import type { CPCDSize } from "../../components/ForeignText";
import type { MarkType } from "../../types";
import { COLORS, type RampHue } from "../../theme/colors";
import { gradeAccuracy, gradeSpeed, type AccuracyTierLadder, type RunTiers, type SpeedTierLadder } from "../shared/runTiers";

/** `wins` table key. */
export const GAME_KEY = "speedReading";

/**
 * The mastery track this game feeds (docs/MASTERY_REWORK.md). A round shows a
 * foreign clue and asks the player to pick the matching word by sight, which is
 * READING, not recognition — so both the pool query and every mark it writes use
 * that track.
 *
 * Single source of truth for the `?markType=` pool query (useSpeedReadingQueue),
 * the /api/flashcards/mark call (SpeedReadingStage), and GAME_REGISTRY's `markType`
 * (which the flp break picker reads).
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
 * through the fixed set of 20 you are. A wrong answer costs no time: it lowers the
 * run's ACCURACY tier instead (ACCURACY_TIERS). The time penalty that used to price
 * it (WRONG_PENALTY_MS, +3s) was removed with the medals.
 *
 * There is no Skip: every round must be answered, so every round counts. See the
 * SpeedReadingStage doc-comment for why the button was removed rather than priced.
 */
export const TARGET_ROUNDS = 20;

/**
 * How many of those rounds are SENTENCE rounds, taken from the END of the run:
 * just the last one, round 20 of 20 (it was the last two until 2026-11-04).
 *
 * The finale escalates from "read this word" to "read this word in context":
 * both options are the same example sentence, differing at one character inside
 * the target word, and the prompt shows the sentence's translation, its pinyin,
 * and narrates the sentence rather than the bare word.
 *
 * The card is RESERVED AT LOAD from the initial pool — the only cards
 * eligible are ones whose det row already carries an example sentence containing
 * the headword — so the finale is decided before the run starts and never
 * depends on what a mid-run top-up returns. See useSpeedReadingQueue.
 */
export const SENTENCE_ROUNDS = 1;

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
 * (SpeedReadingStage prebuilds and prefetches one round ahead) and the option
 * colour's 140ms fade back to neutral (SpeedReadingTapZone transitions into
 * feedback only). Re-check those before shortening this further.
 */
export const FEEDBACK_MS = 180;

// The floating ✓/✗ that used to rise from the tap point — and the red +3s it
// carried on a wrong answer — was REMOVED, along with FLOAT_INDICATOR_MS,
// PENALTY_INDICATOR_MS and indicatorLifetime(). The tapped half's green/red tint
// is now the only visual answer cue, and the live clock is no longer drawn
// (SpeedReadingStage). See docs/SPEED_READING_GAME.md.

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
 * half is never tinted (see SpeedReadingStage.feedbackFor).
 *
 * Held at the old option cards' 0.14 even though the tinted area is now half the
 * screen: with the float indicator gone this tint is the ONLY visual answer cue,
 * and only one half of the two ever lights, so the total colour on screen is
 * comparable to what the two cards used to produce.
 */
/*
 * v2: the MID tier of green / red (artboard 15 caption "Mid: picked word" — the tapped
 * half IS this app's picked word, since the option cards were removed). They were
 * off-palette 14% washes of the old tone-2 green / tone-1 red. (They also filled the HUD's
 * round ticks until the HUD was removed, 2026-11-04.)
 */
export const ZONE_TINT_CORRECT = COLORS.grnM;
export const ZONE_TINT_WRONG = COLORS.redM;
// ZONE_DIVIDER (the hairline down the middle of the board) was REMOVED 2026-11-04 by
// request: the two words, centred on their halves, already say where each target is.
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
 * Speed tiers by the run's time for the 20 rounds, best-first
 * (src/games/shared/runTiers.ts: tier 1 is the best; past the last cutoff is tier 7).
 * Raw elapsed time: wrong answers add nothing, they are graded by ACCURACY_TIERS.
 *
 * Only grade a run that completed all TARGET_ROUNDS — a run cut short by a drained queue
 * has a small elapsed time that would otherwise buy tier 1. The Stage guards that.
 *
 * ⚠️ PLACEHOLDERS: the old medal lines (gold 45s ≈ 2.25s/round, silver 60s, bronze 90s)
 * spread over seven tiers, to be tuned from play data.
 */
export const SPEED_TIERS: SpeedTierLadder = {
    maxMs: [35_000, 45_000, 55_000, 65_000, 80_000, 100_000],
};

/**
 * Accuracy tiers by correct answers / TARGET_ROUNDS, best-first.
 * ⚠️ PLACEHOLDERS: tune from play data.
 */
export const ACCURACY_TIERS: AccuracyTierLadder = {
    minRatio: [1, 0.95, 0.9, 0.8, 0.7, 0.6],
};

/** A finished run's tiers: speed from the raw time, accuracy from the 20 answers. */
export function runResultTiers(elapsedMs: number, correct: number): RunTiers {
    return {
        speed: gradeSpeed(elapsedMs, SPEED_TIERS),
        accuracy: gradeAccuracy(correct, TARGET_ROUNDS, ACCURACY_TIERS),
    };
}

/**
 * `M:SS` for the break's results card. No hour handling: there is no time cap,
 * but a run past 59:59 is a walked-away tab, not a score worth formatting.
 */
export function formatClock(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * THE GAME'S HUE — the accent ground its break screen is flooded with
 * (docs/SHELF_REDESIGN.md § A6b).
 *
 * It lives here rather than as a literal in `GAME_REGISTRY` so the two cannot drift:
 * the registry reads this, and the flp break frame (`gameBreakFrameFor`,
 * GameBreakFrame.tsx) floods its screen with it.
 *
 * Yellow since v2 (artboard 15, `#spr` on `--yelK`); it was blue until the hub hues
 * were brought in line with the artboards.
 */
export const GAME_HUE: RampHue = "yel";
