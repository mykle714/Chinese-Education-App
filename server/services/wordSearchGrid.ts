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

export type Rng = () => number;

/** One target word to hide in the grid. */
export interface WordSearchInput {
  id: number; // vet id, used to mark the card correct via /api/flashcards/mark on find
  entryKey: string; // Chinese text, e.g. "学生"
  pinyin: string; // space-separated tone-marked syllables, one per character
  definition: string; // English gloss shown in the top word list
}

/** A single grid cell: one Chinese character + its pinyin syllable. */
export interface GridCell {
  char: string;
  pinyin: string;
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
}

/** Orthogonal (4-direction) neighbor offsets — no diagonals (see doc §2). */
const NEIGHBORS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
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
 * Anti-duplicate fixup passes (see §2a below) before we give up and regenerate
 * the whole grid. Each pass patches every offending filler cell it finds, so
 * convergence is typically 1-2 passes; this is a generous ceiling against
 * pathological oscillation.
 */
const MAX_DEDUP_PASSES = 20;

function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
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
 * neighbor. Returns the ordered path, or null if it hit a dead end (the caller
 * retries with a new random start).
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

  for (let i = 1; i < len; i++) {
    const [r, c] = path[path.length - 1];
    // Empty, in-bounds neighbors not already on this path.
    const options: [number, number][] = [];
    for (const [dr, dc] of NEIGHBORS) {
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
    return { word, chars, syllables };
  });

  // Longest-first placement order minimizes dead-end restarts on a sparsely-
  // filled board.
  const ordered = [...prepared].sort((a, b) => b.chars.length - a.chars.length);

  for (let gridAttempt = 0; gridAttempt < MAX_GRID_ATTEMPTS; gridAttempt++) {
    const occupied: boolean[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => false)
    );
    const cells: (GridCell | null)[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => null)
    );
    const placed: PlacedWord[] = [];

    let allPlaced = true;
    for (const { word, chars, syllables } of ordered) {
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
        cells[r][c] = { char: chars[i], pinyin: syllables[i] ?? '' };
      });
      placed.push({ ...word, cells: path });
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
    };
  }

  throw new Error(
    `generateWordSearchGrid: failed to place all words after ${MAX_GRID_ATTEMPTS} attempts`
  );
}
