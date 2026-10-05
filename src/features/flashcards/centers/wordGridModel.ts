import { barCategory, isBarOnCooldown, type MasteryBarId } from "../../../utils/masteryCompute";
import { resolveDisplayDefinition } from "../../../utils/definitionUtils";
import { STUDY_MIX_QUOTAS } from "../../../../server/contracts/studyMix";
import type { FlashcardCategory } from "../../../../server/contracts/wire";
import type { VocabEntry } from "../../../types";

/**
 * wordGridModel — the pure half of BOTH Centers' 6×6 word grids
 * (docs/READING_WRITING_CENTERS.md § Phases 2 and 5): the Reading Center's swipe grid
 * (`ReadingSwipeGrid`, bar `reading`) and the Writing Center's practice grid
 * (`WritingPracticeGrid`, bar `writing`). No React, no DOM, no clock of its own: every
 * function takes `now` / `random` so the grids' behaviour is testable.
 *
 * ── The grid ──────────────────────────────────────────────────────────────────
 * GRID_ROWS × GRID_COLUMNS square cells. A WORD occupies `span` adjacent cells of one
 * row (`cellSpan`: one cell per character up to two characters, then compressed — a
 * 3-character word fits in 2 cells, a 4-character word in 3), so every tile is a
 * rectangle and a row is a left-to-right run of words. Each row is filled independently; a hole left by a word
 * the learner swiped away is refilled in place with words whose lengths fit it exactly
 * or leave a remainder (filled in turn), never by reflowing the other tiles.
 * Every packing rule below works in CELLS (`span`), never in characters (`length`).
 *
 * ── Which words ───────────────────────────────────────────────────────────────
 * The learner's own cards (the Center's library), restricted to:
 *   • all-Han words of 1..`maxLength` characters — GRID_COLUMNS for reading, 4 for
 *     writing (PracticeWritingPopup's 2×2 grid holds at most four characters);
 *   • cards NOT resting on the grid's bar FIRST — a mark on a resting card is dropped at
 *     `POST /api/flashcards/mark` (the hard "next markable at", CLAUDE.md § Hydra), so a
 *     resting tile silently records nothing. Resting ("cooled") cards are still pooled,
 *     flagged `cooled`, and drawn only when no markable word fits the room — a cell
 *     shows a cooled word before it shows nothing (2026-10-03).
 * Sampled by the card's band ON THAT BAR in the Study Mix proportions
 * (`STUDY_MIX_QUOTAS`: Target 5 · Unfamiliar 2 · Comfortable 2 · Mastered 1), as
 * weights rather than quotas — the grid has no fixed size in cards, only in cells.
 * A word leaves the pool when it is placed, so it appears at most once per visit.
 */

export const GRID_COLUMNS = 6;
export const GRID_ROWS = 6;

const HAN_ONLY_RE = /^\p{Script=Han}+$/u;

/**
 * Cells a word of N characters occupies, indexed by N (1..GRID_COLUMNS). A cell holds a
 * 28px glyph with room to spare, so past two characters a tile no longer needs a full
 * cell per character: 3 → 2 cells, 4 → 3, and the longer reading-only words keep the
 * same ~2/3 density (5 → 4, 6 → 4). The tile's font still shrinks to fit if a narrow
 * screen makes the span tight (see the grids' fontSize).
 */
const CELL_SPAN_BY_LENGTH: readonly number[] = [0, 1, 2, 2, 3, 4, 4];

/** The tile's width in cells for a word of `length` characters. */
export function cellSpan(length: number): number {
    return CELL_SPAN_BY_LENGTH[length] ?? Math.ceil((length * 2) / 3);
}

export interface GridWord {
    cardId: number;
    word: string;
    /** Characters (code points) — sizes the tile's glyphs, not its footprint. */
    length: number;
    /** Cells the tile covers on its row (`cellSpan(length)`) — every packing rule uses this. */
    span: number;
    band: FlashcardCategory;
    /** The dd — the tile's accessible label once flipped. */
    dd: string;
    /** The card itself — the reading grid's flipped tile renders it as a mini card. */
    entry: VocabEntry;
    /**
     * Resting on the grid's bar at pool time — a fallback filler whose mark the server
     * will drop. Never counted as "ready" (`readyCount`).
     */
    cooled: boolean;
}

export interface PlacedTile extends GridWord {
    /** Unique per placement (a refilled hole gets fresh keys), so React remounts it. */
    key: string;
    row: number;
    col: number;
}

/** The words not yet placed, by the grid bar's band. Mutated as words are drawn. */
export type GridPool = Map<FlashcardCategory, GridWord[]>;

const BAND_WEIGHTS: ReadonlyMap<FlashcardCategory, number> = new Map(
    STUDY_MIX_QUOTAS.map((q) => [q.category, q.count])
);

/** Fisher–Yates, in place (see OnDeckVocabService.shuffleInPlace for why not sort()). */
function shuffleInPlace<T>(items: T[], random: () => number): void {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
}

export interface PoolOptions {
    /** The bar the grid marks — its band weights the sample and its clock gates it. */
    bar: Extract<MasteryBarId, "reading" | "writing">;
    /** Longest word admitted, in characters. Defaults to a full row. */
    maxLength?: number;
}

