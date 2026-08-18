import { describe, it, expect } from 'vitest';
import {
  boxesOverlap,
  boxesTouch,
  boxSeparation,
  connectedIslands,
  touchedSidesForAll,
  mapBounds,
  spawnBatch,
  spawnPosition,
  wordBoxSize,
  drawScale,
  NEW_ISLAND_CHANCE,
  type MapBox,
} from '../services/memoryMapSpawn.js';
import { MEMORY_MAP_SCALE_RANGE } from '../contracts/wire.js';

/**
 * Memory Map geometry (docs/MEMORY_MAP_GAME.md § 2.4).
 *
 * The whole reason the spawn rules live in a pure module is so they can be exercised
 * here instead of by staring at a rendered map, so these tests carry the invariants the
 * feature actually depends on: words never overlap, growth is tangent, and 10% start an
 * island. Tune the constants freely — these should keep passing.
 */

/** A deterministic RNG: replays the given values, then cycles. Beats seeding a PRNG
 *  because a test can say exactly which branch it is forcing. */
function scriptedRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** An RNG that never rolls an island, so every placement must grow. */
const alwaysGrow = () => 0.5;

function box(x: number, y: number, width = 2, height = 1.5): MapBox {
  return { x, y, width, height };
}

describe('wordBoxSize', () => {
  it('scales width with glyph count and height with scale alone', () => {
    const one = wordBoxSize('好', 1, 'zh');
    const three = wordBoxSize('好好好', 1, 'zh');
    expect(three.width).toBeGreaterThan(one.width);
    expect(three.height).toBe(one.height);
  });

  it('gives Latin script a narrower box per glyph than CJK', () => {
    // Same glyph count, different script: five Spanish letters must not claim the
    // width of five Chinese characters, or Spanish maps would be mostly whitespace.
    expect(wordBoxSize('abcde', 1, 'es').width).toBeLessThan(
      wordBoxSize('一二三四五', 1, 'zh').width
    );
  });

  it('counts astral-plane characters as ONE glyph, not two', () => {
    // A rare CJK ideograph above U+FFFF is two UTF-16 code units. Measuring with
    // .length would give it a double-width box that its rendering does not fill.
    const astral = '𠀋';
    expect(astral.length).toBe(2);
    expect(wordBoxSize(astral, 1, 'zh').width).toBe(wordBoxSize('好', 1, 'zh').width);
  });

  it('is a pure function of (word, scale, language) — the client/server contract', () => {
    // The client draws boxes with this exact function. If it ever depended on
    // anything else, tangent neighbours would drift apart on screen.
    expect(wordBoxSize('学习', 1.3, 'zh')).toEqual(wordBoxSize('学习', 1.3, 'zh'));
  });

  it('never returns a zero-width box for an empty string', () => {
    expect(wordBoxSize('', 1, 'zh').width).toBeGreaterThan(0);
  });
});

describe('drawScale', () => {
  it('stays inside the documented range at both extremes', () => {
    expect(drawScale(() => 0)).toBeCloseTo(MEMORY_MAP_SCALE_RANGE.min);
    expect(drawScale(() => 1)).toBeCloseTo(MEMORY_MAP_SCALE_RANGE.max);
  });
});

describe('boxesOverlap', () => {
  it('treats edge-to-edge tangency as NOT overlapping', () => {
    // This is the single most load-bearing assertion in the module: if tangency
    // counted as overlap, every "grow the island" placement would be rejected and
    // the map would degenerate into 100 separate islands.
    const a = box(0, 0, 2, 2);
    const b = box(2, 0, 2, 2); // exactly touching on the right edge
    expect(boxesOverlap(a, b)).toBe(false);
  });

  it('detects genuine interior overlap', () => {
    expect(boxesOverlap(box(0, 0, 2, 2), box(1, 0, 2, 2))).toBe(true);
  });

  it('treats a corner touch as NOT overlapping', () => {
    expect(boxesOverlap(box(0, 0, 2, 2), box(2, 2, 2, 2))).toBe(false);
  });
});

describe('mapBounds', () => {
  it('is null for an empty map', () => {
    expect(mapBounds([])).toBeNull();
  });

  it('covers every box by its extents, not its centre', () => {
    expect(mapBounds([box(0, 0, 2, 2), box(10, 0, 4, 2)])).toEqual({
      minX: -1,
      minY: -1,
      maxX: 12,
      maxY: 1,
    });
  });
});

