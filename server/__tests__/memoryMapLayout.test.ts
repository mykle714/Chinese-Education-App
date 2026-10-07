import { describe, it, expect } from 'vitest';
import {
  ISLAND_GAP,
  allParts,
  bowOffsets,
  bowShape,
  estimatedShape,
  islandsOf,
  layoutMap,
  mapBounds,
  partsOverlap,
  placeShape,
  slideOut,
  tilesOverlap,
  type LayoutSlot,
  type ShapeOf,
  type ShapePart,
  type Tile,
} from '../services/memoryMapLayout.js';

/**
 * Memory Map layout (docs/MEMORY_MAP_GAME.md § 2.3–§ 2.4) — the slot tree → positions.
 *
 * The invariants the feature depends on: no two words' character boxes overlap (tilt
 * included), a grown slot ends up touching what stopped it, an island root sits a full
 * ISLAND_GAP clear of every earlier box, and the result is a pure function of the tree
 * AND the shapes it is handed (the client hands in measured glyph shapes).
 */

/** Mulberry32 — a small seeded PRNG, so randomized trees are reproducible. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slot(partial: Partial<LayoutSlot> & { slotId: number }): LayoutSlot {
  return {
    parentSlotId: null,
    link: 'grow',
    angle: null,
    tilt: 0,
    bow: 0,
    scale: 1,
    entryKey: '你好',
    language: 'zh',
    ...partial,
  };
}

/** A random tree of `n` slots: each hangs off a random earlier slot. */
function randomTree(n: number, rng: () => number): LayoutSlot[] {
  const words = ['好', '你好', '图书馆', '一', '中国人', '学习'];
  const slots: LayoutSlot[] = [];
  for (let i = 1; i <= n; i++) {
    slots.push(
      slot({
        slotId: i,
        parentSlotId: i === 1 ? null : 1 + Math.floor(rng() * (i - 1)),
        link: i > 1 && rng() < 0.1 ? 'island' : 'grow',
        angle: i === 1 ? null : rng() * 360,
        tilt: rng() * 60 - 30,
        bow: rng() * 30 - 15,
        scale: 0.95 + rng() * 0.85,
        entryKey: words[Math.floor(rng() * words.length)],
      })
    );
  }
  return slots;
}

/**
 * A "measured-looking" shape: uneven per-character ink boxes with vertical offsets, the
 * way a real face reports them (一 is a thin bar, most characters are squarish). Proves
 * the layout respects whatever shapes the client hands in, not just the even estimate.
 */
const jaggedShapeOf: ShapeOf = (s) => {
  const chars = s.entryKey ? [...s.entryKey] : ['?', '?'];
  return chars.map((c, i) => {
    const thin = c === '一';
    return {
      dx: (i - (chars.length - 1) / 2) * s.scale,
      dy: (thin ? 0.05 : (i % 2) * 0.08) * s.scale,
      width: (thin ? 0.9 : 0.6 + ((c.codePointAt(0) ?? 0) % 4) * 0.08) * s.scale,
      height: (thin ? 0.12 : 0.85) * s.scale,
    };
  });
};

function expectNoOverlaps(laid: { parts: Tile[] }[]): void {
  for (let i = 0; i < laid.length; i++) {
    for (let j = i + 1; j < laid.length; j++) {
      expect(partsOverlap(laid[i].parts, laid[j].parts)).toBe(false);
    }
  }
}

describe('estimatedShape', () => {
  it('gives one box per code point, centred on the anchor', () => {
    const shape = estimatedShape('图书馆', 1, 'zh');
    expect(shape).toHaveLength(3);
    expect(shape[1].dx).toBeCloseTo(0);
    expect(shape[0].dx).toBeCloseTo(-shape[2].dx);
  });

  it('counts an astral-plane ideograph as ONE glyph', () => {
    expect(estimatedShape('𠀀', 1, 'zh')).toHaveLength(1);
  });

  it('gives Latin letters narrower boxes than CJK, and scales with the slot', () => {
    expect(estimatedShape('a', 1, 'es')[0].width).toBeLessThan(estimatedShape('好', 1, 'zh')[0].width);
    expect(estimatedShape('好', 2, 'zh')[0].width).toBeCloseTo(estimatedShape('好', 1, 'zh')[0].width * 2);
  });

  it('sizes an empty slot as a two-glyph word', () => {
    expect(estimatedShape(null, 1, 'zh')).toHaveLength(2);
  });
});

