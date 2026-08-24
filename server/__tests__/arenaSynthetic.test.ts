import { describe, it, expect } from 'vitest';
import {
  pickSyntheticTarget,
  SYNTHETIC_EFFORT_MULTIPLIER,
  syntheticScoreAt,
  elapsedFraction,
  pickSyntheticName,
} from '../services/arenaSynthetic.js';
import { ARENA_DIVISION_COUNT } from '../contracts/wire.js';

/**
 * Synthetic member scoring (docs/ARENA_FEATURE.md § 6.2).
 *
 * The three properties asserted here are the ones that make a bot survive being
 * WATCHED: a score that ticks down, or climbs in a perfectly straight line, is
 * recognisable as fake within a day. They are properties of the curve, so they
 * are tested as properties across many seeds rather than by example.
 */

const SEEDS = Array.from({ length: 50 }, (_, i) => i * 7919 + 13);

describe('syntheticScoreAt', () => {
  it('is monotonic — a displayed score never goes down', () => {
    for (const seed of SEEDS) {
      const target = 400;
      let prev = -1;
      for (let step = 0; step <= 500; step++) {
        const score = syntheticScoreAt(seed, target, step / 500);
        expect(score, `seed ${seed} dipped at step ${step}`).toBeGreaterThanOrEqual(prev);
        prev = score;
      }
    }
  });

  it('starts at zero and converges exactly on the target', () => {
    for (const seed of SEEDS) {
      expect(syntheticScoreAt(seed, 355, 0)).toBe(0);
      // Every bot on the board reads exactly 0 at the open instant — nobody
      // starts an arena with minutes already banked.
      expect(syntheticScoreAt(seed, 355, Number.MIN_VALUE)).toBe(0);
      expect(syntheticScoreAt(seed, 355, 1)).toBe(355);
    }
  });

  it('is deterministic — the same inputs always give the same number', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      for (const t of [0.13, 0.5, 0.77, 0.99]) {
        expect(syntheticScoreAt(seed, 500, t)).toBe(syntheticScoreAt(seed, 500, t));
      }
    }
  });

  it('is NOT a straight line — the climb is stepped', () => {
    // A linear curve would make every per-step delta identical. Require that the
    // deltas actually vary, or the bot is obviously mechanical when watched.
    let sawVariation = 0;
    for (const seed of SEEDS) {
      const deltas: number[] = [];
      for (let step = 1; step <= 24; step++) {
        deltas.push(
          syntheticScoreAt(seed, 600, step / 24) - syntheticScoreAt(seed, 600, (step - 1) / 24),
        );
      }
      if (new Set(deltas).size > 3) sawVariation++;
    }
    expect(sawVariation).toBeGreaterThan(SEEDS.length * 0.8);
  });

  it('clamps out-of-range fractions instead of extrapolating', () => {
    expect(syntheticScoreAt(11, 300, -5)).toBe(0);
    expect(syntheticScoreAt(11, 300, 9)).toBe(300);
  });

  it('stays within [0, target] throughout', () => {
    for (const seed of SEEDS) {
      for (let step = 0; step <= 100; step++) {
        const score = syntheticScoreAt(seed, 250, step / 100);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(250);
      }
    }
  });
});

