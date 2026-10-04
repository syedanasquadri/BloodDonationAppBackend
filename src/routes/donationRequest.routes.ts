import { Router } from "express";

import {
  createDonationRequest,
} from "../controllers/donationRequest.controller.js";

const router = Router();

router.post("/", createDonationRequest);

export default router;