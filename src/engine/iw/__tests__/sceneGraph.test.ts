/**
 * sceneGraph.test.ts — the walkable set and pathfinding for an iw scene (§ 3a).
 *
 * The rules under test are the INVERSE of the night market's, which is the whole reason this
 * module exists: every in-bounds cell is walkable unless the author painted it UNWALKABLE.
 * Several tests therefore assert an ABSENCE (nothing was painted, and it is still walkable),
 * which reads oddly until you remember what it is guarding against — somebody "fixing" the
 * builder by requiring a walkable mask and stranding every NPC in every scene.
 *
 * ⚠️ Nothing here mentions DECOR any more (2026-09-19). Walkability used to be derived from
 * the sprites on the board, and half this file existed to pin down which sprite families
 * blocked; a wall is painted now, so those tests went with the coupling they described.
 */

import { describe, it, expect } from 'vitest';
import {
  approachCells,
  buildSceneGraph,
  forcedFacingAt,
  FORCED_TILE_COST,
  cellKey,
  chebyshev,
  isWalkable,
  parseCellKey,
  planScenePath,
  reachableFrom,
  resolvePlaceTarget,
  type SceneBoard,
} from '../sceneGraph';

/** A bare board: nothing painted, nothing tagged. */
const bare = (width: number, height: number): SceneBoard =>
  ({ width, height, unwalkable: [], forcedDirection: {}, places: {} });

describe('buildSceneGraph — walkability is the inverse of the night market', () => {
  it('makes every in-bounds cell walkable when nothing is painted', () => {
    const g = buildSceneGraph(bare(4, 3));
    expect(g.walkable.size).toBe(12);
    expect(isWalkable(g, 0, 0)).toBe(true);
    expect(isWalkable(g, 3, 2)).toBe(true);
  });

  it('treats out-of-bounds as unwalkable', () => {
    const g = buildSceneGraph(bare(4, 3));
    expect(isWalkable(g, 4, 0)).toBe(false);
    expect(isWalkable(g, -1, 0)).toBe(false);
    expect(isWalkable(g, 0, 3)).toBe(false);
  });

  it('blocks exactly the cells in the unwalkable mask', () => {
    const g = buildSceneGraph({ ...bare(4, 3), unwalkable: ['1,1'] });
    expect(isWalkable(g, 1, 1)).toBe(false);
    expect(g.walkable.size).toBe(11);
  });

  it('does NOT block a cell just because something stands on it', () => {
    // The 2026-09-19 cutover, pinned. A scene stored before it carries no mask at all, so a
    // board that used to have trees on it comes back fully walkable — deliberately. Any
    // future attempt to re-derive walkability from the sprites fails here, which is the
    // point: `SceneBoard` no longer even has a `decor` field to derive it from.
    const g = buildSceneGraph({
      width: 4, height: 3, unwalkable: [], forcedDirection: {}, places: {},
    });
    expect(g.walkable.size).toBe(12);
  });

  it('builds 4-directional neighbours and never diagonal ones', () => {
    const g = buildSceneGraph(bare(3, 3));
    expect(g.neighbors.get('1,1')).toEqual(['1,0', '2,1', '1,2', '0,1']);
    // A corner has exactly two.
    expect(g.neighbors.get('0,0')).toEqual(['1,0', '0,1']);
  });

  it('KEEPS a place tag naming an unwalkable cell — that is the normal case', () => {
    // A place normally names an object, and an object normally has a wall painted under it. In the first real
    // scene 9 of 26 places are of this kind, including both walk_to_tag targets in use.
    const g = buildSceneGraph({
      width: 3, height: 3,
      unwalkable: ['2,2'],
      forcedDirection: {},
      places: { counter: '1,1', 'cash register': '2,2' },
    });
    expect(g.places.get('counter')).toBe('1,1');
    expect(g.places.get('cash register')).toBe('2,2');
  });

  it('keeps several tags naming the same cell', () => {
    const g = buildSceneGraph({
      ...bare(3, 3),
      places: { counter: '1,1', 'where the tea is': '1,1' },
    });
    expect(g.places.get('counter')).toBe('1,1');
    expect(g.places.get('where the tea is')).toBe('1,1');
  });
});

describe('parseCellKey', () => {
  it('round-trips a cell key', () => {
    expect(parseCellKey(cellKey(3, 7))).toEqual({ col: 3, row: 7 });
  });
  it('returns null for malformed authored data rather than throwing', () => {
    // The input is jsonb written by an author; a bad key is a scene to warn about.
    expect(parseCellKey('1')).toBeNull();
    expect(parseCellKey('a,b')).toBeNull();
    expect(parseCellKey('1,2,3')).toBeNull();
    expect(parseCellKey('1.5,2')).toBeNull();
  });
});

