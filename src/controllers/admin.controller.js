import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import fs from "fs";
import mongoose from "mongoose";
import bcrypt from "bcrypt";

import { User } from "../models/user.model.js";
import { PropertyType } from "../models/PropertyType.model.js";
import { EventCategory } from "../models/EventCategory.model.js";
import { Property } from "../models/Property.model.js";
import { PropertyCalendar } from "../models/PropertyCalendar.model.js";
import { PropertyRating } from "../models/PropertyRating.model.js";
import { TransactionLog } from "../models/TransactionLog.model.js";
import { Wallet, WalletTransaction } from "../models/Wallet.model.js";
import { Booking } from "../models/Booking.model.js";
import {
  Vendor,
  VendorRefundPolicy,
  VendorDiscountCode,
} from "../models/Vendor.model.js";
import { Amenity, AmenityRequest } from "../models/Amenity.model.js";
import {
  ContactEnquiry,
  ContactEnquiryType,
} from "../models/ContactEnquiry.model.js";
import { ConciergeService } from "../models/ConciergeService.model.js";
import { BookingService } from "../models/BookingService.model.js";
import { Event } from "../models/Event.model.js";
import { BookingEvent } from "../models/BookingEvent.model.js";
import { EventRating } from "../models/EventRating.model.js";
import { Setting, FAQ } from "../models/Setting.model.js";
import { Pages } from "../models/Pages.model.js";
import { Notification } from "../models/Notification.model.js";
import { Newsletter, ComingSoon } from "../models/Newsletter.model.js";
import { Permission, AdminRoles } from "../models/Permission.model.js";
import { HelpCenter } from "../models/HelpCenter.model.js";
import { SupportFaq } from "../models/Support.js";
import { UberBooking } from "../models/UberBooking.model.js";
import { createNotification } from "../utils/notification.helper.js";
import { seedPropertyCalendar,  repriceFutureCalendarWindow} from "../utils/calendar.js";
import { createActivityLog, eventComplete, propertyComplete} from "../utils/activityLog.helper.js";
import Stripe from "stripe";
import _ from "mongoose-sequence";

// import { console } from "inspector";

const generateAccessAndRefereshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    throw new ApiError(
      500,
      "Something went wrong while generating referesh and access token"
    );
  }
};

//// ------------- Auth Start -------------------------////

const showLoginPage = asyncHandler(async (req, res) => {
  const { accessToken } = req.cookies;

  if (!accessToken) {
    // No token, show login
    return res.render("pages/admin/auth/login");
  }

  try {
    const decoded = jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET);
    const user = await User.findById(decoded);

    if (user && user.roles.includes("admin")) {
      return res.redirect("/");
    }

    // If not admin or not found
    return res.render("pages/admin/auth/login");
  } catch (error) {
    // Token invalid or expired
    return res.render("pages/admin/auth/login");
  }
});

const loginAdmin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, error: "Email and password are required." });
  }

  try {
    const user = await User.findOne({ email });

    if (!user || !user.roles.includes("admin")) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials or insufficient privileges.",
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: "Account is not active. Please contact admin.",
      });
    }

    const isPasswordValid = await user.isPasswordCorrect(password);
    if (!isPasswordValid) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid password." });
    }

    await createActivityLog({
      entityType: "User",
      entityId: user._id,
      userId: user._id,
      userRole: "admin",
      action: "login",
    });

    const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(
      user._id
    );

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    };
    res
      .status(200)
      .cookie("accessToken", accessToken, cookieOptions)
      .cookie("refreshToken", refreshToken, cookieOptions)
      .json({ success: true, message: "Login successful", redirect: "/" });
  } catch (error) {
    console.error("Error during login:", error);
    return res.status(500).json({
      success: false,
      error: "An unexpected error occurred. Please try again.",
    });
  }
});

const logoutAdmin = asyncHandler(async (req, res) => {
  await createActivityLog({
    entityType: "User",
    entityId: req.admin._id,
    userId: req.admin._id,
    userRole: "admin",
    action: "logout",
  });

  await User.findByIdAndUpdate(
    req.admin._id,
    {
      $unset: {
        refreshToken: 1,
      },
    },
    {
      new: true,
    }
  );

  const options = { httpOnly: true, secure: false };
  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .redirect("/");
});

const showForgotPasswordPage = asyncHandler(async (req, res) => {
  try {
    return res.render("pages/admin/auth/forgotpassword", {
      error: null,
      success: null,
    });
  } catch (error) {
    console.log(error);
    // return res.render("pages/login", { error: null,success: null });
  }
});

const handleForgotPassword = asyncHandler(async (req, res) => {
  try {
    const { email } = req.body;

    // Basic validation
    if (!email) {
      return res.status(400).json({
        error: "Email is required",
      });
    }

    const user = await User.findOne({ email: email });

    if (!user) {
      return res.status(404).json({
        error: "Email not found",
      });
    }

    if (!user.roles.includes("admin")) {
      return res.status(403).json({
        error: "This email is not associated with an admin account",
      });
    }

    // Generate a password reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
    await user.save();

    // Prepare email
    const resetUrl = `${req.protocol}://${req.get(
      "host"
    )}/reset-password/${resetToken}`;

    const emailVariables = {
      emailTitle: "Password Reset Request",
      emailGreeting: `Hello, Admin`,
      emailBody: `You requested a password reset. Please click the link below to reset your password:<br><br><a href="${resetUrl}">Reset Password</a><br><br>If you did not request this, please ignore this email.`,
      emailFooter: "Thank you.",
    };

    // In production, uncomment this to send the email
    // await sendEmail(email, 'Password Reset Request', emailVariables);
    console.log("Reset URL:", resetUrl);

    return res.status(200).json({
      success: "Password reset email sent. Please check your inbox.",
    });
  } catch (error) {
    console.error("Error in handleForgotPassword:", error);
    return res.status(500).json({
      error: "An error occurred while processing your request",
    });
  }
});

const showResetPasswordPage = asyncHandler(async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).render("pages/admin/auth/reset", {
        error: "Password reset token is invalid or has expired.",
        success: false,
        token: null,
      });
    }

    res.render("pages/admin/auth/reset", {
      email: user.email,
      token,
      success: null,
      error: null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).render("pages/admin/auth/reset", {
      error: "An error occurred while processing your request.",
      success: false,
      token: null,
    });
  }
});

const handleResetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;

  try {
    // Server-side validation
    if (password !== confirmPassword) {
      return res.status(400).json({
        error: "Passwords do not match",
      });
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        error: "Invalid or expired token",
      });
    }

    // Hash and update password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    await createActivityLog({
      entityType: "User",
      entityId: user._id,
      userId: user._id,
      userRole: "admin",
      action: "resetPassword",
    });

    return res.status(200).json({
      success: true,
      message:
        "Password reset successfully. You can now login with your new password.",
    });
  } catch (error) {
    console.error("Error resetting password:", error);
    return res.status(500).json({
      error: "An error occurred while resetting your password",
    });
  }
});

//// ------------- Auth End -------------------------////

const showDashboard = asyncHandler(async (req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const totalUsers = await User.countDocuments({});
  const todayUsers = await User.countDocuments({
    createdAt: { $gte: todayStart },
  });

  const verifiedUsers = await User.countDocuments({
    verificationStatus: "Verified",
  });

  await eventComplete();
  await propertyComplete();
  return res.render("pages/admin/dashboard", {
    sidebar: "dashboard",
    totalUsers,
    todayUsers,
    verifiedUsers,
  });
});

/// -------------  Profile Start -------------------------///

const getAdminProfile = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.admin._id);

    res.render("pages/admin/profile", {
      user,
      sidebar: "profile",
    });
  } catch (error) {
    console.error(error);
    res.status(500).render("500", { message: "Server error" });
  }
});

const updateAdminProfile = asyncHandler(async (req, res) => {
  const { firstName, lastName, mobile, address } = req.body;

  try {
    const adminData = await User.findById(req.admin._id);

    if (!adminData) {
      return res.status(404).json(new ApiResponse(404, [], "User not found"));
    }

    adminData.firstName = firstName || adminData.firstName;
    adminData.lastName = lastName || adminData.lastName;
    adminData.mobile = mobile || adminData.mobile;
    if (address) {
      const newAddress = {
        ...(adminData.address?.toObject?.() || {}),
        ...address,
      };

      adminData.address = newAddress;
    }

    await adminData.save();

    await createActivityLog({
      entityType: "User",
      entityId: req.admin._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "update",
    });

    return res
      .status(200)
      .json(new ApiResponse(200, adminData, "Profile updated successfully"));
  } catch (error) {
    console.error(error);
    return res
      .status(400)
      .json(new ApiResponse(400, [], "Something went wrong"));
  }
});

const updateAdminProfileImage = asyncHandler(async (req, res) => {
  try {
    const userId = req.admin._id;
    const adminData = await User.findById(userId);
    if (!adminData) {
      return res.status(404).json(new ApiResponse(404, [], "User not found"));
    }

    if (!req.file) {
      return res.status(400).json(new ApiResponse(400, [], "No file uploaded"));
    }
    const fileUrls = `/temp/${req.file.filename}`;
    adminData.profileImage = fileUrls;
    await adminData.save();

    await createActivityLog({
      entityType: "User",
      entityId: req.admin._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "imageUpdate",
    });

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { profileImage: fileUrls },
          "Profile image updated successfully"
        )
      );
  } catch (error) {
    return res
      .status(500)
      .json(
        new ApiResponse(500, [], "Server error while updating profile image")
      );
  }
});

const changeAdminPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  try {
    const userId = req.admin._id;
    const adminData = await User.findById(userId);

    const isPasswordCorrect = await adminData.isPasswordCorrect(oldPassword);
    if (!isPasswordCorrect) {
      return res
        .status(200)
        .json(new ApiResponse(400, [], "Old password is incorrect"));
    }

    adminData.password = newPassword;
    await adminData.save();

    await createActivityLog({
      entityType: "User",
      entityId: req.admin._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "passwordUpdate",
    });

    return res
      .status(200)
      .json(new ApiResponse(200, adminData, "Password updated successfully"));
  } catch (error) {
    console.log(error);
    return res.status(400).json(new ApiResponse(400, [], "something wrong"));
  }
});

/// -------------  Profile End -------------------------///

/// ----------------- User Management Start -----------------------////

const listGuest = asyncHandler(async (req, res) => {
  try {
    const { search, addressSearch, status, page = 1, limit = 10 } = req.query;

    // Convert page and limit to numbers
    const currentPage = parseInt(page);
    const itemsPerPage = parseInt(limit);

    // Base query
    let query = {
      roles: "guest",
      profileCompletionStatus: "complete",
    };

    // Helper function to create multiple search conditions
    const createMultipleSearchConditions = (searchString, fields) => {
      if (!searchString) return [];

      // Split by comma and trim whitespace
      const searchTerms = searchString
        .split(",")
        .map((term) => term.trim())
        .filter((term) => term.length > 0);

      const conditions = [];

      searchTerms.forEach((term) => {
        const termConditions = fields.map((field) => ({
          [field]: { $regex: term, $options: "i" },
        }));
        conditions.push({ $or: termConditions });
      });

      return conditions;
    };

    // Search across multiple fields with multiple terms
    if (search) {
      const searchFields = [
        "firstName",
        "lastName",
        "email",
        "mobile",
        "userId",
      ];
      const searchConditions = createMultipleSearchConditions(
        search,
        searchFields
      );

      if (searchConditions.length > 0) {
        query.$or = searchConditions;
      }
    }

    // Address search with multiple terms
    if (addressSearch) {
      const addressFields = [
        "address.street",
        "address.city",
        "address.state",
        "address.postalCode",
      ];
      const addressConditions = createMultipleSearchConditions(
        addressSearch,
        addressFields
      );

      if (addressConditions.length > 0) {
        const addressQuery = { $or: addressConditions };

        if (query.$or) {
          // If both search and addressSearch exist, combine them with $and
          query = {
            $and: [
              { roles: "guest", profileCompletionStatus: "complete" },
              { $or: query.$or },
              addressQuery,
            ],
          };
        } else {
          query = { ...query, ...addressQuery };
        }
      }
    }

    // Status filter
    if (status) {
      if (query.$and) {
        query.$and.push({ isActive: status === "active" });
      } else {
        query.isActive = status === "active";
      }
    }

    // Count total matching guests
    const totalGuests = await User.countDocuments(query);
    const totalPages = Math.ceil(totalGuests / itemsPerPage);

    // Get paginated results
    const guests = await User.find(query)
      .select("-password -refreshToken")
      .skip((currentPage - 1) * itemsPerPage)
      .limit(itemsPerPage)
      .sort({ createdAt: -1 })
      .lean();

    res.render("pages/admin/guest", {
      sidebar: "guest",
      guests,
      currentPage,
      totalPages,
      totalGuests,
      limit: itemsPerPage,
      filterValues: {
        ...req.query,
        page: currentPage,
        limit: itemsPerPage,
      },
    });
  } catch (error) {
    console.error("Error filtering guests:", error);
    res.redirect("/guest");
  }
});

const viewGuest = asyncHandler(async (req, res) => {
  try {
    const guest = await User.findById(req.params.id)
      .select("-password -refreshToken")
      .lean();

    if (!guest) {
      return res.redirect("/guest");
    }

    // Get all stats and activities in parallel
    const [propertyBookings, eventBookings, propertyRatings, eventRatings] =
      await Promise.all([
        // Property Bookings
        Booking.find({ guestId: req.params.id })
          .populate("propertyId", "name")
          .sort({ createdAt: -1 })
          .lean(),

        // Event Bookings
        BookingEvent.find({
          "bookingBy.user": req.params.id,
          "bookingBy.role": "guest",
        })
          .populate("event", "title image date status")
          .sort({ bookingDate: -1 })
          .lean(),

        // Property Ratings
        PropertyRating.find({ guestId: req.params.id })
          .populate("propertyId", "name")
          .populate("bookingId", "bookingId")
          .sort({ createdAt: -1 })
          .lean(),

        // Event Ratings
        EventRating.find({ userId: req.params.id })
          .populate("eventId", "title")
          .populate("bookingId", "bookingId")
          .sort({ createdAt: -1 })
          .lean(),
      ]);

    // Format stats
    const guestStats = {
      totalPropertyBookings: propertyBookings.length,
      totalEventBookings: eventBookings.length,
      totalPropertyRatings: propertyRatings.length,
      totalEventRatings: eventRatings.length,
    };

    res.render("pages/admin/guest/view", {
      sidebar: "guest",
      guest,
      guestStats,
      propertyBookings,
      eventBookings,
      propertyRatings,
      eventRatings
    });
  } catch (error) {
    console.error("Error in viewGuest:", error);
    res.redirect("/guest");
  }
});

const updateGuestStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const guest = await User.findById(id);

    if (!guest) {
      return res
        .status(404)
        .json({ success: false, message: "Guest not found" });
    }

    guest.isActive = !guest.isActive;
    await guest.save();

    await createActivityLog({
      entityType: "User",
      entityId: guest._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "status",
    });

    res.status(200).json({
      success: true,
      message: `Guest ${guest.isActive ? "activated" : "Blocked"}`,
      isActive: guest.isActive,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to update status",
    });
  }
});

const listHost = asyncHandler(async (req, res) => {
  try {
    const {
      search,
      addressSearch,
      kycSearch,
      verified,
      kycStatus,
      status,
      propertySearch,
      eventSearch,
      page = 1,
      limit = 10,
    } = req.query;

    // Convert page and limit to numbers
    const currentPage = parseInt(page);
    const itemsPerPage = parseInt(limit);

    // Base query
    let query = {
      roles: "host",
      profileCompletionStatus: "complete",
    };

    // Helper function to create multiple search conditions
    const createMultipleSearchConditions = (searchString, fields) => {
      if (!searchString) return [];

      // Split by comma and trim whitespace
      const searchTerms = searchString
        .split(",")
        .map((term) => term.trim())
        .filter((term) => term.length > 0);

      const conditions = [];

      searchTerms.forEach((term) => {
        const termConditions = fields.map((field) => ({
          [field]: { $regex: term, $options: "i" },
        }));
        conditions.push({ $or: termConditions });
      });

      return conditions;
    };

    // Search across multiple fields with multiple terms
    if (search) {
      const searchFields = [
        "firstName",
        "lastName",
        "email",
        "mobile",
        "userId",
      ];
      const searchConditions = createMultipleSearchConditions(
        search,
        searchFields
      );

      if (searchConditions.length > 0) {
        query.$or = searchConditions;
      }
    }

    // Address search with multiple terms
    if (addressSearch) {
      const addressFields = [
        "address.street",
        "address.city",
        "address.state",
        "address.postalCode",
      ];
      const addressConditions = createMultipleSearchConditions(
        addressSearch,
        addressFields
      );

      if (addressConditions.length > 0) {
        const addressQuery = { $or: addressConditions };

        if (query.$or) {
          // If both search and addressSearch exist, combine them with $and
          query = {
            $and: [
              { roles: "host", profileCompletionStatus: "complete" },
              { $or: query.$or },
              addressQuery,
            ],
          };
        } else {
          query = { ...query, ...addressQuery };
        }
      }
    }

    // KYC search with multiple terms
    if (kycSearch) {
      const kycFields = ["kyc.aadharNumber", "kyc.panNumber"];
      const kycConditions = createMultipleSearchConditions(
        kycSearch,
        kycFields
      );

      if (kycConditions.length > 0) {
        const kycQuery = { $or: kycConditions };

        if (query.$and) {
          query.$and.push(kycQuery);
        } else if (query.$or) {
          query = {
            $and: [
              { roles: "host", profileCompletionStatus: "complete" },
              { $or: query.$or },
              kycQuery,
            ],
          };
        } else {
          query = { ...query, ...kycQuery };
        }
      }
    }

    // Verified filter
    if (verified === "true") {
      query.hostVerified = true;
    } else if (verified === "false") {
      query.hostVerified = false;
    }

    // KYC status filter
    if (kycStatus === "true") {
      query.kycStatus = true;
    } else if (kycStatus === "false") {
      query.kycStatus = false;
    }

    // Status filter
    if (status) {
      query.isActive = status === "active";
    }

    // Property search filter with multiple terms
    if (propertySearch) {
      const propertyFields = [
        "name",
        "propertyId",
        "address.city",
        "address.state",
      ];
      const propertyConditions = createMultipleSearchConditions(
        propertySearch,
        propertyFields
      );

      let propertyQuery = {};
      if (propertyConditions.length > 0) {
        propertyQuery = { $or: propertyConditions };
      }

      const propertyHosts = await Property.find(propertyQuery).distinct(
        "owner"
      );

      if (query._id) {
        query._id.$in = query._id.$in.filter((id) =>
          propertyHosts.includes(id)
        );
      } else {
        query._id = { $in: propertyHosts };
      }
    }

    // Event search filter with multiple terms
    if (eventSearch) {
      const eventFields = ["title", "location.city", "location.state"];
      const eventConditions = createMultipleSearchConditions(
        eventSearch,
        eventFields
      );

      let eventQuery = {};
      if (eventConditions.length > 0) {
        eventQuery = { $or: eventConditions };
      }

      // Add date search if the term looks like a date
      const dateLikeTerms = eventSearch.split(",").filter((term) => {
        return (
          term.match(/\d{4}-\d{2}-\d{2}/) || term.match(/\d{2}\/\d{2}\/\d{4}/)
        );
      });

      if (dateLikeTerms.length > 0) {
        eventQuery.$or = eventQuery.$or || [];
        dateLikeTerms.forEach((dateTerm) => {
          eventQuery.$or.push({
            $expr: {
              $regexMatch: {
                input: { $toString: "$startDate" },
                regex: dateTerm,
              },
            },
          });
        });
      }

      const eventHosts = await Event.find(eventQuery).distinct(
        "createdBy.userId"
      );

      if (query._id) {
        query._id.$in = query._id.$in.filter((id) =>
          eventHosts.some((eid) => eid.equals(id))
        );
      } else {
        query._id = { $in: eventHosts };
      }
    }

    // Count total matching hosts
    const totalHosts = await User.countDocuments(query);
    const totalPages = Math.ceil(totalHosts / itemsPerPage);

    // Get paginated results
    const hosts = await User.find(query)
      .select("-password -refreshToken")
      .skip((currentPage - 1) * itemsPerPage)
      .limit(itemsPerPage)
      .sort({ createdAt: -1 })
      .lean();

    // Enhance with property, event details and KYC info
    const enhancedHosts = await Promise.all(
      hosts.map(async (host) => {
        const [properties, events] = await Promise.all([
          Property.find({ owner: host._id })
            .select("name propertyId images address status")
            .limit(5)
            .lean(),
          Event.find({ "createdBy.userId": host._id })
            .select("title startDate endDate location images status")
            .limit(5)
            .lean(),
        ]);

        return {
          ...host,
          properties,
          propertyCount: await Property.countDocuments({ owner: host._id }),
          events,
          eventCount: await Event.countDocuments({
            "createdBy.userId": host._id,
          }),
          kycInfo: host.kycStatus
            ? {
                aadhar: host.kyc?.aadharNumber,
                pan: host.kyc?.panNumber,
                aadharFront: host.kyc?.aadharFrontImage,
                aadharBack: host.kyc?.aadharBackImage,
                panImage: host.kyc?.panImage,
              }
            : null,
        };
      })
    );

    res.render("pages/admin/host/index", {
      sidebar: "host",
      hosts: enhancedHosts,
      currentPage,
      totalPages,
      totalHosts,
      limit: itemsPerPage,
      filterValues: {
        ...req.query,
        page: currentPage,
        limit: itemsPerPage,
      },
    });
  } catch (error) {
    console.error("Error filtering hosts:", error);
    res.redirect("/host");
  }
});

