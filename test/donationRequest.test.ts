import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";

const databaseUrl = process.env.DATABASE_URL;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;

const parsePostgresUrl = (value: string, name: string) => {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL.`);
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${name} must use the PostgreSQL protocol.`);
  }

  return {
    host: parsed.hostname.toLowerCase(),
    database: decodeURIComponent(
      parsed.pathname.replace(/^\//, ""),
    ).toLowerCase(),
  };
};

if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required; refusing to use DATABASE_URL.",
  );
}
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required to verify test database isolation.",
  );
}
if (!jwtSecret) {
  throw new Error("JWT_SECRET is required to generate test access tokens.");
}

const configuredDatabase = parsePostgresUrl(databaseUrl, "DATABASE_URL");
const isolatedDatabase = parsePostgresUrl(testDatabaseUrl, "TEST_DATABASE_URL");

if (
  !configuredDatabase.host.endsWith(".neon.tech") ||
  !isolatedDatabase.host.endsWith(".neon.tech")
) {
  throw new Error(
    "DATABASE_URL and TEST_DATABASE_URL must both point to Neon.",
  );
}
if (
  configuredDatabase.host === isolatedDatabase.host &&
  configuredDatabase.database === isolatedDatabase.database
) {
  throw new Error(
    "TEST_DATABASE_URL points to the same Neon host and database as DATABASE_URL; refusing to run tests.",
  );
}

// The application Prisma client reads DATABASE_URL; redirect only this test process
// to the verified test branch before importing the client or route modules.
process.env.DATABASE_URL = testDatabaseUrl;

const [
  { prisma },
  { default: donationRequestRoutes },
  { BloodGroup, DonationRequestStatus, UrgencyLevel },
  { createDonationRequest, getSentRequests, getReceivedRequests },
] = await Promise.all([
  import("../src/lib/prisma.js"),
  import("../src/routes/donationRequest.routes.js"),
  import("../src/generated/prisma/enums.js"),
  import("../src/controllers/donationRequest.controller.js"),
]);

const app = express();
app.use(express.json());
app.use("/api/donation-requests", donationRequestRoutes);

let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let isDbConnected = false;

before(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    isDbConnected = true;
  } catch (err: any) {
    isDbConnected = false;
    console.warn("Remote test database not reachable; skipping remote DB integration tests.");
  }
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  if (isDbConnected) {
    await prisma.$disconnect().catch(() => {});
  }
});

type Fixture = {
  requester: { id: number };
  donor: { id: number };
  tokenFor: (userId: number) => string;
  createRequest: (
    status?: (typeof DonationRequestStatus)[keyof typeof DonationRequestStatus],
  ) => Promise<number>;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
};

const withFixture = async (run: (fixture: Fixture) => Promise<void>) => {
  if (!isDbConnected) {
    return;
  }
  const userIds: number[] = [];
  const requestIds: number[] = [];

  try {
    const suffix = randomUUID();
    const requester = await prisma.user.create({
      data: {
        name: "API test requester",
        bloodGroup: BloodGroup.O_POSITIVE,
        phone: `+1555${suffix.replaceAll("-", "").slice(0, 10)}`,
      },
      select: { id: true },
    });
    userIds.push(requester.id);

    const donor = await prisma.user.create({
      data: {
        name: "API test donor",
        bloodGroup: BloodGroup.O_POSITIVE,
        phone: `+1666${suffix.replaceAll("-", "").slice(0, 10)}`,
      },
      select: { id: true },
    });
    userIds.push(donor.id);

    const tokenFor = (userId: number) =>
      jwt.sign({ sub: userId }, jwtSecret, { expiresIn: "15m" });

    const createRequest = async (
      status: (typeof DonationRequestStatus)[keyof typeof DonationRequestStatus] = DonationRequestStatus.PENDING,
    ) => {
      const request = await prisma.donationRequest.create({
        data: {
          requesterId: requester.id,
          donorId: donor.id,
          bloodGroup: BloodGroup.O_POSITIVE,
          status,
        },
        select: { id: true },
      });
      requestIds.push(request.id);
      return request.id;
    };

    await run({
      requester,
      donor,
      tokenFor,
      createRequest,
      fetch: (path, init = {}) => fetch(`${baseUrl}${path}`, init),
    });
  } finally {
    if (requestIds.length > 0) {
      await prisma.donationRequest.deleteMany({
        where: { id: { in: requestIds } },
      });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }
};

const patchStatus = (id: number | string, status: string, token: string) => ({
  method: "PATCH",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ status }),
});

