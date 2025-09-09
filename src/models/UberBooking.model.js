import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const uberBookingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    guestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Uber specific fields
    uberRequestId: {
      type: String,
      required: true,
      unique: true,
    },
    uberProductId: {
      type: String,
      required: true,
    },
    pickupLocation: {
      address: {
        type: String,
        required: true,
      },
      coordinates: {
        latitude: {
          type: Number,
          required: true,
        },
        longitude: {
          type: Number,
          required: true,
        },
      },
    },
    dropoffLocation: {
      address: {
        type: String,
        required: true,
      },
      coordinates: {
        latitude: {
          type: Number,
          required: true,
        },
        longitude: {
          type: Number,
          required: true,
        },
      },
    },
    // Ride details
    rideDetails: {
      productName: {
        type: String,
        required: true,
      },
      productDescription: String,
      capacity: {
        type: Number,
        default: 4,
      },
      priceEstimate: {
        low: Number,
        high: Number,
        currency: {
          type: String,
          default: "INR",
        },
      },
      durationEstimate: Number, // in seconds
      distanceEstimate: Number, // in meters
    },
    // Booking status
    status: {
      type: String,
      enum: [
        "processing",
        "accepted",
        "arriving",
        "in_progress",
        "completed",
        "cancelled",
        "no_drivers_available",
        "driver_cancelled",
        "rider_cancelled",
      ],
      default: "processing",
    },
    // Driver information (when available)
    driverInfo: {
      driverId: String,
      name: String,
      phoneNumber: String,
      rating: Number,
      vehicleInfo: {
        make: String,
        model: String,
        licensePlate: String,
        color: String,
      },
      location: {
        latitude: Number,
        longitude: Number,
      },
      eta: Number, // estimated time of arrival in seconds
    },
    // Trip information
    tripInfo: {
      startTime: Date,
      endTime: Date,
      actualDuration: Number, // in seconds
      actualDistance: Number, // in meters
      actualFare: {
        amount: Number,
        currency: {
          type: String,
          default: "INR",
        },
      },
      surgeMultiplier: {
        type: Number,
        default: 1.0,
      },
    },
    // Payment information
    paymentInfo: {
      paymentMethodId: String,
      paymentStatus: {
        type: String,
        enum: ["pending", "paid", "failed", "refunded"],
        default: "pending",
      },
      transactionId: String,
      refundAmount: Number,
      refundReason: String,
    },
    // Cancellation details
    cancellation: {
      isCancelled: {
        type: Boolean,
        default: false,
      },
      cancelledBy: {
        type: String,
        enum: ["rider", "driver", "system"],
      },
      cancellationReason: String,
      cancellationTime: Date,
      cancellationFee: Number,
    },
    // Admin liked toggle
    liked: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Additional metadata
    metadata: {
      requestTime: {
        type: Date,
        default: Date.now,
      },
      notes: String,
      specialRequests: [String],
    },
  },
  {
    timestamps: true,
  }
);

// Add pagination plugin
uberBookingSchema.plugin(mongooseAggregatePaginate);

// Indexes for better performance
uberBookingSchema.index({ guestId: 1, createdAt: -1 });
uberBookingSchema.index({ status: 1 });
uberBookingSchema.index({ "pickupLocation.coordinates.latitude": 1, "pickupLocation.coordinates.longitude": 1 });
uberBookingSchema.index({ liked: 1, createdAt: -1 });

// Virtual for formatted booking ID
uberBookingSchema.virtual("formattedBookingId").get(function () {
  return `UB${this.bookingId}`;
});

// Method to calculate estimated fare
uberBookingSchema.methods.getEstimatedFare = function () {
  if (this.rideDetails.priceEstimate) {
    return {
      low: this.rideDetails.priceEstimate.low,
      high: this.rideDetails.priceEstimate.high,
      currency: this.rideDetails.priceEstimate.currency,
    };
  }
  return null;
};

// Method to check if booking can be cancelled
uberBookingSchema.methods.canBeCancelled = function () {
  const cancellableStatuses = ["processing", "accepted", "arriving"];
  return cancellableStatuses.includes(this.status);
};

// Pre-save middleware to generate booking ID
uberBookingSchema.pre("save", async function (next) {
  if (this.isNew && !this.bookingId) {
    const count = await this.constructor.countDocuments();
    this.bookingId = `UB${String(count + 1).padStart(6, "0")}`;
  }
  next();
});

export const UberBooking = mongoose.model("UberBooking", uberBookingSchema);