const viewHost = asyncHandler(async (req, res) => {
  try {
    const host = await User.findById(req.params.id)
      .select("-password -refreshToken")
      .lean();

    if (!host) {
      return res.redirect("/host");
    }

    // Get all host-related data in parallel
    const [properties, events, propertyBookings, eventBookings] =
      await Promise.all([
        // Host Properties
        Property.find({ owner: req.params.id }).sort({ createdAt: -1 }).lean(),

        // Host Events
        Event.find({
          "createdBy.userId": req.params.id,
          "createdBy.role": "host",
        })
          .populate("categoryId", "name") // Only populate name field from category
          .sort({ startTime: -1 })
          .lean(),

        // Property Bookings
        Booking.find({ hostId: req.params.id })
          .populate("propertyId", "name") // Only populate necessary fields
          .populate("guestId", "firstName lastName profileImage")
          .sort({ createdAt: -1 })
          .lean(),

        // Event Bookings - Corrected aggregation pipeline
        BookingEvent.aggregate([
          {
            $lookup: {
              from: "events",
              let: { eventId: "$event" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$_id", "$$eventId"] },
                    "createdBy.userId": new mongoose.Types.ObjectId(
                      req.params.id
                    ),
                    "createdBy.role": "host",
                  },
                },
              ],
              as: "eventDetails",
            },
          },
          { $unwind: "$eventDetails" }, // Only include bookings with matching events
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
              _id: 1,
              bookingId: 1,
              bookingDate: 1,
              numberOfAttendees: 1,
              paymentDetails: 1,
              status: 1,
              bookingBy: 1,
              event: "$eventDetails",
              guest: {
                firstName: "$userDetails.firstName",
                lastName: "$userDetails.lastName",
                profileImage: "$userDetails.profileImage",
              },
            },
          },
          { $sort: { bookingDate: -1 } },
          { $limit: 10 }, // Add limit to prevent too many results
        ]),
      ]);

    // Format stats
    const hostStats = {
      totalProperties: properties.length,
      totalEvents: events.length,
      totalBookings: propertyBookings.length,
      totalEventBookings: eventBookings.length,
    };

    res.render("pages/admin/host/view", {
      sidebar: "host",
      host,
      properties,
      events,
      propertyBookings,
      eventBookings,
      hostStats
    });
  } catch (error) {
    console.error("Error in viewHost:", error);
    res.redirect("/host");
  }
});

const updateHostStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const host = await User.findById(id);

    if (!host) {
      return res
        .status(404)
        .json({ success: false, message: "Host not found" });
    }

    host.isActive = !host.isActive;
    await host.save();

    await createActivityLog({
      entityType: "User",
      entityId: host._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "status",
    });

    res.status(200).json({
      success: true,
      message: `Host ${host.isActive ? "activated" : "Blocked"}`,
      isActive: host.isActive,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to update status",
    });
  }
});

const verifyUpdate = asyncHandler(async (req, res) => {
  try {
    const { hostId, verified } = req.body;

    const updatedHost = await User.findByIdAndUpdate(
      hostId,
      { hostVerified: verified },
      { new: true }
    );

    await createNotification({
      recipientId: hostId,
      recipientRole: "host",
      senderId: req.admin._id, // Admin who performed the action
      senderRole: "admin",
      title: `Account ${verified ? "Verified" : "Unverified"}`,
      message: `Your host account has been ${
        verified ? "verified" : "unverified"
      } by our team.`,
      notificationType: "system",
      metadata: {
        status: verified,
        updatedAt: new Date(),
      },
    });

    await createActivityLog({
      entityType: "User",
      entityId: hostId,
      userId: req.admin._id,
      userRole: "admin",
      action: "verifyStatus",
    });

    if (!updatedHost) {
      return res.status(404).json({
        success: false,
        message: "Host not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Host ${verified ? "verified" : "unverified"} successfully`,
      host: updatedHost,
    });
  } catch (error) {
    console.error("Verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

const toggleKYCStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const host = await User.findById(id);
    if (!host) {
      return res.status(404).json({
        success: false,
        message: "Host not found",
      });
    }

    // Toggle the KYC status
    const updatedHost = await User.findByIdAndUpdate(
      id,
      {
        $set: {
          kycStatus: !host.kycStatus,
        },
      },
      { new: true }
    );

    await createActivityLog({
      entityType: "User",
      entityId: id,
      userId: req.admin._id,
      userRole: "admin",
      action: "kycStatus",
    });

    res.json({
      success: true,
      message: `KYC status ${
        updatedHost.kycStatus ? "completed" : "pending"
      } successfully`,
      data: updatedHost,
    });
  } catch (error) {
    console.error("Error toggling KYC status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update KYC status",
    });
  }
});

/// ----------------- User Management End -----------------------////

/// ----------------- Vendor Management Start-----------------------------//

const listVendor = asyncHandler(async (req, res) => {
  // Get filter values from query params
  const {
    search,
    vendorType,
    status,
    location,
    serviceCategory,
    discountCode,
    refundPolicy,
    registrationPeriod,
    fromDate,
    toDate,
    page = 1, // Default to page 1
    limit = 10, // Default to 10 items per page
  } = req.query;

  // Helper function to create multiple search conditions
  const createMultipleSearchConditions = (searchString, fields) => {
    if (!searchString) return [];

    // Split by comma and trim whitespace
    const searchTerms = searchString
      .split(",")
      .map((term) => term.trim())
      .filter((term) => term.length > 0);

    const conditions = [];

    searchTerms.forEach((term) => {
      const termConditions = fields.map((field) => ({
        [field]: { $regex: term, $options: "i" },
      }));
      conditions.push({ $or: termConditions });
    });

    return conditions;
  };

  // Prepare filter object
  let filter = {};

  // Text search filter with multiple terms
  if (search) {
    const searchFields = [
      "vendorId",
      "firstName",
      "lastName",
      "businessInfo.businessName",
      "phoneNumber",
      "emailAddress",
    ];
    const searchConditions = createMultipleSearchConditions(
      search,
      searchFields
    );

    if (searchConditions.length > 0) {
      filter.$or = searchConditions;
    }
  }

  // Location filter with multiple terms
  if (location) {
    const locationFields = [
      "address",
      "cityDistrict",
      "state",
      "serviceableLocations.address",
    ];
    const locationConditions = createMultipleSearchConditions(
      location,
      locationFields
    );

    if (locationConditions.length > 0) {
      const locationQuery = { $or: locationConditions };

      if (filter.$or) {
        // If both search and location exist, combine them with $and
        filter = {
          $and: [{ $or: filter.$or }, locationQuery],
        };
      } else {
        filter = { ...filter, ...locationQuery };
      }
    }
  }

  // Vendor type filter with multiple values
  if (vendorType) {
    const vendorTypes = vendorType
      .split(",")
      .map((type) => type.trim())
      .filter((type) => type.length > 0);

    if (vendorTypes.length > 1) {
      const vendorTypeQuery = { vendorType: { $in: vendorTypes } };

      if (filter.$and) {
        filter.$and.push(vendorTypeQuery);
      } else if (filter.$or) {
        filter = { $and: [{ $or: filter.$or }, vendorTypeQuery] };
      } else {
        filter = { ...filter, ...vendorTypeQuery };
      }
    } else {
      const vendorTypeQuery = { vendorType: vendorTypes[0] };

      if (filter.$and) {
        filter.$and.push(vendorTypeQuery);
      } else if (filter.$or) {
        filter = { $and: [{ $or: filter.$or }, vendorTypeQuery] };
      } else {
        filter.vendorType = vendorTypes[0];
      }
    }
  }

  // Status filter with multiple values
  if (status) {
    const statuses = status
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (statuses.length > 1) {
      const statusQuery = { status: { $in: statuses } };

      if (filter.$and) {
        filter.$and.push(statusQuery);
      } else if (filter.$or) {
        filter = { $and: [{ $or: filter.$or }, statusQuery] };
      } else {
        filter = { ...filter, ...statusQuery };
      }
    } else {
      const statusQuery = { status: statuses[0] };

      if (filter.$and) {
        filter.$and.push(statusQuery);
      } else if (filter.$or) {
        filter = { $and: [{ $or: filter.$or }, statusQuery] };
      } else {
        filter.status = statuses[0];
      }
    }
  }

  // Service category filter with multiple values
  if (serviceCategory) {
    const serviceCategories = serviceCategory
      .split(",")
      .map((cat) => cat.trim())
      .filter((cat) => cat.length > 0);

    if (serviceCategories.length > 0) {
      const serviceCategoryQuery = {
        serviceCategories: { $in: serviceCategories },
      };

      if (filter.$and) {
        filter.$and.push(serviceCategoryQuery);
      } else if (filter.$or) {
        filter = { $and: [{ $or: filter.$or }, serviceCategoryQuery] };
      } else {
        filter = { ...filter, ...serviceCategoryQuery };
      }
    }
  }

  // Pricing filters
  const pricingFilter = {};
  if (discountCode) {
    const discountCodes = discountCode
      .split(",")
      .map((code) => code.trim())
      .filter((code) => code.length > 0);
    if (discountCodes.length > 1) {
      pricingFilter.discountCodeId = { $in: discountCodes };
    } else {
      pricingFilter.discountCodeId = discountCodes[0];
    }
  }

  if (refundPolicy) {
    const refundPolicies = refundPolicy
      .split(",")
      .map((policy) => policy.trim())
      .filter((policy) => policy.length > 0);
    if (refundPolicies.length > 1) {
      pricingFilter.refundPolicyId = { $in: refundPolicies };
    } else {
      pricingFilter.refundPolicyId = refundPolicies[0];
    }
  }

  if (Object.keys(pricingFilter).length > 0) {
    const pricingQuery = { pricing: pricingFilter };

    if (filter.$and) {
      filter.$and.push(pricingQuery);
    } else if (filter.$or) {
      filter = { $and: [{ $or: filter.$or }, pricingQuery] };
    } else {
      filter = { ...filter, ...pricingQuery };
    }
  }

  // Registration date filter
  if (registrationPeriod) {
    let dateFilter = {};
    const now = new Date();

    switch (registrationPeriod) {
      case "today":
        dateFilter.$gte = new Date(now.setHours(0, 0, 0, 0));
        dateFilter.$lte = new Date(now.setHours(23, 59, 59, 999));
        break;
      case "week":
        const firstDayOfWeek = new Date(
          now.setDate(now.getDate() - now.getDay())
        );
        dateFilter.$gte = new Date(firstDayOfWeek.setHours(0, 0, 0, 0));
        dateFilter.$lte = new Date();
        break;
      case "month":
        dateFilter.$gte = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFilter.$lte = new Date();
        break;
      case "year":
        dateFilter.$gte = new Date(now.getFullYear(), 0, 1);
        dateFilter.$lte = new Date();
        break;
      case "custom":
        if (fromDate) {
          dateFilter.$gte = new Date(fromDate);
        }
        if (toDate) {
          const toDateObj = new Date(toDate);
          toDateObj.setHours(23, 59, 59, 999);
          dateFilter.$lte = toDateObj;
        }
        break;
    }

    if (Object.keys(dateFilter).length > 0) {
      const dateQuery = { createdAt: dateFilter };

      if (filter.$and) {
        filter.$and.push(dateQuery);
      } else if (filter.$or) {
        filter = { $and: [{ $or: filter.$or }, dateQuery] };
      } else {
        filter = { ...filter, ...dateQuery };
      }
    }
  }

  // Get reference data for dropdowns
  const [serviceCategories, discountCodes, refundPolicies] = await Promise.all([
    ConciergeService.find().select("name").lean(),
    VendorDiscountCode.find().select("codeName codeValue").lean(),
    VendorRefundPolicy.find().select("timeValue timeUnit percentage").lean(),
  ]);

  // Calculate pagination values
  const currentPage = parseInt(page);
  const itemsPerPage = parseInt(limit);
  const skip = (currentPage - 1) * itemsPerPage;

  // Get total count of vendors (for pagination)
  const totalVendors = await Vendor.countDocuments(filter);
  const totalPages = Math.ceil(totalVendors / itemsPerPage);

  // Query vendors with filters and pagination
  const list = await Vendor.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(itemsPerPage)
    .populate({
      path: "serviceCategories",
      select: "name",
    })
    .populate({
      path: "pricing.discountCodeId",
      select: "codeName codeValue",
    })
    .populate({
      path: "pricing.refundPolicyId",
      select: "timeValue timeUnit percentage",
    })
    .lean();

  return res.render("pages/admin/vendor", {
    sidebar: "vendor",
    list,
    filterValues: req.query,
    serviceCategories,
    discountCodes,
    refundPolicies,
    currentPage,
    totalPages,
    totalVendors,
  });
});

const viewVendor = asyncHandler(async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id)
      .populate("userId", "firstName lastName profileImage")
      .populate({
        path: "serviceCategories",
        select: "name image",
      })
      .populate({
        path: "pricing.discountCodeId",
        model: "VendorDiscountCode",
      })
      .populate({
        path: "pricing.refundPolicyId",
        model: "VendorRefundPolicy",
      })
      .select("-password -refreshToken")
      .lean();

    if (!vendor) {
      return res.redirect("/vendor");
    }

    res.render("pages/admin/vendor/view", {
      sidebar: "vendor",
      vendor,
      formattedDate: (date) =>
        date ? new Date(date).toLocaleDateString("en-IN") : "N/A",
    });
  } catch (error) {
    console.error(error);
    res.redirect("/vendor");
  }
});

const vendorForm = asyncHandler(async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id)
      .populate("userId", "firstName lastName profileImage")
      .populate("serviceCategories", "name")
      .lean();

    if (!vendor) {
      return res.redirect("/vendor");
    }

    const serviceCategories = await ConciergeService.find({
      status: true,
    }).lean();

    res.render("pages/admin/vendor/form", {
      sidebar: "vendor",
      vendor,
      serviceCategories,
      residentialCoords:
        vendor.residentialAddress?.location?.coordinates?.join(",") || "",
      serviceableLocationsDisplay:
        vendor.serviceableLocations?.map((loc) => loc.address).join(", ") || "",
    });
  } catch (error) {
    console.error(error);
    res.redirect("/vendor");
  }
});

const updateVendor = asyncHandler(async (req, res) => {
  try {
    const vendorId = req.params.id;
    const updates = req.body;
    const files = req.files;

    // Handle file uploads
    if (files) {
      // Profile and business photos
      if (files.profilePhoto) {
        updates[
          "documents.profilePhoto"
        ] = `/temp/${files.profilePhoto[0].filename}`;
      }
      if (files.businessPhoto) {
        updates[
          "documents.businessPhoto"
        ] = `/temp/${files.businessPhoto[0].filename}`;
      }

      // Prepare document updates
      const documentUpdates = [];
      const documentFields = [
        { field: "aadharFront", type: "Aadhar", name: "Aadhar Card Front" },
        { field: "aadharBack", type: "Aadhar", name: "Aadhar Card Back" },
        { field: "panCard", type: "Pan", name: "Pan Card" },
        { field: "gstin", type: "GSTIN", name: "GSTIN" },
        { field: "fssai", type: "FSSAI", name: "FSSAI Certificate" },
        {
          field: "certificates",
          type: "Certificates",
          name: "Professional Certificates",
        },
        {
          field: "portfolio",
          type: "Portfolio",
          name: "Portfolio / Sample Work Files",
        },
      ];

      documentFields.forEach((doc) => {
        if (files[doc.field]) {
          documentUpdates.push({
            type: doc.type,
            name: doc.name,
            file: `/temp/${files[doc.field][0].filename}`,
          });
        }
      });

      if (documentUpdates.length > 0) {
        // First get the current vendor to preserve existing documents
        const vendor = await Vendor.findById(vendorId);
        let uploadDocuments = vendor.documents.uploadDocuments || [];

        // Remove existing documents of the same types
        uploadDocuments = uploadDocuments.filter(
          (doc) => !documentUpdates.some((newDoc) => newDoc.type === doc.type)
        );

        // Add the new documents
        uploadDocuments.push(...documentUpdates);

        // Set the complete array
        updates["documents.uploadDocuments"] = uploadDocuments;
      }
    }

    if (updates.residentialAddress) {
      updates.residentialAddress.address = updates.residentialAddress.address;
      updates.residentialAddress.location.coordinates =
        updates.residentialAddress.location.coordinates.split(",").map(Number);
    }

    if (updates.serviceableLocations) {
      updates.serviceableLocations.forEach((loc) => {
        loc.address = loc.address;
        loc.location.coordinates = loc.location.coordinates
          .split(",")
          .map(Number);
      });
    }

    if (updates.languageSpoken) {
      updates.languageSpoken = updates.languageSpoken
        .split(",")
        .map((item) => item.trim());
    }

    // Update vendor
    const updatedVendor = await Vendor.findByIdAndUpdate(vendorId, updates, {
      new: true,
      runValidators: true,
    });

    await createActivityLog({
      entityType: "Vendor",
      entityId: vendorId,
      userId: req.admin._id,
      userRole: "admin",
      action: "update",
    });

    res.json({
      success: true,
      message: "Vendor updated successfully",
      data: updatedVendor,
    });
  } catch (error) {
    console.error("Error updating vendor:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to update vendor",
    });
  }
});

const updateVendorStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;

  // Validate status transition
  const vendor = await Vendor.findById(id);
  if (!vendor) {
    return res
      .status(404)
      .json({ success: false, message: "Vendor not found" });
  }

  // Status transition rules
  if (vendor.status === "pending" && status !== "active") {
    return res.status(400).json({
      success: false,
      message: "Pending vendors can only be activated",
    });
  }

  if (vendor.status !== "pending" && !["active", "inactive"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Only active/inactive status changes allowed",
    });
  }

  // Update status
  vendor.status = status;
  await vendor.save();

  await createActivityLog({
    entityType: "Vendor",
    entityId: id,
    userId: req.admin._id,
    userRole: "admin",
    action: "status",
  });

  res.json({
    success: true,
    message: `Vendor status updated to ${status}`,
    status,
  });
});

/// Discount Code //
const listDiscountCode = asyncHandler(async (req, res) => {
  const discountCodes = await VendorDiscountCode.find().lean();

  return res.render("pages/admin/vendor/setting/discountCode", {
    sidebar: "discountCode",
    discountCodes: discountCodes,
  });
});

const showDiscountCodeForm = asyncHandler(async (req, res) => {
  try {
    const isEditMode = req.path.includes("edit");
    let formData = {
      codeName: "",
      codeValue: "",
      status: true,
    };
    let formTitle = "Add Discount Code";

    if (isEditMode) {
      const discountCode = await VendorDiscountCode.findById(req.params.id);
      if (!discountCode) {
        return res
          .status(404)
          .render("pages/admin/vendor/setting/discountCode/form", {
            error: "Discount Code not found",
            formData,
            formTitle,
            isEditMode,
            sidebar: "discountCode",
          });
      }
      formData = {
        id: discountCode._id,
        codeName: discountCode.codeName,
        codeValue: discountCode.codeValue,
        status: discountCode.status,
      };
      formTitle = "Edit Discount Code";
    }

    res.render("pages/admin/vendor/setting/discountCode/form", {
      formData,
      formTitle,
      isEditMode,
      sidebar: "discountCode",
    });
  } catch (error) {
    console.error(error);
    return res.redirect("/vendor/setting/discountCode");
  }
});