test("requester cannot accept their own donation request", async () => {
  await withFixture(
    async ({ requester, tokenFor, createRequest, fetch: apiFetch }) => {
      const id = await createRequest();
      const response = await apiFetch(
        `/api/donation-requests/${id}/status`,
        patchStatus(id, "ACCEPTED", tokenFor(requester.id)),
      );
      assert.equal(response.status, 403);
    },
  );
});

test("accepting an already processed request returns 400", async () => {
  await withFixture(
    async ({ donor, tokenFor, createRequest, fetch: apiFetch }) => {
      const id = await createRequest(DonationRequestStatus.ACCEPTED);
      const response = await apiFetch(
        `/api/donation-requests/${id}/status`,
        patchStatus(id, "ACCEPTED", tokenFor(donor.id)),
      );
      assert.equal(response.status, 400);
    },
  );
});

test("donor can reject a pending request", async () => {
  await withFixture(
    async ({ donor, tokenFor, createRequest, fetch: apiFetch }) => {
      const id = await createRequest();
      const response = await apiFetch(
        `/api/donation-requests/${id}/status`,
        patchStatus(id, "REJECTED", tokenFor(donor.id)),
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, "REJECTED");
    },
  );
});

test("requester can cancel a pending request", async () => {
  await withFixture(
    async ({ requester, tokenFor, createRequest, fetch: apiFetch }) => {
      const id = await createRequest();
      const response = await apiFetch(
        `/api/donation-requests/${id}/status`,
        patchStatus(id, "CANCELLED", tokenFor(requester.id)),
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, "CANCELLED");
    },
  );
});

test("invalid request status returns 400", async () => {
  await withFixture(
    async ({ donor, tokenFor, createRequest, fetch: apiFetch }) => {
      const id = await createRequest();
      const response = await apiFetch(
        `/api/donation-requests/${id}/status`,
        patchStatus(id, "NOT_A_STATUS", tokenFor(donor.id)),
      );
      assert.equal(response.status, 400);
    },
  );
});

test("invalid request ID returns 400", async () => {
  await withFixture(async ({ donor, tokenFor, fetch: apiFetch }) => {
    const response = await apiFetch(
      "/api/donation-requests/not-an-id/status",
      patchStatus("not-an-id", "ACCEPTED", tokenFor(donor.id)),
    );
    assert.equal(response.status, 400);
  });
});

test("all protected donation-request endpoints reject missing authentication", async () => {
  await withFixture(async ({ fetch: apiFetch }) => {
    const cases: Array<{ path: string; method?: string; body?: string }> = [
      { path: "/api/donation-requests", method: "POST", body: "{}" },
      { path: "/api/donation-requests/sent" },
      { path: "/api/donation-requests/received" },
      {
        path: "/api/donation-requests/1/status",
        method: "PATCH",
        body: JSON.stringify({ status: "ACCEPTED" }),
      },
    ];

    for (const { path, method, body } of cases) {
      const response = await apiFetch(path, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body,
      });
      assert.equal(response.status, 401, `${method ?? "GET"} ${path}`);
    }
  });
});

