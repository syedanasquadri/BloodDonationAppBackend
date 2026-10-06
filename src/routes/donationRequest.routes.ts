import { Router } from "express";

import {
  createDonationRequest,
  getSentRequests,
  getReceivedRequests,
  updateDonationRequestStatus,
} from "../controllers/donationRequest.controller.js";

const router = Router();

router.post("/", createDonationRequest);
router.get("/sent/:userId", getSentRequests);
router.get("/received/:userId", getReceivedRequests);
router.patch("/:id/status", updateDonationRequestStatus)

export default router;
