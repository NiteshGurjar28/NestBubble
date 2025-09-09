import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const notificationSchema = new mongoose.Schema({
    recipient: {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        role: {
            type: String,
            enum: ['guest', 'host', 'admin'],
            required: true
        }
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    isRead: {
        type: Boolean,
        default: false
    },
    readAt: {
        type: Date
    },
    notificationType: {
        type: String,
        enum: [
            'property',
            'property_booking',
            'event',
            'event_booking',
            'event_invitation',
            'service',
            'service_booking',
            'rating',
            'amenity',
            'payment',
            'system'
        ],
        required: true
    },
    actionId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'notificationType'
    },
    actionUrl: {
        type: String
    },
    metadata: {
        type: Object
    }
}, { timestamps: true });

// Indexes for better performance
notificationSchema.index({ 'recipient.user': 1, 'recipient.role': 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.plugin(mongooseAggregatePaginate);

export const Notification = mongoose.model("Notification", notificationSchema);