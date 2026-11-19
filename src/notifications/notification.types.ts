import { NotificationType } from "../generated/prisma/enums.js";

export { NotificationType };

export interface CreateNotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string | undefined;
  entityId?: number | undefined;
  data?: Record<string, any> | undefined;
  channels?: Array<"socket" | "push"> | undefined;
}

export interface NotificationRecord {
  id: number;
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  entityType: string | null;
  entityId: number | null;
  data: string | null;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationPreferences {
  bloodRequests: boolean;
  statusUpdates: boolean;
  announcements: boolean;
}

export interface UpdatePreferencesInput {
  bloodRequests?: boolean | undefined;
  statusUpdates?: boolean | undefined;
  announcements?: boolean | undefined;
}

export interface RegisterPushTokenInput {
  token: string;
  deviceType?: "android" | "ios" | "web" | string | undefined;
}

export interface NotificationQueryOptions {
  limit?: number | undefined;
  offset?: number | undefined;
  isRead?: boolean | undefined;
}
