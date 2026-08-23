// Spine geometry — the design's `.sp` box and its variants (shelf-system.css),
// in one place so no shelf in the app invents its own numbers.
//
// This is a plain module rather than exports on Spine.tsx because it exports
// FUNCTIONS (`spineHeight`, `scaled`), which break fast refresh for a component
// in the same file — the same reason phoneGeometry.ts exists.
//
// See docs/SHELF_REDESIGN.md § A3.

/**
 * The spine variants, each a `.sp` modifier in the design.
 *
 * `base` / `tall` / `short` are ONE spine at three heights — the count→height
 * banding (see `spineHeight`). `uni` is a fourth height used by rows where height
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
    short: { width: 74, height: 96 },
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
 */
export const SPINE_SIZES = {
    /** `.sp` padding. */
    padY: 10,
    padX: 9,
    /** `.sp .nm` — the title. */
    nameFontSize: 11.5,
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
    /** `.sp::after` — the dark strip down the left edge. This is what sells "book". */
    strapWidth: 4,
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
 * Where the count→height bands sit, and the whole reason a shelf reads as a shelf.
 *
 * A spine's height encoding how big the set is only works if the heights are
 * BANDED. Continuous height (height = f(count) as a smooth curve) gives a row of
 * near-identical spines that look like sloppy alignment rather than information,
 * and it makes two decks of 40 and 43 cards visibly different for no reason a
 * learner can act on. Three bands are legible; a fourth is not.
 *
 * ⚠️ THE CUTOFFS ARE A FIRST CUT. The design specifies the three heights but not
 * where a set moves between them. These are chosen against the app's actual spreads
 * — a new user's deck is single digits, a worked collection is dozens, and "All
 * Cards" / a mastery band on an established account runs to hundreds — so each band
 * holds a recognisable class of set rather than a third of the range. Revisit with
 * real accounts on screen.
 */
export const SPINE_BANDS = { short: 20, tall: 100 } as const;

/** The variant a set of `count` cards should render at. */
export function spineHeight(count: number | undefined): SpineVariant {
    if (count === undefined) return "base";
    if (count < SPINE_BANDS.short) return "short";
    if (count < SPINE_BANDS.tall) return "base";
    return "tall";
}
