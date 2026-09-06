/**
 * sceneActor.test.ts — the body that walks a scene path (§ 3).
 *
 * The interesting assertions are the ones about OWNERSHIP and TIMING rather than about
 * arriving: two actors must never end a tick inside the same cell, a re-plan must never
 * teleport a body mid-step, and a blocked actor must give up rather than wait forever.
 */

import { describe, it, expect } from 'vitest';
import { buildSceneGraph, type SceneBoard } from '../sceneGraph';
import { freeFarmTileset } from '../../market/freeFarmTileset';
import { isBlockingDecorUrl } from '../../market/farmTerrain';
import {
  BLOCKED_GIVE_UP_MS,
  createSceneActor,
  facingForStep,
  isWalking,
  occupiedCells,
  sceneActorPosition,
  setActorPath,
  stopActor,
  tickSceneActor,
  tickSceneActors,
  walkActorTo,
  type SceneActorState,
} from '../sceneActor';

const BLOCKING_STEM = (() => {
  const url = freeFarmTileset.getDecorUrls('common')[0];
  const stem = freeFarmTileset.stemOf(url);
  if (!stem || !isBlockingDecorUrl(url)) throw new Error('no blocking decor stem');
  return stem;
})();

const board = (w: number, h: number, decor: Record<string, string> = {}): SceneBoard =>
  ({ width: w, height: h, decor, places: {} });

const OPEN = buildSceneGraph(board(10, 10));
const EMPTY = new Set<string>();

/** Run ticks until the actor stops walking, or the budget runs out. */
function runToRest(actor: SceneActorState, graph = OPEN, dt = 50, maxTicks = 500) {
  let a = actor;
  const events = [];
  for (let i = 0; i < maxTicks && isWalking(a); i++) {
    const r = tickSceneActor(a, dt, { graph, occupied: EMPTY });
    a = r.actor;
    if (r.event.kind !== 'none') events.push(r.event);
  }
  return { actor: a, events };
}

describe('facingForStep', () => {
  it('follows the engine axis convention: +row is north, +col is east', () => {
    // Matches DirectionalWalkAnimation's documented semantics (north = isoY increasing),
    // which is the only facing convention in the codebase that is visually verified.
    expect(facingForStep('5,5', '5,6')).toBe('n');
    expect(facingForStep('5,5', '6,5')).toBe('e');
    expect(facingForStep('5,5', '5,4')).toBe('s');
    expect(facingForStep('5,5', '4,5')).toBe('w');
  });

  it('returns null for a non-step', () => {
    expect(facingForStep('5,5', '5,5')).toBeNull();
    expect(facingForStep('bad', '5,5')).toBeNull();
  });
});

describe('tickSceneActor', () => {
  it('stands still with nothing planned', () => {
    const a = createSceneActor('p', '0,0', 's');
    const r = tickSceneActor(a, 100, { graph: OPEN, occupied: EMPTY });
    expect(r.actor).toEqual(a);
    expect(r.event).toEqual({ kind: 'none' });
    expect(isWalking(a)).toBe(false);
  });

  it('walks a path and reports arrival exactly once', () => {
    const a = walkActorTo(createSceneActor('p', '0,0', 's'), OPEN, '3,0');
    const { actor, events } = runToRest(a);
    expect(actor.cell).toBe('3,0');
    expect(actor.progress).toBe(0);
    expect(events).toEqual([{ kind: 'arrived', cell: '3,0' }]);
  });

  it('turns to face the direction of travel', () => {
    const a = walkActorTo(createSceneActor('p', '0,0', 's'), OPEN, '3,0');
    const r = tickSceneActor(a, 10, { graph: OPEN, occupied: EMPTY });
    expect(r.actor.facing).toBe('e');
  });

  it('moves on the very first tick of a step — a step never costs an idle frame', () => {
    const a = walkActorTo(createSceneActor('p', '0,0', 's'), OPEN, '3,0');
    const r = tickSceneActor(a, 50, { graph: OPEN, occupied: EMPTY });
    expect(r.actor.progress).toBeGreaterThan(0);
    expect(sceneActorPosition(r.actor)[0]).toBeGreaterThan(0);
  });

  it('renders between cells while stepping', () => {
    let a = walkActorTo(createSceneActor('p', '0,0', 's'), OPEN, '3,0');
    a = tickSceneActor(a, 100, { graph: OPEN, occupied: EMPTY }).actor;
    const [x, y] = sceneActorPosition(a);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(1);
    expect(y).toBe(0);
  });

  it('owns the destination cell the moment it commits, not on arrival', () => {
    const a = walkActorTo(createSceneActor('p', '0,0', 's'), OPEN, '3,0');
    const stepping = tickSceneActor(a, 10, { graph: OPEN, occupied: EMPTY }).actor;
    expect(stepping.cell).toBe('1,0');
    expect(stepping.fromCell).toBe('0,0');
    // Both cells are impassable while it is between them.
    expect(occupiedCells([stepping])).toEqual(new Set(['1,0', '0,0']));
  });

  it('waits for an occupied next cell, then gives up and says so', () => {
    let a = walkActorTo(createSceneActor('p', '0,0', 's'), OPEN, '3,0');
    const occupied = new Set(['1,0']);
    let blockedEvent = null;
    for (let i = 0; i < 100; i++) {
      const r = tickSceneActor(a, 100, { graph: OPEN, occupied });
      a = r.actor;
      if (r.event.kind === 'blocked') { blockedEvent = r.event; break; }
    }
    expect(blockedEvent).toEqual({ kind: 'blocked', at: '1,0' });
    expect(a.cell).toBe('0,0');
    expect(a.path).toEqual([]);
  });

  it('resumes when the blocker clears before the give-up deadline', () => {
    let a = walkActorTo(createSceneActor('p', '0,0', 's'), OPEN, '3,0');
    const blocked = new Set(['1,0']);
    // Wait almost long enough to give up.
    for (let i = 0; i < Math.floor(BLOCKED_GIVE_UP_MS / 100) - 1; i++) {
      a = tickSceneActor(a, 100, { graph: OPEN, occupied: blocked }).actor;
    }
    expect(a.path.length).toBeGreaterThan(0);
    const { actor } = runToRest(a);
    expect(actor.cell).toBe('3,0');
  });

  it('gives up when the path is blocked by decor that appeared under it', () => {
    const a = walkActorTo(createSceneActor('p', '0,0', 's'), OPEN, '3,0');
    const walled = buildSceneGraph(board(10, 10, { '1,0': BLOCKING_STEM }));
    let s = a;
    let event = null;
    for (let i = 0; i < 100; i++) {
      const r = tickSceneActor(s, 100, { graph: walled, occupied: EMPTY });
      s = r.actor;
      if (r.event.kind === 'blocked') { event = r.event; break; }
    }
    expect(event).toEqual({ kind: 'blocked', at: '1,0' });
  });

  it('routes around a prop without ever standing on it', () => {
    const g = buildSceneGraph(board(3, 3, { '1,0': BLOCKING_STEM, '1,1': BLOCKING_STEM }));
    let a = walkActorTo(createSceneActor('p', '0,0', 's'), g, '2,0');
    const visited: string[] = [];
    for (let i = 0; i < 300 && isWalking(a); i++) {
      a = tickSceneActor(a, 50, { graph: g, occupied: EMPTY }).actor;
      visited.push(a.cell);
    }
    expect(a.cell).toBe('2,0');
    expect(visited).not.toContain('1,0');
    expect(visited).not.toContain('1,1');
  });
});

