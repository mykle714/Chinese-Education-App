import React, { useCallback } from "react";
import { Box } from "@mui/material";
import type { MemoryMapWord as MemoryMapWordData } from "../../api/memoryMap";
import type { WordOutcome } from "./types";
import {
    OUTCOME_OUTLINE,
    OUTLINE_PX,
    OUTLINE_SELECTED,
    PIXELS_PER_WORLD_UNIT,
} from "./constants";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { useTapGesture } from "./useTapGesture";
import { MAP_FONT_WEIGHT, bowedChars, type MeasuredWord } from "./glyphShapes";

/**
 * One word on the map (docs/MEMORY_MAP_GAME.md § 2.3, § 3.3).
 *
 * ── BARE CHARACTERS, NO CONTAINER ────────────────────────────────────────────
 * Since 2026-10-06 a word is just its characters, in ink, sitting on the blue water —
 * no tile behind it, and no outline until it is armed or marked. Words touch character to
 * character: the layout collides each character's MEASURED ink box (glyphShapes.ts),
 * outline included.
 *
 * ── DRAWN EXACTLY WHERE IT WAS MEASURED ──────────────────────────────────────
 * The word's node is its 1em line box (`measured.width` × 1em at the slot's font size),
 * centred on the layout's anchor and rotated about that centre by the tilt — the same
 * frame `shapeFromMeasure` built the collision boxes in. Each character is its own span
 * at its measured advance `x`, with `line-height: 1`, so the browser draws the ink
 * precisely where the canvas measured it. This is why the map does not render through
 * ForeignText (see glyphShapes.ts).
 *
 * ── THE BOW ──────────────────────────────────────────────────────────────────
 * A multi-character word sits on a gentle arc (§ 2.3a). Each span is moved by its arc
 * `dy` and turned by its arc `rotate` about its pivot (its advance-box centre, at the
 * line-box mid-height) — `translateY` then `rotate` with that transform origin, which
 * is the same pivot-turn `bowShape` applies to the collision box.
 *
 * The outline is `-webkit-text-stroke` at TWICE `OUTLINE_PX` with `paint-order: stroke
 * fill`: the fill paints over the inner half, leaving exactly `OUTLINE_PX` outside the
 * glyph — the amount the collision shape was grown by (always, outline shown or not).
 *
 * ── OUTLINE COLOUR IS THE STATE ──────────────────────────────────────────────
 * none = unanswered · blue = armed by the first tap (§ 3.3a) · green / orange / red =
 * the outcome · red flash = a wrong tap. See `OUTCOME_OUTLINE`. "None" is a TRANSPARENT
 * stroke rather than no stroke, so the colour fades in instead of popping.
 *
 * ── NO PINYIN ON THE MAP, EVER ───────────────────────────────────────────────
 * The prompt bar gives the target's pronunciation; the map must make you find the
 * characters that carry it. Only the characters are drawn.
 */

interface MemoryMapWordProps {
    word: MemoryMapWordData;
    /** The layout's anchor (line-box centre) and tilt, in world units / degrees. */
    x: number;
    y: number;
    tilt: number;
    /** The slot's frozen bow — outer-character lean in degrees, + = smile (§ 2.3a). */
    bow: number;
    /** The slot's frozen scale — the word's font size in world units. */
    scale: number;
    /** The word measured in the current face (glyphShapes.ts). */
    measured: MeasuredWord;
    /** The colour it has earned this run, or undefined while still unanswered. */
    outcome?: WordOutcome;
    /** True for the failed target: it pulses until tapped (§ 3.3). */
    pulsing: boolean;
    /** True for the word the player has armed but not yet committed (§ 3.3a). */
    selected: boolean;
    /** True for a word that just took a wrong tap — a brief red flash. */
    flashing: boolean;
    /** True while it dissolves off the map after graduating (§ 3.6). */
    fading: boolean;
    onTap: (word: MemoryMapWordData) => void;
}

