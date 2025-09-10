import { Router } from "express";
import {
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

} from "../controllers/guest.controller.js";
import {
    getAvailableProducts,
    getPriceEstimates,
    getTimeEstimates,
    requestRide,
    getRideDetails,
    cancelRide,
    getRideHistory,
    getRideReceipt,
    updateRideStatus,
} from "../controllers/uber.controller.js";
// import {upload,uploadVideo,handleMulterErrors} from "../middlewares/multer.middleware.js";
import { verifyJWT, verifyGuestRole, verifyUberAuth } from "../middlewares/auth.middleware.js";
import { initiateWithdrawal as guestWithdraw, getWalletInfo as guestWalletInfo } from "../controllers/wallet.controller.js";

const router = Router();

router.route("/propertyBooking").post(verifyJWT, verifyGuestRole, propertyBooking);
router.route("/bookPropertyWithPayment").post(verifyJWT, verifyGuestRole, bookPropertyWithPayment);
router.route("/propertyBookingCancel").post(verifyJWT,verifyGuestRole, propertyBookingCancel);
router.route("/propertyBookingCancelCalculation").get(verifyJWT,verifyGuestRole, propertyBookingCancelCalculation);
router.route("/getPropertyBookingList").get(verifyJWT, verifyGuestRole, getPropertyBookingList);
router.route("/getPropertyBookingDetails/:bookingId").get(verifyJWT, verifyGuestRole, getPropertyBookingDetails);
router.route("/addRemoveToWishlist").post(verifyJWT,verifyGuestRole, addRemoveToWishlist);
router.route("/getWishlist").get(verifyJWT,verifyGuestRole, getWishlist);
router.route("/addPropertyRating").post(verifyJWT,verifyGuestRole, addPropertyRating);
router.route("/addPropertySuggestion").post(verifyJWT,verifyGuestRole, addPropertySuggestion);
router.route("/serviceBooking").post(verifyJWT,verifyGuestRole, serviceBooking);
router.route("/getServiceBookingList").get(verifyJWT, verifyGuestRole, getServiceBookingList);
router.route("/getEventBookingList").get(verifyJWT, verifyGuestRole, getEventBookingList);
router.route("/getEventBookingDetails/:bookingId").get(verifyJWT, verifyGuestRole, getEventBookingDetails);
router.route("/addEventRating").post(verifyJWT, verifyGuestRole, addEventRating);
router.route("/getMyReview").get(verifyJWT, verifyGuestRole, getMyReview);
router.route("/createPaymentEventBookingLink").post(verifyJWT,verifyGuestRole, addEventBooking);
router.route("/bookEventWithPayment").post(verifyJWT,verifyGuestRole, bookEventWithPayment);

// Wallet
router.route("/wallet").get(verifyJWT, verifyGuestRole, guestWalletInfo);
router.route("/wallet/withdraw").post(verifyJWT, verifyGuestRole, guestWithdraw);

// Uber Ride Booking Routes
router.route("/uber/products").get(verifyJWT, verifyGuestRole, verifyUberAuth, getAvailableProducts);
router.route("/uber/price-estimates").get(verifyJWT, verifyGuestRole, verifyUberAuth, getPriceEstimates);
router.route("/uber/time-estimates").get(verifyJWT, verifyGuestRole, verifyUberAuth, getTimeEstimates);
router.route("/uber/request-ride").post(verifyJWT, verifyGuestRole, verifyUberAuth, requestRide);
router.route("/uber/ride-details/:bookingId").get(verifyJWT, verifyGuestRole, getRideDetails);
router.route("/uber/cancel-ride/:bookingId").post(verifyJWT, verifyGuestRole, cancelRide);
router.route("/uber/ride-history").get(verifyJWT, verifyGuestRole, getRideHistory);
router.route("/uber/ride-receipt/:bookingId").get(verifyJWT, verifyGuestRole, getRideReceipt);
router.route("/uber/webhook/update-status").post(updateRideStatus); // No auth for webhook

export default router;
