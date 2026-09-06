/**
 * iwModelLadder.test.ts — how the ladder is assembled from the environment (§ 14 Q7/Q12).
 *
 * These do not call a model. What they check is the CONFIGURATION story, which is where this
 * feature's most expensive silent failures live: a ladder that shares one vendor does not
 * survive the outage it exists for, and a box with no key at all should freeze visibly rather
 * than crash at import or, worse, boot fine and fail on the first learner's first sentence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildIwLadder, resetIwLadder } from '../services/iw/modelLadder.js';

const KEYS = [
  'IW_ANTHROPIC_API_KEY', 'DICT_AI_API_KEY', 'ANTHROPIC_API_KEY',
  'IW_CROSS_VENDOR_API_KEY', 'DEEPSEEK_API_KEY',
  'IW_MODEL_PRIMARY', 'IW_MODEL_BACKUP', 'IW_MODEL_CROSS_VENDOR', 'IW_CROSS_VENDOR_BASE_URL',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  resetIwLadder();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetIwLadder();
});

/** Collect what an operator would be told. */
function build() {
  const logs: string[] = [];
  const rungs = buildIwLadder(m => logs.push(m));
  return { rungs, logs: logs.join('\n') };
}

describe('buildIwLadder', () => {
  it('builds three rungs across two vendors when both keys are present', () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.DEEPSEEK_API_KEY = 'b';
    const { rungs, logs } = build();
    expect(rungs.map(r => r.id)).toEqual(['iw-primary', 'iw-backup', 'iw-cross-vendor']);
    expect(new Set(rungs.map(r => r.vendor)).size).toBe(2);
    expect(logs).not.toContain('SINGLE VENDOR');
  });

  it('keeps rung 2 on the SAME vendor as rung 1', () => {
    // § 14 Q7: most failures are a model hiccup or a capacity blip, not an outage, and
    // staying put is faster than switching.
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.DEEPSEEK_API_KEY = 'b';
    const { rungs } = build();
    expect(rungs[0].vendor).toBe(rungs[1].vendor);
    expect(rungs[2].vendor).not.toBe(rungs[0].vendor);
  });

  it('warns loudly when the cross-vendor rung is missing', () => {
    // Q12 makes a second vendor a requirement, not an optimization.
    process.env.ANTHROPIC_API_KEY = 'a';
    const { rungs, logs } = build();
    expect(rungs).toHaveLength(2);
    expect(logs).toContain('rung 3 unavailable');
    expect(logs).toContain('SINGLE VENDOR');
  });

  it('drops a rung rather than throwing when a key is missing', () => {
    process.env.DEEPSEEK_API_KEY = 'b';
    const { rungs, logs } = build();
    expect(rungs.map(r => r.id)).toEqual(['iw-cross-vendor']);
    expect(logs).toContain('rungs 1 and 2 unavailable');
  });

  it('yields an EMPTY ladder with no keys, and says every turn will freeze', () => {
    // Correct behaviour for "no model configured": each turn freezes with the Q7 banner,
    // which is far easier to diagnose than a crash at import time.
    const { rungs, logs } = build();
    expect(rungs).toEqual([]);
    expect(logs).toContain('EMPTY');
  });

  it('collapses rungs 1 and 2 when they name the same model', () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.IW_MODEL_PRIMARY = 'claude-haiku-4-5';
    process.env.IW_MODEL_BACKUP = 'claude-haiku-4-5';
    const { rungs } = build();
    expect(rungs.map(r => r.id)).toEqual(['iw-primary']);
  });

  it('accepts the shared dictionary key, so iw needs no new secret to run', () => {
    process.env.DICT_AI_API_KEY = 'shared';
    expect(build().rungs).toHaveLength(2);
  });

  it('prefers an iw-specific key over the shared one', () => {
    process.env.IW_ANTHROPIC_API_KEY = 'mine';
    process.env.DICT_AI_API_KEY = 'shared';
    expect(build().rungs).toHaveLength(2);
  });

  it('names every rung in the log so a deploy can be read at a glance', () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.DEEPSEEK_API_KEY = 'b';
    const { logs } = build();
    expect(logs).toContain('iw-primary');
    expect(logs).toContain('iw-cross-vendor');
    expect(logs).toContain('deepseek');
  });
});
