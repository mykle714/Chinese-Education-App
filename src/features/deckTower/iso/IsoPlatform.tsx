import React, { useMemo } from "react";
import IsoSolid from "./IsoSolid";
import IsoShadow from "./IsoShadow";
import IsoLevitate from "./IsoLevitate";
import { flatPath, insetRect, prism, type WorldRect } from "./geometry";
import type { IsoSurface } from "./light";
import { ISO } from "./palette";
import { useIsoProjector } from "./sceneContext";

/**
 * IsoPlatform — the slab a scene's objects stand on (docs/ISO_ART_FRAMEWORK.md
 * § "IsoPlatform").
 *
 * Its top surface — the FLOOR — is at z = 0 and it extends DOWN to −thickness. Drawn back
 * to front:
 *   1. its shadow on the `ground` (IsoShadow — the slab's footprint cast from its
 *      underside);
 *   2. the slab (IsoSolid), its top painted in the lighter RIM tone;
 *   3. the top again, inset by `RIM_WIDTH`, in the true floor tone — leaving the rim as a
 *      thin light bevel line round the edge;
 *   4. `children` — whatever stands on the floor (carpets, then the objects on them).
 *
 * With `floating`, steps 2–4 go through IsoLevitate: the slab and everything on it bob
 * together, and the shadow breathes in step.
 */
interface IsoPlatformProps {
    rect: WorldRect;
    /** Slab thickness in world units. */
    thickness: number;
    /** The surface far below that the platform's shadow falls on. */
    ground: IsoSurface;
    /** Bob up and down (IsoLevitate). */
    floating?: boolean;
    /** Things standing on the floor; they ride along when it floats. */
    children?: React.ReactNode;
}

/** World-unit width of the light bevel line round the top edge. Exported so a scene can keep things off it (DeckTowerPage's PAWN_ROAM). */
export const RIM_WIDTH = 0.16;

const IsoPlatform: React.FC<IsoPlatformProps> = ({ rect, thickness, ground, floating = false, children }) => {
    const proj = useIsoProjector();
    const slab = useMemo(() => prism(proj, rect, -thickness, 0), [proj, rect, thickness]);

    const shadow = <IsoShadow footprint={rect} casterZ={-thickness} receiver={ground} className="iso-platform__shadow" />;
    const body = (
        <g className="iso-platform">
            <IsoSolid geometry={slab} material={{ ...ISO.platform, top: ISO.platformRim }} className="iso-platform__slab">
                <path className="iso-platform__floor" d={flatPath(proj, insetRect(rect, RIM_WIDTH), 0)} fill={ISO.platform.top} />
            </IsoSolid>
            {children}
        </g>
    );

    return floating ? (
        <IsoLevitate shadow={shadow}>{body}</IsoLevitate>
    ) : (
        <>
            {shadow}
            {body}
        </>
    );
};

export default IsoPlatform;
