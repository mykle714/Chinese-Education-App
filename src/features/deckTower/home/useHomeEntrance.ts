import { useCallback, useEffect, useRef, useState } from "react";
import { DASH_MOTION, prefersReducedMotion } from "../../../utils/pageTransition";
import { carriedOutPlan, outDistanceAt, type OutPlan } from "../useWorldPan";

/**
 * useHomeEntrance — the home screen's state, and the two camera moves between it and the Deck
 * Tower (docs/HOME_SCREEN.md § "Enter" and § "Back to home").
 *
 * GEOMETRY. The home stands ABOVE the tower: Enter takes the camera DOWN from the home to the
 * sky over the deck's top (and on down the tower to the platform); a pull past the top of the
 * deck takes it back UP to the home (owner, 2026-11-09).
 *
 * PHASES
 *   home     The home stage covers td: the tower is laid out (so it can be measured) but
 *            hidden, the header and footer are away.
 *   enter    The world shift DOWN to the tower — the world pan's dash turned vertical, on the
 *            same beats (`DASH_MOTION`, so it reads as the camera move the app already makes):
 *              out     (outMs)    the home stage slides UP off the top of the screen, ease-in;
 *              cruise  (cruiseMs) empty sky races past under vertical speed lines. Its first
 *                                 frame calls `onCruise("enter")`: the page jumps the scroller
 *                                 to the top of the tower while nothing is on screen and
 *                                 measures the sky's altitudes, which blend over the cruise
 *                                 (`altitudeT`);
 *              in      (inMs)     the sky over the tower's top rises in from below, ease-out.
 *   descend  An automatic scroll from the top of the tower down to the platform line: it eases
 *            in, cruises, and SLOWS A LITTLE at the end (a gentle power-2 settle over the last
 *            `SETTLE_PX`) — `descentTimeline`. The target is read every frame, so a refit
 *            mid-descent cannot leave it short.
 *   done     td as usual. `returnHome` (the pull past the deck's top — useHomePull) leaves it.
 *   return   The world shift UP to the home — `enter` mirrored: the tower slides DOWN off the
 *            bottom; the cruise (`onCruise("return")`: the page parks the scroller back on the
 *            platform line, the home's own state); the home comes down in from above.
 *            The pull that starts it CARRIES ON (`ShiftCarry`, the world pan's `PanCarry`
 *            idea): on iOS the release leaves the tower stretched down by the rubber band and
 *            still moving, so the out phase starts from that offset at that speed instead of
 *            the band snapping back and the slide restarting from rest.
 *
 * Under reduced motion both moves cut straight to their end.
 *
 * The page owns the scroller; this hook only drives it during the descent, marking each
 * frame through `onPlaced` so the page's `climb` bookkeeping ignores its own scrolls.
 *
 * Layer: feature page logic (src/features/deckTower/home). Depended on by DeckTowerPage.tsx.
 */

export type HomePhase = "home" | "enter" | "descend" | "done" | "return";
/** Which way a shift runs: down to the tower, or back up to the home. */
export type HomeShiftDirection = "enter" | "return";

/** One frame of a shift. Offsets are fractions of the stage height (+ = down the screen). */
export interface HomeShiftFrame {
    /** The home stage's offset: 0 on screen, −1 parked above the screen. */
    homeY: number;
    /** The tower's offset: 0 on screen, +1 parked below the screen. */
    towerY: number;
    /** The vertical speed lines' strength, 0 → 1 → 0. */
    speed: number;
    /** The sky's altitude blend over the cruise, 0 (where the shift left) → 1 (where it lands). */
    altitudeT: number;
}

/**
 * A gesture's motion handed to a shift so its out phase continues it (the pull home's
 * rubber band). Unsigned, in stage heights, along the leaving scene's own way off.
 */
export interface ShiftCarry {
    /** How far the leaving scene already is toward off screen (0–1). */
    shift: number;
    /** Its speed that way at release, stage heights per ms. */
    velocity: number;
}

const REST_FRAME: HomeShiftFrame = { homeY: 0, towerY: 1, speed: 0, altitudeT: 0 };
/** The uncarried out phase: the plain ease-in over `DASH_MOTION.outMs`. */
const FROM_REST = carriedOutPlan(0, 0);

/** A shift's total length for a given out phase. */
const shiftMs = (out: OutPlan) => out.ms + DASH_MOTION.cruiseMs + DASH_MOTION.inMs;

