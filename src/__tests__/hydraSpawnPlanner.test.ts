import { describe, it, expect } from "vitest";
import {
    hasLiveMatch,
    nextKindByRatio,
    pickBalancedColor,
    planSpawnBatch,
    straysOf,
    type HydraBoardPair,
    type HydraBoardView,
} from "../games/hydra-bubbles/spawnPlanner";
import { DRAIN_ONLY_FILL, spawnWeightsAt } from "../games/hydra-bubbles/spawnTable";
import { HYDRA_COLORS, type HydraColor } from "../games/hydra-bubbles/types";

/**
 * Hydra Bubbles — the spawn algorithm (docs/HYDRA_BUBBLES.md § 4).
 *
 * The two invariants of § 4.3 are what these tests exist for. Everything else about
 * the spawn distribution is tunable; "the board always has something matchable" and
 * "the board can never run to nothing" are not.
 */

const pair = (id: string, hasWord: boolean, hasDefinition: boolean): HydraBoardPair => ({
    pairId: id,
    color: "drain",
    hasWord,
    hasDefinition,
    unmatchedRounds: 0,
});

const board = (pairs: HydraBoardPair[], fill = 0.3): HydraBoardView => ({ fill, pairs });

/** A deterministic rng cycling through fixed values, for reproducible rolls. */
const seq = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
};

/** Replay a plan onto a board view so the invariants can be checked after it runs. */
function applyPlan(view: HydraBoardView, actions: ReturnType<typeof planSpawnBatch>): HydraBoardPair[] {
    const pairs = view.pairs.map((p) => ({ ...p }));
    const plannedToReal = new Map<string, string>();
    for (const action of actions) {
        if (action.type === "complete") {
            const id = plannedToReal.get(action.pairId) ?? action.pairId;
            const target = pairs.find((p) => p.pairId === id);
            if (!target) continue;
            if (action.kind === "word") target.hasWord = true;
            else target.hasDefinition = true;
            continue;
        }
        const realId = `real-${pairs.length}`;
        plannedToReal.set(action.plannedId, realId);
        pairs.push({
            pairId: realId,
            color: action.color,
            hasWord: action.type === "newPair" || action.kind === "word",
            hasDefinition: action.type === "newPair" || action.kind === "definition",
            unmatchedRounds: 0,
        });
    }
    return pairs;
}

describe("nextKindByRatio", () => {
    it("opens with English, because the odd bubble is carried as English", () => {
        expect(nextKindByRatio(0, 0)).toBe("definition");
    });

    it("balances back toward 50/50", () => {
        expect(nextKindByRatio(0, 1)).toBe("word");
        expect(nextKindByRatio(1, 1)).toBe("definition");
        expect(nextKindByRatio(1, 2)).toBe("word");
        expect(nextKindByRatio(3, 1)).toBe("definition");
    });
});

describe("board queries", () => {
    it("finds a live match only when both halves are present", () => {
        expect(hasLiveMatch([pair("a", true, false)])).toBe(false);
        expect(hasLiveMatch([pair("a", true, false), pair("b", false, true)])).toBe(false);
        expect(hasLiveMatch([pair("a", true, true)])).toBe(true);
    });

    it("counts a card with exactly one half as a stray", () => {
        expect(straysOf([pair("a", true, false), pair("b", true, true)]).map((p) => p.pairId)).toEqual(["a"]);
    });
});

