/**
 * superpositionBreak.test.ts — Superposition's flp break adapter
 * (src/games/flpBreak/superpositionBreak.ts, docs/SUPERPOSITION_GAME.md).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FlpBreakCandidate, FlpBreakContext } from '../types';

const dealSuperposition = vi.fn();
const loadGlyph = vi.fn();
vi.mock('../../../api/superposition', () => ({ dealSuperposition: (req: unknown) => dealSuperposition(req) }));
vi.mock('../../../components/handwriting/GlyphSvg', () => ({ loadGlyph: (char: string) => loadGlyph(char) }));

const { SUPERPOSITION_BREAK } = await import('../superpositionBreak');

const context: FlpBreakContext = {
  language: 'zh',
  world: 'writing',
  seedIds: [1, 2],
};
const candidate = {} as FlpBreakCandidate;

describe('SUPERPOSITION_BREAK', () => {
  beforeEach(() => {
    dealSuperposition.mockReset();
    loadGlyph.mockReset();
    dealSuperposition.mockResolvedValue([{ characters: [{ char: '人' }, { char: '民' }] }]);
  });

  it('seeds the deal and loads the stroke data before Play', async () => {
    await SUPERPOSITION_BREAK.prefetch(candidate, context);
    expect(dealSuperposition).toHaveBeenCalledWith({ seedIds: [1, 2], flpBreak: true });
    expect(loadGlyph.mock.calls.map(([char]) => char)).toEqual(['人', '民']);
  });

  it('an empty board is not playable', () => {
    expect(SUPERPOSITION_BREAK.isPlayable?.([])).toBe(false);
  });
});
