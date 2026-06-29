// Resolve a per-card flashcard text-color override (vet."textColors", migration 89) to a
// concrete CSS color. See docs/CARD_ICON_LAYOUT.md (Contrast tool).
//
// The Contrast menu lets a learner force the foreign-word glyphs and/or the English
// definition to a fixed color, independently. Each side is one of:
//   - 'theme' (default): follow the device/app theme — we return `undefined` so the caller
//     keeps its own theme-aware default (text.primary / flashcard.onSurface).
//   - 'dark': force black.
//   - 'light': force white.

import type { TextColorMode } from "../types";

export const DARK_TEXT_COLOR = "#000000";
export const LIGHT_TEXT_COLOR = "#FFFFFF";

/**
 * Map a text-color setting to a CSS color, or `undefined` for 'theme' (the caller should
 * fall back to its own theme-aware default — which is itself device-theme-driven, so
 * 'theme' resolves to white/black per the active theme).
 */
export function resolveTextColor(mode: TextColorMode | undefined | null): string | undefined {
  if (mode === "dark") return DARK_TEXT_COLOR;
  if (mode === "light") return LIGHT_TEXT_COLOR;
  return undefined; // 'theme' / unset
}
