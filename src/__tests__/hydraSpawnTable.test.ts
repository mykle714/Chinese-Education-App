import { describe, it, expect } from "vitest";
import {
    HYDRA_SPAWN_ANCHORS,
    PAYOUT_BY_COLOR,
    RED_ONLY_FILL,
    RED_ONLY_WEIGHTS,
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
        // The gap between the last growth anchor and RED_ONLY_FILL HOLDS its
        // distribution. If it interpolated toward red-only instead, expected payout
        // would fall below break-even well before the squeeze — see RED_ONLY_WEIGHTS.
        expect(spawnWeightsAt(last.fill + 0.01)).toEqual(last.weights);
        expect(spawnWeightsAt(RED_ONLY_FILL - 0.001)).toEqual(last.weights);
    });

    it("steps to red-only at the squeeze and stays there", () => {
        expect(spawnWeightsAt(RED_ONLY_FILL)).toEqual(RED_ONLY_WEIGHTS);
        expect(spawnWeightsAt(0.99)).toEqual(RED_ONLY_WEIGHTS);
        expect(spawnWeightsAt(1.5)).toEqual(RED_ONLY_WEIGHTS);
    });

    // ── The economy ──────────────────────────────────────────────────────────
    it("is NOT self-stabilizing: expected payout exceeds 2 everywhere below the squeeze", () => {
        // 2 is break-even — a match clears two bubbles. Anything above it means the
        // board grows on its own, which is the whole premise of § 3.
        for (let fill = 0; fill < RED_ONLY_FILL; fill += 0.01) {
            expect(expectedPayoutAt(fill), `fill ${fill.toFixed(2)}`).toBeGreaterThan(2);
        }
    });

    it("pays zero inside the squeeze, so the board can only shrink there", () => {
        expect(expectedPayoutAt(RED_ONLY_FILL)).toBe(0);
        expect(expectedPayoutAt(0.9)).toBe(0);
    });

    it("keeps the squeeze reachable — the red-only floor sits below the loss line", () => {
        // If these crossed, the player would lose before ever entering the zone the
        // game is built around.
        expect(RED_ONLY_FILL).toBeLessThan(0.94);
    });

    it("yellow holds at least a fifth of every growth-zone roll after the opening", () => {
        // Challenge words ride the yellow slot (§ 7.5) and free play must roll the
        // same table, so yellow's share is a floor rather than a tuning artifact.
        //
        // THE FLOOR WAS 25 AND IS NOW 22 (2026-08-18). Pushing red to a flat 8% had to
        // come out of somewhere, and it came out of blue and yellow. Yellow's range is
        // now 22–25% rather than 25–30%, so a challenge word surfaces somewhat less
        // often per spawn — acceptable because the red increase also makes the board
        // turn over faster, but it is a REAL reduction and not a rounding change. If
        // challenge rounds start feeling starved of contested words, raise this back
        // and take the points out of blue instead.
        //
        // THE FILL-0 ROW IS EXEMPT, and it is the one exception the floor tolerates:
        // an empty board rolls blue-only, so a challenge word cannot spawn onto it.
        // That costs a challenge nothing — the board is empty for one spawn batch at
        // the very start of a run, and yellow is back to 28% by the 0.25 anchor. The
        // exemption is narrow ON PURPOSE: a second zero-yellow anchor would start
        // starving challenge scoring, so this asserts exactly one.
        const zeroYellow = HYDRA_SPAWN_ANCHORS.filter((a) => a.weights.Target === 0);
        expect(zeroYellow.map((a) => a.fill)).toEqual([0]);

        for (const anchor of HYDRA_SPAWN_ANCHORS) {
            if (anchor.fill >= RED_ONLY_FILL || anchor.fill === 0) continue;
            expect(anchor.weights.Target, `anchor at fill ${anchor.fill}`).toBeGreaterThanOrEqual(22);
        }
    });

    // ── Rolling ──────────────────────────────────────────────────────────────
    it("rolls only red inside the squeeze", () => {
        for (let i = 0; i < 50; i++) {
            expect(rollColor(0.8, () => i / 50)).toBe("Unfamiliar");
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
            expect(expectedPayoutAt(fill), `fill ${fill}`).toBeCloseTo(2.08, 10);
        }
        // Exactly two growth anchors: the opening and the steady state.
        expect(HYDRA_SPAWN_ANCHORS).toHaveLength(2);
    });

    it("offers red early enough to be a real option", () => {
        // Red is the ONLY way to shrink the board, so a table that withholds it until
        // the board is already half full denies the player the very trade § 3 calls
        // the game. It used to be 0% below fill 0.45; it is now on offer from the
        // first tenth and flat at 8% thereafter.
        expect(spawnWeightsAt(0.1).Unfamiliar).toBe(8);
        expect(spawnWeightsAt(0.3).Unfamiliar).toBe(8);
        expect(spawnWeightsAt(0.7).Unfamiliar).toBe(8);
        // Still absent from the blue-only opening.
        expect(spawnWeightsAt(0).Unfamiliar).toBe(0);
    });

    it("never rolls a zero-weight color", () => {
        // Red is 0% at fill 0, so 200 evenly-spaced rolls must never produce it.
        for (let i = 0; i < 200; i++) {
            expect(rollColor(0, () => i / 200)).not.toBe("Unfamiliar");
        }
    });

    it("opens on blue and nothing else", () => {
        // An empty board rolls 100% blue (§ 3.1). This is what makes the opening
        // board's composition a consequence of the table rather than a hard-coded
        // exception in HydraStage — which is exactly how the old opening drifted from
        // the economy it was supposed to express.
        for (let i = 0; i < 200; i++) {
            expect(rollColor(0, () => i / 200)).toBe("Mastered");
        }
        expect(expectedPayoutAt(0)).toBe(3);
    });

    it("ramps the other colors in as the board fills", () => {
        // Blue-only is a POINT, not a zone: by the 0.10 anchor the full mix is already
        // in play. A step here instead of a ramp would give the player a cliff a few
        // bubbles into every run.
        expect(spawnWeightsAt(0).Target).toBe(0);
        expect(spawnWeightsAt(0.05).Target).toBeGreaterThan(0);
        expect(spawnWeightsAt(0.05).Mastered).toBeLessThan(100);
        expect(spawnWeightsAt(0.25).Target).toBe(24);
    });

    it("pays out the documented ladder", () => {
        expect(PAYOUT_BY_COLOR.Unfamiliar).toBe(0);
        expect(PAYOUT_BY_COLOR.Target).toBe(1);
        expect(PAYOUT_BY_COLOR.Comfortable).toBe(2);
        expect(PAYOUT_BY_COLOR.Mastered).toBe(3);
    });
});
