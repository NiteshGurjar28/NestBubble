import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { User } from "../models/user.model.js";
import { Property } from "../models/Property.model.js";
import { Booking } from "../models/Booking.model.js";
import { PropertyType } from "../models/PropertyType.model.js";
import { Amenity } from "../models/Amenity.model.js";
import { Event } from "../models/Event.model.js";
import { EventRating } from "../models/EventRating.model.js";
import { BookingEvent } from "../models/BookingEvent.model.js";
import { AmenityRequest } from "../models/Amenity.model.js";
import { Wallet, WalletTransaction } from "../models/Wallet.model.js";
import { PropertyRating } from "../models/PropertyRating.model.js";
import { createNotification } from "../utils/notification.helper.js";
import { createActivityLog } from "../utils/activityLog.helper.js";
import { Setting } from "../models/Setting.model.js";
import mongoose from "mongoose";
import { PropertyCalendar } from "../models/PropertyCalendar.model.js";
import {  seedPropertyCalendar,  repriceFutureCalendarWindow} from "../utils/calendar.js";

const createProperty = asyncHandler(async (req, res) => {
  try {
    // Validate required fields
    const propertyType = await PropertyType.findById(req.body.propertyType);
    if (!propertyType) {
      return res.status(400).json(new ApiError(400, "Property type not found"));
    }

    // Validate amenities exist
    if (req.body.amenities && req.body.amenities.length > 0) {
      const amenitiesCount = await Amenity.countDocuments({
        _id: { $in: req.body.amenities },
      });
      if (amenitiesCount !== req.body.amenities.length) {
        return res
          .status(400)
          .json(new ApiError(400, "One or more amenities not found"));
      }
    }

    // Create property
    const property = new Property({
      ...req.body,
      owner: req.user._id,
      adminApprovalStatus: "pending", // Default status
    });

    await property.save();

    // Update property type
    propertyType.properties.push(property._id);
    await propertyType.save();

    const setting = await Setting.findOne();
    const propertyFeePercentage = setting?.fees?.property || 5;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 12);
    await seedPropertyCalendar(property, start, end, propertyFeePercentage);

    // Notification to host (property owner)
    await createNotification({
      recipientId: req.user._id,
      recipientRole: "host",
      senderId: req.user._id, // Self-notification
      title: "Property Created Successfully",
      message: `Your property "${property.name}" has been created and is pending admin approval.`,
      notificationType: "property",
      actionId: property._id,
      actionUrl: `/host/properties/${property._id}`,
      metadata: {
        status: "pending",
        createdAt: new Date(),
      },
    });

    // get admin users role admin
    const adminUsers = await User.findOne({
      roles: "admin",
      adminRole: "super_admin",
    }).select("_id");

    // Notifications to admin
    createNotification({
      recipientId: adminUsers._id,
      recipientRole: "admin",
      senderId: req.user._id,
      senderRole: "host",
      title: "New Property Needs Approval",
      message: `New property "${property.name}" created by ${req.user.firstName} ${req.user.lastName} requires approval.`,
      notificationType: "property",
      actionId: property._id,
      actionUrl: `/admin/properties/${property._id}/review`,
      metadata: {
        propertyId: property._id,
        ownerId: req.user._id,
        createdAt: new Date(),
      },
    });

    await createActivityLog({
      entityType: "Property",
      entityId: property._id,
      userId: req.user._id,
      userRole: "host",
      action: "create",
    });

    return res
      .status(200)
      .json(new ApiResponse(200, property, "Property created successfully"));
  } catch (error) {
    console.error("Error creating property:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", [error.message]));
  }
});

const updateProperty = asyncHandler(async (req, res) => {
  try {
    const { propertyId } = req.body;

    // Find the property
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json(new ApiError(404, "Property not found"));
    }

    // Check if user owns the property or is admin
    if (property.owner.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json(new ApiError(403, "Unauthorized to update this property"));
    }

    // Validate property type if provided
    if (req.body.propertyType) {
      const propertyType = await PropertyType.findById(req.body.propertyType);
      if (!propertyType) {
        return res
          .status(400)
          .json(new ApiError(400, "Property type not found"));
      }
    }

    // Validate amenities if provided
    if (req.body.amenities && req.body.amenities.length > 0) {
      const amenitiesCount = await Amenity.countDocuments({
        _id: { $in: req.body.amenities },
      });
      if (amenitiesCount !== req.body.amenities.length) {
        return res
          .status(400)
          .json(new ApiError(400, "One or more amenities not found"));
      }
    }

    // Update the property
    const updatedProperty = await Property.findByIdAndUpdate(
      propertyId,
      { ...req.body },
      { new: true, runValidators: true }
    );

    // If pricing was updated, update the calendar for the next year
    if (req.body.pricing) {
      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(startDate);
      endDate.setFullYear(endDate.getFullYear() + 1); // One year from now

      const setting = await Setting.findOne();
      const propertyFeePercentage = setting?.fees?.property || 5;

      // Update calendar for the next year
      await seedPropertyCalendar(
        updatedProperty,
        startDate,
        endDate,
        propertyFeePercentage
      );

      // 2) Re-price only base/weekend rows that are available (don’t touch manual/smart/booked/blocked)
      await repriceFutureCalendarWindow(
        updatedProperty,
        startDate,
        endDate,
        propertyFeePercentage
      );
    }

    // Create activity log
    await createActivityLog({
      entityType: "Property",
      entityId: property._id,
      userId: req.user._id,
      userRole: "host",
      action: "update",
    });

    return res
      .status(200)
      .json(
        new ApiResponse(200, updatedProperty, "Property updated successfully")
      );
  } catch (error) {
    console.error("Error updating property:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", [error.message]));
  }
});

