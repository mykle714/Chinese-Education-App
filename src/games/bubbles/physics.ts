/**
 * Bubbles — the field simulation, shared by every bubble game.
 *
 * Pure functions over a `BubbleBody[]` plus a `Bounds`; no React, no game rules,
 * no knowledge of which game is running. Bubble Match's descending ceiling is
 * expressed entirely as the caller raising `bounds.top` between frames, which is
 * why this file has no ceiling concept of its own and Hydra (which has no
 * ceiling) can reuse it unchanged.
 *
 * Referenced by: src/games/bubble-match/BubbleStage.tsx,
 * src/__tests__/bubbleMatchSpawn.test.ts.
 * Docs: docs/GAMES_FEATURE.md, docs/HYDRA_BUBBLES.md.
 */
import type { BubbleBody } from "./types";
import {
    GROW_LERP,
    HELD_OVERDRAG_RADII,
    IDLE_SPEED,
    IDLE_SPEED_LERP,
    MAX_PUSH_SPEED,
    MAX_SPEED,
    RESTITUTION,
    SPAWN_MAX_ATTEMPTS,
    SPAWN_OVERLAP_FRACTION,
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

/** Per-game switches on the simulation. */
export interface StepOptions {
    /**
     * Whether settled bubbles WANDER (the lava-lamp float).
     *
     * Bubble Match drifts; Hydra Bubbles does not — its bubbles are placed and then
     * stay put (docs/HYDRA_BUBBLES.md § 1), because its tension comes from a board
     * that grows rather than a field that churns, and a drifting board would keep
     * re-arranging the spatial memory the player is building. Separation still runs
     * with drift off: a growing bubble must still shove its neighbors aside.
     */
    drift?: boolean;
}

export const randRange = (min: number, max: number, rng: Rng = Math.random): number =>
    min + rng() * (max - min);

/** A held bubble's hitbox is fully disabled: it passes through others untouched
    while the pointer drags it. */
const isHeld = (b: BubbleBody): boolean => b.status === "held";

/** A growing bubble (inflating in place from its seed toward targetRadius) is an
    infinite-mass obstacle: it shoves the bubbles it overlaps out of the way to
    make room as it grows, but is never pushed itself — it holds its chosen spot. */
const isGrowing = (b: BubbleBody): boolean => b.status === "growing";

/** Clamp a velocity vector's magnitude to MAX_SPEED in place, so a chain of
    bounces can never accelerate a bubble past a controllable drift. */
function clampSpeed(b: BubbleBody): void {
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        b.vx *= k;
        b.vy *= k;
    }
}

