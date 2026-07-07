/**
 * Word Search — pure grid generation.
 *
 * Kept free of DB / IO so the snaking-placement algorithm is deterministically
 * unit-testable (inject `rng`). OnDeckVocabService.getWordSearchGrid owns the
 * impure parts (assembling the 20-word pool, the substring de-dup pass, and
 * fetching filler characters) and calls generateWordSearchGrid with the results.
 *
 * Referenced by docs/WORD_SEARCH_GAME.md §2 (grid generation).
 */

import { WORD_SEARCH_TEMPLATES } from './wordSearchTemplates.js';

export type Rng = () => number;

/** One target word to hide in the grid. */
export interface WordSearchInput {
  id: number; // vet id, used to mark the card correct via /api/flashcards/mark on find
  entryKey: string; // Chinese text, e.g. "学生"
  pinyin: string; // space-separated tone-marked syllables, one per character
  definition: string; // English gloss shown in the top word list
  /**
   * Per-component-character context-correct sense, one entry per entryKey
   * character (aligned by position). Resolved from each character's own det
   * `definitionClusters` keyed by the word's `breakdown[char].sense` label
   * (see OnDeckVocabService.getWordSearchGrid). Written onto the placed cells so
   * a tap on a target character shows THAT character's sense IN THIS WORD, not
   * its generic standalone gloss. Absent → cells carry no per-char definition.
   */
  charSenses?: Array<{ sense: string | null; definition: string | null }>;
}

/** A single grid cell: one Chinese character + its pinyin syllable. */
export interface GridCell {
  char: string;
  pinyin: string;
  /**
   * Context-correct sense for this character, present ONLY on cells that belong
   * to a target word (filler cells omit them). `definition` is the ddt of the
   * character's det cluster matching `sense`; `sense` is the cluster label. A tap
   * on the cell shows `definition`. See WordSearchInput.charSenses.
   */
  sense?: string;
  definition?: string;
}

/** A placed target: the input word plus the ordered cell path it occupies. */
export interface PlacedWord extends WordSearchInput {
  /** Ordered [row, col] path, one entry per character. */
  cells: [number, number][];
}

export interface WordSearchGrid {
  rows: number;
  cols: number;
  grid: GridCell[][]; // grid[row][col]
  words: PlacedWord[];
  /** Index into WORD_SEARCH_TEMPLATES if template mode placed this grid, else null (random snaking). */
  templateIndex: number | null;
}

/** Orthogonal (4-direction) neighbor offsets — no diagonals (see doc §2). */
const NEIGHBORS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Down/right only — used for 2-character words so their single step always
 * reads in character order (top-to-bottom or left-to-right), never reversed.
 * Longer words still snake through all 4 NEIGHBORS since a mid-word turn makes
 * "reading order" ambiguous anyway.
 */
const FORWARD_NEIGHBORS: [number, number][] = [
  [1, 0],
  [0, 1],
];

/**
 * Per-word placement attempts before we give up on the whole grid and
 * regenerate from scratch. The spec calls for ~10: each attempt picks a fresh
 * random start and snakes forward, so 10 independent tries almost always find a
 * fit on a sparsely-filled 12×16 board.
 */
export const MAX_WORD_ATTEMPTS = 10;

/**
 * Whole-grid regenerations before we bail. Needing even one is already unlikely;
 * this is just a hard stop so a pathological input can't spin forever.
 */
export const MAX_GRID_ATTEMPTS = 100;

/**
 * Whole-grid regenerations that use random snaking placement before falling
 * back to a fixed template (see docs/WORD_SEARCH_TEMPLATES.md). 10 words all
 * at the 4-character cap can wall each other off badly enough that random
 * retries burn through many attempts on bad luck; a template guarantees a fit
 * instead of continuing to gamble. Attempts `RANDOM_GRID_ATTEMPTS` and above
 * (up to MAX_GRID_ATTEMPTS) use template mode when it applies (§ below).
 */
export const RANDOM_GRID_ATTEMPTS = 5;

/**
 * Anti-duplicate fixup passes (see §2a below) before we give up and regenerate
 * the whole grid. Each pass patches every offending filler cell it finds, so
 * convergence is typically 1-2 passes; this is a generous ceiling against
 * pathological oscillation.
 */
const MAX_DEDUP_PASSES = 20;