const updatePropertyPrice = asyncHandler(async (req, res) => {
  try {
    const { propertyId, pricing, type, dates, price } = req.body;

    // Find the property
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json(new ApiError(404, "Property not found"));
    }

    if (type === false) {
      const updatedProperty = await Property.findByIdAndUpdate(
        propertyId,
        { pricing },
        { new: true, runValidators: true }
      );

      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(startDate);
      endDate.setFullYear(endDate.getFullYear() + 1); // One year from now

      const setting = await Setting.findOne();
      const propertyFeePercentage = setting?.fees?.property || 5;

      // Update calendar for the next year
      await seedPropertyCalendar(
        updatedProperty,
        startDate,
        endDate,
        propertyFeePercentage
      );
      console.log(startDate, endDate);
      // 2) Re-price only base/weekend rows that are available (don’t touch booked/blocked)
      await repriceFutureCalendarWindow(
        updatedProperty,
        startDate,
        endDate,
        propertyFeePercentage
      );
    } else if (type === true) {
      if (!dates || price === undefined) {
        return res
          .status(400)
          .json(
            new ApiError(400, "Dates and price are required when type is true")
          );
      }

      const dateObjects = dates.map((dateStr) => {
        const date = new Date(dateStr);
        return date;
      });

      // Check if any of the dates are already booked
      const bookedDates = await PropertyCalendar.find({
        propertyId,
        date: { $in: dateObjects },
        status: "booked",
      });

      if (bookedDates.length > 0) {
        const bookedDateStrings = bookedDates.map(
          (d) => d.date.toISOString().split("T")[0]
        );
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              `Cannot price update for booked dates: ${bookedDateStrings.join(
                ", "
              )}`
            )
          );
      }

      const setting = await Setting.findOne();
      const propertyFeePercentage = setting?.fees?.property || 5;

      // Calculate price with fee
      const priceBeforeTax = price;
      const finalPrice = Math.round(
        price + (price * propertyFeePercentage) / 100
      );
      await PropertyCalendar.updateMany(
        { propertyId, date: { $in: dateObjects }, status: { $ne: "booked" } },
        { $set: { priceBeforeTax, price: finalPrice } }
      );
    }

    // Create activity log
    await createActivityLog({
      entityType: "Property",
      entityId: property._id,
      userId: req.user._id,
      userRole: "host",
      action: "priceUpdate",
    });

    return res
      .status(200)
      .json(new ApiResponse(200, {}, "Property price updated successfully"));
  } catch (error) {
    console.error("Error updating property:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", [error.message]));
  }
});

const updatePropertyDiscount = asyncHandler(async (req, res) => {
  try {
    const { propertyId, weeklyDiscount, monthlyDiscount, newListingDiscount } =
      req.body;

    // Find the property
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json(new ApiError(404, "Property not found"));
    }

    // Prepare update object
    const updateData = {};

    // Handle weekly discount
    if (weeklyDiscount !== undefined) {
      updateData["discounts.weeklyDiscount.percentage"] = weeklyDiscount;
      updateData["discounts.weeklyDiscount.status"] = weeklyDiscount > 0;
    }

    // Handle monthly discount
    if (monthlyDiscount !== undefined) {
      updateData["discounts.monthlyDiscount.percentage"] = monthlyDiscount;
      updateData["discounts.monthlyDiscount.status"] = monthlyDiscount > 0;
    }

    // Handle new listing discount (both status and percentage come together)
    if (newListingDiscount !== undefined) {
      updateData["discounts.newListingDiscount.status"] =
        newListingDiscount.status;
      updateData["discounts.newListingDiscount.percentage"] =
        newListingDiscount.percentage;
    }

    // Update the property
    const updatedProperty = await Property.findByIdAndUpdate(
      propertyId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    // Create activity log
    await createActivityLog({
      entityType: "Property",
      entityId: property._id,
      userId: req.user._id,
      userRole: "host",
      action: "update_discounts",
      changes: Object.keys(updateData),
    });

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          updatedProperty.discounts,
          "Discounts updated successfully"
        )
      );
  } catch (error) {
    console.error("Error updating discounts:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", [error.message]));
  }
});

