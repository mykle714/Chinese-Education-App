import { describe, expect, it } from 'vitest';
import { buildBag, draw, refillInPlace, tilePoints } from '../services/sentenceTiles/bag.js';
import { PlayRuleError, lineKey, resolvePlay, scoreLine } from '../services/sentenceTiles/rules.js';
import { advanceTurn } from '../services/SentenceTilesService.js';
import { ZH_TILES } from '../services/sentenceTiles/tileSet.zh.js';
import {
  SENTENCE_TILES_BAG_SIZE,
  SENTENCE_TILES_CENTRE as C,
  SENTENCE_TILES_LONG_LINE_BONUS,
} from '../contracts/sentenceTiles.js';
import type { SentenceTilesBoardTile, SentenceTilesRackTile } from '../contracts/sentenceTiles.js';
import type { SentenceTilesGameRow, SentenceTilesGameState } from '../dal/interfaces/ISentenceTilesDAL.js';

/**
 * Sentence Tiles pure logic: bag composition, placement rules, scoring, endings.
 * Docs: docs/SENTENCE_TILES_GAME.md § "Rules", § "Tiles and the bag".
 */

/** Deterministic RandomInt (a small LCG) so bag tests are reproducible. */
function seeded(seed: number) {
  let s = seed;
  return (max: number) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s % max;
  };
}

const rack: SentenceTilesRackTile[] = [
  { id: 1, word: '我' }, { id: 2, word: '喜欢' }, { id: 3, word: '你' }, { id: 4, word: '吗' },
];
const tile = (row: number, col: number, word: string, tileId = 90 + row * 13 + col): SentenceTilesBoardTile =>
  ({ row, col, word, tileId, turn: 1 });

describe('buildBag', () => {
  it('deals exactly 100 tiles with unique ids, all from the tile set', () => {
    const bag = buildBag(seeded(7));
    expect(bag).toHaveLength(SENTENCE_TILES_BAG_SIZE);
    expect(new Set(bag.map((t) => t.id)).size).toBe(SENTENCE_TILES_BAG_SIZE);
    const known = new Set(ZH_TILES.map((t) => t.word));
    expect(bag.every((t) => known.has(t.word))).toBe(true);
  });

  it('always carries the function-word skeleton', () => {
    const words = buildBag(seeded(3)).map((t) => t.word);
    expect(words.filter((w) => w === '我')).toHaveLength(3);
    expect(words.filter((w) => w === '了')).toHaveLength(3);
  });

  it('draw pops from the end', () => {
    const bag = buildBag(seeded(1));
    const last = bag[bag.length - 1];
    const drawn = draw(bag, 11);
    expect(drawn).toHaveLength(11);
    expect(drawn[drawn.length - 1]).toEqual(last);
    expect(bag).toHaveLength(89);
  });
});

describe('resolvePlay', () => {
  it('accepts an opening line across the centre', () => {
    const r = resolvePlay([], rack, [
      { tileId: 1, row: C, col: C - 1 }, { tileId: 2, row: C, col: C }, { tileId: 3, row: C, col: C + 1 },
    ], 'across', 1);
    expect(r.lineWords).toEqual(['我', '喜欢', '你']);
  });

  it('rejects an opening that misses the centre or is a single tile', () => {
    expect(() => resolvePlay([], rack, [{ tileId: 1, row: 0, col: 0 }, { tileId: 3, row: 0, col: 1 }], 'across', 1))
      .toThrow(PlayRuleError);
    expect(() => resolvePlay([], rack, [{ tileId: 1, row: C, col: C }], 'across', 1)).toThrow(/at least 2/);
  });

  it('extends the line through board tiles and requires touching one', () => {
    const board = [tile(C, C, '我'), tile(C, C + 1, '喜欢')];
    const r = resolvePlay(board, rack, [{ tileId: 3, row: C, col: C + 2 }, { tileId: 4, row: C, col: C + 3 }], 'across', 2);
    expect(r.lineWords).toEqual(['我', '喜欢', '你', '吗']);
    expect(r.line.filter((t) => !t.isNew)).toHaveLength(2);
    expect(() => resolvePlay(board, rack, [{ tileId: 3, row: 0, col: 0 }, { tileId: 4, row: 0, col: 1 }], 'across', 2))
      .toThrow(/through a tile already on the board/);
  });

  it('reads a down line top to bottom through a board tile', () => {
    const board = [tile(C, C, '喜欢')];
    const r = resolvePlay(board, rack, [{ tileId: 1, row: C - 1, col: C }, { tileId: 3, row: C + 1, col: C }], 'down', 2);
    expect(r.lineWords).toEqual(['我', '喜欢', '你']);
  });

  it('rejects gaps, bends, taken squares, foreign and repeated tiles', () => {
    const board = [tile(C, C, '喜欢')];
    expect(() => resolvePlay(board, rack, [{ tileId: 1, row: C, col: C - 2 }, { tileId: 3, row: C, col: C + 1 }], 'across', 2))
      .toThrow(/gap/);
    expect(() => resolvePlay(board, rack, [{ tileId: 1, row: C, col: C - 1 }, { tileId: 3, row: C + 1, col: C }], 'across', 2))
      .toThrow(/straight line/);
    expect(() => resolvePlay(board, rack, [{ tileId: 1, row: C, col: C }], 'across', 2)).toThrow(/taken/);
    expect(() => resolvePlay(board, rack, [{ tileId: 99, row: C, col: C + 1 }], 'across', 2)).toThrow(/not in your rack/);
    expect(() => resolvePlay(board, rack, [{ tileId: 1, row: C, col: C - 1 }, { tileId: 1, row: C, col: C + 1 }], 'across', 2))
      .toThrow(/twice/);
  });
});

