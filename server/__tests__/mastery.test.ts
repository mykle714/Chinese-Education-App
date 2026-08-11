import { describe, expect, it } from 'vitest';
import {
  activeBars,
  appendTypedMark,
  barCategory,
  barForMarkType,
  barProgressBarHeight,
  categoryForPbh,
  computeCoreCategory,
  computeTypeCategory,
  coreProgressBarHeight,
  masteredAtForBar,
  masteryBar,
  masteryBars,
  PBH_BAND,
  PBH_FULL,
  PBH_MAX_TERM_CAP,
  coreMasteredTypedMarkHistory,
  positiveCount,
  type MasteryGoals,
} from '../contracts/mastery.js';
import {
  MARK_TYPES,
  MARK_WINDOW_SIZE,
  type ReviewMark,
  type TypedMarkHistory,
} from '../contracts/wire.js';

/**
 * Tests for the pbh (progress-bar-height) formula and the THREE mastery bars — the
 * definition of what "Mastered" means (docs/MASTERY_REWORK.md).
 *
 * Why this file exists: the formula was implemented FOUR times (client TS, server TS,
 * SQL compute_utcm_category() in migration 101, SQL compute_type_category() in
 * migration 128) and had zero test coverage in any of its four homes. The two TS
 * copies are now one module; these tests pin its behaviour so the SQL functions the
 * selection queries band with cannot drift away from it unnoticed.
 *
 * The cut points and the blend asserted here are the contract. If you deliberately
 * change them, you must change migrations 128 and 143 in the same commit.
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

const NO_GOALS: MasteryGoals = { reading: false, writing: false };
const ALL_GOALS: MasteryGoals = { reading: true, writing: true };

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

describe('activeBars', () => {
  it('always includes core', () => {
    expect(activeBars(NO_GOALS)).toEqual(['core']);
  });

  it('adds a bar per opt-in goal, core first', () => {
    expect(activeBars({ reading: true, writing: false })).toEqual(['core', 'reading']);
    expect(activeBars(ALL_GOALS)).toEqual(['core', 'reading', 'writing']);
  });
});

describe('barForMarkType', () => {
  it('maps every mark type into exactly one bar', () => {
    expect(barForMarkType('recognition')).toBe('core');
    expect(barForMarkType('production')).toBe('core');
    expect(barForMarkType('reading')).toBe('reading');
    expect(barForMarkType('writing')).toBe('writing');
    // Totality matters: the mark handler assumes one mark moves exactly one bar.
    expect(MARK_TYPES.map(barForMarkType)).toHaveLength(MARK_TYPES.length);
  });
});

describe('coreProgressBarHeight', () => {
  it('is zero with no history at all', () => {
    expect(coreProgressBarHeight(undefined)).toBe(0);
    expect(coreProgressBarHeight({})).toBe(0);
  });

  it('blends the two core tracks: min(6, max) + min / 3', () => {
    // recognition 4 / production 3 → min(6,4) + 3/3 = 4 + 1 = 5
    const h: TypedMarkHistory = { recognition: track(4), production: track(3) };
    expect(coreProgressBarHeight(h)).toBe(5);
  });

  it('caps the leading term at PBH_MAX_TERM_CAP so one maxed track cannot master a card', () => {
    // Recognition maxed (8/8), production empty. First term caps at 6, second is 0.
    const h: TypedMarkHistory = { recognition: track(MARK_WINDOW_SIZE) };
    expect(coreProgressBarHeight(h)).toBe(PBH_MAX_TERM_CAP);
    // …and 6 is below the Mastered threshold, which is the whole point of the cap.
    expect(computeCoreCategory(h)).not.toBe('Mastered');
  });

  it('ignores reading and writing entirely', () => {
    const h: TypedMarkHistory = { reading: track(8), writing: track(8) };
    expect(coreProgressBarHeight(h)).toBe(0);
  });

  it('is GOAL-INDEPENDENT: enabling a goal can no longer demote a card', () => {
    // This is the defect migration 143 exists to fix. Under the old goal-blended pbh
    // this same history was Mastered with two goals and Comfortable with four.
    const h: TypedMarkHistory = { recognition: track(8), production: track(8) };
    expect(computeCoreCategory(h)).toBe('Mastered');
    for (const goals of [NO_GOALS, { reading: true, writing: false }, ALL_GOALS]) {
      expect(barCategory(h, 'core')).toBe('Mastered');
      expect(activeBars(goals)[0]).toBe('core');
    }
  });
});

describe('barProgressBarHeight / barCategory — the reading and writing bars', () => {
  it('measures a single-track bar by its raw positive count', () => {
    const h: TypedMarkHistory = { reading: track(5) };
    expect(barProgressBarHeight(h, 'reading')).toBe(5);
    expect(barCategory(h, 'reading')).toBe('Target');
  });

  it('is full at a perfect window — a card can be mastered in each bar separately', () => {
    const h: TypedMarkHistory = { reading: track(MARK_WINDOW_SIZE) };
    expect(barProgressBarHeight(h, 'reading')).toBe(PBH_FULL);
    expect(barCategory(h, 'reading')).toBe('Mastered');
    // …while the core bar, which this history says nothing about, is untouched.
    expect(barCategory(h, 'core')).toBe('Unfamiliar');
  });

  it('keeps the three bars fully independent', () => {
    const h: TypedMarkHistory = {
      recognition: track(8),
      production: track(8),
      reading: track(3),
    };
    expect(barCategory(h, 'core')).toBe('Mastered');
    expect(barCategory(h, 'reading')).toBe('Target');
    expect(barCategory(h, 'writing')).toBe('Unfamiliar');
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

  it('is independent of the core band', () => {
    // Writing is maxed; the core bar has no history at all.
    const h: TypedMarkHistory = { writing: track(8) };
    expect(computeTypeCategory(h, 'writing')).toBe('Mastered');
    expect(computeCoreCategory(h)).toBe('Unfamiliar');
  });

  it('agrees with barCategory on the single-track bars', () => {
    // The Mastered-collection SQL relies on this: it filters reading/writing with
    // compute_type_category rather than a bar-specific function.
    const h: TypedMarkHistory = { reading: track(6), writing: track(2) };
    expect(computeTypeCategory(h, 'reading')).toBe(barCategory(h, 'reading'));
    expect(computeTypeCategory(h, 'writing')).toBe(barCategory(h, 'writing'));
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

describe('coreMasteredTypedMarkHistory', () => {
  it('masters the CORE bar and leaves reading/writing at Unfamiliar', () => {
    // "I already know this word" is a claim about knowing it, not about reading or
    // writing it. Seeding those bars would hand the learner a finished Read bar for a
    // character they have never once read.
    const h = coreMasteredTypedMarkHistory('2026-03-03T00:00:00.000Z');
    expect(barCategory(h, 'core')).toBe('Mastered');
    expect(barCategory(h, 'reading')).toBe('Unfamiliar');
    expect(barCategory(h, 'writing')).toBe('Unfamiliar');
  });

  it('fills BOTH core tracks — one maxed track alone would only reach Comfortable', () => {
    // The pbh first term is capped at 6, so seeding recognition only would miss the
    // Mastered the learner actually asked for.
    const h = coreMasteredTypedMarkHistory('t');
    expect(h.recognition).toHaveLength(MARK_WINDOW_SIZE);
    expect(h.production).toHaveLength(MARK_WINDOW_SIZE);
  });

  it('writes NO reading/writing tracks at all, not empty ones', () => {
    const h = coreMasteredTypedMarkHistory('t');
    expect(h.reading).toBeUndefined();
    expect(h.writing).toBeUndefined();
  });
});

describe('masteryBar', () => {
  it('composes the core bar over its OWN two tracks only', () => {
    // Reading marks must not appear in the core bar's fill — the conflation the
    // three-bar split undoes.
    const h: TypedMarkHistory = { recognition: track(2), production: track(2), reading: track(8) };
    const bar = masteryBar(h, 'core');
    expect(bar.segments.map((s) => s.type)).toEqual(['recognition', 'production']);
    expect(bar.segments.every((s) => s.fraction === 0.5)).toBe(true);
  });

  it('gives a single-track bar one solid segment', () => {
    const bar = masteryBar({ reading: track(4) }, 'reading');
    expect(bar.segments).toHaveLength(1);
    expect(bar.segments[0]).toMatchObject({ type: 'reading', positive: 4, fraction: 1 });
  });

  it('clamps the fill fraction at 1 even when the core pbh overshoots PBH_FULL', () => {
    const h: TypedMarkHistory = { recognition: track(8), production: track(8) };
    const bar = masteryBar(h, 'core');
    expect(bar.pbh).toBeGreaterThan(PBH_FULL); // the blend's range tops out ~8.67
    expect(bar.heightFraction).toBe(1);
  });

  it('reports zero fractions rather than NaN when there is nothing yet', () => {
    const bar = masteryBar(undefined, 'core');
    expect(bar.segments.every((s) => s.fraction === 0)).toBe(true);
    expect(bar.heightFraction).toBe(0);
    expect(bar.category).toBe('Unfamiliar');
  });
});

describe('masteryBars', () => {
  it('returns only the bars the account is pursuing', () => {
    const h: TypedMarkHistory = { recognition: track(2), writing: track(8) };
    expect(masteryBars(h, NO_GOALS).map((b) => b.id)).toEqual(['core']);
    expect(masteryBars(h, ALL_GOALS).map((b) => b.id)).toEqual(['core', 'reading', 'writing']);
  });

  it('still reports a hidden track\'s accrued progress once its goal is on', () => {
    // "Keep accruing, hide the bar": the writing marks were earned with the goal off.
    const h: TypedMarkHistory = { writing: track(8) };
    const writing = masteryBars(h, { reading: false, writing: true }).find((b) => b.id === 'writing')!;
    expect(writing.category).toBe('Mastered');
  });
});

describe('masteredAtForBar', () => {
  const EARLY = '2026-01-01T00:00:00.000Z';
  const LATE = '2026-06-01T00:00:00.000Z';

  it('is zero when that bar has never crossed', () => {
    expect(masteredAtForBar(null, 'core')).toBe(0);
    expect(masteredAtForBar({}, 'core')).toBe(0);
    expect(masteredAtForBar({ writing: LATE }, 'core')).toBe(0);
  });

  it('reads ONLY the named bar, never the latest across bars', () => {
    // The three bars are three separate achievements. If this collapsed to a max, a
    // reading crossing would silently reorder the core "Date mastered" list.
    const stamps = { core: EARLY, writing: LATE };
    expect(masteredAtForBar(stamps, 'core')).toBe(new Date(EARLY).getTime());
    expect(masteredAtForBar(stamps, 'writing')).toBe(new Date(LATE).getTime());
  });

  it('treats null and unparseable stamps as missing rather than as the epoch', () => {
    expect(masteredAtForBar({ core: null }, 'core')).toBe(0);
    expect(masteredAtForBar({ reading: 'not a date' }, 'reading')).toBe(0);
  });
});
