import type { MarkType } from "../../types";

/** `wins` table key, shared with the Games hub's badge. */
export const GAME_KEY = "speedReading";

/**
 * The mastery track this game feeds (docs/MASTERY_REWORK.md). A round shows a
 * foreign clue and asks the player to pick the matching word by sight, which is
 * READING, not recognition — so both the pool query and every mark it writes use
 * that track.
 *
 * Single source of truth for the `?markType=` pool query (useSpeedReadingQueue),
 * the /api/flashcards/mark call (SpeedReadingPage), and the Games hub's mark-type
 * chip (via GAME_REGISTRY's `markType`).
 */
export const MARK_TYPE: MarkType = "reading";

/**
 * Speed Reading has no difficulty levels, so every win is recorded at level 1 —
 * the same convention Match Speed and Word Search use for the `wins` table's
 * (game, level) key.
 */
export const WIN_LEVEL = 1;

/**
 * Rounds per run. The run is a RACE, not a timed sprint: the player answers this
 * many rounds and the clock counts UP, so the score is elapsed time and lower is
 * better.
 *
 * Every ANSWERED round counts, right or wrong — the counter measures how far
 * through the fixed set of 20 you are, and a wrong answer is paid for in seconds
 * (see WRONG_PENALTY_MS) rather than by making the run longer.
 *
 * There is no Skip: every round must be answered, so every round counts. See the
 * SpeedReadingPage doc-comment for why the button was removed rather than priced.
 */
export const TARGET_ROUNDS = 20;

/**
 * Seconds added to the final time for each wrong answer, in ms.
 *
 * With a count-up clock, an incorrect tap is otherwise the FASTEST way through a
 * round — no reading required — so accuracy needs an explicit price. 3s is about
 * two rounds of good play, which makes a coin-flip run (~10 misses, +30s) land
 * well outside every medal.
 */
export const WRONG_PENALTY_MS = 3_000;
/**
 * Green/red flash before the next round loads.
 *
 * Shortened from 600ms → 280 → 180 once the answer sound and the tap-anchored
 * float indicator landed: with an instant audio cue and feedback appearing where
 * the eye already is, the player no longer needs to travel to the button colours
 * to learn the outcome, so the pause can be much tighter. The clock does not stop
 * during feedback, so this pause is charged to the player 20 times a run — every
 * ms cut here comes straight off every final time.
 *
 * ⚠️ This constant is NOT the whole gap the player feels. Two other sources used
 * to dominate it, both now fixed: the next round's glyphs loading on mount
 * (SpeedReadingPage prebuilds and prefetches one round ahead) and the option
 * button's 140ms colour fade back to neutral (SpeedReadingOption transitions
 * into feedback only). Re-check those before shortening this further.
 */
export const FEEDBACK_MS = 180;

/**
 * Lifetime of the floating ✓/✗ that rises from the tap point.
 *
 * Intentionally LONGER than FEEDBACK_MS: the indicator is absolutely positioned
 * over the play area and keeps animating across the round change, so the
 * feedback reads as continuous instead of being cut off mid-float.
 */
export const FLOAT_INDICATOR_MS = 650;

/**
 * Lifetime of a float that also carries the red **+3s**.
 *
 * Longer than the bare ✓/✗: a glyph is recognised at a glance, but a number has
 * to be READ, and 650ms of a rising, fading element is not enough to be sure the
 * player registered what the mistake cost. This is the ONLY thing the penalty
 * lengthens — it is not a pause, the game advances after FEEDBACK_MS regardless
 * and the indicator finishes floating over the next round.
 */
export const PENALTY_INDICATOR_MS = 1_000;

