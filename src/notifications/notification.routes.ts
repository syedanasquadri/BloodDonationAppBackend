import { Router } from "express";
import { authenticateUser } from "../auth/auth.middleware.js";
import {
  registerPushToken,
  removePushToken,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getPreferences,
  updatePreferences,
} from "./notification.controller.js";

const router = Router();

// Push token management
router.post("/push-token", authenticateUser, registerPushToken);
router.delete("/push-token", authenticateUser, removePushToken);

// Notifications & Unread count
router.get("/", authenticateUser, getNotifications);
router.get("/unread-count", authenticateUser, getUnreadCount);
router.patch("/mark-all-read", authenticateUser, markAllAsRead);
router.patch("/:id/read", authenticateUser, markAsRead);
router.delete("/:id", authenticateUser, deleteNotification);

// Notification preferences
router.get("/preferences", authenticateUser, getPreferences);
router.patch("/preferences", authenticateUser, updatePreferences);

export default router;
