import type { GameCategory, Medal } from "./types";

/**
 * Match Speed — tunable constants.
 *
 * Everything here is meant to be adjusted while balancing the game. See
 * docs/MATCH_SPEED_GAME.md, whose Constants table mirrors this file.
 */

/** Game key under which Match Speed wins are logged in the shared `wins` table
 *  ({ game, level }), read via useGameWins (src/hooks/useGameWins.ts). Shared with
 *  the Games hub so both read the same win data under the same key. */
export const GAME_KEY = "matchSpeed";

/** The only level this game has (single difficulty), so the only `wins` level key. */
export const WIN_LEVEL = 1;

// ---- Board ----------------------------------------------------------------
/** Rows per column. The board is ROWS × 2 slots — ROWS foreign, ROWS english. */
export const ROWS = 5;

/**
 * Card aspect ratio, WIDTH ÷ HEIGHT — every card is locked to 2:1 (i.e. 1:2
 * height-to-width). The board measures its own box and derives one card size that
 * satisfies the ratio in BOTH directions, so the ten cards are always identical
 * rectangles no matter how tall or wide the play area is.
 *
 * Locking the ratio is a correctness requirement, not just a style choice: card
 * SHAPE must carry no information. If cards stretched to fill leftover height, a
 * board with 3 pairs left would render taller cards than a full board, and — worse
 * — any per-row variation would leak which pair is which. See
 * docs/MATCH_SPEED_GAME.md § Board model.
 */
export const CARD_ASPECT = 2;
/** Vertical gap between rows, in px (measured layout, so this is a number). */
export const ROW_GAP_PX = 8;
/** Horizontal gap between the two columns, in px. */
export const COL_GAP_PX = 10;

// ---- Run timing (ms) ------------------------------------------------------
/** One minute per run. */
export const RUN_DURATION_MS = 60_000;
/** Board refill cadence. ONE global interval, not a per-slot timer: a pair matched
 *  right after a tick leaves a visible hole for nearly the full interval. That is
 *  intentional — clearing fast means playing a partly-empty board, and it is the
 *  game's only pacing pressure. The medal thresholds are set against it. */
export const REFILL_TICK_MS = 3_000;
/** Upper bound of the random per-card fade-in delay (staggers a refilled batch). */
export const FADE_IN_MAX_DELAY_MS = 500;
/** The fade-in itself. */
export const FADE_IN_DURATION_MS = 260;
/** Green pop before a matched pair is removed (mirrors Bubble Match). */
export const POP_DURATION_MS = 280;
/** Red flash on a wrong attempt. The board STAYS LIVE during it — taps are never
 *  swallowed, so a fast player is never made to wait out their own mistake. */
export const WRONG_FEEDBACK_MS = 400;
/** Per-step duration of the pre-run 3·2·1·Go countdown. */
export const COUNTDOWN_STEP_MS = 700;
/** The countdown steps, in order. The board renders (readable) behind them and the
 *  run clock starts only when the last one clears, so every run begins from the
 *  same state and no time is billed to reading the opening board. */
export const COUNTDOWN_STEPS = ["3", "2", "1", "Go!"];

// ---- Card selection -------------------------------------------------------
/**
 * Per-draw category weights. Each pair drawn for the board rolls INDEPENDENTLY
 * against this table — unlike Bubble Match's GAME_DISTRIBUTION, which requests a
 * fixed mix for a whole run. A Match Speed board can legitimately come up 5
 * Target cards.
 *
 * These are the per-mark-type (recognition) categories, not the goal-blended
 * overall utcm category — see docs/MASTERY_REWORK.md.
 */
export const CATEGORY_WEIGHTS: Record<GameCategory, number> = {
    Unfamiliar: 12,
    Target: 60,
    Comfortable: 20,
    Mastered: 8,
};

/**
 * Order to walk when the rolled category's buffer is empty; the first non-empty
 * one supplies the pair. Mirrors the server's own
 * `OnDeckVocabService.GAME_FALLBACK_ORDER` so client and server degrade the same
 * way. The weights above are NOT re-normalized — every roll happens against the
 * full table and this is purely a "that shelf was bare" recovery.
 */
