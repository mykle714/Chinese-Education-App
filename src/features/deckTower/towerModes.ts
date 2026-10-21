import { RAMP } from "../../theme/colors";

/**
 * towerModes.ts — the two positions of the Deck Tower's Mix / Review switch
 * (docs/DECK_TOWER.md § "Mix / Review switch").
 *
 * Layer: page constants (feature module `src/features/deckTower`). The switch is a floor
 * fixture on each world's platform (IsoModeSwitch) and only acts on its LEARN NOW deck (the
 * off-cooldown cards); while the Mastered deck is up it is sunk out of sight. Its bands are the flp's own study modes
 * (server/contracts/studyMode.ts): Mix = all four utcm bands, Review = Comfortable +
 * Mastered.
 */
export type TowerModeId = "mix" | "review";

export interface TowerMode {
    /** Printed on the switch's label plate. */
    label: string;
    /** The label plate's band: the flp study hand's hue for the same mode (FlpStudyHand.tsx → HAND_HUES), at its `mid` tier. */
    band: string;
    /** The bands of off-cooldown cards the Learn Now tower stands in this mode. */
    bands: readonly string[];
}

export const TOWER_MODES: Record<TowerModeId, TowerMode> = {
    mix: { label: "MIX", band: RAMP.yel.mid, bands: ["Unfamiliar", "Target", "Comfortable", "Mastered"] },
    review: { label: "REVIEW", band: RAMP.blu.mid, bands: ["Comfortable", "Mastered"] },
};

export function otherTowerMode(id: TowerModeId): TowerModeId {
    return id === "mix" ? "review" : "mix";
}

/** Off-cooldown cards of `bands` in a band-keyed count record (useFlpReadyCounts' shape). */
export function bandTotal(counts: Record<string, number>, bands: readonly string[]): number {
    return bands.reduce((sum, band) => sum + (counts[band] || 0), 0);
}
