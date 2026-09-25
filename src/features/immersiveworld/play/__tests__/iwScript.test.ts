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

/** Let every already-queued promise settle — used to observe a script parked mid-run. */
const flush = () => new Promise(resolve => { setTimeout(resolve, 0); });

/** A deps double that records the order everything happened in. */
function harness(over: Partial<IWScriptDeps> = {}) {
  const log: string[] = [];
  const deps: IWScriptDeps = {
    worldFor: () => ({ graph, selfCell: '1,1', cells: new Map([['player', '6,6']]), conversations: [], eventIds: [] }),
    walk: async (_who, cell) => { log.push(`walk:${cell}`); return 'arrived'; },
    face: (_who, cell) => { log.push(`face:${cell}`); },
    say: async (_who, text) => { log.push(`say:${text}`); },
    renderLine: async (_who, direction) => { log.push(`render:${direction}`); return `[${direction}]`; },
    // The default picker chooses the FIRST candidate, so a test sees a deterministic walk.
    chooseDestination: async (_who, brief, candidates) => { log.push(`choose:${brief}`); return candidates[0] ?? null; },
    playConversation: async id => { log.push(`conversation:${id}`); },
    armEvent: id => { log.push(`event:${id}`); },
    wait: async ms => { log.push(`wait:${ms}`); },
    // The default is an IMMEDIATE resume — a test that cares about the parking itself hands
    // in its own, as the two `wait_for_response` cases below do.
    awaitLearner: async who => { log.push(`awaitLearner:${who}`); },
    // The default collector SUCCEEDS on the first ask, so a test that does not care about the
    // errand sees one round trip. The give-up cases hand in their own.
    collect: async (who, goal, attempt) => { log.push(`collect:${who}:${goal}:${attempt}`); return 'got'; },
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
    // Parked forever, so the assertion is about what was rendered WHILE the learner still
    // has the floor. The comment on the far side is reachable now (2026-09-20) — it must
    // still not be written before the sentence it is going to answer exists.
    const { deps } = harness({ renderLine, awaitLearner: () => new Promise<void>(() => {}) });
    void runAuthoredAction('wangshen', [
      { kind: 'wait_for_response' },
      { kind: 'comment', text: 'greet them' },
    ], deps);
    await flush();
    expect(renderLine).not.toHaveBeenCalled();
  });
});

/**
 * `wait_for_response` — a barrier the script comes BACK from (2026-09-20).
 *
 * It used to `return`, which made "hand the floor back" and "this action is over" the same
 * step. The promise pinned here is that the steps after it are ordinary steps.
 */
