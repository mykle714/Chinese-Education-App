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
 * Calibrated to the 2:1 view this kit used until 2026-10-31: there the figure was
 * pixel-for-pixel the old screen-space pill (BODY_WIDTH × BODY_HEIGHT, rx = half the width)
 * and ball, and the pose's `lean` the same screen rotation about the feet. Today's view
 * shortens its heights a little (`Projector.heightUnit`). Heights are in world z; radii are camera-facing world units, which that view
 * draws at unit·√2 (geometry.ts → `Projector.facingScaleAt`) — hence the √2 below.
 *
 * Pure: no React, no DOM. Depended on by: iso/usePawnMotion.ts (writes it every frame),
 * iso/IsoPawn.tsx (the elements it is written onto). Docs: docs/ISO_ART_FRAMEWORK.md
 * § "IsoPawn" (and its "Vest" for pawnVest), docs/HINT_PAWN.md § "Night vest".
 */

/** The 2:1 view's screen sizes, in `unit`s — what the pawn looked like as a 2D pill. */
const BODY_WIDTH = 0.78;
const BODY_HEIGHT = 1.5;
const HEAD_SCREEN_RADIUS = 0.44;
/** The head's centre sits this far (in head radii) above the body's top: it overlaps the body a little. */
const HEAD_RISE = 0.55;
/** Gap between the head's top and the "!" bubble's tail tip, in `unit`s of the 2:1 view. */
const EMOTE_SCREEN_GAP = 0.3;

/** World radius of the body's end spheres (camera-facing units). */
const BODY_RADIUS = BODY_WIDTH / 2 / Math.SQRT2;
/** The body's world half-width — how wide a channel the pawn ploughs through snow (IsoSnowFloor.tsx). */
export const PAWN_BODY_RADIUS = BODY_RADIUS;
/** Height of the bottom end sphere's centre above the feet: its outline touches the feet in the fixed view. */
const BODY_FOOT_CENTRE = BODY_WIDTH / 2;
export const HEAD_RADIUS = HEAD_SCREEN_RADIUS / Math.SQRT2;
/** Height of the head's centre above the feet, world units. Exported for the flp hint pawn's bubble tail, which points at it. */
export const HEAD_CENTRE = BODY_HEIGHT + HEAD_RISE * HEAD_SCREEN_RADIUS;
export const EMOTE_GAP = EMOTE_SCREEN_GAP / Math.SQRT2;

/** The pose usePawnMotion animates: the same numbers that used to drive the 2D transforms. */
export interface PawnPose {
    /** Degrees of tilt about the feet; + tips the top toward `bendHeading` (default screen-right in the fixed view). */
    lean: number;
    /** Width squash/stretch (1 = rest). */
    sx: number;
    /** Height squash/stretch (1 = rest). */
    sy: number;
    /**
     * Degrees the SPINE bends between the feet and the body's top, in the same sense as
     * `lean` (− curls the top away from `bendHeading`; screen-left by default): the body is drawn as a curved capsule and
     * the head carries on along the top's direction. 0 / omitted = the straight capsule.
     * Used by usePawnMotion's back stretch (docs/ISO_ART_FRAMEWORK.md § IsoPawn → "Back stretch").
     */
    arch?: number;
    /**
     * The direction + `lean` and + `arch` tip the top toward, in degrees round the pawn as
     * the fixed view shows it — the same measure as `pawnVest`'s `facingDeg`: 0 = toward the
     * camera, +90 = screen-right (the default: every waddle, startle and hop leans in the
     * picture plane), −90 = screen-left, 180 = away. The back stretch sets it to the pawn's
     * facing, so its negative bend curls the back AWAY from where the pawn faces
     * (usePawnMotion's STRETCH). See `bendAxis`.
     */
    bendHeading?: number;
}

/** `PawnPose.bendHeading`'s default: lean in the picture plane, + toward screen-right. */
const DEFAULT_BEND_HEADING = 90;

/**
 * The world (x, y) a point moves per z-unit of `side` — sideways travel of the spine — in
 * `pose`'s bend direction. The fixed view draws world (1, 1) as toward the camera and
 * (1, −1) as screen-right; the axis keeps the length 1/√2 the original screen-right lean
 * was calibrated with (see `pawnFigure`), so a heading of 90 is exactly (½, −½) — today's
 * lean — and every heading bends the same world distance.
 */
