import { useCallback } from "react";
import type { Projector } from "./geometry";
import { planSidePath, prefersReducedMotion, rand, useAltitudeWander, useSkyTraffic, type AltitudeWander, type AltitudeWanderConfig, type Pt2, type SkyRegion, type SkySide } from "./skyTraffic";

/**
 * useWindGusts — schedules the wind gusts that sweep past a tall tower
 * (docs/ISO_ART_FRAMEWORK.md § "IsoWind").
 *
 * A gust is the cartoon "streak + curl": two or three dead-straight parallel strands (no
 * wave — straight runs keep the kit's faceted, polygon look), the main one ending in a
 * spiral curl. It lives in ONE vertical plane parallel to one of the four sides
 * of `sky.around` (the side comes from skyTraffic's `planSidePath`, so the front/behind
 * draw rule is the birds' and clouds'). Each strand is authored in that plane's local
 * coordinates — `s` along the gust's direction of travel, `h` straight up — so the curl
 * projects as an iso-correct ellipse on an invisible wall beside the tower, not as a flat
 * screen-space sticker.
 *
 * Unlike a bird or a cloud, a gust does not cross the whole screen. It appears mid-sky,
 * draws itself on head-first and erases tail-first (IsoWind), all on a short stretch of
 * the side path chosen to lie fully on screen. Its baseline height is read from one shared
 * wandering altitude (skyTraffic.ts → createAltitudeWander), so overlapping gusts blow at
 * close heights.
 *
 * Under prefers-reduced-motion there is no wind at all: a gust is nothing BUT motion, and
 * a frozen half-drawn streak would read as a glitch (the same call as the birds).
 *
 * Referenced by: docs/ISO_ART_FRAMEWORK.md § "IsoWind" + § "Sky traffic",
 * docs/DECK_TOWER.md § "The scene".
 */

/** A point in a gust's own vertical plane: `s` along its travel, `h` up (world units). */
export interface WindPt {
    s: number;
    h: number;
}

export interface WindStrand {
    /** The strand's polyline, in the gust's plane, from tail end to head end. */
    pts: WindPt[];
    /** When this strand starts drawing, after the gust mounts (the strands stagger). */
    delayMs: number;
    /** How long it takes to draw on and erase. */
    drawMs: number;
}

export interface WindGust {
    /** Unique per gust — the React key, so each gust mounts a fresh IsoWind. */
    id: number;
    /** World x/y of the gust plane's origin (s = 0) and the unit direction `s` runs in. */
    origin: Pt2;
    dir: Pt2;
    /** World height of the gust's baseline (h = 0). */
    z: number;
    /** How far the whole gust slides along `dir` over its life, world units. */
    drift: number;
    /** From mount to the last strand being fully erased (ms) — then it unmounts. */
    durationMs: number;
    side: SkySide;
    strands: WindStrand[];
}

/** The wind's sky: the band its baselines sit in, the tower, the screen to stay on. */
export type WindSky = SkyRegion;

/** How far out from the tower's side the gust plane runs, in world units. */
const GAP_MIN = 1;
const GAP_MAX = 3.5;
/** The main strand's straight run before the curl, world units. */
const STREAK_MIN = 6;
const STREAK_MAX = 9;
/** The curl: a spiral that starts at radius R and winds inward to CURL_INNER · R. */
const CURL_R_MIN = 0.7;
const CURL_R_MAX = 1;
const CURL_TURNS = 0.85;
const CURL_INNER = 0.55;
/** The extra strands: up/down offset from the main one, and their share of its length. */
const SIDE_STRANDS = [
    { h: -0.85, lengthFrac: 0.7, sOffset: -1.2 },
    { h: 0.8, lengthFrac: 0.5, sOffset: 0.6 },
];
/** Sampling step along the curl, world units. Small enough that it looks round. */
const STEP = 0.2;
/** Draw-on-and-erase time per strand, and the stagger between strands. */
const DRAW_MS_MIN = 1500;
const DRAW_MS_MAX = 2300;
const STAGGER_MS_MAX = 220;
/** How far the gust slides along its travel while it plays. */
const DRIFT_MIN = 1.2;
const DRIFT_MAX = 2.2;
/** Keep the gust this many world units inside each screen edge. */
const SCREEN_INSET = 1;
/** A slot's wait before its first gust (staggered per slot), and between gusts. */
const FIRST_WAIT_MS = { max: 600, perSlot: 900 };
const WAIT_MIN_MS = 1000;
const WAIT_MAX_MS = 4000;

