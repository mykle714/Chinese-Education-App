import type { BubbleBody } from "./types";
import {
    IDLE_SPEED,
    RESTITUTION,
    WANDER_ACCEL,
    MAX_SPEED,
    ENTER_SPEED,
    ENTER_MARGIN,
    ENTRY_INSET,
} from "./constants";

export interface Bounds {
    width: number;
    height: number;
}

export const randRange = (min: number, max: number): number => min + Math.random() * (max - min);

/** A held bubble's hitbox is fully disabled: it passes through others untouched
    while the pointer drags it. */
const isHeld = (b: BubbleBody): boolean => b.status === "held";

/** An entering bubble (flying in from off-screen toward its target) is an
    infinite-mass obstacle: it shoves floaters out of its path but is never moved
    by them. The entry path — not the collision solver — owns its position. */
const isEntering = (b: BubbleBody): boolean => b.status === "entering";

/** Clamp a velocity vector's magnitude to MAX_SPEED in place. */
function clampSpeed(b: BubbleBody): void {
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        b.vx *= k;
        b.vy *= k;
    }
}

/**
 * Advance the simulation by `dt` seconds: integrate motion, apply a gentle
 * random wander so idle bubbles keep drifting like lava-lamp bubbles, bounce
 * off the stage walls, then resolve pairwise elastic (momentum-preserving)
 * collisions. Mutates `bodies` in place.
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
    // --- Integrate + wander + wall bounce -----------------------------------
    for (const b of bodies) {
        // Held bubbles are positioned by the pointer; physics never moves them.
        if (b.status === "held") continue;

        // Entering bubbles fly straight from off-screen to their target spot at a
        // fixed speed, ignoring walls/wander. They're infinite-mass during this
        // (see isEntering), so they bulldoze any floaters in the way. On arrival
        // they become a normal idle bubble that keeps coasting in the launch
        // direction (vx/vy below already point along the entry path).
        if (b.status === "entering") {
            const tx = b.targetX ?? b.x;
            const ty = b.targetY ?? b.y;
            const dx = tx - b.x;
            const dy = ty - b.y;
            const dist = Math.hypot(dx, dy);
            const step = ENTER_SPEED * dt;
            if (dist <= step || dist === 0) {
                // Arrived: snap onto the target and start floating. Keep the entry
                // velocity (set to entry-direction × ENTER_SPEED on every prior
                // frame) so the bubble carries its launch momentum inward instead
                // of darting off randomly. The MAX_SPEED clamp + idle-speed nudge
                // (below) ease it down to normal drift over the next frames.
                b.x = tx;
                b.y = ty;
                b.targetX = null;
                b.targetY = null;
                b.status = "idle";
            } else {
                const k = step / dist;
                b.x += dx * k;
                b.y += dy * k;
                // Keep velocity pointing along the entry path (used as throw seed
                // if the player grabs it the instant it settles).
                b.vx = (dx / dist) * ENTER_SPEED;
                b.vy = (dy / dist) * ENTER_SPEED;
            }
            continue;
        }

        // Small random wander keeps the float lively and breaks up clusters.
        b.vx += randRange(-WANDER_ACCEL, WANDER_ACCEL) * dt;
        b.vy += randRange(-WANDER_ACCEL, WANDER_ACCEL) * dt;

        // Nudge speed toward the idle drift target so bubbles never fully stop
        // and never run away (collisions can briefly spike velocity).
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 0.001) {
            const target = sp + (IDLE_SPEED - sp) * 0.02;
            const k = target / sp;
            b.vx *= k;
            b.vy *= k;
        } else {
            const a = Math.random() * Math.PI * 2;
            b.vx = Math.cos(a) * IDLE_SPEED;
            b.vy = Math.sin(a) * IDLE_SPEED;
        }

        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // Wall bounce — reflect and pin inside bounds.
        if (b.x - b.radius < 0) {
            b.x = b.radius;
            b.vx = Math.abs(b.vx) * RESTITUTION;
        } else if (b.x + b.radius > bounds.width) {
            b.x = bounds.width - b.radius;
            b.vx = -Math.abs(b.vx) * RESTITUTION;
        }
        if (b.y - b.radius < 0) {
            b.y = b.radius;
            b.vy = Math.abs(b.vy) * RESTITUTION;
        } else if (b.y + b.radius > bounds.height) {
            b.y = bounds.height - b.radius;
            b.vy = -Math.abs(b.vy) * RESTITUTION;
        }

        clampSpeed(b);
    }

    // --- Pairwise elastic collisions ----------------------------------------
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

            // Two entering bubbles can overlap but aren't separable — don't let
            // them inflate the residual (they own their own positions).
            if (!(isEntering(a) && isEntering(b))) residual += minDist - dist;

            const nx = dx / dist;
            const ny = dy / dist;

            // Inverse masses for the mass-weighted impulse/separation. An entering
            // bubble is infinite-mass (invMass 0): it pushes the other out of the
            // way and takes none of the push back.
            const invA = isEntering(a) ? 0 : 1 / a.mass;
            const invB = isEntering(b) ? 0 : 1 / b.mass;
            const invSum = invA + invB;
            if (invSum === 0) continue; // both entering: nothing to resolve

            // Positional separation, distributed by inverse mass.
            const overlap = minDist - dist;
            a.x -= nx * overlap * (invA / invSum);
            a.y -= ny * overlap * (invA / invSum);
            b.x += nx * overlap * (invB / invSum);
            b.y += ny * overlap * (invB / invSum);

            // Velocity impulse along the collision normal (elastic, mass-weighted).
            const rvx = b.vx - a.vx;
            const rvy = b.vy - a.vy;
            const velAlongNormal = rvx * nx + rvy * ny;
            if (velAlongNormal > 0) continue; // already separating

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
 * Plan a launch: pick a random entry edge and return both the off-screen `start`
 * and the `target` just inside that wall (aligned on the entry axis). The caller
 * sets status `entering`; the physics loop walks the bubble from start to target
 * as an infinite-mass body, shoving any floaters in its path inward — so bubbles
 * pile in from the edges and there's no free-spot search to fail. Overfill (game
 * over) is decided separately by area packing + residual overlap, not here.
 */
