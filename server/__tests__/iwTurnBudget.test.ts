/**
 * iwTurnBudget.test.ts — § 7's server-side bound.
 *
 * Every rule here is about time or volume, so the clock is injected and nothing sleeps.
 * The thing under test is the ONLY bound that exists once Q4c made the input free text, so
 * these cases are written from the attacker's side — a caller who never ran our JavaScript
 * — rather than from a well-behaved client's.
 */

import { describe, it, expect } from 'vitest';
import {
  capListeners,
  checkUtterance,
  IWTurnBudget,
  IW_DAILY_TURN_CAP,
  IW_MAX_LISTENERS_PER_UTTERANCE,
  IW_MAX_UTTERANCE_CHARS,
  IW_MIN_TURN_GAP_MS,
  IW_SESSION_TURN_BUDGET,
} from '../services/iw/turnBudget.js';

/** A budget with a clock the test drives by hand. */
function budgetAt(start = 1_000_000): { budget: IWTurnBudget; advance: (ms: number) => void } {
  let now = start;
  return { budget: new IWTurnBudget(() => now), advance: (ms: number) => { now += ms; } };
}

describe('checkUtterance', () => {
  it('accepts an ordinary learner sentence', () => {
    expect(checkUtterance('我要一碗牛肉面，谢谢')).toBeNull();
  });

  it('refuses an utterance over the cap', () => {
    const refusal = checkUtterance('字'.repeat(IW_MAX_UTTERANCE_CHARS + 1));
    expect(refusal).toEqual({ code: 'utterance-too-long', limit: IW_MAX_UTTERANCE_CHARS, got: IW_MAX_UTTERANCE_CHARS + 1 });
  });

  it('does not count padding whitespace as content', () => {
    // A client that pads to look longer is not saying more, and a client that pads to sneak
    // past the cap should not be able to either — trimming is what makes both true.
    expect(checkUtterance(`  ${'字'.repeat(IW_MAX_UTTERANCE_CHARS)}  `)).toBeNull();
  });

  it('counts CODE POINTS, not UTF-16 units', () => {
    // The cap protects the PROMPT, and an emoji is one thing a model reads, not two. Using
    // `.length` here would refuse a legal utterance of half the stated size.
    const emoji = '😀'.repeat(IW_MAX_UTTERANCE_CHARS);
    expect(emoji.length).toBe(IW_MAX_UTTERANCE_CHARS * 2);
    expect(checkUtterance(emoji)).toBeNull();
  });
});

describe('capListeners', () => {
  it('drops beyond the cap rather than refusing', () => {
    const many = Array.from({ length: 9 }, (_, i) => `npc${i}`);
    expect(capListeners(many)).toHaveLength(IW_MAX_LISTENERS_PER_UTTERANCE);
  });

  it('keeps the order it was given', () => {
    // The caller sorts by distance, because the nearest NPCs are the ones a learner is
    // plausibly talking to. Reordering here would silently pick the wrong ones.
    expect(capListeners(['near', 'mid', 'far'])).toEqual(['near', 'mid', 'far']);
  });
});

describe('IWTurnBudget — the per-utterance rate limit', () => {
  it('allows a first turn', () => {
    const { budget } = budgetAt();
    expect(budget.check('u1', 's1').refusal).toBeNull();
  });

  it('refuses a second turn inside the gap', () => {
    const { budget, advance } = budgetAt();
    budget.spend('u1', 's1');
    advance(IW_MIN_TURN_GAP_MS - 1);
    expect(budget.check('u1', 's1').refusal).toMatchObject({ code: 'too-fast' });
  });

  it('tells the caller how long to wait', () => {
    const { budget, advance } = budgetAt();
    budget.spend('u1', 's1');
    advance(200);
    const refusal = budget.check('u1', 's1').refusal;
    expect(refusal).toEqual({ code: 'too-fast', retryAfterMs: IW_MIN_TURN_GAP_MS - 200 });
  });

  it('allows the next turn once the gap has passed', () => {
    const { budget, advance } = budgetAt();
    budget.spend('u1', 's1');
    advance(IW_MIN_TURN_GAP_MS);
    expect(budget.check('u1', 's1').refusal).toBeNull();
  });

  it('does not let one user throttle another', () => {
    const { budget } = budgetAt();
    budget.spend('u1', 's1');
    expect(budget.check('u2', 's2').refusal).toBeNull();
  });
});

