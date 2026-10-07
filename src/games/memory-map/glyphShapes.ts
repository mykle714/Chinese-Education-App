import { useEffect, useState } from "react";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import { bowOffsets, type ShapePart } from "../../../server/services/memoryMapLayout";
import { OUTLINE_PX, PIXELS_PER_WORLD_UNIT } from "./constants";

/**
 * Memory Map glyph measurement (docs/MEMORY_MAP_GAME.md § 2.3).
 *
 * Words are drawn as bare outlined characters, and the layout makes them touch
 * CHARACTER TO CHARACTER — so the layout needs each character's real INK box in the
 * learner's chosen typeface. Ink differs face by face (a round face's 口 is fatter than a
 * kai face's), which is why this runs ON LOAD, in the browser, after the face's glyphs
 * have downloaded, and never on the server.
 *
 * ── ONE MEASUREMENT, TWO CONSUMERS ───────────────────────────────────────────
 * `measureWord` returns, in em: where each character's advance starts, its ink box, and
 * the baseline's position inside a 1em line box. The SAME numbers drive
 *   • the collision shape (`shapeFromMeasure` → `layoutMap`), and
 *   • the rendering (`MemoryMapWord` positions each character span at its measured `x`
 *     inside a line box of `line-height: 1`),
 * so what collides and what is drawn cannot drift apart. That is also why the map no
 * longer renders through ForeignText: its per-character cells are laid out by CPCDRow's
 * column widths, not by the font's advances, and the ink would not land where it was
 * measured. (Flagged as a deliberate exception to the ForeignText container rule.)
 *
 * Canvas `measureText` is the only browser API that reports INK bounds
 * (`actualBoundingBox*`); the DOM only knows advance boxes.
 */

/** Canvas font size used for measuring. Large, so integer rounding inside the canvas is negligible. */
const MEASURE_PX = 200;

/** One character's measurement, in em. `x` = where its advance starts within the word. */
export interface MeasuredChar {
    char: string;
    x: number;
    /** Its own advance width (measured alone) — locates the pivot it turns about when bowed. */
    advance: number;
    inkLeft: number;
    inkRight: number;
    inkAscent: number;
    inkDescent: number;
}

/** A word's measurement, in em, within a line box 1em tall. */
export interface MeasuredWord {
    /** Total advance width. */
    width: number;
    /** Distance from the top of the 1em line box down to the baseline. */
    baseline: number;
    chars: MeasuredChar[];
}

/**
 * The font-family stack the map renders a language in, resolved to a concrete string —
 * canvas cannot read CSS custom properties, and `FONTS.cjk` is `var(--cjk-font, …)`.
 * Reads the live `--cjk-font` that `useChineseFont` writes on :root, falling back to the
 * var()'s own default stack.
 */
export function mapFontFamily(language: string): string {
    if (language === "es") return FONTS.sans;
    const live = getComputedStyle(document.documentElement).getPropertyValue("--cjk-font").trim();
    if (live) return live;
    const fallback = /^var\(--cjk-font,\s*(.*)\)$/.exec(FONTS.cjk);
    return fallback ? fallback[1] : FONTS.cjk;
}

/** The weight the map draws at — bold, as it always has. */
export const MAP_FONT_WEIGHT = WEIGHT.bold;

let measureContext: CanvasRenderingContext2D | null = null;

