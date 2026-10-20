import { describe, expect, it } from "vitest";
import { CARD_THICKNESS, cardsShowingAt, planCardCollapse } from "../iso";

/** A seeded PRNG (mulberry32), so each case is reproducible. */
function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe("planCardCollapse (docs/ISO_ART_FRAMEWORK.md § IsoCardRuns)", () => {
    it("partitions every card into exactly one run or ghost chunk, in order", () => {
        for (let seed = 1; seed <= 40; seed++) {
            const plan = planCardCollapse(120, 70, seeded(seed));
            const pieces = [...plan.runs, ...plan.ghosts].sort((a, b) => a.from - b.from);
            let next = 0;
            for (const p of pieces) {
                expect(p.from).toBe(next);
                next += p.count;
            }
            expect(next).toBe(120);
            expect(plan.ghosts.reduce((s, g) => s + g.count, 0)).toBe(70);
            expect(plan.remaining).toBe(50);
        }
    });

    it("keeps the top card (the lid) while any card is kept", () => {
        for (let seed = 1; seed <= 40; seed++) {
            const plan = planCardCollapse(30, 29, seeded(seed));
            const top = plan.runs[plan.runs.length - 1];
            expect(top.hasLid).toBe(true);
            expect(top.from + top.count).toBe(30);
            expect(plan.ghosts.every((g) => !g.hasLid)).toBe(true);
        }
    });

    it("drops each run by the ghosts beneath it, so the kept cards end contiguous", () => {
        const plan = planCardCollapse(200, 90, seeded(7));
        let landed = 0;
        for (const r of plan.runs) {
            expect(r.from - r.dropCards).toBe(landed);
            landed += r.count;
        }
        expect(landed).toBe(plan.remaining);
        // Higher runs fall at least as far — the landings ripple upward.
        for (let i = 1; i < plan.runs.length; i++) expect(plan.runs[i].fallMs).toBeGreaterThanOrEqual(plan.runs[i - 1].fallMs);
        expect(plan.runs[0].dropCards === 0 || plan.runs[0].fallMs > 0).toBe(true);
    });

    it("ghosts every card, lid included, when none is kept", () => {
        const plan = planCardCollapse(12, 12, seeded(3));
        expect(plan.runs).toHaveLength(0);
        expect(plan.remaining).toBe(0);
        expect(plan.ghosts[plan.ghosts.length - 1].hasLid).toBe(true);
    });

    it("does nothing with no ghosts", () => {
        const plan = planCardCollapse(10, 0);
        expect(plan.runs).toEqual([{ from: 0, count: 10, dropCards: 0, fallMs: 0, hasLid: true }]);
        expect(plan.durationMs).toBe(0);
    });

    it("times the longest fall by free fall over the dropped height", () => {
        const plan = planCardCollapse(50, 25, seeded(11));
        const maxDrop = Math.max(...plan.runs.map((r) => r.dropCards)) * CARD_THICKNESS;
        const longest = Math.max(...plan.runs.map((r) => r.fallMs));
        expect(longest).toBeCloseTo(Math.sqrt((2 * maxDrop) / 140) * 1000, 6);
        expect(plan.durationMs).toBeGreaterThan(plan.fallStartMs + longest);
    });

    it("counts the showing cards down to the kept total by the time everything falls", () => {
        const plan = planCardCollapse(80, 33, seeded(5));
        expect(cardsShowingAt(plan, 0)).toBe(80);
        expect(cardsShowingAt(plan, plan.fallStartMs)).toBe(47);
    });
});