/** The shared gust height. Gusts are short (~2 s), so it wanders faster than the clouds'. */
const ALTITUDE_WANDER: AltitudeWanderConfig = { knotMs: 4000, maxStep: 0.15 };

const firstWaitMs = (slot: number) => rand(0, FIRST_WAIT_MS.max) + slot * FIRST_WAIT_MS.perSlot;
const waitMs = () => rand(WAIT_MIN_MS, WAIT_MAX_MS);

/**
 * A straight run from s0 to s1 at height h0 — just its two ends. It projects to a straight
 * line at the grid's 2:1 slope, so it reads as an iso edge rather than a hand-drawn squiggle.
 */
function streak(s0: number, s1: number, h0: number): WindPt[] {
    return [
        { s: s0, h: h0 },
        { s: s1, h: h0 },
    ];
}

/**
 * The curl, continuing from the streak's last point: a spiral whose bottom is that point,
 * entered moving FORWARD (+s) — at angle −π/2 the circle's tangent is +s — then rising
 * up, back over itself, and winding inward.
 */
function curl(from: WindPt, radius: number): WindPt[] {
    const cs = from.s;
    const ch = from.h + radius;
    const sweep = CURL_TURNS * 2 * Math.PI;
    const n = Math.ceil((sweep * radius) / STEP);
    const pts: WindPt[] = [];
    for (let i = 1; i <= n; i++) {
        const u = i / n;
        const a = -Math.PI / 2 + sweep * u;
        const r = radius * (1 - (1 - CURL_INNER) * u);
        pts.push({ s: cs + r * Math.cos(a), h: ch + r * Math.sin(a) });
    }
    return pts;
}

function planGust(id: number, proj: Projector, sky: WindSky, altitude: AltitudeWander): WindGust {
    // The side path runs exactly across the screen span (margin −SCREEN_INSET keeps it inside).
    const path = planSidePath(proj, sky, rand(GAP_MIN, GAP_MAX), -SCREEN_INSET);
    const pathLength = Math.hypot(path.to.x - path.from.x, path.to.y - path.from.y);
    const dir = { x: (path.to.x - path.from.x) / pathLength, y: (path.to.y - path.from.y) / pathLength };

    const streakLength = rand(STREAK_MIN, STREAK_MAX);
    const radius = rand(CURL_R_MIN, CURL_R_MAX);
    const drift = rand(DRIFT_MIN, DRIFT_MAX);
    // The gust's whole along-path extent: the side strand that starts behind the main one,
    // through the curl's forward bulge, plus the drift.
    const back = Math.min(0, ...SIDE_STRANDS.map((st) => st.sOffset));
    const extent = streakLength + radius - back + drift;
    // Place it anywhere it fits on the path (a short path just centres it).
    const start = Math.max(0, pathLength - extent) * Math.random() - back;
    const origin = { x: path.from.x + dir.x * start, y: path.from.y + dir.y * start };

    const mainStreak = streak(0, streakLength, 0);
    const drawMs = rand(DRAW_MS_MIN, DRAW_MS_MAX);
    const strands: WindStrand[] = [
        { pts: [...mainStreak, ...curl(mainStreak[mainStreak.length - 1], radius)], delayMs: 0, drawMs },
        // A random one or two side strands — fewer and shorter than the main one, no curl.
        ...SIDE_STRANDS.slice(0, Math.random() < 0.5 ? 1 : 2).map((st) => ({
            pts: streak(st.sOffset, st.sOffset + streakLength * st.lengthFrac, st.h),
            delayMs: rand(60, STAGGER_MS_MAX),
            drawMs: drawMs * rand(0.8, 0.95),
        })),
    ];
    return {
        id,
        origin,
        dir,
        z: altitude.sample(sky.band),
        drift,
        durationMs: Math.max(...strands.map((st) => st.delayMs + st.drawMs)),
        side: path.side,
        strands,
    };
}

export function useWindGusts(opts: {
    proj: Projector;
    /** Gusts blow only while this is true. Turning it false clears the sky. */
    active: boolean;
    /** Expected to be memoized: a new object restarts every slot. */
    sky: WindSky;
    /** How many gusts may be playing at once (one slot each). */
    maxGusts?: number;
}): WindGust[] {
    const { proj, active, sky, maxGusts = 2 } = opts;
    const altitude = useAltitudeWander(ALTITUDE_WANDER);
    const plan = useCallback((id: number) => planGust(id, proj, sky, altitude), [proj, sky, altitude]);
    return useSkyTraffic({ active: active && !prefersReducedMotion(), slots: maxGusts, plan, firstWaitMs, waitMs });
}
