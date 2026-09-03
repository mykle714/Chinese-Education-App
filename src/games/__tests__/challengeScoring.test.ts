import { describe, it, expect } from "vitest";
import { createChallengeScorer } from "../runtime/challengeScoring";
import { challengeScoringFor } from "../registry";
import type { ChallengeScoringSpec } from "../../types";

/**
 * The challenge scoring runner (docs/STUDY_CHALLENGE.md § 5.4).
 *
 * Every case here is a rule the design states explicitly, tested against the REAL specs
 * from `CHALLENGE_GAMES` rather than fixtures — so a change to the numbers in the
 * contract shows up here as a failing expectation rather than as a quietly different
 * game.
 */
describe("challenge scoring runner", () => {
    const bubbleMatch = challengeScoringFor("bubble-match") as ChallengeScoringSpec;
    const matchSpeed = challengeScoringFor("match-speed") as ChallengeScoringSpec;
    const wordSearch = challengeScoringFor("word-search", "pinyin") as ChallengeScoringSpec;
    const hydra = challengeScoringFor("hydra-bubbles") as ChallengeScoringSpec;

    /** Clear all nine and stop the clock at `activeMs` — one whole Hydra round. */
    const hydraClearRun = (activeMs: number) => {
        const scorer = createChallengeScorer(hydra);
        scorer.apply({ kind: "survivalStart", ruleId: "clearBonus" });
        for (let i = 0; i < 9; i += 1) {
            scorer.apply({ kind: "hit", word: `w${i}`, contested: true });
        }
        scorer.apply({ kind: "tick", activeMs });
        scorer.apply({ kind: "end", won: true });
        return scorer;
    };

    it("pays contested 100 and filler 20", () => {
        const scorer = createChallengeScorer(matchSpeed);
        scorer.apply({ kind: "hit", word: "开始", contested: true });
        scorer.apply({ kind: "hit", word: "水", contested: false });

        const { total, lines } = scorer.snapshot();
        expect(total).toBe(120);
        // The breakdown must be itemised, not just a number — it is what the scoreboard
        // renders, and it must never be recomputed for display.
        expect(lines.map((l) => l.ruleId)).toEqual(["contestedHit", "fillerHit"]);
        expect(lines[0]).toMatchObject({ count: 1, unitPoints: 100, points: 100 });
    });

    it("charges a miss at most once per foreign word, keyed by the WORD not the card", () => {
        const scorer = createChallengeScorer(matchSpeed);
        // Three misses on the same word: only the first is charged.
        scorer.apply({ kind: "miss", word: "开始", contested: true });
        scorer.apply({ kind: "miss", word: "开始", contested: true });
        scorer.apply({ kind: "miss", word: "开始", contested: true });
        // A different word is charged on its own account.
        scorer.apply({ kind: "miss", word: "结束", contested: true });

        expect(scorer.snapshot().total).toBe(-200);
    });

    it("lets a total go negative — scores are unclamped", () => {
        // Q15: clamping would make mistakes free for whoever is already at the floor,
        // which is exactly the player most likely to keep making them.
        const scorer = createChallengeScorer(matchSpeed);
        scorer.apply({ kind: "miss", word: "一", contested: true });
        scorer.apply({ kind: "miss", word: "二", contested: true });
        expect(scorer.snapshot().total).toBe(-200);
    });

    it("decays Bubble Match's survival bonus from when the ceiling started dropping", () => {
        const scorer = createChallengeScorer(bubbleMatch);
        scorer.apply({ kind: "tick", activeMs: 10_000 });
        scorer.apply({ kind: "survivalStart", ruleId: "survival" });

        // Immediately live: full 500.
        expect(scorer.snapshot().total).toBe(500);

        // 6s later = three 2s steps = −300.
        scorer.apply({ kind: "tick", activeMs: 16_000 });
        expect(scorer.snapshot().total).toBe(200);

        // Floors at 0 rather than going negative.
        scorer.apply({ kind: "tick", activeMs: 60_000 });
        expect(scorer.snapshot().total).toBe(0);
    });

    it("forfeits the whole survival bonus when the run is LOST", () => {
        const scorer = createChallengeScorer(bubbleMatch);
        scorer.apply({ kind: "survivalStart", ruleId: "survival" });
        scorer.apply({ kind: "hit", word: "开始", contested: true });
        // Surviving would be worth +500 on top of the +100 match.
        expect(scorer.snapshot().total).toBe(600);

        scorer.apply({ kind: "end", won: false });
        const { total, lines } = scorer.snapshot();
        // The match still counts; the bonus is gone entirely (Q68).
        expect(total).toBe(100);
        // Drawn as an explicit zero line, so the player can see what the loss cost.
        expect(lines.find((l) => l.ruleId === "survival")).toMatchObject({ points: 0 });
    });

    it("keeps the survival bonus on a WON run", () => {
        const scorer = createChallengeScorer(bubbleMatch);
        scorer.apply({ kind: "survivalStart", ruleId: "survival" });
        scorer.apply({ kind: "end", won: true });
        expect(scorer.snapshot().total).toBe(500);
    });

    it("does not restart the survival decay if the signal repeats", () => {
        const scorer = createChallengeScorer(bubbleMatch);
        scorer.apply({ kind: "survivalStart", ruleId: "survival" });
        scorer.apply({ kind: "tick", activeMs: 6_000 });
        // A repeated signal must not hand back the points already decayed away.
        scorer.apply({ kind: "survivalStart", ruleId: "survival" });
        expect(scorer.snapshot().total).toBe(200);
    });

    it("charges Word Search −10/s only after the 1:00 grace, on ACTIVE time", () => {
        const scorer = createChallengeScorer(wordSearch);
        scorer.apply({ kind: "hit", word: "开始", contested: true });

        // Inside the grace: nothing charged.
        scorer.apply({ kind: "tick", activeMs: 59_000 });
        expect(scorer.snapshot().total).toBe(100);

        // 10s past the grace: −100.
        scorer.apply({ kind: "tick", activeMs: 70_000 });
        expect(scorer.snapshot().total).toBe(0);
    });

    it("never refunds an elapsed penalty when a game's clock ticks backwards", () => {
        // A game that resets its timer on resume would otherwise hand time back.
        const scorer = createChallengeScorer(wordSearch);
        scorer.apply({ kind: "tick", activeMs: 90_000 });
        const after = scorer.snapshot().total;
        scorer.apply({ kind: "tick", activeMs: 10_000 });
        expect(scorer.snapshot().total).toBe(after);
    });

    it("pays Hydra nothing for a filler match, but still charges a filler mistake", () => {
        // Hydra is the ONE game where filler is worth 0. The run ends on the last
        // contested clear and nothing else caps its length, so paid filler was
        // farmable: clear eight of nine, then harvest bubbles. Mistakes stay charged
        // because a filler clear is not optional — draining is how the board is kept
        // off the ceiling — so filler must be pure risk rather than inert.
        const scorer = createChallengeScorer(hydra);
        scorer.apply({ kind: "hit", word: "水", contested: false });
        expect(scorer.snapshot().total).toBe(0);
        expect(scorer.snapshot().lines).toHaveLength(0);

        scorer.apply({ kind: "miss", word: "火", contested: false });
        expect(scorer.snapshot().total).toBe(-20);
    });

    it("holds Hydra's clear bonus flat through its grace, then decays it to a floor of 0", () => {
        // Full pot inside the first minute...
        expect(hydraClearRun(45_000).snapshot().total).toBe(900 + 300);
        expect(hydraClearRun(60_000).snapshot().total).toBe(900 + 300);
        // ...then −25 per 15s of ACTIVE time past it.
        expect(hydraClearRun(75_000).snapshot().total).toBe(900 + 275);
        expect(hydraClearRun(120_000).snapshot().total).toBe(900 + 200);
        // Floors at 0 at 4:00 and never goes negative, so a slow finisher still keeps
        // the whole contested ledger.
        expect(hydraClearRun(240_000).snapshot().total).toBe(900);
        expect(hydraClearRun(600_000).snapshot().total).toBe(900);
    });

    it("forfeits Hydra's clear bonus on a run that did not clear the set", () => {
        // THE RULE THAT MAKES SCORING TIME SAFE AT ALL. A per-second term charged to
        // every run would pay players to fail fast, because finishing takes longer
        // than quitting by definition.
        const scorer = createChallengeScorer(hydra);
        scorer.apply({ kind: "survivalStart", ruleId: "clearBonus" });
        scorer.apply({ kind: "hit", word: "一", contested: true });
        scorer.apply({ kind: "miss", word: "二", contested: true });
        scorer.apply({ kind: "tick", activeMs: 20_000 });
        scorer.apply({ kind: "end", won: false });

        const { total, lines } = scorer.snapshot();
        expect(total).toBe(0); // +100 − 100, and no bonus at all
        expect(lines.find((l) => l.ruleId === "clearBonus")).toMatchObject({ points: 0 });
    });

    it("never lets Hydra's clear bonus outrank clearing more words", () => {
        // The invariant the pot's SIZE rests on: a complete run is 900 + bonus >= 900,
        // and the best possible partial run is eight clears plus the miss that ended
        // it (800 − 100 = 700). So a fast partial can never beat a slow complete one,
        // whatever the pot is tuned to.
        const slowestComplete = hydraClearRun(10 * 60_000).snapshot().total;

        const bestPartial = createChallengeScorer(hydra);
        bestPartial.apply({ kind: "survivalStart", ruleId: "clearBonus" });
        for (let i = 0; i < 8; i += 1) {
            bestPartial.apply({ kind: "hit", word: `w${i}`, contested: true });
        }
        bestPartial.apply({ kind: "miss", word: "w8", contested: true });
        bestPartial.apply({ kind: "tick", activeMs: 5_000 });
        bestPartial.apply({ kind: "end", won: false });

        expect(bestPartial.snapshot().total).toBe(700);
        expect(slowestComplete).toBeGreaterThan(bestPartial.snapshot().total);
    });

    it("charges Word Search's hints per use", () => {
        const scorer = createChallengeScorer(wordSearch);
        scorer.apply({ kind: "use", ruleId: "hintUsed" });
        scorer.apply({ kind: "use", ruleId: "hintUsed" });
        expect(scorer.snapshot().total).toBe(-40);
    });

    it("gives Word Search no mistake penalty", () => {
        // A selection either spells a word or it does not, so there is no mismatch event
        // to charge for the way the two matching games have. Time is its penalty instead.
        const scorer = createChallengeScorer(wordSearch);
        scorer.apply({ kind: "miss", word: "开始", contested: true });
        expect(scorer.snapshot().total).toBe(0);
    });

    it("ignores events after the run ended, so a late timer cannot change a banked score", () => {
        const scorer = createChallengeScorer(matchSpeed);
        scorer.apply({ kind: "hit", word: "开始", contested: true });
        scorer.apply({ kind: "end", won: true });
        const banked = scorer.snapshot().total;

        scorer.apply({ kind: "hit", word: "结束", contested: true });
        scorer.apply({ kind: "miss", word: "水", contested: false });
        expect(scorer.snapshot().total).toBe(banked);
    });

    it("has a total that is always exactly the sum of its lines", () => {
        // § 5.6 makes this the client's responsibility, because the server stores both
        // verbatim and cannot arbitrate if they disagree.
        const scorer = createChallengeScorer(bubbleMatch);
        scorer.apply({ kind: "hit", word: "一", contested: true });
        scorer.apply({ kind: "hit", word: "二", contested: false });
        scorer.apply({ kind: "miss", word: "三", contested: true });
        scorer.apply({ kind: "survivalStart", ruleId: "survival" });
        scorer.apply({ kind: "tick", activeMs: 4_000 });

        const { lines, total } = scorer.snapshot();
        expect(lines.reduce((sum, line) => sum + line.points, 0)).toBe(total);
    });

    it("caps Match Speed's contested score at 1000 across ten words", () => {
        // § 5.3: contested words are not recycled, so clearing the set is the round's
        // goal and its contested ceiling is a hard 10 × 100.
        const scorer = createChallengeScorer(matchSpeed);
        for (let i = 0; i < 10; i += 1) {
            scorer.apply({ kind: "hit", word: `word-${i}`, contested: true });
        }
        const contested = scorer.snapshot().lines.find((l) => l.ruleId === "contestedHit");
        expect(contested?.points).toBe(1000);
    });

    it("reports a usable score for a run that never ended (a live forfeit)", () => {
        // A forfeited live round still has to report something, which is why the score is
        // running rather than computed in an end-of-run branch.
        const scorer = createChallengeScorer(matchSpeed);
        scorer.apply({ kind: "hit", word: "开始", contested: true });
        expect(scorer.snapshot().total).toBe(100);
    });
});
