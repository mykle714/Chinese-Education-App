import { describe, expect, it } from 'vitest';
import { insertBehindFront, removeFromLoop } from '../loopSplice';
import type { VocabEntry } from '../../types';

const card = (id: number) => ({ id }) as VocabEntry;
const ids = (state: { loop: VocabEntry[] }) => state.loop.map((c) => c.id);

describe('removeFromLoop', () => {
    it('keeps a surviving front card on front', () => {
        const state = removeFromLoop({ loop: [1, 2, 3, 4].map(card), index: 2 }, new Set([1, 4]));
        expect(ids(state)).toEqual([2, 3]);
        expect(state.loop[state.index].id).toBe(3);
    });

    it('moves the front to the next survivor round the ring when the front is removed', () => {
        const state = removeFromLoop({ loop: [1, 2, 3, 4].map(card), index: 2 }, new Set([3, 4]));
        expect(ids(state)).toEqual([1, 2]);
        expect(state.loop[state.index].id).toBe(1);
    });

    it('empties to index 0', () => {
        expect(removeFromLoop({ loop: [card(1)], index: 0 }, new Set([1]))).toEqual({ loop: [], index: 0 });
    });
});

describe('insertBehindFront', () => {
    it('inserts before the front so the front and back cards stay put', () => {
        const state = insertBehindFront({ loop: [1, 2, 3].map(card), index: 1 }, [card(8), card(9)]);
        expect(ids(state)).toEqual([1, 8, 9, 2, 3]);
        expect(state.loop[state.index].id).toBe(2);
        expect(state.loop[state.index + 1].id).toBe(3);
    });

    it('skips cards already in the loop', () => {
        const state = insertBehindFront({ loop: [1, 2].map(card), index: 0 }, [card(2), card(5)]);
        expect(ids(state)).toEqual([5, 1, 2]);
        expect(state.loop[state.index].id).toBe(1);
    });

    it('fills an empty loop from index 0', () => {
        expect(ids(insertBehindFront({ loop: [], index: 0 }, [card(4), card(5)]))).toEqual([4, 5]);
    });
});
