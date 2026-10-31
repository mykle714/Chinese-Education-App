import { useCallback, useMemo } from "react";
import { VIEW_RAY_Z, type Projector } from "./geometry";
import { planSidePath, prefersReducedMotion, rand, useAltitudeWander, useSkyTraffic, type AltitudeWander, type AltitudeWanderConfig, type Pt2, type SkyRegion, type SkySide } from "./skyTraffic";

/**
 * useCloudDrifts — schedules the clouds drifting past a tall tower
 * (docs/ISO_ART_FRAMEWORK.md § "IsoCloud").
 *
 * A cloud drifts (skyTraffic.ts) in a straight line parallel to one of
 * the four sides of `sky.around`, from off one screen
 * edge to off the other. It is slow (a minute or more per crossing) and drawn behind or in front of the tower by the same side rule. Its height is read
 * from one shared wandering altitude (skyTraffic.ts → createAltitudeWander), so clouds
 * in the sky together sit at close heights rather than at very different ones that
 * perspective then stacks into the same patch of screen.
 *
 * Each slot's FIRST cloud starts partway across (`startT`) and fades in, so when the
 * clouds switch on the band already has sky in it, rather than staying empty for the
 * half-minute a cloud takes to drift in from the edge. Later clouds enter from off screen.
 *
 * Under prefers-reduced-motion the clouds still show — a still cloud reads as a cloud —
 * but nothing is scheduled: one cloud per slot, parked where its
 * opening drift would have started, never moving.
 *
 * Referenced by: docs/ISO_ART_FRAMEWORK.md § "IsoCloud", docs/DECK_TOWER.md § "The scene".
 */

/** One puff of a cloud: a low pill prism, relative to the cloud's origin, in world units. */
export interface CloudPuff {
    x: number;
    y: number;
    /** Height of the puff's underside above the cloud's base. */
    z: number;
    w: number;
    d: number;
    /** Puff thickness. */
    h: number;
}

export interface CloudDrift {
    /** Unique per drift — the React key, so each drift mounts a fresh IsoCloud. */
    id: number;
    /** World x/y of the cloud's ORIGIN at the start and end of the WHOLE crossing. */
    from: Pt2;
    to: Pt2;
    /** Where along from→to (0–1) this drift begins: 0 off screen, more for a slot's opener. */
    startT: number;
    /** World height of the cloud's base. */
    z: number;
    /** How long this drift is on screen, from `startT` to the end (ms). */
    durationMs: number;
    side: SkySide;
    /** The puffs, oriented to the path and scaled, in BACK-TO-FRONT draw order. */
    puffs: CloudPuff[];
}

/** The clouds' sky: the band their BASES sit in, the tower, the screen they cross. */
export type CloudSky = SkyRegion;

/**
 * The cloud shapes, authored with their long side along local x (the drift direction).
 * Each is a crown puff raised over two or three base lobes. Draw order is computed
 * (`orientPuffs`), so the authored order does not matter.
 */
const CLOUD_SHAPES: CloudPuff[][] = [
    [
        { x: 0, y: 0.6, z: 0, w: 2.4, d: 2.0, h: 0.9 },
        { x: 1.2, y: 0, z: 0.5, w: 2.6, d: 2.2, h: 1.1 },
        { x: 2.6, y: 0.5, z: 0.1, w: 2.4, d: 2.0, h: 0.9 },
        { x: 1.0, y: 1.2, z: 0, w: 2.8, d: 1.8, h: 0.8 },
    ],
    [
        { x: 0, y: 0.3, z: 0, w: 2.2, d: 1.8, h: 0.8 },
        { x: 1.3, y: 0, z: 0.35, w: 2.4, d: 2.0, h: 1.0 },
        { x: 2.6, y: 0.4, z: 0, w: 1.8, d: 1.6, h: 0.7 },
    ],
];

/** Per-cloud size multiplier. */
const SCALE_MIN = 0.8;
const SCALE_MAX = 1.25;
/** How far out from the tower's side the cloud's near edge drifts, in world units. */
const GAP_MIN = 1.5;
const GAP_MAX = 4.5;
/** Drift speed, world units per second. Clouds take a minute+ per crossing. */
const SPEED_MIN = 0.4;
const SPEED_MAX = 0.8;
/** Extra world units past each screen edge, beyond the cloud's own extent. */
const OFFSCREEN_MARGIN = 0.5;
/** A slot's opening drift starts this far across (0–1), so the band is never empty at first. */
const OPENER_START = { min: 0.15, max: 0.75 };
/** Openers come up nearly together (they fade in); later clouds wait a few seconds. */
const FIRST_WAIT_MS = { max: 400, perSlot: 250 };
const WAIT_MIN_MS = 4000;
const WAIT_MAX_MS = 14000;

