// Per-card flashcard BACKGROUND fill (vet."cardColor", migration 94). See
// docs/CARD_ICON_LAYOUT.md (the fie "card" menu — formerly "contrast").
//
// The advanced editor's "card" menu lets a learner tint the whole flashcard face (both
// sides) and its mini thumbnails with one of the swatches below. The value is stored as a
// raw CSS hex string so the render path applies it directly with no key lookup; `null` =
// the **auto** option = no override → the card follows the active theme's default face
// color. `auto` is offered as a distinct chip (the red no-fill glyph) from the explicit
// `grey` fill, which pins the light-theme grey regardless of theme.
//
// This is the single source of truth for the offered palette — the toolbar swatch row,
// the server's allow-list, and the render fallback all trace back here (the server keeps
// its own copy of the hex set, kept in sync by hand). Built from design tokens (COLORS)
// rather than inline hex so the swatches stay re-themeable.

import { COLORS } from "../theme/colors";

export interface CardColorOption {
    /** User-facing swatch label (lowercased in the UI; also the hover tooltip). */
    label: string;
    /** Stored value — a CSS hex string, or `null` for the auto/theme default (no override). */
    value: string | null;
    /** The color painted in the swatch chip. Ignored for the `auto` chip, which renders the
     * red "no-fill" (prohibition) glyph instead of a color. */
    swatch: string;
    /** The auto/theme-default option (`value: null`) — rendered as the red circle-with-slash
     * "no override" indicator rather than a color chip. Exactly one option sets this. */
    auto?: boolean;
}

/**
 * The card-fill swatches, in display order — the toolbar lays them out in TWO rows of five:
 * row 1 the neutrals (**auto** / grey / beige / white / black), row 2 the pastel hues (red /
 * green / blue / yellow / purple). **auto** (`value: null`, follow-theme, no override) is shown
 * as the red no-fill glyph; every other option is an explicit fill that overrides the theme on
 * every surface. `grey` is the explicit light-theme face color (distinct from `auto`, which
 * merely follows whatever the theme is). White/black are plain literals (not theme tokens —
 * they carry no theme meaning here).
 */
export const CARD_COLOR_OPTIONS: CardColorOption[] = [
    // Row 1 (neutrals): auto / grey / beige / white / black.
    { label: "auto", value: null, swatch: "transparent", auto: true },
    { label: "grey", value: COLORS.card, swatch: COLORS.card },
    { label: "beige", value: COLORS.cardBeige, swatch: COLORS.cardBeige },
    { label: "white", value: "#FFFFFF", swatch: "#FFFFFF" },
    { label: "black", value: "#000000", swatch: "#000000" },
    // Row 2 (pastel hues): red / green / blue / yellow / purple.
    { label: "red", value: COLORS.redAccent, swatch: COLORS.redAccent },
    { label: "green", value: COLORS.greenAccent, swatch: COLORS.greenAccent },
    { label: "blue", value: COLORS.blueAccent, swatch: COLORS.blueAccent },
    { label: "yellow", value: COLORS.yellowAccent, swatch: COLORS.yellowAccent },
    { label: "purple", value: COLORS.purpleAccent, swatch: COLORS.purpleAccent },
];

/**
 * Resolve a saved cardColor to a concrete CSS fill, or `undefined` for the theme default
 * (so the caller keeps its own theme-aware background — flashcard.flashCard / COLORS.card).
 * An unrecognized stored value falls through to `undefined` (treated as the default).
 */
export function resolveCardColor(value: string | null | undefined): string | undefined {
    if (!value) return undefined;
    return CARD_COLOR_OPTIONS.some((o) => o.value === value) ? value : undefined;
}
