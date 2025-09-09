import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userRole: {
      type: String,
      enum: ["guest", "host", "admin"],
      required: true,
    },
    balance: { type: Number, default: 0, min: 0 },
    holdBalance: { type: Number, default: 0, min: 0 },
    commission: { type: Number, default: 0, min: 0 },
    totalEarnings: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "INR" },
    
  },
  { timestamps: true }
);

const walletTransactionSchema = new mongoose.Schema(
  {
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    transactionType: {
      type: String,
      enum: [
        "property_booking",
        "event_booking",
        "refund",
        "transfer",
        "withdrawal",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "reversed"],
      default: "pending",
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    bookingType: {
      type: String,
      enum: ["property", "event"],
    },
    metadata: mongoose.Schema.Types.Mixed,
  },
  {
    timestamps: true,
  }
);

walletTransactionSchema.plugin(mongooseAggregatePaginate);
export const WalletTransaction = mongoose.model(
  "WalletTransaction",
  walletTransactionSchema
);

walletSchema.plugin(mongooseAggregatePaginate);
export const Wallet = mongoose.model("Wallet", walletSchema);
