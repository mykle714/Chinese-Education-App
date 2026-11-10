import React, { useEffect, useMemo, useRef } from "react";
import type { Projector, WorldRect } from "./geometry";
import { PAWN_BODY_RADIUS } from "./pawnFigure";
import { useIsoProjector } from "./sceneContext";
import { capSnowTrail, type SnowTrail, type TrailPoint } from "./snowTrail";

/**
 * The pawns' CHANNEL through settled snow — recording it and drawing it into any snow slab
 * (docs/ISO_ART_FRAMEWORK.md § "Snow"; docs/TOWER_SNOW.md § "The pawn's trail").
 *
 * Two halves, joined by the trail store (snowTrail.ts):
 *   useSnowTrailRecorder  one rAF loop per store: reads each walker's live ground point from
 *                         its ref (IsoPawn `floorSpot` for the floor, `summitSpot` for the
 *                         tower's top) and extends that walker's run every `STEP` of travel;
 *                         a walker whose ref is null (off that surface) or that is airborne
 *                         (IsoPawn `airborne`) ends its run, so landing starts a new one. Notifies
 *                         the store's listeners at most every `REDRAW_MS`.
 *   useSnowChannel        a slab's side (SnowSlab `trail`): subscribes to the store and
 *                         rewrites the slab's channel paths (SnowChannelRefs) — the runs that
 *                         reach the slab, projected at its top and at the channel's floor — by
 *                         direct attribute writes, no React state per frame.
 * So the floor's sheet, the drift over the deck plate and the tower's top cap all plough the
 * same channel by the same code; the store is the caller's, so it outlasts remounts.
 *
 * The channel is the width of the pawn's body (`PAWN_BODY_RADIUS` each side), round wherever
 * the body's circle would be: at each end, where a walker has only just touched down (a
 * circle), and at every sharp turn, where the run is broken into stretches whose round ends
 * overlap (`runOutlines`).
 *
 * COST: the paths are re-rasterized on every repaint of the scene svg (each frame while snow
 * falls), so their size is the cost. Runs are simplified (`simplifyRun`), their outlines and
 * projected paths cached on the run (`runCache`), and a slab draws only the runs whose bounds
 * reach it.
 *
 * Depended on by: IsoSnowCap.tsx (SnowSlab), IsoSnowFloor.tsx, DeckTowerPlatform.tsx.
 */

/** World travel between a run's points: fine enough that the channel's bends read smooth. */
const STEP = 0.08;
/** The channel's half-width: the pawn's body. */
const CHANNEL_HALF_WIDTH = PAWN_BODY_RADIUS;
/** Segments round each rounded end of a stretch (a half circle): enough to read round at the pawn's size. */
const CAP_POINTS = 16;
/**
 * The sharpest turn (radians, between one step and the next) a stretch of channel is offset
 * across. Tighter than this the turn's radius (STEP / angle) is under the half-width, where
 * the inner offset folds back on itself (a notch under the nonzero rule) and the outer one
 * cuts the corner — so the run is broken there into stretches whose round ends meet, which
 * makes every sharp turn a round one, the body's own circle (see `smoothStretches`).
 */
const MAX_SMOOTH_TURN = 0.5;
/** The share of a corner's shorter segment over the half-width a turn may take before the inner offset folds (see `smoothStretches`). */
const FOLD_MARGIN = 0.6;
/**
 * World distance a run's simplified walking line may stray from the sampled one
 * (`simplifyRun`): well under a screen pixel at the Deck Tower's scale, but it drops the
 * many points of a straight or gently curving walk — the channel's paths are repainted with
 * every repaint of the scene (each frame, while snow falls), so their size is the cost.
 */
const SIMPLIFY_TOLERANCE = 0.012;
/** The fewest ms between two rewrites of the channel's paths (the pawn's body hides the leading edge meanwhile). */
const REDRAW_MS = 100;

/**
 * A run's walking line with the points it does not need dropped (Ramer–Douglas–Peucker,
 * `SIMPLIFY_TOLERANCE`): every kept point is within the tolerance of the sampled line.
 * Iterative (a stack), so a long run cannot overflow the call stack.
 */
