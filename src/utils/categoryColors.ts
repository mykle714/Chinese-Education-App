// Shared color tokens for a card's progress category (FlashcardCategory) and the
// built-in collections. One source for MiniVocabCard, the cdp's MasteryWindow, the
// Account bucket spines and the fdp collection tiles.
import type { MasteryBarId } from "../../server/contracts/wire";
import { COLORS, RAMP, type RampHue } from "../theme/colors";
// ⚠️ SHELF SYSTEM v2 (docs/SHELF_REDESIGN.md § A1b). Two things moved here:
//   1. TARGET IS YELLOW. Artboard 18 paints the Target band pill `--yelK` and its cells
//      `--yelMk` ("Target yellow"); it used to be the org hue.
//   2. A band now has THREE tiers in use rather than a pastel + an ink:
//        surface  CATEGORY_COLORS / BAND_COLORS.main — spines, big fills
//        mid      BAND_MID                           — pills, chips, avatars
//        mark     BAND_MARK                          — mastery cells, mini-card bars
//      The v1 `BAND_INK` (the ramp's dark `*A` member, used where a shape was too small
//      to carry the pastel's outline ring) is gone with the ink tier: the MARK tier is
//      saturated enough to stand on its own at any size, which is exactly the job the
//      ink was doing.
//
// Text on ANY of these is ink (`COLORS.onSurface`), never white.

/**
 * The hue each band owns. Every value below is DERIVED from it, never written out, so
 * a repaint of the ramp carries the bands with it.
 */
export const BAND_HUES = {
    Unfamiliar: "red",
    Target: "yel",
    Comfortable: "grn",
    Mastered: "blu",
} as const satisfies Record<string, RampHue>;

type Band = keyof typeof BAND_HUES;

/** Build a band→colour map from one tier of the ramp. */
const bandTier = (tier: "surface" | "mid" | "mark"): Record<Band, string> => ({
    Unfamiliar: RAMP[BAND_HUES.Unfamiliar][tier],
    Target: RAMP[BAND_HUES.Target][tier],
    Comfortable: RAMP[BAND_HUES.Comfortable][tier],
    Mastered: RAMP[BAND_HUES.Mastered][tier],
});

/**
 * The band's SURFACE — the large-fill tier. Plus a `default` for an unknown/undefined
 * category: `--grey`, so an unknown category is a colourless shape rather than a fifth
 * band.
 */
export const CATEGORY_COLORS: Record<string, string> = {
    ...bandTier("surface"),
    default: COLORS.grey,
};

/**
 * The band's MID tier — pills and chips. Artboard 18's band pill (`.msb .band3`) is
 * `--{hue}K`, which v2 aliases to `--{hue}M`.
 */
export const BAND_MID: Record<string, string> = bandTier("mid");

/**
 * The band's MARK tier — the fluorescent highlighter a mastery CELL is painted with.
 *
 * "Mastery bars are colored by mastery progress, not by mark type" (user, 2026-09-23):
 * every filled cell of a track takes the track's CURRENT BAND, so a card that is Target
 * on reading shows three yellow cells, whatever mix of mark types filled them. This
 * replaced the v1 split where the cdp coloured cells by MARK TYPE and the mini card by
 * band — the two mastery surfaces now speak one palette.
 *
 * Consumers: `components/mastery/MasteryWindow.tsx` (cdp window) and
 * `components/MiniVocabCard.tsx` (the thumbnail strip, via `getBandMark(…, "small")`).
 */
export const BAND_MARK: Record<string, string> = bandTier("mark");

/**
 * The band's mark for a SMALL shape on a light face — the mini-card strip's 3.5px bars.
 * Identical to BAND_MARK except Target, which takes the deeper `--yelMkD`: the design
 * draws artboard 17's mini bars with it because the full-strength `--yelMk` dissolves
 * into the cream card face at that size.
 */
const BAND_MARK_SMALL: Record<string, string> = { ...BAND_MARK, Target: COLORS.yelMkD };

/**
 * The band's mark colour, falling back to `--greyA` for an unknown/absent category — a
 * neutral rather than a fifth hue, so "no band yet" never reads as a band of its own.
 */
export const getBandMark = (category?: string, size: "cell" | "small" = "cell"): string =>
    (category && (size === "small" ? BAND_MARK_SMALL : BAND_MARK)[category]) || COLORS.greyA;

