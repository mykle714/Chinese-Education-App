import { createContext, useContext } from "react";
import { useTheme as useAppTheme } from "../../../contexts/ThemeContext";
import { EIP_LIGHT_PALETTE, eipPaletteFor, type EipPalette } from "./eipPalette";

/**
 * useEipPalette.ts — the eip's theme palette as React state (eipPalette.ts is the pure
 * half; EipPaletteContext.tsx is the provider that publishes it).
 *
 * Layer: feature hooks (src/features/flashcards).
 *
 *   - `useEipPalette()` — the palette for the app's colour theme (Settings → Theme,
 *     `ThemeMode` in src/contexts/ThemeContext.tsx): dark for Dark, light for the rest.
 *     Not the time of day — the eip stopped following the clock on 2026-11-05.
 *   - `useEipColors()` — read the palette published by `EipPaletteProvider`; the light
 *     palette outside one.
 *
 * Depends on: eipPalette.ts, contexts/ThemeContext.tsx. Depended on by:
 * EipPaletteContext.tsx, InfoCardSection, DictionaryCardDetailPage, and every eip piece
 * that paints with the palette.
 * Docs: docs/EIP_SHEET_GESTURES.md § "Light / dark theme".
 */

export const EipPaletteCtx = createContext<EipPalette>(EIP_LIGHT_PALETTE);

/** The published eip palette (light outside a provider). */
export const useEipColors = (): EipPalette => useContext(EipPaletteCtx);

/** The eip palette for the app's current colour theme. Stable per theme (module constants). */
export function useEipPalette(): EipPalette {
    return eipPaletteFor(useAppTheme().themeMode);
}
