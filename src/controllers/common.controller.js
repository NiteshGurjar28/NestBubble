import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { User } from "../models/user.model.js";
import { PropertyType } from "../models/PropertyType.model.js";
import { Property } from "../models/Property.model.js";
import { PropertyRating } from "../models/PropertyRating.model.js";
import { EventRating } from "../models/EventRating.model.js";
import { Amenity } from "../models/Amenity.model.js";
import { ConciergeService } from "../models/ConciergeService.model.js";
import { Wallet, WalletTransaction } from "../models/Wallet.model.js";
import { Event } from "../models/Event.model.js";
import { PropertyCalendar } from "../models/PropertyCalendar.model.js";
import {
  ContactEnquiry,
  ContactEnquiryType,
} from "../models/ContactEnquiry.model.js";
import { EventCategory } from "../models/EventCategory.model.js";
import { Conversation, Message } from "../models/chat.models.js";
import { Notification } from "../models/Notification.model.js";
import {
  Vendor,
  VendorDiscountCode,
  VendorRefundPolicy,
} from "../models/Vendor.model.js";
import {
  createActivityLog,
  eventComplete,
  propertyComplete,
} from "../utils/activityLog.helper.js";
import { Setting, FAQ } from "../models/Setting.model.js";
import { Pages } from "../models/Pages.model.js";
import { Newsletter, ComingSoon } from "../models/Newsletter.model.js";
import { HelpCenter } from "../models/HelpCenter.model.js";
import { SupportFaq, SupportConversation } from "../models/Support.js";
import { getIO } from "../socket.js";
import path from "path";
import mongoose from "mongoose";
import vision from "@google-cloud/vision";
import {
  isImageSafe,
  isHomeRelated,
  summarizeSafeSearch,
} from "../utils/visionRules.js";

import fs from "fs/promises";
import Stripe from "stripe";
import Razorpay from "razorpay";

const client = new vision.ImageAnnotatorClient();

const profileUpdate = asyncHandler(async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    mobile,
    address,
    kyc, // Now kyc comes as an object
    profileImage,
    backgroundImage,
  } = req.body;

  try {
    // Validate required fields
    if (!firstName || !lastName || !email || !mobile) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            "First name, last name, mobile and email are required"
          )
        );
    }

    // Validate KYC fields if provided
    if (kyc) {
      // Validate Aadhaar number format (12 digits)
      if (kyc.aadharNumber && !/^\d{12}$/.test(kyc.aadharNumber)) {
        return res
          .status(400)
          .json(new ApiError(400, "Aadhaar number must be 12 digits"));
      }

      // Validate PAN number format (10 characters)
      if (kyc.panNumber && !/^[A-Z]{5}\d{4}[A-Z]{1}$/.test(kyc.panNumber)) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid PAN number format"));
      }
    }

    // Prepare update data
    const updateData = {
      firstName,
      lastName,
      email,
      profileImage,
      backgroundImage,
      address: {
        ...req.user.address, // Preserve existing address data
        ...address, // Merge with new address data
      },
      profileCompletionStatus: "complete",
      updatedAt: new Date(),
    };

    const currentUser = await User.findById(req.user._id);

    // Check if mobile is being updated and is different from current one
    if (mobile && mobile !== currentUser.mobile) {
      const existingMobile = await User.findOne({
        mobile,
        _id: { $ne: req.user._id },
      });

      if (existingMobile) {
        return res
          .status(400)
          .json(new ApiError(400, "Mobile number already in use"));
      }

      updateData.mobile = mobile; // set only if valid and not same as old
    }

    if (email && email !== currentUser.email) {
      const existingEmail = await User.findOne({
        email,
        _id: { $ne: req.user._id },
      });

      if (existingEmail) {
        return res.status(400).json(new ApiError(400, "Email already in use"));
      }

      updateData.email = email;
    }

    // Only update KYC fields if they're provided
    if (kyc) {
      updateData.kyc = {
        ...req.user.kyc, // Preserve existing KYC data
        ...kyc, // Merge with new KYC data
      };
    }

    // Update user
    const user = await User.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
      runValidators: true,
    }).select("-password -refreshToken -accessToken -socialAuth");

    await createActivityLog({
      entityType: "User",
      entityId: req.user._id,
      userId: req.user._id,
      userRole: "guest",
      action: "update",
    });

    return res
      .status(200)
      .json(new ApiResponse(200, user, "Profile updated successfully"));
  } catch (error) {
    console.error("Profile Update error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const propertyTypeList = asyncHandler(async (req, res) => {
  try {
    const propertyTypes = await PropertyType.find({ status: true })
      .select("name description image cleaningFees")
      .lean();

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          propertyTypes,
          "Property types retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Property Type List error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const priceCalculation = asyncHandler(async (req, res) => {
  try {
    const { propertyId, bookingDates, extraFeatures, guestDetails } = req.body;

    // ========== VALIDATION SECTION ==========
    if (!propertyId || !bookingDates?.startDate || !bookingDates?.endDate) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            "Property ID and booking checkIn/checkOut dates are required."
          )
        );
    }

    const property = await Property.findById(propertyId).populate(
      "propertyType",
      "cleaningFees"
    );
    if (!property) {
      return res.status(404).json(new ApiError(404, "Property not found"));
    }

    if (
      property.status !== "active" ||
      property.adminApprovalStatus !== "approved"
    ) {
      return res
        .status(400)
        .json(new ApiError(400, "Property is not available for booking"));
    }

    // Convert to Date objects
    const checkInDate = new Date(bookingDates.startDate);
    const checkOutDate = new Date(bookingDates.endDate);

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

    // ========== PRICE CALCULATION ==========
    const calendarEntries = await PropertyCalendar.find({
      propertyId,
      date: { $gte: checkInDate, $lte: calendarEndDate },
      status: "available",
    });

    if (calendarEntries.length !== totalNights) {
      return res
        .status(400)
        .json(
          new ApiError(400, "Some selected dates are missing in the calendar.")
        );
    }

    const nightlyPrices = calendarEntries.map((entry) => ({
      date: entry.date,
      price: entry.price,
      priceBeforeTax: entry.priceBeforeTax,
    }));

    const totalAmountWithTax = nightlyPrices.reduce(
      (sum, entry) => sum + entry.price,
      0
    );
    const totalAmountBeforeTax = nightlyPrices.reduce(
      (sum, entry) => sum + entry.priceBeforeTax,
      0
    );
    const totalTaxAmount = totalAmountWithTax - totalAmountBeforeTax;

    // ========== EXTRA FEATURES CALCULATION ==========
    let extraFeaturesTotal = 0;
    const extraFeaturesBreakdown = [];

    if (extraFeatures?.length) {
      for (const feature of extraFeatures) {
        if (!property.extraFeatures.hasOwnProperty(feature.featureType)) {
          return res
            .status(400)
            .json(
              new ApiError(400, `Invalid feature type: ${feature.featureType}`)
            );
        }

        const propertyFeature = property.extraFeatures[feature.featureType];

        if (!propertyFeature.available) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                `${feature.featureType} is not available for this property`
              )
            );
        }

        const featureStartDate = new Date(feature.duration.startDate);
        const featureEndDate = new Date(feature.duration.endDate);

        if (
          isNaN(featureStartDate) ||
          isNaN(featureEndDate) ||
          featureEndDate < featureStartDate
        ) {
          return res
            .status(400)
            .json(new ApiError(400, "Invalid feature duration dates"));
        }

        const featureDays = Math.ceil(
          (featureEndDate - featureStartDate) / oneDay
        );
        const featureDailyRate = propertyFeature.amount;
        const featureTotalAmount = featureDailyRate * featureDays;

        extraFeaturesTotal += featureTotalAmount;

        extraFeaturesBreakdown.push({
          featureType: feature.featureType,
          duration: {
            startDate: featureStartDate,
            endDate: featureEndDate,
            totalDays: featureDays,
          },
          pricing: {
            dailyRate: featureDailyRate,
            totalAmount: featureTotalAmount,
          },
        });
      }
    }

    // ========== CLEANING FEE CALCULATION ==========
    let cleaningFeePercentage = 0;
    if (totalNights <= 2) {
      cleaningFeePercentage = property.propertyType.cleaningFees.shortStay || 0;
    } else {
      cleaningFeePercentage = property.propertyType.cleaningFees.longStay || 0;
    }

    const cleaningFeeAmount =
      (totalAmountWithTax * cleaningFeePercentage) / 100;

    // ========== DISCOUNTS CALCULATION ==========
    const discountsBreakdown = [];
    let totalDiscountAmount = 0;

    // Weekly Discount
    if (
      property.discounts.weeklyDiscount?.status &&
      totalNights >= 7 &&
      totalNights < 28
    ) {
      const discountPercentage =
        property.discounts.weeklyDiscount.percentage || 0;
      const discountAmount = (totalAmountWithTax * discountPercentage) / 100;

      discountsBreakdown.push({
        type: "weeklyDiscount",
        percentage: discountPercentage,
        amount: discountAmount,
      });

      totalDiscountAmount += discountAmount;
    }

    // Monthly Discount
    if (property.discounts.monthlyDiscount?.status && totalNights >= 28) {
      const discountPercentage =
        property.discounts.monthlyDiscount.percentage || 0;
      const discountAmount = (totalAmountWithTax * discountPercentage) / 100;
      discountsBreakdown.push({
        type: "monthlyDiscount",
        percentage: discountPercentage,
        amount: discountAmount,
      });
      totalDiscountAmount += discountAmount;
    }

    // Last Minute Discount
    if (property.discounts.lastMintDiscount?.status) {
      const discountPercentage =
        property.discounts.lastMintDiscount.percentage || 0;
      const discountAmount = (totalAmountWithTax * discountPercentage) / 100;
      discountsBreakdown.push({
        type: "lastMintDiscount",
        percentage: discountPercentage,
        amount: discountAmount,
      });
      totalDiscountAmount += discountAmount;
    }

    // New Listing Discount
    if (
      discountsBreakdown.length === 0 && // no previous discounts applied
      property.discounts.newListingDiscount?.status
    ) {
      const discountPercentage =
        property.discounts.newListingDiscount.percentage || 0;
      const discountAmount = (totalAmountWithTax * discountPercentage) / 100;

      discountsBreakdown.push({
        type: "newListingDiscount",
        percentage: discountPercentage,
        amount: discountAmount,
      });

      totalDiscountAmount += discountAmount;
    }

    // ========== FINAL AMOUNT CALCULATION ==========
    const amountAfterDiscounts = totalAmountWithTax - totalDiscountAmount;
    const finalAmount = amountAfterDiscounts + extraFeaturesTotal;

    // ========== RESPONSE STRUCTURE ==========
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          // Booking Details
          bookingSummary: {
            bookingDates: {
              startDate: checkInDate,
              endDate: checkOutDate,
              totalNights,
            },
            guestDetails,

            // Base Pricing
            pricing: {
              totalAmountBeforeTax,
              totalTaxAmount,
              totalAmountWithTax,
              totalDiscountAmount,
              amountAfterDiscounts,
              extraFeaturesTotal,
              finalAmount,
              cleaningFeeAmount,
            },
            // nightlyBreakdown: nightlyPrices,

            // Discounts
            discounts: discountsBreakdown,

            // Extra Features
            extraFeatures: extraFeaturesBreakdown,
          },
        },
        "Price calculated successfully."
      )
    );
  } catch (error) {
    console.error("Price calculation error:", error);
    return res
      .status(500)
      .json(
        new ApiError(500, "Something went wrong while calculating the price.", [
          error.message,
        ])
      );
  }
});

