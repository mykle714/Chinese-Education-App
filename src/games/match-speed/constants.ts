import { COLORS, type RampHue } from "../../theme/colors";
import type { MarkType } from "../../types";
import type { GameCategory } from "./types";
import { formatTimeMs } from "../../utils/timeUtils";
import { gradeAccuracy, gradeSpeed, type AccuracyTierLadder, type RunTiers, type SpeedTierLadder } from "../shared/runTiers";

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
 * word to its meaning is recognition, so every run writes RECOGNITION marks and
 * pools on that track (an flp break on the reading flp overrides it with `reading`).
 *
 * Single source of truth for the `?markType=` pool query and the
 * /api/flashcards/mark call (MatchSpeedPage) plus the Games hub's mark-type chip
 * (via GAME_REGISTRY's `markType`).
 */
export const MARK_TYPE: MarkType = "recognition";

/** Level key a gold run is logged under in the shared `wins` table. 1 is the key the
 *  game has always used for its one difficulty (the deleted Review/Challenge modes
 *  logged 2 and 3 — docs/DEFERRED_WORK.md § 31), so the win history stays attached. */
export const WIN_LEVEL = 1;
/** The personal-best `mode` key (`usePersonalBest("match-speed-30", …)`). "mixed" is the
 *  Study Mix slug every existing best was recorded under; it stays so they still count. */
export const PERSONAL_BEST_MODE = "mixed";

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
/** The same lock, in an flp break's full-screen board (MatchSpeedStage → `cardAspect`). */
export const BREAK_CARD_ASPECT = 2;
/**
 * How much of the fitted size a break's cards take. Both sides scale, so the ratio holds; a
 * phone's board is width-limited, so this is what shortens them (CARD_ASPECT stays at 2:1).
 */
export const BREAK_CARD_SCALE = 0.92;
/**
 * A card is a 2-state key, on EipAddKey's Add ⇄ Added! numbers (MatchSpeedCard → `cardKeySx`):
 * raised on a 5px lip, or picked and left down on a 2px lip. Held, either one bottoms out
 * with no lip. Its foot lands 4px below the cell in all three, so only the face moves, and
 * that foot stays inside ROW_GAP_PX and the board's padding.
 */
export const CARD_KEY = {
    raised: { lip: 5, y: -1 },
    picked: { lip: 2, y: 2 },
    sinkY: 4,
} as const;
/** Horizontal gap between the two columns, in px (measured layout, so this is a number). */
export const COL_GAP_PX = 8;
/**
 * Gap between the row CELLS, in px, set so the gap the eye sees between rows equals
 * COL_GAP_PX: the design's `.msg2` grid uses one gap on both axes, and an uneven pair reads as
 * a measurement mistake at this size. The lip adds the difference: a raised key's foot hangs
 * 4px below its cell and the next face rises 1px above its own, `raised.lip` in all.
 */
export const ROW_GAP_PX = COL_GAP_PX + CARD_KEY.raised.lip;

// ---- Run timing (ms) ------------------------------------------------------
/** Pairs in one run: the run ends when the player has matched this many, and the
 *  clock counts UP to that moment. The whole run deals exactly this many pairs, so the
 *  board stops refilling once they are all dealt and simply drains. The medal
 *  thresholds below are stated against THIS number — changing one without the other
 *  silently re-tunes the whole scoring curve. So is the challenge grace period
 *  (`CHALLENGE_GAMES`, server/contracts/wire.ts). */
export const TARGET_PAIRS = 30;
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
// The pre-run countdown's steps and timing are shared by every game:
// src/games/shared/GameCountdown.tsx → COUNTDOWN_STEPS, COUNTDOWN_STEP_MS.

// ---- Card selection -------------------------------------------------------
/**
 * Per-draw category weights (the "Study Mix" table — the game's only one since the
 * Review/Challenge modes were removed, docs/DEFERRED_WORK.md § 31). Each pair drawn for
 * the board rolls INDEPENDENTLY against it — unlike Bubble Match's GAME_DISTRIBUTION,
 * which requests a fixed mix for a whole run. A Match Speed board can legitimately come
 * up 5 Target cards. The key order is the roll's walk order (`rollCategory`).
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
 * Order to walk when the rolled category's buffer is empty; the first non-empty one
 * supplies the pair. Mirrors the server's own
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

/** Total pairs the buffer aims to hold across all four buckets, split evenly into
 *  BUFFER_DEPTH per bucket. */
export const BUFFER_TOTAL_TARGET = 24;

/** Target depth of each per-category buffer (4 × 6 = 24 pairs buffered). API latency
 *  is far too high to fetch a card at the moment a slot empties, so the stage keeps
 *  this stocked and tops it up after every tick.
 *
 *  Sized so one bucket (6) covers a FULL board (ROWS = 5) on its own: a bucket that
 *  can't fill the board by itself makes the fallback walk fire on an ordinary tick,
 *  quietly pulling the run off its weight table. */
export const BUFFER_DEPTH = BUFFER_TOTAL_TARGET / 4;

/** The opening pool request's band quotas — BUFFER_DEPTH of each bucket (sent by
 *  `fetchGamePool`, src/api/gamePool.ts). Also an flp break's prefetch
 *  (src/games/flpBreak/matchSpeedBreak.ts). */
export const POOL_DISTRIBUTION: Readonly<Record<GameCategory, number>> = {
    Unfamiliar: BUFFER_DEPTH,
    Target: BUFFER_DEPTH,
    Comfortable: BUFFER_DEPTH,
    Mastered: BUFFER_DEPTH,
};

// ENTRY_GATE_CARDS was removed: nothing blocks on card count any more. The number
// of cards this game WANTS is now a baseline the server tops the player up to with
// temporary cards — CARD_BASELINES['match-speed'] in server/contracts/wire.ts.
// See docs/PROVISIONAL_CARDS.md.

// ---- Scoring --------------------------------------------------------------
/**
 * Speed tiers by time to finish all TARGET_PAIRS, best-first (src/games/shared/runTiers.ts:
 * tier 1 is the best, and every finished run lands on one of the seven).
 * ⚠️ PLACEHOLDERS: the old medal lines (gold 100s ≈ 3.3s/pair, silver 150s, bronze 300s)
 * spread over seven tiers, to be tuned from play data.
 */
export const SPEED_TIERS: SpeedTierLadder = {
    maxMs: [75_000, 100_000, 125_000, 150_000, 200_000, 300_000],
};

/**
 * Accuracy tiers by pairs matched / match attempts, best-first.
 * ⚠️ PLACEHOLDERS: tune from play data.
 */
export const ACCURACY_TIERS: AccuracyTierLadder = {
    minRatio: [1, 0.95, 0.9, 0.8, 0.7, 0.6],
};

/**
 * A run's tiers, or null for a run that did not reach TARGET_PAIRS (left early, out of
 * cards): it has no finish time to grade.
 */
export function runResultTiers(score: number, attempts: number, finishMs: number): RunTiers | null {
    if (score < TARGET_PAIRS) return null;
    return {
        speed: gradeSpeed(finishMs, SPEED_TIERS),
        accuracy: gradeAccuracy(score, attempts, ACCURACY_TIERS),
    };
}

/** The flp break results card's heading (docs/FLP_GAME_BREAKS.md § 5b). */
export function runResultTitle(score: number): string {
    return score >= TARGET_PAIRS ? "Finished!" : "Run ended";
}

export function runResultScore(score: number, finishMs: number): string {
    return score >= TARGET_PAIRS
        ? `${TARGET_PAIRS} pairs in ${formatTimeMs(finishMs)}`
        : `${score} of ${TARGET_PAIRS} pairs matched`;
}

/** The accuracy line under the score; ACCURACY_TIERS grades the same ratio. */
export function runResultAccuracy(score: number, attempts: number): string {
    const percent = attempts > 0 ? Math.round((score / attempts) * 100) : 0;
    return `Accuracy ${score}/${attempts} (${percent}%)`;
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
//   grn  = matched
//   red  = a wrong attempt
//
// Every fill below is a PASTEL carrying ink text, per the redesign's fill rule
// (docs/SHELF_REDESIGN.md § A1) — never saturated ink behind white letters.
//
// v2 (artboard 14, `#msp`): every resting card is WHITE (`.msc{background:var(--white)}`)
// — the foreign column no longer sits on the paper ground, so the columns are told apart
// by type alone. State fills are the SURFACE tier (caption "Surface: picked cards"): a
// card is a large fill, not a Mid-tier chip.
export const FOREIGN_CARD_BG = COLORS.white;
export const ENGLISH_CARD_BG = COLORS.white;
/** The lip under every card: the Dictionary keycap's white-on-grey (DictionaryPageParts → `Keycap`). */
export const CARD_LIP = COLORS.grey;
/** The app's outline, an inset ring so a key's box never changes and no tap can re-wrap a
 *  three-line gloss. A state's fill sits under the same ring. */
export const CARD_OUTLINE = COLORS.border;
/** Selected card (`.msc.pick{background:var(--blu);border:2px solid var(--ink)}`): the
 *  blue SURFACE fill, with the outline swapped for a 2px INK ring. */
export const SELECTED_CARD_BG = COLORS.blu;
export const SELECTED_CARD_RING = COLORS.onSurface;
/** Correct-match pop. */
export const CORRECT_CARD_BG = COLORS.grn;
/** Wrong-attempt flash. Ink-on-pastel like the rest, so the flash reads as the same
 *  system as the other two rather than as an error dialog dropped onto the board. */
export const WRONG_CARD_BG = COLORS.red;
export const WRONG_CARD_INK = COLORS.dangerInk;

/**
 * THE GAME'S HUE — its hub row's colour AND the accent ground its own screen is
 * flooded with (docs/SHELF_REDESIGN.md § A6b).
 *
 * It lives here rather than as a literal in `GAME_REGISTRY` so the two cannot drift:
 * the registry reads this, and the page passes it to `gameSurfaceSx` /
 * `GameSurfaceProvider`. Tapping a blue row must open a blue screen.
 *
 * Blue since v2 (artboard 14, `#msp` on `--bluM`); it was green until the hub hues were
 * brought in line with the artboards. The state fills above were checked against the
 * move: the picked card's `--blu` Surface now shares the ground's hue, which is the
 * design's own pairing (`#msp .msc.pick{background:var(--blu)}` on a `--bluM` ground),
 * and it stays distinct because the cards sit on the white `.play` panel, not on the
 * ground, and the pick carries the ink edge. The green "matched" fill no longer shares
 * the game's hue at all, which only helps it read as feedback.
 */
export const GAME_HUE: RampHue = "blu";
