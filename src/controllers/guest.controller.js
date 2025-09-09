import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { User } from "../models/user.model.js";
import { Property } from "../models/Property.model.js";
import { Booking } from "../models/Booking.model.js";
import { PropertyCalendar } from "../models/PropertyCalendar.model.js";
import { Wishlist } from "../models/wishlist.model.js";
import { Wallet, WalletTransaction } from "../models/Wallet.model.js";
import {
  PropertyRating,
  PropertySuggestion,
} from "../models/PropertyRating.model.js";
import { ConciergeService } from "../models/ConciergeService.model.js";
import { BookingService } from "../models/BookingService.model.js";
import { EventCategory } from "../models/EventCategory.model.js";
import { Event } from "../models/Event.model.js";
import { BookingEvent } from "../models/BookingEvent.model.js";
import { EventRating } from "../models/EventRating.model.js";
import { TransactionLog } from "../models/TransactionLog.model.js";
import { Setting, FAQ } from "../models/Setting.model.js";
import { createNotification } from "../utils/notification.helper.js";
import { createActivityLog } from "../utils/activityLog.helper.js";
import mongoose from "mongoose";
import Stripe from "stripe";
import Razorpay from "razorpay";

const propertyBooking = asyncHandler(async (req, res) => {
  const { paymentType, propertyId, bookingSummary } = req.body;

  const userId = req.user._id;
  // const userId = "68b2bdf259c5330a60f8ffe7";
  if (!paymentType || !["stripe", "razorpay"].includes(paymentType)) {
    return res
      .status(400)
      .json(
        new ApiError(
          400,
          'Invalid payment type. Must be "stripe" or "razorpay"'
        )
      );
  }
  if (!propertyId) {
    return res
      .status(400)
      .json(new ApiError(400, "Missing required booking fields"));
  }

  // Validate required fields
  const property = await Property.findById(propertyId).populate(
    "propertyType",
    "cleaningFees"
  );
  if (!property)
    return res.status(404).json(new ApiError(404, "Property not found"));
  if (
    property.status !== "active" ||
    property.adminApprovalStatus !== "approved"
  ) {
    return res
      .status(400)
      .json(new ApiError(400, "Property is not available for booking"));
  }

  // Validate property owner
  if (property.owner.toString() === req.user._id.toString()) {
    return res
      .status(400)
      .json(new ApiError(400, "You cannot book your own property"));
  }

  const checkInDate = new Date(bookingSummary.bookingDates.startDate);
  const checkOutDate = new Date(bookingSummary.bookingDates.endDate);

  if (isNaN(checkInDate) || isNaN(checkOutDate)) {
    return res
      .status(400)
      .json(
        new ApiError(400, "Invalid date format. Please provide valid dates.")
      );
  }

  // Calculate nights
  const oneDay = 1000 * 60 * 60 * 24;
  const totalNights = Math.ceil((checkOutDate - checkInDate) / oneDay);

  if (totalNights <= 0) {
    return res
      .status(400)
      .json(new ApiError(400, "End date must be after start date."));
  }

  // End date exclusive for calendar lookup
  const calendarEndDate = new Date(checkOutDate);
  calendarEndDate.setDate(calendarEndDate.getDate() - 1);

  // ========== AVAILABILITY CHECK ==========
  const unavailableDates = await PropertyCalendar.find({
    propertyId,
    date: { $gte: checkInDate, $lte: calendarEndDate },
    status: { $in: ["blocked", "booked"] },
  });

  if (unavailableDates.length > 0) {
    return res
      .status(400)
      .json(
        new ApiError(
          400,
          "Some selected dates are not available for booking.",
          unavailableDates
        )
      );
  }

  const amountInSubunits = Math.round(bookingSummary.pricing.finalAmount * 100);

  const transactionLog = await TransactionLog.create({
    gateway: paymentType,
    baseAmount: bookingSummary.pricing.totalAmountWithTax,
    totalAmount: bookingSummary.pricing.finalAmount,
    currency: "INR",
    userId,
    propertyId,
    status: "pending",
    taxAmount: bookingSummary?.pricing?.totalTaxAmount ?? 0,
    metadata: bookingSummary,
  });

  if (paymentType == "stripe") {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res
        .status(500)
        .json(
          new ApiError(
            500,
            "STRIPE_SECRET_KEY is missing in environment variables"
          )
        );
    }

    // Initialize Stripe with error handling
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2023-08-16",
    });

    // Create payment intent with enhanced options
    const pi = await stripe.paymentIntents.create({
      amount: amountInSubunits, // Convert to smallest currency unit
      currency: "inr", // Ensure lowercase
      metadata: {
        paymentRecordId: transactionLog._id.toString(),
        propertyId: propertyId.toString(),
      },
      automatic_payment_methods: { enabled: true },
    });

    transactionLog.gatewayOrderId = pi.id;
    await transactionLog.save();

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          provider: "stripe",
          clientSecret: pi.client_secret,
          paymentRecordId: transactionLog._id,
          amount: bookingSummary.pricing.finalAmount, // ✅ Return final amount instead of divided value
          transactionLog,
        },
        "Stripe Payment link created successfully"
      )
    );
  } else if (paymentType == "razorpay") {
    // Razorpay Payment Integration
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            "Razorpay credentials missing in environment variables"
          )
        );
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const options = {
      amount: amountInSubunits,
      currency: "INR",
      receipt: `receipt_${transactionLog._id}`,
      notes: {
        paymentRecordId: transactionLog._id.toString(),
        propertyId: propertyId.toString(),
      },
    };

    const order = await razorpay.orders.create(options);
    transactionLog.gatewayOrderId = order.id;
    await transactionLog.save();

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          provider: "razorpay",
          orderId: order.id,
          amount: bookingSummary.pricing.finalAmount,
          razorpayKeyId: process.env.RAZORPAY_KEY_ID,
          paymentRecordId: transactionLog._id,
          transactionLog,
        },
        "Razorpay order created successfully"
      )
    );
  }
});