function bendAxis(pose: PawnPose): { x: number; y: number } {
    const a = ((pose.bendHeading ?? DEFAULT_BEND_HEADING) * Math.PI) / 180;
    return { x: (Math.cos(a) + Math.sin(a)) / 2, y: (Math.cos(a) - Math.sin(a)) / 2 };
}

export const REST_POSE: PawnPose = { lean: 0, sx: 1, sy: 1 };

/**
 * How the arch's bend is spread along the spine: the bend so far at fraction `u` of the way
 * up is `arch · u^ARCH_PROFILE_POWER`. Above 1 it gathers toward the top — the upper back
 * curls more than the hips, which reads as a back bending rather than a banana.
 */
const ARCH_PROFILE_POWER = 1.6;
/** Spine samples for a curved body: segments joined as overlapping capsules (see `pawnFigure`). */
const ARCH_SEGMENTS = 10;
/** Integration steps per segment when tracing the curved spine. */
const ARCH_STEPS_PER_SEGMENT = 3;

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
 * as screen-right; `pose.bendHeading` turns it to any other direction (`bendAxis`) — by
 * `lean` degrees as seen in that view: a point h z-units up the axis
 * moves h·sin θ/√2 along (1, −1)/√2 (drawn at √2 · unit px per world unit) and h·cos θ up.
 * Squash scales the axis by `sy` and the radii by `sx` (the head by √(sx·sy), so it keeps
 * its area rather than ballooning) — an approximation of the old 2D scale, which turned
 * the ends into ellipses; the squashes are brief enough that circles read the same.
 *
 * ARCH (`pose.arch` ≠ 0): the axis is no longer straight. Its direction turns from `lean`
 * at the feet to `lean + arch` at the body's top (spread by ARCH_PROFILE_POWER), traced by
 * integrating that direction up the spine. The body is drawn as a chain of short capsules
 * between ARCH_SEGMENTS + 1 sample spheres along the curve, all in ONE path: every
 * `circleHullPath` winds the same way, so under the default nonzero fill rule the
 * overlapping pieces fill as their union — a smooth bent pill with no seams, correct under
 * any camera. The head sits on the line continuing from the top's direction.
 */
