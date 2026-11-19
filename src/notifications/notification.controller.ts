import type { Request, Response } from "express";
import { notificationRepository } from "./notification.repository.js";
import { notificationService } from "./notification.service.js";
import type { NotificationQueryOptions } from "./notification.types.js";

export const registerPushToken = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as number;
    const { token, deviceType } = req.body;

    if (!token || typeof token !== "string" || token.trim().length === 0) {
      return res.status(400).json({
        message: "Valid push token is required.",
      });
    }

    await notificationRepository.upsertPushToken(
      userId,
      token.trim(),
      typeof deviceType === "string" ? deviceType.trim() : undefined,
    );

    return res.status(200).json({
      message: "Push token registered successfully.",
    });
  } catch (error) {
    console.error("Register push token error:", error);
    return res.status(500).json({
      message: "Unable to register push token.",
    });
  }
};

export const removePushToken = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as number;
    const { token } = req.body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({
        message: "Push token is required.",
      });
    }

    await notificationRepository.removePushToken(token.trim(), userId);

    return res.status(200).json({
      message: "Push token removed successfully.",
    });
  } catch (error) {
    console.error("Remove push token error:", error);
    return res.status(500).json({
      message: "Unable to remove push token.",
    });
  }
};

export const getNotifications = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as number;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const options: NotificationQueryOptions = {
      limit: Number.isNaN(limit) ? 20 : limit,
      offset: Number.isNaN(offset) ? 0 : offset,
    };

    if (req.query.isRead !== undefined) {
      options.isRead = req.query.isRead === "true";
    }

    const result = await notificationRepository.getNotifications(userId, options);

    return res.status(200).json(result);
  } catch (error) {
    console.error("Get notifications error:", error);
    return res.status(500).json({
      message: "Unable to fetch notifications.",
    });
  }
};

export const getUnreadCount = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as number;
    const count = await notificationRepository.getUnreadCount(userId);

    return res.status(200).json({ unreadCount: count });
  } catch (error) {
    console.error("Get unread count error:", error);
    return res.status(500).json({
      message: "Unable to fetch unread count.",
    });
  }
};

export const markAsRead = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as number;
    const idParam = req.params.id;
    const notificationId = typeof idParam === "string" ? parseInt(idParam, 10) : NaN;

    if (Number.isNaN(notificationId) || notificationId <= 0) {
      return res.status(400).json({
        message: "Invalid notification ID.",
      });
    }

    const updated = await notificationService.markAsRead(notificationId, userId);

    if (!updated) {
      return res.status(404).json({
        message: "Notification not found.",
      });
    }

    return res.status(200).json(updated);
  } catch (error) {
    console.error("Mark as read error:", error);
    return res.status(500).json({
      message: "Unable to update notification.",
    });
  }
};

export const markAllAsRead = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as number;
    const count = await notificationService.markAllAsRead(userId);

    return res.status(200).json({
      message: "All notifications marked as read.",
      count,
    });
  } catch (error) {
    console.error("Mark all as read error:", error);
    return res.status(500).json({
      message: "Unable to mark notifications as read.",
    });
  }
};

export const deleteNotification = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as number;
    const idParam = req.params.id;
    const notificationId = typeof idParam === "string" ? parseInt(idParam, 10) : NaN;

    if (Number.isNaN(notificationId) || notificationId <= 0) {
      return res.status(400).json({
        message: "Invalid notification ID.",
      });
    }

    const success = await notificationService.deleteNotification(
      notificationId,
      userId,
    );

    if (!success) {
      return res.status(404).json({
        message: "Notification not found.",
      });
    }

    return res.status(200).json({
      message: "Notification deleted successfully.",
    });
  } catch (error) {
    console.error("Delete notification error:", error);
    return res.status(500).json({
      message: "Unable to delete notification.",
    });
  }
};

export const getPreferences = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as number;
    const preferences = await notificationRepository.getPreferences(userId);

    return res.status(200).json(preferences);
  } catch (error) {
    console.error("Get preferences error:", error);
    return res.status(500).json({
      message: "Unable to fetch notification preferences.",
    });
  }
};

export const updatePreferences = async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as number;
    const { bloodRequests, statusUpdates, announcements } = req.body;

    if (
      (bloodRequests !== undefined && typeof bloodRequests !== "boolean") ||
      (statusUpdates !== undefined && typeof statusUpdates !== "boolean") ||
      (announcements !== undefined && typeof announcements !== "boolean")
    ) {
      return res.status(400).json({
        message: "Invalid preferences payload; boolean values required.",
      });
    }

    const updated = await notificationRepository.updatePreferences(userId, {
      bloodRequests,
      statusUpdates,
      announcements,
    });

    return res.status(200).json(updated);
  } catch (error) {
    console.error("Update preferences error:", error);
    return res.status(500).json({
      message: "Unable to update notification preferences.",
    });
  }
};
