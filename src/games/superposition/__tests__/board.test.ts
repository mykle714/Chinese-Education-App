/**
 * board.test.ts — Superposition's board rules (src/games/superposition/board.ts,
 * docs/SUPERPOSITION_GAME.md).
 *
 * Pinned: a stack finishes only with exactly a character's strokes at one exact position, a
 * lookalike swap still finishes, a finished stack locks and then moves, selects and stays
 * finished as one, the tap cycle walks and wraps like the icon editor's, and no tile starts
 * stacked.
 */
import { describe, expect, it } from 'vitest';
import {
  buildTiles,
  characterGroups,
  collapseLocked,
  completedStacks,
  dragTarget,
  lockFinishedStacks,
  moveTile,
  nextTapSelection,
  pickHintPair,
  scatterTiles,
  snapToGrid,
  tilesAt,
  type BoardCharacter,
  type Tile,
} from '../board';
import strokeParts from '../strokeParts.json';
import { SINGLE_STROKE_MAX, groupStrokes, isStrokePartition, strokeInk } from '../../../../server/contracts/superpositionGroups';

const line = (x: number, y = 100): number[][] => [[x, y], [x + 400, y]];
/** A square outline of the given side, ink = side². `x` keeps otherwise equal strokes distinct. */
const square = (side: number, x = 0) => `M ${x} 0 L ${x + side} 0 L ${x + side} ${side} L ${x} ${side} Z`;
const characters: BoardCharacter[] = [
  { char: 'A', strokes: [square(100), square(100, 1)], medians: [line(0), line(0, 500)] },
  { char: 'B', strokes: [square(100, 2)], medians: [line(0, 900)] },
];
/** Characters of ≤ SINGLE_STROKE_MAX strokes keep every stroke on its own tile. */
const tiles = () => buildTiles(characters, 64);
const place = (all: Tile[], positions: [number, number][]) =>
  all.map((tile, i) => ({ ...tile, x: positions[i][0], y: positions[i][1], z: i }));

describe('completedStacks', () => {
  it('finishes a stack holding exactly the character at one position', () => {
    const done = completedStacks(place(tiles(), [[4, 4], [4, 4], [20, 20]]));
    expect(done.get('4,4')).toBe(0);
    expect(done.get('20,20')).toBe(1);
  });

  it('does not count an offset overlap', () => {
    expect(completedStacks(place(tiles(), [[4, 4], [5, 4], [20, 20]])).has('4,4')).toBe(false);
  });

  it('does not count a stack with an extra stroke', () => {
    expect(completedStacks(place(tiles(), [[4, 4], [4, 4], [4, 4]])).has('4,4')).toBe(false);
  });

  it('accepts a lookalike from another character in place of the real stroke', () => {
    const twins: BoardCharacter[] = [
      { char: 'A', strokes: [square(100), square(100, 1)], medians: [line(0), line(0, 500)] },
      { char: 'B', strokes: [square(100, 2), square(100, 3)], medians: [line(30), line(0, 900)] },
    ];
    const swapped = place(buildTiles(twins, 64), [[8, 8], [0, 0], [0, 0], [8, 8]]);
    const done = completedStacks(swapped);
    expect(done.get('0,0')).toBe(0);
    expect(done.get('8,8')).toBe(1);
  });
});

describe('locked stacks', () => {
  const locked = () => lockFinishedStacks(place(tiles(), [[4, 4], [4, 4], [20, 20]]));

  it('locks each finished stack, its tiles sharing one lock', () => {
    const all = locked();
    expect(all.map((tile) => tile.lock)).toEqual([
      { id: 0, charIndex: 0 },
      { id: 0, charIndex: 0 },
      { id: 2, charIndex: 1 },
    ]);
  });

  it('returns the same array when nothing new finishes', () => {
    const all = locked();
    expect(lockFinishedStacks(all)).toBe(all);
  });

  it('leaves an offset overlap loose', () => {
    expect(lockFinishedStacks(place(tiles(), [[4, 4], [5, 4], [20, 20]])).map((tile) => tile.lock)).toEqual([
      null,
      null,
      { id: 2, charIndex: 1 },
    ]);
  });

  it('moves a locked stack as one, onto the top of the pile', () => {
    const moved = moveTile(locked(), 1, 30, 30);
    expect(moved.filter((tile) => tile.x === 30 && tile.y === 30).map((tile) => tile.id)).toEqual([0, 1]);
    expect(moved.map((tile) => tile.z)).toEqual([1, 2, 0]);
  });

  it('moves a loose tile alone', () => {
    const moved = moveTile(place(tiles(), [[4, 4], [5, 4], [20, 20]]), 0, 30, 30);
    expect(moved.map(({ x, y }) => [x, y])).toEqual([[30, 30], [5, 4], [20, 20]]);
  });

  it('is not spoiled, nor joined, by a loose tile dropped on its cell', () => {
    const all = locked().map((tile) => (tile.id === 2 ? { ...tile, x: 4, y: 4, lock: null } : tile));
    expect(completedStacks(all).get('4,4')).toBe(1);
    expect(lockFinishedStacks(all).map((tile) => tile.lock?.id)).toEqual([0, 0, 2]);
  });

  it('folds a locked stack to one entry in a pile', () => {
    const all = locked().map((tile) => (tile.id === 2 ? { ...tile, x: 4, y: 4, z: 5, lock: null } : tile));
    expect(collapseLocked(tilesAt(all, 5, 5, 9)).map((tile) => tile.id)).toEqual([2, 1]);
  });
});

