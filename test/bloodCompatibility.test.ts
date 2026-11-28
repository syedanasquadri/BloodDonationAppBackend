import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { BloodGroup } from "../src/generated/prisma/enums.js";
import {
  getCompatibleDonorGroups,
  getMatchType,
} from "../src/lib/bloodCompatibility.js";
import { prisma } from "../src/lib/prisma.js";
import { app } from "../src/server.js";

test("getCompatibleDonorGroups returns exact RBC compatibility mappings for all 8 blood groups", () => {
  const expected: Record<BloodGroup, BloodGroup[]> = {
    [BloodGroup.O_NEGATIVE]: [BloodGroup.O_NEGATIVE],
    [BloodGroup.O_POSITIVE]: [BloodGroup.O_POSITIVE, BloodGroup.O_NEGATIVE],
    [BloodGroup.A_NEGATIVE]: [BloodGroup.A_NEGATIVE, BloodGroup.O_NEGATIVE],
    [BloodGroup.A_POSITIVE]: [
      BloodGroup.A_POSITIVE,
      BloodGroup.A_NEGATIVE,
      BloodGroup.O_POSITIVE,
      BloodGroup.O_NEGATIVE,
    ],
    [BloodGroup.B_NEGATIVE]: [BloodGroup.B_NEGATIVE, BloodGroup.O_NEGATIVE],
    [BloodGroup.B_POSITIVE]: [
      BloodGroup.B_POSITIVE,
      BloodGroup.B_NEGATIVE,
      BloodGroup.O_POSITIVE,
      BloodGroup.O_NEGATIVE,
    ],
    [BloodGroup.AB_NEGATIVE]: [
      BloodGroup.AB_NEGATIVE,
      BloodGroup.A_NEGATIVE,
      BloodGroup.B_NEGATIVE,
      BloodGroup.O_NEGATIVE,
    ],
    [BloodGroup.AB_POSITIVE]: [
      BloodGroup.AB_POSITIVE,
      BloodGroup.AB_NEGATIVE,
      BloodGroup.A_POSITIVE,
      BloodGroup.A_NEGATIVE,
      BloodGroup.B_POSITIVE,
      BloodGroup.B_NEGATIVE,
      BloodGroup.O_POSITIVE,
      BloodGroup.O_NEGATIVE,
    ],
  };

  for (const recipient of Object.values(BloodGroup)) {
    const actual = getCompatibleDonorGroups(recipient);
    assert.deepEqual(actual, expected[recipient]);
  }

  // Mutating a returned array must not mutate the underlying compatibility table
  const mutated = getCompatibleDonorGroups(BloodGroup.O_NEGATIVE);
  mutated.push(BloodGroup.AB_POSITIVE);
  assert.deepEqual(getCompatibleDonorGroups(BloodGroup.O_NEGATIVE), [
    BloodGroup.O_NEGATIVE,
  ]);
});

test("getMatchType distinguishes EXACT and COMPATIBLE matches", () => {
  assert.equal(
    getMatchType(BloodGroup.A_POSITIVE, BloodGroup.A_POSITIVE),
    "EXACT",
  );
  assert.equal(
    getMatchType(BloodGroup.A_POSITIVE, BloodGroup.O_NEGATIVE),
    "COMPATIBLE",
  );
});

