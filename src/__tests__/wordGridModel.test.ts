import { describe, expect, it } from "vitest";
import {
    GRID_COLUMNS, GRID_ROWS, buildPool, drawWord, initialLayout, poolSize, replaceTile,
    type PlacedTile,
} from "../features/flashcards/centers/wordGridModel";
import type { VocabEntry } from "../types";

// Both Centers' word grid model (docs/READING_WRITING_CENTERS.md § Phases 2 and 5).

const NOW = Date.parse("2026-10-02T12:00:00Z");

/** Deterministic PRNG so layouts are reproducible. */
function seeded(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
    };
}

let nextId = 1;
const card = (entryKey: string, extra: Partial<VocabEntry> = {}): VocabEntry =>
    ({ id: nextId++, entryKey, definition: `def ${entryKey}`, typedMarkHistory: {}, ...extra }) as VocabEntry;

const keys = () => {
    let n = 0;
    return () => `k${n++}`;
};

/** Every cell index (row*cols+col) a tile covers. */
const cellsOf = (t: PlacedTile) => Array.from({ length: t.length }, (_, i) => t.row * GRID_COLUMNS + t.col + i);

describe("buildPool", () => {
    it("keeps only all-Han words that fit a row", () => {
        const pool = buildPool(
            [card("学"), card("学习"), card("hola"), card("学a"), card("一二三四五六七")],
            NOW,
            seeded(1),
            { bar: "reading" }
        );
        const words = [...pool.values()].flat().map((w) => w.word).sort();
        expect(words).toEqual(["学", "学习"]);
    });

    it("drops cards resting on the reading bar (their marks would be dropped server-side)", () => {
        const justMarked = card("读", {
            typedMarkHistory: { reading: [{ timestamp: new Date(NOW - 60_000).toISOString(), isCorrect: true }] },
        });
        const pool = buildPool([justMarked, card("写")], NOW, seeded(2), { bar: "reading" });
        expect([...pool.values()].flat().map((w) => w.word)).toEqual(["写"]);
    });
});

describe("buildPool — writing bar", () => {
    it("caps words at the practice popup's four characters", () => {
        const pool = buildPool([card("写"), card("图书馆"), card("一路平安"), card("中华人民共")], NOW, seeded(12), { bar: "writing", maxLength: 4 });
        expect([...pool.values()].flat().map((w) => w.word).sort()).toEqual(["一路平安", "写", "图书馆"].sort());
    });

    it("gates on the WRITING clock, not the reading one", () => {
        const recent = [{ timestamp: new Date(NOW - 60_000).toISOString(), isCorrect: true }];
        const readJustNow = card("读", { typedMarkHistory: { reading: recent } });
        const wroteJustNow = card("写", { typedMarkHistory: { writing: recent } });
        const pool = buildPool([readJustNow, wroteJustNow], NOW, seeded(13), { bar: "writing" });
        expect([...pool.values()].flat().map((w) => w.word)).toEqual(["读"]);
    });
});

describe("drawWord", () => {
    it("never returns a word longer than the room", () => {
        const pool = buildPool([card("学习"), card("图书馆"), card("人")], NOW, seeded(3), { bar: "reading" });
        expect(drawWord(pool, 1, seeded(4))?.word).toBe("人");
        expect(drawWord(pool, 1, seeded(4))).toBeNull();
    });
});

describe("initialLayout", () => {
    const cards = ["人", "大", "小", "学习", "老师", "朋友", "图书馆", "电脑", "中国", "我", "你", "他",
        "吃饭", "喝水", "今天", "明天", "飞机场", "火车站", "好", "看", "听", "说", "读", "写"].map((w) => card(w));

    it("places each word at most once and never overlaps or overruns a row", () => {
        const pool = buildPool(cards, NOW, seeded(5), { bar: "reading" });
        const tiles = initialLayout(pool, seeded(6), keys());
        const ids = tiles.map((t) => t.cardId);
        expect(new Set(ids).size).toBe(ids.length);
        const cells = tiles.flatMap(cellsOf);
        expect(new Set(cells).size).toBe(cells.length);
        for (const t of tiles) {
            expect(t.col + t.length).toBeLessThanOrEqual(GRID_COLUMNS);
            expect(t.row).toBeLessThan(GRID_ROWS);
        }
    });

    it("takes placed words out of the pool", () => {
        const pool = buildPool(cards, NOW, seeded(7), { bar: "reading" });
        const before = poolSize(pool);
        const tiles = initialLayout(pool, seeded(8), keys());
        expect(poolSize(pool)).toBe(before - tiles.length);
    });
});

describe("replaceTile", () => {
    it("refills only the freed cells (plus adjacent gaps) and keeps every other tile in place", () => {
        const many = Array.from({ length: 60 }, (_, i) => card(String.fromCodePoint(0x4e00 + i)));
        const pool = buildPool(many, NOW, seeded(9), { bar: "reading" });
        const nextKey = keys();
        const tiles = initialLayout(pool, seeded(10), nextKey);
        const gone = tiles[3];
        const after = replaceTile(tiles, gone, pool, seeded(11), nextKey);

        expect(after.find((t) => t.key === gone.key)).toBeUndefined();
        // Everything that was not swiped is untouched.
        for (const t of tiles.filter((x) => x.key !== gone.key)) {
            expect(after).toContainEqual(t);
        }
        // The hole is filled (single characters always fit) and nothing overlaps.
        const cells = after.flatMap(cellsOf);
        expect(new Set(cells).size).toBe(cells.length);
        for (const c of cellsOf(gone)) expect(cells).toContain(c);
    });
});
