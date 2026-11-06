import { splitHanRuns } from '../dal/shared/segmentString.js';

/**
 * Derived title for a new Reader document (docs/USER_DOCUMENT_FEATURE_SUMMARY.md
 * § "Creating a document").
 *
 * LAYER: pure utility — no I/O. The caller (TextService.createText) supplies the
 * Chinese-run segmenter, which is where the det lookup happens.
 *
 * Rule: take the document's first non-empty line and keep as many WHOLE words as fit
 * in DOCUMENT_TITLE_MAX_CHARS characters (code points, so a CJK character counts as
 * one). "Word" means a gsa segment inside a Chinese run and a whitespace-delimited
 * token everywhere else, so a title never cuts 图书馆 or "library" in half. Only when
 * the very first word is itself longer than the budget is it hard-cut, because
 * otherwise the title would be empty. An empty document is "Untitled".
 *
 * Depended on by: server/services/TextService.ts → createText;
 * server/__tests__/documentTitle.test.ts.
 */

export const DOCUMENT_TITLE_MAX_CHARS = 20;
export const UNTITLED_DOCUMENT_TITLE = 'Untitled';

/**
 * How much of the first line gets segmented. Segmenting the whole line would be
 * wasted lookups on a long paragraph; this window is comfortably wider than the
 * budget plus the longest gsa token (4 chars), so the word that straddles the
 * budget boundary is always segmented with its full context.
 */
export const DOCUMENT_TITLE_SEGMENT_WINDOW = 64;

/** Splits one Chinese run into gsa segments that concatenate back to the run. */
export type HanSegmenter = (hanRun: string) => string[];

const codePointLength = (value: string): number => [...value].length;

/**
 * The text the title is cut from: the first non-empty line, inner whitespace
 * collapsed, capped at the segmentation window. Exposed so the caller can collect
 * the det lookup candidates from exactly the string that will be segmented.
 */
export function documentTitleSource(content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .find((line) => line.length > 0) ?? '';
  return [...firstLine].slice(0, DOCUMENT_TITLE_SEGMENT_WINDOW).join('');
}

/** Builds the title from `documentTitleSource(content)` using the given segmenter. */
export function deriveDocumentTitle(content: string, segmentHan: HanSegmenter): string {
  const source = documentTitleSource(content);
  if (!source) return UNTITLED_DOCUMENT_TITLE;

  // Flatten into an ordered word list. Whitespace is its own token so that a
  // space is only kept when the word after it fits too (trimmed off the end below).
  const words: string[] = [];
  for (const run of splitHanRuns(source)) {
    if (run.type === 'han') words.push(...segmentHan(run.value));
    else words.push(...run.value.split(/(\s+)/).filter((token) => token.length > 0));
  }

  let title = '';
  for (const word of words) {
    if (codePointLength(title + word) > DOCUMENT_TITLE_MAX_CHARS) break;
    title += word;
  }
  title = title.trim();

  // First word alone is over budget (e.g. a 25-letter token): hard-cut it.
  if (!title) title = [...source].slice(0, DOCUMENT_TITLE_MAX_CHARS).join('').trim();
  return title || UNTITLED_DOCUMENT_TITLE;
}
