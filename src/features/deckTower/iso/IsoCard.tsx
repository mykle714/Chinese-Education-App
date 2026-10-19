import React, { useMemo } from "react";
import IsoSolid from "./IsoSolid";
import { faceTransform, flatPath, insetRect, prism, type WorldRect } from "./geometry";
import { ISO } from "./palette";
import { useIsoProjector } from "./sceneContext";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * IsoCard — one flashcard (docs/ISO_ART_FRAMEWORK.md § "IsoCard").
 *
 * A thin extruded rounded rect: cream top (`COLORS.cardFace`, the same fill as every
 * flat card in the app), beige walls, no outline. Its face content is drawn FLAT in world
 * units and mapped onto the top face with `faceTransform`, so it lies on the card like a
 * print rather than standing up off it. The card's HEAD is its low-y edge (the
 * upper-right edge on screen), because printed text runs along +x.
 *
 * A PART, not a standalone object: it casts no shadow of its own. IsoCardStack uses it
 * as its top card and casts the stack's shadow.
 */
interface IsoCardProps {
    /** The card's footprint (world units). Long side along world y = portrait. */
    rect: WorldRect;
    /** World z of the card's underside. */
    z: number;
    thickness: number;
    /** Big figure printed in the middle of the face. */
    figure?: string;
    /** Small caps label printed in the head band. */
    label?: string;
    /** The head band's fill. Defaults to `ISO.cardBand`. */
    bandColor?: string;
    /** Small caption printed under the figure. */
    caption?: string;
}

/** Face layout, in world units on the card's own plane. */
const FACE_PAD = 0.34;
const BAND_DEPTH = 1.05;
const BAND_RADIUS = 0.24;

const IsoCard: React.FC<IsoCardProps> = ({ rect, z, thickness, figure, label, caption, bandColor = ISO.cardBand }) => {
    const proj = useIsoProjector();
    const geometry = useMemo(() => prism(proj, rect, z, z + thickness), [proj, rect, z, thickness]);
    const faceZ = z + thickness;

    const band: WorldRect = { x: rect.x + FACE_PAD, y: rect.y + FACE_PAD, w: rect.w - 2 * FACE_PAD, d: BAND_DEPTH, r: BAND_RADIUS };
    const panel = insetRect(rect, FACE_PAD);
    const cx = rect.x + rect.w / 2;
    const bodyMidY = band.y + band.d + (panel.y + panel.d - (band.y + band.d)) / 2;

    return (
        <IsoSolid geometry={geometry} material={ISO.card} className="iso-card">
            <path className="iso-card__panel" d={flatPath(proj, panel, faceZ)} fill={ISO.cardPanel} />
            <path className="iso-card__band" d={flatPath(proj, band, faceZ)} fill={bandColor} />
            {/* Flat print on the face — drawn in world units, mapped onto the top. */}
            <g className="iso-card__print" transform={faceTransform(proj, faceZ)} fill={ISO.ink} fontFamily={FONTS.sans}>
                {label && (
                    <text
                        className="iso-card__label"
                        x={cx}
                        y={band.y + band.d / 2}
                        fontSize={0.5}
                        fontWeight={WEIGHT.bold}
                        letterSpacing={0.08}
                        textAnchor="middle"
                        dominantBaseline="central"
                    >
                        {label}
                    </text>
                )}
                {figure && (
                    <text
                        className="iso-card__figure"
                        x={cx}
                        y={bodyMidY - (caption ? 0.35 : 0)}
                        fontSize={2.1}
                        fontWeight={WEIGHT.bold}
                        textAnchor="middle"
                        dominantBaseline="central"
                    >
                        {figure}
                    </text>
                )}
                {caption && (
                    <text
                        className="iso-card__caption"
                        x={cx}
                        y={bodyMidY + 1.25}
                        fontSize={0.5}
                        fontWeight={WEIGHT.semibold}
                        textAnchor="middle"
                        dominantBaseline="central"
                        opacity={0.6}
                    >
                        {caption}
                    </text>
                )}
            </g>
        </IsoSolid>
    );
};

export default IsoCard;
