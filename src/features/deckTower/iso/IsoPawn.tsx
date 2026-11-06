import React from "react";
import IsoShadow from "./IsoShadow";
import { flatPath, type WorldRect } from "./geometry";
import { shadowFootprint, type IsoSurface } from "./light";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import { EMOTE_GAP, HEAD_RADIUS } from "./pawnFigure";
import { prefersReducedMotion } from "./skyTraffic";
import {
    EMOTE_DRAW_SCALE,
    EMOTE_MS,
    PAWN_FOOT_RADIUS,
    SHOCK_MS,
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
 * With `tappable`, a tap pops the bubble and it jumps on the spot (usePawnMotion's POKE).
 *
 * LIGHTNING (docs/DECK_TOWER.md § "Weather" → "Lightning strikes"): each change of
 * `shockId` is a strike landing on it. It freezes (usePawnMotion's SHOCK) while its body
 * flickers ink ↔ white, jitters, and crackles with small white sparks for SHOCK_MS; a puff
 * of smoke goes up as it ends. With `crispy` it then smoulders: thin white wisps of smoke
 * curl up off its head now and then — the caller keeps `crispy`
 * on for as long as the look should last (the Deck Tower: until the learner leaves the page).
 * The sparks and smoke ride the "!" bubble's head-following anchor, in its units.
 */
interface IsoPawnProps {
    /** World x/y where the pawn starts (and is drawn before its motion transform). */
    at: { x: number; y: number };
    /** The surface it stands on. */
    surface: IsoSurface;
    /**
     * Plays the startle reaction each time this turns true. null = not known yet (the
     * tower's count is loading): the first known value after it is a baseline, not a rise.
     */
    startled?: boolean | null;
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
    /** Called when it gets onto, or leaves, a `summit` step (usePawnMotion's SUMMIT). */
    onSummitChange?: (onSummit: boolean) => void;
    /** Kept at where it stands on the summit (null when it is not there). */
    summitSpot?: React.MutableRefObject<{ x: number; y: number } | null>;
    /** Tapping it pops the "!" bubble and it jumps (usePawnMotion's POKE). */
    tappable?: boolean;
    /** Kept at its live ground point while it stands on the floor (usePawnMotion `floorSpot`). */
    floorSpot?: React.MutableRefObject<{ x: number; y: number } | null>;
    /** Plays the lightning shock each time this changes (not on mount). */
    shockId?: number;
    /** Smoulders — the crispy look, smoke wisps off its head (hidden while a shock is playing). */
    crispy?: boolean;
}

/**
 * The "!" bubble's radius in camera-facing world units (it was 0.62 `unit`s across in the
 * fixed view, which draws a facing unit at unit·√2 — see iso/pawnFigure.ts). Drawn at
 * EMOTE_DRAW_SCALE round its tail tip; usePawnMotion places and scales it over the head.
 */
const EMOTE_RADIUS = 0.62 / Math.SQRT2;

/**
 * The "!" bubble's one-shot: snap in (shock is sudden), hold, fade, over EMOTE_MS.
 * Only the emote is a CSS animation — it is a fire-and-forget one-shot, remounted (by key)
 * per startle. The shadow's pivot (its own centre, for usePawnMotion's scale) lives here
 * too. The emote is drawn at EMOTE_DRAW_SCALE, so its fade's drift up is in those units:
 * a third of the bubble's radius (the 4 px it was at the Deck Tower's unit).
 */
/**
 * Lightning's marks, drawn in the "!" bubble anchor's units: EMOTE_DRAW_SCALE per
 * camera-facing world unit, origin at the bubble's tail tip just above the head. So the
 * head's top is EMOTE_GAP below the origin and its centre a head radius further down.
 */
const ANCHOR_HEAD_TOP = EMOTE_GAP * EMOTE_DRAW_SCALE;
const ANCHOR_HEAD_R = HEAD_RADIUS * EMOTE_DRAW_SCALE;
const ANCHOR_HEAD_CY = ANCHOR_HEAD_TOP + ANCHOR_HEAD_R;

/**
 * The shock's CSS: the figure flickers between ink and white (`--iso-pawn-ink` /
 * `--iso-pawn-flash`, set on the figure, override the paths' fill attribute) and jitters;
 * each spark blinks on its own beat. The crispy smoke wisps rise and fade on a loop; the
 * end-of-shock puff swells and fades once. Reduced motion: no flicker, sparks, wisps or puff
 * (so a crispy pawn looks like any other there).
 */
const SHOCK_CSS = `
@keyframes iso-pawn-shock-flicker { 0%, 100% { fill: var(--iso-pawn-flash); } 50% { fill: var(--iso-pawn-ink); } }
@keyframes iso-pawn-shock-jitter {
    0% { transform: translate(0, 0); } 25% { transform: translate(-2.4px, 1px); }
    50% { transform: translate(2px, -1.4px); } 75% { transform: translate(-1.2px, -0.8px); } 100% { transform: translate(0, 0); }
}
@keyframes iso-pawn-spark-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
@keyframes iso-pawn-smoke-wisp {
    0% { transform: translateY(0) scale(0.6); opacity: 0; }
    20% { opacity: 0.75; }
    100% { transform: translateY(-70px) scale(1.15); opacity: 0; }
}
@keyframes iso-pawn-shock-puff {
    0% { transform: scale(0.3); opacity: 0.9; }
    100% { transform: translateY(-40px) scale(1.4); opacity: 0; }
}
.iso-pawn__figure--shocked { animation: iso-pawn-shock-jitter 90ms linear infinite; }
.iso-pawn__figure--shocked .iso-pawn__body, .iso-pawn__figure--shocked .iso-pawn__head {
    animation: iso-pawn-shock-flicker 120ms steps(1, end) infinite;
}
.iso-pawn__spark { animation: iso-pawn-spark-blink 110ms steps(1, end) infinite; }
.iso-pawn__smoke-wisp, .iso-pawn__shock-puff { transform-box: fill-box; transform-origin: 50% 100%; }
.iso-pawn__smoke-wisp { animation: iso-pawn-smoke-wisp 3.4s ease-out infinite; opacity: 0; }
.iso-pawn__shock-puff { animation: iso-pawn-shock-puff 700ms ease-out both; }
@media (prefers-reduced-motion: reduce) {
    .iso-pawn__figure--shocked, .iso-pawn__figure--shocked .iso-pawn__body, .iso-pawn__figure--shocked .iso-pawn__head { animation: none; }
    .iso-pawn__spark, .iso-pawn__smoke-wisp { display: none; }
}
`;

/** Sparks round the shocked pawn: [x, y, delay ms] of each zig-zag, in anchor units. */
const SPARKS: readonly [number, number, number][] = [
    [-50, ANCHOR_HEAD_CY - 12, 0],
    [46, ANCHOR_HEAD_CY + 18, 55],
    [-42, ANCHOR_HEAD_CY + 80, 30],
    [44, ANCHOR_HEAD_CY + 105, 80],
];

/** The small white zig-zags crackling round a shocked pawn. */
const PawnShockSparks: React.FC<{ color: string }> = ({ color }) => (
    <g className="iso-pawn__shock-sparks" fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
        {SPARKS.map(([x, y, delay], i) => (
            <path
                key={i}
                className="iso-pawn__spark"
                // Mirrored on the left so every spark points away from the body.
                d={`M${x} ${y}l${x < 0 ? -9 : 9} -11l${x < 0 ? -2 : 2} 10l${x < 0 ? -9 : 9} -11`}
                style={{ animationDelay: `${delay}ms` }}
            />
        ))}
    </g>
);

/**
 * The crispy look: two thin white S-wisps of smoke curling up off the top of the head in
 * turn (SHOCK_CSS → `iso-pawn-smoke-wisp`). The frizzled-hair crown it first had was dropped
 * (owner's call, 2026-11-04); the smoke alone says "singed". The wisps keep the height they
 * had over the crown (starting 18 units above the head, not on it) — the owner preferred it.
 */
const WISP_PATH = `M0 ${ANCHOR_HEAD_TOP - 18}c-9 -8 9 -16 0 -24c-9 -8 9 -16 0 -24`;
const CRISPY_WISPS = [
    { x: -8, delay: 0 },
    { x: 10, delay: 1700 },
] as const;

const PawnCrispySmoke: React.FC<{ smoke: string }> = ({ smoke }) => (
    <g className="iso-pawn__crispy">
        {CRISPY_WISPS.map((w, i) => (
            <g key={i} transform={`translate(${w.x} 0)`}>
                <path className="iso-pawn__smoke-wisp" d={WISP_PATH} fill="none" stroke={smoke} strokeWidth={4} strokeLinecap="round" style={{ animationDelay: `${w.delay}ms` }} />
            </g>
        ))}
    </g>
);

/** The puff of smoke as the shock ends: three white discs swelling up off the head, once. */
const PawnShockPuff: React.FC<{ color: string; onDone: () => void }> = ({ color, onDone }) => (
    <g className="iso-pawn__shock-puff" fill={color} onAnimationEnd={onDone}>
        <circle cx={-14} cy={ANCHOR_HEAD_TOP - 6} r={14} />
        <circle cx={12} cy={ANCHOR_HEAD_TOP - 12} r={17} />
        <circle cx={0} cy={ANCHOR_HEAD_TOP - 26} r={12} />
    </g>
);

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
${SHOCK_CSS}
`;

const IsoPawn: React.FC<IsoPawnProps> = ({
    at,
    surface,
    startled = false,
    roam,
    startledBy,
    floorDrop,
    onDepthRankChange,
    decals,
    entrance,
    steps,
    onSummitChange,
    summitSpot,
    tappable = false,
    floorSpot,
    shockId,
    crispy = false,
}) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    // `url(#…)` needs a plain id; React's useId wraps its ids in colons.
    const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const decalClipId = `iso-pawn-decal-clip-${uid}`;
    const { refs, emote, poke } = usePawnMotion({
        proj,
        at,
        startled,
        roam,
        startledBy,
        onDepthRankChange,
        entrance,
        floorDrop,
        steps,
        onSummitChange,
        summitSpot,
        surfaceZ: surface.z,
        floorSpot,
        shockId,
    });
    // The shock plays for SHOCK_MS from a change of `shockId` (not its mount value: a pawn
    // remounting in a world it was struck in is already crispy, not being struck again).
    const [shocking, setShocking] = React.useState(false);
    const mountShockId = React.useRef(shockId);
    React.useEffect(() => {
        if (shockId === mountShockId.current) return;
        mountShockId.current = shockId;
        setShocking(true);
        const t = window.setTimeout(() => setShocking(false), SHOCK_MS);
        return () => window.clearTimeout(t);
    }, [shockId]);
    // The smoke puff as the shock ends: a one-shot, UNMOUNTED when done for the same reason
    // as the bubble (a re-inserted node replays its CSS animation).
    const [puffShockId, setPuffShockId] = React.useState<number | undefined>(undefined);
    const [finishedPuffId, setFinishedPuffId] = React.useState<number | undefined>(undefined);
    const wasShocking = React.useRef(false);
    React.useEffect(() => {
        if (wasShocking.current && !shocking) setPuffShockId(shockId);
        wasShocking.current = shocking;
    }, [shocking, shockId]);
    const showPuff = !shocking && puffShockId !== undefined && puffShockId !== finishedPuffId && !prefersReducedMotion();
    // The id of the last emote whose one-shot has finished. A finished bubble must be
    // UNMOUNTED, not just left at its keyframes' final opacity 0: the page reorders the
    // pawn among its siblings as it walks behind / in front of the tower, React does that
    // by re-inserting the pawn's DOM node, and re-inserting a node restarts its CSS
    // animations — so a lingering bubble would pop "!" again on every reorder.
    const [finishedEmoteId, setFinishedEmoteId] = React.useState(0);
    const showEmote = emote !== null && emote.id !== finishedEmoteId;
    const r = PAWN_FOOT_RADIUS;
    const footprint = { x: at.x - r, y: at.y - r, w: 2 * r, d: 2 * r, r };
    const hasSummit = !!steps?.some((st) => st.summit);

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
                        <g className="iso-pawn__floor-shadow" ref={refs.floorShadow}>
                            <IsoShadow footprint={footprint} casterZ={surface.z} receiver={surface} className="iso-pawn__shadow" />
                        </g>
                        {/* The same shadow as a glaze, so the summit's print shows through it;
                            usePawnMotion swaps the two. */}
                        {hasSummit && (
                            <g className="iso-pawn__summit-shadow" ref={refs.summitShadow} style={{ visibility: "hidden" }}>
                                <IsoShadow
                                    footprint={footprint}
                                    casterZ={surface.z}
                                    receiver={surface}
                                    glaze={palette.ink}
                                    className="iso-pawn__shadow"
                                />
                            </g>
                        )}
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
                    last: it is the nearest part to any camera looking down. The tap target
                    goes over both; usePawnMotion keeps it on the figure. */}
                <g
                    className={shocking ? "iso-pawn__figure iso-pawn__figure--shocked" : "iso-pawn__figure"}
                    onClick={tappable ? poke : undefined}
                    style={
                        {
                            cursor: tappable ? "pointer" : undefined,
                            // The flicker's two tones (SHOCK_CSS), washed with the scene.
                            "--iso-pawn-ink": palette.ink,
                            "--iso-pawn-flash": palette.white,
                        } as React.CSSProperties
                    }
                >
                    <path className="iso-pawn__body" ref={refs.body} fill={palette.ink} />
                    <circle className="iso-pawn__head" ref={refs.head} fill={palette.ink} />
                    {tappable && <circle className="iso-pawn__hit" ref={refs.hit} fill="transparent" />}
                </g>
                {/* A billboard over the head, placed and scaled by usePawnMotion. Keyed per
                    startle so the CSS pop replays. */}
                <g className="iso-pawn__emote-anchor" ref={refs.emoteAnchor}>
                    {/* Lightning: sparks while shocked, then the crispy smoke. */}
                    {shocking && <PawnShockSparks color={palette.white} />}
                    {crispy && !shocking && <PawnCrispySmoke smoke={palette.white} />}
                    {showPuff && <PawnShockPuff color={palette.white} onDone={() => setFinishedPuffId(puffShockId)} />}
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