/**
 * Advance the simulation by `dt` seconds. Each frame we (1) inflate growing
 * bubbles toward their targetRadius, (2) drift every settled bubble — random
 * wander, speed eased toward IDLE_SPEED, position integrated — (3) clamp every
 * body inside the walls, reflecting its velocity off the ones it hits, and
 * (4) resolve pairwise overlap by positional separation (the push that lets a
 * growing bubble make room among its neighbors) plus an elastic velocity impulse
 * so drifting bubbles bounce off each other. Mutates `bodies` in place.
 *
 * The drift is deliberately tiny (every magnitude is scaled by DRIFT_SCALE, see
 * constants.ts) — it exists to keep the field alive, not to move bubbles across
 * the stage. Growing bubbles do not drift: they own their chosen spot until they
 * settle, at which point their pre-seeded velocity takes over.
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
export function stepPhysics(
    bodies: BubbleBody[],
    dt: number,
    bounds: Bounds,
    options: StepOptions = {}
): number {
    const drift = options.drift !== false;
    // --- Grow-in + drift + wall clamp ----------------------------------------
    for (const b of bodies) {
        // Held bubbles are positioned by the pointer; physics never moves them.
        if (b.status === "held") continue;

        // Growing bubbles inflate toward their target size, then settle to idle.
        // They stay infinite-mass while growing (see isGrowing) so they hold their
        // chosen spot and shove the neighbors they overlap outward. They do NOT
        // drift while growing — the seeded velocity only kicks in once settled.
        if (b.status === "growing") {
            b.radius += (b.targetRadius - b.radius) * GROW_LERP;
            if (b.targetRadius - b.radius <= 0.5) {
                b.radius = b.targetRadius;
                b.status = "idle";
            }
        } else if (!drift) {
            // Drift disabled: a settled bubble holds its position exactly. It is
            // still moved by the separation solver below (and by the wall clamp), so
            // a growing neighbor can push it — it simply has no motion of its own.
            b.vx = 0;
            b.vy = 0;
        } else {
            // Small random wander keeps the float lively and breaks up clusters.
            b.vx += randRange(-WANDER_ACCEL, WANDER_ACCEL) * dt;
            b.vy += randRange(-WANDER_ACCEL, WANDER_ACCEL) * dt;

            // Ease the speed back toward the idle drift target so bubbles never
            // fully stop and never run away (bounces briefly spike velocity).
            const sp = Math.hypot(b.vx, b.vy);
            if (sp > 0.001) {
                const k = (sp + (IDLE_SPEED - sp) * IDLE_SPEED_LERP) / sp;
                b.vx *= k;
                b.vy *= k;
            } else {
                // Dead stop (e.g. a freshly settled bubble whose seed cancelled
                // out): re-launch it in a random direction at the drift speed.
                const a = Math.random() * Math.PI * 2;
                b.vx = Math.cos(a) * IDLE_SPEED;
                b.vy = Math.sin(a) * IDLE_SPEED;
            }

            b.x += b.vx * dt;
            b.y += b.vy * dt;
            clampSpeed(b);
        }

        // Wall clamp — bring the center back inside bounds, reflecting the drift
        // velocity off whichever wall was hit so the bubble bounces instead of
        // sticking.
        //
        // LEFT / RIGHT / BOTTOM all GLIDE the body back at MAX_PUSH_SPEED*dt rather
        // than snapping it, honoring the same shove speed cap as the separation
        // solver. Snapping was fine while those side walls only ever corrected a
        // drift step or a sub-pixel separation overshoot — but a bubble RELEASED past
        // a wall (see clampHeldCenter) can sit a full radius outside it, and
        // teleporting it back reads as a glitch where the same distance travelled
        // reads as a spring.
        //
        // Only the reversal is asymmetric: flipping a velocity that ALREADY points
        // back into the field would fight the glide, so each wall reverses only the
        // component still heading further out.
        if (b.x - b.radius < 0) {
            const overshoot = b.radius - b.x;
            b.x += Math.min(overshoot, MAX_PUSH_SPEED * dt);
            if (b.vx < 0) b.vx = -b.vx * RESTITUTION;
        } else if (b.x + b.radius > bounds.width) {
            const overshoot = b.x + b.radius - bounds.width;
            b.x -= Math.min(overshoot, MAX_PUSH_SPEED * dt);
            if (b.vx > 0) b.vx = -b.vx * RESTITUTION;
        }
        // Top is the descending ceiling: snap a body that pokes above it back down.
        // (It only rises a few px/frame, so this is a sub-pixel-ish correction that
        // gently presses the field down as the ceiling closes in.)
        if (b.y - b.radius < bounds.top) {
            b.y = bounds.top + b.radius;
            b.vy = Math.abs(b.vy) * RESTITUTION;
        } else if (b.y + b.radius > bounds.height) {
            const overshoot = b.y + b.radius - bounds.height;
            b.y -= Math.min(overshoot, MAX_PUSH_SPEED * dt);
            // Only reverse a downward drift — the glide above already carries the
            // bubble back up, and flipping an upward velocity would fight it.
            if (b.vy > 0) b.vy = -b.vy * RESTITUTION;
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

            // Velocity impulse along the collision normal (elastic, mass-weighted)
            // so two drifting bubbles bounce off each other rather than grinding
            // together while the positional solver keeps prying them apart. A
            // growing bubble has invMass 0, so it imparts a bounce without taking
            // one. Skipped when the pair is already separating.
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