describe('pickHintPair', () => {
  const threeOfA: BoardCharacter[] = [
    { char: 'A', strokes: [square(100), square(100, 1), square(100, 2)], medians: [line(0), line(0, 500), line(0, 900)] },
    { char: 'B', strokes: [square(100, 3), square(100, 4)], medians: [line(200), line(200, 500)] },
  ];
  const board = (positions: [number, number][]) => place(buildTiles(threeOfA, 1), positions);

  it('picks two lone tiles of one character', () => {
    const all = board([[0, 0], [10, 0], [40, 0], [40, 0], [60, 0]]);
    expect(pickHintPair(lockFinishedStacks(all), () => 0)).toEqual([0, 1]);
  });

  it('never pairs tiles of different characters', () => {
    const all = board([[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]]);
    for (const roll of [0, 0.3, 0.6, 0.9]) {
      const [a, b] = pickHintPair(lockFinishedStacks(all), () => roll)!;
      expect(all[a].source.charIndex).toBe(all[b].source.charIndex);
    }
  });

  it('skips locked stacks', () => {
    const all = board([[0, 0], [10, 0], [20, 0], [30, 0], [30, 0]]);
    expect(pickHintPair(lockFinishedStacks(all), () => 0.99)).toEqual([1, 2]);
  });

  it('falls back to a stacked tile when no two lone tiles belong together', () => {
    const all = board([[0, 0], [0, 0], [20, 0], [30, 0], [30, 0]]);
    const pair = pickHintPair(lockFinishedStacks(all), () => 0)!;
    expect(pair).toContain(2);
  });

  it('is null when nothing is left to join', () => {
    const all = board([[0, 0], [0, 0], [0, 0], [30, 0], [30, 0]]);
    expect(pickHintPair(lockFinishedStacks(all))).toBeNull();
  });
});

/** A side × side square with its corner at (x, y): placed, so strokes can touch or stand apart. */
const box = (x: number, side: number, y = 0) => `M ${x} ${y} L ${x + side} ${y} L ${x + side} ${y + side} L ${x} ${y + side} Z`;

describe('ink', () => {
  it('measures straight and curved outlines', () => {
    expect(strokeInk(square(100))).toBeCloseTo(10000);
    // A parabola's area is ⅔ × base × height: the curve peaks at half its control point, 150.
    expect(strokeInk('M 0 0 Q 150 300 300 0 Z')).toBeCloseTo(30000, -3);
  });

  it('finishes a character from its merged tiles, and draws each merged stroke', () => {
    // Two clusters far apart: a pair on the left, a triple on the right.
    const dotted: BoardCharacter[] = [
      {
        char: 'D',
        strokes: [box(0, 10), box(12, 10), box(500, 10), box(512, 10), box(524, 10)],
        medians: [line(0), line(0, 200), line(0, 400), line(0, 600), line(0, 800)],
      },
    ];
    const merged = buildTiles(dotted, 64);
    expect(merged.map((tile) => tile.paths.length)).toEqual([2, 3]);
    expect(completedStacks(place(merged, [[4, 4], [4, 4]])).get('4,4')).toBe(0);
  });
});