const getpropertyCalendar = asyncHandler(async (req, res) => {
  try {
    const { propertyId, month, year } = req.query;

    // Validate propertyId
    if (!propertyId) {
      return res.status(400).json(new ApiError(400, "Property ID is required"));
    }

    // Create date filter
    let dateFilter = {};

    if (month && year) {
      // Convert month and year to numbers
      const monthNum = parseInt(month);
      const yearNum = parseInt(year);

      // Get first day of the month
      const start = new Date(yearNum, monthNum - 1, 1);

      // Get last day of the month
      const end = new Date(yearNum, monthNum, 0);
      end.setHours(23, 59, 59, 999); // Include the entire last day

      dateFilter = {
        date: { $gte: start, $lte: end },
      };
    }

    // Fetch calendar data from PropertyCalendar
    const calendarData = await PropertyCalendar.find({
      propertyId,
      ...dateFilter,
    })
      .populate({
        path: "bookingId", 
        select: "bookingId", 
      })
      .sort({ date: 1 }) // ascending by date
      .lean();

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          calendarData,
          "Property calendar fetched successfully"
        )
      );
  } catch (error) {
    console.error("Error in fetching property calendar:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", error.message));
  }
});

const amenityList = asyncHandler(async (req, res) => {
  try {
    const amenities = await Amenity.find({ status: true }).lean();

    // Group amenities by category
    const groupedAmenities = amenities.reduce((acc, amenity) => {
      const { category } = amenity;

      if (!acc[category]) {
        acc[category] = [];
      }

      acc[category].push(amenity);
      return acc;
    }, {});

    // Convert to array format with category names
    const result = Object.entries(groupedAmenities).map(
      ([category, items]) => ({
        category,
        items,
      })
    );

    // Sort categories in specific order
    const categoryOrder = [
      "Basic Amenities",
      "Standout Amenities",
      "Safety Items",
    ];

    result.sort((a, b) => {
      return (
        categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category)
      );
    });

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          result,
          "Amenities retrieved and grouped successfully"
        )
      );
  } catch (error) {
    console.error("Amenity List error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const homePage = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?._id;

    // Execute all queries in parallel for better performance
    const [
      propertyTypes,
      topVacationProperties,
      data,
      settings,
      topRatings,
      ratingStats,
      userCount,
      maxPriceResult,
    ] = await Promise.all([
      // 1. Property Types with counts
      PropertyType.aggregate([
        {
          $lookup: {
            from: "properties",
            let: { typeId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$propertyType", "$$typeId"] },
                  status: "active",
                  adminApprovalStatus: "approved",
                },
              },
            ],
            as: "propertyDetails",
          },
        },
        {
          $project: {
            name: 1,
            image: 1,
            slug: 1,
            propertyCount: { $size: "$propertyDetails" },
          },
        },
      ]),

      // 2. Top Vacation Properties
      Property.aggregate([
        {
          $match: {
            adminApprovalStatus: "approved",
            status: "active",
            topVacation: true,
          },
        },
        {
          $lookup: {
            from: "propertytypes",
            localField: "propertyType",
            foreignField: "_id",
            as: "propertyTypeInfo",
          },
        },
        { $unwind: "$propertyTypeInfo" },
        // Use the virtual todayPrice field
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
        // Conditional lookup - only lookup wishlists if userId exists
        ...(userId
          ? [
              {
                $lookup: {
                  from: "wishlists",
                  let: { propertyId: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $and: [
                            { $eq: ["$property", "$$propertyId"] },
                            {
                              $eq: [
                                "$user",
                                new mongoose.Types.ObjectId(userId),
                              ],
                            },
                          ],
                        },
                      },
                    },
                  ],
                  as: "wishlistInfo",
                },
              },
            ]
          : []),
        {
          $addFields: {
            featuredImage: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$images",
                    as: "image",
                    cond: { $eq: ["$$image.isFeatured", true] },
                  },
                },
                0,
              ],
            },
            // Set isWishlisted to false if no userId, otherwise check wishlistInfo
            isWishlisted: userId
              ? { $gt: [{ $size: { $ifNull: ["$wishlistInfo", []] } }, 0] }
              : false,
            // Add today's price - use calendar price if available, otherwise use base amount
            todayPrice: {
              $ifNull: ["$todayPriceInfo.price", "$pricing.baseAmount"],
            },
            todayStatus: {
              $ifNull: ["$todayPriceInfo.status", "available"],
            },
          },
        },
        {
          $sort: {
            averageRating: -1,
            ratingCount: -1,
          },
        },
        {
          $project: {
            name: 1,
            slug: 1,
            address: 1,
            featuredImage: "$featuredImage.url",
            propertyTypeName: "$propertyTypeInfo.name",
            pricing: 1,
            averageRating: 1,
            isWishlisted: 1,
            capacity: 1,
            todayPrice: 1,
            todayStatus: 1,
          },
        },
        { $limit: 6 },
      ]),

      // 3. Home Page Settings
      Pages.findOne({ pageType: "home" })
        .populate("selectedItems.propertyTypes.selectedTypes", "_id name image")
        .populate("selectedItems.services.selectedServices", "_id name image")
        .populate("selectedItems.events.selectedEvents", "_id name image")
        .select("selectedItems sliderImages")
        .lean(),

      // 4. Site Settings
      Setting.findOne().lean(),

      // 5. Top Ratings
      PropertyRating.aggregate([
        {
          $match: { rating: { $gte: 4 } },
        },
        {
          $sort: {
            rating: -1,
            createdAt: -1,
          },
        },
        { $limit: 5 },
        {
          $lookup: {
            from: "users",
            localField: "guestId",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: "$user" },
        {
          $project: {
            rating: 1,
            review: 1,
            createdAt: 1,
            "user.firstName": 1,
            "user.lastName": 1,
            "user.profileImage": 1,
          },
        },
      ]),

      // 6. Rating Statistics
      PropertyRating.aggregate([
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$rating" },
            totalRatings: { $sum: 1 },
          },
        },
      ]),

      // 7. User Count
      User.countDocuments(),
      PropertyCalendar.aggregate([
        {
          $match: {
            // Optional: Add any filters you need
            status: "available", // Only consider available dates
          },
        },
        {
          $group: {
            _id: null,
            maxPrice: { $max: "$price" },
          },
        },
      ]),
    ]);

    await eventComplete();
    await propertyComplete();
    const responseData = {
      data,
      propertyTypes,
      topVacationProperties: topVacationProperties.map((property) => ({
        ...property,
        featuredImage: property.featuredImage || "/images/default-property.jpg",
      })),
      settings,
      topRatings: topRatings.map((rating) => ({
        ...rating,
        createdAt: rating.createdAt.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
      })),
      stats: {
        averageRating: ratingStats[0]?.averageRating?.toFixed(1) || 0,
        totalRatings: ratingStats[0]?.totalRatings || 0,
        totalUsers: userCount,
      },
      maxPrice: maxPriceResult.length > 0 ? maxPriceResult[0].maxPrice : 0,
    };

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          responseData,
          "Home page data fetched successfully"
        )
      );
  } catch (error) {
    console.error("Home page error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", error.message));
  }
});