const createDiscountCode = asyncHandler(async (req, res) => {
  try {
    const { codeName, codeValue, status } = req.body;
    if (!codeName || !codeValue) {
      return res.status(400).json({
        success: false,
        message: "Discount Code Name and Code Value are required",
      });
    }

    const existingDiscountCode = await VendorDiscountCode.findOne({ codeName });
    if (existingDiscountCode) {
      return res.status(400).json({
        success: false,
        message: "Discount Code with this name already exists",
      });
    }

    const discountCode = await VendorDiscountCode.create({
      codeName,
      codeValue,
      status: status ? true : false,
    });

    await createActivityLog({
      entityType: "VendorDiscountCode",
      entityId: discountCode._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "create",
    });

    res.json({ success: true, message: "Discount Code created successfully" });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      success: false,
      message: error.message.includes("duplicate")
        ? "Discount Code with this name already exists"
        : error.message,
    });
  }
});

const updateDiscountCode = asyncHandler(async (req, res) => {
  try {
    console.log(req.params.id);
    const { codeName, codeValue, status } = req.body;

    if (!codeName || !codeValue) {
      return res.status(400).json({
        success: false,
        message: "Discount Code Name and Code Value are required",
      });
    }

    const existingType = await VendorDiscountCode.findOne({
      codeName,
      _id: { $ne: req.params.id }, // Exclude current record
    });

    if (existingType) {
      return res.status(400).json({
        success: false,
        message: "Another Discount Code with this name already exists",
      });
    }

    const updateData = {
      codeName,
      codeValue,
      status: status ? true : false,
    };

    await VendorDiscountCode.findByIdAndUpdate(req.params.id, updateData);

    await createActivityLog({
      entityType: "VendorDiscountCode",
      entityId: req.params.id,
      userId: req.admin._id,
      userRole: "admin",
      action: "update",
    });

    res.json({ success: true, message: "Discount Code updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      success: false,
      message: error.message.includes("duplicate")
        ? "Discount Code with this name already exists"
        : error.message,
    });
  }
});

const updateDiscountCodeStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const discountCode = await VendorDiscountCode.findById(id);

    if (!discountCode) {
      return res.status(404).json({
        success: false,
        message: "Discount Code not found",
      });
    }

    discountCode.status = !discountCode.status;
    await discountCode.save();

    await createActivityLog({
      entityType: "VendorDiscountCode",
      entityId: id,
      userId: req.admin._id,
      userRole: "admin",
      action: "status",
    });

    res.json({
      success: true,
      message: "Discount Code status updated successfully",
      newStatus: discountCode.status,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to update status",
    });
  }
});

// RefundPolicies //
const listRefundPolicies = asyncHandler(async (req, res) => {
  const refundPolicies = await VendorRefundPolicy.find().lean();
  return res.render("pages/admin/vendor/setting/refundPolicy", {
    sidebar: "refundPolicy",
    refundPolicies: refundPolicies,
  });
});

const showRefundPolicyForm = asyncHandler(async (req, res) => {
  try {
    const isEditMode = req.path.includes("edit");
    let formData = {
      timeValue: "",
      timeUnit: "hours",
      percentage: "",
      status: true,
    };
    let formTitle = "Add Refund Policy";

    if (isEditMode) {
      const refundPolicy = await VendorRefundPolicy.findById(req.params.id);
      if (!refundPolicy) {
        return res
          .status(404)
          .render("pages/admin/vendor/setting/refundPolicy/form", {
            error: "Refund Policy not found",
            formData,
            formTitle,
            isEditMode,
            sidebar: "refundPolicy",
          });
      }
      formData = {
        id: refundPolicy._id,
        timeValue: refundPolicy.timeValue,
        timeUnit: refundPolicy.timeUnit,
        percentage: refundPolicy.percentage,
        status: refundPolicy.status,
      };
      formTitle = "Edit Refund Policy";
    }

    res.render("pages/admin/vendor/setting/refundPolicy/form", {
      formData,
      formTitle,
      isEditMode,
      sidebar: "refundPolicy",
    });
  } catch (error) {
    console.error(error);
    return res.redirect("/vendor/setting/refundPolicy");
  }
});

const createRefundPolicy = asyncHandler(async (req, res) => {
  try {
    const { timeValue, timeUnit, percentage, status } = req.body;

    if (!timeValue || !timeUnit || !percentage) {
      return res.status(400).json({
        success: false,
        message: "Time value, time unit and percentage are required",
      });
    }

    // Check if a policy with these exact values already exists
    const existingPolicy = await VendorRefundPolicy.findOne({
      timeValue,
      timeUnit,
      percentage,
    });

    if (existingPolicy) {
      return res.status(400).json({
        success: false,
        message: "Refund Policy with these values already exists",
      });
    }

    const refundPolicy = await VendorRefundPolicy.create({
      timeValue,
      timeUnit,
      percentage,
      status: status ? true : false,
    });

    await createActivityLog({
      entityType: "VendorRefundPolicy",
      entityId: refundPolicy._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "create",
    });

    res.json({
      success: true,
      message: "Refund Policy created successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      success: false,
      message: error.message.includes("validation failed")
        ? "Invalid input data"
        : error.message,
    });
  }
});

const updateRefundPolicy = asyncHandler(async (req, res) => {
  try {
    const { timeValue, timeUnit, percentage, status } = req.body;

    if (!timeValue || !timeUnit || !percentage) {
      return res.status(400).json({
        success: false,
        message: "Time value, time unit and percentage are required",
      });
    }

    // Check if another policy with these values exists (excluding current one)
    const existingPolicy = await VendorRefundPolicy.findOne({
      timeValue,
      timeUnit,
      percentage,
      _id: { $ne: req.params.id },
    });

    if (existingPolicy) {
      return res.status(400).json({
        success: false,
        message: "Another Refund Policy with these values already exists",
      });
    }

    const updateData = {
      timeValue,
      timeUnit,
      percentage,
      status: status ? true : false,
    };

    await VendorRefundPolicy.findByIdAndUpdate(req.params.id, updateData);

    await createActivityLog({
      entityType: "VendorRefundPolicy",
      entityId: req.params.id,
      userId: req.admin._id,
      userRole: "admin",
      action: "update",
    });

    res.json({
      success: true,
      message: "Refund Policy updated successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      success: false,
      message: error.message.includes("validation failed")
        ? "Invalid input data"
        : error.message,
    });
  }
});

const updateRefundPolicyStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const refundPolicy = await VendorRefundPolicy.findById(id);

    if (!refundPolicy) {
      return res.status(404).json({
        success: false,
        message: "Refund Policy not found",
      });
    }

    refundPolicy.status = !refundPolicy.status;
    await refundPolicy.save();

    await createActivityLog({
      entityType: "VendorRefundPolicy",
      entityId: id,
      userId: req.admin._id,
      userRole: "admin",
      action: "status",
    });

    res.json({
      success: true,
      message: "Refund Policy status updated successfully",
      newStatus: refundPolicy.status,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to update status",
    });
  }
});

/// ----------------- Vendor Management End-----------------------------//

/// -------------  Property Management Start -------------------------///

const listProperties = asyncHandler(async (req, res) => {
  try {
    const {
      search,
      hostId,
      location,
      propertyType,
      status,
      adminStatus,
      minPrice,
      maxPrice,
      guests,
      bedrooms,
      bathrooms,
      rating,
      availableFrom,
      availableTo,
      topVacation,
      page = 1,
      limit = 10,
    } = req.query;

    // Convert page and limit to numbers
    const currentPage = parseInt(page);
    const itemsPerPage = parseInt(limit);

    // Base query
    let query = {};

    // Helper function to create multiple search conditions
    const createMultipleSearchConditions = (searchString, fields) => {
      if (!searchString) return [];

      // Split by comma and trim whitespace
      const searchTerms = searchString
        .split(",")
        .map((term) => term.trim())
        .filter((term) => term.length > 0);

      const conditions = [];

      searchTerms.forEach((term) => {
        const termConditions = fields.map((field) => ({
          [field]: { $regex: term, $options: "i" },
        }));
        conditions.push({ $or: termConditions });
      });

      return conditions;
    };

    // Search across multiple fields with multiple terms
    if (search) {
      const searchFields = [
        "name",
        "description",
        "address.city",
        "address.state",
      ];
      const searchConditions = createMultipleSearchConditions(
        search,
        searchFields
      );

      if (searchConditions.length > 0) {
        query.$or = searchConditions;
      }
    }

    // Host filter
    if (hostId) {
      query.owner = new mongoose.Types.ObjectId(hostId);
    }

    // Location filter with multiple terms
    if (location) {
      const locationFields = ["address.city", "address.state"];
      const locationConditions = createMultipleSearchConditions(
        location,
        locationFields
      );

      if (locationConditions.length > 0) {
        const locationQuery = { $or: locationConditions };

        if (query.$or) {
          // If both search and location exist, combine them with $and
          query = {
            $and: [{ $or: query.$or }, locationQuery],
          };
        } else {
          query = { ...query, ...locationQuery };
        }
      }
    }

    // Property type filter
    if (propertyType) {
      query.propertyType = new mongoose.Types.ObjectId(propertyType);
    }

    // Status filter
    if (status) {
      query.status = status;
    }

    // Admin status filter
    if (adminStatus) {
      query.adminApprovalStatus = adminStatus;
    }

    // Price range filter
    if (minPrice || maxPrice) {
      query["pricing.baseAmount"] = {};
      if (minPrice) query["pricing.baseAmount"].$gte = Number(minPrice);
      if (maxPrice) query["pricing.baseAmount"].$lte = Number(maxPrice);
    }

    // Capacity filters
    if (guests) {
      query["capacity.guestsAllowed"] = { $gte: Number(guests) };
    }
    if (bedrooms) {
      query["capacity.bedrooms"] = { $gte: Number(bedrooms) };
    }
    if (bathrooms) {
      query["capacity.bathrooms"] = { $gte: Number(bathrooms) };
    }

    // Rating filter
    if (rating) {
      if (rating === "top") {
        query.averageRating = { $gte: 4 };
      } else if (rating === "low") {
        query.averageRating = { $lte: 2 };
      } else if (!isNaN(rating)) {
        query.averageRating = { $gte: Number(rating) };
      }
    }

    // Top vacation filter
    if (topVacation === "true") {
      query.topVacation = true;
    }

    // Get hosts for dropdown
    const hosts = await User.find({
      roles: "host",
      profileCompletionStatus: "complete",
    })
      .select("firstName lastName _id")
      .sort({ firstName: 1 });

    // Get property types for dropdown
    const propertyTypes = await PropertyType.find().sort({ name: 1 });

    // Step 1: First get all properties that match the basic filters
    let properties = await Property.find(query)
      .populate("owner", "firstName lastName profileImage hostVerified")
      .populate("propertyType", "name")
      .sort({ createdAt: -1 })
      .lean();

    // Step 2: If availability filter is applied, check PropertyCalendar
    if (availableFrom || availableTo) {
      const startDate = availableFrom ? new Date(availableFrom) : new Date();
      const endDate = availableTo ? new Date(availableTo) : new Date();
      endDate.setHours(23, 59, 59, 999);

      // Get all booked dates for the date range
      const bookedProperties = await PropertyCalendar.find({
        date: { $gte: startDate, $lte: endDate },
        status: "booked",
      }).distinct("propertyId");

      // Filter out properties that are booked in the date range
      properties = properties.filter(
        (property) =>
          !bookedProperties.some(
            (bookedId) => bookedId.toString() === property._id.toString()
          )
      );
    }

    // Step 3: Apply pagination after availability filtering
    const total = properties.length;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedProperties = properties.slice(
      startIndex,
      startIndex + itemsPerPage
    );

    // Step 4: Enhance properties with additional data including todayPrice
    const enhancedProperties = await Promise.all(
      paginatedProperties.map(async (property) => {
        const [reviews, bookings, todayPrice] = await Promise.all([
          PropertyRating.find({ property: property._id })
            .select("rating")
            .lean(),
          Booking.find({ property: property._id }).select("status").lean(),
          // Get today's price from PropertyCalendar
          PropertyCalendar.findOne({
            propertyId: property._id,
            date: new Date(new Date().setHours(0, 0, 0, 0)),
          })
            .select("price status")
            .lean(),
        ]);

        return {
          ...property,
          reviewCount: reviews.length,
          bookingCount: bookings.length,
          activeBookingCount: bookings.filter((b) => b.status === "confirmed")
            .length,
          todayPrice: todayPrice?.price || property.pricing.baseAmount,
          todayStatus: todayPrice?.status || "available",
        };
      })
    );

    // Calculate total pages
    const totalPages = Math.ceil(total / itemsPerPage);

    res.render("pages/admin/property-management/property", {
      sidebar: "properties",
      properties: enhancedProperties,
      hosts,
      propertyTypes,
      currentPage,
      totalPages,
      totalProperties: total,
      limit: itemsPerPage,
      filterValues: {
        ...req.query,
        page: currentPage,
        limit: itemsPerPage,
      },
    });
  } catch (error) {
    console.log(error);
    console.error("Error in listProperties:", error);
    res.redirect("/properties");
  }
});

const showPropertiesDetails = asyncHandler(async (req, res) => {
  try {
    const property = await Property.findById(req.params.id)
      .populate("owner")
      .populate("propertyType", "name image")
      .populate("amenities")
      .populate("todayPrice")
      .lean();

    if (!property) {
      return res.status(404).render("error", {
        message: "Property not found",
      });
    }

    // Group amenities by category
    const groupedAmenities = property.amenities.reduce((acc, amenity) => {
      if (!acc[amenity.category]) {
        acc[amenity.category] = [];
      }
      acc[amenity.category].push(amenity);
      return acc;
    }, {});

    const amenitiesByCategory = Object.entries(groupedAmenities).map(
      ([category, items]) => ({
        category,
        items,
      })
    );

    property.groupedAmenities = amenitiesByCategory;

    // Get all ratings for this property
    const ratings = await PropertyRating.find({ propertyId: property._id })
      .populate("guestId", "firstName lastName profileImage")
      .populate("bookingId", "bookingId")
      .sort({ createdAt: -1 })
      .lean();

    // Inside showPropertiesDetails controller
    const bookings = await Booking.find({ propertyId: property._id }).lean();

    // Calculate comprehensive payment summary
    const paymentSummary = {
      // Counts
      bookingsCount: bookings.length,
      completedBookings: bookings.filter((b) => b.status === "completed")
        .length,
      cancelledBookings: bookings.filter((b) => b.status === "cancelled")
        .length,

      // Financial Breakdown
      totalAmountBeforeTax: bookings.reduce(
        (sum, b) => sum + (b.amountBreakdown?.totalAmountBeforeTax || 0),
        0
      ),
      totalTaxAmount: bookings.reduce(
        (sum, b) => sum + (b.amountBreakdown?.totalTaxAmount || 0),
        0
      ),
      totalAmountWithTax: bookings.reduce(
        (sum, b) => sum + (b.amountBreakdown?.totalAmountWithTax || 0),
        0
      ),
      totalDiscountAmount: bookings.reduce(
        (sum, b) => sum + (b.amountBreakdown?.totalDiscountAmount || 0),
        0
      ),
      amountAfterDiscounts: bookings.reduce(
        (sum, b) => sum + (b.amountBreakdown?.amountAfterDiscounts || 0),
        0
      ),
      extraFeaturesTotal: bookings.reduce(
        (sum, b) => sum + (b.amountBreakdown?.extraFeaturesTotal || 0),
        0
      ),
      finalAmount: bookings.reduce(
        (sum, b) => sum + (b.amountBreakdown?.finalAmount || 0),
        0
      ),
      cleaningFeeAmount: bookings.reduce(
        (sum, b) => sum + (b.amountBreakdown?.cleaningFeeAmount || 0),
        0
      ),

      // Refunds (cancellations)
      totalRefundAmount: bookings.reduce(
        (sum, b) => sum + (b.cancellation?.refundAmount || 0),
        0
      ),
      totalPenaltyAmount: bookings.reduce(
        (sum, b) => sum + (b.cancellation?.penaltyAmount || 0),
        0
      ),
    };

    // Get cancellations
    const cancellations = bookings
      .filter((b) => b.status === "cancelled")
      .map((b) => ({
        bookingId: b.bookingId,
        cancellation: b.cancellation,
        refundDetails: {
          amount: b.cancellation?.refundAmount || 0,
          status: b.cancellation?.refundAmount > 0 ? "completed" : "none",
        },
      }))
      .sort(
        (a, b) =>
          new Date(b.cancellation.cancellationDate) -
          new Date(a.cancellation.cancellationDate)
      );

    ///Recent Transactions
    const recentTransactions = await TransactionLog.find({
      propertyId: property._id,
    })
      .sort({ createdAt: -1 })
      .limit(5);

    res.render("pages/admin/property-management/property/show", {
      title: property.title,
      sidebar: "properties",
      property,
      ratings,
      paymentSummary,
      cancellations,
      recentTransactions,
      bookings,
    });
  } catch (error) {
    console.error("Error fetching property:", error);
    res.status(500).render("error", {
      message: "Failed to load property details",
      error,
    });
  }
});

const togglePropertyStatus = asyncHandler(async (req, res) => {
  try {
    const { propertyId, status, rejectionReason } = req.body;

    // Validate input
    if (!mongoose.Types.ObjectId.isValid(propertyId)) {
      return res.status(400).json(new ApiError(400, "Invalid property ID"));
    }

    if (!["approved", "rejected"].includes(status)) {
      return res
        .status(400)
        .json(
          new ApiError(400, "Status must be either 'approved' or 'rejected'")
        );
    }

    if (status === "rejected" && !rejectionReason) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            "Rejection reason is required when rejecting a property"
          )
        );
    }

    // Find and update property
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json(new ApiError(404, "Property not found"));
    }

    // Update property status
    property.adminApprovalStatus = status;
    if (status === "rejected") {
      property.rejectionReason = rejectionReason;
    }

    const updatedProperty = await property.save();

    // Send notification to host
    await createNotification({
      recipientId: property.owner,
      recipientRole: "host",
      senderId: req.admin._id, // Admin who took the action
      senderRole: "admin",
      title: `Property ${status === "approved" ? "Approved" : "Rejected"}`,
      message:
        status === "approved"
          ? `Your property "${property.name}" has been approved and is now live!`
          : `Your property "${property.name}" was rejected. Reason: ${rejectionReason}`,
      notificationType: "property",
      actionId: property._id,
      actionUrl: `/host/properties/${property._id}`,
      metadata: {
        status: status,
        changedAt: new Date(),
        ...(status === "rejected" && { rejectionReason: rejectionReason }),
      },
    });

    await createActivityLog({
      entityType: "Property",
      entityId: property._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "status",
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          property: updatedProperty,
          status: status,
        },
        `Property ${status} successfully`
      )
    );
  } catch (error) {
    console.error("Error updating property status:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal server error", error.message));
  }
});

const updatePropertyStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["active", "inactive"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status value",
    });
  }

  const property = await Property.findByIdAndUpdate(
    id,
    { status },
    { new: true }
  );

  if (!property) {
    return res.status(404).json({
      success: false,
      message: "Property not found",
    });
  }

  // Log the activity (optional)
  await createActivityLog({
    entityType: "Property",
    entityId: property._id,
    userId: req.admin._id,
    action: "status-update",
    details: { newStatus: status },
  });

  res.json({
    success: true,
    message: "Property status updated successfully",
  });
});

const propertyBookingList = asyncHandler(async (req, res) => {
  const propertyId = req.params.id;
  const property = await Property.findById(propertyId).lean();

  // get all propety type  status = true
  const propertyTypes = await PropertyType.find({ status: true }).lean();

  res.render("pages/admin/property-management/property/booking", {
    sidebar: "properties",
    propertyTypes,
    property,
  });
});

