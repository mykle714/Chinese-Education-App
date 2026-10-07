import { describe, it, expect } from "vitest";
import { dealQueue, resolveDrop, resizeQueue, unshownWords, type BucketQueueState, type Rng } from "../games/bucket-drop/bucketQueue";

/** A deterministic PRNG (mulberry32), so a failure is reproducible. */
function seeded(seed: number): Rng {
    let a = seed;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const WORDS = Array.from({ length: 20 }, (_, i) => i + 1);

/** The invariants every state must hold. */
function expectValid(state: BucketQueueState) {
    const shown = state.slots.filter((id): id is number => id !== null);
    // No word has two buckets.
    expect(new Set(shown).size).toBe(shown.length);
    // Every bucket belongs to a word still in play.
    for (const id of shown) expect(state.remaining).toContain(id);
    // No slot sits empty while an unshown word is waiting.
    if (unshownWords(state).length > 0) expect(state.slots.every((id) => id !== null)).toBe(true);
    // While words remain, at least one is placeable.
    if (state.remaining.length > 0 && state.slots.length > 0) expect(shown.length).toBeGreaterThan(0);
}

describe("Bucket Drop queue", () => {
    it("deals random buckets into every slot", () => {
        const state = dealQueue(WORDS, 12, seeded(1));
        expectValid(state);
        expect(state.slots.filter((id) => id !== null)).toHaveLength(12);
    });

    it("plays a full 20-word run to the end, placing any showing word in any order", () => {
        for (const seed of [1, 2, 3, 42, 99]) {
            const rng = seeded(seed);
            let state = dealQueue(WORDS, 12, rng);
            let drops = 0;
            while (state.remaining.length > 0) {
                // The player picks ANY placeable word, not a fixed top.
                const placeable = state.slots.map((id, i) => [id, i] as const).filter(([id]) => id !== null);
                const [word, slot] = placeable[Math.floor(rng() * placeable.length)];
                state = resolveDrop(state, slot, word!, rng);
                drops += 1;
                expectValid(state);
            }
            expect(drops).toBe(WORDS.length);
            expect(state.slots.every((id) => id === null)).toBe(true);
        }
    });

    it("returns the same state for a wrong drop", () => {
        const state = dealQueue(WORDS, 12, seeded(5));
        const wrongWord = state.slots[1]!;
        expect(resolveDrop(state, 0, wrongWord, seeded(6))).toBe(state);
    });

    it("leaves slots empty when fewer words remain than slots", () => {
        const state = dealQueue([1, 2, 3], 12, seeded(7));
        expectValid(state);
        expect(state.slots.filter((id) => id !== null)).toHaveLength(3);
    });

    it("keeps buckets in place on a grow, and returns cut buckets to the pool on a shrink", () => {
        const rng = seeded(11);
        const state = dealQueue(WORDS, 8, rng);
        const grown = resizeQueue(state, 12, rng);
        expect(grown.slots.slice(0, 8)).toEqual(state.slots);
        expectValid(grown);

        const shrunk = resizeQueue(grown, 2, rng);
        expect(shrunk.slots).toEqual(grown.slots.slice(0, 2));
        expectValid(shrunk);
    });

    it("fills an unmeasured deal once the field has slots", () => {
        const rng = seeded(13);
        const measured = resizeQueue(dealQueue(WORDS, 0, rng), 10, rng);
        expectValid(measured);
        expect(measured.slots.every((id) => id !== null)).toBe(true);
    });
});
