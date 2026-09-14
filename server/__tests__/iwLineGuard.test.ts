/**
 * lineGuard.test.ts — what an NPC is allowed to say out loud.
 *
 * The cases are the mechanical failure modes § 5.6 actually measured (a reply in the wrong
 * language, formatting that leaked out of the contract), plus the ones that would silence
 * CORRECT speech if the check were drawn too tight — which is the more expensive mistake,
 * because it presents as an NPC who has gone mute.
 */

import { describe, it, expect } from 'vitest';
import { guardNpcLine } from '../contracts/iwLineGuard.js';

const ok = (text: string, lang: 'zh' | 'es' = 'zh') => guardNpcLine(text, lang);

describe('guardNpcLine — what passes', () => {
  it('passes an ordinary Chinese line', () => {
    expect(ok('热的还是凉的？')).toEqual({ ok: true, text: '热的还是凉的？' });
  });

  it('trims surrounding whitespace', () => {
    expect(ok('  要几碗？  ')).toEqual({ ok: true, text: '要几碗？' });
  });

  it('allows a number inside a Chinese line', () => {
    expect(ok('一共15块').ok).toBe(true);
  });

  it('allows a short borrowing like OK', () => {
    // Drawn tighter, this would silence a line the NPC would really say — and a mute NPC is
    // a worse failure than a slightly-mixed one.
    expect(ok('OK，请坐').ok).toBe(true);
  });

  it('passes a Spanish line', () => {
    expect(ok('¿Cuántos platos?', 'es').ok).toBe(true);
  });
});

describe('guardNpcLine — what is silenced', () => {
  it('rejects an English reply in a Chinese scene', () => {
    // The failure § 5.6 measured. The learner sees the NPC react without speaking, not a
    // bubble of English.
    expect(ok('Sure, how many bowls would you like?').ok).toBe(false);
  });

  it('rejects a Chinese reply in a Spanish scene', () => {
    expect(ok('好的', 'es').ok).toBe(false);
  });

  it('rejects an empty or whitespace-only line', () => {
    expect(ok('').ok).toBe(false);
    expect(ok('   \n ').ok).toBe(false);
  });

  it('rejects a line with no content characters at all', () => {
    expect(ok('？！……').ok).toBe(false);
  });

  it('strips a leaked code fence rather than speaking it', () => {
    expect(ok('```好的```')).toEqual({ ok: true, text: '好的' });
  });

  it('strips zero-width and bidi characters', () => {
    // A bidi override in a bubble would reverse the rest of the line on screen.
    expect(ok(`好${'​'}${'‮'}的`)).toEqual({ ok: true, text: '好的' });
  });

  it('rejects a line that is mostly latin with a token hanzi', () => {
    expect(ok('好 this is the answer you wanted').ok).toBe(false);
  });
});
