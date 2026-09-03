import type {
    ChallengeScoreBreakdown,
    ChallengeScoreLine,
    ChallengeScoringBonus,
    ChallengeScoringSpec,
} from "../../types";

/**
 * The shared runner that turns game EVENTS into a Study Challenge score
 * (docs/STUDY_CHALLENGE.md § 5.4, docs/GAMES_FEATURE.md § "Challenge-eligible games").
 *
 * ── WHY THIS IS DATA-DRIVEN AND NOT A PER-GAME CALLBACK ───────────────────────
 * Live mode (phase 2) must be able to score the same events SERVER-SIDE, with no game
 * page mounted. A callback is code the server cannot reuse; a spec is a table of
 * numbers it can, and this file is a pure function over that table. That single
 * constraint is what decides the shape (Q76), and it is easy to violate accidentally by
 * "just" exporting a scoring function from a game — so games emit events HERE and never
 * compute points themselves.
 *
 * This module has no React and no imports beyond the contract types, precisely so the
 * server can adopt it verbatim when live mode arrives.
 *
 * ── THE THREE RULES A CALLER MUST HONOUR ──────────────────────────────────────
 *  1. **Contested/filler is fixed when the board is generated** and never re-derived.
 *     A challenge round writes real marks, so a word can cross into Mastered mid-test;
 *     scoring that consulted a band would be non-deterministic. Pass `contested` from
 *     the board, not from mastery.
 *  2. **The board must not reveal which words are contested** (Q74). This runner is
 *     told the split; the UI must not show it.
 *  3. **Keep the score RUNNING.** A live round can end by forfeit, and a forfeited run
 *     still has to report a score — so never compute only in an end-of-run branch.
 *     `snapshot()` is valid at any instant, which is what makes that possible.
 */

/** One thing that happened during a round. */
export type ChallengeEvent =
    /** A correct match/answer. `word` is the FOREIGN word, for the once-per-word rule. */
    | { kind: "hit"; word: string; contested: boolean }
    /** A mistake. */
    | { kind: "miss"; word: string; contested: boolean }
    /** A per-use penalty fired (Word Search's hint). */
    | { kind: "use"; ruleId: string }
    /** A survival bonus became live (Bubble Match's ceiling started dropping). */
    | { kind: "survivalStart"; ruleId: string }
    /**
     * How much ACTIVE time has elapsed. Drives `elapsedPenalty` and survival decay.
     *
     * ⚠️ ACCUMULATED ACTIVE TIME, never `now − startedAt`. The clock stops for
     * input-blocking popups and for backgrounding (docs/GAMES_FEATURE.md), and the
     * server has no independent clock on the round to correct a game that gets this
     * wrong — so a game reporting wall-clock here silently charges players for time
     * they were not playing.
     */
    | { kind: "tick"; activeMs: number }
    /** The run ended. `won` decides whether an all-or-nothing survival bonus is kept. */
    | { kind: "end"; won: boolean };

interface Counters {
    contestedHits: number;
    contestedMisses: number;
    fillerHits: number;
    fillerMisses: number;
    /** ruleId → times used. */
    uses: Record<string, number>;
}

/** Mutable accumulator. Create one per round. */
export interface ChallengeScorer {
    apply(event: ChallengeEvent): void;
    /** The score and its itemised breakdown, valid at ANY instant. */
    snapshot(): ChallengeScoreBreakdown;
}

/**
 * Create a scorer for one round.
 *
 * ⚠️ THE BREAKDOWN AND THE TOTAL COME FROM THE SAME ACCUMULATOR, always — the total is
 * the sum of the lines, computed in one place. § 5.6 makes this the client's
 * responsibility because the server stores both verbatim and cannot arbitrate between
 * them: two numbers derived separately WILL eventually disagree on screen, with nothing
 * to say which is right.
 */
