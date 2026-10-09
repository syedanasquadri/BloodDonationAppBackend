import { Router } from "express";

import {
  createUser,
  getUsers,
  getUserProfile,
  updateUserProfile,
  deleteUser,
} from "../controllers/user.controller.js";

const router = Router();

router.post("/", createUser);
router.get("/", getUsers);

router.get("/:id", getUserProfile);
router.put("/:id", updateUserProfile);
router.delete("/:id", deleteUser);

export default router;