describe('tilesOverlap', () => {
  const base: Tile = { x: 0, y: 0, width: 2, height: 1, tilt: 0 };

  it('reports shared area, and not a shared edge', () => {
    expect(tilesOverlap(base, { ...base, x: 1.5 })).toBe(true);
    expect(tilesOverlap(base, { ...base, x: 2 })).toBe(false);
  });

  it('accounts for rotation', () => {
    const a: Tile = { x: 0, y: 0, width: 4, height: 0.5, tilt: 0 };
    const b: Tile = { x: 0, y: 1.5, width: 4, height: 0.5, tilt: 0 };
    expect(tilesOverlap(a, b)).toBe(false);
    expect(tilesOverlap(a, { ...b, tilt: 90 })).toBe(true);
  });

  it('inflates the FIRST box for a clearance test', () => {
    expect(tilesOverlap(base, { ...base, x: 3 }, 1.1)).toBe(true);
    expect(tilesOverlap(base, { ...base, x: 3 }, 0.9)).toBe(false);
  });
});

describe('slideOut', () => {
  const single: ShapePart[] = [{ dx: 0, dy: 0, width: 2, height: 1 }];
  const parent: Tile = { x: 0, y: 0, width: 2, height: 1, tilt: 0 };

  it('stops a child exactly where it leaves its parent', () => {
    expect(slideOut(single, 0, parent, 0, [parent], 0).x).toBeCloseTo(2, 3);
    expect(slideOut(single, 0, parent, 90, [parent], 0).y).toBeCloseTo(1, 3); // y grows DOWN
  });

  it('collides each character box, so a gap between characters can be used', () => {
    // A two-character word with a wide gap between its characters, launched from the
    // centre of a thin post. Its characters straddle the post, so it is ALREADY clear and
    // does not move — a single box around the whole word would have had to slide 1.75
    // units to get off the post.
    const gapped: ShapePart[] = [
      { dx: -1.5, dy: 0, width: 1, height: 1 },
      { dx: 1.5, dy: 0, width: 1, height: 1 },
    ];
    const post: Tile = { x: 0, y: 0, width: 0.5, height: 3, tilt: 0 };
    const landed = slideOut(gapped, 0, post, 90, [post], 0);
    expect(landed.distance).toBe(0);
    const asOneBox: ShapePart[] = [{ dx: 0, dy: 0, width: 4, height: 1 }];
    expect(slideOut(asOneBox, 0, post, 90, [post], 0).distance).toBeCloseTo(2, 3);
  });

  it('touches but never overlaps, at any bearing and tilt, for multi-part shapes', () => {
    const rng = seeded(7);
    for (let i = 0; i < 300; i++) {
      const parentShape = jaggedShapeOf(slot({ slotId: 1, entryKey: '一二三'.slice(0, 1 + (i % 3)) }));
      const parentParts = placeShape(parentShape, 0, 0, rng() * 60 - 30);
      const shape = jaggedShapeOf(slot({ slotId: 2, entryKey: '你好吗'.slice(0, 1 + (i % 3)), scale: 0.95 + rng() }));
      const tilt = rng() * 60 - 30;
      const landed = slideOut(shape, tilt, { x: 0, y: 0 }, rng() * 360, parentParts, 0);
      expect(partsOverlap(placeShape(shape, landed.x, landed.y, tilt), parentParts)).toBe(false);
    }
  });

  it('leaves the requested water around every obstacle', () => {
    expect(slideOut(single, 0, parent, 0, [parent], ISLAND_GAP).x).toBeCloseTo(2 + ISLAND_GAP, 3);
  });
});

describe('bow', () => {
  it('leaves a single character (or no bow) untouched', () => {
    expect(bowOffsets([0], 15)).toEqual([{ dy: 0, rotate: 0 }]);
    expect(bowOffsets([-0.5, 0.5], 0)).toEqual([
      { dy: 0, rotate: 0 },
      { dy: 0, rotate: 0 },
    ]);
  });

  it('leans the outer characters by exactly the bow, mirrored, with the arc centred on the line', () => {
    const [left, middle, right] = bowOffsets([-1, 0, 1], 10);
    // Smile: right end turns counter-clockwise (negative), left end clockwise.
    expect(right.rotate).toBeCloseTo(-10);
    expect(left.rotate).toBeCloseTo(10);
    expect(middle.rotate).toBeCloseTo(0);
    // Ends raised (y down), middle lowered, by equal halves of the depth H·tan(bow)/2.
    const depth = Math.tan((10 * Math.PI) / 180) / 2;
    expect(left.dy).toBeCloseTo(-depth / 2);
    expect(right.dy).toBeCloseTo(-depth / 2);
    expect(middle.dy).toBeCloseTo(depth / 2);
    // A frown is the mirror image.
    expect(bowOffsets([-1, 0, 1], -10)[2].rotate).toBeCloseTo(10);
  });

  it('is the same curve at any scale: dy scales with the word, rotation does not', () => {
    const small = bowOffsets([-0.5, 0.5], 12);
    const big = bowOffsets([-1, 1], 12);
    expect(big[0].dy).toBeCloseTo(small[0].dy * 2);
    expect(big[0].rotate).toBeCloseTo(small[0].rotate);
  });

  it('turns each box about its pivot, not its own centre', () => {
    // Ink sits 0.1 right of the pivot; turning it moves its centre off the pivot's vertical.
    const [, right] = bowShape(
      [
        { dx: -0.4, dy: 0, width: 0.8, height: 0.8, pivotDx: -0.5 },
        { dx: 0.6, dy: 0, width: 0.8, height: 0.8, pivotDx: 0.5 },
      ],
      15
    );
    expect(right.rotate).toBeCloseTo(-15);
    const arcDy = bowOffsets([-0.5, 0.5], 15)[1].dy;
    expect(right.dx).toBeCloseTo(0.5 + 0.1 * Math.cos((15 * Math.PI) / 180));
    expect(right.dy).toBeCloseTo(arcDy - 0.1 * Math.sin((15 * Math.PI) / 180));
  });

  it('collides the bowed boxes: a bowed word laid against a parent never overlaps it', () => {
    const rng = seeded(13);
    for (let i = 0; i < 300; i++) {
      const parentParts = placeShape(bowShape(estimatedShape('一二三', 1, 'zh'), rng() * 30 - 15), 0, 0, rng() * 20 - 10);
      const shape = bowShape(jaggedShapeOf(slot({ slotId: 2, entryKey: '你好吗' })), rng() * 30 - 15);
      const tilt = rng() * 20 - 10;
      const landed = slideOut(shape, tilt, { x: 0, y: 0 }, rng() * 360, parentParts, 0);
      expect(partsOverlap(placeShape(shape, landed.x, landed.y, tilt), parentParts)).toBe(false);
    }
  });
});