const propertyBookingFilter = asyncHandler(async (req, res) => {
  try {
    const {
      search,
      status,
      dateRange,
      propertyId,
      propertyType,
      page = 1,
    } = req.query;
    const limit = 10; // Number of bookings per page
    const skip = (page - 1) * limit;

    // Build the filter query
    const filter = {};

    /// search filter by Booking ID, Guest Name
    if (search) {
      filter.$or = [
        { bookingId: { $regex: search, $options: "i" } },
        { "guestId.firstName": { $regex: search, $options: "i" } },
        { "guestId.lastName": { $regex: search, $options: "i" } },
      ];
    }

    // Status filter
    if (status && status !== "all") {
      filter.status = status;
    }
    if (propertyId) {
      filter.propertyId = new mongoose.Types.ObjectId(propertyId);
    }

    // Date range filter
    if (dateRange && dateRange !== "all") {
      const now = new Date();
      let startDate, endDate;

      switch (dateRange) {
        case "today":
          startDate = new Date(now.setHours(0, 0, 0, 0));
          endDate = new Date(now.setHours(23, 59, 59, 999));
          break;
        case "this_week":
          startDate = new Date(now.setDate(now.getDate() - now.getDay()));
          startDate.setHours(0, 0, 0, 0);
          endDate = new Date(startDate);
          endDate.setDate(startDate.getDate() + 6);
          endDate.setHours(23, 59, 59, 999);
          break;
        case "this_month":
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          endDate.setHours(23, 59, 59, 999);
          break;
        case "next_month":
          startDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0);
          endDate.setHours(23, 59, 59, 999);
          break;
      }

      filter["bookingDates.startDate"] = { $gte: startDate };
      filter["bookingDates.endDate"] = { $lte: endDate };
    }

    // Property type filter
    if (propertyType && propertyType !== "all") {
      // This assumes you have a propertyType field in your Property model
      filter["propertyId.propertyType"] = propertyType;
    }

    // Get total count for pagination
    const totalCount = await Booking.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit);

    // Get bookings with filters and pagination
    const bookings = await Booking.find(filter)
      .populate("propertyId", "name images address propertyType")
      .populate("guestId", "firstName lastName email profileImage")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    // Format the response
    const formattedBookings = bookings.map((booking) => ({
      _id: booking._id,
      bookingId: booking.bookingId,
      propertyName: booking.propertyId?.name || "Deleted Property",
      propertyLocation: booking.propertyId?.address || "Unknown Location",
      propertyImage: booking.propertyId?.images?.[0] || null,
      propertyType: booking.propertyId?.propertyType || "unknown",
      startDate: booking.bookingDates.startDate,
      endDate: booking.bookingDates.endDate,
      totalNights: booking.bookingDates.totalNights,
      adults: booking.guestDetails.adults,
      children: booking.guestDetails.children,
      infants: booking.guestDetails.infants,
      totalAmount: booking.amountBreakdown.finalAmount,
      status: booking.status || "pending",
      guestName:
        booking.guestId?.firstName + " " + booking.guestId?.lastName ||
        "Deleted Guest",
      guestProfileImage: booking.guestId?.profileImage || null,
      guestId: booking.guestId?._id || null,
    }));

    res.json({
      bookings: formattedBookings,
      totalPages,
      currentPage: parseInt(page),
    });
  } catch (error) {
    console.error("Error filtering bookings:", error);
    res.status(500).json({ message: "Error filtering bookings" });
  }
});

const propertyBookingDetails = asyncHandler(async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate({
        path: "propertyId",
        select: "name images address latitude longitude propertyType",
        populate: {
          path: "propertyType",
          select: "name",
        },
      })
      .populate({
        path: "guestId",
        select: "firstName lastName email phone profileImage",
      })
      .populate({
        path: "hostId",
        select: "firstName lastName email",
      })
      .populate({
        path: "transactionLogId",
      })
      .lean();

    if (!booking) {
      return res.redirect("/booking");
    }

    // Calculate additional amounts for display
    const totalGuests =
      booking.guestDetails.adults +
      (booking.guestDetails.children || 0) +
      (booking.guestDetails.infants || 0);

    // Get the rating for this booking
    const rating = await PropertyRating.findOne({
      bookingId: booking._id,
    })
      .populate("guestId", "firstName lastName profileImage")
      .lean();

    // Get additional services
    const serviceBooking = await BookingService.find({ booking: req.params.id })
      .populate("serviceId", "name description price")
      .populate("eventType", "name")
      .lean();

    // Format dates for display
    booking.bookingDates.startDate = new Date(booking.bookingDates.startDate);
    booking.bookingDates.endDate = new Date(booking.bookingDates.endDate);
    booking.createdAt = new Date(booking.createdAt);

    res.render("pages/admin/property-management/booking/show", {
      sidebar: "properties",
      booking,
      rating,
      serviceBooking,
      totalGuests,
    });
  } catch (error) {
    console.error("Booking details error:", error);
    return res.redirect("/booking");
  }
});

const propertyBookingStatusUpdate = asyncHandler(async (req, res) => {
  try {
    const { bookingId, newStatus } = req.body;
    if (!bookingId || !newStatus) {
      return res.status(400).json({
        success: false,
        message: "Booking ID and new status are required",
      });
    }
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }
    booking.status = newStatus;
    await booking.save();

    await createActivityLog({
      entityType: "Booking",
      entityId: booking._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "status",
    });

    return res
      .status(200)
      .json({ success: true, message: "Status updated successfully" });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Error updating status" });
  }
});

const updateTopVacationStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const property = await Property.findByIdAndUpdate(
      id,
      { topVacation: status },
      { new: true }
    );

    if (!property) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }

    await createActivityLog({
      entityType: "Property",
      entityId: property._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "topVacation",
    });

    res.json({
      success: true,
      topVacation: property.topVacation,
      message: `Property marked as ${
        property.topVacation ? "TOP VACATION" : "STANDARD"
      }`,
    });
  } catch (error) {
    console.error("Error updating top vacation status:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to update status" });
  }
});

/// -------------  Property Management End -------------------------///

/// ------------- Property Type Management Start -------------------------///

const listPropertyType = asyncHandler(async (req, res) => {
  const propertyTypes = await PropertyType.find()
    .populate({
      path: "properties",
      select: "name image status",
      options: { limit: 3 },
    })
    .lean();

  return res.render("pages/admin/property-management/type", {
    sidebar: "propertyType",
    propertyTypes,
  });
});

const showPropertyTypeForm = asyncHandler(async (req, res) => {
  try {
    const isEditMode = req.path.includes("edit");
    let formData = {
      name: "",
      description: "",
      cleaningFees: { shortStay: "", longStay: "" },
      status: true,
    };
    let formTitle = "Add Property Type";

    if (isEditMode) {
      const propertyType = await PropertyType.findById(req.params.id);
      if (!propertyType) {
        return res
          .status(404)
          .render("pages/admin/property-management/type/form", {
            error: "Property type not found",
            formData,
            formTitle,
            isEditMode,
            sidebar: "propertyType",
          });
      }
      formData = {
        id: propertyType._id,
        name: propertyType.name,
        description: propertyType.description,
        cleaningFees: {
          shortStay: propertyType.cleaningFees.shortStay,
          longStay: propertyType.cleaningFees.longStay,
        },
        image: propertyType.image,
        status: propertyType.status,
      };
      formTitle = "Edit Property Type";
    }

    res.render("pages/admin/property-management/type/form", {
      formData,
      formTitle,
      isEditMode,
      sidebar: "propertyType",
    });
  } catch (error) {
    console.error(error);
    return res.redirect("/property-type");
  }
});

const createPropertyType = asyncHandler(async (req, res) => {
  try {
    const { name, description, shortStay, longStay, status } = req.body;
    if (!name || !shortStay || !longStay) {
      return res.status(400).json({
        success: false,
        message: "Name and cleaning fees are required",
      });
    }

    const existingType = await PropertyType.findOne({ name });
    if (existingType) {
      return res.status(400).json({
        success: false,
        message: "Property type with this name already exists",
      });
    }

    const imagePath = req.file ? `/temp/${req.file.filename}` : undefined;
    const propertyType = await PropertyType.create({
      name,
      description,
      cleaningFees: {
        shortStay: parseFloat(shortStay),
        longStay: parseFloat(longStay),
      },
      image: imagePath,
      status: status === "on",
      createdBy: req.admin._id,
    });

    await createActivityLog({
      entityType: "PropertyType",
      entityId: propertyType._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "create",
    });

    res.json({ success: true, message: "Property type created successfully" });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      success: false,
      message: error.message.includes("duplicate")
        ? "Property type with this name already exists"
        : error.message,
    });
  }
});

const updatePropertyType = asyncHandler(async (req, res) => {
  try {
    const { name, description, shortStay, longStay, status } = req.body;

    if (!name || !shortStay || !longStay) {
      return res.status(400).json({
        success: false,
        message: "Name and cleaning fees are required",
      });
    }

    const existingType = await PropertyType.findOne({
      name,
      _id: { $ne: req.params.id }, // Exclude current record
    });

    if (existingType) {
      return res.status(400).json({
        success: false,
        message: "Another property type with this name already exists",
      });
    }

    const updateData = {
      name,
      description,
      cleaningFees: {
        shortStay: parseFloat(shortStay),
        longStay: parseFloat(longStay),
      },
      status: status === "on",
      updatedBy: req.admin._id,
    };

    if (req.file) {
      updateData.image = `/temp/${req.file.filename}`;
    }

    await PropertyType.findByIdAndUpdate(req.params.id, updateData);

    await createActivityLog({
      entityType: "PropertyType",
      entityId: req.params.id,
      userId: req.admin._id,
      userRole: "admin",
      action: "update",
    });

    res.json({ success: true, message: "Property type updated successfully" });
  } catch (error) {
    console.error(error);
    // Delete uploaded file if error occurred
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({
      success: false,
      message: error.message.includes("duplicate")
        ? "Property type with this name already exists"
        : error.message,
    });
  }
});

const updatePropertyTypeStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const propertyType = await PropertyType.findById(id);

    if (!propertyType) {
      return res.status(404).json({
        success: false,
        message: "Property type not found",
      });
    }

    propertyType.status = !propertyType.status;
    await propertyType.save();

    await createActivityLog({
      entityType: "PropertyType",
      entityId: id,
      userId: req.admin._id,
      userRole: "admin",
      action: "status",
    });

    res.json({
      success: true,
      message: "Status updated successfully",
      newStatus: propertyType.status,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to update status",
    });
  }
});

const showPropertyTypeDetails = asyncHandler(async (req, res) => {
  try {
    const propertyType = await PropertyType.findById(req.params.id).lean();

    if (!propertyType) {
      return res.redirect("/property-type");
    }

    res.render("pages/admin/property-management/type/details", {
      sidebar: "propertyType",
      propertyType,
    });
  } catch (error) {
    console.error(error);
    res.redirect("/property-type");
  }
});

/// ------------- Property Type Management End -------------------------///

/// ------------- Concierge Services Management Start -------------------------///

const listConciergeServices = asyncHandler(async (req, res) => {
  const services = await ConciergeService.find({})
    .sort({ createdAt: -1 })
    .lean();

  res.render("pages/admin/concierge-service", {
    sidebar: "conciergeService",
    services,
  });
});

const showConciergeServiceForm = asyncHandler(async (req, res) => {
  try {
    const isEditMode = req.path.includes("edit");
    let formData = {
      name: "",
      description: "",
      image: "",
      status: true,
      bookingForm: [],
    };
    let formTitle = "Add Concierge Service";

    if (isEditMode) {
      const service = await ConciergeService.findById(req.params.id);
      if (!service) {
        return res.status(404).render("pages/admin/concierge-service/form", {
          error: "Concierge service not found",
          formData,
          formTitle,
          isEditMode,
          sidebar: "conciergeService",
        });
      }
      formData = {
        id: service._id,
        name: service.name,
        description: service.description,
        status: service.status,
        image: service.image,
        bookingForm: service.bookingForm || [],
      };
      formTitle = "Edit Concierge Service";
    }

    res.render("pages/admin/concierge-service/form", {
      formData,
      formTitle,
      isEditMode,
      sidebar: "conciergeService",
    });
  } catch (error) {
    console.error(error);
    return res.redirect("/concierge-service");
  }
});

const createConciergeService = asyncHandler(async (req, res) => {
  try {
    const { name, description, status, bookingForm } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Name is required" });
    }

    const existingService = await ConciergeService.findOne({ name });
    if (existingService) {
      return res.status(400).json({
        success: false,
        message: "Concierge service with this name already exists",
      });
    }

    const imagePath = req.file ? `/temp/${req.file.filename}` : undefined;

    // Parse booking form if provided
    let parsedBookingForm = [];
    if (bookingForm) {
      try {
        parsedBookingForm = JSON.parse(bookingForm);
      } catch (error) {
        console.error("Error parsing booking form:", error);
        parsedBookingForm = [];
      }
    }

    const newService = await ConciergeService.create({
      name,
      description,
      image: imagePath,
      status: status === "on" || status === true,
      bookingForm: parsedBookingForm,
      createdBy: req.admin._id,
    });

    await createActivityLog({
      entityType: "ConciergeService",
      entityId: newService._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "create",
    });

    res.json({
      success: true,
      message: "Concierge service created successfully",
      data: newService,
    });
  } catch (error) {
    console.error(error);
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error("Error deleting uploaded file:", unlinkError);
      }
    }
    res.status(400).json({
      success: false,
      message: error.message.includes("duplicate")
        ? "Concierge service with this name already exists"
        : error.message,
    });
  }
});

const updateConciergeService = asyncHandler(async (req, res) => {
  try {
    const { name, description, status, bookingForm } = req.body;
    const { id } = req.params;

    if (!name) {
      // Delete uploaded file if validation fails
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    // Check for duplicate name (excluding current service)
    const existingService = await ConciergeService.findOne({
      name,
      _id: { $ne: id },
    });

    if (existingService) {
      // Delete uploaded file if duplicate found
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: "Another concierge service with this name already exists",
      });
    }

    // Find the existing service
    const service = await ConciergeService.findById(id);
    if (!service) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    // Parse booking form if provided
    let parsedBookingForm = service.bookingForm;
    if (bookingForm) {
      parsedBookingForm = JSON.parse(bookingForm);
    }

    // Update service fields
    service.name = name;
    service.description = description || service.description;
    service.status = status === "on" || status === true;
    service.bookingForm = parsedBookingForm;
    service.updatedBy = req.admin._id;

    // Update image if new file uploaded
    if (req.file) {
      service.image = `/temp/${req.file.filename}`;
    }

    // Save the updated service
    const updatedService = await service.save();

    await createActivityLog({
      entityType: "ConciergeService",
      entityId: updatedService._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "update",
    });

    res.json({
      success: true,
      message: "Concierge service updated successfully",
      data: updatedService,
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      success: false,
      message: "Failed to update status",
    });
  }
});

