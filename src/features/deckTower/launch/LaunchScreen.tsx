import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { IsoPlatform, IsoScene, makeProjector, type WorldRect } from "../iso";
import { HEAD_CENTRE, HEAD_RADIUS, REST_POSE, pawnFigure } from "../iso/pawnFigure";
import { useIsoPalette, useIsoProjector } from "../iso/sceneContext";
import { prefersReducedMotion } from "../iso/skyTraffic";
import type { LaunchLook } from "./launchLook";
import { CIRCLE_MOTION, circleCoverRadius, type ScreenPoint } from "../../../utils/pageTransition";

/**
 * LaunchScreen — the full-screen cover td opens behind once per app launch
 * (docs/LAUNCH_SCREEN.md). A solid sky colour with a mini platform a fifth of the way up; a pawn
 * drops onto it from the top of the screen and the platform recoils from the landing. Once
 * td is ready a circle opens out of the pawn and reveals td underneath.
 *
 * ⚠️ PLACEHOLDER animation (owner, 2026-11-11): the pawn drop stands in for a real
 * logo / animation. Replace this component's scene; keep the timing contract (props below).
 *
 * ── Why it exists ────────────────────────────────────────────────────────────
 * td's look depends on things that arrive late: the weather (GET /api/weather sets main's
 * sky hue) and the deck counts (the tower's height). Without a cover the sky visibly jumped
 * colour a moment after opening. The cover hides that first settling. The sky's later
 * changes are hidden by SpaceBackdrop's slow fade instead (SKY_FADE_MS). Until the circle starts
 * to open, td's sky follows every change at once (`onOpen` → SpaceBackdrop `snapSky`), so the
 * circle reveals the true time of day and the real weather if it has arrived (else clear).
 *
 * ── Colour ───────────────────────────────────────────────────────────────────
 * The main world by day, always (owner, 2026-11-11), in clear weather: `launchLook`
 * (launchLook.ts). The sky is the ramp's `COLORS.bluMk` (main's sky); the platform and pawn take
 * day's wash, like td's.
 *
 * ── A baked animation, played by the browser ─────────────────────────────────
 * The scene is drawn ONCE, as stills: the platform in one HTML layer, the resting pawn in
 * another. Every motion is a precomputed keyframe list (Web Animations) on those layers'
 * `transform`: the gravity fall, the stretch and landing squash, the platform's recoil, and
 * the pawn riding it. Nothing is computed per frame in JS, and transform animations on HTML
 * layers run on the browser's COMPOSITOR thread, so the drop stays smooth while td renders
 * underneath on the main thread (the weather landing, the tower rebuilding at its real height
 * — which stalled the earlier per-frame IsoPawn drop mid-fall; owner, 2026-11-11). Transforms
 * inside an SVG are not composited, hence one svg per moving piece, moved from outside.
 *
 * All the animations are pinned (`startTime`) to one `performance.now()` time, the document
 * timeline's clock, so the recoil starts on the frame of touchdown whatever the main thread
 * is doing. The fall is exact gravity: a t² curve is the cubic bezier (1/3, 0, 2/3, 1/3)
 * (`GRAVITY_EASE`).
 *
 * ── Timing contract ──────────────────────────────────────────────────────────
 *   - It always plays ONE full drop and recoil (`played`), so it never flickers in and out. The
 *     drop is scheduled once the cover has painted, not at render (see `drop`).
 *   - Then it waits for `ready`, at most MAX_WAIT_MS from mount; past that it opens anyway (td
 *     falls back to its usual loading states).
 *   - `onOpen` fires as the exit starts (td stops snapping its sky).
 *   - The circle grows over CIRCLE_MOTION (the app's circle transition, pageTransition.ts),
 *     then `onDone` fires and the page unmounts it.
 *   - Under `prefers-reduced-motion`: no drop and no recoil (the pawn just stands), and the
 *     exit is a plain fade.
 *
 * ── Layering ─────────────────────────────────────────────────────────────────
 * Rendered INSIDE td's screen, `position: absolute` over MobileTabScreen's ScreenRoot (the page's
 * stage is deliberately unpositioned, so that is its containing block), above td's header
 * layer (LAUNCH_Z). NOT portaled to <body> with `position: fixed`: on desktop the app is a
 * phone-shaped card (MobileDemoFrame), and a fixed cover would paint the whole browser window.
 * The footer is not covered but hidden while it is up (DeckTowerPage → `useHideFooter`), and
 * slides back in once it has gone. td is fully laid out underneath;
 * the page holds td's own events (the opening grow, cooldown drops, the banking run) until
 * `onDone` (DeckTowerPage → `launchUp`).
 *
 * The circle is a hole cut in this cover with a radial-gradient MASK, not a clip on td: td is
 * live underneath and must not be touched. The radius is written straight to the DOM each
 * frame (no React state per frame); it runs after td is ready, when the main thread is quiet.
 *
 * Layer: feature page view (src/features/deckTower/launch). Rendered by DeckTowerPage.
 * Depends on: the iso framework (IsoScene, IsoPlatform, pawnFigure), launchLook.ts,
 * pageTransition.ts (CIRCLE_MOTION, circleCoverRadius).
 * Docs: docs/LAUNCH_SCREEN.md.
 */