function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** Fisher-Yates shuffle using the grid's own rng, so placement stays deterministic under a seeded rng. */
function shuffle<T>(arr: T[], rng: Rng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Template mode (docs/WORD_SEARCH_TEMPLATES.md) only applies to the shape this
 * game actually ships: a 7x7 board with exactly 10 words, each <= 4 characters
 * (one word per template slot, no leftover words or slots). Any other shape
 * (e.g. a differently-sized test board) keeps retrying random placement for
 * the full MAX_GRID_ATTEMPTS instead.
 */
function templateModeApplicable(
  prepared: { chars: string[] }[],
  rows: number,
  cols: number
): boolean {
  return (
    rows === 7 &&
    cols === 7 &&
    prepared.length === WORD_SEARCH_TEMPLATES[0]?.slots.length &&
    prepared.every((p) => p.chars.length >= 1 && p.chars.length <= 4)
  );
}

/** Coordinate-list equality (order matters). */
function pathsEqual(a: [number, number][], b: [number, number][]): boolean {
  return a.length === b.length && a.every(([r, c], i) => r === b[i][0] && c === b[i][1]);
}

/** Equal as a path traced in either direction (matches the client's found-check). */
function pathsEqualEitherDirection(a: [number, number][], b: [number, number][]): boolean {
  return pathsEqual(a, b) || pathsEqual(a, [...b].reverse());
}

/**
 * Every simple orthogonally-adjacent path in the (possibly still-in-progress)
 * grid that spells `chars` in order — turns included, no cell revisited within
 * one path. Mirrors the freedom a player's drag actually has (§4), so this finds
 * any accidental "findable-looking" occurrence, not just straight runs.
 */
function findWordOccurrences(
  cells: (GridCell | null)[][],
  chars: string[],
  rows: number,
  cols: number
): [number, number][][] {
  const occurrences: [number, number][][] = [];
  const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));

  function dfs(r: number, c: number, idx: number, path: [number, number][]) {
    const cell = cells[r][c];
    if (!cell || cell.char !== chars[idx]) return;
    path.push([r, c]);
    if (idx === chars.length - 1) {
      occurrences.push([...path]);
    } else {
      visited[r][c] = true;
      for (const [dr, dc] of NEIGHBORS) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (visited[nr][nc]) continue;
        dfs(nr, nc, idx + 1, path);
      }
      visited[r][c] = false;
    }
    path.pop();
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      dfs(r, c, 0, []);
    }
  }
  return occurrences;
}

/**
 * Try to lay a single word of `len` characters as a snaking path of empty cells.
 * Picks a random empty start, then repeatedly steps to a random empty orthogonal
 * neighbor. 2-character words step only down or right (FORWARD_NEIGHBORS) so
 * they always read in character order; longer words snake through all 4
 * NEIGHBORS. Returns the ordered path, or null if it hit a dead end (the
 * caller retries with a new random start).
 */
function tryPlaceWord(
  len: number,
  occupied: boolean[][],
  rows: number,
  cols: number,
  rng: Rng
): [number, number][] | null {
  const startR = randInt(rng, rows);
  const startC = randInt(rng, cols);
  if (occupied[startR][startC]) return null;

  const path: [number, number][] = [[startR, startC]];
  const inPath = new Set<string>([`${startR},${startC}`]);
  const directions = len === 2 ? FORWARD_NEIGHBORS : NEIGHBORS;

  for (let i = 1; i < len; i++) {
    const [r, c] = path[path.length - 1];
    // Empty, in-bounds neighbors not already on this path.
    const options: [number, number][] = [];
    for (const [dr, dc] of directions) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (occupied[nr][nc]) continue;
      if (inPath.has(`${nr},${nc}`)) continue;
      options.push([nr, nc]);
    }
    if (options.length === 0) return null; // dead end — caller restarts
    const next = options[randInt(rng, options.length)];
    path.push(next);
    inPath.add(`${next[0]},${next[1]}`);
  }

  return path;
}

/**
 * Place every word (snaking, orthogonal), then flood the remaining cells with
 * filler characters drawn from `fillerPool`.
 *
 * Placement uses per-word restarts (MAX_WORD_ATTEMPTS) and, failing that, whole-
 * grid regeneration (MAX_GRID_ATTEMPTS). Throws only if the board genuinely can't
 * hold the words (e.g. total characters exceed capacity) or the filler pool is
 * empty — both of which the caller guards against upstream.
 */