const updatePropertyAvailable = asyncHandler(async (req, res) => {
  try {
    const { propertyId, dates, status } = req.body;

    // Validate required fields
    if (!propertyId || !dates || !status) {
      return res
        .status(400)
        .json(new ApiError(400, "Property ID, dates, and status are required"));
    }

    // Validate status value
    if (!["available", "blocked"].includes(status)) {
      return res
        .status(400)
        .json(
          new ApiError(400, "Status must be either 'available' or 'blocked'")
        );
    }

    // Find the property
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json(new ApiError(404, "Property not found"));
    }

    // Convert all dates to Date objects and set to midnight
    const dateObjects = dates.map((dateStr) => {
      const date = new Date(dateStr);
      return date;
    });

    // Check if any of the dates are already booked
    const bookedDates = await PropertyCalendar.find({
      propertyId,
      date: { $in: dateObjects },
      status: "booked",
    });

    if (bookedDates.length > 0) {
      const bookedDateStrings = bookedDates.map(
        (d) => d.date.toISOString().split("T")[0]
      );
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            `Cannot update status for booked dates: ${bookedDateStrings.join(
              ", "
            )}`
          )
        );
    }

    // Update the status for all specified dates
    const updateResult = await PropertyCalendar.updateMany(
      {
        propertyId,
        date: { $in: dateObjects },
      },
      {
        $set: { status: status },
      }
    );

    return res
      .status(200)
      .json(new ApiResponse(200, {}, "Availability updated successfully"));
  } catch (error) {
    console.error("Error updating availability:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", [error.message]));
  }
});

const propertyList = asyncHandler(async (req, res) => {
  try {
    // Extract query parameters
    const {
      page = 1,
      limit = 10,
      sort = "createdAt",
      order = "desc",
      search = "",
      status = "",
      adminApprovalStatus = "",
    } = req.query;

    // Build the filter object
    const filter = { owner: req.user._id };
    const filter2 = { owner: req.user._id };

    // Apply filters
    if (search) filter.name = { $regex: search, $options: "i" };
    if (status) filter.status = status;
    if (adminApprovalStatus) filter.adminApprovalStatus = adminApprovalStatus;

    // Build sort object
    const sortOptions = { [sort]: order === "desc" ? -1 : 1 };

    // Execute queries in parallel
    const [
      properties,
      totalPageProperties,
      totalProperties,
      todayBookingsCount,
    ] = await Promise.all([
      Property.find(filter)
        .sort(sortOptions)
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .populate("propertyType", "name")
        .lean(),

      Property.countDocuments(filter),
      Property.countDocuments(filter2),

      // Get today's bookings count for host's properties
      (async () => {
        const today = new Date();
        const startOfDay = new Date(today.setHours(0, 0, 0, 0));
        const endOfDay = new Date(today.setHours(23, 59, 59, 999));

        return Booking.countDocuments({
          hostId: req.user._id,
          $or: [
            { "bookingDates.startDate": { $gte: startOfDay, $lte: endOfDay } },
            {
              "bookingDates.startDate": { $lte: startOfDay },
              "bookingDates.endDate": { $gte: endOfDay },
            },
          ],
        });
      })(),
    ]);

    // Prepare response
    const response = {
      properties,
      stats: {
        totalProperties,
        totalBookingsToday: todayBookingsCount,
        vacantProperties:
          totalProperties - todayBookingsCount > 0
            ? totalProperties - todayBookingsCount
            : 0,
      },
      pagination: {
        totalPageProperties,
        totalPages: Math.ceil(totalProperties / limit),
        currentPage: parseInt(page),
        itemsPerPage: parseInt(limit),
        nextPage:
          page < Math.ceil(totalPageProperties / limit)
            ? parseInt(page) + 1
            : null,
        prevPage: page > 1 ? parseInt(page) - 1 : null,
      },
    };

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          response,
          "Property listing retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Error in property listing:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Failed to retrieve property listing"));
  }
});

const bookingList = asyncHandler(async (req, res) => {
  try {
    // Extract query parameters with defaults
    const {
      page = 1,
      limit = 10,
      sort = "createdAt",
      order = "desc",
      search = "",
      status = "",
      propertyId = "",
    } = req.query;

    // Build the filter object
    const filter = {
      hostId: req.user._id, // Only show bookings for this host
    };

    // Status filter
    if (
      status &&
      ["pending", "confirmed", "completed", "cancelled"].includes(status)
    ) {
      filter.status = status;
    }

    // Property filter
    if (propertyId && mongoose.Types.ObjectId.isValid(propertyId)) {
      filter.propertyId = propertyId;
    }

    // Search filter
    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.$or = [
        { bookingId: searchRegex },
        { "guestDetails.specialRequests": searchRegex },
      ];
    }

    // Sort options
    const sortOptions = {};
    sortOptions[sort] = order === "desc" ? -1 : 1;

    // Get bookings with pagination
    const bookings = await Booking.find(filter)
      .sort(sortOptions)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate({
        path: "propertyId",
        select: "_id name slug images address",
      })
      .populate({
        path: "guestId",
        select: "firstName lastName email mobile profileImage address",
      })
      .lean();

    // Get total count for pagination
    const totalBookings = await Booking.countDocuments(filter);

    /// get host details
    const host = await User.findOne({ _id: req.user._id }).select(
      "autoAcceptedIds"
    );
    const autoAcceptedIds = host.autoAcceptedIds;

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          bookings,
          autoAcceptedIds,
          pagination: {
            total: totalBookings,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(totalBookings / limit),
          },
          filters: {
            status: status || "all",
            search: search || "",
          },
        },
        "Bookings retrieved successfully"
      )
    );
  } catch (error) {
    console.error("Error fetching bookings:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", error.message));
  }
});