const bookPropertyWithPayment = asyncHandler(async (req, res) => {
  try {
    const { paymentRecordId } = req.body;

    if (!paymentRecordId) {
      return res
        .status(400)
        .json(new ApiError(400, "Payment record ID is required"));
    }

    const transactionLog = await TransactionLog.findById(paymentRecordId);

    if (!transactionLog) {
      return res
        .status(404)
        .json(new ApiError(404, "Payment record not found"));
    }

    // Check if payment is already processed
    if (transactionLog.status === "paid") {
      // Wait for booking to be created with a timeout
      const maxWaitTime = 10000; // 10 seconds
      const startTime = Date.now();

      let bookingInfo = null;

      while (Date.now() - startTime < maxWaitTime && !bookingInfo) {
        bookingInfo = await Booking.findOne({
          transactionLogId: transactionLog._id,
        }).lean();

        if (!bookingInfo) {
          // Wait for 500ms before checking again
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      if (bookingInfo) {
        return res
          .status(200)
          .json(
            new ApiResponse(
              200,
              { bookingInfo },
              `Your property has been successfully booked! Confirmation ID: ${bookingInfo.bookingId}`
            )
          );
      } else {
        return res
          .status(202)
          .json(
            new ApiResponse(
              202,
              null,
              "Booking is being processed. Please check back shortly."
            )
          );
      }
    } else {
      return res.status(400).json(new ApiError(400, "Payment is processing"));
    }
  } catch (error) {
    console.error("Booking error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", error.message));
  }
});

const getPropertyBookingList = asyncHandler(async (req, res) => {
  try {
    // Extract query parameters
    const {
      page = 1,
      limit = 10,
      sort = "createdAt",
      order = "desc",
      search = "",
      status = "",
      propertyName = "",
    } = req.query;

    // Build the filter object
    const filter = {};
    filter.guestId = req.user._id;

    // Filter by booking status
    if (status) {
      filter.status = status;
    }

    // Search by property name (via population)
    if (propertyName) {
      filter["propertyDetails.name"] = { $regex: propertyName, $options: "i" };
    }

    // Search by guest name or booking ID (optional)
    if (search) {
      filter.$or = [
        { bookingId: { $regex: search, $options: "i" } },
        { "guestDetails.name": { $regex: search, $options: "i" } },
      ];
    }

    // Build sort object
    const sortOptions = {};
    sortOptions[sort] = order === "desc" ? -1 : 1;

    // Execute all counts in parallel for better performance
    const [
      bookings,
      filterTotalBooking,
      totalBookings,
      upcomingCount,
      completedCount,
      cancelledCount,
    ] = await Promise.all([
      // Get paginated bookings
      Booking.find(filter)
        .sort(sortOptions)
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .populate({
          path: "propertyId",
          select: "name slug images pricing address coordinates capacity",
        })
        .populate({
          path: "guestId",
          select: "firstName lastName email mobile profileImage",
        })
        .lean(),

      // Get total count matching current filters
      Booking.countDocuments(filter),
      Booking.countDocuments({ guestId: req.user._id }),

      // Get upcoming bookings count (pending + confirmed)
      Booking.countDocuments({
        guestId: req.user._id,
        status: { $in: ["pending", "confirmed"] },
      }),

      // Get completed bookings count
      Booking.countDocuments({
        guestId: req.user._id,
        status: "completed",
      }),

      // Get cancelled bookings count
      Booking.countDocuments({
        guestId: req.user._id,
        status: "cancelled",
      }),
    ]);

    // Calculate total pages
    const totalPages = Math.ceil(totalBookings / limit);

    // Prepare response with status counts
    const response = {
      success: true,
      data: bookings,
      counts: {
        total: totalBookings,
        upcoming: upcomingCount,
        completed: completedCount,
        cancelled: cancelledCount,
      },
      pagination: {
        totalBookings: filterTotalBooking,
        totalPages,
        currentPage: parseInt(page),
        itemsPerPage: parseInt(limit),
        nextPage: page < totalPages ? parseInt(page) + 1 : null,
        prevPage: page > 1 ? parseInt(page) - 1 : null,
      },
      filters: {
        search,
        status,
        propertyName,
      },
    };

    return res
      .status(200)
      .json(
        new ApiResponse(200, response, "Booking listing retrieved successfully")
      );
  } catch (error) {
    console.error("Error in booking listing:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", [error.message]));
  }
});

