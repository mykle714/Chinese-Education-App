import { useMemo } from "react";
import { ThemeProvider, createTheme, useTheme } from "@mui/material/styles";
import { CpcdPopupTonesCtx, type CpcdPopupTones } from "../../../components/CpcdPopup";
import type { EipPalette } from "./eipPalette";
import { EipPaletteCtx } from "./useEipPalette";

/**
 * EipPaletteProvider — hands the eip's time-of-day palette (eipPalette.ts) to every part of
 * the panel: SheetPanel's ground, the upper panel's keys and wells, the tab shelf, the
 * cards in the tab body.
 *
 * Layer: feature component (src/features/flashcards).
 *
 * The palette itself comes from `useEipPalette()` (useEipPalette.ts); read it below the
 * provider with `useEipColors()`.
 *
 *   - `EipPaletteProvider` — publishes a palette AND, when its ink is light (night),
 *     re-themes the subtree: the flashcard palette's text/border tokens are swapped for
 *     the palette's, so every component inside that already reads
 *     `theme.palette.flashcard.*` (cpcd rows, the dd, synonyms, compare…) turns light-on-
 *     dark without knowing about the time of day. Components that read `COLORS.*`
 *     directly do NOT follow — see docs/EIP_SHEET_GESTURES.md § Time of day for the list.
 *
 * Depends on: useEipPalette.ts. Depended on by: InfoCardSection.tsx. Docs: docs/EIP_SHEET_GESTURES.md § Time of day.
 */

export const EipPaletteProvider: React.FC<{ palette: EipPalette; children: React.ReactNode }> = ({ palette, children }) => {
    const outer = useTheme();
    // Only a DARK palette re-themes: by day the app's own flashcard tokens are already
    // right, and an identical nested theme would just cost a context re-render.
    const theme = useMemo(() => {
        if (!palette.dark) return null;
        const fc = outer.palette.flashcard;
        return createTheme(outer, {
            palette: {
                text: { primary: palette.ink, secondary: palette.muted },
                flashcard: {
                    ...fc,
                    onSurface: palette.ink,
                    dd: palette.ink2,
                    textSecondary: palette.muted,
                    border: palette.line,
                    tabUnderline: palette.ink,
                    subtleBg: "rgba(255, 255, 255, 0.05)",
                    audioBtn: "rgba(255, 255, 255, 0.08)",
                },
            },
        });
    }, [outer, palette]);
    // CpcdPopup paints from these rather than the theme: its fill is not a flashcard token.
    const popupTones = useMemo<CpcdPopupTones | null>(() => palette.dark ? {
        surface: palette.card,
        pressed: palette.shelf,
        outline: palette.line,
        ink: palette.ink,
        muted: palette.muted,
    } : null, [palette]);
    const content = (
        <EipPaletteCtx.Provider value={palette}>
            <CpcdPopupTonesCtx.Provider value={popupTones}>{children}</CpcdPopupTonesCtx.Provider>
        </EipPaletteCtx.Provider>
    );
    return theme ? <ThemeProvider theme={theme}>{content}</ThemeProvider> : content;
};
