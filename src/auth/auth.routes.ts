import { Router } from "express";
import {
  completeSignupController,
  logoutController,
  refreshTokenController,
  sendOtpController,
  verifyOtpController,
} from "./controllers/auth.controller.js";


const router = Router();

router.post("/signup", completeSignupController);
router.post("/send-otp", sendOtpController);
router.post("/verify-otp", verifyOtpController);
router.post("/refresh", refreshTokenController);
router.post("/logout", logoutController);


export default router;
