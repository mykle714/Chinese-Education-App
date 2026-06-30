/**
 * Guards the hand-maintained sync between the client and server copies of
 * DEFAULT_PLACEMENT_SCALES — the scales that count as a "default placement" in the
 * basic-vs-advanced icon-layout inference. The server can't import the client module
 * (and vice versa), so the list is duplicated in:
 *   - src/features/flashcards/FlashcardsLearnPage/cardIconLayout.ts  (source of truth)
 *   - server/dal/shared/advancedLayout.ts               (mirror)
 * If they drift, the Community feeds' advanced-layout gate disagrees with the editor.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_PLACEMENT_SCALES as CLIENT_SCALES, DEFAULT_ICON_SCALE } from '../features/flashcards/FlashcardsLearnPage/cardIconLayout';
import { DEFAULT_PLACEMENT_SCALES as SERVER_SCALES } from '../../server/dal/shared/advancedLayout';

describe('DEFAULT_PLACEMENT_SCALES sync', () => {
  it('client and server lists are identical (same values, same order)', () => {
    expect([...SERVER_SCALES]).toEqual([...CLIENT_SCALES]);
  });

  it('the current default scale is included', () => {
    expect(CLIENT_SCALES).toContain(DEFAULT_ICON_SCALE);
  });
});
