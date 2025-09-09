import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { UberBooking } from "../models/UberBooking.model.js";
import { User } from "../models/user.model.js";
import uberService from "../utils/uberService.js";
import mongoose from "mongoose";

/**
 * Get available Uber products (ride types) for a location
 */
const getAvailableProducts = asyncHandler(async (req, res) => {
  try {
    const { latitude, longitude } = req.query;

    // Validate coordinates
    if (!latitude || !longitude) {
      return res.status(400).json(
        new ApiError(400, "Latitude and longitude are required")
      );
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (!uberService.validateCoordinates(lat, lng)) {
      return res.status(400).json(
        new ApiError(400, "Invalid coordinates provided")
      );
    }

    // Token ensured by verifyUberAuth; use req.uberAccessToken
    const uberAuth = { accessToken: req.uberAccessToken };
    if (uberAuth?.accessToken) {
      let accessToken = uberAuth.accessToken;
      // Refresh if expired
      if (uberAuth.expiresAt && new Date(uberAuth.expiresAt) < new Date()) {
        try {
          const refreshed = await uberService.refreshAccessToken(uberAuth.refreshToken);
          accessToken = refreshed.access_token;
          await User.findByIdAndUpdate(req.user._id, {
            $set: {
              "uberAuth.accessToken": refreshed.access_token,
              "uberAuth.refreshToken": refreshed.refresh_token || uberAuth.refreshToken,
              "uberAuth.expiresAt": new Date(Date.now() + (refreshed.expires_in || 0) * 1000),
              "uberAuth.scope": refreshed.scope,
              "uberAuth.lastUpdatedAt": new Date(),
            },
          });
        } catch (e) {
          console.error("Uber token refresh failed:", e.response?.data || e.message);
        }
      }

      try {
        const data = await uberService.callWithUserToken(`/products?latitude=${lat}&longitude=${lng}`, accessToken);
        const formatted = (data?.products || []).map((product) => ({
          productId: product.product_id,
          displayName: product.display_name,
          description: product.description,
          capacity: product.capacity,
          image: product.image,
          shared: product.shared,
          upfrontFareEnabled: product.upfront_fare_enabled,
        }));
        return res
          .status(200)
          .json(new ApiResponse(200, formatted, "Uber products fetched"));
      } catch (e) {
        console.error("Uber products with token failed:", e.response?.data || e.message);
         return res.status(500).json(new ApiError(500, "Internal server error", [e.response?.data || e.message]));
      }
    }

    // Fallback: no token connected
    const connectUrl = `${req.protocol}://${req.get("host")}/api/v1/auth/uber`;
    return res.status(401).json(
      new ApiError(401, "Connect Uber account first", { connectUrl })
    );
  } catch (error) {
    console.error("Error fetching products:", error);
    return res.status(500).json(
      new ApiError(500, "Failed to fetch available ride options", error.message)
    );
  }
});

/**
 * Get price estimates for a ride
 */
const getPriceEstimates = asyncHandler(async (req, res) => {
  try {
    const { 
      startLatitude, 
      startLongitude, 
      endLatitude, 
      endLongitude 
    } = req.query;

    // Validate coordinates
    if (!startLatitude || !startLongitude || !endLatitude || !endLongitude) {
      return res.status(400).json(
        new ApiError(400, "All coordinates (start and end) are required")
      );
    }

    const startLat = parseFloat(startLatitude);
    const startLng = parseFloat(startLongitude);
    const endLat = parseFloat(endLatitude);
    const endLng = parseFloat(endLongitude);

    if (!uberService.validateCoordinates(startLat, startLng) || 
        !uberService.validateCoordinates(endLat, endLng)) {
      return res.status(400).json(
        new ApiError(400, "Invalid coordinates provided")
      );
    }

    // Uber API requires OAuth; return approximate estimate based on distance
    const distanceKm = uberService.calculateDistance(startLat, startLng, endLat, endLng);
    const avgSpeedKmph = 30; // rough city average
    const durationSec = Math.round((distanceKm / avgSpeedKmph) * 3600);
    const approx = [{
      productId: null,
      displayName: "Approximate",
      estimate: null,
      lowEstimate: null,
      highEstimate: null,
      currency: null,
      duration: durationSec,
      distance: distanceKm,
    }];

    return res
      .status(200)
      .json(new ApiResponse(200, approx, "Approximate estimate without OAuth"));
  } catch (error) {
    console.error("Error fetching price estimates:", error);
    return res.status(500).json(
      new ApiError(500, "Failed to fetch price estimates", error.message)
    );
  }
});

/**
 * Get time estimates for pickup
 */
const getTimeEstimates = asyncHandler(async (req, res) => {
  try {
    const { latitude, longitude, productId } = req.query;

    // Validate coordinates
    if (!latitude || !longitude) {
      return res.status(400).json(
        new ApiError(400, "Latitude and longitude are required")
      );
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (!uberService.validateCoordinates(lat, lng)) {
      return res.status(400).json(
        new ApiError(400, "Invalid coordinates provided")
      );
    }

    // Uber API requires OAuth; return a rough ETA placeholder
    const etaSec = 5 * 60; // 5 minutes
    const fallback = [{
      productId: productId || null,
      displayName: "Approximate",
      estimate: etaSec,
    }];

    return res
      .status(200)
      .json(new ApiResponse(200, fallback, "Approximate ETA without OAuth"));
  } catch (error) {
    console.error("Error fetching time estimates:", error);
    return res.status(500).json(
      new ApiError(500, "Failed to fetch time estimates", error.message)
    );
  }
});

/**
 * Request a ride (Guest booking)
 */
const requestRide = asyncHandler(async (req, res) => {
  try {
    const {
      productId,
      pickupLocation,
      dropoffLocation,
      fareId,
      paymentMethodId,
      surgeConfirmationId,
      notes,
      specialRequests
    } = req.body;

    const guestId = req.user._id;

    // Validate required fields
    if (!productId || !pickupLocation || !dropoffLocation) {
      return res.status(400).json(
        new ApiError(400, "Product ID, pickup location, and dropoff location are required")
      );
    }

    // Validate coordinates
    if (!uberService.validateCoordinates(
      pickupLocation.coordinates.latitude, 
      pickupLocation.coordinates.longitude
    ) || !uberService.validateCoordinates(
      dropoffLocation.coordinates.latitude, 
      dropoffLocation.coordinates.longitude
    )) {
      return res.status(400).json(
        new ApiError(400, "Invalid coordinates provided")
      );
    }

    // Generate deeplink instead of server-side ride request
    const deeplink = await uberService.requestRide({
      productId,
      startLatitude: pickupLocation.coordinates.latitude,
      startLongitude: pickupLocation.coordinates.longitude,
      endLatitude: dropoffLocation.coordinates.latitude,
      endLongitude: dropoffLocation.coordinates.longitude,
      pickupAddress: pickupLocation.address,
      dropoffAddress: dropoffLocation.address,
    });

    // Get product details for additional information (no auth required)
    const products = await uberService.getProducts(
      pickupLocation.coordinates.latitude,
      pickupLocation.coordinates.longitude
    );
    const selectedProduct = products.find(p => p.product_id === productId);

    // Create booking record in database
    const uberBooking = await UberBooking.create({
      guestId,
      uberRequestId: `deeplink:${Date.now()}`,
      uberProductId: productId,
      pickupLocation: {
        address: pickupLocation.address,
        coordinates: {
          latitude: pickupLocation.coordinates.latitude,
          longitude: pickupLocation.coordinates.longitude,
        },
      },
      dropoffLocation: {
        address: dropoffLocation.address,
        coordinates: {
          latitude: dropoffLocation.coordinates.latitude,
          longitude: dropoffLocation.coordinates.longitude,
        },
      },
      rideDetails: {
        productName: selectedProduct?.display_name || "Uber Ride",
        productDescription: selectedProduct?.description,
        capacity: selectedProduct?.capacity || 4,
        priceEstimate: null,
        durationEstimate: null,
        distanceEstimate: null, // Will be updated when trip starts
      },
      status: "processing",
      paymentInfo: {
        paymentMethodId,
        paymentStatus: "pending",
      },
      metadata: {
        requestTime: new Date(),
        notes,
        specialRequests: specialRequests || [],
        deeplink,
      },
    });

    return res.status(201).json(
      new ApiResponse(201, {
        booking: uberBooking,
        deeplink,
      }, "Ride requested successfully")
    );
  } catch (error) {
    console.error("Error requesting ride:", error);
    return res.status(500).json(
      new ApiError(500, "Failed to request ride", error.message)
    );
  }
});

/**
 * Get ride details
 */
const getRideDetails = asyncHandler(async (req, res) => {
  try {
    const { bookingId } = req.params;
    const guestId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json(
        new ApiError(400, "Invalid booking ID")
      );
    }

    // Find booking in database
    const booking = await UberBooking.findOne({
      _id: bookingId,
      guestId
    }).populate("guestId", "firstName lastName email mobile");

    if (!booking) {
      return res.status(404).json(
        new ApiError(404, "Booking not found")
      );
    }

    // Without user OAuth, cannot fetch live details. Return stored record and deeplink

    return res.status(200).json(
      new ApiResponse(200, booking, "Ride details fetched successfully")
    );
  } catch (error) {
    console.error("Error fetching ride details:", error);
    return res.status(500).json(
      new ApiError(500, "Failed to fetch ride details", error.message)
    );
  }
});

/**
 * Cancel a ride
 */
const cancelRide = asyncHandler(async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { cancellationReason } = req.body;
    const guestId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json(
        new ApiError(400, "Invalid booking ID")
      );
    }

    // Find booking in database
    const booking = await UberBooking.findOne({
      _id: bookingId,
      guestId
    });

    if (!booking) {
      return res.status(404).json(
        new ApiError(404, "Booking not found")
      );
    }

    // Check if booking can be cancelled
    if (!booking.canBeCancelled()) {
      return res.status(400).json(
        new ApiError(400, "This ride cannot be cancelled at this time")
      );
    }

    // Update booking status (client cancels before requesting within deeplink)
    booking.status = "cancelled";
    booking.cancellation = {
      isCancelled: true,
      cancelledBy: "rider",
      cancellationReason: cancellationReason || "Cancelled by rider",
      cancellationTime: new Date(),
      cancellationFee: 0, // Will be updated if there's a cancellation fee
    };

    await booking.save();

    return res.status(200).json(
      new ApiResponse(200, booking, "Ride cancelled successfully")
    );
  } catch (error) {
    console.error("Error cancelling ride:", error);
    return res.status(500).json(
      new ApiError(500, "Failed to cancel ride", error.message)
    );
  }
});

