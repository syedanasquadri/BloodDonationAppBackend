import { type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";

export const createDonationRequest = async (req: Request, res: Response) => {
  const { donorId, requesterId, bloodGroup } = req.body;

  const donationRequest = await prisma.donationRequest.create({
    data: {
      donorId,
      requesterId,
      bloodGroup,
    },
  });

  res.json(donationRequest);
};

export const getSentRequests = async (req: Request, res: Response) => {
  const userId = Number(req.params.userId);

  const requests = await prisma.donationRequest.findMany({
    where: {
      requesterId: userId,
    },
  });

  res.json(requests);
};

export const getReceivedRequests = async (req: Request, res: Response) => {
  const userId = Number(req.params.userId);

  const requests = await prisma.donationRequest.findMany({
    where: {
      donorId: userId,
    },
  });

  res.json(requests);
};

export const updateDonationRequestStatus = async (
  req: Request,
  res: Response,
) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  const validStatuses = ["PENDING", "ACCEPTED", "REJECTED"];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      message: "Invalid donation request status",
    });
  }
  const donationRequest = await prisma.donationRequest.update({
    where: { id },
    data: { status },
  });

  res.json(donationRequest);
};
