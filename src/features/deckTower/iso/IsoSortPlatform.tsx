import React, { useMemo } from "react";
import IsoSolid from "./IsoSolid";
import IsoShadow from "./IsoShadow";
import { flatPath, insetRect, prism, type WorldRect } from "./geometry";
import type { IsoSurface } from "./light";
import { platformTone } from "./palette";
import { useIsoProjector } from "./sceneContext";
import { IsoSnowCap, type SnowCover } from "./IsoSnowCap";
import { backToFront } from "./usePawnMotion";
import { HOP_PERIOD_MS, MINI_RIM, SORT_PLATFORM_JUMP, sortPlatformTopZ } from "./sortPlatformMetrics";

/**
 * IsoSortPlatform — acp's four bins in miniature: a thin slab lying flat on a floor, its
 * four QUADRANTS each in one utcm band's colour, the way acp's four band-coloured platforms
 * stand (docs/ISO_ART_FRAMEWORK.md § "IsoSortPlatform"; acp's full-size bins are
 * src/features/discover/SortBins.tsx → BIN_CELLS).
 *
 * QUADRANTS (`quadrantColors`, in acp's bin order Unfamiliar, Target, Comfortable,
 * Mastered): acp lays its bins as an S piece on the iso grid; folded into a 2 × 2 the run
 * keeps acp's neighbours — Unfamiliar on the left (screen), Target down-right of it at the
 * front, Comfortable up-right of that on the right, Mastered at the back (`QUADRANT_CELLS`).
 * Each quadrant is the WHOLE slab drawn in its band's tone, clipped to that quadrant's
 * column (the screen shape of the vertical prism over its quarter of the footprint, open
 * on its outer sides), painted back to front: where two columns overlap on screen (their
 * shared inner wall) the front one is what shows, so the walls and the top split
 * exactly along the quarter lines while the slab keeps its one rounded outline and bevel.
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
/**
 * Each quadrant's quarter of the footprint, in `quadrantColors` order: `qx` 0 = the low-x
 * half, `qy` 0 = the low-y half. World x is −isoY and world y is −isoX (SortBins.tsx →
 * `cellOrigin`), so acp's left cell is low x / high y and its front cell high x / high y.
 */
const QUADRANT_CELLS = [
    { qx: 0, qy: 1 }, // Unfamiliar — left
    { qx: 1, qy: 1 }, // Target — front
    { qx: 1, qy: 0 }, // Comfortable — right
    { qx: 0, qy: 0 }, // Mastered — back
] as const;
/** World units a quadrant's clip column reaches past the slab on its outer sides, so the clip never trims the slab's own rounded outline. */
const COLUMN_OVERREACH = 1;
/** World units a quadrant's column reaches past a quarter line under a neighbour painted after it (a fraction of a pixel's seam). */
const SEAM_OVERLAP = 0.03;
/** World units the buried band's outline is grown (and its top face shrunk) by, so its clip swallows the walls' anti-aliased edges. */
const BURIED_EDGE_GROW = 0.02;

interface IsoSortPlatformProps {
    /** The slab's footprint (world units). Portrait, like acp's bins. */
    rect: WorldRect;
    /** The floor it floats over (and casts its shadow on). */
    surface: IsoSurface;
    /**
     * Where its shadow falls, when not on `surface` (docs/TOWER_SNOW.md § "The floor"): the
     * top of the floor's snow it stands in. Null: no shadow (an object buried in the snow).
     */
    shadowReceiver?: IsoSurface | null;
    /** The four bands' colours (already washed by the scene), in acp's bin order: Unfamiliar, Target, Comfortable, Mastered. */
    quadrantColors: readonly [string, string, string, string];
    /** 0 → 1 build-up. 1 = settled. */
    progress?: number;
    /** Jump every 2 s (see the header). */
    hopping?: boolean;
    /** Freeze the hop where it is. */
    paused?: boolean;
    /**
     * The slab's thickness (default `SLAB_THICKNESS`). Standing in floor snow deeper than
     * that, the Deck Tower passes the snow's depth, so the top lies flush with the snow's:
     * the snow meets the slab at its outer edge, the bevel and the colours showing, rather
     * than burying the top's front edge (docs/TOWER_SNOW.md § "The floor").
     */
    thickness?: number;
    /**
     * The z of the snow's surface it stands buried in (the Deck Tower: the floor snow's top
     * on a snowy floor). Its walls are not drawn below it — at rest they are wholly under the
     * snow, so not even an anti-aliased edge of them shows; while it hops, the part lifted
     * above the snow does. Undefined: no snow round it.
     */
    buriedTo?: number;
    /** Snow on the slab's top (IsoSnowCap), hopping with it. Undefined: bare. */
    snow?: SnowCover;
}

