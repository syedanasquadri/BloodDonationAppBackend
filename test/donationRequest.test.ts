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
  { BloodGroup, DonationRequestStatus },
] = await Promise.all([
  import("../src/lib/prisma.js"),
  import("../src/routes/donationRequest.routes.js"),
  import("../src/generated/prisma/enums.js"),
]);

const app = express();
app.use(express.json());
app.use("/api/donation-requests", donationRequestRoutes);

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

before(async () => {
  await prisma.$connect();
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
  await prisma.$disconnect();
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
