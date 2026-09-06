/**
 * iwNpcTurn.test.ts — Q7's fallback ladder (§ 14 Q7, § 14 Q12).
 *
 * Every rung here is a fake async iterable, so the whole ladder — including its two deadlines
 * — is exercised with no network and no clock skew. That matters more than usual: the thing
 * being tested is what happens when a provider misbehaves, which is by definition the case
 * you cannot arrange on demand against a real one.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  describeLadder,
  runNpcTurn,
  RUNG_FIRST_GLYPH_DEADLINE_MS,
  type IWModelRung,
} from '../services/iw/npcTurn.js';
import { IW_NO_ACTION } from '../contracts/iw.js';

const OFFERED = ['bring water', 'take the order'];
const REQUEST = { system: 'rules', user: 'turn' };

/** A rung that emits `chunks`, optionally pausing `delayMs` before each. */
const fakeRung = (
  id: string,
  chunks: string[],
  opts: { vendor?: string; delayMs?: number; throwAfter?: number } = {},
): IWModelRung => ({
  id,
  vendor: opts.vendor ?? 'fake',
  async *stream(_req, signal) {
    for (let i = 0; i < chunks.length; i++) {
      if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
      if (signal.aborted) throw new Error('aborted');
      if (opts.throwAfter !== undefined && i >= opts.throwAfter) throw new Error('transport blew up');
      yield chunks[i];
    }
  },
});

/** A rung that never yields anything and hangs until aborted. */
const hangingRung = (id: string, vendor = 'fake'): IWModelRung => ({
  id,
  vendor,
  async *stream(_req, signal) {
    await new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
      // Never resolves on its own.
    });
    yield '';
  },
});

const GOOD = ['热的还是凉的？', '\n', 'bring water', '\n', 'pleased'];

describe('runNpcTurn — the happy path', () => {
  it('returns the parsed reply from the first rung that answers', async () => {
    const out = await runNpcTurn({ rungs: [fakeRung('r1', GOOD)], request: REQUEST, offered: OFFERED });
    expect(out.kind).toBe('reply');
    if (out.kind !== 'reply') return;
    expect(out.reply.say).toBe('热的还是凉的？');
    expect(out.reply.action).toBe('bring water');
    expect(out.reply.emote).toBe('pleased');
    expect(out.rung).toBe('r1');
    expect(out.attempts).toEqual([expect.objectContaining({ id: 'r1', outcome: 'ok' })]);
  });

  it('paints the bubble from the first delta, not at the end', async () => {
    const seen: string[] = [];
    await runNpcTurn({
      rungs: [fakeRung('r1', GOOD)],
      request: REQUEST,
      offered: OFFERED,
      onDelta: say => seen.push(say),
    });
    expect(seen[0]).toBe('热的还是凉的？');
    expect(seen.length).toBeGreaterThan(1);
  });

  it('never touches a later rung once one answers', async () => {
    const second = vi.fn();
    const out = await runNpcTurn({
      rungs: [
        fakeRung('r1', GOOD),
        { id: 'r2', vendor: 'other', stream: (...a) => { second(); return fakeRung('r2', GOOD).stream(...a); } },
      ],
      request: REQUEST,
      offered: OFFERED,
    });
    expect(out.kind).toBe('reply');
    expect(second).not.toHaveBeenCalled();
  });
});

describe('runNpcTurn — walking the ladder', () => {
  it('moves past a rung that throws', async () => {
    const out = await runNpcTurn({
      rungs: [fakeRung('r1', GOOD, { throwAfter: 0 }), fakeRung('r2', GOOD, { vendor: 'other' })],
      request: REQUEST,
      offered: OFFERED,
    });
    expect(out.kind).toBe('reply');
    if (out.kind !== 'reply') return;
    expect(out.rung).toBe('r2');
    expect(out.attempts[0]).toMatchObject({ id: 'r1', outcome: 'error', error: 'transport blew up' });
  });

  it('moves past a rung that returns an EMPTY reply', async () => {
    // § 5.3 calls the empty reply the only true parse failure, and retrying it on another
    // model is exactly what the ladder is for.
    const out = await runNpcTurn({
      rungs: [fakeRung('r1', ['', '  ']), fakeRung('r2', GOOD, { vendor: 'other' })],
      request: REQUEST,
      offered: OFFERED,
    });
    expect(out.kind).toBe('reply');
    if (out.kind !== 'reply') return;
    expect(out.rung).toBe('r2');
    expect(out.attempts[0]).toMatchObject({ id: 'r1', outcome: 'empty' });
  });

  it('kills a rung that has not emitted a single glyph by the deadline', async () => {
    const out = await runNpcTurn({
      rungs: [hangingRung('slow'), fakeRung('r2', GOOD, { vendor: 'other' })],
      request: REQUEST,
      offered: OFFERED,
      firstGlyphDeadlineMs: 30,
    });
    expect(out.kind).toBe('reply');
    if (out.kind !== 'reply') return;
    expect(out.attempts[0]).toMatchObject({ id: 'slow', outcome: 'no-glyph-by-deadline' });
    expect(out.rung).toBe('r2');
  });

  it('KEEPS a reply from a rung that spoke and then broke', async () => {
    // Different failure from "never spoke": we already have a usable bubble, so the total
    // deadline stops us waiting for lines 2 and 3 rather than discarding the utterance.
    const out = await runNpcTurn({
      rungs: [fakeRung('r1', ['热的还是凉的？', '\n', 'x'], { throwAfter: 2 })],
      request: REQUEST,
      offered: OFFERED,
    });
    expect(out.kind).toBe('reply');
    if (out.kind !== 'reply') return;
    expect(out.reply.say).toBe('热的还是凉的？');
    expect(out.reply.action).toBe(IW_NO_ACTION); // never arrived
    expect(out.attempts[0].outcome).toBe('ok');
  });

  it('tells the caller which attempt a delta belongs to, so the bubble can reset', async () => {
    const seen: Array<[string, number]> = [];
    await runNpcTurn({
      rungs: [fakeRung('r1', ['半句', '\n'], { throwAfter: 2 }), fakeRung('r2', GOOD, { vendor: 'other' })],
      request: REQUEST,
      offered: OFFERED,
      onDelta: (say, i) => seen.push([say, i]),
    });
    expect(seen.some(([, i]) => i === 0)).toBe(true);
  });

  it('records every attempt including the successful one', async () => {
    const out = await runNpcTurn({
      rungs: [
        fakeRung('r1', GOOD, { throwAfter: 0 }),
        fakeRung('r2', [''], { vendor: 'b' }),
        fakeRung('r3', GOOD, { vendor: 'c' }),
      ],
      request: REQUEST,
      offered: OFFERED,
    });
    expect(out.attempts.map(a => a.outcome)).toEqual(['error', 'empty', 'ok']);
    expect(out.attempts.every(a => typeof a.ms === 'number')).toBe(true);
  });
});

