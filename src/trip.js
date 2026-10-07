// Pure trip logic: geography, trip totals, share links and labels. No DOM and no Three.js.

const RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance between two { lat, lon } points, in kilometres. */
export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Totals for an ordered list of stops: suggested days, km between stops in order, and a rough budget. */
export function tripStats(stops) {
  let km = 0;
  for (let i = 1; i < stops.length; i++) km += distanceKm(stops[i - 1], stops[i]);
  return {
    stops: stops.length,
    days: stops.reduce((sum, stop) => sum + stop.days, 0),
    km: Math.round(km),
    budget: stops.reduce((sum, stop) => sum + stop.days * stop.perDay, 0),
  };
}

/** "#trip=goa,kyoto" → ["goa", "kyoto"], keeping only known ids, each once. */
export function parseTrip(hash, knownIds) {
  const match = /(?:^#|&)trip=([^&]*)/.exec(hash ?? "");
  if (!match) return [];
  const known = new Set(knownIds);
  return [...new Set(decodeURIComponent(match[1]).split(","))].filter((id) => known.has(id));
}

export const tripHash = (ids) => (ids.length ? `#trip=${ids.join(",")}` : "");

/** Swap a stop with its neighbour; returns a new array. */
export function moveStop(ids, id, step) {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Best months as readable ranges that may wrap the new year: [11, 12, 1, 2] → "Nov – Feb". */
export function monthRanges(months) {
  const on = Array.from({ length: 12 }, (_, i) => months.includes(i + 1));
  if (on.every(Boolean)) return "All year";
  const ranges = [];
  for (let i = 0; i < 12; i++) {
    if (!on[i] || on[(i + 11) % 12]) continue; // only start where the month before is off
    let end = i;
    while (on[(end + 1) % 12]) end = (end + 1) % 12;
    ranges.push(end === i ? MONTHS[i] : `${MONTHS[i]} – ${MONTHS[end]}`);
  }
  return ranges.join(", ");
}

export const isGoodNow = (destination, month) => destination.best.includes(month);

/** A point on the unit sphere for a latitude and longitude, with north up and longitude 0 facing +z. */
export function toVector(lat, lon, radius = 1) {
  const phi = toRad(lat);
  const lambda = toRad(lon);
  return [radius * Math.cos(phi) * Math.sin(lambda), radius * Math.sin(phi), radius * Math.cos(phi) * Math.cos(lambda)];
}

/** Unpack the base64 int16 pairs from land-dots.js into [lat, lon, lat, lon, …] degrees. */
export function decodeDots(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const values = new Int16Array(bytes.buffer);
  return Float32Array.from(values, (value) => value / 100);
}

export const formatRupees = (value) => `₹${Math.round(value).toLocaleString("en-IN")}`;

const WEATHER = [
  [[0], "Clear"],
  [[1, 2], "Partly cloudy"],
  [[3], "Overcast"],
  [[45, 48], "Fog"],
  [[51, 53, 55, 56, 57], "Drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "Rain"],
  [[71, 73, 75, 77, 85, 86], "Snow"],
  [[95, 96, 99], "Thunderstorm"],
];

/** WMO weather code from Open-Meteo to a short label. */
export const weatherLabel = (code) => WEATHER.find(([codes]) => codes.includes(code))?.[1] ?? "Unknown";
