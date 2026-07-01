/**
 * Word Search — shared types.
 *
 * Mirrors the payload from GET /api/onDeck/word-search-grid (server-side grid
 * generation lives in server/services/wordSearchGrid.ts). See
 * docs/WORD_SEARCH_GAME.md.
 */

/** One grid cell: a Chinese character and its pinyin syllable. */
export interface GridCell {
    char: string;
    pinyin: string;
}

/** A target word plus the ordered cell path it snakes through. */
export interface PlacedWord {
    entryKey: string;
    /** Space-separated tone-marked pinyin, one syllable per character. */
    pinyin: string;
    /** English gloss shown in the top word list. */
    definition: string;
    /** Ordered [row, col] path, one entry per character. */
    cells: [number, number][];
}

/** Shape returned by GET /api/onDeck/word-search-grid. */
export interface WordSearchResponse {
    grid: GridCell[][] | null; // null when !sufficient
    words: PlacedWord[];
    rows: number;
    cols: number;
    total: number;
    available: Record<string, number>;
    sufficient: boolean;
    /** Why the game is blocked when !sufficient (client picks the copy). */
    reason?: "language" | "insufficient-distinct" | "no-filler";
}

/** A cell coordinate in the grid. */
export type Coord = [number, number];

/** Awarded medal tier for a completed board (by total time). */
export type Medal = "gold" | "silver" | "bronze";
