import { sunDay, type GeoPoint } from "./sunTimes";

/**
 * dayPhase.ts — the app's time of day as a CLOCK: whether it is day or night for the
 * learner right now, blended gradually across each sunrise and sunset and anchored to
 * their real sun (docs/DECK_TOWER.md § "Time of day").
 *
 * Layer: shared module (`src/timeOfDay/`). Pure. It says only WHEN; each consumer decides
 * what a phase looks like — the Deck Tower's sky and wash (features/deckTower/timeOfDay.ts),
 * the tier-2 look (tier2Look.ts) and the Add Cards page (features/discover/sortTimeOfDay.ts).
 * Moved out of features/deckTower/timeOfDay.ts on 2026-10-29 when the eip became the second
 * reader; the eip stopped reading it on 2026-11-05 (it follows the Settings theme now).
 *
 * ── The day's keyframes ────────────────────────────────────────────────────────
 * Around each sunrise and sunset (sunTimes.ts), TWILIGHT_MS either side:
 *
 *   night @ (rise − 30m) ──blend──▶ day @ (rise + 30m)
 *   day   @ (set − 30m)  ──blend──▶ night @ (set + 30m)
 *
 * So each twilight is one hour-long linear day ↔ night blend centred on the sun event.
 * Between two keyframes of the same phase the look holds. A day too short for any plain
 * day (high-latitude winter) blends straight up to day at its midday and back. A polar
 * day / night holds day / night all day.
 *
 * Dawn and sunset were their own phases (with pink / orange looks in every reader) until
 * 2026-11-04, when they were cut app-wide (docs/TOWER_WEATHER_SKY.md § 1): the night ↔ day
 * blend is now the only twilight.
 *
 * Depends on: sunTimes.ts. Depended on by: useDayClock.ts, wash.ts, tier2Look.ts,
 * features/deckTower/timeOfDay.ts, features/discover/sortTimeOfDay.ts.
 */

export type DayPhase = "day" | "night";

/** Every phase, in the order the day runs through them. */
export const DAY_PHASES: readonly DayPhase[] = ["day", "night"];

/** Half of each twilight: the day ↔ night blend runs this long either side of a sunrise / sunset. */
const TWILIGHT_MS = 30 * 60_000; // cut from 1 h on 2026-10-28
const DAY_MS = 86_400_000;

/** The time of day at one moment: `t` of the way from phase `from` to phase `to` (equal = holding). */
export interface TimeOfDay {
    from: DayPhase;
    to: DayPhase;
    t: number;
}

interface Keyframe {
    at: number;
    phase: DayPhase;
}

/** One solar day's keyframes (see the header), or its polar phase. */
function dayKeyframes(atMs: number, where: GeoPoint): Keyframe[] | DayPhase {
    const sun = sunDay(atMs, where);
    if (sun.polar) return sun.polar;
    // A day too short for both twilights to finish: they meet at midday.
    let dayStart = sun.rise + TWILIGHT_MS;
    let dayEnd = sun.set - TWILIGHT_MS;
    if (dayStart > dayEnd) dayStart = dayEnd = (sun.rise + sun.set) / 2;
    return [
        { at: sun.rise - TWILIGHT_MS, phase: "night" },
        { at: dayStart, phase: "day" },
        { at: dayEnd, phase: "day" },
        { at: sun.set + TWILIGHT_MS, phase: "night" },
    ];
}

/** The time of day at `nowMs` for a learner at `where`. Pure. */
export function timeOfDayAt(nowMs: number, where: GeoPoint): TimeOfDay {
    // Yesterday's, today's and tomorrow's keyframes, so `now` is always bracketed (a
    // night runs from one day's last keyframe to the next day's first).
    const days = [-1, 0, 1].map((d) => dayKeyframes(nowMs + d * DAY_MS, where));
    const frames = days.flatMap((d) => (typeof d === "string" ? [] : d)).sort((a, b) => a.at - b.at);
    for (let i = 0; i < frames.length - 1; i++) {
        const a = frames[i];
        const b = frames[i + 1];
        if (nowMs >= a.at && nowMs < b.at) {
            if (a.phase === b.phase) return { from: a.phase, to: a.phase, t: 0 };
            return { from: a.phase, to: b.phase, t: (nowMs - a.at) / (b.at - a.at) };
        }
    }
    // Not bracketed: a polar day or night (or the edge of one).
    const today = days[1];
    const phase: DayPhase = typeof today === "string" ? today : frames.length > 0 && nowMs < frames[0].at ? frames[0].phase : "night";
    return { from: phase, to: phase, t: 0 };
}

/** How much of `phase` is in the blend: 1 holding it, 1 − t leaving it, t entering it. */
export function phaseShare(time: TimeOfDay, phase: DayPhase): number {
    return (time.from === phase ? 1 - time.t : 0) + (time.to === phase ? time.t : 0);
}