const getPropertyBookingDetails = asyncHandler(async (req, res) => {
  try {
    const { bookingId } = req.params;
    if (!bookingId) {
      return res.status(400).json(new ApiError(400, "Booking ID is required"));
    }

    const booking = await Booking.findById(bookingId)
      .populate({ path: "propertyId" })
      .populate({
        path: "guestId",
        select: "firstName lastName email mobile profileImage",
      })
      .populate({
        path: "hostId",
        select: "firstName lastName email mobile profileImage",
      })
      .lean();

    if (!booking) {
      return res.status(404).json(new ApiError(404, "Booking not found"));
    }

    // get this booking rating
    const rating = await PropertyRating.findOne({
      bookingId: bookingId,
      guestId: req.user._id,
    });

    // get this booking suggestion
    const suggestion = await PropertySuggestion.findOne({
      bookingId: bookingId,
      guestId: req.user._id,
    });

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { booking, rating, suggestion },
          "Booking details fetched successfully"
        )
      );
  } catch (error) {
    console.error("Event error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const propertyBookingCancelCalculation = asyncHandler(async (req, res) => {
  try {
    const { bookingId } = req.query;

    // Validate bookingId
    if (!bookingId) {
      return res.status(400).json(new ApiError(400, "Booking ID is required"));
    }

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res
        .status(400)
        .json(new ApiError(400, "Invalid Booking ID format"));
    }

    // Find booking with proper error handling
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json(new ApiError(404, "Booking not found"));
    }

    // Check if booking is already cancelled
    if (booking.status === "cancelled") {
      return res
        .status(400)
        .json(new ApiError(400, "Booking is already cancelled"));
    }

    // Check if booking is completed
    if (booking.status === "completed") {
      return res
        .status(400)
        .json(new ApiError(400, "Cannot cancel a completed booking"));
    }

    const today = new Date();
    const startDate = new Date(booking.bookingDates.startDate);

    // Check if booking has already started or passed
    if (startDate <= today) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            "Cannot cancel a booking that has already started or passed"
          )
        );
    }

    // Days before start date
    const diffTime = startDate.getTime() - today.getTime();
    const daysBefore = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let penaltyPercent = 0;
    let cancellationPolicy = "";

    // Define cancellation policy based on days before booking
    if (daysBefore <= 0) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            "Cancellation is not allowed on or after the booking date"
          )
        );
    } else if (daysBefore <= 1) {
      penaltyPercent = 80;
      cancellationPolicy = "Less than 24 hours before check-in: 80% penalty";
    } else if (daysBefore <= 7) {
      penaltyPercent = 50;
      cancellationPolicy = "2-7 days before check-in: 50% penalty";
    } else if (daysBefore <= 15) {
      penaltyPercent = 25;
      cancellationPolicy = "8-15 days before check-in: 25% penalty";
    } else if (daysBefore <= 30) {
      penaltyPercent = 10;
      cancellationPolicy = "16-30 days before check-in: 10% penalty";
    } else {
      penaltyPercent = 0;
      cancellationPolicy = "More than 30 days before check-in: Full refund";
    }

    const finalAmount = booking.amountBreakdown.finalAmount || 0;
    const penaltyAmount = (finalAmount * penaltyPercent) / 100;
    const refundAmount = finalAmount - penaltyAmount;

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          bookingId: booking._id,
          bookingCode: booking.bookingId,
          finalAmount,
          daysBefore,
          penaltyPercent,
          penaltyAmount,
          refundAmount,
          cancellationPolicy,
          startDate: booking.bookingDates.startDate,
          currency: booking.amountBreakdown.currency || "INR",
        },
        "Cancellation calculation successful"
      )
    );
  } catch (error) {
    console.error("Cancellation calculation error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", error.message));
  }
});

const propertyBookingCancel = asyncHandler(async (req, res) => {
  try {
    const { bookingId, message } = req.body;

    // Validate the required fields
    if (!bookingId || !message) {
      return res
        .status(400)
        .json(
          new ApiError(400, "Booking ID and cancellation reason are required")
        );
    }

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res
        .status(400)
        .json(new ApiError(400, "Invalid Booking ID format"));
    }

    // Validate the booking exists
    const existingBooking = await Booking.findById(bookingId);
    if (!existingBooking) {
      return res.status(404).json(new ApiError(404, "Booking not found"));
    }

    // Validate the booking is not already completed
    if (existingBooking.status === "completed") {
      return res
        .status(400)
        .json(new ApiError(400, "Cannot cancel a completed booking"));
    }

    // Validate the booking is not already cancelled
    if (existingBooking.status === "cancelled") {
      return res
        .status(400)
        .json(new ApiError(400, "Booking is already cancelled"));
    }

    // Check if booking is in the future
    const now = new Date();
    const startDate = new Date(existingBooking.bookingDates.startDate);
    const endDate = new Date(existingBooking.bookingDates.endDate);
    if (startDate <= now) {
      return res
        .status(400)
        .json(
          new ApiError(400, "Cannot cancel a booking that has already started")
        );
    }

    // Calculate cancellation fees
    const diffTime = startDate.getTime() - now.getTime();
    const daysBefore = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let penaltyPercent = 0;
    if (daysBefore <= 1) {
      penaltyPercent = 80;
    } else if (daysBefore <= 7) {
      penaltyPercent = 50;
    } else if (daysBefore <= 15) {
      penaltyPercent = 25;
    } else if (daysBefore <= 30) {
      penaltyPercent = 10;
    }

    const finalAmount =
      existingBooking.amountBreakdown.finalAmount -
        existingBooking.amountBreakdown.totalTaxAmount || 0;
    const penaltyAmount = (finalAmount * penaltyPercent) / 100;
    const refundAmount = finalAmount - penaltyAmount;

    // Update the booking status to cancelled
    existingBooking.status = "cancelled";
    existingBooking.cancellation = {
      isCancelled: true,
      cancelledBy: "guest",
      cancellationDate: new Date(),
      cancellationReason: message,
      penaltyPercent,
      penaltyAmount,
      refundAmount,
      daysBeforeCancellation: daysBefore,
    };

    await PropertyCalendar.updateMany(
      { bookingId: existingBooking._id },
      {
        $set: {
          status: "available",
          bookingId: null,
        },
      }
    );

    // Get property details for notification
    const property = await Property.findById(existingBooking.propertyId);

    const hostWallet = await getOrCreateWallet(existingBooking.hostId, "host");
    const guestWallet = await getOrCreateWallet(
      existingBooking.guestId,
      "guest"
    );

    // Refund to guest
    await WalletTransaction.create({
      walletId: guestWallet._id,
      amount: refundAmount,
      transactionType: "refund",
      status: "completed",
      bookingId: existingBooking._id,
      bookingType: "property",
      metadata: { refundAmount, cancellationReason: message },
    });
    guestWallet.balance += refundAmount;
    await guestWallet.save();

    // Deduct from host holdBalance
    await WalletTransaction.create({
      walletId: hostWallet._id,
      amount: refundAmount,
      transactionType: "refund",
      status: "completed",
      bookingId: existingBooking._id,
      bookingType: "property",
      metadata: { refundAmount, cancellationReason: message },
    });

    hostWallet.holdBalance = Math.max(0, hostWallet.holdBalance - refundAmount);
    await hostWallet.save();

    // Save the updated booking
    await existingBooking.save();

    await createNotification({
      recipientId: existingBooking.hostId,
      recipientRole: "host",
      senderId: req.user._id,
      senderRole: "guest",
      title: "Booking Cancelled",
      message:
        `Your booking for "${property.name}" has been cancelled by the guest. ` +
        `Reason: ${message}.`,
      notificationType: "property_booking",
      actionId: existingBooking._id,
      actionUrl: `/host/bookings/${existingBooking._id}`,
      metadata: {
        bookingId: existingBooking._id,
        propertyId: property._id,
        status: "cancelled",
        dates: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
        cancellationReason: message,
      },
    });

    // Create activity log
    await createActivityLog({
      entityType: "Property",
      entityId: property._id,
      userId: req.user._id,
      userRole: "guest",
      action: "bookingCancel",
    });

    return res
      .status(200)
      .json(new ApiResponse(200, {}, "Booking cancelled successfully"));
  } catch (error) {
    console.error("Error in cancelling booking:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", error.message));
  }
});