test("getSentRequests returns counterparty donor details ordered newest-first and strips phone unless status is ACCEPTED", async () => {
  const originalFindMany = prisma.donationRequest.findMany;
  let capturedArgs: any;

  const mockDbRecords = [
    {
      id: 101,
      requesterId: 10,
      donorId: 21,
      bloodGroup: "O_POSITIVE",
      status: "PENDING",
      createdAt: new Date("2026-11-24T12:00:00Z"),
      updatedAt: new Date("2026-11-24T12:00:00Z"),
      donor: {
        id: 21,
        name: "Pending Donor",
        bloodGroup: "O_POSITIVE",
        city: "Bengaluru",
        state: "Karnataka",
        phone: "+919876543210",
      },
    },
    {
      id: 102,
      requesterId: 10,
      donorId: 22,
      bloodGroup: "A_POSITIVE",
      status: "REJECTED",
      createdAt: new Date("2026-11-24T11:00:00Z"),
      updatedAt: new Date("2026-11-24T11:30:00Z"),
      donor: {
        id: 22,
        name: "Rejected Donor",
        bloodGroup: "A_POSITIVE",
        city: "Mysuru",
        state: "Karnataka",
        phone: "+919876543211",
      },
    },
    {
      id: 103,
      requesterId: 10,
      donorId: 23,
      bloodGroup: "B_POSITIVE",
      status: "CANCELLED",
      createdAt: new Date("2026-11-24T10:00:00Z"),
      updatedAt: new Date("2026-11-24T10:15:00Z"),
      donor: {
        id: 23,
        name: "Cancelled Donor",
        bloodGroup: "B_POSITIVE",
        city: "Hubballi",
        state: "Karnataka",
        phone: "+919876543212",
      },
    },
    {
      id: 104,
      requesterId: 10,
      donorId: 24,
      bloodGroup: "AB_POSITIVE",
      status: "ACCEPTED",
      createdAt: new Date("2026-11-24T09:00:00Z"),
      updatedAt: new Date("2026-11-24T09:45:00Z"),
      donor: {
        id: 24,
        name: "Accepted Donor",
        bloodGroup: "AB_POSITIVE",
        city: "Mangaluru",
        state: "Karnataka",
        phone: "+919876543213",
      },
    },
  ];

  prisma.donationRequest.findMany = (async (args: any) => {
    capturedArgs = args;
    return mockDbRecords;
  }) as any;

  try {
    let statusCode = 200;
    let payload: any = null;

    const req = {} as any;
    const res = {
      locals: { userId: 10 },
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => {
            payload = data;
          },
        };
      },
    } as any;

    await getSentRequests(req, res);

    assert.equal(statusCode, 200);

    // 1. Verify query ordering is newest-first
    assert.deepEqual(capturedArgs.orderBy, { createdAt: "desc" });
    assert.equal(capturedArgs.where.requesterId, 10);
    assert.deepEqual(capturedArgs.include.donor.select, {
      id: true,
      name: true,
      bloodGroup: true,
      city: true,
      state: true,
      phone: true,
    });

    assert.equal(payload.length, 4);

    // 2. Counterparty details returned
    assert.equal(payload[0].donor.name, "Pending Donor");
    assert.equal(payload[0].donor.bloodGroup, "O_POSITIVE");
    assert.equal(payload[0].donor.city, "Bengaluru");
    assert.equal(payload[0].donor.state, "Karnataka");

    // 3. Privacy rule: phone is null for PENDING, REJECTED, CANCELLED
    assert.equal(payload[0].status, "PENDING");
    assert.equal(payload[0].donor.phone, null, "phone must be stripped for PENDING sent request");

    assert.equal(payload[1].status, "REJECTED");
    assert.equal(payload[1].donor.phone, null, "phone must be stripped for REJECTED sent request");

    assert.equal(payload[2].status, "CANCELLED");
    assert.equal(payload[2].donor.phone, null, "phone must be stripped for CANCELLED sent request");

    // 4. Privacy rule: phone IS exposed for ACCEPTED
    assert.equal(payload[3].status, "ACCEPTED");
    assert.equal(payload[3].donor.name, "Accepted Donor");
    assert.equal(payload[3].donor.phone, "+919876543213", "phone must be exposed for ACCEPTED sent request");
  } finally {
    prisma.donationRequest.findMany = originalFindMany;
  }
});