describe('planScenePath', () => {
  it('returns the single cell when already at the goal', () => {
    const g = buildSceneGraph(bare(3, 3));
    expect(planScenePath(g, '1,1', '1,1')).toEqual(['1,1']);
  });

  it('finds a straight path across an empty board', () => {
    const g = buildSceneGraph(bare(4, 1));
    expect(planScenePath(g, '0,0', '3,0')).toEqual(['0,0', '1,0', '2,0', '3,0']);
  });

  it('routes around a blocking prop', () => {
    // A wall down the middle of a 3-wide board with one gap at the bottom.
    const g = buildSceneGraph({
      ...bare(3, 3),
      unwalkable: ['1,0', '1,1'],
    });
    const path = planScenePath(g, '0,0', '2,0');
    expect(path).not.toBeNull();
    expect(path![0]).toBe('0,0');
    expect(path![path!.length - 1]).toBe('2,0');
    expect(path).toContain('1,2'); // the only gap
  });

  it('returns null when the goal is walled off', () => {
    const g = buildSceneGraph({
      ...bare(3, 3),
      unwalkable: ['1,0', '1,1', '1,2'],
    });
    expect(planScenePath(g, '0,0', '2,0')).toBeNull();
  });

  it('returns null when the START is unwalkable (an NPC that grew a tree)', () => {
    const g = buildSceneGraph({ ...bare(3, 3), unwalkable: ['0,0'] });
    expect(planScenePath(g, '0,0', '2,2')).toBeNull();
  });

  it('is deterministic — the same route every call', () => {
    const g = buildSceneGraph(bare(5, 5));
    const first = planScenePath(g, '0,0', '4,4');
    for (let i = 0; i < 5; i++) expect(planScenePath(g, '0,0', '4,4')).toEqual(first);
  });

  it('routes around an occupied cell', () => {
    const g = buildSceneGraph(bare(3, 1));
    expect(planScenePath(g, '0,0', '2,0', { occupied: new Set(['1,0']) })).toBeNull();
  });

  it('still plans INTO an occupied goal — that is how "walk to that NPC" is expressed', () => {
    const g = buildSceneGraph(bare(3, 1));
    const path = planScenePath(g, '0,0', '2,0', { occupied: new Set(['2,0']) });
    expect(path).toEqual(['0,0', '1,0', '2,0']);
  });
});

describe('approachCells', () => {
  it('returns the cells beside a target, nearest first by PATH not by line', () => {
    // 0,0 . 2,0        A table at 1,0 with 1,1 walled below it: the west seat is one step
    // .   X .          away, the east seat is three.
    const g = buildSceneGraph({ ...bare(3, 2), unwalkable: ['1,1'] });
    expect(approachCells(g, '0,0', '1,0')).toEqual(['0,0', '2,0']);
  });

  it('omits cells it cannot reach rather than sorting them last', () => {
    const g = buildSceneGraph({
      ...bare(4, 1),
      unwalkable: ['1,0'],
    });
    // Standing at 0,0, the only approach to 3,0 is 2,0 — which is behind the wall.
    expect(approachCells(g, '0,0', '3,0')).toEqual([]);
  });

  it('returns empty for a malformed target key', () => {
    expect(approachCells(buildSceneGraph(bare(3, 3)), '0,0', 'nonsense')).toEqual([]);
  });
});

describe('resolvePlaceTarget', () => {
  it('stands ON a walkable place', () => {
    const g = buildSceneGraph({ ...bare(3, 3), places: { doorway: '0,1' } });
    expect(resolvePlaceTarget(g, '2,2', 'doorway')).toBe('0,1');
  });

  it('stands BESIDE an unwalkable place — the counter case', () => {
    const g = buildSceneGraph({
      width: 3, height: 1,
      unwalkable: ['2,0'],
      forcedDirection: {},
      places: { 'cash register': '2,0' },
    });
    expect(resolvePlaceTarget(g, '0,0', 'cash register')).toBe('1,0');
  });

  it('returns null for an unknown tag', () => {
    expect(resolvePlaceTarget(buildSceneGraph(bare(3, 3)), '0,0', 'nowhere')).toBeNull();
  });

  it('returns null when a walkable place is walled off', () => {
    const g = buildSceneGraph({
      ...bare(3, 3),
      unwalkable: ['1,0', '1,1', '1,2'],
      places: { 'far side': '2,0' },
    });
    expect(resolvePlaceTarget(g, '0,0', 'far side')).toBeNull();
  });

  it('returns null when nothing beside an unwalkable place can be reached', () => {
    // A prop boxed in by three more props, approached from outside the box.
    const g = buildSceneGraph({
      width: 5, height: 1,
      unwalkable: ['2,0', '1,0', '3,0'],
      forcedDirection: {},
      places: { boxed: '2,0' },
    });
    expect(resolvePlaceTarget(g, '0,0', 'boxed')).toBeNull();
  });
});

describe('reachableFrom', () => {
  it('covers the whole board when nothing blocks', () => {
    expect(reachableFrom(buildSceneGraph(bare(4, 4)), '0,0').size).toBe(16);
  });

  it('excludes a walled-off pocket', () => {
    // A 3x3 with the middle column solid: two 1x3 halves.
    const g = buildSceneGraph({
      ...bare(3, 3),
      unwalkable: ['1,0', '1,1', '1,2'],
    });
    expect(reachableFrom(g, '0,0').size).toBe(3);
  });

  it('is empty from an unwalkable start', () => {
    const g = buildSceneGraph({ ...bare(3, 3), unwalkable: ['0,0'] });
    expect(reachableFrom(g, '0,0').size).toBe(0);
  });
});

