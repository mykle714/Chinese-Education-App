/**
 * iwTurnOffers.test.ts — what one NPC is offered on one turn (§ 5.4b).
 *
 * This is the RUNTIME half of the selectability system whose authoring half shipped on
 * 2026-09-06, so several tests here are the mirror image of a rule in
 * `iwSceneValidation.test.ts`: the validator says an author may not express X, and these say
 * the runtime does Y when a scene expresses it anyway (scenes save with warnings, so "anyway"
 * is a real state).
 */

import { describe, it, expect } from 'vitest';
import {
  buildTurnOffers,
  isUnlocked,
  offeredActions,
  offeredConversations,
  renderOffers,
} from '../services/iw/turnOffers.js';
import { IW_NO_ACTION, type IWConversation, type IWNpcAction, type IWSceneCastMember } from '../contracts/iw.js';

const action = (over: Partial<IWNpcAction> = {}): IWNpcAction => ({
  id: 'a1', name: 'bring water', steps: [], ...over,
});

const member = (actions: IWNpcAction[], npcId = 'wang_shen'): IWSceneCastMember => ({
  npcId, col: 0, row: 0, facing: 's', actions,
});

const conversation = (over: Partial<IWConversation> = {}): IWConversation => ({
  id: 'c1',
  turns: [{ npcId: 'wang_shen', text: 'hi' }, { npcId: 'he_laoshi', text: 'hello' }],
  ...over,
});

const NO_CUES = new Set<string>();

describe('isUnlocked — ANY, not ALL', () => {
  it('is always available with no gate', () => {
    expect(isUnlocked({}, NO_CUES)).toBe(true);
    expect(isUnlocked({ unlockedBy: [] }, NO_CUES)).toBe(true);
  });

  it('opens on ANY one of several cues', () => {
    const gate = { unlockedBy: ['glass_breaks', 'kitchen_calls'] };
    expect(isUnlocked(gate, new Set(['kitchen_calls']))).toBe(true);
    expect(isUnlocked(gate, new Set(['glass_breaks']))).toBe(true);
    expect(isUnlocked(gate, new Set(['something_else']))).toBe(false);
  });

  it('does NOT require all of them', () => {
    // An ALL gate is expressible only by authoring the conjunction as its own event.
    expect(isUnlocked({ unlockedBy: ['a', 'b'] }, new Set(['a']))).toBe(true);
  });
});

describe('offeredActions', () => {
  it('offers an ordinary action', () => {
    const r = offeredActions(member([action()]), NO_CUES);
    expect(r.offered.map(a => a.name)).toEqual(['bring water']);
    expect(r.suppressed).toEqual([]);
  });

  it('never offers an interaction-only action', () => {
    // This is the structural replacement for PPE's `when: "Do not pick, triggered by
    // interaction"` — an instruction written into the field that makes an action MORE
    // choosable.
    const r = offeredActions(member([action({ interactionOnly: true })]), NO_CUES);
    expect(r.offered).toEqual([]);
    expect(r.suppressed).toEqual([{ name: 'bring water', reason: 'interaction-only' }]);
  });

  it('withholds a locked action until its cue fires', () => {
    const m = member([action({ unlockedBy: ['glass_breaks'] })]);
    expect(offeredActions(m, NO_CUES).offered).toEqual([]);
    expect(offeredActions(m, new Set(['glass_breaks'])).offered.length).toBe(1);
  });

  it('distinguishes "never offered" from "not yet unlocked"', () => {
    // Conflating them is how an author concludes their cue is broken when they ticked the
    // wrong box. The validator refuses both at once, but a scene can save with warnings.
    const r = offeredActions(member([action({ interactionOnly: true, unlockedBy: ['x'] })]), NO_CUES);
    expect(r.suppressed[0].reason).toBe('interaction-only');
  });

  it('names the missing cues so "why didn\'t he do X?" is answerable', () => {
    const r = offeredActions(member([action({ unlockedBy: ['glass_breaks', 'kitchen_calls'] })]), NO_CUES);
    expect(r.suppressed[0].reason).toBe('locked: needs one of glass_breaks, kitchen_calls');
  });

  it('handles a cast member with no actions at all', () => {
    expect(offeredActions(member([]), NO_CUES).offered).toEqual([]);
    expect(offeredActions({ npcId: 'x', col: 0, row: 0, facing: 's' }, NO_CUES).offered).toEqual([]);
  });
});