test("GET /api/users?bloodGroup=A_POSITIVE returns compatible donors sorted EXACT-then-distance and strips private fields", async () => {
  const originalFindMany = prisma.user.findMany;
  const jwtSecret = process.env.JWT_SECRET;
  assert.ok(jwtSecret, "JWT_SECRET must be set for auth middleware test");

  const requesterId = 999;
  const requesterLat = 12.9716;
  const requesterLng = 77.5946; // Bengaluru

  const allDbUsers = [
    {
      id: requesterId,
      name: "Self Requester",
      bloodGroup: BloodGroup.A_POSITIVE,
      phone: "+919000000000",
      city: "Bengaluru",
      state: "Karnataka",
      latitude: 12.9716,
      longitude: 77.5946,
    },
    {
      id: 1,
      name: "Compatible Close O-",
      bloodGroup: BloodGroup.O_NEGATIVE,
      phone: "+919000000001",
      city: "Bengaluru",
      state: "Karnataka",
      latitude: 12.972,
      longitude: 77.595, // ~0.1 km (closer than exact matches)
    },
    {
      id: 2,
      name: "Exact Far A+",
      bloodGroup: BloodGroup.A_POSITIVE,
      phone: "+919000000002",
      city: "Mumbai",
      state: "Maharashtra",
      latitude: 19.076,
      longitude: 72.8777, // ~845 km
    },
    {
      id: 3,
      name: "Exact No GPS A+",
      bloodGroup: BloodGroup.A_POSITIVE,
      phone: "+919000000003",
      city: "Pune",
      state: "Maharashtra",
      latitude: null,
      longitude: null,
    },
    {
      id: 4,
      name: "Incompatible B+",
      bloodGroup: BloodGroup.B_POSITIVE,
      phone: "+919000000004",
      city: "Bengaluru",
      state: "Karnataka",
      latitude: 12.9716,
      longitude: 77.5946,
    },
    {
      id: 5,
      name: "Compatible No GPS O+",
      bloodGroup: BloodGroup.O_POSITIVE,
      phone: "+919000000005",
      city: "Mysuru",
      state: "Karnataka",
      latitude: null,
      longitude: null,
    },
    {
      id: 6,
      name: "Exact Near A+",
      bloodGroup: BloodGroup.A_POSITIVE,
      phone: "+919000000006",
      city: "Bengaluru",
      state: "Karnataka",
      latitude: 13.0,
      longitude: 77.6, // ~3.2 km
    },
    {
      id: 7,
      name: "Compatible Medium A-",
      bloodGroup: BloodGroup.A_NEGATIVE,
      phone: "+919000000007",
      city: "Chennai",
      state: "Tamil Nadu",
      latitude: 13.0827,
      longitude: 80.2707, // ~290 km
    },
  ];

  let capturedFindManyArgs: any;
  prisma.user.findMany = (async (args: any) => {
    capturedFindManyArgs = args;
    const excludedId = args?.where?.id?.not;
    const allowedGroups: BloodGroup[] | undefined = args?.where?.bloodGroup?.in;

    return allDbUsers
      .filter((u) => u.id !== excludedId)
      .filter((u) => !allowedGroups || allowedGroups.includes(u.bloodGroup))
      .map((u) => {
        const selected: Record<string, unknown> = {};
        for (const [key, enabled] of Object.entries(args.select ?? {})) {
          if (enabled) {
            selected[key] = (u as Record<string, unknown>)[key];
          }
        }
        return selected;
      });
  }) as any;

  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
      s.once("error", reject);
    },
  );
  const { port } = server.address() as AddressInfo;
  const token = jwt.sign({ sub: requesterId }, jwtSecret, { expiresIn: "15m" });

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/users?bloodGroup=A_POSITIVE&lat=${requesterLat}&lng=${requesterLng}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as Array<Record<string, any>>;

    assert.deepEqual(capturedFindManyArgs.where, {
      id: { not: requesterId },
      bloodGroup: {
        in: [
          BloodGroup.A_POSITIVE,
          BloodGroup.A_NEGATIVE,
          BloodGroup.O_POSITIVE,
          BloodGroup.O_NEGATIVE,
        ],
      },
    });
    assert.equal("phone" in capturedFindManyArgs.select, false);

    // Excludes self and B+, includes A+, A-, O+, O-
    assert.equal(body.length, 6);
    assert.equal(
      body.some((d) => d.bloodGroup === BloodGroup.B_POSITIVE),
      false,
    );
    assert.equal(
      body.some((d) => d.id === requesterId),
      false,
    );

    // Tier 1: EXACT matches (distance ascending, null last)
    assert.deepEqual(
      body.slice(0, 3).map((d) => ({
        name: d.name,
        bloodGroup: d.bloodGroup,
        matchType: d.matchType,
      })),
      [
        {
          name: "Exact Near A+",
          bloodGroup: BloodGroup.A_POSITIVE,
          matchType: "EXACT",
        },
        {
          name: "Exact Far A+",
          bloodGroup: BloodGroup.A_POSITIVE,
          matchType: "EXACT",
        },
        {
          name: "Exact No GPS A+",
          bloodGroup: BloodGroup.A_POSITIVE,
          matchType: "EXACT",
        },
      ],
    );
    assert.equal(body[2].distanceKm, null);

    // Tier 2: COMPATIBLE matches (distance ascending, null last)
    assert.deepEqual(
      body.slice(3).map((d) => ({
        name: d.name,
        bloodGroup: d.bloodGroup,
        matchType: d.matchType,
      })),
      [
        {
          name: "Compatible Close O-",
          bloodGroup: BloodGroup.O_NEGATIVE,
          matchType: "COMPATIBLE",
        },
        {
          name: "Compatible Medium A-",
          bloodGroup: BloodGroup.A_NEGATIVE,
          matchType: "COMPATIBLE",
        },
        {
          name: "Compatible No GPS O+",
          bloodGroup: BloodGroup.O_POSITIVE,
          matchType: "COMPATIBLE",
        },
      ],
    );
    assert.equal(body[5].distanceKm, null);

    // Privacy check: phone, latitude, longitude, address must never be returned
    for (const donor of body) {
      assert.equal("phone" in donor, false);
      assert.equal("latitude" in donor, false);
      assert.equal("longitude" in donor, false);
      assert.equal("address" in donor, false);
      assert.deepEqual(Object.keys(donor).sort(), [
        "bloodGroup",
        "city",
        "distanceKm",
        "id",
        "matchType",
        "name",
        "state",
      ]);
    }

    // Invalid bloodGroup returns 400 with { message }
    const invalidRes = await fetch(
      `http://127.0.0.1:${port}/api/users?bloodGroup=INVALID_GROUP`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    assert.equal(invalidRes.status, 400);
    const invalidBody = (await invalidRes.json()) as { message?: unknown };
    assert.equal(typeof invalidBody.message, "string");
  } finally {
    prisma.user.findMany = originalFindMany;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