const getFaqs = asyncHandler(async (req, res) => {
  try {
    const faqs = await FAQ.find({ type: "general", isActive: true })
      .lean()
      .sort({ order: 1 });
    return res
      .status(200)
      .json(new ApiResponse(200, faqs, "FAQs retrieved successfully"));
  } catch (error) {
    console.error("FAQs error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const propertyDetails = asyncHandler(async (req, res) => {
  const { propertyId, slug } = req.body;
  const userId = req.user?._id;
  const { ratingsPage = 1, ratingsLimit = 5 } = req.query; // Pagination for ratings

  // Validate property ID
  if (!propertyId && !slug) {
    return res
      .status(400)
      .json(new ApiError(400, "Either propertyId or slug must be provided"));
  }

  let matchCondition = {};
  if (propertyId) {
    if (!mongoose.Types.ObjectId.isValid(propertyId)) {
      return res.status(400).json(new ApiError(400, "Invalid property ID"));
    }
    matchCondition = { _id: new mongoose.Types.ObjectId(propertyId) };
  } else {
    matchCondition = { slug: slug };
  }

  // Convert page and limit to numbers
  const ratingsPageNum = parseInt(ratingsPage);
  const ratingsLimitNum = parseInt(ratingsLimit);

  // Main property aggregation pipeline
  const propertyAggregation = Property.aggregate([
    {
      $match: {
        ...matchCondition,
        status: "active",
      },
    },
    // Lookup owner details
    {
      $lookup: {
        from: "users",
        localField: "owner",
        foreignField: "_id",
        as: "ownerDetails",
        pipeline: [
          {
            $project: {
              _id: 1,
              firstName: 1,
              lastName: 1,
              email: 1,
              profileImage: 1,
              mobile: 1,
            },
          },
        ],
      },
    },
    // Lookup property type details
    {
      $lookup: {
        from: "propertytypes",
        localField: "propertyType",
        foreignField: "_id",
        as: "propertyTypeDetails",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
              image: 1,
              cleaningFees: 1,
            },
          },
        ],
      },
    },
    // Lookup amenities with their details
    {
      $lookup: {
        from: "amenities",
        localField: "amenities",
        foreignField: "_id",
        as: "amenitiesDetails",
      },
    },
    // Lookup today's price from PropertyCalendar
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
                    $gte: ["$date", new Date(new Date().setHours(0, 0, 0, 0))],
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
    { $unwind: { path: "$todayPriceInfo", preserveNullAndEmptyArrays: true } },

    // Lookup wishlist info
    ...(userId
      ? [
          {
            $lookup: {
              from: "wishlists",
              let: { propertyId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$property", "$$propertyId"] },
                        { $eq: ["$user", new mongoose.Types.ObjectId(userId)] },
                      ],
                    },
                  },
                },
              ],
              as: "wishlistInfo",
            },
          },
          {
            $addFields: {
              isWishlisted: {
                $cond: {
                  if: { $gt: [{ $size: "$wishlistInfo" }, 0] },
                  then: true,
                  else: false,
                },
              },
            },
          },
        ]
      : [
          {
            $addFields: {
              isWishlisted: false,
            },
          },
        ]),
    // Add grouped amenities
    {
      $addFields: {
        groupedAmenities: {
          $reduce: {
            input: "$amenitiesDetails",
            initialValue: [],
            in: {
              $let: {
                vars: {
                  existingCategory: {
                    $filter: {
                      input: "$$value",
                      as: "group",
                      cond: { $eq: ["$$group.category", "$$this.category"] },
                    },
                  },
                },
                in: {
                  $cond: {
                    if: { $gt: [{ $size: "$$existingCategory" }, 0] },
                    then: {
                      $map: {
                        input: "$$value",
                        as: "group",
                        in: {
                          $cond: {
                            if: {
                              $eq: ["$$group.category", "$$this.category"],
                            },
                            then: {
                              category: "$$group.category",
                              items: {
                                $concatArrays: ["$$group.items", ["$$this"]],
                              },
                            },
                            else: "$$group",
                          },
                        },
                      },
                    },
                    else: {
                      $concatArrays: [
                        "$$value",
                        [
                          {
                            category: "$$this.category",
                            items: ["$$this"],
                          },
                        ],
                      ],
                    },
                  },
                },
              },
            },
          },
        },
        // Add today's price field
        todayPrice: {
          $ifNull: ["$todayPriceInfo.price", "$pricing.baseAmount"],
        },
        todayStatus: {
          $ifNull: ["$todayPriceInfo.status", "available"],
        },
      },
    },
    // Final projection
    {
      $project: {
        _id: 1,
        propertyUID: 1,
        name: 1,
        slug: 1,
        description: 1,
        topVacation: 1,
        address: 1,
        coordinates: 1,
        buildYear: 1,
        landSize: 1,
        capacity: 1,
        bedrooms: 1,
        bathrooms: 1,
        images: 1,
        rules: 1,
        pricing: 1,
        notAvailableDates: 1,
        extraFeatures: 1,
        videos: 1,
        discounts: 1,
        owner: { $arrayElemAt: ["$ownerDetails", 0] },
        propertyType: { $arrayElemAt: ["$propertyTypeDetails", 0] },
        groupedAmenities: 1,
        amenities: 1,
        isWishlisted: 1,
        averageRating: 1,
        averageComfortableRating: 1,
        averageCleanlinessRating: 1,
        averageFacilitiesRating: 1,
        ratingCount: 1,
        todayPrice: 1,
        todayStatus: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  ]);

  // Execute query in parallel
  const [propertyResult] = await Promise.all([propertyAggregation.exec()]);

  if (!propertyResult.length) {
    return res.status(400).json(new ApiError(400, "Property not found"));
  }

  const propertyInfoId = propertyResult[0]._id;

  // Ratings list aggregation
  const ratingsAggregation = PropertyRating.aggregate([
    {
      $match: {
        propertyId: new mongoose.Types.ObjectId(propertyInfoId),
      },
    },
    {
      $sort: { createdAt: -1 },
    },
    {
      $skip: (ratingsPageNum - 1) * ratingsLimitNum,
    },
    {
      $limit: ratingsLimitNum,
    },
    {
      $lookup: {
        from: "users",
        localField: "guestId",
        foreignField: "_id",
        as: "guestDetails",
        pipeline: [
          {
            $project: {
              _id: 1,
              firstName: 1,
              lastName: 1,
              profileImage: 1,
            },
          },
        ],
      },
    },
    {
      $addFields: {
        guest: { $arrayElemAt: ["$guestDetails", 0] },
      },
    },
    {
      $project: {
        guestDetails: 0,
        propertyId: 0,
        __v: 0,
      },
    },
  ]);

  // Execute parallel
  const [ratings] = await Promise.all([ratingsAggregation.exec()]);

  // Get total ratings count for pagination
  const totalRatings = await PropertyRating.countDocuments({
    propertyId: new mongoose.Types.ObjectId(propertyInfoId),
  });

  // Combine results
  const property = {
    ...propertyResult[0],
    ratings: {
      list: ratings,
      pagination: {
        currentPage: ratingsPageNum,
        totalPages: Math.ceil(totalRatings / ratingsLimitNum),
        totalRatings,
        hasNextPage: ratingsPageNum * ratingsLimitNum < totalRatings,
        hasPreviousPage: ratingsPageNum > 1,
      },
    },
  };

  return res
    .status(200)
    .json(
      new ApiResponse(200, property, "Property details fetched successfully")
    );
});