/** easeOutQuad / smoothstep — the world pan's own curves (useWorldPan). */
const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const smooth = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * A shift at `ms` into it. `enter`: the home leaves UP, the tower arrives from BELOW (the
 * camera goes down). `return`: the tower leaves DOWN, the home arrives from ABOVE (it goes up).
 * `out` is the out phase (`carriedOutPlan`; from rest unless a gesture carries into it).
 */
export function shiftFrameAt(ms: number, direction: HomeShiftDirection = "enter", out: OutPlan = FROM_REST): HomeShiftFrame {
    const { cruiseMs, inMs } = DASH_MOTION;
    const outMs = out.ms;
    // The leaving scene's travel (0 → 1) and the arriving one's remaining distance (1 → 0).
    let leave = 1;
    let arrive = 1;
    let speed = 1;
    let altitudeT = 0;
    if (ms < outMs) {
        const tau = Math.max(0, ms);
        leave = outDistanceAt(out, tau);
        // The streaks gather on the clock (linear from rest); a carried start, already part-way
        // off, brings them in at least as strong as the scene's travel.
        speed = Math.max(tau / outMs, leave - out.start);
    } else if (ms < outMs + cruiseMs) {
        altitudeT = smooth((ms - outMs) / cruiseMs);
    } else {
        const u = clamp01((ms - outMs - cruiseMs) / inMs);
        arrive = 1 - easeOut(u);
        speed = 1 - u;
        altitudeT = 1;
    }
    return direction === "enter"
        ? { homeY: -leave, towerY: arrive, speed, altitudeT }
        : { homeY: -arrive, towerY: leave, speed, altitudeT };
}

// ── The descent ────────────────────────────────────────────────────────────────
/** The cruising speed floor, px/ms. A taller climb cruises faster (`DESCENT_MAX_MS`). */
const DESCENT_SPEED = 1.5;
/** Roughly the longest a descent may take, ms — a very tall tower speeds the cruise up instead. */
const DESCENT_MAX_MS = 2200;
/** The ease-in at the top, px (power 2, so it reaches cruising speed with no lurch). */
const ACCEL_PX = 140;
/** The slow-down at the bottom, px, and its power: 2 = "slows down a little". */
const SETTLE_PX = 300;
const SETTLE_POWER = 2;

/**
 * Distance covered `ms` into a descent of `distance` px, and its length. Three pieces that
 * meet at the same speed: ease-in (power 2) → cruise → settle (power `SETTLE_POWER` ease-out).
 * Each piece's time is fixed by its distance and the cruising speed v — a power-p ease over
 * D px that starts or ends at v lasts p·D / v — so there is no speed jump at the seams.
 */
export function descentTimeline(distance: number): { durationMs: number; at: (ms: number) => number } {
    const d = Math.max(0, distance);
    const accel = Math.min(ACCEL_PX, d * 0.25);
    const settle = Math.min(SETTLE_PX, d * 0.5);
    const cruise = d - accel - settle;
    // The speed that would fit the whole move into DESCENT_MAX_MS (ease pieces cost 2× and p× their distance).
    const fit = (2 * accel + cruise + SETTLE_POWER * settle) / DESCENT_MAX_MS;
    const v = Math.max(DESCENT_SPEED, fit);
    const tA = (2 * accel) / v;
    const tC = cruise / v;
    const tS = (SETTLE_POWER * settle) / v;
    return {
        durationMs: tA + tC + tS,
        at: (ms) => {
            if (ms <= 0) return 0;
            if (ms < tA) return accel * (ms / tA) ** 2;
            if (ms < tA + tC) return accel + v * (ms - tA);
            const u = clamp01((ms - tA - tC) / (tS || 1));
            return accel + cruise + settle * (1 - (1 - u) ** SETTLE_POWER);
        },
    };
}

interface UseHomeEntranceArgs {
    /** Whether this mount opens on the home stage (homeLaunch.ts → `homeDueOnLaunch`). */
    shown: boolean;
    /** The page's scroller, driven during the descent. */
    scrollerRef: React.RefObject<HTMLDivElement | null>;
    /**
     * A shift's cruise has started (nothing on screen): `enter` — put the scroller at the
     * tower's top; `return` — park it back on the platform line, the home's own state.
     */
    onCruise: (direction: HomeShiftDirection) => void;
    /** The scrollTop the descent ends on (the platform line), read every frame. */
    descentTarget: () => number;
    /** A scrollTop the descent wrote — the page marks it as its own. */
    onPlaced: (top: number) => void;
    /** The Enter move is over: td is fully in charge. */
    onLanded: () => void;
    /** The return move is over: the home stage is up again. */
    onHome: () => void;
}

