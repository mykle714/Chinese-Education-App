import React, { useLayoutEffect, useRef, useState } from "react";
import { faceTransform } from "./geometry";
import { shadowTone, type IsoSurface } from "./light";
import { useIsoProjector } from "./sceneContext";
import IsoSpacedText from "./IsoSpacedText";
import { useFontLoadEpoch } from "../../../hooks/useFontLoadEpoch";
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
 * Lines read along a floor axis (`run`) and stack across it. `run="x"` (default): they read
 * along world x (the floor plate's direction) and stack along world +y. `run="-y"`: the
 * block is turned a quarter-turn on the floor, so the lines read along world −y (up-right
 * on screen, still left-to-right) and stack along world +x — a glyph's "up" then points to
 * world −x. Within the block each line is centred (`align="center"`, default) or set flush
 * to the block's end (`align="right"` — `textAnchor="end"`, so a short line ends where the
 * widest one does). `anchor` says what `at` marks along the run: the block's centre
 * (`"center"`, default) or its end (`"end"` — where flush-right lines stop; with `run="-y"`
 * that is the block's far, −y edge, so a print can end a fixed gap off the thing it names).
 * Across the run the block is always centred on `at`.
 *
 * `tail` hangs a mark (e.g. an arrow) past the end of the LAST line, outside the alignment:
 * the lines' own letters set the block's edge and the tail sticks out beyond it, one
 * word-space on. Drawn only with `align="right"` (a centred block has no shared edge to
 * hang it from) and never measured into the block's width. With `anchor="end"`, `at` marks
 * the tail's TIP (the tail is measured after layout), so the letters' edge sits a gap plus
 * the tail's width behind it. Letter-spaced through IsoSpacedText,
 * so the block sits on the same centre in WebKit and Chrome.
 *
 * `maxX` (`run="x"` only — ignored for `"-y"`, where the caller places the block across x
 * itself) keeps the block off something on its right (the platform's rim): the lines are
 * measured after layout (`getBBox`, in world units — the text is drawn in world coordinates
 * under the face transform) and the block slides left just enough that its widest line
 * ends at `maxX`. Measured once per text/size and again when a web font loads, never per
 * frame; before the first measurement (and where there is no layout, e.g. jsdom) it sits
 * centred on `at`.
 *
 * Used by: DeckTowerPlatform (`decals`) — the soft-introduction labels under the corner
 * fixtures (docs/DECK_TOWER.md § "Corner fixture labels"), `run="-y"`, `anchor="end"`.
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
    /** How each line sits within the block: centred (default) or flush to its end. */
    align?: "center" | "right";
    /** The floor axis the lines read along: world x (default) or world −y (a quarter-turn). */
    run?: "x" | "-y";
    /** What `at` marks along the run: the block's centre (default) or its end. */
    anchor?: "center" | "end";
    /** A mark hung past the last line's end, outside the alignment (`align="right"` only). */
    tail?: string;
}

/** The gap between the last line and its `tail`, in em (about a word-space in Noto Sans SC bold). */
const TAIL_GAP_EM = 0.3;

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
    align = "center",
    run = "x",
    anchor = "center",
    tail,
}) => {
    const proj = useIsoProjector();
    // Default: two steps down from the floor, like IsoCardImprint's print (imprint tone → print tone).
    const ink = color ?? shadowTone(shadowTone(surface.color));
    const pitch = fontSize * lineHeight;

    // The widest line's width in world units, measured after layout (see the header note).
    const ref = useRef<SVGGElement>(null);
    const fontEpoch = useFontLoadEpoch();
    // The tail is drawn (and measured) only on a flush-right block.
    const drawTail = tail !== undefined && tail !== "" && align === "right" && lines.length > 0;
    const measureKey = `${lines.join("|")}|${drawTail ? tail : ""}|${fontSize}|${letterSpacing}|${fontEpoch}`;
    // `width`: the widest line. `tailWidth`: the tail glyph(s) alone (0 without one).
    const [measured, setMeasured] = useState<{ key: string; width: number; tailWidth: number } | null>(null);
    // `maxX` is honoured only along x (see the header note).
    const clampX = run === "x" ? maxX : undefined;
    // The widest line is needed to clamp, or whenever the lines' anchor point is not where
    // `at` puts the block's reference: flush-right lines on a centred block, or centred
    // lines on an end-anchored one. (Flush-right on an end anchor needs no measurement —
    // unless it has a tail, whose tip is then the end `at` marks.)
    const needsWidth =
        clampX !== undefined || (align === "right") !== (anchor === "end") || (drawTail && anchor === "end");
    useLayoutEffect(() => {
        if (!needsWidth || measured?.key === measureKey || !ref.current) return;
        let width = 0;
        let tailWidth = 0;
        try {
            const tailEl = ref.current.querySelector(".iso-floor-print__tail") as SVGTextElement | null;
            if (tailEl) tailWidth = tailEl.getBBox().width;
            for (const t of Array.from(ref.current.querySelectorAll<SVGTextElement>(".iso-floor-print__line"))) {
                // IsoSpacedText may not have applied its spacing yet (its own layout effect
                // re-renders it with `textLength` after this commit): add the spacing here.
                const gaps = Math.max(0, Array.from(t.textContent ?? "").length - 1);
                const spacing = t.hasAttribute("textLength") ? 0 : letterSpacing * gaps;
                width = Math.max(width, t.getBBox().width + spacing);
            }
        } catch {
            // Not laid out (detached / no layout engine): stay centred.
        }
        setMeasured({ key: measureKey, width, tailWidth });
    }, [needsWidth, measured, measureKey, letterSpacing]);
    // The lines are laid out in a LOCAL frame: origin on `at`, local x along the run, local
    // y across it (the next line). `run="-y"` turns that frame −90° on the floor, so local
    // x → world −y and local y → world +x.
    const width = measured?.key === measureKey ? measured.width : 0;
    const tailWidth = measured?.key === measureKey ? measured.tailWidth : 0;
    // The gap between the last line's end and its tail.
    const tailGap = fontSize * TAIL_GAP_EM + letterSpacing;
    // How far left the block slides so its widest line ends at `maxX` (0 when it fits).
    const shiftX = clampX === undefined ? 0 : Math.min(0, clampX - (at.x + width / 2));
    // The block's end (local x) and from it each line's anchor x. Before the first
    // measurement `width` is 0 for that one frame — layout effects run before paint, so it
    // is not seen.
    // With a tail on an end anchor, `at` marks the tail's tip, so the lines' shared edge
    // sits one gap + tail behind it.
    const blockEndX = anchor === "end" ? (drawTail ? -(tailGap + tailWidth) : 0) : shiftX + width / 2;
    const lineX = align === "right" ? blockEndX : blockEndX - width / 2;
    // The first line's centre, so the block is centred on `at` across the run.
    const firstY = -((lines.length - 1) * pitch) / 2;
    // The tail starts one word-space past the last line's end (`align="right"` only).
    const tailX = lineX + tailGap;
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
            <g
                className="iso-floor-print__frame"
                transform={`translate(${at.x} ${at.y})${run === "-y" ? " rotate(-90)" : ""}`}
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
                        textAnchor={align === "right" ? "end" : "middle"}
                        // No dominantBaseline: IsoSpacedText centres the caps on `y` itself.
                    >
                        {line}
                    </IsoSpacedText>
                ))}
                {drawTail && (
                    <IsoSpacedText
                        className="iso-floor-print__tail"
                        x={tailX}
                        y={firstY + (lines.length - 1) * pitch}
                        fontSize={fontSize}
                        fontWeight={WEIGHT.bold}
                        letterSpacing={letterSpacing}
                        textAnchor="start"
                    >
                        {tail}
                    </IsoSpacedText>
                )}
            </g>
        </g>
    );
};

export default IsoFloorPrint;
