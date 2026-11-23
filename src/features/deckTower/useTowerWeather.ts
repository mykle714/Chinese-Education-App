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
 *   - The last real answer outlives the page (`lastAnswer`, module scope): td unmounts
 *     whenever the learner switches tabs, and a remount that started from "no weather"
 *     drew a clear sky and then FADED to the cloudy one when the refetch landed. A remount
 *     for the same user now starts from the remembered weather (and `settled`), and the
 *     refetch only changes the sky if the weather actually changed.
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

/**
 * The last real (unpinned) answer, kept across mounts so a remounted td draws the weather it
 * last knew instead of starting clear (see the header). Keyed by user so a sign-in as someone
 * else never inherits the previous account's sky. `weather` null = the last answer was "no
 * weather" (not ok / no location), which is still an answer.
 */
let lastAnswer: { userId: string; weather: WeatherNow | null } | null = null;

/** The remembered answer for this user, or undefined when there is none to start from. */
function rememberedFor(userId: string | undefined, enabled: boolean): { weather: WeatherNow | null } | undefined {
    if (!enabled || userId === undefined || lastAnswer === null || lastAnswer.userId !== userId) return undefined;
    return lastAnswer;
}

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
    // Seeded from the remembered answer so a remount does not flash clear (see the header).
    const [real, setReal] = useState<WeatherNow | null>(() => rememberedFor(userId, enabled)?.weather ?? null);
    // Whether the current load cycle has had its first answer (see `settled` in the header).
    // A remembered answer counts: the launch cover / aurora need not wait on the refetch.
    const [answered, setAnswered] = useState(() => rememberedFor(userId, enabled) !== undefined);
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
        // Start this cycle from the remembered answer when there is one for this user (a
        // remount, or the setting turned back on); otherwise wait for the first answer.
        const remembered = rememberedFor(userId, enabled);
        setReal(remembered?.weather ?? null);
        setAnswered(remembered !== undefined);
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
                    const next = res.status === "ok" ? res.weather : null;
                    // Remember even when this mount has gone: the next td mount starts from it.
                    lastAnswer = { userId, weather: next };
                    if (cancelled) return;
                    setReal(next);
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
