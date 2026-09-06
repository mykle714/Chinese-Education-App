/**
 * actionPlayer.test.ts — resolving one authored step against the world as it stands.
 *
 * The cases are grouped by the two promises the module makes: that a step is resolved LATE
 * (against current positions, not compile-time ones), and that an unresolvable step SKIPS
 * with a reason rather than throwing in front of a learner.
 */

import { describe, it, expect } from 'vitest';
import { buildSceneGraph } from '../../../../engine/iw/sceneGraph';
import { freeFarmTileset } from '../../../../engine/market/freeFarmTileset';
import { isBlockingDecorUrl } from '../../../../engine/market/farmTerrain';
import { actionById, resolveActionStep, type ActionWorld } from '../actionPlayer';
import type { IWActionStep, IWSceneCastMember } from '../../../../../server/contracts/iw';

/**
 * A stem the tileset resolves to a BLOCKING url — discovered rather than hardcoded, so this
 * file is not coupled to the asset pack's current filenames (the same trick sceneGraph's own
 * suite uses).
 */
const BLOCKING_STEM = (() => {
  const url = freeFarmTileset.getDecorUrls('common')[0];
  const stem = freeFarmTileset.stemOf(url);
  if (!stem || !isBlockingDecorUrl(url)) throw new Error('no blocking decor stem available');
  return stem;
})();

/** An 8×8 open floor with a counter (blocking) at 4,4 tagged "counter". */
const graph = buildSceneGraph({
  width: 8,
  height: 8,
  decor: { '4,4': BLOCKING_STEM },
  places: { counter: '4,4', doorway: '0,0' },
});

const world = (over: Partial<ActionWorld> = {}): ActionWorld => ({
  graph,
  selfCell: '1,1',
  cells: new Map([['player', '6,6'], ['companion', '6,5']]),
  conversations: [{ id: 'c1', turns: [] }],
  eventIds: ['e1'],
  ...over,
});

describe('resolveActionStep — the steps that just are what they say', () => {
  it('says an authored comment verbatim', () => {
    expect(resolveActionStep({ kind: 'comment', text: '  你好  ' }, world()))
      .toEqual({ kind: 'say', text: '你好' });
  });

  it('skips a comment with no text', () => {
    expect(resolveActionStep({ kind: 'comment', text: '   ' }, world()).kind).toBe('skip');
  });

  it('converts a wait to milliseconds', () => {
    expect(resolveActionStep({ kind: 'wait', seconds: 3 }, world())).toEqual({ kind: 'wait', ms: 3000 });
  });

  it('treats a negative or missing wait as no wait at all', () => {
    // Authored data out of a jsonb column: a negative delay must not become a negative timeout.
    expect(resolveActionStep({ kind: 'wait', seconds: -5 }, world())).toEqual({ kind: 'wait', ms: 0 });
  });

  it('hands the floor back on wait_for_response', () => {
    expect(resolveActionStep({ kind: 'wait_for_response' }, world())).toEqual({ kind: 'awaitLearner' });
  });
});

describe('resolveActionStep — places', () => {
  it('stands BESIDE an unwalkable place', () => {
    // The common case: a tag names a THING (a counter), and a thing is blocking decor.
    const out = resolveActionStep({ kind: 'walk_to_tag', tag: 'counter' }, world());
    expect(out.kind).toBe('walkTo');
    if (out.kind !== 'walkTo') return;
    expect(out.cell).not.toBe('4,4');
    expect(graph.walkable.has(out.cell)).toBe(true);
  });

  it('stands ON a walkable place', () => {
    expect(resolveActionStep({ kind: 'walk_to_tag', tag: 'doorway' }, world()))
      .toMatchObject({ kind: 'walkTo', cell: '0,0' });
  });

  it('skips a tag nobody named', () => {
    // A renamed place is an authoring fault; the scene keeps playing and the reason is
    // printable in a debug overlay.
    expect(resolveActionStep({ kind: 'walk_to_tag', tag: 'nowhere' }, world()))
      .toEqual({ kind: 'skip', reason: 'cannot reach the place "nowhere"' });
  });
});

