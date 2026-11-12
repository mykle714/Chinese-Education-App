import React, { useMemo } from "react";
import IsoSolid from "./IsoSolid";
import IsoShadow from "./IsoShadow";
import { RIM_WIDTH } from "./IsoPlatform";
import { faceTransform, flatPath, insetRect, prism, type WorldRect } from "./geometry";
import type { IsoSurface } from "./light";
import { platformTone } from "./palette";
import { useIsoProjector } from "./sceneContext";
import { IsoSnowCap, type SnowCover } from "./IsoSnowCap";
import { HOP_PERIOD_MS, SORT_BIN_PLATFORM, SORT_PLATFORM_JUMP, sortMiniScale, sortMiniThickness, sortPlatformTopZ } from "./sortPlatformMetrics";

/**
 * IsoSortPlatform — a miniature of ONE of acp's sort bins (the Deck Tower draws the third,
 * Comfortable): its platform in the band's colour with IsoPlatform's light rim bevel, and its
 * print (the rating number in a dotted outline of the deck's place) on the top. Everything
 * is acp's bin scaled down uniformly by `sortMiniScale(rect)` — footprint proportions,
 * corner radius, rim width, thickness (`sortMiniThickness`) and print — so it is an exact
 * copy (docs/ISO_ART_FRAMEWORK.md § "IsoSortPlatform"; acp's full-size bins are
 * src/features/discover/SortBins.tsx, their print SortBinPrint.tsx).
 *
 * History (2026-11-11): one slab in four coloured quadrants → four loose platforms in acp's
 * S piece → a loose 2 × 2 → tiles set in a base (2 × 2, then S) → the first bin alone (red) → the Comfortable bin (green), which stood clearest of the
 * main world's gold floor.
 *
 * The Deck Tower lays one on the main world's floor as the Add Cards button
 * (docs/DECK_TOWER.md § "The sort platform").
 *
 * Unlike IsoPlatform (whose top is pinned at z = 0 and which hangs DOWN from it) this slab
 * stands UP from `surface`, like any object on a floor, and casts a standing object's shadow
 * onto it. It is drawn straight in world z — no screen-y translate — so it stays correct
 * under the study camera too. acp's bins float and bob; this one sits on the floor and hops.
 *
 * `progress` builds it up with its scene's tower (0 → 1): the slab grows up out of the floor.
 *
 * `hopping` makes it jump: one big jump with two quickly damped rebounds, all inside 1 s, once
 * per `HOP_PERIOD_MS` (2 s) — the Deck Tower's "cards low" call to sort. Only the body jumps;
 * its shadow stays on the floor and shrinks and fades as it rises, on the same keyframes. The
 * shadow is classed `iso-sort-platform__shadow`, so a scene can hide it alongside
 * `iso-card-stack__shadow` (the Deck Tower does while it falls with the trap door).
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
/** World units the buried slab's outline is grown (and its top face shrunk) by, so its clip swallows the walls' anti-aliased edges. */
const BURIED_EDGE_GROW = 0.02;

interface IsoSortPlatformProps {
    /** The slab's footprint (world units); its depth should be `w × SORT_BIN_ASPECT`, acp's platform's proportions. */
    rect: WorldRect;
    /** The floor it stands on (and casts its shadow on). */
    surface: IsoSurface;
    /**
     * Where its shadow falls, when not on `surface` (docs/TOWER_SNOW.md § "The floor"): the
     * top of the floor's snow it stands in. Null: no shadow (an object buried in the snow).
     */
    shadowReceiver?: IsoSurface | null;
    /** The bin's band colour, already washed by the scene. */
    color: string;
    /**
     * What is printed on the top, drawn FLAT in acp's bin coordinates (`SORT_BIN_PLATFORM`:
     * x −1 → 5.4, y −1 → 7) — the Deck Tower passes SortBinPrint. Scaled and mapped onto the
     * top face here. Undefined: a bare top.
     */
    print?: React.ReactNode;
    /** 0 → 1 build-up. 1 = settled. */
    progress?: number;
    /** Jump every 2 s (see the header). */
    hopping?: boolean;
    /** Freeze the hop where it is. */
    paused?: boolean;
    /**
     * The slab's thickness (default `sortMiniThickness(rect)`, acp's ratio). Standing in floor
     * snow deeper than that, the Deck Tower passes the snow's depth, so the top lies flush
     * with the snow's: the snow meets the slab at its outer edge, the bevel showing, rather
     * than burying the top's front edge (docs/TOWER_SNOW.md § "The floor").
     */
    thickness?: number;
    /**
     * The z of the snow's surface it stands buried in (the Deck Tower: the floor snow's top on
     * a snowy floor). Its walls are not drawn below it — at rest they are wholly under the
     * snow, so not even an anti-aliased edge of them shows; while it hops, the part lifted
     * above the snow does. Undefined: no snow round it.
     */
    buriedTo?: number;
    /** Snow on the top (IsoSnowCap, hiding the print), hopping with it. Undefined: bare. */
    snow?: SnowCover;
}

