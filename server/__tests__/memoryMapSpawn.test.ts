import { describe, it, expect } from 'vitest';
import { drawBow, drawScale, drawTilt, planSlots, NEW_ISLAND_CHANCE, type PlannedSlot } from '../services/memoryMapSpawn.js';
import { ISLAND_GAP, allParts, islandsOf, layoutMap, mapBounds, partsOverlap, type LayoutSlot } from '../services/memoryMapLayout.js';
import {
  MEMORY_MAP_BOW_RANGE,
  MEMORY_MAP_BOW_SIGMA,
  MEMORY_MAP_CAPACITY,
  MEMORY_MAP_SCALE_RANGE,
  MEMORY_MAP_TILT_RANGE,
  MEMORY_MAP_TILT_SIGMA,
} from '../contracts/wire.js';

/**
 * Memory Map spawn (docs/MEMORY_MAP_GAME.md § 2.4) — choosing where new slots hang.
 *
 * Tune the constants freely; these carry the invariants rather than the numbers: the
 * plan is a valid tree, the map it produces never overlaps, it forms an archipelago
 * (not one blob, not a scatter), and it comes out portrait for the phone.
 */

function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['好', '你好', '中国人', '学习', '吃饭', '一', '图书馆', '喜欢', '我', '电脑'];

/** Apply a plan the way the DAL does: temp ids stand in for the real (ascending) ones. */
function apply(tree: LayoutSlot[], plan: PlannedSlot[], words: { entryKey: string }[]): LayoutSlot[] {
  return [
    ...tree,
    ...plan.map((p, i) => ({
      slotId: p.tempId,
      parentSlotId: p.parentSlotId,
      link: p.link,
      angle: p.angle,
      tilt: p.tilt,
      bow: p.bow,
      scale: p.scale,
      entryKey: words[i].entryKey,
      language: 'zh',
    })),
  ];
}

/** Grow a full map the way repeated loads would: in a few batches. */
function growMap(seed: number, total = MEMORY_MAP_CAPACITY, batches = 5): LayoutSlot[] {
  const rng = seeded(seed);
  let tree: LayoutSlot[] = [];
  const perBatch = Math.ceil(total / batches);
  while (tree.length < total) {
    const words = Array.from({ length: Math.min(perBatch, total - tree.length) }, () => ({
      entryKey: WORDS[Math.floor(rng() * WORDS.length)],
      language: 'zh',
    }));
    tree = apply(tree, planSlots(tree, words, rng), words);
  }
  return tree;
}

describe('random draws', () => {
  it('draws tilt from a normal around 0°, not a uniform', () => {
    const rng = seeded(5);
    const tilts = Array.from({ length: 20000 }, () => drawTilt(rng));
    const mean = tilts.reduce((a, b) => a + b, 0) / tilts.length;
    const sd = Math.sqrt(tilts.reduce((a, b) => a + (b - mean) ** 2, 0) / tilts.length);
    const withinOneSigma = tilts.filter((t) => Math.abs(t) <= MEMORY_MAP_TILT_SIGMA).length / tilts.length;
    expect(Math.abs(mean)).toBeLessThan(0.5);
    // Truncation at ±30° trims the spread at most slightly below σ.
    expect(sd).toBeGreaterThan(MEMORY_MAP_TILT_SIGMA * 0.9);
    expect(sd).toBeLessThan(MEMORY_MAP_TILT_SIGMA * 1.05);
    // ~68% for a normal (a uniform over ±30° would give ~33%).
    expect(withinOneSigma).toBeGreaterThan(0.64);
    expect(withinOneSigma).toBeLessThan(0.72);
  });

  it('draws bow from a light normal around 0°, inside its range', () => {
    const rng = seeded(6);
    const bows = Array.from({ length: 20000 }, () => drawBow(rng));
    const mean = bows.reduce((a, b) => a + b, 0) / bows.length;
    const sd = Math.sqrt(bows.reduce((a, b) => a + (b - mean) ** 2, 0) / bows.length);
    expect(Math.abs(mean)).toBeLessThan(0.3);
    // Truncated at 3σ, which trims the spread a little below σ.
    expect(sd).toBeGreaterThan(MEMORY_MAP_BOW_SIGMA * 0.9);
    expect(sd).toBeLessThan(MEMORY_MAP_BOW_SIGMA * 1.02);
    for (const bow of bows) {
      expect(bow).toBeGreaterThanOrEqual(MEMORY_MAP_BOW_RANGE.min);
      expect(bow).toBeLessThanOrEqual(MEMORY_MAP_BOW_RANGE.max);
    }
  });

  it('draws scale and tilt inside their documented ranges', () => {
    const rng = seeded(1);
    for (let i = 0; i < 1000; i++) {
      const scale = drawScale(rng);
      const tilt = drawTilt(rng);
      expect(scale).toBeGreaterThanOrEqual(MEMORY_MAP_SCALE_RANGE.min);
      expect(scale).toBeLessThanOrEqual(MEMORY_MAP_SCALE_RANGE.max);
      expect(tilt).toBeGreaterThanOrEqual(MEMORY_MAP_TILT_RANGE.min);
      expect(tilt).toBeLessThanOrEqual(MEMORY_MAP_TILT_RANGE.max);
    }
  });
});

