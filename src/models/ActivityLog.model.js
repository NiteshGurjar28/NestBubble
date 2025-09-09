import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const activityLogSchema = new mongoose.Schema({
    entityType: {
        type: String,
        required: true,
        enum: ['Amenity', 'AmenityRequest', 'Booking', 'BookingEvent', 'BookingService', 
              'ConciergeService', 'ContactEnquiry', 'Event', 'EventCategory', 'EventRating', 
              'HelpCenter', 'ComingSoon', 'Newsletter', 'Notification', 'Pages', 'Property', 
              'PropertyRating', 'PropertyType', 'Setting', 'FAQ', 'User', 'Vendor', 'Wishlist', 'VendorDiscountCode', 'VendorRefundPolicy']
    },
    entityId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    action: {
        type: String,
        required: true,
    },
    performedBy: {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'User'
        },
        role: {
            type: String,
            required: true,
            enum: ['admin', 'host', 'guest']
        }
    }
}, {
    timestamps: true
});

activityLogSchema.plugin(mongooseAggregatePaginate);

export const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);