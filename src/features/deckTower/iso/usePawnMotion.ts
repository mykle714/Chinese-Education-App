import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { insetRect, insideRoundedRect, type Projector, type WorldRect } from "./geometry";
import { shadowSlide, shadowSpread } from "./light";
import { prefersReducedMotion } from "./skyTraffic";
import { PAWN_GRAVITY, type PawnEntrance } from "./pawnEntrances";
import { EMOTE_GAP, HEAD_RADIUS, PAWN_BODY_RADIUS, pawnFigure, pawnSnowClip, pawnVest } from "./pawnFigure";
import { flinchPose, idlePose, IDLE_STALE_MS, LASTING_IDLES, type IdlePose, type PawnIdleCue, type PawnIdleKind } from "./pawnIdles";

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
 * POKE: `poke()` (IsoPawn `tappable`) pops the "!" bubble and throws the feet straight up
 * (POKE_JUMP_SPEED) through the same feet physics a plate launch uses, so it lands in the
 * same shrinking bounces. Every poke counts, in the air too: it re-throws the feet from
 * wherever they are, so quick taps climb higher and GRAVITY brings the pawn back down once
 * they stop. A poked walk stops where it is, and the pawn stands until the bubble has gone
 * (EMOTE_MS). A poke is ignored during an entrance or an edge hop (they place the body
 * themselves, with no feet physics to throw) and while the floor is dropping.
 *
 * SUMMIT: a step marked `summit` (the Deck Tower's tower top) is a surface no walk reaches.
 * A poke while the feet are above it throws the pawn onto it instead of jumping (the `flight`
 * mode: the feet fly under the feet physics, the ground position glides to a random spot
 * over the time that takes). There it wanders that step, under `walkRoam`, and draws in
 * front of every obstacle. As with any step its height is live, so height changes need no
 * code of their own: a shrink leaves the pawn to fall onto the new top, and a sudden rise
 * (SUMMIT_JOLT_RISE, a sky drop landing) throws it up. When the summit `closed`s, the pawn
 * flies back down to `at`; while it is `held` the pawn finishes its step and stands still,
 * so the Deck Tower's cover card can carry it off (`summitSpot`). It ignores startles up
 * there (there is nothing to leap away from).
 *
 * SHOCK: each change of `shockId` (a lightning strike landing on the pawn) stops it where
 * it stands for SHOCK_MS + SHOCK_RECOVER_MS — the flicker itself is IsoPawn's CSS — then
 * it walks on. `floorSpot` reports where it stands on the floor every frame (null when it
 * is not on the floor), which is how the Deck Tower tests a strike against it.
 *
 * STRETCH: each new `stretch` cue (a `{ id, at }`; the flp's hint pawn sends one per new
 * speech bubble, timed to the bubble's grow-in — docs/HINT_PAWN.md § "Back stretch") plays a
 * back stretch from a standstill, starting at `at`: a little crouch (STRETCH_CROUCH_END),
 * then it draws itself up tall and thin while CURVING ITS BACK — the spine bends
 * (STRETCH_ARCH_DEG, pawnFigure's `arch`) over a small whole-body lean — (STRETCH_REACH_END),
 * holds the reach with a slight quiver (STRETCH_HOLD_END), and lets go — straightening in a
 * breath out with a soft squash as it settles (STRETCH_MS). It curls BACKWARD, away from
 * the way the pawn faces: the stretch's pose sets pawnFigure's `bendHeading` to `facing`
 * and both angles are < 0 (for the hint pawn, away from the viewer and its bubble). A cue
 * waits while the pawn is busy (arriving, walking, mid-air) and is dropped if it is still
 * waiting STRETCH_STALE_MS after `at`. A poke rides on top of it, as on a startle.
 *
 * IDLE ANIMATIONS (not the wandering IDLE above): each new `idle` cue (a `PawnIdleCue`,
 * pawnIdles.ts; the flp's hint pawn sends one a minute — docs/HINT_PAWN.md § "Idle
 * animations") plays a sneeze, a song, a doze or knitting from a standstill (the `idle`
 * mode; the pose curves are pawnIdles.ts's). Like a stretch cue it waits while the pawn is
 * busy; a one-shot cue is dropped IDLE_STALE_MS after `at`, a lasting one waits. A one-shot
 * ends on its own. A LASTING idle (doze, knit) holds until the cue is withdrawn (null) or
 * replaced, then eases out (IDLE_EXIT_MS). A tap ends any idle at once. `activeIdle` reports
 * what is playing (and when it is easing out), so IsoPawn draws its marks — z's, notes,
 * the sneeze puff, the needles — only while the pose is.
 *
 * TAP REACTION: with `onTap`, the page picks each tap's reaction — "jump" (the POKE) or
 * "flinch" (the `flinch` mode: a short recoil on the spot, pawnIdles.ts → `flinchPose`;
 * the hint pawn shows its "ouch" bubble with it) — and the poke pops NO "!" bubble (the
 * page has its own reply). A tap while the feet are in the air always jumps, whatever
 * `onTap` returns. Without `onTap` every tap is a jump with the "!", as on the Deck Tower.
 *
 * Under prefers-reduced-motion nothing runs: the pawn stands at `at`, and the startle, the
 * poke, the stretch, the idles and the flinch are skipped.
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
    /**
     * The depth of the snow lying on it, overriding the floor's (`snowDepth`): 0 = bare (the
     * Deck Tower's plate once pressed clear, in its hole), the cap's depth on a snowy tower
     * top. Undefined: the floor's, lifted with the step (the drift over a buried plate) —
     * except a summit, which never takes the floor's snow.
     */
    snowDepth?: number;
    /** Makes this the summit (see the header's SUMMIT). At most one per pawn. */
    summit?: {
        /** It may not be stood on: a pawn up there flies down, and a poke will not throw one up. */
        closed: boolean;
        /** A pawn up there stands still, and a poke will not throw one up. */
        held: boolean;
    };
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
/**
 * Ground one step covers (≈0.44 units; one sway of the waddle). Every walk is a whole
 * number of these (`stepWalkTarget`), so the pawn arrives exactly as a step lands, feet
 * down and upright, instead of treading in place to finish it.
 */
const STEP_DISTANCE = WALK_SPEED / STEP_RATE;
const PAUSE_MIN_MS = 900;
const PAUSE_MAX_MS = 3300;
/**
 * The first pause after the scene mounts. Longer than an ordinary pause so the pawn
 * stands still while the page settles in, instead of setting off the instant it appears.
 */
const OPENING_PAUSE_MIN_MS = 3500;
const OPENING_PAUSE_MAX_MS = 6000;
/**
 * Shortest and longest walk worth taking; shorter picks look like twitching. With walks in
 * whole steps these allow 3–12 steps (1.32–5.29 units).
 */
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
/** World height of the feet over the surface above which the pawn counts as `airborne` (not the last tiny bounces of a landing). */
const AIRBORNE_MIN = 0.03;
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

/**
 * Back stretch (see the header's STRETCH). Phase ends in ms from its start: the crouch,
 * the reach up and back, the held reach, then the release to STRETCH_MS.
 */
const STRETCH_CROUCH_END = 150;
const STRETCH_REACH_END = 520;
const STRETCH_HOLD_END = 820;
const STRETCH_MS = 1200;
/** The crouch's depth (squash, as the landing squashes measure it). */
const STRETCH_CROUCH = 0.08;
/** How much taller (and, at half that, thinner) it draws itself up at full reach; the hold adds REACH_GROW. */
const STRETCH_REACH = 0.16;
const STRETCH_REACH_GROW = 0.03;
/**
 * The back's curve at full reach: the spine bends this many degrees from the hips to the
 * body's top (pawnFigure's `arch`; negative = curling away from `bendHeading`, which the
 * stretch sets to the pawn's facing), on top of a small whole-body lean. The head carries on along the top's direction, so it ends up
 * tipped back by LEAN + ARCH.
 */
const STRETCH_ARCH_DEG = -15; // halved from −30 (owner, 2026-11-08): the facing-relative bend read as too tilted
const STRETCH_LEAN_DEG = -3;
/** The held reach's quiver (on the arch): degrees, and cycles across the hold. */
const STRETCH_QUIVER_DEG = 0.6;
const STRETCH_QUIVER_CYCLES = 2;
/** The settle's squash as it lets go. */
const STRETCH_SETTLE_SQUASH = 0.06;
/** A cue still waiting this long after its `at` (the pawn was busy) is dropped. */
const STRETCH_STALE_MS = 1500;

/** Poke (see the header's POKE): how high the jump clears its surface, and the speed that gets it there. */
const POKE_JUMP_HEIGHT = 2.6;
const POKE_JUMP_SPEED = Math.sqrt(2 * GRAVITY * POKE_JUMP_HEIGHT);
/**
 * Radius of the pawn's invisible tap target, in camera-facing world units. Roughly the
 * figure's half height: the body alone is only a few px wide and never stops moving.
 */
const PAWN_HIT_RADIUS = 1.1;
/**
 * A summit rising this far in one frame jolts the pawn up (see the header's SUMMIT). It
 * tells a landing sky drop from a build-up's steady climb, about 0.1 units a frame.
 */
const SUMMIT_JOLT_RISE = 0.5;
/** A throw lands at least this far further in from the summit's edge than the pawn could stand. */
const SUMMIT_LANDING_INSET = 0.8;

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
/** How much further along +x and +y the shadow reaches than the foot circle (light.ts → `shadowSpread`). */
const SHADOW_SPREAD = shadowSpread();

/** Where a foot-sized circle's centre may be: the roam area shrunk by the foot radius (corners stay rounded). */
function feetBox(roam: PawnRoam): WorldRect {
    return insetRect(roam.area, PAWN_FOOT_RADIUS);
}

/**
 * Whether the feet may stand at `p`: both the foot circle and its shadow circle fit in
 * the roam area. The shadow is stretched SHADOW_SPREAD along +x and +y, so its centre is
 * held that much further from the area's +x and +y edges (only those). Both regions are convex, so their
 * intersection is too — any straight walk between two legal points stays legal, and only
 * the endpoints need checking.
 */
function onFloor(p: Pt2, roam: PawnRoam): boolean {
    const box = feetBox(roam);
    const shadowBox = { ...box, w: box.w - SHADOW_SPREAD.x, d: box.d - SHADOW_SPREAD.y };
    return insideRoundedRect(p, box) && insideRoundedRect({ x: p.x + SHADOW_SLIDE.x, y: p.y + SHADOW_SLIDE.y }, shadowBox);
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
function pickTarget(from: Pt2, roam: PawnRoam, minDist = WALK_MIN, maxDist = WALK_MAX): Pt2 | null {
    const box = feetBox(roam);
    for (let i = 0; i < PICK_TRIES; i++) {
        const p = { x: box.x + Math.random() * box.w, y: box.y + Math.random() * box.d };
        if (!onFloor(p, roam)) continue;
        const dist = Math.hypot(p.x - from.x, p.y - from.y);
        if (dist < minDist || dist > maxDist) continue;
        if (pathClear(from, p, roam.obstacles)) return p;
    }
    return null;
}

/**
 * `target`, pulled back along the straight line from `from` to the nearest whole number of
 * steps (STEP_DISTANCE), rounding down; null when not even one step fits. Rounding
 * down keeps the point on the original segment, so a path that was clear (and legal — the
 * roam regions are convex, see onFloor) stays so.
 */
function stepWalkTarget(from: Pt2, target: Pt2): Pt2 | null {
    const dist = Math.hypot(target.x - from.x, target.y - from.y);
    // The epsilon keeps a target that is already a whole number of steps from losing one to rounding.
    const steps = Math.floor(dist / STEP_DISTANCE + 1e-6);
    if (steps < 1) return null;
    const k = (steps * STEP_DISTANCE) / dist;
    return { x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k };
}

/**
 * A wander target (pickTarget) cut to a whole number of steps. Cutting only shortens, so
 * the result is still ≤ WALK_MAX; a pick that drops under WALK_MIN is retried.
 */
const WALK_PICK_ROUNDS = 4;
function pickWalkTarget(from: Pt2, roam: PawnRoam): Pt2 | null {
    for (let i = 0; i < WALK_PICK_ROUNDS; i++) {
        const raw = pickTarget(from, roam);
        const p = raw && stepWalkTarget(from, raw);
        if (p && Math.hypot(p.x - from.x, p.y - from.y) >= WALK_MIN) return p;
    }
    return null;
}

const rectCentre = (r: WorldRect): Pt2 => ({ x: r.x + r.w / 2, y: r.y + r.d / 2 });

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
    /** The back stretch (see the header's STRETCH), from a standstill. */
    | { kind: "stretch"; t0: number }
    /**
     * An idle animation (see the header's IDLE ANIMATIONS). `endT0` is when a LASTING idle's
     * cue was withdrawn (null while it holds): it eases out from there.
     */
    | { kind: "idle"; t0: number; idle: PawnIdleKind; id: string | number; endT0: number | null }
    /** The tap flinch (see the header's TAP REACTION), from a standstill. */
    | { kind: "flinch"; t0: number }
    | { kind: "entrance"; t0: number; anim: PawnEntrance }
    /** A throw onto or off the summit: the ground position glides `from` → `to` over `ms`. */
    | { kind: "flight"; t0: number; from: Pt2; to: Pt2; ms: number }
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
    /**
     * The night vest's band and its reflective stripes (IsoPawn `vest`, pawnFigure.ts →
     * `pawnVest`): rewritten every frame while mounted. Unmounted (null) on a pawn without a
     * vest, which then skips the vest's geometry entirely.
     */
    vest: React.RefObject<SVGPathElement | null>;
    vestStripes: React.RefObject<SVGPathElement | null>;
    /** The vest's open front and arm holes, drawn in ink over the cloth. */
    vestOpenings: React.RefObject<SVGPathElement | null>;
    /** Places the "!" bubble (drawn round its tail tip at the origin, EMOTE_DRAW_SCALE px per unit) over the head. */
    emoteAnchor: React.RefObject<SVGGElement | null>;
    /** The invisible tap target (IsoPawn `tappable`), centred on the figure every frame. */
    hit: React.RefObject<SVGCircleElement | null>;
    /** The shadow on the floor; hidden on the summit. */
    floorShadow: React.RefObject<SVGGElement | null>;
    /** The see-through shadow; shown only on the summit. */
    summitShadow: React.RefObject<SVGGElement | null>;
    /** Shrinks the shadow while airborne. */
    shadow: React.RefObject<SVGGElement | null>;
    /** The shaded-decal copy: fades with the shadow. */
    decalShade: React.RefObject<SVGGElement | null>;
    /** The shadow outline the decal copy is clipped to: shrinks with the shadow. */
    decalClip: React.RefObject<SVGPathElement | null>;
    /** Undoes `travel` on the decal copy, so the decals stay put on the floor. */
    decalAnchor: React.RefObject<SVGGElement | null>;
    /** The figure's group clipped to the snow line while it stands in snow (`snowDepth`). */
    sunk: React.RefObject<SVGGElement | null>;
    /** That clip's outline (pawnFigure.ts → `pawnSnowClip`), rewritten every frame. */
    sunkClip: React.RefObject<SVGPathElement | null>;
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
/** The "!" bubble's one-shot (IsoPawn's CSS); a poked pawn stands this long. */
export const EMOTE_MS = 2000;
/**
 * A lightning shock (`shockId`, see the header's SHOCK): the pawn stands frozen this long
 * while IsoPawn flickers it, then stands a beat more (SHOCK_RECOVER_MS) before walking on.
 */
export const SHOCK_MS = 1000;
const SHOCK_RECOVER_MS = 900;

/**
 * A back stretch to play (see the header's STRETCH): a new `id` is a new stretch, starting
 * at `at` (a `performance.now()` timestamp).
 */
export interface PawnStretchCue {
    id: string | number;
    at: number;
}

/** What the page answers a tap with (see the header's TAP REACTION). */
export type PawnTapReaction = "jump" | "flinch";

/** The idle being played (see the header's IDLE ANIMATIONS); `ending` while it eases out. */
export interface PawnActiveIdle {
    id: string | number;
    kind: PawnIdleKind;
    ending: boolean;
}

/** An entrance to play on mount, and when to start it (a `performance.now()` timestamp). */
export interface PawnEntranceCue {
    animation: PawnEntrance;
    startAt: number;
}

export function usePawnMotion(opts: {
    proj: Projector;
    at: Pt2;
    /** null = not known yet (the tower's count is loading): the first known value is a baseline, never a startle. */
    startled: boolean | null;
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
    /** Called when the pawn gets onto, or leaves, the summit. */
    onSummitChange?: (onSummit: boolean) => void;
    /** Kept at where the pawn stands on the summit (null when it is not there), every frame. */
    summitSpot?: React.MutableRefObject<Pt2 | null>;
    /** World z of the surface the pawn stands on (its feet are drawn in absolute world space). */
    surfaceZ: number;
    /**
     * Kept at where the pawn stands on the FLOOR (its live ground point), every frame; null
     * while it is not there to be hit (before its entrance, up on the summit, falling).
     * The Deck Tower reads it to tell whether a lightning strike landed on the pawn.
     */
    floorSpot?: React.MutableRefObject<Pt2 | null>;
    /**
     * Kept true while the feet are off the ground: a jump or a throw (feet physics above
     * `AIRBORNE_MIN`), a flight onto the summit, an edge hop. The walk's own step bounce does
     * not count. The Deck Tower's snow trails skip it (no channel ploughed through the air).
     */
    airborne?: React.MutableRefObject<boolean>;
    /**
     * World depth of the snow lying on the floor (undefined: none). Read live. Wherever snow
     * lies under the pawn — this on the floor, or the step's own (`PawnStep` `snowDepth`) —
     * and the floor is not dropping, the figure is cut off below the snow line (pawnFigure.ts
     * → `pawnSnowClip`) — it wades, sunk in — and it casts no shadow. The line is that depth
     * over the surface it stands on (`z0 + lift`).
     */
    snowDepth?: number;
    /** Freezes the pawn for a lightning shock each time this changes (see the header's SHOCK). */
    shockId?: number;
    /** Plays a back stretch for each new cue id (see the header's STRETCH). */
    stretch?: PawnStretchCue | null;
    /**
     * Degrees the pawn faces off the camera, + toward screen-right (0 = facing the viewer).
     * Turns the night vest (pawnFigure.ts → `pawnVest`) and sets the back stretch's
     * direction — it curls away from it (see the header's STRETCH). Read each frame.
     */
    facing?: number;
    /** Plays an idle animation for each new cue id; null withdraws a lasting one (see the header's IDLE ANIMATIONS). */
    idle?: PawnIdleCue | null;
    /**
     * Picks each tap's reaction (see the header's TAP REACTION). Told whether the feet are
     * in the air (a tap then always jumps). Read live. Without it: always jump, with the "!".
     */
    onTap?: (tap: { airborne: boolean }) => PawnTapReaction;
}): {
    refs: PawnMotionRefs;
    emote: PawnEmote | null;
    poke: () => void;
    activeIdle: PawnActiveIdle | null;
} {
    const { proj, at, startled, roam, startledBy, onDepthRankChange } = opts;
    // Only the mount-time cue matters (an entrance is how the pawn ARRIVES), so it is
    // pinned in a ref and a later prop change never replays it.
    const entranceCue = useRef(opts.entrance);
    const refs: PawnMotionRefs = {
        travel: useRef<SVGGElement>(null),
        presence: useRef<SVGGElement>(null),
        body: useRef<SVGPathElement>(null),
        head: useRef<SVGCircleElement>(null),
        vest: useRef<SVGPathElement>(null),
        vestStripes: useRef<SVGPathElement>(null),
        vestOpenings: useRef<SVGPathElement>(null),
        hit: useRef<SVGCircleElement>(null),
        floorShadow: useRef<SVGGElement>(null),
        summitShadow: useRef<SVGGElement>(null),
        emoteAnchor: useRef<SVGGElement>(null),
        shadow: useRef<SVGGElement>(null),
        decalShade: useRef<SVGGElement>(null),
        decalClip: useRef<SVGPathElement>(null),
        decalAnchor: useRef<SVGGElement>(null),
        sunk: useRef<SVGGElement>(null),
        sunkClip: useRef<SVGPathElement>(null),
    };
    const [emote, setEmote] = useState<PawnEmote | null>(null);
    // What the loop is playing, mirrored to React for IsoPawn's marks. Set only on a change
    // (start, start of the ease-out, end), never per frame.
    const [activeIdle, setActiveIdle] = useState<PawnActiveIdle | null>(null);

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
        onSummit: false,
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
        // A back stretch cued but not started yet: its start time (see the header's STRETCH).
        pendingStretch: null as number | null,
        // An idle cued but not started yet (see the header's IDLE ANIMATIONS), and the id
        // of the last one started, so a cue that is still set never replays.
        pendingIdle: null as PawnIdleCue | null,
        startedIdleId: undefined as string | number | undefined,
        // What `activeIdle` was last set to, as "id:ending" (or ""), so the loop only sets
        // React state on a change.
        shownIdle: "",
        // The last frame's pose, which `applyFrame` draws (the loop, and a re-render with a
        // new camera, both draw from it). `hop` is world units off the surface, `lean`
        // degrees; `arch` the spine's bend in degrees (the back stretch's curve, pawnFigure's
        // `arch`); `emoteLean` the lean the "!" bubble follows (the startle's look-up only —
        // it does not waddle). Hidden from the start when an entrance is to come.
        pose: {
            hop: 0,
            lean: 0,
            arch: 0,
            bendHeading: undefined as number | undefined,
            sx: 1,
            sy: 1,
            emoteLean: 0,
            // The anchor over the head follows the BENT head (its arch and squash) — an idle's
            // marks (z's, notes, needles) ride a drooping head; the "!" never does.
            marksFollowHead: false,
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
    const onSummitRef = useRef(opts.onSummitChange);
    onSummitRef.current = opts.onSummitChange;
    const summitSpotRef = useRef(opts.summitSpot);
    summitSpotRef.current = opts.summitSpot;
    const floorSpotRef = useRef(opts.floorSpot);
    floorSpotRef.current = opts.floorSpot;
    const airborneRef = useRef(opts.airborne);
    airborneRef.current = opts.airborne;
    // Latest steps (their heights animate while the plate is pressed), read by the loop.
    const stepsRef = useRef(opts.steps ?? []);
    stepsRef.current = opts.steps ?? [];
    // Latest floor drop (animates every frame of a swap), read by the loop.
    const floorDropRef = useRef(opts.floorDrop ?? 0);
    floorDropRef.current = opts.floorDrop ?? 0;
    // Latest snow top (it appears and goes with the floor's snow), read by `applyFrame`.
    const snowDepthRef = useRef(opts.snowDepth);
    snowDepthRef.current = opts.snowDepth;
    // Latest facing, read by the loop's back stretch (`applyFrame` reads `opts.facing` itself).
    const facingRef = useRef(opts.facing ?? 0);
    facingRef.current = opts.facing ?? 0;
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
        arch: number;
        bendHeading: number | undefined;
        sx: number;
        sy: number;
        emoteLean: number;
        marksFollowHead: boolean;
        shadowScale: number | undefined;
        shadowOpacity: number | undefined;
        hidden: boolean;
        snowDepth: number;
        floorDrop: number;
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
        const { hop, lean, arch, bendHeading, sx, sy, emoteLean, marksFollowHead, shadowOverride, hidden } = s.pose;
        // CSS px on SVG elements are user units, so these are scene units.
        const p = projRef.current;
        const z0 = surfaceZRef.current;
        // IDLE FRAMES: a pawn standing in a pause draws the same pose every frame, and any
        // write to the scene svg (even of an unchanged value) costs a repaint of the WHOLE
        // svg — the tower, its gradients, the clouds — since svg children get no
        // compositor layers of their own. So the loop skips the write when nothing it
        // draws from has changed. A render always draws (`force`): it may have mounted a
        // node (the "!" bubble's anchor) that has never been placed.
        // The snow lying where it stands (see SNOW below): the step's own, else the floor's —
        // a summit never takes the floor's.
        const stepHere = stepsRef.current[s.stepIdx];
        const snowDepth = floorDropRef.current > 0 ? 0 : (stepHere?.snowDepth ?? (stepHere?.summit ? 0 : (snowDepthRef.current ?? 0)));
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
            d.arch === arch &&
            d.bendHeading === bendHeading &&
            d.sx === sx &&
            d.sy === sy &&
            d.emoteLean === emoteLean &&
            d.marksFollowHead === marksFollowHead &&
            d.shadowScale === shadowOverride?.scale &&
            d.shadowOpacity === shadowOverride?.opacity &&
            d.hidden === hidden &&
            d.snowDepth === snowDepth &&
            d.floorDrop === floorDropRef.current
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
            arch,
            bendHeading,
            sx,
            sy,
            emoteLean,
            marksFollowHead,
            shadowScale: shadowOverride?.scale,
            shadowOpacity: shadowOverride?.opacity,
            hidden,
            snowDepth,
            floorDrop: floorDropRef.current,
        };
        const onSummit = !!stepsRef.current[s.stepIdx]?.summit;
        // SNOW (`snowDepth`): the snow line is the depth lying under the pawn over the surface
        // it stands on (`z0 + lift`) — none on a floor dropping away (the snow has slid off
        // the opening trap door by then).
        const snowZ = snowDepth > 0 ? z0 + s.lift + snowDepth : undefined;
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
        const fig = pawnFigure(p, feet, { lean, sx, sy, arch, bendHeading });
        refs.body.current?.setAttribute("d", fig.bodyPath);
        // Sunk in the snow: the figure is cut off below the snow line in front of it.
        if (refs.sunk.current && refs.sunkClip.current) {
            if (snowZ !== undefined) {
                refs.sunkClip.current.setAttribute("d", pawnSnowClip(p, s.pos, snowZ, PAWN_BODY_RADIUS * Math.max(1, sx)));
                refs.sunk.current.setAttribute("clip-path", `url(#${refs.sunkClip.current.parentElement?.id ?? ""})`);
            } else {
                refs.sunk.current.removeAttribute("clip-path");
            }
        }
        // The night vest (IsoPawn `vest`), on the same pose as the body; only when it is mounted.
        if (refs.vest.current || refs.vestStripes.current) {
            const vest = pawnVest(p, feet, { lean, sx, sy, arch, bendHeading }, opts.facing ?? 0);
            refs.vest.current?.setAttribute("d", vest.vestPath);
            refs.vestStripes.current?.setAttribute("d", vest.stripesPath);
            refs.vestOpenings.current?.setAttribute("d", vest.openingsPath);
        }
        if (refs.head.current) {
            refs.head.current.setAttribute("cx", String(fig.head.cx));
            refs.head.current.setAttribute("cy", String(fig.head.cy));
            refs.head.current.setAttribute("r", String(fig.head.r));
        }
        if (refs.hit.current) {
            const feetAt = p.project(feet.x, feet.y, feet.z);
            refs.hit.current.setAttribute("cx", String((feetAt.x + fig.head.cx) / 2));
            refs.hit.current.setAttribute("cy", String((feetAt.y + fig.head.cy) / 2));
            refs.hit.current.setAttribute("r", String(PAWN_HIT_RADIUS * fig.headScale));
        }
        if (refs.emoteAnchor.current) {
            // Billboard: upright on screen, its tail tip just over the head's top, not
            // squashed or waddling with the body (an unsquashed figure at the look-up lean).
            const still =
                marksFollowHead || (emoteLean === lean && arch === 0 && sx === 1 && sy === 1)
                    ? fig
                    : pawnFigure(p, feet, { lean: emoteLean, sx: 1, sy: 1 });
            const k = still.headScale;
            const tipY = still.head.cy - (HEAD_RADIUS + EMOTE_GAP) * k;
            const f = k / EMOTE_DRAW_SCALE;
            refs.emoteAnchor.current.style.transform = `translate(${still.head.cx}px, ${tipY}px) scale(${f})`;
        }
        // Wading in snow it casts no shadow (owner's call, 2026-11-09): nor do the shaded decals show.
        if (refs.floorShadow.current) refs.floorShadow.current.style.visibility = onSummit || snowZ !== undefined ? "hidden" : "";
        if (refs.decalShade.current) refs.decalShade.current.style.visibility = snowZ !== undefined ? "hidden" : "";
        if (refs.summitShadow.current) refs.summitShadow.current.style.visibility = onSummit ? "" : "hidden";
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
    // counts. `null` (the tower's count still loading) leaves the edge detector unseeded,
    // and the first KNOWN value seeds it instead of firing: a tower that loads in already
    // past the threshold has not grown in front of the pawn, it just appeared.
    const wasStartled = useRef<boolean | null>(startled);
    useEffect(() => {
        if (startled === null) return;
        if (wasStartled.current === null) {
            wasStartled.current = startled;
            return;
        }
        const rose = startled && !wasStartled.current;
        wasStartled.current = startled;
        if (!rose || reduced) return;
        const s = state.current;
        // In the air arriving, or up on the summit: no startle.
        if (s.mode.kind === "entrance" || s.mode.kind === "flight") return;
        if (stepsRef.current[s.stepIdx]?.summit) return;
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

    // SHOCK: a change of `shockId` (not its mount value) freezes the pawn where it stands
    // for the flicker and the beat after it. An entrance or a throw keeps its own timeline
    // (the strike only aims at a pawn on the floor, so neither is expected).
    const lastShockId = useRef(opts.shockId);
    useEffect(() => {
        if (opts.shockId === lastShockId.current) return;
        lastShockId.current = opts.shockId;
        const s = state.current;
        if (s.mode.kind === "entrance" || s.mode.kind === "flight" || s.mode.kind === "edgeHop") return;
        s.stepPhase = 0;
        s.mode = { kind: "pause", until: performance.now() + SHOCK_MS + SHOCK_RECOVER_MS };
    }, [opts.shockId]);

    // A new stretch cue: queue it; the loop starts it once the pawn stands still (STRETCH).
    const stretchId = opts.stretch?.id;
    const stretchAt = opts.stretch?.at;
    useEffect(() => {
        if (stretchId === undefined || stretchAt === undefined || reduced) return;
        state.current.pendingStretch = stretchAt;
    }, [stretchId, stretchAt, reduced]);

    // An idle cue (see the header's IDLE ANIMATIONS). A new id queues it; withdrawing the
    // cue (null) or replacing it eases a held LASTING idle out — a replacement then starts
    // once the pawn is standing again.
    const idleId = opts.idle?.id;
    const idleKind = opts.idle?.kind;
    const idleAt = opts.idle?.at;
    useEffect(() => {
        if (reduced) return;
        const s = state.current;
        const m = s.mode;
        if (m.kind === "idle" && m.endT0 === null && m.id !== idleId) s.mode = { ...m, endT0: performance.now() };
        if (idleId === undefined || idleKind === undefined || idleAt === undefined) {
            s.pendingIdle = null;
            return;
        }
        if (idleId === s.startedIdleId) return;
        s.pendingIdle = { id: idleId, kind: idleKind, at: idleAt };
    }, [idleId, idleKind, idleAt, reduced]);

    const onTapRef = useRef(opts.onTap);
    onTapRef.current = opts.onTap;

    /** Throws the pawn to `to`, on a surface `toZ` high: the time is what the feet will take to land there. */
    const startFlight = (to: Pt2, toZ: number, now: number) => {
        const s = state.current;
        const v = POKE_JUMP_SPEED;
        const seconds = (v + Math.sqrt(v * v + 2 * GRAVITY * Math.max(0, s.feetZ - toZ))) / GRAVITY;
        s.feetV = v;
        s.stepPhase = 0;
        s.mode = { kind: "flight", t0: now, from: { ...s.pos }, to, ms: seconds * 1000 };
    };

    // A tap on the pawn: see the header's POKE. Works on the motion state directly, as the
    // startle effect does; the loop picks the jump up on its next frame.
    const poke = () => {
        if (reduced || floorDropRef.current > 0) return;
        const s = state.current;
        const m = s.mode;
        if (m.kind === "entrance" || m.kind === "edgeHop" || m.kind === "flight") return;
        const steps = stepsRef.current;
        const summit = steps.findIndex((st) => st.summit);
        const top = steps[summit];
        if (top?.summit && !top.summit.closed && !top.summit.held && s.stepIdx !== summit && m.kind !== "startle" && s.feetZ > top.height + FEET_EPS) {
            const landing = { area: insetRect(top.rect, SUMMIT_LANDING_INSET), obstacles: [] };
            startFlight(pickTarget(s.pos, landing, 0, Infinity) ?? rectCentre(top.rect), top.height, performance.now());
            setEmote((e) => ({ id: (e?.id ?? 0) + 1 }));
            return;
        }
        // TAP REACTION (header): the page picks, unless the feet are already up — a tap in
        // the air always chains the jump.
        const airborne = s.feetZ > s.lift + FEET_EPS;
        const onTap = onTapRef.current;
        const reaction: PawnTapReaction = onTap ? onTap({ airborne }) : "jump";
        // Any idle stops at once on a tap (a lasting one's page also withdraws its cue).
        if (m.kind === "idle") {
            s.startedIdleId = m.id;
            s.mode = { kind: "pause", until: performance.now() + PAUSE_MIN_MS };
        }
        if (reaction === "flinch" && !airborne) {
            s.stepPhase = 0;
            s.mode = { kind: "flinch", t0: performance.now() };
            return;
        }
        // A startle or a stretch keeps its own timeline: the jump rides on top of it.
        const mode = s.mode;
        if (mode.kind !== "startle" && mode.kind !== "stretch") {
            s.stepPhase = 0;
            s.mode = { kind: "pause", until: performance.now() + (onTap ? PAUSE_MIN_MS : EMOTE_MS) };
        }
        // Re-thrown from wherever the feet are.
        s.feetV = POKE_JUMP_SPEED;
        // The "!" is the default reply; a page with `onTap` replies its own way.
        if (!onTap) setEmote((e) => ({ id: (e?.id ?? 0) + 1 }));
    };

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
        // The floor to wander: the summit's top once it stands there.
        const walkRoam = (): PawnRoam | undefined => {
            const under = stepsRef.current[s.stepIdx];
            return under?.summit ? { area: under.rect, obstacles: [] } : roam;
        };

        const tick = (now: number) => {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            let hop = 0; // world units off the floor
            let lean = 0; // degrees
            let arch = 0; // degrees of spine bend (the back stretch only)
            // The direction lean/arch tip toward (pawnFigure's `bendHeading`): the picture
            // plane (undefined = its default) except in the back stretch.
            let bendHeading: number | undefined;
            let sx = 1;
            let sy = 1;
            // Set only by an entrance; otherwise the shadow follows `hop` (see Apply).
            let shadowOverride: { scale: number; opacity: number } | null = null;
            let hidden = false;
            // The summit closed under it: fly down (see the header's SUMMIT).
            const under = stepsRef.current[s.stepIdx];
            if (under?.summit?.closed && s.mode.kind !== "flight" && floorDropRef.current <= 0) startFlight(at, 0, now);
            if (under?.summit?.held && s.mode.kind === "walk") s.mode = { kind: "land" };
            // A cued stretch starts from a standstill; a cue left waiting too long is dropped.
            if (s.pendingStretch !== null && now >= s.pendingStretch) {
                if (now > s.pendingStretch + STRETCH_STALE_MS) s.pendingStretch = null;
                else if (s.mode.kind === "pause" && !feetAirborne()) {
                    s.mode = { kind: "stretch", t0: now };
                    s.pendingStretch = null;
                }
            }
            // A cued idle likewise (a stretch due first goes first); a one-shot left waiting
            // too long is dropped, a lasting one waits for its standstill.
            const cuedIdle = s.pendingIdle;
            if (cuedIdle !== null && now >= cuedIdle.at && s.pendingStretch === null) {
                if (!LASTING_IDLES.has(cuedIdle.kind) && now > cuedIdle.at + IDLE_STALE_MS) s.pendingIdle = null;
                else if (s.mode.kind === "pause" && !feetAirborne()) {
                    s.mode = { kind: "idle", t0: now, idle: cuedIdle.kind, id: cuedIdle.id, endT0: null };
                    s.startedIdleId = cuedIdle.id;
                    s.pendingIdle = null;
                }
            }
            // Mirror what is playing to React (IsoPawn's marks), on a change only.
            const playing = s.mode.kind === "idle" ? s.mode : null;
            const shown = playing ? `${playing.id}:${playing.endT0 !== null}` : "";
            if (shown !== s.shownIdle) {
                s.shownIdle = shown;
                setActiveIdle(playing ? { id: playing.id, kind: playing.idle, ending: playing.endT0 !== null } : null);
            }
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
                if (now >= m.until && !feetAirborne() && !stepsRef.current[s.stepIdx]?.summit?.held) {
                    const here = walkRoam();
                    const target = here ? pickWalkTarget(s.pos, here) : null;
                    // Start on a step boundary, so the whole-step distance ends on one too.
                    s.stepPhase = 0;
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
                // A wander walk is whole steps (stepWalkTarget), so it arrives as the
                // phase crosses a multiple of π and this ends the same frame; the tread in
                // place only shows when a walk is cut short (the summit `held`).
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
            } else if (m.kind === "flight") {
                // The height is the feet physics' (below); this only carries it across.
                const u = clamp01((now - m.t0) / m.ms);
                s.pos = { x: m.from.x + (m.to.x - m.from.x) * u, y: m.from.y + (m.to.y - m.from.y) * u };
                if (u >= 1) s.mode = { kind: "pause", until: now + PAUSE_MIN_MS };
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
                    // Walk on from feet-down, the rest of the way cut to whole steps — or, if
                    // not even one step is left (the hop carried it to or near the walk's
                    // end), pause here.
                    s.pos = { ...m.to };
                    s.stepPhase = 0;
                    const resume = stepWalkTarget(s.pos, m.resume);
                    s.mode = resume
                        ? { kind: "walk", target: resume }
                        : { kind: "pause", until: now + PAUSE_MIN_MS + Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS) };
                }
            } else if (m.kind === "stretch") {
                const t = now - m.t0;
                // Bend in the plane of the pawn's facing: the negative angles below curl
                // the back away from where it faces (the header's STRETCH).
                bendHeading = facingRef.current;
                // `reach` draws it up tall and thin, `squash` presses it down and wide.
                let reach = 0;
                let squash = 0;
                if (t < STRETCH_CROUCH_END) {
                    // Gather: a little crouch before the reach.
                    squash = STRETCH_CROUCH * Math.sin((Math.PI / 2) * (t / STRETCH_CROUCH_END));
                } else if (t < STRETCH_REACH_END) {
                    // Up and back: the crouch springs into the reach, the lean easing in with it.
                    const u = (t - STRETCH_CROUCH_END) / (STRETCH_REACH_END - STRETCH_CROUCH_END);
                    squash = STRETCH_CROUCH * (1 - easeOut(clamp01(u * 2)));
                    reach = STRETCH_REACH * easeOut(u);
                    lean = STRETCH_LEAN_DEG * easeInOut(u);
                    arch = STRETCH_ARCH_DEG * easeInOut(u);
                } else if (t < STRETCH_HOLD_END) {
                    // The held reach: a touch further, with a slight quiver.
                    const u = (t - STRETCH_REACH_END) / (STRETCH_HOLD_END - STRETCH_REACH_END);
                    reach = STRETCH_REACH + STRETCH_REACH_GROW * Math.sin((Math.PI / 2) * u);
                    lean = STRETCH_LEAN_DEG;
                    arch = STRETCH_ARCH_DEG + STRETCH_QUIVER_DEG * Math.sin(2 * Math.PI * STRETCH_QUIVER_CYCLES * u);
                } else if (t < STRETCH_MS) {
                    // Let go: straighten up, settling in a soft squash over the back half.
                    const u = (t - STRETCH_HOLD_END) / (STRETCH_MS - STRETCH_HOLD_END);
                    const out = 1 - easeInOut(u);
                    reach = (STRETCH_REACH + STRETCH_REACH_GROW) * out;
                    lean = STRETCH_LEAN_DEG * out;
                    arch = STRETCH_ARCH_DEG * out;
                    squash = STRETCH_SETTLE_SQUASH * Math.sin(Math.PI * clamp01((u - 0.45) / 0.55));
                } else {
                    s.mode = { kind: "pause", until: now + PAUSE_MIN_MS };
                }
                sx = (1 - 0.5 * reach) * (1 + 0.75 * squash);
                sy = (1 + reach) * (1 - squash);
            } else if (m.kind === "idle" || m.kind === "flinch") {
                // IDLE ANIMATIONS / TAP REACTION (header): the pose curve is pawnIdles.ts's.
                const p: IdlePose =
                    m.kind === "flinch"
                        ? flinchPose(now - m.t0)
                        : idlePose(m.idle, now - m.t0, m.endT0 === null ? null : now - m.endT0);
                bendHeading = facingRef.current + p.bendHeadingOffset;
                lean = p.lean;
                arch = p.arch;
                // Reach and squash map to the body's scale as the stretch's do.
                sx = (1 - 0.5 * p.reach) * (1 + 0.75 * p.squash);
                sy = (1 + p.reach) * (1 - p.squash);
                if (p.done) s.mode = { kind: "pause", until: now + PAUSE_MIN_MS };
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
                    const summit = !!steps[s.stepIdx]?.summit;
                    if (dh < -FEET_EPS && !summit) s.launchArmed = true;
                    else if (dh > FEET_EPS && s.launchArmed && touching) {
                        s.launchArmed = false;
                        s.feetV = PLATE_LAUNCH_SPEED;
                    } else if (summit && dh >= SUMMIT_JOLT_RISE && touching) {
                        s.feetV = POKE_JUMP_SPEED;
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
            s.pose = { hop, lean, arch, bendHeading, sx, sy, emoteLean: s.mode.kind === "startle" ? lean : 0,
                // Not for knitting: its yarn ball sits on the floor (PawnIdleProps).
                marksFollowHead: s.mode.kind === "idle" && s.mode.idle !== "knit",
                shadowOverride,
                hidden,
            };
            applyRef.current(false);

            const onSummit = !!stepsRef.current[s.stepIdx]?.summit;
            if (summitSpotRef.current) summitSpotRef.current.current = onSummit ? s.pos : null;
            if (floorSpotRef.current) {
                const onFloor = !onSummit && !hidden && s.mode.kind !== "entrance" && floorDropRef.current <= 0;
                floorSpotRef.current.current = onFloor ? s.pos : null;
            }
            if (airborneRef.current) {
                airborneRef.current.current = s.mode.kind === "flight" || s.mode.kind === "edgeHop" || s.feetZ - s.lift > AIRBORNE_MIN;
            }
            if (onSummit !== s.onSummit) {
                s.onSummit = onSummit;
                onSummitRef.current?.(onSummit);
            }

            if (roam) {
                // Ranked among the obstacles in the CAMERA's back-to-front order (it changes
                // as the study camera dives), the same order DeckTowerPlatform draws them in.
                const p = projRef.current;
                // On the summit it stands on top of an obstacle, so in front of them all.
                const rank = stepsRef.current[s.stepIdx]?.summit
                    ? roam.obstacles.length
                    : depthRankAmong(
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

    return { refs, emote, poke, activeIdle };
}