const updateBookingStatus = asyncHandler(async (req, res) => {
  try {
    const { status, bookingId, message } = req.body;

    if (!status || !bookingId) {
      return res
        .status(400)
        .json(new ApiError(400, "Status and Booking ID are required"));
    }

    const validStatuses = ["confirmed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            `Invalid status value. Allowed values: ${validStatuses.join(", ")}`
          )
        );
    }

    const existingBooking = await Booking.findById(bookingId);
    if (!existingBooking) {
      return res.status(404).json(new ApiError(404, "Booking not found"));
    }

    if (existingBooking.hostId.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json(
          new ApiError(403, "Forbidden: Only the host can update the status")
        );
    }

    const currentStatus = existingBooking.status;
    if (currentStatus === "cancelled") {
      return res
        .status(400)
        .json(new ApiError(400, "Booking is already cancelled"));
    }
    if (currentStatus === "confirmed" && status === "confirmed") {
      return res
        .status(400)
        .json(new ApiError(400, "Booking is already confirmed"));
    }

    const property = await Property.findById(existingBooking.propertyId);
    const startDate = new Date(existingBooking.bookingDates.startDate);
    const endDate = new Date(existingBooking.bookingDates.endDate);

    // -------------------------
    // 🟥 HANDLE CANCELLATION
    // -------------------------
    existingBooking.status = status;
    if (status === "cancelled") {
      if (!message) {
        return res
          .status(400)
          .json(new ApiError(400, "Cancellation message is required"));
      }

      const now = new Date();
      if (existingBooking.bookingDates.startDate <= now) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "Cannot cancel a booking that has already started"
            )
          );
      }

      // Refund calculation (simple: full refund to guest)
      const refundAmount = existingBooking.amountBreakdown.finalAmount;
      const hostEarning =
        existingBooking?.amountBreakdown?.finalAmount -
          existingBooking.amountBreakdown?.totalTaxAmount || 0;
      const penaltyAmount = 0; // you can add penalty logic later

      existingBooking.cancellation = {
        isCancelled: true,
        cancelledBy: "host",
        cancellationDate: new Date(),
        cancellationReason: message,
        refundAmount,
        penaltyAmount,
      };

      // ✅ Unblock property dates
      await PropertyCalendar.updateMany(
        { bookingId: existingBooking._id },
        {
          $set: {
            status: "available",
            bookingId: null,
          },
        }
      );

      // ✅ Wallet management
      const hostWallet = await getOrCreateWallet(
        existingBooking.hostId,
        "host"
      );
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

      hostWallet.holdBalance = Math.max(
        0,
        hostWallet.holdBalance - hostEarning
      );
      hostWallet.commission = Math.max(
        0,
        hostWallet.commission - existingBooking.amountBreakdown?.totalTaxAmount
      );
      await hostWallet.save();
    }

    await existingBooking.save();

    // -------------------------
    // 🔔 NOTIFICATION
    // -------------------------
    let notificationTitle, notificationMessage;
    switch (status) {
      case "confirmed":
        notificationTitle = "Booking Confirmed";
        notificationMessage = `Your booking for "${
          property.name
        }" has been confirmed from ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`;
        break;
      case "cancelled":
        notificationTitle = "Booking Cancelled";
        notificationMessage = `Your booking for "${property.name}" has been cancelled. Reason: ${message}. A refund of ${existingBooking.cancellation.refundAmount} will be processed.`;
        break;
      default:
        notificationTitle = "Booking Status Updated";
        notificationMessage = `The status of your booking for "${property.name}" has been updated.`;
    }

    await createNotification({
      recipientId: existingBooking.guestId,
      recipientRole: "guest",
      senderId: req.user._id,
      senderRole: "host",
      title: notificationTitle,
      message: notificationMessage,
      notificationType: "property_booking",
      actionId: existingBooking._id,
      actionUrl: `/bookings/${existingBooking._id}`,
      metadata: {
        bookingId: existingBooking._id,
        propertyId: property._id,
        propertyName: property.name,
        status: status,
        dates: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
        amount: existingBooking.amountBreakdown.finalAmount,
        ...(status === "cancelled" && { cancellationReason: message }),
      },
    });

    await createActivityLog({
      entityType: "Booking",
      entityId: existingBooking._id,
      userId: req.user._id,
      userRole: "host",
      action: status === "cancelled" ? "cancel" : "confirm",
    });

    return res.status(200).json(
      new ApiResponse(200, "Booking status updated successfully", {
        booking: existingBooking,
      })
    );
  } catch (error) {
    console.error("Error in updating booking status:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", error.message));
  }
});

