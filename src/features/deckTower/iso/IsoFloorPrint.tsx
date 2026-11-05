import React, { useLayoutEffect, useRef, useState } from "react";
import { faceTransform } from "./geometry";
import { shadowTone, type IsoSurface } from "./light";
import { useIsoProjector } from "./sceneContext";
import IsoSpacedText, { useFontLoadEpoch } from "./IsoSpacedText";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * IsoFloorPrint — a few short lines of text printed flat into a floor
 * (docs/ISO_ART_FRAMEWORK.md § "IsoFloorPrint").
 *
 * A floor decal with no plate of its own: the letters lie in the floor's plane, in `color`
 * (the caller's, already washed for the time of day) or, by default, the floor's tone two
 * shadow steps down — IsoCardImprint's "0 cards" ink. It is not raised (unlike
 * IsoFloorLabel's plate), so pawns walk over it without stepping, and it is not a shadow
 * (no light offset).
 *
 * Lines read along world x (the floor plate's direction) and stack along world +y, centred
 * as a block on `at`. Letter-spaced through IsoSpacedText, so the block sits on the same
 * centre in WebKit and Chrome.
 *
 * `maxX` keeps the block off something on its right (the platform's rim): the lines are
 * measured after layout (`getBBox`, in world units — the text is drawn in world coordinates
 * under the face transform) and the block slides left just enough that its widest line
 * ends at `maxX`. Measured once per text/size and again when a web font loads, never per
 * frame; before the first measurement (and where there is no layout, e.g. jsdom) it sits
 * centred on `at`.
 *
 * Used by: DeckTowerPlatform (`decals`) — the soft-introduction labels under the corner
 * fixtures (docs/DECK_TOWER.md § "Corner fixture labels").
 */
interface IsoFloorPrintProps {
    /** The block's centre on the floor (world units). */
    at: { x: number; y: number };
    /** The lines, top (far, −y) to bottom (near, +y). Keep them short: there is no wrapping. */
    lines: readonly string[];
    /** The floor it is printed into. */
    surface: IsoSurface;
    /** Glyph size, world units. */
    fontSize?: number;
    /** Line pitch, as a multiple of `fontSize`. */
    lineHeight?: number;
    /** Extra space between glyphs, world units. */
    letterSpacing?: number;
    /** Fades the print as a whole (e.g. riding a fixture's build-up). Default 1. */
    opacity?: number;
    /** The ink. Default: the floor's tone two shadow steps down (IsoCardImprint's print). */
    color?: string;
    /** The rightmost world x the block may reach; it slides left to stay inside. Default: none. */
    maxX?: number;
}

const IsoFloorPrint: React.FC<IsoFloorPrintProps> = ({
    at,
    lines,
    surface,
    fontSize = 0.3,
    lineHeight = 1.25,
    letterSpacing = 0.04,
    opacity = 1,
    color,
    maxX,
}) => {
    const proj = useIsoProjector();
    // Default: two steps down from the floor, like IsoCardImprint's print (imprint tone → print tone).
    const ink = color ?? shadowTone(shadowTone(surface.color));
    const pitch = fontSize * lineHeight;

    // The widest line's width in world units, measured after layout (see the header note).
    const ref = useRef<SVGGElement>(null);
    const fontEpoch = useFontLoadEpoch();
    const measureKey = `${lines.join("|")}|${fontSize}|${letterSpacing}|${fontEpoch}`;
    const [measured, setMeasured] = useState<{ key: string; width: number } | null>(null);
    useLayoutEffect(() => {
        if (maxX === undefined || measured?.key === measureKey || !ref.current) return;
        let width = 0;
        try {
            for (const t of Array.from(ref.current.querySelectorAll("text"))) {
                // IsoSpacedText may not have applied its spacing yet (its own layout effect
                // re-renders it with `textLength` after this commit): add the spacing here.
                const gaps = Math.max(0, Array.from(t.textContent ?? "").length - 1);
                const spacing = t.hasAttribute("textLength") ? 0 : letterSpacing * gaps;
                width = Math.max(width, t.getBBox().width + spacing);
            }
        } catch {
            // Not laid out (detached / no layout engine): stay centred.
        }
        setMeasured({ key: measureKey, width });
    }, [maxX, measured, measureKey, letterSpacing]);
    // How far left the block slides so its widest line ends at `maxX` (0 when it fits).
    const width = measured?.key === measureKey ? measured.width : 0;
    const shiftX = maxX === undefined ? 0 : Math.min(0, maxX - (at.x + width / 2));
    const lineX = at.x + shiftX;
    // The first line's centre, so the whole block is centred on `at` (in y).
    const firstY = at.y - ((lines.length - 1) * pitch) / 2;
    return (
        <g
            ref={ref}
            className="iso-floor-print"
            transform={faceTransform(proj, surface.z, at)}
            fill={ink}
            fontFamily={FONTS.cjk}
            opacity={opacity}
            aria-hidden
            pointerEvents="none"
        >
            {lines.map((line, i) => (
                <IsoSpacedText
                    key={`${i}-${line}`}
                    className="iso-floor-print__line"
                    x={lineX}
                    y={firstY + i * pitch}
                    fontSize={fontSize}
                    fontWeight={WEIGHT.bold}
                    letterSpacing={letterSpacing}
                    textAnchor="middle"
                    dominantBaseline="central"
                >
                    {line}
                </IsoSpacedText>
            ))}
        </g>
    );
};

export default IsoFloorPrint;
