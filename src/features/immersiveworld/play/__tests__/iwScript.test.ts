/**
 * iwScript.test.ts — the loop that plays an authored script (§ 14 Q42).
 *
 * Two promises are pinned here. An authored direction is NEVER spoken as written — it is
 * rendered by the model first, and a render that fails skips the beat rather than leaking the
 * author's English onto the screen. And a render is started as early as it is *provably* safe
 * to, which is what replaces Q42's unsound "generate the whole action at once".
 */

import { describe, it, expect, vi } from 'vitest';
import { nextPrefetchableComment, runAuthoredAction, type IWScriptDeps } from '../iwScript';
import { buildSceneGraph } from '../../../../engine/iw/sceneGraph';
import type { IWActionStep } from '../../../../../server/contracts/iw';

const graph = buildSceneGraph({
  width: 8, height: 8, unwalkable: [], forcedDirection: {}, places: { counter: '4,4' },
});

/** A deps double that records the order everything happened in. */
function harness(over: Partial<IWScriptDeps> = {}) {
  const log: string[] = [];
  const deps: IWScriptDeps = {
    worldFor: () => ({ graph, selfCell: '1,1', cells: new Map([['player', '6,6']]), conversations: [], eventIds: [] }),
    walk: async (_who, cell) => { log.push(`walk:${cell}`); return 'arrived'; },
    face: (_who, cell) => { log.push(`face:${cell}`); },
    say: async (_who, text) => { log.push(`say:${text}`); },
    renderLine: async (_who, direction) => { log.push(`render:${direction}`); return `[${direction}]`; },
    playConversation: async id => { log.push(`conversation:${id}`); },
    armEvent: id => { log.push(`event:${id}`); },
    wait: async ms => { log.push(`wait:${ms}`); },
    note: (_who, reason) => { log.push(`note:${reason}`); },
    cancelled: () => false,
    ...over,
  };
  return { log, deps };
}

describe('an authored direction is never spoken as written', () => {
  it('renders the direction and speaks only what came back', async () => {
    const { log, deps } = harness();
    await runAuthoredAction('wangshen', [{ kind: 'comment', text: 'greet them' }], deps);
    expect(log).toEqual(['render:greet them', 'say:[greet them]']);
  });

  it('SKIPS the beat when the render fails — it must not fall back to the direction', async () => {
    // The whole point: the direction is English prose about the character. Speaking it is the
    // leak Q42 closed, so a failed render has to be silence.
    const { log, deps } = harness({ renderLine: async () => null });
    await runAuthoredAction('wangshen', [
      { kind: 'comment', text: 'greet them' },
      { kind: 'comment', text: 'ask what they want' },
    ], deps);
    expect(log.some(l => l.startsWith('say:'))).toBe(false);
    // And the rest of the script still plays — one lost beat is not a dead scene.
    expect(log).toEqual([]);
  });

  it('plays the remaining steps after a failed render', async () => {
    const { log, deps } = harness({ renderLine: async () => null });
    await runAuthoredAction('wangshen', [
      { kind: 'comment', text: 'greet them' },
      { kind: 'wait', seconds: 1 },
    ], deps);
    expect(log).toEqual(['wait:1000']);
  });
});

describe('nextPrefetchableComment — how early a render may safely start', () => {
  const kinds = (...ks: string[]): IWActionStep[] => ks.map(k => ({ kind: k } as IWActionStep));

  it('reaches across steps that cannot change what the NPC has heard', () => {
    // The shape the whole prefetch exists for: the walk is the window.
    expect(nextPrefetchableComment(kinds('walk_to_tag', 'wait', 'walk_to_actor', 'comment'), 0)).toBe(3);
  });

  it('refuses to cross wait_for_response — the case that sinks batching outright', () => {
    // A script straddles the learner's own sentences. A line written before them would answer
    // something nobody said, which is exactly what § 14 Q42's original mitigation got wrong.
    expect(nextPrefetchableComment(kinds('walk_to_actor', 'wait_for_response', 'comment'), 0)).toBeNull();
  });

  it('treats the step about to be performed as a barrier too', () => {
    expect(nextPrefetchableComment(kinds('wait_for_response', 'comment'), 0)).toBeNull();
  });

  it('refuses to cross another comment, so a line can build on the one before it', () => {
    expect(nextPrefetchableComment(kinds('walk_to_actor', 'comment', 'comment'), 0)).toBe(1);
  });

  it('refuses to cross a conversation — that is several other NPCs speaking', () => {
    expect(nextPrefetchableComment(kinds('walk_to_actor', 'start_conversation', 'comment'), 0)).toBeNull();
  });

  it('returns `from` itself for a comment there, leaving the caller to render it inline', () => {
    expect(nextPrefetchableComment(kinds('comment', 'wait'), 0)).toBe(0);
  });

  it('is null when there is no comment left at all', () => {
    expect(nextPrefetchableComment(kinds('walk_to_actor', 'face'), 0)).toBeNull();
  });
});

