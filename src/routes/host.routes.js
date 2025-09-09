import { Router } from "express";
import {
    createProperty,
    updateProperty,
    updatePropertyPrice,
    updatePropertyDiscount,
    updatePropertyAvailable,
    propertyList,
    bookingList,
    updateBookingStatus,
    getPropertyReviews,
    getEventReviews,
    autoAcceptAddRemoved,
    amenityRequest,
    getAmenityRequests,
    addEditEvent,
    getEventList,
    cancelEvent,
    getEventBookingMembers,
    getEventBookingList,
    getMyListing,
} from "../controllers/host.controller.js";
// import {upload,uploadVideo,handleMulterErrors} from "../middlewares/multer.middleware.js";
import { verifyJWT, verifyHostRole } from "../middlewares/auth.middleware.js";

const router = Router();

router.route("/createProperty").post(verifyJWT, verifyHostRole, createProperty);
router.route("/updateProperty").post(verifyJWT, verifyHostRole, updateProperty);
router.route("/updatePropertyPrice").post(verifyJWT, verifyHostRole, updatePropertyPrice);
router.route("/updatePropertyDiscount").post(verifyJWT, verifyHostRole, updatePropertyDiscount);
router.route("/updatePropertyAvailable").post(verifyJWT, verifyHostRole, updatePropertyAvailable);
router.route("/propertyList").get(verifyJWT, verifyHostRole, propertyList);
router.route("/bookingList").get(verifyJWT, verifyHostRole, bookingList);
router.route("/updateBookingStatus").post(verifyJWT, verifyHostRole, updateBookingStatus);
router.route("/getPropertyReviews").get(verifyJWT, verifyHostRole, getPropertyReviews);
router.route("/getEventReviews").get(verifyJWT, verifyHostRole, getEventReviews);
router.route("/autoAcceptAddRemoved").post(verifyJWT, verifyHostRole, autoAcceptAddRemoved);
router.route("/amenityRequest").post(verifyJWT, verifyHostRole, amenityRequest);
router.route("/getAmenityRequests").get(verifyJWT, verifyHostRole, getAmenityRequests);
router.route("/addEditEvent").post(verifyJWT, verifyHostRole, addEditEvent);
router.route("/getEventList").get(verifyJWT, verifyHostRole, getEventList);
router.route("/cancelEvent").post(verifyJWT, verifyHostRole, cancelEvent);
router.route("/getEventBookingList/:eventId").get(verifyJWT, verifyHostRole, getEventBookingList);
router.route("/getEventBookingMembers").get(verifyJWT, verifyHostRole, getEventBookingMembers);
router.route("/getMyListing").get(verifyJWT, verifyHostRole, getMyListing);

export default router;
