/**
 * Bubbles — the field simulation, shared by every bubble game.
 *
 * Pure functions over a `BubbleBody[]` plus a `Bounds`; no React, no game rules,
 * no knowledge of which game is running. Bubble Match's descending ceiling is
 * expressed entirely as the caller raising `bounds.top` between frames, which is
 * why this file has no ceiling concept of its own and Hydra (which has no
 * ceiling) can reuse it unchanged.
 *
 * Both games run the identical simulation: drift + air-hockey throw momentum.
 *
 * Referenced by: src/games/bubble-match/BubbleStage.tsx,
 * src/games/hydra-bubbles/HydraStage.tsx, src/__tests__/bubbleMatchSpawn.test.ts.
 * Docs: docs/GAMES_FEATURE.md, docs/HYDRA_BUBBLES.md.
 */
import type { BubbleBody } from "./types";
import {
    DRIFT_MAX_SPEED,
    GROW_LERP,
    HELD_OVERDRAG_RADII,
    IDLE_SPEED,
    IDLE_SPEED_LERP,
    MAX_PUSH_SPEED,
    MAX_SUBSTEPS,
    RESTITUTION,
    SPAWN_MAX_ATTEMPTS,
    SPAWN_OVERLAP_FRACTION,
    SUBSTEP_TRAVEL_FRACTION,
    THROW_FRICTION,
    THROW_MAX_SPEED,
    WANDER_ACCEL,
} from "./constants";

export interface Bounds {
    width: number;
    /** Top wall (px from the stage's top edge). 0 at the start of a run; rises
        as the descending ceiling closes in once the whole pool has launched, so
        the play area is the band [top, height]. */
    top: number;
    height: number;
}

export type Rng = () => number;

export const randRange = (min: number, max: number, rng: Rng = Math.random): number =>
    min + rng() * (max - min);

/** A held bubble's hitbox is fully disabled: it passes through others untouched
    while the pointer drags it. */
const isHeld = (b: BubbleBody): boolean => b.status === "held";

/** A growing bubble (inflating in place from its seed toward targetRadius) is an
    infinite-mass obstacle: it shoves the bubbles it overlaps out of the way to
    make room as it grows, but is never pushed itself — it holds its chosen spot. */
const isGrowing = (b: BubbleBody): boolean => b.status === "growing";

/** Clamp a velocity vector's magnitude to THROW_MAX_SPEED in place — the one hard
    speed cap, applied to a release and after every bounce, so no chain of
    collisions can ever launch a bubble faster than the hardest throw. */
function clampSpeed(b: BubbleBody): void {
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > THROW_MAX_SPEED) {
        const k = THROW_MAX_SPEED / sp;
        b.vx *= k;
        b.vy *= k;
    }
}

/**
 * Advance one settled bubble's VELOCITY by a frame. Two regimes, split on
 * DRIFT_MAX_SPEED:
 *
 *   * GLIDING (faster than the drift ceiling) — the bubble was thrown or was struck
 *     by a thrown one. Only exponential friction acts: no wander (it would read as a
 *     wobble on a puck) and no ease toward IDLE_SPEED (that is a per-frame lerp that
 *     would brake a throw in well under a second). It coasts until it crosses back
 *     under the ceiling.
 *   * DRIFTING — the original lava-lamp float: a small random wander, with the speed
 *     eased toward IDLE_SPEED so bubbles never fully stop and never run away.
 *
 * The handoff is smooth because the two decay rates are close (THROW_FRICTION 1.8/s
 * vs IDLE_SPEED_LERP ≈ 1.2/s at 60 fps).
 */
function updateVelocity(b: BubbleBody, dt: number): void {
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > DRIFT_MAX_SPEED) {
        const k = Math.exp(-THROW_FRICTION * dt);
        b.vx *= k;
        b.vy *= k;
        return;
    }

    // Small random wander keeps the float lively and breaks up clusters.
    b.vx += randRange(-WANDER_ACCEL, WANDER_ACCEL) * dt;
    b.vy += randRange(-WANDER_ACCEL, WANDER_ACCEL) * dt;

    const drifting = Math.hypot(b.vx, b.vy);
    if (drifting > 0.001) {
        // Ease the speed back toward the idle drift target (bounces briefly spike it).
        const k = (drifting + (IDLE_SPEED - drifting) * IDLE_SPEED_LERP) / drifting;
        b.vx *= k;
        b.vy *= k;
    } else {
        // Dead stop (a freshly settled bubble whose seed cancelled out, or a bubble
        // released with no throw): re-launch it in a random direction at drift speed.
        const a = Math.random() * Math.PI * 2;
        b.vx = Math.cos(a) * IDLE_SPEED;
        b.vy = Math.sin(a) * IDLE_SPEED;
    }
}

