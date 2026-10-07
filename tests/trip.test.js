import { test } from "node:test";
import assert from "node:assert/strict";
import { DESTINATIONS } from "../src/data.js";
import { LAND_DOTS } from "../src/land-dots.js";
import {
  decodeDots,
  distanceKm,
  formatRupees,
  isGoodNow,
  monthRanges,
  moveStop,
  parseTrip,
  toVector,
  tripHash,
  tripStats,
  weatherLabel,
} from "../src/trip.js";

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

test("distanceKm matches known great-circle distances", () => {
  const delhi = { lat: 28.61, lon: 77.21 };
  const mumbai = { lat: 19.08, lon: 72.88 };
  const london = { lat: 51.51, lon: -0.13 };
  assert.ok(near(distanceKm(delhi, mumbai), 1150, 15));
  assert.ok(near(distanceKm(delhi, london), 6720, 40));
  assert.equal(distanceKm(delhi, delhi), 0);
});

test("tripStats adds days, distance in order and a rough budget", () => {
  const a = { lat: 0, lon: 0, days: 2, perDay: 1000 };
  const b = { lat: 0, lon: 90, days: 3, perDay: 2000 };
  const stats = tripStats([a, b]);
  assert.equal(stats.stops, 2);
  assert.equal(stats.days, 5);
  assert.ok(near(stats.km, 10008, 2), "a quarter of the equator");
  assert.equal(stats.budget, 2 * 1000 + 3 * 2000);
  assert.deepEqual(tripStats([]), { stops: 0, days: 0, km: 0, budget: 0 });
});

test("share links round-trip and ignore unknown or repeated ids", () => {
  const ids = ["goa", "kyoto", "bali"];
  assert.equal(tripHash(ids), "#trip=goa,kyoto,bali");
  assert.deepEqual(parseTrip("#trip=goa,kyoto,bali", ids), ids);
  assert.deepEqual(parseTrip("#trip=goa,atlantis,goa", ids), ["goa"]);
  assert.deepEqual(parseTrip("", ids), []);
  assert.equal(tripHash([]), "");
});

test("moveStop swaps neighbours and stops at the ends", () => {
  assert.deepEqual(moveStop(["a", "b", "c"], "c", -1), ["a", "c", "b"]);
  const ids = ["a", "b"];
  assert.equal(moveStop(ids, "a", -1), ids);
});

test("monthRanges reads naturally, including across new year", () => {
  assert.equal(monthRanges([11, 12, 1, 2]), "Nov – Feb");
  assert.equal(monthRanges([3, 4, 5, 10, 11]), "Mar – May, Oct – Nov");
  assert.equal(monthRanges([7]), "Jul");
  assert.equal(monthRanges([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), "All year");
});

test("isGoodNow checks the best months", () => {
  assert.equal(isGoodNow({ best: [11, 12, 1] }, 12), true);
  assert.equal(isGoodNow({ best: [11, 12, 1] }, 6), false);
});

test("toVector puts the equator at y = 0 and longitude 90 on the right", () => {
  const [x, y, z] = toVector(0, 90);
  assert.ok(near(x, 1, 1e-9) && near(y, 0, 1e-9) && near(z, 0, 1e-9));
  assert.ok(near(toVector(90, 0)[1], 1, 1e-9));
});

test("land dots decode to valid coordinates", () => {
  const dots = decodeDots(LAND_DOTS);
  assert.equal(dots.length % 2, 0);
  assert.ok(dots.length / 2 > 5000);
  for (let i = 0; i < dots.length; i += 2) {
    assert.ok(dots[i] >= -90 && dots[i] <= 90);
    assert.ok(dots[i + 1] >= -180 && dots[i + 1] <= 180);
  }
});

test("every destination has sound data", () => {
  const ids = new Set();
  for (const d of DESTINATIONS) {
    assert.ok(!ids.has(d.id), `duplicate id ${d.id}`);
    ids.add(d.id);
    assert.ok(Math.abs(d.lat) <= 90 && Math.abs(d.lon) <= 180, d.id);
    assert.ok(d.best.every((m) => m >= 1 && m <= 12), d.id);
    assert.ok(d.days > 0 && d.perDay > 0, d.id);
  }
});

test("labels and money", () => {
  assert.equal(weatherLabel(0), "Clear");
  assert.equal(weatherLabel(63), "Rain");
  assert.equal(weatherLabel(42), "Unknown");
  assert.equal(formatRupees(123456.4), "₹1,23,456");
});
