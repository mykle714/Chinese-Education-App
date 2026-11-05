import { LEARNING_HUE, MASTERY_BAR_HUES } from "../../utils/categoryColors";
import { RAMP } from "../../theme/colors";

/**
 * towerDecks.ts — the decks the Deck Tower can stand on its platform
 * (docs/DECK_TOWER_TRANSITIONS.md § "The decks").
 *
 * Layer: page constants (feature module `src/features/deckTower`). Each platform's floor
 * plate toggles THAT platform between the two; the counts come from DeckTowerPage, each
 * platform reading the deck through its own bar (Learning = off-cooldown cards in all four
 * utcm bands, towerModes.ts; Mastered = the bar's Mastered total).
 */
export type TowerDeckId = "learn-now" | "mastered";

export interface TowerDeck {
    /** The page title (the header-voice headline). */
    title: string;
    /** Printed on the floor plate. */
    label: string;
    /**
     * The floor plate's fill (and the CardSplat flyers' strip), the same in every world: the
     * deck's collection hue at its `mid` tier (the pale `surface` tier washes out on the sky).
     * Mastered stays the core bar's blue even in the reading / writing worlds, so the deck
     * reads as one thing wherever the learner is.
     */
    band: string;
    /**
     * The floor plate's wall shading steps (`IsoFloorLabel` `wallSteps`), when the band
     * needs deeper walls than the default `bandMaterial` 0.07 / 0.15. Learning's yellow sits
     * at full saturation, so the default HSL-lightness steps barely change its brightness
     * (#FFE04A / #FFD921 against the #FFE66E face) and the raised plate's edges vanished;
     * its walls go a step deeper (≈ #EEC500 / #B59600 at noon). Mastered's blue reads fine
     * with the default.
     */
    plateWallSteps?: PlateWallSteps;
}

/** How far (HSL lightness, `shadeHex`) a plate's left / right walls are shaded below its band. */
export interface PlateWallSteps {
    left: number;
    right: number;
}

export const TOWER_DECKS: Record<TowerDeckId, TowerDeck> = {
    "learn-now": {
        title: "Learning", label: "LEARNING", band: RAMP[LEARNING_HUE].mid,
        plateWallSteps: { left: 0.25, right: 0.36 },
    },
    // The core bar's Mastered hue (blue) — in every world, not the world's bar hue.
    mastered: { title: "Mastered", label: "MASTERED", band: RAMP[MASTERY_BAR_HUES.core].mid, },
};

export function otherTowerDeck(id: TowerDeckId): TowerDeckId {
    return id === "learn-now" ? "mastered" : "learn-now";
}
