// Helpers for shifting "long" pinyin syllables and their neighbors apart so
// dense rows like "zhuang zhuang yi" don't crowd visually. Used by CPCDRow.
//
// Rule (row-local): every long syllable pushes its two neighbors outward by
// one unit. If a neighbor is itself long, the push propagates one further
// step in the same direction. Propagation continues through any contiguous
// run of long syllables. A long syllable also receives the push it forwards.
//
// Shifts are row-local at the CPCDRow level — the caller must slice items
// per visual row before invoking this so that a long syllable at the end of
// one wrapped line doesn't affect the first item on the next line.

export const LONG_PINYIN_THRESHOLD = 5;

export const SHIFT_UNIT_BY_SIZE: Record<"sm" | "md" | "lg", number> = {
    sm: 2,
    md: 3,
    lg: 4,
};

const isLong = (pinyin: string | undefined, threshold: number): boolean =>
    !!pinyin && pinyin.length >= threshold;

/**
 * Returns a per-index shift in pixels (negative = left, positive = right).
 * Operates on a single row's worth of items.
 */
export function computePinyinShifts(
    items: { pinyin?: string }[],
    shiftUnitPx: number,
    longThreshold: number = LONG_PINYIN_THRESHOLD
): number[] {
    const units = new Array<number>(items.length).fill(0);

    for (let i = 0; i < items.length; i++) {
        if (!isLong(items[i].pinyin, longThreshold)) continue;

        // Push right neighbors outward; propagate through contiguous longs.
        for (let j = i + 1; j < items.length; j++) {
            units[j] += 1;
            if (!isLong(items[j].pinyin, longThreshold)) break;
        }

        // Push left neighbors outward; propagate through contiguous longs.
        for (let j = i - 1; j >= 0; j--) {
            units[j] -= 1;
            if (!isLong(items[j].pinyin, longThreshold)) break;
        }
    }

    return units.map((u) => u * shiftUnitPx);
}
