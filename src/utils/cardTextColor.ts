// Resolve a per-card flashcard text-color override (vet."textColors", migration 89) to a
// concrete CSS color. See docs/CARD_ICON_LAYOUT.md (Contrast tool).
//
// The Contrast menu lets a learner force the foreign-word glyphs and/or the English
// definition to a fixed color, independently. Each side is one of:
//   - 'theme' (default): follow the device/app theme — we return `undefined` so the caller
//     keeps its own theme-aware default (text.primary / flashcard.onSurface).
//   - 'dark': force the dark tone.
//   - 'light': force the light tone.
//
// 'dark'/'light' name a TONE, not a literal color — which two colors those tones map to is
// a property of the surface being colored. The foreign glyphs use the default black/white
// pair; the dd uses its own softer pair (see DD_TONES below), so a learner who forces "dark"
// on the definition gets the dd's dark grey rather than pure black.

import type { TextColorMode } from "../types";

/** The two concrete colors a 'dark'/'light' Contrast pick resolves to on a given surface. */
export interface TextTonePair {
  dark: string;
  light: string;
}

export const DARK_TEXT_COLOR = "#000000";
export const LIGHT_TEXT_COLOR = "#FFFFFF";

/** Default pair — pure black/white. Used by the foreign-word glyphs. */
export const DEFAULT_TEXT_TONES: TextTonePair = {
  dark: DARK_TEXT_COLOR,
  light: LIGHT_TEXT_COLOR,
};

/**
 * dd tones (flp card faces + the eip header gloss), all languages. The English gloss is
 * supporting text next to the headword, so it sits one step off full contrast in whichever
 * direction the surface runs — dark grey on a light card, muted light grey on a dark one.
 * Mirrored by the `flashcard.dd` theme token (src/contexts/ThemeContext.tsx), which picks one
 * of these two per card theme for the 'theme' (unset) case; keep the two in sync.
 */
export const DD_TONES: TextTonePair = {
  dark: "#5A5A60",
  light: "#b8b8bc",
};

/**
 * Map a text-color setting to a CSS color, or `undefined` for 'theme' (the caller should
 * fall back to its own theme-aware default — which is itself device-theme-driven, so
 * 'theme' resolves to the light/dark tone per the active theme).
 *
 * @param tones which concrete pair the 'dark'/'light' tones resolve to; defaults to
 *              black/white.
 */
export function resolveTextColor(
  mode: TextColorMode | undefined | null,
  tones: TextTonePair = DEFAULT_TEXT_TONES,
): string | undefined {
  if (mode === "dark") return tones.dark;
  if (mode === "light") return tones.light;
  return undefined; // 'theme' / unset
}
