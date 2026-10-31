import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { insetRect, insideRoundedRect, type Projector, type WorldRect } from "./geometry";
import { shadowSlide } from "./light";
import { prefersReducedMotion } from "./skyTraffic";
import { PAWN_GRAVITY, type PawnEntrance } from "./pawnEntrances";
import { EMOTE_GAP, HEAD_RADIUS, pawnFigure } from "./pawnFigure";

/**
 * usePawnMotion — the IsoPawn's behaviour (docs/ISO_ART_FRAMEWORK.md § "IsoPawn").
 *
 * One requestAnimationFrame state machine, because walking and the startle both move the
 * same feet and must hand over from wherever the other left them:
 *
 *   pause ──(timer)──▶ walk ──(arrived)──▶ land ──(feet down)──▶ pause …   (IDLE)
 *     ▲                                                              │
 *     └──────── recover ◀── hold ◀── leap ◀── lean ◀──(startled)─────┘   (STARTLE)
 *
 * - IDLE wanders the floor: pick a random spot in `roam.area` whose straight path clears
 *   every obstacle, walk there at WALK_SPEED with a bounce per step (and a little waddle),
 *   pause, repeat. The very first pause after mount is longer (OPENING_PAUSE_*), so the
 *   pawn doesn't set off the moment the page appears.
 * - STARTLE: lean back to look up at `startledBy` (LEAN_MS), leap away from it (LEAP_MS),
 *   squash on landing (SETTLE_MS), hold the look-up (LOOK_HOLD_MS), straighten up
 *   (RECOVER_MS), then back to IDLE.
 * - ENTRANCE (optional, before everything else): with `entrance`, the pawn is hidden until
 *   `entrance.startAt`, then plays the entrance's pose timeline (pawnEntrances.ts — e.g.
 *   falling from the sky) and goes into IDLE's opening pause. A startle that arrives
 *   mid-entrance is dropped: the pawn is still in the air.
 *
 * It writes straight onto the pawn's SVG through refs — the travel and shadow groups'
 * transforms (plus the three that keep the pawn's shaded decals in line with its shadow,
 * see IsoPawn `decals`), the body's path, the head's circle and the "!" bubble's anchor —
 * rather than through React state: the pawn moves every frame, and the page re-rendering at 60 fps
 * for it would be wasted work. A frame that would draw exactly what the last one drew (a
 * pawn standing in a pause) writes nothing, because any svg write repaints the whole scene. React state changes only for the two things the tree
 * needs to know: a fresh emote (to mount the "!" bubble) and the pawn's DEPTH RANK
 * among the obstacles (its slot in their back-to-front order, `depthRankAmong` — the page
 * reorders its children by it, so the pawn walks behind the tower rather than over it).
 *
 * STEPS: `steps` are raised regions of the floor the pawn walks ONTO, not around (the Deck
 * Tower's push-button plate). While its foot centre is over one, the whole pawn — body,
 * shadow and the shadow's clip on the shaded decals — rides that step's height (`lift`).
 * Heights are read live every frame, so a pawn standing on the plate sinks with it when
 * the plate is pressed.
 *   A WALK that is about to cross a step edge HOPS it (the `edgeHop` mode): the walk looks
 *   HOP_LEAD ahead, and when that point is on a surface whose height differs by at least
 *   HOP_MIN_RISE it stops there and hops from a standstill —
 *
 *     walk ──▶ edgeHop: crouch (HOP_PREP_MS) ▶ air (HOP_MS) ▶ recover (HOP_RECOVER_MS) ──▶ walk
 *
 *   settling its feet and squashing down in preparation, arcing over the edge stretched,
 *   then landing in a squash and standing a beat before walking on. Anything else that
 *   carries the feet over an edge (a startle leap, an entrance, a hop cut short by a
 *   startle) falls back to the plain STEP_MS ease.
 *   FEET PHYSICS: on top of `lift` (the surface, which carries the shadow) the feet have
 *   their own height and vertical speed under GRAVITY. A surface dropping out from under
 *   them (the plate pressed) leaves the pawn to FALL onto it rather than snap down with it.
 *   A step that sank under the pawn and then rises again (the plate released) LAUNCHES it
 *   (PLATE_LAUNCH_SPEED): it rides the plate up until the plate's spring slows below that
 *   speed, flies off, and lands in a couple of shrinking bounces (BOUNCE_RESTITUTION) with
 *   a squash on each impact. While airborne this way it doesn't walk, waddle or set off.
 *
 * FLOOR DROP: `floorDrop` > 0 means the floor itself is falling away (the Deck Tower's trap
 * door, docs/DECK_TOWER_TRANSITIONS.md § "Pawns during a swap"). The pawn has no surface
 * then, and falls on its own: a launch still in flight carries on to its apex first, and
 * from there (or at once, for a pawn standing on the floor) its height blends over
 * FALL_BLEND_MS from its own GRAVITY fall into the floor's — the height it would
 * have standing on the falling floor, so a launched pawn CATCHES UP rather than trailing
 * by its launch height. It drops out of the air, then keeps pace with the tower and is
 * gone when the tower is. Its "!"
 * bubble pops as that fall starts.
 *
 * VIEW: the body is a true 3D figure — a capsule under a ball (iso/pawnFigure.ts) — projected
 * every frame from the feet's world position and the pose (hop, lean, squash), so it looks
 * right under ANY camera: under the fixed dimetric view it is the familiar upright pill,
 * and seen from straight above (iso/camera.ts — the Deck Tower's study camera) it is a
 * round head with the body peeking out past it, small far below the camera. The "!" bubble
 * is a billboard: always upright on screen, over the head, sized to the head's scale. The
 * projector is read through a ref, so a camera moving every frame neither restarts the
 * loop nor resets the pawn's walk; the page re-rendering with a new camera redraws the
 * figure at once (a layout effect) rather than a frame late.
 *
 * Under prefers-reduced-motion nothing runs: the pawn stands at `at` and the startle is
 * skipped.
 *
 * Referenced by: docs/ISO_ART_FRAMEWORK.md § "IsoPawn", docs/DECK_TOWER.md § "The scene",
 * docs/DECK_TOWER_TRANSITIONS.md § "Pawn entrances".
 */

type Pt2 = { x: number; y: number };

export interface PawnRoam {
    /**
     * The floor area the pawn's FEET and its SHADOW may cover — a rounded rect, corners
     * honoured. The pawn keeps both its foot circle and the shadow circle (the same circle
     * slid along the light) inside it, so the shadow never spills onto a bevel or off an edge.
     */
    area: WorldRect;
    /** Footprints to walk around, in BACK-TO-FRONT draw order (see `depthRankAmong`). */
    obstacles: WorldRect[];
}

