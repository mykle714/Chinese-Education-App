/**
 * Run tiers: the speed and accuracy grades on a finished game run, which replaced the
 * gold / silver / bronze medals (docs/GAMES_FEATURE.md § Run tiers).
 *
 * Each axis has SEVEN tiers. **Tier 1 is the best and tier 7 the lowest**, and every
 * finished run lands on one: tier 7 catches everything past tier 6's cutoff, so there is
 * no untiered outcome. A run that did not finish (left early, ran out of cards) gets no
 * tiers at all, and that is decided by the caller, not here.
 *
 * A ladder is six cutoffs, best-first. Each game owns its own speed ladder and, where it
 * keeps an error count, its own accuracy ladder, in its `constants.ts`.
 *
 * Layer: engine (src/games/shared). Pure: no React, no I/O.
 *
 * Referenced by: docs/GAMES_FEATURE.md § Run tiers, docs/FLP_GAME_BREAKS.md § 5b
 * (`FlpBreakResults.tiers`), and every game's `SPEED_TIERS` / `ACCURACY_TIERS`.
 */

/** A tier on one axis: 1 is the best, 7 the lowest. */
export type RunTier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Tiers per axis. */
export const RUN_TIER_COUNT = 7;

/** Six cutoffs, best-first. Tier n is the first cutoff the value meets; tier 7 is past all six. */
export type TierCutoffs = readonly [number, number, number, number, number, number];

/**
 * A speed ladder: cutoffs are finish TIMES in ms, so lower is better. Tier n means the run
 * finished within `cutoffs[n - 1]`.
 */
export interface SpeedTierLadder {
    maxMs: TierCutoffs;
}

/**
 * An accuracy ladder: cutoffs are the share of answers that were right (0–1), so higher is
 * better. Tier n means the run's accuracy was at least `cutoffs[n - 1]`.
 */
export interface AccuracyTierLadder {
    minRatio: TierCutoffs;
}

/** A run's speed grade, with the time the results card shows beside it. */
export interface SpeedResult {
    tier: RunTier;
    /** The run's real time, as shown. A game that grades a scaled time still shows this. */
    elapsedMs: number;
}

/** A run's accuracy grade, with the fraction the results card shows beside it. */
export interface AccuracyResult {
    tier: RunTier;
    correct: number;
    attempts: number;
}

/** What a finished run earned. `accuracy` is absent in games that keep no error count. */
export interface RunTiers {
    speed: SpeedResult;
    accuracy?: AccuracyResult;
}

/** The first cutoff (1-based) the value passes, else tier 7. */
function tierFromCutoffs(cutoffs: TierCutoffs, passes: (cutoff: number) => boolean): RunTier {
    const index = cutoffs.findIndex(passes);
    return (index === -1 ? RUN_TIER_COUNT : index + 1) as RunTier;
}

/** Speed tier for a finish time (ms). Lower is better. */
export function speedTierFor(elapsedMs: number, ladder: SpeedTierLadder): RunTier {
    return tierFromCutoffs(ladder.maxMs, (maxMs) => elapsedMs <= maxMs);
}

/**
 * Accuracy tier for `correct` right answers out of `attempts`. Higher is better. Zero
 * attempts reads as perfect: nothing was answered wrong.
 */
export function accuracyTierFor(correct: number, attempts: number, ladder: AccuracyTierLadder): RunTier {
    const ratio = attempts > 0 ? correct / attempts : 1;
    return tierFromCutoffs(ladder.minRatio, (minRatio) => ratio >= minRatio);
}

/**
 * Grade a run's speed. `gradedMs` is the time held against the ladder when it differs from
 * the time shown (Word Search and Memory Map scale theirs to a standard board / quota).
 */
export function gradeSpeed(elapsedMs: number, ladder: SpeedTierLadder, gradedMs: number = elapsedMs): SpeedResult {
    return { tier: speedTierFor(gradedMs, ladder), elapsedMs };
}

/** Grade a run's accuracy: `correct` right answers out of `attempts`. */
export function gradeAccuracy(correct: number, attempts: number, ladder: AccuracyTierLadder): AccuracyResult {
    return { tier: accuracyTierFor(correct, attempts, ladder), correct, attempts };
}

/** "28/30 · 93%" — the accuracy panel's figure. Zero attempts reads as 100%. */
export function formatAccuracy(correct: number, attempts: number): string {
    const percent = attempts > 0 ? Math.round((correct / attempts) * 100) : 100;
    return `${correct}/${attempts} · ${percent}%`;
}
