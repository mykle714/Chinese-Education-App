import { describe, it, expect } from "vitest";
import { dealChallengePairs, emptyDealState } from "../match-speed/challengeDeal";
import { challengeLaunchFor } from "../runtime/challengeLaunch";
import { CHALLENGE_GAMES, CHALLENGE_WORD_COUNT } from "../../types";
import type { CardPair } from "../match-speed/types";

/**
 * Match Speed's alternation rule, and the launch table behind every drawn round
 * (docs/STUDY_CHALLENGE.md § 5.3, § 5.1).
 *
 * Both are cheap to get subtly wrong and expensive to notice: an alternation that
 * drifts hands the player a round scored mostly at 20 points a pair, and a missing
 * launch entry produces a challenge whose sequence contains a round nobody can open.
 * Neither throws — they just quietly score wrong.
 */

/** A stand-in pair; only `entry.id`/`entryKey` and the label matter here. */
function pair(label: string): CardPair {
    return {
        pairId: `pair-${label}`,
        entry: { id: label.length, entryKey: label } as CardPair["entry"],
        category: "Target",
    };
}

/** A filler source that hands back f1, f2, … and then runs dry. */
function fillerSource(count: number): () => CardPair | null {
    let next = 0;
    return () => (next < count ? pair(`f${++next}`) : null);
}

const isContested = (p: CardPair): boolean => p.pairId.startsWith("pair-c");

describe("Match Speed challenge alternation", () => {
    it("deals every other pair contested while the set lasts", () => {
        const state = emptyDealState();
        state.contested = ["c1", "c2", "c3"].map(pair);

        const dealt = dealChallengePairs(state, 6, fillerSource(10));

        expect(dealt.map(isContested)).toEqual([true, false, true, false, true, false]);
    });

    it("keeps the parity ACROSS calls, not just inside one", () => {
        // The board refills a few holes at a time, so an alternation that reset per
        // call would deal a contested pair into every refill's first slot and blow
        // straight through the set.
        const state = emptyDealState();
        state.contested = ["c1", "c2"].map(pair);
        const filler = fillerSource(10);

        const first = dealChallengePairs(state, 1, filler);
        const second = dealChallengePairs(state, 1, filler);
        const third = dealChallengePairs(state, 1, filler);

        expect(first.map(isContested)).toEqual([true]);
        expect(second.map(isContested)).toEqual([false]);
        expect(third.map(isContested)).toEqual([true]);
    });

    it("lapses to pure filler once the contested set is exhausted, and never recycles", () => {
        const state = emptyDealState();
        state.contested = ["c1", "c2"].map(pair);

        const dealt = dealChallengePairs(state, 8, fillerSource(20));
        const contestedDealt = dealt.filter(isContested);

        expect(contestedDealt).toHaveLength(2);
        // The hard ceiling § 5.3 relies on: a cleared set cannot come back for a
        // second 100 points.
        expect(state.contested).toHaveLength(0);
        expect(dealt.slice(3).some(isContested)).toBe(false);
    });

    it("falls through to a contested pair when the buffer is momentarily dry", () => {
        // A hole on the board is worse than an off-parity pair — the buffer is a
        // network-fed queue and WILL run dry between top-ups.
        const state = emptyDealState();
        state.contested = ["c1", "c2", "c3"].map(pair);

        const dealt = dealChallengePairs(state, 3, () => null);

        expect(dealt).toHaveLength(3);
        expect(dealt.every(isContested)).toBe(true);
    });

    it("returns short only when BOTH sources are empty", () => {
        const state = emptyDealState();
        const dealt = dealChallengePairs(state, 5, () => null);
        expect(dealt).toEqual([]);
    });

    it("can deal the whole contested set inside one 30-second run", () => {
        // 12 words at one contested pair per two dealt = 24 pairs, which a 30s run at
        // a 3s refill tick comfortably reaches. A regression that made this
        // impossible would cap every Match Speed round below its intended ceiling.
        const state = emptyDealState();
        state.contested = Array.from({ length: CHALLENGE_WORD_COUNT }, (_, i) => pair(`c${i}`));

        const dealt = dealChallengePairs(state, CHALLENGE_WORD_COUNT * 2, fillerSource(50));

        expect(dealt.filter(isContested)).toHaveLength(CHALLENGE_WORD_COUNT);
    });
});

describe("challenge round launches", () => {
    it("can launch every game a challenge sequence may draw", () => {
        // The server draws from CHALLENGE_GAMES and stores the result, so a game the
        // client cannot open is a round the player is simply stuck on.
        const missing = CHALLENGE_GAMES.filter(
            (game) => !challengeLaunchFor("11111111-1111-4111-8111-111111111111", 1, {
                gameId: game.gameId,
                mode: game.mode,
            })
        ).map((game) => game.gameId);

        expect(missing).toEqual([]);
    });

    it("carries the round's identity in the URL, not in nav state", () => {
        // Nav state does not survive a reload; a player who reloads mid-round must
        // land back in the same scored round rather than in a casual game.
        const launch = challengeLaunchFor("abc", 2, { gameId: "word-search", mode: "pinyin" });
        expect(launch?.to).toContain("challengeId=abc");
        expect(launch?.to).toContain("gameId=word-search");
        expect(launch?.to).toContain("mode=pinyin");
        // The page still needs its own nav state to avoid bouncing to the hub.
        expect(launch?.state).toMatchObject({ mode: "pinyin" });
    });

    it("omits `mode` for a game that has only one", () => {
        const launch = challengeLaunchFor("abc", 1, { gameId: "bubble-match", mode: null });
        expect(launch?.to).not.toContain("mode=");
        // Bubble Match bounces to /games without a level, so the launch must state it.
        expect(launch?.state).toMatchObject({ level: 2 });
    });
});