const addRemoveToWishlist = asyncHandler(async (req, res) => {
  const { propertyId } = req.body;
  const guestId = req.user._id;

  // Validate propertyId format
  if (!mongoose.Types.ObjectId.isValid(propertyId)) {
    return res
      .status(400)
      .json(new ApiError(400, "Invalid property ID format"));
  }

  // Check if property exists
  const propertyExists = await Property.exists({ _id: propertyId });
  if (!propertyExists) {
    return res.status(404).json(new ApiError(404, "Property not found"));
  }

  // Check existing wishlist item in a single query
  const existingWishlist = await Wishlist.findOneAndDelete({
    user: guestId,
    property: propertyId,
  });

  if (existingWishlist) {
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { isWishlisted: false },
          "Property removed from wishlist"
        )
      );
  }

  // If not found, create new wishlist item
  const wishlist = await Wishlist.create({
    user: guestId,
    property: propertyId,
  });

  return res
    .status(200)
    .json(
      new ApiResponse(200, { isWishlisted: true }, "Property added to wishlist")
    );
});

const getWishlist = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = "" } = req.query;
  const guestId = req.user._id;

  // Convert page and limit to numbers and validate
  const pageNumber = parseInt(page);
  const limitNumber = parseInt(limit);

  if (isNaN(pageNumber)) {
    return res.status(400).json(new ApiError(400, "Invalid page number"));
  }

  if (isNaN(limitNumber)) {
    return res.status(400).json(new ApiError(400, "Invalid limit value"));
  }

  // Create base aggregation pipeline
  const pipeline = [
    // Match wishlist items for current user
    {
      $match: {
        user: new mongoose.Types.ObjectId(guestId),
      },
    },
    // Lookup property details with status filter
    {
      $lookup: {
        from: "properties",
        localField: "property",
        foreignField: "_id",
        as: "propertyData",
        pipeline: [
          {
            $match: {
              status: "active",
              $or: search
                ? [
                    { name: { $regex: search, $options: "i" } },
                    { description: { $regex: search, $options: "i" } },
                  ]
                : [{}],
            },
          },
          // Lookup property type name
          {
            $lookup: {
              from: "propertytypes",
              localField: "propertyType",
              foreignField: "_id",
              as: "propertyTypeInfo",
            },
          },
          { $unwind: "$propertyTypeInfo" },
          // Lookup today's price and status from propertycalendars
          {
            $lookup: {
              from: "propertycalendars",
              let: { propertyId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$propertyId", "$$propertyId"] },
                        {
                          $gte: [
                            "$date",
                            new Date(new Date().setHours(0, 0, 0, 0)),
                          ],
                        },
                        {
                          $lt: [
                            "$date",
                            new Date(new Date().setHours(23, 59, 59, 999)),
                          ],
                        },
                      ],
                    },
                  },
                },
                { $project: { price: 1, status: 1 } },
              ],
              as: "todayPriceInfo",
            },
          },
          {
            $unwind: {
              path: "$todayPriceInfo",
              preserveNullAndEmptyArrays: true,
            },
          },
          // Get featured image
          {
            $addFields: {
              featuredImage: {
                $filter: {
                  input: "$images",
                  as: "image",
                  cond: { $eq: ["$$image.isFeatured", true] },
                },
              },
              // Add today's price and status
              todayPrice: {
                $ifNull: ["$todayPriceInfo.price", "$pricing.baseAmount"],
              },
              todayStatus: {
                $ifNull: ["$todayPriceInfo.status", "available"],
              },
            },
          },
          // Project only the required fields
          {
            $project: {
              _id: 1,
              name: 1,
              slug: 1,
              address: 1,
              coordinates: 1,
              capacity: 1,
              featuredImage: { $arrayElemAt: ["$featuredImage.url", 0] },
              propertyTypeName: "$propertyTypeInfo.name",
              pricing: 1,
              todayPrice: 1,
              todayStatus: 1,
            },
          },
        ],
      },
    },
    // Unwind property data
    { $unwind: "$propertyData" },
    // Final projection
    {
      $project: {
        _id: 0,
        property: {
          _id: "$propertyData._id",
          name: "$propertyData.name",
          slug: "$propertyData.slug",
          address: "$propertyData.address",
          coordinates: "$propertyData.coordinates",
          capacity: "$propertyData.capacity",
          featuredImage: "$propertyData.featuredImage",
          propertyTypeName: "$propertyData.propertyTypeName",
          pricing: "$propertyData.pricing",
          todayPrice: "$propertyData.todayPrice",
          todayStatus: "$propertyData.todayStatus",
          isWishlisted: true,
        },
      },
    },
  ];

  // Get total count
  const countPipeline = [...pipeline];
  countPipeline.push({ $count: "total" });
  const countResult = await Wishlist.aggregate(countPipeline);
  const totalCount = countResult[0]?.total || 0;

  // Add pagination to main pipeline
  pipeline.push(
    { $skip: (pageNumber - 1) * limitNumber },
    { $limit: limitNumber }
  );

  // Execute aggregation
  const wishlistItems = await Wishlist.aggregate(pipeline);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        items: wishlistItems.map((item) => item.property),
        pagination: {
          totalItems: totalCount,
          totalPages: Math.ceil(totalCount / limitNumber),
          currentPage: pageNumber,
          itemsPerPage: limitNumber,
        },
      },
      "Wishlist retrieved successfully"
    )
  );
});

