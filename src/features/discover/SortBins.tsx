import React, { memo, useMemo, useState } from "react";
import {
    IsoPlatform,
    IsoScene,
    IsoSolid,
    bandMaterial,
    faceTransform,
    flatPath,
    makeProjector,
    platformTone,
    prism,
    shadeHex,
    type Material,
    type WorldRect,
} from "../deckTower/iso";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import type { SortLook } from "./sortTimeOfDay";
import { KEYCAP_POP_TRANSITION } from "../../theme/keycapPress";

/**
 * SortBins — scp's two drop targets drawn as iso decks on floating platforms
 * (docs/SORT_CARDS_REQUIREMENTS.md § 4.5 "Bins"; Claude Design "Tower Tier 2 - Time of
 * Day", the "Sort ·" artboards → `sbins` / `sdeck`).
 *
 * Layer: feature UI (`src/features/discover`), drawn with the Deck Tower's iso kit
 * (docs/ISO_ART_FRAMEWORK.md). One IsoScene holds both bins; each bin is
 *   - a white platform floating over the page ground (IsoPlatform `floating`, its shadow
 *     cast on the ground), the two bobbing in sync;
 *   - a deck of cards in its collection colour (Learning yellow, Mastered blue), one
 *     layer per card sorted into it THIS SESSION — so both start as an empty dashed
 *     footprint and grow as the learner sorts (Undo takes a layer back off);
 *   - the count printed flat on the deck's top card (on the platform while the bin is
 *     empty), with the bin's name printed under it on the same face.
 *
 * While a card is held over one bin, that bin grows (ACTIVE_SCALE); a card dropped on it
 * despawns at once and the bin sets a new top card down on its deck (PLACE_DROP_PX).
 *
 * The page hit-tests drops against each bin's group (`registerBin`), which rides the bob.
 *
 * Depends on: deckTower/iso, sortTimeOfDay.ts. Depended on by: SortCardsPage.tsx.
 */

export interface SortBinSpec {
    id: string;
    /** The deck's card colour (the collection's ramp SURFACE tier). */
    color: string;
    /** The bin's name: printed under the count, and its accessible name. */
    label: string;
}

interface SortBinsProps {
    bins: readonly [SortBinSpec, SortBinSpec];
    /** Cards sorted into each bin this session, by bin id. */
    counts: Record<string, number>;
    /**
     * The bin a held card is over: it grows (ACTIVE_SCALE). Null = neither.
     * Neither bin's colours ever change — the growth is the whole cue (user request
     * 2026-10-29; the other bin used to desaturate).
     */
    activeBinId: string | null;
    look: SortLook;
    /** The bin's hit area (its whole group) for the page's drop test. */
    registerBin: (id: string, el: SVGGElement | null) => void;
    className?: string;
}

// ── Geometry (world units; the artboard's `setProj(13, …)`) ─────────────────────────
const UNIT = 13;
/** The deck's footprint — a card lying on the platform. */
const DECK: WorldRect = { x: 0, y: 0, w: 4.4, d: 6, r: 0.5 };
/** The platform, a unit wider than the deck all round. */
const PLATFORM: WorldRect = { x: -1, y: -1, w: 6.4, d: 8, r: 1 };
const PLATFORM_THICKNESS = 1.2;
/** The ground the platforms' shadows fall on, this far below their undersides. */
const GROUND_GAP = 1.6;
/** One card layer's pitch, and its solid height (the rest is the seam between layers). */
const LAYER_PITCH = 0.2;
const LAYER_SOLID = 0.15;
/**
 * The most layers a deck draws. A long session can sort far more than this; past it the
 * deck stops growing (the count printed on it stays exact), so a tall deck never runs
 * up into the toolbar.
 */
const MAX_LAYERS = 20;
/**
 * Where the count sits: the centre of the deck's top, which is also the platform's centre
 * (DECK is inset 1 unit on each side of PLATFORM in x, and 1 in y).
 */
const COUNT_AT = { x: 2.2, y: 3 };
/** The count's type size in world units (the artboard's 26px under a 0.9 face scale). */
const COUNT_SIZE = 1.8;
/** The name's type size in world units (≈ 13px on screen). */
const NAME_SIZE = 0.9;
/** Line pitch of a two-line name. */
const NAME_LINE = 1.05;
/**
 * The count + name block, centred on COUNT_AT along world y (the face's "down" in reading
 * order): the count sits half a block above the centre, the name's lines below it.
 * A name longer than NAME_LINE_MAX_CHARS ("Already Know") breaks onto one line per word —
 * the deck's top is only 4.4 units wide, too narrow for it on one line at a legible size.
 * A shorter one ("To Learn") stays on one line.
 */
