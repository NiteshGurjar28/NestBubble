import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const bookingServiceSchema = new mongoose.Schema({
    bookingId: {
        type: String,
        required: true,
        trim: true
    },
    booking: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    serviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ConciergeService',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        match: [/.+\@.+\..+/, 'Please fill a valid email address']
    },
    phoneNumber: {  // Changed from 'phone' to match the form
        type: String,
        required: true,
        trim: true
    },
    eventType: {  // Changed from 'eventCategoryId' to be more descriptive
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EventCategory',
        required: true
    },
    numberOfGuests: {  // New field from the form
        type: Number,
        required: true,
        min: 1
    },
    eventDate: {  // Changed from 'date' to be more specific
        type: Date,
        required: true,
        validate: {
            validator: function(value) {
                return value > new Date();
            },
            message: 'Event date must be in the future'
        }
    },
    message: {
        type: String,
        trim: true,
    },

    bookingForm: [{
        type: String,
        trim: true
    }],
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'completed', 'cancelled'],
        default: 'pending'
    },
    notes: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

bookingServiceSchema.plugin(mongooseAggregatePaginate);

export const BookingService = mongoose.model("BookingService", bookingServiceSchema);

