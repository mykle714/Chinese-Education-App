/**
 * Geohash encoding — client-side only (docs/ARENA_FEATURE.md § 5.2).
 *
 * ── Why this runs on the device and not the server ───────────────────────────
 * The privacy argument for Arena's location feature rests on a single claim:
 * COORDINATES NEVER LEAVE THE DEVICE. The browser hands us a lat/long, we
 * truncate it to a 5-character cell here, and only those 5 characters are
 * transmitted or stored. Geohashing is bit-interleaving with no lookup table, so
 * there was never a reason to ship coordinates anywhere — which is why the
 * client-versus-server question (old Q4b) has no server-side branch left.
 *
 * A 5-character cell is a tile of roughly 5 km x 5 km. It is an IDENTIFIER, not
 * a position: 'gcpvj' cannot locate a home or a workplace, it names a
 * neighbourhood. If the column ever leaked, the most it could say is "somewhere
 * in west London".
 *
 * ── Why a geohash rather than a country or a coordinate pair ─────────────────
 * A geohash is a SPACE-FILLING CURVE: interleaving latitude and longitude bits
 * means strings sharing a prefix are neighbours on the ground. That makes the
 * stored format double as the clustering sort key, so the server's entire
 * clustering algorithm is one ORDER BY (§ 5.1) with no distance maths anywhere.
 *
 * Country was rejected: it is not a proximity measure. It puts Vancouver with
 * Halifax and separates Detroit from Windsor.
 */

/**
 * The geohash alphabet — base32, deliberately excluding a, i, l and o so a
 * transcribed cell cannot be confused with 1 or 0.
 */
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Cell length we store. Must match ARENA_GEOCELL_LENGTH on the server. */
export const GEOCELL_LENGTH = 5;

/**
 * Encode a coordinate to a geohash of `precision` characters.
 *
 * Standard interleave: alternate between halving the longitude range and the
 * latitude range, emitting one bit each time, and flush a base32 character every
 * five bits.
 */
export function encodeGeohash(
  latitude: number,
  longitude: number,
  precision = GEOCELL_LENGTH,
): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('encodeGeohash: latitude and longitude must be finite numbers');
  }
  if (latitude < -90 || latitude > 90) {
    throw new Error('encodeGeohash: latitude out of range');
  }
  if (longitude < -180 || longitude > 180) {
    throw new Error('encodeGeohash: longitude out of range');
  }

  let latRange = [-90, 90];
  let lonRange = [-180, 180];
  let isLongitudeTurn = true;
  let bit = 0;
  let charIndex = 0;
  let hash = '';

  while (hash.length < precision) {
    if (isLongitudeTurn) {
      const mid = (lonRange[0] + lonRange[1]) / 2;
      if (longitude >= mid) {
        charIndex = (charIndex << 1) + 1;
        lonRange = [mid, lonRange[1]];
      } else {
        charIndex = charIndex << 1;
        lonRange = [lonRange[0], mid];
      }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2;
      if (latitude >= mid) {
        charIndex = (charIndex << 1) + 1;
        latRange = [mid, latRange[1]];
      } else {
        charIndex = charIndex << 1;
        latRange = [latRange[0], mid];
      }
    }

    isLongitudeTurn = !isLongitudeTurn;
    bit++;

    if (bit === 5) {
      hash += BASE32[charIndex];
      bit = 0;
      charIndex = 0;
    }
  }

  return hash;
}

/**
 * The cell we actually transmit: exactly GEOCELL_LENGTH characters.
 *
 * A separate named function rather than a default parameter, because this is the
 * privacy contract and it should be impossible to call the "send this" path with
 * a different precision by accident.
 */
export function toGeoCell(latitude: number, longitude: number): string {
  return encodeGeohash(latitude, longitude, GEOCELL_LENGTH);
}

/** Does a string look like a stored cell? Mirrors the server's CHECK constraint. */
export function isValidGeoCell(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === GEOCELL_LENGTH &&
    [...value].every((ch) => BASE32.includes(ch))
  );
}
