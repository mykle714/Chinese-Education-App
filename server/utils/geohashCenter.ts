/**
 * geohashCenter — the centre point of a geohash cell.
 *
 * Layer: server utility (pure, no I/O).
 *
 * The client ENCODES (src/utils/geohash.ts → `encodeGeohash`, truncated to
 * ARENA_GEOCELL_LENGTH before it leaves the device); the server only ever needs the
 * inverse — the middle of the stored ~5 km cell — to ask a weather provider about it
 * (WeatherService). The two halves are separate files because the server cannot
 * import from `src/`; they share nothing but the base32 alphabet below, which is
 * the geohash standard and cannot drift.
 *
 * Depended on by: server/services/WeatherService.ts.
 * Docs: docs/DECK_TOWER.md § "Weather".
 */

/** Standard geohash base32 — no a, i, l or o. Same alphabet as src/utils/geohash.ts. */
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Decode a geohash to its cell's centre, or null for a malformed hash.
 *
 * Standard de-interleave: each character carries five bits, alternating between
 * halving the longitude range (first) and the latitude range. The centre of the
 * final ranges is the answer.
 */
export function geohashCenter(hash: string): { lat: number; lon: number } | null {
  if (!hash) return null;
  let latRange: [number, number] = [-90, 90];
  let lonRange: [number, number] = [-180, 180];
  let isLongitudeTurn = true;

  for (const ch of hash.toLowerCase()) {
    const value = BASE32.indexOf(ch);
    if (value < 0) return null;
    for (let bit = 4; bit >= 0; bit--) {
      const on = (value >> bit) & 1;
      const range = isLongitudeTurn ? lonRange : latRange;
      const mid = (range[0] + range[1]) / 2;
      if (on) range[0] = mid;
      else range[1] = mid;
      isLongitudeTurn = !isLongitudeTurn;
    }
  }

  return { lat: (latRange[0] + latRange[1]) / 2, lon: (lonRange[0] + lonRange[1]) / 2 };
}
