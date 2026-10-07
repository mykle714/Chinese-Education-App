/**
 * writingNotebook.ts — the Writing Notebook's shared rules (docs/WRITING_NOTEBOOK.md).
 *
 * The notebook is an endless practice sheet per word: rows of NOTEBOOK_COLUMNS cells,
 * each holding one hand-written character. Cells are free — any character of the sheet's
 * word may be written in any cell — and each saved cell is recognised server-side and
 * credited to whichever character of the word it matched (top-1). The verdict is never
 * shown; only the sheet's counter moves.
 *
 * What lives here (pure, no I/O — both halves import it):
 *   • sheet geometry (columns, page size) and input caps;
 *   • the compact INK CODEC — ink is stored for the lifetime of the account, so it is
 *     quantised to a 0..INK_GRID integer grid, simplified, and packed as delta-encoded
 *     base-36 text (~0.4–1 KB per character instead of ~15–25 KB of raw jsonb);
 *   • the counter rule (`sheetCount`): min over the word's DISTINCT characters of the
 *     cells credited to it.
 *
 * Referenced by: server/services/WritingNotebookService.ts, server/dal/implementations/
 * WritingNotebookDAL.ts, src/api/writingNotebook.ts, src/features/writingNotebook/*.
 * Docs: docs/WRITING_NOTEBOOK.md § "Storage" and § "Counter".
 */

/** Cells per row. */
export const NOTEBOOK_COLUMNS = 4;
/** Rows per load chunk ("page"). */
export const NOTEBOOK_PAGE_ROWS = 10;
/** Cells per load chunk. */
export const NOTEBOOK_PAGE_SIZE = NOTEBOOK_COLUMNS * NOTEBOOK_PAGE_ROWS;
/** Highest cell index a client may write — a sanity cap, not a product limit (250k rows). */
export const NOTEBOOK_MAX_CELL_INDEX = 999_999;
/**
 * Longest word (code points) a sheet may be keyed by. Four, so the header can draw every
 * character's writing shadow in a full-size replica cell (decided 2026-10-06). The
 * picker offers nothing longer and the server refuses it.
 */
export const NOTEBOOK_MAX_WORD_LENGTH = 4;
/** Widest cell range one read may ask for. */
export const NOTEBOOK_MAX_RANGE = NOTEBOOK_PAGE_SIZE * 4;

/** The integer grid normalised ink is quantised to (0..INK_GRID on both axes). */
export const INK_GRID = 1000;
/** Ramer–Douglas–Peucker tolerance in grid units (1000 = the cell's edge): ~0.6px on a 300px canvas. */
const SIMPLIFY_EPSILON = 2;
/** Caps mirrored from server/utils/handwritingRecognizer.ts → validateInk. */
export const NOTEBOOK_MAX_STROKES = 60;
export const NOTEBOOK_MAX_POINTS_PER_STROKE = 600;
/** Format tag, so a future encoding can be told apart from this one. */
const CODEC_PREFIX = 'v1:';

/** One stroke in NORMALISED coordinates: every x / y in [0, 1] of the cell's edge. */
export interface NotebookStroke {
  xs: number[];
  ys: number[];
}
export type NotebookInk = NotebookStroke[];

/** One saved cell as the client receives it — the ink, never the verdict. */
export interface NotebookCell {
  cellIndex: number;
  /** Encoded ink (`encodeNotebookInk`). */
  ink: string;
}

/** `GET /api/writingNotebook/summary` — the belt card + the page's opening word. */
export interface NotebookSummary {
  /** The most recently opened sheet's word, or null before the first pick. */
  lastWord: string | null;
  /** Sum of every sheet's counter. */
  totalCount: number;
}

/** A sheet's header data (`POST /sheets/open`, and every cell write's reply). */
export interface NotebookSheetState {
  word: string;
  count: number;
}

/** True for a non-empty, all-Han string within the length cap — the only words a sheet takes. */
export function isNotebookWord(word: unknown): word is string {
  if (typeof word !== 'string') return false;
  const chars = [...word];
  return chars.length > 0 && chars.length <= NOTEBOOK_MAX_WORD_LENGTH && /^\p{Script=Han}+$/u.test(word);
}

/** The word's distinct characters, in first-seen order (谢谢 → [谢]). */
export function distinctChars(word: string): string[] {
  return [...new Set([...word])];
}