export function createChallengeScorer(spec: ChallengeScoringSpec): ChallengeScorer {
    const counters: Counters = {
        contestedHits: 0,
        contestedMisses: 0,
        fillerHits: 0,
        fillerMisses: 0,
        uses: {},
    };

    /**
     * Words already charged for a miss, when the spec says a miss costs AT MOST ONCE
     * per word. Keyed by the FOREIGN WORD rather than the card id, so es and zh behave
     * identically — a card id would make the rule depend on which table the row is in.
     */
    const penalisedWords = new Set<string>();

    let activeMs = 0;
    let survivalStartedAtMs: number | null = null;
    let ended = false;
    let won = false;

    const apply = (event: ChallengeEvent): void => {
        // Everything after the end of a run is ignored, so a late event from a timer
        // that had already fired cannot change a banked score.
        if (ended && event.kind !== "end") return;

        switch (event.kind) {
            case "hit":
                if (event.contested) counters.contestedHits += 1;
                else counters.fillerHits += 1;
                break;

            case "miss": {
                if (spec.missChargedOncePerWord) {
                    if (penalisedWords.has(event.word)) break;
                    penalisedWords.add(event.word);
                }
                if (event.contested) counters.contestedMisses += 1;
                else counters.fillerMisses += 1;
                break;
            }

            case "use":
                counters.uses[event.ruleId] = (counters.uses[event.ruleId] ?? 0) + 1;
                break;

            case "survivalStart":
                // First one wins: the decay is measured from when the ceiling STARTED
                // dropping, and a repeated signal must not restart the clock (which
                // would hand back points the player had already lost).
                if (survivalStartedAtMs === null) survivalStartedAtMs = activeMs;
                break;

            case "tick":
                // Monotonic: a tick that goes backwards (a game resetting its clock on
                // resume) would otherwise refund an elapsed penalty.
                activeMs = Math.max(activeMs, event.activeMs);
                break;

            case "end":
                ended = true;
                won = event.won;
                break;
        }
    };

    /** Points and count for one bonus, at the current state. */
    const bonusLine = (bonus: ChallengeScoringBonus): ChallengeScoreLine | null => {
        switch (bonus.kind) {
            case "survival": {
                // Not live yet — the ceiling never started dropping, so there is nothing
                // to award and no line to draw.
                if (survivalStartedAtMs === null) return null;
                // ALL-OR-NOTHING on a loss (Q68). Bubble Match IS a survival game, so a
                // challenge score that ignored whether the player survived would be
                // scoring a different game than the one they played. Drawn as an explicit
                // 0 line rather than omitted, so the player can see what the loss cost.
                if (ended && bonus.forfeitOnLoss && !won) {
                    return {
                        ruleId: bonus.ruleId,
                        label: `${bonus.label} (lost)`,
                        count: null,
                        unitPoints: null,
                        points: 0,
                    };
                }
                // A HEAD START BEFORE THE DECAY BEGINS. Bubble Match sets no grace and
                // is unaffected (`?? 0`); Hydra's clear bonus holds the full pot for
                // its first minute, which is what stops a first-guess decay rate from
                // punishing a run that was actually fast. Measured from when the pot
                // was ARMED, not from the start of the run — the two coincide only for
                // a `runStart` trigger.
                const grace = bonus.graceMs ?? 0;
                const interval = bonus.decayIntervalMs ?? 0;
                const elapsedSinceArmed = Math.max(0, activeMs - survivalStartedAtMs - grace);
                const steps = interval > 0 ? Math.floor(elapsedSinceArmed / interval) : 0;
                const decayed = bonus.points + steps * (bonus.decayPoints ?? 0);
                const floor = bonus.floor ?? 0;
                return {
                    ruleId: bonus.ruleId,
                    label: bonus.label,
                    count: null,
                    unitPoints: null,
                    points: Math.max(floor, decayed),
                };
            }

            case "elapsedPenalty": {
                const interval = bonus.decayIntervalMs ?? 1000;
                const grace = bonus.graceMs ?? 0;
                const chargeable = activeMs - grace;
                if (chargeable <= 0 || interval <= 0) return null;
                const steps = Math.floor(chargeable / interval);
                if (steps <= 0) return null;
                return {
                    ruleId: bonus.ruleId,
                    label: bonus.label,
                    count: steps,
                    unitPoints: bonus.points,
                    points: steps * bonus.points,
                };
            }

            case "perUse": {
                const count = counters.uses[bonus.ruleId] ?? 0;
                if (count === 0) return null;
                return {
                    ruleId: bonus.ruleId,
                    label: bonus.label,
                    count,
                    unitPoints: bonus.points,
                    points: count * bonus.points,
                };
            }

            default:
                return null;
        }
    };

    const snapshot = (): ChallengeScoreBreakdown => {
        const lines: ChallengeScoreLine[] = [];

        /** Push a simple `count × unit` line, omitting it when it never fired. */
        const push = (ruleId: string, label: string, count: number, unitPoints: number) => {
            if (count === 0 || unitPoints === 0) return;
            lines.push({ ruleId, label, count, unitPoints, points: count * unitPoints });
        };

        // Order matters for display, not for arithmetic: contested first, because the
        // contested words are what the challenge is measuring.
        push("contestedHit", "contested matches", counters.contestedHits, spec.contestedHit);
        push("contestedMiss", "contested mistakes", counters.contestedMisses, spec.contestedMiss);
        push("fillerHit", "filler matches", counters.fillerHits, spec.fillerHit);
        push("fillerMiss", "filler mistakes", counters.fillerMisses, spec.fillerMiss);

        for (const bonus of spec.bonuses ?? []) {
            const line = bonusLine(bonus);
            if (line) lines.push(line);
        }

        // THE TOTAL IS THE SUM OF THE LINES, by construction. Not clamped: a total may
        // legitimately go negative (Q15), because clamping would make mistakes free for
        // whoever is already at the floor — precisely the player most likely to keep
        // making them.
        const total = lines.reduce((sum, line) => sum + line.points, 0);
        return { lines, total };
    };

    return { apply, snapshot };
}