// ── Scene ────────────────────────────────────────────────────────────────────

/** Screen px per world unit. */
const UNIT = 30;
const PROJ = makeProjector(UNIT);
/** The mini platform: a small rounded slab, about 180 px across. Its floor is z = 0. */
const PLATFORM: WorldRect = { x: 0, y: 0, w: 3, d: 3, r: 0.45 };
const PLATFORM_THICKNESS = 0.9;
/** The pawn stands in the middle of the floor. */
const PAWN_FEET = { x: PLATFORM.w / 2, y: PLATFORM.d / 2, z: 0 };
/** px of the recoil's deepest dip, kept clear under the slab so it is never cropped. */
const RECOIL_DIP_PX = 10;
/** Screen px from the pawn's feet up to the top of its head, standing at rest (pawnFigure.ts). */
const PAWN_HEAD_TOP_PX = HEAD_CENTRE * PROJ.heightUnit + HEAD_RADIUS * PROJ.facingScaleAt(0, 0, 0);
/** Where the pawn's feet (the floor's centre) sit, as a share of the screen's height from the top. */
const FEET_AT_SCREEN_Y = 0.8;

/** The scene's px box, from the slab's projected corners and the pawn's head (as in HintPawn). */
const SCENE_BOX = (() => {
    const pad = 4;
    const left = PROJ.project(PLATFORM.x, PLATFORM.y + PLATFORM.d, 0).x;
    const right = PROJ.project(PLATFORM.x + PLATFORM.w, PLATFORM.y, 0).x;
    const feet = PROJ.project(PAWN_FEET.x, PAWN_FEET.y, 0);
    const top = Math.min(PROJ.project(PLATFORM.x, PLATFORM.y, 0).y, feet.y - PAWN_HEAD_TOP_PX);
    const bottom = PROJ.project(PLATFORM.x + PLATFORM.w, PLATFORM.y + PLATFORM.d, -PLATFORM_THICKNESS).y + RECOIL_DIP_PX;
    const width = right - left + 2 * pad;
    const height = bottom - top + 2 * pad;
    return {
        viewBox: `${left - pad} ${top - pad} ${width} ${height}`,
        width,
        height,
        /** The pawn's feet, in scene px. */
        pawnX: feet.x - (left - pad),
        pawnY: feet.y - (top - pad),
    };
})();

// ── Motion (all baked: keyframe lists the browser plays) ─────────────────────

/** A beat of plain colour before the pawn starts to fall. */
const FALL_DELAY_MS = 250;
/**
 * The fall's pull, in world units/s²: the same as the td sky fall's (pawnEntrances.ts →
 * SKY_FALL_GRAVITY), a slightly floaty drop. Turned into px/s² with the projector's height unit.
 */
const GRAVITY_UNITS = 60;
const GRAVITY_PX = GRAVITY_UNITS * PROJ.heightUnit;
/** Clear space between the top of the cover and the pawn's head when the fall starts. */
const FALL_START_MARGIN_PX = 16;
/**
 * Exact gravity as a CSS easing: distance ∝ t², and y = x² is the cubic bezier with control
 * points (1/3, 0) and (2/3, 1/3). Starts from rest and accelerates all the way down.
 */
