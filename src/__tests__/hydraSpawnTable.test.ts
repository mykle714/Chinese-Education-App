import { describe, it, expect } from "vitest";
import {
    HYDRA_SPAWN_ANCHORS,
    PAYOUT_BY_COLOR,
    DRAIN_ONLY_FILL,
    DRAIN_ONLY_WEIGHTS,
    expectedPayoutAt,
    rollColor,
    spawnWeightsAt,
} from "../games/hydra-bubbles/spawnTable";
import { HYDRA_COLORS, type HydraColor } from "../games/hydra-bubbles/types";

/**
 * Hydra Bubbles — the spawn table (docs/HYDRA_BUBBLES.md § 3).
 *
 * These tests pin the ECONOMY, which is the game's central design decision: the
 * board must creep upward on its own everywhere below the squeeze, and must be able
 * to only shrink inside it. A tuning pass may move the anchor numbers freely — what
 * it may NOT do is flip either of those signs without someone noticing.
 */
describe("hydra spawn table", () => {
    it("every anchor row sums to 100%", () => {
        for (const anchor of HYDRA_SPAWN_ANCHORS) {
            const total = HYDRA_COLORS.reduce((n, c) => n + anchor.weights[c], 0);
            expect(total, `anchor at fill ${anchor.fill}`).toBe(100);
        }
    });

    it("anchors are in strictly increasing fill order", () => {
        for (let i = 1; i < HYDRA_SPAWN_ANCHORS.length; i++) {
            expect(HYDRA_SPAWN_ANCHORS[i].fill).toBeGreaterThan(HYDRA_SPAWN_ANCHORS[i - 1].fill);
        }
    });

    it("interpolates linearly between two anchors", () => {
        const [lo, hi] = HYDRA_SPAWN_ANCHORS;
        const mid = (lo.fill + hi.fill) / 2;
        const weights = spawnWeightsAt(mid);
        for (const color of HYDRA_COLORS) {
            expect(weights[color]).toBeCloseTo((lo.weights[color] + hi.weights[color]) / 2, 6);
        }
    });

    it("clamps below the first anchor, and plateaus between the last one and the squeeze", () => {
        expect(spawnWeightsAt(-1)).toEqual(HYDRA_SPAWN_ANCHORS[0].weights);
        const last = HYDRA_SPAWN_ANCHORS[HYDRA_SPAWN_ANCHORS.length - 1];
        // The gap between the last growth anchor and DRAIN_ONLY_FILL HOLDS its
        // distribution. If it interpolated toward drain-only instead, expected payout
        // would fall below break-even almost immediately — see DRAIN_ONLY_WEIGHTS.
        expect(spawnWeightsAt(last.fill + 0.01)).toEqual(last.weights);
        expect(spawnWeightsAt(DRAIN_ONLY_FILL - 0.001)).toEqual(last.weights);
    });

    it("steps to drain-only at the squeeze and stays there", () => {
        expect(spawnWeightsAt(DRAIN_ONLY_FILL)).toEqual(DRAIN_ONLY_WEIGHTS);
        expect(spawnWeightsAt(0.99)).toEqual(DRAIN_ONLY_WEIGHTS);
        expect(spawnWeightsAt(1.5)).toEqual(DRAIN_ONLY_WEIGHTS);
    });

    // ── The economy ──────────────────────────────────────────────────────────
    it("is NOT self-stabilizing: expected payout exceeds 2 everywhere below the squeeze", () => {
        // 2 is break-even — a match clears two bubbles. Anything above it means the
        // board grows on its own, which is the whole premise of § 3.
        for (let fill = 0; fill < DRAIN_ONLY_FILL; fill += 0.01) {
            expect(expectedPayoutAt(fill), `fill ${fill.toFixed(2)}`).toBeGreaterThan(2);
        }
    });

    it("requires bloom to be the MAJORITY of every growth-zone roll", () => {
        // THE TWO-COLOR IDENTITY (2026-08-21), and the reason the old mix could not be
        // carried over. With a symmetric ±1 ladder, net growth per match is exactly
        // `2·bloomShare − 1`, so "the board grows on its own" is equivalent to "bloom is
        // over half". The four-color table put 65% of rolls on its two hard colors;
        // merged verbatim that is a board that DRAINS on its own.
        //
        // This is the same claim as the test above, asserted on the weights rather
        // than through E[payout] — so a future tuning pass that breaks it reads a
        // failure naming the actual constraint rather than an arithmetic one.
        for (let fill = 0; fill < DRAIN_ONLY_FILL; fill += 0.01) {
            const w = spawnWeightsAt(fill);
            const bloomShare = w.bloom / (w.bloom + w.drain);
            expect(bloomShare, `fill ${fill.toFixed(2)}`).toBeGreaterThan(0.5);
            expect(expectedPayoutAt(fill) - 2).toBeCloseTo(2 * bloomShare - 1, 10);
        }
    });

    it("pays below break-even inside the squeeze, so the board can only shrink there", () => {
        // Drain pays 1 against the 2 a match removes, so the zone is −1 per match. The
        // assertion is on the SIGN, not on the value, so the next payout tuning cannot
        // silently make the squeeze survivable-by-standing-still.
        expect(expectedPayoutAt(DRAIN_ONLY_FILL)).toBeLessThan(2);
        expect(expectedPayoutAt(0.9)).toBeLessThan(2);
        expect(expectedPayoutAt(DRAIN_ONLY_FILL)).toBe(PAYOUT_BY_COLOR.drain);
    });

    it("keeps the squeeze reachable — the drain-only floor sits below the loss line", () => {
        // If these crossed, the player would lose before ever entering the zone the
        // game is built around.
        expect(DRAIN_ONLY_FILL).toBeLessThan(0.94);
    });

    it("makes bloom available everywhere except the squeeze", () => {
        // Challenge words ride the BLUE slot since 2026-08-21 (§ 7.5) — they moved off
        // yellow when yellow was removed — and free play must roll the same table, so
        // bloom's availability is a contract rather than a tuning artifact.
        //
        // The squeeze is the one place a challenge word cannot spawn, and that is
        // accepted: it is a bounded emergency zone the player is actively digging out
        // of, not a state a run sits in. The old table had the mirror-image exemption
        // (yellow was absent from the bloom-only opening); this one is the only gap.
        for (let fill = 0; fill < DRAIN_ONLY_FILL; fill += 0.01) {
            expect(spawnWeightsAt(fill).bloom, `fill ${fill.toFixed(2)}`).toBeGreaterThan(0);
        }
        expect(spawnWeightsAt(DRAIN_ONLY_FILL).bloom).toBe(0);
    });

    // ── Rolling ──────────────────────────────────────────────────────────────
    it("rolls only drain inside the squeeze", () => {
        for (let i = 0; i < 50; i++) {
            expect(rollColor(0.8, () => i / 50)).toBe("drain");
        }
    });

    it("walks the cumulative distribution in order", () => {
        // The fill-0 row is walked in the key order of the weights object.
        const order = Object.keys(spawnWeightsAt(0)) as HydraColor[];
        expect(rollColor(0, () => 0)).toBe(order[0]);
        // A roll landing at the very top of the range still returns a valid color
        // rather than falling off the end.
        expect(HYDRA_COLORS).toContain(rollColor(0, () => 0.999999));
    });

    it("holds ONE mix across the whole steady state", () => {
        // The table is three states — opening, steady state, squeeze — not a curve.
        // If a future tuning pass reintroduces intermediate anchors, this fails and
        // the author has to decide deliberately rather than by accident.
        const steady = spawnWeightsAt(0.1);
        for (const fill of [0.1, 0.2, 0.35, 0.5, 0.65, 0.74]) {
            expect(spawnWeightsAt(fill), `fill ${fill}`).toEqual(steady);
            expect(expectedPayoutAt(fill), `fill ${fill}`).toBeCloseTo(2.1, 10);
        }
        // Exactly two growth anchors: the opening and the steady state.
        expect(HYDRA_SPAWN_ANCHORS).toHaveLength(2);
    });

    it("offers drain early enough to be a real option", () => {
        // Drain is the ONLY way to shrink the board, so a table that withholds it until
        // the board is already half full denies the player the very trade § 3 calls
        // the game. It is a flat 45% from the first tenth onward — the most it can be
        // while the board still grows on its own.
        expect(spawnWeightsAt(0.1).drain).toBe(45);
        expect(spawnWeightsAt(0.3).drain).toBe(45);
        expect(spawnWeightsAt(0.7).drain).toBe(45);
        // Still absent from the bloom-only opening.
        expect(spawnWeightsAt(0).drain).toBe(0);
    });

    it("never rolls a zero-weight color", () => {
        // Drain is 0% at fill 0, so 200 evenly-spaced rolls must never produce it.
        for (let i = 0; i < 200; i++) {
            expect(rollColor(0, () => i / 200)).not.toBe("drain");
        }
    });

    it("opens on bloom and nothing else", () => {
        // An empty board rolls 100% bloom (§ 3.1). This is what makes the opening
        // board's composition a consequence of the table rather than a hard-coded
        // exception in HydraStage — which is exactly how the old opening drifted from
        // the economy it was supposed to express.
        for (let i = 0; i < 200; i++) {
            expect(rollColor(0, () => i / 200)).toBe("bloom");
        }
        expect(expectedPayoutAt(0)).toBe(PAYOUT_BY_COLOR.bloom); // 3.00 — the fastest growth in the game
    });

    it("ramps drain in as the board fills", () => {
        // Bloom-only is a POINT, not a zone: by the 0.10 anchor the full mix is already
        // in play. A step here instead of a ramp would give the player a cliff a few
        // bubbles into every run.
        expect(spawnWeightsAt(0).drain).toBe(0);
        expect(spawnWeightsAt(0.05).drain).toBeGreaterThan(0);
        expect(spawnWeightsAt(0.05).bloom).toBeLessThan(100);
        expect(spawnWeightsAt(0.25).drain).toBe(45);
    });

    it("pays out the two-color ladder, one step either side of break-even", () => {
        // A match always removes 2, so these ARE the net board deltas: −1 and +1.
        // Symmetry is the design (§ 2) — the player reads one bit off the bubble, not
        // a four-rung table — so both the values and their distance from 2 matter.
        expect(PAYOUT_BY_COLOR.drain).toBe(1);
        expect(PAYOUT_BY_COLOR.bloom).toBe(3);
        expect(2 - PAYOUT_BY_COLOR.drain).toBe(PAYOUT_BY_COLOR.bloom - 2);
    });

    it("keeps drain strictly cheaper than bloom", () => {
        // The economy is expressed as a RANKING — riskier color, smaller payout — and
        // every § 3 argument rests on that ordering rather than on the two values.
        expect(PAYOUT_BY_COLOR.drain).toBeLessThan(PAYOUT_BY_COLOR.bloom);
        // And there are exactly two of them: a third would reintroduce a rung the
        // player has to memorize rather than read.
        expect(HYDRA_COLORS).toHaveLength(2);
    });
});
