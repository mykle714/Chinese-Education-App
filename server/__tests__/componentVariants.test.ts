/**
 * The offline half of § 6z-5 (in-context component variants): stroke → component
 * labelling in decompose.js, and the cut + greedy-cover selection in
 * componentVariants.js.
 *
 * Pure: the decomposition entries are hand-built rather than read from the
 * makemeahanzi cache (a gitignored build input), and the scorer is injected.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6z-5.
 */
import { describe, it, expect } from 'vitest';
import { componentStrokesOf, componentsOf } from '../scripts/backfill/chinese/lib/decompose.js';
import { cutComponents, selectVariants, COVER_RADIUS, MIN_SUPPORT } from '../scripts/backfill/chinese/lib/componentVariants.js';

/** The real makemeahanzi rows for the 你 family, trimmed to what the labeller reads. */
const entries = new Map<string, { ids: string; matches: Array<number[] | null> | null }>([
  ['你', { ids: '⿰亻尔', matches: [[0], [0], [1], [1], [1], [1], [1]] }],
  ['尔', { ids: '⿱⺈小', matches: [[0], [0], [1], [1], [1]] }],
  ['从', { ids: '⿰人人', matches: [[0], [0], [1], [1]] }],
  // A nested IDS: the matches paths walk INTO the tree ([1, 0] = child 0 of child 1).
  ['赢', {
    ids: '⿱吂⿲⺼贝？',
    matches: [[0], [0], [0], [0], [0], [0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 1], [1, 1], [1, 1], [1, 1], null, null, null],
  }],
]);

describe('componentStrokesOf (decompose.js)', () => {
  it('labels every stroke of 你 through the opened-up 尔', () => {
    const { parts, labels } = componentStrokesOf('你', entries);
    expect(parts).toEqual(['亻', '⺈', '小']);
    // 亻亻 ⺈⺈ 小小小 — 尔's own labels, shifted to where its parts landed.
    expect(labels).toEqual([0, 0, 1, 1, 2, 2, 2]);
  });

  it('keeps the two 人 of 从 distinct, which is why labels are indices', () => {
    expect(componentStrokesOf('从', entries)).toEqual({ parts: ['人', '人'], labels: [0, 0, 1, 1] });
  });

  it('resolves nested matches paths, and leaves unattributed strokes null', () => {
    const { labels } = componentStrokesOf('赢', entries);
    expect(labels!.slice(6, 10)).toEqual([1, 1, 1, 1]); // [1, 0] → ⺼
    expect(labels!.slice(14)).toEqual([null, null, null]);
  });

  it('decomposes exactly as componentsOf does — one recursion, two outputs', () => {
    const ids = new Map([...entries].map(([char, entry]) => [char, entry.ids]));
    for (const char of entries.keys()) {
      expect(componentStrokesOf(char, entries).parts).toEqual(componentsOf(char, ids));
    }
  });
});

describe('cutComponents', () => {
  const medians = [0, 1, 2, 3, 4, 5, 6].map((s) => [[s, s]] as Array<[number, number]>);

  it("cuts each wanted component's strokes, in stroke order", () => {
    const cuts = cutComponents(['亻', '⺈', '小'], [0, 0, 1, 1, 2, 2, 2], medians, (g: string) => g === '⺈');
    expect(cuts).toEqual([{ component: '⺈', medians: [medians[2], medians[3]] }]);
  });

  it('refuses a character with any unattributed stroke — the cut might be incomplete', () => {
    expect(cutComponents(['亻', '⺈'], [0, 0, 1, null, 1, 1, 1], medians, () => true)).toEqual([]);
  });
});

describe('selectVariants', () => {
  // One-stroke, one-point "shapes" on a line: the injected cost is the distance
  // between their x positions, so clusters are easy to lay out by hand.
  type Shape = Array<Array<[number, number]>>;
  const at = (x: number): Shape => [[[x, 0]]];
  const cost = (a: Shape, b: Shape) => Math.abs(a[0][0][0] - b[0][0][0]);
  const sample = (source: string, x: number) => ({ source, shape: at(x) });

  it('ships nothing when every sample is already close to the standalone form', () => {
    const samples = Array.from({ length: 10 }, (_, i) => sample(`c${i}`, i * 0.001));
    expect(selectVariants(at(0), samples, cost)).toEqual([]);
  });

  it('ships one representative for a well-supported distinct form', () => {
    const far = Array.from({ length: MIN_SUPPORT + 2 }, (_, i) => sample(`far${i}`, 0.5 + i * 0.001));
    const near = Array.from({ length: 10 }, (_, i) => sample(`near${i}`, i * 0.001));
    const chosen = selectVariants(at(0), [...near, ...far], cost);
    expect(chosen).toHaveLength(1);
    expect(chosen[0].support).toBe(far.length);
    expect(cost(chosen[0].shape, at(0.5))).toBeLessThanOrEqual(COVER_RADIUS);
  });

  it('drops a form too rare to be more than a one-off', () => {
    const rare = Array.from({ length: MIN_SUPPORT - 1 }, (_, i) => sample(`rare${i}`, 0.5));
    const near = Array.from({ length: 10 }, (_, i) => sample(`near${i}`, 0));
    expect(selectVariants(at(0), [...near, ...rare], cost)).toEqual([]);
  });

  it('gives a component with no standalone drawing a template of its own', () => {
    const samples = Array.from({ length: MIN_SUPPORT }, (_, i) => sample(`c${i}`, 0.3));
    expect(selectVariants(null, samples, cost)).toHaveLength(1);
  });
});