describe('groupStrokes (server/contracts/superpositionGroups.ts)', () => {
  /** Ten-unit squares at these x positions: 12 apart touch-close, hundreds apart far. */
  const row = (...xs: number[]) => xs.map((x) => box(x, 10));

  it(`deals a character of ≤ ${SINGLE_STROKE_MAX} strokes as single strokes, parts and all`, () => {
    expect(groupStrokes(row(0, 12, 24, 36), [[0, 1]])).toEqual([[0], [1], [2], [3]]);
  });

  it('grows the densest strokes together, whatever the stroke order', () => {
    // Even strokes cluster on the left, odd on the right.
    expect(groupStrokes(row(0, 500, 12, 512, 24, 524))).toEqual([[0, 2, 4], [1, 3, 5]]);
  });

  it('stops growing at a sharp drop in density, and the drop ratio sets how sharp', () => {
    // Pairs 30 units apart: adding the next pair's stroke drops density from 0.91 to 0.58.
    const paths = row(0, 12, 42, 54, 500, 512);
    expect(groupStrokes(paths)).toEqual([[0, 1], [2, 3], [4, 5]]);
    // A ratio of 0.5 tolerates that drop, but not the far pair's.
    expect(groupStrokes(paths, [], 0.5)).toEqual([[0, 1, 2, 3], [4, 5]]);
  });

  it('puts a lone leftover stroke in the group it leaves densest', () => {
    // 4 sits near the right pair, so it joins them rather than the left pair.
    expect(groupStrokes(row(0, 12, 500, 512, 540))).toEqual([[0, 1], [2, 3, 4]]);
  });

  it('never adds to a natural part: a leftover stroke joins a free group instead', () => {
    // 0 sits beside the part (1, 2), but the part is closed, so 0 joins the free pair (3, 4).
    expect(groupStrokes(row(0, 12, 24, 500, 512), [[1, 2]])).toEqual([[0, 3, 4], [1, 2]]);
  });

  it('leaves a stroke alone when every other stroke is in a part', () => {
    expect(groupStrokes(row(0, 12, 24, 36, 48), [[1, 2, 3, 4]])).toEqual([[0], [1, 2, 3, 4]]);
  });

  it('keeps a part whole even when its strokes are not neighbours in writing order', () => {
    const paths = [box(0, 100), box(300, 10), box(320, 10), box(0, 100, 200), box(340, 10)];
    const groups = groupStrokes(paths, [[0, 3]]);
    expect(groups.find((group) => group.includes(0))).toEqual([0, 3]);
  });

  it('ignores parts that do not fit the glyph', () => {
    const paths = row(0, 12, 500, 512, 540);
    expect(groupStrokes(paths, [[0, 9]])).toEqual(groupStrokes(paths));
  });

  it('never collapses a character into one tile: it cuts at the sharpest drop, two strokes a side', () => {
    // Overlapping squares only ever grow denser, so they would grow into a single group.
    const groups = groupStrokes(row(0, 5, 10, 15, 20));
    expect(groups).toHaveLength(2);
    expect(isStrokePartition(groups, 5)).toBe(true);
    groups.forEach((group) => expect(group.length).toBeGreaterThanOrEqual(2));
  });
});

describe('stored groups', () => {
  const stored = (groups: number[][]): BoardCharacter => ({
    char: 'S',
    strokes: [box(0, 10), box(100, 20), box(200, 30)],
    medians: [line(0), line(0, 300), line(0, 600)],
    groups,
  });

  it('uses groups that partition the strokes', () => {
    expect(characterGroups(stored([[0, 1], [2]]))).toEqual([[0, 1], [2]]);
  });

  it('computes its own when the stored groups do not fit the glyph', () => {
    // Three strokes: computed, every stroke stands alone.
    expect(characterGroups(stored([[0], [1]]))).toEqual([[0], [1], [2]]);
    expect(characterGroups(stored([[0, 1], [1, 2]]))).toEqual([[0], [1], [2]]);
  });

  it('checks a partition exactly', () => {
    expect(isStrokePartition([[0, 2], [1]], 3)).toBe(true);
    expect(isStrokePartition([[0], [1]], 3)).toBe(false);
    expect(isStrokePartition([[0, 1], []], 2)).toBe(false);
    expect(isStrokePartition([[0, 3]], 2)).toBe(false);
  });
});

describe('natural parts', () => {
  it('lets the same part from two characters swap', () => {
    const shared = [square(100), square(100, 1)];
    const lines = [line(0), line(0, 300)];
    const twins: BoardCharacter[] = [
      // Five strokes each, so the part counts (rule 0 ignores parts in characters of ≤ 4).
      {
        char: 'A',
        strokes: [...shared, square(100, 2), square(100, 4), square(100, 6)],
        medians: [...lines, line(0, 900), line(0, 950), line(0, 1000)],
        parts: [[0, 1]],
      },
      {
        char: 'B',
        strokes: [...shared, square(100, 3), square(100, 5), square(100, 7)],
        medians: [...lines, line(0, 700), line(0, 750), line(0, 800)],
        parts: [[0, 1]],
      },
    ];
    const swapped = place(buildTiles(twins, 64), [[8, 8], [0, 0], [0, 0], [8, 8]]);
    const done = completedStacks(swapped);
    expect(done.get('0,0')).toBe(0);
    expect(done.get('8,8')).toBe(1);
  });
});