describe('wait_for_response parks the script rather than ending it', () => {
  it('plays the steps after it once the learner has spoken', async () => {
    let release: (() => void) | null = null;
    const { log, deps } = harness({
      awaitLearner: () => new Promise<void>(resolve => { release = resolve; }),
    });
    const done = runAuthoredAction('wangshen', [
      { kind: 'comment', text: 'ask what they want' },
      { kind: 'wait_for_response' },
      { kind: 'comment', text: 'repeat the order back' },
    ], deps);

    // Nothing beyond the barrier has run while the learner holds the floor (§ 14 Q29). A
    // macrotask, not a microtask: the beats before the barrier are themselves awaits, and a
    // single `Promise.resolve()` would assert before the script had even reached it.
    await flush();
    expect(log).toEqual(['render:ask what they want', 'say:[ask what they want]']);

    release!();
    await done;
    expect(log).toEqual([
      'render:ask what they want', 'say:[ask what they want]',
      'render:repeat the order back', 'say:[repeat the order back]',
    ]);
  });

  it('unwinds without playing the rest when the wait is released by a cancellation', async () => {
    // The scene-left path: the host resolves every parked waiter so the chain can notice
    // `cancelled()` and stop. Nothing after the barrier may be performed on the way out.
    let cancelled = false;
    const { log, deps } = harness({
      awaitLearner: async () => { cancelled = true; },
      cancelled: () => cancelled,
    });
    await runAuthoredAction('wangshen', [
      { kind: 'wait_for_response' },
      { kind: 'comment', text: 'greet them' },
    ], deps);
    expect(log).toEqual([]);
  });

  it('takes several barriers in one action', async () => {
    const { log, deps } = harness();
    await runAuthoredAction('wangshen', [
      { kind: 'wait_for_response' },
      { kind: 'comment', text: 'answer them' },
      { kind: 'wait_for_response' },
      { kind: 'comment', text: 'say goodbye' },
    ], deps);
    expect(log).toEqual([
      'awaitLearner:wangshen',
      'render:answer them', 'say:[answer them]',
      'awaitLearner:wangshen',
      'render:say goodbye', 'say:[say goodbye]',
    ]);
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
      awaitLearner: async who => { log.push(`awaitLearner:${who}`); },
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

describe('get_information keeps the floor until the NPC has its answer', () => {
  it('asks once when the first answer carries it', async () => {
    const { log, deps } = harness();
    await runAuthoredAction('wangshen', [
      { kind: 'comment', text: 'ask what they want' },
      { kind: 'get_information', goal: 'what they want to order' },
      { kind: 'comment', text: 'repeat the order back' },
    ], deps);
    expect(log).toEqual([
      'render:ask what they want', 'say:[ask what they want]',
      'collect:wangshen:what they want to order:1',
      'render:repeat the order back', 'say:[repeat the order back]',
    ]);
  });

  it('asks again, with a rising attempt number, until it is satisfied', async () => {
    let asks = 0;
    const { log, deps } = harness({
      collect: async (_who, _goal, attempt) => {
        asks++;
        log.push(`collect:${attempt}`);
        return asks >= 3 ? 'got' : 'not-yet';
      },
    });
    await runAuthoredAction('wangshen', [{ kind: 'get_information', goal: 'their order' }], deps);
    // Three attempts, and NO give-up line: it got there on the last one.
    expect(log).toEqual(['collect:1', 'collect:2', 'collect:3']);
  });

  it('gives up IN CHARACTER at the cap rather than standing there', async () => {
    let asks = 0;
    const { log, deps } = harness({ collect: async () => { asks++; return 'not-yet'; } });
    await runAuthoredAction('wangshen', [
      { kind: 'get_information', goal: 'their order', maxTurns: 2 },
      { kind: 'comment', text: 'bring the house dish' },
    ], deps);
    // Two asks, a rendered give-up line, and then the script carries on — the whole point of
    // the cap is that the errand failing is not the scene failing.
    expect(asks).toBe(2);
    expect(log.some(l => l.startsWith('render:You could not find out their order'))).toBe(true);
    expect(log).toContain('say:[bring the house dish]');
  });

  it('stops dead when the scene is left mid-errand — no give-up line at nobody', async () => {
    let cancelled = false;
    const { log, deps } = harness({
      collect: async () => { cancelled = true; return 'not-yet'; },
      cancelled: () => cancelled,
    });
    await runAuthoredAction('wangshen', [
      { kind: 'get_information', goal: 'their order' },
      { kind: 'comment', text: 'never reached' },
    ], deps);
    expect(log.some(l => l.startsWith('render:'))).toBe(false);
  });

  it('SKIPS a goal-less step rather than parking on an unanswerable question', async () => {
    const { log, deps } = harness();
    await runAuthoredAction('wangshen', [{ kind: 'get_information', goal: '  ' }], deps);
    expect(log).toEqual(['note:a Get information step with no goal']);
  });
});

describe('ai_walk — ask where, then walk there like any other walk (§ 5.4)', () => {
  it('asks the picker, then walks beside the chosen place and faces it', async () => {
    const { log, deps } = harness({
      chooseDestination: async (_who, brief) => { log.push(`choose:${brief}`); return { kind: 'place', tag: 'counter' }; },
    });
    await runAuthoredAction('wangshen', [{ kind: 'ai_walk', instruction: 'to the counter' }], deps);
    expect(log[0]).toBe('choose:to the counter');
    // Faced before setting off and again on arrival — the ordinary walk_to_tag shape.
    expect(log.slice(1)).toEqual(['face:4,4', expect.stringMatching(/^walk:/), 'face:4,4']);
  });

  it('skips the walk — and plays on — when the picker finds nowhere', async () => {
    const { log, deps } = harness({ chooseDestination: async () => null });
    await runAuthoredAction('wangshen', [
      { kind: 'ai_walk', instruction: 'somewhere' },
      { kind: 'wait', seconds: 1 },
    ], deps);
    expect(log).toEqual(['note:the AI walk found nowhere to go', 'wait:1000']);
  });

  it('stops without walking when the script is cancelled during the call', async () => {
    let cancelled = false;
    const { log, deps } = harness({
      chooseDestination: async () => { cancelled = true; return { kind: 'place', tag: 'counter' }; },
      cancelled: () => cancelled,
    });
    await runAuthoredAction('wangshen', [{ kind: 'ai_walk', instruction: 'to the counter' }], deps);
    expect(log.some(l => l.startsWith('walk:'))).toBe(false);
  });
});
