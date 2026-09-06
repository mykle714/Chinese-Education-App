/**
 * hearing.test.ts — the mechanical audibility gate (§ 4, § 4.1).
 *
 * ⚠️ THESE ARE BUDGET TESTS AS MUCH AS BEHAVIOUR TESTS. Every audible NPC is one model call
 * (§ 4.1), so a change that widens a radius or forgives an occluder shows up as spend. If a
 * test here starts failing because the numbers moved, that is a costing decision, not a
 * test to relax.
 */

import { describe, it, expect } from 'vitest';
import { buildSceneGraph, type SceneBoard } from '../sceneGraph';
import { freeFarmTileset } from '../../market/freeFarmTileset';
import { isBlockingDecorUrl } from '../../market/farmTerrain';
import {
  audibleCells,
  audibleListeners,
  cellsOnLine,
  chebyshev,
  countOccluders,
  hears,
  HEARING_RADIUS,
  MAX_OCCLUDERS,
  OCCLUSION_PENALTY,
} from '../hearing';

const BLOCKING_STEM = (() => {
  const url = freeFarmTileset.getDecorUrls('common')[0];
  const stem = freeFarmTileset.stemOf(url);
  if (!stem || !isBlockingDecorUrl(url)) throw new Error('no blocking decor stem available');
  return stem;
})();

const board = (width: number, height: number, decor: Record<string, string> = {}): SceneBoard =>
  ({ width, height, decor, places: {} });

/**
 * An open 40x40 room. Deliberately larger than a shout's diameter so the radius tests
 * measure the RADIUS and not the board edge — a 20x20 board silently clips a shout from the
 * middle, which is how the first draft of these tests "passed" for the wrong reason.
 */
const OPEN = buildSceneGraph(board(40, 40));

describe('chebyshev', () => {
  it('counts a diagonal as one, not two — you can hear the corner of a room', () => {
    expect(chebyshev({ col: 0, row: 0 }, { col: 1, row: 1 })).toBe(1);
    expect(chebyshev({ col: 0, row: 0 }, { col: 3, row: 1 })).toBe(3);
  });
});

