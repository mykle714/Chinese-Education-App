import { describe, it, expect } from 'vitest';
import {
  selectVersion,
  conditionScoreSelector,
  scoreVersion,
  type VersionConditionState,
} from '../versionSelector';
import type { ConditionAnalysis, ConditionIsland } from '../conditionAnalysis';

/** A placeholder condition island bound to an area id. */
function placeholderIsland(id: string, areaId: string): ConditionIsland {
  return {
    id,
    kind: 'placeholder',
    cells: new Set([id]),
    bbox: { minCol: 0, minRow: 0, maxCol: 0, maxRow: 0 },
    placeholderAreaId: areaId,
  };
}

/** A border-street condition island. */
function borderIsland(id: string): ConditionIsland {
  return {
    id,
    kind: 'border-street',
    cells: new Set([id]),
    bbox: { minCol: 0, minRow: 0, maxCol: 0, maxRow: 0 },
  };
}

function analysisOf(islands: ConditionIsland[]): ConditionAnalysis {
  return { islands, conditionCount: islands.length };
}

function state(
  islands: ConditionIsland[],
  abutting: string[] = [],
): VersionConditionState {
  return { analysis: analysisOf(islands), abuttingBorderIslandIds: new Set(abutting) };
}

describe('scoreVersion', () => {
  it('scores placeholder satisfaction from filled area ids', () => {
    const s = state([placeholderIsland('i1', 'a1'), placeholderIsland('i2', 'a2')]);
    const r = scoreVersion(s, new Set(['a1']));
    expect(r).toEqual({ satisfied: 1, count: 2, score: 0.5 });
  });

  it('scores border-street satisfaction from abutting island ids', () => {
    const s = state([borderIsland('b1'), borderIsland('b2')], ['b1', 'b2']);
    const r = scoreVersion(s, new Set());
    expect(r).toEqual({ satisfied: 2, count: 2, score: 1 });
  });

  it('defines the base version 0/0 as score 0', () => {
    const r = scoreVersion(state([]), new Set());
    expect(r).toEqual({ satisfied: 0, count: 0, score: 0 });
  });

  it('never satisfies a placeholder island with no area match', () => {
    const orphan: ConditionIsland = {
      id: 'x',
      kind: 'placeholder',
      cells: new Set(['x']),
      bbox: { minCol: 0, minRow: 0, maxCol: 0, maxRow: 0 },
      placeholderAreaId: undefined,
    };
    expect(scoreVersion(state([orphan]), new Set(['a1'])).satisfied).toBe(0);
  });
});

describe('conditionScoreSelector', () => {
  it('picks the version with the highest absolute satisfied count', () => {
    // v0: base (satisfied 0). v1: 1/2 satisfied. v2: 2/2 satisfied → winner (most satisfied).
    const byVersion = new Map<number, VersionConditionState>([
      [0, state([])],
      [1, state([placeholderIsland('i1', 'a1'), placeholderIsland('i2', 'a2')])],
      [2, state([placeholderIsland('j1', 'a1'), placeholderIsland('j2', 'a2')])],
    ]);
    // Fill both areas → v2 = 2/2 = 1.0, v1 also 2/2? v1 islands map a1,a2 too → also 1.0.
    // Make them differ: v1 needs a1,a2; v2 needs a1,a2 — tie. Adjust: v1 needs a3 as well.
    byVersion.set(1, state([placeholderIsland('i1', 'a1'), placeholderIsland('i2', 'a3')]));
    const v = conditionScoreSelector([0, 1, 2], {
      name: 't',
      offsetCol: 0,
      offsetRow: 0,
      filledPlaceholderIds: new Set(['a1', 'a2']),
      byVersion,
    });
    // v1 = 1/2 = 0.5, v2 = 2/2 = 1.0 → v2 wins.
    expect(v).toBe(2);
  });

  it('renders the base version 0 when nothing is satisfied', () => {
    const byVersion = new Map<number, VersionConditionState>([
      [0, state([])],
      [1, state([placeholderIsland('i1', 'a1')])],
    ]);
    const v = conditionScoreSelector([0, 1], {
      name: 't',
      offsetCol: 0,
      offsetRow: 0,
      filledPlaceholderIds: new Set(), // nothing filled
      byVersion,
    });
    expect(v).toBe(0);
  });

  it('prefers higher absolute satisfied count over a higher ratio', () => {
    // The discriminating case between the two rules:
    // v1: 3/5 satisfied (ratio 0.6). v2: 2/2 satisfied (ratio 1.0).
    // Old ratio-primary rule would pick v2; absolute-primary picks v1 (3 > 2 satisfied).
    const byVersion = new Map<number, VersionConditionState>([
      [
        1,
        state([
          placeholderIsland('i1', 'a1'),
          placeholderIsland('i2', 'a2'),
          placeholderIsland('i3', 'a3'),
          placeholderIsland('i4', 'x1'), // unmet
          placeholderIsland('i5', 'x2'), // unmet
        ]),
      ],
      [2, state([placeholderIsland('j1', 'a1'), placeholderIsland('j2', 'a2')])],
    ]);
    const v = conditionScoreSelector([1, 2], {
      name: 't',
      offsetCol: 0,
      offsetRow: 0,
      filledPlaceholderIds: new Set(['a1', 'a2', 'a3']),
      byVersion,
    });
    expect(v).toBe(1);
  });

  it('tiebreaks equal absolute satisfied by highest ratio', () => {
    // v1: 1/1 = 1.0 (satisfied 1). v2: 1/2 = 0.5 (satisfied 1). Equal absolute → v1 (higher ratio).
    const byVersion = new Map<number, VersionConditionState>([
      [1, state([placeholderIsland('i1', 'a1')])],
      [2, state([placeholderIsland('j1', 'a1'), placeholderIsland('j2', 'x9')])],
    ]);
    const v = conditionScoreSelector([1, 2], {
      name: 't',
      offsetCol: 0,
      offsetRow: 0,
      filledPlaceholderIds: new Set(['a1']),
      byVersion,
    });
    expect(v).toBe(1);
  });

  it('tiebreaks equal ratio AND equal absolute by lowest version number', () => {
    // Both v1 and v2 score 1/1 with satisfied 1 → lowest version wins.
    const byVersion = new Map<number, VersionConditionState>([
      [1, state([borderIsland('b1')], ['b1'])],
      [2, state([borderIsland('b2')], ['b2'])],
    ]);
    const v = conditionScoreSelector([2, 1], {
      name: 't',
      offsetCol: 0,
      offsetRow: 0,
      byVersion,
    });
    expect(v).toBe(1);
  });

  it('falls back to the lowest available version when scoring inputs are absent', () => {
    expect(conditionScoreSelector([3, 1, 2], { name: 't', offsetCol: 0, offsetRow: 0 })).toBe(1);
  });

  it('is usable through the selectVersion seam', () => {
    const byVersion = new Map<number, VersionConditionState>([
      [0, state([])],
      [1, state([borderIsland('b1')], ['b1'])],
    ]);
    const v = selectVersion([0, 1], { name: 't', offsetCol: 0, offsetRow: 0, byVersion }, conditionScoreSelector);
    expect(v).toBe(1);
  });
});