const updateConciergeServiceStatus = asyncHandler(async (req, res) => {
  try {
    const service = await ConciergeService.findById(req.params.id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    service.status = !service.status;
    await service.save();

    await createActivityLog({
      entityType: "ConciergeService",
      entityId: service._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "status",
    });

    res.json({
      success: true,
      message: "Status updated successfully",
      newStatus: service.status,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to update status",
    });
  }
});

const showConciergeServiceDetails = asyncHandler(async (req, res) => {
  try {
    const service = await ConciergeService.findById(req.params.id).lean();

    if (!service) {
      return res.redirect("/concierge-service");
    }
    res.render("pages/admin/concierge-service/details", {
      sidebar: "conciergeService",
      service,
    });
  } catch (error) {
    console.error(error);
    res.redirect("/concierge-service");
  }
});

const getBookingService = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "",
      serviceId = "",
    } = req.query;

    const query = {};

    if (serviceId) {
      query.serviceId = serviceId;
    }

    if (search) {
      query.$or = [
        { bookingForm: { $regex: search, $options: "i" } },
        { "userId.firstName": { $regex: search, $options: "i" } },
        { "userId.lastName": { $regex: search, $options: "i" } },
      ];
    }

    if (status) {
      query.status = status;
    }

    const bookingServices = await BookingService.find(query)
      .populate("userId", "_id firstName lastName profileImage")
      .populate("booking")
      .populate("serviceId", "name")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const count = await BookingService.countDocuments(query);

    res.json({
      bookingServices,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

const getBookingServiceById = asyncHandler(async (req, res) => {
  try {
    const serviceBooking = await BookingService.findById(req.params.id)
      .populate("userId", "_id firstName lastName email mobile profileImage")
      .populate("booking")
      .populate("eventType")
      .lean();

    res.json({
      data: serviceBooking,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Server Error" });
  }
});

const updateBookingServiceStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updatedBooking = await BookingService.findByIdAndUpdate(
      id,
      {
        status,
      },
      { new: true, runValidators: true }
    ).populate("userId", "_id firstName lastName email");

    if (!updatedBooking) {
      return res.status(404).json({
        success: false,
        message: "Booking service not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Booking status updated successfully",
      data: updatedBooking,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Server Error" });
  }
});

/// ------------- Concierge Services Management End -------------------------///

/// ------------- Amenity Management Start -------------------------///

const listAmenity = asyncHandler(async (req, res) => {
  const amenitys = await Amenity.find({}).sort({ createdAt: -1 }).lean();

  res.render("pages/admin/amenity", {
    sidebar: "amenity",
    amenitys,
  });
});

const showAmenityForm = asyncHandler(async (req, res) => {
  try {
    const isEditMode = req.path.includes("edit");
    let formData = {
      name: "",
      category: "",
      icon: "",
      status: true,
    };
    let formTitle = "Add Amenity";

    if (isEditMode) {
      const amenity = await Amenity.findById(req.params.id);
      if (!amenity) {
        return res.status(404).render("pages/admin/amenity/form", {
          error: "Amenity not found",
          formData,
          formTitle,
          isEditMode,
          sidebar: "amenity",
        });
      }
      formData = {
        id: amenity._id,
        name: amenity.name,
        category: amenity.category,
        status: amenity.status,
        icon: amenity.icon,
      };
      formTitle = "Edit Amenity";
    }

    res.render("pages/admin/amenity/form", {
      formData,
      formTitle,
      isEditMode,
      sidebar: "amenity",
    });
  } catch (error) {
    console.error(error);
    return res.redirect("/amenity");
  }
});

const createAmenity = asyncHandler(async (req, res) => {
  try {
    const { name, category, status } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Name is required" });
    }

    const existingAmenity = await Amenity.findOne({ name });
    if (existingAmenity) {
      return res.status(400).json({
        success: false,
        message: "Amenity with this name already exists",
      });
    }

    const imagePath = req.file ? `/temp/${req.file.filename}` : undefined;

    const amenity = await Amenity.create({
      name,
      category,
      icon: imagePath,
      status: status === "on",
    });

    await createActivityLog({
      entityType: "Amenity",
      entityId: amenity._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "create",
    });

    res.json({ success: true, message: "Amenity created successfully" });
  } catch (error) {
    console.error(error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(400).json({
      success: false,
      message: error.message.includes("duplicate")
        ? "Amenity with this name already exists"
        : error.message,
    });
  }
});

const updateAmenity = asyncHandler(async (req, res) => {
  try {
    const { name, category, status } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Name is required" });
    }

    const existingAmenity = await Amenity.findOne({
      name,
      _id: { $ne: req.params.id },
    });

    if (existingAmenity) {
      return res.status(400).json({
        success: false,
        message: "Another Amenity with this name already exists",
      });
    }

    const amenity = await Amenity.findById(req.params.id);
    if (!amenity) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res
        .status(404)
        .json({ success: false, message: "Amenity not found" });
    }

    amenity.name = name;
    amenity.category = category;
    amenity.status = status === "on";

    if (req.file) {
      amenity.icon = `/temp/${req.file.filename}`;
    }

    await amenity.save();

    await createActivityLog({
      entityType: "Amenity",
      entityId: amenity._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "update",
    });

    res.json({ success: true, message: "Amenity updated successfully" });
  } catch (error) {
    console.error(error);
    if (req.file) fs.unlinkSync(req.file.path);

    res.status(400).json({
      success: false,
      message: error.message.includes("duplicate")
        ? "amenity with this name already exists"
        : error.message,
    });
  }
});

const updateAmenityStatus = asyncHandler(async (req, res) => {
  try {
    const amenity = await Amenity.findById(req.params.id);

    if (!amenity) {
      return res.status(404).json({
        success: false,
        message: "Amenity not found",
      });
    }

    amenity.status = !amenity.status;
    await amenity.save();

    await createActivityLog({
      entityType: "Amenity",
      entityId: amenity._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "status",
    });

    res.json({
      success: true,
      message: "Status updated successfully",
      newStatus: amenity.status,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to update status",
    });
  }
});

const listAmenityRequest = asyncHandler(async (req, res) => {
  const list = await AmenityRequest.find({})
    .populate("user")
    .sort({ createdAt: -1 })
    .lean();

  res.render("pages/admin/amenity/request", {
    sidebar: "amenityRequest",
    list,
  });
});

const updateAmenityRequestStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { status, responseMessage } = req.body;

    // Validate status
    if (!["Approved", "Rejected"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    const updatedRequest = await AmenityRequest.findByIdAndUpdate(
      id,
      {
        reqStatus: status,
        responseMessage: responseMessage,
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (!updatedRequest) {
      return res
        .status(404)
        .json({ success: false, message: "Request not found" });
    }

    await createNotification({
      recipientId: updatedRequest.user,
      recipientRole: "host",
      senderId: req.admin._id,
      senderRole: "admin",
      title: `Amenity Request ${status}`,
      message: `Your amenity request has been ${status.toLowerCase()}. ${
        status == "Rejected" ? "reason" : ""
      } ${responseMessage}`,
      notificationType: "amenity",
      metadata: {
        requestId: updatedRequest._id,
        status: status,
        updatedAt: new Date(),
      },
    });

    await createActivityLog({
      entityType: "AmenityRequest",
      entityId: updatedRequest._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "status",
    });

    return res.status(200).json({
      success: true,
      message: "Status updated successfully",
    });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

const updateAmenityRequestDetails = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const amenity = await AmenityRequest.findById(id)
      .populate("user", "firstName lastName profileImage")
      .lean();

    if (!amenity) {
      return res.status(404).json({
        success: false,
        message: "Amenity request not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: amenity,
    });
  } catch (error) {
    console.error("Error fetching amenity details:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/// ------------- Amenity Management End -------------------------///

/// ------------- Event Management Start -------------------------///

const listEvent = asyncHandler(async (req, res) => {
  const eventCategorys = await EventCategory.find({ status: true }).lean();
  return res.render("pages/admin/event-management/event", {
    sidebar: "event",
    eventCategorys,
  });
});

const getFilteredEvents = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 8,
      createdBy,
      eventType,
      date,
      category,
      sort = "desc",
      minAmount,
      maxAmount,
      status = "upcoming",
    } = req.query;

    // Build query
    const query = {};

    if (status) {
      query.status = status;
    }

    // Created by filter
    if (createdBy && createdBy !== "all") {
      query["createdBy.role"] = createdBy;
    }

    // Date filter
    if (date) {
      const selectedDate = new Date(date);
      const nextDay = new Date(selectedDate);
      nextDay.setDate(nextDay.getDate() + 1);

      query.$and = [
        { startDate: { $lt: nextDay } },
        { endDate: { $gte: selectedDate } },
      ];
    }

    // Category filter
    if (category && category !== "all") {
      query.categoryId = category;
    }

    // Event type filter
    if (eventType && eventType !== "all") {
      query.eventType = eventType;
    }

    // Price range filter
    if (minAmount || maxAmount) {
      query.price = {};
      if (minAmount) query.price.$gte = Number(minAmount);
      if (maxAmount) query.price.$lte = Number(maxAmount);
    }

    // Get total count
    const totalEvents = await Event.countDocuments(query);

    // Get paginated events
    const events = await Event.find(query)
      .populate("categoryId", "name")
      .sort({ createdAt: sort === "asc" ? 1 : -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      events,
      totalEvents,
      currentPage: Number(page),
      totalPages: Math.ceil(totalEvents / limit),
    });
  } catch (error) {
    console.error("Error getting filtered events:", error);
    return res.status(500).json(new ApiError(500, "Internal server error"));
  }
});

const showEventForm = asyncHandler(async (req, res) => {
  try {
    const eventCategories = await EventCategory.find({ status: true }).lean();
    const isEditMode = req.path.includes("edit");
    let formData = {
      title: "",
      categoryId: "",
      eventType: "public",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      startTime: new Date().toISOString().slice(11, 16),
      endTime: new Date().toISOString().slice(11, 16),
      maxParticipants: 20,
      ageRestriction: 18,
      eventLanguage: [],
      includedItems: [],
      whatToBring: [],
      location: {
        address: "",
        coordinates: [75.7872709, 26.9124336],
      },
      price: 0,
      currency: "INR",
      description: "",
      images: [],
      video: null,
      safetyInfo: [],
      termsAgreement: "",
      organizer: {
        firstName: "",
        lastName: "",
        email: "",
        mobileNumber: "",
      },
      status: "upcoming",
    };
    let formTitle = "Add New Event";

    if (isEditMode) {
      const event = await Event.findById(req.params.id).lean();
      if (!event) {
        return res
          .status(404)
          .render("pages/admin/event-management/event/form", {
            error: "Event not found",
            formData,
            formTitle,
            isEditMode,
            eventCategories,
            sidebar: "event",
          });
      }

      const startDate = new Date(event.startDate);
      const endDate = new Date(event.endDate);

      formData = {
        ...event,
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        _id: event._id,
      };
      formTitle = "Edit Event";
    }

    res.render("pages/admin/event-management/event/form", {
      formData,
      formTitle,
      isEditMode,
      eventCategories,
      sidebar: "event",
    });
  } catch (error) {
    console.error(error);
    return res.redirect("/event");
  }
});

const saveEvent = asyncHandler(async (req, res) => {
  try {
    const {
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
      location,
      price,
      currency,
      description,
      safetyInfo,
      termsAgreement,
      organizerFirstName,
      organizerLastName,
      organizerEmail,
      organizerMobile,
      status,
    } = req.body;

    // Basic validation
    if (
      !title ||
      !categoryId ||
      !eventType ||
      !startDate ||
      !endDate ||
      !startTime ||
      !endTime
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Title, category, event type, start date, end date, start time, and end time are required",
      });
    }

    // Process arrays from form data
    const processArrayField = (field) => {
      if (!field) return [];
      if (typeof field === "string") {
        return field
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return Array.isArray(field) ? field.filter(Boolean) : [];
    };

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
      maxParticipants: parseInt(maxParticipants) || 20,
      ageRestriction: parseInt(ageRestriction) || 18,
      eventLanguage: processArrayField(eventLanguage),
      includedItems: processArrayField(includedItems),
      whatToBring: processArrayField(whatToBring),
      location: {
        address: location.address,
        type: "Point",
        coordinates: Array.isArray(location.coordinates)
          ? location.coordinates
          : JSON.parse(location.coordinates || "[0, 0]"),
      },
      price: parseFloat(price) || 0,
      currency: currency || "INR",
      description,
      safetyInfo: processArrayField(safetyInfo),
      termsAgreement,
      organizer: {
        firstName: organizerFirstName,
        lastName: organizerLastName,
        email: organizerEmail,
        mobileNumber: organizerMobile,
      },
      status: status || "upcoming",
    };

    // Handle images
    const images = [];

    // Parse removeImages properly
    let removeImages = [];

    if (req.body.removeImages) {
      try {
        // Check if it's already an array
        if (Array.isArray(req.body.removeImages)) {
          removeImages = req.body.removeImages;
        }
        // Check if it's a JSON string that can be parsed
        else if (typeof req.body.removeImages === "string") {
          // Try to parse as JSON array first
          try {
            const parsed = JSON.parse(req.body.removeImages);
            removeImages = Array.isArray(parsed) ? parsed : [parsed];
          } catch (parseError) {
            // If JSON parsing fails, treat it as a single string value
            removeImages = [req.body.removeImages];
          }
        }
        // Handle other cases
        else {
          removeImages = [req.body.removeImages];
        }

        // Final safety check to ensure it's an array
        if (!Array.isArray(removeImages)) {
          removeImages = [removeImages];
        }
      } catch (err) {
        console.error("Error parsing removeImages:", err);
        removeImages = [];
      }
    } else {
      console.log("No removeImages found in request");
    }

    // Process existing images - only in edit mode
    if (req.body.existingImages) {
      try {
        let existingImages = [];

        // Parse existingImages based on its type
        if (Array.isArray(req.body.existingImages)) {
          existingImages = req.body.existingImages;
        } else if (typeof req.body.existingImages === "string") {
          try {
            // Try to parse as JSON first
            const parsed = JSON.parse(req.body.existingImages);
            existingImages = Array.isArray(parsed) ? parsed : [parsed];
          } catch (parseError) {
            // If JSON parsing fails, treat it as a single string value
            existingImages = [req.body.existingImages];
          }
        } else {
          existingImages = [req.body.existingImages];
        }

        // Final safety check to ensure it's an array
        if (!Array.isArray(existingImages)) {
          existingImages = [existingImages];
        }

        // Process each existing image
        existingImages.forEach((img) => {
          // Handle both object format {url: "...", isFeatured: true} and string format
          let imageUrl = "";
          let imageObj = {};

          if (typeof img === "string") {
            imageUrl = img;
            imageObj = { url: imageUrl, isFeatured: false };
          } else if (img && typeof img === "object" && img.url) {
            imageUrl = img.url;
            imageObj = { ...img, isFeatured: img.isFeatured || false };
          }

          if (imageUrl) {
            // Extract just the path from the URL if it's a full URL
            if (imageUrl.includes("://")) {
              try {
                const urlObj = new URL(imageUrl);
                imageObj.url = urlObj.pathname;
              } catch (e) {
                console.error("Error parsing image URL:", imageUrl, e);
              }
            }

            // Check if this image should be removed (ensure removeImages is array)
            const shouldRemove =
              Array.isArray(removeImages) &&
              removeImages.some((removeUrl) => removeUrl === imageObj.url);

            if (!shouldRemove) {
              images.push(imageObj);
            } else {
              console.log("Removing image:", imageObj.url);
            }
          }
        });
      } catch (err) {
        console.error("Error parsing existingImages:", err);
      }
    }

    // Process new uploaded images
    if (req.files?.images) {
      const files = Array.isArray(req.files.images)
        ? req.files.images
        : [req.files.images];

      files.forEach((file) => {
        // Only add if file has a filename
        if (file.filename) {
          images.push({
            url: `/temp/${file.filename}`,
            isFeatured: false, // will handle later
          });
        }
      });
    }

    // Ensure we have at least one image
    if (images.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one image is required",
      });
    }

    // Ensure first image is featured
    images.forEach((img, i) => {
      img.isFeatured = i === 0;
    });

    // Assign to event data
    eventData.images = images;

    // Process new uploaded video (only one)
    if (req.files?.videos && req.files.videos.length > 0) {
      const videoFile = Array.isArray(req.files.videos)
        ? req.files.videos[0]
        : req.files.videos;
      eventData.video = `/temp/${videoFile.filename}`;
    }

    // Create or update event
    let event;
    if (req.params.id) {
      event = await Event.findByIdAndUpdate(req.params.id, eventData, {
        new: true,
      });

      await createActivityLog({
        entityType: "Event",
        entityId: event._id,
        userId: req.admin._id,
        userRole: "admin",
        action: "update",
      });
    } else {
      event = await Event.create({
        ...eventData,
        createdBy: {
          userId: req.admin._id,
          role: "admin",
        },
      });

      await createActivityLog({
        entityType: "Event",
        entityId: event._id,
        userId: req.admin._id,
        userRole: "admin",
        action: "create",
      });
    }

    res.json({
      success: true,
      message: req.params.id
        ? "Event updated successfully"
        : "Event created successfully",
      eventId: event._id,
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      success: false,
      message: error.message.includes("duplicate")
        ? "Event with this title already exists"
        : error.message,
    });
  }
});

const showEventDetails = asyncHandler(async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate("categoryId", "name")
      .populate(
        "createdBy.userId",
        "firstName lastName email profileImage hostVerified"
      ) // Populate creator details
      .lean();

    if (!event) {
      return res.redirect("/event");
    }

    const ratings = await EventRating.find({ eventId: event._id })
      .populate("userId", "firstName lastName profileImage")
      .sort({ createdAt: -1 }) // Sort by newest first
      .lean();

    // Calculate average rating
    const averageRating =
      ratings.length > 0
        ? (
            ratings.reduce((sum, rating) => sum + rating.rating, 0) /
            ratings.length
          ).toFixed(1)
        : 0;

    res.render("pages/admin/event-management/event/show", {
      sidebar: "event",
      event,
      ratings,
      averageRating,
      ratingCount: ratings.length,
    });
  } catch (error) {
    console.error(error);
    res.redirect("/event");
  }
});

const showEventMemberList = asyncHandler(async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate("categoryId", "name")
      .populate("createdBy.userId", "firstName lastName email profileImage")
      .lean();

    if (!event) {
      return res.redirect("/event");
    }

    const bookings = await BookingEvent.find({ event: req.params.id })
      .populate("bookingBy.user", "firstName lastName email profileImage")
      .sort({ bookingDate: -1 })
      .lean();

    // Calculate total attendees
    const baseAmount = bookings.reduce((sum, booking) => {
      return booking.paymentDetails.status === "paid"
        ? sum + booking.paymentDetails.baseAmount
        : sum;
    }, 0);

    const taxAmount = bookings.reduce((sum, booking) => {
      return booking.paymentDetails.status === "paid"
        ? sum + booking.paymentDetails.taxAmount
        : sum;
    }, 0);

    const totalAmount = bookings.reduce((sum, booking) => {
      return booking.paymentDetails.status === "paid"
        ? sum + booking.paymentDetails.totalAmount
        : sum;
    }, 0);

    const refundAmount = bookings.reduce((sum, booking) => {
      return booking.paymentDetails.status === "refunded"
        ? sum + booking.paymentDetails.refundAmount
        : sum;
    }, 0);

    res.render("pages/admin/event-management/event/member", {
      sidebar: "event",
      event,
      bookings,
      baseAmount,
      taxAmount,
      refundAmount,
      totalAmount,
      helpers: {
        paymentStatusBadge: (status) => {
          const statusClass = {
            pending: "bg-label-warning",
            completed: "bg-label-success",
            failed: "bg-label-danger",
            refunded: "bg-label-info",
          };
          return `<span class="badge ${
            statusClass[status] || "bg-label-secondary"
          }">${status}</span>`;
        },
        bookingStatusBadge: (status) => {
          const statusClass = {
            pending: "bg-label-warning",
            confirmed: "bg-label-primary",
            cancelled: "bg-label-danger",
            completed: "bg-label-success",
          };
          return `<span class="badge ${
            statusClass[status] || "bg-label-secondary"
          }">${status}</span>`;
        },
      },
    });
  } catch (error) {
    console.error(error);
    res.redirect("/event");
  }
});

const getEventBookingDetails = asyncHandler(async (req, res) => {
  try {
    const booking = await BookingEvent.findById(req.params.id)
      .populate("transactionLogId")
      .populate("bookingBy.user", "firstName lastName email phone profileImage")
      .lean();

    if (!booking) {
      return res.status(404).send("Booking not found");
    }
    const rating = await EventRating.findOne({ bookingId: booking._id }).lean();

    // return res.status(200).json({ booking, rating });
    return res.status(200).json( new ApiResponse(200, { booking, rating }, "Event Details get successfully"));
  } catch (error) {
    console.error("Error getting filtered events:", error);
    return res.status(500).json(new ApiError(500, "Internal server error"));
  }
});

const cancelRequestUpdate = asyncHandler(async (req, res) => {
  const { eventId } = req.params;

  const event = await Event.findById(eventId);
  if (!event) {
    return res.status(404).json(new ApiError(404, "Event not found"));
  }

  if (!event.cancelRequest) {
    return res
      .status(400)
      .json(new ApiError(400, "No cancellation request exists"));
  }

  if (event.status === "cancelled") {
    return res
      .status(400)
      .json(new ApiError(400, "Event is already cancelled"));
  }

  // Approve cancellation
  event.status = "cancelled";
  event.cancelledAt = new Date();
  await event.save();

  // Fetch bookings
  const bookings = await BookingEvent.find({ event: eventId });

  // Get Host Wallet
  const hostWallet = await getOrCreateWallet(
    event.createdBy.userId,
    event.createdBy.role
  );

  let refundTotalAmount = 0;

  // Refund confirmed guest bookings
  for (const booking of bookings) {
    if (booking.bookingBy.role === "guest" && booking.status === "confirmed") {
      const guestWallet = await getOrCreateWallet(
        booking.bookingBy.user,
        booking.bookingBy.role
      );

      // Refund transaction
      await WalletTransaction.create({
        walletId: guestWallet._id,
        amount: Number(booking.paymentDetails.totalAmount),
        transactionType: "refund",
        status: "completed",
        bookingId: booking._id,
        bookingType: "event",
        metadata: {
          totalAmount: Number(booking.paymentDetails.totalAmount),
        },
      });

      guestWallet.balance += Number(booking.paymentDetails.totalAmount);
      await guestWallet.save();

      booking.paymentDetails.refundAmount = Number(booking.paymentDetails.totalAmount);
      booking.paymentDetails.status = "refunded";
      await booking.save();

      refundTotalAmount += booking.paymentDetails.baseAmount;

      // Notify guest
      await createNotification({
        recipientId: booking.bookingBy.user,
        recipientRole: "guest",
        senderId: req.admin._id,
        senderRole: "admin",
        title: "Event Cancelled",
        message: `Your booking for event "${event.title}" has been cancelled. Your payment has been refunded.`,
        notificationType: "event",
        actionId: event._id,
        actionUrl: `/guest/events/${event._id}`,
        metadata: {
          eventId: event._id,
          eventTitle: event.title,
          cancellationReason: event.cancellationReason,
          cancelledBy: event.cancelledBy,
          cancelledAt: new Date(),
        },
      });
    }
  }

  // Deduct from host wallet
  if (refundTotalAmount > 0) {
    await WalletTransaction.create({
      walletId: hostWallet._id,
      amount: refundTotalAmount,
      transactionType: "refund",
      status: "completed",
      bookingType: "event",
      metadata: {
        totalAmount: refundTotalAmount,
      },
    });

    hostWallet.holdBalance = Math.max(
      0,
      hostWallet.holdBalance - refundTotalAmount
    );
    await hostWallet.save();
  }

  // Notify host
  await createNotification({
    recipientId: event.createdBy.userId,
    recipientRole: "host",
    senderId: req.admin._id,
    senderRole: "admin",
    title: "Event Cancellation Approved",
    message: `Your cancellation request for event "${event.title}" has been approved by the admin.`,
    notificationType: "event",
    actionId: event._id,
    actionUrl: `/host/events/${event._id}`,
    metadata: {
      eventId: event._id,
      eventTitle: event.title,
      status: "cancelled",
      cancellationReason: event.cancellationReason,
      cancelledBy: event.cancelledBy,
      approvedAt: new Date(),
    },
  });

  // Activity log
  await createActivityLog({
    entityType: "Event",
    entityId: event._id,
    userId: req.admin._id,
    userRole: "admin",
    action: "cancelApproved",
  });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        null,
        "Cancellation request approved and event cancelled"
      )
    );
});

const eventCancel = asyncHandler(async (req, res) => {
  const { eventId, reason } = req.body;

  const event = await Event.findById(eventId);
  if (!event) {
    return res.status(404).json(new ApiError(404, "Event not found"));
  }

  if (event.status === "cancelled") {
    return res
      .status(400)
      .json(new ApiError(400, "Event is already cancelled"));
  }

  // Update event
  event.status = "cancelled";
  event.cancellationReason = reason;
  event.cancelledAt = new Date();
  event.cancelledBy = {
    userId: req.admin._id,
    role: "admin",
  };
  await event.save();

  // Fetch bookings
  const bookings = await BookingEvent.find({ event: eventId });

  // Get Host Wallet
  const hostWallet = await getOrCreateWallet(
    event.createdBy.userId,
    event.createdBy.role
  );

  let refundTotalAmount = 0;
  let totaltaxAmount = 0;

  // ✅ Loop bookings safely
  for (const booking of bookings) {
    if (booking.bookingBy.role === "guest" && booking.status === "confirmed") {
      const guestWallet = await getOrCreateWallet(
        booking.bookingBy.user,
        booking.bookingBy.role
      );

      // Refund transaction for guest
      await WalletTransaction.create({
        walletId: guestWallet._id,
        amount: Number(booking.paymentDetails.totalAmount),
        transactionType: "refund",
        status: "completed",
        bookingId: booking._id,
        bookingType: "event",
        metadata: {
          totalAmount: Number(booking.paymentDetails.totalAmount),
        },
      });

      guestWallet.balance += Number(booking.paymentDetails.totalAmount);
      await guestWallet.save();

      booking.paymentDetails.refundAmount = Number(booking.paymentDetails.totalAmount);
      booking.paymentDetails.status = "refunded";
      await booking.save();

      refundTotalAmount += booking.paymentDetails.baseAmount;
      totaltaxAmount += booking.paymentDetails.taxAmount;

      // Notify guest
      await createNotification({
        recipientId: booking.bookingBy.user,
        recipientRole: "guest",
        senderId: req.admin._id,
        senderRole: "admin",
        title: "Event Cancelled by Admin",
        message: `Your booking for event "${event.title}" has been cancelled by the admin. Reason: ${reason}`,
        notificationType: "event",
        actionId: event._id,
        actionUrl: `/guest/events/${event._id}`,
        metadata: {
          eventId: event._id,
          eventTitle: event.title,
          cancellationReason: reason,
          cancelledBy: {
            adminId: req.admin._id,
            adminName: `${req.admin.firstName} ${req.admin.lastName}`,
          },
          cancelledAt: new Date(),
        },
      });
    }
  }

  // Deduct from host wallet
  if (refundTotalAmount > 0) {
    await WalletTransaction.create({
      walletId: hostWallet._id,
      amount: refundTotalAmount,
      transactionType: "refund",
      status: "completed",
      bookingType: "event",
      metadata: {
        totalAmount: refundTotalAmount,
      },
    });

    hostWallet.holdBalance = Math.max(
      0,
      hostWallet.holdBalance - refundTotalAmount
    );
    hostWallet.commission = Math.max(0, hostWallet.commission - totaltaxAmount);
    await hostWallet.save();
  }

  // Notify host
  if (event.createdBy.role === "host") {
    await createNotification({
      recipientId: event.createdBy.userId,
      recipientRole: "host",
      senderId: req.admin._id,
      senderRole: "admin",
      title: "Event Cancelled by Admin",
      message: `Your event "${event.title}" has been cancelled by the admin. Reason: ${reason}`,
      notificationType: "event",
      actionId: event._id,
      actionUrl: `/host/events/${event._id}`,
      metadata: {
        eventId: event._id,
        eventTitle: event.title,
        cancellationReason: reason,
        cancelledBy: {
          adminId: req.admin._id,
          adminName: `${req.admin.firstName} ${req.admin.lastName}`,
        },
        cancelledAt: new Date(),
      },
    });
  }

  // Activity log
  await createActivityLog({
    entityType: "Event",
    entityId: event._id,
    userId: req.admin._id,
    userRole: "admin",
    action: "cancelAdmin",
  });

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Event cancelled by admin"));
});