/** Measure one word in a resolved font family. Synchronous; the face must be loaded. */
export function measureWord(text: string, family: string): MeasuredWord {
    measureContext ??= document.createElement("canvas").getContext("2d");
    const ctx = measureContext;
    if (!ctx) return { width: 0, baseline: 0.8, chars: [] };
    ctx.font = `${MAP_FONT_WEIGHT} ${MEASURE_PX}px ${family}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    const whole = ctx.measureText(text);
    // Baseline inside a `line-height: 1` box: CSS centres the content area (ascent +
    // descent) in the line box, splitting the leftover (possibly negative) evenly.
    const ascent = whole.fontBoundingBoxAscent / MEASURE_PX;
    const descent = whole.fontBoundingBoxDescent / MEASURE_PX;
    const baseline = (1 - (ascent + descent)) / 2 + ascent;

    const chars: MeasuredChar[] = [];
    let prefix = "";
    for (const char of text) {
        // Advance start = width of everything before it, so kerning between letters is
        // honoured exactly as the DOM will lay the same string out.
        const x = ctx.measureText(prefix).width / MEASURE_PX;
        const m = ctx.measureText(char);
        chars.push({
            char,
            x,
            advance: m.width / MEASURE_PX,
            inkLeft: m.actualBoundingBoxLeft / MEASURE_PX,
            inkRight: m.actualBoundingBoxRight / MEASURE_PX,
            inkAscent: m.actualBoundingBoxAscent / MEASURE_PX,
            inkDescent: m.actualBoundingBoxDescent / MEASURE_PX,
        });
        prefix += char;
    }
    return { width: whole.width / MEASURE_PX, baseline, chars };
}

/** Whether a character draws anything (a space does not, and gets no box or arc position). */
function hasInk(c: MeasuredChar): boolean {
    return c.inkLeft + c.inkRight > 0 && c.inkAscent + c.inkDescent > 0;
}

/**
 * The point a character turns about when its word is bowed, as an x offset in em from the
 * word's anchor: the centre of its advance box. Its y is the line-box centre (the anchor's
 * own y), which is also where a `line-height: 1` span's 50% transform origin sits.
 */
function pivotEm(measured: MeasuredWord, c: MeasuredChar): number {
    return c.x + c.advance / 2 - measured.width / 2;
}

/**
 * Each character's place on the word's arc (§ 2.3a), aligned with `measured.chars`:
 * `dy` in em and `rotate` in degrees, about the pivot `pivotOffsetEm` from the
 * character span's left edge. Computed by the layout's own `bowOffsets` over the same
 * inked characters `shapeFromMeasure` gives boxes to, so the drawn arc and the collided
 * arc are the same arc. Inkless characters get zeros — they draw nothing anyway.
 */
export function bowedChars(
    measured: MeasuredWord,
    bow: number
): { dy: number; rotate: number; pivotOffsetEm: number }[] {
    const inked = measured.chars.filter(hasInk);
    const offsets = bowOffsets(
        inked.map((c) => pivotEm(measured, c)),
        bow
    );
    const byChar = new Map(inked.map((c, i) => [c, offsets[i]]));
    return measured.chars.map((c) => ({
        ...(byChar.get(c) ?? { dy: 0, rotate: 0 }),
        pivotOffsetEm: c.advance / 2,
    }));
}

/**
 * A measured word as the layout's collision shape, in world units: one box per
 * character's ink, scaled to the slot's font size and grown by the outline on every side
 * (the outline is drawn in world-layer px, so it does NOT scale with the word). Offsets
 * are from the word's anchor — the centre of its 1em line box. Characters with no ink
 * (a space) contribute no box. Unbowed: `layoutMap` bends it by the slot's bow
 * (`bowShape`), turning each box about its `pivotDx`.
 */
export function shapeFromMeasure(measured: MeasuredWord, scale: number): ShapePart[] {
    const outline = OUTLINE_PX / PIXELS_PER_WORLD_UNIT;
    const parts: ShapePart[] = [];
    for (const c of measured.chars) {
        const left = c.x - c.inkLeft;
        const right = c.x + c.inkRight;
        const top = measured.baseline - c.inkAscent;
        const bottom = measured.baseline + c.inkDescent;
        if (!hasInk(c)) continue;
        parts.push({
            dx: ((left + right) / 2 - measured.width / 2) * scale,
            pivotDx: pivotEm(measured, c) * scale,
            dy: ((top + bottom) / 2 - 0.5) * scale,
            width: (right - left) * scale + 2 * outline,
            height: (bottom - top) * scale + 2 * outline,
        });
    }
    return parts;
}

/**
 * Measure every word on the map in the learner's current face, once its glyphs have
 * loaded. Returns null until then — the caller must not lay the map out with guessed
 * shapes, or every word would jump the moment the real ones arrived.
 *
 * Re-measures when the word set or the face changes (`fontKey` — the account's
 * `chineseFont` id). The face's web-font slices load per unicode range, so it asks
 * `document.fonts.load` for exactly the characters on the map rather than the face in
 * general; if loading fails it measures anyway, with whatever the browser fell back to,
 * which is still what it will draw.
 */
export function useGlyphShapes(
    texts: string[],
    language: string,
    fontKey: string | undefined
): Map<string, MeasuredWord> | null {
    const [measured, setMeasured] = useState<Map<string, MeasuredWord> | null>(null);
    // A stable dependency for the word set: sorted, de-duplicated, joined.
    const textKey = [...new Set(texts)].sort().join("\u0000");

    useEffect(() => {
        let cancelled = false;
        const unique = textKey ? textKey.split("\u0000") : [];
        if (unique.length === 0) {
            setMeasured(new Map());
            return;
        }
        const family = mapFontFamily(language);
        const sample = unique.join("");

        (async () => {
            try {
                await document.fonts.load(`${MAP_FONT_WEIGHT} ${MEASURE_PX}px ${family}`, sample);
            } catch {
                // Measure with the fallback face — it is also what will be drawn.
            }
            if (cancelled) return;
            setMeasured(new Map(unique.map((text) => [text, measureWord(text, family)])));
        })();

        return () => {
            cancelled = true;
        };
    }, [textKey, language, fontKey]);

    return measured;
}
