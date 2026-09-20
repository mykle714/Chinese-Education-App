/**
 * iwSceneTranscript.test.ts — what a scene run remembers (§ 12 phase 3).
 *
 * What is only testable HERE: the LIFECYCLE. Whether a run is opened at all, whether one
 * session is one run, whether the entries arrive in the order they were produced, and
 * whether any of it can take down the turn it is riding along with. The trim itself is a
 * single SQL statement and is exercised against a real database by
 * `server/scripts/iw-transcript.js --self-test`, not here — a fake that reimplemented
 * `jsonb_agg ... ORDER BY ord` would only be testing the fake.
 */

import { describe, it, expect, vi } from 'vitest';
import { SceneTranscript } from '../services/iw/sceneTranscript.js';
import { ImmersiveWorldService } from '../services/ImmersiveWorldService.js';
import { IWTurnBudget } from '../services/iw/turnBudget.js';
import { IW_ACTOR_PLAYER, type IWScene, type IWTranscriptEntry } from '../contracts/iw.js';
import type { IImmersiveWorldDAL } from '../dal/interfaces/IImmersiveWorldDAL.js';
import type { IWModelRung } from '../services/iw/npcTurn.js';
import { COMPANION_NPC_ID_BY_LANGUAGE, npcsForLanguage } from '../config/iwNpcs.js';

const COMPANION_ID = COMPANION_NPC_ID_BY_LANGUAGE.zh!;
const NPC_ID = npcsForLanguage('zh').find(n => n.id !== COMPANION_ID)!.id;

const SCENE: IWScene = {
  id: 'scene-1',
  name: 'test scene',
  language: 'zh',
  width: 8,
  height: 8,
  layout: { decor: {}, places: {} },
  npcCast: [{ npcId: NPC_ID, col: 2, row: 2, facing: 'south', actions: [] }],
  companionStartCol: 5,
  companionStartRow: 5,
  companionStartFacing: 'north',
  conversations: [],
  interactions: {},
} as unknown as IWScene;

/** A DAL that keeps the runs it opened in memory and records every call in order. */
function fakeRunDal(overrides: Partial<IImmersiveWorldDAL> = {}) {
  const calls: string[] = [];
  const transcripts = new Map<string, IWTranscriptEntry[]>();
  let nextId = 1;
  const dal = {
    calls,
    transcripts,
    async findSceneById() { return SCENE; },
    async openRun(userId: string, language: string, sceneId: string) {
      const id = `run-${nextId++}`;
      calls.push(`open:${userId}:${language}:${sceneId}`);
      transcripts.set(id, []);
      return { id, userId, language, sceneId, transcript: [] } as any;
    },
    async appendTranscript(runId: string, entries: readonly IWTranscriptEntry[]) {
      const held = transcripts.get(runId);
      if (!held) return false;
      held.push(...entries);
      calls.push(`append:${runId}:${entries.map(e => `${e.speaker}=${e.text}`).join('|')}`);
      return true;
    },
    async completeRun(runId: string) {
      calls.push(`close:${runId}`);
      return { id: runId, transcript: transcripts.get(runId) ?? [], durationSeconds: 3 } as any;
    },
    ...overrides,
  };
  return dal as unknown as IImmersiveWorldDAL & typeof dal;
}

const entry = (speaker: string, text: string): IWTranscriptEntry =>
  ({ speaker, text, at: new Date().toISOString() });

const SCENE_REF = { sceneId: 'scene-1', language: 'zh' };

