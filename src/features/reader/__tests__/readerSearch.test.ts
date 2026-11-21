import { describe, expect, it } from "vitest";
import type { SegmentSpan } from "../../../reading/documentSegmentation";
import { buildDocumentSyllables, findPinyinMatches, findReaderMatches, findTextMatches } from "../readerSearch";

// Covers src/features/reader/readerSearch.ts (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Search").

/** Spans for a content string whose words are listed in order (gaps = non-words). */
function spansFor(content: string, words: string[]): SegmentSpan[] {
    const spans: SegmentSpan[] = [];
    let from = 0;
    for (const word of words) {
        const start = content.indexOf(word, from);
        spans.push({ start, end: start + word.length, text: word } as SegmentSpan);
        from = start + word.length;
    }
    return spans;
}

const CONTENT = "你好，我很好。\n不是好人。";
const SPANS = spansFor(CONTENT, ["你好", "我", "很", "好", "不是", "好人"]);
const PRONUNCIATIONS = new Map([
    ["你好", "nǐ hǎo"],
    ["我", "wǒ"],
    ["很", "hěn"],
    ["好", "hǎo"],
    ["不是", "bù shì"],
    ["好人", "hǎo rén"],
]);
const SYLLABLES = buildDocumentSyllables(CONTENT, SPANS, PRONUNCIATIONS);
const slice = (m: { start: number; end: number }) => CONTENT.slice(m.start, m.end);

describe("findTextMatches", () => {
    it("finds every literal occurrence", () => {
        expect(findTextMatches(CONTENT, "好").map(slice)).toEqual(["好", "好", "好"]);
    });
    it("is case-insensitive for Latin and ignores a blank query", () => {
        expect(findTextMatches("Apple apple", "APPLE")).toHaveLength(2);
        expect(findTextMatches("abc", "  ")).toEqual([]);
    });
    it("treats regex characters literally", () => {
        expect(findTextMatches("a.b axb", ".")).toEqual([{ start: 1, end: 2 }]);
    });
});

describe("buildDocumentSyllables", () => {
    it("zips readings onto characters and applies 不 sandhi", () => {
        expect(SYLLABLES[CONTENT.indexOf("你")]).toBe("nǐ");
        expect(SYLLABLES[CONTENT.indexOf("，")]).toBe("");
        // 不 before a 4th tone surfaces as bú.
        expect(SYLLABLES[CONTENT.indexOf("不")]).toBe("bú");
    });
});

describe("findPinyinMatches", () => {
    it("matches toneless letters against any tone", () => {
        expect(findPinyinMatches(CONTENT, SYLLABLES, "hao").map(slice)).toEqual(["好", "好", "好"]);
    });
    it("pins tones from marks and digits", () => {
        expect(findPinyinMatches(CONTENT, SYLLABLES, "hěn").map(slice)).toEqual(["很"]);
        expect(findPinyinMatches(CONTENT, SYLLABLES, "hen1")).toEqual([]);
        expect(findPinyinMatches(CONTENT, SYLLABLES, "bu2").map(slice)).toEqual(["不"]);
        expect(findPinyinMatches(CONTENT, SYLLABLES, "bu4")).toEqual([]);
    });
    it("spans syllables and ignores spaces", () => {
        expect(findPinyinMatches(CONTENT, SYLLABLES, "ni hao").map(slice)).toEqual(["你好"]);
        expect(findPinyinMatches(CONTENT, SYLLABLES, "nihao3").map(slice)).toEqual(["你好"]);
    });
    it("starts only at a syllable start but may end mid-syllable", () => {
        expect(findPinyinMatches(CONTENT, SYLLABLES, "ao")).toEqual([]);
        expect(findPinyinMatches(CONTENT, SYLLABLES, "ha").map(slice)).toEqual(["好", "好", "好"]);
    });
    it("a digit requires the syllable to end there", () => {
        expect(findPinyinMatches(CONTENT, SYLLABLES, "ha3")).toEqual([]);
    });
    it("never crosses punctuation", () => {
        expect(findPinyinMatches(CONTENT, SYLLABLES, "haowo")).toEqual([]);
        expect(findPinyinMatches(CONTENT, SYLLABLES, "henhao").map(slice)).toEqual(["很好"]);
    });
    it("rejects non-pinyin queries", () => {
        expect(findPinyinMatches(CONTENT, SYLLABLES, "好")).toEqual([]);
    });
});

describe("findReaderMatches", () => {
    it("is text-only without syllables", () => {
        expect(findReaderMatches(CONTENT, "hao", null)).toEqual([]);
    });
    it("merges text and pinyin matches without overlaps", () => {
        const content = "hao 好";
        const spans = spansFor(content, ["hao", "好"]);
        const syllables = buildDocumentSyllables(content, spans, new Map([["好", "hǎo"]]));
        expect(findReaderMatches(content, "hao", syllables).map((m) => content.slice(m.start, m.end))).toEqual(["hao", "好"]);
    });
});
