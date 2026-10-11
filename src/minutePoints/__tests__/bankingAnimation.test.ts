import { describe, it, expect } from 'vitest';
import {
  BANKING_ANIMATION,
  bankingIntensity,
  planBankingRun,
  sampleBankingRun,
} from '../dailyBanking/bankingAnimation';

// The hp daily banking run's pure timeline (docs/DAILY_MINUTE_BANKING.md § 3–4).

describe('bankingIntensity', () => {
  it('is 0 for an empty day and 1 at or past the full-ceremony size', () => {
    expect(bankingIntensity(0)).toBe(0);
    expect(bankingIntensity(BANKING_ANIMATION.fullCeremonyMinutes)).toBeCloseTo(1);
    expect(bankingIntensity(1000)).toBe(1);
  });

  it('is logarithmic: 3→30 is a bigger step than 90→120', () => {
    expect(bankingIntensity(30) - bankingIntensity(3)).toBeGreaterThan(
      bankingIntensity(120) - bankingIntensity(90)
    );
  });
});

describe('planBankingRun', () => {
  it('scales every knob with the size of yesterday', () => {
    const small = planBankingRun(3, 0);
    const big = planBankingRun(200, 0);
    expect(big.peakScale).toBeGreaterThan(small.peakScale);
    expect(big.totalMs).toBeGreaterThan(small.totalMs);
    expect(big.peakGlowPx).toBeGreaterThan(small.peakGlowPx);
  });

  it('flies exactly one ember per minute drained', () => {
    expect(planBankingRun(3, 0).emberCount).toBe(3);
    expect(planBankingRun(500, 0).emberCount).toBe(500);
  });
});

describe('sampleBankingRun', () => {
  const plan = planBankingRun(45, 7);
  const drainStart = plan.restMs + plan.swellMs;
  const settleStart = drainStart + plan.drainMs;

  it('opens on yesterday, full, at normal size, with no glow', () => {
    const f = sampleBankingRun(plan, 0);
    expect(f.displayCount).toBe(45);
    expect(f.fillLevel).toBe(1);
    expect(f.flameScale).toBe(1);
    expect(f.glowPx).toBe(0);
    expect(f.done).toBe(false);
  });

  it('swells above 1× before the drain', () => {
    expect(sampleBankingRun(plan, drainStart - 1).flameScale).toBeGreaterThan(1.1);
  });

  it('only ever grows the glow during the drain — nothing else counts up (Q6)', () => {
    let prev = 0;
    for (let t = drainStart; t <= settleStart; t += 16) {
      const g = sampleBankingRun(plan, t).glowPx;
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it('always drains to 0 at exactly 1×, whatever today holds', () => {
    const f = sampleBankingRun(plan, settleStart);
    expect(f.displayCount).toBe(0);
    expect(f.flameScale).toBe(1);
    expect(f.fillLevel).toBe(0);
  });

  it('launches each ember the instant the count drops by its minute', () => {
    // Sum over time of embers launched (in the air + landed) must equal minutes drained.
    for (let t = drainStart; t <= settleStart; t += 7) {
      const f = sampleBankingRun(plan, t);
      const launched = f.embers.length + Math.round((f.glowPx / plan.peakGlowPx) * plan.emberCount);
      expect(launched).toBe(45 - f.displayCount);
    }
  });

  it('has the avatar fully charged once the last ember lands, and the glow gone before the count-up', () => {
    expect(sampleBankingRun(plan, settleStart + BANKING_ANIMATION.emberFlightMs).glowPx).toBeCloseTo(plan.peakGlowPx);
    expect(sampleBankingRun(plan, settleStart + plan.settleMs).glowPx).toBeCloseTo(0);
  });

  it('then counts up from 0 to today, never past it', () => {
    let prev = 0;
    for (let t = settleStart + plan.settleMs; t <= plan.totalMs; t += 16) {
      const c = sampleBankingRun(plan, t).displayCount;
      expect(c).toBeGreaterThanOrEqual(prev);
      expect(c).toBeLessThanOrEqual(7);
      prev = c;
    }
    expect(sampleBankingRun(plan, plan.totalMs).displayCount).toBe(7);
  });

  it('with nothing earned today, stays at 0 and only relights', () => {
    const p0 = planBankingRun(45, 0);
    expect(p0.countUpMs).toBe(BANKING_ANIMATION.relightOnlyMs);
    const end = sampleBankingRun(p0, p0.totalMs);
    expect(end.displayCount).toBe(0);
    expect(end.fillLevel).toBeCloseTo(1);
  });

  it('ends relit and done, matching the plain off-study flame', () => {
    const f = sampleBankingRun(plan, plan.totalMs);
    expect(f.done).toBe(true);
    expect(f.fillLevel).toBeCloseTo(1);
    expect(f.embers).toHaveLength(0);
  });
});
