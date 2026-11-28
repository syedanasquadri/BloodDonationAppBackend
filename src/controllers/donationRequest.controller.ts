import { type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import {
  DonationRequestStatus,
  BloodGroup,
  NotificationType,
  UrgencyLevel,
} from "../generated/prisma/enums.js";
import { notificationService } from "../notifications/notification.service.js";

export const createDonationRequest = async (req: Request, res: Response) => {
  const requesterId = res.locals.userId as number;
  const { donorId, bloodGroup, hospitalName, hospitalCity, urgency } = req.body;

  const allowedBloodGroups = Object.values(BloodGroup);
  const allowedUrgencyLevels = Object.values(UrgencyLevel);

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

  let validatedHospitalName: string | null = null;
  if (hospitalName !== undefined && hospitalName !== null) {
    if (typeof hospitalName !== "string") {
      return res.status(400).json({
        message: "Hospital name must be a valid text string.",
      });
    }
    const trimmed = hospitalName.trim();
    if (trimmed.length > 0 && (trimmed.length < 2 || trimmed.length > 120)) {
      return res.status(400).json({
        message: "Hospital name must be between 2 and 120 characters.",
      });
    }
    validatedHospitalName = trimmed.length > 0 ? trimmed : null;
  }

  let validatedHospitalCity: string | null = null;
  if (hospitalCity !== undefined && hospitalCity !== null) {
    if (typeof hospitalCity !== "string") {
      return res.status(400).json({
        message: "Hospital city must be a valid text string.",
      });
    }
    const trimmed = hospitalCity.trim();
    if (trimmed.length > 0 && (trimmed.length < 2 || trimmed.length > 100)) {
      return res.status(400).json({
        message: "Hospital city must be between 2 and 100 characters.",
      });
    }
    validatedHospitalCity = trimmed.length > 0 ? trimmed : null;
  }

  let validatedUrgency: UrgencyLevel = UrgencyLevel.WITHIN_24H;
  if (urgency !== undefined && urgency !== null) {
    if (
      typeof urgency !== "string" ||
      !allowedUrgencyLevels.includes(urgency as UrgencyLevel)
    ) {
      return res.status(400).json({
        message: "Invalid urgency level. Allowed values: CRITICAL, WITHIN_24H, SCHEDULED.",
      });
    }
    validatedUrgency = urgency as UrgencyLevel;
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
      hospitalName: validatedHospitalName,
      hospitalCity: validatedHospitalCity,
      urgency: validatedUrgency,
    },
  });

  // Enrich notification message when hospitalName or urgency === "CRITICAL" is provided
  let notificationTitle = "New Blood Donation Request";
  let notificationMessage: string;

  if (validatedUrgency === UrgencyLevel.CRITICAL) {
    notificationTitle = "Urgent Blood Donation Request";
    if (validatedHospitalName) {
      notificationMessage = `Urgent request for ${bloodGroup} blood at ${validatedHospitalName}.`;
    } else {
      notificationMessage = `Urgent request for ${bloodGroup} blood was sent to you.`;
    }
  } else if (validatedHospitalName) {
    notificationMessage = `A request for ${bloodGroup} blood at ${validatedHospitalName} was sent to you.`;
  } else {
    notificationMessage = `A request for ${bloodGroup} blood was sent to you.`;
  }

  // Notify the eligible donor through centralized notification service
  notificationService
    .sendNotification({
      userId: donorId,
      type: NotificationType.DONATION_REQUEST,
      title: notificationTitle,
      message: notificationMessage,
      entityType: "donation_request",
      entityId: donationRequest.id,
      data: {
        requestId: donationRequest.id,
        bloodGroup: donationRequest.bloodGroup,
        requesterId,
        urgency: donationRequest.urgency,
        hospitalName: donationRequest.hospitalName,
        hospitalCity: donationRequest.hospitalCity,
      },
    })
    .catch((err) => {
      console.error("Failed to dispatch donation request notification:", err);
    });

  return res.status(201).json(donationRequest);
};

