import React from "react";
import IsoShadow from "./IsoShadow";
import { flatPath, type WorldRect } from "./geometry";
import { shadowFootprint, type IsoSurface } from "./light";
import { ISO } from "./palette";
import { useIsoProjector } from "./sceneContext";
import { LOOK_UP_LEAN_DEG, PAWN_FOOT_RADIUS, usePawnMotion, type PawnEntranceCue, type PawnRoam, type PawnStep } from "./usePawnMotion";
import { prefersReducedMotion } from "./skyTraffic";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * IsoPawn — one of Good Job's featureless ink "pawn" workers: a pill body and a ball
 * head (docs/ISO_ART_FRAMEWORK.md § "IsoPawn").
 *
 * The body is drawn in SCREEN space at the projected point it stands on — a pill reads
 * the same from every angle, so it needs no iso geometry. Its shadow is NOT: it is a
 * round footprint cast through IsoShadow like every other shadow, so it falls the same
 * way and in the same tone as the rest of the scene's.
 *
 * It is DRAWN once, at `at`; all movement is `usePawnMotion` transforming four nested
 * groups (travel ⊃ shadow, hop ⊃ pose + emote). Because the projection is affine, sliding
 * the drawn pawn by a projected floor delta is the same as redrawing it there — shadow
 * included, since the shadow lies flat on the same floor.
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

/** Sizes in world units. */
const BODY_WIDTH = 0.78;
const BODY_HEIGHT = 1.5;
const HEAD_RADIUS = 0.44;
const EMOTE_RADIUS = 0.62;
const EMOTE_GAP = 0.3;
/** The "!" bubble's one-shot: snap in (shock is sudden), hold, fade. */
const EMOTE_MS = 2000;

/**
 * Only the emote is a CSS animation — it is a fire-and-forget one-shot, remounted (by key)
 * per startle. The pivots for the JS-driven groups live here too: the pose turns about the
 * feet (bottom of the body's box), the shadow scales about its own centre.
 */
const PAWN_CSS = `
@keyframes iso-pawn-emote {
    0% { transform: scale(0.4); opacity: 0; animation-timing-function: linear; }
    3.5% { transform: scale(1.25); opacity: 1; }
    9% { transform: scale(1); }
    82% { transform: scale(1); opacity: 1; }
    100% { transform: translateY(-4px) scale(0.9); opacity: 0; }
}
.iso-pawn__pose { transform-box: fill-box; transform-origin: 50% 100%; }
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
    // `url(#…)` needs a plain id; React's useId wraps its ids in colons.
    const decalClipId = `iso-pawn-decal-clip-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const { refs, emote } = usePawnMotion({ proj, at, startled, roam, startledBy, onDepthRankChange, entrance, floorDrop, steps });
    // The id of the last emote whose one-shot has finished. A finished bubble must be
    // UNMOUNTED, not just left at its keyframes' final opacity 0: the page reorders the
    // pawn among its siblings as it walks behind / in front of the tower, React does that
    // by re-inserting the pawn's DOM node, and re-inserting a node restarts its CSS
    // animations — so a lingering bubble would pop "!" again on every reorder.
    const [finishedEmoteId, setFinishedEmoteId] = React.useState(0);
    const showEmote = emote !== null && emote.id !== finishedEmoteId;
    const u = proj.unit;
    const feet = proj.project(at.x, at.y, surface.z);
    const r = PAWN_FOOT_RADIUS;
    const footprint = { x: at.x - r, y: at.y - r, w: 2 * r, d: 2 * r, r };
    const bodyW = BODY_WIDTH * u;
    const bodyH = BODY_HEIGHT * u;
    const headR = HEAD_RADIUS * u;
    const headCy = feet.y - bodyH - headR * 0.55;

    // The emote sits over where the head is while the pawn looks up: leaning by θ about
    // the feet shifts the head sideways by h·sin θ (h = head top above the feet).
    const emoteR = EMOTE_RADIUS * u;
    const headTopAboveFeet = feet.y - (headCy - headR);
    const leanShift = emote ? emote.leanSign * headTopAboveFeet * Math.sin((LOOK_UP_LEAN_DEG * Math.PI) / 180) : 0;
    const emoteCx = feet.x + leanShift;
    const emoteTipY = headCy - headR - EMOTE_GAP * u;
    const emoteCy = emoteTipY - emoteR * 1.25;
    const tailL = { x: emoteCx - emoteR * 0.32, y: emoteCy + emoteR * 0.9 };
    const tailR = { x: emoteCx + emoteR * 0.32, y: emoteCy + emoteR * 0.9 };

    return (
        <g className="iso-pawn">
            <style>{PAWN_CSS}</style>
            {/* Hidden from the first paint when it has an entrance to make: the motion loop
                only starts after mount, and would otherwise let the pawn flash standing on
                the floor for a frame before its entrance hides it. (Not under reduced
                motion: no loop runs then to un-hide it.) The loop owns
                `visibility` from then on (React never rewrites an unchanged style). */}
            <g className="iso-pawn__travel" ref={refs.travel} style={entrance && !prefersReducedMotion() ? { visibility: "hidden" } : undefined}>
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
                <g className="iso-pawn__hop" ref={refs.hop}>
                    <g className="iso-pawn__pose" ref={refs.pose}>
                        <rect className="iso-pawn__body" x={feet.x - bodyW / 2} y={feet.y - bodyH} width={bodyW} height={bodyH} rx={bodyW / 2} fill={ISO.ink} />
                        <circle className="iso-pawn__head" cx={feet.x} cy={headCy} r={headR} fill={ISO.ink} />
                    </g>
                    {/* Inside the hop (rides the arc with the head) but outside the pose (does
                        not lean or waddle). Keyed per startle so the CSS pop replays. */}
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
                                fill={ISO.white}
                            />
                            <text
                                className="iso-pawn__emote-mark"
                                x={emoteCx}
                                y={emoteCy}
                                fontSize={emoteR * 1.35}
                                fontFamily={FONTS.sans}
                                fontWeight={WEIGHT.bold}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fill={ISO.ink}
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