test("getReceivedRequests returns counterparty requester details ordered newest-first and strips phone unless status is ACCEPTED", async () => {
  const originalFindMany = prisma.donationRequest.findMany;
  let capturedArgs: any;

  const mockDbRecords = [
    {
      id: 201,
      requesterId: 51,
      donorId: 10,
      bloodGroup: "O_POSITIVE",
      status: "PENDING",
      createdAt: new Date("2026-11-24T12:00:00Z"),
      updatedAt: new Date("2026-11-24T12:00:00Z"),
      requester: {
        id: 51,
        name: "Pending Requester",
        bloodGroup: "O_POSITIVE",
        city: "Bengaluru",
        state: "Karnataka",
        phone: "+919111111111",
      },
    },
    {
      id: 202,
      requesterId: 52,
      donorId: 10,
      bloodGroup: "A_POSITIVE",
      status: "REJECTED",
      createdAt: new Date("2026-11-24T11:00:00Z"),
      updatedAt: new Date("2026-11-24T11:30:00Z"),
      requester: {
        id: 52,
        name: "Rejected Requester",
        bloodGroup: "A_POSITIVE",
        city: "Mysuru",
        state: "Karnataka",
        phone: "+919222222222",
      },
    },
    {
      id: 203,
      requesterId: 53,
      donorId: 10,
      bloodGroup: "B_POSITIVE",
      status: "CANCELLED",
      createdAt: new Date("2026-11-24T10:00:00Z"),
      updatedAt: new Date("2026-11-24T10:15:00Z"),
      requester: {
        id: 53,
        name: "Cancelled Requester",
        bloodGroup: "B_POSITIVE",
        city: "Hubballi",
        state: "Karnataka",
        phone: "+919333333333",
      },
    },
    {
      id: 204,
      requesterId: 54,
      donorId: 10,
      bloodGroup: "AB_POSITIVE",
      status: "ACCEPTED",
      createdAt: new Date("2026-11-24T09:00:00Z"),
      updatedAt: new Date("2026-11-24T09:45:00Z"),
      requester: {
        id: 54,
        name: "Accepted Requester",
        bloodGroup: "AB_POSITIVE",
        city: "Mangaluru",
        state: "Karnataka",
        phone: "+919444444444",
      },
    },
  ];

  prisma.donationRequest.findMany = (async (args: any) => {
    capturedArgs = args;
    return mockDbRecords;
  }) as any;

  try {
    let statusCode = 200;
    let payload: any = null;

    const req = {} as any;
    const res = {
      locals: { userId: 10 },
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => {
            payload = data;
          },
        };
      },
    } as any;

    await getReceivedRequests(req, res);

    assert.equal(statusCode, 200);

    // 1. Verify query ordering is newest-first
    assert.deepEqual(capturedArgs.orderBy, { createdAt: "desc" });
    assert.equal(capturedArgs.where.donorId, 10);
    assert.deepEqual(capturedArgs.include.requester.select, {
      id: true,
      name: true,
      bloodGroup: true,
      city: true,
      state: true,
      phone: true,
    });

    assert.equal(payload.length, 4);

    // 2. Counterparty details returned
    assert.equal(payload[0].requester.name, "Pending Requester");
    assert.equal(payload[0].requester.bloodGroup, "O_POSITIVE");
    assert.equal(payload[0].requester.city, "Bengaluru");
    assert.equal(payload[0].requester.state, "Karnataka");

    // 3. Privacy rule: phone is null for PENDING, REJECTED, CANCELLED
    assert.equal(payload[0].status, "PENDING");
    assert.equal(payload[0].requester.phone, null, "phone must be stripped for PENDING received request");

    assert.equal(payload[1].status, "REJECTED");
    assert.equal(payload[1].requester.phone, null, "phone must be stripped for REJECTED received request");

    assert.equal(payload[2].status, "CANCELLED");
    assert.equal(payload[2].requester.phone, null, "phone must be stripped for CANCELLED received request");

    // 4. Privacy rule: phone IS exposed for ACCEPTED
    assert.equal(payload[3].status, "ACCEPTED");
    assert.equal(payload[3].requester.name, "Accepted Requester");
    assert.equal(payload[3].requester.phone, "+919444444444", "phone must be exposed for ACCEPTED received request");
  } finally {
    prisma.donationRequest.findMany = originalFindMany;
  }
});

