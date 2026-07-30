import { describe, expect, it } from 'vitest';
import {
  appendTypedMark,
  categoryForPbh,
  computeTypeCategory,
  computeUtcm,
  goalTypes,
  masteryBar,
  PBH_BAND,
  PBH_FULL,
  PBH_MAX_TERM_CAP,
  perfectTypedMarkHistory,
  positiveCount,
  progressBarHeight,
  type MasteryGoals,
} from '../contracts/mastery.js';
import { MARK_TYPES, MARK_WINDOW_SIZE, type ReviewMark, type TypedMarkHistory } from '../contracts/wire.js';

/**
 * Tests for the pbh (progress-bar-height) formula — the definition of what
 * "Mastered" means (docs/MASTERY_REWORK.md).
 *
 * Why this file exists: the formula was implemented FOUR times (client TS, server TS,
 * SQL compute_utcm_category() in migration 101, SQL compute_type_category() in
 * migration 128) and had zero test coverage in any of its four homes. The two TS
 * copies are now one module; these tests pin its behaviour so the remaining SQL
 * functions — which the generated `vocabentries_*.category` column still depends on —
 * cannot drift away from it unnoticed.
 *
 * The cut points and the blend asserted here are the contract. If you deliberately
 * change them, you must change migrations 101 and 128 in the same commit.
 *
 * See docs/ARCHITECTURE_REVIEW.md findings 3 and 7.
 */

/** Build a track with `n` correct marks followed by `wrong` incorrect ones. */
function track(n: number, wrong = 0): ReviewMark[] {
  const at = '2026-01-01T00:00:00.000Z';
  return [
    ...Array.from({ length: n }, () => ({ timestamp: at, isCorrect: true })),
    ...Array.from({ length: wrong }, () => ({ timestamp: at, isCorrect: false })),
  ];
}

const BOTH: MasteryGoals = { reading: false, writing: false };
const ALL_FOUR: MasteryGoals = { reading: true, writing: true };

describe('positiveCount', () => {
  it('counts only correct marks', () => {
    expect(positiveCount(track(3, 5))).toBe(3);
  });

  it('treats a missing or malformed track as zero', () => {
    expect(positiveCount(undefined)).toBe(0);
    expect(positiveCount([])).toBe(0);
    // Defensive: the column is jsonb, so a non-array can reach here from bad data.
    expect(positiveCount('nonsense' as unknown as ReviewMark[])).toBe(0);
  });
});

describe('goalTypes', () => {
  it('always includes recognition and production', () => {
    expect(goalTypes(BOTH)).toEqual(['recognition', 'production']);
  });

  it('adds the opt-in goals', () => {
    expect(goalTypes({ reading: true, writing: false })).toEqual([
      'recognition',
      'production',
      'reading',
    ]);
    expect(goalTypes(ALL_FOUR)).toHaveLength(4);
  });
});

describe('progressBarHeight', () => {
  it('is zero with no history at all', () => {
    expect(progressBarHeight(undefined, BOTH)).toBe(0);
    expect(progressBarHeight({}, ALL_FOUR)).toBe(0);
  });

  it('blends max + remaining: min(6, max) + (sum - max) / ((goalCount - 1) * 3)', () => {
    // Two goals, recognition 4 / production 3 → min(6,4) + (7-4)/((2-1)*3) = 4 + 1 = 5
    const h: TypedMarkHistory = { recognition: track(4), production: track(3) };
    expect(progressBarHeight(h, BOTH)).toBe(5);
  });

  it('caps the leading term at PBH_MAX_TERM_CAP so one maxed track cannot master a card', () => {
    // Recognition maxed (8/8), production empty. First term caps at 6, second is 0.
    const h: TypedMarkHistory = { recognition: track(MARK_WINDOW_SIZE) };
    expect(progressBarHeight(h, BOTH)).toBe(PBH_MAX_TERM_CAP);
    // …and 6 is below the Mastered threshold, which is the whole point of the cap.
    expect(computeUtcm(h, BOTH)).not.toBe('Mastered');
  });

  it('ignores tracks that are not goals', () => {
    const h: TypedMarkHistory = { reading: track(8), writing: track(8) };
    // Neither is a goal under BOTH, so the card has made no progress.
    expect(progressBarHeight(h, BOTH)).toBe(0);
  });

  it('reweights when a goal is added — enabling a goal can DEMOTE a card', () => {
    const h: TypedMarkHistory = { recognition: track(8), production: track(8) };
    const withTwo = progressBarHeight(h, BOTH);
    const withFour = progressBarHeight(h, ALL_FOUR);
    expect(withTwo).toBeGreaterThan(withFour);
    expect(computeUtcm(h, BOTH)).toBe('Mastered');
    expect(computeUtcm(h, ALL_FOUR)).not.toBe('Mastered');
  });

  it('reaches Mastered when every goal track is maxed', () => {
    const h: TypedMarkHistory = {
      recognition: track(8),
      production: track(8),
      reading: track(8),
      writing: track(8),
    };
    expect(computeUtcm(h, ALL_FOUR)).toBe('Mastered');
  });
});

