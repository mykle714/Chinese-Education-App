/**
 * Guards the hand-maintained sync between the client and server copies of the Night Market
 * template editor's placeholder-area primitives. The server can't import the client module
 * (it lives outside the `server/` Docker build context), so the area shape + drop sizes are
 * duplicated in:
 *   - src/engine/market/placeholderArea.ts        (source of truth)
 *   - server/dal/shared/placeholderArea.ts        (server mirror)
 * If PLACEHOLDER_SIZES drift, the editor's size toggle and the server save validator disagree
 * about which drop sizes are legal.
 */
import { describe, it, expect } from 'vitest';
import {
  PLACEHOLDER_SIZES as CLIENT_SIZES,
  isValidPlaceholderSize,
} from '../engine/market/placeholderArea';
import { PLACEHOLDER_SIZES as SERVER_SIZES } from '../../server/dal/shared/placeholderArea';

describe('PLACEHOLDER_SIZES sync', () => {
  it('client and server lists are identical (same values, same order)', () => {
    expect([...SERVER_SIZES]).toEqual([...CLIENT_SIZES]);
  });

  it('every server size is accepted by the client size validator', () => {
    for (const { w, h } of SERVER_SIZES) {
      expect(isValidPlaceholderSize(w, h)).toBe(true);
    }
  });
});
