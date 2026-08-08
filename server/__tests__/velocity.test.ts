import { describe, expect, it } from 'vitest';
import {
  bandsClimbed,
  categoryRank,
  CATEGORY_ORDER,
  computeUtcm,
  type MasteryGoals,
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
 * The multi-band case is not hypothetical: pbh is continuous, so one mark can cross
 * two boundaries at once. See the last test.
 */

/** Build a track with `n` correct marks. */
function track(n: number): ReviewMark[] {
  const at = '2026-01-01T00:00:00.000Z';
  return Array.from({ length: n }, () => ({ timestamp: at, isCorrect: true }));
}

const RECOGNITION_ONLY: MasteryGoals = { reading: false, writing: false };

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

describe('velocity at the mark boundary', () => {
  it('logs 1 for the mark that carries a card over a band boundary', () => {
    // Recognition-only goals: pbh == the recognition positive count, so the 3rd
    // correct mark crosses PBH_BAND.TARGET.
    const before: TypedMarkHistory = { recognition: track(2) };
    const after: TypedMarkHistory = { recognition: track(3) };
    const climbed = bandsClimbed(
      computeUtcm(before, RECOGNITION_ONLY),
      computeUtcm(after, RECOGNITION_ONLY)
    );
    expect(climbed).toBe(1);
  });

  it('logs 0 for a mark that stays inside a band (most marks)', () => {
    const before: TypedMarkHistory = { recognition: track(3) };
    const after: TypedMarkHistory = { recognition: track(4) };
    // Both sides band as 'Target' (3 and 4 correct are inside the same band).
    expect(computeUtcm(before, RECOGNITION_ONLY)).toBe('Target');
    expect(
      bandsClimbed(computeUtcm(before, RECOGNITION_ONLY), computeUtcm(after, RECOGNITION_ONLY))
    ).toBe(0);
  });

  it('logs 2 when one mark crosses two boundaries at once', () => {
    // With all four goals the second term (the non-max tracks / 9) can jump the
    // blend by more than a band in a single mark: a card sitting just under
    // Target with three maxed non-max tracks lands in Comfortable.
    const goals: MasteryGoals = { reading: true, writing: true };
    const before: TypedMarkHistory = {
      recognition: track(2),
      production: track(2),
      reading: track(2),
      writing: track(2),
    };
    // pbh(before) = 2 + (6/9) = 2.67 → Unfamiliar
    expect(computeUtcm(before, goals)).toBe('Unfamiliar');
    const after: TypedMarkHistory = {
      recognition: track(6),
      production: track(2),
      reading: track(2),
      writing: track(2),
    };
    // pbh(after) = 6 + (6/9) = 6.67 → Comfortable, two bands up.
    expect(computeUtcm(after, goals)).toBe('Comfortable');
    expect(bandsClimbed(computeUtcm(before, goals), computeUtcm(after, goals))).toBe(2);
  });
});
