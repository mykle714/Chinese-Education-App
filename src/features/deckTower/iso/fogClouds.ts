import type { Projector } from "./geometry";

/**
 * fogClouds.ts — plans the fog clouds IsoFog rolls across a scene
 * (docs/ISO_ART_FRAMEWORK.md § "IsoFog").
 *
 * Layer: framework math (pure — no React). The scene calls `planFogClouds` ONCE per framing
 * with its FIXED view projector, and hands the plan to IsoFog. Planning against the fixed
 * view (not the study camera) keeps the field stable: a camera move re-projects the same
 * world clouds instead of re-planning, which would remount them and restart their loops.
 *
 * ── A fog cloud ───────────────────────────────────────────────────────────────
 * A cloud is 2–4 fog UNITS — skinny pills, long side along the travel (world +x) — lying
 * side by side across world y at one height, `UNIT_GAP` apart. Each unit is STAGGERED: slid
 * along x by its own offset, with its own length. Neighbouring units are CONNECTED where
 * they can be: where they overlap along x, part of the gap between them is filled
 * (`FogBridge`), so the cloud reads as one stepped silhouette. A bridge keeps
 * `BRIDGE_END_INSET` (one unit width) clear of every unit's end, so it never reaches a
 * rounded cap; within that room its length is random, from `MIN_BRIDGE_WIDTHS` (2) unit
 * widths up to the whole room, at a random spot. Units without that much room stay apart
 * — a notch in the cloud. The bridge runs between the two units' centre lines, and each of
 * its ends is pinched in by two concave FILLETS of the units' own radius, one off each
 * unit's side, meeting mid-gap (`bridgeEnd`) — so the join flows out of the units the way
 * their rounded ends do, instead of stepping square.
 *
 * ── The field ─────────────────────────────────────────────────────────────────
 * The fog must cover a SCREEN box (`cover`: the scene's full width, in a band around the
 * platform), not just the slab. Every cloud travels along world +x (screen down-right), so
 * the field is a set of LANES — lines of constant world y — `LANE_SPACING` apart, each a
 * cloud's centre line. For each of the three heights, the lanes' y range is found by
 * inverting the projection at the box's corners (the fixed view is affine, so a world line
 * is a screen line and the box's corners bound it). Each lane runs only where its screen
 * line crosses the box, plus the cloud's extent and `EDGE_MARGIN` either side, so a cloud
 * enters and leaves fully outside the box.
 *
 * ── Density ───────────────────────────────────────────────────────────────────
 * A lane carries one cloud per `CLOUD_PITCH` units of its travel (at least one), spread
 * evenly round the loop with a little jitter — so the field is uniformly thick whatever a
 * lane's length, and two clouds in one lane never overlap (they share the lane's speed).
 * Lanes take the three heights in turn, so neighbouring lanes sit at different heights.
 * Everything random comes from a seeded PRNG, so the same framing always plans the same field.
 *
 * Depends on: geometry.ts (`Projector`). Depended on by: IsoFog.tsx (`FogCloud`),
 * src/features/deckTower/DeckTowerPage.tsx (plans it per framing).
 */

/** One fog unit: a skinny pill, offset from its cloud's origin. */
export interface FogUnit {
    /** World x of its back end, from the cloud's origin (≥ 0). */
    dx: number;
    /** World y of its centre line, from the cloud's centre line. */
    dy: number;
    length: number;
}

/** A world point as offsets from its cloud's origin (back end of the rear-most unit, centre line). */
export interface FogPoint {
    dx: number;
    dy: number;
}

/**
 * The filled gap between two neighbouring units: a closed flat outline (fillet arcs
 * pre-sampled), offsets from the cloud's origin. It runs centre line to centre line, so its
 * straight edges hide inside the two units.
 */
export interface FogBridge {
    outline: FogPoint[];
}