describe("planSpawnBatch — slot budget", () => {
    it("spends exactly `payout` bubbles when the board already has a live match", () => {
        const view = board([pair("a", true, true)]);
        for (const payout of [1, 2, 3]) {
            const actions = planSpawnBatch(view, payout, seq([0.1, 0.5, 0.9]));
            const bubbles = actions.reduce((n, a) => n + (a.type === "newPair" ? 2 : 1), 0);
            expect(bubbles, `payout ${payout}`).toBe(payout);
        }
    });

    it("spends exactly one bubble on a drain clear, against the two it removed", () => {
        // Drain is the ONLY move that shrinks the board (§ 2), and this is where that
        // property actually lives: one slot spent against two bubbles cleared, net −1.
        const actions = planSpawnBatch(board([pair("a", true, true)]), 1, seq([0.5]));
        const bubbles = actions.reduce((n, a) => n + (a.type === "newPair" ? 2 : 1), 0);
        expect(bubbles).toBe(1);
    });

    it("spawns nothing at a payout of 0, which no color pays any more", () => {
        // A defensive edge, not a game state: the ladder's floor is drain = 1 since the
        // 2026-08-19 raise, so nothing calls this. Pinned so the branch cannot start
        // spawning free bubbles if a future tuning drops a color back to zero.
        expect(planSpawnBatch(board([pair("a", true, true)]), 0, seq([0.5]))).toEqual([]);
    });

    it("opens a payout of 3 with a fresh matched pair", () => {
        const actions = planSpawnBatch(board([pair("a", true, true)]), 3, seq([0.5]));
        expect(actions[0].type).toBe("newPair");
    });
});

describe("planSpawnBatch — the invariants (§ 4.3)", () => {
    it("leaves a live match after every payout, from every board shape", () => {
        const shapes: HydraBoardPair[][] = [
            [], // empty board — the anti-zero case
            [pair("a", true, false)], // one Chinese stray
            [pair("a", false, true)], // one English stray
            [pair("a", true, false), pair("b", false, true)], // two mismatched strays
            [pair("a", true, true)], // already live
        ];
        for (const shape of shapes) {
            for (const payout of [0, 1, 2, 3]) {
                for (const roll of [0.01, 0.33, 0.67, 0.99]) {
                    const view = board(shape);
                    const after = applyPlan(view, planSpawnBatch(view, payout, seq([roll])));
                    expect(
                        hasLiveMatch(after),
                        `shape ${shape.length} / payout ${payout} / roll ${roll}`
                    ).toBe(true);
                }
            }
        }
    });

    it("anti-zero fires on a drain clear that would strand the board", () => {
        // Payout 0 AND no live match: the guarantee has to spawn even though the
        // ladder paid nothing, or the board dead-ends with nothing matchable.
        const view = board([pair("a", true, false)]);
        const actions = planSpawnBatch(view, 0, seq([0.5]));
        expect(actions.length).toBeGreaterThan(0);
        expect(hasLiveMatch(applyPlan(view, actions))).toBe(true);
    });

    it("anti-zero overrides the drain-only squeeze", () => {
        // Inside the squeeze the table rolls drain exclusively, but a board with no
        // live match must still be given one — a dead end is worse than an easy match.
        const view = board([pair("a", false, true)], DRAIN_ONLY_FILL + 0.1);
        const actions = planSpawnBatch(view, 0, seq([0.5]));
        expect(hasLiveMatch(applyPlan(view, actions))).toBe(true);
    });

    it("completes an existing stray rather than drawing a new card", () => {
        // The cheapest way to satisfy the invariant: no card is drawn, so a long run
        // does not burn through the buffers (and the lend supply) to stay legal.
        const view = board([pair("a", true, false)]);
        const actions = planSpawnBatch(view, 0, seq([0.5]));
        expect(actions).toEqual([{ type: "complete", pairId: "a", kind: "definition" }]);
    });

    it("spawns a fresh pair when there is no stray to complete", () => {
        const view = board([]);
        const actions = planSpawnBatch(view, 0, seq([0.5]));
        expect(actions).toHaveLength(1);
        expect(actions[0].type).toBe("newPair");
    });
});

describe("planSpawnBatch — purity", () => {
    it("never mutates the caller's board view", () => {
        const pairs = [pair("a", true, false)];
        const view = board(pairs);
        const snapshot = JSON.stringify(view);
        planSpawnBatch(view, 3, seq([0.2, 0.4, 0.6]));
        expect(JSON.stringify(view)).toBe(snapshot);
    });

    it("labels every planned card so a later slot can complete it", () => {
        const view = board([pair("a", true, true)]);
        const actions = planSpawnBatch(view, 3, seq([0.5]));
        const planned = actions.filter((a) => a.type !== "complete");
        const ids = planned.map((a) => (a as { plannedId: string }).plannedId);
        expect(new Set(ids).size, "planned ids must be unique within a batch").toBe(ids.length);
    });
});


