import type { VocabEntry } from "../../types";

/**
 * Match Speed — shared types.
 *
 * See docs/MATCH_SPEED_GAME.md § Board model. The board is modeled as two fixed
 * SLOT ARRAYS (not a list of live cards) so a matched pair leaves a hole that the
 * next refill tick drops a new card into, while every surviving card keeps its
 * row — and, just as importantly, its React key, so its DOM node is never
 * re-created mid-tap.
 */

/** Which column a card belongs to. Left = the foreign word, right = its gloss. */
export type CardSide = "foreign" | "english";

/**
 * The four game-pool buckets, in the per-mark-type sense the pool endpoint
 * selects on (recognition, for this game) — NOT the goal-blended overall utcm
 * category. See docs/MASTERY_REWORK.md § "Games select by their own mark type".
 */
export type GameCategory = "Unfamiliar" | "Target" | "Comfortable" | "Mastered";

/** One card sitting in a board slot. */
export interface BoardCard {
    /** Stable id for React keys + animation identity (`${pairId}-${side}`). */
    id: string;
    /** Both members of a pair share this; a match is `a.pairId === b.pairId`. */
    pairId: string;
    side: CardSide;
    /** The vocab entry both sides render from (word on the left, gloss on the right). */
    entry: VocabEntry;
    /**
     * ms delay applied to this card's fade-in, randomized in
     * [0, FADE_IN_MAX_DELAY_MS] so a batch of 4 refilled cards staggers in
     * rather than appearing as one block.
     */
    fadeDelayMs: number;
    /** True from the moment a correct match lands until the pop finishes and the
     *  card is removed; drives the pop animation. */
    exiting: boolean;
}

/** A board position: either holds a card or is empty, awaiting the next refill tick. */
export type Slot = BoardCard | null;

/** A pair drawn from the pool, still unplaced. Held in the card buffer. */
export interface CardPair {
    pairId: string;
    entry: VocabEntry;
    /** Bucket the server drew it from (`gameCategory`), i.e. which buffer it lives in. */
    category: GameCategory;
}

/**
 * Run phase. `cleanup` is deliberately NOT a value here — it is derived as
 * `phase === "ended" && popupMinimized`, mirroring how Bubble Match derives
 * `cleanupMode`, so the two can never disagree.
 *
 *   loading ─► blocked        (signed out / < ENTRY_GATE_CARDS cards / fetch failed)
 *      │
 *      └─────► countdown ─(3·2·1)─► playing ─(60s)─► ended
 *                  ▲                                   │
 *                  └────────── Play Again ─────────────┘
 */
export type Phase = "loading" | "blocked" | "countdown" | "playing" | "ended";

/** Medal tier for a finished run. `null` is a real outcome — see MEDAL_THRESHOLDS. */
export type Medal = "gold" | "silver" | "bronze";

/** Per-card visual state, resolved by the board and rendered by MatchSpeedCard. */
export type CardVisualState =
    | "idle"
    | "selected"
    /** Red flash on a wrong attempt; the board stays live throughout. */
    | "wrong"
    /** Cleanup-mode only: "this is the partner of the card you tapped". */
    | "partner-hint";