const getPropertyReviews = asyncHandler(async (req, res) => {
  try {
    // Extract and validate parameters
    const { page = 1, limit = 10, propertyId } = req.query;

    // Validate propertyId
    if (!mongoose.Types.ObjectId.isValid(propertyId)) {
      return res
        .status(400)
        .json(new ApiError(400, "Invalid property ID format"));
    }

    // Check property exists
    const property = await Property.findById(propertyId).select(
      "averageRating averageComfortableRating averageCleanlinessRating averageFacilitiesRating"
    );
    if (!property) {
      return res.status(404).json(new ApiError(404, "Property not found"));
    }

    // Convert and validate pagination parameters
    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const skip = (pageNumber - 1) * limitNumber;

    // Fetch reviews with pagination
    const [reviews, totalReviews] = await Promise.all([
      PropertyRating.find({ propertyId })
        .populate({
          path: "guestId",
          select: "firstName lastName profileImage",
          model: "User",
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PropertyRating.countDocuments({ propertyId }),
    ]);

    // Prepare response
    const response = {
      metadata: {
        overall: property.averageRating,
        comfort: property.averageComfortableRating,
        cleanliness: property.averageCleanlinessRating,
        facilities: property.averageFacilitiesRating,
        totalReviews,
      },
      reviews,
      pagination: {
        currentPage: pageNumber,
        totalPages: Math.ceil(totalReviews / limitNumber),
        itemsPerPage: limitNumber,
        hasNextPage: pageNumber * limitNumber < totalReviews,
      },
    };

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          response,
          "Property reviews retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Error in fetching property reviews:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Failed to retrieve property reviews"));
  }
});

const autoAcceptAddRemoved = asyncHandler(async (req, res) => {
  try {
    const { guestId } = req.body;

    // Validate the guestId exists in request body
    if (!guestId) {
      return res.status(400).json(new ApiError(400, "Guest ID is required"));
    }

    // Validate guestId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(guestId)) {
      return res.status(400).json(new ApiError(400, "Invalid Guest ID format"));
    }

    const guestObjectId = new mongoose.Types.ObjectId(guestId);
    const hostId = new mongoose.Types.ObjectId(req.user._id);

    // Get host and guest details
    const host = await User.findOne({ _id: hostId });
    if (!host) {
      return res.status(404).json(new ApiError(404, "Host user not found"));
    }

    const guest = await User.findOne({ _id: guestObjectId });
    if (!guest) {
      return res.status(404).json(new ApiError(404, "Guest user not found"));
    }

    const isAlreadyAccepted = host.autoAcceptedIds.some((id) =>
      id.equals(guestObjectId)
    );

    // Perform the appropriate update operation
    let updateOperation;
    let message;
    let notificationMessage;

    if (isAlreadyAccepted) {
      updateOperation = { $pull: { autoAcceptedIds: guestObjectId } };
      message = "Your removed from auto-accept list";
      notificationMessage =
        `${host.firstName} ${host.lastName} has removed you from their auto-accept list. ` +
        `Your future booking requests will require manual approval.`;
    } else {
      updateOperation = { $addToSet: { autoAcceptedIds: guestObjectId } };
      message = "Your auto-accept list has been updated";
      notificationMessage =
        `${host.firstName} ${host.lastName} has added you to their auto-accept list. ` +
        `Your future booking requests will be automatically approved!`;
    }

    const updatedHost = await User.findByIdAndUpdate(hostId, updateOperation, {
      new: true,
    }).select("autoAcceptedIds");

    // Send notification to guest
    await createNotification({
      recipientId: guestObjectId,
      recipientRole: "guest",
      senderId: hostId,
      senderRole: "host",
      title: "Auto-Accept Status Changed",
      message: notificationMessage,
      notificationType: "system",
      actionId: hostId,
      actionUrl: `/users/${hostId}/profile`,
      metadata: {
        hostId: hostId,
        hostName: `${host.firstName} ${host.lastName}`,
        isAutoAccepted: !isAlreadyAccepted,
        changedAt: new Date(),
      },
    });

    await createActivityLog({
      entityType: "User",
      entityId: hostId,
      userId: hostId,
      userRole: "host",
      action: "autoAccept",
    });

    return res.status(200).json({
      status: true,
      code: 200,
      message: message,
      data: {
        isAutoAccepted: !isAlreadyAccepted,
      },
    });
  } catch (error) {
    console.error("Error in auto-accept modification:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", [error.message]));
  }
});

const amenityRequest = asyncHandler(async (req, res) => {
  try {
    const { category, reqName, reqMessage } = req.body;

    if (!category || !reqName) {
      return res
        .status(400)
        .json(
          new ApiError(400, "Invalid request", [
            "Category and reqName are required",
          ])
        );
    }

    const allowedCategories = [
      "Basic Amenities",
      "Standout Amenities",
      "Safety Items",
    ];
    if (!allowedCategories.includes(category)) {
      return res
        .status(400)
        .json(
          new ApiError(400, "Invalid category", [
            "Category must be one of Basic Amenities, Standout Amenities, or Safety Items",
          ])
        );
    }

    /// create AmenityRequest
    const amenityRequest = await AmenityRequest.create({
      user: req.user._id,
      category,
      reqName,
      reqMessage,
    });

    const adminUsers = await User.findOne({
      roles: "admin",
      adminRole: "super_admin",
    }).select("_id");

    await createNotification({
      recipientId: adminUsers._id,
      recipientRole: "admin",
      senderId: req.user._id,
      senderRole: "host",
      title: `New Amenity Request`,
      message: `New ${category} request for ${reqName} has been submitted.`,
      notificationType: "amenity",
      metadata: {
        requestId: amenityRequest._id,
        category: category,
        requestName: reqName,
        createdAt: new Date(),
      },
    });

    await createActivityLog({
      entityType: "AmenityRequest",
      entityId: amenityRequest._id,
      userId: req.user._id,
      userRole: "host",
      action: "create",
    });

    return res
      .status(201)
      .json(
        new ApiResponse(
          201,
          amenityRequest,
          "Amenity Request created successfully"
        )
      );
  } catch (error) {
    console.error("Error in amenity Request:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", [error.message]));
  }
});

