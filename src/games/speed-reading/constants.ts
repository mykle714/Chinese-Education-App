/** `wins` table key, shared with the Games hub's badge. */
export const GAME_KEY = "speedReading";

/**
 * Speed Reading has no difficulty levels, so every win is recorded at level 1 —
 * the same convention Match Speed and Word Search use for the `wins` table's
 * (game, level) key.
 */
export const WIN_LEVEL = 1;

/** One minute per run. */
export const RUN_DURATION_MS = 60_000;
/**
 * Green/red flash before the next round loads.
 *
 * Shortened from 600ms → 280 → 180 once the answer sound and the tap-anchored
 * float indicator landed: with an instant audio cue and feedback appearing where
 * the eye already is, the player no longer needs to travel to the button colours
 * to learn the outcome, so the pause can be much tighter. The clock does not stop
 * during feedback, so every ms cut here is a ms returned to play.
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
/** Cards fetched on game load. */
export const INITIAL_BATCH = 20;
/** Queue length that triggers a top-up. */
export const TOPUP_THRESHOLD = 5;
/** Cards per top-up request. */
export const TOPUP_BATCH = 5;
/** Learn Now cards required to play, matching Bubble Match. */
export const ENTRY_GATE_CARDS = 20;

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
 * Medal thresholds, in CORRECT PICKS.
 *
 * At ~1.8s/round (think time plus the 180ms feedback) a run is roughly 33
 * rounds, so gold means near-perfect play at speed.
 *
 * ⚠️ ALL THREE NUMBERS ARE PLACEHOLDERS until the game has been played. They
 * were set against the old 600ms feedback (~27 rounds/run); the shorter pause
 * fits ~6 more rounds into the minute, so they are now slightly easier to hit
 * and should be re-tuned from real play data.
 */
export const MEDAL_THRESHOLDS = { gold: 24, silver: 17, bronze: 10 };

export type Medal = "gold" | "silver" | "bronze" | null;

/** Medal earned for a score, or null below bronze. */
export function medalFor(score: number): Medal {
    if (score >= MEDAL_THRESHOLDS.gold) return "gold";
    if (score >= MEDAL_THRESHOLDS.silver) return "silver";
    if (score >= MEDAL_THRESHOLDS.bronze) return "bronze";
    return null;
}

export const MEDAL_LABEL: Record<Exclude<Medal, null>, string> = {
    gold: "🥇 Gold",
    silver: "🥈 Silver",
    bronze: "🥉 Bronze",
};
