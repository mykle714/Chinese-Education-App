import type { WeatherNow, WeatherResponse } from '../contracts/wire.js';
import { geohashCenter } from '../utils/geohashCenter.js';

/**
 * WeatherService — the current weather at a user's stored location cell, for the
 * Deck Tower's sky (docs/DECK_TOWER.md § "Weather"). Purely aesthetic.
 *
 * LAYER: service. It owns the policy (which cell, how long a reading is good for, how a
 * WMO code folds into a WeatherKind); the location comes from the DAL
 * (`ArenaDAL.getGeoCell`, through the narrow `GeoCellLookup` shape) and the
 * observation from Open-Meteo. No SQL here.
 *
 * ── Why a server proxy rather than the browser calling Open-Meteo ─────────────
 *   - PRIVACY: the third party never sees the learner's IP address, and the client never
 *     needs to read its own cell back. Open-Meteo only ever sees the CENTRE of a ~5 km
 *     cell, from our server.
 *   - COST: readings are cached PER CELL, so every learner in one neighbourhood shares
 *     one upstream call per `FRESH_MS`.
 *
 * ── Cache ───────────────────────────────────────────────────────────────────
 * In-process and bounded (`MAX_CELLS`, oldest-inserted evicted first). A restart simply
 * refetches. Concurrent misses on one cell share one in-flight request. A failed
 * upstream call is cached as `unavailable` for `RETRY_MS`, so an Open-Meteo outage is
 * not hammered by every tower mount.
 *
 * Depends on: server/utils/geohashCenter.ts, server/contracts/wire.ts (WeatherKind).
 * Depended on by: server/controllers/WeatherController.ts (wired in dal/setup.ts).
 */

/** The one DAL read this service needs (ArenaDAL satisfies it). */
export interface GeoCellLookup {
  getGeoCell(userId: string): Promise<string | null>;
}

/** The fetch this service calls — injectable for tests. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** How long one cell's reading is served before it is refetched. Open-Meteo's "current" block updates every 15 min. */
const FRESH_MS = 30 * 60_000;
/** How long a failed upstream call is remembered before the next attempt. */
const RETRY_MS = 5 * 60_000;
/** Upstream call budget — the tower draws nothing until it answers, so don't wait long. */
const UPSTREAM_TIMEOUT_MS = 5_000;
/** Cap on cached cells; oldest-inserted is evicted first (a Map iterates in insertion order). */
const MAX_CELLS = 5_000;

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

type Cached = { at: number; ttl: number; value: Exclude<WeatherResponse, { status: 'no-location' }> };

/**
 * Fold an Open-Meteo WMO weather code (and the cloud-cover percentage, used for the
 * partly-cloudy band) into what the tower draws. Unknown codes read as clear — a
 * missing effect is harmless, a wrong one is not.
 *
 * WMO table: https://open-meteo.com/en/docs → "WMO Weather interpretation codes".
 */
export function weatherFromWmoCode(code: number, cloudCoverPct: number | null): WeatherNow {
  const cloudCover = cloudCoverPct === null ? null : Math.min(1, Math.max(0, cloudCoverPct / 100));
  return { ...foldWmoCode(code, cloudCover ?? 0), wmoCode: code, cloudCover };
}

/** The kind + intensity half of `weatherFromWmoCode`. */
function foldWmoCode(code: number, cloud: number): Pick<WeatherNow, 'kind' | 'intensity'> {
  switch (code) {
    case 0:
    case 1: return { kind: 'clear', intensity: 0 };              // clear / mainly clear
    case 2: return { kind: 'cloudy', intensity: Math.max(0.35, cloud * 0.7) }; // partly cloudy
    case 3: return { kind: 'cloudy', intensity: 1 };             // overcast
    case 45:
    case 48: return { kind: 'fog', intensity: 1 };               // fog / rime fog
    case 51: case 56: return { kind: 'drizzle', intensity: 0.3 };
    case 53: return { kind: 'drizzle', intensity: 0.55 };
    case 55: case 57: return { kind: 'drizzle', intensity: 0.8 };
    case 61: case 80: return { kind: 'rain', intensity: 0.35 };  // slight rain / showers
    case 63: case 66: case 81: return { kind: 'rain', intensity: 0.65 };
    case 65: case 67: case 82: return { kind: 'rain', intensity: 1 };
    case 77: return { kind: 'snow', intensity: 0.3 };            // snow grains
    case 71: case 85: return { kind: 'snow', intensity: 0.35 };
    case 73: return { kind: 'snow', intensity: 0.65 };
    case 75: case 86: return { kind: 'snow', intensity: 1 };
    case 95: return { kind: 'storm', intensity: 0.8 };
    case 96:
    case 99: return { kind: 'storm', intensity: 1 };             // thunderstorm with hail
    default: return { kind: 'clear', intensity: 0 };
  }
}

export class WeatherService {
  private readonly cache = new Map<string, Cached>();
  private readonly inFlight = new Map<string, Promise<Cached['value']>>();

  constructor(
    private readonly geoCells: GeoCellLookup,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {}

  /** GET /api/weather for one user. Never throws for upstream trouble — that is `unavailable`. */
  async weatherFor(userId: string): Promise<WeatherResponse> {
    const cell = await this.geoCells.getGeoCell(userId);
    if (!cell) return { status: 'no-location' };
    return this.weatherForCell(cell);
  }

  private async weatherForCell(cell: string): Promise<Cached['value']> {
    const hit = this.cache.get(cell);
    if (hit && this.now() - hit.at < hit.ttl) return hit.value;

    // Coalesce concurrent misses on one cell into one upstream request.
    const pending = this.inFlight.get(cell);
    if (pending) return pending;

    const request = this.fetchCell(cell).finally(() => this.inFlight.delete(cell));
    this.inFlight.set(cell, request);
    return request;
  }

  private async fetchCell(cell: string): Promise<Cached['value']> {
    const center = geohashCenter(cell);
    let value: Cached['value'] = { status: 'unavailable' };
    if (center) {
      try {
        const params = new URLSearchParams({
          latitude: center.lat.toFixed(3),
          longitude: center.lon.toFixed(3),
          current: 'weather_code,cloud_cover',
        });
        const res = await this.fetchFn(`${OPEN_METEO_URL}?${params}`, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
        if (res.ok) {
          const body = (await res.json()) as { current?: { weather_code?: unknown; cloud_cover?: unknown } } | null;
          const code = body?.current?.weather_code;
          const cloud = body?.current?.cloud_cover;
          if (typeof code === 'number') {
            value = { status: 'ok', weather: weatherFromWmoCode(code, typeof cloud === 'number' ? cloud : null) };
          }
        } else {
          console.warn(`[WeatherService] Open-Meteo responded ${res.status} for cell ${cell}`);
        }
      } catch (error) {
        console.warn(`[WeatherService] Open-Meteo request failed for cell ${cell}:`, error instanceof Error ? error.message : error);
      }
    }
    this.remember(cell, value);
    return value;
  }

  private remember(cell: string, value: Cached['value']): void {
    // Re-insert so a refreshed cell moves to the back of the eviction order.
    this.cache.delete(cell);
    this.cache.set(cell, { at: this.now(), ttl: value.status === 'ok' ? FRESH_MS : RETRY_MS, value });
    while (this.cache.size > MAX_CELLS) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