const IsoSortPlatform: React.FC<IsoSortPlatformProps> = ({ rect, surface, shadowReceiver, quadrantColors, thickness, buriedTo, progress = 1, hopping = false, paused = false, snow }) => {
    const proj = useIsoProjector();
    // useId gives "«r1»"-style ids; strip the punctuation so url(#…) always resolves.
    const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const topZ = sortPlatformTopZ(surface.z, progress, thickness);

    const slab = useMemo(() => prism(proj, rect, surface.z, topZ), [proj, rect, surface.z, topZ]);
    const floorPath = useMemo(() => flatPath(proj, insetRect(rect, MINI_RIM), topZ), [proj, rect, topZ]);
    // Each quadrant: its quarter (for the painting order) and its clip column (see the header).
    const quadrants = useMemo(() => {
        const midX = rect.x + rect.w / 2;
        const midY = rect.y + rect.d / 2;
        const quarters: WorldRect[] = QUADRANT_CELLS.map(({ qx, qy }) => ({
            x: qx === 0 ? rect.x : midX,
            y: qy === 0 ? rect.y : midY,
            w: rect.w / 2,
            d: rect.d / 2,
            r: 0,
        }));
        const order = backToFront(quarters, proj);
        const paintedAt = (qx: number, qy: number) => order.indexOf(QUADRANT_CELLS.findIndex((c) => c.qx === qx && c.qy === qy));
        const cells = QUADRANT_CELLS.map(({ qx, qy }, i) => {
            const mine = order.indexOf(i);
            // Open on the outer sides: reach past the slab there. On an inner side, stop at the
            // quarter line — or just past it when the neighbour there is painted later and
            // covers the overlap, so no anti-aliased hairline of the floor shows at the seam.
            const reachX = paintedAt(1 - qx, qy) > mine ? SEAM_OVERLAP : 0;
            const reachY = paintedAt(qx, 1 - qy) > mine ? SEAM_OVERLAP : 0;
            const x0 = qx === 0 ? rect.x - COLUMN_OVERREACH : midX - reachX;
            const x1 = qx === 0 ? midX + reachX : rect.x + rect.w + COLUMN_OVERREACH;
            const y0 = qy === 0 ? rect.y - COLUMN_OVERREACH : midY - reachY;
            const y1 = qy === 0 ? midY + reachY : rect.y + rect.d + COLUMN_OVERREACH;
            const column: WorldRect = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r: 0 };
            return { clip: prism(proj, column, surface.z, Math.max(topZ, surface.z + 1e-3)).hull };
        });
        return { cells, order };
    }, [proj, rect, surface.z, topZ]);

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
    // One quadrant, back to front, the whole slab in its band's tone clipped to its column:
    // its top in the lighter rim tone, then the inset floor in the true tone — IsoPlatform's
    // bevel. `topOnly`: just the top face (the buried slab's unclipped top).
    const renderQuadrant = (i: number, topOnly: boolean) => {
        const tone = platformTone(quadrantColors[i]);
        return (
            <g key={i} className={`iso-sort-platform__quadrant iso-sort-platform__quadrant--${i}`} clipPath={`url(#iso-sort-platform-quadrant-${uid}-${i})`}>
                {topOnly ? (
                    <>
                        <path className="iso-sort-platform__top" d={slab.top} fill={tone.rim} />
                        <path className="iso-sort-platform__floor" d={floorPath} fill={tone.material.top} />
                    </>
                ) : (
                    <IsoSolid geometry={slab} material={{ ...tone.material, top: tone.rim }} className="iso-sort-platform__slab">
                        <path className="iso-sort-platform__floor" d={floorPath} fill={tone.material.top} />
                    </IsoSolid>
                )}
            </g>
        );
    };

    const className = ["iso-sort-platform", hopping && "iso-sort-platform--hopping", paused && "iso-sort-platform--paused"].filter(Boolean).join(" ");
    return (
        <g className={className}>
            <style>{HOP_CSS}</style>
            <g className="iso-sort-platform__hop-shadow">
                {shadowReceiver !== null && (
                    <IsoShadow footprint={rect} casterZ={surface.z} casterHeight={topZ - surface.z} receiver={shadowReceiver ?? surface} className="iso-sort-platform__shadow" />
                )}
            </g>
            <defs>
                {quadrants.cells.map((c, i) => (
                    <clipPath key={i} id={`iso-sort-platform-quadrant-${uid}-${i}`}>
                        <path d={c.clip} />
                    </clipPath>
                ))}
                {aboveSnow && (
                    <clipPath id={`iso-sort-platform-above-snow-${uid}`}>
                        <path d={aboveSnow} clipRule="evenodd" />
                    </clipPath>
                )}
            </defs>
            {/* The slab — walls and top. Buried (`buriedTo`), clipped to above the snow
                line in the SCENE's frame (the clip sits outside the hop): at rest its walls
                are wholly under the snow and draw nothing, not even an anti-aliased edge;
                hopping, the part lifted above the snow shows. */}
            <g className="iso-sort-platform__walls" clipPath={aboveSnow ? `url(#iso-sort-platform-above-snow-${uid})` : undefined}>
                <g className="iso-sort-platform__hop" style={hopStyle}>
                    {quadrants.order.map((i) => renderQuadrant(i, false))}
                </g>
            </g>
            <g className="iso-sort-platform__hop" style={hopStyle}>
                <g className="iso-sort-platform__body">
                    {/* Buried: the top face again, unclipped — it lies at the snow's surface. */}
                    {aboveSnow && quadrants.order.map((i) => renderQuadrant(i, true))}
                    {/* Snow over the slab's whole top, hiding all four colours (docs/TOWER_SNOW.md). */}
                    {snow && <IsoSnowCap rect={rect} z={topZ} cover={snow} inset={0.04} />}
                </g>
            </g>
        </g>
    );
};

export default IsoSortPlatform;
