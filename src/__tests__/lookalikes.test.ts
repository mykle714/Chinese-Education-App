/**
 * lookalikes.ts — the writing flp's look-alike table (docs/WRITING_PRACTICE_REWORK.md
 * § 3c). Covers the lookup contract and the table's own invariants.
 */
import { createRequire } from "module";
import { describe, expect, it } from "vitest";
import { findLookalike } from "../components/handwriting/lookalikes";

const require = createRequire(import.meta.url);

describe("findLookalike", () => {
    it("matches a miss read as a listed look-alike, carrying the TARGET's tell", () => {
        const m = findLookalike("末", "未");
        expect(m?.target.char).toBe("末");
        expect(m?.recognized.char).toBe("未");
        expect(m?.target.tell).toMatch(/top one is longer instead of shorter/);
    });

    it("works across a 3+ member group in either direction", () => {
        expect(findLookalike("申", "由")?.recognized.pinyin).toBe("yóu");
        expect(findLookalike("由", "申")?.recognized.pinyin).toBe("shēn");
    });

    it("is null for a correct answer, an unrelated misread, an unlisted target, or no read", () => {
        expect(findLookalike("末", "末")).toBeNull();
        expect(findLookalike("末", "大")).toBeNull();
        expect(findLookalike("爱", "受")).toBeNull();
        expect(findLookalike("末", null)).toBeNull();
    });
});

describe("table invariants", () => {
    // Every listed character must have corpus stroke data — LookalikeNotice draws it
    // with GlyphSvg, and a missing glyph would leave a blank square in the notice.
    it("every listed character has hanzi-writer-data strokes", async () => {
        const src = require("fs").readFileSync(require.resolve("../components/handwriting/lookalikes.ts"), "utf8") as string;
        const chars = [...src.matchAll(/\["(\p{Script=Han})", "/gu)].map((m) => m[1]);
        expect(chars.length).toBeGreaterThan(50);
        for (const ch of chars) {
            const data = require(`hanzi-writer-data/${ch}.json`);
            expect(Array.isArray(data.strokes), ch).toBe(true);
        }
    });
});
