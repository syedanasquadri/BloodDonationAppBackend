import { type Request, type Response } from "express";

import { prisma } from "../lib/prisma.js";

export const createUser = async (req: Request, res: Response) => {
  const {
    name,
    bloodGroup,
    phone,
    address,
    city,
    state,
    latitude,
    longitude,
  } = req.body;

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

  const where = bloodGroup
    ? {
        bloodGroup: String(bloodGroup),
      }
    : {};

  const users = await prisma.user.findMany({
    where,
  });

  res.json(users);
};

export const getUserProfile = async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  res.json(user);
};

export const updateUserProfile = async (
  req: Request,
  res: Response,
) => {
  const id = Number(req.params.id);

  const user = await prisma.user.update({
    where: { id },
    data: req.body,
  });

  res.json(user);
};

export const deleteUser = async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  await prisma.user.delete({
    where: { id },
  });

  res.json({
    message: "User deleted successfully",
  });
};