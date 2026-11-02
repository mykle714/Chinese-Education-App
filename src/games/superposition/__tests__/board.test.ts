/**
 * board.test.ts — Superposition's board rules (src/games/superposition/board.ts,
 * docs/SUPERPOSITION_GAME.md).
 *
 * Pinned: a stack finishes only with exactly a character's strokes at one exact position, a
 * lookalike swap still finishes, the tap cycle walks and wraps like the icon editor's, and
 * no tile starts stacked.
 */
import { describe, expect, it } from 'vitest';
import {
  buildTiles,
  completedStacks,
  dragTarget,
  groupStrokes,
  groupStrokesByInk,
  nextTapSelection,
  scatterTiles,
  snapToGrid,
  strokeInk,
  tilesAt,
  type BoardCharacter,
  type Tile,
} from '../board';
import strokeParts from '../strokeParts.json';

const line = (x: number, y = 100): number[][] => [[x, y], [x + 400, y]];
/** A square outline of the given side, ink = side². `x` keeps otherwise equal strokes distinct. */
const square = (side: number, x = 0) => `M ${x} 0 L ${x + side} 0 L ${x + side} ${side} L ${x} ${side} Z`;
const characters: BoardCharacter[] = [
  { char: 'A', strokes: [square(100), square(100, 1)], medians: [line(0), line(0, 500)] },
  { char: 'B', strokes: [square(100, 2)], medians: [line(0, 900)] },
];
/** A threshold of 1 keeps every stroke on its own tile. */
const tiles = () => buildTiles(characters, 64, 1);
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

  it('judges a tile only once it is dropped', () => {
    const stacked = place(tiles(), [[4, 4], [4, 4], [20, 20]]);
    expect(completedStacks(stacked, 1).has('4,4')).toBe(false);
    expect(completedStacks(stacked, 1).get('20,20')).toBe(1);
    expect(completedStacks(stacked, null).get('4,4')).toBe(0);
  });

  it('accepts a lookalike from another character in place of the real stroke', () => {
    const twins: BoardCharacter[] = [
      { char: 'A', strokes: [square(100), square(100, 1)], medians: [line(0), line(0, 500)] },
      { char: 'B', strokes: [square(100, 2), square(100, 3)], medians: [line(30), line(0, 900)] },
    ];
    const swapped = place(buildTiles(twins, 64, 1), [[8, 8], [0, 0], [0, 0], [8, 8]]);
    const done = completedStacks(swapped);
    expect(done.get('0,0')).toBe(0);
    expect(done.get('8,8')).toBe(1);
  });
});

describe('ink merging', () => {
  it('measures straight and curved outlines', () => {
    expect(strokeInk(square(100))).toBeCloseTo(10000);
    // A parabola's area is ⅔ × base × height: the curve peaks at half its control point, 150.
    expect(strokeInk('M 0 0 Q 150 300 300 0 Z')).toBeCloseTo(30000, -3);
  });

  it('merges from the smallest stroke until a group reaches the threshold', () => {
    const paths = [square(100), square(10, 1), square(10, 2), square(10, 3), square(10, 4), square(90, 5)];
    expect(groupStrokesByInk(paths, 400)).toEqual([[1, 2, 3, 4], [5], [0]]);
  });

  it('never collapses a character into one tile', () => {
    expect(groupStrokesByInk([square(100), square(90, 1)], 1e6)).toEqual([[1], [0]]);
  });

  it('finishes a character from its merged tiles, and draws each merged stroke', () => {
    const dotted: BoardCharacter[] = [
      { char: 'D', strokes: [square(10), square(10, 1), square(100, 2)], medians: [line(0), line(0, 200), line(0, 500)] },
    ];
    const merged = buildTiles(dotted, 64, 200);
    expect(merged.map((tile) => tile.paths.length)).toEqual([2, 1]);
    expect(completedStacks(place(merged, [[4, 4], [4, 4]])).get('4,4')).toBe(0);
  });
});

describe('natural parts', () => {
  const paths = [square(100), square(100, 1), square(10, 2), square(10, 3), square(10, 4)];

  it('gives each part its own tile and merges only what is left by ink', () => {
    expect(groupStrokes(paths, [[0, 2]], 150)).toEqual([[0, 2], [3, 4], [1]]);
  });

  it('falls back to ink with no parts, or parts that do not fit the glyph', () => {
    expect(groupStrokes(paths, [], 150)).toEqual(groupStrokesByInk(paths, 150));
    expect(groupStrokes(paths, [[0, 9]], 150)).toEqual(groupStrokesByInk(paths, 150));
  });

  it('lets the same part from two characters swap', () => {
    const shared = [square(100), square(100, 1)];
    const lines = [line(0), line(0, 300)];
    const twins: BoardCharacter[] = [
      { char: 'A', strokes: [...shared, square(100, 2)], medians: [...lines, line(0, 900)], parts: [[0, 1]] },
      { char: 'B', strokes: [...shared, square(100, 3)], medians: [...lines, line(0, 700)], parts: [[0, 1]] },
    ];
    const swapped = place(buildTiles(twins, 64, 1), [[8, 8], [0, 0], [0, 0], [8, 8]]);
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
