import React from "react";
import { faceTransform, flatPath, type WorldRect } from "./geometry";
import { shadowTone, type IsoSurface } from "./light";
import { useIsoProjector } from "./sceneContext";
import IsoText from "./IsoText";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * IsoCardImprint — the imprint a card stack leaves on its floor, printed "0 cards"
 * (docs/ISO_ART_FRAMEWORK.md § "IsoCardImprint").
 *
 * A floor decal, like IsoFloorLabel: the card rect laid flat on `surface` in the floor's
 * tone one shadow step down, its print one step darker again. It is NOT a shadow —
 * nothing casts it — so it does not slide along the light (no IsoShadow); it sits exactly
 * under where the bottom card stands.
 *
 * The caller draws it under the stack whenever the count is known, not only when the deck
 * is empty: the stack covers it, and whatever clears the floor (a collapse to 0, the trap
 * door's fall, an empty deck) reveals it already there.
 *
 * The `retry` variant prints "↻ retry" in the same figure-over-caption layout: the deck's
 * count failed to load (useFlpReadyCounts `failed`), and the footprint is the tap target
 * that re-fetches it (docs/DECK_TOWER.md § "Loading feedback" → "Counts that fail"). Kept
 * to one short word because the caption must fit the card's 4.8-unit width.
 *
 * Used by: DeckTowerPlatform (`decals`).
 */
interface IsoCardImprintProps {
    /** The card's footprint (the stack's `rect`). */
    rect: WorldRect;
    /** The floor it is pressed into. */
    surface: IsoSurface;
    /** "count" prints "0 cards" (the default); "retry" prints "↻ retry" for a failed count. */
    variant?: "count" | "retry";
}

/** Each variant's figure (large) and caption (under it). */
const IMPRINT_TEXT = {
    count: { figure: "0", caption: "cards" },
    retry: { figure: "↻", caption: "retry" },
} as const;

const IsoCardImprint: React.FC<IsoCardImprintProps> = ({ rect, surface, variant = "count" }) => {
    const text = IMPRINT_TEXT[variant];
    const proj = useIsoProjector();
    const imprintTone = shadowTone(surface.color);
    const printTone = shadowTone(imprintTone);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.d / 2;
    return (
        <g className={`iso-card-imprint iso-card-imprint--${variant}`}>
            <path className="iso-card-imprint__outline" d={flatPath(proj, rect, surface.z)} fill={imprintTone} />
            {/* Same figure-over-caption layout as a card face (IsoCard), but the caption is
                far larger: here it is the whole message, not a footnote under the figure. */}
            <g className="iso-card-imprint__print" transform={faceTransform(proj, surface.z, { x: cx, y: cy })} fill={printTone} fontFamily={FONTS.cjk}>
                <IsoText
                    className="iso-card-imprint__figure"
                    x={cx}
                    y={cy - 0.85}
                    fontSize={2.1}
                    fontWeight={WEIGHT.bold}
                    textAnchor="middle"
                >
                    {text.figure}
                </IsoText>
                <IsoText
                    className="iso-card-imprint__caption"
                    x={cx}
                    y={cy + 1.25}
                    fontSize={1.3}
                    fontWeight={WEIGHT.bold}
                    textAnchor="middle"
                >
                    {text.caption}
                </IsoText>
            </g>
        </g>
    );
};

export default IsoCardImprint;