/**
 * Get user's ride history
 */
const getRideHistory = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status = "",
      sortBy = "createdAt",
      sortOrder = "desc"
    } = req.query;

    const guestId = req.user._id;
    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);

    // Build filter
    const filter = { guestId };
    if (status) {
      filter.status = status;
    }

    // Build sort
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Get bookings with pagination
    const bookings = await UberBooking.find(filter)
      .sort(sortOptions)
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .populate("guestId", "firstName lastName email mobile")
      .lean();

    // Get total count
    const totalBookings = await UberBooking.countDocuments(filter);

    // Get status counts
    const statusCounts = await UberBooking.aggregate([
      { $match: { guestId: new mongoose.Types.ObjectId(guestId) } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    const statusCountMap = {};
    statusCounts.forEach(item => {
      statusCountMap[item._id] = item.count;
    });

    return res.status(200).json(
      new ApiResponse(200, {
        bookings,
        pagination: {
          totalBookings,
          totalPages: Math.ceil(totalBookings / limitNumber),
          currentPage: pageNumber,
          itemsPerPage: limitNumber,
          hasNextPage: pageNumber < Math.ceil(totalBookings / limitNumber),
          hasPreviousPage: pageNumber > 1,
        },
        statusCounts: statusCountMap,
      }, "Ride history fetched successfully")
    );
  } catch (error) {
    console.error("Error fetching ride history:", error);
    return res.status(500).json(
      new ApiError(500, "Failed to fetch ride history", error.message)
    );
  }
});