describe('resolveActionStep — people', () => {
  it('faces an actor without moving', () => {
    expect(resolveActionStep({ kind: 'face', actor: 'player' }, world()))
      .toEqual({ kind: 'face', cell: '6,6' });
  });

  it('walks BESIDE an actor, never onto them', () => {
    const out = resolveActionStep({ kind: 'walk_to_actor', actor: 'player' }, world());
    expect(out).toMatchObject({ kind: 'walkTo' });
    if (out.kind !== 'walkTo') return;
    expect(out.cell).not.toBe('6,6');
  });

  it('reads positions LATE — the same step resolves differently as people move', () => {
    // The property the whole module exists for: a script says "walk to the customer", and the
    // customer is somewhere else by the third step.
    const step: IWActionStep = { kind: 'face', actor: 'player' };
    expect(resolveActionStep(step, world())).toEqual({ kind: 'face', cell: '6,6' });
    expect(resolveActionStep(step, world({ cells: new Map([['player', '2,2']]) })))
      .toEqual({ kind: 'face', cell: '2,2' });
  });

  it('moves AWAY from an actor', () => {
    const out = resolveActionStep({ kind: 'walk_away_from', actor: 'player' }, world({ selfCell: '5,5' }));
    expect(out.kind).toBe('walkTo');
    if (out.kind !== 'walkTo') return;
    const [c, r] = out.cell.split(',').map(Number);
    expect(Math.max(Math.abs(c - 6), Math.abs(r - 6))).toBeGreaterThan(1);
  });

  it('skips an actor who is not in the scene', () => {
    expect(resolveActionStep({ kind: 'walk_to_actor', actor: 'ghost' }, world()))
      .toEqual({ kind: 'skip', reason: '"ghost" is not in this scene' });
  });
});

describe('resolveActionStep — references into the scene', () => {
  it('plays a conversation that exists', () => {
    expect(resolveActionStep({ kind: 'start_conversation', conversationId: 'c1' }, world()))
      .toEqual({ kind: 'conversation', conversationId: 'c1' });
  });

  it('skips a conversation that does not', () => {
    expect(resolveActionStep({ kind: 'start_conversation', conversationId: 'gone' }, world()).kind).toBe('skip');
  });

  it('arms an event with its delay in ms', () => {
    expect(resolveActionStep({ kind: 'schedule_event', eventId: 'e1', seconds: 20 }, world()))
      .toEqual({ kind: 'scheduleEvent', eventId: 'e1', ms: 20000 });
  });

  it('skips an event that does not exist', () => {
    expect(resolveActionStep({ kind: 'schedule_event', eventId: 'gone', seconds: 1 }, world()).kind).toBe('skip');
  });
});

describe('resolveActionStep — what phase 2 does not do', () => {
  it('skips ai_walk with a reason rather than inventing a destination', () => {
    expect(resolveActionStep({ kind: 'ai_walk', instruction: 'to whoever is waiting' }, world()))
      .toEqual({ kind: 'skip', reason: 'ai_walk is not resolved in phase 2' });
  });

  it('skips a step kind it has never heard of', () => {
    // A scene authored by a newer build. Guessing would perform something nobody wrote.
    expect(resolveActionStep({ kind: 'teleport' } as unknown as IWActionStep, world()).kind).toBe('skip');
  });
});

describe('actionById', () => {
  const member = { npcId: 'n', col: 0, row: 0, facing: 's', actions: [{ id: 'a1', name: 'bring water', steps: [] }] } as IWSceneCastMember;

  it('finds an authored action', () => {
    expect(actionById(member, 'a1')?.name).toBe('bring water');
  });

  it('returns null for an unknown id, and for an NPC with no actions', () => {
    expect(actionById(member, 'nope')).toBeNull();
    expect(actionById(undefined, 'a1')).toBeNull();
  });
});
