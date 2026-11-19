import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import { NotificationType } from "../src/generated/prisma/enums.js";
import { NotificationService } from "../src/notifications/notification.service.js";
import type {
  CreateNotificationInput,
  NotificationPreferences,
  NotificationRecord,
  UpdatePreferencesInput,
} from "../src/notifications/notification.types.js";
import type { NotificationRepository } from "../src/notifications/notification.repository.js";
import type { SocketService } from "../src/notifications/socket.service.js";
import type { ExpoPushService } from "../src/notifications/expoPush.service.js";

// Mock Repository for unit testing notification logic
class MockNotificationRepository implements Partial<NotificationRepository> {
  notifications: NotificationRecord[] = [];
  pushTokens = new Map<string, { userId: number; token: string; deviceType?: string }>();
  preferences = new Map<number, NotificationPreferences>();
  private idCounter = 1;

  async createNotification(input: CreateNotificationInput): Promise<NotificationRecord> {
    const record: NotificationRecord = {
      id: this.idCounter++,
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      data: input.data ? JSON.stringify(input.data) : null,
      isRead: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.notifications.push(record);
    return record;
  }

  async getNotifications(userId: number, options: any = {}) {
    let list = this.notifications.filter((n) => n.userId === userId);
    if (options.isRead !== undefined) {
      list = list.filter((n) => n.isRead === options.isRead);
    }
    return { notifications: list, total: list.length };
  }

  async getUnreadCount(userId: number): Promise<number> {
    return this.notifications.filter((n) => n.userId === userId && !n.isRead).length;
  }

  async markAsRead(notificationId: number, userId: number): Promise<NotificationRecord | null> {
    const found = this.notifications.find((n) => n.id === notificationId && n.userId === userId);
    if (!found) return null;
    found.isRead = true;
    return found;
  }

  async markAllAsRead(userId: number): Promise<number> {
    let count = 0;
    for (const n of this.notifications) {
      if (n.userId === userId && !n.isRead) {
        n.isRead = true;
        count++;
      }
    }
    return count;
  }

  async deleteNotification(notificationId: number, userId: number): Promise<boolean> {
    const idx = this.notifications.findIndex((n) => n.id === notificationId && n.userId === userId);
    if (idx === -1) return false;
    this.notifications.splice(idx, 1);
    return true;
  }

  async findRecentDuplicate(
    userId: number,
    type: string,
    entityType?: string,
    entityId?: number,
  ): Promise<NotificationRecord | null> {
    const found = this.notifications.find(
      (n) =>
        n.userId === userId &&
        n.type === type &&
        (!entityType || n.entityType === entityType) &&
        (entityId === undefined || n.entityId === entityId),
    );
    return found ?? null;
  }

  async upsertPushToken(userId: number, token: string, deviceType?: string): Promise<void> {
    this.pushTokens.set(token, { userId, token, deviceType });
  }

  async removePushToken(token: string): Promise<boolean> {
    return this.pushTokens.delete(token);
  }

  async getPushTokensForUser(userId: number): Promise<string[]> {
    const tokens: string[] = [];
    for (const record of this.pushTokens.values()) {
      if (record.userId === userId) {
        tokens.push(record.token);
      }
    }
    return tokens;
  }

  async getPreferences(userId: number): Promise<NotificationPreferences> {
    return (
      this.preferences.get(userId) ?? {
        bloodRequests: true,
        statusUpdates: true,
        announcements: true,
      }
    );
  }

  async updatePreferences(userId: number, data: UpdatePreferencesInput): Promise<NotificationPreferences> {
    const existing = await this.getPreferences(userId);
    const updated = {
      bloodRequests: data.bloodRequests ?? existing.bloodRequests,
      statusUpdates: data.statusUpdates ?? existing.statusUpdates,
      announcements: data.announcements ?? existing.announcements,
    };
    this.preferences.set(userId, updated);
    return updated;
  }
}

// Mock Socket Service
class MockSocketService implements Partial<SocketService> {
  emissions: Array<{ userId: number; event: string; payload: any }> = [];

  emitToUser(userId: number, event: string, payload: any): void {
    this.emissions.push({ userId, event, payload });
  }
}

// Mock Expo Push Service
class MockExpoPushService implements Partial<ExpoPushService> {
  sentPushes: Array<{ tokens: string[]; payload: any }> = [];

