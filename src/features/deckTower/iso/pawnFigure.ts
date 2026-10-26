import type { Projector, Pt } from "./geometry";

/**
 * pawnFigure.ts — the IsoPawn's body as a true 3D figure, projected through whatever
 * camera the scene has (docs/ISO_ART_FRAMEWORK.md § "IsoPawn" → "View").
 *
 * The pawn is a vertical CAPSULE (the pill body) under a SPHERE (the ball head). Both
 * project the same way under any camera: a sphere's outline is a circle round its
 * projected centre, `radius · facingScaleAt` across, and a capsule's outline is the hull
 * of its two end spheres' circles. So the figure is drawn as one hull path and one circle,
 * recomputed every frame — and seen from straight above (the Deck Tower's study camera,
 * docs/DECK_TOWER.md § "Studying the tower") it reads as what it is: a round head with the
 * body peeking out on the side away from the camera's centre, instead of a 2D pill
 * sheared flat onto the floor.
 *
 * Calibrated to the fixed dimetric view: there the figure is pixel-for-pixel the old
 * screen-space pill (BODY_WIDTH × BODY_HEIGHT, rx = half the width) and ball, and the
 * pose's `lean` is the same screen rotation about the feet. Heights are in world z (one z
 * unit = `unit` px in that view); radii are camera-facing world units, which that view
 * draws at unit·√2 (geometry.ts → `Projector.facingScaleAt`) — hence the √2 below.
 *
 * Pure: no React, no DOM. Depended on by: iso/usePawnMotion.ts (writes it every frame),
 * iso/IsoPawn.tsx (the elements it is written onto). Docs: docs/ISO_ART_FRAMEWORK.md
 * § "IsoPawn".
 */

/** The fixed view's screen sizes, in `unit`s — what the pawn looked like as a 2D pill. */
const BODY_WIDTH = 0.78;
const BODY_HEIGHT = 1.5;
const HEAD_SCREEN_RADIUS = 0.44;
/** The head's centre sits this far (in head radii) above the body's top: it overlaps the body a little. */
const HEAD_RISE = 0.55;
/** Gap between the head's top and the "!" bubble's tail tip, in `unit`s of the fixed view. */
const EMOTE_SCREEN_GAP = 0.3;

/** World radius of the body's end spheres (camera-facing units). */
const BODY_RADIUS = BODY_WIDTH / 2 / Math.SQRT2;
/** Height of the bottom end sphere's centre above the feet: its outline touches the feet in the fixed view. */
const BODY_FOOT_CENTRE = BODY_WIDTH / 2;
export const HEAD_RADIUS = HEAD_SCREEN_RADIUS / Math.SQRT2;
const HEAD_CENTRE = BODY_HEIGHT + HEAD_RISE * HEAD_SCREEN_RADIUS;
export const EMOTE_GAP = EMOTE_SCREEN_GAP / Math.SQRT2;

/** The pose usePawnMotion animates: the same numbers that used to drive the 2D transforms. */
export interface PawnPose {
    /** Degrees of tilt about the feet; + tips the top toward screen-right in the fixed view. */
    lean: number;
    /** Width squash/stretch (1 = rest). */
    sx: number;
    /** Height squash/stretch (1 = rest). */
    sy: number;
}

export const REST_POSE: PawnPose = { lean: 0, sx: 1, sy: 1 };

export interface PawnFigure {
    /** The body's outline (an SVG path `d`). */
    bodyPath: string;
    /** The head's projected circle. */
    head: { cx: number; cy: number; r: number };
    /** Screen px per facing world unit at the head (sizes the "!" bubble). */
    headScale: number;
}

