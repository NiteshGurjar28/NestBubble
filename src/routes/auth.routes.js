import { Router } from "express";
import {
  handleMobileAuth,
  verifyMobileOTP,
  socialLogin,
  becomeHost,
  becomeVendor,
  logoutUser,
  switchRole,
  startUberOAuth,
  uberOAuthCallback,
  
} from "../controllers/auth.controller.js";
// import {upload,uploadVideo,handleMulterErrors} from "../middlewares/multer.middleware.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.route("/handleMobileAuth").post(handleMobileAuth);
router.route("/verifyMobileOTP").post(verifyMobileOTP);
router.route("/socialLogin").post(socialLogin);
router.route("/becomeHost").post(verifyJWT, becomeHost);
router.route("/becomeVendor").post(verifyJWT, becomeVendor);
router.route("/logoutUser").get(verifyJWT, logoutUser);
router.route("/switchRole").post(verifyJWT, switchRole);

// Uber OAuth routes
router.route("/uber").get(verifyJWT, startUberOAuth);
router.route("/uber/callback").get(uberOAuthCallback);

export default router;