const searchProperties = asyncHandler(async (req, res) => {
  try {
    const {
      checkIn,
      checkOut,
      guests,
      propertyTypes,
      priceRange,
      areaRange,
      ratingRange,
      amenities,
      beds,
      bedrooms,
      bathrooms,
      searchQuery,
      sortBy,
      page = 1,
      limit = 10,
      latitude,
      slug,
      propertyId,
      longitude,
      maxDistance = 50000, // Default 50km radius in meters
    } = req.body;

    const userId = req.user?._id; // Get user ID if authenticated

    // Build the filter object
    const filter = {
      adminApprovalStatus: "approved",
      status: "active",
    };

    let geoNearStage;
    if (latitude !== undefined && longitude !== undefined) {
      // Validate coordinates
      if (isNaN(latitude)) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid latitude value"));
      }
      if (isNaN(longitude)) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid longitude value"));
      }

      // Validate latitude range (-90 to 90)
      if (latitude < -90 || latitude > 90) {
        return res
          .status(400)
          .json(new ApiError(400, "Latitude must be between -90 and 90"));
      }

      // Validate longitude range (-180 to 180)
      if (longitude < -180 || longitude > 180) {
        return res
          .status(400)
          .json(new ApiError(400, "Longitude must be between -180 and 180"));
      }

      geoNearStage = {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [longitude, latitude], // Note: MongoDB uses [long, lat]
          },
          distanceField: "distance",
          maxDistance: maxDistance,
          spherical: true,
          query: {
            // Include other filters in the geoNear query for better performance
            adminApprovalStatus: "approved",
            status: "active",
          },
        },
      };
    }

    if (checkIn || checkOut) {
      if (!checkIn || !checkOut) {
        return res
          .status(400)
          .json(
            new ApiError(400, "Both checkIn and checkOut dates are required")
          );
      }

      const startDate = new Date(checkIn);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(checkOut);
      endDate.setHours(23, 59, 59, 999);

      // Validate dates
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json(new ApiError(400, "Invalid date format"));
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (startDate < today) {
        return res
          .status(400)
          .json(new ApiError(400, "Check-in date cannot be in the past"));
      }
      if (endDate <= startDate) {
        return res
          .status(400)
          .json(
            new ApiError(400, "Check-out date must be after check-in date")
          );
      }

      // Get ALL properties that have ANY booked date in the range
      const bookedProperties = await PropertyCalendar.find({
        date: { $gte: startDate, $lte: endDate },
        status: { $in: ["booked", "blocked"] },
      }).distinct("propertyId");

      // Exclude properties that have ANY booked date in the range
      filter._id = { $nin: bookedProperties.map((id) => id.toString()) };
    }

    // Other filters
    if (guests) filter["capacity.guestsAllowed"] = { $gte: parseInt(guests) };

    // Convert propertyTypes strings to ObjectIds
    if (propertyTypes?.length) {
      filter.propertyType = {
        $in: propertyTypes.map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    if (priceRange)
      filter["pricing.baseAmount"] = {
        $gte: priceRange.min || 0,
        $lte: priceRange.max || Infinity,
      };
    if (areaRange)
      filter["landSize.value"] = {
        $gte: areaRange.min || 0,
        $lte: areaRange.max || Infinity,
      };
    if (ratingRange)
      filter["averageRating"] = {
        $gte: ratingRange.min || 0,
        $lte: ratingRange.max || Infinity,
      };

    if (amenities?.length) {
      filter.amenities = {
        $in: amenities.map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    if (bedrooms) filter["capacity.bedrooms"] = { $gte: parseInt(bedrooms) };
    if (beds) filter["capacity.beds"] = { $gte: parseInt(beds) };
    if (bathrooms) filter["capacity.bathrooms"] = { $gte: parseInt(bathrooms) };

    if (slug) filter["slug"] = slug;
    if (propertyId) filter["_id"] = new mongoose.Types.ObjectId(propertyId);

    if (searchQuery) {
      filter.$or = [
        { name: { $regex: searchQuery, $options: "i" } },
        { description: { $regex: searchQuery, $options: "i" } },
        { "address.street": { $regex: searchQuery, $options: "i" } },
        { "address.city": { $regex: searchQuery, $options: "i" } },
        { "address.district": { $regex: searchQuery, $options: "i" } },
      ];
    }

    // Create aggregation pipeline
    const pipeline = [];

    // Add geoNear stage first if location provided
    if (geoNearStage) pipeline.push(geoNearStage);

    // Add match stage with all filters
    pipeline.push({ $match: filter });

    // Add lookup stages for propertyType and amenities
    pipeline.push(
      {
        $lookup: {
          from: "propertytypes",
          localField: "propertyType",
          foreignField: "_id",
          as: "propertyType",
          pipeline: [
            {
              $project: {
                name: 1,
                description: 1,
                _id: 1,
              },
            },
          ],
        },
      },
      { $unwind: "$propertyType" },
      {
        $lookup: {
          from: "amenities",
          localField: "amenities",
          foreignField: "_id",
          as: "amenities",
          pipeline: [
            {
              $project: {
                name: 1,
                category: 1,
                icon: 1,
                _id: 1,
              },
            },
          ],
        },
      },
      // Lookup today's price from PropertyCalendar
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
      { $unwind: { path: "$todayPriceInfo", preserveNullAndEmptyArrays: true } }
    );

    // Conditional wishlist lookup - only if userId exists
    if (userId) {
      pipeline.push({
        $lookup: {
          from: "wishlists",
          let: { propertyId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$property", "$$propertyId"] },
                    { $eq: ["$user", new mongoose.Types.ObjectId(userId)] },
                  ],
                },
              },
            },
          ],
          as: "wishlistInfo",
        },
      });
    }

    // Add featured image, wishlist status, and today's price
    pipeline.push({
      $addFields: {
        featuredImage: {
          $arrayElemAt: [
            {
              $filter: {
                input: "$images",
                as: "image",
                cond: { $eq: ["$$image.isFeatured", true] },
              },
            },
            0,
          ],
        },
        // Set isWishlisted based on userId existence and wishlistInfo
        isWishlisted: userId
          ? {
              $gt: [{ $size: { $ifNull: ["$wishlistInfo", []] } }, 0],
            }
          : false,
        // Add today's price field
        todayPrice: {
          $ifNull: ["$todayPriceInfo.price", "$pricing.baseAmount"],
        },
        todayStatus: {
          $ifNull: ["$todayPriceInfo.status", "available"],
        },
      },
    });

    // Add sort stage
    let sortStage = {};
    if (sortBy) {
      switch (sortBy) {
        case "priceLowToHigh":
          sortStage = { todayPrice: 1 }; // Now using todayPrice instead of baseAmount
          break;
        case "priceHighToLow":
          sortStage = { todayPrice: -1 }; // Now using todayPrice instead of baseAmount
          break;
        case "ratingHighToLow":
          sortStage = { averageRating: -1 };
          break;
        case "newest":
          sortStage = { createdAt: -1 };
          break;
        case "distance":
          sortStage = { distance: 1 };
          break;
        case "wishlisted":
          sortStage = { isWishlisted: -1 };
          // Only show wishlisted items if user is logged in
          if (userId) {
            // Add additional match stage to filter only wishlisted items
            pipeline.push({
              $match: {
                $expr: {
                  $gt: [{ $size: { $ifNull: ["$wishlistInfo", []] } }, 0],
                },
              },
            });
          }
          break;
        default:
          sortStage = { createdAt: -1 };
      }
    } else if (latitude && longitude) {
      sortStage = { distance: 1 };
    } else {
      sortStage = { createdAt: -1 };
    }
    pipeline.push({ $sort: sortStage });

    // Add pagination stages
    pipeline.push(
      { $skip: (page - 1) * limit },
      { $limit: parseInt(limit) },
      {
        $project: {
          name: 1,
          description: 1,
          slug: 1,
          featuredImage: "$featuredImage.url",
          address: 1,
          coordinates: 1,
          pricing: 1,
          capacity: 1,
          propertyType: 1,
          amenities: 1,
          averageRating: 1,
          ratingCount: 1,
          distance: 1,
          isWishlisted: 1,
          todayPrice: 1, // Include today's price in response
          todayStatus: 1, // Include today's status in response
        },
      }
    );

    // Execute aggregation
    const properties = await Property.aggregate(pipeline);

    // Get total count (without pagination)
    const countPipeline = [];
    if (geoNearStage) countPipeline.push(geoNearStage);
    countPipeline.push({ $match: filter });

    // If sorting by wishlisted, we need to include the wishlist filter in count
    if (sortBy === "wishlisted" && userId) {
      countPipeline.push({
        $lookup: {
          from: "wishlists",
          let: { propertyId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$property", "$$propertyId"] },
                    { $eq: ["$user", new mongoose.Types.ObjectId(userId)] },
                  ],
                },
              },
            },
          ],
          as: "wishlistInfo",
        },
      });
      countPipeline.push({
        $match: {
          $expr: { $gt: [{ $size: { $ifNull: ["$wishlistInfo", []] } }, 0] },
        },
      });
    }

    countPipeline.push({ $count: "total" });

    const countResult = await Property.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    // Format response
    const response = {
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
      limit: parseInt(limit),
      results: properties,
    };

    return res
      .status(200)
      .json(new ApiResponse(200, response, "Properties fetched successfully"));
  } catch (error) {
    console.error("Search Properties error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const eventCategoryList = asyncHandler(async (req, res) => {
  try {
    const eventCategorys = await EventCategory.find({ status: true }).lean();
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          eventCategorys,
          "Event Category retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Event Category List error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const getConciergeServicesList = asyncHandler(async (req, res) => {
  try {
    const conciergeServices = await ConciergeService.find({
      status: true,
    }).lean();
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          conciergeServices,
          "Concierge Services List retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Concierge Services List error:", error);
    return res.status(500).json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const getEventList = asyncHandler(async (req, res) => {
  try {
    const {
      pageNum,
      eventType,
      limitNum,
      categoryId,
      sort = "desc",
      search,
      date,
    } = req.query;
    const page = parseInt(pageNum) || 1;
    const limit = parseInt(limitNum) || 10;
    const skip = (page - 1) * limit;

    // Base query - only upcoming events
    const query = { status: "upcoming" };

    // Add category filter if provided
    if (categoryId) {
      query.categoryId = categoryId;
    }
    // Add eventType filter if provided
    if (eventType) {
      query.eventType = eventType;
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
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const getEventDetails = asyncHandler(async (req, res) => {
  try {
    const { eventId, slug } = req.query;
    if (!eventId && !slug) {
      return res
        .status(400)
        .json(new ApiError(400, "Event ID or slug is required"));
    }

    const query = eventId ? { _id: eventId } : { slug };

    const eventlist = await Event.findOne(query)
      .populate({ path: "categoryId", select: "name" })
      .populate({
        path: "createdBy.userId",
        select: "_id firstName lastName email profileImage eventRating",
      })
      .lean();

    if (!eventlist) {
      return res.status(404).json(new ApiError(404, "Event not found"));
    }

    // Get the latest 10 ratings for this event with user details
    const ratings = await EventRating.find({ eventId: eventlist._id })
      .sort({ createdAt: -1 }) // Latest first
      .limit(10) // Limit to 10 ratings
      .populate({
        path: "userId",
        select: "firstName lastName email profileImage",
      })
      .lean();

    // Add ratings and average rating to the event object
    const event = {
      ...eventlist,
      ratings: ratings,
    };

    return res
      .status(200)
      .json(new ApiResponse(200, event, "Event details fetched successfully"));
  } catch (error) {
    console.error("Event error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const getContactEnquiryType = asyncHandler(async (req, res) => {
  try {
    const contactEnquiryType = await ContactEnquiryType.find({
      status: true,
    }).lean();
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          contactEnquiryType,
          "Contact Enquiry Type List retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Event error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const saveContactEnquiry = asyncHandler(async (req, res) => {
  try {
    const { name, email, phoneNumber, type, message } = req.body;

    // Validate required fields
    if (!name || !email || !phoneNumber || !type) {
      return res
        .status(400)
        .json(
          new ApiError(400, "Name, email, phone number and type are required")
        );
    }

    // Validate MongoDB ObjectId for type
    if (!mongoose.Types.ObjectId.isValid(type)) {
      return res
        .status(400)
        .json(new ApiError(400, "Invalid enquiry type ID format"));
    }

    // Check if enquiry type exists
    const enquiryTypeExists = await ContactEnquiryType.findById(type);
    if (!enquiryTypeExists) {
      return res
        .status(400)
        .json(new ApiError(400, "Specified enquiry type does not exist"));
    }

    // Create contact entry
    const contact = await ContactEnquiry.create({
      userId: req.user?._id,
      name,
      email,
      phoneNumber,
      type,
      message,
    });

    return res
      .status(201)
      .json(
        new ApiResponse(201, contact, "Contact form submitted successfully")
      );
  } catch (error) {
    console.error("Contact form error:", error);
    return res.status(500).json(new ApiError(500, "Internal server error"));
  }
});

// const sendMessage = asyncHandler(async (req, res) => {
//     const { recipientId, recipientRole, currentRole, content, file } = req.body;
//     const senderId = req.user._id;

//     // Check if conversation exists - CORRECTED QUERY
//     let conversation = await Conversation.findOne({
//         $and: [
//             {
//                 participants: {
//                     $elemMatch: {
//                         user: new mongoose.Types.ObjectId(senderId),
//                         role: currentRole
//                     }
//                 }
//             },
//             {
//                 participants: {
//                     $elemMatch: {
//                         user: new mongoose.Types.ObjectId(recipientId),
//                         role: recipientRole
//                     }
//                 }
//             }
//         ]
//     });

//     if (!conversation) {
//         conversation = await Conversation.create({
//             participants: [
//                 { user: new mongoose.Types.ObjectId(senderId), role: currentRole },
//                 { user: new mongoose.Types.ObjectId(recipientId), role: recipientRole }
//             ]
//         });
//     }

//     // Create message with role context
//     const message = await Message.create({
//         sender: senderId,
//         senderRole: currentRole,
//         recipient: recipientId,
//         recipientRole: recipientRole,
//         content,
//         attachment: file ? {
//             url: file.path,
//             fileType: file.mimetype,
//             fileName: file.originalname
//         } : undefined
//     });

//     // Update conversation
//     conversation.lastMessage = message._id;
//     await conversation.save();

//     const populatedMessage = await Message.findById(message._id)
//         .populate('sender',  'firstName lastName profileImage email')
//         .populate('recipient',  'firstName lastName profileImage email');

//     return res.status(201).json(
//         new ApiResponse(201, populatedMessage, "Message sent successfully")
//     );
// });

// const getUserConversations = asyncHandler(async (req, res) => {
//     const userId = req.user._id;
//     const { currentRole, search } = req.query;

//     // Validate currentRole
//     if (!['guest', 'host', 'admin'].includes(currentRole)) {
//         throw new ApiError(400, 'Invalid role specified');
//     }

//     // Step 1: Get all conversations for current user WITH SPECIFIC ROLE
//     let conversations = await Conversation.find({
//         participants: {
//             $elemMatch: {
//                 user: userId,
//                 role: currentRole
//             }
//         }
//     })
//     .populate({
//         path: 'participants.user',
//         select: 'firstName lastName profileImage email',
//         match: { _id: { $ne: userId } }
//     })
//     .populate('lastMessage')
//     .lean();

//     // Step 2: Filter out null participants and enhance with otherParticipant
//     let enhancedConversations = conversations
//         .filter(conv => conv.participants.some(p => p.user && p.user._id.toString() !== userId.toString()))
//         .map(conv => {
//             const otherParticipant = conv.participants.find(p => p.user && p.user._id.toString() !== userId.toString());
//             return {
//                 ...conv,
//                 otherParticipant: otherParticipant.user
//             };
//         });

//     // Step 3: Get unread counts for each conversation
//     enhancedConversations = await Promise.all(
//         enhancedConversations.map(async conv => {
//             const unreadCount = await Message.countDocuments({
//                 recipient: userId,
//                 recipientRole: currentRole,
//                 sender: conv.otherParticipant._id,
//                 isRead: false
//             });

//             return {
//                 ...conv,
//                 unreadCount: unreadCount
//             };
//         })
//     );

//     // Apply search filter if provided
//     if (search) {
//         const searchRegex = new RegExp(search, 'i');
//         enhancedConversations = enhancedConversations.filter(conv => {
//             return (
//                 searchRegex.test(conv.otherParticipant.firstName) ||
//                 searchRegex.test(conv.otherParticipant.lastName) ||
//                 searchRegex.test(conv.otherParticipant.email)
//             );
//         });
//     }

//     // Sort by most recent message
//     enhancedConversations.sort((a, b) =>
//         new Date(b.lastMessage?.createdAt || 0) - new Date(a.lastMessage?.createdAt || 0)
//     );

//     return res.status(200).json(
//         new ApiResponse(200, enhancedConversations, "Conversations retrieved successfully")
//     );
// });

// const getMessages = asyncHandler(async (req, res) => {
//     const { conversationId } = req.params;
//     const userId = req.user._id;
//     const { currentRole, page = 1, limit = 20 } = req.query;

//     // Validate inputs
//     if (!mongoose.Types.ObjectId.isValid(conversationId)) {
//         return res.status(400).json(new ApiError(400, "Invalid conversation ID"));
//     }

//     // Verify user is part of conversation in this role
//     const conversation = await Conversation.findById(conversationId);
//     if (!conversation || !conversation.participants.some(
//         p => p.user.toString() === userId.toString() && p.role === currentRole
//     )) {
//         return res.status(403).json(new ApiError(403, "Unauthorized access to this conversation"));
//     }

//     // Find other participant
//     const otherParticipant = conversation.participants.find(
//         p => p.user.toString() !== userId.toString()
//     );

//     if (!otherParticipant) {
//         return res.status(400).json(new ApiError(400, "Invalid conversation participants"));
//     }

//     // Get messages with pagination
//     let messages = await Message.find({
//         $or: [
//             {
//                 sender: userId,
//                 senderRole: currentRole,
//                 recipient: otherParticipant.user,
//                 recipientRole: otherParticipant.role
//             },
//             {
//                 sender: otherParticipant.user,
//                 senderRole: otherParticipant.role,
//                 recipient: userId,
//                 recipientRole: currentRole
//             }
//         ]
//     })
//     .populate('sender', 'firstName lastName profileImage email')
//     .populate('recipient', 'firstName lastName profileImage email')
//     .sort({ createdAt: -1 })
//     .skip((page - 1) * limit)
//     .limit(parseInt(limit));

//     // Identify messages that need to be marked as read
//     const messagesToMarkAsRead = messages.filter(msg =>
//         msg.recipient._id.toString() === userId.toString() &&
//         msg.recipientRole === currentRole &&
//         !msg.isRead
//     );

//     // If there are messages to mark as read
//     if (messagesToMarkAsRead.length > 0) {
//         const messageIds = messagesToMarkAsRead.map(msg => msg._id);
//         const now = new Date();

//         // Update messages in database
//         await Message.updateMany(
//             { _id: { $in: messageIds } },
//             { $set: { isRead: true, readAt: now } }
//         );

//         // Update the messages array with new read status
//         messages = messages.map(msg => {
//             if (messageIds.includes(msg._id)) {
//                 return {
//                     ...msg.toObject(),
//                     isRead: true,
//                     readAt: now
//                 };
//             }
//             return msg;
//         });

//     }

//     return res.status(200).json(
//         new ApiResponse(200, {
//             messages,
//             pagination: {
//                 page: parseInt(page),
//                 limit: parseInt(limit),
//                 totalMessages: messages.length
//             },
//             conversationId,
//             otherParticipant: {
//                 _id: otherParticipant.user,
//                 role: otherParticipant.role
//             }
//         }, "Messages retrieved successfully")
//     );
// });

const sendMessage = asyncHandler(async (req, res) => {
  const { recipientId, content, file } = req.body;
  const senderId = req.user._id;

  // Check if conversation exists
  let conversation = await Conversation.findOne({
    participants: { $all: [senderId, recipientId] },
  });

  if (!conversation) {
    conversation = await Conversation.create({
      participants: [senderId, recipientId],
    });
  }

  // Create message
  const message = await Message.create({
    sender: senderId,
    recipient: recipientId,
    content,
    attachment: file
      ? {
          url: file.path,
          fileType: file.mimetype,
          fileName: file.originalname,
        }
      : undefined,
  });

  // Update conversation
  conversation.lastMessage = message._id;
  await conversation.save();

  const populatedMessage = await Message.findById(message._id)
    .populate("sender", "firstName lastName profileImage email")
    .populate("recipient", "firstName lastName profileImage email");

  const responseMessage = populatedMessage.toObject(); 
  responseMessage.conversationId = conversation._id; 

  return res
    .status(201)
    .json(new ApiResponse(201, responseMessage, "Message sent successfully"));
});

const getUserConversations = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { search } = req.query;

  // Get all conversations for current user
  let conversations = await Conversation.find({
    participants: userId,
  })
    .populate({
      path: "participants",
      select: "firstName lastName profileImage email",
      match: { _id: { $ne: userId } },
    })
    .populate("lastMessage")
    .lean();

  // Filter and enhance with otherParticipant
  let enhancedConversations = conversations
    .filter((conv) =>
      conv.participants.some((p) => p && p._id.toString() !== userId.toString())
    )
    .map((conv) => {
      const otherParticipant = conv.participants.find(
        (p) => p._id.toString() !== userId.toString()
      );
      return {
        ...conv,
        otherParticipant,
      };
    });

  // Get unread counts for each conversation
  enhancedConversations = await Promise.all(
    enhancedConversations.map(async (conv) => {
      const unreadCount = await Message.countDocuments({
        recipient: userId,
        sender: conv.otherParticipant._id,
        isRead: false,
      });
      return {
        ...conv,
        unreadCount,
      };
    })
  );

  // Apply search filter if provided
  if (search) {
    const searchRegex = new RegExp(search, "i");
    enhancedConversations = enhancedConversations.filter((conv) => {
      return (
        searchRegex.test(conv.otherParticipant.firstName) ||
        searchRegex.test(conv.otherParticipant.lastName) ||
        searchRegex.test(conv.otherParticipant.email)
      );
    });
  }

  // Sort by most recent message
  enhancedConversations.sort(
    (a, b) =>
      new Date(b.lastMessage?.createdAt || 0) -
      new Date(a.lastMessage?.createdAt || 0)
  );

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        enhancedConversations,
        "Conversations retrieved successfully"
      )
    );
});

const getMessages = asyncHandler(async (req, res) => {
  const { conversationId } = req.query;
  const userId = req.user._id;
  const { page = 1, limit = 20 } = req.query;

  // Validate inputs
  if (!mongoose.Types.ObjectId.isValid(conversationId)) {
    return res.status(400).json(new ApiError(400, "Invalid conversation ID"));
  }

  // Verify user is part of conversation
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || !conversation.participants.includes(userId)) {
    return res
      .status(403)
      .json(new ApiError(403, "Unauthorized access to this conversation"));
  }

  // Find other participant
  const otherParticipant = conversation.participants.find(
    (p) => p.toString() !== userId.toString()
  );

  if (!otherParticipant) {
    return res
      .status(400)
      .json(new ApiError(400, "Invalid conversation participants"));
  }

  // Get messages with pagination
  let messages = await Message.find({
    $or: [
      { sender: userId, recipient: otherParticipant },
      { sender: otherParticipant, recipient: userId },
    ],
  })
    .populate("sender", "firstName lastName profileImage email")
    .populate("recipient", "firstName lastName profileImage email")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  // // Identify messages that need to be marked as read
  // const messagesToMarkAsRead = messages.filter(msg =>
  //     msg.recipient._id.toString() === userId.toString() &&
  //     !msg.isRead
  // );

  // // If there are messages to mark as read
  // if (messagesToMarkAsRead.length > 0) {
  //     const messageIds = messagesToMarkAsRead.map(msg => msg._id);
  //     const now = new Date();

  //     // Update messages in database
  //     await Message.updateMany(
  //         { _id: { $in: messageIds } },
  //         { $set: { isRead: true, readAt: now } }
  //     );

  //     // Update the messages array with new read status
  //     messages = messages.map(msg => {
  //         if (messageIds.includes(msg._id)) {
  //             return {
  //                 ...msg.toObject(),
  //                 isRead: true,
  //                 readAt: now
  //             };
  //         }
  //         return msg;
  //     });
  // }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        messages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalMessages: messages.length,
        },
        conversationId,
        otherParticipant: otherParticipant,
      },
      "Messages retrieved successfully"
    )
  );
});

const getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { currentRole, page = 1, limit = 10, markAsRead = false } = req.query;

  // Validate role
  if (!["guest", "host", "admin"].includes(currentRole)) {
    return res.status(400).json(new ApiResponse(400, null, "Invalid role"));
  }

  // Build base query
  const query = {
    "recipient.user": userId,
    "recipient.role": currentRole,
  };

  // Get total count for pagination
  const totalCount = await Notification.countDocuments(query);

  // Get notifications
  let notifications = await Notification.find(query)
    .populate("sender", "firstName lastName profileImage")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  // Mark as read if requested
  if (markAsRead === "true") {
    const notificationIds = notifications.map((n) => n._id);
    await Notification.updateMany(
      { _id: { $in: notificationIds } },
      { $set: { isRead: true, readAt: new Date() } }
    );

    // Update the notifications array
    notifications = notifications.map((n) => ({
      ...n.toObject(),
      isRead: true,
      readAt: new Date(),
    }));
  }

  // Get unread count
  const unreadCount = await Notification.countDocuments({
    ...query,
    isRead: false,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        notifications,
        pagination: {
          totalCount,
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / limit),
          itemsPerPage: parseInt(limit),
        },
        unreadCount,
      },
      "Notifications retrieved successfully"
    )
  );
});

