import { describe, expect, it } from 'vitest';
import { createLineSink, renderLineDirection } from '../services/iw/lineRender.js';
import { renderLineContract, renderLineWorldRules, IW_WORLD_RULES_STEM } from '../services/iw/worldRules.js';
import { IWTurnBudget } from '../services/iw/turnBudget.js';

/**
 * § 14 Q42 — an authored direction becomes a line the NPC would actually say.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 14 Q42.
 */

const ctx = {
  knownWords: ['你好', '谢谢'],
  nearby: [{ label: 'the learner', distance: 1, facingYou: true }],
  heard: [{ speaker: 'the learner', text: '想点菜了' }],
};

describe('renderLineDirection', () => {
  it('quotes the direction and says plainly that it is not a line to translate', () => {
    const out = renderLineDirection({ ...ctx, direction: 'tell them the fish is finished' });
    expect(out).toContain('"tell them the fish is finished"');
    expect(out).toContain('Not words anyone');
  });

  it('carries the same perception a turn does, so memory cannot drift between the two', () => {
    const out = renderLineDirection({ ...ctx, direction: 'greet them' });
    expect(out).toContain('KNOWN_WORDS: 你好, 谢谢');
    expect(out).toContain('the learner said: "想点菜了"');
    expect(out).toContain('the learner at 1 tiles, facing you');
  });

  it('never offers silence — the beat is authored, so the NPC speaks', () => {
    const out = renderLineDirection({ ...ctx, direction: 'greet them' });
    // A turn's closer makes NOTHING a legal answer. A render's must not.
    expect(out).not.toContain('say NOTHING');
    expect(out).toContain('Say it now, in Chinese');
  });

  it('names who the line is aimed at when there is one, and hands the choice over when there is not', () => {
    expect(renderLineDirection({ ...ctx, direction: 'greet them', toward: '老周' }))
      .toContain('You are saying it to 老周.');
    const untargeted = renderLineDirection({ ...ctx, direction: 'greet them' });
    expect(untargeted).not.toContain('You are saying it to');
    // ⚠️ An omitted addressee is a CHOICE, not silence about one (2026-09-19) — a
    // `prompt_npc` cue leaves it out precisely when the right person depends on the moment.
    expect(untargeted).toContain('Decide who you are saying it to');
  });
});

/**
 * The UNBRIEFED cue (2026-09-19) — a `prompt_npc` step that names a speaker and nothing else.
 *
 * Referenced by: docs/IMMERSIVE_WORLD.md § 14 Q45.
 */
describe('renderLineDirection with no direction', () => {
  it('asks for an intention instead of quoting an empty one', () => {
    const out = renderLineDirection({ ...ctx });
    // The bug this guards: rendering `""` as "what you mean to say" asks a model to perform
    // a blank, which is exactly the confused non-answer it reads as.
    expect(out).not.toContain('WHAT YOU MEAN TO SAY');
    expect(out).not.toContain('""');
    expect(out).toContain('IT IS YOUR MOMENT TO SPEAK');
  });

  it('treats a whitespace-only direction as no direction at all', () => {
    expect(renderLineDirection({ ...ctx, direction: '   ' })).toContain('IT IS YOUR MOMENT TO SPEAK');
  });

  it('still carries the same perception, so the unbriefed line is grounded rather than invented', () => {
    const out = renderLineDirection({ ...ctx });
    expect(out).toContain('the learner said: "想点菜了"');
    expect(out).toContain('Say it now, in Chinese');
  });
});

describe('the one-line contract', () => {
  it('shares layer 1 byte-for-byte with a turn, so both hit the same cached prefix', () => {
    const [before, after] = IW_WORLD_RULES_STEM.split('__CONTRACT__');
    const rendered = renderLineWorldRules();
    expect(rendered.startsWith(before)).toBe(true);
    expect(rendered.endsWith(after)).toBe(true);
  });

  it('asks for one line and forbids English', () => {
    const contract = renderLineContract();
    expect(contract).toContain('exactly ONE line of Chinese');
    expect(contract).toContain('no English');
  });
});

