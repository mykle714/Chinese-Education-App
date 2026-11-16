// Spine geometry — the design's `.sp` box and its variants (shelf-system.css),
// in one place so no shelf in the app invents its own numbers.
//
// This is a plain module rather than exports on Spine.tsx because it exports
// FUNCTIONS (`relativeSpineHeights`, `spineScale`), which break fast refresh for a component
// in the same file — the same reason phoneGeometry.ts exists.
//
// See docs/SHELF_REDESIGN.md § A3.

/**
 * The spine variants, each a `.sp` modifier in the design.
 *
 * `base` / `tall` / `short` are ONE spine at three heights. `short` and `tall` are
 * also the floor and ceiling of a count-encoding row (`relativeSpineHeights`). `uni` is a fourth height used by rows where height
 * must deliberately NOT encode a count. `vol` is a different object: wider, taller,
 * and laid out from its own slots (a title plate rather than a plain name).
 */
export type SpineVariant = "base" | "tall" | "short" | "uni" | "vol";

interface VariantSpec {
    /** Natural width in px. Also the reference every interior size is authored at. */
    width: number;
    /** Natural height in px. */
    height: number;
}

export const SPINE_VARIANTS: Record<SpineVariant, VariantSpec> = {
    base: { width: 74, height: 116 },
    tall: { width: 74, height: 140 },
    // Compact floor (user, 2026-11-14: 52; 64 from 2026-11-13; the design's 96 before
    // that). Every band label is one line now (11.5px, or the fit-to-line size for
    // "Comfortable" — `Spine`'s `nameFitWidth`), so the content is 2×10 padding +
    // 11.5 × 1.2 ≈ 14 name line + the 13px foot glyph ≈ 47–48px. 52 leaves ~4px between
    // the name and the foot row so the bar still reads as having a top and a foot.
    // ⚠️ A label that wraps to two lines (≈ 61px of content) would overflow this; the
    // 64 floor was sized for that case.
    short: { width: 74, height: 52 },
    uni: { width: 74, height: 126 },
    vol: { width: 86, height: 134 },
};

/**
 * Interior sizes, authored in px at the OWNING VARIANT'S natural width and scaled by
 * `spineScale()` when a caller renders the spine at some other width.
 *
 * ⚠️ THE REFERENCE IS PER VARIANT, not a single global 74. The design authors
 * `.sp.vol`'s interior at its own 86px width (`.ti` is 11.5px there, the same numeral
 * as `.nm` at 74px), so scaling vol's text off a 74 reference would render it ~16%
 * larger than the artboard.
 *
 * ⚠️ SCALED IN JS, NOT IN `cqw`. `DeckTile` (which this replaces) did this with
 * container-query units, and the first cut of `Spine` copied that. It does not
 * transfer, for two reasons:
 *
 *   1. **An element cannot query itself.** `container-type: inline-size` makes a box a
 *      container for its DESCENDANTS. The spine's own padding in `cqw` therefore
 *      resolved against the next container out — the phone frame — producing
 *      `padding: 54px 49px` on a 74px spine. With `box-sizing: border-box` the box
 *      could not shrink below its own padding, so it rendered 98px wide with a
 *      ZERO-width content box, which collapsed every descendant's `cqw` to `0px`:
 *      the name, the count and the glyph were all present at `font-size: 0`.
 *   2. **A spine never shrinks anyway.** `DeckTile` was `flex: 1 1 auto` and genuinely
 *      did not know its own width, which is what container units are for. A spine is
 *      `flex-shrink: 0` and is always given an explicit width, so the component knows
 *      the scale at render time and plain arithmetic is exact.
 *
 * The one place `cqw` IS used is one level up: a ROW may make itself the query
 * container and pass each spine a CSS-length `width` derived from `100cqw`
 * (DeckBuckets → `fittedSpineWidth`). `Spine` then scales these sizes as
 * `calc(<width> × n/natural)`. That works because the container is an ANCESTOR of
 * the spine, which is exactly what reason 1 says self-querying was not.
 */
