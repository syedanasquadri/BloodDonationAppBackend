import { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return secret;
};

export class SocketService {
  private io: SocketIOServer | null = null;

  initialize(httpServer: HttpServer): SocketIOServer {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST", "PATCH", "DELETE"],
      },
    });

    // JWT authentication middleware for Socket.IO
    this.io.use((socket: Socket, next) => {
      try {
        let token = socket.handshake.auth?.token as string | undefined;

        if (!token && socket.handshake.headers.authorization) {
          const authHeader = socket.handshake.headers.authorization;
          if (authHeader.startsWith("Bearer ")) {
            token = authHeader.slice(7);
          }
        }

        if (!token) {
          return next(new Error("Authentication error: Token required"));
        }

        const decoded = jwt.verify(token, getJwtSecret());

        if (
          typeof decoded === "string" ||
          typeof decoded.sub !== "number" ||
          (decoded as any).purpose === "signup"
        ) {
          return next(new Error("Authentication error: Invalid token"));
        }

        socket.data.userId = decoded.sub;
        return next();
      } catch (err: any) {
        return next(
          new Error("Authentication error: " + (err?.message || "Unauthorized")),
        );
      }
    });

    this.io.on("connection", (socket: Socket) => {
      const userId = socket.data.userId as number;
      const room = `user:${userId}`;

      // Join private user room (supports multiple concurrent devices)
      socket.join(room);

      socket.on("disconnect", () => {
        // Disconnected gracefully
      });
    });

    return this.io;
  }

  emitToUser(userId: number, event: string, payload: any): void {
    if (!this.io) return;
    this.io.to(`user:${userId}`).emit(event, payload);
  }

  emitToUsers(userIds: number[], event: string, payload: any): void {
    if (!this.io) return;
    for (const userId of userIds) {
      this.io.to(`user:${userId}`).emit(event, payload);
    }
  }

  isInitialized(): boolean {
    return this.io !== null;
  }
}

export const socketService = new SocketService();