/**
 * The figure of a pawn whose feet are at world `feet`, in `pose`, under `proj`.
 *
 * Lean tilts the body's axis toward world (1, −1) — the direction the fixed view draws
 * as screen-right — by `lean` degrees as seen in that view: a point h z-units up the axis
 * moves h·sin θ/√2 along (1, −1)/√2 (drawn at √2 · unit px per world unit) and h·cos θ up.
 * Squash scales the axis by `sy` and the radii by `sx` (the head by √(sx·sy), so it keeps
 * its area rather than ballooning) — an approximation of the old 2D scale, which turned
 * the ends into ellipses; the squashes are brief enough that circles read the same.
 */
export function pawnFigure(proj: Projector, feet: { x: number; y: number; z: number }, pose: PawnPose): PawnFigure {
    const tilt = (pose.lean * Math.PI) / 180;
    const upward = Math.cos(tilt);
    // Per z unit up the axis: along each of world x and −y (the fixed view's screen-right).
    const dx = Math.sin(tilt) / 2;
    const dy = -Math.sin(tilt) / 2;
    const along = (h: number) => ({ x: feet.x + h * dx, y: feet.y + h * dy, z: feet.z + h * upward });
    const projected = (h: number, radius: number) => {
        const w = along(h);
        const c = proj.project(w.x, w.y, w.z);
        const k = proj.facingScaleAt(w.x, w.y, w.z);
        return { c, r: radius * k, k };
    };
    const bottomH = BODY_FOOT_CENTRE * pose.sx;
    const topH = Math.max(bottomH, BODY_HEIGHT * pose.sy - BODY_FOOT_CENTRE * pose.sx);
    const bodyRadius = BODY_RADIUS * pose.sx;
    const bottom = projected(bottomH, bodyRadius);
    const top = projected(topH, bodyRadius);
    const head = projected(HEAD_CENTRE * pose.sy, HEAD_RADIUS * Math.sqrt(pose.sx * pose.sy));
    return {
        bodyPath: circleHullPath(bottom.c, bottom.r, top.c, top.r),
        head: { cx: head.c.x, cy: head.c.y, r: head.r },
        headScale: head.k,
    };
}

/** A circle as a path (two half arcs). */
function circlePath(c: Pt, r: number): string {
    return `M ${c.x + r} ${c.y} A ${r} ${r} 0 1 0 ${c.x - r} ${c.y} A ${r} ${r} 0 1 0 ${c.x + r} ${c.y} Z`;
}

/**
 * The convex hull of two circles — the outline of a capsule whose end spheres project to
 * them. The two outer tangents touch each circle at ±φ from the line between the centres,
 * where cos φ = (ra − rb) / distance; the hull runs along one tangent, round B's far side,
 * back along the other and round A's far side. When one circle swallows the other (the
 * capsule seen end-on, from straight above) it is just the bigger circle.
 */
export function circleHullPath(a: Pt, ra: number, b: Pt, rb: number): string {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist + Math.min(ra, rb) <= Math.max(ra, rb) + 1e-9) return ra >= rb ? circlePath(a, ra) : circlePath(b, rb);
    const base = Math.atan2(dy, dx);
    const phi = Math.acos(Math.max(-1, Math.min(1, (ra - rb) / dist)));
    const at = (c: Pt, r: number, angle: number) => `${c.x + r * Math.cos(angle)} ${c.y + r * Math.sin(angle)}`;
    // Both arcs run with the angle DECREASING (SVG sweep-flag 0): B's from +φ through 0 to
    // −φ (an arc of 2φ), A's from −φ through π to +φ (2π − 2φ).
    const bLarge = 2 * phi > Math.PI ? 1 : 0;
    const aLarge = 1 - bLarge;
    return [
        `M ${at(a, ra, base + phi)}`,
        `L ${at(b, rb, base + phi)}`,
        `A ${rb} ${rb} 0 ${bLarge} 0 ${at(b, rb, base - phi)}`,
        `L ${at(a, ra, base - phi)}`,
        `A ${ra} ${ra} 0 ${aLarge} 0 ${at(a, ra, base + phi)}`,
        "Z",
    ].join(" ");
}