export const CATEGORY_FALLBACK_ORDER: GameCategory[] = [
    "Target",
    "Comfortable",
    "Unfamiliar",
    "Mastered",
];

/** Target depth of each per-category buffer (4 × 5 = 20 pairs buffered). API
 *  latency is far too high to fetch a card at the moment a slot empties, so the
 *  page keeps this stocked and tops it up after every tick. */
export const BUFFER_DEPTH = 5;

/** Learn Now cards required to play, matching Bubble Match's gate. A 60s run at
 *  gold pace consumes 18+ pairs, so below this a run would be mostly repeats. */
export const ENTRY_GATE_CARDS = 20;

/** Per-bucket quota for the initial pool request (`?Unfamiliar=5&Target=5&…`). */
export const POOL_QUERY = (Object.keys(CATEGORY_WEIGHTS) as GameCategory[])
    .map((cat) => `${encodeURIComponent(cat)}=${BUFFER_DEPTH}`)
    .join("&");

// ---- Scoring --------------------------------------------------------------
/**
 * Medal thresholds by pairs matched in 60s, best-first.
 *
 * Unlike Word Search's `medalForTime` — whose bronze row is `maxSeconds: Infinity`
 * and is therefore ALWAYS awarded — this table has a genuine no-medal tier, so
 * `medalForScore` returns null below the bronze line. Same ordered-table shape,
 * different floor.
 */
export const MEDAL_THRESHOLDS: { medal: Medal; minPairs: number; emoji: string }[] = [
    { medal: "gold", minPairs: 18, emoji: "🥇" }, // ~3.3s/pair
    { medal: "silver", minPairs: 12, emoji: "🥈" }, // ~5.0s/pair
    { medal: "bronze", minPairs: 6, emoji: "🥉" }, // ~10s/pair
];

/** Resolve a final score (pairs matched) to its medal tier, or null for 0–5 pairs. */
export function medalForScore(score: number): { medal: Medal; emoji: string } | null {
    const tier = MEDAL_THRESHOLDS.find((t) => score >= t.minPairs);
    return tier ? { medal: tier.medal, emoji: tier.emoji } : null;
}

// ---- Gloss fitting --------------------------------------------------------
// The english card scales its font down as the gloss gets longer, between this
// character band (measured AFTER stripParentheses), then clamps to 3 lines. Row
// height must stay fixed and equal across all 5 rows — a taller row would leak
// which pair is which — so overflow is absorbed by size, then by ellipsis.
// Same length→size idea Bubble Match applies to bubble radius.
export const DEF_LEN_MIN = 10;
export const DEF_LEN_MAX = 46;
export const DEF_FONT_MAX_PX = 19;
export const DEF_FONT_MIN_PX = 13;
/** Hard cap on rendered gloss lines (CSS line-clamp). */
export const DEF_MAX_LINES = 3;

// ---- Palette --------------------------------------------------------------
// Kept local and deliberately harmonized with Bubble Match's bubble palette so
// the two games teach the same visual vocabulary: blue = the foreign word,
// warm = its english meaning, green = correct, red = wrong.
export const FOREIGN_CARD_BG = "#EAF1FF";
export const FOREIGN_CARD_BORDER = "#B9CDF5";
export const ENGLISH_CARD_BG = "#FFF3E6";
export const ENGLISH_CARD_BORDER = "#F2D2A8";
/** Selected card outline (both columns). */
export const SELECTED_BORDER = "#3D6BD6";
/** Correct-match pop AND the cleanup-mode partner hint — the same light green
 *  Bubble Match uses for both (CORRECT_BUBBLE_BG). */
export const CORRECT_CARD_BG = "#A5D6A7";
export const CORRECT_CARD_BORDER = "#7BB97F";
/** Wrong-attempt flash. */
export const WRONG_CARD_BG = "#F44336";
