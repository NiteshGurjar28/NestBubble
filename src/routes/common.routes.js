import { Router } from "express";
import {
  profileUpdate,
  propertyTypeList,
  getConciergeServicesList,
  amenityList,
  homePage,
  getFaqs,
  searchProperties,
  propertyDetails,
  getEventList,
  getEventDetails,
  eventCategoryList,
  getContactEnquiryType,
  saveContactEnquiry,
  sendMessage,
  getUserConversations,
  getMessages,
  getNotifications,
  markNotificationAsRead,
  uploadImages,
  updateVendor,
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
  priceCalculation,
  getpropertyCalendar,
  uploadAndScreenRealEstateImages,
} from "../controllers/common.controller.js";
import {
  upload,
  handleMulterErrors,
  uploadRealEstateImages,
} from "../middlewares/multer.middleware.js";
import { verifyJWT, optionalJWT } from "../middlewares/auth.middleware.js";

const router = Router();
router.route("/myAccount").get(optionalJWT, myAccount);
router.route("/priceCalculation").post(optionalJWT, priceCalculation);
router.route("/getpropertyCalendar").get(optionalJWT, getpropertyCalendar);
router.route("/subscribeNewsletter").post(optionalJWT, subscribeNewsletter);
router.route("/addComingSoonEmail").post(optionalJWT, addComingSoonEmail);
router.route("/vendorAccount").get(optionalJWT, vendorAccount);
router.route("/propertyTypeList").get(optionalJWT, propertyTypeList);
router.route("/eventCategoryList").get(optionalJWT, eventCategoryList);
router
  .route("/getConciergeServicesList")
  .get(optionalJWT, getConciergeServicesList);
router.route("/amenityList").get(optionalJWT, amenityList);
router.route("/searchProperties").post(optionalJWT, searchProperties);
router.route("/propertyDetails").post(optionalJWT, propertyDetails);
router.route("/homePage").get(optionalJWT, homePage);
router.route("/getFaqs").get(optionalJWT, getFaqs);
router.route("/getEventList").get(optionalJWT, getEventList);
router.route("/getEventDetails").get(optionalJWT, getEventDetails);
router.route("/profileUpdate").post(verifyJWT, profileUpdate);
router.route("/updateVendor").patch(verifyJWT, updateVendor);
router.route("/getContactEnquiryType").get(optionalJWT, getContactEnquiryType);
router.route("/saveContactEnquiry").post(optionalJWT, saveContactEnquiry);
router.route("/conversations").get(verifyJWT, getUserConversations);
router.route("/messages").get(verifyJWT, getMessages);
// router.route("/send").post(upload.fields([{ name: 'file', maxCount: 1 }]), verifyJWT, sendMessage);
router.route("/send").post(verifyJWT, sendMessage);
router.route("/getNotifications").get(verifyJWT, getNotifications);
router
  .route("/markNotificationAsRead/:notificationId")
  .get(verifyJWT, markNotificationAsRead);
router
  .route("/uploadimages")
  .post(
    upload.fields([{ name: "files", maxCount: 30 }]),
    handleMulterErrors,
    uploadImages
  );
router.route("/createTicket").post(verifyJWT, createTicket);
router.route("/getAllTickets").get(verifyJWT, getAllTickets);
router
  .route("/getTicketConversation/:ticketId")
  .get(verifyJWT, getTicketConversation);
router.route("/addTicketMessage/:ticketId").post(verifyJWT, addTicketMessage);
router.route("/supportQuestion").get(optionalJWT, supportQuestion);
router.route("/supportConversations").post(optionalJWT, supportConversations);
router.route("/vendorCodeAndPolicy").get(optionalJWT, vendorCodeAndPolicy);
router.route("/page/:slug").get(optionalJWT, getPages);
router.route("/setting").get(optionalJWT, getSetting);
router.route("/getWalletDetails").get(optionalJWT, getWalletDetails);

router
  .route("/upload/real-estate")
  .post(
    uploadRealEstateImages.array("images", 20),
    handleMulterErrors,
    uploadAndScreenRealEstateImages
  );


export default router;
