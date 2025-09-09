import { Notification } from "../models/Notification.model.js";
import { getIO } from "../socket.js";

export const createNotification = async ({
    recipientId,
    recipientRole,
    senderId,
    title,
    message,
    notificationType,
    actionId,
    actionUrl,
    metadata = {}
}) => {
    try {
        const notification = await Notification.create({
            recipient: {
                user: recipientId,
                role: recipientRole
            },
            sender: senderId,
            title,
            message,
            notificationType,
            actionId: actionId,
            actionUrl,
            metadata
        });

        const io = getIO();

        const notificationPayload = {
            _id: notification._id,
            title: notification.title,
            message: notification.message,
            notificationType: notification.notificationType,
            actionId: notification.actionId,
            createdAt: notification.createdAt,
            sender: notification.sender 
        };
        
        if (recipientRole === "host") {
            io.to(`host_${recipientId}`).emit("hostNotification", notificationPayload);
        } else if (recipientRole === "guest") {
            io.to(`guest_${recipientId}`).emit("guestNotification", notificationPayload);
        }
        

        return notification;
    } catch (error) {
        console.error("Error creating notification:", error);
        throw error;
    }
};