const getAmenityRequests = asyncHandler(async (req, res) => {
  try {
    // Validate and parse query parameters
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const sortField = req.query.sort || "updatedAt";
    const sortOrder = parseInt(req.query.sortOrder) === 1 ? 1 : -1;
    const { category } = req.query;

    // Build base query
    const query = {
      user: req.user._id,
      ...(category && { category }), // Add category filter if provided
    };

    // Optimized aggregation pipeline
    const aggregationPipeline = [
      { $match: query },
      { $sort: { [sortField]: sortOrder } },
      {
        $facet: {
          metadata: [
            { $count: "totalRequests" },
            { $addFields: { page, limit } },
          ],
          data: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                category: 1,
                reqName: 1,
                reqMessage: 1,
                reqStatus: 1,
                responseMessage: 1,
                createdAt: 1,
                updatedAt: 1,
                // Add any additional fields needed for display
              },
            },
          ],
        },
      },
      {
        $project: {
          requests: "$data",
          pagination: {
            $ifNull: [
              { $arrayElemAt: ["$metadata", 0] },
              { totalRequests: 0, page, limit },
            ],
          },
        },
      },
      {
        $addFields: {
          "pagination.totalPages": {
            $ceil: {
              $divide: ["$pagination.totalRequests", "$pagination.limit"],
            },
          },
        },
      },
      {
        $addFields: {
          "pagination.hasNextPage": {
            $lt: ["$pagination.page", "$pagination.totalPages"],
          },
          "pagination.hasPreviousPage": {
            $gt: ["$pagination.page", 1],
          },
        },
      },
    ];

    const [result] = await AmenityRequest.aggregate(aggregationPipeline);

    return res
      .status(200)
      .json(
        new ApiResponse(200, result, "Amenity requests retrieved successfully")
      );
  } catch (error) {
    console.error("Error fetching amenity requests:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", error.message));
  }
});

