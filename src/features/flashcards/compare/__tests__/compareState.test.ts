import { describe, expect, it } from "vitest";
import type { DictionaryEntry, VocabEntry } from "../../../../types";
import { EMPTY_COMPARE_STATE, activeSearchSlot, isPickableFor } from "../compareState";

const word = (entryKey: string) => ({ entryKey, language: "zh" }) as unknown as VocabEntry;
const row = (word1: string) => ({ id: 1, word1 }) as unknown as DictionaryEntry;

describe("activeSearchSlot", () => {
    it("never opens the search on its own, even with a slot empty", () => {
        expect(activeSearchSlot(EMPTY_COMPARE_STATE, null)).toBeNull();
        expect(activeSearchSlot({ ...EMPTY_COMPARE_STATE, slotA: word("高兴") }, null)).toBeNull();
        expect(activeSearchSlot({ ...EMPTY_COMPARE_STATE, slotA: word("高兴") }, "B")).toBe("B");
    });

    it("shows the comparison when both are filled, unless a slot was tapped to replace", () => {
        const both = { ...EMPTY_COMPARE_STATE, slotA: word("高兴"), slotB: word("开心") };
        expect(activeSearchSlot(both, null)).toBeNull();
        expect(activeSearchSlot(both, "A")).toBe("A");
    });
});

describe("isPickableFor", () => {
    it("offers words up to four characters", () => {
        expect(isPickableFor(row("开心"), null)).toBe(true);
        expect(isPickableFor(row("一心一意"), null)).toBe(true);
        expect(isPickableFor(row("一二三四五"), null)).toBe(false);
    });

    it("leaves out the word already in the other slot", () => {
        expect(isPickableFor(row("高兴"), word("高兴"))).toBe(false);
        expect(isPickableFor(row("开心"), word("高兴"))).toBe(true);
    });
});