const addPropertyRating = asyncHandler(async (req, res) => {
  try {
    const {
      bookingId,
      rating,
      comfortableRating,
      cleanlinessRating,
      facilitiesRating,
      review,
    } = req.body;
    const guestId = req.user._id;

    // Validate all rating fields
    const ratingFields = {
      rating,
      comfortableRating,
      cleanlinessRating,
      facilitiesRating,
    };
    for (const [field, value] of Object.entries(ratingFields)) {
      if (value !== undefined && (value < 1 || value > 5)) {
        return res
          .status(400)
          .json(new ApiResponse(400, null, `${field} must be between 1 and 5`));
      }
    }

    // Validate review length
    if (review && review.length > 500) {
      return res
        .status(400)
        .json(
          new ApiResponse(400, null, "Review cannot exceed 500 characters")
        );
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json(new ApiResponse(404, null, "Booking not found"));
    }

    if (booking.guestId.toString() !== guestId.toString()) {
      return res
        .status(403)
        .json(
          new ApiResponse(
            403,
            null,
            "You are not authorized to rate this booking"
          )
        );
    }

    if (booking.status !== "completed") {
      return res
        .status(400)
        .json(
          new ApiResponse(400, null, "You can only rate a completed booking")
        );
    }

    const existingRating = await PropertyRating.findOne({ bookingId, guestId });
    if (existingRating) {
      return res
        .status(400)
        .json(
          new ApiResponse(400, null, "You have already rated this booking")
        );
    }

    // Create and save new rating
    const newRating = await PropertyRating.create({
      propertyId: booking.propertyId,
      guestId,
      bookingId,
      rating,
      comfortableRating,
      cleanlinessRating,
      facilitiesRating,
      review,
    });

    // Create activity log
    await createActivityLog({
      entityType: "Property",
      entityId: booking.propertyId,
      userId: guestId,
      userRole: "guest",
      action: "rating",
    });

    // Calculate all average ratings in a single query
    const ratings = await PropertyRating.find({
      propertyId: booking.propertyId,
    });
    const ratingData = {
      averageRating: 0,
      averageComfortableRating: 0,
      averageCleanlinessRating: 0,
      averageFacilitiesRating: 0,
    };

    if (ratings.length > 0) {
      ratingData.averageRating = calculateAverage(ratings, "rating");
      ratingData.averageComfortableRating = calculateAverage(
        ratings,
        "comfortableRating"
      );
      ratingData.averageCleanlinessRating = calculateAverage(
        ratings,
        "cleanlinessRating"
      );
      ratingData.averageFacilitiesRating = calculateAverage(
        ratings,
        "facilitiesRating"
      );
    }

    // Update property with all averages
    await Property.findByIdAndUpdate(booking.propertyId, {
      ...ratingData,
      $inc: { ratingCount: 1 },
    });

    return res
      .status(200)
      .json(new ApiResponse(200, null, "Property rating added successfully"));
  } catch (error) {
    console.error("Error in adding rating:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", [error.message]));
  }
});

const addPropertySuggestion = asyncHandler(async (req, res) => {
  try {
    const { bookingId, suggestion } = req.body;
    const guestId = req.user._id;

    // Validate suggestion length
    if (suggestion && suggestion.length > 500) {
      return res
        .status(400)
        .json(
          new ApiResponse(400, null, "Suggestion cannot exceed 500 characters")
        );
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json(new ApiResponse(404, null, "Booking not found"));
    }

    if (booking.guestId.toString() !== guestId.toString()) {
      return res
        .status(403)
        .json(
          new ApiResponse(
            403,
            null,
            "You are not authorized to rate this booking"
          )
        );
    }

    if (booking.status !== "completed") {
      return res
        .status(400)
        .json(
          new ApiResponse(400, null, "You can only rate a completed booking")
        );
    }

    const existingSuggestion = await PropertySuggestion.findOne({
      bookingId,
      guestId,
    });
    if (existingSuggestion) {
      return res
        .status(400)
        .json(
          new ApiResponse(400, null, "You have already suggested this booking")
        );
    }

    // Create and save new suggestion
    await PropertySuggestion.create({
      propertyId: booking.propertyId,
      guestId,
      bookingId,
      suggestion,
    });

    // Create activity log
    // await createActivityLog({
    //     entityType: 'Property',
    //     entityId: booking.propertyId,
    //     userId: guestId,
    //     userRole: 'guest',
    //     action: 'rating',
    // });

    return res
      .status(200)
      .json(
        new ApiResponse(200, null, "Property suggestion added successfully")
      );
  } catch (error) {
    console.error("Error in adding rating:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", [error.message]));
  }
});

function calculateAverage(ratings, field) {
  const sum = ratings.reduce((total, item) => total + (item[field] || 0), 0);
  return parseFloat((sum / ratings.length).toFixed(2));
}

