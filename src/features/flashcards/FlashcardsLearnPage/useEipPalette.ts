import { createContext, useContext, useMemo } from "react";
import { useAuth } from "../../../AuthContext";
import { useDayClock } from "../../../timeOfDay/useDayClock";
import { EIP_DAY_PALETTE, eipPaletteAt, type EipPalette } from "./eipPalette";

/**
 * useEipPalette.ts — the eip's time-of-day palette as React state (eipPalette.ts is the
 * pure half; EipPaletteContext.tsx is the provider that publishes it).
 *
 * Layer: feature hooks (src/features/flashcards).
 *
 *   - `useEipPalette()` — the clock-driven palette. Samples the SHARED day clock
 *     (src/timeOfDay/useDayClock), honouring the feature-tester override exactly as the
 *     Deck Tower does, so an eip open over the tower is always at the tower's hour.
 *   - `useEipColors()` — read the palette published by `EipPaletteProvider`; the day
 *     palette outside one (the cdps' inline panels, which have no sheet and stay day).
 *
 * Depends on: eipPalette.ts, src/timeOfDay/useDayClock.ts, AuthContext. Depended on by:
 * EipPaletteContext.tsx, InfoCardSection, and every eip piece that paints with the palette.
 * Docs: docs/EIP_SHEET_GESTURES.md § Time of day.
 */

export const EipPaletteCtx = createContext<EipPalette>(EIP_DAY_PALETTE);

/** The published eip palette (day outside a provider). */
export const useEipColors = (): EipPalette => useContext(EipPaletteCtx);

/** The eip palette for the learner's time of day right now. */
export function useEipPalette(): EipPalette {
    const { user } = useAuth();
    const { time } = useDayClock(user?.isFeatureTester === true);
    return useMemo(() => eipPaletteAt(time), [time]);
}
