import { describe, it, expect } from 'vitest';
import {
  computeZoneCutoffs,
  zoneForScore,
  divisionChangeForScore,
} from '../services/arenaZones.js';
import {
  ARENA_SIZE,
  ARENA_PROMOTE_COUNT,
  ARENA_RELEGATE_COUNT,
  ARENA_DIVISION_COUNT,
} from '../contracts/wire.js';

/** A full board of distinct, descending scores: rank 1 = 250 … rank 25 = 10. */
function distinctBoard(): number[] {
  return Array.from({ length: ARENA_SIZE }, (_, i) => (ARENA_SIZE - i) * 10);
}

/** Zone of every rank on a mid-ladder board (both ends of the ladder open). */
function zones(scores: number[], division = 5): string[] {
  const cutoffs = computeZoneCutoffs(scores);
  return scores.map((s) => zoneForScore(s, division, cutoffs));
}

describe('arena zones — no ties', () => {
  it('promotes exactly the top N and relegates exactly the bottom N', () => {
    const z = zones(distinctBoard());
    expect(z.filter((x) => x === 'promote')).toHaveLength(ARENA_PROMOTE_COUNT);
    expect(z.filter((x) => x === 'relegate')).toHaveLength(ARENA_RELEGATE_COUNT);
    expect(z[ARENA_PROMOTE_COUNT - 1]).toBe('promote');
    expect(z[ARENA_PROMOTE_COUNT]).toBe('hold');
    expect(z[ARENA_SIZE - ARENA_RELEGATE_COUNT - 1]).toBe('hold');
    expect(z[ARENA_SIZE - ARENA_RELEGATE_COUNT]).toBe('relegate');
  });

  it('clamps the ladder at both ends of the division range', () => {
    const top = zones(distinctBoard(), ARENA_DIVISION_COUNT);
    expect(top).not.toContain('promote');
    expect(top.filter((x) => x === 'relegate')).toHaveLength(ARENA_RELEGATE_COUNT);

    const bottom = zones(distinctBoard(), 1);
    expect(bottom).not.toContain('relegate');
    expect(bottom.filter((x) => x === 'promote')).toHaveLength(ARENA_PROMOTE_COUNT);
  });
});

describe('arena zones — promotion GROWS into a tie', () => {
  it('pulls up everyone tied with the last promotion rank', () => {
    const scores = distinctBoard();
    // Ranks 5, 6 and 7 all finish on the rank-5 score.
    scores[ARENA_PROMOTE_COUNT] = scores[ARENA_PROMOTE_COUNT - 1];
    scores[ARENA_PROMOTE_COUNT + 1] = scores[ARENA_PROMOTE_COUNT - 1];

    const z = zones(scores);
    expect(z.filter((x) => x === 'promote')).toHaveLength(ARENA_PROMOTE_COUNT + 2);
    expect(z[ARENA_PROMOTE_COUNT + 1]).toBe('promote');
    expect(z[ARENA_PROMOTE_COUNT + 2]).toBe('hold');
  });
});

describe('arena zones — relegation SHRINKS out of a tie', () => {
  it('keeps up everyone tied with the last safe rank', () => {
    const scores = distinctBoard();
    const lastSafe = ARENA_SIZE - ARENA_RELEGATE_COUNT - 1; // index of the last safe rank
    // The first two relegation ranks tie with the last safe rank.
    scores[lastSafe + 1] = scores[lastSafe];
    scores[lastSafe + 2] = scores[lastSafe];

    const z = zones(scores);
    expect(z.filter((x) => x === 'relegate')).toHaveLength(ARENA_RELEGATE_COUNT - 2);
    expect(z[lastSafe + 1]).toBe('hold');
    expect(z[lastSafe + 2]).toBe('hold');
    expect(z[lastSafe + 3]).toBe('relegate');
  });

  it('empties the relegation zone when the tie spans it entirely', () => {
    const lastSafe = ARENA_SIZE - ARENA_RELEGATE_COUNT - 1;
    const scores = distinctBoard().map((s, i) => (i >= lastSafe ? 40 : s));
    expect(zones(scores)).not.toContain('relegate');
  });
});

describe('arena zones — collisions', () => {
  it('promotes the whole board when every member is tied above zero', () => {
    const z = zones(new Array(ARENA_SIZE).fill(60));
    expect(z.every((x) => x === 'promote')).toBe(true);
  });

  it('holds a zero-score board rather than promoting it', () => {
    const z = zones(new Array(ARENA_SIZE).fill(0));
    expect(z.every((x) => x === 'hold')).toBe(true);
  });

  it('never promotes a zero score even when it reaches the cutoff', () => {
    // Only four members scored at all, so the rank-5 score is 0.
    const scores = [50, 40, 30, 20, ...new Array(ARENA_SIZE - 4).fill(0)];
    const z = zones(scores);
    expect(z.slice(0, 4).every((x) => x === 'promote')).toBe(true);
    expect(z.slice(4).every((x) => x === 'hold')).toBe(true);
  });
});

describe('arena zones — short boards', () => {
  it('has no relegation zone when the board is no longer than the last safe rank', () => {
    const scores = distinctBoard().slice(0, ARENA_SIZE - ARENA_RELEGATE_COUNT);
    expect(zones(scores)).not.toContain('relegate');
  });

  it('promotes every scoring member of a board shorter than the promotion count', () => {
    const z = zones([30, 20, 10]);
    expect(z.every((x) => x === 'promote')).toBe(true);
  });
});

describe('divisionChangeForScore', () => {
  it('mirrors the displayed zone', () => {
    const scores = distinctBoard();
    const cutoffs = computeZoneCutoffs(scores);
    for (const s of scores) {
      const zone = zoneForScore(s, 5, cutoffs);
      const change = divisionChangeForScore(s, 5, cutoffs);
      expect(change).toBe(zone === 'promote' ? 1 : zone === 'relegate' ? -1 : 0);
    }
  });
});