const serviceBooking = asyncHandler(async (req, res) => {
  try {
    const {
      bookingId,
      serviceId,
      name,
      email,
      phoneNumber,
      eventType,
      numberOfGuests,
      eventDate,
      message,
      bookingForm,
    } = req.body;

    // Validate required fields
    if (
      !bookingId ||
      !serviceId ||
      !eventType ||
      !numberOfGuests ||
      !eventDate
    ) {
      return res.status(400).json(new ApiError(400, "Missing required fields"));
    }

    // Get userId from authenticated user
    const userId = req.user._id;

    // Validate ObjectIDs
    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json(new ApiError(400, "Invalid service ID"));
    }

    if (!mongoose.Types.ObjectId.isValid(eventType)) {
      return res.status(400).json(new ApiError(400, "Invalid Event Type ID"));
    }

    const [eventTypeData, serviceData] = await Promise.all([
      EventCategory.findById(eventType),
      ConciergeService.findById(serviceId),
    ]);

    if (!eventTypeData) {
      return res.status(400).json(new ApiError(400, "Event Type not found"));
    }

    if (!serviceData) {
      return res.status(400).json(new ApiError(400, "Service not found"));
    }

    // 1. Check if the booking exists
    const bookingData = await Booking.findOne({ bookingId });
    if (!bookingData) {
      return res
        .status(404)
        .json(new ApiError(404, "Booking ID does not exist"));
    }

    const selectedDate = new Date(eventDate);
    if (selectedDate <= new Date()) {
      return res
        .status(400)
        .json(new ApiError(400, "Event date must be in the future"));
    }

    if (numberOfGuests < 1) {
      return res
        .status(400)
        .json(new ApiError(400, "Number of guests must be at least 1"));
    }

    // 2. Verify the user is authorized (matches guestId in booking)
    if (bookingData.guestId.toString() !== userId.toString()) {
      return res
        .status(403)
        .json(new ApiError(403, "You are not authorized to use this booking"));
    }

    // 4. Check if this service is already booked for this booking
    const existingServiceBooking = await BookingService.findOne({
      booking: bookingData._id,
      serviceId,
      userId,
    });

    if (existingServiceBooking) {
      return res
        .status(409)
        .json(
          new ApiError(409, "This service is already booked for this booking")
        );
    }

    // Create new service booking with dynamic form data
    const booking = await BookingService.create({
      bookingId,
      booking: bookingData._id,
      userId,
      serviceId,
      name,
      email,
      phoneNumber,
      eventType,
      numberOfGuests,
      eventDate: selectedDate,
      message,
      bookingForm,
      status: "pending",
    });

    await createActivityLog({
      entityType: "ConciergeService",
      entityId: serviceId,
      userId: req.user._id,
      userRole: "guest",
      action: "booking",
    });

    return res
      .status(201)
      .json(
        new ApiResponse(201, booking, "Service Booking created successfully")
      );
  } catch (error) {
    console.error("Error Booking Service:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", error.message));
  }
});

const getServiceBookingList = asyncHandler(async (req, res) => {
  try {
    // Extract query parameters with defaults
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "",
      eventType = "",
      fromDate = "",
      toDate = "",
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Validate pagination parameters
    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    if (
      isNaN(pageNumber) ||
      isNaN(limitNumber) ||
      pageNumber < 1 ||
      limitNumber < 1
    ) {
      return res
        .status(400)
        .json(new ApiError(400, "Invalid pagination parameters"));
    }

    // Build the base query
    const query = {};

    // Add search filter (case-insensitive)
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { bookingId: { $regex: search, $options: "i" } },
      ];
    }

    query.userId = req.user._id;

    // Add status filter
    if (status) {
      query.status = status;
    }

    // Add event type filter
    if (eventType && mongoose.Types.ObjectId.isValid(eventType)) {
      query.eventType = eventType;
    }

    // Add date range filter
    if (fromDate || toDate) {
      query.eventDate = {};
      if (fromDate) {
        query.eventDate.$gte = new Date(fromDate);
      }
      if (toDate) {
        query.eventDate.$lte = new Date(toDate);
      }
    }

    // Get total count for pagination
    const totalBookings = await BookingService.countDocuments(query);

    // Calculate pagination values
    const totalPages = Math.ceil(totalBookings / limitNumber);
    const skip = (pageNumber - 1) * limitNumber;

    // Execute query with sorting and pagination
    const bookings = await BookingService.find(query)
      .populate(
        "booking",
        "bookingDates guestDetails pricing extraFeatures amountBreakdown"
      )
      .populate("eventType", "name")
      .populate("serviceId", "name description image")
      .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
      .skip(skip)
      .limit(limitNumber)
      .lean();

    // Prepare response
    const response = {
      success: true,
      data: bookings,
      pagination: {
        totalItems: totalBookings,
        totalPages,
        currentPage: pageNumber,
        itemsPerPage: limitNumber,
        nextPage: pageNumber < totalPages ? pageNumber + 1 : null,
        prevPage: pageNumber > 1 ? pageNumber - 1 : null,
      },
      filters: {
        search,
        status,
        eventType,
        fromDate,
        toDate,
        sortBy,
        sortOrder,
      },
    };

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          response,
          "Service bookings retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Error fetching service bookings:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", error.message));
  }
});

const addEventBooking = asyncHandler(async (req, res) => {
  try {
    // Destructure and validate input
    const { paymentType, eventId, numberOfAttendees } = req.body;
    const userId = req.user._id;
    // const userId = "6854063345c66fec8bff7df6";

    if (!paymentType || !["stripe", "razorpay"].includes(paymentType)) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            'Invalid payment type. Must be "stripe" or "razorpay"'
          )
        );
    }

    if (
      !eventId ||
      !numberOfAttendees ||
      isNaN(numberOfAttendees) ||
      numberOfAttendees < 1
    ) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            "Valid eventId and numberOfAttendees (minimum 1) required"
          )
        );
    }

    // Validate event
    const event = await Event.findById(eventId);
    if (!event)
      return res.status(404).json(new ApiError(404, "Event not found"));
    if (event.currentAttendees + numberOfAttendees > event.maxParticipants) {
      return res
        .status(400)
        .json(new ApiError(400, "Not enough available spots"));
    }
    if (event.status === "cancelled")
      return res.status(400).json(new ApiError(400, "Event is cancelled"));
    if (event.status === "completed")
      return res.status(400).json(new ApiError(400, "Event is completed"));

    const setting = await Setting.findOne().lean();
    if (!setting || !setting.fees || !setting.fees.event) {
      return res
        .status(500)
        .json(new ApiError(500, "Platform fee configuration not found"));
    }

    const baseAmount = (event.price || 0) * Number(numberOfAttendees);
    if (baseAmount <= 0)
      return res.status(400).json(new ApiError(400, "Invalid total amount'"));
    const platformFeePercentage = setting.fees.event;
    const platformFee = Math.round((baseAmount * platformFeePercentage) / 100);
    const totalAmount = baseAmount + platformFee;
    const amountInSubunits = Math.round(totalAmount * 100);

    const transactionLog = await TransactionLog.create({
      gateway: paymentType,
      baseAmount,
      totalAmount: Math.round(amountInSubunits / 100),
      currency: "INR",
      userId,
      eventId,
      status: "pending",
      taxAmount: {
        percent: platformFeePercentage,
        amount: platformFee,
      },
      metadata: { numberOfAttendees },
    });

    if (paymentType == "stripe") {
      if (!process.env.STRIPE_SECRET_KEY) {
        return res
          .status(500)
          .json(
            new ApiError(
              500,
              "STRIPE_SECRET_KEY is missing in environment variables"
            )
          );
      }

      // Initialize Stripe with error handling
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: "2023-08-16",
      });

      // Create payment intent with enhanced options
      const pi = await stripe.paymentIntents.create({
        amount: amountInSubunits, // Convert to smallest currency unit
        currency: "inr", // Ensure lowercase
        metadata: {
          paymentRecordId: transactionLog._id.toString(),
          eventId: eventId.toString(),
        },
        automatic_payment_methods: { enabled: true },
      });

      transactionLog.gatewayOrderId = pi.id;
      await transactionLog.save();

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            provider: "stripe",
            clientSecret: pi.client_secret,
            paymentRecordId: transactionLog._id,
            amount: amountInSubunits / 100,
          },
          "Stripe Payment link created successfully"
        )
      );
    } else if (paymentType == "razorpay") {
      // Razorpay Payment Integration
      if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "Razorpay credentials missing in environment variables"
            )
          );
      }

      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });

      const options = {
        amount: amountInSubunits,
        currency: "INR",
        receipt: `receipt_${transactionLog._id}`,
        notes: {
          paymentRecordId: transactionLog._id.toString(),
          eventId: eventId.toString(),
        },
      };

      const order = await razorpay.orders.create(options);
      transactionLog.gatewayOrderId = order.id;
      await transactionLog.save();

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            provider: "razorpay",
            orderId: order.id,
            amount: amountInSubunits,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID,
            paymentRecordId: transactionLog._id,
          },
          "Razorpay order created successfully"
        )
      );
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json(new ApiError(500, "Internal server error"));
  }
});

