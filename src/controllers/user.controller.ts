import { type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { BloodGroup } from "../generated/prisma/enums.js";

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
  const { bloodGroup } = req.query;

  if (
    bloodGroup !== undefined &&
    (typeof bloodGroup !== "string" ||
      !Object.values(BloodGroup).includes(bloodGroup as BloodGroup))
  ) {
    return res.status(400).json({
      message: "Invalid blood group.",
    });
  }

  const users = await prisma.user.findMany({
    where: bloodGroup ? { bloodGroup: bloodGroup as BloodGroup } : {},
    select: {
      id: true,
      name: true,
      bloodGroup: true,
      city: true,
      state: true,
    },
  });

  return res.status(200).json(users);
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
      city: true,
      state: true,
      createdAt: true,
      updatedAt: true,
    },
  });

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
