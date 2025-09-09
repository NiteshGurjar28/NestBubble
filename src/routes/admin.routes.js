// import { Router, express  } from "express";
import express from 'express';
const router = express.Router();

import {
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

  listAmenity,
  showAmenityForm,
  createAmenity,
  updateAmenity,
  updateAmenityStatus,
  updateAmenityRequestStatus,
  listAmenityRequest,
  updateAmenityRequestDetails,

  listConciergeServices,
  showConciergeServiceDetails,
  showConciergeServiceForm,
  createConciergeService,
  updateConciergeService,
  updateConciergeServiceStatus,
  getBookingService,
  getBookingServiceById,
  updateBookingServiceStatus,

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
  updateTicketStatus,
  getTicketConversation,
  sendReply,
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


} from "../controllers/admin.controller.js";
import { isAdmin, checkPermission } from "../middlewares/auth.middleware.js";
import {upload, uploadEvent ,handleMulterErrors} from "../middlewares/multer.middleware.js";
// const router = Router();

// Dashboard
router.route("/dashboard").get(isAdmin, showDashboard);
router.route("/").get(isAdmin ,showDashboard); 

// Authentication
router.route("/login").get(showLoginPage); // Login form
router.route("/login").post(loginAdmin);   // Submit login
router.route("/logout").get(isAdmin, logoutAdmin);

// // Forgot & Reset Password
router.route("/forgot-password").get(showForgotPasswordPage);
router.route("/forgot-password").post(handleForgotPassword);
router.route("/reset-password/:token").get(showResetPasswordPage);
router.route("/reset-password/:token").post(handleResetPassword);

// // Admin Profile
router.route("/profile").get(isAdmin, getAdminProfile);
router.route("/profile").post(isAdmin, updateAdminProfile);
router.route("/profile/image").post(isAdmin, upload.single('file'), handleMulterErrors, updateAdminProfileImage);
router.route("/profile/change-password").post(isAdmin, changeAdminPassword);

// // User Management
router.route("/guest").get(isAdmin, checkPermission("guest-list"), listGuest);
router.route("/guest/:id/show").get(isAdmin, checkPermission("guest-show"), viewGuest);
router.route("/guest/:id/status").put(isAdmin, checkPermission("guest-status"), updateGuestStatus);
router.route("/host").get(isAdmin, checkPermission("host-list"), listHost);
router.route("/host/:id/show").get(isAdmin, checkPermission("host-show"), viewHost); 
router.route("/host/:id/status").put(isAdmin, checkPermission("host-status"), updateHostStatus);
router.route("/host/verifyUpdate").post(isAdmin, checkPermission("host-verify-status"), verifyUpdate);
router.route("/host/:id/toggle-kyc").put(isAdmin, checkPermission("host-kyc-status"), toggleKYCStatus);

//// Vendor Management
router.route("/vendor").get(isAdmin, checkPermission("vendor-list"), listVendor);
router.route("/vendor/:id/show").get(isAdmin, checkPermission("vendor-show"), viewVendor);
router.route("/vendor/:id/edit").get(isAdmin, checkPermission("vendor-edit"), vendorForm); 
router.route("/vendor/:id/edit").post(isAdmin, upload.fields([{ name: 'profilePhoto', maxCount: 1 }, { name: 'businessPhoto', maxCount: 1 },{ name: 'aadharFront', maxCount: 1 }, { name: 'aadharBack', maxCount: 1 },{ name: 'panCard', maxCount: 1 }, { name: 'gstin', maxCount: 1 },{ name: 'fssai', maxCount: 1 }, { name: 'certificates', maxCount: 1 }, { name: 'portfolio', maxCount: 1 }]), updateVendor);
router.route("/vendor/:id/status").patch(isAdmin, checkPermission("vendor-status"), updateVendorStatus);

////  Vendor Discount Code Management
router.route("/vendor/discount-code").get(isAdmin, checkPermission("vendor-discount-code-list"), listDiscountCode);
router.route("/vendor/discount-code/add").get(isAdmin, checkPermission("vendor-discount-code-create"),showDiscountCodeForm);
router.route("/vendor/discount-code").post(isAdmin, createDiscountCode);
router.route("/vendor/discount-code/:id/edit").get(isAdmin, checkPermission("vendor-discount-code-edit"), showDiscountCodeForm);
router.route("/vendor/discount-code/:id/edit").post(isAdmin, updateDiscountCode);
router.route("/vendor/discount-code/:id/status").put(isAdmin, checkPermission("vendor-discount-code-status"), updateDiscountCodeStatus);

