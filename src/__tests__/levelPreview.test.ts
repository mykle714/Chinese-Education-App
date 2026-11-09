/**
 * levelBehavior → levelPreview / previewShowsWholeCharacter: what a read-only slot
 * preview shows per level (docs/PRACTICE_WRITING.md "Grid-preview guide rule").
 * Pins the 2026-10-04 Memorize exception: its outline is the editor's study phase,
 * never a preview.
 */
import { describe, expect, it } from 'vitest';
import { levelPreview, previewShowsWholeCharacter, regionClipPath } from '../components/handwriting/levelBehavior';
import { WRITING_LEVELS } from '../../server/contracts/writingLevels';

describe('levelPreview', () => {
    it('never previews Memorize (level 5)', () => {
        expect(levelPreview('memorize').guide).toBe(false);
    });

    it('previews only a region at Thirds / Quarters', () => {
        expect(levelPreview('thirds').regionClip).toBeDefined();
        expect(levelPreview('quarters').regionClip).toBeDefined();
    });

    it('shows the whole character at exactly levels 1–3', () => {
        const whole = WRITING_LEVELS.filter((spec) => previewShowsWholeCharacter(spec.mode)).map((spec) => spec.level);
        expect(whole).toEqual([1, 2, 3]);
    });
});

describe('regionClipPath', () => {
    it('cuts Thirds into three centre wedges, each wrapping one corner', () => {
        expect(regionClipPath(3, 0)).toBe('polygon(50% 50%, 0% 0%, 100% 0%, 100% 33.333%)');
        expect(regionClipPath(3, 1)).toBe('polygon(50% 50%, 100% 33.333%, 100% 100%, 33.333% 100%)');
        expect(regionClipPath(3, 2)).toBe('polygon(50% 50%, 33.333% 100%, 0% 100%, 0% 0%)');
    });

    it('cuts Quarters into the X triangles, clockwise from the top', () => {
        expect(regionClipPath(4, 0)).toBe('polygon(50% 50%, 0% 0%, 100% 0%)');
        expect(regionClipPath(4, 1)).toBe('polygon(50% 50%, 100% 0%, 100% 100%)');
        expect(regionClipPath(4, 2)).toBe('polygon(50% 50%, 100% 100%, 0% 100%)');
        expect(regionClipPath(4, 3)).toBe('polygon(50% 50%, 0% 100%, 0% 0%)');
    });

    it('wraps the index', () => {
        expect(regionClipPath(3, 3)).toBe(regionClipPath(3, 0));
        expect(regionClipPath(4, -1)).toBe(regionClipPath(4, 3));
    });
});
