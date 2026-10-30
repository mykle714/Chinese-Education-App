import { sunDay, type GeoPoint } from "./sunTimes";

/**
 * dayPhase.ts — the app's time of day as a CLOCK: which of dawn / day / sunset / night it
 * is for the learner right now, blended gradually across each sunrise and sunset and
 * anchored to their real sun (docs/DECK_TOWER.md § "Time of day").
 *
 * Layer: shared module (`src/timeOfDay/`). Pure. It says only WHEN; each consumer decides
 * what a phase looks like — the Deck Tower's sky and wash (features/deckTower/timeOfDay.ts)
 * and the eip's tint (features/flashcards/FlashcardsLearnPage/eipPalette.ts). Moved out of
 * features/deckTower/timeOfDay.ts on 2026-10-29 when the eip became the second reader.
 *
 * ── The day's keyframes ────────────────────────────────────────────────────────
 * Around each sunrise and sunset (sunTimes.ts), TWILIGHT_MS either side:
 *
 *   night ──(rise − 30m)──▶ dawn @ rise ──(rise + 30m)──▶ day
 *   day   ──(set − 30m)───▶ sunset @ set ──(set + 30m)──▶ night
 *
 * Between two keyframes of different phases the look blends linearly; between two of the
 * same phase it holds. A day too short for any plain day (high-latitude winter)
 * meets dawn and sunset at its midday. A polar day / night holds day / night all day.
 *
 * Depends on: sunTimes.ts. Depended on by: useDayClock.ts, features/deckTower/timeOfDay.ts,
 * features/flashcards/FlashcardsLearnPage/eipPalette.ts.
 */

export type DayPhase = "dawn" | "day" | "sunset" | "night";

/** Every phase, in the order the day runs through them. */
export const DAY_PHASES: readonly DayPhase[] = ["dawn", "day", "sunset", "night"];

/** How long each side of a sunrise / sunset the sky takes to change. */
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
    let dayStart = sun.rise + TWILIGHT_MS;
    let dayEnd = sun.set - TWILIGHT_MS;
    if (dayStart > dayEnd) dayStart = dayEnd = (sun.rise + sun.set) / 2;
    return [
        { at: sun.rise - TWILIGHT_MS, phase: "night" },
        { at: sun.rise, phase: "dawn" },
        { at: dayStart, phase: "day" },
        { at: dayEnd, phase: "day" },
        { at: sun.set, phase: "sunset" },
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