function simplifyRun(run: TrailPoint[]): TrailPoint[] {
    const n = run.length;
    if (n < 3) return run;
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack: [number, number][] = [[0, n - 1]];
    const tol2 = SIMPLIFY_TOLERANCE * SIMPLIFY_TOLERANCE;
    while (stack.length) {
        const [i0, i1] = stack.pop()!;
        const a = run[i0];
        const b = run[i1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        let worst = -1;
        let worstD2 = tol2;
        for (let i = i0 + 1; i < i1; i++) {
            const p = run[i];
            // Distance to the segment (a walk can double back, so not to its infinite line).
            const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
            const ex = p.x - (a.x + t * dx);
            const ey = p.y - (a.y + t * dy);
            const d2 = ex * ex + ey * ey;
            if (d2 > worstD2) {
                worstD2 = d2;
                worst = i;
            }
        }
        if (worst < 0) continue;
        keep[worst] = 1;
        stack.push([i0, worst], [worst, i1]);
    }
    return run.filter((_, i) => keep[i]);
}

/**
 * A run broken at its sharp turns into stretches, consecutive ones sharing the turn's
 * point. A turn is sharp when the inner offset would fold — its radius (the shorter
 * neighbouring segment over the angle) under the half-width, with `FOLD_MARGIN` — or when
 * it passes `MAX_SMOOTH_TURN`, past which the outer offset visibly cuts the corner. Each
 * stretch then turns gently enough to offset cleanly.
 */
function smoothStretches(run: TrailPoint[], hw: number): TrailPoint[][] {
    const out: TrailPoint[][] = [];
    let cur: TrailPoint[] = [run[0]];
    for (let i = 1; i < run.length; i++) {
        cur.push(run[i]);
        if (i === run.length - 1) break;
        const a = run[i - 1];
        const b = run[i];
        const c = run[i + 1];
        const turn = Math.abs(Math.atan2((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)));
        const shorter = Math.min(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - b.x, c.y - b.y));
        if (turn > Math.min(MAX_SMOOTH_TURN, (FOLD_MARGIN * shorter) / hw)) {
            out.push(cur);
            cur = [b];
        }
    }
    out.push(cur);
    return out;
}

/** A full circle round `p` (a walker that has not moved a step yet), wound as the outlines are. */
function circleOutline(p: TrailPoint, hw: number): TrailPoint[] {
    const pts: TrailPoint[] = [];
    for (let k = 0; k < CAP_POINTS * 2; k++) {
        const a = -Math.PI * (k / CAP_POINTS);
        pts.push({ x: p.x + Math.cos(a) * hw, y: p.y + Math.sin(a) * hw });
    }
    return pts;
}

/** One run's channel: one outline per smooth stretch (their round ends overlap at each sharp turn). */
function runOutlines(run: TrailPoint[], hw: number): TrailPoint[][] {
    if (run.length === 0) return [];
    if (run.length === 1) return [circleOutline(run[0], hw)];
    return smoothStretches(simplifyRun(run), hw).map((stretch) => channelOutline(stretch, hw));
}

/**
 * A run's outlines and their projected paths, cached on the run: only the runs a walker is
 * extending change between redraws, so the rest are neither re-outlined nor re-projected.
 * `len` + `first` detect a change (a point added, or the oldest dropped by the cap); `proj`
 * a camera change, which only drops the projected paths.
 */
interface RunCache {
    len: number;
    first: TrailPoint | undefined;
    outlines: TrailPoint[][];
    /** The outlines' world bounds (the drift keeps only the runs that reach it). */
    bounds: WorldRect;
    proj: Projector;
    paths: Map<number, string>;
}
const runCaches = new WeakMap<TrailPoint[], RunCache>();