describe('pickSyntheticTarget', () => {
  it('is monotonically harder as the division climbs', () => {
    // A division-11 bot must not be lazier than a division-2 human, or the top
    // of the ladder becomes the easiest place to stay.
    const averages: number[] = [];
    for (let d = 1; d <= ARENA_DIVISION_COUNT; d++) {
      const targets = SEEDS.map((s) => pickSyntheticTarget(d, s));
      averages.push(targets.reduce((a, b) => a + b, 0) / targets.length);
    }
    for (let i = 1; i < averages.length; i++) {
      expect(averages[i], `division ${i + 1} is not harder than ${i}`)
        .toBeGreaterThan(averages[i - 1]);
    }
  });

  it('is deterministic per seed', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      expect(pickSyntheticTarget(5, seed)).toBe(pickSyntheticTarget(5, seed));
    }
  });

  it('samples the observed distribution once there is enough history', () => {
    const observed = [300, 320, 340, 360, 380, 400];
    for (const seed of SEEDS) {
      const t = pickSyntheticTarget(3, seed, observed);
      // Sampled from the observed range, jittered +/-15%, then nerfed to a
      // quarter of a real player's week (SYNTHETIC_EFFORT_MULTIPLIER).
      expect(t).toBeGreaterThanOrEqual(
        Math.round(300 * 0.85 * SYNTHETIC_EFFORT_MULTIPLIER),
      );
      expect(t).toBeLessThanOrEqual(
        Math.round(400 * 1.15 * SYNTHETIC_EFFORT_MULTIPLIER),
      );
    }
  });

  it('lands well under a real player of the same division', () => {
    // The point of the nerf: padding fills the middle of the board, it does not
    // win it. A division-1 bot must not out-earn a modest real division-1 week.
    for (const seed of SEEDS) {
      expect(pickSyntheticTarget(1, seed)).toBeLessThanOrEqual(
        Math.ceil(160 * SYNTHETIC_EFFORT_MULTIPLIER),
      );
      expect(pickSyntheticTarget(ARENA_DIVISION_COUNT, seed)).toBeLessThanOrEqual(
        Math.ceil(820 * SYNTHETIC_EFFORT_MULTIPLIER),
      );
    }
  });

  it('falls back to the band when history is too thin to trust', () => {
    // Fewer than 5 observations: a single outlier week must not define the bots.
    const t = pickSyntheticTarget(1, 42, [9999]);
    expect(t).toBeLessThan(1000);
  });

  it('clamps an out-of-range division instead of indexing off the end', () => {
    expect(() => pickSyntheticTarget(0, 1)).not.toThrow();
    expect(() => pickSyntheticTarget(99, 1)).not.toThrow();
    expect(pickSyntheticTarget(99, 1)).toBe(pickSyntheticTarget(ARENA_DIVISION_COUNT, 1));
  });

  it('always returns a positive target', () => {
    for (let d = 1; d <= ARENA_DIVISION_COUNT; d++) {
      for (const seed of SEEDS) {
        expect(pickSyntheticTarget(d, seed)).toBeGreaterThan(0);
      }
    }
  });
});

describe('elapsedFraction', () => {
  const start = new Date('2026-08-18T08:00:00Z');
  const close = new Date('2026-08-23T20:00:00Z');

  it('maps the active period onto [0, 1]', () => {
    expect(elapsedFraction(start, close, start)).toBe(0);
    expect(elapsedFraction(start, close, close)).toBe(1);
    const mid = new Date((start.getTime() + close.getTime()) / 2);
    expect(elapsedFraction(start, close, mid)).toBeCloseTo(0.5, 5);
  });

  it('clamps before the start and after the close', () => {
    expect(elapsedFraction(start, close, new Date('2026-01-01T00:00:00Z'))).toBe(0);
    expect(elapsedFraction(start, close, new Date('2027-01-01T00:00:00Z'))).toBe(1);
  });

  it('treats a zero-or-negative span as finished rather than dividing by zero', () => {
    expect(elapsedFraction(close, start, new Date())).toBe(1);
    expect(elapsedFraction(start, start, start)).toBe(1);
  });
});

describe('pickSyntheticName', () => {
  it('never repeats a name within one arena', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const name = pickSyntheticName(i * 31 + 7, taken);
      expect(taken.has(name), `repeated ${name}`).toBe(false);
      taken.add(name);
    }
    expect(taken.size).toBe(24);
  });

  it('still yields a unique name when the pool is exhausted', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const name = pickSyntheticName(i, taken);
      expect(taken.has(name)).toBe(false);
      taken.add(name);
    }
    expect(taken.size).toBe(40);
  });

  it('is deterministic for the same seed and taken-set', () => {
    expect(pickSyntheticName(99, new Set())).toBe(pickSyntheticName(99, new Set()));
  });
});
