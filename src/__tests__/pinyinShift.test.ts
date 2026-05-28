import { describe, it, expect } from 'vitest';
import { computePinyinShifts } from '../utils/pinyinShift';

// Use shiftUnitPx=1 so the returned numbers equal the unit counts directly.
const shifts = (pinyins: string[]) =>
    computePinyinShifts(pinyins.map((p) => ({ pinyin: p })), 1);

describe('computePinyinShifts', () => {
    it('matches the worked example: zhuang zhuang yi', () => {
        // First zhuang shifts -1, second zhuang shifts +1, yi shifts +2 (one
        // direct push from neighbor and one propagated through the long chain).
        expect(shifts(['zhuang', 'zhuang', 'yi'])).toEqual([-1, 1, 2]);
    });

    it('mirrors symmetrically: yi zhuang zhuang', () => {
        expect(shifts(['yi', 'zhuang', 'zhuang'])).toEqual([-2, -1, 1]);
    });

    it('handles a single long syllable surrounded by shorts', () => {
        expect(shifts(['ni', 'zhuang', 'hao'])).toEqual([-1, 0, 1]);
    });

    it('returns all zeros when no syllable is long', () => {
        expect(shifts(['ni', 'hao', 'ma'])).toEqual([0, 0, 0]);
    });

    it('cancels the middle of a run of three longs', () => {
        // Each end gets pushed by both neighbors (with propagation); middle
        // receives equal-and-opposite pushes from its two neighbors.
        expect(shifts(['zhuang', 'zhuang', 'zhuang'])).toEqual([-2, 0, 2]);
    });

    it('ignores empty/undefined pinyins as not long', () => {
        expect(shifts(['', 'zhuang', ''])).toEqual([-1, 0, 1]);
    });

    it('scales by shiftUnitPx', () => {
        expect(
            computePinyinShifts(
                ['zhuang', 'zhuang', 'yi'].map((p) => ({ pinyin: p })),
                3
            )
        ).toEqual([-3, 3, 6]);
    });
});
