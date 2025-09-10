// src/socket_v2.js
import { Server } from "socket.io";
import mongoose from "mongoose";
import { Conversation, Message } from "./models/chat.models.js";

let ioV2 = null;

// Track sockets per user to support multi-device connections
const socketIdToUserId = new Map();
const userIdToSocketIds = new Map();

const getUserIdValue = (maybeUser) => {
  if (!maybeUser) return null;
  if (typeof maybeUser === "string") return maybeUser;
  if (typeof maybeUser === "object" && maybeUser._id) return String(maybeUser._id);
  return null;
};

const isValidObjectIdString = (value) => {
  if (typeof value !== "string") return false;
  return mongoose.Types.ObjectId.isValid(value);
};

const toObjectId = (value) => new mongoose.Types.ObjectId(value);

const addSocketForUser = (userId, socketId) => {
  socketIdToUserId.set(socketId, userId);
  if (!userIdToSocketIds.has(userId)) userIdToSocketIds.set(userId, new Set());
  userIdToSocketIds.get(userId).add(socketId);
};

const removeSocketForUser = (socketId) => {
  const userId = socketIdToUserId.get(socketId);
  if (!userId) return;
  socketIdToUserId.delete(socketId);
  const set = userIdToSocketIds.get(userId);
  if (set) {
    set.delete(socketId);
    if (set.size === 0) userIdToSocketIds.delete(userId);
  }
};

const joinUserRooms = (socket, userId) => {
  const room = `user_${userId}`;
  socket.join(room);
};

export const initSocketV2 = (server) => {
  ioV2 = new Server(server, {
    cors: {
      origin: ["http://localhost:8060"],
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    allowEIO3: true,
    path: "/socket.io",
  });

  ioV2.on("connection", (socket) => {
    // Identify and join user room (supports string or {_id})
    socket.on("identify", (payload, ack) => {
      try {
        const userIdStr = getUserIdValue(payload);
        if (!isValidObjectIdString(userIdStr)) {
          if (typeof ack === "function") ack({ ok: false, error: "Invalid userId" });
          return;
        }
        addSocketForUser(userIdStr, socket.id);
        joinUserRooms(socket, userIdStr);
        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        if (typeof ack === "function") ack({ ok: false, error: "Identify failed" });
      }
    });

    // Backward-compatible handlers
    socket.on("joinUserRoom", (userIdLike, ack) => {
      const userIdStr = getUserIdValue(userIdLike);
      if (!isValidObjectIdString(userIdStr)) {
        if (typeof ack === "function") ack({ ok: false, error: "Invalid userId" });
        return;
      }
      addSocketForUser(userIdStr, socket.id);
      joinUserRooms(socket, userIdStr);
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("joinTicketRoom", (ticketId) => {
      if (!ticketId) return;
      socket.join(`ticket_${ticketId}`);
    });

    socket.on("joinAdminRoom", (adminId) => {
      if (!adminId) return;
      socket.join("admin");
      socket.join(`admin_${adminId}`);
    });

    socket.on("joinNotificationRoom", (userIdLike) => {
      const userIdStr = getUserIdValue(userIdLike);
      if (!userIdStr) return;
      socket.join(`host_${userIdStr}`);
      socket.join(`guest_${userIdStr}`);
    });

    socket.on("sendMessage", async (messageData, ack) => {
      try {
        if (!messageData || typeof messageData !== "object") {
          if (typeof ack === "function") ack({ ok: false, error: "Invalid payload" });
          return;
        }

        const senderIdStr = getUserIdValue(messageData.senderId ?? messageData.sender);
        const recipientIdStr = getUserIdValue(messageData.recipientId ?? messageData.recipient);
        const content = typeof messageData.content === "string" ? messageData.content.trim() : "";

        if (!isValidObjectIdString(senderIdStr) || !isValidObjectIdString(recipientIdStr)) {
          if (typeof ack === "function") ack({ ok: false, error: "Invalid senderId or recipientId" });
          return;
        }
        if (!content && !messageData.attachment) {
          if (typeof ack === "function") ack({ ok: false, error: "Message must have content or attachment" });
          return;
        }

        const senderId = toObjectId(senderIdStr);
        const recipientId = toObjectId(recipientIdStr);

        // Find or create one-to-one conversation
        let conversation = await Conversation.findOne({
          participants: { $all: [senderId, recipientId] },
        });

        if (!conversation) {
          conversation = await Conversation.create({
            participants: [senderId, recipientId],
          });
        }

        const newMessage = await Message.create({
          sender: senderId,
          recipient: recipientId,
          content,
          attachment: messageData.attachment ?? undefined,
        });

        conversation.lastMessage = newMessage._id;
        await conversation.save();

        const populatedMessage = await Message.findById(newMessage._id)
          .populate("sender", "firstName lastName profileImage email")
          .populate("recipient", "firstName lastName profileImage email");

        const recipientRoom = `user_${recipientIdStr}`;
        const senderRoom = `user_${senderIdStr}`;

        ioV2.to(recipientRoom).emit("receiveMessage", populatedMessage);
        ioV2.to(senderRoom).emit("senderMessage", populatedMessage);

        if (typeof ack === "function") ack({ ok: true, message: populatedMessage });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[socket_v2] Error sending message:", error);
        if (typeof ack === "function") ack({ ok: false, error: "Failed to send message" });
        else socket.emit("messageError", { error: "Failed to send message" });
      }
    });

    socket.on("disconnect", () => {
      removeSocketForUser(socket.id);
      // eslint-disable-next-line no-console
      console.log("❌ Socket disconnected:", socket.id);
    });
  });

  return ioV2;
};

export const getIOV2 = () => {
  if (!ioV2) throw new Error("Socket.io v2 not initialized");
  return ioV2;
};

