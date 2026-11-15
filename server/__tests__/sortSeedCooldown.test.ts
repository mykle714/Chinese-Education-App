import { describe, expect, it } from 'vitest';
import {
  sortSeedTypedMarkHistory,
  isBarOnCooldown,
  barReadyAt,
  COOLDOWN_MS_BY_CATEGORY,
} from '../contracts/cooldown.js';
import { barCategory } from '../contracts/mastery.js';

// The acp sort seed's clock (contracts/cooldown.ts → sortSeedTypedMarkHistory):
// Target and Comfortable start OFF cooldown, released exactly at the sort; Mastered
// rests its full window; Unfamiliar (library) seeds nothing.
// Docs: docs/SORT_CARDS_REQUIREMENTS.md § 5, docs/DECK_TOWER.md § "Back from Add Cards".
describe('sortSeedTypedMarkHistory', () => {
  const now = Date.parse('2026-11-14T12:00:00.000Z');

  it.each([
    ['target', 'Target'],
    ['comfortable', 'Comfortable'],
  ] as const)('%s lands in %s and is ready at the sort', (bucket, band) => {
    const h = sortSeedTypedMarkHistory(bucket, now);
    expect(barCategory(h, 'core')).toBe(band);
    expect(barReadyAt(h, 'core')).toBe(now);
    expect(isBarOnCooldown(h, 'core', now)).toBe(false);
    // Backdated by exactly the band's window.
    expect(Date.parse(h.recognition![0].timestamp)).toBe(now - COOLDOWN_MS_BY_CATEGORY[band]);
  });

  it('already-learned lands in Mastered and rests its full window', () => {
    const h = sortSeedTypedMarkHistory('already-learned', now);
    expect(barCategory(h, 'core')).toBe('Mastered');
    expect(barReadyAt(h, 'core')).toBe(now + COOLDOWN_MS_BY_CATEGORY.Mastered);
    expect(isBarOnCooldown(h, 'core', now)).toBe(true);
  });

  it('library seeds no marks', () => {
    expect(sortSeedTypedMarkHistory('library', now)).toEqual({});
  });
});
