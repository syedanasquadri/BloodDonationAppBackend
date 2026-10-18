import { Router } from "express";

import {
  createDonationRequest,
  getSentRequests,
  getReceivedRequests,
  updateDonationRequestStatus,
} from "../controllers/donationRequest.controller.js";
import { authenticateUser } from "../auth/auth.middleware.js";

const router = Router();

router.post("/", authenticateUser, createDonationRequest);
router.get("/sent", authenticateUser, getSentRequests);
router.get("/received", authenticateUser, getReceivedRequests);
router.patch("/:id/status", authenticateUser, updateDonationRequestStatus);

export default router;