/**
 * Rehomed from the deleted `hearing.test.ts` (2026-09-07). Only the metric survived the
 * removal of the earshot gate — these are the two properties its one remaining caller
 * (the `nearby` distances in an NPC's prompt) actually depends on.
 */
describe('chebyshev', () => {
  it('counts a diagonal step as one', () => {
    expect(chebyshev({ col: 0, row: 0 }, { col: 1, row: 1 })).toBe(1);
    expect(chebyshev({ col: 0, row: 0 }, { col: 3, row: 1 })).toBe(3);
  });

  it('is symmetric and zero on itself', () => {
    expect(chebyshev({ col: 4, row: 2 }, { col: 1, row: 7 })).toBe(chebyshev({ col: 1, row: 7 }, { col: 4, row: 2 }));
    expect(chebyshev({ col: 4, row: 2 }, { col: 4, row: 2 })).toBe(0);
  });
});


describe('forced-direction cells — walkable, avoided, never a wall', () => {
  /** A 1-row corridor with one forced cell in the middle of it. */
  const corridor = (forcedCell: string, width = 5): SceneBoard => ({
    width, height: 1, unwalkable: [], forcedDirection: { [forcedCell]: 'n' }, places: {},
  });

  it('keeps a forced cell WALKABLE — it is a destination, not an obstacle', () => {
    const g = buildSceneGraph(corridor('2,0'));
    expect(isWalkable(g, 2, 0)).toBe(true);
    expect(g.forced.get('2,0')).toBe('n');
    expect(forcedFacingAt(g, '2,0')).toBe('n');
    expect(forcedFacingAt(g, '1,0')).toBeNull();
  });

  it('drops a facing painted on an unwalkable cell — nobody could ever settle there', () => {
    const g = buildSceneGraph({
      width: 3, height: 1, unwalkable: ['1,0'], forcedDirection: { '1,0': 'e' }, places: {},
    });
    expect(g.forced.has('1,0')).toBe(false);
  });

  it('plans INTO a forced cell as a goal', () => {
    const g = buildSceneGraph(corridor('4,0'));
    expect(planScenePath(g, '0,0', '4,0')).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0']);
  });

  it('plans OUT of a forced cell as a start', () => {
    const g = buildSceneGraph(corridor('0,0'));
    expect(planScenePath(g, '0,0', '2,0')).toEqual(['0,0', '1,0', '2,0']);
  });

  it('walks THROUGH one when the only alternative is a long way round', () => {
    // A 1-wide corridor: there is no detour at all, so the forced cell is simply crossed.
    const g = buildSceneGraph(corridor('2,0'));
    expect(planScenePath(g, '0,0', '4,0')).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0']);
  });

  it('takes a SHORT detour rather than crossing one', () => {
    // Two rows, forced cell at 1,0. Going around costs 4 steps; crossing costs
    // FORCED_TILE_COST + 1 = 9, so the detour wins.
    expect(FORCED_TILE_COST).toBeGreaterThan(4); // the premise of this test, made explicit
    const g = buildSceneGraph({
      width: 3, height: 2, unwalkable: [], forcedDirection: { '1,0': 'n' }, places: {},
    });
    expect(planScenePath(g, '0,0', '2,0')).toEqual(['0,0', '0,1', '1,1', '2,1', '2,0']);
  });

  it('does NOT take an absurd detour — the penalty is finite', () => {
    // A 3-wide, 6-tall room with a solid divider up the middle, open only along the bottom
    // row. Getting from 0,0 to 2,0 either steps across the forced cell at 1,0 (cost
    // FORCED_TILE_COST + 1 = 9) or walks all the way down, across and back up (12 ordinary
    // steps). The detour is longer than the penalty, so the body cuts through — which is the
    // whole difference between this rule and "a clean route always wins".
    const g = buildSceneGraph({
      width: 3,
      height: 6,
      unwalkable: ['1,1', '1,2', '1,3', '1,4'],
      forcedDirection: { '1,0': 'n' },
      places: {},
    });
    expect(planScenePath(g, '0,0', '2,0')).toEqual(['0,0', '1,0', '2,0']);
  });

  it('prefers an ordinary approach cell over a forced one', () => {
    // A target at 1,0 with two seats: 0,0 (forced) and 2,0 (ordinary). Standing on the forced
    // seat would override the very facing the approach exists to set, so it sorts last.
    const g = buildSceneGraph({
      width: 3, height: 1, unwalkable: [], forcedDirection: { '0,0': 'n' }, places: {},
    });
    expect(approachCells(g, '2,0', '1,0')).toEqual(['2,0', '0,0']);
  });

  it('counts a forced cell as reachable — expensive is not closed', () => {
    const g = buildSceneGraph(corridor('2,0'));
    expect(reachableFrom(g, '0,0').size).toBe(5);
  });
});
