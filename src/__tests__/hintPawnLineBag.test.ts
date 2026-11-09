import { describe, expect, it } from "vitest";
import { dealLineBag, takeHintLineIndex } from "../features/flashcards/FlashcardsLearnPage/hintPawn/hintPawnVisit";

// docs/HINT_PAWN.md § "The lines": random order from a shuffle bag, every line once per
// round, never the same line twice in a row.
describe("hint pawn line bag", () => {
    it("deals every index exactly once", () => {
        const bag = dealLineBag(10, -1);
        expect([...bag].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("never deals the avoided index first", () => {
        for (let avoid = 0; avoid < 10; avoid++) {
            for (let k = 0; k < 50; k++) {
                const bag = dealLineBag(10, avoid);
                expect(bag[bag.length - 1]).not.toBe(avoid);
            }
        }
    });

    it("says each line once per round and never repeats back to back", () => {
        const taken = Array.from({ length: 40 }, () => takeHintLineIndex("test-round", 10));
        for (let round = 0; round < 4; round++) {
            const slice = taken.slice(round * 10, round * 10 + 10);
            expect(new Set(slice).size).toBe(10);
        }
        for (let i = 1; i < taken.length; i++) expect(taken[i]).not.toBe(taken[i - 1]);
    });

    it("keeps a separate round per kind", () => {
        const a = Array.from({ length: 5 }, () => takeHintLineIndex("test-kind-a", 5));
        // Taking from another kind mid-round must not disturb kind a's round.
        takeHintLineIndex("test-kind-b", 5);
        const aNext = Array.from({ length: 5 }, () => takeHintLineIndex("test-kind-a", 5));
        expect(new Set(a).size).toBe(5);
        expect(new Set(aNext).size).toBe(5);
    });

    it("skips ineligible lines without dropping them from the round", () => {
        // Lines 0 and 1 are conditional; this card only fits 2, 3, 4.
        const fitsThree = (i: number) => i >= 2;
        const first = Array.from({ length: 3 }, () => takeHintLineIndex("test-skip", 5, fitsThree));
        expect([...first].sort()).toEqual([2, 3, 4]);
        // A card that fits everything then gets the two skipped lines before a new round.
        const rest = Array.from({ length: 2 }, () => takeHintLineIndex("test-skip", 5));
        expect([...rest].sort()).toEqual([0, 1]);
    });

    it("returns 0 when nothing is eligible", () => {
        expect(takeHintLineIndex("test-none", 4, () => false)).toBe(0);
    });
});
