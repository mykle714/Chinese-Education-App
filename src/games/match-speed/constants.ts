import { COLORS } from "../../theme/colors";
import type { MarkType } from "../../types";
import type { GameCategory, MatchSpeedMode, Medal, ModeConfig } from "./types";

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

/**
 * The mastery track this game feeds (docs/MASTERY_REWORK.md). Matching a foreign
 * word to its meaning is recognition, so every mode writes RECOGNITION marks and
 * pools on that track — the mode only changes WHICH cards are dealt, never the
 * mark type, so this is a whole-game constant rather than a per-ModeConfig field.
 *
 * Single source of truth for the `?markType=` pool query and the
 * /api/flashcards/mark call (MatchSpeedPage) plus the Games hub's mark-type chip
 * (via GAME_REGISTRY's `markType`).
 */
export const MARK_TYPE: MarkType = "recognition";

// The `wins` level key per difficulty mode lives on each MODE_CONFIGS entry
// (`winLevel`) — Study Mix keeps 1, the key the game used back when it had a single
// difficulty, so pre-existing win history stays attached to the default mode.

// ---- Board ----------------------------------------------------------------
/** Rows per column. The board is ROWS × 2 slots — ROWS foreign, ROWS english. */
export const ROWS = 5;

/**
 * Card aspect ratio, WIDTH ÷ HEIGHT — every card is locked to 2.4:1. The board
 * measures its own box and derives one card size that satisfies the ratio in BOTH
 * directions, so the ten cards are always identical rectangles no matter how tall
 * or wide the play area is.
 *
 * This is ALSO the height dial: on a phone the board is width-limited, so raising
 * the ratio makes every card shorter (the column keeps its width and the grid
 * centers in the freed vertical slack). Lower it to make the cards taller again.
 * It is deliberately held at 2.4 across the ROWS 6 → 5 change: on a width-limited
 * board the card height depends ONLY on this ratio, so dropping a row removes a
 * pair without resizing the remaining cells — the grid just centers in more slack.
 *
 * Locking the ratio is a correctness requirement, not just a style choice: card
 * SHAPE must carry no information. If cards stretched to fill leftover height, a
 * board with 3 pairs left would render taller cards than a full board, and — worse
 * — any per-row variation would leak which pair is which. See
 * docs/MATCH_SPEED_GAME.md § Board model.
 */
export const CARD_ASPECT = 2.4;
/** Vertical gap between rows, in px (measured layout, so this is a number). */
export const ROW_GAP_PX = 8;
/** Horizontal gap between the two columns, in px. Equal to ROW_GAP_PX because the
 *  design's `.msg2` grid uses one gap on both axes — an uneven pair reads as a
 *  measurement mistake at this size. */
export const COL_GAP_PX = 8;

// ---- Run timing (ms) ------------------------------------------------------
/** Thirty seconds per run. Short on purpose: the drill is a throughput sprint,
 *  and the medal thresholds below are stated against THIS number — changing one
 *  without the other silently re-tunes the whole scoring curve. */
export const RUN_DURATION_MS = 30_000;
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
/** Lifetime of the "Board Cleared!" banner (pop, hold, drift up, fade). Kept well
 *  under REFILL_TICK_MS so it is gone — or nearly — by the time the replacement
 *  cards fade in underneath it. Scores nothing; see MatchSpeedClearBanner.tsx. */
export const CLEAR_BANNER_MS = 1_400;
/** Per-step duration of the pre-run 3·2·1·Go countdown. */
export const COUNTDOWN_STEP_MS = 700;
/** The countdown steps, in order. The board renders (readable) behind them and the
 *  run clock starts only when the last one clears, so every run begins from the
 *  same state and no time is billed to reading the opening board. */
export const COUNTDOWN_STEPS = ["3", "2", "1", "Go!"];

