/**
 * bucketDropBreak.test.ts — Bucket Drop's flp break adapter
 * (src/games/flpBreak/bucketDropBreak.ts, docs/BUCKET_DROP_GAME.md § 8).
 *
 * Pinned: the prefetch pools on the CANDIDATE's track, so a break's board is bucketed and
 * cooled on the bar being studied, and an empty pool sends the flp to another game.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GamePoolResponse } from '../../../api/gamePool';
import type { FlpBreakCandidate, FlpBreakContext } from '../types';

const fetchGamePool = vi.fn();
vi.mock('../../../api/gamePool', () => ({ fetchGamePool: (req: unknown) => fetchGamePool(req) }));

const { BUCKET_DROP_BREAK } = await import('../bucketDropBreak');

const context: FlpBreakContext = {
  language: 'es',
  world: 'reading',
  seedIds: [1, 2],
};
const candidate = { mode: 'no-pinyin', markType: 'reading', showPinyin: false } as FlpBreakCandidate;

describe('BUCKET_DROP_BREAK', () => {
  beforeEach(() => fetchGamePool.mockReset());

  it('prefetches on the candidate track, seeded and flagged as a break', async () => {
    fetchGamePool.mockResolvedValue({ cards: [] });
    await BUCKET_DROP_BREAK.prefetch(candidate, context);
    expect(fetchGamePool).toHaveBeenCalledWith(expect.objectContaining({
      markType: 'reading',
      surface: 'bucket-drop',
      seedIds: [1, 2],
      flpBreak: true,
    }));
  });

  it('is playable only with cards to deal', () => {
    const pool = (n: number) => ({ cards: new Array(n).fill({}) }) as GamePoolResponse;
    expect(BUCKET_DROP_BREAK.isPlayable?.(pool(0))).toBe(false);
    expect(BUCKET_DROP_BREAK.isPlayable?.(pool(1))).toBe(true);
  });
});
