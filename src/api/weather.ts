/**
 * weather.ts — the client's typed call against GET /api/weather
 * (docs/DECK_TOWER.md § "Weather").
 *
 * The server reads the caller's stored `users."geoCell"` and answers from a per-cell
 * cache, so this takes no location: the client never needs (or sends) one here. The
 * cell is WRITTEN by `shareArenaLocation` (src/api/arena.ts).
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 this takes no `token`: it goes through
 * src/api/http.ts, which resolves the Authorization header at call time.
 */
import { apiGet } from './http';
import type { WeatherResponse } from '../../server/contracts/wire';

export type { WeatherKind, WeatherNow, WeatherResponse } from '../../server/contracts/wire';

/** GET /api/weather — the weather at the caller's stored location cell. */
export function fetchWeather(): Promise<WeatherResponse> {
    return apiGet<WeatherResponse>('/api/weather');
}