const markNotificationAsRead = asyncHandler(async (req, res) => {
  const { notificationId } = req.params;
  const userId = req.user._id;

  const notification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      "recipient.user": userId,
    },
    {
      $set: {
        isRead: true,
        readAt: new Date(),
      },
    },
    { new: true }
  );

  if (!notification) {
    return res
      .status(404)
      .json(new ApiResponse(404, null, "Notification not found"));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, notification, "Notification marked as read"));
});

const updateVendor = asyncHandler(async (req, res) => {
  const updateData = req.body;

  try {
    // Check if vendor exists
    const existingVendor = await Vendor.findOne({ userId: req.user._id });
    if (!existingVendor) {
      return res.status(404).json(new ApiError(404, "Vendor not found"));
    }

    // Validate vendor type cannot be changed
    if (
      updateData.vendorType &&
      updateData.vendorType !== existingVendor.vendorType
    ) {
      return res
        .status(400)
        .json(
          new ApiError(400, "Vendor type cannot be changed after creation")
        );
    }

    // Individual vendor specific validations
    if (existingVendor.vendorType === "individual") {
      if (updateData.businessInfo) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "Business info not allowed for individual vendors"
            )
          );
      }
      if (
        updateData.personalInfo?.alternatePhoneNumber &&
        !/^\d{10}$/.test(updateData.personalInfo.alternatePhoneNumber)
      ) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid alternate phone number format"));
      }
    }

    // Business vendor specific validations
    if (existingVendor.vendorType === "business") {
      if (updateData.personalInfo) {
        return res
          .status(400)
          .json(
            new ApiError(400, "Personal info not allowed for business vendors")
          );
      }
      if (
        updateData.businessInfo?.businessPhoneNumber &&
        !/^[\d\s-]+$/.test(updateData.businessInfo.businessPhoneNumber)
      ) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid business phone number format"));
      }
    }

    // Common validations
    if (updateData.phoneNumber && !/^\d{10}$/.test(updateData.phoneNumber)) {
      return res
        .status(400)
        .json(new ApiError(400, "Invalid phone number format"));
    }

    if (updateData.pinCode && !/^\d{6}$/.test(updateData.pinCode)) {
      return res.status(400).json(new ApiError(400, "Invalid pin code format"));
    }

    // Banking details validation
    if (updateData.bankingDetails) {
      const {
        preferredPaymentMode,
        holderName,
        bankName,
        accountNumber,
        ifscCode,
        upiId,
      } = updateData.bankingDetails;
      if (preferredPaymentMode === "bankTransfer") {
        if (
          (accountNumber || ifscCode) &&
          (!holderName || !bankName || !accountNumber || !ifscCode)
        ) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Holder name, bank name, account number and IFSC code are all required for bank transfers"
              )
            );
        }
      }

      if (preferredPaymentMode === "upi") {
        if (!upiId) {
          return res
            .status(400)
            .json(new ApiError(400, "UPI ID is required for UPI transfers"));
        }
      }

      if (upiId && !/^[\w.-]+@[\w]+$/.test(upiId)) {
        return res.status(400).json(new ApiError(400, "Invalid UPI ID format"));
      }
    }

    if (updateData.pricing) {
      const { discountCodeId, refundPolicyId } = updateData.pricing;

      if (discountCodeId) {
        const discountCode = await VendorDiscountCode.findOne({
          _id: discountCodeId,
        });
        if (!discountCode) {
          return res
            .status(400)
            .json(new ApiError(400, "Invalid discount code"));
        }
      }

      if (refundPolicyId) {
        const refundPolicy = await VendorRefundPolicy.findOne({
          _id: refundPolicyId,
        });
        if (!refundPolicy) {
          return res
            .status(400)
            .json(new ApiError(400, "Invalid refund policy"));
        }
      }
    }

    // Update vendor
    const updatedVendor = await Vendor.findOneAndUpdate(
      { userId: req.user._id },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    await createActivityLog({
      entityType: "Vendor",
      entityId: updatedVendor._id,
      userId: req.user._id,
      userRole: "guest",
      action: "update",
    });

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          updatedVendor,
          "Vendor profile updated successfully"
        )
      );
  } catch (error) {
    console.error("Vendor update error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const uploadImages = asyncHandler(async (req, res) => {
  // First, collect all files from all fields
  let allFiles = [];

  if (req.files) {
    // req.files is an object where each key contains an array of files
    Object.values(req.files).forEach((fieldFiles) => {
      if (Array.isArray(fieldFiles)) {
        allFiles = allFiles.concat(fieldFiles);
      } else {
        // In case single file was uploaded (unlikely with .array(), but good practice)
        allFiles.push(fieldFiles);
      }
    });
  }

  if (allFiles.length === 0) {
    throw new ApiError(400, "No files were uploaded.");
  }

  // Process file data
  const processFile = (file) => {
    const originalName = file.originalname;
    const fileName = file.filename;
    const mimeType = file.mimetype;
    const extension = path.extname(originalName).toLowerCase();
    const url = `/temp/${fileName}`;

    return {
      originalName,
      fileName,
      mimeType,
      extension,
      url,
    };
  };

  // Prepare response data
  let responseData;
  if (allFiles.length === 1) {
    // Single file response
    responseData = processFile(allFiles[0]);
  } else {
    // Multiple files response as array
    responseData = allFiles.map((file) => processFile(file));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, responseData, "Files uploaded successfully"));
});

