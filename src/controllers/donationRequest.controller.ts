import { type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";

export const createDonationRequest = async (
  req: Request,
  res: Response,
) => {
  const {
    donorId,
    requesterName,
    requesterPhone,
    bloodGroup,
  } = req.body;

  const donationRequest = await prisma.donationRequest.create({
    data: {
      donorId,
      requesterName,
      requesterPhone,
      bloodGroup,
    },
  });

  res.json(donationRequest);
};