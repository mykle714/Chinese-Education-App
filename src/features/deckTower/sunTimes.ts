import { TZ_COORDINATES } from "./tzCoordinates";

/**
 * sunTimes.ts — where the learner loosely is, and when the sun rises and sets there, for
 * the Deck Tower's time of day (docs/DECK_TOWER.md § "Time of day").
 *
 * Layer: page logic (feature module `src/features/deckTower`). Pure apart from
 * `deviceLocation` reading the device's timezone. No network, no location permission.
 *
 *   - LOCATION comes from the device's IANA timezone (`Intl`), looked up in the bundled
 *     TZ_COORDINATES table (the zone's principal city). A zone missing from the table
 *     falls back to its UTC offset: longitude = offset × 15°, latitude `FALLBACK_LATITUDE`.
 *   - SUNRISE / SUNSET use the NOAA "sunrise equation" (good to a minute or two, plenty
 *     for a sky colour): the solar transit for the day, the sun's declination, and the
 *     hour angle at which its centre sits 0.833° below the horizon (refraction + radius).
 *
 * Depends on: tzCoordinates.ts (generated). Depended on by: timeOfDay.ts.
 */

export interface GeoPoint {
    /** Degrees, north positive. */
    lat: number;
    /** Degrees, east positive. */
    lon: number;
}

/** A timezone not in the table: assume a mid-northern latitude (most of the world's people). */
const FALLBACK_LATITUDE = 35;

/** The learner's rough position: their timezone's principal city (see the header). */
export function deviceLocation(now: Date = new Date()): GeoPoint {
    let zone: string | undefined;
    try {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        zone = undefined;
    }
    const at = zone ? TZ_COORDINATES[zone] : undefined;
    if (at) return { lat: at[0], lon: at[1] };
    // getTimezoneOffset is minutes BEHIND UTC (UTC−5 → +300), so east = −offset.
    return { lat: FALLBACK_LATITUDE, lon: (-now.getTimezoneOffset() / 60) * 15 };
}

/**
 * One day's sun. `rise` / `set` are epoch ms; a day with no sunrise (polar summer or
 * winter) has neither and says which it is in `polar`.
 */
export type SunDay = { rise: number; set: number; polar?: undefined } | { rise?: undefined; set?: undefined; polar: "day" | "night" };

const DAY_MS = 86_400_000;
/** Julian date of the Unix epoch, and of J2000.0. */
const JD_UNIX_EPOCH = 2440587.5;
const J2000 = 2451545.0;
const RAD = Math.PI / 180;
/** Earth's axial tilt, degrees. */
const OBLIQUITY = 23.4397;
/** The sun's centre this far below the horizon counts as rising/setting (refraction + radius). */
const HORIZON_DEG = -0.833;

/**
 * The sunrise and sunset of the solar day nearest `atMs` at `where` (NOAA sunrise
 * equation). "Nearest" = the day whose solar noon is closest, so calling it at local
 * midnight, noon or 23:00 all return that local date's sun.
 */
export function sunDay(atMs: number, where: GeoPoint): SunDay {
    const jd = atMs / DAY_MS + JD_UNIX_EPOCH;
    // The day number since J2000 whose mean solar noon at this longitude is nearest.
    const n = Math.round(jd - J2000 - 0.0008 + where.lon / 360);
    const meanNoon = n + 0.0008 - where.lon / 360;
    const anomaly = (357.5291 + 0.98560028 * meanNoon) % 360;
    const m = anomaly * RAD;
    const centre = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m);
    const eclipticLon = ((anomaly + centre + 180 + 102.9372) % 360) * RAD;
    const transit = J2000 + meanNoon + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * eclipticLon);
    const sinDecl = Math.sin(eclipticLon) * Math.sin(OBLIQUITY * RAD);
    const cosDecl = Math.cos(Math.asin(sinDecl));
    const phi = where.lat * RAD;
    const cosHour = (Math.sin(HORIZON_DEG * RAD) - Math.sin(phi) * sinDecl) / (Math.cos(phi) * cosDecl);
    // Never below the horizon line → polar day; never above it → polar night.
    if (cosHour < -1) return { polar: "day" };
    if (cosHour > 1) return { polar: "night" };
    const halfDay = Math.acos(cosHour) / (2 * Math.PI); // fraction of a day, noon → set
    const toMs = (j: number) => (j - JD_UNIX_EPOCH) * DAY_MS;
    return { rise: toMs(transit - halfDay), set: toMs(transit + halfDay) };
}