////  Vendor Refund Policies Management
router.route("/vendor/refund-policies").get(isAdmin, checkPermission("vendor-refund-policies-list"), listRefundPolicies);
router.route("/vendor/refund-policies/add").get(isAdmin, checkPermission("vendor-refund-policies-create"),showRefundPolicyForm);
router.route("/vendor/refund-policies").post(isAdmin, createRefundPolicy);
router.route("/vendor/refund-policies/:id/edit").get(isAdmin, checkPermission("vendor-refund-policies-edit"), showRefundPolicyForm);
router.route("/vendor/refund-policies/:id/edit").post(isAdmin, updateRefundPolicy);
router.route("/vendor/refund-policies/:id/status").put(isAdmin, checkPermission("vendor-refund-policies-status"), updateRefundPolicyStatus);

//// Property  Management
router.route("/property").get(isAdmin, checkPermission("property-list"), listProperties);
router.route("/property/:id/show").get(isAdmin, checkPermission("property-show"), showPropertiesDetails);
router.route("/property-status").post(isAdmin, checkPermission("property-admin-status"), togglePropertyStatus);
router.route("/property/:id/status").post(isAdmin, checkPermission("property-status-update"), updatePropertyStatus);
router.route("/property/:id/update-top-vacation").post(isAdmin, checkPermission("property-top-vacation-status"), updateTopVacationStatus);
router.route("/property/:id/booking").get(isAdmin, checkPermission("property-booking-list"), propertyBookingList);
router.route("/property/bookings/filter").get(isAdmin, checkPermission("property-booking-list"), propertyBookingFilter);
router.route("/property/booking/:id/show").get(isAdmin, checkPermission("property-booking-show"), propertyBookingDetails);
router.route("/property/booking/udpate-status").put(isAdmin, checkPermission("property-booking-status"), propertyBookingStatusUpdate);


// // Property Type Management
router.route("/property-type").get(isAdmin, checkPermission("property-type-list"), listPropertyType);
router.route("/property-type/:id/show").get(isAdmin, checkPermission("property-type-show"), showPropertyTypeDetails);
router.route("/property-type/add").get(isAdmin, checkPermission("property-type-create") ,showPropertyTypeForm);
router.route("/property-type").post(isAdmin,upload.single('image'), createPropertyType);
router.route("/property-type/:id/edit").get(isAdmin, checkPermission("property-type-edit"), showPropertyTypeForm);
router.route("/property-type/:id/edit").post(isAdmin, upload.single('image'),updatePropertyType)
router.route("/property-type/:id/status").put(isAdmin, checkPermission("property-type-status"), updatePropertyTypeStatus);

// Amenity Management
router.route("/amenity").get(isAdmin, checkPermission("amenity-list"), listAmenity);
router.route("/amenity").post(isAdmin, checkPermission("amenity-create"), upload.single('icon'), createAmenity);
router.route("/amenity/add").get(isAdmin, checkPermission("amenity-create"), showAmenityForm);
router.route("/amenity/:id/edit").get(isAdmin, checkPermission("amenity-edit"), showAmenityForm);
router.route("/amenity/:id/edit").post(isAdmin, checkPermission("amenity-edit"), upload.single('icon'), updateAmenity);
router.route("/amenity/:id/status").put(isAdmin, checkPermission("amenity-status"), updateAmenityStatus);
router.route("/amenity/request").get(isAdmin, checkPermission("amenity-request-list"), listAmenityRequest);
router.route("/amenity/request/:id/status").put(isAdmin, checkPermission("amenity-request-status"), updateAmenityRequestStatus);
router.route("/amenity/request/:id/details").get(isAdmin, updateAmenityRequestDetails);