describe('scoring', () => {
  it('sums every tile in the line and adds the long-line bonus at 6+', () => {
    const short = ['我', '喜欢', '你'];
    expect(scoreLine(short)).toBe(short.reduce((t, w) => t + tilePoints(w), 0));
    const long = ['我', '很', '喜欢', '你', '的', '书'];
    expect(scoreLine(long)).toBe(long.reduce((t, w) => t + tilePoints(w), 0) + SENTENCE_TILES_LONG_LINE_BONUS);
    expect(lineKey(short)).toBe('我|喜欢|你');
  });
});

describe('advanceTurn', () => {
  const g = { playerAId: 'A', playerBId: 'B' } as SentenceTilesGameRow;
  const base: SentenceTilesGameState = {
    status: 'draft', turnUserId: 'A', board: [], rackA: [{ id: 1, word: '我' }], rackB: [{ id: 2, word: '你' }],
    bag: [], scoreA: 10, scoreB: 10, scorelessTurns: 0, winnerId: null, finished: false,
  };

  it('steps draft → pending → active and passes the turn', () => {
    const afterOpening = advanceTurn(g, 'A', base, null);
    expect(afterOpening).toMatchObject({ status: 'pending', turnUserId: 'B' });
    const afterAccept = advanceTurn(g, 'B', { ...base, status: 'pending' }, null);
    expect(afterAccept).toMatchObject({ status: 'active', turnUserId: 'A' });
  });

  it('going out transfers the opponent rack value', () => {
    const left = tilePoints('你');
    const done = advanceTurn(g, 'A', { ...base, status: 'active', rackA: [] }, 'wentOut');
    expect(done).toMatchObject({ status: 'finished', turnUserId: null, scoreA: 10 + left, scoreB: 10 - left, winnerId: 'A' });
  });

  it('four scoreless turns end the game with rack penalties', () => {
    const done = advanceTurn(g, 'B', { ...base, status: 'active', scorelessTurns: 4 }, null);
    expect(done.status).toBe('finished');
    expect(done.scoreA).toBe(10 - tilePoints('我'));
    expect(done.scoreB).toBe(10 - tilePoints('你'));
  });
});

describe('refillInPlace', () => {
  const t = (id: number, word: string): SentenceTilesRackTile => ({ id, word });
  it('puts each fresh draw in the slot of the tile it replaces; kept tiles do not move', () => {
    const rack = [t(1, '我'), t(2, '你'), t(3, '他'), t(4, '好')];
    const bag = [t(10, '是'), t(11, '的')];
    const out = refillInPlace(rack, new Set([2, 4]), bag);
    expect(out.map((x) => x.id)).toEqual([1, expect.any(Number), 3, expect.any(Number)]);
    expect(new Set([out[1].id, out[3].id])).toEqual(new Set([10, 11]));
    expect(bag).toHaveLength(0);
  });
  it('drops unfilled slots when the bag runs dry', () => {
    const rack = [t(1, '我'), t(2, '你'), t(3, '他')];
    const out = refillInPlace(rack, new Set([1, 2]), [t(10, '是')]);
    expect(out.map((x) => x.id)).toEqual([10, 3]);
  });
});
