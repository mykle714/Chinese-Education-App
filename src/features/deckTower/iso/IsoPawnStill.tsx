import React from "react";
import IsoShadow from "./IsoShadow";
import { pawnFigure, REST_POSE } from "./pawnFigure";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
import { PAWN_FOOT_RADIUS } from "./usePawnMotion";

/**
 * IsoPawnStill — the IsoPawn at rest, with no motion: the same figure and see-through
 * shadow, feet at a world point, for drawing a pawn in another scene. The Deck Tower's
 * count card carries one (TowerCoverCard). Docs: docs/ISO_ART_FRAMEWORK.md § "IsoPawn" → "Summit".
 */
const IsoPawnStill: React.FC<{ at: { x: number; y: number; z: number } }> = ({ at }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const fig = pawnFigure(proj, at, REST_POSE);
    const r = PAWN_FOOT_RADIUS;
    return (
        <g className="iso-pawn-still">
            <IsoShadow
                footprint={{ x: at.x - r, y: at.y - r, w: 2 * r, d: 2 * r, r }}
                casterZ={at.z}
                receiver={{ z: at.z, color: palette.card.top }}
                glaze={palette.ink}
            />
            <path className="iso-pawn-still__body" d={fig.bodyPath} fill={palette.ink} />
            <circle className="iso-pawn-still__head" cx={fig.head.cx} cy={fig.head.cy} r={fig.head.r} fill={palette.ink} />
        </g>
    );
};

export default IsoPawnStill;