export function pawnFigure(proj: Projector, feet: { x: number; y: number; z: number }, pose: PawnPose): PawnFigure {
    if (pose.arch) return archedPawnFigure(proj, feet, pose, pose.arch);
    const tilt = (pose.lean * Math.PI) / 180;
    const upward = Math.cos(tilt);
    // Per z unit up the axis: along the bend direction (`bendAxis`; screen-right by default).
    const axis = bendAxis(pose);
    const dx = Math.sin(tilt) * axis.x;
    const dy = Math.sin(tilt) * axis.y;
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

/** The arched figure (see ARCH in `pawnFigure`'s comment). */
function archedPawnFigure(proj: Projector, feet: { x: number; y: number; z: number }, pose: PawnPose, arch: number): PawnFigure {
    const lean = (pose.lean * Math.PI) / 180;
    const bend = (arch * Math.PI) / 180;
    const bottomH = BODY_FOOT_CENTRE * pose.sx;
    const topH = Math.max(bottomH, BODY_HEIGHT * pose.sy - BODY_FOOT_CENTRE * pose.sx);
    const bodyRadius = BODY_RADIUS * pose.sx;
    /** The axis's tilt `h` z-units of spine up from the feet (bent over 0 … topH). */
    const tiltAt = (h: number) => spineTilt(lean, bend, topH, h);
    // A spine point as a world offset from the feet, in the straight case's terms: `side`
    // along the bend direction (`bendAxis`), split over world x and y as there.
    const axis = bendAxis(pose);
    const toWorld = (side: number, up: number) => ({ x: feet.x + side * axis.x, y: feet.y + side * axis.y, z: feet.z + up });
    // Trace the spine from the feet (midpoint rule), keeping the samples from bottomH to topH.
    const steps = ARCH_SEGMENTS * ARCH_STEPS_PER_SEGMENT;
    let side = 0;
    let up = 0;
    let h = 0;
    // Feet → bottom sphere first (bent a little already), then the body in even steps.
    const advance = (to: number, n: number) => {
        const dh = (to - h) / n;
        for (let i = 0; i < n; i++) {
            const t = tiltAt(h + dh / 2);
            side += Math.sin(t) * dh;
            up += Math.cos(t) * dh;
            h += dh;
        }
    };
    advance(bottomH, ARCH_STEPS_PER_SEGMENT);
    const spheres: { c: Pt; r: number }[] = [];
    const sample = () => {
        const w = toWorld(side, up);
        spheres.push({ c: proj.project(w.x, w.y, w.z), r: bodyRadius * proj.facingScaleAt(w.x, w.y, w.z) });
    };
    sample();
    for (let seg = 0; seg < ARCH_SEGMENTS; seg++) {
        advance(bottomH + ((topH - bottomH) * (seg + 1)) / ARCH_SEGMENTS, steps / ARCH_SEGMENTS);
        sample();
    }
    // The head: on from the top sphere along the top's direction, as far as it sits above
    // the body's top in the straight figure.
    const topTilt = tiltAt(topH);
    const headReach = HEAD_CENTRE * pose.sy - topH;
    const hw = toWorld(side + Math.sin(topTilt) * headReach, up + Math.cos(topTilt) * headReach);
    const headC = proj.project(hw.x, hw.y, hw.z);
    const headK = proj.facingScaleAt(hw.x, hw.y, hw.z);
    const pieces: string[] = [];
    for (let i = 0; i + 1 < spheres.length; i++) {
        pieces.push(circleHullPath(spheres[i].c, spheres[i].r, spheres[i + 1].c, spheres[i + 1].r));
    }
    return {
        bodyPath: pieces.join(" "),
        head: { cx: headC.x, cy: headC.y, r: HEAD_RADIUS * Math.sqrt(pose.sx * pose.sy) * headK },
        headScale: headK,
    };
}

// ── The night vest ─────────────────────────────────────────────────────────────
// A hi-viz safety vest the flp's hint pawn wears at night (docs/HINT_PAWN.md § "Night
// vest", docs/ISO_ART_FRAMEWORK.md § "IsoPawn" → "Vest"). Opt-in per pawn (IsoPawn
// `vest`): only a pawn that wears one pays for it each frame.
//
// An OPEN vest: its front is a gap down the centre line (a slit at the hem opening to a V
// at the neck), and it has two arm holes the armless pawn does not use — both are drawn
// as `openingsPath` in the body's ink, over the cloth (see `vestOpeningPath`,
// `vestArmHolePath`). Both are patches of the body's SURFACE, placed by angle round it
// from the vest's facing, which can be turned off the camera (`pawnVest`'s `facingDeg`).
//
// The cloth is two bands painted round the body's capsule — the vest itself, and its two
// reflective stripes — each the stretch of the body between two heights up the SPINE. A
// band painted on a cylinder is bounded, as seen, by the FRONT arcs of its two edge rings
// (the halves nearer the camera), so each band is drawn as: the top ring's front arc left
// → right, then the bottom ring's front arc back right → left. The rings are horizontal
// circles round the spine point, as wide as the body (a horizontal circle of the body's
// radius projects exactly as wide as the capsule's outline — both are radius · unit · √2
// across in the fixed view), a little over so the arcs' ends run past the outline. The
// caller CLIPS the bands to the body's outline, which trims those ends and the vest's
// sides to the body; the head, drawn after, covers its top. Horizontal rings stay
// horizontal as the pawn leans or arches (a real hem would tilt with the torso) — at the
// poses usePawnMotion plays the difference is under a pixel.
//
// "Front" is the half of a ring lower on screen, which holds for any camera looking DOWN
// at the pawn — every view this kit has (the fixed view, iso/camera.ts's study camera).

/** Spine heights (as fractions of BODY_HEIGHT, before `sy`) of the vest's hem and top. The top's middle sits under the head; its sides show as the shoulder straps. */
const VEST_SPAN = { from: 0.3, to: 0.97 } as const;
/** The two reflective stripes: their centres (fractions of BODY_HEIGHT) and their thickness (world z, before `sy`). Both below the arm holes. */
const VEST_STRIPE_CENTRES = [0.4, 0.53] as const;
const VEST_STRIPE_THICKNESS = 0.09;
/**
 * The OPEN FRONT: a gap down the front's centre line, as a half-angle round the ring either
 * side of the front-most point (radians). Narrow at the hem, opening to a V at the neck.
 */
const VEST_OPENING_HALF_ANGLE = { hem: 0.14, neck: 0.42 } as const;
/** Spine samples down the open front (it follows an arched spine). */
const VEST_OPENING_STEPS = 8;
/**
 * The ARM HOLES (the pawn has no arms, so they are just empty): an oval patch of the body's
 * surface a quarter turn either side of the vest's facing, spanning these spine heights
 * (fractions of BODY_HEIGHT) and ± `halfAngle` round the body (radians). Kept on the
 * capsule's STRAIGHT sides (below the top end sphere's centre, ~0.74 of BODY_HEIGHT, plus a
 * little): above that the outline curves in over the shoulders and a hole there would fall
 * off the body and eat the strap.
 */
const VEST_ARM_HOLE = { from: 0.62, to: 0.8, halfAngle: 0.6 } as const;
/** Points round each arm hole's oval. */
const VEST_ARM_HOLE_SAMPLES = 20;
/** Ring radius over the body's, so each arc's ends run past the outline the band is clipped to (no seam at the edge). */
const VEST_RING_OVERSHOOT = 1.12;
/** Points sampled round each ring. */
const VEST_RING_SAMPLES = 32;
/** Midpoint-rule steps when tracing an arched spine up to a vest height. */
const VEST_SPINE_STEPS = 24;

export interface PawnVest {
    /** The vest's band (an SVG path `d`), to be clipped to the body's outline. */
    vestPath: string;
    /** Both reflective stripes, one path (two closed subpaths), also clipped to the body. */
    stripesPath: string;
    /**
     * Where the vest is NOT: the open front and the two arm holes, one path (three closed
     * subpaths). Drawn over the cloth and stripes in the body's own ink, inside the same
     * clip — on an ink body that reads exactly as a cut-out.
     */
    openingsPath: string;
}

/**
 * The spine's tilt `h` z-units up from the feet: `lean` at the feet, bending to
 * `lean + arch` at the body's top `topH` (radians in, radians out). Mirrors
 * archedPawnFigure's `tiltAt`, so the vest follows the same curve the body is drawn on.
 */
function spineTilt(leanRad: number, archRad: number, topH: number, h: number): number {
    return leanRad + archRad * Math.pow(Math.min(1, h / Math.max(topH, 1e-6)), ARCH_PROFILE_POWER);
}

/**
 * The world point on the spine `h` z-units of spine up from `feet`, in `pose` — the same
 * axis pawnFigure draws the body round (straight: along the lean; arched: traced up the
 * bend with the midpoint rule, as archedPawnFigure does).
 */
function spinePoint(feet: { x: number; y: number; z: number }, pose: PawnPose, h: number): { x: number; y: number; z: number } {
    const lean = (pose.lean * Math.PI) / 180;
    // `side` runs along the bend direction, split over world x and y (`bendAxis`, as pawnFigure).
    let side: number;
    let up: number;
    if (!pose.arch) {
        side = h * Math.sin(lean);
        up = h * Math.cos(lean);
    } else {
        const bend = (pose.arch * Math.PI) / 180;
        const bottomH = BODY_FOOT_CENTRE * pose.sx;
        const topH = Math.max(bottomH, BODY_HEIGHT * pose.sy - BODY_FOOT_CENTRE * pose.sx);
        side = 0;
        up = 0;
        const dh = h / VEST_SPINE_STEPS;
        for (let i = 0; i < VEST_SPINE_STEPS; i++) {
            const t = spineTilt(lean, bend, topH, (i + 0.5) * dh);
            side += Math.sin(t) * dh;
            up += Math.cos(t) * dh;
        }
    }
    const axis = bendAxis(pose);
    return { x: feet.x + side * axis.x, y: feet.y + side * axis.y, z: feet.z + up };
}

/** The horizontal ring round spine height `h`, `VEST_RING_SAMPLES` projected points at even angles from world +x. */
function ringPoints(proj: Projector, feet: { x: number; y: number; z: number }, pose: PawnPose, h: number, overshoot = VEST_RING_OVERSHOOT): Pt[] {
    const c = spinePoint(feet, pose, h);
    const r = BODY_RADIUS * pose.sx * overshoot;
    const pts: Pt[] = [];
    for (let i = 0; i < VEST_RING_SAMPLES; i++) {
        const a = (i / VEST_RING_SAMPLES) * 2 * Math.PI;
        pts.push(proj.project(c.x + r * Math.cos(a), c.y + r * Math.sin(a), c.z));
    }
    return pts;
}

/** The front (lower-on-screen) arc of the horizontal ring round spine height `h`, ordered left → right. */
function ringFrontArc(proj: Projector, feet: { x: number; y: number; z: number }, pose: PawnPose, h: number): Pt[] {
    const pts = ringPoints(proj, feet, pose, h);
    // The ring's leftmost and rightmost points split it into two arcs; the front is the one lower on screen.
    let iL = 0;
    let iR = 0;
    pts.forEach((p, i) => {
        if (p.x < pts[iL].x) iL = i;
        if (p.x > pts[iR].x) iR = i;
    });
    const walk = (from: number, to: number): Pt[] => {
        const arc: Pt[] = [];
        for (let i = from; ; i = (i + 1) % pts.length) {
            arc.push(pts[i]);
            if (i === to) return arc;
        }
    };
    const meanY = (arc: Pt[]) => arc.reduce((s, p) => s + p.y, 0) / arc.length;
    const leftToRight = walk(iL, iR);
    const rightToLeft = walk(iR, iL);
    return meanY(leftToRight) >= meanY(rightToLeft) ? leftToRight : rightToLeft.reverse();
}

/**
 * The world-space angle (round the ring, from world +x) of the point nearest the camera —
 * the ring's lowest point on screen. Refined from the sampled ring with a parabola through
 * the lowest sample and its two neighbours, so the open front does not step between samples.
 */
function frontAngle(proj: Projector, feet: { x: number; y: number; z: number }, pose: PawnPose, h: number): number {
    const pts = ringPoints(proj, feet, pose, h);
    const n = pts.length;
    let iMax = 0;
    pts.forEach((p, i) => {
        if (p.y > pts[iMax].y) iMax = i;
    });
    const y0 = pts[(iMax - 1 + n) % n].y;
    const y1 = pts[iMax].y;
    const y2 = pts[(iMax + 1) % n].y;
    const denom = y0 - 2 * y1 + y2;
    const offset = Math.abs(denom) < 1e-9 ? 0 : (0.5 * (y0 - y2)) / denom;
    return ((iMax + offset) / n) * 2 * Math.PI;
}

/** One projected point on the ring round spine height `h`, at world angle `a`, the ring `overshoot` × the body's radius. */
function ringPointAt(proj: Projector, feet: { x: number; y: number; z: number }, pose: PawnPose, h: number, a: number, overshoot: number): Pt {
    const c = spinePoint(feet, pose, h);
    const r = BODY_RADIUS * pose.sx * overshoot;
    return proj.project(c.x + r * Math.cos(a), c.y + r * Math.sin(a), c.z);
}

/**
 * +1 when turning a ring's angle UP moves its front point toward screen-right, else −1 —
 * so the vest's facing can be given in screen terms ("toward the right") under any camera.
 */
function screenRightSign(proj: Projector, feet: { x: number; y: number; z: number }, pose: PawnPose, h: number, front: number): 1 | -1 {
    const up = ringPointAt(proj, feet, pose, h, front + 0.1, 1);
    const down = ringPointAt(proj, feet, pose, h, front - 0.1, 1);
    return up.x >= down.x ? 1 : -1;
}

/**
 * A point on the body's surface at spine height `h`, `rel` radians round from the
 * front-most point (+ = toward screen-right). Only the camera-facing half is drawn, so `rel`
 * is clamped to ± a quarter turn: a patch that wraps round the side is flattened onto the
 * outline there — pushed just past it (VEST_RING_OVERSHOOT), where the clip trims it, so
 * no hairline of cloth is left along the edge. A patch wholly round the back collapses to
 * nothing.
 */
function surfacePoint(proj: Projector, feet: { x: number; y: number; z: number }, pose: PawnPose, h: number, rel: number): Pt {
    const front = frontAngle(proj, feet, pose, h);
    const sign = screenRightSign(proj, feet, pose, h, front);
    const quarter = Math.PI / 2;
    const clamped = Math.max(-quarter, Math.min(quarter, rel));
    return ringPointAt(proj, feet, pose, h, front + sign * clamped, clamped === rel ? 1 : VEST_RING_OVERSHOOT);
}

/**
 * The open front: the strip of the body's surface within ± a half-angle of the vest's
 * facing (`facing` radians round from the front-most point, + = screen-right), from the
 * hem up past the vest's top — narrow at the hem, a V at the neck. Its left edge runs up,
 * its right edge back down.
 */
function vestOpeningPath(proj: Projector, feet: { x: number; y: number; z: number }, pose: PawnPose, h0: number, h1: number, facing: number): string {
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let i = 0; i <= VEST_OPENING_STEPS; i++) {
        const u = i / VEST_OPENING_STEPS;
        const h = h0 + (h1 - h0) * u;
        // Eased so the gap stays a narrow slit most of the way up and opens near the neck.
        const half = VEST_OPENING_HALF_ANGLE.hem + (VEST_OPENING_HALF_ANGLE.neck - VEST_OPENING_HALF_ANGLE.hem) * u * u;
        left.push(surfacePoint(proj, feet, pose, h, facing - half));
        right.push(surfacePoint(proj, feet, pose, h, facing + half));
    }
    return `M ${[...left, ...right.reverse()].map((p) => `${p.x} ${p.y}`).join(" L ")} Z`;
}