/**
 * The sheet counter: the smallest number of cells credited to any ONE of the word's
 * distinct characters. A character nobody has written yet counts 0, so 明天 with five
 * 明 and no 天 reads 0. `creditedByChar` may carry characters outside the word (it never
 * should — the service only credits the word's own) and they are ignored.
 */
export function sheetCount(word: string, creditedByChar: ReadonlyMap<string, number>): number {
  const chars = distinctChars(word);
  if (chars.length === 0) return 0;
  return Math.min(...chars.map((c) => creditedByChar.get(c) ?? 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Ink codec
// ─────────────────────────────────────────────────────────────────────────────

const quantise = (v: number) => Math.min(INK_GRID, Math.max(0, Math.round(v * INK_GRID)));

/** Perpendicular distance from p to the segment a–b (all in grid units). */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Ramer–Douglas–Peucker over one stroke's points, iterative (a long stroke must not
 * recurse deeply). Keeps the endpoints; drops interior points that sit within
 * SIMPLIFY_EPSILON of the line between their kept neighbours.
 */
function simplify(xs: number[], ys: number[]): { xs: number[]; ys: number[] } {
  const n = xs.length;
  if (n <= 2) return { xs, ys };
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(xs[i], ys[i], xs[first], ys[first], xs[last], ys[last]);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (index !== -1 && maxDist > SIMPLIFY_EPSILON) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const outX: number[] = [];
  const outY: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) { outX.push(xs[i]); outY.push(ys[i]); }
  return { xs: outX, ys: outY };
}

/**
 * Normalised ink → compact text. Format `v1:` + strokes joined by `;`, each stroke a
 * comma list of signed base-36 integers: the first point absolute, every later point
 * as a delta from the previous one (deltas are usually one or two digits).
 * Lossy by design (quantised + simplified) — the recogniser is always run on the
 * DECODED form, so a re-validation judges exactly what is stored.
 */
export function encodeNotebookInk(ink: NotebookInk): string {
  const strokes: string[] = [];
  for (const stroke of ink) {
    const n = Math.min(stroke.xs.length, stroke.ys.length);
    if (n === 0) continue;
    const { xs, ys } = simplify(
      stroke.xs.slice(0, n).map(quantise),
      stroke.ys.slice(0, n).map(quantise)
    );
    const parts: string[] = [];
    let px = 0;
    let py = 0;
    for (let i = 0; i < xs.length; i++) {
      parts.push((xs[i] - px).toString(36), (ys[i] - py).toString(36));
      px = xs[i];
      py = ys[i];
    }
    strokes.push(parts.join(','));
  }
  return CODEC_PREFIX + strokes.join(';');
}

/**
 * Compact text → normalised ink. Throws on anything malformed or over the caps, so the
 * server can use it as its input validator. An encoded EMPTY ink (`v1:`) decodes to [].
 */
export function decodeNotebookInk(encoded: string): NotebookInk {
  if (typeof encoded !== 'string' || !encoded.startsWith(CODEC_PREFIX)) {
    throw new Error('ink must be a v1 notebook encoding');
  }
  const body = encoded.slice(CODEC_PREFIX.length);
  if (body === '') return [];
  const strokeTexts = body.split(';');
  if (strokeTexts.length > NOTEBOOK_MAX_STROKES) throw new Error(`too many strokes (max ${NOTEBOOK_MAX_STROKES})`);
  return strokeTexts.map((text, s) => {
    const values = text.split(',');
    if (values.length === 0 || values.length % 2 !== 0) throw new Error(`stroke ${s} has an odd coordinate count`);
    if (values.length / 2 > NOTEBOOK_MAX_POINTS_PER_STROKE) throw new Error(`stroke ${s} has too many points`);
    const xs: number[] = [];
    const ys: number[] = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < values.length; i += 2) {
      const dx = parseInt(values[i], 36);
      const dy = parseInt(values[i + 1], 36);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error(`stroke ${s} has a malformed coordinate`);
      x += dx;
      y += dy;
      if (x < 0 || x > INK_GRID || y < 0 || y > INK_GRID) throw new Error(`stroke ${s} leaves the cell`);
      xs.push(x / INK_GRID);
      ys.push(y / INK_GRID);
    }
    return { xs, ys };
  });
}
