import { describe, it, expect } from 'vitest';
import { WORD_SEARCH_TEMPLATE_SETS } from '../services/wordSearchTemplates.js';
import { generateWordSearchGrid, type GridCell, type WordSearchInput } from '../services/wordSearchGrid.js';
import { CARD_BASELINES, WORD_SEARCH_BOARDS } from '../contracts/wire.js';

/**
 * The templates are GENERATED DATA committed as source (see
 * server/scripts/generate-word-search-templates.js and
 * docs/WORD_SEARCH_TEMPLATES.md), so nothing in a code review re-checks them.
 * These are the invariants `generateWordSearchGrid` relies on when it drops into
 * template mode — if any breaks, template mode silently stops guaranteeing a fit.
 */
const SLOT_LEN = 4;
const key = (r: number, c: number) => `${r},${c}`;
const adjacent = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

describe.each(WORD_SEARCH_TEMPLATE_SETS.map((set) => [`${set.rows}x${set.cols}`, set] as const))('word search placement templates %s', (_board, set) => {
  const { rows, cols, templates } = set;
  const holes = new Set(set.holes.map(([r, c]) => key(r, c)));
  const nonHoleCells = rows * cols - holes.size;
  const slotsPerTemplate = nonHoleCells / SLOT_LEN;

  it('has a whole number of slots covering every non-hole cell', () => {
    expect(nonHoleCells % SLOT_LEN).toBe(0);
    expect(templates.length).toBeGreaterThan(0);
  });

  // Template mode only engages when the word count equals the slot count
  // (`templateModeApplicable`), so a board that holds fewer words than the
  // templates have slots would never reach the fallback at all.
  it('has one slot per word the board is sized for', () => {
    const board = Object.values(WORD_SEARCH_BOARDS).find((b) => b.rows === rows && b.cols === cols);
    expect(slotsPerTemplate).toBe(board?.words);
  });

  it.each(templates.map((t, i) => [i, t] as const))(
    'template %i tiles the board with walkable, disjoint 4-cell paths',
    (_i, template) => {
      expect(template.slots).toHaveLength(slotsPerTemplate);
      const covered = new Set<string>();

      for (const slot of template.slots) {
        expect(slot).toHaveLength(SLOT_LEN);
        const own = new Set(slot.map(([r, c]) => key(r, c)));
        expect(own.size).toBe(SLOT_LEN); // no repeated cell within a slot

        for (const [r, c] of slot) {
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThan(rows);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThan(cols);
          expect(holes.has(key(r, c))).toBe(false); // never covers a hole
          expect(covered.has(key(r, c))).toBe(false); // no overlap between slots
          covered.add(key(r, c));
        }

        // Consecutive cells orthogonally adjacent — a word snakes along the slot.
        for (let i = 1; i < slot.length; i++) {
          expect(adjacent(slot[i - 1], slot[i])).toBe(true);
        }
        // No cell touches more than 2 of its own slot's cells: a T/plus piece
        // cannot be walked as a single path even though its cells are connected.
        for (const cell of slot) {
          const touching = slot.filter((other) => adjacent(cell, other)).length;
          expect(touching).toBeLessThanOrEqual(2);
        }
        // Not a closed loop (a 2x2 square) — a cycle would read as the same word
        // in several directions, so the found-path check could not be exact.
        expect(adjacent(slot[0], slot[slot.length - 1])).toBe(false);
      }

      expect(covered.size).toBe(nonHoleCells);
    }
  );

  it('has no duplicate templates', () => {
    const canonical = templates.map((t) =>
      t.slots
        .map((slot) => slot.map(([r, c]) => key(r, c)).sort().join(' '))
        .sort()
        .join(' | ')
    );
    expect(new Set(canonical).size).toBe(canonical.length);
  });
});

describe('word search boards', () => {
  it('sizes each distribution to its board', () => {
    for (const board of Object.values(WORD_SEARCH_BOARDS)) {
      expect(Object.values(board.distribution).reduce((a, b) => a + b, 0)).toBe(board.words);
    }
  });

  it('keeps the standard board at the provisional baseline', () => {
    expect(WORD_SEARCH_BOARDS.standard.words).toBe(CARD_BASELINES['word-search']);
  });

  // The whole point of the compact templates: at 28 of 30 cells, seven full-length words.
  it('fits seven 4-character words on the compact board', () => {
    const { rows, cols, words: count } = WORD_SEARCH_BOARDS.compact;
    const words: WordSearchInput[] = Array.from({ length: count }, (_, w) => {
      const chars = Array.from({ length: SLOT_LEN }, (_c, i) => String.fromCodePoint(0x4e00 + w * SLOT_LEN + i));
      return { id: w + 1, entryKey: chars.join(''), pinyin: 'a a a a', definition: `w${w}` };
    });
    const filler: GridCell[] = [{ char: '一', pinyin: 'yi' }, { char: '二', pinyin: 'er' }];

    for (let run = 0; run < 50; run++) {
      const board = generateWordSearchGrid(words, filler, rows, cols);
      expect(board.rows).toBe(rows);
      expect(board.cols).toBe(cols);
      const used = new Set(board.words.flatMap((w) => w.cells.map(([r, c]) => key(r, c))));
      expect(used.size).toBe(count * SLOT_LEN);
    }
  });
});
