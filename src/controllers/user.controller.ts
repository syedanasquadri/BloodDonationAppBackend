import { type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { BloodGroup, NotificationType } from "../generated/prisma/enums.js";
import { notificationService } from "../notifications/notification.service.js";
import { calculateDistanceKm } from "../lib/geo.js";
import {
  getCompatibleDonorGroups,
  getMatchType,
} from "../lib/bloodCompatibility.js";

export const createUser = async (req: Request, res: Response) => {
  const { name, bloodGroup, phone, address, city, state, latitude, longitude } =
    req.body;

  const user = await prisma.user.create({
    data: {
      name,
      bloodGroup,
      phone,
      address,
      city,
      state,
      latitude,
      longitude,
    },
  });

  res.json(user);
};

export const getUsers = async (req: Request, res: Response) => {
  const { bloodGroup, lat, lng } = req.query;
  const userId = res.locals.userId as number;

  if (
    bloodGroup !== undefined &&
    (typeof bloodGroup !== "string" ||
      !Object.values(BloodGroup).includes(bloodGroup as BloodGroup))
  ) {
    return res.status(400).json({
      message: "Invalid blood group.",
    });
  }

  // Parse and validate optional user coordinates
  let parsedLat: number | null = null;
  let parsedLng: number | null = null;

  if (lat !== undefined && lng !== undefined) {
    const rawLat = typeof lat === "string" ? parseFloat(lat) : Number(lat);
    const rawLng = typeof lng === "string" ? parseFloat(lng) : Number(lng);

    if (
      !Number.isNaN(rawLat) &&
      !Number.isNaN(rawLng) &&
      rawLat >= -90 &&
      rawLat <= 90 &&
      rawLng >= -180 &&
      rawLng <= 180
    ) {
      parsedLat = rawLat;
      parsedLng = rawLng;
    }
  }

  const requestedBloodGroup =
    typeof bloodGroup === "string" ? (bloodGroup as BloodGroup) : undefined;
  const compatibleGroups = requestedBloodGroup
    ? getCompatibleDonorGroups(requestedBloodGroup)
    : undefined;

  const users = await prisma.user.findMany({
    where: {
      id: { not: userId },
      ...(compatibleGroups && { bloodGroup: { in: compatibleGroups } }),
    },
    select: {
      id: true,
      name: true,
      bloodGroup: true,
      city: true,
      state: true,
      latitude: true,
      longitude: true,
    },
  });

  const hasCoords = parsedLat !== null && parsedLng !== null;

  const result = users.map((user) => {
    let distanceKm: number | null = null;

    if (
      hasCoords &&
      user.latitude !== null &&
      user.longitude !== null
    ) {
      distanceKm = calculateDistanceKm(
        parsedLat!,
        parsedLng!,
        user.latitude,
        user.longitude,
      );
    }

    return {
      id: user.id,
      name: user.name,
      bloodGroup: user.bloodGroup,
      city: user.city,
      state: user.state,
      distanceKm,
      ...(requestedBloodGroup && {
        matchType: getMatchType(requestedBloodGroup, user.bloodGroup),
      }),
    };
  });

  if (requestedBloodGroup || hasCoords) {
    result.sort((a, b) => {
      if (requestedBloodGroup) {
        const rankA = a.matchType === "EXACT" ? 0 : 1;
        const rankB = b.matchType === "EXACT" ? 0 : 1;
        if (rankA !== rankB) {
          return rankA - rankB;
        }
      }

      if (hasCoords) {
        if (a.distanceKm !== null && b.distanceKm !== null) {
          return a.distanceKm - b.distanceKm;
        }
        if (a.distanceKm !== null) {
          return -1;
        }
        if (b.distanceKm !== null) {
          return 1;
        }
      }

      return 0;
    });
  }

  return res.status(200).json(result);
};

export const getUserProfile = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const userId = res.locals.userId as number;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      message: "Invalid user ID.",
    });
  }

  if (id !== userId) {
    return res.status(403).json({
      message: "You can only view your own profile.",
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      bloodGroup: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      latitude: true,
      longitude: true,
      isPhoneVerified: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    return res.status(404).json({
      message: "User not found.",
    });
  }

  return res.status(200).json(user);
};

export const updateUserProfile = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const userId = res.locals.userId as number;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      message: "Invalid user ID.",
    });
  }

  if (id !== userId) {
    return res.status(403).json({
      message: "You can only update your own profile.",
    });
  }

  const { name, bloodGroup, address, city, state, latitude, longitude } =
    req.body;

  if (
    bloodGroup !== undefined &&
    !Object.values(BloodGroup).includes(bloodGroup)
  ) {
    return res.status(400).json({
      message: "Invalid blood group.",
    });
  }

  if (
    (latitude !== undefined &&
      (typeof latitude !== "number" ||
        Number.isNaN(latitude) ||
        latitude < -90 ||
        latitude > 90)) ||
    (longitude !== undefined &&
      (typeof longitude !== "number" ||
        Number.isNaN(longitude) ||
        longitude < -180 ||
        longitude > 180))
  ) {
    return res.status(400).json({
      message: "Invalid latitude or longitude.",
    });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(name !== undefined && { name }),
      ...(bloodGroup !== undefined && { bloodGroup }),
      ...(address !== undefined && { address }),
      ...(city !== undefined && { city }),
      ...(state !== undefined && { state }),
      ...(latitude !== undefined && { latitude }),
      ...(longitude !== undefined && { longitude }),
    },
    select: {
      id: true,
      name: true,
      bloodGroup: true,
      address: true,
      city: true,
      state: true,
      latitude: true,
      longitude: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  notificationService
    .sendNotification({
      userId,
      type: NotificationType.ACCOUNT_SECURITY,
      title: "Profile Updated",
      message: "Your profile information was successfully updated.",
      entityType: "user",
      entityId: userId,
    })
    .catch((err) =>
      console.error("Failed to dispatch security notification:", err),
    );

  return res.status(200).json(user);
};

export const deleteUser = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const userId = res.locals.userId as number;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      message: "Invalid user ID.",
    });
  }

  if (id !== userId) {
    return res.status(403).json({
      message: "You can only delete your own account.",
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    return res.status(404).json({
      message: "User not found.",
    });
  }

  await prisma.user.delete({
    where: { id: userId },
  });

  return res.status(200).json({
    message: "Account deleted successfully.",
  });
};
