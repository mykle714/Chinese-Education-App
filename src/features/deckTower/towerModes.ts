import { RAMP } from "../../theme/colors";

/**
 * towerModes.ts — the study mode the Deck Tower's Learn Now deck stands in
 * (docs/DECK_TOWER.md § "Decks and modes").
 *
 * Layer: page constants (feature module `src/features/deckTower`). Only one mode today:
 * Mix, all four utcm bands — the flp's own Study Mix (server/contracts/studyMode.ts),
 * counting off-cooldown cards only. A Mix / Review floor switch (IsoModeSwitch) used to
 * flip each world between Mix and Review (Comfortable + Mastered); it was dropped
 * 2026-10-22. The record is kept keyed by mode so a mode toggle can come back: `label` and
 * `band` are what such a switch would print and paint.
 *
 * Depended on by: DeckTowerPage.tsx (`learnNowCount`), useFocusLever.tsx (`readyTotal`).
 */
export type TowerModeId = "mix";

export interface TowerMode {
    /** The mode's name, as a switch's label plate would print it. */
    label: string;
    /** The mode's band: the flp study hand's hue for the same mode (FlpStudyHand.tsx → HAND_HUES), at its `mid` tier. */
    band: string;
    /** The bands of off-cooldown cards the Learn Now tower stands in this mode. */
    bands: readonly string[];
}

export const TOWER_MODES: Record<TowerModeId, TowerMode> = {
    mix: { label: "MIX", band: RAMP.yel.mid, bands: ["Unfamiliar", "Target", "Comfortable", "Mastered"] },
};

/** Off-cooldown cards of `bands` in a band-keyed count record (useFlpReadyCounts' shape). */
export function bandTotal(counts: Record<string, number>, bands: readonly string[]): number {
    return bands.reduce((sum, band) => sum + (counts[band] || 0), 0);
}
