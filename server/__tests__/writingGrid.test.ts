import { describe, expect, it } from 'vitest';
import { sampleWritingGridCharacters, medalForWritingGrid } from '../contracts/writingGrid.js';
import { writingLevelForMastery, writingMarkCounts } from '../contracts/writingLevels.js';
import { writingMasteryFromChars } from '../contracts/mastery.js';

const cand = (char: string, writingMastery: number, cooled = false) => ({ char, writingMastery, cooled, pinyin: null });

describe('sampleWritingGridCharacters', () => {
  it('returns distinct characters, at most `count`', () => {
    const pool = 'abcdefghijkl'.split('').map((c, i) => cand(c, i % 9));
    const picked = sampleWritingGridCharacters(pool, 8, () => 0.37);
    expect(picked).toHaveLength(8);
    expect(new Set(picked.map((p) => p.char)).size).toBe(8);
  });

  it('draws off-cooldown characters before cooled ones', () => {
    const pool = [cand('a', 0, true), cand('b', 0, false), cand('c', 0, true)];
    const picked = sampleWritingGridCharacters(pool, 1, () => 0.99);
    expect(picked[0].char).toBe('b');
  });

  it('returns what it has when the pool is short', () => {
    expect(sampleWritingGridCharacters([cand('a', 0)], 8)).toHaveLength(1);
  });
});

describe('writing level rules', () => {
  it('maps mastery to level: 0→1, 1→2, ≥7→8, fractional floors', () => {
    expect(writingLevelForMastery(0)).toBe(1);
    expect(writingLevelForMastery(1)).toBe(2);
    expect(writingLevelForMastery(2.5)).toBe(3);
    expect(writingLevelForMastery(7)).toBe(8);
    expect(writingLevelForMastery(8)).toBe(8);
  });
  it('counts a mark only when level > mastery', () => {
    expect(writingMarkCounts(1, 0)).toBe(true);
    expect(writingMarkCounts(3, 3)).toBe(false);
  });
  it('averages characters, skipping clock-only marks', () => {
    const correct = { timestamp: 't', isCorrect: true };
    expect(writingMasteryFromChars([{ writing: [correct, correct] }, { writing: [] }, undefined])).toBeCloseTo(2 / 3);
    expect(writingMasteryFromChars([{ writing: [{ ...correct, clockOnly: true }] }])).toBe(0);
  });
});

describe('medalForWritingGrid', () => {
  it('bands by total time', () => {
    expect(medalForWritingGrid(100_000)).toBe('gold');
    expect(medalForWritingGrid(200_000)).toBe('silver');
    expect(medalForWritingGrid(300_000)).toBe('bronze');
    expect(medalForWritingGrid(400_000)).toBeNull();
  });
});
