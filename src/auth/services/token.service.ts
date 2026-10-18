import { randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma.js";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return secret;
};

export const createSession = async (userId: number) => {
  const accessToken = jwt.sign({ sub: userId }, getJwtSecret(), {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });

  const refreshToken = randomBytes(32).toString("hex");

  const refreshTokenHash = createHash("sha256")
    .update(refreshToken)
    .digest("hex");

  const expiresAt = new Date(
    Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  await prisma.session.create({
    data: {
      userId,
      refreshTokenHash,
      expiresAt,
    },
  });

  return {
    accessToken,
    refreshToken,
  };
};

export const refreshSession = async (refreshToken: string) => {
  const refreshTokenHash = createHash("sha256")
    .update(refreshToken)
    .digest("hex");

  const session = await prisma.session.findUnique({
    where: { refreshTokenHash },
  });

  if (!session || session.expiresAt <= new Date()) {
    return null;
  }

  const newRefreshToken = randomBytes(32).toString("hex");

  const newRefreshTokenHash = createHash("sha256")
    .update(newRefreshToken)
    .digest("hex");

  const updated = await prisma.session.updateMany({
    where: {
      id: session.id,
      refreshTokenHash,
      expiresAt: { gt: new Date() },
    },
    data: {
      refreshTokenHash: newRefreshTokenHash,
    },
  });

  if (updated.count !== 1) {
    return null;
  }

  const accessToken = jwt.sign(
    { sub: session.userId },
    getJwtSecret(),
    { expiresIn: ACCESS_TOKEN_EXPIRY },
  );

  return {
    accessToken,
    refreshToken: newRefreshToken,
  };
};

export const revokeSession = async (refreshToken: string) => {
  const refreshTokenHash = createHash("sha256")
    .update(refreshToken)
    .digest("hex");

  await prisma.session.deleteMany({
    where: { refreshTokenHash },
  });
};

export const createSignupToken = (phone: string) => {
  return jwt.sign(
    {
      phone,
      purpose: "signup",
    },
    getJwtSecret(),
    { expiresIn: "10m" },
  );
};

export const verifySignupToken = (token: string) => {
  try {
    const decoded = jwt.verify(token, getJwtSecret());

    if (
      typeof decoded === "string" ||
      decoded.purpose !== "signup" ||
      typeof decoded.phone !== "string"
    ) {
      return null;
    }

    return decoded.phone;
  } catch {
    return null;
  }
};
