import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const BookingEventSchema = new mongoose.Schema(
  {
    bookingId: {
      type: String,
      unique: true,
      required: true,
      default: function () {
        return (
          "EBK" +
          Date.now() +
          Math.random().toString(36).substr(2, 4).toUpperCase()
        );
      },
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    transactionLogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TransactionLog",
    },
    bookingBy: {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      role: {
        type: String,
        enum: ["host", "guest", "admin"],
        required: true,
        default: "guest",
      },
    },
    bookingDate: {
      type: Date,
      default: Date.now,
    },
    numberOfAttendees: {
      type: Number,
      required: true,
      min: [1, "Minimum 1 attendee required"],
    },
    paymentDetails: {
      paymentMethod: String,
      baseAmount: Number, /// this amount for host
      taxAmount: Number,
      totalAmount: Number,
      transactionId: String,
      refundAmount: String,
      status: {
        type: String,
        enum: ["paid", "refunded"],
        default: "paid",
      },
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled"],
      default: "confirmed",
    },
  },
  { timestamps: true }
);

BookingEventSchema.plugin(mongooseAggregatePaginate);

export const BookingEvent = mongoose.model("BookingEvent", BookingEventSchema);
