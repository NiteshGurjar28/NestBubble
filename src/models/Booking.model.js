import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";
import AutoIncrementFactory from 'mongoose-sequence';
const AutoIncrement = AutoIncrementFactory(mongoose);

const bookingSchema = new mongoose.Schema({

    bookingId: String,
    bookingCounter: Number,
    
    // PROPERTY & GUEST DETAILS
    propertyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: true,
    },
    
    guestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },

    hostId: { 
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', 
        required: true 
    },

    transactionLogId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TransactionLog'
    },

    // BOOKING DATES & DURATION
    bookingDates: {
        startDate: {
            type: Date,
            required: true,
            index: true
        },
        endDate: {
            type: Date,
            required: true,
            index: true
        },
        totalNights: {
            type: Number,
            required: true,
            min: 1
        }
    },

    // GUEST COUNT DETAILS
    guestDetails: {
        adults: {
            type: Number,
            required: true,
            min: 1,
        },
        children: {
            type: Number,
            default: 0,
            min: 0,
        },
        infants: {
            type: Number,
            default: 0,
            min: 0,
        }
    },

    // PRICING BREAKDOWN

    // EXTRA FEATURES & SERVICES
    extraFeatures: [{
        featureType: {
            type: String,
            enum: ['clubHouse', 'car', 'carwithDriver', 'maidService', 'other'],
            required: true
        },
        duration: {
            startDate: {
                type: Date,
                required: true
            },
            endDate: {
                type: Date,
                required: true
            },
            totalDays: {
                type: Number,
                required: true,
                min: 1
            }
        },
        pricing: {
            dailyRate: {
                type: Number,
                required: true,
                min: 0
            },
            totalAmount: {
                type: Number,
                required: true,
                min: 0
            }
        }
    }],

    // DISCOUNTS APPLIED
    discounts: [{
        discountType: {
            type: String,
            enum: ['weeklyDiscount', 'monthlyDiscount', 'lastMintDiscount', 'newListingDiscount']
        },
        percentage: {
            type: Number,
            min: 0,
            max: 100
        },
        amount: {
            type: Number,
            min: 0
        },
    }],


    // FINAL AMOUNT CALCULATION
    amountBreakdown: {
        totalAmountBeforeTax: { type: Number, default: 0 },
        totalTaxAmount: { type: Number, default: 0 },
        totalAmountWithTax: { type: Number, default: 0 },
        totalDiscountAmount: { type: Number, default: 0 },
        amountAfterDiscounts: { type: Number, default: 0 },
        extraFeaturesTotal: { type: Number, default: 0 },
        finalAmount: { type: Number, default: 0 },
        cleaningFeeAmount: { type: Number, default: 0 },
    },

    // BOOKING STATUS & MANAGEMENT
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'completed', 'cancelled'],
        default: 'pending',
        required: true
    },


    // CANCELLATION DETAILS
    cancellation: {
        isCancelled: {
            type: Boolean,
            default: false
        },
        cancelledBy: {
            type: String,
            enum: ['guest', 'host', 'admin']
        },
        cancellationDate: Date,
        cancellationReason: String,
        refundAmount : {
            type: Number,
            default: 0,
            min: 0
        },
        penaltyAmount: {
            type: Number,
            default: 0,
            min: 0
        },
        daysBeforeCancellation: Number,
        penaltyPercent: Number,
    },

}, {
  timestamps: true,
});

// Aggregate paginate plugin
bookingSchema.plugin(mongooseAggregatePaginate);

bookingSchema.plugin(AutoIncrement, { 
  inc_field: 'bookingCounter',   // will auto-increment
  id: 'bookingCounterSeq',       // internal sequence name (must be unique string, not a field)
  start_seq: 1
});

bookingSchema.post('save', async function(doc, next) {
  if (!doc.bookingId && doc.bookingCounter) {  
    doc.bookingId = 'BK' + doc.bookingCounter.toString().padStart(5, '0');
    await doc.constructor.findByIdAndUpdate(doc._id, { bookingId: doc.bookingId });
  }
  next();
});


export const Booking = mongoose.model("Booking", bookingSchema);

