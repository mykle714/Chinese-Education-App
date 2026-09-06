/**
 * sceneGraph.test.ts — the walkable set and pathfinding for an iw scene (§ 3a).
 *
 * The rules under test are the INVERSE of the night market's, which is the whole reason this
 * module exists: every in-bounds cell is walkable unless a blocking asset stands on it.
 * Several tests therefore assert an ABSENCE (nothing was painted, and it is still walkable),
 * which reads oddly until you remember what it is guarding against — somebody "fixing" the
 * builder by requiring a walkable mask and stranding every NPC in every scene.
 */

import { describe, it, expect } from 'vitest';
import {
  approachCells,
  buildSceneGraph,
  cellKey,
  isWalkable,
  parseCellKey,
  planScenePath,
  reachableFrom,
  resolvePlaceTarget,
  type SceneBoard,
} from '../sceneGraph';

/** A bare board with no decor and no places. */
const bare = (width: number, height: number): SceneBoard =>
  ({ width, height, decor: {}, places: {} });

/**
 * A stem the tileset actually resolves to a BLOCKING url, discovered rather than hardcoded
 * — hardcoding one couples every test below to the asset pack's current filenames.
 */
import { freeFarmTileset } from '../../market/freeFarmTileset';
import { isBlockingDecorUrl } from '../../market/farmTerrain';

const BLOCKING_STEM = (() => {
  const url = freeFarmTileset.getDecorUrls('common')[0];
  const stem = freeFarmTileset.stemOf(url);
  if (!stem || !isBlockingDecorUrl(url)) throw new Error('no blocking decor stem available');
  return stem;
})();

const FLUSH_STEM = (() => {
  const url = freeFarmTileset.getDecorUrls('dirt')[0];
  const stem = freeFarmTileset.stemOf(url);
  if (!stem || isBlockingDecorUrl(url)) throw new Error('no flush decor stem available');
  return stem;
})();

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

  it('blocks a cell carrying BLOCKING decor', () => {
    const g = buildSceneGraph({ ...bare(4, 3), decor: { '1,1': BLOCKING_STEM } });
    expect(isWalkable(g, 1, 1)).toBe(false);
    expect(g.walkable.size).toBe(11);
  });

  it('leaves a cell carrying FLUSH decor walkable', () => {
    const g = buildSceneGraph({ ...bare(4, 3), decor: { '1,1': FLUSH_STEM } });
    expect(isWalkable(g, 1, 1)).toBe(true);
  });

  it('treats an unresolvable decor stem as non-blocking', () => {
    // An asset renamed out from under a stored scene: the sprite will not render either, and
    // an invisible wall is the worse of the two failures.
    const g = buildSceneGraph({ ...bare(3, 3), decor: { '1,1': 'no_such_asset_stem' } });
    expect(isWalkable(g, 1, 1)).toBe(true);
  });

  it('builds 4-directional neighbours and never diagonal ones', () => {
    const g = buildSceneGraph(bare(3, 3));
    expect(g.neighbors.get('1,1')).toEqual(['1,0', '2,1', '1,2', '0,1']);
    // A corner has exactly two.
    expect(g.neighbors.get('0,0')).toEqual(['1,0', '0,1']);
  });

  it('KEEPS a place tag naming an unwalkable cell — that is the normal case', () => {
    // A place normally names an object, and an object is blocking decor. In the first real
    // scene 9 of 26 places are of this kind, including both walk_to_tag targets in use.
    const g = buildSceneGraph({
      width: 3, height: 3,
      decor: { '2,2': BLOCKING_STEM },
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
      decor: { '1,0': BLOCKING_STEM, '1,1': BLOCKING_STEM },
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
      decor: { '1,0': BLOCKING_STEM, '1,1': BLOCKING_STEM, '1,2': BLOCKING_STEM },
    });
    expect(planScenePath(g, '0,0', '2,0')).toBeNull();
  });

  it('returns null when the START is unwalkable (an NPC that grew a tree)', () => {
    const g = buildSceneGraph({ ...bare(3, 3), decor: { '0,0': BLOCKING_STEM } });
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
    // 0,0 . 2,0        A table at 1,0 with 1,1 blocked below it: the west seat is one step
    // .   X .          away, the east seat is three.
    const g = buildSceneGraph({ ...bare(3, 2), decor: { '1,1': BLOCKING_STEM } });
    expect(approachCells(g, '0,0', '1,0')).toEqual(['0,0', '2,0']);
  });

  it('omits cells it cannot reach rather than sorting them last', () => {
    const g = buildSceneGraph({
      ...bare(4, 1),
      decor: { '1,0': BLOCKING_STEM },
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
      decor: { '2,0': BLOCKING_STEM },
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
      decor: { '1,0': BLOCKING_STEM, '1,1': BLOCKING_STEM, '1,2': BLOCKING_STEM },
      places: { 'far side': '2,0' },
    });
    expect(resolvePlaceTarget(g, '0,0', 'far side')).toBeNull();
  });

  it('returns null when nothing beside an unwalkable place can be reached', () => {
    // A prop boxed in by three more props, approached from outside the box.
    const g = buildSceneGraph({
      width: 5, height: 1,
      decor: { '2,0': BLOCKING_STEM, '1,0': BLOCKING_STEM, '3,0': BLOCKING_STEM },
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
      decor: { '1,0': BLOCKING_STEM, '1,1': BLOCKING_STEM, '1,2': BLOCKING_STEM },
    });
    expect(reachableFrom(g, '0,0').size).toBe(3);
  });

  it('is empty from an unwalkable start', () => {
    const g = buildSceneGraph({ ...bare(3, 3), decor: { '0,0': BLOCKING_STEM } });
    expect(reachableFrom(g, '0,0').size).toBe(0);
  });
});
