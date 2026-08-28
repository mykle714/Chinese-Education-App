// Shared color tokens for a card's progress category (FlashcardCategory).
// These match the deck colors used across the app (decks page, discover page).
// Extracted here so MiniVocabCard, VocabCardDetailPage, and the flashcard
// learn-page chip all draw from one source instead of duplicating the map.
import type { MasteryBarId } from "../../server/contracts/wire";
// ⚠️ VALUES REWRITTEN for the shelf redesign (docs/SHELF_REDESIGN.md, decision D2).
// The four categories are now the design's OKLCH PASTELS at the hue each already
// owned. The names, the shape and every consumer are unchanged — only the values moved:
//   Unfamiliar  #EF476F -> #FFDDDB  (--red, oklch(93% 0.045  20))
//   Target      #FF9E5A -> #FFE6C8  (--org, oklch(94% 0.05   70))
//   Comfortable #05C793 -> #D9F4D9  (--grn, oklch(94% 0.045 145))
//   Mastered    #779BE7 -> #D2EBFF  (--blu, oklch(93% 0.045 250))
//
// ⚠️ A PASTEL IS NOT SELF-SUFFICIENT. Each of these is ~1.15:1 against the paper
// ground — invisible as a bare dot, chip or bar. They read only when the shape carries
// `COLORS.markOutline` (a 1px inset ink ring), which is the design's own device:
// `.msb .cells i` fills at 6% ink and STILL draws a 12% ring. A pastel fill without
// that ring is a bug.
//
// ⚠️ And text on one of these must be INK (`COLORS.onSurface`), never white — white on
// a pastel is ~1.1:1. Three call sites were flipped when this landed: MiniVocabCard's
// corner badge and VocabCardDetailBody's category chip. (A third, CardFace's
// `CategoryChip` on the flp card back, was deleted on 2026-08-28.)
//
// The near-white partner of each hue (--redTint etc.) is the `accent` in BAND_COLORS
// below and the `*Accent` token in theme/colors.ts. For INK sitting on a pastel, use
// the ramp's `*A` member (COLORS.redA / orgA / grnA / bluA) instead.
export const CATEGORY_COLORS = {
    Unfamiliar: "#FFDDDB",
    Target: "#FFE6C8",
    Comfortable: "#D9F4D9",
    Mastered: "#D2EBFF",
    // Fallback for unknown/undefined category. --grey, the ramp's neutral surface —
    // a pastel like the four above, so an unknown category is a colorless chip rather
    // than a dark one.
    default: "#E7E7EA",
} as const;

/**
 * The two-tone pair each band paints a DECK TILE with: a saturated body color and a
 * lighter inner fill (`DeckTile`, the deleted stacked-card icon). A `Spine` takes
 * only the `main` pastel — the highlight down its right edge does what the accent
 * used to, so the `accent` half of each pair is now read by other surfaces only.
 *
 * Separate from CATEGORY_COLORS above, which is the single flat color a chip or a
 * mini-card badge uses. A tile needs both tones, and the `main` values here are the
 * same hues, so the two maps agree by construction rather than by coincidence.
 */
// Post-redesign `main` is the 93% PASTEL body and `accent` the 97.5% near-white inner
// fill — two tiers of one hue rather than saturated-over-pastel. The tile needs its own
// outline to separate from the paper; see COLORS.markOutline.
export const BAND_COLORS = {
    Unfamiliar: { main: "#FFDDDB", accent: "#FFF2F2" },
    Target: { main: "#FFE6C8", accent: "#FFF5EA" },
    Comfortable: { main: "#D9F4D9", accent: "#F0FAF0" },
    Mastered: { main: "#D2EBFF", accent: "#EEF8FF" },
    /**
     * "All" — the whole library. Deliberately GREY: every other tile color on the page
     * carries meaning (a band, a mastery bar, a deck's derived accent), and All is not
     * one of those sets — it is their union. A neutral pair keeps it from reading as a
     * fifth band. The accent is the existing `COLORS.card` grey, so it stays inside the
     * app's surface family rather than introducing a new hue.
     *
     * Post-redesign these are the ramp's own neutrals, so "All" is desaturated by
     * construction rather than by a hand-picked grey — and it sits at the same two
     * tiers as the four hues above (--grey body, paper-white inner fill).
     */
    All: { main: "#E7E7EA", accent: "#FBFAF8" },
} as const;