// ---- Card selection -------------------------------------------------------
/**
 * Per-draw category weights for the STUDY MIX mode (the game's original, unrestricted
 * table). Each pair drawn for the board rolls INDEPENDENTLY against it — unlike
 * Bubble Match's GAME_DISTRIBUTION, which requests a fixed mix for a whole run.
 * A Match Speed board can legitimately come up 5 Target cards.
 *
 * Review and Challenge have their own tables on MODE_CONFIGS below; this one is also
 * the shape every mode's `weights` follows (an off-mode bucket weighs 0).
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
 * Order to walk when the rolled category's buffer is empty in STUDY MIX mode; the
 * first non-empty one supplies the pair. Restricted modes carry their own,
 * shorter order on MODE_CONFIGS (an off-mode bucket is never a fallback — that
 * is the whole point of the restriction). Mirrors the server's own
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

/** Total pairs the buffer aims to hold across all of a mode's buckets. Split
 *  evenly over however many buckets the mode uses, so Review/Challenge (2 buckets)
 *  buffer 12 each where Study Mix (4 buckets) buffers 6 each — the board draws the
 *  same number of pairs per tick either way.
 *
 *  Sized so that even Study Mix's per-bucket depth (6) covers a FULL board (ROWS = 5)
 *  on its own: a bucket that can't fill the board by itself makes the fallback
 *  walk fire on an ordinary tick, quietly pulling the run off its weight table. */
export const BUFFER_TOTAL_TARGET = 24;

/** Target depth of each per-category buffer in STUDY MIX mode (4 × 6 = 24 pairs
 *  buffered). API latency is far too high to fetch a card at the moment a slot
 *  empties, so the page keeps this stocked and tops it up after every tick.
 *  Restricted modes derive their own depth — read `ModeConfig.bufferDepth`
 *  rather than this constant in mode-aware code. */
export const BUFFER_DEPTH = BUFFER_TOTAL_TARGET / 4;

// ENTRY_GATE_CARDS was removed: nothing blocks on card count any more. The number
// of cards this game WANTS is now a baseline the server tops the player up to with
// temporary cards — CARD_BASELINES['match-speed'] in server/contracts/wire.ts.
// See docs/PROVISIONAL_CARDS.md.

// ---- Difficulty modes -----------------------------------------------------
/**
 * Build one mode's config from its bucket restriction. `weights` is stated over
 * the mode's OWN buckets and padded with zeros for the rest, so every config
 * carries the full four-key shape and `rollCategory` never indexes undefined.
 *
 * `categories` is stated in the canonical CATEGORY_WEIGHTS key order; the roll
 * walks it in that order, so the order is part of the (tested) contract.
 */
function defineMode(
    mode: MatchSpeedMode,
    label: string,
    winLevel: number,
    categoryLabel: string,
    weights: Partial<Record<GameCategory, number>>,
    fallbackOrder: GameCategory[]
): ModeConfig {
    const categories = (Object.keys(CATEGORY_WEIGHTS) as GameCategory[]).filter(
        (cat) => (weights[cat] ?? 0) > 0
    );
    const bufferDepth = Math.ceil(BUFFER_TOTAL_TARGET / categories.length);
    return {
        mode,
        label,
        winLevel,
        categoryLabel,
        categories,
        weights: {
            Unfamiliar: weights.Unfamiliar ?? 0,
            Target: weights.Target ?? 0,
            Comfortable: weights.Comfortable ?? 0,
            Mastered: weights.Mastered ?? 0,
        },
        fallbackOrder,
        bufferDepth,
        poolQuery: categories
            .map((cat) => `${encodeURIComponent(cat)}=${bufferDepth}`)
            .join("&"),
    };
}

/**
 * The three independently-playable difficulty modes, in HUB ORDER (Study Mix
 * first, then Review, then Challenge — the hub is the only place to pick one;
 * there is no in-game picker). Modes do NOT chain and nothing is unlocked by
 * clearing one.
 *
 * The bucket split is the /decks rule verbatim (FlashcardsDecksPage.tsx):
 * Review = Comfortable + Mastered, Challenge = Unfamiliar + Target. Within a
 * restricted mode the two buckets keep roughly the ratio they have in the Study
 * Mix table (20:8 → 70:30, 12:60 → 20:80), so Challenge still leans on Target
 * and Review still leans on Comfortable rather than flattening to 50/50.
 *
 * Everything else about a run — the 30s clock (RUN_DURATION_MS), the 5×2 board, the 3s refill
 * tick, the medal thresholds — is identical across modes. Difficulty comes only
 * from which cards you are asked to recognize, which is exactly what "Review"
 * and "Challenge" mean on /decks.
 */