/**
 * A raised region of the floor the pawn steps up onto (it is NOT an obstacle). `height` is
 * world units above the pawn's surface and may change every render (a plate being
 * pressed); usePawnMotion reads the latest value each frame.
 */
export interface PawnStep {
    rect: WorldRect;
    height: number;
}

/**
 * Ms the lift takes to settle onto a new surface when the feet crossed its edge WITHOUT an
 * edge hop (a startle leap landing on the plate, a corner clipped mid-hop). Short: it only
 * has to hide the height change.
 */
const STEP_MS = 90;

/** World units the pawn's foot circle occupies, and its clearance from obstacles. */
export const PAWN_FOOT_RADIUS = 0.45;
const OBSTACLE_CLEARANCE = 0.15;

/** Idle wander. Distances in world units, speeds per second, times in ms. */
const WALK_SPEED = 1.5;
/** Steps per second; the body bounces once per step. */
const STEP_RATE = 3.4;
const STEP_HOP = 0.13;
/** Side-to-side waddle, alternating per step. */
const WADDLE_DEG = 4;
const PAUSE_MIN_MS = 700;
const PAUSE_MAX_MS = 2600;
/**
 * The first pause after the scene mounts. Longer than an ordinary pause so the pawn
 * stands still while the page settles in, instead of setting off the instant it appears.
 */
const OPENING_PAUSE_MIN_MS = 3500;
const OPENING_PAUSE_MAX_MS = 6000;
/** Shortest and longest walk worth taking; shorter picks look like twitching. */
const WALK_MIN = 1.2;
const WALK_MAX = 5.5;
const PICK_TRIES = 16;

/** Edge hop (see the header's STEPS). Times in ms, distances and heights in world units. */
/** Standing at the edge before take-off: the feet settle, then it crouches. */
const HOP_PREP_MS = 260;
/** How quickly the walk's bounce and waddle die out once it stops at the edge. */
const HOP_STOP_MS = 90;
/** How deep the crouch squashes (0.14 = 14% shorter) by take-off. */
const HOP_CROUCH = 0.14;
/** In the air. */
const HOP_MS = 320;
/** The arc's height above the straight line from the take-off surface to the landing one. */
const HOP_ARC = 0.4;
/** Standing after touch-down before walking on; the landing squash eases out over the first HOP_SQUASH_MS. */
const HOP_RECOVER_MS = 380;
const HOP_SQUASH_MS = 200;
const HOP_LAND_SQUASH = 0.16;
/**
 * How far before an edge the pawn stops to hop (and, doubled, how far the hop carries it):
 * about the body's half width, so it stops with its front at the edge and lands as far past.
 */
const HOP_LEAD = 0.4;
const HOP_PREP_END = HOP_PREP_MS;
const HOP_AIR_END = HOP_PREP_MS + HOP_MS;
const HOP_END = HOP_AIR_END + HOP_RECOVER_MS;

/** Feet physics (see the header's STEPS). World units per second (squared). */
/**
 * Pulls the feet down onto their surface: the pawn's own cartoon gravity
 * (pawnEntrances.ts → PAWN_GRAVITY; the sky-fall entrance uses a gentler SKY_FALL_GRAVITY). A 0.25-unit plate press takes ~67 ms
 * to fall — the plate's ease-out sink drops away faster at first, so the feet lift off it
 * for a moment and land with a small bounce.
 */
const GRAVITY = PAWN_GRAVITY;
/**
 * How high a released plate throws the pawn: its feet clear the plate by about the pawn's
 * own full height (IsoPawn's body + head ≈ 2.4 units). The launch speed follows from it.
 */
const PLATE_LAUNCH_APEX = 2.4;
const PLATE_LAUNCH_SPEED = Math.sqrt(2 * GRAVITY * PLATE_LAUNCH_APEX);
/**
 * Ms from a plate release to the launched pawn's apex (~209). The Deck Tower holds its trap
 * door shut at least this long after a release (useDeckSwap → PLATE_SETTLE_MS), so the floor
 * never drops out from under the pawn before it has peaked: it falls from the air.
 */
export const PLATE_LAUNCH_APEX_MS = (PLATE_LAUNCH_SPEED / GRAVITY) * 1000;
/** Fraction of the landing speed a bounce keeps — 0.45 gives two visible bounces after a launch (~0.5, then ~0.1 units). */
const BOUNCE_RESTITUTION = 0.45;
/** Landing slower than this settles instead of bouncing again. */
const BOUNCE_MIN_SPEED = 1.7;
/** The squash on each impact: depth per unit of landing speed (capped), and how long it eases out. */
const IMPACT_SQUASH_PER_SPEED = 0.007;
const IMPACT_SQUASH_MAX = 0.16;
const IMPACT_MS = 130;
/** Below this the feet count as on their surface. */
const FEET_EPS = 1e-4;
/**
 * With the floor dropping away: how long the pawn's height takes to blend from its own
 * GRAVITY fall into the floor's. The two pulls are close (the trap door's is 140, raised
 * for tall towers so they clear in time), but the pawn starts from wherever its launch has
 * it while the floor starts from rest, so the blend keeps the pawn in step with the floor —
 * and gone when the floor's fall ends and the pawn is unmounted (the shortest, a 12-unit
 * fall, takes ~0.41 s plus its 50 ms delay).
 */
const FALL_BLEND_MS = 350;
/** A height change smaller than this (a plate pressed flush) is stepped over, not hopped. */
const HOP_MIN_RISE = 0.05;

/** Startle. */
const LOOK_UP_LEAN_DEG = 10;
export const LEAP_HOP_HEIGHT = 0.9;
const LEAP_DISTANCE = 0.85;
const LEAN_MS = 120;
const LEAP_MS = 300;
const SETTLE_MS = 140;
/** How long it keeps staring up after landing, then how long it takes to straighten. */
const LOOK_HOLD_MS = 2800;
const RECOVER_MS = 450;
const LANDED_AT = LEAN_MS + LEAP_MS;
const RECOVER_AT = LANDED_AT + LOOK_HOLD_MS;
const STARTLE_END = RECOVER_AT + RECOVER_MS;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

/** True when a point lies inside `rect` grown by `by` (corners treated as square). */
function insideGrown(p: Pt2, rect: WorldRect, by: number): boolean {
    return p.x > rect.x - by && p.x < rect.x + rect.w + by && p.y > rect.y - by && p.y < rect.y + rect.d + by;
}

