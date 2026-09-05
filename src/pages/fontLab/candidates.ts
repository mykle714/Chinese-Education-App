// Loading and measurement helpers for the font lab.
//
// The CATALOG itself lives in src/theme/cjkFontOptions.ts — it is shipped code now
// (it backs the account setting), and a second lab-local copy drifted on family names
// and stylesheet URLs. This file keeps only what is lab-specific: waiting for a face to
// be usable, and measuring its metrics.

import { CJK_FONT_CATALOG, ensureCjkFontLoaded, type CjkFontOption } from "../../theme/cjkFontOptions";

export { CJK_FONT_CATALOG, type CjkFontOption };

/**
 * Ensure a face's stylesheet is in the document, then wait for the face to be usable.
 * Resolves even on failure — a font that will not load is a fallback, not an error, and
 * a dead CDN should degrade the lab rather than break it.
 */
export async function loadCandidate(option: CjkFontOption, sample: string): Promise<void> {
    ensureCjkFontLoaded(option);
    try {
        // Only the sliced webfonts covering `sample` are fetched; document.fonts.load
        // resolves once those slices are ready (or immediately if the family is unknown).
        await document.fonts.load(`400 40px "${option.family}"`, sample);
        await document.fonts.ready;
    } catch {
        /* A font that will not load is a fallback, not an error. */
    }
}

/**
 * Measured han advance width as a multiple of the font size.
 *
 * WHY THIS READOUT EXISTS: cpcd (docs/CPCD_PINYIN_SHIFT.md) stacks a pinyin syllable
 * over each character assuming han glyphs occupy a full 1em square, and the pinyin-shift
 * logic nudges neighbours from that baseline. A face whose advance is not ~1.00 puts
 * every column out of register. Advisory only — canvas silently falls back to another
 * family if the requested one has not loaded, which reads as a suspiciously round 1.00.
 */
export function measureHanAdvance(family: string, sample = "汉"): number | null {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const SIZE = 100;
    ctx.font = `400 ${SIZE}px "${family}"`;
    const width = ctx.measureText(sample).width;
    return width > 0 ? width / SIZE : null;
}
