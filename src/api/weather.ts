/**
 * weather.ts — the client's typed call against GET /api/weather
 * (docs/DECK_TOWER.md § "Weather").
 *
 * The server reads the caller's stored `users."geoCell"` and answers from a per-cell
 * cache, so this takes no location: the client never needs (or sends) one here. The
 * cell is WRITTEN by `shareArenaLocation` (src/api/arena.ts).
 *
 * Depended on by: features/deckTower/useTowerWeather.ts, hooks/useWeatherPrefetch.ts
 * (`fetchWeatherShared`), hooks/useWeatherEffectsSetting.ts (`fetchWeather`).
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

/**
 * A fetch shared by every caller within SHARE_MS: the app-level prefetch (useWeatherPrefetch,
 * started as soon as the user is known, while td's code-split chunk is still downloading)
 * and td's own first read (useTowerWeather) get the SAME request, so td's launch screen waits
 * on a request that is already under way (docs/LAUNCH_SCREEN.md § "Weather prefetch").
 *
 * Keyed by the user id, so a sign-in as someone else never reuses the last account's answer.
 * A failed request is dropped from the share at once, so the next caller retries.
 */
const SHARE_MS = 60_000;
let shared: { userId: string; at: number; promise: Promise<WeatherResponse> } | null = null;

export function fetchWeatherShared(userId: string): Promise<WeatherResponse> {
    const now = Date.now();
    if (shared && shared.userId === userId && now - shared.at < SHARE_MS) return shared.promise;
    const promise = fetchWeather();
    const entry = { userId, at: now, promise };
    shared = entry;
    promise.catch(() => {
        if (shared === entry) shared = null;
    });
    return promise;
}