const MemoryMapWord: React.FC<MemoryMapWordProps> = ({
    word,
    x,
    y,
    tilt,
    bow,
    scale,
    measured,
    outcome,
    pulsing,
    selected,
    flashing,
    fading,
    onTap,
}) => {
    const fontPx = scale * PIXELS_PER_WORLD_UNIT;
    const widthPx = measured.width * fontPx;
    const heightPx = fontPx;
    const arc = bowedChars(measured, bow);

    // Precedence: a wrong-tap flash, then the armed state, then the earned outcome,
    // then none (transparent, so the stroke-colour transition fades it in).
    const outline = flashing
        ? COLORS.redMk
        : selected
          ? OUTLINE_SELECTED
          : outcome
            ? OUTCOME_OUTLINE[outcome]
            : "transparent";

    const tap = useTapGesture(
        useCallback(
            (event: React.PointerEvent) => {
                // Stop the tap reaching the world layer, which reads a pointer on open
                // water as "deselect" (§ 3.3a) and treats a drag there as a pan.
                event.stopPropagation();
                onTap(word);
            },
            [onTap, word]
        )
    );

    return (
        <Box
            className={[
                "memory-map-word",
                `memory-map-word--${outcome ?? "unanswered"}`,
                selected ? "memory-map-word--selected" : "",
                pulsing ? "memory-map-word--pulsing" : "",
                fading ? "memory-map-word--fading" : "",
            ]
                .filter(Boolean)
                .join(" ")}
            // ── A PAN THAT CROSSES A WORD IS NOT A TAP ON IT ────────────────
            // `useTapGesture` only calls back when the pointer barely moved, so a drag
            // that starts on a word still pans. The whole line box is the tap target —
            // more forgiving than the ink alone, and still inside the word's footprint.
            {...tap}
            sx={{
                position: "absolute",
                left: x * PIXELS_PER_WORLD_UNIT - widthPx / 2,
                top: y * PIXELS_PER_WORLD_UNIT - heightPx / 2,
                width: widthPx,
                height: heightPx,
                // About the centre (the CSS default origin) — the anchor the layout
                // rotated the collision boxes about. Positive = clockwise.
                transform: `rotate(${tilt}deg)`,
                cursor: "pointer",
                // The map owns its gestures; the browser must not pan or zoom for us.
                touchAction: "none",
                transition: "opacity 0.6s ease, filter 0.3s ease",
                opacity: fading ? 0 : 1,
                // Fading words are on their way out and must not accept another tap.
                pointerEvents: fading ? "none" : "auto",
                // Lift the armed word so its blue outline is never painted over by a
                // neighbour that renders later.
                zIndex: selected ? 2 : undefined,
                "&.memory-map-word--pulsing": {
                    animation: "memory-map-pulse 1.1s ease-in-out infinite",
                },
                "@keyframes memory-map-pulse": {
                    // Glow rather than scale: scaling would push the word's ink into
                    // the neighbours it was laid against.
                    "0%, 100%": { filter: `drop-shadow(0 0 2px ${COLORS.redMk})` },
                    "50%": { filter: `drop-shadow(0 0 12px ${COLORS.redMk})` },
                },
            }}
        >
            {measured.chars.map((c, i) => (
                <Box
                    component="span"
                    // Index, not char: a word can repeat a character (谢谢).
                    key={i}
                    className="memory-map-word__char"
                    sx={{
                        position: "absolute",
                        left: c.x * fontPx,
                        top: 0,
                        // Onto the arc (see THE BOW above). The origin's 50% is the
                        // line-box mid-height because line-height is 1.
                        transformOrigin: `${arc[i].pivotOffsetEm * fontPx}px 50%`,
                        transform: `translateY(${arc[i].dy * fontPx}px) rotate(${arc[i].rotate}deg)`,
                        fontFamily: word.language === "es" ? FONTS.sans : FONTS.cjk,
                        fontSize: fontPx,
                        fontWeight: MAP_FONT_WEIGHT,
                        // MUST be 1: the measured baseline assumes a 1em line box.
                        lineHeight: 1,
                        whiteSpace: "pre",
                        color: COLORS.onSurface,
                        WebkitTextStroke: `${OUTLINE_PX * 2}px ${outline}`,
                        paintOrder: "stroke fill",
                        transition: "-webkit-text-stroke-color 0.3s ease",
                        pointerEvents: "none",
                    }}
                >
                    {c.char}
                </Box>
            ))}
        </Box>
    );
};

export default MemoryMapWord;