/**
 * One arm hole: an oval patch of the body's surface centred `centre` radians round from the
 * front-most point (+ = screen-right), between spine heights `h0` and `h1`. Drawn on the
 * surface, so it foreshortens as the vest turns: a hole turned toward the camera shows as
 * an oval on the body's face, one at the side as a scoop out of the outline, one turned
 * away not at all (surfacePoint's clamp).
 */
function vestArmHolePath(proj: Projector, feet: { x: number; y: number; z: number }, pose: PawnPose, h0: number, h1: number, centre: number): string {
    const hMid = (h0 + h1) / 2;
    const hHalf = (h1 - h0) / 2;
    const pts: Pt[] = [];
    for (let i = 0; i < VEST_ARM_HOLE_SAMPLES; i++) {
        const t = (i / VEST_ARM_HOLE_SAMPLES) * 2 * Math.PI;
        pts.push(surfacePoint(proj, feet, pose, hMid + hHalf * Math.cos(t), centre + VEST_ARM_HOLE.halfAngle * Math.sin(t)));
    }
    return `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")} Z`;
}

/** The band of the body between spine heights `h0` < `h1`, as one closed subpath (see the section header). */
function vestBandPath(proj: Projector, feet: { x: number; y: number; z: number }, pose: PawnPose, h0: number, h1: number): string {
    const top = ringFrontArc(proj, feet, pose, h1);
    const bottom = ringFrontArc(proj, feet, pose, h0).reverse();
    return `M ${[...top, ...bottom].map((p) => `${p.x} ${p.y}`).join(" L ")} Z`;
}

