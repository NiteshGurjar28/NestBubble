import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import {
  Vendor,
  VendorDiscountCode,
  VendorRefundPolicy,
} from "../models/Vendor.model.js";
import { ConciergeService } from "../models/ConciergeService.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { createActivityLog } from "../utils/activityLog.helper.js";
import { sendOTP } from "../utils/twilio.js";
import mongoose from "mongoose";
import uberService from "../utils/uberService.js";

// Uber OAuth: Start authorization (redirect URL)
const startUberOAuth = asyncHandler(async (req, res) => {
  const userId = req.user?._id?.toString();
  if (!userId) {
    return res.status(401).json(new ApiError(401, "Unauthorized"));
  }
  
  try {
    const authorizeUrl = uberService.buildAuthorizeUrl(userId);
    return res
      .status(200)
      .json(new ApiResponse(200, { authorizeUrl }, "Uber OAuth URL generated"));
  } catch (e) {
    if (e.code === "UBER_OAUTH_CONFIG_MISSING") {
      return res.status(400).json(new ApiError(400, e.message));
    }
    return res.status(500).json(new ApiError(500, "Failed to start Uber OAuth"));
  }
});

// Uber OAuth: Callback to exchange code and save tokens
const uberOAuthCallback = asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return res
      .status(400)
      .json(new ApiError(400, "Missing code or state in callback"));
  }
  try {
    const tokenData = await uberService.exchangeCodeForTokens(code);
    const expiresInSec = tokenData.expires_in || 0;
    const expiresAt = new Date(Date.now() + expiresInSec * 1000);

    const user = await User.findById(state);
    if (!user) {
      return res.status(404).json(new ApiError(404, "User not found"));
    }

    user.uberAuth = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      scope: tokenData.scope,
      lastUpdatedAt: new Date(),
    };
    await user.save();

    return res
      .status(200)
      .json(new ApiResponse(200, { }, "Uber account connected"));
  } catch (err) {
    console.error("Uber OAuth callback error:", err.response?.data || err.message);
    return res
      .status(500)
      .json(new ApiError(500, "Failed to connect Uber account", err.message));
  }
});

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

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 -digit OTP
};

const handleMobileAuth = asyncHandler(async (req, res) => {
  const {
    countryCode = "+91",
    mobile,
    firstName,
    lastName,
    email,
    profileImage,
  } = req.body;

  if (!mobile) {
    return res
      .status(400)
      .json(new ApiError(400, "Mobile number are required"));
  }

  try {
    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    // Check if signup attempt
    const isSignUpAttempt = firstName || lastName || email || profileImage;

    if (isSignUpAttempt) {
      // Validate signup fields
      if (!firstName || !lastName || !email) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "First name, last name, and email are required for new users"
            )
          );
      }

      const [existingMobile, existingEmail] = await Promise.all([
        User.findOne({ mobile }),
        User.findOne({ email }),
      ]);

      if (existingMobile)
        return res
          .status(400)
          .json(new ApiError(400, "Mobile number already registered"));
      if (existingEmail)
        return res
          .status(400)
          .json(new ApiError(400, "Email already registered"));

      await User.create({
        countryCode,
        mobile,
        firstName,
        lastName,
        email,
        profileImage: profileImage || undefined,
        mobileOtp: { code: otp, expiresAt: otpExpiry },
        roles: ["guest"],
        profileCompletionStatus: "complete",
      });
    } else {
      const user = await User.findOne({ countryCode, mobile });
      if (!user)
        return res
          .status(404)
          .json(new ApiError(404, "User not found. Please sign up first."));
      if (user.roles.includes("admin"))
        return res.status(404).json(new ApiError(404, "User Not found"));

      user.mobileOtp = { code: otp, expiresAt: otpExpiry };
      await user.save();
    }

    // await sendOTP(countryCode, mobile, otp);

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { mobile, otp, countryCode },
          "OTP sent successfully"
        )
      );
  } catch (error) {
    console.error("Authentication error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", error.message));
  }
});