/**
 * Keep one body inside the walls for a substep of length `h`.
 *
 * LEFT / RIGHT / BOTTOM have TWO behaviours, chosen by where the body was at the
 * start of the substep (`prevX`/`prevY`):
 *
 *   * It was INSIDE and its own motion carried it out — a bounce. The position is
 *     MIRRORED back across the wall and the outward velocity component reflected.
 *     Mirroring (rather than gliding) matters for a thrown bubble: at throw speed a
 *     substep can overshoot tens of px, and gliding that back at MAX_PUSH_SPEED reads
 *     as the puck sinking into a cushion instead of cracking off it.
 *   * It was ALREADY OUTSIDE — released past a wall (see clampHeldCenter), or shoved
 *     out by the separation solver. It GLIDES back at MAX_PUSH_SPEED, honoring the
 *     same shove cap as separation; teleporting a bubble a full radius reads as a
 *     glitch where the same distance travelled reads as a spring. Only the velocity
 *     component still heading further out is reversed, so the reversal never fights
 *     the glide.
 *
 * TOP is the descending ceiling (Bubble Match) and always SNAPS: it only rises a few
 * px per frame, so the correction is tiny and gently presses the field down.
 */
function clampToWalls(b: BubbleBody, bounds: Bounds, h: number, prevX: number, prevY: number): void {
    const glide = MAX_PUSH_SPEED * h;
    const r = b.radius;

    if (b.x - r < 0) {
        if (prevX - r >= 0 && b.vx < 0) {
            b.x = 2 * r - b.x; // mirror across x = r
            b.vx = -b.vx * RESTITUTION;
        } else {
            b.x += Math.min(r - b.x, glide);
            if (b.vx < 0) b.vx = -b.vx * RESTITUTION;
        }
    } else if (b.x + r > bounds.width) {
        const wall = bounds.width - r;
        if (prevX + r <= bounds.width && b.vx > 0) {
            b.x = 2 * wall - b.x; // mirror across x = width − r
            b.vx = -b.vx * RESTITUTION;
        } else {
            b.x -= Math.min(b.x - wall, glide);
            if (b.vx > 0) b.vx = -b.vx * RESTITUTION;
        }
    }

    if (b.y - r < bounds.top) {
        b.y = bounds.top + r;
        b.vy = Math.abs(b.vy) * RESTITUTION;
    } else if (b.y + r > bounds.height) {
        const floor = bounds.height - r;
        if (prevY + r <= bounds.height && b.vy > 0) {
            // Mirror, but never above the ceiling on a very squat field.
            b.y = Math.max(bounds.top + r, 2 * floor - b.y);
            b.vy = -b.vy * RESTITUTION;
        } else {
            b.y -= Math.min(b.y - floor, glide);
            if (b.vy > 0) b.vy = -b.vy * RESTITUTION;
        }
    }
}

/**
 * One substep of pairwise collision: positional separation (the push that lets a
 * growing bubble make room among its neighbors) plus an elastic, mass-weighted
 * velocity impulse so moving bubbles bounce off each other — which is also what
 * makes a thrown bubble knock the ones it hits into motion.
 *
 * Returns the summed overlap depth measured BEFORE separating (see stepPhysics).
 */
function resolvePairs(bodies: BubbleBody[], h: number): number {
    let residual = 0;
    const maxStep = MAX_PUSH_SPEED * h;
    for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
            const a = bodies[i];
            const b = bodies[j];
            // Held bubbles pass through everything (hitbox disabled while dragged).
            if (isHeld(a) || isHeld(b)) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            const minDist = a.radius + b.radius;
            if (dist >= minDist || dist === 0) continue;

            // Two growing bubbles can overlap but aren't separable — don't let
            // them inflate the residual (they each own their own positions).
            if (!(isGrowing(a) && isGrowing(b))) residual += minDist - dist;

            const nx = dx / dist;
            const ny = dy / dist;

            // Inverse masses for the mass-weighted separation. A growing bubble is
            // infinite-mass (invMass 0): it pushes the other out of the way and
            // takes none of the push back — and a thrown bubble bounces off it.
            const invA = isGrowing(a) ? 0 : 1 / a.mass;
            const invB = isGrowing(b) ? 0 : 1 / b.mass;
            const invSum = invA + invB;
            if (invSum === 0) continue; // both growing: nothing to resolve

            // Positional separation, distributed by inverse mass. Each body's shove is
            // capped at MAX_PUSH_SPEED per second so a pushed bubble glides toward its
            // separated spot instead of snapping there; any remaining overlap
            // resolves next substep. (A fast collision is separated mostly by the
            // impulse below — the bodies fly apart on their own reflected velocity.)
            const overlap = minDist - dist;
            const moveA = Math.min(overlap * (invA / invSum), maxStep);
            const moveB = Math.min(overlap * (invB / invSum), maxStep);
            a.x -= nx * moveA;
            a.y -= ny * moveA;
            b.x += nx * moveB;
            b.y += ny * moveB;

            // Velocity impulse along the collision normal. Skipped when the pair is
            // already separating, so an overlap left by a drop never "sticks".
            const velAlongNormal = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (velAlongNormal >= 0) continue;
            const impulse = (-(1 + RESTITUTION) * velAlongNormal) / invSum;
            a.vx -= impulse * invA * nx;
            a.vy -= impulse * invA * ny;
            b.vx += impulse * invB * nx;
            b.vy += impulse * invB * ny;
            clampSpeed(a);
            clampSpeed(b);
        }
    }
    return residual;
}