describe("pickBalancedColor", () => {
    const colored = (colors: HydraColor[]): HydraBoardPair[] =>
        colors.map((color, i) => ({
            pairId: `p${i}`,
            color,
            hasWord: true,
            hasDefinition: true,
            unmatchedRounds: 0,
        }));

    it("picks whichever color is furthest below the target mix", () => {
        // Steady state is bloom 55 / drain 45. On an all-bloom board of 4 the post-spawn
        // targets are bloom 2.75 / drain 2.25, so drain carries the whole deficit (+2.25
        // against bloom's −1.25) and comes next.
        const allBlue = colored(["bloom", "bloom", "bloom", "bloom"]);
        expect(pickBalancedColor(allBlue, 0.3, () => 0)).toBe("drain");
    });

    it("falls back to a plain roll on an empty board", () => {
        // Nothing to balance against — and this is what preserves the bloom-only
        // opening (§ 3.1), which would otherwise be overridden by the balancer.
        expect(pickBalancedColor([], 0, () => 0)).toBe("bloom");
        expect(pickBalancedColor([], 0, () => 0.99)).toBe("bloom");
    });

    it("only ever yields drain inside the squeeze", () => {
        // The target there is drain 100%, so bloom is permanently at or over quota no
        // matter what the board looks like.
        const mixed = colored(["bloom", "bloom", "drain", "bloom"]);
        expect(pickBalancedColor(mixed, DRAIN_ONLY_FILL + 0.05, () => 0)).toBe("drain");
    });

    it("drives the BOARD's mix to the §3.1 weights", () => {
        // THE LOAD-BEARING TEST, and note what it asserts: the composition of the
        // BOARD, not the frequency of spawns. Those are different claims, and the
        // board is the one that matters — §3's payouts are collected on what the
        // player CLEARS, so what the economy depends on is the mix of colors standing
        // in front of them. It is also the only one that survives contact with a real
        // player: they clear colors selectively, so the balancer keeps replacing
        // whatever they drain and spawn frequencies drift by design. That drift is the
        // feature (availability holds up under any play style); the board mix is the
        // invariant.
        const fill = 0.3;
        const target = spawnWeightsAt(fill);
        const boardPairs: HydraBoardPair[] = [];
        for (let i = 0; i < 400; i++) {
            const color = pickBalancedColor(boardPairs, fill, () => 0);
            boardPairs.push({ pairId: `s${i}`, color, hasWord: true, hasDefinition: true, unmatchedRounds: 0 });
            // Retire a RANDOM card rather than the oldest, standing in for a player
            // clearing whatever they please. FIFO would be a gentler test.
            if (boardPairs.length > 25) boardPairs.splice(i % boardPairs.length, 1);
        }
        const actual: Record<HydraColor, number> = { drain: 0, bloom: 0 };
        for (const p of boardPairs) actual[p.color] += 1;
        for (const color of HYDRA_COLORS) {
            const pct = (actual[color] / boardPairs.length) * 100;
            // Within 6 points — the board is only ~25 cards, so one card is 4 points.
            expect(pct, `${color} share of board`).toBeGreaterThan(target[color] - 6);
            expect(pct, `${color} share of board`).toBeLessThan(target[color] + 6);
        }
    });

    it("guarantees drain appears regularly rather than in clumps", () => {
        // Drain is 45% of the mix and the player's ONLY way to shrink the board, so what
        // matters is not its average but that it never goes missing for long. An
        // independent roll can withhold it for a long stretch; balancing cannot — and
        // at 45% the bound should be TIGHT, which is what the assertion checks.
        const fill = 0.3;
        const boardPairs: HydraBoardPair[] = [];
        let sinceRed = 0;
        let worstGap = 0;
        for (let i = 0; i < 600; i++) {
            const color = pickBalancedColor(boardPairs, fill, () => 0);
            sinceRed = color === "drain" ? 0 : sinceRed + 1;
            worstGap = Math.max(worstGap, sinceRed);
            boardPairs.push({ pairId: `s${i}`, color, hasWord: true, hasDefinition: true, unmatchedRounds: 0 });
            if (boardPairs.length > 12) boardPairs.shift();
        }
        // 45% => roughly every other spawn; a bounded gap is the point.
        expect(worstGap).toBeLessThan(5);
    });
});


