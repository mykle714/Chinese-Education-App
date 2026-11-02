/**
 * writingGridBreak.test.ts — Writing Grid's flp break adapter
 * (src/games/flpBreak/writingGridBreak.ts, docs/FLP_GAME_BREAKS.md § 6).
 *
 * Pinned: the deal is seeded from the loop, the focus rule rides only an unrestricted
 * session (a hand-picked set ignores focus), and an empty board sends the flp elsewhere.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FlpBreakCandidate, FlpBreakContext } from '../types';

const dealWritingGrid = vi.fn();
vi.mock('../../../api/writingGrid', () => ({ dealWritingGrid: (req: unknown) => dealWritingGrid(req) }));

const { WRITING_GRID_BREAK } = await import('../writingGridBreak');

const context: FlpBreakContext = {
  language: 'zh',
  world: 'writing',
  studyMode: null,
  collection: null,
  seedIds: [1, 2],
  towerSession: true,
};
const candidate = {} as FlpBreakCandidate;

describe('WRITING_GRID_BREAK', () => {
  beforeEach(() => {
    dealWritingGrid.mockReset();
    dealWritingGrid.mockResolvedValue([]);
  });

  it('seeds the deal and applies the focus rule on an unrestricted session', async () => {
    await WRITING_GRID_BREAK.prefetch(candidate, context);
    expect(dealWritingGrid).toHaveBeenCalledWith({ seedIds: [1, 2], flpBreak: true });
  });

  it('leaves the focus rule out of a deck session', async () => {
    await WRITING_GRID_BREAK.prefetch(candidate, { ...context, collection: { kind: 'deck', id: 7 } as never });
    expect(dealWritingGrid).toHaveBeenCalledWith({ seedIds: [1, 2], flpBreak: false });
  });

  it('an empty board is not playable', () => {
    expect(WRITING_GRID_BREAK.isPlayable?.([])).toBe(false);
    expect(WRITING_GRID_BREAK.isPlayable?.([{} as never])).toBe(true);
  });
});