/**
 * Advance the simulation by `dt` seconds. Mutates `bodies` in place.
 *
 * ONCE PER FRAME: (1) inflate growing bubbles toward their targetRadius, and
 * (2) update every settled bubble's velocity — drift or glide, see updateVelocity.
 * Both of those are per-FRAME lerps (GROW_LERP, IDLE_SPEED_LERP), which is why they
 * sit outside the substep loop: running them per substep would make a frame with a
 * throw in it grow and ease several times faster than a quiet one.
 *
 * THEN, IN SUBSTEPS: (3) integrate positions, (4) wall-clamp, (5) resolve pairs.
 * The substep count scales with the fastest body so it never travels more than
 * SUBSTEP_TRAVEL_FRACTION of the smallest bubble's radius per substep — a thrown
 * bubble cannot tunnel through a neighbor. A quiet field (drift only) always runs a
 * single substep, i.e. exactly the pre-throw simulation.
 *
 * A held bubble has its hitbox fully disabled: it neither moves nor collides, so
 * the player can drag it freely through the field without shoving anyone. Once it's
 * dropped it rejoins, carrying whatever release velocity the stage gave it
 * (throwTracker.ts), and any overlap is pushed apart on the following frames.
 *
 * Growing bubbles do not integrate velocity: they own their chosen spot until they
 * settle, at which point their pre-seeded drift velocity takes over.
 *
 * Returns the total *residual penetration* (px) — the sum of overlap depths over
 * all colliding pairs, measured in the FIRST substep, i.e. before this frame's
 * separation. When the field is over-packed the solver can't fully separate
 * everyone, so this stays high frame after frame; Bubble Match uses a
 * sustained-residual threshold as an overfill (game-over) safety net.
 */
export function stepPhysics(bodies: BubbleBody[], dt: number, bounds: Bounds): number {
    // --- Per-frame: grow-in + velocity ---------------------------------------
    let fastest = 0;
    let smallest = Infinity;
    for (const b of bodies) {
        if (isHeld(b)) continue; // positioned by the pointer; physics never moves it
        if (isGrowing(b)) {
            b.radius += (b.targetRadius - b.radius) * GROW_LERP;
            if (b.targetRadius - b.radius <= 0.5) {
                b.radius = b.targetRadius;
                b.status = "idle";
            }
        } else {
            updateVelocity(b, dt);
            fastest = Math.max(fastest, Math.hypot(b.vx, b.vy));
        }
        // targetRadius, not radius: a 4px growing seed would otherwise demand a
        // dozen substeps every time anything drifts.
        smallest = Math.min(smallest, b.targetRadius);
    }

    const maxTravel = smallest * SUBSTEP_TRAVEL_FRACTION;
    const substeps = Number.isFinite(maxTravel) && maxTravel > 0
        ? Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((fastest * dt) / maxTravel)))
        : 1;
    const h = dt / substeps;

    // --- Per-substep: integrate + walls + pairs ------------------------------
    let residual = 0;
    for (let s = 0; s < substeps; s++) {
        for (const b of bodies) {
            if (isHeld(b)) continue;
            const prevX = b.x;
            const prevY = b.y;
            if (!isGrowing(b)) {
                b.x += b.vx * h;
                b.y += b.vy * h;
            }
            clampToWalls(b, bounds, h, prevX, prevY);
        }
        const r = resolvePairs(bodies, h);
        if (s === 0) residual = r;
    }
    return residual;
}

