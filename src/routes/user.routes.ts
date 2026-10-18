import { Router } from "express";

import {
  getUsers,
  getUserProfile,
  updateUserProfile,
  deleteUser,
} from "../controllers/user.controller.js";
import { authenticateUser } from "../auth/auth.middleware.js";

const router = Router();

router.get("/", authenticateUser, getUsers);

router.get("/:id", authenticateUser, getUserProfile);
router.put("/:id", authenticateUser, updateUserProfile);
router.delete("/:id", authenticateUser, deleteUser);

export default router;