// Concierge Service Management
router.route("/concierge-service").get(isAdmin, checkPermission("concierge-service-list"), listConciergeServices);
router.route("/concierge-service").post(isAdmin, upload.single('image'), createConciergeService);
router.route("/concierge-service/add").get(isAdmin, checkPermission("concierge-service-create"), showConciergeServiceForm);
router.route("/concierge-service/:id/show").get(isAdmin, checkPermission("concierge-service-view"), showConciergeServiceDetails);
router.route("/concierge-service/:id/edit").get(isAdmin, checkPermission("concierge-service-edit"), showConciergeServiceForm);
router.route("/concierge-service/:id/edit").put(isAdmin, upload.single('image'), updateConciergeService);
router.route("/concierge-service/:id/status").put(isAdmin, updateConciergeServiceStatus);
router.route("/concierge-service/booking").get(isAdmin, checkPermission("concierge-service-booking-list"), getBookingService);
router.route("/concierge-service/booking/:id").get(isAdmin, getBookingServiceById);
router.route("/concierge-service/booking/:id/status").put(isAdmin, updateBookingServiceStatus);


////  Event Management
router.route("/event").get(isAdmin, checkPermission("event-list"), listEvent);
router.route("/event-filter-data").get(isAdmin, getFilteredEvents);
router.route("/event/:id/show").get(isAdmin, checkPermission("event-show"), showEventDetails);
router.route("/event/add").get(isAdmin, checkPermission("event-create"), showEventForm);
router.route("/event").post(isAdmin, uploadEvent.fields([{ name: 'images', maxCount: 10 },{ name: 'videos', maxCount: 5 }]), saveEvent);
router.route("/event/:id/edit").get(isAdmin, checkPermission("event-edit"), showEventForm);
router.route("/event/:id/edit").post(isAdmin, uploadEvent.fields([{ name: 'images', maxCount: 10 },{ name: 'videos', maxCount: 5 }]),saveEvent)
router.route("/event/:id/member").get(isAdmin, checkPermission("event-member"), showEventMemberList);
router.route("/event/booking/:id/details").get(isAdmin, checkPermission("event-booking-details"), getEventBookingDetails);
router.route("/event/:eventId/cancel-request").post(isAdmin, checkPermission("event-cancel-request"), cancelRequestUpdate);
router.route("/event/cancel").post(isAdmin, checkPermission("event-cancel"), eventCancel);
router.route("/event/booking/admin").post(isAdmin, checkPermission("event-booking"), eventBooking);



////  Event Category Management
router.route("/event/category").get(isAdmin, checkPermission("event-category-list"), listEventCategory);
router.route("/event/category/:id/show").get(isAdmin, checkPermission("event-category-show"), showEventCategoryDetails);
router.route("/event/category/add").get(isAdmin, checkPermission("event-category-create"),showEventCategoryForm);
router.route("/event/category").post(isAdmin, upload.single('image'), createEventCategory);
router.route("/event/category/:id/edit").get(isAdmin, checkPermission("event-category-edit"), showEventCategoryForm);
router.route("/event/category/:id/edit").post(isAdmin, upload.single('image'), updateEventCategory)
router.route("/event/category/:id/status").put(isAdmin, checkPermission("event-category-status"), updateEventCategoryStatus);

////  Contact Enquiry Management
router.route("/contact-enquiry").get(isAdmin, checkPermission("contact-enquiry"), contactEnquiry);
router.route("/contact-enquiries").get(isAdmin, getContactEnquiries);
router.route("/contact-enquiries/:id").get(isAdmin, getContactEnquiryDetails);
router.route("/contact-enquiries/:id/status").put(isAdmin, updateEnquiryStatus);
router.route("/contact-enquiry-type").get(isAdmin, checkPermission("contact-enquiry-type"), contactEnquiryTypeList);
router.route("/contact-enquiry-type").post(isAdmin, createContactEnquiryType);
router.route("/contact-enquiry-type/:id").put(isAdmin, updateContactEnquiryType);
router.route("/contact-enquiry-type/status/:id").put(isAdmin, updateStatusContactEnquiryType);