/**
 * "Learn Now" — the cards still being learned (every sorted card whose core bar is
 * unfinished). It is a COLLECTION, not a band, so it takes a hue no band owns:
 * purple. Green (Comfortable) would have been free on the fdp now that the band
 * tiles are gone, but Comfortable green still paints mini-card chips and the Account
 * page's bucket row, and a learner should not meet the same color meaning two things.
 *
 * Shared by the fdp tile and the Games hub selector dot via `builtinCollections.ts`.
 * Same two-tone shape as BAND_COLORS / MASTERY_BAR_COLORS: saturated body + light fill.
 */
export const LEARN_NOW_COLORS = { main: "#ECE2FF", accent: "#F8F4FF" } as const;

/**
 * The two-tone tile palette for each mastery bar's Mastered collection (the fdp's
 * Mastered row, migration 143).
 *
 * The row used to be three blue tiles, on the reasoning that they are one achievement
 * in three skills. In practice that made three DIFFERENT sets look interchangeable, so
 * each bar carries its own hue — and the hue is not arbitrary: `reading` and `writing`
 * are single-mark-type bars, so each takes the BAND HUE its mark already owns
 * (reading = the red hue, writing = the orange hue), the same hue that mark paints on
 * the cdp track and the mini-card strip. A learner who has learned "red = reading" from
 * the progress bars reads the tile the same way.
 *
 * `core` is the exception, and has to be: it blends recognition (blue) and production
 * (green), so it has no single mark hue to borrow and keeps the app's Mastered blue.
 *
 * ⚠️ These are the PASTEL pairs, not `MARK_TYPE_COLORS`. A Mastered tile is a shelf
 * SPINE with a name and a count printed on it, and the design draws exactly that —
 * artboard 2's "Mastered Reading" spine is `background: var(--red)`, the 93% pastel,
 * with ink lettering. `MARK_TYPE_COLORS` stays saturated because a mark CELL carries
 * nothing on top of it. These two maps share a hue, deliberately, at two tiers of it;
 * a previous pass aliased `main` straight to `MARK_TYPE_COLORS` and put unreadable
 * saturated spines next to the pastel band spines on the same shelf.
 *
 * Reading's red and writing's orange are also the Unfamiliar and Target band hues.
 * That used to be a live collision on the fdp, which stacked a band row above the
 * Mastered row; the band collections are gone, so on that page these hues now mean
 * only "reading" and "writing". They still carry the band meaning on the Account
 * page's bucket row and on mini-card chips, where no Mastered tile appears.
 */
export const MASTERY_BAR_COLORS: Record<MasteryBarId, { main: string; accent: string }> = {
    // No mark hue to borrow — recognition + production — so it keeps Mastered blue.
    core: { main: BAND_COLORS.Mastered.main, accent: BAND_COLORS.Mastered.accent },
    // Read from BAND_COLORS rather than restated, so the Mastered spines and the band
    // spines above them on the same shelf cannot drift onto different reds/oranges.
    reading: { main: BAND_COLORS.Unfamiliar.main, accent: BAND_COLORS.Unfamiliar.accent },
    writing: { main: BAND_COLORS.Target.main, accent: BAND_COLORS.Target.accent },
};

/** Maps a card's progress category to its display color, falling back to a
 *  neutral gray for unknown/undefined categories. */
export const getCategoryColor = (category?: string): string => {
    switch (category) {
        case "Unfamiliar": return CATEGORY_COLORS.Unfamiliar;
        case "Target": return CATEGORY_COLORS.Target;
        case "Comfortable": return CATEGORY_COLORS.Comfortable;
        case "Mastered": return CATEGORY_COLORS.Mastered;
        default: return CATEGORY_COLORS.default;
    }
};