/**
 * Where a HELD bubble's center is allowed to be.
 *
 * A held bubble is positioned by the pointer and skipped by `stepPhysics`, so this is
 * the only thing bounding it — and it is deliberately LOOSER than the walls that bound
 * a settled body. Left, right and bottom all give by the same `HELD_OVERDRAG_RADII`,
 * measured from the STAGE edge rather than the play floor, so the bubble can be pulled
 * clean off any of the three and springs back identically. The top is walled at the
 * stage edge; see that constant for why.
 *
 * Note the asymmetry that survives here: the bottom's give is measured from
 * `fullHeight` (the stage, strip included) and NOT from `bounds.height` (the play
 * floor), which is what lets a bubble sit fully inside the cancel strip *and* keep
 * going. The sides have no strip, so their play wall and their stage edge are the same
 * line.
 *
 * Extracted here because BubbleStage and HydraStage had this expression written out
 * twice, identically — which is exactly how the two fields would have drifted apart the
 * first time either was tuned.
 *
 * @param fullHeight measured stage height INCLUDING the cancel strip.
 */
export function clampHeldCenter(
    body: BubbleBody,
    bounds: Bounds,
    fullHeight: number,
    x: number,
    y: number
): { x: number; y: number } {
    const slack = body.radius * HELD_OVERDRAG_RADII;
    return {
        x: Math.max(-slack, Math.min(bounds.width + slack, x)),
        // Top: no give (the ceiling is a mechanic). Bottom: the same give as the sides,
        // taken from the stage edge, so the strip is passed through rather than stopped at.
        y: Math.max(body.radius, Math.min(fullHeight + slack, y)),
    };
}

/**
 * Pick where a new bubble should appear. Tries up to SPAWN_MAX_ATTEMPTS random
 * centers inside the stage (inset by `targetRadius` so the full-size bubble fits
 * within the walls) and returns the first that satisfies the "20% rule": at full
 * size the new bubble may penetrate any existing bubble by at most
 * SPAWN_OVERLAP_FRACTION of *that* bubble's diameter.
 *
 * Held bubbles are ignored (transient — the player owns them). The new bubble
 * then grows in place and its infinite-mass shove resolves the small overlap the
 * rule allows. If the board is so full that no candidate clears the rule, we
 * return the least-bad spot (smallest worst-overlap ratio) anyway so the field
 * can still over-pack and trip the overfill loss.
 *
 * `rng` is injectable (defaults to Math.random) for deterministic unit tests.
 */
export function planSpawn(
    targetRadius: number,
    bounds: Bounds,
    bodies: BubbleBody[],
    rng: Rng = Math.random
): { x: number; y: number } {
    const others = bodies.filter((b) => !isHeld(b));

    let best: { x: number; y: number } | null = null;
    let bestWorstRatio = Infinity;

    for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
        const x = randRange(targetRadius, Math.max(targetRadius, bounds.width - targetRadius), rng);
        // Inset by the (descending) top wall as well as the bottom — though in
        // practice the whole pool has launched before the ceiling starts moving.
        const yLo = bounds.top + targetRadius;
        const y = randRange(yLo, Math.max(yLo, bounds.height - targetRadius), rng);

        // Worst overlap ratio across all existing bubbles for this candidate. The
        // ratio is penetration / other.diameter; the rule passes when it stays
        // ≤ SPAWN_OVERLAP_FRACTION for every existing bubble.
        let worstRatio = 0;
        for (const o of others) {
            const dist = Math.hypot(x - o.x, y - o.y);
            const penetration = targetRadius + o.radius - dist;
            if (penetration <= 0) continue; // no overlap with this one
            const ratio = penetration / (2 * o.radius);
            if (ratio > worstRatio) worstRatio = ratio;
        }

        if (worstRatio <= SPAWN_OVERLAP_FRACTION) return { x, y }; // clears the 20% rule
        if (worstRatio < bestWorstRatio) {
            bestWorstRatio = worstRatio;
            best = { x, y };
        }
    }

    // Board too full for any spot to clear the rule — place at the least-bad one.
    return best ?? { x: bounds.width / 2, y: bounds.height / 2 };
}

/**
 * Total fraction of stage area currently covered by bubbles (for the red glow
 * and the overfill loss). Counts every bubble by its *current* radius, so a
 * still-growing bubble contributes only its (small) inflated-so-far area.
 */
export function fillRatio(bodies: BubbleBody[], bounds: Bounds): number {
    // Coverage is measured against the *live* play area [top, height], so as the
    // ceiling descends the same bubbles cover a larger fraction — which is exactly
    // what drives the field toward the overfill loss.
    const stageArea = bounds.width * (bounds.height - bounds.top);
    if (stageArea <= 0) return 1;
    const bubbleArea = bodies.reduce((sum, b) => sum + Math.PI * b.radius * b.radius, 0);
    return bubbleArea / stageArea;
}