/**
 * The shared cloud height. A cloud is up for a minute or more, so the wander is slow: in
 * one crossing it moves about a third of the band, and so does the next spawn.
 */
const ALTITUDE_WANDER: AltitudeWanderConfig = { knotMs: 20000, maxStep: 0.12 };

const firstWaitMs = (slot: number) => rand(0, FIRST_WAIT_MS.max) + slot * FIRST_WAIT_MS.perSlot;
const waitMs = () => rand(WAIT_MIN_MS, WAIT_MAX_MS);

/**
 * A shape scaled and turned to its path (along y swaps x ↔ y), sorted BACK-TO-FRONT by
 * view depth. The view ray is (1, 1, VIEW_RAY_Z) — sx and sy are unchanged
 * moving along it — so a puff is nearer the viewer the larger the x + y + z · VIEW_RAY_Z of its centre.
 */
function orientPuffs(shape: CloudPuff[], scale: number, alongX: boolean): CloudPuff[] {
    const viewDepth = (p: CloudPuff) => p.x + p.w / 2 + p.y + p.d / 2 + (p.z + p.h / 2) * VIEW_RAY_Z;
    return shape
        .map((p) => {
            const s = { x: p.x * scale, y: p.y * scale, z: p.z * scale, w: p.w * scale, d: p.d * scale, h: p.h * scale };
            return alongX ? s : { ...s, x: s.y, y: s.x, w: s.d, d: s.w };
        })
        .sort((a, b) => viewDepth(a) - viewDepth(b));
}

/** The puffs' footprint extent: along the path, and across it. */
function shapeExtent(shape: CloudPuff[], scale: number) {
    return {
        along: Math.max(...shape.map((p) => p.x + p.w)) * scale,
        across: Math.max(...shape.map((p) => p.y + p.d)) * scale,
    };
}

function planDrift(id: number, opener: boolean, proj: Projector, sky: CloudSky, altitude: AltitudeWander): CloudDrift {
    const shape = CLOUD_SHAPES[Math.floor(Math.random() * CLOUD_SHAPES.length)];
    const scale = rand(SCALE_MIN, SCALE_MAX);
    const { along, across } = shapeExtent(shape, scale);
    // The cloud's screen extent from its origin is (−across … +along) world units on the
    // path's axis, so `along + across` past each edge keeps the whole of it off screen.
    const path = planSidePath(proj, sky, rand(GAP_MIN, GAP_MAX), along + across + OFFSCREEN_MARGIN, across);
    const length = Math.hypot(path.to.x - path.from.x, path.to.y - path.from.y);
    const startT = opener ? rand(OPENER_START.min, OPENER_START.max) : 0;
    return {
        id,
        from: path.from,
        to: path.to,
        startT,
        z: altitude.sample(sky.band),
        durationMs: ((length * (1 - startT)) / rand(SPEED_MIN, SPEED_MAX)) * 1000,
        side: path.side,
        puffs: orientPuffs(shape, scale, path.alongX),
    };
}

/**
 * Clouds sorted BACK-TO-FRONT by the view depth of their path's midpoint — near the
 * tower, where two clouds are likeliest to overlap. Approximate: two clouds on
 * perpendicular sides change order as they move, which a static sort cannot follow.
 */
export function sortCloudsBackToFront(clouds: CloudDrift[]): CloudDrift[] {
    const depth = (c: CloudDrift) => (c.from.x + c.to.x) / 2 + (c.from.y + c.to.y) / 2 + c.z * VIEW_RAY_Z;
    return [...clouds].sort((a, b) => depth(a) - depth(b));
}

export function useCloudDrifts(opts: {
    proj: Projector;
    /** Clouds show only while this is true. Turning it false clears the sky. */
    active: boolean;
    /** Expected to be memoized: a new object restarts every slot. */
    sky: CloudSky;
    /** How many clouds may be in the sky at once (one slot each). */
    maxInSky?: number;
}): CloudDrift[] {
    const { proj, active, sky, maxInSky = 3 } = opts;
    const reduced = prefersReducedMotion();
    const altitude = useAltitudeWander(ALTITUDE_WANDER);
    const plan = useCallback((id: number, first: boolean) => planDrift(id, first, proj, sky, altitude), [proj, sky, altitude]);
    const drifting = useSkyTraffic({ active: active && !reduced, slots: maxInSky, plan, firstWaitMs, waitMs });
    // Reduced motion: one parked opener per slot, planned once per activation.
    const parked = useMemo(
        () => (active && reduced ? Array.from({ length: maxInSky }, (_, i) => plan(i + 1, true)) : []),
        [active, reduced, maxInSky, plan]
    );
    return reduced ? parked : drifting;
}