const eventBooking = asyncHandler(async (req, res) => {
  const { eventId, numberOfAttendees } = req.body;

  const event = await Event.findById(eventId);
  if (!event) {
    return res.status(400).json({ success: false, message: "Event not found" });
  }

  if (
    parseInt(event.currentAttendees) + parseInt(numberOfAttendees) >
    event.maxParticipants
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Not enough available spots" });
  }

  if (event.status == "cancelled") {
    return res
      .status(400)
      .json({ success: false, message: "Event is cancelled" });
  }

  if (event.status == "completed") {
    return res
      .status(400)
      .json({ success: false, message: "Event is completed" });
  }

  const setting = await Setting.findOne().lean();
  const baseAmount = (event.price || 0) * Number(numberOfAttendees);
  const platformFeePercentage = setting.fees.event;
  const platformFee = (baseAmount * platformFeePercentage) / 100;
  const totalAmount = baseAmount + platformFee;

  const newBooking = await BookingEvent.create({
    event: eventId,
    bookingBy: {
      user: req.admin._id,
      role: "admin",
    },
    numberOfAttendees,
    paymentDetails: {
      baseAmount: event.price,
      taxAmount: platformFee,
      totalAmount,
    },
    status: "confirmed",
  });

  // Update event attendance count
  event.currentAttendees += parseInt(numberOfAttendees);
  await event.save();

  await createActivityLog({
    entityType: "Event",
    entityId: eventId,
    userId: req.admin._id,
    userRole: "admin",
    action: "booking",
  });

  const organizer = event.createdBy;
  // await createNotification({
  //     recipientId: organizer.userId,
  //     recipientRole: organizer.role,
  //     senderId: req.admin._id,
  //     title: 'New Event Booking Received',
  //     message: `admin booked ${numberOfAttendees} ` +
  //               `spot${numberOfAttendees > 1 ? 's' : ''} for your event "${event.title}"`,
  //     notificationType: 'event_booking',
  //     actionId: eventId,
  //     metadata: {
  //         bookingId: newBooking._id,
  //         attendeesCount: numberOfAttendees,
  //     }
  // });

  return res
    .status(201)
    .json({ success: true, message: "Booking created successfully" });
});

/// ------------- Event Management End -------------------------///

/// ------------- Event Category Management Start -------------------------///

const listEventCategory = asyncHandler(async (req, res) => {
  const eventCategorys = await EventCategory.find().lean();

  return res.render("pages/admin/event-management/category", {
    sidebar: "eventCategory",
    eventCategorys,
  });
});

const showEventCategoryForm = asyncHandler(async (req, res) => {
  try {
    const isEditMode = req.path.includes("edit");
    let formData = {
      name: "",
      description: "",
      status: true,
    };
    let formTitle = "Add Event Category";

    if (isEditMode) {
      const eventCategory = await EventCategory.findById(req.params.id);
      if (!eventCategory) {
        return res
          .status(404)
          .render("pages/admin/event-management/category/form", {
            error: "Event Category not found",
            formData,
            formTitle,
            isEditMode,
            sidebar: "eventCategory",
          });
      }
      formData = {
        id: eventCategory._id,
        name: eventCategory.name,
        description: eventCategory.description,
        image: eventCategory.image,
        status: eventCategory.status,
      };
      formTitle = "Edit Event Category";
    }

    res.render("pages/admin/event-management/category/form", {
      formData,
      formTitle,
      isEditMode,
      sidebar: "eventCategory",
    });
  } catch (error) {
    console.error(error);
    return res.redirect("/event/category");
  }
});

const createEventCategory = asyncHandler(async (req, res) => {
  try {
    const { name, description, status } = req.body;
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Name are required" });
    }

    const existingType = await EventCategory.findOne({ name });
    if (existingType) {
      return res.status(400).json({
        success: false,
        message: "Event Category with this name already exists",
      });
    }

    const imagePath = req.file ? `/temp/${req.file.filename}` : undefined;

    const eventCategory = await EventCategory.create({
      name,
      description,
      image: imagePath,
      status: status ? true : false,
      createdBy: req.admin._id,
    });

    await createActivityLog({
      entityType: "EventCategory",
      entityId: eventCategory._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "create",
    });

    res.json({ success: true, message: "Event Category created successfully" });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      success: false,
      message: error.message.includes("duplicate")
        ? "Event Category with this name already exists"
        : error.message,
    });
  }
});

const updateEventCategory = asyncHandler(async (req, res) => {
  try {
    const { name, description, status } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name are required",
      });
    }

    const existingType = await EventCategory.findOne({
      name,
      _id: { $ne: req.params.id }, // Exclude current record
    });

    if (existingType) {
      return res.status(400).json({
        success: false,
        message: "Another Event Category with this name already exists",
      });
    }

    const updateData = {
      name,
      description,
      status: status ? true : false,
      updatedBy: req.admin._id,
    };

    if (req.file) {
      updateData.image = `/temp/${req.file.filename}`;
    }

    await EventCategory.findByIdAndUpdate(req.params.id, updateData);

    await createActivityLog({
      entityType: "EventCategory",
      entityId: req.params.id,
      userId: req.admin._id,
      userRole: "admin",
      action: "update",
    });

    res.json({ success: true, message: "Event Category updated successfully" });
  } catch (error) {
    console.error(error);
    // Delete uploaded file if error occurred
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({
      success: false,
      message: error.message.includes("duplicate")
        ? "Event Category with this name already exists"
        : error.message,
    });
  }
});

const updateEventCategoryStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const eventCategory = await EventCategory.findById(id);

    if (!eventCategory) {
      return res.status(404).json({
        success: false,
        message: "Event Category not found",
      });
    }

    eventCategory.status = !eventCategory.status;
    await eventCategory.save();

    await createActivityLog({
      entityType: "EventCategory",
      entityId: id,
      userId: req.admin._id,
      userRole: "admin",
      action: "status",
    });

    res.json({
      success: true,
      message: "Status updated successfully",
      newStatus: eventCategory.status,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to update status",
    });
  }
});

const showEventCategoryDetails = asyncHandler(async (req, res) => {
  try {
    const eventCategory = await EventCategory.findById(req.params.id).lean();

    if (!eventCategory) {
      return res.redirect("/event/category");
    }

    res.render("pages/admin/event-management/category/details", {
      sidebar: "eventCategory",
      eventCategory,
    });
  } catch (error) {
    console.error(error);
    res.redirect("/event/category");
  }
});

/// ------------- Event Category Management End -------------------------///

/// ------------- Contact Enquiry Management Start -------------------------///

const contactEnquiry = asyncHandler(async (req, res) => {
  const types = await ContactEnquiryType.find().lean();
  return res.render("pages/admin/contact-enquiry", {
    sidebar: "contactEnquiry",
    contactTypes: types,
  });
});

const getContactEnquiries = asyncHandler(async (req, res) => {
  const { status, type, search } = req.query;

  const query = {};

  if (status && status !== "all") {
    query.status = status;
  }

  if (type && type !== "all") {
    query.type = type;
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { phoneNumber: { $regex: search, $options: "i" } },
      { type: { $regex: search, $options: "i" } },
    ];
  }

  const enquiries = await ContactEnquiry.find(query)
    .populate("type", "name")
    .sort({ createdAt: -1 })
    .lean();

  res.json(enquiries);
});

const getContactEnquiryDetails = asyncHandler(async (req, res) => {
  const enquiry = await ContactEnquiry.findById(req.params.id)
    .populate("userId", "firstName lastName email profileImage")
    .populate("type", "name")
    .lean();

  if (!enquiry) {
    return res.status(404).json({ message: "Enquiry not found" });
  }

  res.json(enquiry);
});

const updateEnquiryStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, response } = req.body;

  // Create update object conditionally
  const updateData = {
    $push: {
      responses: {
        message: response,
        respondedBy: req.admin._id,
        respondedAt: new Date(),
      },
    },
  };

  // Only add status to update if it was provided
  if (status) {
    updateData.status = status;
  }

  const enquiry = await ContactEnquiry.findByIdAndUpdate(id, updateData, {
    new: true,
  });

  if (!enquiry) {
    return res.status(404).json({ message: "Enquiry not found" });
  }

  await createActivityLog({
    entityType: "ContactEnquiry",
    entityId: id,
    userId: req.admin._id,
    userRole: "admin",
    action: "update",
  });

  res.json(enquiry);
});

const contactEnquiryTypeList = asyncHandler(async (req, res) => {
  const contactEnquiryTypes = await ContactEnquiryType.find().sort({ name: 1 });
  return res.render("pages/admin/setting/contact-enquiry-type/index", {
    sidebar: "contact-enquiry-type",
    contactEnquiryTypes,
  });
});

const createContactEnquiryType = asyncHandler(async (req, res) => {
  const { name, status } = req.body;

  const nameExist = await ContactEnquiryType.findOne({ name });
  if (nameExist) {
    return res.status(400).json({
      success: false,
      message: "Contact Enquiry Type name already exists",
    });
  }

  await ContactEnquiryType.create({ name, status });
  return res.json({
    success: true,
    message: "Contact Enquiry Type created successfully",
  });
});

const updateContactEnquiryType = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, status } = req.body;

  const enquiryType = await ContactEnquiryType.findById(id);
  if (!enquiryType) {
    return res
      .status(404)
      .json({ success: false, message: "Contact Enquiry Type not found" });
  }

  const nameExist = await ContactEnquiryType.findOne({
    name,
    _id: { $ne: id },
  });
  if (nameExist) {
    return res.status(400).json({
      success: false,
      message: "Contact Enquiry Type name already exists",
    });
  }

  enquiryType.name = name;
  enquiryType.status = status;
  await enquiryType.save();

  return res.json({
    success: true,
    message: "Contact Enquiry Type updated successfully",
  });
});

const updateStatusContactEnquiryType = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const enquiryType = await ContactEnquiryType.findById(id);
  if (!enquiryType) {
    return res
      .status(404)
      .json({ success: false, message: "Contact Enquiry Type not found" });
  }

  enquiryType.status = status;
  await enquiryType.save();

  return res.json({ success: true, message: "Status updated successfully" });
});

/// ------------- Contact Enquiry Management End -------------------------///

/// ------------- Setting Management Start -------------------------///

const getSetting = asyncHandler(async (req, res) => {
  const settings = await Setting.findOne();
  return res.render("pages/admin/setting", {
    sidebar: "setting",
    settings,
  });
});

const updateSetting = asyncHandler(async (req, res) => {
  try {
    const { email, address, location, phone, socialMedia, fees, seo } = req.body;

    // Initialize logo with existing value or empty string
    let logo = req.body.existingLogo || "";

    // If new file uploaded, update logo path
    if (req.file) {
      logo = `/temp/${req.file.filename}`; // Adjust path as per your storage setup
    }

    // Update settings
    const settings = await Setting.findOneAndUpdate(
      {},
      {
        email,
        address,
        location,
        phone,
        logo,
        fees,
        socialMedia,
        seo,
      },
      { new: true, upsert: true }
    );

    // Create activity log
    await createActivityLog({
      entityType: "Setting",
      entityId: settings._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "update",
    });

    // Define date range for calendar updates
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1); // One year from now

    // Fetch all properties
    const properties = await Property.find({}).select('_id pricing').lean();

    // Get property fee percentage from updated settings
    const propertyFeePercentage = fees?.property || 0;

    // Defer calendar processing to background
    setImmediate(async () => {
      for (const property of properties) {
        try {
          // Seed property calendar
          await seedPropertyCalendar(
            property,
            startDate,
            endDate,
            propertyFeePercentage
          );

          // Re-price available base/weekend rows
          await repriceFutureCalendarWindow(
            property,
            startDate,
            endDate,
            propertyFeePercentage
          );
        } catch (error) {
          console.error(`Error updating calendar for property ${property._id}:`, error.message);
          // Continue with next property
        }
      }
      console.log(`Completed calendar updates for ${properties.length} properties`);
    });

    // Return response immediately
    res.status(200).json({
      success: true,
      message: "Settings updated successfully, calendar updates are being processed in the background",
      settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update settings",
      error: error.message,
    });
  }
});

const faqList = asyncHandler(async (req, res) => {
  const faqs = await FAQ.find().sort({ order: 1 });
  return res.render("pages/admin/setting/faq", {
    sidebar: "faqs",
    faqs,
  });
});

const createFAQ = asyncHandler(async (req, res) => {
  try {
    const { question, answer, type = "general", isActive, order } = req.body;

    const faq = await FAQ.create({
      question,
      answer,
      type,
      isActive: isActive ? true : false,
      order: order || 0,
    });

    await createActivityLog({
      entityType: "FAQ",
      entityId: faq._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "create",
    });

    res.status(201).json({
      success: true,
      message: "FAQ created successfully",
      faq,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to create FAQ",
      error: error.message,
    });
  }
});

const updateFAQ = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer, type = "general", isActive, order } = req.body;

    const faq = await FAQ.findByIdAndUpdate(
      id,
      {
        question,
        answer,
        type,
        isActive: isActive ? true : false,
        order,
      },
      { new: true }
    );

    if (!faq) {
      return res.status(404).json({
        success: false,
        message: "FAQ not found",
      });
    }

    await createActivityLog({
      entityType: "FAQ",
      entityId: faq._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "update",
    });

    res.status(200).json({
      success: true,
      message: "FAQ updated successfully",
      faq,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update FAQ",
      error: error.message,
    });
  }
});

const deleteFAQ = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const faq = await FAQ.findByIdAndDelete(id);

    if (!faq) {
      return res.status(404).json({
        success: false,
        message: "FAQ not found",
      });
    }

    await createActivityLog({
      entityType: "FAQ",
      entityId: faq._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "delete",
    });

    res.status(200).json({
      success: true,
      message: "FAQ deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete FAQ",
      error: error.message,
    });
  }
});

const pagesList = asyncHandler(async (req, res) => {
  const pages = await Pages.find().sort({ pageType: 1 });
  res.render("pages/admin/setting/pages", {
    title: "Page Management",
    pages,
    sidebar: "pages",
  });
});

const getPage = asyncHandler(async (req, res) => {
  if (req.params.pageType == "home") {
    const page = await Pages.findOne({ pageType: req.params.pageType })
      .populate("selectedItems.propertyTypes.selectedTypes")
      .populate("selectedItems.services.selectedServices")
      .populate("selectedItems.events.selectedEvents");

    const propertyTypes = await PropertyType.find({ status: true }).lean();
    const services = await ConciergeService.find({ status: true }).lean();
    const events = await EventCategory.find({ status: true }).lean();

    if (!page) {
      return res.redirect("/pages");
    }

    // Mark selected items
    const markSelected = (items, selectedItems) => {
      const selectedIds = selectedItems?.map((i) => i._id.toString()) || [];
      return items.map((item) => ({
        ...item,
        isSelected: selectedIds.includes(item._id.toString()),
      }));
    };

    const processedPropertyTypes = markSelected(
      propertyTypes,
      page.selectedItems?.propertyTypes?.selectedTypes
    );
    const processedServices = markSelected(
      services,
      page.selectedItems?.services?.selectedServices
    );
    const processedEvents = markSelected(
      events,
      page.selectedItems?.events?.selectedEvents
    );

    res.render(`pages/admin/setting/pages/formhome`, {
      title: `Edit ${page.pageType} Page`,
      page,
      sidebar: "pages",
      propertyTypes: processedPropertyTypes,
      services: processedServices,
      events: processedEvents,
    });
  } else {
    const page = await Pages.findOne({ pageType: req.params.pageType });

    if (!page) {
      return res.redirect("/pages");
    }

    res.render(`pages/admin/setting/pages/form`, {
      title: `Edit ${page.pageType} Page`,
      page,
      sidebar: "pages",
    });
  }
});

const savePage = asyncHandler(async (req, res) => {
  try {
    const { pageType } = req.params;
    const { title, subtitle, content, removeBannerImage } = req.body;

    // Get existing page data
    let existingPage = (await Pages.findOne({ pageType })) || { images: [] };

    // Handle banner image
    let bannerImage = existingPage.bannerImage;
    if (req.files?.bannerImage?.[0]) {
      bannerImage = `/temp/${req.files.bannerImage[0].filename}`;
    } else if (removeBannerImage === "true") {
      bannerImage = "";
    }

    // Update or create the page
    const pageData = { pageType, title, subtitle, content, bannerImage };

    const page = await Pages.findOneAndUpdate({ pageType }, pageData, {
      new: true,
      upsert: true,
    });

    await createActivityLog({
      entityType: "Pages",
      entityId: page._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "update",
    });

    res.status(200).json({
      success: true,
      message: "Page updated successfully",
      page,
    });
  } catch (error) {
    console.error("Error saving page:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update Page",
      error: error.message,
    });
  }
});

const updateHomePropertyTypes = asyncHandler(async (req, res) => {
  const { pageType, propertyTypesTitle, propertyTypes } = req.body;

  const updatedPage = await Pages.findOneAndUpdate(
    { pageType },
    {
      $set: {
        "selectedItems.propertyTypes": {
          title: propertyTypesTitle,
          selectedTypes: propertyTypes,
        },
      },
    },
    { new: true, runValidators: true }
  );

  if (!updatedPage) {
    throw new ApiError(404, "Page not found");
  }

  await createActivityLog({
    entityType: "Pages",
    entityId: updatedPage._id,
    userId: req.admin._id,
    userRole: "admin",
    action: "updatePropertyTypes",
  });

  res.json(
    new ApiResponse(200, updatedPage, "Property types updated successfully")
  );
});

const updateHomeServices = asyncHandler(async (req, res) => {
  const { pageType, servicesTitle, services } = req.body;

  const updatedPage = await Pages.findOneAndUpdate(
    { pageType },
    {
      $set: {
        "selectedItems.services": {
          title: servicesTitle,
          selectedServices: services,
        },
      },
    },
    { new: true, runValidators: true }
  );

  if (!updatedPage) {
    throw new ApiError(404, "Page not found");
  }

  await createActivityLog({
    entityType: "Pages",
    entityId: updatedPage._id,
    userId: req.admin._id,
    userRole: "admin",
    action: "updateServices",
  });

  res.json(new ApiResponse(200, updatedPage, "Services updated successfully"));
});

const updateHomeEvents = asyncHandler(async (req, res) => {
  const { pageType, eventsTitle, events } = req.body;

  const updatedPage = await Pages.findOneAndUpdate(
    { pageType },
    {
      $set: {
        "selectedItems.events": {
          title: eventsTitle,
          selectedEvents: events,
        },
      },
    },
    { new: true, runValidators: true }
  );

  if (!updatedPage) {
    throw new ApiError(404, "Page not found");
  }

  await createActivityLog({
    entityType: "Pages",
    entityId: updatedPage._id,
    userId: req.admin._id,
    userRole: "admin",
    action: "updateEvents",
  });

  res.json(new ApiResponse(200, updatedPage, "Events updated successfully"));
});

