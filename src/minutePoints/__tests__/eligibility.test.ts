import { describe, expect, it } from 'vitest';
import { isMinutePointsAutoActivePath, isMinutePointsEligiblePath } from '../eligibility';

/**
 * Minute-point route eligibility.
 *
 * Worth a suite because both failure directions are SILENT: a study surface that quietly earns
 * nothing and a menu that quietly farms points look
 * identical from the screen — the header flame is the only tell, and it is easy to read as
 * "not interacting yet".
 */
describe('isMinutePointsEligiblePath', () => {
  it('earns on the study surfaces', () => {
    expect(isMinutePointsEligiblePath('/flashcards/writing/notebook')).toBe(true);
    expect(isMinutePointsEligiblePath('/reader')).toBe(true);
    expect(isMinutePointsEligiblePath('/games/word-search')).toBe(true);
  });

  it('does not earn on hubs and browse screens', () => {
    expect(isMinutePointsEligiblePath('/')).toBe(false);
    expect(isMinutePointsEligiblePath('/discover')).toBe(false);
    expect(isMinutePointsEligiblePath('/menu')).toBe(false);
  });

  it('matches a prefix only on a segment boundary', () => {
    // `startsWith` alone would admit a route that merely shares a prefix's spelling.
    expect(isMinutePointsEligiblePath('/reader/doc/7')).toBe(true);
    expect(isMinutePointsEligiblePath('/reader-settings')).toBe(false);
  });

  it('does not earn on the bare /flashcards parent or its browse screens', () => {
    // Only named children (`/flashcards/writing/notebook`) are listed. The card detail
    // (`/flashcards/card`, deleted 2026-11-23) is now td's card view, which earns by claiming
    // the study surface (minutePoints/studySurface.ts), not by its path.
    expect(isMinutePointsEligiblePath('/flashcards')).toBe(false);
    expect(isMinutePointsEligiblePath('/flashcards/collection/3')).toBe(false);
  });

});

describe('isMinutePointsAutoActivePath', () => {
  it('is games and only games', () => {
    expect(isMinutePointsAutoActivePath('/games/match-speed')).toBe(true);
    expect(isMinutePointsAutoActivePath('/flashcards/writing/notebook')).toBe(false);
  });
});
