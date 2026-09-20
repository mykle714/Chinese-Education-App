/**
 * How a `HeaderCycleChip` sizes its label and itself.
 *
 * Its own module rather than a corner of PageHeader.tsx because these are shared
 * CONSTANTS AND FUNCTIONS, not components: every chip's label table has to run
 * through `cycleChipWidthCh` to be measured, so callers import them directly, and a
 * file that exports both components and helpers loses fast refresh.
 *
 * Used by: PageHeader.tsx (HeaderCycleChip), AudioModeChip.tsx,
 * src/features/immersiveworld/play/IWVolumeChip.tsx.
 * Documented in: docs/AUDIO_PLAYBACK.md, docs/IMMERSIVE_WORLD.md § 9a.
 */

/** The chip's full label size, in px. Small already — it is a header control. */
export const CYCLE_CHIP_FONT_PX = 10;

/**
 * How many characters a label may run to before the chip starts shrinking its type.
 *
 * A cycling chip is as wide as its LONGEST label in every state, so one long word
 * sizes the whole control — `whisper` sizes the volume chip and `default` sizes the
 * audio chip, even while the eye is on `say` or `mute`. Rather than abbreviate the
 * long word (which the AUDIO_PLAYBACK.md § "labels" rule forbids: a label must be a
 * word the learner sees elsewhere in the app), the chip renders just that word a
 * little smaller and keeps the width the short ones want.
 */
const CYCLE_CHIP_COMFORTABLE_LABEL_CH = 5;

/** How small a long label may get. Below this the saving stops being worth the strain. */
const CYCLE_CHIP_MIN_FONT_PX = 8;

/**
 * The size ONE label renders at: full size if it fits the comfortable width, else
 * shrunk just enough to fit it — floored at CYCLE_CHIP_MIN_FONT_PX, so a very long
 * label widens the chip rather than becoming unreadable.
 *
 * Per-label rather than per-chip on purpose. Shrinking every state to suit the
 * longest one makes a chip that is uniformly harder to read in order to solve a
 * problem only one of its words has.
 */
export function cycleChipFontPx(label: string): number {
    if (label.length <= CYCLE_CHIP_COMFORTABLE_LABEL_CH) return CYCLE_CHIP_FONT_PX;
    const fitted = (CYCLE_CHIP_FONT_PX * CYCLE_CHIP_COMFORTABLE_LABEL_CH) / label.length;
    return Math.max(CYCLE_CHIP_MIN_FONT_PX, Math.floor(fitted * 10) / 10);
}

/**
 * The `widthCh` a chip needs for a set of labels, in `ch` of the FULL-size face —
 * each label's character count scaled by however much `cycleChipFontPx` shrank it.
 *
 * Pass the whole label table. Deriving the width from the same rule that sizes the
 * type is what keeps the two from drifting: a renamed state re-measures the chip.
 */
export function cycleChipWidthCh(labels: readonly string[]): number {
    return Math.max(...labels.map((l) => (l.length * cycleChipFontPx(l)) / CYCLE_CHIP_FONT_PX));
}