/**
 * Get ride receipt
 */
const getRideReceipt = asyncHandler(async (req, res) => {
  try {
    const { bookingId } = req.params;
    const guestId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json(
        new ApiError(400, "Invalid booking ID")
      );
    }

    // Find booking in database
    const booking = await UberBooking.findOne({
      _id: bookingId,
      guestId
    });

    if (!booking) {
      return res.status(404).json(
        new ApiError(404, "Booking not found")
      );
    }

    // Live receipt not available without user OAuth
    const receipt = booking.tripInfo?.actualFare
      ? {
          request_id: booking.uberRequestId,
          charges: [
            {
              name: "Trip Fare",
              amount: booking.tripInfo.actualFare.amount,
              type: "base_fare",
            },
          ],
          total_charged: booking.tripInfo.actualFare.amount,
          currency_code: booking.tripInfo.actualFare.currency,
        }
      : null;

    return res.status(200).json(
      new ApiResponse(200, {
        booking,
        receipt,
      }, "Ride receipt fetched successfully")
    );
  } catch (error) {
    console.error("Error fetching ride receipt:", error);
    return res.status(500).json(
      new ApiError(500, "Failed to fetch ride receipt", error.message)
    );
  }
});

/**
 * Update ride status (webhook endpoint for Uber)
 */
