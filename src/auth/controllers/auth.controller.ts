import { type Request, type Response } from "express";
import { sendOtp, verifyOtp } from "../services/auth.service.js";
import { prisma } from "../../lib/prisma.js";
import {
  createSession,
  createSignupToken,
  refreshSession,
  revokeSession,
  verifySignupToken,
} from "../services/token.service.js";
import { BloodGroup } from "../../generated/prisma/client.js";

export const sendOtpController = async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;

    if (typeof phone !== "string" || !/^\+?[1-9]\d{7,14}$/.test(phone)) {
      return res.status(400).json({
        message: "Provide a valid phone number with country code",
      });
    }

    await sendOtp(phone);

    return res.status(200).json({
      message: "OTP generated. Check the backend terminal in development.",
    });
  } catch (error) {
    console.error("Send OTP error:", error);

    return res.status(500).json({
      message: "Unable to generate OTP",
    });
  }
};

export const verifyOtpController = async (req: Request, res: Response) => {
  try {
    const { phone, otp } = req.body;

    if (
      typeof phone !== "string" ||
      !/^\+?[1-9]\d{7,14}$/.test(phone) ||
      typeof otp !== "string" ||
      !/^\d{6}$/.test(otp)
    ) {
      return res.status(400).json({
        message: "Provide a valid phone number and six-digit OTP.",
      });
    }

    const result = await verifyOtp(phone, otp);

    if (!result.success) {
      return res.status(400).json({
        message: result.message,
      });
    }

    const user = await prisma.user.findUnique({
      where: { phone },
    });

    if (!user) {
      const signupToken = createSignupToken(phone);

      return res.status(200).json({
        message: "Phone verified. Complete your profile to sign up.",
        accountExists: false,
        signupToken,
      });
    }

    const session = await createSession(user.id);

    return res.status(200).json({
      message: "Phone verified successfully.",
      accountExists: true,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        bloodGroup: user.bloodGroup,
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);

    return res.status(500).json({
      message: "Unable to verify OTP",
    });
  }
};

export const completeSignupController = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const signupToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!signupToken) {
      return res.status(401).json({
        message: "Signup token is required.",
      });
    }

    const phone = verifySignupToken(signupToken);

    if (!phone) {
      return res.status(401).json({
        message: "Invalid or expired signup token.",
      });
    }

    const { name, bloodGroup, address, city, state, latitude, longitude } =
      req.body;

    const allowedBloodGroups = Object.values(BloodGroup);

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof bloodGroup !== "string" ||
      !allowedBloodGroups.includes(bloodGroup as BloodGroup)
    ) {
      return res.status(400).json({
        message: "A valid name and blood group are required.",
      });
    }

    if (
      (address !== undefined && typeof address !== "string") ||
      (city !== undefined && typeof city !== "string") ||
      (state !== undefined && typeof state !== "string") ||
      (latitude !== undefined &&
        (typeof latitude !== "number" || latitude < -90 || latitude > 90)) ||
      (longitude !== undefined &&
        (typeof longitude !== "number" || longitude < -180 || longitude > 180))
    ) {
      return res.status(400).json({
        message: "Invalid profile details.",
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { phone },
    });

    if (existingUser) {
      return res.status(409).json({
        message: "An account with this phone number already exists.",
      });
    }

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        phone,
        bloodGroup: bloodGroup as (typeof BloodGroup)[keyof typeof BloodGroup],
        address,
        city,
        state,
        latitude,
        longitude,
        isPhoneVerified: true,
      },
    });

    const session = await createSession(user.id);

    return res.status(201).json({
      message: "Account created successfully.",
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        bloodGroup: user.bloodGroup,
      },
    });
  } catch (error) {
    console.error("Complete signup error:", error);

    return res.status(500).json({
      message: "Unable to complete signup.",
    });
  }
};
export const refreshTokenController = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      return res.status(400).json({
        message: "Refresh token is required.",
      });
    }

    const session = await refreshSession(refreshToken);

    if (!session) {
      return res.status(401).json({
        message:
          "Invalid or expired refresh token. Please verify your phone again.",
      });
    }

    return res.status(200).json({
      message: "Session refreshed successfully.",
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
  } catch (error) {
    console.error("Refresh token error:", error);

    return res.status(500).json({
      message: "Unable to refresh session.",
    });
  }
};
export const logoutController = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      return res.status(400).json({
        message: "Refresh token is required.",
      });
    }

    await revokeSession(refreshToken);

    return res.status(200).json({
      message: "Logged out successfully.",
    });
  } catch (error) {
    console.error("Logout error:", error);

    return res.status(500).json({
      message: "Unable to log out.",
    });
  }
};
