import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../AuthContext";
import { fetchWeather, type WeatherNow } from "../../api/weather";
import { WEATHER_KINDS } from "../../../server/contracts/wire";
import { useWeatherEffectsEnabled } from "../../hooks/useWeatherEffectsSetting";
import { pinnedWeather, type WeatherOverride } from "./towerWeather";

/**
 * useTowerWeather — the weather the Deck Tower's sky draws right now
 * (docs/DECK_TOWER.md § "Weather").
 *
 * Layer: page logic (feature module `src/features/deckTower`).
 *
 *   - Off (null) unless the per-device "Weather effects" setting is on
 *     (useWeatherEffectsEnabled, src/hooks/useWeatherEffectsSetting.ts).
 *   - When on, fetches GET /api/weather on mount, every `REFRESH_MS` while mounted, and
 *     when the tab comes back after being hidden longer than that. Anything but an `ok`
 *     answer draws no weather (the server already backs off a failing upstream).
 *   - The load effect keys on `user?.id`, never on `token` (CLAUDE.md § "Never
 *     reload/reset a page on a silent token refresh").
 *   - Feature testers can pin a kind (WeatherToggle), stored per device like the
 *     time-of-day pin. A pin shows even with the setting off, so a tester can preview
 *     every effect without granting location.
 *
 * Depends on: src/api/weather.ts, src/hooks/useWeatherEffectsSetting.ts, towerWeather.ts.
 * Depended on by: DeckTowerPage.tsx, discover/AddCardsPage.tsx (the observation only — acp draws no particles).
 */

/** How often a mounted tower re-asks (the server caches per cell for 30 min). */
const REFRESH_MS = 30 * 60_000;

const OVERRIDE_KEY = "deckTower.weatherOverride";

function readOverride(): WeatherOverride {
    try {
        const v = localStorage.getItem(OVERRIDE_KEY);
        return v && (WEATHER_KINDS as readonly string[]).includes(v) ? (v as WeatherOverride) : "auto";
    } catch {
        return "auto";
    }
}

export function useTowerWeather(allowOverride: boolean): {
    weather: WeatherNow | null;
    override: WeatherOverride;
    setOverride: (v: WeatherOverride) => void;
} {
    const { user } = useAuth();
    const userId = user?.id;
    const enabled = useWeatherEffectsEnabled();
    const [real, setReal] = useState<WeatherNow | null>(null);
    const [override, setOverrideState] = useState<WeatherOverride>(readOverride);

    // When the last fetch was made, read by the visibility listener without re-subscribing.
    const fetchedAt = useRef(0);

    useEffect(() => {
        if (!enabled || userId === undefined) {
            setReal(null);
            return;
        }
        let cancelled = false;
        const load = () => {
            fetchedAt.current = Date.now();
            fetchWeather()
                .then((res) => {
                    if (!cancelled) setReal(res.status === "ok" ? res.weather : null);
                })
                .catch(() => {
                    // Network trouble: keep whatever was drawn; the next refresh retries.
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
    }, []);

    const pinned = allowOverride && override !== "auto" ? pinnedWeather(override) : null;
    return { weather: pinned ?? real, override, setOverride };
}
