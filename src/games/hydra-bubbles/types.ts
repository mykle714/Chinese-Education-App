import type { VocabEntry } from "../../types";

/**
 * Hydra Bubbles — domain types (docs/HYDRA_BUBBLES.md).
 *
 * Hydra reuses the shared bubble field (`src/games/bubbles/`) and adds one idea
 * of its own: every Chinese bubble carries a COLOR, and that color is a contract
 * with the player about what clearing it will cost or earn (§ 2).
 */

/**
 * A payout color. These are the four utcm band names, reused verbatim rather than
 * renamed, because a Hydra bubble's color must mean the same thing it means on the
 * decks page and the cdp progress bars — the player has already learned this
 * palette (`CATEGORY_COLORS`, src/utils/categoryColors.ts).
 *
 * The band name is the color's IDENTITY, not a claim about the card's mastery: a
 * lent card is colored by its difficulty tier instead, and the two are deliberately
 * allowed to disagree (§ 5).
 */
export type HydraColor = "Unfamiliar" | "Target" | "Comfortable" | "Mastered";

/** The four colors in payout order, lowest first. Iteration order for fallbacks. */
export const HYDRA_COLORS: readonly HydraColor[] = [
    "Unfamiliar",
    "Target",
    "Comfortable",
    "Mastered",
];

/**
 * One card drawn for the board, tagged with the color it will be played at.
 *
 * The tag is assigned when the card LEAVES a color buffer, not read off the card:
 * a provisional card's color comes from the tier it was requested at, and it keeps
 * that color for the whole run (§ 5, docs/PROVISIONAL_CARDS.md § 3c). Carrying it
 * on the drawn card rather than recomputing it is what makes that stable.
 */
export interface HydraCard {
    entry: VocabEntry;
    color: HydraColor;
}

/** How the run ended. There is no win — Hydra is endless (§ 7.1). */
export type HydraOutcome = "wrongMatch" | "overflow" | "challengeComplete";

/** High-level phase the page renders against. */
export type HydraPhase = "loading" | "blocked" | "playing" | "over";