export function generateWordSearchGrid(
  words: WordSearchInput[],
  fillerPool: GridCell[],
  rows: number,
  cols: number,
  rng: Rng = Math.random
): WordSearchGrid {
  if (fillerPool.length === 0) {
    throw new Error('generateWordSearchGrid: filler pool is empty');
  }

  // Per-word placement metadata: characters aligned with their pinyin syllables.
  const prepared = words.map((word) => {
    const chars = [...word.entryKey];
    const syllables = word.pinyin ? word.pinyin.trim().split(/\s+/) : [];
    return { word, chars, syllables, charSenses: word.charSenses };
  });

  // Build one target-word cell, attaching its context-correct sense/definition
  // (position-aligned) when the caller supplied charSenses. Only non-empty values
  // are written so filler cells and un-tagged positions stay lean.
  const buildCell = (
    chars: string[],
    syllables: string[],
    charSenses: WordSearchInput['charSenses'],
    idx: number
  ): GridCell => {
    const cell: GridCell = { char: chars[idx], pinyin: syllables[idx] ?? '' };
    const cs = charSenses?.[idx];
    if (cs?.definition) cell.definition = cs.definition;
    if (cs?.sense) cell.sense = cs.sense;
    return cell;
  };

  // Longest-first placement order minimizes dead-end restarts on a sparsely-
  // filled board.
  const ordered = [...prepared].sort((a, b) => b.chars.length - a.chars.length);
  const canUseTemplates = templateModeApplicable(prepared, rows, cols);

  for (let gridAttempt = 0; gridAttempt < MAX_GRID_ATTEMPTS; gridAttempt++) {
    const occupied: boolean[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => false)
    );
    const cells: (GridCell | null)[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => null)
    );
    const placed: PlacedWord[] = [];

    const useTemplate = canUseTemplates && gridAttempt >= RANDOM_GRID_ATTEMPTS;
    let allPlaced = true;
    let templateIndex: number | null = null;

    if (useTemplate) {
      // Template mode (docs/WORD_SEARCH_TEMPLATES.md): pick a random fixed 7x7
      // layout, shuffle words across its 10 four-cell slots, and for any word
      // shorter than 4 characters take a random contiguous run within its
      // slot — the rest of that slot is left null and picked up by the normal
      // filler flood below, same as every other empty cell. Cell-count-wise
      // this can never fail (every word is <= 4 chars, every slot is 4 cells),
      // so `allPlaced` stays true here.
      templateIndex = randInt(rng, WORD_SEARCH_TEMPLATES.length);
      const template = WORD_SEARCH_TEMPLATES[templateIndex];
      const shuffled = shuffle(prepared, rng);

      shuffled.forEach(({ word, chars, syllables, charSenses }, i) => {
        const slot = template.slots[i];
        const len = chars.length;
        const maxOffset = slot.length - len;
        const offset = maxOffset > 0 ? randInt(rng, maxOffset + 1) : 0;
        const path = slot.slice(offset, offset + len);

        path.forEach(([r, c], idx) => {
          occupied[r][c] = true;
          cells[r][c] = buildCell(chars, syllables, charSenses, idx);
        });
        placed.push({ ...word, cells: path });
      });
    } else {
      for (const { word, chars, syllables, charSenses } of ordered) {
        let path: [number, number][] | null = null;
        for (let attempt = 0; attempt < MAX_WORD_ATTEMPTS; attempt++) {
          path = tryPlaceWord(chars.length, occupied, rows, cols, rng);
          if (path) break;
        }
        if (!path) {
          allPlaced = false; // regenerate the whole grid
          break;
        }

        // Commit the word's characters into the board.
        path.forEach(([r, c], i) => {
          occupied[r][c] = true;
          cells[r][c] = buildCell(chars, syllables, charSenses, i);
        });
        placed.push({ ...word, cells: path });
      }
    }

    if (!allPlaced) continue;

    // Flood remaining cells with filler.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cells[r][c] !== null) continue;
        cells[r][c] = fillerPool[randInt(rng, fillerPool.length)];
      }
    }

    // ---- Anti-duplicate pass (§2a) ------------------------------------------
    // A target's full character sequence could, by chance, also trace through
    // some OTHER orthogonally-adjacent path in the finished grid (through
    // filler, or through another word's cells) — a player tracing that path
    // sees the right characters but the client's found-check compares exact
    // coordinates (see docs/WORD_SEARCH_GAME.md §4), so it silently wouldn't
    // register. We patch that by re-rolling an offending filler cell until no
    // such duplicate remains. Single-character words are exempt: the filler
    // bag is deliberately built from real level-appropriate words with
    // duplicates kept ("frequent characters recur naturally" — see Filler
    // above), so one common character recurring elsewhere is by design, not a
    // placement bug.
    let dedupClean = false;
    for (let pass = 0; pass < MAX_DEDUP_PASSES; pass++) {
      let anyUnfixable = false;
      let anyFixed = false;

      for (const p of placed) {
        if (p.cells.length < 2) continue;
        const chars = [...p.entryKey];
        const occurrences = [
          ...findWordOccurrences(cells, chars, rows, cols),
          ...findWordOccurrences(cells, [...chars].reverse(), rows, cols),
        ];

        for (const occ of occurrences) {
          if (pathsEqualEitherDirection(occ, p.cells)) continue; // the real placement

          // Break this occurrence by re-rolling one of its filler cells (never
          // a placed-word cell, which must stay put).
          const fillableIdx = occ.findIndex(([r, c]) => !occupied[r][c]);
          if (fillableIdx === -1) {
            anyUnfixable = true; // every cell belongs to placed words — can't patch
            continue;
          }
          const [r, c] = occ[fillableIdx];
          const currentChar = cells[r][c]!.char;
          const alt = fillerPool.filter((f) => f.char !== currentChar);
          const pool = alt.length > 0 ? alt : fillerPool;
          cells[r][c] = pool[randInt(rng, pool.length)];
          anyFixed = true;
        }
      }

      if (anyUnfixable) break; // give up on this grid — regenerate from scratch
      if (!anyFixed) {
        dedupClean = true;
        break;
      }
    }

    if (!dedupClean) continue; // regenerate the whole grid from scratch

    return {
      rows,
      cols,
      grid: cells as GridCell[][],
      // Return words in the original (top-list) order, not placement order.
      words: words.map((w) => placed.find((p) => p.entryKey === w.entryKey)!),
      templateIndex,
    };
  }

  throw new Error(
    `generateWordSearchGrid: failed to place all words after ${MAX_GRID_ATTEMPTS} attempts`
  );
}
