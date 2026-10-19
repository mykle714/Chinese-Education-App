import React, { useMemo } from "react";
import { faceTransform, flatPath, type WorldRect } from "./geometry";
import { shadowTone, type IsoSurface } from "./light";
import { ISO } from "./palette";
import { useIsoProjector } from "./sceneContext";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * IsoFloorLabel — a name plate printed on a floor (docs/ISO_ART_FRAMEWORK.md
 * § "IsoFloorLabel").
 *
 * A rounded rect with the text in ink, the same treatment as a card's head band, laid
 * flat on `surface` with `flatPath` + `faceTransform` so it reads as a decal on the floor.
 * Text runs along world +x (screen down-right), the same direction as a card's print.
 *
 * Like a carpet it is part of its surface: zero height, no shadow, and pawns walk over
 * it. Draw it before anything standing on the floor.
 *
 * Because it is part of the floor it also RECEIVES shadows, in its own tones: `shaded`
 * draws it as it looks in shade (plate and print each one shadow step darker, light.ts →
 * `shadowTone`). A caster whose shadow can cross it draws that shaded copy clipped to its
 * shadow — see IsoPawn's `decals`.
 */
interface IsoFloorLabelProps {
    rect: WorldRect;
    /** The floor it is printed on. */
    surface: IsoSurface;
    text: string;
    /** Cap height-ish, in world units. */
    fontSize?: number;
    /** The plate's fill. Defaults to `ISO.cardBand`, like a card's head band. */
    bandColor?: string;
    /** Draw it as it looks in shadow (each tone one shadow step darker). */
    shaded?: boolean;
}

const IsoFloorLabel: React.FC<IsoFloorLabelProps> = ({
    rect,
    surface,
    text,
    fontSize = 0.55,
    bandColor = ISO.cardBand,
    shaded = false,
}) => {
    const proj = useIsoProjector();
    const plate = useMemo(() => flatPath(proj, rect, surface.z), [proj, rect, surface.z]);
    return (
        <g className={shaded ? "iso-floor-label iso-floor-label--shaded" : "iso-floor-label"}>
            <path className="iso-floor-label__plate" d={plate} fill={shaded ? shadowTone(bandColor) : bandColor} />
            <g className="iso-floor-label__print" transform={faceTransform(proj, surface.z)} fontFamily={FONTS.sans}>
                <text
                    className="iso-floor-label__text"
                    x={rect.x + rect.w / 2}
                    y={rect.y + rect.d / 2}
                    fontSize={fontSize}
                    fontWeight={WEIGHT.bold}
                    letterSpacing={0.08}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={shaded ? shadowTone(ISO.ink) : ISO.ink}
                >
                    {text}
                </text>
            </g>
        </g>
    );
};

export default IsoFloorLabel;
