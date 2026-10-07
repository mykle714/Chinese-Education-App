import type { NotebookCell } from '../../contracts/writingNotebook.js';

/** One (word, character) credit tally — the counter's raw input. */
export interface NotebookCreditRow {
  word: string;
  matchedChar: string;
  credited: number;
}

/**
 * Data-access contract for the Writing Notebook (migration 174): `notebook_sheets` and
 * `notebook_cells`. Pure storage — which character a cell is credited to, and how the
 * counter is computed from the credits, are WritingNotebookService's / the contract's.
 * Docs: docs/WRITING_NOTEBOOK.md § "Storage".
 */
export interface IWritingNotebookDAL {
  /** Create the sheet if new, and stamp it as the most recently opened. */
  touchSheet(userId: string, language: string, word: string): Promise<void>;

  /** The most recently opened sheet's word, or null. */
  findLastWord(userId: string, language: string): Promise<string | null>;

  /** Filled cells with `from <= cellIndex < to`, ascending. Ink only — never the verdict. */
  listCells(userId: string, language: string, word: string, from: number, to: number): Promise<NotebookCell[]>;

  /**
   * Insert or replace one cell's ink + verdict. Creates the sheet row first when it is
   * missing (a write can race a sheet that was never opened through `touchSheet`).
   */
  upsertCell(
    userId: string,
    language: string,
    word: string,
    cellIndex: number,
    ink: string,
    matchedChar: string | null
  ): Promise<void>;

  /** Remove one cell (erased back to blank). A missing row is a no-op. */
  deleteCell(userId: string, language: string, word: string, cellIndex: number): Promise<void>;

  /** Credited-cell tallies per (word, character) — one word, or every sheet when `word` is omitted. */
  listCredits(userId: string, language: string, word?: string): Promise<NotebookCreditRow[]>;

  /** The lowest EMPTY cell index >= `after` (cells beyond the last filled one are empty). */
  findNextEmpty(userId: string, language: string, word: string, after: number): Promise<number>;
}
