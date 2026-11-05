import React, { useCallback, useMemo, useRef } from "react";
import { Box } from "@mui/material";
import type { MemoryMapWord as MemoryMapWordData } from "../../api/memoryMap";
import type { WordOutcome } from "./types";
import {
    FINDER_DIMMED_OPACITY,
    HIGHLIGHT_PX,
    OUTCOME_OUTLINE,
    OUTLINE_SELECTED,
    PIXELS_PER_WORLD_UNIT,
} from "./constants";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { useTapGesture } from "./useTapGesture";
import { MAP_FONT_WEIGHT, bowedChars, mapFontFamily, type MeasuredWord } from "./glyphShapes";
import { highlightMaskFor, type HighlightMask } from "./highlightMask";

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
 * ── THE TWO LAYERS ───────────────────────────────────────────────────────────
 * Every word is rendered TWICE by MemoryMapWorld (`WORD_LAYERS`): once as its `"ring"` and
 * once as its `"ink"`, and the world stacks ALL rings beneath ALL ink. The ring copy is a
 * block in the outline colour clipped by `highlightMaskFor`'s canvas mask (the glyphs
 * stroked at twice `HIGHLIGHT_PX`, round joins); the ink copy on top covers the inner
 * half, leaving `HIGHLIGHT_PX` showing outside the glyph.
 *
 * Why two layers: the ring (8px) is far wider than the 1px collision margin the layout
 * packs words at (`OUTLINE_PX`), so it overlaps its neighbours. Drawn in one pass, a
 * word's ring would paint over the next word's characters, and within a word each
 * character's ring would paint over the character before it. Splitting the passes means
 * a ring can only ever cover water and other rings, never ink.
 *
 * ── THE RING IS A CANVAS MASK, POCKETS INCLUDED ──────────────────────────────
 * Water the ring fully closes off (the counter of a big 口, a gap two characters' rings
 * seal) is part of the same mask, so a highlighted word reads as one solid shape. The ring
 * is NOT `-webkit-text-stroke`: Chromium strokes HTML text with mitre joins (spikes at
 * every sharp corner at 8px), and a CSS ring that differs from the canvas one left
 * unfilled specks (highlightMask.ts → WHY THE RING IS DRAWN HERE). The mask depends on the
 * shape alone, so it is computed the first time the word is highlighted and only
 * recoloured after that. If the canvas fails, the ring falls back to the CSS stroke so
 * the word's state is never lost.
 *
 * The ink layer owns everything interactive (the tap target, the red pulse); the ring
 * layer is `pointer-events: none`.
 *
 * ── OUTLINE COLOUR IS THE STATE ──────────────────────────────────────────────
 * none = unanswered · blue = armed by the first tap (§ 3.3a) · green / orange / red =
 * the outcome · red flash = a wrong tap. See `OUTCOME_OUTLINE`. "None" is a TRANSPARENT
 * colour rather than no ring, so it fades out instead of vanishing; it fades in with a
 * short opacity animation when the mask first mounts.
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
    /**
     * True when the word finder holds text this word does not contain (§ 3.7). Drawn at
     * `FINDER_DIMMED_OPACITY`, both copies, so the matches stand out. Still tappable —
     * the finder narrows the eye, not the rules. Ignored while the word is armed: the
     * player's own selection must never be what fades.
     */
    dimmed: boolean;
    onTap: (word: MemoryMapWordData) => void;
    /** Which of the two passes this copy draws (see THE TWO LAYERS). */
    layer: "ring" | "ink";
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
    dimmed,
    onTap,
    layer,
}) => {
    const isRing = layer === "ring";
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

    // ── Highlight mask (ring copy only) ───────────────────────────────────────
    // Computed lazily, the first time this word shows any colour, because most words on
    // a map are never armed in a given session. Remembered in a ref once computed so the
    // ring can fade OUT (its colour goes transparent) rather than unmount mid-fade.
    // Reading a ref inside useMemo is deliberate: it is a cache of the last mask, not
    // render state, and `highlightMaskFor` has its own cache behind it anyway.
    const highlighted = outline !== "transparent";
    const maskRef = useRef<{ key: string; mask: HighlightMask | null } | null>(null);
    const ringMask = useMemo(() => {
        if (!isRing) return null;
        const family = mapFontFamily(word.language);
        const key = `${fontPx}|${bow}|${family}`;
        const prev = maskRef.current;
        if (!highlighted) return prev && prev.key === key ? prev.mask : null;
        const mask = highlightMaskFor(measured, fontPx, bow, family);
        maskRef.current = { key, mask };
        return mask;
    }, [isRing, highlighted, measured, fontPx, bow, word.language]);
    // Canvas unavailable: draw the ring with the CSS stroke instead (spiky corners, but
    // the state still shows). An unhighlighted ring copy with no mask draws nothing.
    const cssStrokeRing = isRing && highlighted && !ringMask;

    const tap = useTapGesture(
        useCallback(
            (event: React.PointerEvent) => {
                // Stop the tap reaching the world layer, which reads a pointer on open
                // water as "deselect" (§ 3.3a).
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
                `memory-map-word--${layer}`,
                `memory-map-word--${outcome ?? "unanswered"}`,
                selected ? "memory-map-word--selected" : "",
                pulsing ? "memory-map-word--pulsing" : "",
                fading ? "memory-map-word--fading" : "",
            ]
                .filter(Boolean)
                .join(" ")}
            // ── A SLIDE THAT CROSSES A WORD IS NOT A TAP ON IT ──────────────
            // `useTapGesture` only calls back when the pointer barely moved, so a finger
            // that slides off a word does not answer it (the map no longer pans, but a
            // slid touch is still not a deliberate tap). The whole line box is the tap
            // target — more forgiving than the ink alone, and still inside the word's
            // footprint.
            {...(isRing ? {} : tap)}
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
                // The browser must not pan or zoom for us (CLAUDE.md § Touch & Scroll).
                touchAction: "none",
                transition: "opacity 0.6s ease, filter 0.3s ease",
                // Fading wins (the word is leaving), then the finder's dim (§ 3.7).
                opacity: fading ? 0 : dimmed && !selected ? FINDER_DIMMED_OPACITY : 1,
                // Fading words are on their way out and must not accept another tap.
                // The ring copy is never a target: taps belong to the ink copy above it.
                pointerEvents: fading || isRing ? "none" : "auto",
                // Lift the armed word's ring above its neighbours' rings so its blue is
                // never painted over by a marked word that renders later. (This only
                // orders rings among rings — the whole ink layer still sits on top.)
                zIndex: selected ? 2 : undefined,
                // Ink only: a pulsing ring copy would double the glow.
                "&.memory-map-word--ink.memory-map-word--pulsing": {
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
            {ringMask && (
                <Box
                    className="memory-map-word__ring-mask"
                    sx={{
                        position: "absolute",
                        left: ringMask.left,
                        top: ringMask.top,
                        width: ringMask.width,
                        height: ringMask.height,
                        backgroundColor: outline,
                        WebkitMaskImage: `url(${ringMask.dataUrl})`,
                        maskImage: `url(${ringMask.dataUrl})`,
                        WebkitMaskSize: "100% 100%",
                        maskSize: "100% 100%",
                        transition: "background-color 0.3s ease",
                        // Mounts already coloured (the mask is built on first highlight),
                        // so fade it in rather than pop it.
                        animation: "memory-map-ring-in 0.3s ease",
                        "@keyframes memory-map-ring-in": {
                            from: { opacity: 0 },
                            to: { opacity: 1 },
                        },
                        pointerEvents: "none",
                    }}
                />
            )}
            {/* The ring copy only draws characters in the CSS-stroke fallback. */}
            {(!isRing || cssStrokeRing) &&
                measured.chars.map((c, i) => (
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
                            // Ink copy: fill only. Ring copy (CSS-stroke fallback only): stroke,
                            // transparent fill, since the ink copy above supplies the fill.
                            color: isRing ? "transparent" : COLORS.onSurface,
                            WebkitTextStroke: isRing
                                ? `${HIGHLIGHT_PX * 2}px ${outline}`
                                : undefined,
                            transition: isRing ? "-webkit-text-stroke-color 0.3s ease" : undefined,
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
