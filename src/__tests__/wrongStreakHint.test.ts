import { describe, expect, it } from "vitest";
import type { VocabEntry } from "../types";
import type { ReviewMark } from "../../server/contracts/wire";
import { hasWrongStreak, pawnHintFor } from "../features/flashcards/FlashcardsLearnPage/hintPawn/pawnHints";
import { CPCD_LINE_MAX_CHARS, USED_IN_LINES, WRONG_STREAK_LINES, splitHintKeywords } from "../features/flashcards/FlashcardsLearnPage/hintPawn/pawnHintLines";

// docs/HINT_PAWN.md § "Hints" → wrong-streak: main + reading, last 3 marks of the world's
// tracks (merged by timestamp) all wrong.

const mark = (minute: number, isCorrect: boolean): ReviewMark => ({
    timestamp: new Date(Date.UTC(2026, 10, 1, 0, minute)).toISOString(),
    isCorrect,
});

const entry = (over: Partial<VocabEntry>): VocabEntry => ({ id: 7, entryKey: "朋友", ...over }) as VocabEntry;

const eligibleIds = (e: VocabEntry) => {
    const hint = pawnHintFor("core", e);
    return WRONG_STREAK_LINES.filter((_, i) => hint?.eligible?.[i]).map((l) => l.id);
};

describe("hasWrongStreak", () => {
    it("needs three wrong marks, newest first", () => {
        expect(hasWrongStreak({ reading: [mark(1, false), mark(2, false)] }, "reading")).toBe(false);
        expect(hasWrongStreak({ reading: [mark(1, true), mark(2, false), mark(3, false), mark(4, false)] }, "reading")).toBe(true);
        expect(hasWrongStreak({ reading: [mark(1, false), mark(2, false), mark(3, false), mark(4, true)] }, "reading")).toBe(false);
    });

    it("merges recognition and production by timestamp in main", () => {
        const history = {
            recognition: [mark(1, true), mark(3, false), mark(5, false)],
            production: [mark(4, false)],
        };
        expect(hasWrongStreak(history, "core")).toBe(true);
        // A newer correct production mark breaks it.
        expect(hasWrongStreak({ ...history, production: [mark(4, false), mark(6, true)] }, "core")).toBe(false);
    });

    it("ignores other worlds' tracks", () => {
        const history = { reading: [mark(1, false), mark(2, false), mark(3, false)] };
        expect(hasWrongStreak(history, "core")).toBe(false);
    });
});

describe("pawnHintFor wrong-streak", () => {
    const streak = { recognition: [mark(1, false), mark(2, false), mark(3, false)] };

    it("is null without a streak, and never in writing", () => {
        expect(pawnHintFor("core", entry({}))).toBeNull();
        expect(pawnHintFor("writing", entry({ typedMarkHistory: { writing: streak.recognition } }))?.kind).not.toBe("wrong-streak");
    });

    it("offers only the unconditional hints on a bare card", () => {
        expect(eligibleIds(entry({ typedMarkHistory: streak }))).toEqual(["customize", "compare", "focus"]);
    });

    it("adds breakdown on a multi-char card with breakdown, examples with sentences", () => {
        const rich = entry({
            typedMarkHistory: streak,
            breakdown: { 朋: { definition: "friend" }, 友: { definition: "friend" } },
            exampleSentences: [{ foreignText: "他是我的朋友。", english: "He is my friend." }],
        } as Partial<VocabEntry>);
        expect(eligibleIds(rich)).toEqual(["breakdown", "examples", "customize", "compare", "focus"]);
    });

    it("never offers breakdown on a single character", () => {
        const single = entry({ entryKey: "朋", typedMarkHistory: streak, breakdown: { 朋: { definition: "friend" } } } as Partial<VocabEntry>);
        expect(eligibleIds(single)).not.toContain("breakdown");
    });
});

// The cpcd dialogue-box variant forbids its line from wrapping (pawnHints.ts →
// PAWN_BUBBLE_VARIANT), so every line of a cpcd kind must fit on one line.
describe("cpcd-variant lines", () => {
    it("every used-in line fits CPCD_LINE_MAX_CHARS", () => {
        for (const line of USED_IN_LINES) expect(line.length, line).toBeLessThanOrEqual(CPCD_LINE_MAX_CHARS);
    });
});

describe("splitHintKeywords", () => {
    it("pulls out {keyword} runs and drops the braces", () => {
        expect(splitHintKeywords("Tap {Compare} above the {More Info}.")).toEqual([
            { text: "Tap ", keyword: false },
            { text: "Compare", keyword: true },
            { text: " above the ", keyword: false },
            { text: "More Info", keyword: true },
            { text: ".", keyword: false },
        ]);
    });

    it("leaves plain and unclosed lines as text", () => {
        expect(splitHintKeywords("No markup here:")).toEqual([{ text: "No markup here:", keyword: false }]);
        expect(splitHintKeywords("Broken {brace")).toEqual([{ text: "Broken {brace", keyword: false }]);
    });

    it("no hint line carries quote marks or stray braces once split", () => {
        for (const { line } of WRONG_STREAK_LINES) {
            const text = splitHintKeywords(line).map((r) => r.text).join("");
            expect(text).not.toMatch(/["“”{}]/);
        }
    });
});