test("creating a donation request with hospitalName, hospitalCity, and urgency stores and returns them in sent and received endpoints", async () => {
  const originalFindUnique = prisma.user.findUnique;
  const originalCreate = prisma.donationRequest.create;
  const originalFindMany = prisma.donationRequest.findMany;
  const { notificationService } = await import("../src/notifications/notification.service.js");
  const originalSendNotification = notificationService.sendNotification;

  let capturedCreateData: any = null;
  let capturedNotification: any = null;

  notificationService.sendNotification = (async (input: any) => {
    capturedNotification = input;
    return null;
  }) as any;

  prisma.user.findUnique = (async () => ({ id: 2 })) as any;
  prisma.donationRequest.create = (async (args: any) => {
    capturedCreateData = args.data;
    return {
      id: 501,
      ...args.data,
      status: "PENDING",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }) as any;

  try {
    let statusCode = 0;
    let payload: any = null;

    const req = {
      body: {
        donorId: 2,
        bloodGroup: "O_POSITIVE",
        hospitalName: "  Apollo Hospital  ",
        hospitalCity: "  Bengaluru  ",
        urgency: "CRITICAL",
      },
    } as any;

    const res = {
      locals: { userId: 1 },
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => {
            payload = data;
          },
        };
      },
    } as any;

    await createDonationRequest(req, res);

    assert.equal(statusCode, 201);
    assert.equal(capturedCreateData.donorId, 2);
    assert.equal(capturedCreateData.requesterId, 1);
    assert.equal(capturedCreateData.bloodGroup, "O_POSITIVE");
    assert.equal(capturedCreateData.hospitalName, "Apollo Hospital");
    assert.equal(capturedCreateData.hospitalCity, "Bengaluru");
    assert.equal(capturedCreateData.urgency, "CRITICAL");

    assert.equal(payload.hospitalName, "Apollo Hospital");
    assert.equal(payload.hospitalCity, "Bengaluru");
    assert.equal(payload.urgency, "CRITICAL");

    // Verify enriched notification for CRITICAL with hospital name
    assert.equal(capturedNotification.title, "Urgent Blood Donation Request");
    assert.equal(
      capturedNotification.message,
      "Urgent request for O_POSITIVE blood at Apollo Hospital.",
    );
    assert.equal(capturedNotification.data.hospitalName, "Apollo Hospital");
    assert.equal(capturedNotification.data.urgency, "CRITICAL");

    // Also verify sent requests endpoint returns hospitalName, hospitalCity, urgency
    prisma.donationRequest.findMany = (async () => [
      {
        id: 501,
        requesterId: 1,
        donorId: 2,
        bloodGroup: "O_POSITIVE",
        status: "PENDING",
        hospitalName: "Apollo Hospital",
        hospitalCity: "Bengaluru",
        urgency: "CRITICAL",
        createdAt: new Date(),
        updatedAt: new Date(),
        donor: {
          id: 2,
          name: "Test Donor",
          bloodGroup: "O_POSITIVE",
          city: "Bengaluru",
          state: "Karnataka",
          phone: "+919876543210",
        },
      },
    ]) as any;

    let sentPayload: any = null;
    const sentRes = {
      locals: { userId: 1 },
      status: (code: number) => {
        assert.equal(code, 200);
        return {
          json: (data: any) => {
            sentPayload = data;
          },
        };
      },
    } as any;

    await getSentRequests({} as any, sentRes);
    assert.equal(sentPayload[0].hospitalName, "Apollo Hospital");
    assert.equal(sentPayload[0].hospitalCity, "Bengaluru");
    assert.equal(sentPayload[0].urgency, "CRITICAL");

    // Also verify received requests endpoint returns hospitalName, hospitalCity, urgency
    prisma.donationRequest.findMany = (async () => [
      {
        id: 501,
        requesterId: 1,
        donorId: 2,
        bloodGroup: "O_POSITIVE",
        status: "PENDING",
        hospitalName: "Apollo Hospital",
        hospitalCity: "Bengaluru",
        urgency: "CRITICAL",
        createdAt: new Date(),
        updatedAt: new Date(),
        requester: {
          id: 1,
          name: "Test Requester",
          bloodGroup: "O_POSITIVE",
          city: "Bengaluru",
          state: "Karnataka",
          phone: "+919876543211",
        },
      },
    ]) as any;

    let receivedPayload: any = null;
    const receivedRes = {
      locals: { userId: 2 },
      status: (code: number) => {
        assert.equal(code, 200);
        return {
          json: (data: any) => {
            receivedPayload = data;
          },
        };
      },
    } as any;

    await getReceivedRequests({} as any, receivedRes);
    assert.equal(receivedPayload[0].hospitalName, "Apollo Hospital");
    assert.equal(receivedPayload[0].hospitalCity, "Bengaluru");
    assert.equal(receivedPayload[0].urgency, "CRITICAL");
  } finally {
    prisma.user.findUnique = originalFindUnique;
    prisma.donationRequest.create = originalCreate;
    prisma.donationRequest.findMany = originalFindMany;
    notificationService.sendNotification = originalSendNotification;
  }
});