/** One fog cloud, crossing its lane at height `z` from origin x `x0` to `x1`. */
export interface FogCloud {
    z: number;
    /** World y of the cloud's centre line. */
    y: number;
    x0: number;
    x1: number;
    /** Every unit's width (one per cloud, so the stack is even). */
    unitWidth: number;
    units: FogUnit[];
    bridges: FogBridge[];
    /** Seconds one crossing takes (the lane's speed), and where in that loop it starts (0–1). */
    periodS: number;
    phase: number;
}

/** A screen-space box, in the scene's viewBox units. */
export interface FogCover {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

/**
 * The fog's heights over the floor. The low level sits near the pawn's knees (body 1.5
 * tall), the top one just over its head, so the pawn wades through the fog.
 */
export const FOG_LEVELS = [0.35, 1.0, 1.9] as const;

/** Units per cloud, inclusive. */
const UNITS_PER_CLOUD = [2, 4] as const;
/** A unit's width (skinny) and length ranges, world units. */
const UNIT_WIDTH = [0.6, 0.9] as const;
const UNIT_LENGTH = [5, 12] as const;
/** World units of clear space between neighbouring units' sides — what a bridge fills. */
const UNIT_GAP = 0.3;
/** Line segments per fillet arc at a bridge's end. */
const FILLET_STEPS = 8;
/** How far a unit may be slid along x from its neighbour, either way — the stagger. */
const STAGGER = 5;
/** A bridge's ends stay this many unit widths clear of every unit's end (its tip). */
const BRIDGE_END_INSET = 1;
/** Shortest bridge, in unit widths; neighbours with less room than this stay a notch. */
const MIN_BRIDGE_WIDTHS = 2;
/** World units between neighbouring lanes (across all three heights). A 4-unit cloud is ~4 deep, so clouds at different heights overlap. */
const LANE_SPACING = 1.2;
/** World units of travel per cloud in a lane. */
const CLOUD_PITCH = 17;
/**
 * A lane's speed range, world units/s — far slower than the sky clouds (0.4–0.8): ground fog
 * barely drifts (a 5-unit pill takes ~1 min to pass its own length). A crossing takes
 * many minutes, so the field relies on the spread phases to look full from the start.
 */
const SPEED = [0.06, 0.1] as const;
/** World units a cloud starts / ends beyond the box, so it enters and leaves fully outside it. */
const EDGE_MARGIN = 1;
/** Jitter on a cloud's evenly-spread loop position, as a share of the gap between clouds. */
const PHASE_JITTER = 0.35;

/** mulberry32: a tiny seeded PRNG, so the field is the same every time it is planned. */
function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * One end of a bridge between unit `a` (smaller y) and unit `b`, at x `end`, as a chain of
 * points from a's centre line to b's. `side` is +1 for the front end (larger x), -1 for the
 * back end. Both units run on past `end` (the bridge is inset from their tips), so the end
 * is two concave fillets of radius `r` (the units' radius): one circle sits r off a's side
 * line and touches it at `end`, the other likewise off b's side; each arc runs from its
 * touch point inward (away from `side`) to the middle of the gap, where the two meet. The
 * gap is narrower than 2r, so the arcs meet at a slight crease rather than a straight edge.
 * The anchor-to-touch legs run inside the units.
 */
function bridgeEnd(a: FogUnit, b: FogUnit, r: number, end: number, side: 1 | -1): FogPoint[] {
    const pt = (dx: number, dy: number): FogPoint => ({ dx, dy });
    const sideA = a.dy + r;
    const sideB = b.dy - r;
    const midY = (sideA + sideB) / 2;
    // Each fillet's circle sits r off its unit's side; at mid-gap it has curved inward by `pinch`.
    const lift = r - (midY - sideA); // circle centre to mid-gap, across y
    const pinch = Math.sqrt(Math.max(0, r * r - lift * lift));
    const arc = (cy: number, fromY: number): FogPoint[] => {
        // From the touch point (straight over/under the centre) to the mid-gap point.
        const t0 = Math.atan2(fromY - cy, 0);
        const t1 = Math.atan2(midY - cy, -side * pinch);
        let sweep = t1 - t0;
        if (sweep > Math.PI) sweep -= 2 * Math.PI;
        if (sweep < -Math.PI) sweep += 2 * Math.PI;
        return Array.from({ length: FILLET_STEPS + 1 }, (_, k) => {
            const t = t0 + (sweep * k) / FILLET_STEPS;
            return pt(end + r * Math.cos(t), cy + r * Math.sin(t));
        });
    };
    const arcA = arc(sideA + r, sideA);
    const arcB = arc(sideB - r, sideB).reverse(); // mid-gap → b's touch point
    return [pt(end, a.dy), ...arcA, ...arcB.slice(1), pt(end, b.dy)];
}

/**
 * One cloud's shape: 2–4 staggered units and the bridges between them, offsets from its
 * origin (the back end of its rear-most unit, on its centre line). Also returns its extent
 * along x and its half-depth across y.
 */
function shapeCloud(rand: () => number): { unitWidth: number; units: FogUnit[]; bridges: FogBridge[]; extent: number; halfDepth: number } {
    const between = ([lo, hi]: readonly [number, number]) => lo + rand() * (hi - lo);
    const count = UNITS_PER_CLOUD[0] + Math.floor(rand() * (UNITS_PER_CLOUD[1] - UNITS_PER_CLOUD[0] + 1));
    const unitWidth = between(UNIT_WIDTH);
    const pitch = unitWidth + UNIT_GAP;
    // Each unit staggered off the previous one, so the silhouette steps rather than scatters.
    const raw: { x: number; length: number }[] = [];
    let x = 0;
    for (let i = 0; i < count; i++) {
        const length = between(UNIT_LENGTH);
        if (i > 0) x += (rand() * 2 - 1) * STAGGER;
        raw.push({ x, length });
    }
    // Shift so the rear-most unit starts at 0.
    const minX = Math.min(...raw.map((u) => u.x));
    const units: FogUnit[] = raw.map((u, i) => ({ dx: u.x - minX, dy: (i - (count - 1) / 2) * pitch, length: u.length }));

    // Bridges: between neighbours, inside the room their overlap leaves once each end keeps
    // BRIDGE_END_INSET widths clear of both units' tips; a random length (MIN_BRIDGE_WIDTHS
    // widths up to the whole room) at a random spot in it. Outline: the front end's fillet
    // chain (a → b), then the back end's reversed (b → a); the closing edges run along the
    // two centre lines.
    const r = unitWidth / 2;
    const inset = BRIDGE_END_INSET * unitWidth;
    const minLength = MIN_BRIDGE_WIDTHS * unitWidth;
    const bridges: FogBridge[] = [];
    for (let i = 1; i < units.length; i++) {
        const a = units[i - 1];
        const b = units[i];
        const roomFrom = Math.max(a.dx, b.dx) + inset;
        const roomTo = Math.min(a.dx + a.length, b.dx + b.length) - inset;
        const room = roomTo - roomFrom;
        if (room < minLength) continue;
        const length = minLength + rand() * (room - minLength);
        const from = roomFrom + rand() * (room - length);
        const to = from + length;
        bridges.push({ outline: [...bridgeEnd(a, b, r, to, 1), ...bridgeEnd(a, b, r, from, -1).reverse()] });
    }
    const extent = Math.max(...units.map((u) => u.dx + u.length));
    const halfDepth = ((count - 1) * pitch + unitWidth) / 2;
    return { unitWidth, units, bridges, extent, halfDepth };
}

/**
 * Plans the clouds covering `cover` at `floorZ + FOG_LEVELS`. `proj` must be affine (the
 * fixed view, `makeProjector`) — the inversion below assumes it.
 */
export function planFogClouds(proj: Projector, floorZ: number, cover: FogCover): FogCloud[] {
    const rand = seeded(0xf06);
    const clouds: FogCloud[] = [];

    const levels = FOG_LEVELS.map((dz) => {
        const z = floorZ + dz;
        // The affine map at this height: screen = o + x·ex + y·ey.
        const o = proj.project(0, 0, z);
        const px = proj.project(1, 0, z);
        const py = proj.project(0, 1, z);
        const ex = { x: px.x - o.x, y: px.y - o.y };
        const ey = { x: py.x - o.x, y: py.y - o.y };
        const det = ex.x * ey.y - ey.x * ex.y;
        // Screen → world y at this height (Cramer's rule).
        const worldY = (sx: number, sy: number) => (ex.x * (sy - o.y) - (sx - o.x) * ex.y) / det;
        const ys = [
            worldY(cover.minX, cover.minY),
            worldY(cover.maxX, cover.minY),
            worldY(cover.minX, cover.maxY),
            worldY(cover.maxX, cover.maxY),
        ];

        // Where the lane at world y crosses the box: screen x and y both run linearly in
        // world x along it, so each gives an x interval; the lane is in the box on their overlap.
        const crossing = (y: number): [number, number] | null => {
            let lo = -Infinity;
            let hi = Infinity;
            for (const [axis, min, max] of [
                ["x", cover.minX, cover.maxX],
                ["y", cover.minY, cover.maxY],
            ] as const) {
                const base = o[axis] + y * ey[axis];
                const slope = ex[axis];
                if (Math.abs(slope) < 1e-9) {
                    if (base < min || base > max) return null;
                    continue;
                }
                const a = (min - base) / slope;
                const b = (max - base) / slope;
                lo = Math.max(lo, Math.min(a, b));
                hi = Math.min(hi, Math.max(a, b));
            }
            return lo < hi ? [lo, hi] : null;
        };
        return { z, yMin: Math.min(...ys), yMax: Math.max(...ys), crossing };
    });

    // One shared lane grid over the union of the levels' ranges (grown by a cloud's depth);
    // lane i goes to level i % 3.
    const reach = (UNITS_PER_CLOUD[1] * (UNIT_WIDTH[1] + UNIT_GAP)) / 2;
    const yMin = Math.min(...levels.map((l) => l.yMin)) - reach;
    const yMax = Math.max(...levels.map((l) => l.yMax)) + reach;
    const laneCount = Math.ceil((yMax - yMin) / LANE_SPACING);
    for (let i = 0; i <= laneCount; i++) {
        const level = levels[i % FOG_LEVELS.length];
        const y = yMin + i * LANE_SPACING + (rand() - 0.5) * LANE_SPACING * 0.4;
        // The lane's band is a cloud deep: it counts if any of it crosses the box.
        const hits = [level.crossing(y), level.crossing(y - reach), level.crossing(y + reach)].filter((h): h is [number, number] => h !== null);
        if (hits.length === 0) continue;
        const enter = Math.min(...hits.map((h) => h[0]));
        const leave = Math.max(...hits.map((h) => h[1]));
        const speed = SPEED[0] + rand() * (SPEED[1] - SPEED[0]);
        // Shapes first: the lane's travel must clear its longest cloud at both ends.
        const travelGuess = leave - enter + 2 * EDGE_MARGIN;
        const count = Math.max(1, Math.round(travelGuess / CLOUD_PITCH));
        const shapes = Array.from({ length: count }, () => shapeCloud(rand));
        const longest = Math.max(...shapes.map((s) => s.extent));
        // Origin starts so the cloud's FRONT is just outside; finishes with its back just outside.
        const x0 = enter - EDGE_MARGIN - longest;
        const x1 = leave + EDGE_MARGIN;
        const periodS = (x1 - x0) / speed;
        const lanePhase = rand();
        shapes.forEach((shape, j) => {
            const phase = (lanePhase + (j + (rand() - 0.5) * PHASE_JITTER) / count + 1) % 1;
            clouds.push({ z: level.z, y, x0, x1, unitWidth: shape.unitWidth, units: shape.units, bridges: shape.bridges, periodS, phase });
        });
    }
    return clouds;
}
