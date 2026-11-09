import { useCallback, useEffect, useRef, useState } from "react";
import { LASTING_IDLES, type PawnIdleCue, type PawnIdleKind, type PawnStretchCue } from "../../../deckTower/iso";

/**
 * useHintPawnIdles — when the flp's hint pawn plays an idle animation, and which
 * (docs/HINT_PAWN.md § "Idle animations").
 *
 * ── The minute ───────────────────────────────────────────────────────────────
 * One idle a minute: IDLE_EVERY_MS after the pawn lands, then after every idle, and from
 * the learner's last TAP on the pawn (owner, 2026-11-08: only pawn taps reset it; studying
 * cards does not). While the pawn is not `running` (unseen behind a game break or the count
 * card, leaving, parked) there is no timer, and the minute starts over when it is back.
 *
 * ── Which ────────────────────────────────────────────────────────────────────
 * One of HINT_PAWN_IDLES at random, never the same twice in a row (`pickHintPawnIdle`).
 * The stretch is the pawn's existing back stretch, so it goes out as a stretch cue
 * (`idleStretch`, merged with the speech bubbles' by HintPawn); the rest are IsoPawn
 * `idle` cues (pawnIdles.ts).
 *
 * ── States ───────────────────────────────────────────────────────────────────
 * Doze and knit are LASTING: the pawn stays in them, and no further idle is scheduled,
 * until a tap on the pawn (`noteTap`) or a new line of dialogue (`wakeKey` changes — a new
 * speech bubble, which also stretches) withdraws the cue (owner, 2026-11-08). A new arrival
 * (`resetKey`) clears everything, so a pawn that was parked asleep lands awake.
 *
 * Layer: flp page presentation hook (client). Depended on by: hintPawn/HintPawn.tsx;
 * src/__tests__/hintPawnIdles.test.ts (`pickHintPawnIdle`).
 */

/** One idle per this long (see the header's "The minute"). */
export const IDLE_EVERY_MS = 60_000;

/** What the hint pawn may do when idle: the back stretch, or one of IsoPawn's idles. */
export type HintPawnIdle = PawnIdleKind | "stretch";
export const HINT_PAWN_IDLES: readonly HintPawnIdle[] = ["stretch", "sneeze", "sing", "doze", "knit"];

/** A random idle, never `last` (when there is another to pick). `random` is injectable for tests. */
export function pickHintPawnIdle(last: HintPawnIdle | null, random: () => number = Math.random): HintPawnIdle {
    const pool = HINT_PAWN_IDLES.filter((k) => k !== last);
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

const isLasting = (cue: PawnIdleCue | null) => cue !== null && LASTING_IDLES.has(cue.kind);

export function useHintPawnIdles({
    running,
    startAt,
    wakeKey,
    resetKey,
}: {
    /** The pawn is on screen and free to idle (landed or landing, seen, not leaving). */
    running: boolean;
    /** When the first minute starts counting (`performance.now()` time — the landing). */
    startAt: number;
    /** Changes with each new line of dialogue: wakes a dozing / knitting pawn. */
    wakeKey: string | null;
    /** Changes with each arrival: clears every cue. */
    resetKey: number | null;
}): { idle: PawnIdleCue | null; idleStretch: PawnStretchCue | null; noteTap: () => void } {
    const [idle, setIdle] = useState<PawnIdleCue | null>(null);
    const [idleStretch, setIdleStretch] = useState<PawnStretchCue | null>(null);
    // Bumped to start the minute over (a tap, or a stretch — which leaves `idle` unchanged).
    const [minuteStart, setMinuteStart] = useState(0);
    const lastIdle = useRef<HintPawnIdle | null>(null);
    const idleIds = useRef(0);
    const inState = isLasting(idle);

    // A new arrival lands awake, with nothing queued.
    useEffect(() => {
        setIdle(null);
        setIdleStretch(null);
    }, [resetKey]);

    // A new line of dialogue wakes it (see the header's "States").
    useEffect(() => {
        if (wakeKey !== null) setIdle((cue) => (isLasting(cue) ? null : cue));
    }, [wakeKey]);

    // The minute. Re-armed by every change it depends on: an idle starting (or a state
    // ending), a tap, the pawn coming back on screen. Nothing while in a lasting state.
    useEffect(() => {
        if (!running || inState) return;
        const delay = Math.max(0, startAt - performance.now()) + IDLE_EVERY_MS;
        const timer = setTimeout(() => {
            const kind = pickHintPawnIdle(lastIdle.current);
            lastIdle.current = kind;
            idleIds.current += 1;
            const at = performance.now();
            if (kind === "stretch") {
                setIdleStretch({ id: `idle-${idleIds.current}`, at });
                setMinuteStart((n) => n + 1);
            } else {
                setIdle({ id: idleIds.current, kind, at });
            }
        }, delay);
        return () => clearTimeout(timer);
    }, [running, inState, startAt, idle, minuteStart]);

    // A tap on the pawn: the minute starts over, and a doze / knit ends.
    const noteTap = useCallback(() => {
        setMinuteStart((n) => n + 1);
        setIdle((cue) => (isLasting(cue) ? null : cue));
    }, []);

    return { idle, idleStretch, noteTap };
}
