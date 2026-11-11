import React from "react";

/**
 * IsoText — the iso kit's centred SVG `<text>`: `y` is the visual centre of the glyphs' INK,
 * identical in WebKit (iOS Safari / the Capacitor app) and Chromium.
 *
 * Why it exists: `dominant-baseline="central"` centres the font's EM box, not its ink, and
 * WebKit and Chromium derive that box differently for a CJK face. The iso kit prints in
 * `FONTS.cjk` (975 Maru SC), so every `central` label looked centred in desktop Chrome and
 * sat visibly off-centre on an iPhone — first the Deck Tower's "LEARNING" plate, then the
 * acp's rating numbers (2026-11-10). A desktop check cannot catch it.
 *
 * The fix: keep the ALPHABETIC baseline (every engine places it identically) and drop it by
 * INK_CENTRE_DY, so the ink centres on `y` everywhere. `dominantBaseline` and `dy` are
 * omitted from the props type so a caller cannot reintroduce the drift, and eslint
 * (eslint.config.js, "iso text" block) rejects a bare `dominantBaseline` in the iso kit.
 *
 * Draw iso text with this, or with IsoSpacedText when it is letter-spaced (that one uses
 * the same INK_CENTRE_DY). Text that is deliberately positioned by its baseline (e.g. the
 * Deck Tower's TapToStartHint, which stacks words above an arrow) needs neither.
 *
 * Users: IsoCard (figure + caption), IsoCardImprint, IsoPawn (emote mark), PawnIdleProps
 * (mark discs, doze Z's), discover/SortBins.tsx (NumberPrint).
 * Docs: docs/ISO_ART_FRAMEWORK.md § "Text in the iso kit".
 */

/**
 * How far below `y` the alphabetic baseline sits so the ink centres on `y`. Measured from
 * 975 Maru SC's outlines (the cn-fontsource woff2 subsets, fontTools bounds):
 *   capitals (H, Z, LEARNING) 0.338 em · digits 0–4 0.337–0.344 em · "!" 0.341 em ·
 *   "cards" (ascender) 0.356 em · x-height-only words (acrs) 0.257 em.
 * So 0.34 em centres caps, digits, punctuation and words with an ascender. It is also
 * within 0.004 em of where Chromium's `central` put Maru (hhea (928 − 256) / 2 = 0.336 em),
 * so desktop rendering is unchanged and only WebKit moves. A lowercase-only word with no
 * ascender would sit ~0.08 em high; none is drawn today.
 * ⚠️ Font-specific: re-measure if `FONTS.cjk`'s face (useChineseFont's
 * DEFAULT_CHINESE_FONT_ID) changes.
 */
export const INK_CENTRE_DY = "0.34em";

export type IsoTextProps = Omit<React.SVGProps<SVGTextElement>, "dominantBaseline" | "dy" | "ref">;

const IsoText: React.FC<IsoTextProps> = ({ children, ...textProps }) => (
    <text {...textProps} dy={INK_CENTRE_DY}>
        {children}
    </text>
);

export default IsoText;