const COUNT_NAME_GAP = 0.35;
/** The longest name kept on one line (≈ 0.58 em per character × NAME_SIZE ≤ the deck's 4.4 width). */
const NAME_LINE_MAX_CHARS = 8;

/** Screen x of each bin's origin in the scene's 390-wide box (the artboard's bin centres + 10.5). */
const BIN_ORIGIN_X = [115.5, 295.5] as const;
/**
 * The scene's box: the 390px artboard width, and tall enough for a full `MAX_LAYERS` deck
 * plus its bob above, and the platforms' shadows below. The scene scales to fit its box.
 */
const VIEW_BOX = "0 -64 390 196";
/**
 * How far both bins are lowered below the box's bottom-pinned position, viewBox px. They
 * hang past the box's bottom edge (the scene is `overflow: visible`), closer to the
 * on-deck cards — moved down by user request 2026-10-29.
 */
const BINS_LOWER_PX = 20;

/**
 * PLACING a card: when a bin's count goes UP, its new top card (with the count printed on
 * it) is set down onto the deck from PLACE_DROP_PX above — fading in as it comes down,
 * landing, and settling with a small bounce. This is the WHOLE drop animation: the
 * dragged card despawns the instant it is let go (no fall to the bin — removed by user
 * request 2026-10-29). A count going down by ONE (Undo) plays it backwards (`.sort-bins__lifted`). viewBox px (≈ screen px: the scene is ~390 wide on a phone).
 */
const PLACE_DROP_PX = 28;
const PLACE_MS = 320;
/**
 * A beat between letting go of the card and the new top card starting down, so the
 * despawn and the set-down read as two moments rather than one (user request
 * 2026-10-29). The `both` fill holds the keyframes' 0% (invisible, raised) during it.
 */
const PLACE_DELAY_MS = 120;

/**
 * The drop-target cue: the bin a held card is over grows by this much, so it is plain
 * which deck the card will land on. It settles back the moment the card is let go,
 * while the new top card is set down. Scaled about the bin's own box centre; the page's hit-test uses rects
 * snapshotted at drag start, so the growth never feeds back into which bin is hovered.
 * The grow uses the tower plate's overshoot (theme/keycapPress → KEYCAP_POP_TRANSITION;
 * keys themselves now snap, this timing survives only for non-press motion).
 */
const ACTIVE_SCALE = 1.1;

const BIN_CSS = `
@keyframes sort-bins-place {
    0%   { transform: translateY(-${PLACE_DROP_PX}px); opacity: 0; }
    30%  { opacity: 1; }
    70%  { transform: translateY(0); }
    85%  { transform: translateY(-1.5px); }
    100% { transform: translateY(0); }
}
.sort-bins__placed { animation: sort-bins-place ${PLACE_MS}ms cubic-bezier(0.3, 0.6, 0.4, 1) ${PLACE_DELAY_MS}ms both; }
/* Undo: the place animation BACKWARDS — the old top card lifts off and fades out. */
.sort-bins__lifted { animation: sort-bins-place ${PLACE_MS}ms cubic-bezier(0.3, 0.6, 0.4, 1) reverse both; }
@media (prefers-reduced-motion: reduce) { .sort-bins__placed, .sort-bins__lifted { animation: none; } }
.sort-bins__bin {
    transform-box: fill-box;
    transform-origin: 50% 50%;
    transition: transform ${KEYCAP_POP_TRANSITION};
}
.sort-bins__bin--active { transform: scale(${ACTIVE_SCALE}); }
@media (prefers-reduced-motion: reduce) { .sort-bins__bin { transition: none; } }
`;

/** A lower layer's material: the card colour stepped down, alternating so the seams read. */
function underLayerMaterial(color: string, k: number): Material {
    return {
        top: shadeHex(color, 0.2),
        left: shadeHex(color, k % 2 ? 0.1 : 0.15),
        right: shadeHex(color, k % 2 ? 0.18 : 0.23),
    };
}

const proj = makeProjector(UNIT);

interface SortBinProps {
    spec: SortBinSpec;
    count: number;
    active: boolean;
    look: SortLook;
    registerBin: SortBinsProps["registerBin"];
}

/** True when the device asks for reduced motion (the place animation is then off). */
function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * A bin's print — its count over its name — laid on the face at height `z`. Dark on a
 * deck's coloured top; the softer ground ink (`look.countEmpty`) on an empty platform.
 */
