import { useEffect, useRef, useState } from "react";
import { insetRect, insideRoundedRect, type Projector, type WorldRect } from "./geometry";
import { shadowSlide } from "./light";
import { prefersReducedMotion } from "./skyTraffic";
import type { PawnEntrance } from "./pawnEntrances";

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
 * It writes CSS transforms straight onto four SVG groups (plus the three that keep the
 * pawn's shaded decals in line with its shadow, see IsoPawn `decals`) through refs rather than
 * through React state: the pawn moves every frame, and the page re-rendering at 60 fps
 * for it would be wasted work. React state changes only for the two things the tree
 * needs to know: a fresh emote (to mount the "!" bubble) and the pawn's DEPTH RANK
 * among the obstacles (its slot in their back-to-front order, `depthRankAmong` — the page
 * reorders its children by it, so the pawn walks behind the tower rather than over it).
 *
 * STEPS: `steps` are raised regions of the floor the pawn walks ONTO, not around (the Deck
 * Tower's push-button plate). While its foot centre is over one, the whole pawn — body,
 * shadow and the shadow's clip on the shaded decals — rides that step's height (`lift`),
 * easing up or down over STEP_MS as it crosses an edge. Heights are read live every
 * frame, so a pawn standing on the plate sinks with it when the plate is pressed.
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

/** Ms the feet take to go up (or down) a step's edge — a quick hop, not a ramp. */
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

/** Startle. */
export const LOOK_UP_LEAN_DEG = 10;
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
 * things that do not overlap on the floor, an iso object is nearer the viewer than a box
 * when it is past the box's far edge on either floor axis (+x or +y, the axes that run
 * toward the viewer).
 *
 * Why not simply count the rects it is in front of: a fixed back-to-front list is not a
 * total order for every point. On the Deck Tower a pawn on the tower's back-left side is
 * BEHIND the tower (obstacle 0) yet IN FRONT of the lever (obstacle 1, at the back-right
 * corner) — the count says 1 and drew the pawn over the tower. Those two never overlap
 * on screen, so any slot that respects the rects the pawn is behind is correct; taking
 * the first one errs toward hiding the pawn rather than drawing it over a tower.
 */
export function depthRankAmong(p: Pt2, rects: WorldRect[]): number {
    const behind = rects.findIndex((r) => p.x < r.x + r.w && p.y < r.y + r.d);
    return behind < 0 ? rects.length : behind;
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
    | { kind: "entrance"; t0: number; anim: PawnEntrance };

export interface PawnMotionRefs {
    /** Slides the whole pawn (shadow included) across the floor. */
    travel: React.RefObject<SVGGElement | null>;
    /** Lifts body + emote off the floor (step bounce, leap arc). */
    hop: React.RefObject<SVGGElement | null>;
    /** Shrinks the shadow while airborne. */
    shadow: React.RefObject<SVGGElement | null>;
    /** Leans / squashes / waddles the body about its feet. */
    pose: React.RefObject<SVGGElement | null>;
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
    /** Which way the pawn leans while looking up (+1 = top tips screen-right); 0 = an alarm, no lean. */
    leanSign: 1 | -1 | 0;
}

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
     * Pops the "!" bubble each time this turns true, WITHOUT the startle's lean and leap —
     * for a shock the pawn can't react to with its feet (the floor dropping out from under
     * it: docs/DECK_TOWER_TRANSITIONS.md § "Pawns during a swap").
     */
    alarmed?: boolean;
    /** Raised floor the pawn steps up onto (see the header's STEPS). Read live: may be a new array each render. */
    steps?: PawnStep[];
}): { refs: PawnMotionRefs; emote: PawnEmote | null } {
    const { proj, at, startled, roam, startledBy, onDepthRankChange, alarmed = false } = opts;
    // Only the mount-time cue matters (an entrance is how the pawn ARRIVES), so it is
    // pinned in a ref and a later prop change never replays it.
    const entranceCue = useRef(opts.entrance);
    const refs: PawnMotionRefs = {
        travel: useRef<SVGGElement>(null),
        hop: useRef<SVGGElement>(null),
        shadow: useRef<SVGGElement>(null),
        pose: useRef<SVGGElement>(null),
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
        stepIdx: -1,
        lift: 0,
        liftFrom: 0,
        liftT0: -Infinity,
    });
    // The latest callback, so a new inline function from the page doesn't restart the loop.
    const onRank = useRef(onDepthRankChange);
    onRank.current = onDepthRankChange;
    // Latest steps (their heights animate while the plate is pressed), read by the loop.
    const stepsRef = useRef(opts.steps ?? []);
    stepsRef.current = opts.steps ?? [];
    const reduced = prefersReducedMotion();

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
        if (s.mode.kind === "entrance") return;
        // Lean AWAY from the source on screen: a pawn to the tower's right tips its top
        // further right as it cranes up at it.
        const pawnSx = proj.project(s.pos.x, s.pos.y, 0).x;
        const srcSx = startledBy ? proj.project(startledBy.x + startledBy.w / 2, startledBy.y + startledBy.d / 2, 0).x : pawnSx - 1;
        const leanSign: 1 | -1 = pawnSx >= srcSx ? 1 : -1;
        s.mode = { kind: "startle", t0: performance.now(), from: { ...s.pos }, to: leapLanding(s.pos, startledBy, roam), leanSign };
        setEmote((e) => ({ id: (e?.id ?? 0) + 1, leanSign }));
    }, [startled, reduced, proj, startledBy, roam]);

    // Rising edge of `alarmed` → just the bubble. The motion loop is left alone.
    const wasAlarmed = useRef(false);
    useEffect(() => {
        const rose = alarmed && !wasAlarmed.current;
        wasAlarmed.current = alarmed;
        if (!rose || reduced) return;
        setEmote((e) => ({ id: (e?.id ?? 0) + 1, leanSign: 0 }));
    }, [alarmed, reduced]);

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
                if (now >= m.until) {
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

            // Step up / down. On the same step as last frame the feet track its live height
            // exactly (so they sink with a pressed plate); crossing an edge starts a short
            // ease from wherever the lift was to the new surface's height.
            const steps = stepsRef.current;
            const idx = stepUnder(s.pos, steps);
            const targetLift = idx >= 0 ? steps[idx].height : 0;
            if (idx !== s.stepIdx) {
                s.stepIdx = idx;
                s.liftFrom = s.lift;
                s.liftT0 = now;
            }
            const stepU = clamp01((now - s.liftT0) / STEP_MS);
            s.lift = s.liftFrom + (targetLift - s.liftFrom) * easeOut(stepU);

            // Apply. CSS px on SVG elements are user units, so these are scene units.
            const home = proj.project(at.x, at.y, 0);
            // `lift` raises the whole pawn (shadow and decal clip included): it stands, and
            // casts its shadow, on the step's top face.
            const here = proj.project(s.pos.x, s.pos.y, s.lift);
            const u0 = proj.unit;
            if (refs.travel.current) {
                refs.travel.current.style.transform = `translate(${here.x - home.x}px, ${here.y - home.y}px)`;
                refs.travel.current.style.visibility = hidden ? "hidden" : "";
            }
            if (refs.decalAnchor.current) refs.decalAnchor.current.style.transform = `translate(${home.x - here.x}px, ${home.y - here.y}px)`;
            if (refs.hop.current) refs.hop.current.style.transform = `translateY(${-hop * u0}px)`;
            if (refs.pose.current) refs.pose.current.style.transform = `rotate(${lean}deg) scale(${sx}, ${sy})`;
            if (refs.shadow.current) {
                const air = Math.min(1, hop / LEAP_HOP_HEIGHT);
                const shadowScale = shadowOverride ? shadowOverride.scale : 1 - 0.25 * air;
                const shadowOpacity = shadowOverride ? shadowOverride.opacity : 1 - 0.4 * air;
                refs.shadow.current.style.transform = `scale(${shadowScale})`;
                refs.shadow.current.style.opacity = String(shadowOpacity);
                // The shaded decals are the same shadow seen on another receiver: same
                // shrink, same fade.
                if (refs.decalClip.current) refs.decalClip.current.style.transform = refs.shadow.current.style.transform;
                if (refs.decalShade.current) refs.decalShade.current.style.opacity = refs.shadow.current.style.opacity;
            }

            if (roam) {
                const rank = depthRankAmong(s.pos, roam.obstacles);
                if (rank !== s.rank) {
                    s.rank = rank;
                    onRank.current?.(rank);
                }
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
        // refs are stable useRef objects; `at`/`roam` are expected to be module constants.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reduced, proj, at, roam]);

    return { refs, emote };
}
