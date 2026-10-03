import { Router } from "express";

import {
  createDonor,
  getDonors,
  updateDonor,
  deleteDonor,
} from "../controllers/donor.controller.js";

const router = Router();

router.post("/", createDonor);
router.get("/", getDonors);
router.put("/:id", updateDonor);
router.delete("/:id", deleteDonor);

export default router;