const BinPrint: React.FC<{ count: number; z: number; label: string; ink: string }> = ({ count, z, label, ink }) => {
    // Count over name, the pair centred on COUNT_AT (see COUNT_NAME_GAP).
    const nameLines = label.length > NAME_LINE_MAX_CHARS ? label.split(" ") : [label];
    const blockHeight = COUNT_SIZE + COUNT_NAME_GAP + nameLines.length * NAME_LINE;
    const countY = COUNT_AT.y - blockHeight / 2 + COUNT_SIZE / 2;
    const nameY = countY + COUNT_SIZE / 2 + COUNT_NAME_GAP + NAME_LINE / 2;
    return (
        <g className="sort-bins__count" transform={faceTransform(proj, z, COUNT_AT)}>
            {/* Drawn in WORLD units: faceTransform maps world (x, y) onto the face, so
                the text must sit at COUNT_AT itself, not at the group's origin. */}
            <text
                className="sort-bins__count-number"
                x={COUNT_AT.x}
                y={countY}
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily={FONTS.sans}
                fontSize={COUNT_SIZE}
                fontWeight={WEIGHT.bold}
                fill={ink}
                style={{ fontVariantNumeric: "tabular-nums" }}
            >
                {count}
            </text>
            <text
                className="sort-bins__name"
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily={FONTS.sans}
                fontSize={NAME_SIZE}
                fontWeight={WEIGHT.semibold}
                fill={ink}
            >
                {nameLines.map((line, i) => (
                    <tspan key={i} x={COUNT_AT.x} y={nameY + i * NAME_LINE}>
                        {line}
                    </tspan>
                ))}
            </text>
        </g>
    );
};

