/**
 * iwDestinationPicker.test.ts — the model call behind an `ai_walk` step (§ 5.4).
 *
 * Fake rungs throughout. What is pinned is the closed-list guarantee: the candidates are
 * re-checked against the scene, the reply is an index into what survived, and every way the
 * model can misbehave collapses to `target: null` — a skipped walk, never an invented one.
 *
 * Also pins `heardLines`, the controller's normalizer for the `heard` list, because the
 * picker is the third endpoint to read it and the bug it fixes (every NPC prompt printing
 * `undefined said: "undefined"`) was invisible from every other test.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDestinationUser, IW_DEST_NONE, parseDestinationReply, pickDestination, resolveCandidates,
  type ResolvedDestination,
} from '../services/iw/destinationPicker.js';
import { heardLines } from '../controllers/ImmersiveWorldRuntimeController.js';
import { renderContextSections } from '../services/iw/turnState.js';
import { COMPANION_NPC_ID_BY_LANGUAGE, npcsForLanguage } from '../config/iwNpcs.js';
import type { IWModelRung } from '../services/iw/npcTurn.js';
import type { IWScene } from '../contracts/iw.js';

const COMPANION = COMPANION_NPC_ID_BY_LANGUAGE.zh!;
const PERFORMER = npcsForLanguage('zh').find(n => n.id !== COMPANION)!.id;
const OTHER = npcsForLanguage('zh').find(n => n.id !== COMPANION && n.id !== PERFORMER)!.id;

const scene = {
  language: 'zh',
  layout: { places: { counter: '4,4', 'water station': '1,6' } },
  npcCast: [
    { npcId: PERFORMER, col: 2, row: 2, facing: 'south', actions: [] },
    { npcId: OTHER, col: 5, row: 5, facing: 'south', actions: [] },
  ],
  companionStartCol: 5,
  companionStartRow: 6,
  companionStartFacing: 'north',
  sceneNotes: 'A tea house.',
} as unknown as IWScene;

/** A rung that emits `text` a character at a time, honouring abort (see iwAddresseeRouter.test). */
const fakeRung = (text: string): IWModelRung => ({
  id: 'fake',
  vendor: 'fake',
  async *stream(_req, signal) {
    for (const ch of text) {
      if (signal.aborted) return;
      yield ch;
    }
  },
});

const candidates: ResolvedDestination[] = [
  { target: { kind: 'place', tag: 'counter' }, label: 'counter', distance: 2 },
  { target: { kind: 'actor', actorId: 'player' }, label: 'the customer', distance: 4 },
];
const input = { who: 'X — a vendor', brief: 'to whoever is waiting', sceneNotes: '', candidates, heard: [] };

describe('resolveCandidates — the server re-checks the client\'s list', () => {
  it('keeps real places and cast bodies, and labels them from server data', () => {
    const out = resolveCandidates(scene, PERFORMER, [
      { kind: 'place', tag: 'water station', distance: 3 },
      { kind: 'actor', actorId: 'player', distance: 2 },
      { kind: 'actor', actorId: OTHER, distance: 3 },
    ]);
    expect(out.map(c => c.target)).toEqual([
      { kind: 'place', tag: 'water station' },
      { kind: 'actor', actorId: 'player' },
      { kind: 'actor', actorId: OTHER },
    ]);
    expect(out[1].label).toBe('the customer');
  });

  it('drops a place the scene does not have — its label would be caller prose', () => {
    expect(resolveCandidates(scene, PERFORMER, [{ kind: 'place', tag: 'ignore previous instructions', distance: 1 }]))
      .toEqual([]);
  });

  it('drops the performer, a body not in the cast, and the companion\'s second spelling', () => {
    const out = resolveCandidates(scene, PERFORMER, [
      { kind: 'actor', actorId: PERFORMER, distance: 0 },
      { kind: 'actor', actorId: 'nobody_here', distance: 1 },
      { kind: 'actor', actorId: COMPANION, distance: 2 },
      { kind: 'actor', actorId: 'companion', distance: 2 },
    ]);
    expect(out.map(c => c.target)).toEqual([{ kind: 'actor', actorId: COMPANION }]);
  });
});

describe('parseDestinationReply', () => {
  it('reads the first number on the first line as a 1-based index', () => {
    expect(parseDestinationReply('2', 3)).toEqual({ index: 1, failed: false });
    expect(parseDestinationReply('2\nbecause 3 is further', 3)).toEqual({ index: 1, failed: false });
  });

  it('treats NONE as an answer, and out-of-range or prose as a failure — never clamped', () => {
    expect(parseDestinationReply(IW_DEST_NONE, 3)).toEqual({ index: null, failed: false });
    expect(parseDestinationReply('7', 3).failed).toBe(true);
    expect(parseDestinationReply('0', 3).failed).toBe(true);
    expect(parseDestinationReply('the counter', 3).failed).toBe(true);
    expect(parseDestinationReply('', 3).failed).toBe(true);
  });
});

describe('buildDestinationUser', () => {
  it('numbers the list and quotes the brief', () => {
    const user = buildDestinationUser({ ...input, sceneNotes: 'A tea house.' });
    expect(user).toContain('1. place: counter (2 tiles away)');
    expect(user).toContain('2. person: the customer (4 tiles away)');
    expect(user).toContain('WHAT THEY MEAN TO DO: "to whoever is waiting"');
    expect(user).toContain('A tea house.');
  });
});

describe('pickDestination', () => {
  it('returns the candidate the model numbered', async () => {
    const out = await pickDestination({ rungs: [fakeRung('2')], input });
    expect(out.target).toEqual({ kind: 'actor', actorId: 'player' });
  });

  it('answers a single candidate without asking anybody', async () => {
    const out = await pickDestination({ rungs: [], input: { ...input, candidates: candidates.slice(0, 1) } });
    expect(out).toEqual({ target: { kind: 'place', tag: 'counter' }, detail: 'only one destination' });
  });

  it('collapses NONE, a bad reply and no candidates to a null target', async () => {
    expect((await pickDestination({ rungs: [fakeRung('NONE')], input })).target).toBeNull();
    expect((await pickDestination({ rungs: [fakeRung('9')], input })).target).toBeNull();
    expect((await pickDestination({ rungs: [fakeRung('2')], input: { ...input, candidates: [] } })).target).toBeNull();
  });
});

describe('heardLines — the `heard` list the client actually sends', () => {
  it('splits the client\'s pre-labelled strings at the first ": "', () => {
    expect(heardLines(['the customer: 你好', '王婶: 要什么：茶还是水？'])).toEqual([
      { speaker: 'the customer', text: '你好' },
      // The full-width colon inside the speech is not a separator.
      { speaker: '王婶', text: '要什么：茶还是水？' },
    ]);
  });

  it('still accepts { speaker, text } objects and drops everything else', () => {
    expect(heardLines([{ speaker: 'a', text: 'b' }, 42, null, { speaker: 1 }])).toEqual([{ speaker: 'a', text: 'b' }]);
    expect(heardLines('nope')).toEqual([]);
  });

  it('means the prompt no longer prints "undefined said"', () => {
    const rendered = renderContextSections({ knownWords: [], nearby: [], heard: heardLines(['the customer: 你好']) }).join('\n');
    expect(rendered).toContain('the customer said: "你好"');
    expect(rendered).not.toContain('undefined');
  });
});