function runCache(run: TrailPoint[], proj: Projector, hw: number): RunCache {
    let c = runCaches.get(run);
    if (!c || c.len !== run.length || c.first !== run[0]) {
        const outlines = runOutlines(run, hw);
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const p of run) {
            x0 = Math.min(x0, p.x);
            y0 = Math.min(y0, p.y);
            x1 = Math.max(x1, p.x);
            y1 = Math.max(y1, p.y);
        }
        // r: 0 — the bounds are only an overlap test, never drawn, so they need no corner radius.
        const bounds: WorldRect = { x: x0 - hw, y: y0 - hw, w: x1 - x0 + 2 * hw, d: y1 - y0 + 2 * hw, r: 0 };
        c = { len: run.length, first: run[0], outlines, bounds, proj, paths: new Map() };
        runCaches.set(run, c);
    } else if (c.proj !== proj) {
        c.proj = proj;
        c.paths.clear();
    }
    return c;
}

/** A run's channel projected flat at height z (cached per height). */
function runPath(c: RunCache, z: number): string {
    let d = c.paths.get(z);
    if (d === undefined) {
        // The drift's height animates with the plate's press: don't keep every height it passed.
        if (c.paths.size >= 8) c.paths.clear();
        d = channelPath(c.proj, c.outlines, z);
        c.paths.set(z, d);
    }
    return d;
}

function overlaps(a: WorldRect, b: WorldRect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;
}

/**
 * One smooth stretch's channel outline in world space: the walking line offset by the half-width to
 * each side (left side forward, right side back), with a half circle round each end. Every
 * run is wound the same way relative to its travel, so overlapping runs and self-crossings
 * add up under the nonzero fill rule instead of cancelling into holes.
 */
function channelOutline(run: TrailPoint[], hw: number): TrailPoint[] {
    const n = run.length;
    if (n < 2) return [];
    // Unit normals (left of travel), each from the direction across its neighbours.
    const normals = run.map((_, i) => {
        const a = run[Math.max(0, i - 1)];
        const b = run[Math.min(n - 1, i + 1)];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: -dy / len, y: dx / len };
    });
    const left = run.map((p, i) => ({ x: p.x + normals[i].x * hw, y: p.y + normals[i].y * hw }));
    const right = run.map((p, i) => ({ x: p.x - normals[i].x * hw, y: p.y - normals[i].y * hw }));
    // A half circle round `p`, turning clockwise-in-world from the offset along `nrm` to the
    // opposite one: from left to right round the end it bulges forward, and from right to
    // left round the start it bulges back.
    const cap = (p: TrailPoint, nrm: TrailPoint) => {
        const pts: TrailPoint[] = [];
        const base = Math.atan2(nrm.y, nrm.x);
        for (let k = 1; k < CAP_POINTS; k++) {
            const a = base - Math.PI * (k / CAP_POINTS);
            pts.push({ x: p.x + Math.cos(a) * hw, y: p.y + Math.sin(a) * hw });
        }
        return pts;
    };
    return [
        ...left,
        ...cap(run[n - 1], normals[n - 1]),
        ...right.reverse(),
        ...cap(run[0], { x: -normals[0].x, y: -normals[0].y }),
    ];
}