describe('spawnPosition', () => {
  it('puts the first word of an empty map at the origin', () => {
    const result = spawnPosition([], wordBoxSize('好', 1, 'zh'), alwaysGrow);
    expect(result).toEqual({ x: 0, y: 0, mode: 'island' });
  });

  it('places a grown word tangent to an existing one, never overlapping', () => {
    const existing = [box(0, 0, 2, 2)];
    const size = { width: 2, height: 2 };
    const { x, y, mode } = spawnPosition(existing, size, alwaysGrow);
    expect(mode).toBe('grow');
    expect(boxesOverlap({ x, y, ...size }, existing[0])).toBe(false);
    // Tangent means the gap on one axis is exactly the summed half-extents.
    const touchingX = Math.abs(x - 0) === 2;
    const touchingY = Math.abs(y - 0) === 2;
    expect(touchingX || touchingY).toBe(true);
  });

  it('starts a new island when the roll comes in under the threshold', () => {
    // First value is the island roll; the rest feed the angle.
    const rng = scriptedRng([NEW_ISLAND_CHANCE / 2, 0.25]);
    const { mode } = spawnPosition([box(0, 0)], wordBoxSize('好', 1, 'zh'), rng);
    expect(mode).toBe('island');
  });

  it('grows when the roll comes in over the threshold', () => {
    const rng = scriptedRng([NEW_ISLAND_CHANCE + 0.01, 0.5, 0.5, 0.5]);
    const { mode } = spawnPosition([box(0, 0)], wordBoxSize('好', 1, 'zh'), rng);
    expect(mode).toBe('grow');
  });

  it('places a new island clear of every existing box', () => {
    const existing = [box(0, 0, 4, 4), box(6, 0, 4, 4)];
    const size = { width: 2, height: 2 };
    const rng = scriptedRng([0.01, 0.3]); // island, then the angle
    const { x, y, mode } = spawnPosition(existing, size, rng);
    expect(mode).toBe('island');
    for (const other of existing) {
      expect(boxesOverlap({ x, y, ...size }, other)).toBe(false);
    }
  });

  it('falls back to an island rather than failing when no edge is free', () => {
    // A word fully boxed in: neighbours on all four sides and in the diagonals, so
    // every tangent candidate collides. A card must ALWAYS get a spot — a card that
    // silently never appears on the map is the one outcome the feature cannot have.
    const size = { width: 2, height: 2 };
    const existing: MapBox[] = [];
    for (let gx = -1; gx <= 1; gx++) {
      for (let gy = -1; gy <= 1; gy++) existing.push(box(gx * 2, gy * 2, 2, 2));
    }
    const { x, y } = spawnPosition(existing, size, alwaysGrow);
    for (const other of existing) {
      expect(boxesOverlap({ x, y, ...size }, other)).toBe(false);
    }
  });
});

