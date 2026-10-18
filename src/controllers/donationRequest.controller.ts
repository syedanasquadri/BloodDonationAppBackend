import { type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import {
  DonationRequestStatus,
  BloodGroup,
} from "../generated/prisma/enums.js";

export const createDonationRequest = async (req: Request, res: Response) => {
  const requesterId = res.locals.userId as number;
  const { donorId, bloodGroup } = req.body;

  const allowedBloodGroups = Object.values(BloodGroup);

  if (
    !Number.isInteger(donorId) ||
    donorId <= 0 ||
    typeof bloodGroup !== "string" ||
    !allowedBloodGroups.includes(bloodGroup as BloodGroup)
  ) {
    return res.status(400).json({
      message: "A valid donor ID and blood group are required.",
    });
  }

  if (donorId === requesterId) {
    return res.status(400).json({
      message: "You cannot request blood from yourself.",
    });
  }

  const donor = await prisma.user.findUnique({
    where: { id: donorId },
    select: { id: true },
  });

  if (!donor) {
    return res.status(404).json({
      message: "Donor not found.",
    });
  }

  const donationRequest = await prisma.donationRequest.create({
    data: {
      donorId,
      requesterId,
      bloodGroup: bloodGroup as BloodGroup,
    },
  });

  return res.status(201).json(donationRequest);
};

export const getSentRequests = async (req: Request, res: Response) => {
  const userId = res.locals.userId as number;

  const requests = await prisma.donationRequest.findMany({
    where: { requesterId: userId },
  });

  return res.status(200).json(requests);
};

export const getReceivedRequests = async (req: Request, res: Response) => {
  const userId = res.locals.userId as number;

  const requests = await prisma.donationRequest.findMany({
    where: { donorId: userId },
  });

  return res.status(200).json(requests);
};

export const updateDonationRequestStatus = async (
  req: Request,
  res: Response,
) => {
  const id = Number(req.params.id);
  const userId = res.locals.userId as number;
  const { status } = req.body;

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      message: "Invalid donation request ID.",
    });
  }

  if (
    status !== DonationRequestStatus.ACCEPTED &&
    status !== DonationRequestStatus.REJECTED &&
    status !== DonationRequestStatus.CANCELLED
  ) {
    return res.status(400).json({
      message: "Invalid status.",
    });
  }

  const request = await prisma.donationRequest.findUnique({
    where: { id },
    select: {
      donorId: true,
      requesterId: true,
      status: true,
    },
  });

  if (!request) {
    return res.status(404).json({
      message: "Donation request not found.",
    });
  }

  if (request.status !== DonationRequestStatus.PENDING) {
    return res.status(400).json({
      message: "Only pending requests can be updated.",
    });
  }

  const isDonor = request.donorId === userId;
  const isRequester = request.requesterId === userId;

  const canUpdate =
    (isDonor &&
      (status === DonationRequestStatus.ACCEPTED ||
        status === DonationRequestStatus.REJECTED)) ||
    (isRequester && status === DonationRequestStatus.CANCELLED);

  if (!canUpdate) {
    return res.status(403).json({
      message: "You are not allowed to perform this action.",
    });
  }

  const result = await prisma.donationRequest.updateMany({
    where: {
      id,
      status: DonationRequestStatus.PENDING,
    },
    data: {
      status,
    },
  });

  if (result.count === 0) {
    return res.status(409).json({
      message: "This request has already been updated.",
    });
  }

  const updatedRequest = await prisma.donationRequest.findUnique({
    where: { id },
  });

  return res.status(200).json(updatedRequest);
};
