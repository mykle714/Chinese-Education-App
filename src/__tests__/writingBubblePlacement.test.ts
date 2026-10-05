/**
 * writingBubblePlacement → placeBubble: one level, random x within the card, never
 * overlapping an already-placed bubble (docs/WRITING_PRACTICE_REWORK.md § 3b "Placement").
 */
import { describe, expect, it } from 'vitest';
import { placeBubble, BUBBLE_GAP, EDGE_INSET, type BubblePlacement } from '../features/flashcards/FlashcardsLearnPage/writingBubblePlacement';

const size = { w: 80, h: 50 };
const CARD = 300;

/** Do two placements overlap (gap included)? */
const clash = (a: BubblePlacement, b: BubblePlacement) =>
    a.x < b.x + b.w + BUBBLE_GAP && b.x < a.x + a.w + BUBBLE_GAP;

describe('placeBubble', () => {
    it('spans the whole card width across the random range', () => {
        expect(placeBubble(size, CARD, [], () => 0).x).toBe(EDGE_INSET);
        expect(placeBubble(size, CARD, [], () => 1).x).toBe(CARD - EDGE_INSET - size.w);
    });

    it('never overlaps a placed bubble, whatever the draw', () => {
        const first = placeBubble(size, CARD, [], () => 0.5);
        for (let i = 0; i <= 20; i++) {
            const second = placeBubble(size, CARD, [first], () => i / 20);
            expect(clash(first, second)).toBe(false);
            expect(second.x).toBeGreaterThanOrEqual(EDGE_INSET);
            expect(second.x + second.w).toBeLessThanOrEqual(CARD - EDGE_INSET);
        }
    });

    it('uses the free space on both sides of a placed bubble', () => {
        const middle = { x: 110, w: 80, h: 50 };
        const xs = [0, 0.25, 0.75, 1].map((r) => placeBubble(size, CARD, [middle], () => r).x);
        expect(xs.some((x) => x < middle.x)).toBe(true);
        expect(xs.some((x) => x > middle.x)).toBe(true);
    });

    it('falls back to the least-overlapping end when no spot is free', () => {
        const wide = { x: 60, w: 200, h: 50 };
        const placed = placeBubble({ w: 120, h: 50 }, CARD, [wide], () => 0.5);
        expect([EDGE_INSET, CARD - EDGE_INSET - 120]).toContain(placed.x);
    });

    it('centres a bubble wider than the card', () => {
        expect(placeBubble({ w: 320, h: 50 }, CARD, [], () => 0.9).x).toBe(-10);
    });
});
