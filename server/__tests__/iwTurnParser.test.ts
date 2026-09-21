/**
 * iwTurnParser.test.ts — the streaming three-line parser (§ 5.1, § 5.3).
 *
 * The table in § 5.3 lists the inputs a model has actually produced or plausibly would; each
 * row is a test here. The property that matters most is the last describe block's: NOTHING
 * throws, for any input at all, because this code runs in front of a player watching a bubble.
 */

import { describe, it, expect } from 'vitest';
import { createTurnParser, parseTurnReply } from '../services/iw/turnParser.js';
import { IW_NO_ACTION } from '../contracts/iw.js';

const OFFERED = ['take the order', 'bring water', 'wipe the counter'];

describe('parseTurnReply — the § 5.3 table', () => {
  it('parses a clean three-line reply', () => {
    const r = parseTurnReply('热的还是凉的？\ntake the order\npleased', OFFERED);
    expect(r).toEqual({
      say: '热的还是凉的？', action: 'take the order', emote: 'pleased', rescued: [], failed: false,
      // A turn that was not collecting has no fourth line to read (§ 5.4).
      collected: false,
    });
  });

  it('parses through extra blank lines between fields', () => {
    const r = parseTurnReply('热的还是凉的？\n\n\ntake the order\n\npleased\n', OFFERED);
    expect(r.say).toBe('热的还是凉的？');
    expect(r.action).toBe('take the order');
    expect(r.emote).toBe('pleased');
  });

  it('strips a speaker label', () => {
    const r = parseTurnReply('王婶：热的还是凉的？\ntake the order\npleased', OFFERED);
    expect(r.say).toBe('热的还是凉的？');
    expect(r.rescued).toContain('stripped label/quotes');
  });

  it('strips wrapping quotes', () => {
    expect(parseTurnReply('"热的还是凉的？"\nbring water\namused', OFFERED).say).toBe('热的还是凉的？');
  });

  it('does NOT eat a real sentence containing a colon', () => {
    // The label pattern is capped at 8 chars before the colon precisely for this.
    const say = '他跟我说过好几次了：不行';
    expect(parseTurnReply(`${say}\nbring water\nneutral`, OFFERED).say).toBe(say);
  });

  it('defaults the emote when the third line is missing', () => {
    const r = parseTurnReply('好的\ntake the order', OFFERED);
    expect(r.emote).toBe('neutral');
    expect(r.rescued).toContain('no legal emote line → neutral');
  });

  it('degrades an invented action to none', () => {
    const r = parseTurnReply('好的\nponder deeply\npleased', OFFERED);
    expect(r.action).toBe(IW_NO_ACTION);
    expect(r.rescued).toContain(`no legal action line → ${IW_NO_ACTION}`);
  });

  it('sniffs and parses a fenced JSON object', () => {
    const raw = '```json\n{"say": "热的还是凉的？", "action": "bring water", "emote": "curious"}\n```';
    const r = parseTurnReply(raw, OFFERED);
    expect(r.say).toBe('热的还是凉的？');
    expect(r.action).toBe('bring water');
    expect(r.emote).toBe('curious');
    expect(r.rescued).toContain('emitted JSON, not lines');
  });

  it('rejects an illegal action even inside a JSON envelope', () => {
    const r = parseTurnReply('{"say":"x","action":"fly away","emote":"curious"}', OFFERED);
    expect(r.action).toBe(IW_NO_ACTION);
  });

  it('keeps the speech when only line 1 arrived, applying both defaults', () => {
    const r = parseTurnReply('热的还是凉的？', OFFERED);
    expect(r.say).toBe('热的还是凉的？');
    expect(r.action).toBe(IW_NO_ACTION);
    expect(r.emote).toBe('neutral');
    expect(r.failed).toBe(false);
  });

  it('treats an empty reply as the ONLY true failure', () => {
    for (const raw of ['', '   ', '\n\n']) {
      const r = parseTurnReply(raw, OFFERED);
      expect(r.failed).toBe(true);
      expect(r.rescued).toContain('empty reply');
    }
  });

  it('turns NOTHING into silence, which is a normal reply and not a failure', () => {
    const r = parseTurnReply('NOTHING\ntake the order\nneutral', OFFERED);
    expect(r.say).toBe('');
    expect(r.failed).toBe(false);
    expect(r.action).toBe('take the order');
  });

  it('scans rather than indexing, so an inserted line does not shift the fields', () => {
    const r = parseTurnReply('好的\n(considering)\nbring water\nimpatient', OFFERED);
    expect(r.action).toBe('bring water');
    expect(r.emote).toBe('impatient');
    expect(r.rescued).toContain('extra lines');
  });

  it('matches a WHOLE action name, spaces included', () => {
    // An action is a name now (Q42), not a verb token: matching the first token would find
    // nothing here, and matching a prefix would confuse "bring water" with "bring".
    expect(parseTurnReply('好\nwipe the counter\nneutral', OFFERED).action).toBe('wipe the counter');
    expect(parseTurnReply('好\nwipe\nneutral', OFFERED).action).toBe(IW_NO_ACTION);
  });

  it('offers nothing when the caller offers nothing', () => {
    expect(parseTurnReply('好的\ntake the order\npleased', []).action).toBe(IW_NO_ACTION);
  });

  it('records what it rescued so a metric can report cleanAction, not legalAction', () => {
    expect(parseTurnReply('好的\ntake the order\npleased', OFFERED).rescued).toEqual([]);
    expect(parseTurnReply('好的\nnonsense\nnonsense', OFFERED).rescued.length).toBe(2);
  });
});