export function planEntry(
    radius: number,
    bounds: Bounds
): { start: { x: number; y: number }; target: { x: number; y: number } } {
    const off = radius + ENTER_MARGIN; // how far beyond the wall the bubble starts
    const inset = radius + ENTRY_INSET; // target center: one radius + a small gap off the wall
    switch (Math.floor(Math.random() * 4)) {
        case 0: {
            // from the left
            const y = randRange(radius, bounds.height - radius);
            return { start: { x: -off, y }, target: { x: inset, y } };
        }
        case 1: {
            // from the right
            const y = randRange(radius, bounds.height - radius);
            return { start: { x: bounds.width + off, y }, target: { x: bounds.width - inset, y } };
        }
        case 2: {
            // from the top
            const x = randRange(radius, bounds.width - radius);
            return { start: { x, y: -off }, target: { x, y: inset } };
        }
        default: {
            // from the bottom
            const x = randRange(radius, bounds.width - radius);
            return { start: { x, y: bounds.height + off }, target: { x, y: bounds.height - inset } };
        }
    }
}

/**
 * Total fraction of stage area currently covered by bubbles (for the red glow).
 * Entering bubbles are excluded — they're still (partly) off-screen, so counting
 * them would inflate the ratio and trip the danger glow prematurely.
 */
export function fillRatio(bodies: BubbleBody[], bounds: Bounds): number {
    const stageArea = bounds.width * bounds.height;
    if (stageArea === 0) return 0;
    const bubbleArea = bodies.reduce(
        (sum, b) => (b.status === "entering" ? sum : sum + Math.PI * b.radius * b.radius),
        0
    );
    return bubbleArea / stageArea;
}