/** Every run's channel projected flat at height z, as one path. */
function channelPath(proj: Projector, outlines: TrailPoint[][], z: number): string {
    let d = "";
    for (const pts of outlines) {
        for (let i = 0; i < pts.length; i++) {
            const s = proj.project(pts[i].x, pts[i].y, z);
            d += `${i === 0 ? "M" : "L"}${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
        }
        if (pts.length) d += "Z";
    }
    return d;
}

/** A walker a recorder tracks: its live ground point on the snow's surface (null while it is off it). */
export interface SnowWalker {
    key: string;
    spot: React.MutableRefObject<{ x: number; y: number } | null>;
    /** True while it is in the air (IsoPawn `airborne`): no channel through the air, so its run ends and a new one starts where it lands. */
    airborne?: React.MutableRefObject<boolean>;
}

/**
 * Records the walkers' runs into `trail` while `enabled` (see the header). Walkers are read
 * through a ref, so they come and go (a swap's outgoing pawn) without restarting the loop.
 */
export function useSnowTrailRecorder(trail: SnowTrail | undefined, walkers: SnowWalker[], enabled: boolean): void {
    const live = useRef(walkers);
    live.current = walkers;
    useEffect(() => {
        if (!trail || !enabled) return;
        let lastNotify = -Infinity;
        let pending = false;
        let frame = 0;
        const tick = () => {
            frame = requestAnimationFrame(tick);
            const liveKeys = new Set<string>();
            for (const w of live.current) {
                liveKeys.add(w.key);
                const at = w.spot.current;
                if (!at || w.airborne?.current) {
                    // Off the surface (on the tower, falling, before its entrance) or in the air
                    // over it (a jump, a flight onto the tower): its run ends here.
                    trail.open.delete(w.key);
                    continue;
                }
                let run = trail.open.get(w.key);
                if (!run) {
                    run = [{ x: at.x, y: at.y }];
                    trail.runs.push(run);
                    trail.open.set(w.key, run);
                    trail.points += 1;
                    // Drawn at once: a fresh run is the body's circle where it touched down.
                    pending = true;
                    continue;
                }
                const last = run[run.length - 1];
                if ((at.x - last.x) ** 2 + (at.y - last.y) ** 2 < STEP * STEP) continue;
                run.push({ x: at.x, y: at.y });
                trail.points += 1;
                pending = true;
            }
            // Close the runs of walkers no longer drawn (a swap's outgoing pawn).
            for (const k of trail.open.keys()) if (!liveKeys.has(k)) trail.open.delete(k);
            // Rewritten at most every REDRAW_MS (each rewrite re-parses every path).
            if (pending && performance.now() - lastNotify >= REDRAW_MS) {
                pending = false;
                lastNotify = performance.now();
                capSnowTrail(trail);
                for (const l of trail.listeners) l();
            }
        };
        frame = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(frame);
            // Whatever was recorded since the last notify.
            if (pending) for (const l of trail.listeners) l();
        };
    }, [trail, enabled]);
}

/** The paths of a channel ploughed through a slab (see SnowSlab). */
export interface SnowChannelRefs {
    clip: React.RefObject<SVGPathElement | null>;
    wall: React.RefObject<SVGPathElement | null>;
    floor: React.RefObject<SVGPathElement | null>;
}

/**
 * A slab's channel: refs to hand its three paths, kept drawn from `trail` — the runs whose
 * bounds reach `rect`, projected at `topZ` (the slab's top: the clip and the far wall) and
 * at `floorZ` (the channel's floor). Repainted on every notify, and when the projection or
 * the heights change (a camera dive, the plate's press).
 */
export function useSnowChannel(trail: SnowTrail | undefined, rect: WorldRect, floorZ: number, topZ: number): SnowChannelRefs {
    const proj = useIsoProjector();
    const clip = useRef<SVGPathElement>(null);
    const wall = useRef<SVGPathElement>(null);
    const floor = useRef<SVGPathElement>(null);
    const refs = useMemo(() => ({ clip, wall, floor }), []);
    const live = useRef({ proj, rect, floorZ, topZ });
    live.current = { proj, rect, floorZ, topZ };
    const redraw = useMemo(
        () => () => {
            if (!trail) return;
            const { proj: p, rect: r, floorZ: fz, topZ: tz } = live.current;
            const runs = trail.runs.map((run) => runCache(run, p, CHANNEL_HALF_WIDTH)).filter((c) => overlaps(c.bounds, r));
            const top = runs.map((c) => runPath(c, tz)).join("");
            clip.current?.setAttribute("d", top);
            wall.current?.setAttribute("d", top);
            floor.current?.setAttribute("d", runs.map((c) => runPath(c, fz)).join(""));
        },
        [trail]
    );
    useEffect(() => {
        if (!trail) return;
        trail.listeners.add(redraw);
        return () => {
            trail.listeners.delete(redraw);
        };
    }, [trail, redraw]);
    // Mount (the channel ploughed before it: a pan back, a cover remounting), and every change
    // of projection, place or height.
    useEffect(() => {
        redraw();
    }, [redraw, proj, rect, floorZ, topZ]);
    return refs;
}
