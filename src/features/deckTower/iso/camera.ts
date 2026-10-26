import type { Projector, Pt, Pt3 } from "./geometry";

/**
 * camera.ts — a moving camera for the iso art framework (docs/ISO_ART_FRAMEWORK.md
 * § "The camera").
 *
 * The framework's default view is a FIXED 2:1 dimetric projection (geometry.ts →
 * `makeProjector`). This file generalises it into an orbit camera with optional
 * perspective, so a scene can fly its viewpoint somewhere else and back — the Deck
 * Tower's dive from its iso view straight down onto the tower's top card
 * (docs/DECK_TOWER.md § "Studying the tower"). The dimetric view is one setting of it
 * (`dimetricView`), reproduced EXACTLY, so a camera parked there draws pixel-for-pixel
 * what the fixed projector does and the move can start with no jump.
 *
 * ── The model ────────────────────────────────────────────────────────────────
 * Relative to the camera's `target` (world), a point is
 *   1. turned about world z by `yaw` (in the floor plane),
 *   2. its height scaled by `zScale` (the dimetric view's √(2/3) foreshortening of z),
 *   3. tilted by `pitch` about the screen's horizontal axis (π/3 = the iso tilt,
 *      0 = looking straight down),
 *   4. scaled by `scale` px per unit and, with `perspective` > 0, divided by
 *      (1 − depth · perspective) — depth toward the viewer is positive, so things nearer
 *      the camera draw larger. 1 / perspective is the camera's distance from the
 *      target in world units; a point that close or closer is clamped (MIN_DEPTH_FACTOR)
 *      rather than flipped,
 *   5. placed so `target` lands on `screen`.
 *
 * Pure: no React. Depended on by: iso/geometry.ts (the `Projector` shape it fills),
 * src/features/deckTower/towerCamera.ts (the dive's two ends and the blend between them).
 */

export interface CameraView {
    /** Radians the floor is turned about world z. π/4 = the dimetric view's diagonal. */
    yaw: number;
    /** Radians of tilt. π/3 = the dimetric view; 0 = straight down onto the floor. */
    pitch: number;
    /** World z foreshortening before the tilt. √(2/3) = dimetric; 1 = true height. */
    zScale: number;
    /** Screen px per world unit at the target. */
    scale: number;
    /** Perspective strength, 1 / (camera distance in world units). 0 = parallel projection. */
    perspective: number;
    /** The world point the camera looks at… */
    target: Pt3;
    /** …and where on screen it lands. */
    screen: Pt;
}

/**
 * The perspective divisor never falls below this, so a point at (or behind) the camera
 * draws very large instead of dividing by zero or turning inside out. The Deck Tower's
 * sky drop starts its stack just short of the camera and relies on this only as a guard.
 */
const MIN_DEPTH_FACTOR = 0.05;

/** The dimetric foreshortening of z: with yaw π/4 and pitch π/3 it makes 1 unit of z = `unit` px. */
export const DIMETRIC_Z_SCALE = Math.sqrt(2 / 3);

/**
 * The camera setting that reproduces `makeProjector(unit)` exactly, looking at `target`.
 * (Yaw π/4 turns world (x − y) onto screen x with a 1/√2 factor, which `scale` = unit·√2
 * undoes; pitch π/3 then halves screen y and, with `zScale`, maps 1 unit of z to `unit` px.)
 */
export function dimetricView(unit: number, target: Pt3): CameraView {
    return {
        yaw: Math.PI / 4,
        pitch: Math.PI / 3,
        zScale: DIMETRIC_Z_SCALE,
        scale: unit * Math.SQRT2,
        perspective: 0,
        target,
        // Where the fixed projector (origin 0) puts the target.
        screen: { x: (target.x - target.y) * unit, y: ((target.x + target.y) * unit) / 2 - target.z * unit },
    };
}

export function makeCameraProjector(view: CameraView): Projector {
    const cy = Math.cos(view.yaw);
    const sy = Math.sin(view.yaw);
    const cp = Math.cos(view.pitch);
    const sp = Math.sin(view.pitch);
    const { target, screen, scale, perspective, zScale } = view;
    // The camera-space frame of a world point: its offset across / down the screen at the
    // target's scale, and its perspective factor `k` (px per facing world unit there).
    const frame = (x: number, y: number, z: number) => {
        const dx = x - target.x;
        const dy = y - target.y;
        const dz = (z - target.z) * zScale;
        // 1. yaw: `across` runs along screen x, `along` into the screen (down it, unpitched).
        const across = dx * cy - dy * sy;
        const along = dx * sy + dy * cy;
        // 3. pitch: screen-down component, and depth toward the viewer.
        const down = along * cp - dz * sp;
        const depth = along * sp + dz * cp;
        // 4. perspective.
        const k = scale / Math.max(MIN_DEPTH_FACTOR, 1 - depth * perspective);
        return { across, down, k };
    };
    const project = (x: number, y: number, z: number): Pt => {
        const { across, down, k } = frame(x, y, z);
        return { x: screen.x + across * k, y: screen.y + down * k };
    };
    // A facing length is not foreshortened by yaw, pitch or zScale: only perspective.
    const facingScaleAt = (x: number, y: number, z: number): number => frame(x, y, z).k;
    // Floor-plane area scale at a point: |det| of the screen images of a small world x and
    // y step there. Measured over STEP (not 1 unit) so perspective's curvature does not
    // skew it; for the fixed view this is exactly `unit`.
    const STEP = 0.1;
    const scaleAt = (x: number, y: number, z: number): number => {
        const o = project(x, y, z);
        const px = project(x + STEP, y, z);
        const py = project(x, y + STEP, z);
        const det = (px.x - o.x) * (py.y - o.y) - (px.y - o.y) * (py.x - o.x);
        return Math.sqrt(Math.abs(det)) / STEP;
    };
    return { unit: scaleAt(target.x, target.y, target.z), project, scaleAt, facingScaleAt };
}
