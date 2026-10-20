import React, { useContext, useMemo } from "react";
import IsoSolid from "./IsoSolid";
import { affineToSvg, hingedPrism, prism, roundedRectWorld, toPath, wallAffine, type WorldRect } from "./geometry";
import { ISO, shadeHex } from "./palette";
import { IsoDeckHingeContext, useIsoProjector } from "./sceneContext";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * IsoWallSlider — a two-position slide switch mounted on a slab's FRONT-LEFT wall, with a
 * name plate beside it naming the position it is in (docs/ISO_ART_FRAMEWORK.md
 * § "IsoWallSlider").
 *
 * Three parts, all on the wall plane at world `wallY` (geometry.ts → `wallAffine`):
 *   - the SLOT, a groove printed a step darker than the wall;
 *   - the KNOB, a chunky cream box (card stock, `ISO.card`) standing OUT of the wall along
 *     +y — an ordinary extruded rounded rect (`prism`), so it takes the framework's
 *     three-tone shading like every solid. It slides along the slot: `position` 0 is the
 *     slot's start (low x, upper-left on screen), 1 its end;
 *   - the LABEL, a flat plate printed on the wall in the `labelColor` band, shaded one
 *     LEFT-wall step (0.07, the same step every left wall takes) because it faces the way
 *     the left walls do. `dimmed` greys it out (`RAMP.grey`'s tones): the switch is not in
 *     use.
 *
 * Purely visual: the caller wraps it in its own button (role, handlers), and `hit` gives a
 * transparent target over the whole fitting for that wrapper to catch taps on.
 *
 * A wall FITTING: pass it to IsoPlatform's `fittings`, which supplies the open trap door
 * (`IsoDeckHingeContext`) so it swings with its wall.
 *
 * The knob is drawn once at the slot's start and slid with a CSS `transform` along the
 * wall's own x direction (an affine image of a world slide), eased by a CSS transition.
 * On a swinging door the slide vector turns with the wall, so the transition is dropped
 * there — it would lag behind the door.
 */

/** The fitting's layout along the wall, in world units (x along the wall, z up). */
export interface WallSliderLayout {
    /** World y of the wall face it is mounted on (the slab's yMax). */
    wallY: number;
    /** World z of the slot's centre line (the slab's top is z = 0). */
    z: number;
    /** The slot's start and length along x. The knob travels inside it. */
    slotX: number;
    slotW: number;
    /** The label plate's start and length along x. */
    labelX: number;
    labelW: number;
}

interface IsoWallSliderProps {
    layout: WallSliderLayout;
    /** The wall's own (left-wall) tone — the slot is printed a step darker than it. */
    wallTone: string;
    /** 0 = knob at the slot's start, 1 = at its end. */
    position: 0 | 1;
    label: string;
    labelColor: string;
    /** The switch is not in use: the label greys out. */
    dimmed?: boolean;
    /** Transparent tap target over the whole fitting (padded by this many world units). */
    hitPad?: number;
}

/** Knob size: along the wall, out of it, and its height. */
const KNOB_W = 0.8;
const KNOB_OUT = 0.42;
const KNOB_H = 0.78;
const KNOB_R = 0.14;
/** The groove's height, and the label plate's. */
const SLOT_H = 0.3;
const LABEL_H = 0.92;
/** How much darker than the wall the groove is. */
const SLOT_DEPTH = 0.12;
/** The LEFT-wall shading step (palette.ts → platformTone), applied to the label print. */
const LEFT_WALL_STEP = 0.07;
const KNOB_SLIDE = "transform 200ms cubic-bezier(0.34, 1.4, 0.64, 1)";

const IsoWallSlider: React.FC<IsoWallSliderProps> = ({ layout, wallTone, position, label, labelColor, dimmed = false, hitPad = 0.35 }) => {
    const proj = useIsoProjector();
    const hinge = useContext(IsoDeckHingeContext);
    const { wallY, z, slotX, slotW, labelX, labelW } = layout;
    // The wall's drawing plane: x along the wall, y DOWN it (so `down` = −z).
    const wall = useMemo(() => wallAffine(proj, wallY, hinge), [proj, wallY, hinge]);
    const down = -z;

    // The knob, at the slot's start. A footprint standing out of the wall along +y.
    const knobRect: WorldRect = useMemo(() => ({ x: slotX, y: wallY, w: KNOB_W, d: KNOB_OUT, r: KNOB_R }), [slotX, wallY]);
    const knob = useMemo(
        () =>
            hinge
                ? hingedPrism(proj, knobRect, z - KNOB_H / 2, z + KNOB_H / 2, hinge)
                : prism(proj, knobRect, z - KNOB_H / 2, z + KNOB_H / 2),
        [proj, knobRect, z, hinge]
    );
    // The knob's travel, as a screen vector: the wall's x direction × the slot's free run.
    const travel = slotW - KNOB_W;
    const slide = { x: wall.a * travel * position, y: wall.b * travel * position };

    // Flat prints on the wall, in its own (x, down) coordinates.
    const plate = (x: number, w: number, h: number, r: number) =>
        toPath(roundedRectWorld({ x, y: down - h / 2, w, d: h, r }));
    const labelFill = shadeHex(dimmed ? ISO.inertPlate : labelColor, LEFT_WALL_STEP);
    const textFill = dimmed ? ISO.inertInk : ISO.ink;
    const hitW = labelX + labelW - slotX + 2 * hitPad;

    return (
        <g className={dimmed ? "iso-wall-slider iso-wall-slider--dimmed" : "iso-wall-slider"}>
            <g className="iso-wall-slider__print" transform={affineToSvg(wall)} fontFamily={FONTS.sans}>
                <path
                    className="iso-wall-slider__hit"
                    d={plate(slotX - hitPad, hitW, LABEL_H + 2 * hitPad, 0.3)}
                    fill="transparent"
                />
                <path className="iso-wall-slider__slot" d={plate(slotX, slotW, SLOT_H, SLOT_H / 2)} fill={shadeHex(wallTone, SLOT_DEPTH)} />
                <path className="iso-wall-slider__label-plate" d={plate(labelX, labelW, LABEL_H, 0.22)} fill={labelFill} />
                <text
                    className="iso-wall-slider__label"
                    x={labelX + labelW / 2}
                    y={down}
                    fontSize={0.58}
                    fontWeight={WEIGHT.bold}
                    letterSpacing={0.08}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={textFill}
                >
                    {label}
                </text>
            </g>
            <g
                className="iso-wall-slider__knob"
                style={{
                    transform: `translate(${slide.x.toFixed(2)}px, ${slide.y.toFixed(2)}px)`,
                    transition: hinge ? "none" : KNOB_SLIDE,
                }}
            >
                <IsoSolid geometry={knob} material={ISO.card} />
            </g>
        </g>
    );
};

export default IsoWallSlider;
