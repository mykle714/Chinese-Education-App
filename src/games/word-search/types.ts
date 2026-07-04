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
    /** vet id — used to mark the card correct via /api/flashcards/mark on find. */
    id: number;
    entryKey: string;
    /** Space-separated tone-marked pinyin, one syllable per character. */
    pinyin: string;
    /** English gloss shown in the top word list. */
    definition: string;
    /** Ordered [row, col] path, one entry per character. */
    cells: [number, number][];
}

/**
 * A det headword whose entire character sequence is drawn exclusively from
 * characters that appear somewhere on the grid — NOT necessarily one of the
 * 10 targets, and not guaranteed to trace an adjacent-cell path (the client
 * still checks the actual dragged path). Used to recognize a "bonus" find:
 * a real word the player traced that isn't a target (see doc §4).
 */
export interface BonusWord {
    entryKey: string;
    /** Space-separated tone-marked pinyin, one syllable per character. */
    pinyin: string;
    definition: string;
}

/** Shape returned by GET /api/onDeck/word-search-grid. */
export interface WordSearchResponse {
    grid: GridCell[][] | null; // null when !sufficient
    words: PlacedWord[];
    bonusWords: BonusWord[];
    rows: number;
    cols: number;
    total: number;
    available: Record<string, number>;
    sufficient: boolean;
    /** Why the game is blocked when !sufficient (client picks the copy). */
    reason?: "language" | "insufficient-distinct" | "no-filler";
    /** Index into WORD_SEARCH_TEMPLATES if template mode placed this grid, else null (random snaking). */
    templateIndex?: number | null;
}

/** A cell coordinate in the grid. */
export type Coord = [number, number];

/** Awarded medal tier for a completed board (by total time). */
export type Medal = "gold" | "silver" | "bronze";