/** Build the visit's pool from the learner's library. Shuffled once, here. */
export function buildPool(
    cards: readonly VocabEntry[],
    now: number,
    random: () => number,
    { bar, maxLength = GRID_COLUMNS }: PoolOptions
): GridPool {
    const pool: GridPool = new Map();
    const longest = Math.min(maxLength, GRID_COLUMNS);
    for (const card of cards) {
        const word = card.entryKey ?? "";
        const length = [...word].length;
        if (length < 1 || length > longest || !HAN_ONLY_RE.test(word)) continue;
        const cooled = isBarOnCooldown(card.typedMarkHistory, bar, now, card.writingMastery);
        const band = barCategory(card.typedMarkHistory, bar, card.writingMastery);
        const list = pool.get(band) ?? [];
        list.push({ cardId: card.id, word, length, span: cellSpan(length), band, dd: resolveDisplayDefinition(card), entry: card, cooled });
        pool.set(band, list);
    }
    pool.forEach((list) => shuffleInPlace(list, random));
    return pool;
}

/**
 * How many of `words` are markable (not cooled) — the grids' "N ready" count. Pass the
 * board's tiles and/or `allPoolWords(pool)`.
 */
export function readyCount(words: Iterable<GridWord>): number {
    let n = 0;
    for (const w of words) if (!w.cooled) n++;
    return n;
}

/** Every unplaced word, across bands. */
export function allPoolWords(pool: GridPool): GridWord[] {
    return [...pool.values()].flat();
}

/** How many words are still unplaced (cooled fallbacks included). */
export function poolSize(pool: GridPool): number {
    let n = 0;
    pool.forEach((list) => { n += list.length; });
    return n;
}

/**
 * Draw one word whose tile fits in `room` cells: pick a band by Study Mix weight among the
 * bands that still HAVE such a word, then that band's next fitting word. Markable words
 * are tried first; only when none fits does the same draw run over the cooled fallbacks.
 * Null when no word at all fits.
 */
export function drawWord(pool: GridPool, room: number, random: () => number): GridWord | null {
    return drawFromTier(pool, room, random, false) ?? drawFromTier(pool, room, random, true);
}

/** `drawWord` restricted to one tier — markable (`cooled = false`) or the cooled fallbacks. */
function drawFromTier(pool: GridPool, room: number, random: () => number, cooled: boolean): GridWord | null {
    const candidates: { band: FlashcardCategory; index: number; weight: number }[] = [];
    pool.forEach((list, band) => {
        const index = list.findIndex((w) => w.cooled === cooled && w.span <= room);
        if (index >= 0) candidates.push({ band, index, weight: BAND_WEIGHTS.get(band) ?? 1 });
    });
    if (candidates.length === 0) return null;
    const total = candidates.reduce((sum, c) => sum + c.weight, 0);
    let r = random() * total;
    const chosen = candidates.find((c) => (r -= c.weight) < 0) ?? candidates[candidates.length - 1];
    const list = pool.get(chosen.band)!;
    const [word] = list.splice(chosen.index, 1);
    return word;
}

/**
 * Fill `length` cells of `row` starting at `col`, left to right. Cells nothing fits
 * stay empty (no tile) — the grid shows a gap rather than a word that would overrun.
 */
export function fillSegment(
    pool: GridPool,
    row: number,
    col: number,
    length: number,
    random: () => number,
    nextKey: () => string
): PlacedTile[] {
    const placed: PlacedTile[] = [];
    let cursor = col;
    const end = col + length;
    while (cursor < end) {
        const word = drawWord(pool, end - cursor, random);
        if (!word) break;
        placed.push({ ...word, key: nextKey(), row, col: cursor });
        cursor += word.span;
    }
    return placed;
}

/** The visit's opening layout: every row filled from the pool. */
export function initialLayout(pool: GridPool, random: () => number, nextKey: () => string): PlacedTile[] {
    const tiles: PlacedTile[] = [];
    for (let row = 0; row < GRID_ROWS; row++) {
        tiles.push(...fillSegment(pool, row, 0, GRID_COLUMNS, random, nextKey));
    }
    return tiles;
}

/**
 * Remove `tile` and refill the cells it freed, plus any EMPTY cells touching it on the
 * same row (a gap left earlier may now combine with the new hole into room for a
 * longer word).
 */
export function replaceTile(
    tiles: readonly PlacedTile[],
    tile: PlacedTile,
    pool: GridPool,
    random: () => number,
    nextKey: () => string
): PlacedTile[] {
    const rest = tiles.filter((t) => t.key !== tile.key);
    const occupied = new Set<number>();
    rest.filter((t) => t.row === tile.row).forEach((t) => {
        for (let c = t.col; c < t.col + t.span; c++) occupied.add(c);
    });
    let start = tile.col;
    while (start > 0 && !occupied.has(start - 1)) start--;
    let end = tile.col + tile.span;
    while (end < GRID_COLUMNS && !occupied.has(end)) end++;
    return [...rest, ...fillSegment(pool, tile.row, start, end - start, random, nextKey)];
}
