import { describe, expect, it } from "vitest";
import {
    buildOverrideLookup,
    cycleOverride,
    readingOptionsFor,
    shiftPronunciationOverrides,
} from "../reading/pronunciationOverrides";
import type { DictionaryEntry } from "../types";

// READING CHOICES rules (src/reading/pronunciationOverrides.ts).

const entry = (pronunciation: string, readings: string[]) => ({
    pronunciation,
    selectedSense: null,
    definitionClusters: readings.map((reading, i) => ({ reading, glosses: [`sense ${i}`], frequencyScore: 5 - i })),
}) as unknown as DictionaryEntry;

const de = entry("de", ["de", "de2", "dei3"]);
const target = { start: 3, end: 4, text: "得" };

describe("readingOptionsFor", () => {
    it("lists the default first, then each other distinct cluster reading", () => {
        expect(readingOptionsFor(de).map((o) => o.numbered)).toEqual([null, "de2", "dei3"]);
    });
    it("has nothing to cycle for a one-reading word", () => {
        expect(readingOptionsFor(entry("hǎo", ["hao3"])).length).toBe(1);
    });
    it("skips a reading whose syllable count differs from the default", () => {
        expect(readingOptionsFor(entry("cháng", ["chang2", "zhang3 da4"])).length).toBe(1);
    });
});

describe("cycleOverride", () => {
    const options = readingOptionsFor(de);
    it("steps default → alternatives → back to default (removing the entry)", () => {
        const one = cycleOverride([], target, options);
        expect(one).toEqual([{ ...target, reading: "de2" }]);
        const two = cycleOverride(one, target, options);
        expect(two).toEqual([{ ...target, reading: "dei3" }]);
        expect(cycleOverride(two, target, options)).toEqual([]);
    });
    it("leaves other occurrences alone", () => {
        const other = { start: 10, end: 11, text: "得", reading: "dei3" };
        expect(cycleOverride([other], target, options)).toEqual([{ ...target, reading: "de2" }, other]);
    });
});

describe("buildOverrideLookup", () => {
    it("returns the toned reading only for the exact span", () => {
        const lookup = buildOverrideLookup([{ ...target, reading: "dei3" }]);
        expect(lookup(target)).toBe("děi");
        expect(lookup({ start: 3, end: 5, text: "得到" })).toBeUndefined();
    });
});

describe("shiftPronunciationOverrides (shift only)", () => {
    const old = "我觉得他得去";
    const choices = [
        { start: 2, end: 3, text: "得", reading: "de2" },
        { start: 4, end: 5, text: "得", reading: "dei3" },
    ];
    it("keeps choices before an edit and shifts those after it", () => {
        expect(shiftPronunciationOverrides(old, "我觉得，他得去", choices)).toEqual([
            choices[0],
            { ...choices[1], start: 5, end: 6 },
        ]);
    });
    it("drops a choice inside the edited stretch", () => {
        expect(shiftPronunciationOverrides(old, "我觉他得去", choices)).toEqual([{ ...choices[1], start: 3, end: 4 }]);
    });
});
