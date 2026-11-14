import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * Every cloud ENTERS from off screen — none appears mid-sky when the clouds switch on —
 * EXCEPT on a `fillRequest` (a weather tester pin tap): then every slot's opening cloud
 * starts at once, already partway across (`PARKED_AT`), so the tap shows a full sky now.
 * Clouds are cloudy weather (towerWeather.ts → `weatherCloudCount`), the commonest kind, so
 * they arrive quietly: the slots' first drifts are staggered like any later one
 * (`firstWaitMs`), and the band fills over a minute or so rather than all at once.
 *
 * The RED BALLOON: each drift has a 1-in-100 chance (`BALLOON_CHANCE`) of being a red
 * balloon instead of a cloud (`kind: "balloon"`, drawn by IsoBalloon). It takes the cloud's
 * slot, path, speed and side rule, but flies lower, in `sky.balloonBand` (just under the
 * clouds), and its one "puff" is the balloon body's bounding box, so the path extent,
 * depth sort and shadow (IsoCloudShadow) all work unchanged.
 *
 * A feature tester can also spawn a balloon on demand (`balloonRequest`, the Deck Tower's
 * BalloonSpawnChip): it flies outside the slots and whatever the weather, in
 * `sky.visibleBalloonBand`, so it is on screen even over a tower too short to reach the
 * real band, and it starts partway across, so it is on screen at once.
 *
 * Under prefers-reduced-motion the clouds still show — a still cloud reads as a cloud —
 * but nothing is scheduled: one cloud per slot, parked partway across (`PARKED_AT`),
 * never moving.
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

/** What a drift is: almost always a cloud; rarely (`BALLOON_CHANCE`) a red balloon. */
export type CloudDriftKind = "cloud" | "balloon";

export interface CloudDrift {
    /** Unique per drift — the React key, so each drift mounts a fresh IsoCloud / IsoBalloon. */
    id: number;
    kind: CloudDriftKind;
    /** World x/y of the cloud's ORIGIN at the start and end of the WHOLE crossing. */
    from: Pt2;
    to: Pt2;
    /** Where along from→to (0–1) this drift begins: 0 off screen; more only for a reduced-motion parked cloud. */
    startT: number;
    /** World height of the cloud's base (a balloon: the bottom of its body; its string hangs below). */
    z: number;
    /** How long this drift is on screen, from `startT` to the end (ms). */
    durationMs: number;
    side: SkySide;
    /**
     * The puffs, oriented to the path and scaled, in BACK-TO-FRONT draw order. A balloon has
     * ONE: its body's bounding box (a 2r cube), which is what the shadow and path extent read.
     */
    puffs: CloudPuff[];
}

/**
 * The clouds' sky: the band their BASES sit in, the tower, the screen they cross — plus the
 * lower band the rare red balloon's body bottom sits in.
 */
export type CloudSky = SkyRegion & {
    balloonBand: { zMin: number; zMax: number };
    /**
     * `balloonBand`, brought down inside the framed scene when the tower stops short of it.
     * Only the tester spawn (`balloonRequest`) flies here, so a tap always shows a balloon;
     * a natural balloon keeps the real band, like the clouds.
     */
    visibleBalloonBand: { zMin: number; zMax: number };
};

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
/** Reduced motion only: how far across (0–1) a parked cloud sits, so it is on screen. */
const PARKED_AT = { min: 0.15, max: 0.75 };
/**
 * Gaps between a slot's drifts. The FIRST drift of slot n waits n of these gaps (plus a
 * short lead-in), so the slots' clouds come in one after another rather than together.
 */
const FIRST_LEAD_IN_MS = 1500;
const WAIT_MIN_MS = 4000;
const WAIT_MAX_MS = 14000;

/**
 * The shared cloud height. A cloud is up for a minute or more, so the wander is slow: in
 * one crossing it moves about a third of the band, and so does the next spawn.
 */
const ALTITUDE_WANDER: AltitudeWanderConfig = { knotMs: 20000, maxStep: 0.12 };

/** The chance that a drift is a red balloon instead of a cloud (docs/ISO_ART_FRAMEWORK.md § "IsoBalloon"). */
const BALLOON_CHANCE = 0.01;
/** The balloon body's world radius (its width; IsoBalloon draws it a little taller than wide). */
export const BALLOON_RADIUS = 0.55;
/**
 * Tester-spawned balloons' ids start here, clear of the slot drifts' (which count up from 1
 * per activation), so the two never share a React key.
 */
const FORCED_BALLOON_ID_BASE = 1_000_000;
/** Reduced motion only: how long a tester-spawned (parked, still) balloon stays up. */
const FORCED_PARKED_MS = 15000;

const waitMs = () => rand(WAIT_MIN_MS, WAIT_MAX_MS);
const firstWaitMs = (slot: number) => rand(0, FIRST_LEAD_IN_MS) + slot * waitMs();

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

/** The balloon's one "puff": its body's bounding box, a 2r cube on the origin. */
const BALLOON_SHAPE: CloudPuff[] = [{ x: 0, y: 0, z: 0, w: 2 * BALLOON_RADIUS, d: 2 * BALLOON_RADIUS, h: 2 * BALLOON_RADIUS }];

