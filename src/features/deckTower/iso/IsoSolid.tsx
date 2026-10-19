import React, { useId } from "react";
import type { PrismGeometry } from "./geometry";
import type { Material } from "./palette";

/**
 * IsoSolid — paints one extruded rounded rect (a `PrismGeometry`) in the three-tone
 * flat shading of the iso art framework (docs/ISO_ART_FRAMEWORK.md § "Primitives").
 *
 * The silhouette is filled with a horizontal gradient that steps from the LEFT wall
 * tone to the RIGHT wall tone across the front corner's arc — a hard step on a sharp
 * box, a short blend on a rounded one, which is what sells the soft bevel. The top
 * face is painted over it. `children` render after the top, so a caller can print
 * decals onto the face.
 *
 * A primitive: it takes ready-made geometry, so it needs no scene context. Used by
 * IsoPlatform, IsoCarpet, IsoCard and IsoCardStack.
 */
interface IsoSolidProps {
    geometry: PrismGeometry;
    material: Material;
    className?: string;
    children?: React.ReactNode;
}

const IsoSolid: React.FC<IsoSolidProps> = ({ geometry, material, className, children }) => {
    // useId gives "«r1»"-style ids; strip the punctuation so url(#…) always resolves.
    const gradientId = `iso-wall-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const { frontX, bevelHalfWidth } = geometry;
    return (
        <g className={className}>
            <defs>
                <linearGradient
                    id={gradientId}
                    gradientUnits="userSpaceOnUse"
                    x1={frontX - bevelHalfWidth}
                    y1={0}
                    x2={frontX + bevelHalfWidth}
                    y2={0}
                >
                    <stop offset="0" stopColor={material.left} />
                    <stop offset="1" stopColor={material.right} />
                </linearGradient>
            </defs>
            <path className="iso-solid__walls" d={geometry.hull} fill={`url(#${gradientId})`} />
            <path className="iso-solid__top" d={geometry.top} fill={material.top} />
            {children}
        </g>
    );
};

export default IsoSolid;
