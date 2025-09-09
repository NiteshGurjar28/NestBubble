// models/PropertyCalendar.js
import mongoose from "mongoose";

const propertyCalendarSchema = new mongoose.Schema(
  {
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      index: true,
      required: true,
    },
    date: { type: Date, required: true }, // night-of stay (check-in date)

    // Availability
    status: {
      type: String,
      enum: ["available", "booked", "blocked"],
      default: "available",
      index: true,
    },

    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },

    // Pricing (final nightly price you’ll charge for this date)
    priceBeforeTax: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 },

    // Meta
    isWeekend: { type: Boolean, default: false },
    priceSource: {
      type: String,
      enum: ["base", "weekend"],
      default: "base",
    },
  },
  { timestamps: true }
);

propertyCalendarSchema.index({ propertyId: 1, date: 1 }, { unique: true });

export const PropertyCalendar = mongoose.model(
  "PropertyCalendar",
  propertyCalendarSchema
);