const verifyMobileOTP = asyncHandler(async (req, res) => {
  const { mobile, otp } = req.body;

  if (!mobile || !otp) {
    return res
      .status(400)
      .json(new ApiError(400, "Mobile and OTP are required"));
  }

  try {
    const user = await User.findOne({
      mobile,
      "mobileOtp.code": otp,
      "mobileOtp.expiresAt": { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json(new ApiError(400, "Invalid OTP or expired"));
    }

    // check isActive
    if (user.isActive === false) {
      return res.status(400).json(new ApiError(401, "Your account is Blocked"));
    }

    user.mobileOtp = undefined;
    user.lastLogin = new Date();

    const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(
      user._id
    );
    user.refreshToken = refreshToken;
    user.accessToken = accessToken;

    await user.save();

    await createActivityLog({
      entityType: "User",
      entityId: user._id,
      userId: user._id,
      userRole: "guest",
      action: "login",
    });

    // Set cookie options
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    };

    const userToReturn = await User.findById(user._id).select("-password");

    return res
      .status(200)
      .cookie("accessToken", accessToken, cookieOptions)
      .cookie("refreshToken", refreshToken, cookieOptions)
      .json(
        new ApiResponse(
          200,
          { user: userToReturn },
          "OTP verified successfully"
        )
      );
  } catch (error) {
    console.error("OTP verification error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const socialLogin = asyncHandler(async (req, res) => {
  const { email, name, googleId, appleId } = req.body;

  if (!googleId && !appleId) {
    return res
      .status(400)
      .json(new ApiError(400, "Social ID (Google or Apple) is required"));
  }

  try {
    let user;

    // Find user by social ID
    if (googleId) {
      user = await User.findOne({ "socialAuth.googleId": googleId });
    } else if (appleId) {
      user = await User.findOne({ "socialAuth.appleId": appleId });
    }

    // Create user if not found
    if (!user) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) {
        user = await User.findOneAndUpdate(
          { email },
          {
            socialAuth: {
              googleId: googleId || null,
              appleId: appleId || null,
            },
          },
          { new: true } // Return the updated document
        );
      } else {
        user = await User.create({
          email: email,
          firstName: name,
          socialAuth: {
            googleId: googleId || null,
            appleId: appleId || null,
          },
          roles: ["guest"],
          profileCompletionStatus: "complete",
        });
      } 
    }

    if (user.isActive === false) {
      return res.status(400).json(new ApiError(401, "Your account is Blocked"));
    }

    user.lastLogin = new Date();

    const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(
      user._id
    );
    user.accessToken = accessToken;
    user.refreshToken = refreshToken;

    await user.save();

    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    };

    const userToReturn = await User.findById(user._id).select("-password");

    await createActivityLog({
      entityType: "User",
      entityId: userToReturn._id,
      userId: userToReturn._id,
      userRole: "guest",
      action: "login",
    });

    return res
      .status(200)
      .cookie("accessToken", accessToken, cookieOptions)
      .cookie("refreshToken", refreshToken, cookieOptions)
      .json(new ApiResponse(200, { user: userToReturn }, "Login successful"));
  } catch (error) {
    console.error("Social auth error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const becomeHost = asyncHandler(async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    address,
    aadharNumber,
    panNumber,
    aadharFrontImage,
    aadharBackImage,
    panImage,
    acceptedTerms,
  } = req.body;

  try {
    // Validate required fields
    if (
      !firstName ||
      !lastName ||
      !email ||
      !aadharNumber ||
      !panNumber ||
      !aadharFrontImage ||
      !aadharBackImage ||
      !panImage ||
      !acceptedTerms
    ) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            "First name, last name, mobile, aadharNumber, panNumber, aadharFrontImage, aadharBackImage, panImage, acceptedTerms and email are required"
          )
        );
    }

    // Validate Aadhaar number format (12 digits)
    if (aadharNumber && !/^\d{12}$/.test(aadharNumber)) {
      return res
        .status(400)
        .json(new ApiError(400, "Aadhaar number must be 12 digits"));
    }

    // Validate PAN number format (10 characters)
    if (panNumber && !/^[A-Z]{5}\d{4}[A-Z]{1}$/.test(panNumber)) {
      return res
        .status(400)
        .json(new ApiError(400, "Invalid PAN number format"));
    }

    // Prepare update data
    const updateData = {
      firstName,
      lastName,
      email,
      address: {
        ...req.user.address, // Preserve existing address data
        ...address, // Merge with new address data
      },
      acceptedTerms,
      roles: ["guest", "host"],
      activeRole: "host",
      profileCompletionStatus: "complete",
      updatedAt: new Date(),
    };

    const currentUser = await User.findById(req.user._id);

    // Check if mobile is being updated and is different from current one
    if (email && email !== currentUser.email) {
      const existingEmailUser = await User.findOne({
        email,
        _id: { $ne: req.user._id },
      });

      if (existingEmailUser) {
        return res.status(400).json(new ApiError(400, "Email already in use"));
      }

      updateData.email = email; // set only if valid and not same as old
    }

    // Only update KYC fields if they're provided
    if (
      aadharNumber ||
      panNumber ||
      aadharFrontImage ||
      aadharBackImage ||
      panImage
    ) {
      updateData.kyc = {
        ...req.user.kyc, // Preserve existing KYC data
        aadharNumber: aadharNumber || req.user.kyc?.aadharNumber,
        panNumber: panNumber || req.user.kyc?.panNumber,
        aadharFrontImage: aadharFrontImage || req.user.kyc?.aadharFrontImage,
        aadharBackImage: aadharBackImage || req.user.kyc?.aadharBackImage,
        panImage: panImage || req.user.kyc?.panImage,
      };
    }

    // Update user
    const user = await User.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
      runValidators: true,
    }).select("-password -refreshToken -accessToken -socialAuth");

    if (!user) {
      return res.status(404).json(new ApiError(404, "User not found"));
    }

    await createActivityLog({
      entityType: "User",
      entityId: user._id,
      userId: user._id,
      userRole: "host",
      action: "create",
    });

    return res
      .status(200)
      .json(new ApiResponse(200, user, "Host profile created successfully"));
  } catch (error) {
    console.error("Host profile error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const becomeVendor = asyncHandler(async (req, res) => {
  const {
    vendorType,
    firstName,
    lastName,
    phoneNumber,
    emailAddress,
    yearsOfExperience,
    languageSpoken,
    workingDaysAndHours,
    address,
    cityDistrict,
    state,
    pinCode,
    serviceableLocations,
    residentialAddress,
    paymentModeOfCommunication,
    personalInfo,
    businessInfo,
    serviceCategories,
    bankingDetails,
    documents,
    pricing,
    agreements,
  } = req.body;

  try {
    // Validate required fields
    if (!vendorType || !["individual", "business"].includes(vendorType)) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            "Valid vendorType (individual or business) is required"
          )
        );
    }

    // Common required fields for all vendors
    if (
      !firstName ||
      !lastName ||
      !phoneNumber ||
      !address ||
      !cityDistrict ||
      !state ||
      !pinCode ||
      !serviceCategories ||
      !serviceCategories.length ||
      !agreements ||
      !agreements.termsAndConditions ||
      !agreements.authenticityOfDocuments ||
      !agreements.conductBackgroundVerification ||
      !agreements.serviceLevelAgreement
    ) {
      return res.status(400).json(new ApiError(400, "Missing required fields"));
    }

    // Individual vendor specific validations
    if (vendorType === "individual") {
      if (
        !yearsOfExperience ||
        !languageSpoken ||
        !languageSpoken.length ||
        !personalInfo ||
        !personalInfo.dateOfBirth ||
        !personalInfo.gender
      ) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "For individual vendors, lastName, yearsOfExperience, languageSpoken, and personalInfo (dateOfBirth, gender) are required"
            )
          );
      }
    }

    // Business vendor specific validations
    if (vendorType === "business") {
      if (
        !businessInfo ||
        !businessInfo.businessName ||
        !emailAddress ||
        !businessInfo.businessType ||
        !businessInfo.businessPhoneNumber
      ) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "For business vendors, businessInfo (businessName, businessType, businessPhoneNumber) are required"
            )
          );
      }
    }

    // Validate banking details if provided
    if (bankingDetails) {
      const {
        preferredPaymentMode,
        holderName,
        bankName,
        accountNumber,
        ifscCode,
        upiId,
      } = bankingDetails;
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

    if (pricing) {
      const { discountCodeId, refundPolicyId } = pricing;

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

    // // Check if all service categories exist in ConciergeService collection
    // const validServices = await ConciergeService.find({
    //     _id: { $in: serviceCategories.map(id => new mongoose.Types.ObjectId(id)) },
    //     isActive: true
    // });

    // if (validServices.length !== serviceCategories.length) {
    //     const validIds = validServices.map(service => service._id.toString());
    //     const invalidIds = serviceCategories.filter(
    //         id => !validIds.includes(id)
    //     );
    //     return res.status(400).json(new ApiError(400,
    //         `Invalid or inactive service categories: ${invalidIds.join(', ')}`
    //     ));
    // }
    // Prepare vendor data
    const vendorData = {
      vendorType,
      userId: req.user._id,
      firstName,
      lastName,
      phoneNumber,
      emailAddress,
      yearsOfExperience,
      languageSpoken,
      workingDaysAndHours,
      address,
      cityDistrict,
      state,
      pinCode,
      serviceableLocations,
      residentialAddress,
      paymentModeOfCommunication,
      personalInfo: vendorType === "individual" ? personalInfo : undefined,
      businessInfo: vendorType === "business" ? businessInfo : undefined,
      serviceCategories,
      bankingDetails,
      documents,
      pricing,
      agreements,
    };

    // Check if user already has a vendor profile
    const existingVendor = await Vendor.findOne({ userId: req.user._id });

    if (existingVendor) {
      /// send error message
      return res
        .status(400)
        .json(new ApiError(400, "This User already has a vendor profile"));
    } else {
      // Create new vendor profile
      const newVendor = await Vendor.create(vendorData);

      await createActivityLog({
        entityType: "Vendor",
        entityId: newVendor._id,
        userId: req.user._id,
        userRole: "guest",
        action: "create",
      });

      return res
        .status(201)
        .json(
          new ApiResponse(201, newVendor, "Vendor profile created successfully")
        );
    }
  } catch (error) {
    console.error("Vendor profile error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const logoutUser = asyncHandler(async (req, res) => {
  try {
    // Get user from request (assuming you have auth middleware that attaches user)
    const userId = req.user._id;
    const user = await User.findById(userId).select(
      "-password -refreshToken -accessToken -socialAuth"
    );

    if (!user) {
      return res
        .status(401)
        .json(new ApiError(401, "Unauthorized - No user found"));
    }

    await createActivityLog({
      entityType: "User",
      entityId: userId,
      userId: userId,
      userRole: "guest",
      action: "logout",
    });

    // Clear tokens from user document
    user.accessToken = undefined;
    user.refreshToken = undefined;
    await user.save();

    // Clear cookies
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    };

    return res
      .status(200)
      .clearCookie("accessToken", cookieOptions)
      .clearCookie("refreshToken", cookieOptions)
      .json(new ApiResponse(200, {}, "User logged out successfully"));
  } catch (error) {
    console.error("Logout error:", error);
    return res
      .status(500)
      .json(new ApiError(500, "Internal Server Error", [error.message]));
  }
});

const switchRole = asyncHandler(async (req, res) => {
  try {
    const { role } = req.body;
    const userId = req.user._id;

    // Validate input
    if (!role || !["guest", "host"].includes(role)) {
      return res
        .status(400)
        .json(new ApiError(400, "Invalid role. Allowed values: guest or host"));
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json(new ApiError(404, "User not found"));
    }

    // Check if user has the requested role
    if (!user.roles.includes(role)) {
      return res
        .status(403)
        .json(
          new ApiError(
            403,
            `You don't have ${role} role assigned to your account`
          )
        );
    }

    // Update active role
    user.activeRole = role;
    await user.save();

    // Return success response
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { activeRole: user.activeRole },
          "Role switched successfully"
        )
      );
  } catch (error) {
    console.error("Error switching role:", error.message);
    return res
      .status(500)
      .json(new ApiError(500, "An error occurred while switching roles"));
  }
});

export {
  handleMobileAuth,
  verifyMobileOTP,
  socialLogin,
  becomeHost,
  becomeVendor,
  logoutUser,
  switchRole,
  startUberOAuth,
  uberOAuthCallback,
};