describe('layoutMap', () => {
  it('puts the first root at the origin', () => {
    const [root] = layoutMap([slot({ slotId: 1 })]);
    expect(root).toMatchObject({ x: 0, y: 0, islandRootSlotId: 1 });
    expect(root.parts).toHaveLength(2);
  });

  it('never overlaps — estimated or measured-looking shapes, tilt and bow included', () => {
    for (let seed = 1; seed <= 30; seed++) {
      expectNoOverlaps(layoutMap(randomTree(50, seeded(seed))));
      expectNoOverlaps(layoutMap(randomTree(50, seeded(seed)), jaggedShapeOf));
    }
  });

  it('lays an island root a full ISLAND_GAP clear of every earlier box', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const tree = randomTree(50, seeded(seed));
      const laid = layoutMap(tree, jaggedShapeOf);
      tree.forEach((s, i) => {
        if (s.link !== 'island') return;
        for (let j = 0; j < i; j++) expect(partsOverlap(laid[i].parts, laid[j].parts, ISLAND_GAP * 0.999)).toBe(false);
      });
    }
  });

  it('is a pure function of the tree: input order does not matter', () => {
    const tree = randomTree(30, seeded(3));
    const byId = new Map(layoutMap([...tree].reverse()).map((t) => [t.slotId, t]));
    for (const placed of layoutMap(tree)) expect(byId.get(placed.slotId)).toEqual(placed);
  });

  it('a refilled slot with a longer word pushes its subtree out instead of overlapping it', () => {
    const tree = randomTree(40, seeded(11));
    const grown = tree.map((s) => (s.slotId === 2 ? { ...s, entryKey: '中华人民共和国' } : s));
    expectNoOverlaps(layoutMap(grown));
  });

  it('degrades an orphaned slot to an island instead of throwing', () => {
    const laid = layoutMap([
      slot({ slotId: 1 }),
      slot({ slotId: 5, parentSlotId: 99, angle: 0 }),
      slot({ slotId: 6, parentSlotId: null }),
    ]);
    expect(laid.map((s) => s.islandRootSlotId)).toEqual([1, 5, 6]);
    expectNoOverlaps(laid);
  });
});

describe('islandsOf / mapBounds', () => {
  it('groups by island root, read off the tree', () => {
    const laid = layoutMap([
      slot({ slotId: 1 }),
      slot({ slotId: 2, parentSlotId: 1, angle: 0 }),
      slot({ slotId: 3, parentSlotId: 2, link: 'island', angle: 90 }),
      slot({ slotId: 4, parentSlotId: 3, angle: 180 }),
    ]);
    expect(islandsOf(laid)).toEqual([
      { rootSlotId: 1, indices: [0, 1] },
      { rootSlotId: 3, indices: [2, 3] },
    ]);
  });

  it('bounds include the corners a tilt swings out, and are null when empty', () => {
    const flat = mapBounds([{ x: 0, y: 0, width: 4, height: 1, tilt: 0 }])!;
    const tilted = mapBounds([{ x: 0, y: 0, width: 4, height: 1, tilt: 30 }])!;
    expect(tilted.maxY - tilted.minY).toBeGreaterThan(flat.maxY - flat.minY);
    expect(mapBounds(allParts([]))).toBeNull();
  });
});
