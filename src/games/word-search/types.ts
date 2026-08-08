/**
 * Word Search — shared types.
 *
 * Mirrors the payload from GET /api/onDeck/wordSearchGrid (server-side grid
 * generation lives in server/services/wordSearchGrid.ts). See
 * docs/WORD_SEARCH_GAME.md.
 */

/** One grid cell: a Chinese character and its pinyin syllable. */
export interface GridCell {
    char: string;
    pinyin: string;
    /**
     * Context-correct sense for this character, present ONLY on cells belonging to
     * a target word (filler cells omit them). `definition` is the ddt of the
     * character's det cluster matching `sense` (resolved server-side at grid build);
     * `sense` is the cluster label. Tapping the cell shows `definition` so the
     * player sees the character's meaning IN THIS WORD, not its generic gloss.
     * See server/services/wordSearchGrid.ts and docs/WORD_SEARCH_GAME.md.
     */
    sense?: string;
    definition?: string;
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
    /**
     * Sub-character visual parts, one array per character (aligned by position):
     * 想吃 → [["木","目","心"], ["口","乞"]]. Already ordered most-common-first, so
     * revealing them in order escalates the hint from weak to decisive.
     *
     * The hint currency for **No Pinyin** mode — see `componentUnits.ts` and
     * `WordSearchHintRow`. An empty inner array means that character is atomic
     * (人, 口, 木): it has no parts, so its ladder goes straight to the character.
     * Absent on boards saved before this shipped; treat as all-empty.
     */
    charComponents?: string[][];
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

/** Shape returned by GET /api/onDeck/wordSearchGrid. */
export interface WordSearchResponse {
    grid: GridCell[][] | null; // null when !sufficient
    words: PlacedWord[];
    bonusWords: BonusWord[];
    rows: number;
    cols: number;
    total: number;
    available: Record<string, number>;
    sufficient: boolean;
    /**
     * Words in this grid that were LENT to reach the baseline rather than sorted by the
     * player (docs/PROVISIONAL_CARDS.md). Drives the pre-round notice and the
     * end-of-round "keep these" offer. Absent/empty when the player's own deck covered
     * the grid.
     */
    provisionalWords?: string[];
    /** Why the game is blocked when !sufficient (client picks the copy). */
    reason?: "language" | "insufficient-distinct" | "no-filler";
    /** Index into WORD_SEARCH_TEMPLATES if template mode placed this grid, else null (random snaking). */
    templateIndex?: number | null;
}

/** A cell coordinate in the grid. */
export type Coord = [number, number];

/** Awarded medal tier for a completed board (by total time). */
export type Medal = "gold" | "silver" | "bronze";
