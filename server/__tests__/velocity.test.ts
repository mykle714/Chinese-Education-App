import { describe, expect, it } from 'vitest';
import {
  bandsClimbed,
  barCategory,
  barForMarkType,
  categoryRank,
  CATEGORY_ORDER,
} from '../contracts/mastery.js';
import type { ReviewMark, TypedMarkHistory } from '../contracts/wire.js';

/**
 * Tests for the band-step arithmetic behind VELOCITY (docs/VELOCITY.md).
 *
 * Velocity sums `bandsClimbed(before, after)` over the last 7 days. Everything
 * about the number's meaning rests on this one function, and it is called at the
 * single moment a promotion is observable (inside POST /api/flashcards/mark) — a
 * mistake here silently mis-scores the log forever, because the log is the only
 * record that the move happened.
 *
 * The multi-band case is not hypothetical: the core pbh is continuous, so one mark
 * can cross two boundaries at once. See the last test.
 *
 * Since migration 143 a promotion is measured on the bar the MARK belongs to, not on
 * a single whole-card band — the mark handler pairs `barForMarkType` with
 * `barCategory` either side of the write.
 */

/** Build a track with `n` correct marks. */
function track(n: number): ReviewMark[] {
  const at = '2026-01-01T00:00:00.000Z';
  return Array.from({ length: n }, () => ({ timestamp: at, isCorrect: true }));
}

describe('categoryRank', () => {
  it('ranks the bands in ascending mastery order', () => {
    expect(CATEGORY_ORDER.map(categoryRank)).toEqual([0, 1, 2, 3]);
  });

  it('ranks unknown or missing input as 0 rather than throwing', () => {
    // The value arrives from a jsonb-derived compute, so defend against junk.
    expect(categoryRank(undefined)).toBe(0);
    expect(categoryRank('Nonsense')).toBe(0);
  });
});

describe('bandsClimbed', () => {
  it('counts a single-band promotion as 1', () => {
    expect(bandsClimbed('Unfamiliar', 'Target')).toBe(1);
    expect(bandsClimbed('Comfortable', 'Mastered')).toBe(1);
  });

  it('counts a multi-band promotion by its distance', () => {
    expect(bandsClimbed('Unfamiliar', 'Comfortable')).toBe(2);
    expect(bandsClimbed('Unfamiliar', 'Mastered')).toBe(3);
  });

  it('returns 0 when the band did not change', () => {
    expect(bandsClimbed('Target', 'Target')).toBe(0);
  });

  it('returns 0 for a demotion — velocity never goes down', () => {
    expect(bandsClimbed('Mastered', 'Target')).toBe(0);
    expect(bandsClimbed('Comfortable', 'Unfamiliar')).toBe(0);
  });
});

/** What the mark handler computes: the step size on the bar the mark landed in. */
function stepsFor(
  before: TypedMarkHistory,
  after: TypedMarkHistory,
  markType: Parameters<typeof barForMarkType>[0]
): number {
  const bar = barForMarkType(markType);
  return bandsClimbed(barCategory(before, bar), barCategory(after, bar));
}

describe('velocity at the mark boundary', () => {
  it('logs 1 for the mark that carries a card over a band boundary', () => {
    // Recognition only, so the core pbh == the recognition count: the 3rd correct
    // mark crosses PBH_BAND.TARGET.
    const before: TypedMarkHistory = { recognition: track(2) };
    const after: TypedMarkHistory = { recognition: track(3) };
    expect(stepsFor(before, after, 'recognition')).toBe(1);
  });

  it('logs 0 for a mark that stays inside a band (most marks)', () => {
    const before: TypedMarkHistory = { recognition: track(3) };
    const after: TypedMarkHistory = { recognition: track(4) };
    // Both sides band as 'Target' (3 and 4 correct are inside the same band).
    expect(barCategory(before, 'core')).toBe('Target');
    expect(stepsFor(before, after, 'recognition')).toBe(0);
  });

  it('logs 2 when one mark crosses two boundaries at once', () => {
    // The core blend is continuous, so a single mark can jump more than one band.
    // Here production is parked at 2 (contributing a flat 2/3) while recognition
    // climbs from 2 to 6 — which is a realistic Bubble Match streak, not a contrived
    // history, and is why the log stores the step size instead of assuming 1.
    const before: TypedMarkHistory = { recognition: track(2), production: track(2) };
    const after: TypedMarkHistory = { recognition: track(6), production: track(2) };
    // pbh(before) = 2 + 2/3 = 2.67 → Unfamiliar
    expect(barCategory(before, 'core')).toBe('Unfamiliar');
    // pbh(after)  = 6 + 2/3 = 6.67 → Comfortable, two bands up.
    expect(barCategory(after, 'core')).toBe('Comfortable');
    expect(stepsFor(before, after, 'recognition')).toBe(2);
  });

  it('scores a reading mark on the READING bar, not the core one', () => {
    // The core bar sees nothing here; velocity would log 0 if it banded the card as
    // a whole, which is exactly the progress the three-bar model set out to count.
    const before: TypedMarkHistory = { reading: track(2) };
    const after: TypedMarkHistory = { reading: track(3) };
    expect(stepsFor(before, after, 'reading')).toBe(1);
    expect(bandsClimbed(barCategory(before, 'core'), barCategory(after, 'core'))).toBe(0);
  });
});