export const SPINE_SIZES = {
    /** `.sp` padding. */
    padY: 10,
    padX: 9,
    /** `.sp .nm` — the title, at the design's size. */
    nameFontSize: 11.5,
    /**
     * The name's RIGHT inset for a FIT-TO-LINE name (`Spine`'s `nameFitWidth`), in place
     * of `padX`. Applied to the NAME only (as a negative right margin), so the left edge
     * — every name in a row starts on the same inset (user, 2026-11-13) — and the foot
     * row (count and glyph) stay level with the neighbouring spines. It widens the
     * name's line from 56px to 63px at natural width; the font then takes the largest
     * size that fits that line, capped at `nameFontSize`. (Replaced the fixed 10px
     * `nameFontSizeCompact`, 2026-11-14.) If it ever wraps, the soft hyphen in
     * DeckBuckets' `BUCKET_LABELS` still breaks it cleanly as "Comfort- / able".
     */
    namePadRightCompact: 2,
    nameLineHeight: 1.2,
    /** `.sp .k` — the mono count at the foot. */
    countFontSize: 10,
    /** `.sp .pin` — the top-right badge on its translucent white chip. */
    pinFontSize: 9,
    pinInset: 8,
    /** `.sp .cap2` — the bottom mono caption. */
    captionFontSize: 9,
    captionInset: 9,
    /** `.sp .mine` — the top-left glyph. */
    glyphSize: 13,
    glyphInset: 8,
    /**
     * The bar's corner radius, the same on all four corners (2026-11-13; was the
     * design's `11px 11px 4px 4px` book foot). Not scaled with width: a narrowed spine
     * keeps the same rounding so the four bands match.
     */
    cornerRadius: 11,
    /** `.sp.vol .band` — the title plate. */
    volBandInsetX: 7,
    volBandTop: 9,
    volBandPadY: 7,
    volBandPadX: 8,
    volTitleFontSize: 11.5,
    volTitleLineHeight: 1.3,
    /** `.sp.vol .mt` — mono meta lines at the foot. */
    volMetaFontSize: 9,
    volMetaInset: 10,
    volMetaLineHeight: 1.5,
    /** `.sp.vol .own` — the owner glyph, sitting clear of the meta block. */
    volOwnerSize: 13,
    volOwnerRight: 9,
    volOwnerBottom: 46,
} as const;

/**
 * The factor to multiply every `SPINE_SIZES` value by, for a spine rendered at
 * `renderedWidth` when its variant's natural width is `referenceWidth`.
 */
export const spineScale = (renderedWidth: number, referenceWidth: number) =>
    renderedWidth / referenceWidth;

/**
 * The minimum height difference between two spines whose counts differ, in px. Below
 * ~10px two bars side by side read as sloppy alignment rather than as "this one is
 * bigger"; 14 is clearly a step at phone size.
 */
export const SPINE_MIN_HEIGHT_STEP = 14;

/**
 * Heights for a ROW of spines whose heights encode their counts (user, 2026-11-15),
 * index-aligned with `counts`. Replaced the absolute three-band `spineHeight`
 * (< 20 short, < 100 base, else tall), under which 9 and 12 cards rendered at the
 * identical height.
 *
 * The heights are RELATIVE to the row, in two passes:
 *   1. PROPORTIONAL — each count maps linearly from the floor (`short`, 52 — the least
 *      the spine's content fits in) to the ceiling (`tall`, 140) by `count / max`, so
 *      the biggest set is always the tallest bar and an empty set sits on the floor.
 *   2. SEPARATED — walking the DISTINCT counts upward, each is pushed to at least
 *      `SPINE_MIN_HEIGHT_STEP` above the one below it; if that pushes the top past the
 *      ceiling, a downward walk from the ceiling pulls them back under it. The step
 *      shrinks to fit when there are too many distinct counts for the range (never
 *      for the four bands: 3 × 14 = 42 < 88).
 * Equal counts always get equal heights, and order is always preserved.
 *
 * Example: counts 43 / 9 / 12 / 9 → proportional 140 / 70 / 77 / 70 → separated
 * 140 / 70 / 84 / 70.
 *
 * Used by: src/components/DeckBuckets.tsx (passes each result as `Spine`'s `height`).
 * Docs: docs/SHELF_REDESIGN.md § A3.
 */
export function relativeSpineHeights(counts: readonly number[]): number[] {
    const floor = SPINE_VARIANTS.short.height;
    const ceiling = SPINE_VARIANTS.tall.height;
    const range = ceiling - floor;
    // Negative / NaN counts are treated as empty rather than trusted.
    const safe = counts.map((c) => (Number.isFinite(c) && c > 0 ? c : 0));
    const max = Math.max(0, ...safe);
    if (max === 0) return safe.map(() => floor);

    // One height per DISTINCT count, ascending, so ties stay level.
    const distinct = [...new Set(safe)].sort((a, b) => a - b);
    const step = distinct.length > 1 ? Math.min(SPINE_MIN_HEIGHT_STEP, range / (distinct.length - 1)) : 0;
    const heights = distinct.map((c) => floor + (range * c) / max);
    // Upward pass: open every gap to at least `step`.
    for (let i = 1; i < heights.length; i++) heights[i] = Math.max(heights[i], heights[i - 1] + step);
    // Downward pass: the top may now be over the ceiling — pin it and pull the rest under.
    heights[heights.length - 1] = Math.min(heights[heights.length - 1], ceiling);
    for (let i = heights.length - 2; i >= 0; i--) heights[i] = Math.min(heights[i], heights[i + 1] - step);

    const byCount = new Map(distinct.map((c, i) => [c, Math.round(heights[i])]));
    return safe.map((c) => byCount.get(c) ?? floor);
}
