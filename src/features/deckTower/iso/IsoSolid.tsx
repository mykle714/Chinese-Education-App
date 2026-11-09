import React, { useId } from "react";
import type { PrismGeometry } from "./geometry";
import { mixHex, type Material } from "./palette";
import { RIM_LIGHT_PX, RIM_LIGHT_WHITE_PCT, ROUNDED_EDGE_FILLET_PX } from "../../../theme/roundedEdge";

/**
 * IsoSolid — paints one extruded rounded rect (a `PrismGeometry`) in the three-tone
 * flat shading of the iso art framework (docs/ISO_ART_FRAMEWORK.md § "Layers").
 *
 * The silhouette is filled with a horizontal gradient that steps from the LEFT wall
 * tone to the RIGHT wall tone across the front corner's arc — a hard step on a sharp
 * box, a short blend on a rounded one, which is what sells the soft bevel. The top
 * face is painted over it. `children` render after the top, so a caller can print
 * decals onto the face.
 *
 * ── The rounded edge (opt-in, `roundedEdge`) ──
 * The SVG form of theme/roundedEdge.ts — the hairline round the HTML tower objects (the td
 * filter keys, the card-stock mini cards, the footer slab) draw with box-shadows, so the
 * scene's solids and the page's keys share one edge (docs/ISO_ART_FRAMEWORK.md § "The rounded edge"):
 *
 *  - FILLET: the top's FRONT edge (`topFront`, where it meets the walls) stroked
 *    2 × ROUNDED_EDGE_FILLET_PX wide BEFORE the top is painted, so the top covers the inner
 *    half and a ROUNDED_EDGE_FILLET_PX band shows on the wall side. Coloured half-way from
 *    the top to the wall under it — a gradient on the walls' own left → right step.
 *  - RIM LIGHT: the top's BACK edge (`topBack`, against the sky — the edge the upper-left
 *    light catches, as the HTML rim light sits on the face's top-left) stroked
 *    2 × RIM_LIGHT_PX wide, clipped to the top, so RIM_LIGHT_PX shows inside the face.
 *    The top mixed RIM_LIGHT_WHITE_PCT toward `roundedEdge` (the palette's washed
 *    `edgeLight`). Painted AFTER the children, unlike the HTML inset shadow: a raised
 *    floor plate prints a face that covers its whole top (IsoFloorLabel), and every other
 *    caller's print stays inset from the edge.
 *
 * Widths are viewBox px, which the scenes keep ≈ screen px (like the 1px wall seams).
 *
 * A primitive: it takes ready-made geometry and colours, so it needs no scene context. Used
 * by IsoPlatform, IsoSortPlatform, IsoCard, IsoCardStack, IsoPaperStack, IsoFloorLabel,
 * IsoLever, IsoHatch, IsoCloud and the acp's SortBins.
 */
interface IsoSolidProps {
    geometry: PrismGeometry;
    material: Material;
    className?: string;
    /**
     * Draw the hairline rounded edge, with this colour (hex) as the rim light's white —
     * pass the palette's `edgeLight` so it follows the wash. Strokes the geometry's
     * `topFront` / `topBack`.
     */
    roundedEdge?: string;
    children?: React.ReactNode;
}

const IsoSolid: React.FC<IsoSolidProps> = ({ geometry, material, className, roundedEdge, children }) => {
    // useId gives "«r1»"-style ids; strip the punctuation so url(#…) always resolves.
    const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const gradientId = `iso-wall-${uid}`;
    const filletGradientId = `iso-fillet-${uid}`;
    const topClipId = `iso-top-${uid}`;
    const { frontX, bevelHalfWidth } = geometry;
    const edge = roundedEdge !== undefined;
    // The walls' left → right step, across the front corner's arc.
    const wallStep = { gradientUnits: "userSpaceOnUse" as const, x1: frontX - bevelHalfWidth, y1: 0, x2: frontX + bevelHalfWidth, y2: 0 };
    return (
        <g className={className}>
            <defs>
                <linearGradient id={gradientId} {...wallStep}>
                    <stop offset="0" stopColor={material.left} />
                    <stop offset="1" stopColor={material.right} />
                </linearGradient>
                {edge && (
                    <>
                        <linearGradient id={filletGradientId} {...wallStep}>
                            <stop offset="0" stopColor={mixHex(material.top, material.left, 0.5)} />
                            <stop offset="1" stopColor={mixHex(material.top, material.right, 0.5)} />
                        </linearGradient>
                        <clipPath id={topClipId}>
                            <path d={geometry.top} />
                        </clipPath>
                    </>
                )}
            </defs>
            <path className="iso-solid__walls" d={geometry.hull} fill={`url(#${gradientId})`} />
            {edge && (
                <path
                    className="iso-solid__fillet"
                    d={geometry.topFront}
                    fill="none"
                    stroke={`url(#${filletGradientId})`}
                    strokeWidth={2 * ROUNDED_EDGE_FILLET_PX}
                    strokeLinejoin="round"
                />
            )}
            <path className="iso-solid__top" d={geometry.top} fill={material.top} />
            {children}
            {edge && (
                <path
                    className="iso-solid__rim-light"
                    d={geometry.topBack}
                    clipPath={`url(#${topClipId})`}
                    fill="none"
                    stroke={mixHex(material.top, roundedEdge, RIM_LIGHT_WHITE_PCT / 100)}
                    strokeWidth={2 * RIM_LIGHT_PX}
                    strokeLinejoin="round"
                    pointerEvents="none"
                />
            )}
        </g>
    );
};

export default IsoSolid;
