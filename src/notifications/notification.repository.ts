import { prisma } from "../lib/prisma.js";
import type {
  CreateNotificationInput,
  NotificationQueryOptions,
  NotificationRecord,
  NotificationPreferences,
  UpdatePreferencesInput,
} from "./notification.types.js";

export class NotificationRepository {
  async createNotification(
    input: CreateNotificationInput,
  ): Promise<NotificationRecord> {
    const dataString = input.data ? JSON.stringify(input.data) : null;

    return prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        data: dataString,
      },
    });
  }

  async getNotifications(
    userId: number,
    options: NotificationQueryOptions = {},
  ): Promise<{ notifications: NotificationRecord[]; total: number }> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    const where: { userId: number; isRead?: boolean } = { userId };
    if (options.isRead !== undefined) {
      where.isRead = options.isRead;
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.notification.count({ where }),
    ]);

    return { notifications, total };
  }

  async getUnreadCount(userId: number): Promise<number> {
    return prisma.notification.count({
      where: {
        userId,
        isRead: false,
      },
    });
  }

  async markAsRead(
    notificationId: number,
    userId: number,
  ): Promise<NotificationRecord | null> {
    const existing = await prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!existing) {
      return null;
    }

    return prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: number): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return result.count;
  }

  async deleteNotification(
    notificationId: number,
    userId: number,
  ): Promise<boolean> {
    const existing = await prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!existing) {
      return false;
    }

    await prisma.notification.delete({
      where: { id: notificationId },
    });

    return true;
  }

  async findRecentDuplicate(
    userId: number,
    type: string,
    entityType?: string,
    entityId?: number,
    withinSeconds = 60,
  ): Promise<NotificationRecord | null> {
    const threshold = new Date(Date.now() - withinSeconds * 1000);

    return prisma.notification.findFirst({
      where: {
        userId,
        type: type as any,
        ...(entityType ? { entityType } : {}),
        ...(entityId !== undefined ? { entityId } : {}),
        createdAt: { gte: threshold },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async upsertPushToken(
    userId: number,
    token: string,
    deviceType?: string,
  ): Promise<void> {
    await prisma.pushToken.upsert({
      where: { token },
      update: {
        userId,
        deviceType: deviceType ?? null,
        updatedAt: new Date(),
      },
      create: {
        userId,
        token,
        deviceType: deviceType ?? null,
      },
    });
  }

  async removePushToken(token: string, userId?: number): Promise<boolean> {
    const where = userId ? { token, userId } : { token };
    const result = await prisma.pushToken.deleteMany({
      where,
    });

    return result.count > 0;
  }

  async getPushTokensForUser(userId: number): Promise<string[]> {
    const records = await prisma.pushToken.findMany({
      where: { userId },
      select: { token: true },
    });

    return records.map((r) => r.token);
  }

  async getPushTokensForUsers(
    userIds: number[],
  ): Promise<Map<number, string[]>> {
    const records = await prisma.pushToken.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, token: true },
    });

    const map = new Map<number, string[]>();
    for (const record of records) {
      const list = map.get(record.userId) ?? [];
      list.push(record.token);
      map.set(record.userId, list);
    }

    return map;
  }

  async deletePushTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;

    await prisma.pushToken.deleteMany({
      where: { token: { in: tokens } },
    });
  }

  async getPreferences(userId: number): Promise<NotificationPreferences> {
    const record = await prisma.notificationPreference.findUnique({
      where: { userId },
    });

    if (!record) {
      return {
        bloodRequests: true,
        statusUpdates: true,
        announcements: true,
      };
    }

    return {
      bloodRequests: record.bloodRequests,
      statusUpdates: record.statusUpdates,
      announcements: record.announcements,
    };
  }

  async updatePreferences(
    userId: number,
    data: UpdatePreferencesInput,
  ): Promise<NotificationPreferences> {
    const record = await prisma.notificationPreference.upsert({
      where: { userId },
      update: {
        ...(data.bloodRequests !== undefined && {
          bloodRequests: data.bloodRequests,
        }),
        ...(data.statusUpdates !== undefined && {
          statusUpdates: data.statusUpdates,
        }),
        ...(data.announcements !== undefined && {
          announcements: data.announcements,
        }),
      },
      create: {
        userId,
        bloodRequests: data.bloodRequests ?? true,
        statusUpdates: data.statusUpdates ?? true,
        announcements: data.announcements ?? true,
      },
    });

    return {
      bloodRequests: record.bloodRequests,
      statusUpdates: record.statusUpdates,
      announcements: record.announcements,
    };
  }
}

export const notificationRepository = new NotificationRepository();
