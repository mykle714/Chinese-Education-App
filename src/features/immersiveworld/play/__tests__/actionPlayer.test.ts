/**
 * actionPlayer.test.ts — resolving one authored step against the world as it stands.
 *
 * The cases are grouped by the two promises the module makes: that a step is resolved LATE
 * (against current positions, not compile-time ones), and that an unresolvable step SKIPS
 * with a reason rather than throwing in front of a learner.
 */

import { describe, it, expect } from 'vitest';
import { buildSceneGraph } from '../../../../engine/iw/sceneGraph';
import { actionById, resolveActionStep, type ActionWorld } from '../actionPlayer';
import type { IWActionStep, IWSceneCastMember } from '../../../../../server/contracts/iw';

/** An 8×8 open floor with a counter (an unwalkable cell) at 4,4 tagged "counter". */
const graph = buildSceneGraph({
  width: 8,
  height: 8,
  unwalkable: ['4,4'],
  forcedDirection: {},
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
  it('passes an authored comment through as the DIRECTION to render (§ 14 Q42)', () => {
    // `say.text` is the author's intention, not a line. `iwScript` renders it through the
    // model before anything is spoken; this module never sees the Chinese.
    expect(resolveActionStep({ kind: 'comment', text: '  greet them  ' }, world()))
      .toEqual({ kind: 'say', text: 'greet them' });
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

/**
 * A walk toward something ends looking at it (2026-09-07).
 *
 * The report: an interaction walked 王婶 over to the learner and she delivered her line to the
 * wall behind them. Both actor- and place-aimed walks stop BESIDE their target, so without a
 * facing the performer arrives with their back to what they crossed the room for — and the
 * learner's own tap already had this right (`approachAndFace`), which is what made the NPC
 * version read as a bug rather than as a limitation.
 */
describe('REGRESSION: a walk toward something ends looking at it (2026-09-07)', () => {
  it('walk_to_actor stops beside the target and faces the target itself', () => {
    const step: IWActionStep = { kind: 'walk_to_actor', actor: 'player' };
    const instruction = resolveActionStep(step, world());
    expect(instruction.kind).toBe('walkTo');
    if (instruction.kind !== 'walkTo') return;
    // Beside, never on: you do not walk into somebody.
    expect(instruction.cell).not.toBe('6,6');
    expect(instruction.facing).toBe('6,6');
  });

  it('faces an unreachable person instead of skipping the step entirely', () => {
    // Boxed in — nowhere beside them is walkable. A shopkeeper who cannot get around the
    // counter should still turn to the learner, not stand facing a wall while their line
    // comes out of nowhere.
    const cells = new Map([['player', '4,4']]);
    const boxed = world({ cells, occupied: new Set(['3,4', '5,4', '4,3', '4,5']) });
    expect(resolveActionStep({ kind: 'walk_to_actor', actor: 'player' }, boxed))
      .toEqual({ kind: 'face', cell: '4,4' });
  });

  it('walk_away_from does NOT face its target — that would undo the beat', () => {
    const instruction = resolveActionStep({ kind: 'walk_away_from', actor: 'player' }, world());
    expect(instruction.kind).toBe('walkTo');
    if (instruction.kind !== 'walkTo') return;
    expect(instruction.facing).toBeUndefined();
  });

  it('walk_to_tag faces the PLACE, which is the unwalkable cell it stopped beside', () => {
    const instruction = resolveActionStep({ kind: 'walk_to_tag', tag: 'counter' }, world());
    expect(instruction.kind).toBe('walkTo');
    if (instruction.kind !== 'walkTo') return;
    expect(instruction.cell).not.toBe('4,4');
    expect(instruction.facing).toBe('4,4');
  });
});

/**
 * `prompt_npc` — the only step resolved into an instruction about SOMEBODY ELSE (2026-09-19).
 *
 * The asymmetry pinned here is that a missing speaker and a missing addressee are NOT the
 * same failure. Without a speaker there is no degraded beat to play; without an addressee
 * there is — the line loses its aim and the model picks, which is the step's own documented
 * no-target behaviour rather than a guess.
 */
describe('prompt_npc resolves to a cue for another body', () => {
  const room = world({ cells: new Map([['player', '6,6'], ['kitchen_hand', '2,2']]) });

  it('carries the speaker, the addressee and the brief through untouched', () => {
    const step: IWActionStep = {
      kind: 'prompt_npc', npcId: 'kitchen_hand', target: 'player', instruction: 'the noodles are coming',
    };
    expect(resolveActionStep(step, room)).toEqual({
      kind: 'promptNpc', npcId: 'kitchen_hand', toward: 'player', instruction: 'the noodles are coming',
    });
  });

  it('normalises a blank brief to undefined, so "no brief" is ONE thing downstream', () => {
    const step: IWActionStep = { kind: 'prompt_npc', npcId: 'kitchen_hand', instruction: '   ' };
    expect(resolveActionStep(step, room)).toEqual({
      kind: 'promptNpc', npcId: 'kitchen_hand', toward: undefined, instruction: undefined,
    });
  });

  it('SKIPS when the speaker is not here — there is nobody to say it', () => {
    const step: IWActionStep = { kind: 'prompt_npc', npcId: 'lao_zhou' };
    expect(resolveActionStep(step, room)).toEqual({
      kind: 'skip', reason: '"lao_zhou" is not in this scene',
    });
  });

  it('DROPS an addressee who is not here, and still cues the line', () => {
    const step: IWActionStep = { kind: 'prompt_npc', npcId: 'kitchen_hand', target: 'lao_zhou' };
    const instruction = resolveActionStep(step, room);
    expect(instruction.kind).toBe('promptNpc');
    expect((instruction as { toward?: string }).toward).toBeUndefined();
  });
});