describe('setActorPath', () => {
  it('rejects a stale plan that does not start where the actor is', () => {
    const a = createSceneActor('p', '0,0', 's');
    expect(setActorPath(a, ['5,5', '5,6'])).toBe(a);
  });

  it('re-plans from the cell being walked INTO, never teleporting mid-step', () => {
    let a = walkActorTo(createSceneActor('p', '0,0', 's'), OPEN, '5,0');
    a = tickSceneActor(a, 10, { graph: OPEN, occupied: EMPTY }).actor;
    expect(a.cell).toBe('1,0');
    expect(a.progress).toBeGreaterThan(0);
    // A new plan starting at the CURRENT cell is refused — the actor is not there yet.
    const stale = setActorPath(a, ['0,0', '0,1']);
    expect(stale).toBe(a);
    // A plan from the cell it is walking into is accepted, and does not move it.
    const fresh = setActorPath(a, ['1,0', '1,1']);
    expect(fresh.path).toEqual(['1,1']);
    expect(fresh.cell).toBe('1,0');
    expect(fresh.progress).toBe(a.progress);
  });

  it('stopActor finishes the current step and then stands', () => {
    let a = walkActorTo(createSceneActor('p', '0,0', 's'), OPEN, '5,0');
    a = tickSceneActor(a, 10, { graph: OPEN, occupied: EMPTY }).actor;
    const stopped = stopActor(a);
    const { actor } = runToRest(stopped);
    expect(actor.cell).toBe('1,0'); // the cell it had already committed to
    expect(isWalking(actor)).toBe(false);
  });
});

describe('walkActorTo', () => {
  it('leaves the actor untouched when no path exists', () => {
    const g = buildSceneGraph(board(3, 1, { '1,0': BLOCKING_STEM }));
    const a = createSceneActor('p', '0,0', 's');
    expect(walkActorTo(a, g, '2,0')).toBe(a);
  });
});

describe('tickSceneActors', () => {
  it('never lets two actors end a tick in the same cell', () => {
    // Two actors walking head-on down a 1-wide corridor.
    const g = buildSceneGraph(board(5, 1));
    let actors = [
      setActorPath(createSceneActor('a', '0,0', 'e'), ['0,0', '1,0', '2,0', '3,0', '4,0']),
      setActorPath(createSceneActor('b', '4,0', 'w'), ['4,0', '3,0', '2,0', '1,0', '0,0']),
    ];
    for (let i = 0; i < 200; i++) {
      actors = tickSceneActors(actors, 50, g).actors;
      const cells = actors.map(a => a.cell);
      expect(new Set(cells).size).toBe(cells.length);
    }
  });

  it('resolves a contested cell in favour of the earlier actor, stably', () => {
    const g = buildSceneGraph(board(3, 3));
    const make = () => [
      setActorPath(createSceneActor('first', '0,1', 'e'), ['0,1', '1,1']),
      setActorPath(createSceneActor('second', '2,1', 'w'), ['2,1', '1,1']),
    ];
    const run = () => {
      let actors = make();
      for (let i = 0; i < 5; i++) actors = tickSceneActors(actors, 50, g).actors;
      return actors.map(a => a.cell);
    };
    expect(run()).toEqual(['1,1', '2,1']);
    expect(run()).toEqual(run()); // stable, not randomized
  });

  it('reports each arrival with its own actor id', () => {
    const g = buildSceneGraph(board(4, 1));
    let actors = [
      setActorPath(createSceneActor('a', '0,0', 'e'), ['0,0', '1,0']),
      setActorPath(createSceneActor('b', '3,0', 'w'), ['3,0', '2,0']),
    ];
    const seen: string[] = [];
    for (let i = 0; i < 100; i++) {
      const r = tickSceneActors(actors, 50, g);
      actors = r.actors;
      for (const e of r.events) if (e.event.kind === 'arrived') seen.push(`${e.id}@${e.event.cell}`);
    }
    expect(seen.sort()).toEqual(['a@1,0', 'b@2,0']);
  });
});
