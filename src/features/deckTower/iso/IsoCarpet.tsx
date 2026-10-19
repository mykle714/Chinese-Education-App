import React, { useMemo } from "react";
import IsoSolid from "./IsoSolid";
import { prism, type WorldRect } from "./geometry";
import type { IsoSurface } from "./light";
import { ISO } from "./palette";
import { useIsoProjector } from "./sceneContext";

/**
 * IsoCarpet — a zone marked on a floor, the way Good Job zones a room with flat areas
 * rather than props (docs/ISO_ART_FRAMEWORK.md § "IsoCarpet").
 *
 * A low solid mat a step darker than the floor, `thickness` tall — just enough to show a
 * sliver of wall, so it reads as a mat lying on the floor rather than as paint. It counts
 * as part of the floor: it receives shadows but casts none. Whatever stands on it stands
 * on the surface `{ z: surface.z + thickness, color: ISO.carpet.top }`.
 */
interface IsoCarpetProps {
    rect: WorldRect;
    /** The floor it lies on. */
    surface: IsoSurface;
    thickness?: number;
}

const IsoCarpet: React.FC<IsoCarpetProps> = ({ rect, surface, thickness = 0.07 }) => {
    const proj = useIsoProjector();
    const geometry = useMemo(() => prism(proj, rect, surface.z, surface.z + thickness), [proj, rect, surface.z, thickness]);
    return <IsoSolid geometry={geometry} material={ISO.carpet} className="iso-carpet" />;
};

export default IsoCarpet;
