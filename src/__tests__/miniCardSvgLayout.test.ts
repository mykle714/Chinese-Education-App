import { describe, expect, it } from "vitest";
import { layoutMiniCardSvg, type TextMeasurer } from "../components/miniCardSvgLayout";
import { solvePinyinShift, pinyinSeparators, buildCharItems, PINYIN_MIN_GAP_PX } from "../components/cpcdLayout";

/**
 * MiniCardSvg's hand layout (src/components/miniCardSvgLayout.ts) and the cpcd pinyin
 * solver it shares with CPCDRow (src/components/cpcdLayout.ts). A fixed-width measurer
 * stands in for canvas: every glyph advances 0.5em; ascent/descent 0.8/0.2 em.
 */
const measure: TextMeasurer = {
    advance: (text, font) => [...text].length * font.sizePx * 0.5,
    metrics: (font) => ({ ascent: font.sizePx * 0.8, descent: font.sizePx * 0.2 }),
};

describe("solvePinyinShift", () => {
    it("leaves fitting, well-spaced syllables alone", () => {
        const s = solvePinyinShift([
            { center: 11, boxWidth: 22, textWidth: 10 },
            { center: 29, boxWidth: 22, textWidth: 10 },
        ]);
        expect(s.offsets).toEqual([0, 0]);
        expect(s.pushed).toEqual([false]);
    });

    it("splits a collision evenly and leaves exactly the minimum gap", () => {
        const row = [
            { center: 11, boxWidth: 22, textWidth: 20 },
            { center: 29, boxWidth: 22, textWidth: 20 },
        ];
        const s = solvePinyinShift(row);
        expect(s.offsets[0]).toBeCloseTo(-s.offsets[1]);
        const gap = row[1].center + s.offsets[1] - s.halfLefts[1] - (row[0].center + s.offsets[0] + s.halfRights[0]);
        expect(gap).toBeCloseTo(PINYIN_MIN_GAP_PX);
        expect(s.pushed).toEqual([true]);
    });

    it("re-centres a lone overflowing syllable over its glyph", () => {
        const s = solvePinyinShift([{ center: 11, boxWidth: 22, textWidth: 30 }]);
        // Left-anchored text spans [0, 30]; pulled left by half the 8px overflow → [-4, 26].
        expect(s.offsets[0]).toBeCloseTo(-4);
    });

    it("does nothing when disabled", () => {
        const s = solvePinyinShift([{ center: 11, boxWidth: 22, textWidth: 30 }], false);
        expect(s.offsets).toEqual([0]);
    });

    it("marks only pushed same-tone pairs for a separator", () => {
        const row = [
            { center: 11, boxWidth: 22, textWidth: 20 },
            { center: 29, boxWidth: 22, textWidth: 20 },
        ];
        const solution = solvePinyinShift(row);
        const sameTone = [{ character: "a", pinyin: "mā" }, { character: "b", pinyin: "tā" }];
        const otherTone = [{ character: "a", pinyin: "mā" }, { character: "b", pinyin: "tà" }];
        expect(pinyinSeparators(row, sameTone, solution)).toHaveLength(1);
        expect(pinyinSeparators(row, otherTone, solution)).toHaveLength(0);
    });
});

describe("buildCharItems", () => {
    it("applies yī tone sandhi (一次 → yí cì)", () => {
        expect(buildCharItems("一次", "yī cì", true, true, true).map((i) => i.pinyin)).toEqual(["yí", "cì"]);
    });
});

describe("layoutMiniCardSvg", () => {
    const base = { language: "zh" as const, definition: "once", iconId: null };

    it("centres a short word in the card", () => {
        const l = layoutMiniCardSvg({ ...base, entryKey: "一次", pronunciation: "yī cì" }, measure);
        expect(l.width).toBe(92);
        expect(l.height).toBe(132);
        const mid = (l.glyphs[0].x + l.glyphs[1].x) / 2;
        expect(mid).toBeCloseTo(46);
        // Adjacent xs cells overlap by 4px: 22px columns, 18px apart.
        expect(l.glyphs[1].x - l.glyphs[0].x).toBeCloseTo(18);
        expect(l.pinyins.map((p) => p.text)).toEqual(["yí", "cì"]);
    });

    it("wraps a five-character word after four cells", () => {
        const l = layoutMiniCardSvg({ ...base, entryKey: "一二三四五", pronunciation: "yī èr sān sì wǔ" }, measure);
        const rows = new Set(l.glyphs.map((g) => g.y.toFixed(2)));
        expect(rows.size).toBe(2);
        // The lone fifth cell is centred on its own line.
        expect(l.glyphs[4].x).toBeCloseTo(46);
    });

    it("keeps a one-line gloss at the top of its min-height box", () => {
        const l = layoutMiniCardSvg({ ...base, entryKey: "一", pronunciation: "yī" }, measure);
        expect(l.definitionLines).toHaveLength(1);
        // Content box: bottom at 132 − 6 = 126, min content height 24 − 2 = 22 → top 104.
        expect(l.definitionClip.y).toBeCloseTo(104);
    });

    it("clamps a long gloss to two lines ending in an ellipsis", () => {
        const l = layoutMiniCardSvg({ ...base, entryKey: "一", pronunciation: "yī", definition: "a very long gloss that cannot possibly fit on two lines here" }, measure);
        expect(l.definitionLines).toHaveLength(2);
        const last = l.definitionLines[1].runs.map((r) => r.text).join("");
        expect(last.endsWith("…")).toBe(true);
        // 14px × 0.5em = 7px per glyph; the body is 76px wide → at most 10 glyphs a line.
        expect([...last].length).toBeLessThanOrEqual(10);
    });

    it("italicises the classifier label", () => {
        const l = layoutMiniCardSvg({ ...base, entryKey: "本", pronunciation: "běn", definition: "classifier for books" }, measure);
        const runs = l.definitionLines.flatMap((line) => line.runs);
        expect(runs[0]).toEqual({ text: "classifier", italic: true });
    });
});