export const getSentRequests = async (req: Request, res: Response) => {
  const userId = res.locals.userId as number;

  const requests = await prisma.donationRequest.findMany({
    where: { requesterId: userId },
    orderBy: { createdAt: "desc" },
    include: {
      donor: {
        select: {
          id: true,
          name: true,
          bloodGroup: true,
          city: true,
          state: true,
          phone: true,
        },
      },
    },
  });

  const sanitized = requests.map((request) => ({
    ...request,
    donor: request.donor
      ? {
          ...request.donor,
          phone:
            request.status === DonationRequestStatus.ACCEPTED
              ? request.donor.phone
              : null,
        }
      : null,
  }));

  return res.status(200).json(sanitized);
};

export const getReceivedRequests = async (req: Request, res: Response) => {
  const userId = res.locals.userId as number;

  const requests = await prisma.donationRequest.findMany({
    where: { donorId: userId },
    orderBy: { createdAt: "desc" },
    include: {
      requester: {
        select: {
          id: true,
          name: true,
          bloodGroup: true,
          city: true,
          state: true,
          phone: true,
        },
      },
    },
  });

  const sanitized = requests.map((request) => ({
    ...request,
    requester: request.requester
      ? {
          ...request.requester,
          phone:
            request.status === DonationRequestStatus.ACCEPTED
              ? request.requester.phone
              : null,
        }
      : null,
  }));

  return res.status(200).json(sanitized);
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
    include: {
      donor: {
        select: {
          id: true,
          name: true,
          bloodGroup: true,
          city: true,
          state: true,
          phone: true,
        },
      },
      requester: {
        select: {
          id: true,
          name: true,
          bloodGroup: true,
          city: true,
          state: true,
          phone: true,
        },
      },
    },
  });

  if (!updatedRequest) {
    return res.status(404).json({
      message: "Donation request not found.",
    });
  }

  const isAccepted = updatedRequest.status === DonationRequestStatus.ACCEPTED;
  const sanitized = {
    ...updatedRequest,
    donor: updatedRequest.donor
      ? {
          ...updatedRequest.donor,
          phone: isAccepted ? updatedRequest.donor.phone : null,
        }
      : null,
    requester: updatedRequest.requester
      ? {
          ...updatedRequest.requester,
          phone: isAccepted ? updatedRequest.requester.phone : null,
        }
      : null,
  };

  // Notify relevant party through centralized notification service
  if (status === DonationRequestStatus.ACCEPTED) {
    notificationService
      .sendNotification({
        userId: request.requesterId,
        type: NotificationType.REQUEST_ACCEPTED,
        title: "Donation Request Accepted",
        message: "A donor has accepted your blood donation request.",
        entityType: "donation_request",
        entityId: id,
        data: { requestId: id, status },
      })
      .catch((err) =>
        console.error("Failed to dispatch acceptance notification:", err),
      );
  } else if (status === DonationRequestStatus.REJECTED) {
    notificationService
      .sendNotification({
        userId: request.requesterId,
        type: NotificationType.REQUEST_REJECTED,
        title: "Donation Request Declined",
        message: "A donor was unable to fulfill your blood donation request.",
        entityType: "donation_request",
        entityId: id,
        data: { requestId: id, status },
      })
      .catch((err) =>
        console.error("Failed to dispatch rejection notification:", err),
      );
  } else if (status === DonationRequestStatus.CANCELLED) {
    notificationService
      .sendNotification({
        userId: request.donorId,
        type: NotificationType.REQUEST_CANCELLED,
        title: "Donation Request Cancelled",
        message: "A blood donation request was cancelled by the requester.",
        entityType: "donation_request",
        entityId: id,
        data: { requestId: id, status },
      })
      .catch((err) =>
        console.error("Failed to dispatch cancellation notification:", err),
      );
  }

  return res.status(200).json(sanitized);
};
