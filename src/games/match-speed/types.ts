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

/**
 * Difficulty mode, chosen on the Games hub (one sub-card per mode) and carried
 * into the page via nav `state.mode`.
 *
 * The buckets each mode may draw from mirror the /decks study buttons exactly
 * (FlashcardsDecksPage.tsx): Review = Comfortable + Mastered, Challenge = Unfamiliar
 * + Target, Study Mix = everything. See docs/MATCH_SPEED_GAME.md § Difficulty modes.
 */
export type MatchSpeedMode = "mixed" | "review" | "challenge";

/**
 * Everything that differs between the three modes. One frozen entry per mode
 * lives in `constants.ts` (MODE_CONFIGS) and is threaded through the pure buffer
 * module, so no code below the page branches on the mode name itself.
 */
export interface ModeConfig {
    mode: MatchSpeedMode;
    /** Sub-card subtitle on the Games hub ("Study Mix" / "Review" / "Challenge"). */
    label: string;
    /** Level key this mode's wins are logged under in the shared `wins` table.
     *  Study Mix is 1 — the key single-difficulty Match Speed already used — so the
     *  existing win history stays attached to the default mode. */
    winLevel: number;
    /** Buckets this mode may draw from. A hard restriction, not a preference:
     *  an off-mode card is dropped on arrival (see `fillBuffer`). */
    categories: GameCategory[];
    /** Per-draw weights over `categories` (see CATEGORY_WEIGHTS' doc comment). */
    weights: Record<GameCategory, number>;
    /** Walk order when the rolled bucket is empty; restricted to `categories`. */
    fallbackOrder: GameCategory[];
    /** Target depth of EACH in-mode bucket, sized so total buffered pairs stay
     *  ~BUFFER_TOTAL_TARGET regardless of how many buckets the mode uses. */
    bufferDepth: number;
    /** `?Comfortable=10&Mastered=10` — the initial pool request's bucket quotas. */
    poolQuery: string;
    /** Human phrase naming the buckets, for the "you have none of these" block
     *  message (e.g. "Comfortable or Mastered"). */
    categoryLabel: string;
}

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
     * ms delay applied to this card's fade-in, randomized per CARD (not per pair)
     * in [0, FADE_IN_MAX_DELAY_MS] so a refilled batch staggers in rather than
     * appearing as one block — and so partners never fade in together, which
     * would visually give away the match.
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
 *   loading ─► blocked        (signed out / fetch failed — NEVER on card count,
 *                              see docs/PROVISIONAL_CARDS.md)
 *      │
 *      └─────► countdown ─(3·2·1)─► playing ─(30s)─► ended
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