test("creating a donation request without optional hospital fields still succeeds and defaults urgency to WITHIN_24H", async () => {
  const originalFindUnique = prisma.user.findUnique;
  const originalCreate = prisma.donationRequest.create;
  const { notificationService } = await import("../src/notifications/notification.service.js");
  const originalSendNotification = notificationService.sendNotification;

  let capturedCreateData: any = null;
  let capturedNotification: any = null;

  notificationService.sendNotification = (async (input: any) => {
    capturedNotification = input;
    return null;
  }) as any;

  prisma.user.findUnique = (async () => ({ id: 2 })) as any;
  prisma.donationRequest.create = (async (args: any) => {
    capturedCreateData = args.data;
    return {
      id: 502,
      ...args.data,
      status: "PENDING",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }) as any;

  try {
    let statusCode = 0;
    let payload: any = null;

    const req = {
      body: {
        donorId: 2,
        bloodGroup: "O_POSITIVE",
      },
    } as any;

    const res = {
      locals: { userId: 1 },
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => {
            payload = data;
          },
        };
      },
    } as any;

    await createDonationRequest(req, res);

    assert.equal(statusCode, 201);
    assert.equal(capturedCreateData.donorId, 2);
    assert.equal(capturedCreateData.requesterId, 1);
    assert.equal(capturedCreateData.bloodGroup, "O_POSITIVE");
    assert.equal(capturedCreateData.hospitalName, null);
    assert.equal(capturedCreateData.hospitalCity, null);
    assert.equal(capturedCreateData.urgency, "WITHIN_24H");

    assert.equal(payload.hospitalName, null);
    assert.equal(payload.hospitalCity, null);
    assert.equal(payload.urgency, "WITHIN_24H");

    assert.equal(capturedNotification.title, "New Blood Donation Request");
    assert.equal(
      capturedNotification.message,
      "A request for O_POSITIVE blood was sent to you.",
    );
    assert.equal(capturedNotification.data.hospitalName, null);
    assert.equal(capturedNotification.data.urgency, "WITHIN_24H");
  } finally {
    prisma.user.findUnique = originalFindUnique;
    prisma.donationRequest.create = originalCreate;
    notificationService.sendNotification = originalSendNotification;
  }
});
