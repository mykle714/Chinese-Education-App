import type { CPCDSize } from "../../components/ForeignText";
import type { MarkType } from "../../types";
import type { RampHue } from "../../theme/colors";

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
 * How many of those rounds are SENTENCE rounds, taken from the END of the run
 * (rounds 19 and 20 of 20).
 *
 * The finale escalates from "read this word" to "read this word in context":
 * both options are the same example sentence, differing at one character inside
 * the target word, and the prompt shows the sentence's translation, its pinyin,
 * and narrates the sentence rather than the bare word.
 *
 * Their cards are RESERVED AT LOAD from the initial pool — the only cards
 * eligible are ones whose det row already carries an example sentence containing
 * the headword — so the finale is decided before the run starts and never
 * depends on what a mid-run top-up returns. See useSpeedReadingQueue.
 */
export const SENTENCE_ROUNDS = 2;

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
 * Shortened from 600ms → 280 → 180 once the answer SOUND landed: an instant
 * audio cue tells the player the outcome without their having to travel to a
 * colour at all, so the pause can be much tighter. The clock does not stop
 * during feedback, so this pause is charged to the player 20 times a run — every
 * ms cut here comes straight off every final time.
 *
 * ⚠️ The visual half of that argument got weaker when the tap-anchored float
 * indicator was removed: the only thing left to see is the tapped half's tint,
 * and 180ms is short for a colour change to register. If the reveal starts
 * feeling unreadable, LENGTHENING this is the fix — the sound is doing most of
 * the work at present.
 *
 * ⚠️ This constant is also NOT the whole gap the player feels. Two other sources
 * used to dominate it, both now fixed: the next round's glyphs loading on mount
 * (SpeedReadingPage prebuilds and prefetches one round ahead) and the option
 * colour's 140ms fade back to neutral (SpeedReadingTapZone transitions into
 * feedback only). Re-check those before shortening this further.
 */
export const FEEDBACK_MS = 180;

// The floating ✓/✗ that used to rise from the tap point — and the red +3s it
// carried on a wrong answer — was REMOVED, along with FLOAT_INDICATOR_MS,
// PENALTY_INDICATOR_MS and indicatorLifetime(). The tapped half's green/red tint
// is now the only visual answer cue. ⚠️ Nothing shows the WRONG_PENALTY_MS
// charge at the moment it is incurred; it is visible only as the clock being
// larger than the elapsed time. See docs/SPEED_READING_GAME.md.

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

// ── Tap zones and option words ──────────────────────────────────────────────
// The two controls are the LEFT and RIGHT HALVES of the play area
// (SpeedReadingTapZone), with each option's word drawn centred on its half
// (SpeedReadingOptionWord). These are the shared numbers between those two.

/**
 * Fill of the TAPPED half while it is showing answer feedback — green if the
 * pick was right, red if it was wrong — for the FEEDBACK_MS window. The other
 * half is never tinted (see SpeedReadingPage.feedbackFor).
 *
 * Held at the old option cards' 0.14 even though the tinted area is now half the
 * screen: with the float indicator gone this tint is the ONLY visual answer cue,
 * and only one half of the two ever lights, so the total colour on screen is
 * comparable to what the two cards used to produce.
 */
export const ZONE_TINT_CORRECT = "rgba(5, 199, 147, 0.14)";
export const ZONE_TINT_WRONG = "rgba(239, 71, 111, 0.14)";
/**
 * Hairline down the middle, so the two halves read as two targets before the
 * player has tapped either. Deliberately fainter than `COLORS.border` — it is a
 * seam, not a frame.
 */
export const ZONE_DIVIDER = "rgba(255, 255, 255, 0.08)";
/** Horizontal breathing room around one option word, px, per side. */
export const OPTION_WORD_PADDING_X_PX = 12;
/**
 * cpcd size the option word is drawn at — the top of the ladder (`xl`,
 * ~51px glyphs), because reading these two words quickly IS the game.
 *
 * Fixed rather than fitted: at half the screen a 3–4 character word is wider
 * than its half, and it WRAPS at full size instead of shrinking. Both options
 * are the same length (the one-character invariant), so they always wrap the
 * same way and neither side can hint at the answer.
 */
export const OPTION_GLYPH_SIZE: CPCDSize = "xl";

/**
 * cpcd size a SENTENCE option is drawn at. Much smaller than the word rounds'
 * `xl` for the obvious reason: a sentence is 8–14 characters and each option
 * still only gets half the screen, so at `xl` it would wrap to five or six lines
 * and the two halves would stop being scannable side by side.
 *
 * `sm` (32px columns) fits ~10 characters per line in a half, i.e. most sentences
 * on one or two lines. The pair still wraps identically — the options differ by a
 * single character, so their line breaks are always in the same places.
 */
export const OPTION_SENTENCE_GLYPH_SIZE: CPCDSize = "sm";

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

/**
 * THE GAME'S HUE — its hub row's colour AND the accent ground its own screen is
 * flooded with (docs/SHELF_REDESIGN.md § A6b).
 *
 * It lives here rather than as a literal in `GAME_REGISTRY` so the two cannot drift:
 * the registry reads this, and the page passes it to `gameSurfaceSx` /
 * `GameSurfaceProvider`. Tapping a blu row must open a blu screen.
 */
export const GAME_HUE: RampHue = "blu";
