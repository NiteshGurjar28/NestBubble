import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const TransactionLogSchema = new mongoose.Schema({
        gateway: { type: String, enum: ['stripe','razorpay'], required: true },
        gatewayPaymentId: String, 
        gatewayOrderId: String,  
        baseAmount :{ type: Number, required: true },
        totalAmount: { type: Number, required: true }, 
        taxAmount: {
            percent: {
                type: Number, default: 0 
            },
            amount: {
                type: Number, default: 0 
            }
        },
        currency: { type: String, default: 'INR' },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
        propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' },
        status: { type: String, enum: ['pending','paid','failed'], default: 'pending' },
        metadata: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

TransactionLogSchema.plugin(mongooseAggregatePaginate);

export const TransactionLog = mongoose.model("TransactionLog", TransactionLogSchema);