const vendorAccount = asyncHandler(async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ userId: req.user._id })
      .populate({
        path: "serviceCategories",
        model: "ConciergeService",
      })
      .populate({
        path: "pricing.discountCodeId",
        model: "VendorDiscountCode",
      })
      .populate({
        path: "pricing.refundPolicyId",
        model: "VendorRefundPolicy",
      })
      .lean(); // Convert to plain JavaScript object

    if (!vendor) {
      return res.status(404).json(new ApiError(404, "Vendor not found"));
    }

    return res
      .status(200)
      .json(
        new ApiResponse(200, vendor, "Vendor account retrieved successfully")
      );
  } catch (error) {
    console.error("Error fetching vendor account:", error);
    return res
      .status(500)
      .json(
        new ApiError(500, "An error occurred while fetching vendor account")
      );
  }
});

const myAccount = asyncHandler(async (req, res) => {
  if (!req.user?._id) {
    return res.status(400).json(new ApiError(400, "User not found"));
  }
  const user = await User.findById(req.user._id).select(
    "-password -refreshToken -accessToken -socialAuth"
  );
  if (!user) {
    return res.status(400).json(new ApiError(400, "User not found"));
  }

  const now = new Date();
  const eventsToUpdate = await Event.find({
    status: "upcoming",
    $or: [
      { endDate: { $lt: now } },
      {
        endDate: {
          $lte: new Date(now.toISOString().split("T")[0]),
        },
        endTime: { $exists: true, $ne: "" },
        $expr: {
          $lt: [
            {
              $dateFromString: {
                dateString: {
                  $concat: [{ $substr: ["$endDate", 0, 10] }, "T", "$endTime"],
                },
              },
            },
            now,
          ],
        },
      },
    ],
  }).select("_id");

  if (eventsToUpdate.length > 0) {
    await Event.updateMany(
      { _id: { $in: eventsToUpdate.map((e) => e._id) } },
      { $set: { status: "completed" } }
    );
  }
  return res
    .status(200)
    .json(new ApiResponse(200, user, "User account retrieved successfully"));
});

