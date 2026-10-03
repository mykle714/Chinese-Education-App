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
 * GRID_ROWS × GRID_COLUMNS square cells. A WORD occupies `length` adjacent cells of one
 * row — a 2-character word is a 2×1 tile — so every tile is a rectangle and a row is a
 * left-to-right run of words. Each row is filled independently; a hole left by a word
 * the learner swiped away is refilled in place with words whose lengths fit it exactly
 * or leave a remainder (filled in turn), never by reflowing the other tiles.
 *
 * ── Which words ───────────────────────────────────────────────────────────────
 * The learner's own cards (the Center's library), restricted to:
 *   • all-Han words of 1..`maxLength` characters — GRID_COLUMNS for reading, 4 for
 *     writing (PracticeWritingPopup's 2×2 grid holds at most four characters);
 *   • cards NOT resting on the grid's bar — a mark on a resting card is dropped at
 *     `POST /api/flashcards/mark` (the hard "next markable at", CLAUDE.md § Hydra), so
 *     offering one would be a tile that silently records nothing.
 * Sampled by the card's band ON THAT BAR in the Study Mix proportions
 * (`STUDY_MIX_QUOTAS`: Target 5 · Unfamiliar 2 · Comfortable 2 · Mastered 1), as
 * weights rather than quotas — the grid has no fixed size in cards, only in cells.
 * A word leaves the pool when it is placed, so it appears at most once per visit.
 */

export const GRID_COLUMNS = 6;
export const GRID_ROWS = 6;

const HAN_ONLY_RE = /^\p{Script=Han}+$/u;

export interface GridWord {
    cardId: number;
    word: string;
    /** Characters (code points) — the tile's span in cells. */
    length: number;
    band: FlashcardCategory;
    /** The dd — the tile's accessible label once flipped. */
    dd: string;
    /** The card itself — the reading grid's flipped tile renders it as a mini card. */
    entry: VocabEntry;
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
        if (isBarOnCooldown(card.typedMarkHistory, bar, now)) continue;
        const band = barCategory(card.typedMarkHistory, bar);
        const list = pool.get(band) ?? [];
        list.push({ cardId: card.id, word, length, band, dd: resolveDisplayDefinition(card), entry: card });
        pool.set(band, list);
    }
    pool.forEach((list) => shuffleInPlace(list, random));
    return pool;
}

/** How many words are still unplaced. */
export function poolSize(pool: GridPool): number {
    let n = 0;
    pool.forEach((list) => { n += list.length; });
    return n;
}

/**
 * Draw one word no longer than `maxLength`: pick a band by Study Mix weight among the
 * bands that still HAVE such a word, then that band's next fitting word. Null when no
 * word in any band fits.
 */
export function drawWord(pool: GridPool, maxLength: number, random: () => number): GridWord | null {
    const candidates: { band: FlashcardCategory; index: number; weight: number }[] = [];
    pool.forEach((list, band) => {
        const index = list.findIndex((w) => w.length <= maxLength);
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
        cursor += word.length;
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
        for (let c = t.col; c < t.col + t.length; c++) occupied.add(c);
    });
    let start = tile.col;
    while (start > 0 && !occupied.has(start - 1)) start--;
    let end = tile.col + tile.length;
    while (end < GRID_COLUMNS && !occupied.has(end)) end++;
    return [...rest, ...fillSegment(pool, tile.row, start, end - start, random, nextKey)];
}
