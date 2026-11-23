/**
 * levelBehavior → levelPreview / previewShowsWholeCharacter: what a read-only slot
 * preview shows per level (docs/PRACTICE_WRITING.md "Grid-preview guide rule").
 * Pins the 2026-10-04 Memorize exception: its outline is the editor's study phase,
 * never a preview.
 */
import { describe, expect, it } from 'vitest';
import { levelHasGuide, levelPreview, previewShowsWholeCharacter, regionClipPath } from '../components/handwriting/levelBehavior';
import { WRITING_LEVELS } from '../../server/contracts/writingLevels';

describe('levelPreview', () => {
    it('never previews Memorize (level 5)', () => {
        expect(levelPreview('memorize').guide).toBe(false);
    });

    it('previews only a region at Sections', () => {
        expect(levelPreview('sections').regionClip).toBeDefined();
    });

    it('previews nothing at Flash (level 6) — it opens blank', () => {
        expect(levelPreview('flash').guide).toBe(false);
    });

    it('shows the whole character at exactly levels 1–3', () => {
        const whole = WRITING_LEVELS.filter((spec) => previewShowsWholeCharacter(spec.mode)).map((spec) => spec.level);
        expect(whole).toEqual([1, 2, 3]);
    });
});

describe('levelHasGuide', () => {
    it('mounts the editor guide for every level but Blank / Timed (Flash included)', () => {
        const without = WRITING_LEVELS.filter((spec) => !levelHasGuide(spec.mode)).map((spec) => spec.mode);
        expect(without).toEqual(['test', 'timed']);
    });
});

describe('regionClipPath', () => {
    const SECTIONS = { positions: 6, span: 2 };
    // The retired Quarters level's spec — kept as a geometry case for the general construction.
    const QUARTERS = { positions: 4, span: 1 };

    it('slides a ⅓ Sections window clockwise in ⅙ steps', () => {
        // Even windows are the three old disjoint thirds, each wrapping one corner.
        expect(regionClipPath(SECTIONS, 0)).toBe('polygon(50% 50%, 0% 0%, 100% 0%, 100% 33.333%)');
        expect(regionClipPath(SECTIONS, 2)).toBe('polygon(50% 50%, 100% 33.333%, 100% 100%, 33.333% 100%)');
        expect(regionClipPath(SECTIONS, 4)).toBe('polygon(50% 50%, 33.333% 100%, 0% 100%, 0% 0%)');
        // Odd windows straddle two neighbouring thirds (a ⅙ step = ⅔ of a side).
        expect(regionClipPath(SECTIONS, 1)).toBe('polygon(50% 50%, 66.667% 0%, 100% 0%, 100% 100%)');
        expect(regionClipPath(SECTIONS, 3)).toBe('polygon(50% 50%, 100% 100%, 0% 100%, 0% 66.667%)');
        // The last window wraps past the top-left corner back onto the top edge.
        expect(regionClipPath(SECTIONS, 5)).toBe('polygon(50% 50%, 0% 66.667%, 0% 0%, 66.667% 0%)');
    });

    it('cuts {4, 1} into the X triangles, clockwise from the top', () => {
        expect(regionClipPath(QUARTERS, 0)).toBe('polygon(50% 50%, 0% 0%, 100% 0%)');
        expect(regionClipPath(QUARTERS, 1)).toBe('polygon(50% 50%, 100% 0%, 100% 100%)');
        expect(regionClipPath(QUARTERS, 2)).toBe('polygon(50% 50%, 100% 100%, 0% 100%)');
        expect(regionClipPath(QUARTERS, 3)).toBe('polygon(50% 50%, 0% 100%, 0% 0%)');
    });

    it('wraps the index', () => {
        expect(regionClipPath(SECTIONS, 6)).toBe(regionClipPath(SECTIONS, 0));
        expect(regionClipPath(QUARTERS, -1)).toBe(regionClipPath(QUARTERS, 3));
    });
});