describe('cellsOnLine', () => {
  it('excludes both endpoints', () => {
    expect(cellsOnLine({ col: 0, row: 0 }, { col: 3, row: 0 }))
      .toEqual([{ col: 1, row: 0 }, { col: 2, row: 0 }]);
  });

  it('is empty for adjacent or identical cells', () => {
    expect(cellsOnLine({ col: 0, row: 0 }, { col: 1, row: 0 })).toEqual([]);
    expect(cellsOnLine({ col: 0, row: 0 }, { col: 1, row: 1 })).toEqual([]);
    expect(cellsOnLine({ col: 2, row: 2 }, { col: 2, row: 2 })).toEqual([]);
  });

  it('never repeats a cell, so one prop is never charged twice', () => {
    const cells = cellsOnLine({ col: 0, row: 0 }, { col: 6, row: 2 });
    const keys = cells.map(c => `${c.col},${c.row}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('walks the same cells in both directions', () => {
    const a = cellsOnLine({ col: 0, row: 0 }, { col: 5, row: 3 }).map(c => `${c.col},${c.row}`);
    const b = cellsOnLine({ col: 5, row: 3 }, { col: 0, row: 0 }).map(c => `${c.col},${c.row}`);
    expect(new Set(a)).toEqual(new Set(b));
  });
});

describe('countOccluders', () => {
  it('counts blocking cells strictly between two points', () => {
    const g = buildSceneGraph(board(6, 1, { '2,0': BLOCKING_STEM, '3,0': BLOCKING_STEM }));
    expect(countOccluders(g, { col: 0, row: 0 }, { col: 5, row: 0 })).toBe(2);
  });

  it('does not count a prop the listener is standing beside', () => {
    // The prop is AT the endpoint's neighbour but not between: 0,0 -> 2,0 crosses only 1,0.
    const g = buildSceneGraph(board(6, 1, { '3,0': BLOCKING_STEM }));
    expect(countOccluders(g, { col: 0, row: 0 }, { col: 2, row: 0 })).toBe(0);
  });
});

describe('hears', () => {
  const listener = (col: number, row: number, busy = false) => ({ id: 'n1', col, row, busy });

  it('hears inside the radius for each volume', () => {
    for (const volume of ['whisper', 'talk', 'shout'] as const) {
      const r = HEARING_RADIUS[volume];
      expect(hears(OPEN, { col: 20, row: 20 }, listener(20 + r, 20), volume)).not.toBeNull();
      expect(hears(OPEN, { col: 20, row: 20 }, listener(20 + r + 1, 20), volume)).toBeNull();
    }
  });

  it('a whisper does not carry as far as a shout', () => {
    expect(HEARING_RADIUS.whisper).toBeLessThan(HEARING_RADIUS.talk);
    expect(HEARING_RADIUS.talk).toBeLessThan(HEARING_RADIUS.shout);
  });

  it('returns null — not a falsy result — for a miss, so it cannot be misread', () => {
    expect(hears(OPEN, { col: 0, row: 0 }, listener(19, 19), 'whisper')).toBeNull();
  });

  it('excludes a busy NPC however close they are', () => {
    expect(hears(OPEN, { col: 10, row: 10 }, listener(10, 11, true), 'shout')).toBeNull();
  });

  it('charges range for an occluder — a stand between you muffles', () => {
    // One prop on the line — it must sit BETWEEN the two, not beyond the listener.
    // talk's radius 5 drops to 3.
    const g = buildSceneGraph(board(20, 1, { '1,0': BLOCKING_STEM }));
    const at = HEARING_RADIUS.talk - OCCLUSION_PENALTY;
    expect(hears(g, { col: 0, row: 0 }, listener(at, 0), 'talk')).not.toBeNull();
    expect(hears(g, { col: 0, row: 0 }, listener(at + 1, 0), 'talk')).toBeNull();
  });

  it('stops entirely past MAX_OCCLUDERS — a wall, not a muffle', () => {
    const decor: Record<string, string> = {};
    for (let i = 1; i <= MAX_OCCLUDERS + 1; i++) decor[`${i},0`] = BLOCKING_STEM;
    const g = buildSceneGraph(board(20, 1, decor));
    // Well inside a shout's radius, and still nothing.
    expect(hears(g, { col: 0, row: 0 }, listener(MAX_OCCLUDERS + 2, 0), 'shout')).toBeNull();
  });

  it('reports the numbers that decided it, for the debug overlay', () => {
    const g = buildSceneGraph(board(20, 1, { '2,0': BLOCKING_STEM }));
    const r = hears(g, { col: 0, row: 0 }, listener(3, 0), 'talk');
    expect(r).toEqual({
      id: 'n1',
      distance: 3,
      occluders: 1,
      effectiveRadius: HEARING_RADIUS.talk - OCCLUSION_PENALTY,
    });
  });
});

describe('audibleListeners', () => {
  it('returns only those who heard, nearest first', () => {
    const heard = audibleListeners(OPEN, { col: 10, row: 10 }, [
      { id: 'far', col: 14, row: 10 },
      { id: 'near', col: 11, row: 10 },
      { id: 'deaf', col: 30, row: 30 },
      { id: 'mid', col: 12, row: 10 },
    ], 'talk');
    expect(heard.map(h => h.id)).toEqual(['near', 'mid', 'far']);
  });

  it('breaks distance ties on the authored cast order, so it is stable', () => {
    const cast = [
      { id: 'a', col: 11, row: 10 },
      { id: 'b', col: 9, row: 10 },
      { id: 'c', col: 10, row: 11 },
    ];
    const ids = audibleListeners(OPEN, { col: 10, row: 10 }, cast, 'talk').map(h => h.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('is the cost control — a busy cast produces no calls at all', () => {
    const heard = audibleListeners(OPEN, { col: 10, row: 10 }, [
      { id: 'a', col: 11, row: 10, busy: true },
      { id: 'b', col: 9, row: 10, busy: true },
    ], 'shout');
    expect(heard).toEqual([]);
  });
});

describe('audibleCells', () => {
  it('is the walkable disc around the speaker', () => {
    const cells = audibleCells(OPEN, { col: 10, row: 10 }, 'whisper');
    const r = HEARING_RADIUS.whisper;
    expect(cells.size).toBe((2 * r + 1) ** 2);
    expect(cells.has('10,10')).toBe(true);
    expect(cells.has(`${10 + r + 1},10`)).toBe(false);
  });

  it('never includes an unwalkable cell — nobody stands there to hear', () => {
    const g = buildSceneGraph(board(20, 20, { '11,10': BLOCKING_STEM }));
    expect(audibleCells(g, { col: 10, row: 10 }, 'talk').has('11,10')).toBe(false);
  });

  it('is clipped by the board edge', () => {
    const cells = audibleCells(OPEN, { col: 0, row: 0 }, 'whisper');
    const r = HEARING_RADIUS.whisper;
    expect(cells.size).toBe((r + 1) ** 2);
  });

  it('shows the occlusion shadow behind a prop', () => {
    const decor: Record<string, string> = {};
    for (let i = 1; i <= MAX_OCCLUDERS + 1; i++) decor[`${10 + i},10`] = BLOCKING_STEM;
    const g = buildSceneGraph(board(20, 20, decor));
    const cells = audibleCells(g, { col: 10, row: 10 }, 'shout');
    expect(cells.has(`${10 + MAX_OCCLUDERS + 2},10`)).toBe(false);
    expect(cells.has('10,12')).toBe(true); // unobstructed direction is unaffected
  });
});