describe('createTurnParser — streaming', () => {
  it('paints the bubble from the first delta, before the turn is done', () => {
    const p = createTurnParser(OFFERED);
    expect(p.push('热').say).toBe('热');
    expect(p.push('的还').say).toBe('热的还');
    expect(p.push('是凉的？').say).toBe('热的还是凉的？');
  });

  it('reports speechComplete only once the newline closing line 1 arrives', () => {
    const p = createTurnParser(OFFERED);
    expect(p.push('热的还是凉的？').speechComplete).toBe(false);
    expect(p.push('\n').speechComplete).toBe(true);
  });

  it('survives a delta splitting anywhere in the reply', () => {
    const full = '热的还是凉的？\ntake the order\npleased';
    for (let cut = 1; cut < full.length; cut++) {
      const p = createTurnParser(OFFERED);
      p.push(full.slice(0, cut));
      p.push(full.slice(cut));
      expect(p.finish().say).toBe('热的还是凉的？');
      expect(p.finish().action).toBe('take the order');
    }
  });

  it('does not blank the bubble on a partial NOTHING', () => {
    // "NOTH" must not read as silence — that would flicker the bubble.
    const p = createTurnParser(OFFERED);
    expect(p.push('NOTH').say).toBe('NOTH');
    expect(p.push('ING').say).toBe('');
  });

  it('does not treat a volunteered fence as speech', () => {
    const p = createTurnParser(OFFERED);
    expect(p.push('```json').say).toBe('');
  });

  it('finish() is callable before the stream ends and again after', () => {
    const p = createTurnParser(OFFERED);
    p.push('好的\n');
    expect(p.finish().say).toBe('好的');
    p.push('bring water\nneutral');
    expect(p.finish().action).toBe('bring water');
    expect(p.finish().action).toBe('bring water');
  });

  it('keeps the raw buffer for logging a reply that went wrong', () => {
    const p = createTurnParser(OFFERED);
    p.push('a');
    p.push('b');
    expect(p.raw()).toBe('ab');
  });
});

describe('it has no error path — only degraded outputs', () => {
  const nasty = [
    '', ' ', '\n', '\t', '```', '```\n```', '{', '{]', '{"say":', 'null', '[]',
    '{"say":null,"action":null,"emote":null}', '：：：', '"""', 'a'.repeat(10000),
    '\n'.repeat(500), '{"say":"x"}\n{"say":"y"}', 'NOTHING', '：x',
  ];
  it('never throws, for any input', () => {
    for (const raw of nasty) {
      expect(() => parseTurnReply(raw, OFFERED)).not.toThrow();
      const p = createTurnParser(OFFERED);
      expect(() => { p.push(raw); p.finish(); }).not.toThrow();
    }
  });

  it('always returns a legal action and a legal emote', () => {
    for (const raw of nasty) {
      const r = parseTurnReply(raw, OFFERED);
      expect([...OFFERED, IW_NO_ACTION]).toContain(r.action);
      expect(['neutral', 'curious', 'pleased', 'confused', 'impatient', 'amused']).toContain(r.emote);
      expect(typeof r.say).toBe('string');
    }
  });
});

describe('the optional fourth line — a get_information turn (§ 5.4)', () => {
  it('reads `got: yes` as the errand being finished', () => {
    const reply = parseTurnReply('要几个？\nnone\ncurious\ngot: yes', []);
    expect(reply.collected).toBe(true);
    // And it is NOT reported as drift — a fourth line is the contract on these turns.
    expect(reply.rescued).not.toContain('extra lines');
  });

  it('reads `got: no`, and a missing line, as not yet', () => {
    expect(parseTurnReply('要几个？\nnone\ncurious\ngot: no', []).collected).toBe(false);
    // The safe direction: a model that drops the line costs one more exchange, never an
    // errand that ends without anybody having answered it.
    expect(parseTurnReply('要几个？\nnone\ncurious', []).collected).toBe(false);
  });

  it('tolerates the 冒号 and a stray blank line, like every other line rule', () => {
    expect(parseTurnReply('好的\n\nnone\nhappy\nGot：Yes', []).collected).toBe(true);
  });

  it('does not mistake speech for the verdict', () => {
    // "no" alone is a perfectly good thing for an NPC to say; only the LABEL counts.
    expect(parseTurnReply('no\nnone\nneutral', []).collected).toBe(false);
  });
});