//// Setting Management
router.route("/setting").get(isAdmin, checkPermission("setting"), getSetting);
router.route("/setting").post(isAdmin, upload.single('image'), updateSetting);
router.route("/faqs").get(isAdmin, checkPermission("faqs-list"), faqList);
router.route("/faqs").post(isAdmin, checkPermission("faqs-create"), createFAQ);
router.route("/faqs/:id").put(isAdmin, checkPermission("faqs-edit"), updateFAQ);
router.route("/faqs/:id").delete(isAdmin, checkPermission("faqs-delete"), deleteFAQ);
router.route("/pages").get(isAdmin, checkPermission("pages"), pagesList);
router.route("/pages/:pageType").get(isAdmin, getPage);
router.route("/pages/:pageType").post(isAdmin, upload.fields([{ name: 'bannerImage', maxCount: 1 }]), savePage);
router.route("/update-home-property-types").post(isAdmin, updateHomePropertyTypes);
router.route("/update-home-services").post(isAdmin, updateHomeServices);
router.route("/update-home-events").post(isAdmin, updateHomeEvents);
router.route("/pages-update-slider").post(isAdmin, upload.single('sliderImage'), updateSlider)

/// Permission Management
router.route("/permission").get(isAdmin, checkPermission("permissions"), permissionList);
router.route("/permission").post(isAdmin, checkPermission("permissions"), createPermission);
router.route("/admin-roles").get(isAdmin, checkPermission("admin-roles"), adminRolesList);
router.route("/admin-permissions/:role/edit").get(isAdmin, checkPermission("admin-roles"), adminRolesForm);
router.route("/admin-permissions/:role").put(isAdmin, checkPermission("admin-roles"), updateAdminPermission);

/// Admin User
router.route("/admin-user").get(isAdmin, checkPermission("admin-user-list"), adminUserList);
router.route("/admin-user/add").get(isAdmin, checkPermission("admin-user-create"), adminUserForm);
router.route("/admin-user").post(isAdmin, checkPermission("admin-user-create"), createAdminUser);
router.route("/admin-user/:id/edit").get(isAdmin, checkPermission("admin-user-edit"), adminUserForm);
router.route("/admin-user/:id/edit").put(isAdmin, checkPermission("admin-user-edit"), updateAdminUser);
router.route("/admin-user/:id/status").put(isAdmin, checkPermission("admin-user-status"), updateAdminUserStatus);


/// Notification Management
router.route("/notifications").get(isAdmin, checkPermission("notifications"), getNotificationList);
router.route("/notification-list").get(isAdmin, checkPermission("notifications"), getNotifications);
router.route("/notification/mark-all-read").post(isAdmin, checkPermission("notifications"), markAllNotificationsAsRead);
router.route("/notifications/:id").get(isAdmin, getNotificationDetails);

/// Help Center Management
router.route("/newsletter").get(isAdmin, checkPermission("newsletter"), getNewsletterList);
router.route("/comingsoon").get(isAdmin, checkPermission("comingsoon"), getComingSoonEmailList);
router.route("/help-center").get(isAdmin, checkPermission("help-center"), ticketView);
router.route("/help-center-api").get(isAdmin, getTicketsApi);
router.route("/help-center-conversation/:ticketId").get(isAdmin, getTicketConversation);
router.route("/help-center/:ticketId/status").put(isAdmin, updateTicketStatus);
router.route("/help-center/:ticketId/reply").post(isAdmin, sendReply);
router.route("/help-center/reset-unread-count").patch(isAdmin, resetAdminUnreadCount);

/// Bot Faq Managemnt
router.route("/support-faq").get(isAdmin, checkPermission("support-faq-list"), supportFaqList);
router.route("/support-faq/add").get(isAdmin, checkPermission("support-faq-add"), supportFaqForm);
router.route("/support-faq").post(isAdmin, checkPermission("support-faq-add"), supportFaqCreate);
router.route("/support-faq/:id/edit").get(isAdmin, checkPermission("support-faq-edit"), supportFaqForm);
router.route("/support-faq/:id/edit").put(isAdmin, checkPermission("support-faq-edit"), supportFaqUpdate);
router.route("/support-faq/:id/show").get(isAdmin, checkPermission("support-faq-show"), supportFaqShow);
router.route("/support-faq/save-suggestion").post(isAdmin, checkPermission("support-faq-add"), saveSuggestion);
router.route("/support-faq/:questionId").delete(isAdmin, checkPermission("support-faq-edit"), deleteSuggestion);



/// Webhook Managemnt
router.route("/webhook/stripe").post(  express.raw({ type: 'application/json' }),stripeWebhook);
router.route("/webhook/razorpay").post(  express.raw({ type: 'application/json' }),razorpayWebhook);
router.route("/test-payment-event").get(isAdmin, testPaymentEvent);
router.route("/test-payment-property").get(isAdmin, testPaymentProperty);



export default router;