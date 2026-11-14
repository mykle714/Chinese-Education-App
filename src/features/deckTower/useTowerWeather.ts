import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../AuthContext";
import { fetchWeather, fetchWeatherShared, type WeatherNow } from "../../api/weather";
import { useWeatherEffectsEnabled } from "../../hooks/useWeatherEffectsSetting";
import { parseWeatherOverride, pinnedWeather, type WeatherOverride } from "./towerWeather";

/**
 * useTowerWeather — the weather the Deck Tower's sky draws right now
 * (docs/DECK_TOWER.md § "Weather").
 *
 * Layer: page logic (feature module `src/features/deckTower`).
 *
 *   - Off (null) unless the per-device "Weather effects" setting is on
 *     (useWeatherEffectsEnabled, src/hooks/useWeatherEffectsSetting.ts).
 *   - When on, fetches GET /api/weather on mount (sharing the app-level prefetch's request —
 *     useWeatherPrefetch, `fetchWeatherShared`), every `REFRESH_MS` while mounted, and
 *     when the tab comes back after being hidden longer than that. Anything but an `ok`
 *     answer draws no weather (the server already backs off a failing upstream).
 *   - The load effect keys on `user?.id`, never on `token` (CLAUDE.md § "Never
 *     reload/reset a page on a silent token refresh").
 *   - `settled`: false only while the setting is on and the FIRST answer (ok, not ok, or a
 *     network failure) has not come back — so a reader that must not act on "no weather
 *     yet" can wait (the aurora's clear-sky roll, towerAurora.ts). Off or pinned = settled.
 *   - Feature testers can pin one WMO look (WeatherToggle → towerWeather.ts `WEATHER_PINS`),
 *     stored per device like the time-of-day pin. `pinTaps` counts the tester's taps, so the
 *     page can show a tapped pin INSTANTLY (sky colour snaps, clouds fill mid-sky) while
 *     real weather keeps its slow fade-in. A pin shows even with the setting off, so a tester can preview
 *     every effect without granting location.
 *
 * Depends on: src/api/weather.ts (`fetchWeather`, `fetchWeatherShared`), src/hooks/useWeatherEffectsSetting.ts, towerWeather.ts.
 * Depended on by: DeckTowerPage.tsx (also towerAurora.ts via the page), discover/AddCardsPage.tsx (the observation only — acp draws no particles).
 */

/** How often a mounted tower re-asks (the server caches per cell for 30 min). */
const REFRESH_MS = 30 * 60_000;

const OVERRIDE_KEY = "deckTower.weatherOverride";

function readOverride(): WeatherOverride {
    try {
        return parseWeatherOverride(localStorage.getItem(OVERRIDE_KEY));
    } catch {
        return "auto";
    }
}

export function useTowerWeather(allowOverride: boolean): {
    weather: WeatherNow | null;
    settled: boolean;
    override: WeatherOverride;
    setOverride: (v: WeatherOverride) => void;
    /** Bumped on every tester pin tap (including Auto); 0 until the first. */
    pinTaps: number;
} {
    const { user } = useAuth();
    const userId = user?.id;
    const enabled = useWeatherEffectsEnabled();
    const [real, setReal] = useState<WeatherNow | null>(null);
    // Whether the current load cycle has had its first answer (see `settled` in the header).
    const [answered, setAnswered] = useState(false);
    const [override, setOverrideState] = useState<WeatherOverride>(readOverride);
    const [pinTaps, setPinTaps] = useState(0);

    // When the last fetch was made, read by the visibility listener without re-subscribing.
    const fetchedAt = useRef(0);

    useEffect(() => {
        if (!enabled || userId === undefined) {
            setReal(null);
            setAnswered(true);
            return;
        }
        setAnswered(false);
        let cancelled = false;
        // The FIRST read takes the shared request (fetchWeatherShared), which the app-level
        // prefetch (useWeatherPrefetch) has usually already started; refreshes ask afresh.
        let first = true;
        const load = () => {
            fetchedAt.current = Date.now();
            const request = first ? fetchWeatherShared(userId) : fetchWeather();
            first = false;
            request
                .then((res) => {
                    if (cancelled) return;
                    setReal(res.status === "ok" ? res.weather : null);
                    setAnswered(true);
                })
                .catch(() => {
                    // Network trouble: keep whatever was drawn; the next refresh retries.
                    // Still an answer: "unknown" must not hold readers waiting forever.
                    if (!cancelled) setAnswered(true);
                });
        };
        load();
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") load();
        }, REFRESH_MS);
        const onVisible = () => {
            if (document.visibilityState === "visible" && Date.now() - fetchedAt.current > REFRESH_MS) load();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [enabled, userId]);

    const setOverride = useCallback((v: WeatherOverride) => {
        try {
            if (v === "auto") localStorage.removeItem(OVERRIDE_KEY);
            else localStorage.setItem(OVERRIDE_KEY, v);
        } catch {
            // Storage unavailable — the pin just won't persist past this session.
        }
        setOverrideState(v);
        setPinTaps((n) => n + 1);
    }, []);

    const pinned = allowOverride && override !== "auto" ? pinnedWeather(override) : null;
    return { weather: pinned ?? real, settled: pinned !== null || answered, override, setOverride, pinTaps };
}