const updateRideStatus = asyncHandler(async (req, res) => {
  try {
    const { request_id, status, driver, vehicle, trip } = req.body;

    if (!request_id) {
      return res.status(400).json(
        new ApiError(400, "Request ID is required")
      );
    }

    // Find booking by Uber request ID
    const booking = await UberBooking.findOne({
      uberRequestId: request_id
    });

    if (!booking) {
      return res.status(404).json(
        new ApiError(404, "Booking not found")
      );
    }

    // Update booking status
    booking.status = status;

    // Update driver information if provided
    if (driver) {
      booking.driverInfo = {
        driverId: driver.driver_id,
        name: driver.name,
        phoneNumber: driver.phone_number,
        rating: driver.rating,
        location: driver.location ? {
          latitude: driver.location.latitude,
          longitude: driver.location.longitude,
        } : null,
        eta: driver.eta,
      };
    }

    // Update vehicle information if provided
    if (vehicle && booking.driverInfo) {
      booking.driverInfo.vehicleInfo = {
        make: vehicle.make,
        model: vehicle.model,
        licensePlate: vehicle.license_plate,
        color: vehicle.color,
      };
    }

    // Update trip information if provided
    if (trip) {
      booking.tripInfo = {
        startTime: trip.start_time ? new Date(trip.start_time) : null,
        endTime: trip.end_time ? new Date(trip.end_time) : null,
        actualDuration: trip.duration,
        actualDistance: trip.distance,
        actualFare: trip.fare ? {
          amount: trip.fare.amount,
          currency: trip.fare.currency_code,
        } : null,
        surgeMultiplier: trip.surge_multiplier || 1.0,
      };
    }

    await booking.save();

    return res.status(200).json(
      new ApiResponse(200, booking, "Ride status updated successfully")
    );
  } catch (error) {
    console.error("Error updating ride status:", error);
    return res.status(500).json(
      new ApiError(500, "Failed to update ride status", error.message)
    );
  }
});

export {
  getAvailableProducts,
  getPriceEstimates,
  getTimeEstimates,
  requestRide,
  getRideDetails,
  cancelRide,
  getRideHistory,
  getRideReceipt,
  updateRideStatus,
};
