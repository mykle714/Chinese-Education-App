import React, { useMemo } from "react";
import IsoSolid from "./IsoSolid";
import IsoShadow from "./IsoShadow";
import { flatPath, insetRect, prism, type WorldRect } from "./geometry";
import type { IsoSurface } from "./light";
import { platformTone, shadeHex } from "./palette";
import { useIsoProjector } from "./sceneContext";
import {
    FOOTPRINT_DASH,
    FOOTPRINT_GAP,
    FOOTPRINT_INSET,
    FOOTPRINT_SHADE,
    FOOTPRINT_STROKE,
    HOP_PERIOD_MS,
    MINI_RIM,
    SORT_PLATFORM_JUMP,
    sortPlatformTopZ,
} from "./sortPlatformMetrics";

/**
 * IsoSortPlatform — acp's empty "To Learn" bin in miniature: a thin slab lying flat on a
 * floor, with a dashed footprint in the bin's colour where its deck would stand
 * (docs/ISO_ART_FRAMEWORK.md § "IsoSortPlatform"; acp's full-size bins are
 * src/features/discover/SortBins.tsx, whose empty bin draws the same dashed footprint).
 *
 * The Deck Tower lays one on the main world's floor as the Add Cards button
 * (docs/DECK_TOWER.md § "The sort platform").
 *
 * Unlike IsoPlatform (whose top is pinned at z = 0 and which hangs DOWN from it) this slab
 * stands UP from `surface`, like any object on a floor, and casts a standing object's
 * shadow onto it. It is drawn straight in world z — no screen-y translate — so it stays
 * correct under the study camera too.
 *
 * `progress` builds it up with its scene's tower (0 → 1): the slab grows up out of the
 * floor to its full thickness.
 *
 * `hopping` makes it jump: one big jump with two quickly damped rebounds, all inside
 * 1 s, once per `HOP_PERIOD_MS` (2 s) — the Deck Tower's "cards low" call to sort.
 * Only the body jumps; its shadow stays on the floor and shrinks and fades as it rises, on
 * the same keyframes. The shadow is classed `iso-sort-platform__shadow`, so a scene can hide
 * it alongside `iso-card-stack__shadow` (the Deck Tower does while it falls with the trap door).
 */

/**
 * The hop as keyframes over the 2 s period: the first 50% (1 s) is the
 * jump + rebounds, the rest is stillness. Heights fall 1 → 0.28 → 0.08 and each flight's
 * time scales with the square root of its height (0.56 s, 0.30 s, 0.16 s), so it reads
 * as a ball losing energy rather than a wobble. Rising legs ease out and falling legs
 * ease in (quadratic), the shape of a free-fall arc.
 */
