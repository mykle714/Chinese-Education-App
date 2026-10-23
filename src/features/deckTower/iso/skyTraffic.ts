import { useEffect, useState } from "react";
import type { Projector, WorldRect } from "./geometry";

/**
 * skyTraffic.ts — what the scene's flying things share: the isometric path along one side
 * of a tower, and the slot scheduler that keeps 0..N of them crossing the sky
 * (docs/ISO_ART_FRAMEWORK.md § "Sky traffic").
 *
 * Clouds and wind cross the sky the same way and differ only in what crosses, how fast,
 * and how often.
 *
 * Depended on by: useCloudDrifts.ts, useWindGusts.ts.
 */

export type Pt2 = { x: number; y: number };

/**
 * Which side of the tower a path runs along, and so where its traveller is drawn: after
 * the tower on its two FRONT sides (+x / +y, the walls a viewer sees), before it on the
 * two back ones, so the tower hides it as it passes. Fixed for the whole crossing: where
 * a back-side path runs out past the tower's corner, the traveller is BESIDE the tower on
 * screen, not over it, so the order cannot be wrong there.
 */
export type SkySide = "front" | "behind";

/** The flying region: a z band, the footprint to fly beside, and the screen to cross. */
export interface SkyRegion {
    /** World-z range the paths' heights are picked from. */
    band: { zMin: number; zMax: number };
    /** The footprint the paths run along the sides of. */
    around: WorldRect;
    /** The scene's screen-x extent (viewBox units) that each path must fully cross. */
    screenSpan: { minX: number; maxX: number };
}

export interface SidePath {
    /** World x/y of the traveller's ORIGIN at the start and end. Both lie off screen. */
    from: Pt2;
    to: Pt2;
    side: SkySide;
    /** True when the path runs along world x (the origin's y is fixed), else along y. */
    alongX: boolean;
}

export const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * A random straight path parallel to one of `region.around`'s four sides, `gap` world
 * units out from it, long enough to run from `margin` world units past one edge of
 * `region.screenSpan` to `margin` past the other — so the traveller enters and leaves
 * the screen rather than popping in mid-sky. On screen it crosses diagonally at the
 * grid's 2:1 slope.
 *
 * `depth` is the traveller's extent ACROSS the path, from its origin toward +x/+y (0 for
 * a flat traveller like a gust, the footprint's short side for a cloud). The origin is pushed out by it on the
 * back sides, so the whole footprint stays `gap` clear of the tower on every side — which
 * is what keeps the front/behind draw order correct.
 */
export function planSidePath(proj: Projector, region: SkyRegion, gap: number, margin: number, depth = 0): SidePath {
    const { around: r, screenSpan } = region;
    const u = proj.unit;
    // The four sides: two run along world x (fixed y), two along world y (fixed x).
    //   y = r.y + r.d (+gap)  the front-LEFT wall (faces +y)   → front
    //   x = r.x + r.w (+gap)  the front-RIGHT wall (faces +x)  → front
    //   y = r.y (−gap)        the back-right wall              → behind
    //   x = r.x (−gap)        the back-left wall               → behind
    const sideIndex = Math.floor(Math.random() * 4);
    const alongX = sideIndex === 0 || sideIndex === 2;
    const side: SkySide = sideIndex < 2 ? "front" : "behind";
    const fixed =
        sideIndex === 0 ? r.y + r.d + gap
        : sideIndex === 1 ? r.x + r.w + gap
        : sideIndex === 2 ? r.y - gap - depth
        : r.x - gap - depth;

    // Solve the moving coordinate for the screen span (sx = (x − y)·unit):
    //   along x at y = c:  x = sx/u + c       (x grows with sx)
    //   along y at x = c:  y = c − sx/u       (y shrinks as sx grows)
    const lo = screenSpan.minX / u - margin;
    const hi = screenSpan.maxX / u + margin;
    const a = alongX ? { x: lo + fixed, y: fixed } : { x: fixed, y: fixed - lo };
    const b = alongX ? { x: hi + fixed, y: fixed } : { x: fixed, y: fixed - hi };
    const [from, to] = Math.random() < 0.5 ? [a, b] : [b, a];
    return { from, to, side, alongX };
}

/** How an altitude wander moves: a new waypoint every `knotMs`, at most `maxStep` of the band from the last. */
export interface AltitudeWanderConfig {
    knotMs: number;
    /** Largest change between consecutive waypoints, as a fraction (0–1) of the band. */
    maxStep: number;
}

/** Waypoints older than this many knots are not replayed one by one; the wander restarts. */
const WANDER_MAX_CATCH_UP_KNOTS = 64;