const subscribeNewsletter = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json(new ApiError(400, "Email is required"));
  }

  // Check if already subscribed
  const existingSubscriber = await Newsletter.findOne({ email });

  if (existingSubscriber) {
    if (existingSubscriber.isSubscribed) {
      return res
        .status(400)
        .json(new ApiError(400, "This email is already subscribed"));
    }
    // Resubscribe if previously unsubscribed
    existingSubscriber.isSubscribed = true;
    existingSubscriber.unsubscribedAt = undefined;
    await existingSubscriber.save();
    return res
      .status(200)
      .json(
        new ApiResponse(200, existingSubscriber, "Resubscribed successfully")
      );
  }

  // Create new subscription
  const subscriber = await Newsletter.create({ email });

  return res
    .status(201)
    .json(
      new ApiResponse(201, subscriber, "Subscribed to newsletter successfully")
    );
});

const addComingSoonEmail = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json(new ApiError(400, "Email is required"));
  }

  // Check if email already exists
  const existingEmail = await ComingSoon.findOne({ email });
  if (existingEmail) {
    return res.status(400).json(new ApiError(400, "Email already registered"));
  }

  // Save new email (pre-save hook will handle first 100 logic)
  const newEntry = await ComingSoon.create({ email });

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        email: newEntry.email,
        isFirst100: newEntry.isFirst100,
        position: newEntry.position,
        message: newEntry.isFirst100
          ? "You're among the first 100! You'll receive a surprise offer."
          : "Thank you for your interest!",
      },
      "Email added successfully"
    )
  );
});

const createTicket = asyncHandler(async (req, res) => {
  const { category, title, initialMessage } = req.body;

  if (!category || !title || !initialMessage) {
    return res
      .status(400)
      .json(
        new ApiError(400, "Category, title and initial message are required")
      );
  }

  if (
    !["account", "payments", "bookings", "technical", "other"].includes(
      category
    )
  ) {
    return res.status(400).json(new ApiError(400, "Invalid category"));
  }

  const ticket = await HelpCenter.create({
    user: req.user._id,
    category,
    title,
    initialMessage,
    messages: [
      {
        sender: "user",
        senderId: req.user._id,
        message: initialMessage,
      },
    ],
    lastRepliedBy: "user",
    unreadCount: { admin: 1 },
  });

  return res
    .status(201)
    .json(new ApiResponse(201, ticket, "Ticket created successfully"));
});

const getAllTickets = asyncHandler(async (req, res) => {
  const tickets = await HelpCenter.find({ user: req.user._id })
    .sort({ updatedAt: -1 })
    .select("-messages");

  return res
    .status(200)
    .json(new ApiResponse(200, { tickets }, "Tickets fetched successfully"));
});

const getTicketConversation = asyncHandler(async (req, res) => {
  const { ticketId } = req.params;
  const { page = 1, limit = 30 } = req.query;

  // Validate inputs
  const pageNum = Math.max(1, parseInt(page)) || 1;
  const limitNum = Math.min(50, Math.max(1, parseInt(limit))) || 30;

  // Get ticket with paginated messages
  const ticket = await HelpCenter.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(ticketId),
        user: new mongoose.Types.ObjectId(req.user._id),
      },
    },
    {
      $addFields: {
        totalMessages: { $size: "$messages" },
        paginatedMessages: {
          $slice: [
            {
              $reverseArray: "$messages", // Show latest first
            },
            (pageNum - 1) * limitNum,
            limitNum,
          ],
        },
      },
    },
    {
      $project: {
        ticketId: 1,
        user: 1,
        category: 1,
        title: 1,
        status: 1,
        priority: 1,
        unreadCount: 1,
        createdAt: 1,
        updatedAt: 1,
        totalMessages: 1,
        messages: "$paginatedMessages",
      },
    },
  ]);

  if (!ticket || ticket.length === 0) {
    throw new ApiError(404, "Ticket not found or unauthorized");
  }

  // Mark messages as read
  await HelpCenter.updateOne(
    { _id: ticketId },
    { $set: { "unreadCount.user": 0 } }
  );

  const result = ticket[0];
  const totalPages = Math.ceil(result.totalMessages / limitNum);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ticket: result,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalMessages: result.totalMessages,
          messagesPerPage: limitNum,
          hasNextPage: pageNum < totalPages,
        },
      },
      "Ticket conversation fetched successfully"
    )
  );
});

const addTicketMessage = asyncHandler(async (req, res) => {
  const { ticketId } = req.params;
  const { message } = req.body;

  if (!ticketId) {
    return res.status(400).json(new ApiError(400, "Ticket ID is required"));
  }

  if (!mongoose.Types.ObjectId.isValid(ticketId)) {
    return res.status(400).json(new ApiError(400, "Invalid ticket ID"));
  }
  /// yaha check hoga ki bot se chat cl rhi hai ya admin se

  const ticket = await HelpCenter.findOneAndUpdate(
    {
      _id: ticketId,
      user: req.user._id,
      status: { $ne: "closed" },
    },
    {
      $push: {
        messages: {
          sender: "user",
          senderId: req.user._id,
          message,
        },
      },
      $set: { lastRepliedBy: "user" },
      $inc: { "unreadCount.admin": 1 },
      status: "in-progress",
    },
    { new: true }
  );

  if (!ticket) {
    return res
      .status(404)
      .json(new ApiError(404, "Ticket not found or closed"));
  }

  try {
    /// get user data
    const user = await User.findById(req.user._id).select(
      "firstName lastName profileImage"
    );
    // Emit socket event to relevant rooms
    const io = getIO();

    // Emit to admin room
    io.to(`ticket_${ticket._id}`)
      .to("admin")
      .emit("ticketMessage", {
        ticketId: ticket._id,
        message: ticket.messages[ticket.messages.length - 1],
        user,
      });

    io.to("admin").emit("ticketList", {
      ticketId: ticket._id,
    });
  } catch (socketError) {
    console.error("Socket emit error:", socketError);
    // Don't fail the request if socket fails
  }

  return res
    .status(200)
    .json(new ApiResponse(200, ticket, "Message added successfully"));
});

const supportQuestion = asyncHandler(async (req, res) => {
  try {
    const faqs = await SupportFaq.find({ parentQuestion: null })
      .sort({ createdAt: 1 })
      .select("_id question");
    if (faqs.length === 0) {
      return res.status(404).json(new ApiError(404, "No FAQs found"));
    }
    return res
      .status(200)
      .json(new ApiResponse(200, faqs, "FAQs fetched successfully"));
  } catch (error) {
    return res.status(500).json(new ApiError(500, "Internal server error"));
  }
});