describe('strokeParts.json', () => {
  const parts = strokeParts as Record<string, number[][]>;

  it('keeps a listed part whole and opens an unlisted one', () => {
    expect(parts['们']).toEqual([[0, 1], [2, 3], [4]]);
    expect(parts['语'].some((part) => part.join() === '0,1')).toBe(true);
    expect(parts['语'].some((part) => part.join() === '6,7,8')).toBe(true);
    expect(parts['日']).toBeUndefined();
  });

  it('cuts the split parts as approved', () => {
    expect(parts['心']).toEqual([[0, 2, 3], [1]]);
    expect(parts['门']).toEqual([[0, 1], [2]]);
    expect(parts['米']).toEqual([[0, 1], [2, 3, 4, 5]]);
    expect(parts['笑'].slice(0, 2)).toEqual([[0, 1, 2], [3, 4, 5]]);
  });

  it('never leaves a character as one finished tile', () => {
    ['乡', '孓', '才', '由', '芈'].forEach((char) => expect(parts[char]).toBeUndefined());
  });

  it('never claims a stroke twice', () => {
    Object.values(parts).forEach((groups) => {
      const flat = groups.flat();
      expect(new Set(flat).size).toBe(flat.length);
    });
  });
});

describe('selection', () => {
  const pile = place(tiles(), [[0, 0], [0, 0], [0, 0]]);
  const hits = tilesAt(pile, 1, 1, 4);

  it('orders a pile topmost first and misses outside the box', () => {
    expect(hits.map((t) => t.id)).toEqual([2, 1, 0]);
    expect(tilesAt(pile, 4, 1, 4)).toEqual([]);
  });

  it('cycles down the pile and wraps to the top', () => {
    expect(nextTapSelection(hits, null)).toBe(2);
    expect(nextTapSelection(hits, 2)).toBe(1);
    expect(nextTapSelection(hits, 0)).toBe(2);
    expect(nextTapSelection([], 2)).toBe(null);
  });

  it('drags the selection when it is in the pile, else the top tile', () => {
    expect(dragTarget(hits, 0)).toBe(0);
    expect(dragTarget(hits, 99)).toBe(2);
    expect(dragTarget([], 0)).toBe(null);
  });
});

describe('scatterTiles', () => {
  const many = Array.from({ length: 16 }, (_, i) => ({ ...tiles()[0], id: i }));
  const zone = { marginUnits: 1, topUnits: 0, spreadUnits: 12 };

  it('bunches tiles at the bottom centre, each at its own position', () => {
    const placed = scatterTiles(many, 48, 60, 4, zone);
    expect(new Set(placed.map((t) => `${t.x},${t.y}`)).size).toBe(16);
    expect(placed.every((t) => t.x >= 16 && t.x <= 28 && t.y >= 43 && t.y <= 55)).toBe(true);
  });

  it('lets tiles overlap at an offset', () => {
    const placed = scatterTiles(many, 48, 60, 4, zone);
    const overlaps = placed.some((a) =>
      placed.some((b) => a !== b && Math.abs(a.x - b.x) < 4 && Math.abs(a.y - b.y) < 4)
    );
    expect(overlaps).toBe(true);
  });

  it('stays clear of the edges and the top rows on a cramped board', () => {
    const placed = scatterTiles(many, 12, 16, 4, { ...zone, topUnits: 5 });
    expect(placed.every((t) => t.x >= 1 && t.x + 4 <= 11 && t.y >= 5 && t.y + 4 <= 15)).toBe(true);
  });

  it('keeps the tile on the board when the zone leaves no room', () => {
    const [crowded] = scatterTiles(many.slice(0, 1), 12, 12, 4, { ...zone, topUnits: 40 });
    expect(crowded.y + 4).toBeLessThanOrEqual(12);
    const [tiny] = scatterTiles(many.slice(0, 1), 5, 4, 4, zone);
    expect(tiny.x + 4).toBeLessThanOrEqual(5);
    expect(tiny.y).toBe(0);
  });
});

describe('snapToGrid', () => {
  it('rounds to a unit and keeps the tile on the board', () => {
    expect(snapToGrid(13, 8, 40, 4)).toBe(2);
    expect(snapToGrid(-20, 8, 40, 4)).toBe(0);
    expect(snapToGrid(9999, 8, 40, 4)).toBe(36);
  });
});
