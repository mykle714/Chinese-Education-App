import type { BubbleBody } from "./types";
import { GROW_LERP, MAX_PUSH_SPEED, SPAWN_MAX_ATTEMPTS, SPAWN_OVERLAP_FRACTION } from "./constants";

export interface Bounds {
    width: number;
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

/**
 * Advance the simulation by `dt` seconds. There is NO velocity model: bubbles
 * don't drift, bounce, or get thrown. Each frame we only (1) inflate growing
 * bubbles toward their targetRadius, (2) clamp every body inside the walls, and
 * (3) resolve pairwise overlap by positional separation (the push that lets a
 * growing bubble make room among its neighbors). Mutates `bodies` in place.
 *
 * A held bubble has its hitbox fully disabled: it neither moves nor collides,
 * so the player can drag it freely through the field without shoving anyone.
 * Once it's dropped (status leaves `held`) it rejoins collision resolution, and
 * any overlap created by a wrong drop is pushed apart on the following frames.
 *
 * Returns the total *residual penetration* (px) — the sum of overlap depths over
 * all colliding pairs, measured before this frame's separation. When the field
 * is over-packed the solver can't fully separate everyone, so this stays high
 * frame after frame; the caller uses a sustained-residual threshold as an
 * overfill (game-over) safety net alongside the area-packing check.
 */
export function stepPhysics(bodies: BubbleBody[], dt: number, bounds: Bounds): number {
    // --- Grow-in + wall clamp -----------------------------------------------
    for (const b of bodies) {
        // Held bubbles are positioned by the pointer; physics never moves them.
        if (b.status === "held") continue;

        // Growing bubbles inflate toward their target size, then settle to idle.
        // They stay infinite-mass while growing (see isGrowing) so they hold their
        // chosen spot and shove the neighbors they overlap outward.
        if (b.status === "growing") {
            b.radius += (b.targetRadius - b.radius) * GROW_LERP;
            if (b.targetRadius - b.radius <= 0.5) {
                b.radius = b.targetRadius;
                b.status = "idle";
            }
        }

        // Wall clamp — pin the center inside bounds (position only, no bounce).
        // Top/left/right snap (they only ever correct sub-pixel separation
        // overshoot). The bottom is the cancel-strip boundary: a bubble released in
        // the strip can sit well below it, so push it back up at MAX_PUSH_SPEED*dt
        // rather than snapping — it glides into play, honoring the same shove speed
        // cap as the separation solver.
        if (b.x - b.radius < 0) b.x = b.radius;
        else if (b.x + b.radius > bounds.width) b.x = bounds.width - b.radius;
        if (b.y - b.radius < 0) b.y = b.radius;
        else if (b.y + b.radius > bounds.height) {
            const overshoot = b.y + b.radius - bounds.height;
            b.y -= Math.min(overshoot, MAX_PUSH_SPEED * dt);
        }
    }

    // --- Pairwise positional separation -------------------------------------
    // Accumulate how deeply pairs overlap *before* we separate them this frame.
    // In a resolvable field this trends to ~0; in an over-packed one it persists.
    let residual = 0;
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
            // takes none of the push back.
            const invA = isGrowing(a) ? 0 : 1 / a.mass;
            const invB = isGrowing(b) ? 0 : 1 / b.mass;
            const invSum = invA + invB;
            if (invSum === 0) continue; // both growing: nothing to resolve

            // Positional separation, distributed by inverse mass. Each body's
            // per-frame shove is capped at MAX_PUSH_SPEED*dt so a pushed bubble
            // glides toward its separated spot over several frames instead of
            // snapping there instantly; any remaining overlap resolves next frame.
            const overlap = minDist - dist;
            const maxStep = MAX_PUSH_SPEED * dt;
            const moveA = Math.min(overlap * (invA / invSum), maxStep);
            const moveB = Math.min(overlap * (invB / invSum), maxStep);
            a.x -= nx * moveA;
            a.y -= ny * moveA;
            b.x += nx * moveB;
            b.y += ny * moveB;
        }
    }

    return residual;
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
        const y = randRange(targetRadius, Math.max(targetRadius, bounds.height - targetRadius), rng);

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
    const stageArea = bounds.width * bounds.height;
    if (stageArea === 0) return 0;
    const bubbleArea = bodies.reduce((sum, b) => sum + Math.PI * b.radius * b.radius, 0);
    return bubbleArea / stageArea;
}