const supportConversations = asyncHandler(async (req, res) => {
  try {
    const { questionId } = req.body;

    if (!questionId) {
      return res.status(400).json(new ApiError(400, "Question ID is required"));
    }

    const question = await SupportFaq.findById(questionId);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    await SupportConversation.create({
      userId: req.user?._id,
      questionId,
      questionText: question.question,
      answerText: question.answer,
    });

    const suggestions = await SupportFaq.find({
      _id: { $in: question.suggestQuestions },
    }).select("_id question");

    const isSuggestion = suggestions.length == 0 ? false : true;

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { answer: question.answer, suggestions, isSuggestion },
          "Suggestions fetched successfully"
        )
      );
  } catch (error) {
    console.log(error);
    return res.status(500).json(new ApiError(500, "Internal server error"));
  }
});

const vendorCodeAndPolicy = asyncHandler(async (req, res) => {
  try {
    const discountCode = await VendorDiscountCode.find({ status: true }).lean();
    const refundPolicy = await VendorRefundPolicy.find({ status: true }).lean();

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { discountCode, refundPolicy },
          "Discount Code and Refund Policy fetched successfully"
        )
      );
  } catch (error) {
    console.log(error);
    return res.status(500).json(new ApiError(500, "Internal server error"));
  }
});

const getPages = asyncHandler(async (req, res) => {
  try {
    const { slug } = req.params;
    const page = await Pages.findOne({ slug }).select(
      "title slug subtitle content _id"
    );
    if (!page) return res.status(400).json(new ApiError(500, "Page not found"));
    return res
      .status(200)
      .json(new ApiResponse(200, page, "Page fetched successfully"));
  } catch (error) {
    console.log(error);
    return res.status(500).json(new ApiError(500, "Internal server error"));
  }
});

const getSetting = asyncHandler(async (req, res) => {
  try {
    const setting = await Setting.findOne();
    return res
      .status(200)
      .json(new ApiResponse(200, setting, "Setting fetched successfully"));
  } catch (error) {
    console.log(error);
    return res.status(500).json(new ApiError(500, "Internal server error"));
  }
});

const getWalletDetails = asyncHandler(async (req, res) => {
  const {
    userId,
    role,
    transactionType,
    bookingType,
    page = 1,
    limit = 10,
  } = req.query;

  if (!userId || !role) {
    return res
      .status(400)
      .json(new ApiError(400, "userId and role are required"));
  }

  // --- Get or create wallet
  let wallet = await Wallet.findOne({ userId, userRole: role });
  if (!wallet) {
    wallet = await Wallet.create({ userId, userRole: role });
  }

  // --- Filters
  const filter = { walletId: wallet._id };
  if (transactionType) filter.transactionType = transactionType;
  if (bookingType) filter.bookingType = bookingType;

  // --- Pagination & sort
  const skip = (page - 1) * limit;
  const sortOptions = { createdAt: -1 };

  // --- Aggregate transactions with booking info (only _id, name, amount)
  let transactionsQuery = WalletTransaction.aggregate([
    { $match: filter },
    { $sort: sortOptions },

    // Lookup property booking (only _id, name, amount)
    {
      $lookup: {
        from: "bookings",
        localField: "bookingId",
        foreignField: "_id",
        pipeline: [{ $project: { _id: 1, bookingId: 1 } }],
        as: "propertyBooking",
      },
    },

    // Lookup event booking (only _id, name, amount)
    {
      $lookup: {
        from: "bookingevents",
        localField: "bookingId",
        foreignField: "_id",
        pipeline: [{ $project: { _id: 1, bookingId: 1 } }],
        as: "eventBooking",
      },
    },

    // Merge booking info based on type
    {
      $addFields: {
        bookingDetails: {
          $cond: [
            { $eq: ["$bookingType", "property"] },
            { $arrayElemAt: ["$propertyBooking", 0] },
            { $arrayElemAt: ["$eventBooking", 0] },
          ],
        },
      },
    },

    { $project: { propertyBooking: 0, eventBooking: 0 } },
    { $skip: skip },
    { $limit: parseInt(limit) },
  ]);

  const transactions = await transactionsQuery.exec();

  // --- Total count for pagination
  const totalTransactions = await WalletTransaction.countDocuments(filter);

  // --- Response like Booking API
  const responseData = {
    wallet,
    transactions,
    pagination: {
      total: totalTransactions,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(totalTransactions / limit),
    },
  };

  return res
    .status(200)
    .json(
      new ApiResponse(200, responseData, "Wallet details fetched successfully")
    );
});

const uploadAndScreenRealEstateImages = asyncHandler(async (req, res) => {
  // Collect files from multer (supports array/fields)
  let files = [];
  if (Array.isArray(req.files)) {
    files = req.files;
  } else if (req.files && typeof req.files === "object") {
    for (const v of Object.values(req.files)) {
      if (Array.isArray(v)) files.push(...v);
      else files.push(v);
    }
  }

  if (!files.length) {
    return res
      .status(400)
      .json(
        new ApiError(400, "No files were uploaded", [
          "Upload at least one image",
        ])
      );
  }

  // Evaluate all files first; only persist if ALL pass
  const results = [];

  for (const file of files) {
    const filePath = file.path; // full path from multer
    try {
      const [anno] = await client.annotateImage({
        image: { source: { filename: filePath } },
        features: [
          { type: "SAFE_SEARCH_DETECTION" }, // strict moderation first
          { type: "LABEL_DETECTION", maxResults: 15 },
          { type: "TEXT_DETECTION" },
          { type: "WEB_DETECTION" },
          { type: "OBJECT_LOCALIZATION", maxResults: 10 },
        ],
      });

      const labels = (anno.labelAnnotations || []).map((l) => ({
        description: l.description,
        score: l.score,
      }));

      // 1) Safety gate
      const safety = isImageSafe({
        safeSearch: anno.safeSearchAnnotation,
        labels,
      });
      if (!safety.ok) {
        results.push({
          originalName: file.originalname,
          fileName: file.filename,
          mimeType: file.mimetype,
          size: file.size,
          accepted: false,
          reason: safety.reason,
          url: null, // we will only add URLs on full success
          ...(process.env.NODE_ENV === "development"
            ? { safeSearch: summarizeSafeSearch(anno.safeSearchAnnotation) }
            : {}),
        });
        continue;
      }

      // 2) Real-estate classification
      const webEntities = (anno.webDetection?.webEntities || []).map((w) => ({
        description: w.description,
        score: w.score,
      }));
      const ocrText = (anno.fullTextAnnotation?.text || "").trim();
      const objects = (anno.localizedObjectAnnotations || []).map((o) => ({
        name: o.name,
        score: o.score,
      }));

      const verdict = isHomeRelated({ labels, webEntities, ocrText, objects });

      results.push({
        originalName: file.originalname,
        fileName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        // NOTE: Do NOT set URL yet; we only expose URLs if ALL pass.
        url: null,
        accepted: verdict.ok,
        reason: verdict.ok
          ? verdict.reason
          : "Insufficient home-related evidence",
        labels,
        ...(process.env.NODE_ENV === "development"
          ? {
              webEntities,
              ocrPreview: ocrText?.slice(0, 140),
              objects,
              safeSearch: summarizeSafeSearch(anno.safeSearchAnnotation),
            }
          : {}),
      });
    } catch (err) {
      results.push({
        originalName: file.originalname,
        fileName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        url: null,
        accepted: false,
        reason: "Vision API error",
        error: process.env.NODE_ENV === "development" ? String(err) : undefined,
      });
    }
  }

  const hasAnyFailure = results.some((r) => !r.accepted);

  if (hasAnyFailure) {
    // Atomic rollback: delete ALL uploaded files for this request
    await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => {})));

    // Optional: include which files failed in the error array
    const failedFiles = results
      .filter((r) => !r.accepted)
      .map((r) => `${r.originalName}: ${r.reason}`);

    return res
      .status(400)
      .json(
        new ApiError(
          400,
          "One or more images failed validation; none were uploaded",
          failedFiles.length ? failedFiles : ["Validation failed"]
        )
      );
  }

  // All good → now safely expose URLs for every file
  const filesWithUrls = results.map((r) => ({
    ...r,
    url: `/temp/${r.fileName}`,
  }));

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        summary: {
          total: filesWithUrls.length,
          accepted: filesWithUrls.length,
          rejected: 0,
        },
        files: filesWithUrls,
      },
      "Images processed"
    )
  );
});



export {
  profileUpdate,
  propertyTypeList,
  eventCategoryList,
  getConciergeServicesList,
  amenityList,
  homePage,
  getFaqs,
  searchProperties,
  propertyDetails,
  getEventList,
  getEventDetails,
  getContactEnquiryType,
  saveContactEnquiry,
  sendMessage,
  getUserConversations,
  getMessages,
  getNotifications,
  markNotificationAsRead,
  updateVendor,
  uploadImages,
  vendorAccount,
  myAccount,
  subscribeNewsletter,
  addComingSoonEmail,
  createTicket,
  getAllTickets,
  getTicketConversation,
  addTicketMessage,
  supportQuestion,
  supportConversations,
  vendorCodeAndPolicy,
  getPages,
  getSetting,
  getWalletDetails,
  uploadAndScreenRealEstateImages,
  priceCalculation,
  getpropertyCalendar,
};
