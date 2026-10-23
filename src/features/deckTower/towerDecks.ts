import { LEARN_NOW_HUE, MASTERY_BAR_HUES } from "../../utils/categoryColors";
import { RAMP } from "../../theme/colors";

/**
 * towerDecks.ts — the decks the Deck Tower can stand on its platform
 * (docs/DECK_TOWER_TRANSITIONS.md § "The decks").
 *
 * Layer: page constants (feature module `src/features/deckTower`). Each platform's floor
 * plate toggles THAT platform between the two; the counts come from DeckTowerPage, each
 * platform reading the deck through its own bar (Learn Now = off-cooldown cards in all four
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
     * deck's fdp hue at its `mid` tier (the pale `surface` tier the fdp card uses washes out).
     * Mastered stays the core bar's blue even in the reading / writing worlds, so the deck
     * reads as one thing wherever the learner is.
     */
    band: string;
}

export const TOWER_DECKS: Record<TowerDeckId, TowerDeck> = {
    "learn-now": { title: "Learn Now", label: "LEARN NOW", band: RAMP[LEARN_NOW_HUE].mid },
    // The fdp's Mastered row's hue (the core bar's blue) — in every world, not the world's bar hue.
    mastered: { title: "Mastered", label: "MASTERED", band: RAMP[MASTERY_BAR_HUES.core].mid },
};

export function otherTowerDeck(id: TowerDeckId): TowerDeckId {
    return id === "learn-now" ? "mastered" : "learn-now";
}