/**
 * One slowly-wandering altitude that every spawn of a traveller type reads its height
 * from, instead of each picking its own `rand(zMin, zMax)`. Travellers that spawn close
 * together in time get close heights, so two of them that are up at once never sit at
 * very different altitudes in the same patch of screen. In an isometric view that
 * reads as a depth ambiguity (is that cloud higher, or just nearer?).
 * Over a few knots the wander still covers the whole band.
 *
 * It is a bounded random walk on 0–1, stepping by up to `maxStep` every `knotMs` (it
 * reflects off 0 and 1), cosine-eased between waypoints so it has no corners. It runs
 * on wall-clock time: it keeps moving while nothing is spawning, and `sample(band)`
 * just reads where it is now. The position is a FRACTION of the band, so a band that
 * changes (the tower settling lower) rescales it rather than leaving it outside.
 */
export function createAltitudeWander({ knotMs, maxStep }: AltitudeWanderConfig) {
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    /** The next waypoint: up to ±maxStep from `from`, reflected back into 0–1. */
    const stepFrom = (from: number) => {
        const next = from + rand(-maxStep, maxStep);
        return next < 0 ? -next : next > 1 ? 2 - next : next;
    };
    let prev = Math.random();
    let next = stepFrom(prev);
    let knotStart = now();

    return {
        /** The wander's current height inside `band` (world z). */
        sample(band: { zMin: number; zMax: number }): number {
            const t = now();
            const knotsBehind = Math.floor((t - knotStart) / knotMs);
            if (knotsBehind > WANDER_MAX_CATCH_UP_KNOTS) {
                // Long idle (tab hidden, band inactive): a fresh start is as good as a replay.
                prev = Math.random();
                next = stepFrom(prev);
                knotStart = t;
            } else {
                for (let k = 0; k < knotsBehind; k++) {
                    prev = next;
                    next = stepFrom(prev);
                    knotStart += knotMs;
                }
            }
            const u = (t - knotStart) / knotMs;
            const eased = (1 - Math.cos(Math.PI * u)) / 2;
            const fraction = prev + (next - prev) * eased;
            return band.zMin + fraction * Math.max(0, band.zMax - band.zMin);
        },
    };
}

export type AltitudeWander = ReturnType<typeof createAltitudeWander>;

/**
 * One altitude wander per hook instance, stable across renders (so it is safe in a
 * `plan` callback's deps). `config` is read once, so pass a module constant.
 */
export function useAltitudeWander(config: AltitudeWanderConfig): AltitudeWander {
    return useState(() => createAltitudeWander(config))[0];
}

/** True under the OS "reduce motion" setting. Read once per render; not live-updating. */
export function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Keeps `slots` independent travellers looping wait → cross → wait on their own
 * timeouts, so the sky holds 0..slots of them at irregular intervals. A slot's first
 * crossing waits `firstWaitMs(slot)` (stagger by slot), later ones `waitMs()`.
 * `plan(id, first)` builds one crossing; `first` is true for each slot's opening one
 * (a caller may start those partway across, see useCloudDrifts).
 *
 * React state changes only when a crossing starts or ends. Per-frame motion is the
 * object's own rAF loop. Turning `active` false clears the sky.
 *
 * ⚠️ `plan`, `firstWaitMs` and `waitMs` are effect dependencies — memoize them
 * (useCallback / module constants), or every render restarts every slot.
 */
export function useSkyTraffic<T extends { id: number; durationMs: number }>(opts: {
    active: boolean;
    slots: number;
    plan: (id: number, first: boolean) => T;
    firstWaitMs: (slot: number) => number;
    waitMs: () => number;
}): T[] {
    const { active, slots, plan, firstWaitMs, waitMs } = opts;
    const [travellers, setTravellers] = useState<T[]>([]);

    useEffect(() => {
        if (!active) return;
        // Every pending timeout, so the cleanup can cancel all of them — a slot always has
        // exactly one pending (its next spawn, or the end of its current crossing).
        const timers = new Set<ReturnType<typeof setTimeout>>();
        const after = (ms: number, fn: () => void) => {
            const t = setTimeout(() => {
                timers.delete(t);
                fn();
            }, ms);
            timers.add(t);
        };
        let nextId = 1;

        const cross = (first: boolean) => {
            const traveller = plan(nextId++, first);
            setTravellers((list) => [...list, traveller]);
            after(traveller.durationMs, () => {
                setTravellers((list) => list.filter((other) => other.id !== traveller.id));
                after(waitMs(), () => cross(false));
            });
        };
        for (let slot = 0; slot < slots; slot++) after(firstWaitMs(slot), () => cross(true));
        return () => {
            timers.forEach(clearTimeout);
            setTravellers([]);
        };
    }, [active, slots, plan, firstWaitMs, waitMs]);

    return travellers;
}
