import React, { useMemo } from "react";
import IsoSolid from "./IsoSolid";
import { faceTransform, flatPath, insetRect, prism, type WorldRect } from "./geometry";
import { useIsoPalette, useIsoProjector } from "./sceneContext";
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
    /**
     * Small caps label printed in the head band. The band exists only to house it: with
     * no label the face has no band and the figure centres on the whole panel.
     */
    label?: string;
    /** The head band's fill (only drawn with a `label`). Defaults to `ISO.cardBand`. */
    bandColor?: string;
    /** Small caption printed under the figure. */
    caption?: string;
    /**
     * Opacity of everything printed on the face (panel, band, text) — the bare card stock
     * stays. The Deck Tower takes it off (0) while its study camera is down on the card:
     * the count card is then its own layer over the session (TowerCoverCard), and the
     * session's cards lie on a bare top (docs/DECK_TOWER.md § "Studying the tower").
     * Default 1.
     */
    printOpacity?: number;
}

/**
 * Face layout, in world units on the card's own plane. FACE_PAD is the cream rim around
 * the beige panel; the tower-hosted flp paints the same rim as a share of the card's width
 * (`FLP_CARD_STOCK_INSET_RATIO`, src/features/flashcards/constants.ts = FACE_PAD / CARD_W)
 * — retune both together.
 *
 * PANEL_RADIUS is the panel's own corner — the rim's INNER radius. It is deliberately
 * rounder than concentric (the card's 0.45 corner − FACE_PAD would leave a near-square
 * 0.11), so the rim swells slightly at the corners, and it equals the head band's corner so
 * the band's top corners sit flush in the panel's. The flp mirrors it as
 * `FLP_CARD_PANEL_RADIUS_RATIO` (= PANEL_RADIUS / CARD_W) — retune both together.
 */
const FACE_PAD = 0.34;
const PANEL_RADIUS = 0.24;
const BAND_DEPTH = 1.05;
const BAND_RADIUS = PANEL_RADIUS;

const IsoCard: React.FC<IsoCardProps> = ({ rect, z, thickness, figure, label, caption, bandColor, printOpacity = 1 }) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const bandFill = bandColor ?? palette.cardBand;
    const geometry = useMemo(() => prism(proj, rect, z, z + thickness), [proj, rect, z, thickness]);
    const faceZ = z + thickness;

    const band: WorldRect = { x: rect.x + FACE_PAD, y: rect.y + FACE_PAD, w: rect.w - 2 * FACE_PAD, d: BAND_DEPTH, r: BAND_RADIUS };
    const panel: WorldRect = { ...insetRect(rect, FACE_PAD), r: PANEL_RADIUS };
    const cx = rect.x + rect.w / 2;
    // The figure + caption centre on the panel below the band, or on the whole panel
    // when there is no band.
    const bodyTop = label ? band.y + band.d : panel.y;
    const bodyMidY = bodyTop + (panel.y + panel.d - bodyTop) / 2;

    if (printOpacity <= 0) return <IsoSolid geometry={geometry} material={palette.card} className="iso-card" />;
    return (
        <IsoSolid geometry={geometry} material={palette.card} className="iso-card">
            <g className="iso-card__face" opacity={printOpacity < 1 ? printOpacity : undefined}>
                <path className="iso-card__panel" d={flatPath(proj, panel, faceZ)} fill={palette.cardPanel} />
                {label && <path className="iso-card__band" d={flatPath(proj, band, faceZ)} fill={bandFill} />}
                {/* Flat print on the face — drawn in world units, mapped onto the top (around
                    the card's centre: exact there under a perspective camera). */}
                <g className="iso-card__print" transform={faceTransform(proj, faceZ, { x: cx, y: rect.y + rect.d / 2 })} fill={palette.ink} fontFamily={FONTS.cjk}>
                    {label && (
                        <text
                            className="iso-card__label"
                            x={cx}
                            y={band.y + band.d / 2}
                            fontSize={0.53}
                            fontWeight={WEIGHT.bold}
                            letterSpacing={0.055}
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
                            y={bodyMidY - (caption ? 0.45 : 0)}
                            fontSize={2.1}
                            fontWeight={WEIGHT.bold}
                            // ⚠️ TEMP font trial: a hairline outline in the ink's own colour
                            // makes the count a touch heavier than the faux bold elsewhere.
                            stroke={palette.ink}
                            strokeLinejoin="round"
                            style={{ strokeWidth: "0.012em" }}
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
                            y={bodyMidY + 1.4}
                            fontSize={0.8}
                            fontWeight={WEIGHT.bold}
                            textAnchor="middle"
                            dominantBaseline="central"
                            opacity={0.6}
                        >
                            {caption}
                        </text>
                    )}
                </g>
            </g>
        </IsoSolid>
    );
};

export default IsoCard;
