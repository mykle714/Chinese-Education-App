import {
  SENTENCE_TILES_BOARD_SIZE,
  SENTENCE_TILES_CENTRE,
  SENTENCE_TILES_LONG_LINE_BONUS,
  SENTENCE_TILES_LONG_LINE_TILES,
  SENTENCE_TILES_MIN_OPENING_TILES,
  SENTENCE_TILES_RACK_SIZE,
} from '../../contracts/sentenceTiles.js';
import type {
  SentenceTilesBoardTile,
  SentenceTilesDirection,
  SentenceTilesPlacement,
  SentenceTilesRackTile,
} from '../../contracts/sentenceTiles.js';
import { tilePoints } from './bag.js';

/**
 * Sentence Tiles — the placement rules (docs/SENTENCE_TILES_GAME.md § "Rules").
 *
 * Decides whether a set of placements is a geometrically legal play and which LINE it forms.
 * Whether that line is a real sentence is the judge's business, not this file's.
 *
 *   - Every placed tile comes from the mover's rack (no tile twice), onto an empty in-bounds cell.
 *   - All placements share one row (across) or one column (down).
 *   - The run from the first to the last placement has no gaps: every cell between them is
 *     either being placed or already occupied.
 *   - The LINE is that run extended in both directions through adjacent board tiles. Only this
 *     line is judged; tiles that end up side by side across it are not (crossing rule lifted,
 *     owner's decision 2026-11-21).
 *   - On an empty board the line covers the centre cell and holds ≥ 2 tiles. Otherwise it
 *     includes at least one tile already on the board.
 *
 * LAYER: pure service helper (no I/O). Throws PlayRuleError with a player-facing message.
 */

export class PlayRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlayRuleError';
  }
}

export interface ResolvedPlay {
  /** Every tile in the line, in reading order, with whether it was placed this turn. */
  line: { row: number; col: number; word: string; tileId: number; isNew: boolean }[];
  /** The placed tiles, resolved against the rack. */
  placed: SentenceTilesBoardTile[];
  /** The line's words in reading order. */
  lineWords: string[];
}

const cellKey = (row: number, col: number) => `${row},${col}`;

/**
 * Validate `placements` against the board and rack. Returns the line it forms, or throws
 * PlayRuleError. `turn` stamps the placed tiles.
 */
export function resolvePlay(
  board: readonly SentenceTilesBoardTile[],
  rack: readonly SentenceTilesRackTile[],
  placements: readonly SentenceTilesPlacement[],
  direction: SentenceTilesDirection,
  turn: number,
): ResolvedPlay {
  if (!Array.isArray(placements) || placements.length === 0) {
    throw new PlayRuleError('Place at least one tile.');
  }
  if (placements.length > SENTENCE_TILES_RACK_SIZE) throw new PlayRuleError('Too many tiles.');
  if (direction !== 'across' && direction !== 'down') throw new PlayRuleError('Pick across or down.');

  const occupied = new Map(board.map((t) => [cellKey(t.row, t.col), t]));
  const rackById = new Map(rack.map((t) => [t.id, t]));
  const seenTiles = new Set<number>();
  const newCells = new Map<string, SentenceTilesBoardTile>();

  for (const p of placements) {
    const { tileId, row, col } = p ?? ({} as SentenceTilesPlacement);
    if (![tileId, row, col].every(Number.isInteger)) throw new PlayRuleError('Bad placement.');
    if (row < 0 || col < 0 || row >= SENTENCE_TILES_BOARD_SIZE || col >= SENTENCE_TILES_BOARD_SIZE) {
      throw new PlayRuleError('A tile is off the board.');
    }
    const tile = rackById.get(tileId);
    if (!tile) throw new PlayRuleError('That tile is not in your rack.');
    if (seenTiles.has(tileId)) throw new PlayRuleError('A tile was placed twice.');
    seenTiles.add(tileId);
    const key = cellKey(row, col);
    if (occupied.has(key) || newCells.has(key)) throw new PlayRuleError('That square is taken.');
    newCells.set(key, { row, col, tileId, word: tile.word, turn });
  }

  const placed = [...newCells.values()];
  const across = direction === 'across';
  const fixed = across ? placed[0].row : placed[0].col;
  if (!placed.every((t) => (across ? t.row : t.col) === fixed)) {
    throw new PlayRuleError('Tiles must sit in one straight line.');
  }

  // Walk the line: from the first placement back over board tiles, then forward to the end.
  const at = (i: number) => (across ? cellKey(fixed, i) : cellKey(i, fixed));
  const tileAt = (i: number) => newCells.get(at(i)) ?? occupied.get(at(i));
  const positions = placed.map((t) => (across ? t.col : t.row));
  let start = Math.min(...positions);
  let end = Math.max(...positions);
  for (let i = start; i <= end; i++) {
    if (!tileAt(i)) throw new PlayRuleError('The line has a gap.');
  }
  while (start > 0 && tileAt(start - 1)) start--;
  while (end < SENTENCE_TILES_BOARD_SIZE - 1 && tileAt(end + 1)) end++;

  const line: ResolvedPlay['line'] = [];
  for (let i = start; i <= end; i++) {
    const t = tileAt(i)!;
    line.push({ row: t.row, col: t.col, word: t.word, tileId: t.tileId, isNew: newCells.has(at(i)) });
  }

  if (board.length === 0) {
    const coversCentre = placed.some((t) => t.row === SENTENCE_TILES_CENTRE && t.col === SENTENCE_TILES_CENTRE);
    if (!coversCentre) throw new PlayRuleError('The first line must cover the centre square.');
    if (line.length < SENTENCE_TILES_MIN_OPENING_TILES) {
      throw new PlayRuleError(`The first line needs at least ${SENTENCE_TILES_MIN_OPENING_TILES} tiles.`);
    }
  } else if (!line.some((t) => !t.isNew)) {
    throw new PlayRuleError('Your line must run through a tile already on the board.');
  }

  return { line, placed, lineWords: line.map((t) => t.word) };
}

/** Points for a judged-legal line: every tile in it (board tiles too), plus the long-line bonus. */
export function scoreLine(lineWords: readonly string[]): number {
  const base = lineWords.reduce((total, w) => total + tilePoints(w), 0);
  return base + (lineWords.length >= SENTENCE_TILES_LONG_LINE_TILES ? SENTENCE_TILES_LONG_LINE_BONUS : 0);
}

/** The cache / training-log key for a line: words joined with '|' (tiles are indivisible). */
export function lineKey(lineWords: readonly string[]): string {
  return lineWords.join('|');
}