/**
 * The point's slot in the draw order of `rects` (given back-to-front): the index of the
 * FIRST rect it stands behind, or `rects.length` when it is in front of them all. For
 * things that do not overlap on the floor, an object is nearer the viewer than a box when
 * it is past one of the box's faces that the camera sees (`pointInFrontOfRect`) — under the
 * fixed iso view, past its far edge on either floor axis (+x or +y, the axes that run
 * toward the viewer). Under a moving camera `rects` must be in that camera's order
 * (`backToFront`).
 *
 * Why not simply count the rects it is in front of: a fixed back-to-front list is not a
 * total order for every point. With the Deck Tower's lever at the floor's back-right
 * corner (where it once stood), a pawn on the tower's back-left side was BEHIND the tower
 * (obstacle 0) yet IN FRONT of the lever (obstacle 1) — the count said 1 and drew the pawn
 * over the tower. Those two never overlap
 * on screen, so any slot that respects the rects the pawn is behind is correct; taking
 * the first one errs toward hiding the pawn rather than drawing it over a tower.
 */
export function depthRankAmong(p: Pt2, rects: WorldRect[], proj?: Projector): number {
    const behind = rects.findIndex((r) => !pointInFrontOfRect(p, r, proj));
    return behind < 0 ? rects.length : behind;
}

/**
 * Whether floor point `p` (outside box `r`'s footprint) is nearer the camera than the box:
 * it is past one of the box's faces and the camera sees that face. Under the fixed view
 * (no `proj`, or `makeProjector`'s) only the high-x / high-y faces are seen, so this is
 * "past the far edge on either axis"; under the Deck Tower's study camera, tipping over
 * to look straight down onto the tower, the faces stop being seen one by one, and what
 * stood in front of the tower goes behind it — its top hides the floor round its foot.
 */
export function pointInFrontOfRect(p: Pt2, r: WorldRect, proj?: Projector): boolean {
    const sees = (axis: "x" | "y", at: number) => (proj ? proj.seesHighSide(axis, at) : true);
    return (
        (p.x >= r.x + r.w && sees("x", r.x + r.w)) ||
        (p.y >= r.y + r.d && sees("y", r.y + r.d)) ||
        (p.x <= r.x && !sees("x", r.x)) ||
        (p.y <= r.y && !sees("y", r.y))
    );
}

/** The same test for a whole footprint `a` against box `b` (footprints that do not overlap). */
function rectInFrontOfRect(a: WorldRect, b: WorldRect, proj: Projector): boolean {
    return (
        (a.x >= b.x + b.w && proj.seesHighSide("x", b.x + b.w)) ||
        (a.y >= b.y + b.d && proj.seesHighSide("y", b.y + b.d)) ||
        (a.x + a.w <= b.x && !proj.seesHighSide("x", b.x)) ||
        (a.y + a.d <= b.y && !proj.seesHighSide("y", b.y))
    );
}

/**
 * The indices of `rects` (non-overlapping footprints, listed back to front for the fixed
 * view) in back-to-front order for the camera `proj`: each one moved behind any earlier one
 * that is now unambiguously in front of it. Two footprints separated on BOTH axes can test
 * in front of each other at once (the Deck Tower's lever: past the tower's high-y face but
 * short of its low-x one); then neither can occlude the other, so either order draws
 * correctly and the listed one is kept — the fixed view keeps its order exactly. Both the
 * pawn's rank (`depthRankAmong`, over the rects in THIS order) and the draw order of the
 * obstacles' layers (DeckTowerPlatform) read it, so the two agree.
 */
export function backToFront(rects: WorldRect[], proj: Projector): number[] {
    const order: number[] = [];
    for (let i = 0; i < rects.length; i++) {
        // Slot `i` in front of everything already placed, unless one of them is now in front of it.
        const firstInFront = order.findIndex(
            (j) => rectInFrontOfRect(rects[j], rects[i], proj) && !rectInFrontOfRect(rects[i], rects[j], proj),
        );
        if (firstInFront < 0) order.push(i);
        else order.splice(firstInFront, 0, i);
    }
    return order;
}

/** The step the foot centre stands on (the highest, should two overlap), or -1 for the bare floor. */
function stepUnder(p: Pt2, steps: PawnStep[]): number {
    let best = -1;
    steps.forEach((st, i) => {
        if (insideRoundedRect(p, st.rect) && (best < 0 || st.height > steps[best].height)) best = i;
    });
    return best;
}

/** Where the pawn's shadow circle sits relative to its feet: it stands ON its surface (gap 0). */
const SHADOW_SLIDE = shadowSlide(0, 0);

/** Where a foot-sized circle's centre may be: the roam area shrunk by the foot radius (corners stay rounded). */
function feetBox(roam: PawnRoam): WorldRect {
    return insetRect(roam.area, PAWN_FOOT_RADIUS);
}

/**
 * Whether the feet may stand at `p`: both the foot circle and its shadow circle fit in
 * the roam area. Both regions are convex, so their intersection is too — any straight
 * walk between two legal points stays legal, and only the endpoints need checking.
 */
function onFloor(p: Pt2, roam: PawnRoam): boolean {
    const box = feetBox(roam);
    return insideRoundedRect(p, box) && insideRoundedRect({ x: p.x + SHADOW_SLIDE.x, y: p.y + SHADOW_SLIDE.y }, box);
}

/**
 * The legal point nearest `p` along the line from the floor's middle. The middle (shifted
 * back by half the shadow slide) is always legal on a floor big enough for the pawn, so
 * a bisection between it and `p` finds the legal region's edge.
 */
function clampToFloor(p: Pt2, roam: PawnRoam): Pt2 {
    if (onFloor(p, roam)) return p;
    const box = feetBox(roam);
    const mid = { x: box.x + box.w / 2 - SHADOW_SLIDE.x / 2, y: box.y + box.d / 2 - SHADOW_SLIDE.y / 2 };
    const at = (t: number) => ({ x: mid.x + (p.x - mid.x) * t, y: mid.y + (p.y - mid.y) * t });
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
        const t = (lo + hi) / 2;
        if (onFloor(at(t), roam)) lo = t;
        else hi = t;
    }
    return at(lo);
}

/** A straight path is clear when every sample along it keeps the feet off every obstacle. */
function pathClear(a: Pt2, b: Pt2, obstacles: WorldRect[]): boolean {
    const grow = PAWN_FOOT_RADIUS + OBSTACLE_CLEARANCE;
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.2) + 1;
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (obstacles.some((o) => insideGrown(p, o, grow))) return false;
    }
    return true;
}