export const MODE_CONFIGS: ModeConfig[] = [
    defineMode("mixed", "Study Mix", 1, "Learn Now", CATEGORY_WEIGHTS, CATEGORY_FALLBACK_ORDER),
    defineMode("review", "Review", 2, "Comfortable or Mastered", { Comfortable: 70, Mastered: 30 }, [
        "Comfortable",
        "Mastered",
    ]),
    defineMode("challenge", "Challenge", 3, "Unfamiliar or Target", { Unfamiliar: 20, Target: 80 }, [
        "Target",
        "Unfamiliar",
    ]),
];

/** Mode used when the page is opened without a valid `state.mode` (a direct URL
 *  or a stale link). Unlike Bubble Match — which bounces to the hub when no
 *  level was passed — Match Speed has always been reachable as a plain route, so
 *  it falls back to Study Mix rather than dead-ending. */
export const DEFAULT_MODE_CONFIG: ModeConfig = MODE_CONFIGS[0];

/** Resolve an untrusted nav-state value to a mode config, defaulting to Study Mix.
 *  A stale link carrying the old "easy"/"hard" values resolves to Study Mix. */
export function modeConfigFor(raw: unknown): ModeConfig {
    return MODE_CONFIGS.find((cfg) => cfg.mode === raw) ?? DEFAULT_MODE_CONFIG;
}

// ---- Scoring --------------------------------------------------------------
/**
 * Medal thresholds by pairs matched in 30s, best-first. Halved alongside the run
 * clock (they were 18/12/6 over 60s), so the required PACE is unchanged.
 *
 * Unlike Word Search's `medalForTime` — whose bronze row is `maxSeconds: Infinity`
 * and is therefore ALWAYS awarded — this table has a genuine no-medal tier, so
 * `medalForScore` returns null below the bronze line. Same ordered-table shape,
 * different floor.
 */
export const MEDAL_THRESHOLDS: { medal: Medal; minPairs: number; emoji: string }[] = [
    { medal: "gold", minPairs: 9, emoji: "🥇" }, // ~3.3s/pair
    { medal: "silver", minPairs: 6, emoji: "🥈" }, // ~5.0s/pair
    { medal: "bronze", minPairs: 3, emoji: "🥉" }, // ~10s/pair
];

/** Resolve a final score (pairs matched) to its medal tier, or null for 0–2 pairs. */
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
// Shelf redesign, artboard 14 (docs/SHELF_REDESIGN.md § 14, class `.msc`). The two
// columns USED to be colour-coded — blue for the foreign word, warm for its meaning —
// which spent the board's only strong signal on a distinction the player can already
// see: one column is Chinese, the other is English. The design takes that colour back
// and separates the columns TYPOGRAPHICALLY (cjk 19/700 on the paper ground vs sans
// 13/500 on white), which frees the fills to mean state and only state:
//
//   blu  = the card you have selected      (`.msc.pick`)
//   grn  = matched, or the cleanup partner hint
//   red  = a wrong attempt
//
// Every fill below is a PASTEL carrying ink text, per the redesign's fill rule
// (docs/SHELF_REDESIGN.md § A1) — never saturated ink behind white letters.
export const FOREIGN_CARD_BG = COLORS.background;
export const ENGLISH_CARD_BG = COLORS.white;
/** Both columns rest on the same hairline, so selecting a card cannot change its
 *  border WIDTH and re-wrap a three-line gloss mid-tap. State swaps the colour only. */
export const CARD_BORDER = COLORS.rowBorder;
/** Selected card (`.msc.pick`) — pastel fill, border blended into it. */
export const SELECTED_CARD_BG = COLORS.blu;
/** Correct-match pop AND the cleanup-mode partner hint. */
export const CORRECT_CARD_BG = COLORS.grn;
/** Wrong-attempt flash. Ink-on-pastel like the rest, so the flash reads as the same
 *  system as the other two rather than as an error dialog dropped onto the board. */
export const WRONG_CARD_BG = COLORS.red;
export const WRONG_CARD_INK = COLORS.dangerInk;
