import React from "react";
import { flatPath, type WorldRect } from "./geometry";
import { shadowFootprint, shadowTone, type IsoSurface } from "./light";
import { useIsoProjector } from "./sceneContext";

/**
 * IsoShadow — the ONLY way a shadow is drawn in the iso framework
 * (docs/ISO_ART_FRAMEWORK.md § "Light and shadows").
 *
 * Given what casts it (a footprint and the height of its underside) and what it falls
 * on, it applies light.ts's one rule: slide the footprint along the light, lay it flat
 * on the receiver, and paint it in the receiver's colour one shadow step darker. Hard
 * edged, never blurred — the style never blurs.

 *
 * Every object that stands on something renders one of these first, so the object
 * itself covers the part of its shadow that would be hidden.
 */
interface IsoShadowProps {
    /** The caster's underside outline, in world units. */
    footprint: WorldRect;
    /** World z of the caster's underside. */
    casterZ: number;
    /** The surface the shadow falls on. */
    receiver: IsoSurface;
    className?: string;
}

const IsoShadow: React.FC<IsoShadowProps> = ({ footprint, casterZ, receiver, className }) => {
    const proj = useIsoProjector();
    return (
        <path
            className={className ?? "iso-shadow"}
            d={flatPath(proj, shadowFootprint(footprint, casterZ, receiver), receiver.z)}
            fill={shadowTone(receiver.color)}
        />
    );
};

export default IsoShadow;