describe('runNpcTurn — an exhausted ladder freezes the world', () => {
  it('returns frozen rather than inventing a cover line', async () => {
    // § 14 Q7, decided: no speech, no emote, no improvised line. A scene quietly serving
    // plausible filler through a real outage is the BILLING_DISABLED failure mode.
    const out = await runNpcTurn({
      rungs: [fakeRung('r1', GOOD, { throwAfter: 0 }), fakeRung('r2', [''], { vendor: 'b' })],
      request: REQUEST,
      offered: OFFERED,
    });
    expect(out.kind).toBe('frozen');
    expect(out).not.toHaveProperty('reply');
    if (out.kind !== 'frozen') return;
    expect(out.attempts).toHaveLength(2);
  });

  it('freezes on an empty ladder rather than throwing', async () => {
    const out = await runNpcTurn({ rungs: [], request: REQUEST, offered: OFFERED });
    expect(out).toEqual({ kind: 'frozen', attempts: [] });
  });
});

describe('runNpcTurn — the offered list is the validation list', () => {
  it('degrades an action this NPC was not offered', async () => {
    const out = await runNpcTurn({
      rungs: [fakeRung('r1', ['好\nfly away\npleased'])],
      request: REQUEST,
      offered: OFFERED,
    });
    expect(out.kind).toBe('reply');
    if (out.kind !== 'reply') return;
    expect(out.reply.action).toBe(IW_NO_ACTION);
  });
});

describe('describeLadder', () => {
  it('names a single-vendor ladder as a misconfiguration', () => {
    // Q12 makes a second vendor a requirement, not an optimization: a ladder that shares a
    // vendor throughout does not survive the outage it exists for.
    const text = describeLadder([fakeRung('a', []), fakeRung('b', [])]);
    expect(text).toContain('SINGLE VENDOR');
  });

  it('is quiet about a two-vendor ladder', () => {
    const text = describeLadder([fakeRung('a', []), fakeRung('b', [], { vendor: 'other' })]);
    expect(text).not.toContain('SINGLE VENDOR');
    expect(text).toContain('a (fake) → b (other)');
  });

  it('says an empty ladder will freeze every turn', () => {
    expect(describeLadder([])).toContain('EMPTY');
  });
});

describe('the deadline constant', () => {
  it('leaves headroom over the worst measured first glyph', () => {
    // Measured 2026-09-06 on the first real authored scene: first glyph 715-1254 ms across
    // Haiku 4.5 and Sonnet 5. The deadline must clear the worst good case without being so
    // long that a dead rung plus a live one blows § 6's budget.
    expect(RUNG_FIRST_GLYPH_DEADLINE_MS).toBeGreaterThan(1254);
    expect(RUNG_FIRST_GLYPH_DEADLINE_MS).toBeLessThanOrEqual(2000);
  });
});

describe('a slow rung that IS streaming is not killed', () => {
  it('keeps a rung alive past the first-glyph deadline once it has spoken', async () => {
    // The regression this pins: a sayDone-based deadline killed Sonnet 5 on 4 of 4 real turns
    // and once froze a scene that had a good answer coming, throwing away a bubble that was
    // already painting.
    const trickle: IWModelRung = {
      id: 'slow-but-alive',
      vendor: 'fake',
      async *stream(_req, signal) {
        yield '热';
        for (const chunk of ['的还是凉的？', '\n', 'bring water', '\n', 'pleased']) {
          await new Promise(r => setTimeout(r, 15));
          if (signal.aborted) throw new Error('aborted');
          yield chunk;
        }
      },
    };
    const out = await runNpcTurn({
      rungs: [trickle],
      request: REQUEST,
      offered: OFFERED,
      firstGlyphDeadlineMs: 20,
      totalDeadlineMs: 500,
    });
    expect(out.kind).toBe('reply');
    if (out.kind !== 'reply') return;
    expect(out.reply.say).toBe('热的还是凉的？');
    expect(out.reply.action).toBe('bring water');
  });
});