describe('offeredConversations', () => {
  it('offers a selectable conversation to its FIRST speaker', () => {
    const c = conversation({ selectable: true, title: 'Remark on the weather' });
    expect(offeredConversations([c], 'wang_shen', NO_CUES).offered.map(x => x.id)).toEqual(['c1']);
  });

  it('does not offer it to anyone else in the conversation', () => {
    // Ownership is derived from turns[0], not authored — a separate ownerNpcId could name
    // somebody who never speaks.
    const c = conversation({ selectable: true, title: 'Remark on the weather' });
    const r = offeredConversations([c], 'he_laoshi', NO_CUES);
    expect(r.offered).toEqual([]);
    expect(r.suppressed).toEqual([]); // not theirs to start — not a suppression
  });

  it('does not offer a non-selectable conversation', () => {
    const r = offeredConversations([conversation()], 'wang_shen', NO_CUES);
    expect(r.offered).toEqual([]);
    expect(r.suppressed).toEqual([{ name: 'c1', reason: 'not choosable' }]);
  });

  it('gates a selectable conversation on its cues', () => {
    const c = conversation({ selectable: true, title: 'About the rain', unlockedBy: ['rain'] });
    expect(offeredConversations([c], 'wang_shen', NO_CUES).offered).toEqual([]);
    expect(offeredConversations([c], 'wang_shen', new Set(['rain'])).offered.length).toBe(1);
  });

  it('falls back to the id when a selectable conversation has no title', () => {
    // The validator requires a title; a scene saved with warnings may lack one, and emitting
    // `undefined` into a prompt is worse than an ugly handle.
    const c = conversation({ selectable: true });
    expect(offeredConversations([c], 'wang_shen', NO_CUES).offered.length).toBe(1);
    expect(buildTurnOffers({ conversations: [c] }, member([])).names).toEqual(['c1']);
  });

  it('ignores a conversation with no turns', () => {
    const c = conversation({ selectable: true, title: 't', turns: [] });
    expect(offeredConversations([c], 'wang_shen', NO_CUES).offered).toEqual([]);
  });
});

describe('buildTurnOffers', () => {
  it('merges actions and conversations into one list the model picks by name', () => {
    const r = buildTurnOffers(
      { conversations: [conversation({ selectable: true, title: 'Remark on the weather' })] },
      member([action(), action({ id: 'a2', name: 'take the order' })]),
    );
    expect(r.names).toEqual(['bring water', 'take the order', 'Remark on the weather']);
    expect(r.offers.map(o => o.kind)).toEqual(['action', 'action', 'conversation']);
  });

  it('resolves a name collision in the action\'s favour, deterministically', () => {
    const scene = { conversations: [conversation({ selectable: true, title: 'bring water' })] };
    const r = buildTurnOffers(scene, member([action()]));
    expect(r.names).toEqual(['bring water']);
    expect(r.offers[0].kind).toBe('action');
    expect(r.suppressed).toContainEqual({ name: 'bring water', reason: 'name collides with an action' });
    // Same answer every time — no coin flip in front of a player.
    expect(buildTurnOffers(scene, member([action()]))).toEqual(r);
  });

  it('never puts IW_NO_ACTION among the offers', () => {
    // It is always legal and the prompt states it separately; listing it would let the parser
    // "match" it as though an author had written it.
    const r = buildTurnOffers({ conversations: [] }, member([action()]));
    expect(r.names).not.toContain(IW_NO_ACTION);
  });

  it('returns an empty list rather than throwing for an empty scene', () => {
    const r = buildTurnOffers({ conversations: undefined as never }, member([]));
    expect(r).toEqual({ offers: [], names: [], suppressed: [] });
  });

  it('carries when and urgent through to the offer', () => {
    const r = buildTurnOffers(
      { conversations: [] },
      member([action({ when: 'after they sit down', urgent: true })]),
    );
    expect(r.offers[0]).toEqual({
      name: 'bring water', kind: 'action', id: 'a1', when: 'after they sit down', urgent: true,
    });
  });
});

describe('renderOffers', () => {
  it('renders a name, its guidance and its urgency on one line each', () => {
    const text = renderOffers([
      { name: 'bring water', kind: 'action', id: 'a1', when: 'after they sit down' },
      { name: 'take the order', kind: 'action', id: 'a2', urgent: true },
      { name: 'Remark on the weather', kind: 'conversation', id: 'c1' },
    ]);
    expect(text).toBe(
      '- bring water — after they sit down\n'
      + '- take the order (you have been meaning to do this)\n'
      + '- Remark on the weather',
    );
  });

  it('does not sort urgent offers to the top', () => {
    // urgent is prose, not an ordering — a second silent channel saying the same thing would
    // teach the model that list order is meaningful everywhere.
    const text = renderOffers([
      { name: 'first', kind: 'action', id: 'a' },
      { name: 'second', kind: 'action', id: 'b', urgent: true },
    ]);
    expect(text.indexOf('first')).toBeLessThan(text.indexOf('second'));
  });

  it('says so when there is nothing to offer', () => {
    expect(renderOffers([])).toContain(IW_NO_ACTION);
  });
});
