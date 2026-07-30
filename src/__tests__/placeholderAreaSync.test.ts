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
  placeholderUnitSlots as clientUnitSlots,
} from '../engine/market/placeholderArea';
import {
  PLACEHOLDER_SIZES as SERVER_SIZES,
  placeholderUnitSlots as serverUnitSlots,
} from '../../server/dal/shared/placeholderArea';

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

/**
 * The unit-slot tiling decides WHICH ids an unlock can occupy, so a client/server drift here
 * would make the renderer light up slots the grant flow never fills (or vice versa).
 */
describe('placeholderUnitSlots sync', () => {
  it('client and server split every drop size identically', () => {
    for (const { w, h } of CLIENT_SIZES) {
      const area = { col: 7, row: 3, w, h };
      expect(serverUnitSlots(area)).toEqual(clientUnitSlots(area));
    }
  });

  it('units exactly tile the area with occupant-sized (4×5 / 5×4) rects', () => {
    for (const { w, h } of CLIENT_SIZES) {
      const area = { col: 7, row: 3, w, h };
      const units = clientUnitSlots(area);

      // Count: a double-sized drop is two unlocks, a single-sized drop is one.
      expect(units.length).toBe((w * h) / 20);
      // Cover: the units' cells are exactly the parent area's cells, no overlap, no gap.
      const cells = new Set(units.flatMap((u) => clientUnitCells(u)));
      expect(cells.size).toBe(w * h);
      expect(units.every((u) => (u.w === 4 && u.h === 5) || (u.w === 5 && u.h === 4))).toBe(true);
    }
  });

  it('the first unit inherits the parent anchor (pre-split occupant rows stay valid)', () => {
    for (const { w, h } of CLIENT_SIZES) {
      const [first] = clientUnitSlots({ col: 7, row: 3, w, h });
      expect({ col: first.col, row: first.row }).toEqual({ col: 7, row: 3 });
    }
  });
});

/** Local cell expansion — kept here so the test doesn't depend on which module exports it. */
function clientUnitCells(u: { col: number; row: number; w: number; h: number }): string[] {
  const out: string[] = [];
  for (let dx = 0; dx < u.w; dx++) for (let dy = 0; dy < u.h; dy++) out.push(`${u.col + dx},${u.row + dy}`);
  return out;
}
