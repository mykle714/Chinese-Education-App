import { useCallback, useState, useSyncExternalStore } from 'react';
import { fetchWeather } from '../api/weather';
import { shareArenaLocation } from '../api/arena';

/**
 * useWeatherEffectsSetting — the per-device "Weather effects" switch in Settings →
 * Display, and the flow that turns it on (docs/DECK_TOWER.md § "Weather" → "The setting").
 *
 * Layer: shared hook (`src/hooks/`) — written by pages/settings/SettingsBody.tsx, read by
 * features/deckTower/useTowerWeather.ts, so it cannot live under either feature.
 *
 * ── Storage ───────────────────────────────────────────────────────────────────
 * Per DEVICE in localStorage (owner's choice 2026-11-04), like "Color pinyin by tone":
 * how much animation a device should draw is a property of the device. One app-wide
 * value behind useSyncExternalStore, so the tower picks up a flip made in Settings
 * without a reload. DEFAULT OFF: switching it on is the consent moment for location.
 *
 * ── Turning it on ─────────────────────────────────────────────────────────────
 *   1. Ask GET /api/weather. Anything but `no-location` means a cell is already stored
 *      (e.g. from the Arena) → switch on.
 *   2. `no-location` → ask the browser for location through `shareArenaLocation`, which
 *      truncates to a ~5 km cell ON THE DEVICE and stores it in the same
 *      `users."geoCell"` the Arena uses. Granted → switch on. Declined → stay off.
 * Switching OFF only hides the effects. It deliberately does NOT clear the cell: the
 * Arena's grouping still uses it, and the Arena page owns that off switch.
 *
 * The browser is asked at most ONCE per session (`locationAskedThisSession`), the same
 * rule ArenaPage keeps: a repeated permission sheet is the fastest route to a permanent
 * browser-level block.
 *
 * Depends on: src/api/weather.ts, src/api/arena.ts (`shareArenaLocation`).
 * Depended on by: pages/settings/SettingsBody.tsx, features/deckTower/useTowerWeather.ts.
 */

const STORAGE_KEY = 'deckTower.weatherEffects';

function readStored(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

// ── The store ────────────────────────────────────────────────────────────────
let stored = readStored();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

const getSnapshot = () => stored;

function write(on: boolean): void {
    try {
        if (on) localStorage.setItem(STORAGE_KEY, '1');
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Storage unavailable — the switch just won't persist past this session.
    }
    stored = on;
    listeners.forEach((listener) => listener());
}

/** Module-level, so remounting Settings cannot re-prompt within one session. */
let locationAskedThisSession = false;

/** Why turning the switch on did not stick (shown under the row). */
export type WeatherEnableError = 'location-declined' | 'failed';

/** Read-only view for surfaces that draw weather (the Deck Tower). */
export function useWeatherEffectsEnabled(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** The Settings row: the switch's value, a busy flag, the last error, and the setter. */
export function useWeatherEffectsSetting(): {
    enabled: boolean;
    busy: boolean;
    error: WeatherEnableError | null;
    setEnabled: (on: boolean) => Promise<void>;
} {
    const enabled = useWeatherEffectsEnabled();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<WeatherEnableError | null>(null);

    const setEnabled = useCallback(async (on: boolean) => {
        setError(null);
        if (!on) {
            write(false);
            return;
        }
        setBusy(true);
        try {
            const res = await fetchWeather();
            if (res.status !== 'no-location') {
                write(true);
                return;
            }
            if (locationAskedThisSession) {
                setError('location-declined');
                return;
            }
            locationAskedThisSession = true;
            const cell = await shareArenaLocation();
            if (cell) write(true);
            else setError('location-declined');
        } catch {
            // Network trouble, or /api/arena/location not mounted (arena flag off).
            setError('failed');
        } finally {
            setBusy(false);
        }
    }, []);

    return { enabled, busy, error, setEnabled };
}