/** A random reachable walk target, or null when none turned up (the pawn just waits longer). */
function pickTarget(from: Pt2, roam: PawnRoam): Pt2 | null {
    const box = feetBox(roam);
    for (let i = 0; i < PICK_TRIES; i++) {
        const p = { x: box.x + Math.random() * box.w, y: box.y + Math.random() * box.d };
        if (!onFloor(p, roam)) continue;
        const dist = Math.hypot(p.x - from.x, p.y - from.y);
        if (dist < WALK_MIN || dist > WALK_MAX) continue;
        if (pathClear(from, p, roam.obstacles)) return p;
    }
    return null;
}

/** Where a leap away from `source` lands: along the line from its nearest point, kept on the floor. */
function leapLanding(from: Pt2, source: WorldRect | undefined, roam: PawnRoam | undefined): Pt2 {
    let dir = { x: 1, y: 0.35 };
    if (source) {
        const near = {
            x: Math.min(source.x + source.w, Math.max(source.x, from.x)),
            y: Math.min(source.y + source.d, Math.max(source.y, from.y)),
        };
        const away = { x: from.x - near.x, y: from.y - near.y };
        if (Math.hypot(away.x, away.y) > 1e-6) dir = away;
    }
    const len = Math.hypot(dir.x, dir.y);
    const to = { x: from.x + (dir.x / len) * LEAP_DISTANCE, y: from.y + (dir.y / len) * LEAP_DISTANCE };
    return roam ? clampToFloor(to, roam) : to;
}

type Mode =
    | { kind: "pause"; until: number }
    | { kind: "walk"; target: Pt2 }
    | { kind: "land" }
    | { kind: "startle"; t0: number; from: Pt2; to: Pt2; leanSign: 1 | -1 }
    | { kind: "entrance"; t0: number; anim: PawnEntrance }
    | EdgeHopMode;

/**
 * A hop over a step edge, from a standstill (see the header's STEPS). `from` → `to` is the
 * ground the arc covers; `toIdx` the step it lands on (-1 = the bare floor); `resume` the
 * walk target to carry on to afterwards. `fromBounce` / `fromLean` are where the walk's
 * bounce and waddle had the body when it stopped, so they die out instead of snapping.
 * `fromLift` is the lift at take-off; `landed` is set on touch-down, when the landing
 * surface is committed.
 */
interface EdgeHopMode {
    kind: "edgeHop";
    t0: number;
    from: Pt2;
    to: Pt2;
    toIdx: number;
    resume: Pt2;
    fromBounce: number;
    fromLean: number;
    fromLift: number;
    landed: boolean;
}

export interface PawnMotionRefs {
    /** Slides the whole pawn (shadow included) across the floor. */
    travel: React.RefObject<SVGGElement | null>;
    /** Hides the whole pawn before its entrance starts. */
    presence: React.RefObject<SVGGElement | null>;
    /** The body's outline: rewritten every frame (see VIEW in the header). */
    body: React.RefObject<SVGPathElement | null>;
    /** The head's circle: rewritten every frame. */
    head: React.RefObject<SVGCircleElement | null>;
    /** Places the "!" bubble (drawn round its tail tip at the origin, EMOTE_DRAW_SCALE px per unit) over the head. */
    emoteAnchor: React.RefObject<SVGGElement | null>;
    /** Shrinks the shadow while airborne. */
    shadow: React.RefObject<SVGGElement | null>;
    /** The shaded-decal copy: fades with the shadow. */
    decalShade: React.RefObject<SVGGElement | null>;
    /** The shadow outline the decal copy is clipped to: shrinks with the shadow. */
    decalClip: React.RefObject<SVGPathElement | null>;
    /** Undoes `travel` on the decal copy, so the decals stay put on the floor. */
    decalAnchor: React.RefObject<SVGGElement | null>;
}

export interface PawnEmote {
    /** Bumps per startle (or alarm); used as a React key so the bubble's CSS pop replays. */
    id: number;
}

/**
 * The scale IsoPawn draws the "!" bubble at: px per world unit, round its tail tip at the
 * origin. The motion loop rescales it to the head's real scale each frame. A large fixed
 * scale rather than 1, so the bubble's text is never laid out at a sub-pixel font size.
 */
export const EMOTE_DRAW_SCALE = 100;

/** An entrance to play on mount, and when to start it (a `performance.now()` timestamp). */
export interface PawnEntranceCue {
    animation: PawnEntrance;
    startAt: number;
}

