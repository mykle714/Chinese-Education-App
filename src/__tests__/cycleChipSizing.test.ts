/**
 * cycleChipSizing.test.ts — how a HeaderCycleChip sizes a long label and itself.
 *
 * The rule exists because a cycling chip is as wide as its longest label in EVERY state,
 * so one long word ("whisper", "default") sizes a control the learner is mostly looking at
 * in some other state. The tests below pin the two properties that make that acceptable:
 * short labels are left alone, and the chip's width is measured at what a shrunken label
 * actually occupies rather than at its raw character count.
 */

import { describe, it, expect } from 'vitest';
import { CYCLE_CHIP_FONT_PX, cycleChipFontPx, cycleChipWidthCh } from '../components/cycleChipSizing';

describe('cycleChipFontPx', () => {
  it('leaves a short label at full size', () => {
    for (const label of ['say', 'mute', 'shout', 'media']) {
      expect(cycleChipFontPx(label)).toBe(CYCLE_CHIP_FONT_PX);
    }
  });

  it('shrinks the long labels that actually forced the rule', () => {
    // 'default' is the audio chip's; 'whisper' is the removed iw volume chip's, kept as a
    // second seven-character case.
    expect(cycleChipFontPx('whisper')).toBeLessThan(CYCLE_CHIP_FONT_PX);
    expect(cycleChipFontPx('default')).toBe(cycleChipFontPx('whisper'));
  });

  it('never shrinks past the floor, however long the label', () => {
    // Past the floor the chip must widen instead — an unreadable label is not a saving.
    const tiny = cycleChipFontPx('extraordinarily');
    expect(tiny).toBe(8);
    expect(cycleChipFontPx('x'.repeat(60))).toBe(tiny);
  });
});

describe('cycleChipWidthCh', () => {
  it('is the longest label when nothing shrank', () => {
    expect(cycleChipWidthCh(['mute', 'media'])).toBe(5);
  });

  it('charges a shrunken label only what it occupies', () => {
    // 'whisper' is 7 characters but renders at 8/10 size, so it costs 5.6ch, not 7.
    expect(cycleChipWidthCh(['whisper'])).toBeCloseTo(5.6, 5);
  });

  it('gives two label sets with the same longest length the same width', () => {
    // A shared rule that sized two such chips differently would be a rule with a leak in it.
    expect(cycleChipWidthCh(['whisper', 'say', 'shout']))
      .toBeCloseTo(cycleChipWidthCh(['mute', 'default', 'media']), 5);
  });

  it('is driven by the widest RENDERED label, not the longest string', () => {
    // 'shout' (5 chars, full size) is wider than a label long enough to hit the floor
    // would be short of... so the check that matters is that shrinking can reorder them.
    expect(cycleChipWidthCh(['whisper', 'shout'])).toBeCloseTo(5.6, 5);
    expect(cycleChipWidthCh(['whisper', 'shouting'])).toBeGreaterThan(5.6);
  });
});
