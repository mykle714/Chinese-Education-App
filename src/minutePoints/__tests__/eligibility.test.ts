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
    expect(isMinutePointsEligiblePath('/flashcards/card/7')).toBe(true);
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

  it('keeps the exact-match page from leaking to its children', () => {
    // The legacy desktop flashcards page is a study surface; everything under it browses.
    expect(isMinutePointsEligiblePath('/flashcards')).toBe(true);
    expect(isMinutePointsEligiblePath('/flashcards/collection/3')).toBe(false);
  });

});

describe('isMinutePointsAutoActivePath', () => {
  it('is games and only games', () => {
    expect(isMinutePointsAutoActivePath('/games/hydra-bubbles')).toBe(true);
    expect(isMinutePointsAutoActivePath('/flashcards/card/7')).toBe(false);
  });
});
