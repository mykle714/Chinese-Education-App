/**
 * iwRuntimeService.test.ts — the seam between the HTTP boundary and the pure turn pipeline.
 *
 * What this file is for, and what it deliberately is NOT: the prompt layers, the parser, the
 * offers and the ladder each have their own suite against fakes, and re-testing them through
 * the service would only make those failures harder to read. What is only testable HERE is
 * the ORDERING — that the budget is consulted before a model is, that a scene that does not
 * exist never reaches one, and that a frozen turn does not bill the learner.
 */

import { describe, it, expect } from 'vitest';
import { ImmersiveWorldService } from '../services/ImmersiveWorldService.js';
import { IWTurnBudget, IW_MAX_UTTERANCE_CHARS, IW_SESSION_TURN_BUDGET } from '../services/iw/turnBudget.js';
import type { IWModelRung } from '../services/iw/npcTurn.js';
import type { IWScene } from '../contracts/iw.js';
import type { IImmersiveWorldDAL } from '../dal/interfaces/IImmersiveWorldDAL.js';
import { npcsForLanguage } from '../config/iwNpcs.js';

/** The first real NPC in the registry, so the sheet the prompt renders is a real one. */
const NPC_ID = npcsForLanguage('zh')[0].id;

const SCENE: IWScene = {
  name: 'test scene',
  language: 'zh',
  width: 8,
  height: 8,
  layout: { decor: {}, places: {} },
  npcCast: [{ npcId: NPC_ID, col: 2, row: 2, facing: 'south', actions: [] }],
  conversations: [],
  interactions: {},
} as unknown as IWScene;

/** A DAL that answers with one scene and records what it was asked for. */
function fakeDal(scene: IWScene | null = SCENE): IImmersiveWorldDAL & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async findSceneById(id: string) { asked.push(id); return scene; },
  } as unknown as IImmersiveWorldDAL & { asked: string[] };
}

const rung = (chunks: string[]): IWModelRung => ({
  id: 'fake', vendor: 'fake',
  async *stream() { for (const c of chunks) yield c; },
});

const GOOD = rung(['好的\n', 'none\n', 'pleased']);
const SILENT = rung(['']);

const request = (over: Partial<Record<string, unknown>> = {}) => ({
  sceneId: 'scene-1',
  sessionId: 'run-1',
  npcId: NPC_ID,
  perception: {
    knownWords: ['好'],
    nearby: [],
    heard: [],
    event: { kind: 'utterance' as const, speaker: 'the customer', text: '你好', addressed: true },
  },
  ...over,
}) as any;

function service(dal = fakeDal(), rungs: IWModelRung[] = [GOOD], budget = new IWTurnBudget()) {
  return { svc: new ImmersiveWorldService(dal, budget, rungs), dal, budget };
}

describe('runTurn — the happy path', () => {
  it('reads the scene, runs the turn, and reports the remaining budget', async () => {
    const { svc, dal } = service();
    const out = await svc.runTurn('u1', request());
    expect(dal.asked).toEqual(['scene-1']);
    expect(out.kind).toBe('reply');
    if (out.kind !== 'reply') return;
    expect(out.reply.say).toBe('好的');
    expect(out.remaining).toBe(IW_SESSION_TURN_BUDGET - 1);
  });

  it('threads deltas through so a stream can paint', async () => {
    const seen: string[] = [];
    const { svc } = service();
    await svc.runTurn('u1', request(), say => seen.push(say));
    expect(seen[0]).toBe('好的');
  });
});

describe('runTurn — the budget is consulted BEFORE a model is', () => {
  it('refuses an over-long utterance without reading the scene', async () => {
    // The ordering is the point: an SSE response cannot change its status code once headers
    // are out, so every refusal has to be decided before anything is written.
    const { svc, dal } = service();
    const out = await svc.runTurn('u1', request({
      perception: { ...request().perception, event: { kind: 'utterance', speaker: 'x', text: '字'.repeat(IW_MAX_UTTERANCE_CHARS + 1), addressed: true } },
    }));
    expect(out.kind).toBe('refused');
    expect(dal.asked).toEqual([]);
  });

  it('refuses a second send inside the rate-limit gap', async () => {
    const { svc } = service();
    await svc.runTurn('u1', request());
    const out = await svc.runTurn('u1', request());
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') return;
    expect(out.refusal.code).toBe('too-fast');
  });
});

describe('runTurn — failures that must not bill the learner', () => {
  it('does not charge for a frozen turn', async () => {
    // § 14 Q7: the ladder was exhausted and the world said nothing. The learner got nothing,
    // so their session budget is untouched and they may try again.
    const { svc, budget } = service(fakeDal(), [SILENT]);
    const out = await svc.runTurn('u1', request());
    expect(out.kind).toBe('frozen');
    expect(budget.remaining('run-1')).toBe(IW_SESSION_TURN_BUDGET);
  });

  it('answers no-scene rather than throwing', async () => {
    const { svc } = service(fakeDal(null));
    const out = await svc.runTurn('u1', request());
    expect(out).toMatchObject({ kind: 'no-scene', sceneId: 'scene-1' });
  });

  it('answers unknown-npc for somebody who is not cast', async () => {
    const { svc } = service();
    const out = await svc.runTurn('u1', request({ npcId: 'nobody_here' }));
    expect(out).toMatchObject({ kind: 'unknown-npc' });
  });
});

describe('endSession', () => {
  it('releases the run counter', async () => {
    const { svc, budget } = service();
    await svc.runTurn('u1', request());
    expect(budget.remaining('run-1')).toBe(IW_SESSION_TURN_BUDGET - 1);
    svc.endSession('run-1');
    expect(budget.remaining('run-1')).toBe(IW_SESSION_TURN_BUDGET);
  });
});