const RISE = "cubic-bezier(0.5, 1, 0.89, 1)";
const FALL = "cubic-bezier(0.11, 0, 0.5, 0)";
const HOP_CSS = `
@keyframes iso-sort-platform-hop {
    0%   { transform: translateY(0); animation-timing-function: ${RISE}; }
    14%  { transform: translateY(calc(-1 * var(--hop))); animation-timing-function: ${FALL}; }
    28%  { transform: translateY(0); animation-timing-function: ${RISE}; }
    35.5% { transform: translateY(calc(-0.28 * var(--hop))); animation-timing-function: ${FALL}; }
    43%  { transform: translateY(0); animation-timing-function: ${RISE}; }
    46.5% { transform: translateY(calc(-0.08 * var(--hop))); animation-timing-function: ${FALL}; }
    50%, 100% { transform: translateY(0); }
}
@keyframes iso-sort-platform-hop-shadow {
    0%   { transform: scale(1); opacity: 1; animation-timing-function: ${RISE}; }
    14%  { transform: scale(0.72); opacity: 0.5; animation-timing-function: ${FALL}; }
    28%  { transform: scale(1); opacity: 1; animation-timing-function: ${RISE}; }
    35.5% { transform: scale(0.92); opacity: 0.85; animation-timing-function: ${FALL}; }
    43%, 100% { transform: scale(1); opacity: 1; }
}
.iso-sort-platform--hopping .iso-sort-platform__hop {
    animation: iso-sort-platform-hop ${HOP_PERIOD_MS}ms linear infinite;
}
.iso-sort-platform--hopping .iso-sort-platform__hop-shadow {
    transform-box: fill-box;
    transform-origin: center;
    animation: iso-sort-platform-hop-shadow ${HOP_PERIOD_MS}ms linear infinite;
}
.iso-sort-platform--paused .iso-sort-platform__hop,
.iso-sort-platform--paused .iso-sort-platform__hop-shadow { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
    .iso-sort-platform__hop, .iso-sort-platform__hop-shadow { animation: none !important; }
}
`;
interface IsoSortPlatformProps {
    /** The slab's footprint (world units). Portrait, like acp's bins. */
    rect: WorldRect;
    /** The floor it floats over (and casts its shadow on). */
    surface: IsoSurface;
    /** The bin's collection colour (already washed by the scene); the dashed footprint is a shade of it. */
    deckColor: string;
    /** The slab's colour (already washed by the scene). */
    slabColor: string;
    /** 0 → 1 build-up. 1 = settled. */
    progress?: number;
    /** Jump every 2 s (see the header). */
    hopping?: boolean;
    /** Freeze the hop where it is. */
    paused?: boolean;
}

const IsoSortPlatform: React.FC<IsoSortPlatformProps> = ({ rect, surface, deckColor, slabColor, progress = 1, hopping = false, paused = false }) => {
    const proj = useIsoProjector();
    const topZ = sortPlatformTopZ(surface.z, progress);
    const tone = platformTone(slabColor);

    const slab = useMemo(() => prism(proj, rect, surface.z, topZ), [proj, rect, surface.z, topZ]);
    const floorPath = useMemo(() => flatPath(proj, insetRect(rect, MINI_RIM), topZ), [proj, rect, topZ]);
    // acp's empty-bin footprint, scaled down: the deck's outline, dashed, on the slab's top.
    const footprintPath = useMemo(
        () => flatPath(proj, { ...insetRect(rect, FOOTPRINT_INSET), r: Math.min(rect.r, 0.12) }, topZ),
        [proj, rect, topZ],
    );

    const className = ["iso-sort-platform", hopping && "iso-sort-platform--hopping", paused && "iso-sort-platform--paused"].filter(Boolean).join(" ");
    return (
        <g className={className}>
            <style>{HOP_CSS}</style>
            <g className="iso-sort-platform__hop-shadow">
                <IsoShadow footprint={rect} casterZ={surface.z} casterHeight={topZ - surface.z} receiver={surface} className="iso-sort-platform__shadow" />
            </g>
            <g
                className="iso-sort-platform__hop"
                style={{ "--hop": `${(SORT_PLATFORM_JUMP * proj.heightUnit).toFixed(2)}px` } as React.CSSProperties}
            >
                <g className="iso-sort-platform__body">
                    {/* The slab: its top in the lighter rim tone, then the inset floor in the true tone — IsoPlatform's bevel. */}
                    <IsoSolid geometry={slab} material={{ ...tone.material, top: tone.rim }} className="iso-sort-platform__slab">
                        <path className="iso-sort-platform__floor" d={floorPath} fill={tone.material.top} />
                        <path
                            className="iso-sort-platform__footprint"
                            d={footprintPath}
                            fill="none"
                            stroke={shadeHex(deckColor, FOOTPRINT_SHADE)}
                            strokeWidth={FOOTPRINT_STROKE * proj.unit}
                            strokeDasharray={`${FOOTPRINT_DASH * proj.unit} ${FOOTPRINT_GAP * proj.unit}`}
                        />
                    </IsoSolid>
                </g>
            </g>
        </g>
    );
};

export default IsoSortPlatform;
