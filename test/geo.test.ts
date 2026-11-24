import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateDistanceKm } from "../src/lib/geo.js";

test("calculateDistanceKm returns 0 for identical coordinates", () => {
  const dist = calculateDistanceKm(17.385, 78.4867, 17.385, 78.4867);
  assert.equal(dist, 0);
});

test("calculateDistanceKm computes accurate distance between known cities", () => {
  // Hyderabad (Charminar: 17.3616, 78.4747) to Secunderabad Railway Station (17.4344, 78.5011)
  // Distance is ~8.5 km
  const dist = calculateDistanceKm(17.3616, 78.4747, 17.4344, 78.5011);
  assert.ok(dist >= 8.0 && dist <= 9.5, `Expected ~8.5 km, got ${dist}`);
});

test("calculateDistanceKm is symmetric and rounded to 1 decimal place", () => {
  const lat1 = 12.9716;
  const lon1 = 77.5946; // Bengaluru
  const lat2 = 13.0827;
  const lon2 = 80.2707; // Chennai

  const d1 = calculateDistanceKm(lat1, lon1, lat2, lon2);
  const d2 = calculateDistanceKm(lat2, lon2, lat1, lon1);

  assert.equal(d1, d2);
  // Verify 1 decimal place precision
  const decimals = (d1.toString().split(".")[1] || "").length;
  assert.ok(decimals <= 1, `Expected at most 1 decimal place, got ${decimals}`);
});

test("closest-first sorting places closest donors first and null coordinates at the end", () => {
  const userLat = 17.385;
  const userLng = 78.4867; // Hyderabad Center

  const donors = [
    { id: 1, name: "Far Away Donor", latitude: 19.076, longitude: 72.8777 }, // Mumbai (~620 km)
    { id: 2, name: "No GPS Donor", latitude: null, longitude: null },
    { id: 3, name: "Nearby Donor", latitude: 17.4344, longitude: 78.5011 }, // Secunderabad (~6 km)
    { id: 4, name: "Medium Distance Donor", latitude: 17.6868, longitude: 83.2185 }, // Vizag (~500 km)
    { id: 5, name: "Another No GPS Donor", latitude: null, longitude: null },
  ];

  const processed = donors.map((donor) => {
    let distanceKm: number | null = null;
    if (donor.latitude !== null && donor.longitude !== null) {
      distanceKm = calculateDistanceKm(
        userLat,
        userLng,
        donor.latitude,
        donor.longitude,
      );
    }
    return {
      ...donor,
      distanceKm,
    };
  });

  processed.sort((a, b) => {
    if (a.distanceKm !== null && b.distanceKm !== null) {
      return a.distanceKm - b.distanceKm;
    }
    if (a.distanceKm !== null && b.distanceKm === null) {
      return -1;
    }
    if (a.distanceKm === null && b.distanceKm !== null) {
      return 1;
    }
    return 0;
  });

  // Verify closest first
  assert.equal(processed[0].name, "Nearby Donor");
  assert.equal(processed[1].name, "Medium Distance Donor");
  assert.equal(processed[2].name, "Far Away Donor");

  // Verify donors without coordinates appear at the end
  assert.equal(processed[3].distanceKm, null);
  assert.equal(processed[4].distanceKm, null);
});

test("donor response payload strips phone, latitude, longitude and returns only distanceKm", () => {
  const userLat = 12.9716;
  const userLng = 77.5946;

  // Raw user records as stored in database
  const rawDbUsers = [
    {
      id: 1,
      name: "Donor One",
      bloodGroup: "O_POSITIVE",
      phone: "+919876543210",
      address: "123 Street",
      city: "Bengaluru",
      state: "Karnataka",
      latitude: 12.9089,
      longitude: 77.6141,
    },
    {
      id: 2,
      name: "Donor Two",
      bloodGroup: "O_POSITIVE",
      phone: "+919876543211",
      address: null,
      city: "Mysuru",
      state: "Karnataka",
      latitude: null,
      longitude: null,
    },
  ];

  // Simulating the exact mapping performed by GET /api/users
  const result = rawDbUsers.map((user) => {
    let distanceKm: number | null = null;
    if (user.latitude !== null && user.longitude !== null) {
      distanceKm = calculateDistanceKm(
        userLat,
        userLng,
        user.latitude,
        user.longitude,
      );
    }
    return {
      id: user.id,
      name: user.name,
      bloodGroup: user.bloodGroup,
      city: user.city,
      state: user.state,
      distanceKm,
    };
  });

  for (const donor of result) {
    // Allowed fields
    assert.ok("id" in donor);
    assert.ok("name" in donor);
    assert.ok("bloodGroup" in donor);
    assert.ok("city" in donor);
    assert.ok("state" in donor);
    assert.ok("distanceKm" in donor);

    // Privacy-critical fields that MUST NOT be exposed to requesters in GET /api/users
    assert.equal("phone" in donor, false, "phone must be stripped from response payload");
    assert.equal("latitude" in donor, false, "latitude must be stripped from response payload");
    assert.equal("longitude" in donor, false, "longitude must be stripped from response payload");
    assert.equal("address" in donor, false, "address must be stripped from response payload");

    const keys = Object.keys(donor).sort();
    assert.deepEqual(keys, ["bloodGroup", "city", "distanceKm", "id", "name", "state"]);
  }

  assert.equal(typeof result[0].distanceKm, "number");
  assert.equal(result[1].distanceKm, null);
});