describe('SceneTranscript — the run lifecycle', () => {
  it('opens no run until something is actually said', async () => {
    const dal = fakeRunDal();
    const t = new SceneTranscript(dal);
    // A scene walked into and left in silence. `end` on a session that never recorded must
    // not conjure a row to close.
    t.end('u1', 's1');
    await t.flush('u1', 's1');
    expect(dal.calls).toEqual([]);
  });

  it('opens exactly one run per session, however many turns it takes', async () => {
    const dal = fakeRunDal();
    const t = new SceneTranscript(dal);
    t.record('u1', 's1', SCENE_REF, [entry(IW_ACTOR_PLAYER, '你好')]);
    t.record('u1', 's1', SCENE_REF, [entry(NPC_ID, '你好啊')]);
    await t.flush('u1', 's1');
    expect(dal.calls.filter(c => c.startsWith('open:'))).toEqual(['open:u1:zh:scene-1']);
  });

  it('keeps entries in the order they were produced, not the order they resolve', async () => {
    // The whole point of the append chain: recording is fire-and-forget, so without it two
    // turns a second apart could land in either order and read back as a reply preceding
    // the line it answers. The first append is deliberately made the SLOW one.
    let firstAppend = true;
    const dal = fakeRunDal();
    const slow = { ...dal } as any;
    const realAppend = dal.appendTranscript.bind(dal);
    slow.appendTranscript = async (runId: string, entries: readonly IWTranscriptEntry[]) => {
      if (firstAppend) {
        firstAppend = false;
        await new Promise(r => setTimeout(r, 20));
      }
      return realAppend(runId, entries);
    };

    const t = new SceneTranscript(slow);
    t.record('u1', 's1', SCENE_REF, [entry(IW_ACTOR_PLAYER, 'first')]);
    t.record('u1', 's1', SCENE_REF, [entry(NPC_ID, 'second')]);
    t.record('u1', 's1', SCENE_REF, [entry(NPC_ID, 'third')]);
    const runId = await t.flush('u1', 's1');
    expect(dal.transcripts.get(runId!)!.map(e => e.text)).toEqual(['first', 'second', 'third']);
  });

  it('closes the run only after the appends still in flight have landed', async () => {
    const dal = fakeRunDal();
    const t = new SceneTranscript(dal);
    t.record('u1', 's1', SCENE_REF, [entry(NPC_ID, '最后一句')]);
    // `/session/end` arrives with `keepalive` right behind the last turn — the case where
    // closing eagerly would drop the very line a reader most wants.
    t.end('u1', 's1');
    await new Promise(r => setTimeout(r, 20));
    expect(dal.calls).toEqual([
      'open:u1:zh:scene-1',
      'append:run-1:' + `${NPC_ID}=最后一句`,
      'close:run-1',
    ]);
  });

  it('starts a fresh run after the session ended', async () => {
    const dal = fakeRunDal();
    const t = new SceneTranscript(dal);
    t.record('u1', 's1', SCENE_REF, [entry(NPC_ID, 'a')]);
    await t.flush('u1', 's1');
    t.end('u1', 's1');
    t.record('u1', 's2', SCENE_REF, [entry(NPC_ID, 'b')]);
    await t.flush('u1', 's2');
    expect(dal.calls.filter(c => c.startsWith('open:')).length).toBe(2);
  });

  it('does not let one user’s session id reach another user’s run', async () => {
    // Session ids are client-generated, so two learners can pick the same one. Keying on it
    // alone would append one person's conversation to the other's history.
    const dal = fakeRunDal();
    const t = new SceneTranscript(dal);
    t.record('u1', 'same', SCENE_REF, [entry(NPC_ID, 'mine')]);
    t.record('u2', 'same', SCENE_REF, [entry(NPC_ID, 'theirs')]);
    const a = await t.flush('u1', 'same');
    const b = await t.flush('u2', 'same');
    expect(a).not.toBe(b);
    expect(dal.transcripts.get(a!)!.map(e => e.text)).toEqual(['mine']);
    expect(dal.transcripts.get(b!)!.map(e => e.text)).toEqual(['theirs']);
  });
});

