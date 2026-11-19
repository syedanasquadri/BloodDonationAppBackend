import { Expo } from "expo-server-sdk";
import type { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { notificationRepository } from "./notification.repository.js";

export class ExpoPushService {
  private expo: Expo;

  constructor() {
    this.expo = new Expo();
  }

  async sendPushNotifications(
    tokens: string[],
    payload: {
      title: string;
      body: string;
      data?: Record<string, any>;
      sound?: "default" | null;
      badge?: number;
      channelId?: string;
    },
  ): Promise<{ sent: number; failed: number }> {
    if (tokens.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const validTokens: string[] = [];
    const invalidTokens: string[] = [];

    for (const token of tokens) {
      if (Expo.isExpoPushToken(token)) {
        validTokens.push(token);
      } else {
        invalidTokens.push(token);
      }
    }

    // Clean up invalid format tokens
    if (invalidTokens.length > 0) {
      console.warn(
        `[ExpoPushService] Removing ${invalidTokens.length} malformed push tokens.`,
      );
      await notificationRepository.deletePushTokens(invalidTokens);
    }

    if (validTokens.length === 0) {
      return { sent: 0, failed: invalidTokens.length };
    }

    const messages: ExpoPushMessage[] = validTokens.map((to) => {
      const msg: ExpoPushMessage = {
        to,
        sound: payload.sound ?? "default",
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        channelId: payload.channelId ?? "default",
        priority: "high",
      };
      if (typeof payload.badge === "number") {
        msg.badge = payload.badge;
      }
      return msg;
    });

    const chunks = this.expo.chunkPushNotifications(messages);
    const deadTokens: string[] = [];
    let sentCount = 0;
    let failedCount = invalidTokens.length;

    for (const chunk of chunks) {
      try {
        const ticketChunk: ExpoPushTicket[] =
          await this.expo.sendPushNotificationsAsync(chunk);

        for (let i = 0; i < ticketChunk.length; i++) {
          const ticket = ticketChunk[i];
          const targetToken = chunk[i]?.to;

          if (!ticket) continue;

          if (ticket.status === "ok") {
            sentCount++;
          } else {
            failedCount++;
            console.error(
              `[ExpoPushService] Push ticket error for token:`,
              ticket.message,
              ticket.details,
            );

            // Clean up unregistered devices
            if (
              ticket.details?.error === "DeviceNotRegistered" &&
              typeof targetToken === "string"
            ) {
              deadTokens.push(targetToken);
            }
          }
        }
      } catch (error) {
        console.error(
          "[ExpoPushService] Error sending chunk of push notifications:",
          error,
        );
        failedCount += chunk.length;
      }
    }

    if (deadTokens.length > 0) {
      console.info(
        `[ExpoPushService] Removing ${deadTokens.length} unregistered device tokens.`,
      );
      await notificationRepository.deletePushTokens(deadTokens);
    }

    return { sent: sentCount, failed: failedCount };
  }
}

export const expoPushService = new ExpoPushService();
