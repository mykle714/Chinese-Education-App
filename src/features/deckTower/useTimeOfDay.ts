import { useCallback, useEffect, useMemo, useState } from "react";
import { deviceLocation } from "./sunTimes";
import { timeOfDayAt, towerLight, type DayPhase, type TimeOfDay, type TowerLight } from "./timeOfDay";

/**
 * useTimeOfDay — samples the Deck Tower's time of day on a clock and builds the light
 * the page paints with (docs/DECK_TOWER.md § "Time of day").
 *
 * Layer: page logic (feature module `src/features/deckTower`).
 *
 *   - Re-sampled every `SAMPLE_MS` (a minute) and whenever the page becomes visible
 *     again (an app brought back from the background hours later), so a learner who
 *     stays on the page through sunset watches the sky turn. A sample that lands on the
 *     same look (rounded `t`) keeps the old light's identity, so nothing re-renders.
 *   - The location is read once per mount (the device's timezone, sunTimes.ts).
 *   - OVERRIDE (feature testers only — `users.isFeatureTester`, migration 178): the
 *     page's TimeOfDayToggle pins one phase. Stored per device in localStorage, like the
 *     app's other tester switches; read only when `allowOverride`, so a stale key on a
 *     shared device never changes a learner's sky.
 *
 * Depends on: timeOfDay.ts, sunTimes.ts. Depended on by: DeckTowerPage.tsx.
 */

/** How often the clock is re-sampled. */
const SAMPLE_MS = 60_000;

/** `auto` follows the clock; a phase pins that look. */
export type TimeOfDayOverride = "auto" | DayPhase;

const OVERRIDE_KEY = "deckTower.timeOfDayOverride";
const PHASES: readonly DayPhase[] = ["dawn", "day", "sunset", "night"];

function readOverride(): TimeOfDayOverride {
    try {
        const v = localStorage.getItem(OVERRIDE_KEY);
        return v && (PHASES as readonly string[]).includes(v) ? (v as DayPhase) : "auto";
    } catch {
        return "auto";
    }
}

function writeOverride(v: TimeOfDayOverride): void {
    try {
        if (v === "auto") localStorage.removeItem(OVERRIDE_KEY);
        else localStorage.setItem(OVERRIDE_KEY, v);
    } catch {
        // Storage unavailable — the toggle just won't persist.
    }
}

/** Two samples this close in blend are the same look (1/200 of a twilight hour ≈ 18 s). */
const sameTime = (a: TimeOfDay, b: TimeOfDay) => a.from === b.from && a.to === b.to && Math.abs(a.t - b.t) < 0.005;

export function useTimeOfDay(allowOverride: boolean): {
    light: TowerLight;
    override: TimeOfDayOverride;
    setOverride: (v: TimeOfDayOverride) => void;
} {
    const where = useMemo(() => deviceLocation(), []);
    const [clock, setClock] = useState<TimeOfDay>(() => timeOfDayAt(Date.now(), where));
    const [stored, setStored] = useState<TimeOfDayOverride>(readOverride);
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

    const setOverride = useCallback((v: TimeOfDayOverride) => {
        writeOverride(v);
        setStored(v);
    }, []);

    // Keyed on the look's VALUES, so an override round-trip or an unchanged sample keeps
    // the light (and IsoScene's washed palette) by identity.
    const time: TimeOfDay = override === "auto" ? clock : { from: override, to: override, t: 0 };
    const light = useMemo(() => towerLight({ from: time.from, to: time.to, t: time.t }), [time.from, time.to, time.t]);
    return { light, override, setOverride };
}