const IsoSortPlatform: React.FC<IsoSortPlatformProps> = ({ rect, surface, shadowReceiver, color, print, thickness, buriedTo, progress = 1, hopping = false, paused = false, snow }) => {
    const proj = useIsoProjector();
    // useId gives "«r1»"-style ids; strip the punctuation so url(#…) always resolves.
    const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const scale = sortMiniScale(rect);
    const topZ = sortPlatformTopZ(surface.z, progress, thickness ?? sortMiniThickness(rect));

    const slab = useMemo(() => prism(proj, rect, surface.z, topZ), [proj, rect, surface.z, topZ]);
    // IsoPlatform's bevel at this scale: the top in the lighter rim tone, then the top again
    // inset by RIM_WIDTH (scaled) in the true tone.
    const floorPath = useMemo(() => flatPath(proj, insetRect(rect, RIM_WIDTH * scale), topZ), [proj, rect, scale, topZ]);
    const tone = platformTone(color);
    // The print's map: acp bin coordinates → this footprint (translate + uniform scale), then
    // onto the top face at `topZ` (faceTransform, exact at the slab's centre).
    const printTransform = useMemo(() => {
        const at = { x: rect.x + rect.w / 2, y: rect.y + rect.d / 2 };
        const tx = rect.x - SORT_BIN_PLATFORM.x * scale;
        const ty = rect.y - SORT_BIN_PLATFORM.y * scale;
        return `${faceTransform(proj, topZ, at)} translate(${tx} ${ty}) scale(${scale})`;
    }, [proj, rect, scale, topZ]);

    // Buried in snow up to `buriedTo`: the scene region above the snow line — everything but
    // the band the walls fill at rest (the prism's hull minus its top face), the hull grown
    // and the top face shrunk by a hair, so no anti-aliased sliver of wall survives at the
    // band's edges.
    const aboveSnow = useMemo(() => {
        if (buriedTo === undefined || buriedTo <= surface.z) return undefined;
        const g = prism(proj, insetRect(rect, -BURIED_EDGE_GROW), surface.z, buriedTo);
        const top = flatPath(proj, insetRect(rect, BURIED_EDGE_GROW), buriedTo);
        const { minX, minY, maxX, maxY } = g.bounds;
        const pad = Math.max(maxX - minX, maxY - minY) * 4;
        const box = `M${minX - pad} ${minY - pad}H${maxX + pad}V${maxY + pad}H${minX - pad}Z`;
        return `${box}${g.hull}${top}`;
    }, [proj, rect, surface.z, buriedTo]);
    const hopStyle = { "--hop": `${(SORT_PLATFORM_JUMP * proj.heightUnit).toFixed(2)}px` } as React.CSSProperties;

    const className = ["iso-sort-platform", hopping && "iso-sort-platform--hopping", paused && "iso-sort-platform--paused"].filter(Boolean).join(" ");
    return (
        <g className={className}>
            <style>{HOP_CSS}</style>
            <g className="iso-sort-platform__hop-shadow">
                {shadowReceiver !== null && (
                    <IsoShadow footprint={rect} casterZ={surface.z} casterHeight={topZ - surface.z} receiver={shadowReceiver ?? surface} className="iso-sort-platform__shadow" />
                )}
            </g>
            {aboveSnow && (
                <defs>
                    <clipPath id={`iso-sort-platform-above-snow-${uid}`}>
                        <path d={aboveSnow} clipRule="evenodd" />
                    </clipPath>
                </defs>
            )}
            {/* The scene's tap handler measures this group for the art's centre (DeckTowerPlatform → `artSelector`). */}
            <g className="iso-sort-platform__body">
                {/* The slab's walls and top. Buried, clipped to above the snow line in the
                    SCENE's frame (outside the hop): at rest its walls draw nothing, not even an
                    anti-aliased edge; hopping, the part lifted out of the snow shows. */}
                <g className="iso-sort-platform__walls" clipPath={aboveSnow ? `url(#iso-sort-platform-above-snow-${uid})` : undefined}>
                    <g className="iso-sort-platform__hop" style={hopStyle}>
                        <IsoSolid geometry={slab} material={{ ...tone.material, top: tone.rim }} className="iso-sort-platform__slab">
                            <path className="iso-sort-platform__floor" d={floorPath} fill={tone.material.top} />
                        </IsoSolid>
                    </g>
                </g>
                <g className="iso-sort-platform__hop" style={hopStyle}>
                    {/* Buried: the top face again, unclipped — it lies at the snow's surface. */}
                    {aboveSnow && (
                        <>
                            <path className="iso-sort-platform__top" d={slab.top} fill={tone.rim} />
                            <path className="iso-sort-platform__floor" d={floorPath} fill={tone.material.top} />
                        </>
                    )}
                    {print && (
                        <g className="iso-sort-platform__print" transform={printTransform}>
                            {print}
                        </g>
                    )}
                    {/* Snow over the whole top, print included (docs/TOWER_SNOW.md). */}
                    {snow && <IsoSnowCap rect={rect} z={topZ} cover={snow} inset={0.04} />}
                </g>
            </g>
        </g>
    );
};

export default IsoSortPlatform;