describe('the prefetch actually starts early, and is used exactly once', () => {
  it('starts the render before the walk and speaks it after', async () => {
    const { log, deps } = harness();
    await runAuthoredAction('wangshen', [
      { kind: 'walk_to_actor', actor: 'player' },
      { kind: 'comment', text: 'greet them' },
    ], deps);
    // Render FIRST — that is the latency hiding behind the walk.
    expect(log[0]).toBe('render:greet them');
    expect(log[log.length - 1]).toBe('say:[greet them]');
  });

  it('renders each comment exactly once, never twice', async () => {
    const renderLine = vi.fn(async (_who: string, d: string) => `[${d}]`);
    const { deps } = harness({ renderLine });
    await runAuthoredAction('wangshen', [
      { kind: 'walk_to_actor', actor: 'player' },
      { kind: 'comment', text: 'greet them' },
      { kind: 'wait', seconds: 1 },
      { kind: 'comment', text: 'ask what they want' },
    ], deps);
    expect(renderLine).toHaveBeenCalledTimes(2);
  });

  it('does not prefetch past a wait_for_response', async () => {
    const renderLine = vi.fn(async (_who: string, d: string) => `[${d}]`);
    const { deps } = harness({ renderLine });
    // `wait_for_response` ends the action, so the comment after it never runs at all — and
    // must not have been rendered speculatively either.
    await runAuthoredAction('wangshen', [
      { kind: 'wait_for_response' },
      { kind: 'comment', text: 'greet them' },
    ], deps);
    expect(renderLine).not.toHaveBeenCalled();
  });
});

/**
 * `prompt_npc` — one body's script making ANOTHER body speak (2026-09-19).
 *
 * The promise being pinned is subjecthood: every other instruction in the loop is performed
 * by the action's own performer, and this one is not. Getting it wrong is not a crash — it is
 * 王婶 speaking the kitchen's line in her own bubble, which reads as the scene working.
 */
describe('prompt_npc hands the floor to somebody else', () => {
  /** A harness that records WHO each beat belonged to, which the default one throws away. */
  function whoHarness() {
    const log: string[] = [];
    const { deps } = harness({
      worldFor: () => ({
        graph,
        selfCell: '1,1',
        cells: new Map([['player', '6,6'], ['kitchen_hand', '2,2'], ['wangshen', '1,1']]),
        conversations: [],
        eventIds: [],
      }),
      say: async (who, text) => { log.push(`say:${who}:${text}`); },
      renderLine: async (who, direction, toward) => {
        log.push(`render:${who}:${direction ?? '(unbriefed)'}:${toward ?? '(model picks)'}`);
        return `[${who}]`;
      },
      note: (_who, reason) => { log.push(`note:${reason}`); },
      // Overridden too, so every beat lands in THIS log — the base harness keeps its own.
      wait: async ms => { log.push(`wait:${ms}`); },
    });
    return { log, deps };
  }

  it('renders and speaks as the PROMPTED npc, not as the performer', async () => {
    const { log, deps } = whoHarness();
    await runAuthoredAction('wangshen', [
      { kind: 'prompt_npc', npcId: 'kitchen_hand', target: 'player', instruction: 'say the noodles are coming' },
    ], deps);
    expect(log).toEqual([
      'render:kitchen_hand:say the noodles are coming:player',
      'say:kitchen_hand:[kitchen_hand]',
    ]);
  });

  it('passes an unbriefed, untargeted cue straight through as "the model decides"', async () => {
    const { log, deps } = whoHarness();
    await runAuthoredAction('wangshen', [{ kind: 'prompt_npc', npcId: 'kitchen_hand' }], deps);
    expect(log[0]).toBe('render:kitchen_hand:(unbriefed):(model picks)');
  });

  it('drops an addressee who is not in the scene without losing the line', async () => {
    const { log, deps } = whoHarness();
    await runAuthoredAction('wangshen', [
      { kind: 'prompt_npc', npcId: 'kitchen_hand', target: 'lao_zhou' },
    ], deps);
    expect(log[0]).toBe('render:kitchen_hand:(unbriefed):(model picks)');
    expect(log[1]).toBe('say:kitchen_hand:[kitchen_hand]');
  });

  it('skips the cue when the speaker is not in the scene, and plays on', async () => {
    const { log, deps } = whoHarness();
    await runAuthoredAction('wangshen', [
      { kind: 'prompt_npc', npcId: 'lao_zhou' },
      { kind: 'wait', seconds: 1 },
    ], deps);
    expect(log.some(l => l.startsWith('say:'))).toBe(false);
    expect(log.some(l => l.includes('is not in this scene'))).toBe(true);
    expect(log).toContain('wait:1000');
  });

  it('a frozen render is silence, exactly as it is for a comment', async () => {
    const { log, deps } = harness({
      worldFor: () => ({
        graph, selfCell: '1,1', cells: new Map([['kitchen_hand', '2,2']]), conversations: [], eventIds: [],
      }),
      renderLine: async () => null,
    });
    await runAuthoredAction('wangshen', [{ kind: 'prompt_npc', npcId: 'kitchen_hand' }], deps);
    expect(log.some(l => l.startsWith('say:'))).toBe(false);
  });

  it('BARRIERS a prefetch — a line the performer will answer cannot be written before it', () => {
    // Same fact as start_conversation, in smaller form: another voice is about to enter.
    const steps: IWActionStep[] = [
      { kind: 'prompt_npc', npcId: 'kitchen_hand' },
      { kind: 'comment', text: 'answer them' },
    ];
    expect(nextPrefetchableComment(steps, 0)).toBeNull();
  });
});
