/**
 * iwPromptLayers.test.ts — layers 1 and 3 of the NPC prompt (§ 5.5).
 *
 * Most of these guard against a REGRESSION THAT HAS ALREADY HAPPENED ONCE. Layer 1 acquired
 * one character's register and a stale vocabulary rule while nobody was looking, and both
 * were invisible until a multi-NPC sweep in 2026-09. The tests below fail if either creeps
 * back, which a doc paragraph cannot do.
 *
 * The other theme is § 11: the learner's text is untrusted and belongs in the user message,
 * quoted. A test asserting where a string is NOT looks strange until you remember that
 * "moved into the system block to save tokens" is a plausible future edit.
 */

import { describe, it, expect } from 'vitest';
import {
  IW_WORLD_RULES_STEM,
  renderReplyContract,
  renderWorldRules,
} from '../services/iw/worldRules.js';
import { renderTurnState, type TurnStateInput } from '../services/iw/turnState.js';
import { IW_EMOTES, IW_NO_ACTION } from '../contracts/iw.js';

describe('layer 1 — the frozen world rules', () => {
  it('contains no register belonging to any one character', () => {
    // It once ended "you are a street vendor, warm and brisk, not a poet" — written when 王婶
    // was the only NPC, and flatly contradicting 老周, who is retired and sells nothing.
    for (const leak of ['vendor', 'stall', 'noodle', 'poet', 'brisk', '王婶']) {
      expect(IW_WORLD_RULES_STEM.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it('defers to layer 2 for register rather than setting one', () => {
    expect(IW_WORLD_RULES_STEM).toContain('Your register is described below');
  });

  it('states the vocabulary rule as GUIDANCE, not a hard budget', () => {
    // "AT MOST ONE word outside that list. Never two." was withdrawn in § 9.4; it produced
    // stilted speech and the measured failure mode was never the count.
    expect(IW_WORLD_RULES_STEM).toContain('guidance, not a rule to count against');
    expect(IW_WORLD_RULES_STEM).not.toMatch(/AT MOST ONE word/i);
    expect(IW_WORLD_RULES_STEM).not.toMatch(/never two/i);
  });

  it('forbids meta language about the fiction', () => {
    expect(IW_WORLD_RULES_STEM).toContain('never mention being an AI');
    expect(IW_WORLD_RULES_STEM).toContain('a game, a scene or an exercise');
  });

  it('states the earshot rule that makes an NPC a person', () => {
    expect(IW_WORLD_RULES_STEM).toContain('You only know what you have heard');
  });

  it('is frozen — nothing dynamic can reach it', () => {
    // The stem takes no arguments at all, so this is structural rather than a text check:
    // the only seam is the contract placeholder.
    expect(IW_WORLD_RULES_STEM).toContain('__CONTRACT__');
    expect(IW_WORLD_RULES_STEM.match(/__[A-Z]+__/g)).toEqual(['__CONTRACT__']);
  });
});

describe('renderReplyContract', () => {
  it('always offers none, even when the NPC has nothing authored', () => {
    // An NPC must be able to decline to act.
    expect(renderReplyContract([])).toContain(IW_NO_ACTION);
  });

  it('lists the offered names verbatim, none first', () => {
    expect(renderReplyContract(['bring water', 'take the order']))
      .toContain(`${IW_NO_ACTION} | bring water | take the order`);
  });

  it('does not list none twice when a caller passes it in', () => {
    const contract = renderReplyContract([IW_NO_ACTION, 'bring water']);
    expect(contract.match(new RegExp(IW_NO_ACTION, 'g'))!.length).toBe(2); // the line label + the list
    expect(contract).toContain(`${IW_NO_ACTION} | bring water`);
  });

  it('lists exactly the six emotes, single-sourced with the contract', () => {
    expect(renderReplyContract([])).toContain(IW_EMOTES.join(' | '));
  });

  it('asks for the speech as the very first token', () => {
    // § 6.1: any envelope the model opens first is dead air the player sits through.
    expect(renderReplyContract([])).toContain('Start line 1 immediately');
    expect(renderReplyContract([])).toContain('No preamble, no labels, no quotes');
  });
});

describe('renderWorldRules', () => {
  it('splices the contract into the stem, leaving no placeholder', () => {
    const text = renderWorldRules(['bring water']);
    expect(text).not.toContain('__CONTRACT__');
    expect(text).toContain('bring water');
    expect(text).toContain('You are NOT an assistant');
  });
});

const baseTurn = (over: Partial<TurnStateInput> = {}): TurnStateInput => ({
  knownWords: ['面', '碗', '要'],
  nearby: [{ label: 'the customer', distance: 2, facingYou: true }],
  heard: [{ speaker: 'the customer', text: '你好' }],
  event: { kind: 'utterance', speaker: 'the customer', text: '我要一碗面', addressed: true },
  ...over,
});

describe('layer 3 — the volatile turn', () => {
  it('quotes the learner text rather than merging it into surrounding prose', () => {
    // § 11: the quotes are what mark where the untrusted span begins and ends.
    expect(renderTurnState(baseTurn())).toContain('said to you: "我要一碗面"');
  });

  it('distinguishes being addressed from overhearing', () => {
    const overheard = renderTurnState(baseTurn({
      event: { kind: 'utterance', speaker: '老周', text: '天气不错', addressed: false },
    }));
    expect(overheard).toContain('you overheard 老周 say, not to you');
    // § 4.1's failure mode is over-eagerness; a bystander is told plainly it was not for them.
    expect(overheard).not.toContain('said to you');
  });

  it('offers silence at the point of answering', () => {
    // NOTHING is only a real option if it is stated at the end, not 300 tokens earlier.
    expect(renderTurnState(baseTurn())).toContain('say NOTHING');
  });

  /**
   * `muffled` went with § 4's occlusion model (2026-09-07). It had never been SET by anything
   * — the client's `contextFor` has only ever built `{label, distance, facingYou}` — so this
   * test was the field's only caller, which is why the removal is a deletion rather than a
   * migration. `facingYou` is the one perception note left.
   */
  it('renders distance as a number, and the facing note', () => {
    const text = renderTurnState(baseTurn({
      nearby: [
        { label: 'the customer', distance: 2, facingYou: true },
        { label: '老周', distance: 7 },
      ],
    }));
    expect(text).toContain('- the customer at 2 tiles, facing you');
    expect(text).toContain('- 老周 at 7 tiles');
  });

  it('says "nothing yet" for an empty history, but omits holding entirely', () => {
    const text = renderTurnState(baseTurn({ heard: [], holding: [] }));
    expect(text).toContain('WHAT YOU HAVE HEARD, oldest first:\n- nothing yet');
    expect(text).not.toContain('YOU ARE HOLDING');
  });

  it('renders holding when there is something to hold', () => {
    expect(renderTurnState(baseTurn({ holding: ['a bowl of noodles'] })))
      .toContain('YOU ARE HOLDING:\n- a bowl of noodles');
  });

  it('renders ONLY the annotated offers, not the whole list again', () => {
    // The bare names are already in the reply contract; printing them twice wastes tokens and
    // invites the model to read the two lists as different things.
    const text = renderTurnState(baseTurn({
      offers: [
        { name: 'plain', kind: 'action', id: 'a1' },
        { name: 'bring water', kind: 'action', id: 'a2', when: 'after they sit down' },
        { name: 'close up', kind: 'action', id: 'a3', urgent: true },
      ],
    }));
    expect(text).toContain('- bring water: after they sit down');
    expect(text).toContain('- close up: (you have been meaning to do this)');
    expect(text).not.toContain('plain');
  });

  it('omits the offer block entirely when nothing is annotated', () => {
    const text = renderTurnState(baseTurn({ offers: [{ name: 'plain', kind: 'action', id: 'a' }] }));
    expect(text).not.toContain('ABOUT THE THINGS YOU CAN DO');
  });

  it('states turn-taking pressure as a fact, not an instruction', () => {
    const text = renderTurnState(baseTurn({ spokeLastTurn: true }));
    expect(text).toContain('You spoke on the last beat.');
    expect(text).not.toMatch(/do not speak|you must|stay quiet/i);
  });

  /**
   * ⚠️ The volume is COLOUR, not a gate (§ 4c). Whether this NPC hears the line at all was
   * settled before the turn was requested — an NPC out of range is never asked — so what
   * reaches layer 3 is only the register the answer should match.
   */
  it('says how loudly the line was said, when the learner chose', () => {
    const said = (volume: 'whisper' | 'talk' | 'shout') => renderTurnState(baseTurn({
      event: { kind: 'utterance', speaker: 'the customer', text: '买单', addressed: true, volume },
    }));
    expect(said('whisper')).toContain('whispered to you');
    expect(said('shout')).toContain('shouted to you');
    expect(said('talk')).toContain('said to you');
  });

  it('reads exactly as before when no volume is sent', () => {
    const text = renderTurnState(baseTurn({
      event: { kind: 'utterance', speaker: 'the customer', text: '买单', addressed: true },
    }));
    expect(text).toContain('said to you');
    expect(text).not.toMatch(/whispered|shouted/);
  });

  it('carries the volume through the overheard phrasing too', () => {
    const text = renderTurnState(baseTurn({
      event: { kind: 'utterance', speaker: 'the customer', text: '买单', addressed: false, volume: 'shout' },
    }));
    expect(text).toContain('you overheard the customer shouted, not to you');
  });

  it('handles an approach with no speech', () => {
    expect(renderTurnState(baseTurn({ event: { kind: 'approach', who: 'the customer' } })))
      .toContain('walked up to you and said nothing');
  });

  it('handles a world event', () => {
    expect(renderTurnState(baseTurn({ event: { kind: 'world', description: 'a glass breaks behind you' } })))
      .toContain('JUST NOW: a glass breaks behind you');
  });

  it('survives a learner with no known words yet', () => {
    expect(renderTurnState(baseTurn({ knownWords: [] }))).toContain('KNOWN_WORDS: (none yet)');
  });

  it('survives an empty room', () => {
    expect(renderTurnState(baseTurn({ nearby: [] }))).toContain('- nobody');
  });
});