const GRAVITY_EASE = "cubic-bezier(0.3333, 0, 0.6667, 0.3333)";
/** The pawn's shape while falling (stretched along the fall), as in pawnEntrances.ts → `fallFromHeight`. */
const STRETCH = "scale(0.92, 1.1)";
/** The landing squash: hits its flattest SQUASH_IN_MS after touchdown, back to rest by SQUASH_MS. */
const SQUASH = "scale(1.22, 0.72)";
const SQUASH_IN_MS = 60;
const SQUASH_MS = 320;
/** The platform's recoil (and the pawn riding it): pushed down by the landing, springing back past rest, settling. */
const RECOIL_MS = 560;
/**
 * The recoil's keyframes. The dip is quick (bottoming out ~90 ms after touchdown, inside the
 * pawn's squash) so the two read as one impact, then a slower spring back past rest and a
 * small settle.
 */
const RECOIL_KEYFRAMES: Keyframe[] = [
    { offset: 0, transform: "translateY(0)", easing: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
    { offset: 0.16, transform: `translateY(${RECOIL_DIP_PX}px)`, easing: "ease-in-out" },
    { offset: 0.45, transform: "translateY(-3px)", easing: "ease-in-out" },
    { offset: 0.72, transform: "translateY(1px)", easing: "ease-in-out" },
    { offset: 1, transform: "translateY(0)" },
];
/** A short hold after the recoil, so the landing reads before the circle opens. */
const SETTLE_MS = 180;
/** The longest the cover waits for `ready`, from mount. */
const MAX_WAIT_MS = 4000;
/** Under reduced motion: the shortest the cover stays, and its fade out. */
const REDUCED_MIN_MS = 300;
const REDUCED_FADE_MS = 240;
/** Above td's scroller (1), header layer (2) and everything else td stacks in its screen. */
const LAUNCH_Z = 10;

/** One scheduled drop: when it starts (a performance.now() time), how far and how long it falls. */
interface LaunchDrop {
    startAt: number;
    fallPx: number;
    landMs: number;
}

/**
 * The drop for a cover `coverHeight` px tall (measured once it is laid out, so the phone frame
 * on desktop is measured, not the window): from the head just above the cover's top edge down
 * to the feet's resting place, FEET_AT_SCREEN_Y down. Time from rest under gravity: √(2d/g).
 */
function planDrop(coverHeight: number, startAt: number): LaunchDrop {
    const fallPx = coverHeight * FEET_AT_SCREEN_Y + PAWN_HEAD_TOP_PX + FALL_START_MARGIN_PX;
    return { startAt, fallPx, landMs: Math.sqrt((2 * fallPx) / GRAVITY_PX) * 1000 };
}

/** CIRCLE_MOTION's grow curve, cubic-bezier(0.5, 0, 0.3, 1), approximated as an ease-in-out cubic. */
const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

/** Plays `keyframes` on `el`, its start pinned to `startAt` on the document timeline (performance.now()'s clock). */
function playAt(el: HTMLElement, keyframes: Keyframe[], duration: number, startAt: number): Animation {
    const anim = el.animate(keyframes, { duration, fill: "both" });
    anim.startTime = startAt;
    return anim;
}

/** The pawn at rest, feet on the floor's centre: the IsoPawn's figure (body + head in ink), drawn once. */
function LaunchPawnFigure() {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const fig = pawnFigure(proj, PAWN_FEET, REST_POSE);
    return (
        <g className="launch-screen__pawn-figure">
            <path className="launch-screen__pawn-body" d={fig.bodyPath} fill={palette.ink} />
            <circle className="launch-screen__pawn-head" cx={fig.head.cx} cy={fig.head.cy} r={fig.head.r} fill={palette.ink} />
        </g>
    );
}

interface LaunchScreenProps {
    /** The cover's look (`launchLook`), fixed at mount. */
    look: LaunchLook;
    /** td has what it needs to look right (the weather has settled, the shown deck's count is in). */
    ready: boolean;
    /** The exit is starting (the circle, or the reduced-motion fade): td becomes visible. */
    onOpen: () => void;
    /** The circle has fully opened: unmount the cover and release td's held events. */
    onDone: () => void;
}

export default function LaunchScreen({ look, ready, onOpen, onDone }: LaunchScreenProps) {
    const { world, wash } = look;
    const reduced = useState(prefersReducedMotion)[0];
    const rootRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<HTMLDivElement>(null);
    // The moving layers (see the header): the platform; the pawn's ride on the recoil, its
    // fall inside that, and its stretch / squash inside that (scaled about its feet).
    const platformLayerRef = useRef<HTMLDivElement>(null);
    const pawnRideRef = useRef<HTMLDivElement>(null);
    const pawnFallRef = useRef<HTMLDivElement>(null);
    const pawnShapeRef = useRef<HTMLDivElement>(null);

    // The drop is scheduled only once the cover has PAINTED (two frames after mount), not at
    // render: on a cold start td's first render can hold the main thread for hundreds of ms
    // after this component renders, and a clock started at render would already be deep into
    // the fall by the first painted frame.
    const [drop, setDrop] = useState<LaunchDrop | null>(null);
    useEffect(() => {
        if (reduced) return;
        let second = 0;
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => {
                const coverHeight = rootRef.current?.getBoundingClientRect().height || window.innerHeight;
                setDrop(planDrop(coverHeight, performance.now() + FALL_DELAY_MS));
            });
        });
        return () => {
            cancelAnimationFrame(first);
            cancelAnimationFrame(second);
        };
    }, [reduced]);

    // Hand the whole drop to the browser: four keyframe animations on one clock.
    useLayoutEffect(() => {
        const platform = platformLayerRef.current;
        const ride = pawnRideRef.current;
        const fall = pawnFallRef.current;
        const shape = pawnShapeRef.current;
        if (!drop || !platform || !ride || !fall || !shape) return;
        const { startAt, fallPx, landMs } = drop;
        const landAt = startAt + landMs;
        const shapeMs = landMs + SQUASH_MS;
        const anims = [
            // The fall: from above the top edge to the floor, under gravity. `fill: both`
            // holds it above the edge (off the cover) until it starts.
            playAt(fall, [{ transform: `translateY(${-fallPx}px)`, easing: GRAVITY_EASE }, { transform: "translateY(0)" }], landMs, startAt),
            // Stretched all the way down, squashed flat on touchdown, then back to rest.
            playAt(
                shape,
                [
                    { offset: 0, transform: STRETCH },
                    { offset: landMs / shapeMs, transform: STRETCH, easing: "ease-out" },
                    { offset: (landMs + SQUASH_IN_MS) / shapeMs, transform: SQUASH, easing: "cubic-bezier(0.3, 0, 0.3, 1)" },
                    { offset: 1, transform: "scale(1, 1)" },
                ],
                shapeMs,
                startAt,
            ),
            // The recoil from touchdown: the platform dips, and the pawn standing on it with it.
            playAt(platform, RECOIL_KEYFRAMES, RECOIL_MS, landAt),
            playAt(ride, RECOIL_KEYFRAMES, RECOIL_MS, landAt),
        ];
        // Shown only now that the fall holds it above the edge (it rendered at rest).
        fall.style.visibility = "visible";
        return () => anims.forEach((a) => a.cancel());
    }, [drop]);

    const [played, setPlayed] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    const [opening, setOpening] = useState(false);
    // One full drop + recoil + settle, on the drop's own clock (or a short beat under reduced motion).
    useEffect(() => {
        if (!reduced && !drop) return;
        const playedAt = drop ? drop.startAt + drop.landMs + RECOIL_MS + SETTLE_MS : performance.now() + REDUCED_MIN_MS;
        const t = window.setTimeout(() => setPlayed(true), Math.max(0, playedAt - performance.now()));
        return () => window.clearTimeout(t);
    }, [reduced, drop]);
    // The longest wait for `ready`, from mount. It never cuts the drop short: opening also needs `played`.
    useEffect(() => {
        const t = window.setTimeout(() => setTimedOut(true), MAX_WAIT_MS);
        return () => window.clearTimeout(t);
    }, []);
    useEffect(() => {
        if (played && (ready || timedOut)) setOpening(true);
    }, [played, ready, timedOut]);
    useEffect(() => {
        if (opening) onOpen();
    }, [opening, onOpen]);

    const onDoneRef = useRef(onDone);
    onDoneRef.current = onDone;

    // The exit: a circle opening out of the pawn's middle (or a fade, under reduced motion).
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!opening || !root) return;
        if (reduced) {
            root.style.transition = `opacity ${REDUCED_FADE_MS}ms ease-out`;
            root.style.opacity = "0";
            const t = window.setTimeout(() => onDoneRef.current(), REDUCED_FADE_MS);
            return () => window.clearTimeout(t);
        }
        // The mask is laid out in the COVER's own box, not the window's: on desktop the cover
        // sits inside the phone frame (MobileDemoFrame), offset from the window's corner, so
        // window coordinates would put the centre off by the frame's offset. Everything below
        // is measured relative to the cover's rect.
        const rootRect = root.getBoundingClientRect();
        const svgRect = sceneRef.current?.getBoundingClientRect();
        const scale = svgRect ? svgRect.width / SCENE_BOX.width : 1;
        // The pawn's middle (half its head height above the feet), which stands on the platform.
        const at: ScreenPoint = svgRect
            ? {
                  x: svgRect.left - rootRect.left + SCENE_BOX.pawnX * scale,
                  y: svgRect.top - rootRect.top + (SCENE_BOX.pawnY - (HEAD_CENTRE / 2) * PROJ.heightUnit) * scale,
              }
            : { x: rootRect.width / 2, y: rootRect.height * FEET_AT_SCREEN_Y };
        const cover = circleCoverRadius(at, { left: 0, top: 0, width: rootRect.width, height: rootRect.height });
        const t0 = performance.now();
        let raf = 0;
        const frame = (now: number) => {
            const u = Math.min(1, (now - t0) / CIRCLE_MOTION.ms);
            const r = cover * easeInOutCubic(u);
            // The hole: transparent inside r, opaque past it (a half-px edge, antialiased).
            const mask = `radial-gradient(circle at ${at.x.toFixed(1)}px ${at.y.toFixed(1)}px, transparent ${r.toFixed(1)}px, #000 ${(r + 0.5).toFixed(1)}px)`;
            root.style.maskImage = mask;
            root.style.setProperty("-webkit-mask-image", mask);
            if (u < 1) raf = requestAnimationFrame(frame);
            else onDoneRef.current();
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [opening, reduced]);

    /** A full-box layer, promoted for its transform animation. */
    const layerSx = { position: "absolute", inset: 0, willChange: "transform" } as const;
    /** Both stills share the scene's viewBox and box, so they line up exactly. */
    const sceneStyle = { width: SCENE_BOX.width, height: SCENE_BOX.height, display: "block", overflow: "visible" } as const;

    return (
        <Box
            ref={rootRef}
            className="launch-screen"
            // Swallows every touch while up: td underneath is held anyway, and a tap must not
            // reach it through the opening hole before `onDone`. Clips the pawn waiting above it.
            sx={{
                position: "absolute",
                inset: 0,
                zIndex: LAUNCH_Z,
                backgroundColor: world.sky,
                touchAction: "none",
                overflow: "hidden",
            }}
        >
            {/* The scene's box: centred across, with the pawn's feet FEET_AT_SCREEN_Y down the
                screen (owner, 2026-11-11: "1/5 from the bottom"). Measured for the circle's centre. */}
            <Box
                ref={sceneRef}
                className="launch-screen__scene-box"
                sx={{
                    position: "absolute",
                    left: "50%",
                    top: `${FEET_AT_SCREEN_Y * 100}%`,
                    width: SCENE_BOX.width,
                    height: SCENE_BOX.height,
                    transform: `translate(${-SCENE_BOX.pawnX}px, ${-SCENE_BOX.pawnY}px)`,
                }}
            >
                <Box ref={platformLayerRef} className="launch-screen__platform-layer" sx={layerSx}>
                    <IsoScene proj={PROJ} viewBox={SCENE_BOX.viewBox} wash={wash} className="launch-screen__platform-scene" style={sceneStyle}>
                        <IsoPlatform rect={PLATFORM} thickness={PLATFORM_THICKNESS} tone={world.platform} />
                    </IsoScene>
                </Box>
                <Box ref={pawnRideRef} className="launch-screen__pawn-ride" sx={layerSx}>
                    <Box
                        ref={pawnFallRef}
                        className="launch-screen__pawn-fall"
                        // Hidden until the fall's animation holds it above the edge (it renders at
                        // rest); standing in view from the start under reduced motion.
                        sx={{ ...layerSx, visibility: reduced ? "visible" : "hidden" }}
                    >
                        <Box
                            ref={pawnShapeRef}
                            className="launch-screen__pawn-shape"
                            sx={{ ...layerSx, transformOrigin: `${SCENE_BOX.pawnX}px ${SCENE_BOX.pawnY}px` }}
                        >
                            <IsoScene proj={PROJ} viewBox={SCENE_BOX.viewBox} wash={wash} className="launch-screen__pawn-scene" style={sceneStyle}>
                                <LaunchPawnFigure />
                            </IsoScene>
                        </Box>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