const SortBin: React.FC<SortBinProps> = ({ spec, count, active, look, registerBin }) => {
    const shown = Math.min(count, MAX_LAYERS);
    const layers = useMemo(
        () =>
            Array.from({ length: shown }, (_, k) => ({
                geometry: prism(proj, DECK, k * LAYER_PITCH, k * LAYER_PITCH + LAYER_SOLID),
                material: k === shown - 1 ? bandMaterial(spec.color) : underLayerMaterial(spec.color, k),
            })),
        [shown, spec.color],
    );
    // The count sits ON a top card's face (its solid top, below the seam); on the platform
    // itself (z 0) when the bin is empty.
    const printZ = (layersShown: number) => (layersShown > 0 ? layersShown * LAYER_PITCH - (LAYER_PITCH - LAYER_SOLID) : 0);

    // Each RISE in the count re-keys the top card's group, remounting it so its place
    // animation plays (state from the previous render, React's "adjust state while
    // rendering" pattern — no effect, no extra paint of the un-animated card).
    // `placingFrom` is the count BEFORE the rise, held until that animation ends: while
    // the new card is on its way down, the deck under it still shows its old top card and
    // old number (or the empty footprint and "0"), which the new card then covers.
    const [prevCount, setPrevCount] = useState(count);
    const [placeKey, setPlaceKey] = useState(0);
    const [placingFrom, setPlacingFrom] = useState<number | null>(null);
    // The mirror for Undo taking ONE card back: `liftingFrom` is the count before the
    // drop, and the old top card (with that number) plays the place animation backwards
    // over the deck as it now stands, keyed by `liftKey` so back-to-back undos restart it.
    // Any other fall (several at once) just redraws.
    const [liftingFrom, setLiftingFrom] = useState<number | null>(null);
    const [liftKey, setLiftKey] = useState(0);
    if (count !== prevCount) {
        setPrevCount(count);
        // No animation runs under reduced motion, so nothing would end either hold.
        const animate = !prefersReducedMotion();
        if (count > prevCount) {
            setPlaceKey((k) => k + 1);
            setPlacingFrom(animate ? prevCount : null);
            setLiftingFrom(null);
        } else {
            // Undo mid-placement: drop the placement hold and lift the card off instead.
            setPlacingFrom(null);
            const oneBack = animate && count === prevCount - 1;
            if (oneBack) setLiftKey((k) => k + 1);
            setLiftingFrom(oneBack ? prevCount : null);
        }
    }
    const handlePlaceEnd = (e: React.AnimationEvent<SVGGElement>) => {
        if (e.target === e.currentTarget) setPlacingFrom(null);
    };
    const handleLiftEnd = (e: React.AnimationEvent<SVGGElement>) => {
        if (e.target === e.currentTarget) setLiftingFrom(null);
    };
    // The card being lifted off: the old top, at the old height, with the old number.
    const liftedShown = liftingFrom == null ? null : Math.min(liftingFrom, MAX_LAYERS);
    const liftedTop = liftedShown != null && liftedShown > 0
        ? prism(proj, DECK, (liftedShown - 1) * LAYER_PITCH, (liftedShown - 1) * LAYER_PITCH + LAYER_SOLID)
        : null;

    // The old top card, still shown under the falling one. At the MAX_LAYERS cap the deck
    // doesn't grow, so the old top sits exactly where the new one lands.
    const oldShown = placingFrom == null ? null : Math.min(placingFrom, MAX_LAYERS);
    const underCount = oldShown == null ? shown - 1 : Math.min(oldShown, shown) - 1;
    const oldTop = oldShown != null && oldShown > 0
        ? { geometry: prism(proj, DECK, (oldShown - 1) * LAYER_PITCH, (oldShown - 1) * LAYER_PITCH + LAYER_SOLID), material: bandMaterial(spec.color) }
        : null;
    const showFootprint = shown === 0 || oldShown === 0;

    const className = ["sort-bins__bin", active && "sort-bins__bin--active"].filter(Boolean).join(" ");
    return (
        <g
            className={className}
            ref={(el) => registerBin(spec.id, el)}
            role="img"
            aria-label={`${spec.label}: ${count}`}
        >
            <IsoPlatform
                rect={PLATFORM}
                thickness={PLATFORM_THICKNESS}
                ground={{ z: -PLATFORM_THICKNESS - GROUND_GAP, color: look.ground }}
                tone={platformTone(look.platform)}
                floating
            >
                {showFootprint && (
                    // Empty: a dashed footprint where the deck will stand.
                    <path
                        className="sort-bins__footprint"
                        d={flatPath(proj, DECK, 0)}
                        fill="none"
                        stroke={shadeHex(spec.color, look.footprintShade)}
                        strokeWidth={1.8}
                        strokeDasharray="6 5"
                    />
                )}
                {layers.slice(0, Math.max(underCount, 0)).map((layer, k) => (
                    <IsoSolid key={k} className="sort-bins__layer" geometry={layer.geometry} material={layer.material} />
                ))}
                {/* While a card is being placed: the deck as it was, old number and all. */}
                {oldShown != null && (
                    <g className="sort-bins__old-top">
                        {oldTop && <IsoSolid className="sort-bins__layer" geometry={oldTop.geometry} material={oldTop.material} />}
                        <BinPrint count={placingFrom ?? 0} z={printZ(oldShown)} label={spec.label} ink={oldShown > 0 ? COLORS.onSurface : look.countEmpty} />
                    </g>
                )}
                {/* The top card and its print, set down together (PLACE_DROP_PX). */}
                <g
                    key={placeKey}
                    className={placeKey > 0 ? "sort-bins__top sort-bins__placed" : "sort-bins__top"}
                    onAnimationEnd={handlePlaceEnd}
                >
                    {shown > 0 && (
                        <IsoSolid className="sort-bins__layer" geometry={layers[shown - 1].geometry} material={layers[shown - 1].material} />
                    )}
                    <BinPrint count={count} z={printZ(shown)} label={spec.label} ink={count > 0 ? COLORS.onSurface : look.countEmpty} />
                </g>
                {/* Undo: the old top card lifting off the deck as it now stands. */}
                {liftedTop && (
                    <g key={`lift-${liftKey}`} className="sort-bins__lifted" onAnimationEnd={handleLiftEnd}>
                        <IsoSolid className="sort-bins__layer" geometry={liftedTop} material={bandMaterial(spec.color)} />
                        <BinPrint count={liftingFrom ?? 0} z={printZ(liftedShown ?? 0)} label={spec.label} ink={COLORS.onSurface} />
                    </g>
                )}
            </IsoPlatform>
        </g>
    );
};

const SortBins: React.FC<SortBinsProps> = ({ bins, counts, activeBinId, look, registerBin, className }) => (
    // Pinned to the BOTTOM of its box ("xMidYMax"), so the platforms sit just above the
    // on-deck cards however tall the screen; the spare height goes above, under the toolbar.
    <IsoScene proj={proj} viewBox={VIEW_BOX} preserveAspectRatio="xMidYMax meet" className={className} style={{ width: "100%", height: "100%", overflow: "visible" }}>
        <style>{BIN_CSS}</style>
        {bins.map((spec, i) => (
            <g key={spec.id} transform={`translate(${BIN_ORIGIN_X[i]} ${BINS_LOWER_PX})`}>
                <SortBin
                    spec={spec}
                    count={counts[spec.id] ?? 0}
                    active={activeBinId === spec.id}
                    look={look}
                    registerBin={registerBin}
                />
            </g>
        ))}
    </IsoScene>
);

export default memo(SortBins);
