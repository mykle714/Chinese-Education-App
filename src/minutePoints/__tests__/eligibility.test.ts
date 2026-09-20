import { describe, expect, it } from 'vitest';
import { isMinutePointsAutoActivePath, isMinutePointsEligiblePath } from '../eligibility';

/**
 * Minute-point route eligibility.
 *
 * Worth a suite because both failure directions are SILENT: a study surface that quietly earns
 * nothing (the immersive world, until 2026-09-07) and a menu that quietly farms points look
 * identical from the screen — the header flame is the only tell, and it is easy to read as
 * "not interacting yet".
 */
describe('isMinutePointsEligiblePath', () => {
  it('earns on the study surfaces', () => {
    expect(isMinutePointsEligiblePath('/flashcards/learn')).toBe(true);
    expect(isMinutePointsEligiblePath('/reader')).toBe(true);
    expect(isMinutePointsEligiblePath('/games/word-search')).toBe(true);
  });

  it('does not earn on hubs and browse screens', () => {
    expect(isMinutePointsEligiblePath('/')).toBe(false);
    expect(isMinutePointsEligiblePath('/discover')).toBe(false);
    expect(isMinutePointsEligiblePath('/flashcards/decks')).toBe(false);
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

  describe('the immersive world (2026-09-07)', () => {
    it('earns inside a scene', () => {
      // The play surface is `/immersive-world/:sceneId`, so only a PREFIX can admit it.
      expect(isMinutePointsEligiblePath('/immersive-world/dc16dd0e-98e9-421c-a9ff-5e30b942b539')).toBe(true);
    });

    it('does not earn on the scene list or in the editor', () => {
      // The two siblings that same prefix sweeps in — a hub you pick from, and an authoring
      // surface an author could leave open all afternoon.
      expect(isMinutePointsEligiblePath('/immersive-world')).toBe(false);
      expect(isMinutePointsEligiblePath('/immersive-world/scene-editor')).toBe(false);
    });

    it('excludes by EXACT path, so a child of the editor is judged on its own', () => {
      // The exclusion must not become a second, invisible prefix list.
      expect(isMinutePointsEligiblePath('/immersive-world/scene-editor/preview')).toBe(true);
    });
  });
});

describe('isMinutePointsAutoActivePath', () => {
  it('is games and only games', () => {
    expect(isMinutePointsAutoActivePath('/games/hydra-bubbles')).toBe(true);
    // A scene needs a real interaction before it earns, like every non-game surface: it is
    // read for a long time, and the composer makes the learner's involvement explicit.
    expect(isMinutePointsAutoActivePath('/immersive-world/abc')).toBe(false);
    expect(isMinutePointsAutoActivePath('/flashcards/learn')).toBe(false);
  });
});
