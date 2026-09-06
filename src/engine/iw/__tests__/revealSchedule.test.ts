/**
 * revealSchedule.test.ts — the glyph pacing behind § 5.3a's typewriter.
 *
 * The properties worth pinning are the ones a rewrite could plausibly break without looking
 * broken: that the first glyph is never late, that punctuation delays what FOLLOWS it rather
 * than itself, and that the audio-paced and timer-paced paths differ only in their duration.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateSpeechMs,
  glyphsVisibleAt,
  IW_TIMER_GLYPHS_PER_SEC,
  planGlyphReveal,
  revealedText,
  toGlyphs,
} from '../revealSchedule';

describe('planGlyphReveal', () => {
  it('paints the first glyph the instant the voice starts', () => {
    // The whole point of audio-as-clock: nothing is on screen ahead of the voice, and nothing
    // lags behind it either.
    expect(planGlyphReveal('好的，请坐', 2000)[0]).toBe(0);
  });

  it('gives one entry per glyph', () => {
    expect(planGlyphReveal('要几碗？', 1000)).toHaveLength(4);
  });

  it('spaces an unpunctuated line evenly', () => {
    // With every glyph the same weight the schedule degenerates to § 6.4 rule 3's
    // duration / glyphCount, which is the behaviour the weights are an exception to.
    expect(planGlyphReveal('一二三四', 4000)).toEqual([0, 1000, 2000, 3000]);
  });

  it('never goes backwards', () => {
    const schedule = planGlyphReveal('好的，请坐。谢谢！', 3000);
    for (let i = 1; i < schedule.length; i++) expect(schedule[i]).toBeGreaterThanOrEqual(schedule[i - 1]);
  });

  it('delays the glyph AFTER a comma, not the comma itself', () => {
    // The reason the weight is applied as "everything before me": a comma the learner has to
    // wait for reads as a dropped frame, while a pause after it reads as a breath.
    // Compared as GAPS, not as absolute offsets: adding a comma lengthens the whole line, so
    // every glyph before it lands slightly earlier within a fixed duration.
    const schedule = planGlyphReveal('一二，三', 4000);
    const beforeComma = schedule[2] - schedule[1]; // 二 → ，
    const afterComma = schedule[3] - schedule[2];  // ， → 三
    expect(afterComma).toBeGreaterThan(beforeComma * 2);
  });

  it('finishes within the duration it was given', () => {
    const schedule = planGlyphReveal('不好意思，厨房做错了菜。', 5000);
    expect(schedule[schedule.length - 1]).toBeLessThan(5000);
  });

  it('falls back to the estimated cadence when the duration is unusable', () => {
    // A decoder that hands back 0 or NaN must not dump the whole sentence at once.
    for (const bad of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const schedule = planGlyphReveal('要几碗？', bad as number | undefined);
      expect(schedule).toEqual(planGlyphReveal('要几碗？', estimateSpeechMs('要几碗？')));
    }
  });

  it('is empty for an empty line', () => {
    expect(planGlyphReveal('', 1000)).toEqual([]);
  });

  it('counts an astral character as one glyph', () => {
    expect(planGlyphReveal('好😀好', 300)).toHaveLength(3);
  });
});

describe('estimateSpeechMs', () => {
  it('runs at the stated cadence for plain syllables', () => {
    expect(estimateSpeechMs('一二三四五')).toBe(Math.round((5 / IW_TIMER_GLYPHS_PER_SEC) * 1000));
  });

  it('gives a punctuated line MORE time, not less', () => {
    // Otherwise the fallback would race the audio-paced path on exactly the lines where the
    // two are most visibly different — and § 5.3a requires them to be indistinguishable.
    expect(estimateSpeechMs('好的，请坐')).toBeGreaterThan(estimateSpeechMs('好的请坐'));
  });

  it('does not spend a full syllable on each latin letter', () => {
    expect(estimateSpeechMs('OK')).toBeLessThan(estimateSpeechMs('好的'));
  });
});

describe('glyphsVisibleAt / revealedText', () => {
  const text = '一二三四';
  const schedule = planGlyphReveal(text, 4000);

  it('shows nothing before the first glyph is due', () => {
    expect(glyphsVisibleAt([100, 200], 0)).toBe(0);
  });

  it('reveals a glyph exactly ON its offset', () => {
    expect(glyphsVisibleAt(schedule, 1000)).toBe(2);
  });

  it('shows the whole line once the duration has passed', () => {
    expect(revealedText(text, schedule, 99_999)).toBe(text);
  });

  it('slices by glyph, never mid-character', () => {
    const astral = '好😀好';
    const plan = planGlyphReveal(astral, 300);
    expect(toGlyphs(revealedText(astral, plan, 150)).every(g => astral.includes(g))).toBe(true);
    expect(revealedText(astral, plan, 150)).toBe('好😀');
  });
});