describe('SceneTranscript — it can never take a scene down', () => {
  it('survives a DAL that throws synchronously when the run is opened', async () => {
    const dal = fakeRunDal({
      openRun() { throw new Error('no database'); },
    });
    const t = new SceneTranscript(dal);
    expect(() => t.record('u1', 's1', SCENE_REF, [entry(NPC_ID, 'hi')])).not.toThrow();
    await t.flush('u1', 's1');
    // And a later turn in the same session must not throw either — it joins the same
    // already-rejected open rather than retrying into the same wall.
    expect(() => t.record('u1', 's1', SCENE_REF, [entry(NPC_ID, 'hi again')])).not.toThrow();
    await t.flush('u1', 's1');
  });

  it('survives an append that rejects, and keeps recording afterwards', async () => {
    let calls = 0;
    const dal = fakeRunDal();
    const flaky = { ...dal } as any;
    const realAppend = dal.appendTranscript.bind(dal);
    flaky.appendTranscript = async (runId: string, entries: readonly IWTranscriptEntry[]) => {
      if (++calls === 1) throw new Error('deadlock');
      return realAppend(runId, entries);
    };
    const t = new SceneTranscript(flaky);
    t.record('u1', 's1', SCENE_REF, [entry(NPC_ID, 'lost')]);
    t.record('u1', 's1', SCENE_REF, [entry(NPC_ID, 'kept')]);
    const runId = await t.flush('u1', 's1');
    // One line is gone; the run is not, and the next line still lands. A transcript is
    // best-effort by construction (see the class header).
    expect(dal.transcripts.get(runId!)!.map(e => e.text)).toEqual(['kept']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Through the service — what a real turn and a real line actually store
// ─────────────────────────────────────────────────────────────────────────────

const rung = (chunks: string[]): IWModelRung => ({
  id: 'fake', vendor: 'fake',
  async *stream() { for (const c of chunks) yield c; },
});

const turnRequest = (over: Record<string, unknown> = {}) => ({
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

function serviceWith(dal: IImmersiveWorldDAL, rungs: IWModelRung[]) {
  return new ImmersiveWorldService(dal, new IWTurnBudget(), rungs, undefined, new SceneTranscript(dal));
}

describe('runTurn / runLine — what reaches the transcript', () => {
  it('stores the learner’s line and the reply, in that order', async () => {
    const dal = fakeRunDal();
    const svc = serviceWith(dal, [rung(['好的\n', 'none\n', 'pleased'])]);
    await svc.runTurn('u1', turnRequest());
    const runId = await svc.flushTranscript('u1', 'run-1');
    expect(dal.transcripts.get(runId!)!.map(e => [e.speaker, e.text])).toEqual([
      [IW_ACTOR_PLAYER, '你好'],
      [NPC_ID, '好的'],
    ]);
  });

  it('stores nothing for a frozen turn', async () => {
    // A learner's line with no answer beside it would read back as an NPC ignoring them,
    // which is a story the run did not actually contain (see the note in `runTurn`).
    const dal = fakeRunDal();
    const svc = serviceWith(dal, [rung([''])]);
    const out = await svc.runTurn('u1', turnRequest());
    expect(out.kind).toBe('frozen');
    await svc.flushTranscript('u1', 'run-1');
    expect(dal.calls).toEqual([]);
  });

  it('stores an authored beat the same way it stores a turn', async () => {
    const dal = fakeRunDal();
    const svc = serviceWith(dal, [rung(['请坐'])]);
    await svc.runLine('u1', {
      sceneId: 'scene-1', sessionId: 'run-1', npcId: NPC_ID,
      direction: 'invite them to sit',
      perception: { knownWords: [], nearby: [], heard: [] },
    });
    const runId = await svc.flushTranscript('u1', 'run-1');
    expect(dal.transcripts.get(runId!)!.map(e => [e.speaker, e.text])).toEqual([[NPC_ID, '请坐']]);
  });

  it('puts a turn and an authored beat in the same run', async () => {
    // One session is one conversation, whichever endpoint produced each line.
    const dal = fakeRunDal();
    const svc = serviceWith(dal, [rung(['好的\n', 'none\n', 'pleased'])]);
    await svc.runTurn('u1', turnRequest());
    await svc.runLine('u1', {
      sceneId: 'scene-1', sessionId: 'run-1', npcId: NPC_ID,
      direction: 'say something else',
      perception: { knownWords: [], nearby: [], heard: [] },
    });
    await svc.flushTranscript('u1', 'run-1');
    expect(dal.calls.filter(c => c.startsWith('open:')).length).toBe(1);
  });
});
