/**
 * towerModes.ts — the study mode the Deck Tower's Learning deck stands in
 * (docs/DECK_TOWER.md § "Decks and modes").
 *
 * Layer: page constants (feature module `src/features/deckTower`). Only one mode exists:
 * Mix, all four utcm bands — the flp's Study Mix, the only loop it deals — counting
 * off-cooldown cards only. A Mix / Review floor switch (IsoModeSwitch, deleted 2026-11-08) used to flip each
 * world between Mix and Review; it was dropped 2026-10-22, and the Review / Challenge flp
 * modes themselves were removed 2026-11-04 (docs/DEFERRED_WORK.md § 31). The record stays
 * keyed by mode so `TOWER_MODES.mix.bands` reads as what it is.
 *
 * Depended on by: DeckTowerPage.tsx (`learningCount`), useFocusLever.tsx (`readyTotal`);
 * CLAUDE.md § "Terminology: Learning cards".
 */
export type TowerModeId = "mix";

export interface TowerMode {
    /** The bands of off-cooldown cards the Learning tower stands in this mode. */
    bands: readonly string[];
}

export const TOWER_MODES: Record<TowerModeId, TowerMode> = {
    mix: { bands: ["Unfamiliar", "Target", "Comfortable", "Mastered"] },
};

/** Off-cooldown cards of `bands` in a band-keyed count record (useFlpReadyCounts' shape). */
export function bandTotal(counts: Record<string, number>, bands: readonly string[]): number {
    return bands.reduce((sum, band) => sum + (counts[band] || 0), 0);
}