describe('spawnBatch', () => {
  const words = (n: number) =>
    Array.from({ length: n }, () => ({ entryKey: '学习', language: 'zh' }));

  it('returns one placement per input, in input order', () => {
    const result = spawnBatch([], words(5), alwaysGrow);
    expect(result).toHaveLength(5);
  });

  it('never overlaps any two words in a full-capacity batch', () => {
    // The invariant the whole map rests on, at the size the map actually reaches.
    // Uses real randomness deliberately: a scripted RNG would only prove one path.
    const placed = spawnBatch([], words(100), Math.random);
    const boxes: MapBox[] = placed.map((p) => ({
      x: p.x,
      y: p.y,
      ...wordBoxSize('学习', p.scale, 'zh'),
    }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(boxesOverlap(boxes[i], boxes[j])).toBe(false);
      }
    }
  });

  it('does not mutate the caller\'s array of existing boxes', () => {
    // The service passes in its own live map state; a spawn call that appended to it
    // would corrupt the very list it later persists against.
    const existing = [box(0, 0)];
    spawnBatch(existing, words(3), alwaysGrow);
    expect(existing).toHaveLength(1);
  });

  it('places newcomers against EACH OTHER, not just the pre-existing map', () => {
    // Sequential placement is load-bearing: if each word only saw `existing`, a batch
    // into an empty map would stack every word on the origin.
    const placed = spawnBatch([], words(4), alwaysGrow);
    const distinct = new Set(placed.map((p) => `${p.x},${p.y}`));
    expect(distinct.size).toBe(4);
  });

  it('freezes a scale in range for every word', () => {
    for (const p of spawnBatch([], words(20), Math.random)) {
      expect(p.scale).toBeGreaterThanOrEqual(MEMORY_MAP_SCALE_RANGE.min);
      expect(p.scale).toBeLessThanOrEqual(MEMORY_MAP_SCALE_RANGE.max);
    }
  });

  it('produces roughly NEW_ISLAND_CHANCE islands over a large sample', () => {
    // Guards the ratio itself: an island is a placement that landed clear of every
    // box already down, which is what the 10% roll is meant to produce.
    let islands = 0;
    const placed: MapBox[] = [];
    for (let i = 0; i < 400; i++) {
      const size = wordBoxSize('学习', 1, 'zh');
      const { mode } = spawnPosition(placed, size, Math.random);
      if (mode === 'island') islands++;
      // Re-place deterministically so the map keeps growing regardless of mode.
      const { x, y } = spawnPosition(placed, size, alwaysGrow);
      placed.push({ x, y, ...size });
    }
    const rate = islands / 400;
    expect(rate).toBeGreaterThan(NEW_ISLAND_CHANCE / 2);
    expect(rate).toBeLessThan(NEW_ISLAND_CHANCE * 2.5);
  });
});

describe('boxesTouch', () => {
  it('joins two boxes sharing an edge segment', () => {
    expect(boxesTouch(box(0, 0, 2, 2), box(2, 0, 2, 2))).toBe(true);
  });

  it('does NOT join two boxes meeting only at a corner', () => {
    // A corner kiss looks like two nearby islands, not one. This is the same rule
    // MIN_EDGE_OVERLAP enforces when placing.
    expect(boxesTouch(box(0, 0, 2, 2), box(2, 2, 2, 2))).toBe(false);
  });

  it('does not join boxes with water between them', () => {
    expect(boxesTouch(box(0, 0, 2, 2), box(5, 0, 2, 2))).toBe(false);
  });
});

describe('connectedIslands', () => {
  it('reports an empty map as no islands', () => {
    expect(connectedIslands([])).toEqual([]);
  });

  it('groups a tangent chain into ONE island', () => {
    const chain = [box(0, 0, 2, 2), box(2, 0, 2, 2), box(4, 0, 2, 2)];
    expect(connectedIslands(chain)).toHaveLength(1);
  });

  it('separates boxes with water between them', () => {
    const two = [box(0, 0, 2, 2), box(2, 0, 2, 2), box(20, 0, 2, 2)];
    const islands = connectedIslands(two);
    expect(islands).toHaveLength(2);
    expect(islands.map((i) => i.length).sort()).toEqual([1, 2]);
  });

  it('covers every box exactly once', () => {
    const boxes = spawnBatch([], Array.from({ length: 40 }, () => ({ entryKey: '学习', language: 'zh' })), Math.random)
      .map((p) => ({ x: p.x, y: p.y, ...wordBoxSize('学习', p.scale, 'zh') }));
    const islands = connectedIslands(boxes);
    const indices = islands.flat().sort((a, b) => a - b);
    expect(indices).toEqual(boxes.map((_, i) => i));
  });
});

