/**
 * iwLearnerProfile.test.ts — how an NPC sees the learner (migration 164, § 5.5).
 *
 * Three things are pinned here:
 *   1. The age arithmetic counts a birthday ON the day, not the day after.
 *   2. The NPC gets a coarse band and a gender, NEVER the birth date — the date is private.
 *   3. An unset learner changes nothing: no line at all, i.e. the pre-164 prompt byte for byte.
 *
 * Plus the write-side validator shared by signup and Settings (`validateDemographics`).
 */

import { describe, it, expect } from 'vitest';
import { ageOn, describeLearner, renderLearnerLine } from '../services/iw/learnerProfile.js';
import { renderTurnState, type TurnStateInput } from '../services/iw/turnState.js';
import { validateDemographics } from '../services/UserService.js';
import { iwPlayerAvatar, IW_DEFAULT_PLAYER_AVATAR } from '../contracts/iw.js';

const NOW = new Date(Date.UTC(2026, 8, 23)); // 2026-09-23

describe('ageOn', () => {
  it('turns a year older on the birthday itself', () => {
    expect(ageOn('1990-09-23', NOW)).toBe(36);
    expect(ageOn('1990-09-24', NOW)).toBe(35);
    expect(ageOn('1990-09-22', NOW)).toBe(36);
  });

  it('is null for a missing, garbled or future date', () => {
    expect(ageOn(null, NOW)).toBeNull();
    expect(ageOn(undefined, NOW)).toBeNull();
    expect(ageOn('23/09/1990', NOW)).toBeNull();
    expect(ageOn('2027-01-01', NOW)).toBeNull();
  });
});

describe('describeLearner', () => {
  it('says nothing when the learner has told us nothing', () => {
    expect(describeLearner({}, NOW)).toBeNull();
    expect(describeLearner({ gender: null, birthDate: null }, NOW)).toBeNull();
  });

  it('describes gender alone, and age alone', () => {
    expect(describeLearner({ gender: 'female' }, NOW)).toBe('a woman');
    expect(describeLearner({ gender: 'male' }, NOW)).toBe('a man');
    expect(describeLearner({ birthDate: '1990-01-01' }, NOW)).toBe('a person in their thirties');
  });

  it('bands by decade, folding 18–19 into the twenties', () => {
    expect(describeLearner({ gender: 'female', birthDate: '2008-01-01' }, NOW)).toBe('a woman in her twenties'); // 18
    expect(describeLearner({ gender: 'male', birthDate: '1976-01-01' }, NOW)).toBe('a man in his fifties'); // 50
    expect(describeLearner({ gender: 'female', birthDate: '1940-01-01' }, NOW)).toBe('a woman in her seventies or older');
  });

  it('describes minors as minors, so no NPC addresses a child as an adult', () => {
    expect(describeLearner({ gender: 'female', birthDate: '2012-01-01' }, NOW)).toBe('a teenage girl'); // 14
    expect(describeLearner({ gender: 'male', birthDate: '2016-01-01' }, NOW)).toBe('a young boy'); // 10
  });

  it('never leaks the birth date or an exact age', () => {
    const text = describeLearner({ gender: 'female', birthDate: '1990-05-17' }, NOW)!;
    expect(text).not.toMatch(/\d/);
  });
});

describe('the layer-3 learner line', () => {
  const base: TurnStateInput = {
    knownWords: ['你好'],
    nearby: [{ label: 'the customer', distance: 1, facingYou: true }],
    heard: [],
    event: { kind: 'approach', who: 'the customer' },
  };

  it('is absent entirely for an unset learner — the pre-164 prompt, unchanged', () => {
    expect(renderLearnerLine(undefined)).toBeNull();
    expect(renderTurnState(base)).not.toMatch(/LOOKS LIKE/);
  });

  it('names the learner by the same label the rest of the prompt uses', () => {
    const out = renderTurnState({ ...base, learner: 'a woman in her thirties' });
    expect(out).toContain('THE CUSTOMER LOOKS LIKE: a woman in her thirties.');
    // Beside NEARBY, and before the event the NPC is reacting to.
    expect(out.indexOf('LOOKS LIKE')).toBeGreaterThan(out.indexOf('NEARBY'));
    expect(out.indexOf('LOOKS LIKE')).toBeLessThan(out.indexOf('JUST NOW'));
  });
});

describe('iwPlayerAvatar', () => {
  it('follows the account, and falls back to the pre-164 body when unset', () => {
    expect(iwPlayerAvatar('male')).toBe('male');
    expect(iwPlayerAvatar('female')).toBe('female');
    expect(iwPlayerAvatar(null)).toBe(IW_DEFAULT_PLAYER_AVATAR);
    expect(iwPlayerAvatar(undefined)).toBe(IW_DEFAULT_PLAYER_AVATAR);
  });
});

describe('validateDemographics', () => {
  it('passes through only the keys that were sent, null included', () => {
    expect(validateDemographics({}, NOW)).toEqual({});
    expect(validateDemographics({ gender: null }, NOW)).toEqual({ gender: null });
    expect(validateDemographics({ birthDate: '1990-02-28' }, NOW)).toEqual({ birthDate: '1990-02-28' });
  });

  it('rejects an unknown gender', () => {
    expect(() => validateDemographics({ gender: 'other' as never }, NOW)).toThrow(/gender/);
  });

  it('rejects dates that are malformed, unreal, too early or in the future', () => {
    expect(() => validateDemographics({ birthDate: '1990-2-28' }, NOW)).toThrow(/YYYY-MM-DD/);
    expect(() => validateDemographics({ birthDate: '2001-02-29' }, NOW)).toThrow(/real calendar date/);
    expect(() => validateDemographics({ birthDate: '1899-12-31' }, NOW)).toThrow(/1900/);
    expect(() => validateDemographics({ birthDate: '2026-09-24' }, NOW)).toThrow(/future/);
    expect(validateDemographics({ birthDate: '2000-02-29' }, NOW)).toEqual({ birthDate: '2000-02-29' });
  });
});
