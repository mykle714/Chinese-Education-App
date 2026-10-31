import React from "react";
import IsoShadow from "./IsoShadow";
import { flatPath, type WorldRect } from "./geometry";
import { shadowFootprint, type IsoSurface } from "./light";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import {
    EMOTE_DRAW_SCALE,
    PAWN_FOOT_RADIUS,
    usePawnMotion,
    type PawnEntranceCue,
    type PawnRoam,
    type PawnStep,
} from "./usePawnMotion";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * IsoPawn — one of Good Job's featureless ink "pawn" workers: a pill body and a ball
 * head (docs/ISO_ART_FRAMEWORK.md § "IsoPawn").
 *
 * The body is a 3D figure — a capsule under a ball (iso/pawnFigure.ts) — projected
 * through the scene's camera, so it reads as a pawn from the fixed iso view AND from the
 * Deck Tower's straight-down study camera. usePawnMotion redraws it every frame (the
 * body's path, the head's circle), so neither carries geometry in this JSX. Its shadow is
 * a round footprint cast through IsoShadow like every other shadow, so it falls the same
 * way and in the same tone as the rest of the scene's; it is DRAWN once, at `at`, and
 * slid by the `travel` group (a projected floor delta — the shadow lies flat on the floor).
 *
 * Its shadow falls on DECALS too (flat things printed on its floor, e.g. IsoFloorLabel):
 * an opaque floor-tone shadow would paint over them, so `decals` — passed already drawn
 * in their shaded tones — are drawn again over the shadow, clipped to it. The copy sits
 * inside `travel` (so the clip, the shadow's own outline, moves with it) and is
 * counter-translated by usePawnMotion so the decals themselves stay put on the floor.
 *
 * Behaviour (usePawnMotion): with `roam`, it wanders the floor around the obstacles with
 * a bouncing walk, stepping up onto any `steps` it crosses. When `startled` turns true it leans back to look up at `startledBy`,
 * leaps away from it, a white "!" bubble pops over its head, it stares up for a few
 * seconds, straightens up, and goes back to wandering. With `floorDrop` above 0 the floor is
 * falling away under it: it falls on its own (finishing a launch from the plate first) and
 * pops the bubble as it starts to (no lean, no leap). With `entrance` it first ARRIVES
 * (pawnEntrances.ts — e.g. dropping out of the sky), timed so it lands at a given moment.
 */
interface IsoPawnProps {
    /** World x/y where the pawn starts (and is drawn before its motion transform). */
    at: { x: number; y: number };
    /** The surface it stands on. */
    surface: IsoSurface;
    /** Plays the startle reaction each time this turns true. */
    startled?: boolean;
    /** Where it may wander. Without it the pawn stands still. */
    roam?: PawnRoam;
    /** What startles it: it leaps away from this footprint and looks up at it. */
    startledBy?: WorldRect;
    /**
     * World units the floor under it has dropped (0 = in place): it falls on its own and pops
     * its "!" bubble (usePawnMotion `floorDrop`). Do NOT also translate its wrapper by the
     * drop — the pawn is already following it.
     */
    floorDrop?: number;
    /**
     * Called when the pawn's draw position among `roam.obstacles` changes: its slot in their
     * back-to-front order (`depthRankAmong`). The caller renders it after that many of them.
     */
    onDepthRankChange?: (rank: number) => void;
    /**
     * Decals on `surface` that the pawn's shadow can cross, drawn in their SHADED tones
     * (e.g. `<IsoFloorLabel shaded … />`). Drawn clipped to the shadow, so where the
     * shadow falls on a decal it darkens the decal instead of covering it.
     */
    decals?: React.ReactNode;
    /**
     * Arrive this way on mount (read once). The pawn is hidden until `startAt`, plays the
     * entrance, and lands `animation.landMs` after `startAt`. Remount (new key) to replay.
     */
    entrance?: PawnEntranceCue;
    /**
     * Raised floor it steps up onto rather than walking around (e.g. a raised
     * IsoFloorLabel, at its current height). Heights are read live (usePawnMotion `steps`).
     */
    steps?: PawnStep[];
}

/**
 * The "!" bubble's radius in camera-facing world units (it was 0.62 `unit`s across in the
 * fixed view, which draws a facing unit at unit·√2 — see iso/pawnFigure.ts). Drawn at
 * EMOTE_DRAW_SCALE round its tail tip; usePawnMotion places and scales it over the head.
 */
const EMOTE_RADIUS = 0.62 / Math.SQRT2;
/** The "!" bubble's one-shot: snap in (shock is sudden), hold, fade. */
const EMOTE_MS = 2000;

/**
 * Only the emote is a CSS animation — it is a fire-and-forget one-shot, remounted (by key)
 * per startle. The shadow's pivot (its own centre, for usePawnMotion's scale) lives here
 * too. The emote is drawn at EMOTE_DRAW_SCALE, so its fade's drift up is in those units:
 * a third of the bubble's radius (the 4 px it was at the Deck Tower's unit).
 */
const EMOTE_DRIFT = (EMOTE_RADIUS * EMOTE_DRAW_SCALE) / 3;
const PAWN_CSS = `
@keyframes iso-pawn-emote {
    0% { transform: scale(0.4); opacity: 0; animation-timing-function: linear; }
    3.5% { transform: scale(1.25); opacity: 1; }
    9% { transform: scale(1); }
    82% { transform: scale(1); opacity: 1; }
    100% { transform: translateY(-${EMOTE_DRIFT}px) scale(0.9); opacity: 0; }
}
.iso-pawn__shadow-hop, .iso-pawn__decal-clip-shape { transform-box: fill-box; transform-origin: center; }
.iso-pawn__emote {
    transform-box: fill-box;
    transform-origin: 50% 100%;
    animation: iso-pawn-emote ${EMOTE_MS}ms ease-out both;
}
@media (prefers-reduced-motion: reduce) {
    .iso-pawn__emote { animation: none; opacity: 0; }
}
`;

const IsoPawn: React.FC<IsoPawnProps> = ({ at, surface, startled = false, roam, startledBy, floorDrop, onDepthRankChange, decals, entrance, steps }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    // `url(#…)` needs a plain id; React's useId wraps its ids in colons.
    const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const decalClipId = `iso-pawn-decal-clip-${uid}`;
    const { refs, emote } = usePawnMotion({
        proj,
        at,
        startled,
        roam,
        startledBy,
        onDepthRankChange,
        entrance,
        floorDrop,
        steps,
        surfaceZ: surface.z,
    });
    // The id of the last emote whose one-shot has finished. A finished bubble must be
    // UNMOUNTED, not just left at its keyframes' final opacity 0: the page reorders the
    // pawn among its siblings as it walks behind / in front of the tower, React does that
    // by re-inserting the pawn's DOM node, and re-inserting a node restarts its CSS
    // animations — so a lingering bubble would pop "!" again on every reorder.
    const [finishedEmoteId, setFinishedEmoteId] = React.useState(0);
    const showEmote = emote !== null && emote.id !== finishedEmoteId;
    const r = PAWN_FOOT_RADIUS;
    const footprint = { x: at.x - r, y: at.y - r, w: 2 * r, d: 2 * r, r };

    // The bubble, round its tail tip at the origin (usePawnMotion's `emoteAnchor` puts the
    // tip over the head).
    const emoteR = EMOTE_RADIUS * EMOTE_DRAW_SCALE;
    const emoteCx = 0;
    const emoteTipY = 0;
    const emoteCy = emoteTipY - emoteR * 1.25;
    const tailL = { x: emoteCx - emoteR * 0.32, y: emoteCy + emoteR * 0.9 };
    const tailR = { x: emoteCx + emoteR * 0.32, y: emoteCy + emoteR * 0.9 };

    return (
        <g className="iso-pawn">
            <style>{PAWN_CSS}</style>
            {/* Hidden from the first paint when it has an entrance to make (usePawnMotion
                writes `visibility` in a layout effect, before the first paint). */}
            <g className="iso-pawn__presence" ref={refs.presence}>
                <g className="iso-pawn__travel" ref={refs.travel}>
                    <g className="iso-pawn__shadow-hop" ref={refs.shadow}>
                        <IsoShadow footprint={footprint} casterZ={surface.z} receiver={surface} className="iso-pawn__shadow" />
                    </g>
                    {/* The shaded decals, clipped to the shadow's outline (same path IsoShadow
                        draws; usePawnMotion scales it in step with shadow-hop). The inner group
                        undoes `travel`, so the decals stay where the floor has them. */}
                    {decals && (
                        <g className="iso-pawn__decal-shade" clipPath={`url(#${decalClipId})`} ref={refs.decalShade}>
                            <clipPath id={decalClipId} className="iso-pawn__decal-clip">
                                <path
                                    className="iso-pawn__decal-clip-shape"
                                    ref={refs.decalClip}
                                    d={flatPath(proj, shadowFootprint(footprint, surface.z, surface), surface.z)}
                                />
                            </clipPath>
                            <g className="iso-pawn__decal-anchor" ref={refs.decalAnchor}>
                                {decals}
                            </g>
                        </g>
                    )}
                </g>
                {/* The 3D figure, in absolute screen space: usePawnMotion writes the body's `d`
                    and the head's cx/cy/r every frame (iso/pawnFigure.ts). The head is drawn
                    last: it is the nearest part to any camera looking down. */}
                <g className="iso-pawn__figure">
                    <path className="iso-pawn__body" ref={refs.body} fill={palette.ink} />
                    <circle className="iso-pawn__head" ref={refs.head} fill={palette.ink} />
                </g>
                {/* A billboard over the head, placed and scaled by usePawnMotion. Keyed per
                    startle so the CSS pop replays. */}
                <g className="iso-pawn__emote-anchor" ref={refs.emoteAnchor}>
                    {showEmote && (
                        <g className="iso-pawn__emote" key={emote.id} onAnimationEnd={() => setFinishedEmoteId(emote.id)}>
                            <path
                                className="iso-pawn__emote-bubble"
                                d={[
                                    // A round bubble with a short tail pointing down at the head.
                                    `M ${tailL.x} ${tailL.y}`,
                                    `L ${emoteCx} ${emoteTipY}`,
                                    `L ${tailR.x} ${tailR.y}`,
                                    `A ${emoteR} ${emoteR} 0 1 0 ${tailL.x} ${tailL.y}`,
                                    "Z",
                                ].join(" ")}
                                fill={palette.white}
                            />
                            <text
                                className="iso-pawn__emote-mark"
                                x={emoteCx}
                                y={emoteCy}
                                fontSize={emoteR * 1.35}
                                fontFamily={FONTS.cjk}
                                fontWeight={WEIGHT.bold}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fill={palette.ink}
                            >
                                !
                            </text>
                        </g>
                    )}
                </g>
            </g>
        </g>
    );
};

export default IsoPawn;