/** `forceBalloon`: the tester spawn — always a balloon, in the on-screen `visibleBalloonBand`. */
function planDrift(id: number, parked: boolean, proj: Projector, sky: CloudSky, altitude: AltitudeWander, forceBalloon = false): CloudDrift {
    const kind: CloudDriftKind = forceBalloon || Math.random() < BALLOON_CHANCE ? "balloon" : "cloud";
    const balloonBand = forceBalloon ? sky.visibleBalloonBand : sky.balloonBand;
    const shape = kind === "balloon" ? BALLOON_SHAPE : CLOUD_SHAPES[Math.floor(Math.random() * CLOUD_SHAPES.length)];
    // A balloon is always one size: varying it would only read as varying distance.
    const scale = kind === "balloon" ? 1 : rand(SCALE_MIN, SCALE_MAX);
    const { along, across } = shapeExtent(shape, scale);
    // The cloud's screen extent from its origin is (−across … +along) world units on the
    // path's axis, so `along + across` past each edge keeps the whole of it off screen.
    const path = planSidePath(proj, sky, rand(GAP_MIN, GAP_MAX), along + across + OFFSCREEN_MARGIN, across);
    const length = Math.hypot(path.to.x - path.from.x, path.to.y - path.from.y);
    const startT = parked ? rand(PARKED_AT.min, PARKED_AT.max) : 0;
    return {
        id,
        kind,
        from: path.from,
        to: path.to,
        startT,
        // A balloon is up only now and then, so it does not follow the clouds' shared wander:
        // any height in its own band will do.
        z: kind === "balloon" ? rand(balloonBand.zMin, balloonBand.zMax) : altitude.sample(sky.band),
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
    /**
     * Feature testing: each CHANGE of this number spawns one balloon now, outside the slots
     * and whatever `active` says (DeckTowerPage → BalloonSpawnChip). 0 / unchanged: none.
     */
    balloonRequest?: number;
    /**
     * Feature testing: each CHANGE of this number fills the sky now — every slot's opening
     * cloud starts at once, mid-sky (useSkyTraffic → `instantKey`) — instead of the clouds
     * drifting in one by one (DeckTowerPage → the weather tester pins). 0 / unchanged: none.
     */
    fillRequest?: number;
}): CloudDrift[] {
    const { proj, active, sky, maxInSky = 3, balloonRequest = 0, fillRequest = 0 } = opts;
    const reduced = prefersReducedMotion();
    const altitude = useAltitudeWander(ALTITUDE_WANDER);
    // Moving clouds start off screen, whatever useSkyTraffic's `first` says — unless this is
    // an instant fill's opening crossing, which starts partway across (`parked` startT) and
    // drifts on from there.
    const plan = useCallback(
        (id: number, _first: boolean, instant: boolean) => planDrift(id, instant, proj, sky, altitude),
        [proj, sky, altitude]
    );
    const drifting = useSkyTraffic({ active: active && !reduced, slots: maxInSky, plan, firstWaitMs, waitMs, instantKey: fillRequest });
    // Reduced motion: one parked cloud per slot, planned once per activation.
    const parked = useMemo(
        () => (active && reduced ? Array.from({ length: maxInSky }, (_, i) => planDrift(i + 1, true, proj, sky, altitude)) : []),
        [active, reduced, maxInSky, proj, sky, altitude]
    );
    const forced = useForcedBalloons(balloonRequest, reduced, proj, sky, altitude);
    const base = reduced ? parked : drifting;
    return forced.length === 0 ? base : [...base, ...forced];
}

/**
 * The tester-spawned balloons: one per change of `request`, each starting partway across
 * (on screen at once) and removed when its crossing ends (or after FORCED_PARKED_MS under
 * reduced motion, where it stays still).
 */
function useForcedBalloons(request: number, reduced: boolean, proj: Projector, sky: CloudSky, altitude: AltitudeWander): CloudDrift[] {
    const [balloons, setBalloons] = useState<CloudDrift[]>([]);
    // The request value last served: the effect also re-runs when proj/sky change, and only a
    // NEW request may spawn (the initial value spawns nothing).
    const served = useRef(request);
    const nextId = useRef(FORCED_BALLOON_ID_BASE);
    const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

    useEffect(() => {
        if (request === served.current) return;
        served.current = request;
        // Always parked partway across (2026-11-13: every tester control is instant), so the
        // balloon is on screen the moment the chip is tapped instead of drifting in from off
        // screen; with motion it then flies on from there.
        const drift = planDrift(nextId.current++, true, proj, sky, altitude, true);
        setBalloons((list) => [...list, drift]);
        const t = setTimeout(() => {
            timers.current.delete(t);
            setBalloons((list) => list.filter((d) => d.id !== drift.id));
        }, reduced ? FORCED_PARKED_MS : drift.durationMs);
        timers.current.add(t);
    }, [request, reduced, proj, sky, altitude]);

    // Cancel every pending removal on unmount (the page leaving), so none fires after.
    useEffect(() => {
        const pending = timers.current;
        return () => pending.forEach(clearTimeout);
    }, []);

    return balloons;
}