/** How long a given float indicator lives, in ms. */
export function indicatorLifetime(kind: "correct" | "wrong"): number {
    return kind === "correct" ? FLOAT_INDICATOR_MS : PENALTY_INDICATOR_MS;
}
/** Cards fetched on game load. */
export const INITIAL_BATCH = 20;
/** Queue length that triggers a top-up. */
export const TOPUP_THRESHOLD = 5;
/** Cards per top-up request. */
export const TOPUP_BATCH = 5;
// ENTRY_GATE_CARDS was removed: nothing blocks on card count any more. The number
// of cards this game WANTS is now a baseline the server tops the player up to with
// temporary cards — CARD_BASELINES['speed-reading'] in server/contracts/wire.ts.
// See docs/PROVISIONAL_CARDS.md.

// ── Option-button geometry ──────────────────────────────────────────────────
// The two options sit SIDE BY SIDE, so each gets about half the row. Glyph size
// is measured against the real row width rather than tabulated by word length
// (see SpeedReadingPage's `glyphSize`), and these are the fixed costs that come
// off that width first. They MUST match the sx values in SpeedReadingOption —
// they are the same numbers expressed for arithmetic instead of for CSS.

/** Gap between the two option buttons, px. Matches the options row's `gap: 1.5`. */
export const OPTION_ROW_GAP_PX = 12;
/** Horizontal padding inside one option button, px, per side. */
export const OPTION_PADDING_X_PX = 8;
/** Gap between adjacent glyphs inside a button, px. Matches `gap: 0.5`. */
export const OPTION_CHAR_GAP_PX = 4;
/** Floor, so a 4-character word stays legible on a narrow phone. */
export const MIN_GLYPH_PX = 30;
/** Ceiling, so a single character doesn't balloon on a tablet. */
export const MAX_GLYPH_PX = 120;
/**
 * Minimum option-button height, px.
 *
 * Side-by-side glyphs are small, and height tracks the glyph — without a floor a
 * 4-character word would produce a button too short to be a comfortable tap
 * target.
 */
export const MIN_OPTION_HEIGHT_PX = 92;

/**
 * Pool distribution, same shape as Bubble Match's. Bucketed by the READING track
 * (see the markType param) because that is the track this game marks.
 */
export const GAME_DISTRIBUTION: Record<string, number> = {
    Unfamiliar: 2,
    Target: 10,
    Comfortable: 6,
    Mastered: 2,
};

/**
 * Medal thresholds, in FINAL TIME (ms) for the 20 rounds — penalties included.
 * LOWER IS BETTER, which inverts the comparison in `medalFor` relative to every
 * other game's score-based thresholds.
 *
 * Gold at 45s is 2.25s/round, which is roughly the pace the old one-minute
 * format's gold demanded (24 correct in 60s).
 *
 * ⚠️ ALL THREE NUMBERS ARE PLACEHOLDERS until the game has been played at this
 * format, and should be re-tuned from real play data.
 */
export const MEDAL_THRESHOLDS = { gold: 45_000, silver: 60_000, bronze: 90_000 };

export type Medal = "gold" | "silver" | "bronze" | null;

/**
 * Medal earned for a finished run's total time, or null if slower than bronze.
 *
 * Only call this for a run that actually completed all TARGET_ROUNDS — a run cut
 * short by a drained queue has a small elapsed time that would otherwise buy a
 * gold. The page guards that; this function deliberately does not take the round
 * count so it stays a pure time→medal mapping.
 */
export function medalFor(totalMs: number): Medal {
    if (totalMs <= MEDAL_THRESHOLDS.gold) return "gold";
    if (totalMs <= MEDAL_THRESHOLDS.silver) return "silver";
    if (totalMs <= MEDAL_THRESHOLDS.bronze) return "bronze";
    return null;
}

/**
 * `M:SS` for the clock and the end popup. No hour handling: there is no time cap,
 * but a run past 59:59 is a walked-away tab, not a score worth formatting.
 */
export function formatClock(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export const MEDAL_LABEL: Record<Exclude<Medal, null>, string> = {
    gold: "🥇 Gold",
    silver: "🥈 Silver",
    bronze: "🥉 Bronze",
};