/**
 * The night vest of a pawn whose feet are at world `feet`, in `pose`, under `proj` — the
 * same arguments as pawnFigure, so the vest moves, squashes and bends with the body.
 *
 * `facingDeg` turns the vest round the body: 0 faces the camera; + turns its front toward
 * screen-right (the flp's hint pawn: toward its speech bubble). The open front and the arm
 * holes turn with it; the cloth and stripes are bands all the way round, so they do not
 * change. Keep it within about ±60°, or the V's far edge wraps past the outline.
 *
 * Depended on by: iso/usePawnMotion.ts (writes it every frame when the pawn wears one).
 */
export function pawnVest(proj: Projector, feet: { x: number; y: number; z: number }, pose: PawnPose, facingDeg = 0): PawnVest {
    const facing = (facingDeg * Math.PI) / 180;
    const at = (fraction: number) => fraction * BODY_HEIGHT * pose.sy;
    const halfStripe = (VEST_STRIPE_THICKNESS * pose.sy) / 2;
    return {
        vestPath: vestBandPath(proj, feet, pose, at(VEST_SPAN.from), at(VEST_SPAN.to)),
        stripesPath: VEST_STRIPE_CENTRES.map((c) => vestBandPath(proj, feet, pose, at(c) - halfStripe, at(c) + halfStripe)).join(" "),
        openingsPath: [
            // From just under the hem (so the slit is open at the bottom edge) to the vest's top.
            vestOpeningPath(proj, feet, pose, at(VEST_SPAN.from) - halfStripe, at(VEST_SPAN.to), facing),
            // The arm holes, a quarter turn either side of the facing.
            vestArmHolePath(proj, feet, pose, at(VEST_ARM_HOLE.from), at(VEST_ARM_HOLE.to), facing - Math.PI / 2),
            vestArmHolePath(proj, feet, pose, at(VEST_ARM_HOLE.from), at(VEST_ARM_HOLE.to), facing + Math.PI / 2),
        ].join(" "),
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

/** Points round the snow line's circle (pawnSnowClip): smooth enough at the pawn's size. */
const SNOW_LINE_POINTS = 24;
/** viewBox units the snow clip reaches past the snow line, up and to each side. */
const SNOW_CLIP_REACH = 2000;

/**
 * The clip that sinks a pawn into snow (IsoPawn `snowDepth`; docs/TOWER_SNOW.md
 * § "The pawn's trail"): everything ABOVE the snow line in front of it. The snow line is
 * the near half of the body's circle (`bodyRadius` round the ground point) projected at the
 * snow's top — where the snow in front of the pawn meets it, since the channel it ploughs
 * is exactly its body's width. Beyond the circle's two side points the boundary runs out
 * level, then the clip reaches far up. A figure whose feet are above `snowZ` (a jump) is
 * not cut at all, as its outline lies wholly above the line.
 */
export function pawnSnowClip(proj: Projector, at: { x: number; y: number }, snowZ: number, bodyRadius: number): string {
    const ring: Pt[] = [];
    for (let i = 0; i < SNOW_LINE_POINTS; i++) {
        const a = (i / SNOW_LINE_POINTS) * Math.PI * 2;
        ring.push(proj.project(at.x + Math.cos(a) * bodyRadius, at.y + Math.sin(a) * bodyRadius, snowZ));
    }
    // The ring's screen-left and screen-right points split it into a near (lower) and a far chain.
    let li = 0;
    let ri = 0;
    let lowest = 0;
    for (let i = 1; i < ring.length; i++) {
        if (ring[i].x < ring[li].x) li = i;
        if (ring[i].x > ring[ri].x) ri = i;
        if (ring[i].y > ring[lowest].y) lowest = i;
    }
    // Walk from the left point to the right one in whichever direction passes the lowest point.
    const n = ring.length;
    const walk = (step: number) => {
        const out: Pt[] = [];
        let passesLowest = false;
        for (let i = li; ; i = (i + step + n) % n) {
            out.push(ring[i]);
            if (i === lowest) passesLowest = true;
            if (i === ri) break;
        }
        return { out, passesLowest };
    };
    const fwd = walk(1);
    const near = fwd.passesLowest ? fwd.out : walk(-1).out;
    const l = ring[li];
    const r = ring[ri];
    const top = Math.min(l.y, r.y) - SNOW_CLIP_REACH;
    const pts = [
        { x: l.x - SNOW_CLIP_REACH, y: l.y },
        ...near,
        { x: r.x + SNOW_CLIP_REACH, y: r.y },
        { x: r.x + SNOW_CLIP_REACH, y: top },
        { x: l.x - SNOW_CLIP_REACH, y: top },
    ];
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("") + "Z";
}