const updateSlider = asyncHandler(async (req, res) => {
  const { pageType, sliderId, title, subtitle, content, action } = req.body;

  const page = await Pages.findOne({ pageType });
  if (!page) {
    throw new ApiError(404, "Page not found");
  }

  let sliderImages = page.sliderImages || [];
  let message = "";

  if (action === "add") {
    // Add new slider
    const newSlider = {
      title: title || "",
      subtitle: subtitle || "",
      content: content || "",
      image: req.file ? `/temp/${req.file.filename}` : "",
    };
    sliderImages.push(newSlider);
    message = "Slider added successfully";

    await createActivityLog({
      entityType: "Pages",
      entityId: page._id,
      userId: req.admin._id,
      userRole: "admin",
      action: "createSlider",
    });
  } else if (action === "update" && sliderId) {
    // Update existing slider
    const index = parseInt(sliderId);
    if (index >= 0 && index < sliderImages.length) {
      sliderImages[index] = {
        title: title || sliderImages[index].title,
        subtitle: subtitle || sliderImages[index].subtitle,
        content: content || sliderImages[index].content,
        image: req.file
          ? `/temp/${req.file.filename}`
          : sliderImages[index].image,
      };
      message = "Slider updated successfully";

      await createActivityLog({
        entityType: "Pages",
        entityId: page._id,
        userId: req.admin._id,
        userRole: "admin",
        action: "updateSlider",
      });
    }
  } else if (action === "remove" && sliderId) {
    // Remove slider
    const index = parseInt(sliderId);
    if (index >= 0 && index < sliderImages.length) {
      sliderImages.splice(index, 1);
      message = "Slider removed successfully";

      await createActivityLog({
        entityType: "Pages",
        entityId: page._id,
        userId: req.admin._id,
        userRole: "admin",
        action: "removeSlider",
      });
    }
  }

  const updatedPage = await Pages.findOneAndUpdate(
    { pageType },
    { $set: { sliderImages } },
    { new: true }
  );

  res.json(new ApiResponse(200, updatedPage, message));
});

/// ------------- Setting Management End -------------------------///

/// ---------------- Permission Setting Start ------------------- ////

const permissionList = asyncHandler(async (req, res) => {
  const permissions = await Permission.find().sort({ name: 1 });
  return res.render("pages/admin/setting/permission/list", {
    sidebar: "permissions",
    permissions,
  });
});

const createPermission = asyncHandler(async (req, res) => {
  const { name, title } = req.body;

  const nameExist = await Permission.findOne({ name });
  if (nameExist) {
    return res
      .status(400)
      .json({ success: false, message: "Permission name already exists" });
  }

  await Permission.create({ name, title });

  return res.json({
    success: true,
    message: "Permission created successfully",
  });
});

const adminRolesList = asyncHandler(async (req, res) => {
  const adminRoles = await AdminRoles.find()
    .populate("permissions")
    .sort({ role: 1 });

  return res.render("pages/admin/setting/permission/admin-roles", {
    sidebar: "admin_permissions",
    adminRoles,
  });
});

const adminRolesForm = asyncHandler(async (req, res) => {
  const [rolePermission, allPermissions] = await Promise.all([
    AdminRoles.findOne({ role: req.params.role }).populate("permissions"),
    Permission.find().sort({ name: 1 }),
  ]);

  return res.render("pages/admin/setting/permission/admin-roles-form", {
    sidebar: "admin_permissions",
    rolePermission,
    allPermissions,
    role: req.params.role,
  });
});

const updateAdminPermission = asyncHandler(async (req, res) => {
  const { permissions = [] } = req.body;
  const role = req.params.role;

  await AdminRoles.findOneAndUpdate(
    { role },
    { permissions: permissions },
    { new: true }
  );
  return res.json({
    success: true,
    message: "Admin Roles permission updated successfully",
  });
});

///  ---------------- Permission Setting End ------------------- ////

/// ---------------- Admin Roles Start ------------------- ////

const adminUserList = asyncHandler(async (req, res) => {
  // Find users with 'admin' in their roles array AND specific adminRoles
  const adminUsers = await User.find({
    roles: "admin",
    adminRole: { $in: ["customer_admin", "manager_admin"] },
  })
    .sort({ createdAt: -1 })
    .select("-password"); // Exclude password field

  return res.render("pages/admin/setting/admin-user/list", {
    sidebar: "admin_users",
    adminUsers,
  });
});

const adminUserForm = asyncHandler(async (req, res) => {
  let adminUser = null;

  if (req.params.id) {
    adminUser = await User.findById(req.params.id).select("-password");
  }

  return res.render("pages/admin/setting/admin-user/form", {
    sidebar: "admin_users",
    adminUser,
    isEdit: req.params.id ? true : false,
  });
});

const createAdminUser = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, adminRole, mobile } = req.body;

  // Check if email already exists
  const emailExists = await User.findOne({ email });
  if (emailExists) {
    return res
      .status(400)
      .json({ success: false, message: "Email already exists" });
  }

  const mobileExists = await User.findOne({ mobile });
  if (mobileExists) {
    return res
      .status(400)
      .json({ success: false, message: "Mobile number already exists" });
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  const adminUser = await User.create({
    firstName,
    lastName,
    email,
    mobile,
    password: hashedPassword,
    roles: ["admin"], // Set as array containing 'admin'
    adminRole,
  });

  return res.json({
    success: true,
    message: "Admin user created successfully",
    data: { id: adminUser._id },
  });
});

const updateAdminUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { firstName, lastName, email, adminRole, password, mobile } = req.body;

  // Check if email is being updated and if it already exists
  const existingUser = await User.findOne({ email });
  if (existingUser && existingUser._id.toString() !== id) {
    return res.status(400).json({
      success: false,
      message: "Email already exists for another user",
    });
  }

  const existingMobile = await User.findOne({ mobile });
  if (existingMobile && existingMobile._id.toString() !== id) {
    return res.status(400).json({
      success: false,
      message: "Mobile number already exists for another user",
    });
  }

  const updateData = {
    firstName,
    lastName,
    email,
    mobile,
    adminRole,
    $addToSet: { roles: "admin" }, // Ensure admin role is maintained
  };

  // Only update password if provided
  if (password) {
    updateData.password = await bcrypt.hash(password, 10);
  }

  const updatedUser = await User.findByIdAndUpdate(id, updateData, {
    new: true,
  }).select("-password");

  return res.json({
    success: true,
    message: "Admin user updated successfully",
    data: updatedUser,
  });
});

const updateAdminUserStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const adminUser = await User.findById(id);

    if (!adminUser) {
      return res
        .status(404)
        .json({ success: false, message: "Admin user not found" });
    }

    adminUser.isActive = !adminUser.isActive;
    await adminUser.save();

    res.status(200).json({
      success: true,
      message: `Admin user ${adminUser.isActive ? "activated" : "Blocked"}`,
      isActive: adminUser.isActive,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Failed to update status",
    });
  }
});

///  ---------------- Admin Roles End ------------------- ////

/// ------------- Notification Management Start -------------------------///

const getNotificationList = asyncHandler(async (req, res) => {
  return res.render("pages/admin/notifications", {
    sidebar: "notifications",
  });
});

const getNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, markAsRead = false } = req.query;
  // Build base query
  const query = {
    "recipient.role": "admin",
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

const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    {
      "recipient.role": "admin",
      isRead: false, // Only update unread notifications
    },
    {
      $set: {
        isRead: true,
        readAt: new Date(),
      },
    }
  );

  return res.status(200).json({
    success: true,
    message: `Successfully marked ${result.modifiedCount} notifications as read`,
    data: { updatedCount: result.modifiedCount },
  });
});

const getNotificationDetails = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Find and mark notification as read in one operation
    const notification = await Notification.findOneAndUpdate(
      {
        _id: id,
        // 'recipient.user': req.admin._id,
        "recipient.role": "admin",
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
      {
        new: true,
      }
    ).populate("sender", "firstName lastName profileImage");

    if (!notification) {
      return res.redirect("/notifications");
    }

    // Otherwise render the details page
    res.render("pages/admin/notifications/details", {
      sidebar: "notifications",
      notification,
    });
  } catch (error) {
    console.error("Error in getNotificationDetails:", error);
    return res.redirect("/notifications");
  }
});

/// --------------  Notification Management End -------------------------///

/// --------------- Help Center Start -----------------------////

const getNewsletterList = asyncHandler(async (req, res) => {
  const newsletters = await Newsletter.find({});
  return res.render("pages/admin/newsletter", {
    sidebar: "newsletter",
    newsletters,
  });
});

const getComingSoonEmailList = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    sort = "-createdAt",
    search = "",
    status = "all",
  } = req.query;

  // Build aggregation pipeline
  const pipeline = [];

  // Match stage for search
  if (search) {
    pipeline.push({
      $match: {
        email: { $regex: search, $options: "i" },
      },
    });
  }

  // Filter by first 100 status
  if (status !== "all") {
    pipeline.push({
      $match: {
        isFirst100: status === "first100",
      },
    });
  }

  // Add calculated fields if needed
  pipeline.push({
    $addFields: {
      positionText: {
        $cond: [{ $gt: ["$position", 0] }, { $toString: "$position" }, "-"],
      },
    },
  });

  // Sort stage
  const sortOption = {};
  if (sort === "position") sortOption.position = 1;
  else if (sort === "-position") sortOption.position = -1;
  else if (sort === "email") sortOption.email = 1;
  else if (sort === "-email") sortOption.email = -1;
  else if (sort === "createdAt") sortOption.createdAt = 1;
  else sortOption.createdAt = -1; // Default sort

  pipeline.push({ $sort: sortOption });

  // Pagination options
  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    customLabels: {
      docs: "emailList",
      totalDocs: "total",
    },
    collation: { locale: "en" },
  };

  const result = await ComingSoon.aggregatePaginate(
    ComingSoon.aggregate(pipeline),
    options
  );

  return res.render("pages/admin/comingsoon", {
    sidebar: "comingsoon",
    emailList: result.emailList,
    pages: result.totalPages,
    currentPage: result.page,
    search,
    sort,
    status,
    limit: result.limit,
    first100Count: await ComingSoon.countDocuments({ isFirst100: true }),
    regularCount: await ComingSoon.countDocuments({ isFirst100: false }),
    total: await ComingSoon.countDocuments(),
  });
});

const ticketView = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    status,
    priority,
    category,
    search,
  } = req.query;

  const tickets = await getTicketsData({
    page,
    limit,
    status,
    priority,
    category,
    search,
  });

  return res.render("pages/admin/help-center", {
    sidebar: "help-center",
    tickets: tickets.docs,
    totalPages: tickets.totalPages,
    currentPage: tickets.page,
    hasNextPage: tickets.hasNextPage,
    hasPrevPage: tickets.hasPrevPage,
    filter: { status, priority, category, search },
    helpers: {
      getPriorityClass: function (priority) {
        const classes = {
          low: "success",
          medium: "info",
          high: "warning",
          critical: "danger",
        };
        return classes[priority] || "secondary";
      },
      getStatusClass: function (status) {
        const classes = {
          open: "primary",
          "in-progress": "warning",
          resolved: "success",
          closed: "secondary",
        };
        return classes[status] || "light";
      },
      formatTime: function (date) {
        const now = new Date();
        const diff = now - new Date(date);
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
        if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
        if (minutes > 0)
          return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
        return "Just now";
      },
    },
  });
});

const getTicketsApi = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    status,
    priority,
    category,
    search,
  } = req.query;

  const tickets = await getTicketsData({
    page,
    limit,
    status,
    priority,
    category,
    search,
  });

  return res.json({
    status: true,
    data: {
      tickets: tickets.docs,
      totalPages: tickets.totalPages,
      currentPage: tickets.page,
      hasNextPage: tickets.hasNextPage,
      hasPrevPage: tickets.hasPrevPage,
    },
  });
});

async function getTicketsData({
  page,
  limit,
  status,
  priority,
  category,
  search,
}) {
  // Create the match stage for aggregation
  const matchStage = {};

  // Apply filters
  if (status) matchStage.status = status;
  if (priority) matchStage.priority = priority;
  if (category) matchStage.category = category;

  // Search functionality
  if (search) {
    const searchRegex = new RegExp(search, "i");
    matchStage.$or = [{ ticketId: searchRegex }, { title: searchRegex }];
  }

  const aggregationPipeline = [
    { $match: matchStage },
    { $sort: { updatedAt: -1 } },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    ...(search
      ? [
          {
            $match: {
              $or: [
                { ticketId: new RegExp(search, "i") },
                { title: new RegExp(search, "i") },
                { "user.firstName": new RegExp(search, "i") },
                { "user.lastName": new RegExp(search, "i") },
                { "user.email": new RegExp(search, "i") },
              ],
            },
          },
        ]
      : []),
    {
      $project: {
        "user.firstName": 1,
        "user.lastName": 1,
        "user.email": 1,
        "user.profileImage": 1,
        ticketId: 1,
        title: 1,
        category: 1,
        initialMessage: 1,
        unreadCount: 1,
        status: 1,
        priority: 1,
        updatedAt: 1,
        createdAt: 1,
        lastMessage: { $arrayElemAt: ["$messages", -1] },
        messageCount: { $size: { $ifNull: ["$messages", []] } },
      },
    },
  ];

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
  };

  return await HelpCenter.aggregatePaginate(
    HelpCenter.aggregate(aggregationPipeline),
    options
  );
}

const getTicketConversation = asyncHandler(async (req, res) => {
  const { ticketId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const ticket = await HelpCenter.findById(ticketId)
    .populate("user", "firstName lastName email profileImage")
    .lean();

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  // Get messages with pagination
  const messages = ticket.messages || [];
  const totalMessages = messages.length;

  // Sort messages by createdAt (newest first for display)
  const sortedMessages = messages.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  // Calculate pagination
  const totalPages = Math.ceil(totalMessages / limit);
  const currentPage = parseInt(page);
  const startIndex = (currentPage - 1) * limit;
  const endIndex = startIndex + limit;

  // Get paginated messages
  const paginatedMessages = sortedMessages.slice(startIndex, endIndex);

  // For conversation view, we want chronological order (oldest first)
  const conversationMessages = paginatedMessages.reverse();

  // Mark messages as read by admin
  if (ticket.unreadCount && ticket.unreadCount.admin > 0) {
    await HelpCenter.updateOne(
      { _id: ticketId },
      {
        $set: {
          // 'messages.$[elem].read': true,
          "unreadCount.admin": 0,
        },
      }
    );
  }

  return res.json(
    new ApiResponse(200, {
      ticket: {
        ...ticket,
        messages: conversationMessages,
      },
      pagination: {
        currentPage,
        totalPages,
        totalMessages,
        hasNextPage: currentPage < totalPages,
        hasPrevPage: currentPage > 1,
        limit: parseInt(limit),
      },
    })
  );
});

const sendReply = asyncHandler(async (req, res) => {
  const { ticketId } = req.params;
  const { message, attachments = [] } = req.body;

  if (!message || !message.trim()) {
    throw new ApiError(400, "Message is required");
  }

  const newMessage = {
    sender: "admin",
    senderId: req.admin._id,
    message: message.trim(),
    attachments,
    read: false,
    createdAt: new Date(),
  };

  const update = {
    $push: {
      messages: newMessage,
    },
    $inc: {
      "unreadCount.user": 1,
    },
    $set: {
      updatedAt: new Date(),
      // Update status if it's closed
      ...(await HelpCenter.findById(ticketId)
        .lean()
        .then((ticket) =>
          ticket.status === "closed" ? { status: "open" } : {}
        )),
    },
  };

  const ticket = await HelpCenter.findByIdAndUpdate(ticketId, update, {
    new: true,
  }).populate("user", "firstName lastName email profileImage");

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  // Here you can add real-time notification logic
  // For example, emit socket event to user
  // io.to(ticket.user._id.toString()).emit('new_message', newMessage);

  return res.json(
    new ApiResponse(
      200,
      {
        message: newMessage,
        ticket: {
          _id: ticket._id,
          ticketId: ticket.ticketId,
          title: ticket.title,
          status: ticket.status,
          updatedAt: ticket.updatedAt,
        },
      },
      "Reply sent successfully"
    )
  );
});

const updateTicketStatus = asyncHandler(async (req, res) => {
  const { ticketId } = req.params;
  const { status, priority } = req.body;

  const updateData = {};
  if (status) updateData.status = status;
  if (priority) updateData.priority = priority;
  updateData.updatedAt = new Date();

  const ticket = await HelpCenter.findByIdAndUpdate(ticketId, updateData, {
    new: true,
  }).populate("user", "firstName lastName email");

  if (!ticket) {
    throw new ApiError(404, "Ticket not found");
  }

  await createActivityLog({
    entityType: "HelpCenter",
    entityId: ticket._id,
    userId: req.admin._id,
    userRole: "admin",
    action: "status",
  });

  return res.json(new ApiResponse(200, ticket, "Ticket updated successfully"));
});

const getTicketStats = asyncHandler(async (req, res) => {
  const stats = await HelpCenter.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        open: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
        inProgress: {
          $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] },
        },
        resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } },
        closed: { $sum: { $cond: [{ $eq: ["$status", "closed"] }, 1, 0] } },
        critical: {
          $sum: { $cond: [{ $eq: ["$priority", "critical"] }, 1, 0] },
        },
        high: { $sum: { $cond: [{ $eq: ["$priority", "high"] }, 1, 0] } },
        medium: { $sum: { $cond: [{ $eq: ["$priority", "medium"] }, 1, 0] } },
        low: { $sum: { $cond: [{ $eq: ["$priority", "low"] }, 1, 0] } },
      },
    },
  ]);

  return res.json(
    new ApiResponse(200, stats[0] || {}, "Statistics retrieved successfully")
  );
});

const resetAdminUnreadCount = asyncHandler(async (req, res) => {
  try {
    const { ticketId } = req.body;

    const ticket = await HelpCenter.findByIdAndUpdate(
      ticketId,
      { $set: { "unreadCount.admin": 0 } },
      { new: true }
    );

    if (!ticket) {
      return next(new ApiError(404, "Ticket not found"));
    }

    res.status(200).json({
      status: "success",
      data: {
        ticket,
      },
    });
  } catch (error) {
    next(new ApiError(500, "Failed to reset unread count"));
  }
});

/// --------------- Help Center End -----------------------////

///// -------------- Support FAQS Start ----------------------////

const supportFaqList = asyncHandler(async (req, res) => {
  const faqs = await SupportFaq.find({ parentQuestion: null }).sort({
    createdAt: 1,
  });
  return res.render("pages/admin/setting/supportFaq/list", {
    sidebar: "supportFaq",
    faqs,
  });
});

const supportFaqForm = asyncHandler(async (req, res) => {
  let faq = null;

  if (req.params.id) {
    faq = await SupportFaq.findById(req.params.id);
  }

  const otherQuestions = await SupportFaq.find({
    _id: { $ne: req.params.id },
  }).lean();

  return res.render("pages/admin/setting/supportFaq/form", {
    sidebar: "supportFaq",
    faq,
    otherQuestions,
    isEdit: req.params.id ? true : false,
  });
});

const supportFaqCreate = asyncHandler(async (req, res) => {
  const { question, answer } = req.body;

  if (!question || !answer) {
    return res.status(400).json({
      success: false,
      message: "Question and answer are required",
    });
  }

  await SupportFaq.create({
    question,
    topQuestion: true,
    answer,
  });

  return res.status(200).json({
    success: true,
    message: "FAQ created successfully",
  });
});

const supportFaqUpdate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { question, answer } = req.body;

  if (!question || !answer) {
    return res.status(400).json({
      success: false,
      message: "Question and answer are required",
    });
  }

  const faq = await SupportFaq.findByIdAndUpdate(
    id,
    {
      question,
      topQuestion: true,
      answer,
    },
    { new: true, runValidators: true }
  );

  if (!faq) {
    return res.status(404).json({
      success: false,
      message: "FAQ not found",
    });
  }

  return res.status(200).json({
    success: true,
    message: "FAQ updated successfully",
  });
});

const supportFaqShow = asyncHandler(async (req, res) => {
  // Function to recursively populate suggestions
  const populateSuggestions = async (faq, currentDepth = 0, maxDepth = 5) => {
    if (currentDepth >= maxDepth) return faq;

    if (faq.suggestQuestions && faq.suggestQuestions.length > 0) {
      await SupportFaq.populate(faq, {
        path: "suggestQuestions",
        options: { limit: 100 },
      });

      // Recursively populate each suggestion
      for (const suggestion of faq.suggestQuestions) {
        await populateSuggestions(suggestion, currentDepth + 1, maxDepth);
      }
    }
    return faq;
  };

  // Get the base FAQ
  const faq = await SupportFaq.findById(req.params.id).populate({
    path: "suggestQuestions",
    options: { limit: 100 },
  });

  // Recursively populate nested suggestions
  const populatedFaq = await populateSuggestions(faq, 0, 5);

  res.render("pages/admin/setting/supportFaq/show", {
    sidebar: "supportFaq",
    faq: populatedFaq,
    currentDepth: 0,
    maxDepth: 5,
  });
});