export interface HomeEntrance {
    phase: HomePhase;
    /** The current shift frame (REST until Enter; the last frame once past the shift). */
    frame: HomeShiftFrame;
    /** Start the Enter move. Ignored unless the home stage is up. */
    enter: () => void;
    /**
     * Go back up to the home. Ignored unless td is fully in charge (`done`). `carry` is the
     * pull's motion at release (the rubber band's stretch and speed), continued by the shift.
     */
    returnHome: (carry?: ShiftCarry) => void;
}

export function useHomeEntrance({ shown, scrollerRef, onCruise, descentTarget, onPlaced, onLanded, onHome }: UseHomeEntranceArgs): HomeEntrance {
    const [phase, setPhase] = useState<HomePhase>(shown ? "home" : "done");
    const [frame, setFrame] = useState<HomeShiftFrame>(REST_FRAME);
    // The callbacks close over the page's render; read the latest through a ref so the rAF
    // loop started on Enter never calls a stale one.
    const cb = useRef({ onCruise, descentTarget, onPlaced, onLanded, onHome });
    cb.current = { onCruise, descentTarget, onPlaced, onLanded, onHome };
    const raf = useRef(0);
    useEffect(() => () => cancelAnimationFrame(raf.current), []);

    const land = useCallback(() => {
        setPhase("done");
        cb.current.onLanded();
    }, []);

    const descend = useCallback(() => {
        const el = scrollerRef.current;
        if (!el) return land();
        setPhase("descend");
        const from = el.scrollTop;
        const plan = descentTimeline(cb.current.descentTarget() - from);
        const start = performance.now();
        const tick = (now: number) => {
            const ms = now - start;
            const to = cb.current.descentTarget();
            // Scaled onto the live target: a refit that moves the platform line mid-way is
            // absorbed proportionally rather than overshot.
            const planned = plan.durationMs > 0 ? plan.at(ms) / Math.max(1, plan.at(plan.durationMs)) : 1;
            el.scrollTop = from + (to - from) * Math.min(1, planned);
            cb.current.onPlaced(el.scrollTop);
            if (ms < plan.durationMs) raf.current = requestAnimationFrame(tick);
            else land();
        };
        raf.current = requestAnimationFrame(tick);
    }, [scrollerRef, land]);

    /** Plays one shift, then `after`. */
    const playShift = useCallback((direction: HomeShiftDirection, after: () => void, carry?: ShiftCarry) => {
        const out = carry ? carriedOutPlan(carry.shift, carry.velocity) : FROM_REST;
        const total = shiftMs(out);
        // The shift's first frame commits WITH its phase. `frame` still holds the rest pose
        // (Enter's start: tower parked below, home on screen), which for a return is the
        // wrong end — rendering it for even one frame flashed the home in and the tower out
        // before the slide began.
        setFrame(shiftFrameAt(0, direction, out));
        setPhase(direction);
        // The clock starts on the first animation frame, after that commit has landed: the
        // commit mounts the home stage (a return) or reveals the tower (Enter), which can take
        // a frame or two on a phone, and a clock already running would skip the slide ahead.
        let start = -1;
        let cruising = false;
        const tick = (now: number) => {
            if (start < 0) start = now;
            const ms = now - start;
            if (!cruising && ms >= out.ms) {
                cruising = true;
                cb.current.onCruise(direction);
            }
            setFrame(shiftFrameAt(ms, direction, out));
            if (ms < total) raf.current = requestAnimationFrame(tick);
            else after();
        };
        raf.current = requestAnimationFrame(tick);
    }, []);

    const atHome = useCallback(() => {
        setFrame(REST_FRAME);
        setPhase("home");
        cb.current.onHome();
    }, []);

    const enter = useCallback(() => {
        if (phase !== "home") return;
        if (prefersReducedMotion()) return land();
        playShift("enter", descend);
    }, [phase, land, descend, playShift]);

    const returnHome = useCallback((carry?: ShiftCarry) => {
        if (phase !== "done") return;
        if (prefersReducedMotion()) {
            cb.current.onCruise("return");
            return atHome();
        }
        playShift("return", atHome, carry);
    }, [phase, playShift, atHome]);

    return { phase, frame, enter, returnHome };
}