describe('map compactness (regression: islands spread too far)', () => {
  /** Bounding-rect width and height of a placed map, in world units. */
  function rectOf(placed: { x: number; y: number; scale: number }[]): { w: number; h: number } {
    const bounds = mapBounds(
      placed.map((p) => ({ x: p.x, y: p.y, ...wordBoxSize('学习', p.scale, 'zh') }))
    );
    if (!bounds) return { w: 0, h: 0 };
    return { w: bounds.maxX - bounds.minX, h: bounds.maxY - bounds.minY };
  }

  const areaOf = (placed: { x: number; y: number; scale: number }[]) => {
    const { w, h } = rectOf(placed);
    return w * h;
  };

  const build = (n: number) =>
    spawnBatch([], Array.from({ length: n }, () => ({ entryKey: '学习', language: 'zh' })), Math.random);

  it('keeps a full 100-word map within a sane AREA', () => {
    // Asserted on AREA rather than on the longest side, because the map is deliberately
    // ELONGATED to match a phone (see the portrait test below) — a side-length bound
    // would fail for a map that is exactly the right shape. Area is the quantity the
    // runaway actually blew up: the original centre-anchored placement reached ~15,000
    // units² at 100 words against ~2,200 today.
    for (let trial = 0; trial < 5; trial++) {
      expect(areaOf(build(100))).toBeLessThan(6000);
    }
  });

  it('grows roughly LINEARLY in area as words are added', () => {
    // Area should scale with the word COUNT, since each word occupies a fixed patch.
    // Runaway island drift showed up as super-linear growth — 4× the words costing far
    // more than 4× the area — which is the shape this guards, not any single number.
    const small = areaOf(build(25));
    const large = areaOf(build(100));
    expect(large).toBeLessThan(small * 10); // 4× words; 10× area is generous slack
  });

  it('comes out PORTRAIT, to match the phone it is played on', () => {
    // The growth rules are biased vertically (VERTICAL_GROWTH_BIAS, ISLAND_BEARING_ASPECT,
    // VERTICAL_SIDE_OFFSET_DAMP) so fitting the map to a tall screen does not leave fat
    // empty margins above and below with every word shrunk to suit. Averaged over trials
    // because a single map is noisy — this pins the BIAS, not any one layout.
    let ratio = 0;
    const trials = 12;
    for (let t = 0; t < trials; t++) {
      const { w, h } = rectOf(build(80));
      ratio += w / h;
    }
    expect(ratio / trials).toBeLessThan(0.85);
  });

  it('never strands an island far from every other one', () => {
    // Every island must be within a short swim of another island's coast — that is the
    // whole point of the drift cap. Measured centre-to-centre against the NEAREST other
    // box, so a lone word joined to nothing still has to be near something.
    const placed = spawnBatch([], Array.from({ length: 60 }, () => ({ entryKey: '学习', language: 'zh' })), Math.random);
    const boxes = placed.map((p) => ({ x: p.x, y: p.y, ...wordBoxSize('学习', p.scale, 'zh') }));
    for (let i = 0; i < boxes.length; i++) {
      let nearest = Infinity;
      for (let j = 0; j < boxes.length; j++) {
        if (i === j) continue;
        nearest = Math.min(nearest, Math.hypot(boxes[i].x - boxes[j].x, boxes[i].y - boxes[j].y));
      }
      expect(nearest).toBeLessThan(20);
    }
  });
});

describe('island formation (regression: maps came out as a single island)', () => {
  const KEYS = ["学", "学习", "图书馆"];
  const words = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ entryKey: KEYS[i % KEYS.length], language: "zh" }));

  function islandsOf(n: number): number {
    const placed = spawnBatch([], words(n), Math.random);
    const boxes = placed.map((p, i) => ({
      x: p.x,
      y: p.y,
      ...wordBoxSize(KEYS[i % KEYS.length], p.scale, "zh"),
    }));
    return connectedIslands(boxes).length;
  }

  it('always produces several islands on a large map', () => {
    // TWO bugs made large maps collapse into one landmass, and this is the guard for
    // both. (1) The island probe walked a random bearing under a total-distance cap, so
    // any bearing pointing INTO the anchor's own island gave up before reaching water.
    // (2) A grown word could land tangent to two islands at once and silently merge
    // them, eroding the archipelago one word at a time.
    for (let trial = 0; trial < 10; trial++) {
      expect(islandsOf(65)).toBeGreaterThan(1);
    }
  });

  it('produces islands at roughly the declared rate', () => {
    // ~10% of placements start an island, so a 100-word map should land in the high
    // single digits. Bounded on BOTH sides: too few means the probe is failing again,
    // too many means growth has stopped working and every word is landing in open water.
    let total = 0;
    const trials = 10;
    for (let t = 0; t < trials; t++) total += islandsOf(100);
    const mean = total / trials;
    expect(mean).toBeGreaterThan(3);
    expect(mean).toBeLessThan(20);
  });

  it('keeps real water between separate islands', () => {
    // The channel a new island was launched into must not be silted up by later growth,
    // or the compass ends up pointing at things the player cannot see as separate.
    const placed = spawnBatch([], words(60), Math.random);
    const boxes = placed.map((p, i) => ({
      x: p.x,
      y: p.y,
      ...wordBoxSize(KEYS[i % KEYS.length], p.scale, "zh"),
    }));
    const islands = connectedIslands(boxes);
    for (let a = 0; a < islands.length; a++) {
      for (let b = a + 1; b < islands.length; b++) {
        let nearest = Infinity;
        for (const i of islands[a]) {
          for (const j of islands[b]) {
            nearest = Math.min(nearest, boxSeparation(boxes[i], boxes[j]));
          }
        }
        expect(nearest).toBeGreaterThan(0);
      }
    }
  });
});

