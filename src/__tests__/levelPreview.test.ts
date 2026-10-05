/**
 * levelBehavior → levelPreview / previewShowsWholeCharacter: what a read-only slot
 * preview shows per level (docs/PRACTICE_WRITING.md "Grid-preview guide rule").
 * Pins the 2026-10-04 Memorize exception: its outline is the editor's study phase,
 * never a preview.
 */
import { describe, expect, it } from 'vitest';
import { levelPreview, previewShowsWholeCharacter } from '../components/handwriting/levelBehavior';
import { WRITING_LEVELS } from '../../server/contracts/writingLevels';

describe('levelPreview', () => {
    it('never previews Memorize (level 5)', () => {
        expect(levelPreview('memorize').guide).toBe(false);
    });

    it('previews only a region at Quarters / Eighths', () => {
        expect(levelPreview('quarters').regionClip).toBeDefined();
        expect(levelPreview('eighths').regionClip).toBeDefined();
    });

    it('shows the whole character at exactly levels 1–3', () => {
        const whole = WRITING_LEVELS.filter((spec) => previewShowsWholeCharacter(spec.mode)).map((spec) => spec.level);
        expect(whole).toEqual([1, 2, 3]);
    });
});
