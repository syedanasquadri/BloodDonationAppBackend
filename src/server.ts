import http from "node:http";
import express from "express";
import cors from "cors";
import donationRequestRoutes from "./routes/donationRequest.routes.js";
import userRoutes from "./routes/user.routes.js";
import authRoutes from "./auth/auth.routes.js";
import notificationRoutes from "./notifications/notification.routes.js";
import { socketService } from "./notifications/socket.service.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello, World!");
});

app.get("/api/health", (req, res) => {
  res.json({ message: "BloodConnect API is running" });
});

app.use("/api/donation-requests", donationRequestRoutes);
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/notifications", notificationRoutes);

const server = http.createServer(app);

// Initialize Socket.IO on the HTTP server
socketService.initialize(server);

const PORT = process.env.PORT || 3000;

const isTestRun =
  process.env.NODE_ENV === "test" ||
  process.argv.some((arg) => arg.includes("test")) ||
  Boolean(process.env.npm_lifecycle_event?.includes("test"));

if (!isTestRun) {
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

export { app, server };
