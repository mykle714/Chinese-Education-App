import { describe, expect, it } from "vitest";
import type { Text } from "../../../types";
import { filterByCollection, formatJournalDate, sortTexts } from "../readerListOrder";

// Covers src/features/reader/readerListOrder.ts (docs/USER_DOCUMENT_FEATURE_SUMMARY.md
// § "Collections (Documents / Journal)", § "Sorting").

function text(over: Partial<Text> & Pick<Text, "id">): Text {
    return {
        title: over.id,
        content: "",
        language: "en" as Text["language"],
        characterCount: 0,
        isUserCreated: true,
        kind: "document",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        pronunciationOverrides: [],
        ...over,
    };
}

const a = text({ id: "a", title: "Banana", kind: "journal", characterCount: 5, createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z" });
const b = text({ id: "b", title: "apple", characterCount: 50, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z" });
const c = text({ id: "c", title: "Cherry", isUserCreated: false, characterCount: 20, createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" });
const all = [b, c, a];
const ids = (ts: Text[]) => ts.map((t) => t.id);

describe("filterByCollection", () => {
    it("keeps only the selected kind (built-ins are documents)", () => {
        expect(ids(filterByCollection(all, "journal"))).toEqual(["a"]);
        expect(ids(filterByCollection(all, "document"))).toEqual(["b", "c"]);
    });
});

describe("sortTexts", () => {
    it("orders by each key without mutating the input", () => {
        expect(ids(sortTexts(all, "newest"))).toEqual(["a", "c", "b"]);
        expect(ids(sortTexts(all, "oldest"))).toEqual(["b", "c", "a"]);
        expect(ids(sortTexts(all, "title"))).toEqual(["b", "a", "c"]);
        expect(ids(sortTexts(all, "edited"))).toEqual(["b", "a", "c"]);
        expect(ids(sortTexts(all, "length"))).toEqual(["b", "c", "a"]);
        expect(ids(all)).toEqual(["b", "c", "a"]);
    });

    it("breaks ties newest-first", () => {
        const x = text({ id: "x", characterCount: 10, createdAt: "2026-01-01T00:00:00Z" });
        const y = text({ id: "y", characterCount: 10, createdAt: "2026-06-01T00:00:00Z" });
        expect(ids(sortTexts([x, y], "length"))).toEqual(["y", "x"]);
    });
});

describe("formatJournalDate", () => {
    it("is empty for a missing or bad timestamp", () => {
        expect(formatJournalDate(undefined)).toBe("");
        expect(formatJournalDate("nope")).toBe("");
        expect(formatJournalDate("2026-11-17T12:00:00Z")).toMatch(/2026/);
    });
});