describe("stray aging (§ 4.2c)", () => {
    const stray = (id: string, unmatchedRounds: number): HydraBoardPair => ({
        pairId: id,
        color: "drain",
        hasWord: true,
        hasDefinition: false,
        unmatchedRounds,
    });
    const live = (id: string): HydraBoardPair => ({
        pairId: id,
        color: "bloom",
        hasWord: true,
        hasDefinition: true,
        unmatchedRounds: 0,
    });

    it("ignores strays that have not waited yet", () => {
        // A stray created this round has zero shares, so the slot must introduce a new
        // card. Without this, a fresh stray would be completed immediately and the
        // board would never build up anything for the player to work toward.
        const view = board([live("a"), stray("fresh", 0)], 0.3);
        const actions = planSpawnBatch(view, 2, seq([0, 0, 0, 0]));
        expect(actions.every((a) => a.type !== "complete")).toBe(true);
    });

    it("completes a long-stranded stray instead of adding another card", () => {
        // 40 rounds against NEW_CARD_SHARES = 6: the stray holds ~87% of the shares,
        // so all but the highest rolls land on it.
        const view = board([live("a"), stray("old", 40)], 0.3);
        const actions = planSpawnBatch(view, 2, seq([0.1, 0.1, 0.1, 0.1]));
        const completed = actions.filter((a) => a.type === "complete");
        expect(completed.length).toBeGreaterThan(0);
        expect(completed[0]).toMatchObject({ pairId: "old", kind: "definition" });
    });

    it("completes the half that is actually missing", () => {
        const missingWord: HydraBoardPair = {
            pairId: "w",
            color: "drain",
            hasWord: false,
            hasDefinition: true,
            unmatchedRounds: 40,
        };
        const actions = planSpawnBatch(board([live("a"), missingWord], 0.3), 2, seq([0.1]));
        const completed = actions.find((a) => a.type === "complete");
        expect(completed).toMatchObject({ pairId: "w", kind: "word" });
    });

    it("lets a backlog of orphans crowd out new cards", () => {
        // Shares SUM, which is what makes the mechanism self-limiting: the more the
        // board silts up, the more of every batch goes to clearing it. Five strays at
        // 10 rounds hold 50 shares against 6, so a mid-range roll cannot reach the
        // new-card option.
        const backlog = [live("a"), ...[1, 2, 3, 4, 5].map((n) => stray(`s${n}`, 10))];
        const actions = planSpawnBatch(board(backlog, 0.3), 3, seq([0.5, 0.5, 0.5, 0.5]));
        expect(actions.some((a) => a.type === "complete")).toBe(true);
    });

    it("still spawns something when every share is zero", () => {
        // The new-card option is drawn last precisely so an all-zero board cannot fall
        // off the end of the lottery and return nothing.
        const view = board([live("a"), stray("s", 0)], 0.3);
        for (const r of [0, 0.5, 0.999999]) {
            const actions = planSpawnBatch(view, 2, seq([r]));
            expect(actions.length).toBeGreaterThan(0);
        }
    });

    it("does not change how many bubbles a payout buys", () => {
        // THE ECONOMY GUARD. A `complete` and a `newStray` each cost one slot and each
        // put one bubble on the board — only WHICH bubble differs. If aging ever
        // started costing a different number of slots, §3's payout ladder would shift
        // underneath the whole game.
        for (const payout of [1, 2, 3]) {
            const aged = board([live("a"), stray("old", 99)], 0.3);
            const fresh = board([live("a"), stray("new", 0)], 0.3);
            const bubbles = (v: HydraBoardView) =>
                planSpawnBatch(v, payout, seq([0.1, 0.1, 0.1, 0.1])).reduce(
                    (n, a) => n + (a.type === "newPair" ? 2 : 1),
                    0
                );
            expect(bubbles(aged), `payout ${payout}`).toBe(bubbles(fresh));
        }
    });
});