describe('planSlots', () => {
  it('makes the first word on an empty map the root', () => {
    const [root, child] = planSlots([], [{ entryKey: '好', language: 'zh' }, { entryKey: '你', language: 'zh' }], seeded(2));
    expect(root).toMatchObject({ parentSlotId: null, angle: null });
    expect(child.parentSlotId).toBe(root.tempId);
    expect(child.angle).toBeGreaterThanOrEqual(0);
    expect(child.angle).toBeLessThan(360);
  });

  it('allocates temp ids above every existing id, ascending, with parents always earlier', () => {
    const tree = growMap(3, 20);
    const maxId = Math.max(...tree.map((s) => s.slotId));
    const plan = planSlots(tree, WORDS.map((entryKey) => ({ entryKey, language: 'zh' })), seeded(4));
    plan.forEach((p, i) => {
      expect(p.tempId).toBe(maxId + 1 + i);
      expect(p.parentSlotId).not.toBeNull();
      expect(p.parentSlotId as number).toBeLessThan(p.tempId);
    });
  });

  it('never produces an overlapping map', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const laid = layoutMap(growMap(seed));
      for (let i = 0; i < laid.length; i++) {
        for (let j = i + 1; j < laid.length; j++) expect(partsOverlap(laid[i].parts, laid[j].parts)).toBe(false);
      }
    }
  });

  it('forms an archipelago — several islands, never one blob', () => {
    let singleIsland = 0;
    let totalIslands = 0;
    const runs = 40;
    for (let seed = 1; seed <= runs; seed++) {
      const count = islandsOf(layoutMap(growMap(seed))).length;
      totalIslands += count;
      if (count === 1) singleIsland++;
    }
    const mean = totalIslands / runs;
    // ~NEW_ISLAND_CHANCE × 50 words, minus the rays that find no water.
    expect(mean).toBeGreaterThan(MEMORY_MAP_CAPACITY * NEW_ISLAND_CHANCE * 0.6);
    expect(mean).toBeLessThan(MEMORY_MAP_CAPACITY * NEW_ISLAND_CHANCE * 1.6);
    expect(singleIsland).toBeLessThanOrEqual(1);
  });

  it('keeps islands apart: tiles of different islands rarely come within the gap', () => {
    let pairs = 0;
    let tooClose = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const laid = layoutMap(growMap(seed));
      for (let i = 0; i < laid.length; i++) {
        for (let j = i + 1; j < laid.length; j++) {
          if (laid[i].islandRootSlotId === laid[j].islandRootSlotId) continue;
          pairs++;
          if (partsOverlap(laid[i].parts, laid[j].parts, ISLAND_GAP * 0.5)) tooClose++;
        }
      }
    }
    // The bridge rule has a crowded-map fallback, so this is a rate, not an absolute.
    expect(tooClose / pairs).toBeLessThan(0.01);
  });

  it('grows portrait, roughly the shape of an upright phone', () => {
    let ratio = 0;
    const runs = 30;
    for (let seed = 1; seed <= runs; seed++) {
      const b = mapBounds(allParts(layoutMap(growMap(seed))))!;
      ratio += (b.maxX - b.minX) / (b.maxY - b.minY);
    }
    expect(ratio / runs).toBeGreaterThan(0.35);
    expect(ratio / runs).toBeLessThan(0.75);
  });

  it('is deterministic for a given random source', () => {
    expect(growMap(9)).toEqual(growMap(9));
  });
});
