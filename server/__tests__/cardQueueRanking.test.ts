import { describe, it, expect } from 'vitest';
import {
  COOLDOWN_MS_BY_CATEGORY,
  isTypeOnCooldown,
  lastCorrectMarkTimestamp,
  queueArrivalAt,
  rankCardQueue,
  readyMarkTypes,
} from '../services/cardQueueRanking.js';
import type { TypedMarkHistory } from '../contracts/wire.js';

/**
 * The shared queue discipline (docs/MEMORY_MAP_GAME.md § 13.1).
 *
 * This logic used to be five private methods on OnDeckVocabService, serving the flp
 * alone and covered by nothing. It was extracted so Memory Map could rank on the
 * READING track without a second copy — so these tests pin BOTH callers' shapes: the
 * flp's two-track / core-window configuration and Memory Map's one-track / reading
 * one.
 */

const NOW = Date.UTC(2026, 7, 18, 12, 0, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A history with one correct mark on `type`, `agoMs` before NOW. */
function correctAgo(type: string, agoMs: number): TypedMarkHistory {
  return {
    [type]: [{ isCorrect: true, timestamp: new Date(NOW - agoMs).toISOString() }],
  } as TypedMarkHistory;
}

const FLP_TRACKS = ['recognition', 'production'] as const;
const READING = ['reading'] as const;

describe('lastCorrectMarkTimestamp', () => {
  it('ignores incorrect marks', () => {
    const history = {
      reading: [{ isCorrect: false, timestamp: new Date(NOW).toISOString() }],
    } as TypedMarkHistory;
    expect(lastCorrectMarkTimestamp(history, 'reading')).toBeNull();
  });

  it('ignores unparseable timestamps rather than returning NaN', () => {
    // A NaN would poison every comparison downstream and silently reorder the queue.
    const history = { reading: [{ isCorrect: true, timestamp: 'not-a-date' }] } as TypedMarkHistory;
    expect(lastCorrectMarkTimestamp(history, 'reading')).toBeNull();
  });

  it('returns the NEWEST correct mark, not the last in the array', () => {
    const history = {
      reading: [
        { isCorrect: true, timestamp: new Date(NOW - 1 * DAY).toISOString() },
        { isCorrect: true, timestamp: new Date(NOW - 9 * DAY).toISOString() },
      ],
    } as TypedMarkHistory;
    expect(lastCorrectMarkTimestamp(history, 'reading')).toBe(NOW - 1 * DAY);
  });

  it('returns null for a track that is absent or not an array', () => {
    expect(lastCorrectMarkTimestamp(undefined, 'reading')).toBeNull();
    expect(lastCorrectMarkTimestamp({ reading: 'nope' } as never, 'reading')).toBeNull();
  });
});

describe('isTypeOnCooldown', () => {
  it('rests a card for its category window and releases it after', () => {
    const history = correctAgo('reading', 1 * HOUR);
    // Target = 24h: an hour in, still resting.
    expect(isTypeOnCooldown(history, 'reading', NOW, 'Target')).toBe(true);
    // Unfamiliar = 5min: long since released.
    expect(isTypeOnCooldown(history, 'reading', NOW, 'Unfamiliar')).toBe(false);
  });

  it('treats an unknown category as NO cooldown, not as infinite', () => {
    // Failing open is deliberate: a card whose category could not be computed should
    // still be servable rather than vanishing from every queue invisibly.
    expect(isTypeOnCooldown(correctAgo('reading', 0), 'reading', NOW, 'Nonsense')).toBe(false);
    expect(isTypeOnCooldown(correctAgo('reading', 0), 'reading', NOW, null)).toBe(false);
  });

  it('is per-track: a correct READING mark does not rest the recognition track', () => {
    const history = correctAgo('reading', 1 * MINUTE);
    expect(isTypeOnCooldown(history, 'reading', NOW, 'Target')).toBe(true);
    expect(isTypeOnCooldown(history, 'recognition', NOW, 'Target')).toBe(false);
  });
});

describe('readyMarkTypes', () => {
  it('returns only the tracks the caller asked about', () => {
    // Memory Map must never be told a card is ready because its RECOGNITION track is.
    const history = correctAgo('reading', 1 * MINUTE);
    expect(readyMarkTypes(history, NOW, READING, 'Target')).toEqual([]);
    expect(readyMarkTypes(history, NOW, FLP_TRACKS, 'Target')).toEqual([
      'recognition',
      'production',
    ]);
  });
});

describe('queueArrivalAt', () => {
  it('takes the EARLIEST arrival across ready tracks, not the latest', () => {
    // A card whose recognition track has been ready for ten days is ten days overdue,
    // even if production only rested yesterday. MIN is what makes this a queue.
    const history = {
      recognition: [{ isCorrect: true, timestamp: new Date(NOW - 30 * DAY).toISOString() }],
      production: [{ isCorrect: true, timestamp: new Date(NOW - 2 * DAY).toISOString() }],
    } as TypedMarkHistory;
    expect(queueArrivalAt(history, FLP_TRACKS, 'Target')).toBe(
      NOW - 30 * DAY + COOLDOWN_MS_BY_CATEGORY.Target
    );
  });

  it('skips tracks with no correct mark instead of scoring them -Infinity', () => {
    // A partially-marked card HAS been gotten right; it must not sink into the
    // never-marked tail alongside cards the learner has never seen.
    const history = correctAgo('recognition', 5 * DAY);
    expect(queueArrivalAt(history, FLP_TRACKS, 'Target')).toBe(
      NOW - 5 * DAY + COOLDOWN_MS_BY_CATEGORY.Target
    );
  });

  it('returns -Infinity only when NO ready track carries a correct mark', () => {
    expect(queueArrivalAt({}, FLP_TRACKS, 'Target')).toBe(-Infinity);
  });
});

describe('rankCardQueue', () => {
  const rank = (cards: any[], tracks: readonly any[] = READING) =>
    rankCardQueue(cards, NOW, {
      markTypes: tracks,
      windowCategoryOf: (c: any) => c.readingCategory ?? 'Unfamiliar',
    }).map((r) => r.card.id);

  it('drops cards that are still cooling down', () => {
    const cards = [
      { id: 'resting', readingCategory: 'Target', typedMarkHistory: correctAgo('reading', 1 * HOUR) },
      { id: 'rested', readingCategory: 'Target', typedMarkHistory: correctAgo('reading', 5 * DAY) },
    ];
    expect(rank(cards)).toEqual(['rested']);
  });

  it('serves the longest-waiting card first', () => {
    const cards = [
      { id: 'recent', readingCategory: 'Unfamiliar', typedMarkHistory: correctAgo('reading', 1 * HOUR) },
      { id: 'ancient', readingCategory: 'Unfamiliar', typedMarkHistory: correctAgo('reading', 90 * DAY) },
      { id: 'middle', readingCategory: 'Unfamiliar', typedMarkHistory: correctAgo('reading', 10 * DAY) },
    ];
    expect(rank(cards)).toEqual(['ancient', 'middle', 'recent']);
  });

  it('sinks never-marked cards BELOW every card with history', () => {
    // The tier check is the reason this cannot be a plain ascending sort: a
    // never-marked card scores -Infinity, which ascending order would put FIRST.
    const cards = [
      { id: 'never', readingCategory: 'Unfamiliar', typedMarkHistory: {} },
      { id: 'marked', readingCategory: 'Unfamiliar', typedMarkHistory: correctAgo('reading', 1 * DAY) },
    ];
    expect(rank(cards)).toEqual(['marked', 'never']);
  });

  it('keeps the caller\'s incoming order among never-marked cards', () => {
    // Stability is what lets the SQL ORDER BY be the final tiebreak.
    const cards = ['a', 'b', 'c'].map((id) => ({
      id,
      readingCategory: 'Unfamiliar',
      typedMarkHistory: {},
    }));
    expect(rank(cards)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the cards it ranks', () => {
    const card = { id: 'x', readingCategory: 'Unfamiliar', typedMarkHistory: {} };
    rank([card]);
    expect(card).toEqual({ id: 'x', readingCategory: 'Unfamiliar', typedMarkHistory: {} });
  });

  it('ranks the SAME card differently for the flp and for Memory Map', () => {
    // The whole point of the extraction. This card was read correctly a minute ago but
    // never marked for recognition/production: Memory Map must rest it, the flp must
    // still offer it.
    const card = { id: 'read-just-now', readingCategory: 'Target', typedMarkHistory: correctAgo('reading', 1 * MINUTE) };
    expect(rank([card], READING)).toEqual([]);
    expect(rank([card], FLP_TRACKS)).toEqual(['read-just-now']);
  });
});
