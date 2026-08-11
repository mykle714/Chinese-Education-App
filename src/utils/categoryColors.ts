// Shared color tokens for a card's progress category (FlashcardCategory).
// These match the deck colors used across the app (decks page, discover page).
// Extracted here so MiniVocabCard, VocabCardDetailPage, and the flashcard
// learn-page chip all draw from one source instead of duplicating the map.
import { MARK_TYPE_COLORS } from "./masteryCompute";
import type { MasteryBarId } from "../../server/contracts/wire";
export const CATEGORY_COLORS = {
    Unfamiliar: "#EF476F",
    Target: "#FF9E5A",
    Comfortable: "#05C793",
    Mastered: "#779BE7",
    // Fallback for unknown/undefined category.
    default: "#5C5C66",
} as const;

/**
 * The two-tone pair each band paints a DECK TILE with: a saturated body color and a
 * lighter inner fill (`DeckTile`, the stacked-card icon).
 *
 * Separate from CATEGORY_COLORS above, which is the single flat color a chip or a
 * mini-card badge uses. A tile needs both tones, and the `main` values here are the
 * same hues, so the two maps agree by construction rather than by coincidence.
 */
export const BAND_COLORS = {
    Unfamiliar: { main: "#EF476F", accent: "#F2BAC9" },
    Target: { main: "#FF9E5A", accent: "#F2E2BA" },
    Comfortable: { main: "#05C793", accent: "#BAF2D8" },
    Mastered: { main: "#779BE7", accent: "#BAD7F2" },
    /**
     * "All" — the whole library. Deliberately GREY: every other tile color on the page
     * carries meaning (a band, a mastery bar, a deck's derived accent), and All is not
     * one of those sets — it is their union. A neutral pair keeps it from reading as a
     * fifth band. The accent is the existing `COLORS.card` grey, so it stays inside the
     * app's surface family rather than introducing a new hue.
     */
    All: { main: "#8A8A94", accent: "#D8D8DC" },
} as const;

/**
 * The two-tone tile palette for each mastery bar's Mastered collection (the fdp's
 * Mastered row, migration 143).
 *
 * The row used to be three blue tiles, on the reasoning that they are one achievement
 * in three skills. In practice that made three DIFFERENT sets look interchangeable, so
 * each bar now carries its own hue — and the hue is not arbitrary: `reading` and
 * `writing` are single-mark-type bars, so each takes ITS MARK's color from
 * `MARK_TYPE_COLORS`, the same color that mark paints on the cdp track and the
 * mini-card strip. A learner who has learned "red = reading" from the progress bars
 * reads the tile the same way.
 *
 * `core` is the exception, and has to be: it blends recognition (blue) and production
 * (green), so it has no single mark color to borrow and keeps the app's Mastered blue.
 *
 * NOTE the collision this creates on the fdp: reading's red and writing's orange are
 * the Unfamiliar and Target band hues, which sit one section above. The sections are
 * separated and captioned, so the tiles are distinguishable by position — but if the
 * page ever interleaves them, these need to diverge.
 */
export const MASTERY_BAR_COLORS: Record<MasteryBarId, { main: string; accent: string }> = {
    // No mark color to borrow — recognition + production — so it keeps Mastered blue.
    core: { main: BAND_COLORS.Mastered.main, accent: BAND_COLORS.Mastered.accent },
    // Read from MARK_TYPE_COLORS rather than restated, so a mark's color and its
    // Mastered tile cannot drift apart.
    reading: { main: MARK_TYPE_COLORS.reading, accent: "#F2BAC9" },
    writing: { main: MARK_TYPE_COLORS.writing, accent: "#F2E2BA" },
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
