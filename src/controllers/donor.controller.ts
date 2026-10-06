import { type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";

export const createDonor = async (req: Request, res: Response) => {
  const { name, bloodGroup, phone, address, city, state, latitude, longitude } = req.body;

  const donor = await prisma.user.create({
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

  res.json(donor);
};

export const getDonors = async (req: Request, res: Response) => {
  const { bloodGroup } = req.query;

  const where = bloodGroup
    ? {
        bloodGroup: String(bloodGroup),
      }
    : {};

  const donors = await prisma.user.findMany({
    where,
  });

  res.json(donors);
};

export const updateDonor = async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const donor = await prisma.user.update({
    where: { id },
    data: req.body,
  });

  res.json(donor);
};

export const deleteDonor = async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  await prisma.user.delete({
    where: { id },
  });

  res.json({
    message: "Donor deleted successfully",
  });
};
