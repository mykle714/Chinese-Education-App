import { describe, it, expect } from 'vitest';
import {
  COOLDOWN_MS_BY_CATEGORY,
  barCooldownRemainingMs,
  isMarkOnCooldown,
  lastCorrectMarkTimestamp,
  lastCorrectOnBar,
  queueArrivalAt,
  rankCardQueue,
  rankCardQueueCooled,
} from '../services/cardQueueRanking.js';
import type { ReviewMark, TypedMarkHistory } from '../contracts/wire.js';

/**
 * The shared cooldown + queue discipline (docs/MASTERY_REWORK.md § 6,
 * docs/MEMORY_MAP_GAME.md § 13.1).
 *
 * Since the know merge (2026-09-25) a cooldown clock belongs to a BAR, not a mark
 * type: recognition and production share the know (core) clock, reading and writing
 * each keep their own. The window is the bar's own band, so these tests control the
 * window by controlling how many correct marks a track holds:
 *   1 correct  → Unfamiliar (5 min)   — reading bar, or core pbh 1
 *   3 correct  → Target (24 h)        — reading bar, or core pbh 3
 *   6 correct  → Comfortable (14 d)   — core pbh 6 (one track maxing the first term)
 */

const NOW = Date.UTC(2026, 7, 18, 12, 0, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `count` correct marks on one track, the NEWEST `agoMs` before NOW (older ones a day apart). */
function track(count: number, agoMs: number): ReviewMark[] {
  return Array.from({ length: count }, (_, i) => ({
    isCorrect: true,
    timestamp: new Date(NOW - agoMs - i * DAY).toISOString(),
  })) as ReviewMark[];
}

/** A history built from per-track `[count, agoMs]` pairs. */
function history(tracks: Partial<Record<string, [number, number]>>): TypedMarkHistory {
  const out: Record<string, ReviewMark[]> = {};
  for (const [type, spec] of Object.entries(tracks)) {
    if (spec) out[type] = track(spec[0], spec[1]);
  }
  return out as TypedMarkHistory;
}

describe('lastCorrectMarkTimestamp (one track)', () => {
  it('ignores incorrect marks', () => {
    const h = { reading: [{ isCorrect: false, timestamp: new Date(NOW).toISOString() }] } as TypedMarkHistory;
    expect(lastCorrectMarkTimestamp(h, 'reading')).toBeNull();
  });

  it('ignores unparseable timestamps rather than returning NaN', () => {
    // A NaN would poison every comparison downstream and silently reorder the queue.
    const h = { reading: [{ isCorrect: true, timestamp: 'not-a-date' }] } as TypedMarkHistory;
    expect(lastCorrectMarkTimestamp(h, 'reading')).toBeNull();
  });

  it('returns the NEWEST correct mark, not the last in the array', () => {
    const h = {
      reading: [
        { isCorrect: true, timestamp: new Date(NOW - 1 * DAY).toISOString() },
        { isCorrect: true, timestamp: new Date(NOW - 9 * DAY).toISOString() },
      ],
    } as TypedMarkHistory;
    expect(lastCorrectMarkTimestamp(h, 'reading')).toBe(NOW - 1 * DAY);
  });

  it('returns null for a track that is absent or not an array', () => {
    expect(lastCorrectMarkTimestamp(undefined, 'reading')).toBeNull();
    expect(lastCorrectMarkTimestamp({ reading: 'nope' } as never, 'reading')).toBeNull();
  });
});

describe('the know clock — recognition and production share one', () => {
  it('starts from the newer correct mark across BOTH tracks', () => {
    const h = history({ recognition: [1, 3 * DAY], production: [1, 2 * HOUR] });
    expect(lastCorrectOnBar(h, 'core')).toBe(NOW - 2 * HOUR);
  });

  it('a correct RECOGNITION mark rests PRODUCTION too', () => {
    // pbh 3 → Target (24h). Recognition answered an hour ago; production never.
    const h = history({ recognition: [3, 1 * HOUR] });
    expect(isMarkOnCooldown(h, 'recognition', NOW)).toBe(true);
    expect(isMarkOnCooldown(h, 'production', NOW)).toBe(true);
  });

  it('is windowed by the CORE band, not either track\'s own band', () => {
    // Recognition 6/8 → core pbh 6 → Comfortable (14 d), even though production alone
    // (1 mark) would band Unfamiliar (5 min). Production answered 2 days ago must
    // therefore still be resting.
    const h = history({ recognition: [6, 10 * DAY], production: [1, 2 * DAY] });
    expect(barCooldownRemainingMs(h, 'core', NOW)).toBe(COOLDOWN_MS_BY_CATEGORY.Comfortable - 2 * DAY);
  });

  it('does not touch the reading clock, and vice versa', () => {
    const h = history({ reading: [3, 1 * MINUTE] });
    expect(isMarkOnCooldown(h, 'reading', NOW)).toBe(true);
    expect(isMarkOnCooldown(h, 'recognition', NOW)).toBe(false);
  });

  it('releases the card once the window has elapsed', () => {
    const h = history({ reading: [1, 10 * MINUTE] }); // Unfamiliar: 5 min
    expect(isMarkOnCooldown(h, 'reading', NOW)).toBe(false);
  });
});

describe('queueArrivalAt', () => {
  it('is the bar clock\'s release time', () => {
    const h = history({ recognition: [3, 30 * DAY], production: [1, 2 * DAY] });
    // core pbh = 3 + 1/3 → Target; the clock started at production's newer mark.
    expect(queueArrivalAt(h, 'core')).toBe(NOW - 2 * DAY + COOLDOWN_MS_BY_CATEGORY.Target);
  });

  it('counts a card right on only ONE know track as having history', () => {
    // A partially-marked card HAS been gotten right; it must not sink into the
    // never-marked tail alongside cards the learner has never seen.
    const h = history({ recognition: [1, 5 * DAY] });
    expect(queueArrivalAt(h, 'core')).toBe(NOW - 5 * DAY + COOLDOWN_MS_BY_CATEGORY.Unfamiliar);
  });

  it('returns -Infinity only when the bar carries no correct mark', () => {
    expect(queueArrivalAt({}, 'core')).toBe(-Infinity);
    expect(queueArrivalAt(history({ reading: [3, DAY] }), 'core')).toBe(-Infinity);
  });
});

describe('rankCardQueue', () => {
  const rank = (cards: any[], bar: 'core' | 'reading' = 'reading') =>
    rankCardQueue(cards, NOW, { bar }).map((r) => r.card.id);

  it('drops cards that are still cooling down', () => {
    const cards = [
      { id: 'resting', typedMarkHistory: history({ reading: [3, 1 * HOUR] }) },
      { id: 'rested', typedMarkHistory: history({ reading: [3, 5 * DAY] }) },
    ];
    expect(rank(cards)).toEqual(['rested']);
  });

  it('serves the longest-waiting card first', () => {
    const cards = [
      { id: 'recent', typedMarkHistory: history({ reading: [1, 1 * HOUR] }) },
      { id: 'ancient', typedMarkHistory: history({ reading: [1, 90 * DAY] }) },
      { id: 'middle', typedMarkHistory: history({ reading: [1, 10 * DAY] }) },
    ];
    expect(rank(cards)).toEqual(['ancient', 'middle', 'recent']);
  });

  it('sinks never-marked cards BELOW every card with history', () => {
    // The tier check is the reason this cannot be a plain ascending sort: a
    // never-marked card scores -Infinity, which ascending order would put FIRST.
    const cards = [
      { id: 'never', typedMarkHistory: {} },
      { id: 'marked', typedMarkHistory: history({ reading: [1, 1 * DAY] }) },
    ];
    expect(rank(cards)).toEqual(['marked', 'never']);
  });

  it("keeps the caller's incoming order among never-marked cards", () => {
    // Stability is what lets the SQL ORDER BY be the final tiebreak.
    const cards = ['a', 'b', 'c'].map((id) => ({ id, typedMarkHistory: {} }));
    expect(rank(cards)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the cards it ranks', () => {
    const card = { id: 'x', typedMarkHistory: {} };
    rank([card]);
    expect(card).toEqual({ id: 'x', typedMarkHistory: {} });
  });

  it('ranks the SAME card differently for the flp and for Memory Map', () => {
    // Read correctly a minute ago, never marked for recognition/production: Memory
    // Map must rest it, the flp must still offer it.
    const card = { id: 'read-just-now', typedMarkHistory: history({ reading: [3, 1 * MINUTE] }) };
    expect(rank([card], 'reading')).toEqual([]);
    expect(rank([card], 'core')).toEqual(['read-just-now']);
  });

  it('holds an flp card back when EITHER know track was just answered', () => {
    // The know merge's defining case: production is long rested, but recognition was
    // answered an hour ago, so the shared clock is running and the card waits.
    const card = {
      id: 'just-recognized',
      typedMarkHistory: history({ recognition: [3, 1 * HOUR], production: [3, 30 * DAY] }),
    };
    expect(rank([card], 'core')).toEqual([]);
  });
});

/**
 * The COOLED complement (docs/PROVISIONAL_CARDS.md § 4b). Lending is the bottom of
 * every fill ladder, so a round short on rested cards re-serves RESTING ones instead
 * of minting words the learner never chose — and this is what orders them.
 */
describe('rankCardQueueCooled', () => {
  const flp = { bar: 'core' as const };
  /** Core pbh 3 (Target, 24 h window), newest correct mark `agoMs` ago. */
  const target = (agoMs: number) => history({ recognition: [3, agoMs] });

  it('returns only resting cards — the exact complement of rankCardQueue', () => {
    const rested = { id: 1, typedMarkHistory: target(2 * DAY) };
    const resting = { id: 2, typedMarkHistory: target(HOUR) };
    const cards = [rested, resting];

    expect(rankCardQueueCooled(cards, NOW, flp).map((c) => c.id)).toEqual([2]);
    expect(rankCardQueue(cards, NOW, flp).map((r) => r.card.id)).toEqual([1]);
  });

  it('orders nearest-to-ready first', () => {
    const almostReady = { id: 1, typedMarkHistory: target(23 * HOUR) };
    const justMarked = { id: 2, typedMarkHistory: target(MINUTE) };
    const midway = { id: 3, typedMarkHistory: target(12 * HOUR) };

    expect(
      rankCardQueueCooled([justMarked, almostReady, midway], NOW, flp).map((c) => c.id)
    ).toEqual([1, 3, 2]);
  });

  it('excludes a never-marked card (it is rested, not resting)', () => {
    expect(rankCardQueueCooled([{ id: 1, typedMarkHistory: {} as TypedMarkHistory }], NOW, flp)).toEqual([]);
  });

  it('includes a card marked on only ONE know track — the other track no longer rescues it', () => {
    // Before the merge an unmarked production track counted as "ready" and kept this
    // card out of the cooled tier. Now the one clock is running, so it is resting.
    const oneTrack = { id: 1, typedMarkHistory: target(MINUTE) };
    expect(rankCardQueueCooled([oneTrack], NOW, flp).map((c) => c.id)).toEqual([1]);
    expect(rankCardQueue([oneTrack], NOW, flp)).toEqual([]);
  });

  it("is stable, so the caller's own ordering survives a tie", () => {
    const a = { id: 1, typedMarkHistory: target(HOUR) };
    const b = { id: 2, typedMarkHistory: target(HOUR) };
    expect(rankCardQueueCooled([b, a], NOW, flp).map((c) => c.id)).toEqual([2, 1]);
  });

  it("ranks on the caller's own bar — Memory Map reads reading, not know", () => {
    const card = {
      id: 1,
      typedMarkHistory: history({ reading: [3, MINUTE], recognition: [3, 2 * DAY] }),
    };
    expect(rankCardQueueCooled([card], NOW, { bar: 'reading' }).map((c) => c.id)).toEqual([1]);
    expect(rankCardQueueCooled([card], NOW, flp)).toEqual([]);
  });
});