describe('categoryForPbh — the band cut points', () => {
  it('bands on [0,3) [3,6) [6,8) [8,∞)', () => {
    expect(categoryForPbh(0)).toBe('Unfamiliar');
    expect(categoryForPbh(PBH_BAND.TARGET - 0.001)).toBe('Unfamiliar');
    expect(categoryForPbh(PBH_BAND.TARGET)).toBe('Target');
    expect(categoryForPbh(PBH_BAND.COMFORTABLE - 0.001)).toBe('Target');
    expect(categoryForPbh(PBH_BAND.COMFORTABLE)).toBe('Comfortable');
    expect(categoryForPbh(PBH_FULL - 0.001)).toBe('Comfortable');
    expect(categoryForPbh(PBH_FULL)).toBe('Mastered');
  });

  it('pins the exact cut points that migrations 101 and 128 encode', () => {
    // Guard against a "harmless" retune here silently disagreeing with the SQL.
    expect(PBH_BAND.TARGET).toBe(3);
    expect(PBH_BAND.COMFORTABLE).toBe(6);
    expect(PBH_FULL).toBe(8);
    expect(PBH_MAX_TERM_CAP).toBe(6);
  });
});

describe('computeTypeCategory', () => {
  it('bands ONE track by its raw positive count, using the same cut points', () => {
    expect(computeTypeCategory({ reading: track(0) }, 'reading')).toBe('Unfamiliar');
    expect(computeTypeCategory({ reading: track(3) }, 'reading')).toBe('Target');
    expect(computeTypeCategory({ reading: track(6) }, 'reading')).toBe('Comfortable');
    expect(computeTypeCategory({ reading: track(8) }, 'reading')).toBe('Mastered');
  });

  it('is independent of the card\'s overall band', () => {
    // Writing is maxed, but with only that one track the card overall is capped at 6.
    const h: TypedMarkHistory = { writing: track(8) };
    expect(computeTypeCategory(h, 'writing')).toBe('Mastered');
    expect(computeUtcm(h, ALL_FOUR)).not.toBe('Mastered');
  });
});

describe('appendTypedMark', () => {
  const mark: ReviewMark = { timestamp: '2026-02-02T00:00:00.000Z', isCorrect: true };

  it('does not mutate the input', () => {
    const original: TypedMarkHistory = { recognition: track(1) };
    const snapshot = JSON.stringify(original);
    appendTypedMark(original, 'recognition', mark);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('keeps only the most recent MARK_WINDOW_SIZE marks', () => {
    let h: TypedMarkHistory = { recognition: track(MARK_WINDOW_SIZE) };
    h = appendTypedMark(h, 'recognition', { timestamp: 'newest', isCorrect: false });
    expect(h.recognition).toHaveLength(MARK_WINDOW_SIZE);
    expect(h.recognition!.at(-1)!.timestamp).toBe('newest');
    // The oldest correct mark fell out of the window, so the count dropped.
    expect(positiveCount(h.recognition)).toBe(MARK_WINDOW_SIZE - 1);
  });

  it('starts a track that does not exist yet', () => {
    const h = appendTypedMark(undefined, 'writing', mark);
    expect(h.writing).toEqual([mark]);
  });
});

describe('perfectTypedMarkHistory', () => {
  it('is Mastered under EVERY goal configuration', () => {
    const h = perfectTypedMarkHistory('2026-03-03T00:00:00.000Z');
    for (const goals of [
      BOTH,
      { reading: true, writing: false },
      { reading: false, writing: true },
      ALL_FOUR,
    ]) {
      expect(computeUtcm(h, goals)).toBe('Mastered');
    }
  });

  it('fills all four tracks to the window size', () => {
    const h = perfectTypedMarkHistory('t');
    for (const type of MARK_TYPES) {
      expect(h[type]).toHaveLength(MARK_WINDOW_SIZE);
    }
  });
});

describe('masteryBar', () => {
  it('composes over ALL types, not just the goal types', () => {
    const h: TypedMarkHistory = { recognition: track(2), reading: track(2) };
    const bar = masteryBar(h, BOTH); // reading is NOT a goal here
    const reading = bar.segments.find((s) => s.type === 'reading')!;
    expect(reading.positive).toBe(2);
    expect(reading.fraction).toBeCloseTo(0.5);
  });

  it('clamps the fill fraction at 1 even when pbh overshoots PBH_FULL', () => {
    const h: TypedMarkHistory = {
      recognition: track(8),
      production: track(8),
      reading: track(8),
      writing: track(8),
    };
    const bar = masteryBar(h, ALL_FOUR);
    expect(bar.pbh).toBeGreaterThan(PBH_FULL); // the formula's range tops out ~8.67
    expect(bar.heightFraction).toBe(1);
  });

  it('reports zero fractions rather than NaN when there is nothing yet', () => {
    const bar = masteryBar(undefined, BOTH);
    expect(bar.segments.every((s) => s.fraction === 0)).toBe(true);
    expect(bar.heightFraction).toBe(0);
    expect(bar.category).toBe('Unfamiliar');
  });
});
