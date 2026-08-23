import type { VocabEntry } from "../../types";

/**
 * Hydra Bubbles — domain types (docs/HYDRA_BUBBLES.md).
 *
 * Hydra reuses the shared bubble field (`src/games/bubbles/`) and adds one idea
 * of its own: every Chinese bubble carries a COLOR, and that color is a contract
 * with the player about what clearing it will cost or earn (§ 2). There are exactly
 * TWO of them, one either side of break-even.
 */

/**
 * A payout tier — TWO of them, named for WHAT THEY DO TO THE BOARD.
 *
 * ⚠️ NOT MASTERY NAMES, AND NOT HUE NAMES (2026-08-21). Two earlier spellings were
 * rejected, each for its own reason:
 *
 *   1. The utcm band names ("Unfamiliar" | "Target" | "Comfortable" | "Mastered"),
 *      reused verbatim from the four-color ladder. Collapsing to two tiers killed
 *      that: a tier is now a UNION of two bands (bloom = Mastered + Comfortable,
 *      drain = Target + Unfamiliar), so no band name could label one without lying
 *      about the other half of its contents.
 *   2. Hue names ("red" | "blue", the first two-tier spelling). Those were repainted
 *      charcoal/gold within days of landing to get Hydra off the mastery ramp's hues
 *      entirely — at which point every identifier in the game named a color that
 *      appeared nowhere on screen. A hue name is only ever one palette pass from
 *      being false.
 *
 * `drain` and `bloom` name the CONTRACT instead, which is the one thing that cannot
 * drift: a drain bubble costs the player board space (net −1), a bloom bubble buys it
 * (net +1). Mastery is one of two things that can decide which tier a card lands in —
 * the other is difficulty tier, for a lent card (§ 5) — and the palette is free to
 * change again without touching a single identifier.
 *
 * See BUCKETS_BY_COLOR (constants.ts) for the band → tier mapping, and HYDRA_PALETTE
 * (HydraStage.tsx) for the hues.
 */
export type HydraColor = "drain" | "bloom";

/** Both tiers in payout order, lowest first. Iteration order for fallbacks. */
export const HYDRA_COLORS: readonly HydraColor[] = ["drain", "bloom"];

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
