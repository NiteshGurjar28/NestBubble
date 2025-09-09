import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";
import { AdminRoles } from "../models/Permission.model.js";
import { Notification } from "../models/Notification.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import uberService from "../utils/uberService.js";

export const verifyJWT = asyncHandler(async (req, res, next) => {
  try {
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");
    if (!token) {
       return res.status(401).json(new ApiError(401, "Unauthorized request"));
    }

    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    const user = await User.findById(decodedToken?._id).select(
      "-password -refreshToken"
    );
    if (user.isActive === false) {
      return res.status(400).json(new ApiError(400, "Account is Blocked By Admin"));
    }

    if (!user) {
       return res.status(400).json(new ApiError(400, "Invalid Access Token"));
    }
    req.user = user;
    next();
  } catch (error) {
      return res.status(400).json(new ApiError(400, error?.message || "Invalid access token"));
  }
});

export const verifyHostRole = asyncHandler(async (req, res, next) => {
  try {
    if (!req.user?.roles?.includes("host")) {
        return res.status(403).json(new ApiError(403, "Access denied: Host role required"));
    }
    next();
  } catch (error) {
      return res.status(403).json(new ApiError(403, "Internal server error", [error.message]));
  }
});

export const verifyGuestRole = asyncHandler(async (req, res, next) => {
  try {
    if (!req.user?.roles?.includes("guest")) {
        return res.status(403).json(new ApiError(403, "Access denied: Guest role required"));
    }
    next();
  } catch (error) {
      return res.status(403).json(new ApiError(403, "Internal server error", [error.message]));
  }
});

export const optionalJWT = asyncHandler(async (req, _, next) => {
  try {
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");
      
    if (token) {
      const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      const user = await User.findById(decodedToken?._id).select(
        "-password -refreshToken"
      );
      
      if (user) {
        if (user.isActive === false) {
          return res.status(400).json(new ApiError(401, "Account is Blocked By Admin"));
        }
        req.user = user;
      }
    }
    next();
  } catch (error) {
    // Don't throw error, just continue without user
    next();
  }
});

export const isAdmin = asyncHandler(async (req, res, next) => {
  try {
    // 1. Get token from cookies or Authorization header
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");
    
    if (!token) {
        return res.render("pages/admin/auth/login");
    }

    // 2. Verify token
    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // 3. Find user and exclude sensitive fields
    const user = await User.findById(decodedToken?._id).select(
      "-password -refreshToken"
    );

    // 4. Check if user exists and has admin role
    if (!user || !user.roles.includes("admin")) {
         return res.render("pages/admin/auth/login");
    }

    // 5. Check if user is active
    if (!user.isActive) {
      // Clear tokens from database
      await User.findByIdAndUpdate(
        user._id,
        {
          $unset: {
            refreshToken: 1,
            accessToken: 1
          },
        },
        { new: true }
      );

      // Clear cookies and redirect to login
      const options = {   httpOnly: true, sameSite: 'strict' };
      
      return res
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .render("pages/admin/auth/login", {
          message: "Your account has been deactivated"
        });
    }

    // 6. Attach user to request and response locals
    req.admin = user;
    res.locals.adminDetails = user;

    /// 7.  set unread notifiction count
    res.locals.unreadNotificationCount = await Notification.countDocuments({
      // 'recipient.user': user._id,
      'recipient.role': 'admin',
      isRead: false
    }) || 0;

    // 8. AdminRole Premissions
    const adminRole = await AdminRoles.findOne({ role: user.adminRole }).populate('permissions');
    if (!adminRole) {
      return res.render("pages/admin/auth/login");
    }
    res.locals.adminPerms = adminRole.permissions.map(p => p.name);
    
    // 9. Proceed to next middleware
    next();

  } catch (error) {
      return res.render("pages/admin/auth/login");
  }
});

export const checkPermission = (requiredPermission) => {
  return asyncHandler(async (req, res, next) => {
    try {
      // Get admin permissions from res.locals (set by isAdmin middleware)
      const adminPerms = res.locals.adminPerms || [];
      
      // Check if admin has the required permission
      if (!adminPerms.includes(requiredPermission)) {
        return res.status(403).render("pages/admin/auth/not-authorized");
      }
      
      next();
    } catch (error) {
      return res.status(403).render("pages/admin/auth/not-authorized");
    }
  });
};

// Ensure user has connected Uber (OAuth). Refresh if expired and attach token.
export const verifyUberAuth = asyncHandler(async (req, res, next) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json(new ApiError(401, "Unauthorized"));
    }

    const user = await User.findById(req.user._id);
    if (!user?.uberAuth?.accessToken) {
      const connectUrl = `${req.protocol}://${req.get("host")}/api/v1/auth/uber`;
      return res
        .status(401)
        .json(new ApiError(401, "Connect Uber account first", { connectUrl }));
    }

    // Refresh if expired
    if (user.uberAuth.expiresAt && new Date(user.uberAuth.expiresAt) < new Date()) {
      try {
        const refreshed = await uberService.refreshAccessToken(user.uberAuth.refreshToken);
        user.uberAuth.accessToken = refreshed.access_token;
        user.uberAuth.refreshToken = refreshed.refresh_token || user.uberAuth.refreshToken;
        user.uberAuth.expiresAt = new Date(Date.now() + (refreshed.expires_in || 0) * 1000);
        user.uberAuth.scope = refreshed.scope;
        user.uberAuth.lastUpdatedAt = new Date();
        await user.save();
      } catch (e) {
        const connectUrl = `${req.protocol}://${req.get("host")}/api/v1/auth/uber`;
        return res
          .status(401)
          .json(new ApiError(401, "Uber token refresh failed. Reconnect required.", { connectUrl }));
      }
    }

    req.uberAccessToken = user.uberAuth.accessToken;
    next();
  } catch (error) {
    return res.status(401).json(new ApiError(401, "Uber authorization failed"));
  }
});