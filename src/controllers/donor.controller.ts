import { type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";

export const createDonor = async (req: Request, res: Response) => {
  const { name, bloodGroup, phone, location } = req.body;

  const donor = await prisma.donor.create({
    data: {
      name,
      bloodGroup,
      phone,
      location,
    },
  });

  res.json(donor);
};

export const getDonors = async (req: Request, res: Response) => {
  const donors = await prisma.donor.findMany();

  res.json(donors);
};

export const updateDonor = async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const donor = await prisma.donor.update({
    where: { id },
    data: req.body,
  });

  res.json(donor);
};

export const deleteDonor = async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  await prisma.donor.delete({
    where: { id },
  });

  res.json({
    message: "Donor deleted successfully",
  });
};