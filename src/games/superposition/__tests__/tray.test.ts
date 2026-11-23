/**
 * tray.test.ts — Superposition's tray layout (src/games/superposition/tray.ts,
 * docs/SUPERPOSITION_GAME.md § Tray).
 *
 * Pinned: slots wrap at the tray's width, every row (the short last one included) is
 * centred, the height follows the row count, and the hit-test finds the slot under a point.
 */
import { describe, expect, it } from 'vitest';
import { slotAt, trayLayout } from '../tray';

const metrics = { miniPx: 40, gapPx: 8, paddingPx: 12 };

describe('trayLayout', () => {
  it('wraps into centred rows', () => {
    // 390 wide: (390 − 24 + 8) / 48 → 7 per row, so 10 slots make rows of 7 and 3.
    const { slots, height } = trayLayout(10, 390, metrics);
    expect(slots).toHaveLength(10);
    expect(slots[6].top).toBe(12);
    expect(slots[7].top).toBe(60);
    const fullRow = 7 * 40 + 6 * 8;
    expect(slots[0].left).toBe((390 - fullRow) / 2);
    const lastRow = 3 * 40 + 2 * 8;
    expect(slots[7].left).toBe((390 - lastRow) / 2);
    expect(height).toBe(12 * 2 + 2 * 40 + 8);
  });

  it('keeps one slot a row on a tray too narrow for one', () => {
    const { slots } = trayLayout(2, 10, metrics);
    expect(slots[1].top).toBe(60);
  });

  it('is empty with no tiles', () => {
    expect(trayLayout(0, 390, metrics)).toEqual({ slots: [], height: 0 });
  });
});

describe('slotAt', () => {
  it('finds the slot under a point, or -1 in a gap', () => {
    const { slots } = trayLayout(3, 390, metrics);
    expect(slotAt(slots, slots[1].left + 5, slots[1].top + 5)).toBe(1);
    expect(slotAt(slots, slots[1].left - 2, slots[1].top + 5)).toBe(-1);
  });
});