describe('IWTurnBudget — the session budget', () => {
  it('counts down as turns are spent', () => {
    const { budget, advance } = budgetAt();
    budget.spend('u1', 's1');
    advance(IW_MIN_TURN_GAP_MS);
    expect(budget.check('u1', 's1').remaining).toBe(IW_SESSION_TURN_BUDGET - 1);
  });

  it('winds the scene down when it is spent', () => {
    const { budget, advance } = budgetAt();
    for (let i = 0; i < IW_SESSION_TURN_BUDGET; i++) {
      budget.spend('u1', 's1');
      advance(IW_MIN_TURN_GAP_MS);
    }
    const verdict = budget.check('u1', 's1');
    expect(verdict.refusal).toEqual({ code: 'session-spent', spent: IW_SESSION_TURN_BUDGET });
    expect(verdict.remaining).toBe(0);
  });

  it('is per session, so a new run starts fresh', () => {
    const { budget, advance } = budgetAt();
    for (let i = 0; i < IW_SESSION_TURN_BUDGET; i++) {
      budget.spend('u1', 's1');
      advance(IW_MIN_TURN_GAP_MS);
    }
    expect(budget.check('u1', 's2').refusal).toBeNull();
  });

  it('releases a finished run', () => {
    const { budget } = budgetAt();
    budget.spend('u1', 's1');
    expect(budget.remaining('s1')).toBe(IW_SESSION_TURN_BUDGET - 1);
    budget.endSession('s1');
    expect(budget.remaining('s1')).toBe(IW_SESSION_TURN_BUDGET);
  });
});

describe('IWTurnBudget — the daily cap', () => {
  it('stops a caller who keeps opening new sessions', () => {
    // This is the case the session budget alone does not cover, and it is the one that
    // costs real money: exhaust a run, start another, repeat.
    const { budget, advance } = budgetAt();
    for (let i = 0; i < IW_DAILY_TURN_CAP; i++) {
      budget.spend('u1', `s${Math.floor(i / IW_SESSION_TURN_BUDGET)}`);
      advance(IW_MIN_TURN_GAP_MS);
    }
    expect(budget.check('u1', 'fresh').refusal).toMatchObject({ code: 'daily-cap' });
  });

  it('bills a fanned-out send once per model call', () => {
    // § 4.1: one utterance can be several calls. The daily cap is a money bound, so it must
    // count calls; the session budget counts sends, which is what the HUD dresses up.
    const { budget } = budgetAt();
    budget.spend('u1', 's1', 4);
    expect(budget.remaining('s1')).toBe(IW_SESSION_TURN_BUDGET - 1);
  });

  it('resets on the next local day', () => {
    const { budget, advance } = budgetAt();
    for (let i = 0; i < IW_DAILY_TURN_CAP; i++) {
      budget.spend('u1', 's1', 1);
      advance(IW_MIN_TURN_GAP_MS);
    }
    advance(24 * 60 * 60 * 1000);
    expect(budget.check('u1', 'tomorrow').refusal).toBeNull();
  });
});

describe('the check/spend split', () => {
  it('does not charge for a turn that was only checked', () => {
    // A turn the ladder could not answer (§ 14 Q7's frozen outcome) gave the learner
    // nothing, so it must cost them nothing.
    const { budget } = budgetAt();
    budget.check('u1', 's1');
    budget.check('u1', 's1');
    expect(budget.remaining('s1')).toBe(IW_SESSION_TURN_BUDGET);
  });
});