/**
 * The two-tone pair each band paints a TILE with: `main` the MID-tier body (artboard 5's
 * Account spines are `--{hue}M`) and `accent` the near-white TINT. Separate from
 * CATEGORY_COLORS because a tile needs both tones.
 */
export const BAND_COLORS: Record<string, { main: string; accent: string }> = {
    Unfamiliar: { main: RAMP[BAND_HUES.Unfamiliar].mid, accent: RAMP[BAND_HUES.Unfamiliar].tint },
    Target: { main: RAMP[BAND_HUES.Target].mid, accent: RAMP[BAND_HUES.Target].tint },
    Comfortable: { main: RAMP[BAND_HUES.Comfortable].mid, accent: RAMP[BAND_HUES.Comfortable].tint },
    Mastered: { main: RAMP[BAND_HUES.Mastered].mid, accent: RAMP[BAND_HUES.Mastered].tint },
    /**
     * "All" — the whole library. Deliberately GREY: every other tile colour carries
     * meaning (a band, a mastery bar, a collection), and All is their union, not one of
     * them. The ramp's own neutrals keep it from reading as a fifth band.
     */
    All: { main: COLORS.grey, accent: COLORS.background },
};

/**
 * "Learn Now" — the cards still being learned. A COLLECTION, not a band, drawn on the
 * fdp's LibraryDuo as a SURFACE card (artboard 2: "Surface: … Learn Now").
 *
 * Gold `--yel`, the hue the fdp's Study Mix card carries — Study Mix draws from exactly
 * this set of cards, so the two share a colour on purpose (2026-09-01).
 *
 * ⚠️ OPEN COLLISION (v2): Target is ALSO yellow now. The design resolves it by drawing
 * Learn Now purple (artboard 2's duo is `--pur`); the user kept Learn Now yellow on
 * 2026-09-23 and moved Target to yellow, so yellow means both "Target band" (pills,
 * cells) and "Learn Now / Study Mix" (fdp cards). Tracked in docs/SHELF_REDESIGN.md
 * § A1b; switching is this one constant.
 *
 * The HUE is exported, not only the pair, because a collection tile needs more than
 * two tiers of its colour and a component takes a hue KEY when it does (theme/colors
 * § RAMP).
 */
export const LEARN_NOW_HUE: RampHue = "yel";
export const LEARN_NOW_COLORS = { main: RAMP[LEARN_NOW_HUE].surface, accent: RAMP[LEARN_NOW_HUE].tint } as const;

/**
 * The hue of each mastery bar's Mastered collection (the fdp's Mastered row,
 * migration 143). Each bar carries its own hue so three DIFFERENT sets do not look
 * interchangeable.
 *
 * `reading` and `writing` are single-mark-type bars and keep the hues their skill
 * centers have always carried (reading red, writing orange); `core` blends recognition
 * and production and keeps the Mastered blue.
 *
 * v2 note: since Target moved to yellow, writing's orange no longer doubles as a band
 * hue. Reading's red still equals Unfamiliar's — on the fdp no band tile appears beside
 * it, so the collision is only latent.
 */
export const MASTERY_BAR_HUES: Record<MasteryBarId, RampHue> = {
    core: "blu",
    reading: "red",
    writing: "org",
};

/** The Mastered section is a SURFACE (artboard 2: "Surface: … Mastered section"). */
export const MASTERY_BAR_COLORS: Record<MasteryBarId, { main: string; accent: string }> =
    Object.fromEntries(
        (Object.keys(MASTERY_BAR_HUES) as MasteryBarId[]).map((bar) => {
            const hue = RAMP[MASTERY_BAR_HUES[bar]];
            return [bar, { main: hue.surface, accent: hue.tint }];
        })
    ) as Record<MasteryBarId, { main: string; accent: string }>;

/** Maps a card's progress category to its SURFACE colour, falling back to grey. */
export const getCategoryColor = (category?: string): string =>
    (category && CATEGORY_COLORS[category]) || CATEGORY_COLORS.default;

/** Maps a card's progress category to its MID colour (pills/chips), falling back to grey. */
export const getBandMid = (category?: string): string =>
    (category && BAND_MID[category]) || COLORS.grey;
