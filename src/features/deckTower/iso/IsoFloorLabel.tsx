import React, { useContext, useMemo } from "react";
import IsoShadow from "./IsoShadow";
import IsoSolid from "./IsoSolid";
import IsoSpacedText from "./IsoSpacedText";
import {
    affineToSvg,
    composeAffine,
    faceAffine,
    faceTransform,
    hingedPlaneAffine,
    hingedPrism,
    invertAffine,
    prism,
    roundedRectWorld,
    toPath,
    type WorldRect,
} from "./geometry";
import { shadowTone, type IsoSurface } from "./light";
import { bandMaterial, type Material } from "./palette";
import { IsoDeckHingeContext, useIsoPalette, useIsoProjector } from "./sceneContext";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * IsoFloorLabel — a name plate printed on a floor (docs/ISO_ART_FRAMEWORK.md
 * § "IsoFloorLabel").
 *
 * A rounded rect with the text in ink, the same treatment as a card's head band, laid
 * flat on `surface`: plate and text are drawn in WORLD units inside one plane transform,
 * so the whole plate reads as a decal on the floor. Text runs along world +x (screen
 * down-right), the same direction as a card's print.
 *
 * Flush (`raised` 0) it is part of its surface like a carpet: zero height, no shadow, and
 * pawns walk over it. Draw it before anything standing on the floor.
 *
 * Because it is part of the floor it also RECEIVES shadows, in its own tones: `shaded`
 * draws it as it looks in shade (plate and print each one shadow step darker, light.ts →
 * `shadowTone`). A caster whose shadow can cross it draws that shaded copy clipped to its
 * shadow — see IsoPawn's `decals`.
 *
 * `raised` stands the plate up as a thin slab (`RAISED_HEIGHT` at 1) so it reads as a
 * button: walls in the band's own three tones (like every solid) and a contact shadow,
 * faded out as it sinks flush (0 draws exactly the flat decal). The Deck Tower presses it
 * flush and swaps its text and band as it pops back up (docs/DECK_TOWER_TRANSITIONS.md
 * § "The plate button").
 *
 * On a platform whose trap door is OPEN (`IsoDeckHingeContext`), the platform's decal
 * transform would squash a raised slab into the door's plane — its walls would lie along
 * the floor instead of standing square off it. So a raised plate there cancels that
 * transform and draws itself swung for real: walls via `hingedPrism`, its face via
 * `hingedPlaneAffine` at the face's own height. Its contact shadow is flat on the floor, so
 * it stays under the platform's transform.
 */

/** World height of a fully raised plate (`raised` = 1): ~5 px at the Deck Tower's scale. */
export const RAISED_HEIGHT = 0.25;

/** A plate's wall tones, from its band (palette.ts → `bandMaterial`), each a shadow step down when shaded. */
const plateMaterial = (band: string, shaded: boolean): Material => {
    const m = bandMaterial(band);
    return shaded ? { top: shadowTone(m.top), left: shadowTone(m.left), right: shadowTone(m.right) } : m;
};
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
    /**
     * How far the plate stands up off `surface`: 0 = flush (a flat decal), 1 = `RAISED_HEIGHT`.
     * May briefly exceed 1 (a spring overshoot).
     */
    raised?: number;
}

const IsoFloorLabel: React.FC<IsoFloorLabelProps> = ({
    rect,
    surface,
    text,
    fontSize = 0.58,
    bandColor,
    shaded = false,
    raised = 0,
}) => {
    const proj = useIsoProjector();
    const palette = useIsoPalette();
    const bandFill = bandColor ?? palette.cardBand;
    const plate = useMemo(() => toPath(roundedRectWorld(rect)), [rect]);
    const height = Math.max(0, raised) * RAISED_HEIGHT;
    const faceZ = surface.z + height;
    // A flat plate rides the platform's decal transform as-is; only a raised one on an open
    // door needs the true swung geometry (see the header).
    const hinge = useContext(IsoDeckHingeContext);
    const swung = hinge !== null && height > 0 ? hinge : null;
    // Measured around the plate's centre (exact there under a perspective camera).
    const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.d / 2 };
    const transform = swung
        ? affineToSvg(composeAffine(hingedPlaneAffine(proj, faceZ, swung), faceAffine(proj, faceZ, centre)))
        : faceTransform(proj, faceZ, centre);
    const slab = useMemo(
        () => (height <= 0 ? null : swung ? hingedPrism(proj, rect, surface.z, faceZ, swung) : prism(proj, rect, surface.z, faceZ)),
        [height, swung, proj, rect, surface.z, faceZ]
    );
    // Cancels the platform's decal transform (the door's plane map at the hinge's height),
    // so the swung slab and face below are drawn in plain screen space.
    const unswing = swung ? affineToSvg(invertAffine(hingedPlaneAffine(proj, swung.z, swung))) : undefined;
    return (
        <g className={shaded ? "iso-floor-label iso-floor-label--shaded" : "iso-floor-label"}>
            {/* The shaded copy (inside a pawn's shadow) skips the contact shadow: the pawn's
                shadow already darkens that floor to the same tone. */}
            {slab && !shaded && (
                <g className="iso-floor-label__shadow" opacity={Math.min(1, raised)}>
                    <IsoShadow footprint={rect} casterZ={surface.z} receiver={surface} />
                </g>
            )}
            <g className="iso-floor-label__body" transform={unswing}>
                {slab && <IsoSolid className="iso-floor-label__slab" geometry={slab} material={plateMaterial(bandFill, shaded)} />}
                <g className="iso-floor-label__face" transform={transform} fontFamily={FONTS.cjk}>
                    <path className="iso-floor-label__plate" d={plate} fill={shaded ? shadowTone(bandFill) : bandFill} />
                    <IsoSpacedText
                        className="iso-floor-label__text"
                        x={rect.x + rect.w / 2}
                        y={rect.y + rect.d / 2}
                        fontSize={fontSize}
                        fontWeight={WEIGHT.bold}
                        letterSpacing={0.06}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={shaded ? shadowTone(palette.ink) : palette.ink}
                    >
                        {text}
                    </IsoSpacedText>
                </g>
            </g>
        </g>
    );
};

export default IsoFloorLabel;
