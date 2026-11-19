import type {
  CreateNotificationInput,
  NotificationRecord,
} from "./notification.types.js";
import { NotificationType } from "./notification.types.js";
import {
  notificationRepository,
  NotificationRepository,
} from "./notification.repository.js";
import { socketService, SocketService } from "./socket.service.js";
import { expoPushService, ExpoPushService } from "./expoPush.service.js";

export class NotificationService {
  constructor(
    private repository: NotificationRepository = notificationRepository,
    private socket: SocketService = socketService,
    private push: ExpoPushService = expoPushService,
  ) {}

  /**
   * Evaluates whether a notification type is allowed by user preferences.
   * Critical security alerts bypass user preferences.
   */
  private async isAllowedByPreferences(
    userId: number,
    type: NotificationType,
  ): Promise<boolean> {
    if (type === NotificationType.ACCOUNT_SECURITY) {
      return true;
    }

    const preferences = await this.repository.getPreferences(userId);

    switch (type) {
      case NotificationType.DONATION_REQUEST:
        return preferences.bloodRequests;

      case NotificationType.REQUEST_ACCEPTED:
      case NotificationType.REQUEST_REJECTED:
      case NotificationType.REQUEST_CANCELLED:
      case NotificationType.REQUEST_FULFILLED:
      case NotificationType.REQUEST_EXPIRED:
        return preferences.statusUpdates;

      case NotificationType.PLATFORM_ANNOUNCEMENT:
        return preferences.announcements;

      default:
        return true;
    }
  }

  /**
   * Persists the notification, then delivers across real-time socket and push channels.
   * Guarantees persistence before delivery attempts and avoids duplicate records.
   */
  async sendNotification(
    input: CreateNotificationInput,
  ): Promise<NotificationRecord | null> {
    // 1. Prevent duplicate notifications within 60s for idempotent retries
    if (input.entityType && input.entityId) {
      const duplicate = await this.repository.findRecentDuplicate(
        input.userId,
        input.type,
        input.entityType,
        input.entityId,
        60,
      );

      if (duplicate) {
        return duplicate;
      }
    }

    // 2. Check user notification preferences
    const isAllowed = await this.isAllowedByPreferences(
      input.userId,
      input.type,
    );
    if (!isAllowed) {
      return null;
    }

    // 3. Database persistence (Single canonical record)
    const notification = await this.repository.createNotification(input);
    const unreadCount = await this.repository.getUnreadCount(input.userId);

    const channels = input.channels ?? ["socket", "push"];

    // 4. Real-time delivery via Socket.IO
    if (channels.includes("socket")) {
      try {
        this.socket.emitToUser(input.userId, "notification:new", {
          notification,
          unreadCount,
        });
        this.socket.emitToUser(input.userId, "notification:unread_count", {
          unreadCount,
        });
      } catch (err) {
        console.error(
          `[NotificationService] Failed to emit socket event to user ${input.userId}:`,
          err,
        );
      }
    }

    // 5. Mobile Push Delivery via Expo
    if (channels.includes("push")) {
      try {
        const tokens = await this.repository.getPushTokensForUser(input.userId);

        if (tokens.length > 0) {
          // Prepare clean payload (no sensitive personal medical data in lock screen)
          const deepLink = this.resolveDeepLink(
            input.type,
            input.entityType,
            input.entityId,
          );

          await this.push.sendPushNotifications(tokens, {
            title: input.title,
            body: input.message,
            badge: unreadCount,
            data: {
              notificationId: notification.id,
              type: notification.type,
              entityType: notification.entityType,
              entityId: notification.entityId,
              link: deepLink,
              ...(input.data ?? {}),
            },
          });
        }
      } catch (err) {
        console.error(
          `[NotificationService] Failed to send push notification to user ${input.userId}:`,
          err,
        );
      }
    }

    return notification;
  }

  /**
   * Helper to resolve target deep link screens based on notification event
   */
  resolveDeepLink(
    type: NotificationType,
    entityType?: string,
    entityId?: number,
  ): string {
    switch (type) {
      case NotificationType.DONATION_REQUEST:
        return "/received-requests";
      case NotificationType.REQUEST_ACCEPTED:
      case NotificationType.REQUEST_REJECTED:
      case NotificationType.REQUEST_CANCELLED:
      case NotificationType.REQUEST_FULFILLED:
        return "/my-requests";
      case NotificationType.ACCOUNT_SECURITY:
        return "/profile";
      default:
        return "/home";
    }
  }

  async markAsRead(
    notificationId: number,
    userId: number,
  ): Promise<NotificationRecord | null> {
    const updated = await this.repository.markAsRead(notificationId, userId);
    if (updated) {
      const unreadCount = await this.repository.getUnreadCount(userId);
      this.socket.emitToUser(userId, "notification:unread_count", {
        unreadCount,
      });
    }
    return updated;
  }

  async markAllAsRead(userId: number): Promise<number> {
    const count = await this.repository.markAllAsRead(userId);
    this.socket.emitToUser(userId, "notification:unread_count", {
      unreadCount: 0,
    });
    return count;
  }

  async deleteNotification(
    notificationId: number,
    userId: number,
  ): Promise<boolean> {
    const deleted = await this.repository.deleteNotification(
      notificationId,
      userId,
    );
    if (deleted) {
      const unreadCount = await this.repository.getUnreadCount(userId);
      this.socket.emitToUser(userId, "notification:unread_count", {
        unreadCount,
      });
    }
    return deleted;
  }
}

export const notificationService = new NotificationService();