describe('createLineSink', () => {
  const drain = (chunks: string[]) => {
    const sink = createLineSink();
    let last = { text: '', complete: false };
    for (const c of chunks) last = sink.push(c);
    return { progress: last, ...sink.finish() };
  };

  it('accumulates a line split across arbitrary fragment boundaries', () => {
    // Fragments never respect characters, let alone lines — see IWModelRung.
    expect(drain(['鱼', '卖完', '了。']).value).toBe('鱼卖完了。');
  });

  it('reports complete on the newline that closes the line, which is when TTS fires', () => {
    const sink = createLineSink();
    expect(sink.push('鱼卖完了。').complete).toBe(false);
    expect(sink.push('\n').complete).toBe(true);
  });

  it('keeps only the first line when the model volunteers a second', () => {
    expect(drain(['鱼卖完了。\nneutral\n']).value).toBe('鱼卖完了。');
  });

  it('strips a volunteered fence, a speaker label and wrapping quotes', () => {
    expect(drain(['```\n鱼卖完了。\n```']).value).toBe('鱼卖完了。');
    expect(drain(['王婶：鱼卖完了。']).value).toBe('鱼卖完了。');
    expect(drain(['"鱼卖完了。"']).value).toBe('鱼卖完了。');
  });

  it('strips a short prefix before a 冒号 — parity with turnParser, INCLUDING its flaw', () => {
    // ⚠️ `turnParser.stripSpeechDecoration`'s own comment claims the 8-character cap means
    // "他说：不行" survives as speech. It does not: 他说 is two characters, so the label rule
    // eats it there and here. This test pins the ACTUAL shared behaviour rather than the
    // documented intent, so the day somebody fixes the rule both parsers move together and
    // this test is the thing that says so.
    expect(drain(['他说：不行']).value).toBe('不行');
    // A prefix past the cap is left alone, which is the half of the rule that does work.
    expect(drain(['这是一句非常非常长的话：不行']).value).toBe('这是一句非常非常长的话：不行');
  });

  it('fails ONLY on an empty buffer, which is what makes the ladder try the next rung', () => {
    expect(drain([]).failed).toBe(true);
    expect(drain(['   \n\n']).failed).toBe(true);
    expect(drain(['好']).failed).toBe(false);
  });
});

describe('IWTurnBudget — a render is billed differently from a turn (§ 14 Q42)', () => {
  it('does not touch the session budget, so authored beats cannot close the market early', () => {
    const budget = new IWTurnBudget(() => 1_000_000);
    budget.spendSceneCall('u1');
    budget.spendSceneCall('u1');
    expect(budget.remaining('s1')).toBe(60);
  });

  it('does not arm the learner rate gap, so their next sentence is not refused as too fast', () => {
    let now = 1_000_000;
    const budget = new IWTurnBudget(() => now);
    budget.spendSceneCall('u1');
    now += 10;
    expect(budget.check('u1', 's1', '你好').refusal).toBeNull();
  });

  it('does count against the daily cap, which is the money bound', () => {
    const budget = new IWTurnBudget(() => 1_000_000);
    for (let i = 0; i < 400; i++) budget.spendSceneCall('u1');
    expect(budget.checkSceneCall('u1')?.code).toBe('daily-cap');
  });

  it('leaves a real turn gap alone when a render lands after it', () => {
    let now = 1_000_000;
    const budget = new IWTurnBudget(() => now);
    budget.spend('u1', 's1');
    budget.spendSceneCall('u1');
    now += 10;
    // The turn's gap must still bite — spendSceneCall must not have cleared `lastTurnAt`.
    expect(budget.check('u1', 's1', '你好').refusal?.code).toBe('too-fast');
  });
});
