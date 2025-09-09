// src/socket.js
import { Server } from "socket.io";
import { Conversation, Message } from "./models/chat.models.js";

let io = null;

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: ["http://localhost:8060"],
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    allowEIO3: true,
    path: "/socket.io"
  });

  io.on("connection", (socket) => {

    socket.on("joinTicketRoom", (ticketId) => {
        socket.join(`ticket_${ticketId}`);
        // console.log(`Socket ${socket.id} joined ticket room ${ticketId}`);
    });
    
    // Handle admin connection
    socket.on("joinAdminRoom", (adminId) => {
        socket.join('admin');
        socket.join(`admin_${adminId}`); // Individual admin room
        // console.log(`Socket ${socket.id} joined admin room ${adminId}`);
    });

    // socket.on("joinHostRoom", (hostId) => {
    //     socket.join('host'); // All hosts room
    //     socket.join(`host_${hostId}`); // Individual host room
    // });

    // socket.on("joinGuestRoom", (guestId) => {
    //     socket.join('guest'); // All guests room
    //     socket.join(`guest_${guestId}`); // Individual guest room
    //        console.log(`Socket ${socket.id} joined guest room ${guestId}`);
    // });

    socket.on("joinUserRoom", (userId) => {
        socket.join(`user_${userId._id}`); 
    });

    socket.on("joinNotificationRoom", (userId) => {
      console.log(userId);
        socket.join(`host_${userId._id}`);
        socket.join(`guest_${userId._id}`);
    });



    socket.on("sendMessage", async (messageData) => {
        try {
            const { senderId, recipientId, content } = messageData;
            
            // Check if conversation exists or create new one
            let conversation = await Conversation.findOne({
                participants: { $all: [senderId, recipientId] }
            });

            if (!conversation) {
                conversation = await Conversation.create({
                    participants: [senderId, recipientId]
                });
            }

            // Create new message
            const newMessage = await Message.create({
                sender: senderId,
                recipient: recipientId,
                content
            });

            // Update conversation's last message
            conversation.lastMessage = newMessage._id;
            await conversation.save();

            // Populate message with sender details
            const populatedMessage = await Message.findById(newMessage._id)
                .populate('sender', 'firstName lastName profileImage email')
                .populate('recipient', 'firstName lastName profileImage email');

            // Determine recipient and sender rooms
            const recipientRoom = `user_${recipientId}`;
            const senderRoom = `user_${senderId}`;

            // Emit to both users
            io.to(recipientRoom).emit("receiveMessage", populatedMessage);
            io.to(senderRoom).emit("senderMessage", populatedMessage);

        } catch (error) {
            console.error("Error sending message:", error);
            // Emit error back to sender
            socket.emit("messageError", { error: "Failed to send message" });
        }
    });


    socket.on("disconnect", () => {
      console.log("❌ Socket disconnected:", socket.id);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized");
  return io;
};