export function usePawnMotion(opts: {
    proj: Projector;
    at: Pt2;
    startled: boolean;
    roam?: PawnRoam;
    startledBy?: WorldRect;
    onDepthRankChange?: (rank: number) => void;
    /** Read once, on mount: the pawn arrives this way instead of standing there from the start. */
    entrance?: PawnEntranceCue;
    /**
     * World units the floor under the pawn has dropped (0 = in place) — the trap door
     * falling away (see the header's FLOOR DROP). Read live. Once it is above 0 the pawn
     * falls on its own and pops its "!" bubble as it starts to.
     */
    floorDrop?: number;
    /** Raised floor the pawn steps up onto (see the header's STEPS). Read live: may be a new array each render. */
    steps?: PawnStep[];
    /** World z of the surface the pawn stands on (its feet are drawn in absolute world space). */
    surfaceZ: number;
}): { refs: PawnMotionRefs; emote: PawnEmote | null } {
    const { proj, at, startled, roam, startledBy, onDepthRankChange } = opts;
    // Only the mount-time cue matters (an entrance is how the pawn ARRIVES), so it is
    // pinned in a ref and a later prop change never replays it.
    const entranceCue = useRef(opts.entrance);
    const refs: PawnMotionRefs = {
        travel: useRef<SVGGElement>(null),
        presence: useRef<SVGGElement>(null),
        body: useRef<SVGPathElement>(null),
        head: useRef<SVGCircleElement>(null),
        emoteAnchor: useRef<SVGGElement>(null),
        shadow: useRef<SVGGElement>(null),
        decalShade: useRef<SVGGElement>(null),
        decalClip: useRef<SVGPathElement>(null),
        decalAnchor: useRef<SVGGElement>(null),
    };
    const [emote, setEmote] = useState<PawnEmote | null>(null);

    // Mutable motion state lives in a ref: the rAF loop reads and writes it every frame,
    // and the startle effect below swaps its mode without restarting the loop.
    // It starts in its entrance (when it has one) from the very first render, not when the
    // motion loop mounts: the startle effect below runs first and must already see the
    // pawn as in the air.
    const state = useRef({
        pos: { ...at },
        stepPhase: 0,
        mode: (opts.entrance
            ? { kind: "entrance", t0: opts.entrance.startAt, anim: opts.entrance.animation }
            : { kind: "pause", until: 0 }) as Mode,
        rank: -1,
        // Step-up state: which step the feet were on last frame, the current lift (world
        // units), and the edge-crossing ease in progress (lift it started from, start time).
        // `stepIdx` is the surface the pawn stands on — or, mid edge hop, is hopping onto.
        stepIdx: -1,
        lift: 0,
        liftFrom: 0,
        liftT0: -Infinity,
        // Feet physics: the feet's absolute height (≥ lift) and vertical speed; whether the
        // step under them has sunk since they stood on it (a press — so its next rise is a
        // release that launches them), the step and height seen last frame, and the latest
        // impact's squash (start time, depth).
        feetZ: 0,
        feetV: 0,
        launchArmed: false,
        prevStepIdx: -1,
        prevStepH: 0,
        impactT0: -Infinity,
        impactDepth: 0,
        // With the floor dropping away (FLOOR DROP): when the pawn's own fall started —
        // null until then.
        fall: null as { t0: number } | null,
        // The last frame's pose, which `applyFrame` draws (the loop, and a re-render with a
        // new camera, both draw from it). `hop` is world units off the surface, `lean`
        // degrees; `emoteLean` the lean the "!" bubble follows (the startle's look-up only —
        // it does not waddle). Hidden from the start when an entrance is to come.
        pose: {
            hop: 0,
            lean: 0,
            sx: 1,
            sy: 1,
            emoteLean: 0,
            shadowOverride: null as { scale: number; opacity: number } | null,
            hidden: !!opts.entrance && !prefersReducedMotion(),
        },
    });
    // The latest projector: a moving camera hands in a new one every frame, which must not
    // restart the loop (see VIEW in the header).
    const projRef = useRef(proj);
    projRef.current = proj;
    // The latest callback, so a new inline function from the page doesn't restart the loop.
    const onRank = useRef(onDepthRankChange);
    onRank.current = onDepthRankChange;
    // Latest steps (their heights animate while the plate is pressed), read by the loop.
    const stepsRef = useRef(opts.steps ?? []);
    stepsRef.current = opts.steps ?? [];
    // Latest floor drop (animates every frame of a swap), read by the loop.
    const floorDropRef = useRef(opts.floorDrop ?? 0);
    floorDropRef.current = opts.floorDrop ?? 0;
    // What `applyFrame` last wrote to the DOM, so the loop can skip a frame that would
    // write the same thing (see IDLE FRAMES in `applyFrame`). Null until the first draw.
    const drawn = useRef<{
        proj: Projector;
        z0: number;
        x: number;
        y: number;
        lift: number;
        hop: number;
        lean: number;
        sx: number;
        sy: number;
        emoteLean: number;
        shadowScale: number | undefined;
        shadowOpacity: number | undefined;
        hidden: boolean;
    } | null>(null);
    const surfaceZRef = useRef(opts.surfaceZ);
    surfaceZRef.current = opts.surfaceZ;
    const reduced = prefersReducedMotion();

    /**
     * Draws the current state (position, lift, `state.pose`) through the latest projector:
     * slides the shadow, redraws the 3D figure, places the bubble. Called by the loop every
     * frame, and after every render (below) so a new camera never shows a stale frame.
     */
    const applyFrame = (force: boolean) => {
        const s = state.current;
        const { hop, lean, sx, sy, emoteLean, shadowOverride, hidden } = s.pose;
        // CSS px on SVG elements are user units, so these are scene units.
        const p = projRef.current;
        const z0 = surfaceZRef.current;
        // IDLE FRAMES: a pawn standing in a pause draws the same pose every frame, and any
        // write to the scene svg (even of an unchanged value) costs a repaint of the WHOLE
        // svg — the tower, its gradients, the clouds — since svg children get no
        // compositor layers of their own. So the loop skips the write when nothing it
        // draws from has changed. A render always draws (`force`): it may have mounted a
        // node (the "!" bubble's anchor) that has never been placed.
        const d = drawn.current;
        if (
            !force &&
            d !== null &&
            d.proj === p &&
            d.z0 === z0 &&
            d.x === s.pos.x &&
            d.y === s.pos.y &&
            d.lift === s.lift &&
            d.hop === hop &&
            d.lean === lean &&
            d.sx === sx &&
            d.sy === sy &&
            d.emoteLean === emoteLean &&
            d.shadowScale === shadowOverride?.scale &&
            d.shadowOpacity === shadowOverride?.opacity &&
            d.hidden === hidden
        ) {
            return;
        }
        drawn.current = {
            proj: p,
            z0,
            x: s.pos.x,
            y: s.pos.y,
            lift: s.lift,
            hop,
            lean,
            sx,
            sy,
            emoteLean,
            shadowScale: shadowOverride?.scale,
            shadowOpacity: shadowOverride?.opacity,
            hidden,
        };
        const home = p.project(at.x, at.y, z0);
        // `lift` raises the whole pawn (shadow and decal clip included): it stands, and
        // casts its shadow, on the step's top face.
        const here = p.project(s.pos.x, s.pos.y, z0 + s.lift);
        // The shadow is a true projection drawn at `at` (IsoShadow), so it is already the
        // right size THERE: it only rescales by the change from there to here.
        const shadowSizeHere = p.scaleAt(s.pos.x, s.pos.y, z0 + s.lift) / p.scaleAt(at.x, at.y, z0);
        if (refs.presence.current) refs.presence.current.style.visibility = hidden ? "hidden" : "";
        if (refs.travel.current) refs.travel.current.style.transform = `translate(${here.x - home.x}px, ${here.y - home.y}px)`;
        if (refs.decalAnchor.current) refs.decalAnchor.current.style.transform = `translate(${home.x - here.x}px, ${home.y - here.y}px)`;

        // VIEW (header): the figure in true 3D, its feet `hop` above the surface.
        const feet = { x: s.pos.x, y: s.pos.y, z: z0 + s.lift + hop };
        const fig = pawnFigure(p, feet, { lean, sx, sy });
        refs.body.current?.setAttribute("d", fig.bodyPath);
        if (refs.head.current) {
            refs.head.current.setAttribute("cx", String(fig.head.cx));
            refs.head.current.setAttribute("cy", String(fig.head.cy));
            refs.head.current.setAttribute("r", String(fig.head.r));
        }
        if (refs.emoteAnchor.current) {
            // Billboard: upright on screen, its tail tip just over the head's top, not
            // squashed or waddling with the body (an unsquashed figure at the look-up lean).
            const still = emoteLean === lean && sx === 1 && sy === 1 ? fig : pawnFigure(p, feet, { lean: emoteLean, sx: 1, sy: 1 });
            const k = still.headScale;
            const tipY = still.head.cy - (HEAD_RADIUS + EMOTE_GAP) * k;
            const f = k / EMOTE_DRAW_SCALE;
            refs.emoteAnchor.current.style.transform = `translate(${still.head.cx}px, ${tipY}px) scale(${f})`;
        }
        if (refs.shadow.current) {
            // Clamped at 0: falling BELOW its surface (FLOOR DROP) doesn't grow the shadow.
            const air = clamp01(hop / LEAP_HOP_HEIGHT);
            const shadowScale = shadowOverride ? shadowOverride.scale : 1 - 0.25 * air;
            const shadowOpacity = shadowOverride ? shadowOverride.opacity : 1 - 0.4 * air;
            refs.shadow.current.style.transform = `scale(${shadowScale * shadowSizeHere})`;
            refs.shadow.current.style.opacity = String(shadowOpacity);
            // The shaded decals are the same shadow seen on another receiver: same
            // shrink, same fade.
            if (refs.decalClip.current) refs.decalClip.current.style.transform = refs.shadow.current.style.transform;
            if (refs.decalShade.current) refs.decalShade.current.style.opacity = refs.shadow.current.style.opacity;
        }
    };
    const applyRef = useRef(applyFrame);
    applyRef.current = applyFrame;
    // After every render, before paint: the first frame (and every frame under reduced
    // motion, when no loop runs) and every re-render with a new camera draw at once.
    useLayoutEffect(() => applyRef.current(true));

    // Rising edge of `startled` → switch to the startle timeline from wherever the feet are.
    // Seeded with the MOUNT value: a pawn that mounts beside an already-tall tower (the
    // Deck Tower remounts its pawn on arriving in another world) has nothing to be
    // startled by — only a change it watches happen (the build-up crossing the threshold)
    // counts.
    const wasStartled = useRef(startled);
    useEffect(() => {
        const rose = startled && !wasStartled.current;
        wasStartled.current = startled;
        if (!rose || reduced) return;
        const s = state.current;
        // In the air arriving: no startle.
        if (s.mode.kind === "entrance") return;
        // Cut a hop short: ease the lift from wherever the arc had it (see the step code).
        if (s.mode.kind === "edgeHop") {
            s.liftFrom = s.lift;
            s.liftT0 = performance.now();
        }
        // Lean AWAY from the source on screen: a pawn to the tower's right tips its top
        // further right as it cranes up at it.
        const p = projRef.current;
        const pawnSx = p.project(s.pos.x, s.pos.y, 0).x;
        const srcSx = startledBy ? p.project(startledBy.x + startledBy.w / 2, startledBy.y + startledBy.d / 2, 0).x : pawnSx - 1;
        const leanSign: 1 | -1 = pawnSx >= srcSx ? 1 : -1;
        s.mode = { kind: "startle", t0: performance.now(), from: { ...s.pos }, to: leapLanding(s.pos, startledBy, roam), leanSign };
        setEmote((e) => ({ id: (e?.id ?? 0) + 1 }));
    }, [startled, reduced, startledBy, roam]);

    useEffect(() => {
        if (reduced) return;
        const s = state.current;
        // Opening hold: stand still for a beat on mount (see OPENING_PAUSE_MIN_MS) — or,
        // with an entrance, arrive first and take the opening hold after landing.
        const openingPause = (now: number): Mode => ({
            kind: "pause",
            until: now + OPENING_PAUSE_MIN_MS + Math.random() * (OPENING_PAUSE_MAX_MS - OPENING_PAUSE_MIN_MS),
        });
        const cue = entranceCue.current;
        s.mode = cue ? { kind: "entrance", t0: cue.startAt, anim: cue.animation } : openingPause(performance.now());
        let frame = 0;
        let last = performance.now();
        // The feet are off their surface, or still moving (launched, mid-bounce).
        const feetAirborne = () => s.feetV !== 0 || s.feetZ > s.lift + FEET_EPS;

        const tick = (now: number) => {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            let hop = 0; // world units off the floor
            let lean = 0; // degrees
            let sx = 1;
            let sy = 1;
            // Set only by an entrance; otherwise the shadow follows `hop` (see Apply).
            let shadowOverride: { scale: number; opacity: number } | null = null;
            let hidden = false;
            const m = s.mode;

            if (m.kind === "entrance") {
                const t = now - m.t0;
                if (t < 0) {
                    // Not on stage yet.
                    hidden = true;
                } else if (t >= m.anim.durationMs) {
                    s.mode = openingPause(now);
                } else {
                    const f = m.anim.frame(t);
                    hop = f.hop;
                    sx = f.sx;
                    sy = f.sy;
                    shadowOverride = { scale: f.shadowScale, opacity: f.shadowOpacity };
                }
            } else if (m.kind === "pause") {
                // Never set off mid-air (thrown up by the plate): wait for the feet.
                if (now >= m.until && !feetAirborne()) {
                    const target = roam ? pickTarget(s.pos, roam) : null;
                    s.mode = target ? { kind: "walk", target } : { kind: "pause", until: now + PAUSE_MIN_MS };
                }
            } else if (m.kind === "walk" || m.kind === "land") {
                if (m.kind === "walk") {
                    const dx = m.target.x - s.pos.x;
                    const dy = m.target.y - s.pos.y;
                    const dist = Math.hypot(dx, dy);
                    const stride = WALK_SPEED * dt;
                    if (dist <= stride) {
                        s.pos = { ...m.target };
                        s.mode = { kind: "land" };
                    } else {
                        s.pos = { x: s.pos.x + (dx / dist) * stride, y: s.pos.y + (dy / dist) * stride };
                    }
                    // Edge hop: look HOP_LEAD ahead along the walk (never past its end, so a
                    // walk that stops short of an edge never hops it). A surface of a
                    // different height there means the edge is within reach: stop here and
                    // hop it from a standstill.
                    const rest = dist - stride;
                    const steps = stepsRef.current;
                    if (rest > 1e-6 && !feetAirborne()) {
                        const dir = { x: dx / dist, y: dy / dist };
                        const along = (d: number) => ({ x: s.pos.x + dir.x * d, y: s.pos.y + dir.y * d });
                        const lead = Math.min(HOP_LEAD, rest);
                        const aheadIdx = stepUnder(along(lead), steps);
                        const aheadH = aheadIdx >= 0 ? steps[aheadIdx].height : 0;
                        if (aheadIdx !== s.stepIdx && Math.abs(aheadH - s.lift) >= HOP_MIN_RISE) {
                            // Land as far past the edge as it stopped short of it — but never
                            // past the walk's end, nor off the far side of a narrow step.
                            let to = along(Math.min(2 * HOP_LEAD, rest));
                            if (stepUnder(to, steps) !== aheadIdx) to = along(lead);
                            s.mode = {
                                kind: "edgeHop",
                                t0: now,
                                from: { ...s.pos },
                                to,
                                toIdx: aheadIdx,
                                resume: m.target,
                                fromBounce: STEP_HOP * Math.abs(Math.sin(s.stepPhase)),
                                fromLean: WADDLE_DEG * Math.sin(s.stepPhase),
                                fromLift: s.lift,
                                landed: false,
                            };
                        }
                    }
                }
                // One bounce per step: |sin| touches down every π. On arrival keep stepping
                // in place until the feet are down, so the pawn never drops out of mid-air.
                const before = Math.floor(s.stepPhase / Math.PI);
                s.stepPhase += dt * STEP_RATE * Math.PI;
                if (s.mode.kind === "land" && Math.floor(s.stepPhase / Math.PI) !== before) {
                    s.stepPhase = 0;
                    s.mode = { kind: "pause", until: now + PAUSE_MIN_MS + Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS) };
                } else {
                    hop = STEP_HOP * Math.abs(Math.sin(s.stepPhase));
                    lean = WADDLE_DEG * Math.sin(s.stepPhase);
                }
                // Just stopped to hop: this frame still shows the walk's pose; the hop's
                // timeline (below, next frame on) eases it out from here.
            } else if (m.kind === "edgeHop") {
                const t = now - m.t0;
                if (t < HOP_PREP_END) {
                    // Prepare: the walk's bounce and waddle die out (feet down, upright),
                    // then it crouches, deepest at take-off.
                    const stop = 1 - easeOut(clamp01(t / HOP_STOP_MS));
                    hop = m.fromBounce * stop;
                    lean = m.fromLean * stop;
                    const d = HOP_CROUCH * easeInOut(t / HOP_PREP_MS);
                    sx = 1 + 0.75 * d;
                    sy = 1 - d;
                } else if (t < HOP_AIR_END) {
                    // In the air: across the edge in a parabola, stretched like the startle
                    // leap. (`lift` glides between the two surfaces in the step code below.)
                    const u = (t - HOP_PREP_END) / HOP_MS;
                    s.pos = { x: m.from.x + (m.to.x - m.from.x) * u, y: m.from.y + (m.to.y - m.from.y) * u };
                    hop = 4 * HOP_ARC * u * (1 - u);
                    const e = 0.07 * Math.sin(Math.PI * u);
                    sx = 1 - 0.7 * e;
                    sy = 1 + e;
                } else if (t < HOP_END) {
                    // Recover: squash on touch-down, ease out of it, then stand a beat.
                    s.pos = { ...m.to };
                    const d = HOP_LAND_SQUASH * (1 - easeOut(clamp01((t - HOP_AIR_END) / HOP_SQUASH_MS)));
                    sx = 1 + 0.75 * d;
                    sy = 1 - d;
                } else {
                    // Walk on from feet-down — or, if the hop carried it to the walk's end, pause.
                    s.pos = { ...m.to };
                    s.stepPhase = 0;
                    const atEnd = Math.hypot(m.resume.x - s.pos.x, m.resume.y - s.pos.y) < 1e-6;
                    s.mode = atEnd
                        ? { kind: "pause", until: now + PAUSE_MIN_MS + Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS) }
                        : { kind: "walk", target: m.resume };
                }
            } else {
                const t = now - m.t0;
                const L = LOOK_UP_LEAN_DEG * m.leanSign;
                // Lean: snap back, hold through the leap and the stare, then straighten.
                if (t < LEAN_MS) lean = L * easeOut(t / LEAN_MS);
                else if (t < RECOVER_AT) lean = L;
                else lean = L * (1 - easeInOut(clamp01((t - RECOVER_AT) / RECOVER_MS)));
                // Leap: slide from → to with a parabolic arc, stretched in the air.
                const u = clamp01((t - LEAN_MS) / LEAP_MS);
                const k = easeOut(u);
                s.pos = { x: m.from.x + (m.to.x - m.from.x) * k, y: m.from.y + (m.to.y - m.from.y) * k };
                if (u > 0 && u < 1) {
                    hop = 4 * LEAP_HOP_HEIGHT * u * (1 - u);
                    const e = 0.07 * Math.sin(Math.PI * u);
                    sx = 1 - 0.7 * e;
                    sy = 1 + e;
                } else if (t >= LANDED_AT && t < LANDED_AT + SETTLE_MS) {
                    // Landing squash, easing back out.
                    const d = 0.16 * (1 - (t - LANDED_AT) / SETTLE_MS) ** 2;
                    sx = 1 + 0.75 * d;
                    sy = 1 - d;
                }
                if (t >= STARTLE_END) s.mode = { kind: "pause", until: now + PAUSE_MIN_MS };
            }

            // Step up / down.
            const steps = stepsRef.current;
            const heightOf = (i: number) => (i >= 0 && steps[i] ? steps[i].height : 0);
            // An edge hop owns the lift while it is in the air: the surface under the body
            // (`lift`, which carries the shadow too) glides from the take-off height to the
            // landing surface's LIVE height, with the arc riding on top in `hop` — so only
            // the body leaves the ground and the shadow shrinks beneath it. On touch-down,
            // once, the landing surface is committed with no ease pending, so the code below
            // tracks its live height from there. (A startle cutting the hop short hands the
            // lift to that code's ease — see the startle effect.)
            const hm = s.mode.kind === "edgeHop" ? s.mode : null;
            const hopT = hm ? now - hm.t0 : 0;
            const airborne = hm !== null && hopT >= HOP_PREP_END && hopT < HOP_AIR_END;
            if (hm && airborne) {
                s.lift = hm.fromLift + (heightOf(hm.toIdx) - hm.fromLift) * easeInOut((hopT - HOP_PREP_END) / HOP_MS);
            } else if (hm && hopT >= HOP_AIR_END && !hm.landed) {
                hm.landed = true;
                s.stepIdx = hm.toIdx;
                s.lift = s.liftFrom = heightOf(hm.toIdx);
                s.liftT0 = -Infinity;
            }
            if (!airborne) {
                // On the same surface as last frame the feet track its live height exactly
                // (so they sink with a pressed plate). Crossing an edge with no hop (a
                // startle leap, a corner clipped while landing, a rise under HOP_MIN_RISE)
                // starts a short ease from wherever the lift was to the new surface's height.
                const idx = stepUnder(s.pos, steps);
                if (idx !== s.stepIdx) {
                    s.stepIdx = idx;
                    s.liftFrom = s.lift;
                    s.liftT0 = now;
                }
                const stepU = clamp01((now - s.liftT0) / STEP_MS);
                s.lift = s.liftFrom + (heightOf(idx) - s.liftFrom) * easeOut(stepU);
            }

            // Feet physics (see the header's STEPS). Only where the motion has feet on the
            // ground to begin with: an entrance or an edge hop places the body itself, so
            // there the feet just stand on the surface.
            const floorDrop = floorDropRef.current;
            if (floorDrop <= 0 && s.fall) {
                // The floor came back (not something a swap does today): stand on it again.
                s.fall = null;
                s.feetZ = s.lift;
                s.feetV = 0;
            }
            if (floorDrop > 0 && s.mode.kind === "edgeHop") {
                // The floor went mid edge hop: drop the hop from where its arc has the body,
                // and fall from there (walking on, legs still, toward the same target).
                s.feetZ = s.lift + hop;
                s.feetV = 0;
                s.mode = { kind: "walk", target: s.mode.resume };
                hop = 0;
                sx = sy = 1;
            }
            if (floorDrop > 0 && s.mode.kind !== "entrance") {
                // FLOOR DROP (see the header): nothing to stand on. Free flight under GRAVITY;
                // once it is no longer rising, the fall starts ("!") and the height blends
                // into where it would be standing on the falling floor (`lift − floorDrop`).
                // Not measured from where the fall began: a launched pawn would then trail
                // the floor by its whole launch height and still be on screen when the swap
                // unmounts it (the drop only clears the screen by FALL_CLEARANCE).
                s.launchArmed = false;
                if (!s.fall && s.feetV <= 0) {
                    s.fall = { t0: now };
                    setEmote((e) => ({ id: (e?.id ?? 0) + 1 }));
                }
                s.feetV -= GRAVITY * dt;
                s.feetZ += s.feetV * dt;
                let z = s.feetZ;
                if (s.fall) {
                    const w = easeInOut(clamp01((now - s.fall.t0) / FALL_BLEND_MS));
                    z += (s.lift - floorDrop - z) * w;
                }
                const fly = z - s.lift;
                if (s.mode.kind === "walk" || s.mode.kind === "land") {
                    hop = fly;
                    lean = 0;
                    s.stepPhase = 0;
                } else {
                    hop += fly;
                }
            } else if (s.mode.kind === "entrance" || s.mode.kind === "edgeHop") {
                s.feetZ = s.lift;
                s.feetV = 0;
                s.launchArmed = false;
            } else {
                // Press / release: read off the LIVE height of the step the feet stand on.
                const stepH = heightOf(s.stepIdx);
                // Touching = the (risen) surface has reached the feet. Not "standing": on a
                // quick tap the plate springs back up while the pawn is still falling onto it,
                // and the launch fires when the two meet.
                const touching = s.feetZ <= s.lift + FEET_EPS;
                if (s.stepIdx >= 0 && s.stepIdx === s.prevStepIdx) {
                    const dh = stepH - s.prevStepH;
                    if (dh < -FEET_EPS) s.launchArmed = true;
                    else if (dh > FEET_EPS && s.launchArmed && touching) {
                        s.launchArmed = false;
                        s.feetV = PLATE_LAUNCH_SPEED;
                    }
                } else {
                    s.launchArmed = false;
                }
                s.prevStepIdx = s.stepIdx;
                s.prevStepH = stepH;

                if (s.feetV === 0 && s.feetZ <= s.lift + FEET_EPS) {
                    // On the surface: ride it (a rising surface just carries the feet up).
                    s.feetZ = s.lift;
                } else {
                    // While the rising plate is still pushing the feet up faster than their
                    // launch speed, they ride it (no gravity yet); once it slows they fly off.
                    const pushed = s.feetZ <= s.lift && s.feetV > 0;
                    if (!pushed) s.feetV -= GRAVITY * dt;
                    s.feetZ += s.feetV * dt;
                    if (s.feetZ <= s.lift) {
                        s.feetZ = s.lift;
                        if (s.feetV < 0) {
                            // Impact: squash, then bounce back up or settle.
                            const speed = -s.feetV;
                            s.impactT0 = now;
                            s.impactDepth = Math.min(IMPACT_SQUASH_MAX, IMPACT_SQUASH_PER_SPEED * speed);
                            s.feetV = speed > BOUNCE_MIN_SPEED ? speed * BOUNCE_RESTITUTION : 0;
                        }
                    }
                }
                const fly = s.feetZ - s.lift;
                if (fly > FEET_EPS) {
                    if (s.mode.kind === "walk" || s.mode.kind === "land") {
                        // Thrown up mid-walk: legs still in the air — no step bounce or waddle,
                        // and the step cycle restarts from feet-down when it lands.
                        hop = fly;
                        lean = 0;
                        s.stepPhase = 0;
                    } else {
                        hop += fly;
                    }
                }
                const impactU = (now - s.impactT0) / IMPACT_MS;
                if (impactU < 1) {
                    const d = s.impactDepth * (1 - impactU) ** 2;
                    sx *= 1 + 0.75 * d;
                    sy *= 1 - d;
                }
            }

            // Apply: hand the pose to `applyFrame`, which draws it.
            s.pose = { hop, lean, sx, sy, emoteLean: s.mode.kind === "startle" ? lean : 0, shadowOverride, hidden };
            applyRef.current(false);

            if (roam) {
                // Ranked among the obstacles in the CAMERA's back-to-front order (it changes
                // as the study camera dives), the same order DeckTowerPlatform draws them in.
                const p = projRef.current;
                const rank = depthRankAmong(
                    s.pos,
                    backToFront(roam.obstacles, p).map((i) => roam.obstacles[i]),
                    p,
                );
                if (rank !== s.rank) {
                    s.rank = rank;
                    onRank.current?.(rank);
                }
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
        // `at`/`roam` are expected to be module constants; the projector and the drawing are
        // reached through `applyRef` (see VIEW in the header), so a new camera never restarts it.
    }, [reduced, at, roam]);

    return { refs, emote };
}
