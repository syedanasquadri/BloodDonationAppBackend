import { randomInt, createHash } from "node:crypto";
import { prisma } from "../../lib/prisma.js";

export const sendOtp = async (phone: string) => {
  const otp = randomInt(100000, 1000000).toString();

  const otpHash = createHash("sha256")
    .update(otp)
    .digest("hex");

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.otpVerification.create({
    data: {
      phone,
      otpHash,
      expiresAt,
    },
  });

  if (process.env.NODE_ENV !== "production") {
    console.log(`Development OTP for ${phone}: ${otp}`);
  }
};


export const verifyOtp = async (phone: string, otp: string) => {
  const verification = await prisma.otpVerification.findFirst({
    where: {
      phone,
      consumedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!verification) {
    return { success: false, message: "No pending OTP found. Request a new OTP." };
  }

  if (verification.expiresAt <= new Date()) {
    return { success: false, message: "OTP has expired. Request a new OTP." };
  }

  if (verification.attempts >= 5) {
    return { success: false, message: "Too many attempts. Request a new OTP." };
  }

  const { createHash, timingSafeEqual } = await import("node:crypto");

  const submittedHash = createHash("sha256")
    .update(otp)
    .digest("hex");

  const matches = timingSafeEqual(
    Buffer.from(submittedHash, "hex"),
    Buffer.from(verification.otpHash, "hex"),
  );

  if (!matches) {
    await prisma.otpVerification.update({
      where: { id: verification.id },
      data: { attempts: { increment: 1 } },
    });

    return { success: false, message: "Invalid OTP." };
  }

  await prisma.otpVerification.update({
    where: { id: verification.id },
    data: { consumedAt: new Date() },
  });

  return { success: true, message: "Phone verified successfully." };
};