const addEditEvent = asyncHandler(async (req, res) => {
  try {
    const {
      editId,
      title,
      categoryId,
      eventType,
      startDate,
      endDate,
      startTime,
      endTime,
      duration,
      maxParticipants,
      ageRestriction,
      eventLanguage,
      includedItems,
      whatToBring,
      safetyInfo,
      location,
      price,
      description,
      images,
      video,
      termsAgreement,
      organizer,
    } = req.body;

    // Validate required fields
    if (
      !title ||
      !categoryId ||
      !eventType ||
      !startDate ||
      !endDate ||
      !startTime ||
      !endTime ||
      !price ||
      !description ||
      !organizer
    ) {
      return res.status(400).json(new ApiError(400, "Missing required fields"));
    }

    // Validate organizer fields
    if (
      !organizer.firstName ||
      !organizer.lastName ||
      !organizer.email ||
      !organizer.mobileNumber
    ) {
      return res
        .status(400)
        .json(new ApiError(400, "Missing required organizer fields"));
    }

    let processedImages = [];
    if (images && Array.isArray(images)) {
      let featuredImageFound = false;

      // First pass: validate and normalize images
      processedImages = images.map((img, index) => {
        // Ensure isFeatured is boolean (default false)
        const isFeatured = !!img.isFeatured;

        // If this image is marked as featured and we haven't found one yet
        if (isFeatured && !featuredImageFound) {
          featuredImageFound = true;
          return {
            url: img.url || "",
            caption: img.caption || "",
            isFeatured: true,
          };
        }

        // All other images
        return {
          url: img.url || "",
          caption: img.caption || "",
          isFeatured: false,
        };
      });

      // If no image was marked as featured, make the first one featured
      if (!featuredImageFound && processedImages.length > 0) {
        processedImages[0].isFeatured = true;
      }
    }

    // Prepare event data
    const eventData = {
      title,
      categoryId,
      eventType,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      startTime,
      endTime,
      duration,
      maxParticipants: maxParticipants || 20,
      ageRestriction: ageRestriction || 18,
      eventLanguage: eventLanguage || ["English"],
      includedItems: includedItems || [],
      whatToBring: whatToBring || [],
      safetyInfo: safetyInfo || [],
      location: {
        address: location?.address || "",
        coordinates: location?.coordinates || [],
      },
      price,
      currency: "INR",
      description,
      images: processedImages || [],
      video,
      termsAgreement: termsAgreement || "",
      organizer: {
        firstName: organizer.firstName,
        lastName: organizer.lastName,
        email: organizer.email,
        mobileNumber: organizer.mobileNumber,
      },
      createdBy: {
        userId: req.user._id,
        role: "host",
      },
      status: "upcoming",
    };

    // Check if editing existing event
    if (editId) {
      // Update existing event
      const updatedEvent = await Event.findByIdAndUpdate(
        editId,
        { $set: eventData },
        { new: true, runValidators: true }
      );

      if (!updatedEvent) {
        return res.status(404).json(new ApiError(404, "Event not found"));
      }

      await createActivityLog({
        entityType: "Event",
        entityId: updatedEvent._id,
        userId: req.user._id,
        userRole: "host",
        action: "update",
      });

      return res
        .status(200)
        .json(new ApiResponse(200, updatedEvent, "Event updated successfully"));
    } else {
      // Create new event
      const newEvent = await Event.create(eventData);

      await createActivityLog({
        entityType: "Event",
        entityId: newEvent._id,
        userId: req.user._id,
        userRole: "host",
        action: "create",
      });

      return res
        .status(201)
        .json(new ApiResponse(201, newEvent, "Event created successfully"));
    }
  } catch (error) {
    console.error("Event error:", error);
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res
        .status(400)
        .json(new ApiError(400, "Validation Error", errors));
    }
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const getEventList = asyncHandler(async (req, res) => {
  try {
    const {
      pageNum,
      limitNum,
      categoryId,
      sort = "desc",
      search,
      date,
      status = "upcoming",
    } = req.query;
    const page = parseInt(pageNum) || 1;
    const limit = parseInt(limitNum) || 10;
    const skip = (page - 1) * limit;

    const query = {
      createdBy: {
        userId: req.user._id,
        role: "host",
      },
    };
    // Add category filter if provided
    if (categoryId) {
      query.categoryId = categoryId;
    }

    if (status) {
      query.status = status;
    }

    // Add search filter if provided
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { tags: { $regex: search, $options: "i" } },
      ];
    }

    // if get patical date filter
    if (date) {
      const selectedDate = new Date(date);
      if (isNaN(selectedDate.getTime())) {
        return res.status(400).json(new ApiError(400, "Invalid date format"));
      }
      const nextDay = new Date(selectedDate);
      nextDay.setDate(nextDay.getDate() + 1);

      query.$and = [
        { startDate: { $lt: nextDay } },
        { endDate: { $gte: selectedDate } },
      ];
    }

    // Sort options (default: newest first)
    const sortOptions = {};
    if (sort === "asc") {
      sortOptions.startDate = 1; // Oldest first
    } else {
      sortOptions.startDate = -1; // Newest first (default)
    }

    // Get events with pagination
    const events = await Event.find(query)
      .populate("categoryId", "name")
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count for pagination
    const totalEvents = await Event.countDocuments(query);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          events,
          pagination: {
            total: totalEvents,
            page,
            pages: Math.ceil(totalEvents / limit),
            limit,
          },
        },
        "Events fetched successfully"
      )
    );
  } catch (error) {
    console.error("Event error:", error);
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res
        .status(400)
        .json(new ApiError(400, "Validation Error", errors));
    }
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const cancelEvent = asyncHandler(async (req, res) => {
  try {
    const { eventId, reason } = req.body;
    const userId = req.user._id;

    // Validate input
    if (!eventId || !reason) {
      return res
        .status(400)
        .json(
          new ApiError(400, "Event ID and cancellation reason are required")
        );
    }

    // Find the event and verify ownership
    const event = await Event.findOne({
      _id: eventId,
      "createdBy.userId": userId,
    });

    if (!event) {
      return res
        .status(404)
        .json(
          new ApiError(
            404,
            "Event not found or you don't have permission to cancel it"
          )
        );
    }

    // Check if event is already cancelled
    if (event.status === "cancelled") {
      return res
        .status(400)
        .json(new ApiError(400, "Event is already cancelled"));
    }

    // Check if event is already completed
    if (event.status === "completed") {
      return res
        .status(400)
        .json(new ApiError(400, "Cannot cancel a completed event"));
    }

    // Update event status and cancellation reason
    const updatedEvent = await Event.findByIdAndUpdate(
      eventId,
      {
        $set: {
          cancellationReason: reason,
          cancelRequest: true,
          requestedAt: new Date(),
          cancelledBy: {
            userId: userId,
            role: "host",
          },
        },
      },
      { new: true }
    );

    // Get all admin users
    const adminUsers = await User.findOne({
      roles: "admin",
      adminRole: "super_admin",
    }).select("_id");

    // Create notifications for each admin
    await createNotification({
      recipientId: adminUsers._id,
      recipientRole: "admin",
      senderId: userId,
      senderRole: "host",
      title: "Event Cancellation Request",
      message: `Event "${updatedEvent.title}" has been requested for cancellation by host.`,
      notificationType: "event",
      actionId: updatedEvent._id,
      actionUrl: `/events/${updatedEvent._id}`,
      metadata: {
        eventId: updatedEvent._id,
        eventTitle: updatedEvent.title,
        cancelledBy: {
          userId: userId,
          role: "host",
        },
        cancellationReason: reason,
        requestedAt: new Date(),
      },
    });

    await createActivityLog({
      entityType: "Event",
      entityId: updatedEvent._id,
      userId: req.user._id,
      userRole: "host",
      action: "cancelRequest",
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          event: updatedEvent,
        },
        "Event cancelled request send successfully"
      )
    );
  } catch (error) {
    console.error("Error cancelling event:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const getEventReviews = asyncHandler(async (req, res) => {
  try {
    // Extract and validate parameters
    const { page = 1, limit = 10, eventId } = req.query;

    // Validate eventId
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json(new ApiError(400, "Invalid event ID format"));
    }

    // Check property exists
    const event = await Event.findById(eventId).select("averageRating");
    if (!event) {
      return res.status(404).json(new ApiError(404, "Event not found"));
    }

    // Convert and validate pagination parameters
    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const skip = (pageNumber - 1) * limitNumber;

    // Fetch reviews with pagination
    const [reviews, totalReviews] = await Promise.all([
      EventRating.find({ eventId })
        .populate({
          path: "userId",
          select: "firstName lastName profileImage",
          model: "User",
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      EventRating.countDocuments({ eventId }),
    ]);

    const averageRating =
      reviews.length > 0
        ? parseFloat(
            (
              reviews.reduce((sum, item) => sum + item.rating, 0) /
              reviews.length
            ).toFixed(2)
          )
        : 0;

    // Prepare response
    const response = {
      metadata: {
        overall: averageRating,
        totalReviews,
      },
      reviews,
      pagination: {
        currentPage: pageNumber,
        totalPages: Math.ceil(totalReviews / limitNumber),
        itemsPerPage: limitNumber,
        hasNextPage: pageNumber * limitNumber < totalReviews,
      },
    };

    return res
      .status(200)
      .json(
        new ApiResponse(200, response, "Event reviews retrieved successfully")
      );
  } catch (error) {
    console.error("Error in fetching event reviews:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Failed to retrieve event reviews"));
  }
});

const getEventBookingList = asyncHandler(async (req, res) => {
  try {
    const { eventId } = req.params;

    // Validate event ownership
    const event = await Event.findOne({
      _id: eventId,
      "createdBy.userId": req.user._id,
      "createdBy.role": "host",
    });

    if (!event) {
      return res
        .status(404)
        .json(
          new ApiError(404, "Event not found or you don't have permission")
        );
    }

    // Get all bookings for this event with populated details
    const bookings = await BookingEvent.aggregate([
      {
        $match: {
          event: new mongoose.Types.ObjectId(eventId),
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "bookingBy.user",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      { $unwind: "$userDetails" },
      {
        $project: {
          bookingId: 1,
          status: 1,
          bookingDate: 1,
          numberOfAttendees: 1,
          paymentDetails: 1,
          user: {
            firstName: "$userDetails.firstName",
            lastName: "$userDetails.lastName",
            email: "$userDetails.email",
            address: "$userDetails.address",
            mobile: "$userDetails.mobile",
            profileImage: "$userDetails.profileImage",
          },
        },
      },
      { $sort: { bookingDate: -1 } }, // Sort by newest first
    ]);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          bookings: bookings,
        },
        "Event bookings fetched successfully"
      )
    );
  } catch (error) {
    console.error("Event booking error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const getEventBookingMembers = asyncHandler(async (req, res) => {
  try {
    const { eventId, slug } = req.query;

    if (!eventId && !slug) {
      return res
        .status(400)
        .json(new ApiError(400, "Event ID or slug is required"));
    }

    // Event find by id or slug
    const event = await Event.findOne(
      eventId ? { _id: eventId } : { slug: slug }
    ).lean();

    if (!event) {
      return res.status(404).json(new ApiError(404, "Event not found"));
    }

    // booking event list according to event id
    const bookingEventList = await BookingEvent.find({ event: event._id })
      .populate({
        path: "bookingBy.user",
        select: "firstName lastName email address mobile profileImage",
      })
      .lean();

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { bookingEventList },
          "Event members fetched successfully"
        )
      );
  } catch (error) {
    console.error("Booking error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const getMyListing = asyncHandler(async (req, res) => {
  try {
    const { type } = req.query;
    if (!type) {
      return res.status(400).json(new ApiError(400, "Type is required"));
    }

    let response = [];

    if (type == "event") {
      response = await Event.find({
        "createdBy.userId": req.user._id,
        "createdBy.role": "host",
      }).select("_id title slug eventType images status");
    } else if (type == "property") {
      response = await Property.find({ owner: req.user._id }).select(
        "_id name slug images"
      );
    } else {
      return res
        .status(400)
        .json(new ApiError(400, "Type must be event or property"));
    }

    return res
      .status(200)
      .json(
        new ApiResponse(200, response, "Event reviews retrieved successfully")
      );
  } catch (error) {
    console.error("Error in fetching listing:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Failed to retrieve listing"));
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
  createProperty,
  updateProperty,
  updatePropertyPrice,
  updatePropertyDiscount,
  updatePropertyAvailable,
  propertyList,
  bookingList,
  updateBookingStatus,
  getPropertyReviews,
  autoAcceptAddRemoved,
  amenityRequest,
  getAmenityRequests,
  addEditEvent,
  getEventList,
  cancelEvent,
  getEventReviews,
  getEventBookingMembers,
  getEventBookingList,
  getMyListing,
};