const bookEventWithPayment = asyncHandler(async (req, res) => {
  try {
    const { paymentRecordId } = req.body;

    // Validate input
    if (!paymentRecordId) {
      return res
        .status(400)
        .json(new ApiError(400, "Payment record ID is required"));
    }

    const transactionLog = await TransactionLog.findById(paymentRecordId);
    if (!transactionLog) {
      return res
        .status(404)
        .json(new ApiError(404, "Payment record not found"));
    }

    // Check if payment is already processed
    if (transactionLog.status === "paid") {
      const bookingInfo = await BookingEvent.findOne({
        transactionLogId: transactionLog._id,
      }).lean();
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            { bookingInfo },
            `Your event has been successfully booked! Confirmation ID: ${bookingInfo.bookingId}`
          )
        );
    } else {
      return res.status(400).json(new ApiError(400, "Payment is processing"));
    }
  } catch (error) {
    console.error("Booking error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", error.message));
  }
});

const getEventBookingList = asyncHandler(async (req, res) => {
  try {
    const {
      pageNum,
      limitNum,
      categoryId,
      sort = "desc",
      search,
      date,
      status,
    } = req.query;
    const page = parseInt(pageNum) || 1;
    const limit = parseInt(limitNum) || 10;
    const skip = (page - 1) * limit;

    // Build match condition for bookings
    const bookingMatch = {
      "bookingBy.user": req.user._id,
      "bookingBy.role": "guest",
    };

    const pipeline = [
      { $match: bookingMatch },

      // Join event details
      {
        $lookup: {
          from: "events", // collection name in MongoDB
          localField: "event",
          foreignField: "_id",
          as: "event",
        },
      },
      { $unwind: "$event" },

      // Apply filters on event
      {
        $match: {
          ...(categoryId
            ? { "event.categoryId": new mongoose.Types.ObjectId(categoryId) }
            : {}),
          ...(status ? { "event.status": status } : {}),
        },
      },

      // Search filter
      ...(search
        ? [
            {
              $match: {
                $or: [
                  { "event.title": { $regex: search, $options: "i" } },
                  { "event.description": { $regex: search, $options: "i" } },
                  { "event.tags": { $regex: search, $options: "i" } },
                ],
              },
            },
          ]
        : []),

      // Date filter
      ...(date
        ? (() => {
            const selectedDate = new Date(date);
            if (isNaN(selectedDate.getTime())) {
              throw new Error("Invalid date format");
            }
            const nextDay = new Date(selectedDate);
            nextDay.setDate(nextDay.getDate() + 1);

            return [
              {
                $match: {
                  "event.startDate": { $lt: nextDay },
                  "event.endDate": { $gte: selectedDate },
                },
              },
            ];
          })()
        : []),

      // Sort
      {
        $sort: { "event.startDate": sort === "asc" ? 1 : -1 },
      },

      // Pagination
      { $skip: skip },
      { $limit: limit },

      // Final projection
      {
        $project: {
          _id: 1,
          bookingId: 1,
          bookingDate: 1,
          numberOfAttendees: 1,
          paymentDetails: 1,
          status: 1,
          event: {
            _id: 1,
            title: 1,
            slug: 1,
            startDate: 1,
            endDate: 1,
            startTime: 1,
            endTime: 1,
            categoryId: 1,
            location: 1,
            description: 1,
            tags: 1,
            images: 1,
            status: 1,
          },
        },
      },
    ];

    const results = await BookingEvent.aggregate(pipeline);

    // Get total count (without pagination)
    const countPipeline = pipeline.filter(
      (p) => !("$skip" in p || "$limit" in p)
    );
    countPipeline.push({ $count: "total" });
    const countResult = await BookingEvent.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          events: results.map((r) => ({
            ...r.event,
            bookingDetails: r,
          })),
          pagination: {
            total,
            page,
            pages: Math.ceil(total / limit),
            limit,
          },
        },
        "Attended events fetched successfully"
      )
    );
  } catch (error) {
    console.error("Event error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const getEventBookingDetails = asyncHandler(async (req, res) => {
  try {
    const { bookingId } = req.params;
    if (!bookingId) {
      return res.status(400).json(new ApiError(400, "Booking ID is required"));
    }

    const booking = await BookingEvent.findById(bookingId)
      .populate({
        path: "event",
        select:
          "title startDate endDate startTime endTime categoryId location description tags images",
      })
      .lean();

    if (!booking) {
      return res.status(404).json(new ApiError(404, "Booking not found"));
    }

    return res
      .status(200)
      .json(
        new ApiResponse(200, booking, "Booking details fetched successfully")
      );
  } catch (error) {
    console.error("Event error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const addEventRating = asyncHandler(async (req, res) => {
  try {
    const { bookingId, rating, review } = req.body;
    const userId = req.user._id;

    // Validate inputs
    if (!bookingId || rating === undefined) {
      return res
        .status(400)
        .json(new ApiError(400, "Booking ID and rating are required"));
    }
    if (rating < 1 || rating > 5) {
      return res
        .status(400)
        .json(new ApiError(400, "Rating must be between 1 and 5"));
    }

    // Find booking and validate
    const booking = await BookingEvent.findById(bookingId);
    if (!booking) {
      return res.status(404).json(new ApiError(404, "Booking not found"));
    }

    // Check for existing rating
    const existingRating = await EventRating.findOne({ bookingId, userId });
    if (existingRating) {
      return res
        .status(400)
        .json(new ApiError(400, "You have already rated this booking"));
    }

    // Get event data
    const event = await Event.findById(booking.event).lean();
    if (!event) {
      return res.status(404).json(new ApiError(404, "Event not found"));
    }

    if (event.status != "completed") {
      return res
        .status(400)
        .json(new ApiError(400, "Only completed event can be rated"));
    }

    // Create new rating
    const newRating = await EventRating.create({
      eventId: booking.event,
      bookingId,
      hostUserId: event.createdBy.userId,
      role: event.createdBy.role,
      userId,
      rating,
      review: review || null,
    });

    await createActivityLog({
      entityType: "Event",
      entityId: event._id,
      userId: req.user._id,
      userRole: "guest",
      action: "rating",
    });

    // Calculate new average rating
    const ratings = await EventRating.find({
      hostUserId: event.createdBy.userId,
      role: event.createdBy.role,
    });

    const averageRating =
      ratings.length > 0
        ? parseFloat(
            (
              ratings.reduce((sum, item) => sum + item.rating, 0) /
              ratings.length
            ).toFixed(2)
          )
        : 0;

    await User.findByIdAndUpdate(
      event.createdBy.userId,
      { $set: { eventRating: averageRating } },
      { new: true }
    );

    // Add notification with proper title and message
    try {
      const ratingEmoji = "⭐".repeat(rating) + "☆".repeat(5 - rating);
      await createNotification({
        recipientId: event.createdBy.userId,
        recipientRole: event.createdBy.role,
        senderId: userId,
        title: "New Event Rating Received",
        message:
          `Your event "${event.name}" received a ${rating}-star rating ${ratingEmoji}` +
          (review ? ` with review: "${review}"` : ""),
        notificationType: "event",
        actionId: event._id,
        // actionUrl: `/events/${event._id}`,
        metadata: {
          ratingValue: rating,
          eventName: event.name,
          hasReview: !!review,
        },
      });
    } catch (notificationError) {
      console.error("Notification creation failed:", notificationError);
    }

    return res
      .status(201)
      .json(new ApiResponse(201, newRating, "Rating added successfully"));
  } catch (error) {
    console.error("Rating error:", error);
    return res.status(500).json(new ApiError(500, "Internal server error"));
  }
});

const getMyReview = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10 } = req.query;

    const [propertyRatings, eventRatings] = await Promise.all([
      // Property Ratings with host details
      PropertyRating.find({ guestId: userId })
        .populate({
          path: "propertyId",
          select: "name images owner",
          populate: {
            path: "owner",
            select: "firstName lastName email profileImage", // Select host details you want
          },
        })
        .populate("bookingId", "bookingId")
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 })
        .lean(),

      // Event Ratings with host details
      EventRating.find({ userId })
        .populate({
          path: "eventId",
          select: "title images organizer",
          populate: {
            path: "organizer",
            select: "firstName lastName email profileImage", // Select host details you want
          },
        })
        .populate("bookingId", "bookingId")
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    // Merge and sort results by createdAt date
    const allReviews = [
      ...propertyRatings.map((rating) => ({ ...rating, type: "property" })),
      ...eventRatings.map((rating) => ({ ...rating, type: "event" })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Get total counts for pagination
    const [propertyCount, eventCount] = await Promise.all([
      PropertyRating.countDocuments({ guestId: userId }),
      EventRating.countDocuments({ userId }),
    ]);

    // Prepare pagination metadata
    const totalItems = propertyCount + eventCount;
    const totalPages = Math.ceil(totalItems / limit);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          reviews: allReviews,
          pagination: {
            totalItems,
            totalPages,
            currentPage: parseInt(page),
            itemsPerPage: parseInt(limit),
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
          },
        },
        "Reviews fetched successfully"
      )
    );
  } catch (error) {
    console.error("Review error:", error);
    return res.status(500).json(new ApiError(500, "Internal server error"));
  }
});

async function getOrCreateWallet(userId, userRole) {
  let wallet = await Wallet.findOne({ userId, userRole });
  if (!wallet) {
    wallet = await Wallet.create({
      userId,
      userRole,
      balance: 0,
      holdBalance: 0,
      commission: 0,
      currency: "INR",
    });
  }
  return wallet;
}

export {
  propertyBooking,
  bookPropertyWithPayment,
  propertyBookingCancel,
  propertyBookingCancelCalculation,
  getPropertyBookingList,
  getPropertyBookingDetails,
  addRemoveToWishlist,
  getWishlist,
  addPropertyRating,
  addPropertySuggestion,
  serviceBooking,
  getServiceBookingList,
  getEventBookingList,
  getEventBookingDetails,
  addEventRating,
  getMyReview,
  addEventBooking,
  bookEventWithPayment,
};