describe('boxSeparation', () => {
  it('is zero for touching boxes and positive for parted ones', () => {
    expect(boxSeparation(box(0, 0, 2, 2), box(2, 0, 2, 2))).toBe(0);
    expect(boxSeparation(box(0, 0, 2, 2), box(5, 0, 2, 2))).toBeCloseTo(3);
  });

  it('measures diagonal water diagonally', () => {
    // Boxes offset on BOTH axes are further apart than either axis gap alone suggests.
    expect(boxSeparation(box(0, 0, 2, 2), box(5, 5, 2, 2))).toBeCloseTo(Math.hypot(3, 3));
  });
});

describe('touchedSidesForAll', () => {
  it('marks the shared edge on BOTH boxes, and only that edge', () => {
    // b sits to the right of a: a's right is fenced, a's other three sides are coast.
    const [a, b] = touchedSidesForAll([box(0, 0, 2, 2), box(2, 0, 2, 2)]);
    expect(a).toEqual({ top: false, right: true, bottom: false, left: false });
    expect(b).toEqual({ top: false, right: false, bottom: false, left: true });
  });

  it('treats a larger y as BELOW, matching screen space', () => {
    // The renderer reads these literally, so an inverted axis here would draw every
    // vertical fence on the wrong side of its word.
    const [a, b] = touchedSidesForAll([box(0, 0, 2, 2), box(0, 2, 2, 2)]);
    expect(a.bottom).toBe(true);
    expect(a.top).toBe(false);
    expect(b.top).toBe(true);
  });

  it('draws nothing for a corner touch', () => {
    // Two boxes meeting at a point share no edge; stubs there would look like a
    // rendering fault rather than a boundary.
    const [a, b] = touchedSidesForAll([box(0, 0, 2, 2), box(2, 2, 2, 2)]);
    expect(a).toEqual({ top: false, right: false, bottom: false, left: false });
    expect(b).toEqual({ top: false, right: false, bottom: false, left: false });
  });

  it('draws nothing between boxes with water between them', () => {
    const [a] = touchedSidesForAll([box(0, 0, 2, 2), box(9, 0, 2, 2)]);
    expect(a).toEqual({ top: false, right: false, bottom: false, left: false });
  });

  it('fences a word enclosed on several sides', () => {
    const sides = touchedSidesForAll([
      box(0, 0, 2, 2),
      box(2, 0, 2, 2),
      box(-2, 0, 2, 2),
      box(0, 2, 2, 2),
    ]);
    expect(sides[0]).toEqual({ top: false, right: true, bottom: true, left: true });
  });

  it('agrees with boxesTouch about which pairs are connected', () => {
    // The border rule and the island rule must not disagree — a fence between two words
    // that the island code considers separate would be a visible contradiction.
    const placed = spawnBatch([], Array.from({ length: 40 }, () => ({ entryKey: '学习', language: 'zh' })), Math.random);
    const boxes = placed.map((p) => ({ x: p.x, y: p.y, ...wordBoxSize('学习', p.scale, 'zh') }));
    const sides = touchedSidesForAll(boxes);
    for (let i = 0; i < boxes.length; i++) {
      const hasFence = sides[i].top || sides[i].right || sides[i].bottom || sides[i].left;
      const hasNeighbour = boxes.some((other, j) => j !== i && boxesTouch(boxes[i], other));
      expect(hasFence).toBe(hasNeighbour);
    }
  });
});