const saveSuggestion = asyncHandler(async (req, res) => {
  const { parentId, questionId, question, answer } = req.body;

  let faq;
  if (questionId) {
    // Update existing
    faq = await SupportFaq.findByIdAndUpdate(
      questionId,
      {
        question,
        answer,
      },
      { new: true }
    );
  } else {
    // Create new
    faq = await SupportFaq.create({
      question,
      answer,
      parentQuestion: parentId,
    });

    // Add to parent's suggestions
    await SupportFaq.findByIdAndUpdate(parentId, {
      $addToSet: { suggestQuestions: faq._id },
    });
  }

  res.json({ success: true, faq });
});

const deleteSuggestion = asyncHandler(async (req, res) => {
  const { questionId } = req.params;

  // Recursive function to delete a question and all its nested suggestions
  const deleteQuestionAndNested = async (id) => {
    // First get all nested suggestions
    const question = await SupportFaq.findById(id).select("suggestQuestions");

    // Recursively delete all nested suggestions
    if (question.suggestQuestions && question.suggestQuestions.length > 0) {
      await Promise.all(
        question.suggestQuestions.map((childId) =>
          deleteQuestionAndNested(childId)
        )
      );
    }

    // Remove from parent's suggestions
    const current = await SupportFaq.findById(id).select("parentQuestion");
    if (current.parentQuestion) {
      await SupportFaq.findByIdAndUpdate(current.parentQuestion, {
        $pull: { suggestQuestions: id },
      });
    }

    // Finally delete the question itself
    await SupportFaq.findByIdAndDelete(id);
  };

  try {
    await deleteQuestionAndNested(questionId);
    res.json({
      success: true,
      message: "Question and all nested suggestions deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting question hierarchy:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete question and its nested suggestions",
    });
  }
});

///// -------------- Support FAQS End ----------------------////

///// ---------------  Webhook Implementation Start-------------------------//

///// ------  Stripe Webhook
const stripeWebhook = asyncHandler(async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2023-08-16",
  });
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("⚠️ Webhook signature verification failed:", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handleStripePaymentSuccess(event.data.object);
        break;

      case "payment_intent.payment_failed":
        await handleStripePaymentFailure(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
});

async function handleStripePaymentSuccess(paymentIntent) {
  const transactionLog = await TransactionLog.findOneAndUpdate(
    {
      _id: paymentIntent.metadata.paymentRecordId,
      gateway: "stripe",
      gatewayOrderId: paymentIntent.id,
      status: "pending",
    },
    {
      $set: {
        status: "paid",
        gatewayPaymentId: paymentIntent.id,
        paidAt: new Date(),
        receiptUrl: paymentIntent.charges?.data[0]?.receipt_url,
      },
    },
    { new: true }
  );

  console.log("Transaction log updated:", transactionLog);

  if (!transactionLog) {
    console.error("Transaction log not found for payment:", paymentIntent.id);
    return;
  }

  // Create event booking if not already created via client-side confirmation
  if (transactionLog?.eventId) {
    const existingEventBooking = await BookingEvent.findOne({
      transactionLogId: transactionLog._id,
    });
    if (!existingEventBooking) {
      await createEventBookingFromTransaction(transactionLog);
    }
  }

  /// Create Property
  if (transactionLog?.propertyId) {
    const existingPropertyBooking = await Booking.findOne({
      transactionLogId: transactionLog._id,
    });
    if (!existingPropertyBooking) {
      await createPropertyBookingFromTransaction(transactionLog);
    }
  }
}

async function handleStripePaymentFailure(paymentIntent) {
  await TransactionLog.findOneAndUpdate(
    {
      _id: paymentIntent.metadata.paymentRecordId,
      gateway: "stripe",
      gatewayOrderId: paymentIntent.id,
    },
    {
      $set: {
        status: "failed",
        failureReason:
          paymentIntent.last_payment_error?.message || "Payment failed",
        failedAt: new Date(),
      },
    }
  );
}

///// ------ Razorpay Webhook

const razorpayWebhook = asyncHandler(async (req, res) => {
  const body = req.body;
  const signature = req.headers["x-razorpay-signature"];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  // Verify signature
  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(JSON.stringify(body))
    .digest("hex");

  if (expectedSignature !== signature) {
    console.error("⚠️ Razorpay webhook signature verification failed");
    return res.status(400).json({ error: "Invalid signature" });
  }

  try {
    switch (body.event) {
      case "payment.captured":
        await handleRazorpayPaymentSuccess(body.payload.payment.entity);
        break;

      case "payment.failed":
        await handleRazorpayPaymentFailure(body.payload.payment.entity);
        break;

      default:
        console.log(`Unhandled Razorpay event: ${body.event}`);
    }

    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("Razorpay webhook processing error:", error);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
});

async function handleRazorpayPaymentSuccess(payment) {
  const transactionLog = await TransactionLog.findOneAndUpdate(
    {
      gateway: "razorpay",
      gatewayOrderId: payment.order_id,
      status: "pending",
    },
    {
      $set: {
        status: "paid",
        gatewayPaymentId: payment.id,
        paidAt: new Date(),
        receiptUrl: payment.receipt,
      },
    },
    { new: true }
  );

  if (!transactionLog) {
    console.error(
      "Transaction log not found for Razorpay payment:",
      payment.id
    );
    return;
  }

  // Create event booking if not already created via client-side confirmation
  if (transactionLog?.eventId) {
    const existingEventBooking = await BookingEvent.findOne({
      transactionLogId: transactionLog._id,
    });
    if (!existingEventBooking) {
      await createEventBookingFromTransaction(transactionLog);
    }
  }

  /// Create Property
  if (transactionLog?.propertyId) {
    const existingPropertyBooking = await Booking.findOne({
      transactionLogId: transactionLog._id,
    });
    if (!existingPropertyBooking) {
      await createPropertyBookingFromTransaction(transactionLog);
    }
  }
}

async function handleRazorpayPaymentFailure(payment) {
  await TransactionLog.findOneAndUpdate(
    {
      gateway: "razorpay",
      gatewayOrderId: payment.order_id,
    },
    {
      $set: {
        status: "failed",
        failureReason: payment.error_description || "Payment failed",
        failedAt: new Date(),
      },
    }
  );
}

///// -------  Transaction ------

async function createEventBookingFromTransaction(transactionLog) {
  const event = await Event.findById(transactionLog.eventId);
  if (!event) {
    throw new Error("Event not found");
  }

  // Create booking
  const newBooking = await BookingEvent.create({
    event: event._id,
    transactionLogId: transactionLog._id,
    bookingBy: {
      user: transactionLog.userId,
      role: "guest",
    },
    numberOfAttendees: Number(transactionLog.metadata.numberOfAttendees),
    paymentDetails: {
      paymentMethod: transactionLog.gateway,
      [transactionLog.gateway === "stripe"
        ? "stripePaymentId"
        : "razorpayPaymentId"]: transactionLog.gatewayPaymentId,
      baseAmount: transactionLog.baseAmount,
      taxAmount: transactionLog.taxAmount.amount,
      totalAmount: transactionLog.totalAmount,
      transactionId: transactionLog.gatewayOrderId,
      status: "paid",
    },
    status: "confirmed",
  });

  // Update event attendance
  event.currentAttendees += Number(transactionLog.metadata.numberOfAttendees);
  await event.save();

  // Create activity log
  await createActivityLog({
    entityType: "Event",
    entityId: event._id,
    userId: transactionLog.userId,
    userRole: "guest",
    action: "booking",
  });

  // Send notification
  const organizer = event.createdBy;
  const bookingUser = await User.findById(transactionLog.userId)
    .select("firstName lastName")
    .lean();

  await createNotification({
    recipientId: organizer.userId,
    recipientRole: organizer.role,
    senderId: transactionLog.userId,
    title: "New Event Booking Received",
    message:
      `${bookingUser.firstName} ${bookingUser.lastName} booked ${transactionLog.metadata.numberOfAttendees} ` +
      `spot${
        transactionLog.metadata.numberOfAttendees > 1 ? "s" : ""
      } for your event "${event.title}"`,
    notificationType: "event_booking",
    actionId: event._id,
    metadata: {
      bookingId: newBooking._id,
      attendeesCount: transactionLog.metadata.numberOfAttendees,
      totalAmount: transactionLog.totalAmount,
    },
  });

  await createWalletTransactionHost(
    "event",
    newBooking,
    event.createdBy.userId,
    event.createdBy.role
  );
  await createWalletTransactionGuest("event", newBooking);

  return newBooking;
}

async function createPropertyBookingFromTransaction(transactionLog) {
  const property = await Property.findById(transactionLog.propertyId);
  if (!property) {
    throw new Error("Property not found");
  }

  const propertyOwner = await User.findById(property.owner);
  if (!propertyOwner) {
    throw new Error("Property owner not found");
  }

  const autoAcceptedIds = propertyOwner.autoAcceptedIds || [];
  const isAutoAccepted = autoAcceptedIds.includes(transactionLog.userId);
  const status = isAutoAccepted ? "confirmed" : "pending";

  const finalAmount = transactionLog.metadata.pricing.finalAmount;
  const startDate = new Date(transactionLog.metadata.bookingDates.startDate);
  const endDate = new Date(transactionLog.metadata.bookingDates.endDate);

  // ✅ Create booking
  const booking = new Booking({
    propertyId: property._id,
    guestId: transactionLog.userId,
    transactionLogId: transactionLog._id,
    hostId: property.owner,
    bookingDates: transactionLog.metadata.bookingDates,
    guestDetails: transactionLog.metadata.guestDetails || {},
    extraFeatures: transactionLog.metadata.extraFeatures || [],
    discounts: transactionLog.metadata.discounts || [],
    amountBreakdown: transactionLog.metadata.pricing || {},
    status,
  });

  await booking.save();

  const currentDate = new Date(startDate);
  while (currentDate < endDate) {
    await PropertyCalendar.updateOne(
      {
        propertyId: property._id,
        date: currentDate, // filter by current date
      },
      {
        $set: {
          status: "booked",
          bookingId: booking._id,
        },
      }
    );

    // move to next date
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // ✅ Notifications
  try {
    const guestUser = await User.findById(transactionLog.userId)
      .select("firstName lastName")
      .lean();

    // Notification for host
    await createNotification({
      recipientId: property.owner,
      recipientRole: "host",
      senderId: transactionLog.userId,
      title: status === "confirmed" ? "New Booking" : "Booking Request",
      message: `${guestUser.firstName} ${guestUser.lastName} has ${
        status === "confirmed" ? "booked" : "requested to book"
      } your property "${
        property.name
      }" from ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`,
      notificationType: "property_booking",
      actionId: booking._id,
      metadata: {
        bookingId: booking._id,
        propertySlug: property.slug,
        status,
        dates: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
        amount: finalAmount,
      },
    });

    // Notification for guest
    await createNotification({
      recipientId: transactionLog.userId,
      recipientRole: "guest",
      senderId: property.owner,
      title:
        status === "confirmed" ? "Booking Confirmed" : "Booking Request Sent",
      message: `Your ${
        status === "confirmed"
          ? "booking is confirmed"
          : "booking request was sent"
      } for "${
        property.name
      }" from ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`,
      notificationType: "property_booking",
      actionId: booking._id,
      metadata: {
        bookingId: booking._id,
        propertySlug: property.slug,
        status,
        dates: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
        amount: finalAmount,
      },
    });
  } catch (notificationError) {
    console.error("Notification creation failed:", notificationError);
  }

  /// wallet mange
  await createWalletTransactionHost(
    "property",
    booking,
    property.owner,
    "host"
  );
  await createWalletTransactionGuest("property", booking);

  return booking;
}

async function createWalletTransactionHost(
  bookingType,
  booking,
  userId,
  userRole
) {
  try {
    const wallet = await getOrCreateWallet(userId, userRole);

    let totalAmount = 0;
    let hostEarnings = 0;
    let platformCommission = 0;

    if (bookingType == "event") {
      totalAmount = booking?.paymentDetails?.totalAmount || 0;
      hostEarnings = booking?.paymentDetails?.baseAmount || 0;
      platformCommission = booking?.paymentDetails?.taxAmount || 0;
    } else if (bookingType == "property") {
      totalAmount = booking?.amountBreakdown?.finalAmount || 0;
      hostEarnings =
        booking?.amountBreakdown?.finalAmount -
          booking?.amountBreakdown?.totalTaxAmount || 0;
      platformCommission = booking?.amountBreakdown?.totalTaxAmount || 0;
    }

    // Create wallet transaction for host
    const walletTransaction = await WalletTransaction.create({
      walletId: wallet._id,
      amount: hostEarnings,
      transactionType: `${bookingType}_booking`,
      status: "completed",
      bookingId: booking._id,
      bookingType,
      metadata: {
        totalAmount,
        platformCommission,
        hostEarnings,
      },
    });

    // Update host wallet balance
    wallet.holdBalance += hostEarnings;
    wallet.commission += platformCommission;
    await wallet.save();

    return walletTransaction;
  } catch (error) {
    console.error(
      `Error creating host wallet transaction for ${bookingType}:`,
      error
    );
    throw new Error(
      `Failed to create host wallet transaction: ${error.message}`
    );
  }
}

async function createWalletTransactionGuest(bookingType, booking) {
  try {
    const guestId = booking.guestId || booking.bookingBy?.user;
    if (!guestId) {
      throw new Error("Guest ID not found in booking");
    }

    const wallet = await getOrCreateWallet(guestId, "guest");
    const totalAmount =
      booking?.amountBreakdown?.finalAmount ||
      booking?.paymentDetails?.totalAmount;

    // Create wallet transaction for guest (debit transaction)
    const walletTransaction = await WalletTransaction.create({
      walletId: wallet._id,
      amount: totalAmount, // Negative amount for debit
      transactionType: `${bookingType}_booking`,
      status: "completed",
      bookingId: booking._id,
      bookingType,
      metadata: {
        totalAmount,
        paymentStatus: "completed",
      },
    });

    return walletTransaction;
  } catch (error) {
    console.error(
      `Error creating guest wallet transaction for ${bookingType}:`,
      error
    );
    throw new Error(
      `Failed to create guest wallet transaction: ${error.message}`
    );
  }
}

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

const testPaymentEvent = asyncHandler(async (req, res) => {
  return res.render("payment-test-event", {
    eventId: "68a44c52acf09a1241a86692",
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});

const testPaymentProperty = asyncHandler(async (req, res) => {
  return res.render("payment-test-property", {
    propertyId: "68b2c296f9a3d3bb6a3f1236",
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});


///// ---------------  Webhook Implementation End-------------------------//

// --------------- Uber Booking Admin Module ------------------ //
const listUberBookings = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 12,
    status = "",
    liked = "",
    q = "",
    guestId = ""
  } = req.query;

  const pageNumber = parseInt(page);
  const limitNumber = parseInt(limit);

  const filter = {};
  if (status) filter.status = status;
  if (liked !== "") filter.liked = liked === "true";
  if (guestId && mongoose.Types.ObjectId.isValid(guestId)) {
    filter.guestId = new mongoose.Types.ObjectId(guestId);
  }
  if (q) {
    filter.$or = [
      { bookingId: new RegExp(q, "i") },
      { "rideDetails.productName": new RegExp(q, "i") },
      { "pickupLocation.address": new RegExp(q, "i") },
      { "dropoffLocation.address": new RegExp(q, "i") },
    ];
  }

  const [bookings, total, guestOptions] = await Promise.all([
    UberBooking.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .populate("guestId", "firstName lastName email mobile")
      .lean(),
    UberBooking.countDocuments(filter),
    UberBooking.aggregate([
      { $group: { _id: "$guestId", count: { $sum: 1 } } },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "guest" } },
      { $unwind: "$guest" },
      { $project: { _id: 1, count: 1, firstName: "$guest.firstName", lastName: "$guest.lastName", email: "$guest.email" } },
      { $sort: { firstName: 1, lastName: 1 } },
    ]),
  ]);

  return res.render("pages/admin/uber-booking/index", {
    sidebar: "uberBooking",
    bookings,
    pagination: {
      total,
      totalPages: Math.ceil(total / limitNumber),
      currentPage: pageNumber,
      itemsPerPage: limitNumber,
    },
    filters: { status, liked, q, guestId },
    guestOptions,
  });
});

const showUberBookingDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const booking = await UberBooking.findById(id)
    .populate("guestId", "firstName lastName email mobile")
    .lean();

  if (!booking) {
    return res.status(404).render("errors", { message: "Uber booking not found" });
  }

  const relatedBookings = await UberBooking.find({
    guestId: booking.guestId?._id || booking.guestId,
    _id: { $ne: booking._id },
  })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  return res.render("pages/admin/uber-booking/show", {
    sidebar: "uberBooking",
    booking,
    relatedBookings,
  });
});



export {
  showDashboard,
  showLoginPage,
  loginAdmin,
  logoutAdmin,
  showForgotPasswordPage,
  handleForgotPassword,
  showResetPasswordPage,
  handleResetPassword,
  getAdminProfile,
  updateAdminProfile,
  updateAdminProfileImage,
  changeAdminPassword,
  listGuest,
  viewGuest,
  updateGuestStatus,
  listHost,
  viewHost,
  updateHostStatus,
  verifyUpdate,
  toggleKYCStatus,
  listVendor,
  viewVendor,
  vendorForm,
  updateVendor,
  updateVendorStatus,
  listDiscountCode,
  showDiscountCodeForm,
  createDiscountCode,
  updateDiscountCode,
  updateDiscountCodeStatus,
  listRefundPolicies,
  showRefundPolicyForm,
  createRefundPolicy,
  updateRefundPolicy,
  updateRefundPolicyStatus,
  listProperties,
  showPropertiesDetails,
  togglePropertyStatus,
  updatePropertyStatus,
  propertyBookingList,
  propertyBookingFilter,
  propertyBookingDetails,
  propertyBookingStatusUpdate,
  updateTopVacationStatus,
  listPropertyType,
  showPropertyTypeDetails,
  showPropertyTypeForm,
  createPropertyType,
  updatePropertyType,
  updatePropertyTypeStatus,
  listConciergeServices,
  showConciergeServiceDetails,
  showConciergeServiceForm,
  createConciergeService,
  updateConciergeService,
  updateConciergeServiceStatus,
  getBookingService,
  getBookingServiceById,
  updateBookingServiceStatus,
  listAmenity,
  showAmenityForm,
  createAmenity,
  updateAmenity,
  updateAmenityStatus,
  listAmenityRequest,
  updateAmenityRequestStatus,
  updateAmenityRequestDetails,
  listEvent,
  getFilteredEvents,
  showEventDetails,
  showEventForm,
  saveEvent,
  showEventMemberList,
  getEventBookingDetails,
  cancelRequestUpdate,
  eventCancel,
  eventBooking,
  listEventCategory,
  showEventCategoryDetails,
  showEventCategoryForm,
  createEventCategory,
  updateEventCategory,
  updateEventCategoryStatus,
  contactEnquiry,
  getContactEnquiries,
  getContactEnquiryDetails,
  updateEnquiryStatus,
  contactEnquiryTypeList,
  createContactEnquiryType,
  updateContactEnquiryType,
  updateStatusContactEnquiryType,
  getSetting,
  updateSetting,
  faqList,
  createFAQ,
  updateFAQ,
  deleteFAQ,
  pagesList,
  getPage,
  savePage,
  updateHomePropertyTypes,
  updateHomeServices,
  updateHomeEvents,
  updateSlider,
  getNotificationList,
  getNotifications,
  markAllNotificationsAsRead,
  getNotificationDetails,
  getNewsletterList,
  getComingSoonEmailList,
  ticketView,
  getTicketsApi,
  getTicketConversation,
  sendReply,
  updateTicketStatus,
  getTicketStats,
  resetAdminUnreadCount,
  permissionList,
  createPermission,
  adminRolesList,
  adminRolesForm,
  updateAdminPermission,
  adminUserList,
  adminUserForm,
  createAdminUser,
  updateAdminUser,
  updateAdminUserStatus,
  supportFaqList,
  supportFaqForm,
  supportFaqCreate,
  supportFaqUpdate,
  supportFaqShow,
  saveSuggestion,
  deleteSuggestion,
  stripeWebhook,
  razorpayWebhook,
  testPaymentEvent,
  testPaymentProperty,
  listUberBookings,
  showUberBookingDetails,

};
