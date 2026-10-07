import type { IWritingNotebookDAL } from '../dal/interfaces/IWritingNotebookDAL.js';
import { ValidationError } from '../types/dal.js';
import { recognizeChinese, type Ink } from '../utils/handwritingRecognizer.js';
import {
  INK_GRID,
  NOTEBOOK_MAX_CELL_INDEX,
  NOTEBOOK_MAX_RANGE,
  decodeNotebookInk,
  distinctChars,
  isNotebookWord,
  sheetCount,
  type NotebookCell,
  type NotebookInk,
  type NotebookSheetState,
  type NotebookSummary,
} from '../contracts/writingNotebook.js';

/** Ranked candidates for one ink on a square writing area of `size`. */
export type NotebookRecognizer = (ink: Ink, width: number, height: number) => Promise<string[]>;

/** Spacing (ms) of the synthetic timestamps — stored ink carries none (the codec drops them). */
const SYNTHETIC_SAMPLE_MS = 16;

/**
 * WritingNotebookService — the Writing Notebook's rules (docs/WRITING_NOTEBOOK.md).
 *
 * LAYER: service. Validates every input (word, cell index, range, ink encoding), runs
 * the handwriting recogniser on a saved cell and decides which character of the sheet's
 * word it credits, and turns the DAL's raw credit tallies into counters
 * (`sheetCount`, server/contracts/writingNotebook.ts). The VERDICT never leaves this
 * service — callers get ink and counters only, because the page must not reveal
 * whether a cell passed.
 *
 * zh only: the recogniser is Chinese, and `isNotebookWord` admits only Han words.
 */
export class WritingNotebookService {
  constructor(
    private notebookDAL: IWritingNotebookDAL,
    private recognize: NotebookRecognizer = recognizeChinese
  ) {}

  /** The belt card's total + the word the page reopens on. */
  async getSummary(userId: string, language: string): Promise<NotebookSummary> {
    const [lastWord, credits] = await Promise.all([
      this.notebookDAL.findLastWord(userId, language),
      this.notebookDAL.listCredits(userId, language),
    ]);
    // Group the tallies by sheet, then sum each sheet's counter. A sheet with no
    // credited cell has no tally rows and counts 0, so leaving it out changes nothing.
    const bySheet = new Map<string, Map<string, number>>();
    for (const row of credits) {
      const tally = bySheet.get(row.word) ?? new Map<string, number>();
      tally.set(row.matchedChar, row.credited);
      bySheet.set(row.word, tally);
    }
    let totalCount = 0;
    for (const [word, tally] of bySheet) totalCount += sheetCount(word, tally);
    return { lastWord, totalCount };
  }

  /** Opening a sheet: create it if new, stamp it as the last opened, return its counter. */
  async openSheet(userId: string, language: string, word: unknown): Promise<NotebookSheetState> {
    const sheetWord = this.requireWord(word);
    await this.notebookDAL.touchSheet(userId, language, sheetWord);
    return { word: sheetWord, count: await this.countFor(userId, language, sheetWord) };
  }

  /** Filled cells in [from, to). */
  async listCells(userId: string, language: string, word: unknown, from: unknown, to: unknown): Promise<NotebookCell[]> {
    const sheetWord = this.requireWord(word);
    const start = this.requireIndex(from, 'from');
    const end = this.requireIndex(to, 'to', NOTEBOOK_MAX_CELL_INDEX + 1);
    if (end <= start) return [];
    if (end - start > NOTEBOOK_MAX_RANGE) {
      throw new ValidationError(`a cell range may span at most ${NOTEBOOK_MAX_RANGE} cells`);
    }
    return this.notebookDAL.listCells(userId, language, sheetWord, start, end);
  }

  /** The lowest empty cell at or after `after` — the "jump to next empty" target. */
  async findNextEmpty(userId: string, language: string, word: unknown, after: unknown): Promise<number> {
    const sheetWord = this.requireWord(word);
    return this.notebookDAL.findNextEmpty(userId, language, sheetWord, this.requireIndex(after, 'after'));
  }

  /**
   * Save one cell on canvas exit, and re-validate it. Empty ink deletes the cell (it is
   * blank again). Otherwise the ink is recognised on its DECODED form — exactly what is
   * stored, so a later re-edit is judged the same way — and credited to the word's
   * character iff that character is the recogniser's top-1 (the app-wide strict rule,
   * docs/PRACTICE_WRITING.md § "Grading").
   *
   * A recogniser FAILURE (upstream down / timeout) still saves the ink, uncredited: the
   * learner's writing is never lost to a flaky third party. It is logged, and the cell
   * re-validates the next time it is edited. See docs/WRITING_NOTEBOOK.md § "Open flags".
   *
   * Returns the sheet's counter after the write.
   */
  async saveCell(
    userId: string,
    language: string,
    word: unknown,
    cellIndex: unknown,
    ink: unknown
  ): Promise<NotebookSheetState> {
    const sheetWord = this.requireWord(word);
    const index = this.requireIndex(cellIndex, 'cellIndex');
    if (typeof ink !== 'string') throw new ValidationError('ink must be an encoded string');

    let decoded: NotebookInk;
    try {
      decoded = decodeNotebookInk(ink);
    } catch (err: any) {
      throw new ValidationError(err?.message ?? 'malformed ink');
    }

    if (decoded.length === 0) {
      await this.notebookDAL.deleteCell(userId, language, sheetWord, index);
    } else {
      const matchedChar = await this.recogniseCredit(sheetWord, decoded);
      await this.notebookDAL.upsertCell(userId, language, sheetWord, index, ink, matchedChar);
    }
    return { word: sheetWord, count: await this.countFor(userId, language, sheetWord) };
  }

  // ── internals ───────────────────────────────────────────────────────────────

  /** The word's character this ink is credited to, or null (no match / recogniser down). */
  private async recogniseCredit(word: string, ink: NotebookInk): Promise<string | null> {
    // Back onto the recogniser's pixel-like grid, with evenly spaced synthetic timestamps.
    const recognizerInk: Ink = ink.map((s) => ({
      xs: s.xs.map((x) => Math.round(x * INK_GRID)),
      ys: s.ys.map((y) => Math.round(y * INK_GRID)),
      ts: s.xs.map((_, i) => i * SYNTHETIC_SAMPLE_MS),
    }));
    try {
      const candidates = await this.recognize(recognizerInk, INK_GRID, INK_GRID);
      const top1 = candidates[0];
      return top1 && distinctChars(word).includes(top1) ? top1 : null;
    } catch (err: any) {
      console.error('WritingNotebookService: recognition failed, saving uncredited:', err?.message || err);
      return null;
    }
  }

  private async countFor(userId: string, language: string, word: string): Promise<number> {
    const credits = await this.notebookDAL.listCredits(userId, language, word);
    return sheetCount(word, new Map(credits.map((c) => [c.matchedChar, c.credited])));
  }

  private requireWord(word: unknown): string {
    if (!isNotebookWord(word)) throw new ValidationError('word must be a non-empty all-Han word');
    return word;
  }

  private requireIndex(value: unknown, name: string, max = NOTEBOOK_MAX_CELL_INDEX): number {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > max) {
      throw new ValidationError(`${name} must be an integer between 0 and ${max}`);
    }
    return n;
  }
}