  async sendPushNotifications(tokens: string[], payload: any): Promise<{ sent: number; failed: number }> {
    this.sentPushes.push({ tokens, payload });
    return { sent: tokens.length, failed: 0 };
  }
}

test("NotificationService: creates and dispatches notification across socket and push", async () => {
  const repo = new MockNotificationRepository() as any;
  const socket = new MockSocketService() as any;
  const push = new MockExpoPushService() as any;
  const service = new NotificationService(repo, socket, push);

  await repo.upsertPushToken(101, "ExponentPushToken[mock-token-1]", "android");

  const result = await service.sendNotification({
    userId: 101,
    type: NotificationType.DONATION_REQUEST,
    title: "Urgent Need",
    message: "A patient needs O+ blood.",
    entityType: "donation_request",
    entityId: 42,
  });

  assert.ok(result);
  assert.equal(result.userId, 101);
  assert.equal(result.type, NotificationType.DONATION_REQUEST);
  assert.equal(result.isRead, false);

  // Check socket emission
  assert.equal(socket.emissions.length, 2);
  assert.equal(socket.emissions[0].event, "notification:new");
  assert.equal(socket.emissions[0].userId, 101);
  assert.equal(socket.emissions[1].event, "notification:unread_count");

  // Check push emission
  assert.equal(push.sentPushes.length, 1);
  assert.deepEqual(push.sentPushes[0].tokens, ["ExponentPushToken[mock-token-1]"]);
  assert.equal(push.sentPushes[0].payload.data.link, "/received-requests");
});

test("NotificationService: prevents duplicate notification on idempotent retry", async () => {
  const repo = new MockNotificationRepository() as any;
  const socket = new MockSocketService() as any;
  const push = new MockExpoPushService() as any;
  const service = new NotificationService(repo, socket, push);

  const first = await service.sendNotification({
    userId: 102,
    type: NotificationType.DONATION_REQUEST,
    title: "Urgent Need",
    message: "A patient needs A+ blood.",
    entityType: "donation_request",
    entityId: 99,
  });

  const duplicate = await service.sendNotification({
    userId: 102,
    type: NotificationType.DONATION_REQUEST,
    title: "Urgent Need",
    message: "A patient needs A+ blood.",
    entityType: "donation_request",
    entityId: 99,
  });

  assert.ok(first);
  assert.ok(duplicate);
  assert.equal(first.id, duplicate.id);
  assert.equal(repo.notifications.length, 1);
});

test("NotificationService: respects user notification preferences", async () => {
  const repo = new MockNotificationRepository() as any;
  const socket = new MockSocketService() as any;
  const push = new MockExpoPushService() as any;
  const service = new NotificationService(repo, socket, push);

  // User disabled blood request notifications
  await repo.updatePreferences(103, { bloodRequests: false });

  const result = await service.sendNotification({
    userId: 103,
    type: NotificationType.DONATION_REQUEST,
    title: "Blood Request",
    message: "A patient needs blood.",
    entityType: "donation_request",
    entityId: 10,
  });

  assert.equal(result, null);
  assert.equal(repo.notifications.length, 0);

  // But critical account security notification must still be delivered
  const securityResult = await service.sendNotification({
    userId: 103,
    type: NotificationType.ACCOUNT_SECURITY,
    title: "Security Alert",
    message: "New login from unknown device.",
  });

  assert.ok(securityResult);
  assert.equal(repo.notifications.length, 1);
});

test("NotificationService: marks notifications as read and updates unread counts", async () => {
  const repo = new MockNotificationRepository() as any;
  const socket = new MockSocketService() as any;
  const push = new MockExpoPushService() as any;
  const service = new NotificationService(repo, socket, push);

  const n1 = await service.sendNotification({
    userId: 104,
    type: NotificationType.REQUEST_ACCEPTED,
    title: "Accepted",
    message: "Your request was accepted.",
  });
  const n2 = await service.sendNotification({
    userId: 104,
    type: NotificationType.REQUEST_ACCEPTED,
    title: "Accepted 2",
    message: "Another accepted.",
  });

  assert.equal(await repo.getUnreadCount(104), 2);

  await service.markAsRead(n1!.id, 104);
  assert.equal(await repo.getUnreadCount(104), 1);

  await service.markAllAsRead(104);
  assert.equal(await repo.getUnreadCount(104), 0);
});

test("Socket.IO JWT authentication validation", () => {
  const jwtSecret = process.env.JWT_SECRET || "test-secret";
  const validToken = jwt.sign({ sub: 55 }, jwtSecret, { expiresIn: "1h" });
  const decoded = jwt.verify(validToken, jwtSecret) as any;

  assert.equal(decoded.sub, 55);

  const signupToken = jwt.sign({ phone: "+1234567890", purpose: "signup" }, jwtSecret);
  const decodedSignup = jwt.verify(signupToken, jwtSecret) as any;
  assert.equal(decodedSignup.purpose, "signup");
  assert.equal(decodedSignup.sub, undefined);
});

test("Notification API: rejects unauthorized access without JWT", async () => {
  const { app } = await import("../src/server.js");
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/api/notifications`);
    assert.equal(res.status, 401);

    const tokenRes = await fetch(`${baseUrl}/api/notifications/push-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "ExponentPushToken[abc]" }),
    });
    assert.equal(tokenRes.status, 401);

    const prefRes = await fetch(`${baseUrl}/api/notifications/preferences`);
    assert.equal(prefRes.status, 401);
  } finally {
    server.close();
  }
});

test("Notification API: rejects invalid or signup token", async () => {
  const { app } = await import("../src/server.js");
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const jwtSecret = process.env.JWT_SECRET || "test-secret";
  const signupToken = jwt.sign({ phone: "+1234567890", purpose: "signup" }, jwtSecret);

  try {
    const res = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${signupToken}` },
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

