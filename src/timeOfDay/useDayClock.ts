import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { deviceLocation } from "./sunTimes";
import { DAY_PHASES, timeOfDayAt, type DayPhase, type TimeOfDay } from "./dayPhase";

/**
 * useDayClock — samples the learner's time of day on a clock (docs/DECK_TOWER.md
 * § "Time of day"). Returns the blend `{ from, to, t }`, never a look: the Deck Tower turns
 * it into a sky (useTimeOfDay), the eip into a tint (useEipPalette).
 *
 * Layer: shared hook (`src/timeOfDay/`). Moved out of features/deckTower/useTimeOfDay.ts
 * on 2026-10-29 when the eip became the second reader.
 *
 *   - Re-sampled every `SAMPLE_MS` (a minute) and whenever the page becomes visible
 *     again (an app brought back from the background hours later). A sample that lands on
 *     the same look (`sameTime`) keeps the old object's identity, so nothing re-renders.
 *   - The location is read once per mount (the device's timezone, sunTimes.ts).
 *   - OVERRIDE (feature testers only — `users.isFeatureTester`, migration 178): the Deck
 *     Tower's TimeOfDayToggle pins one phase. Stored per device in localStorage, like the
 *     app's other tester switches; honoured only when `allowOverride`, so a stale key on a
 *     shared device never changes a learner's sky. It is a module-level STORE, not hook
 *     state, so every reader agrees the moment the toggle is tapped — the tower and an eip
 *     open over it must never show two different hours.
 *
 * Depends on: dayPhase.ts, sunTimes.ts. Depended on by: features/deckTower/useTimeOfDay.ts,
 * useTier2Look.ts,
 * features/flashcards/FlashcardsLearnPage/useEipPalette.ts.
 */

/** How often the clock is re-sampled. */
const SAMPLE_MS = 60_000;

/** `auto` follows the clock; a phase pins that look. */
export type TimeOfDayOverride = "auto" | DayPhase;

// The storage key keeps its tower-era name so testers' pinned phases survive the move.
const OVERRIDE_KEY = "deckTower.timeOfDayOverride";

function readOverride(): TimeOfDayOverride {
    try {
        const v = localStorage.getItem(OVERRIDE_KEY);
        return v && (DAY_PHASES as readonly string[]).includes(v) ? (v as DayPhase) : "auto";
    } catch {
        return "auto";
    }
}

// ── The override store ─────────────────────────────────────────────────────────
// One value for the whole app, read through useSyncExternalStore.
let storedOverride: TimeOfDayOverride = readOverride();
const listeners = new Set<() => void>();

function subscribeOverride(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

const getOverride = () => storedOverride;

function writeOverride(v: TimeOfDayOverride): void {
    try {
        if (v === "auto") localStorage.removeItem(OVERRIDE_KEY);
        else localStorage.setItem(OVERRIDE_KEY, v);
    } catch {
        // Storage unavailable — the pin just won't persist past this session.
    }
    storedOverride = v;
    listeners.forEach((listener) => listener());
}

/** Two samples this close in blend are the same look (1/200 of a 30-minute twilight ≈ 9 s). */
const sameTime = (a: TimeOfDay, b: TimeOfDay) => a.from === b.from && a.to === b.to && Math.abs(a.t - b.t) < 0.005;

export function useDayClock(allowOverride: boolean): {
    time: TimeOfDay;
    override: TimeOfDayOverride;
    setOverride: (v: TimeOfDayOverride) => void;
} {
    const where = useMemo(() => deviceLocation(), []);
    const [clock, setClock] = useState<TimeOfDay>(() => timeOfDayAt(Date.now(), where));
    const stored = useSyncExternalStore(subscribeOverride, getOverride);
    const override: TimeOfDayOverride = allowOverride ? stored : "auto";

    useEffect(() => {
        const sample = () => {
            const next = timeOfDayAt(Date.now(), where);
            setClock((prev) => (sameTime(prev, next) ? prev : next));
        };
        const id = window.setInterval(sample, SAMPLE_MS);
        const onVisible = () => {
            if (document.visibilityState === "visible") sample();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            window.clearInterval(id);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [where]);

    const setOverride = useCallback((v: TimeOfDayOverride) => writeOverride(v), []);

    // Keyed on the look's VALUES, so an override round-trip or an unchanged sample keeps
    // the returned object by identity (consumers memoise their palettes on it).
    const from = override === "auto" ? clock.from : override;
    const to = override === "auto" ? clock.to : override;
    const t = override === "auto" ? clock.t : 0;
    const time = useMemo<TimeOfDay>(() => ({ from, to, t }), [from, to, t]);
    return { time, override, setOverride };
}
