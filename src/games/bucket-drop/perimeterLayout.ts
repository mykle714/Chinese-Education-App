import { BUCKET_GAP, BUCKET_SIZE, MAX_EDGE_INSET, MAX_LIVE_BUCKETS } from "./constants";

/**
 * perimeterLayout — where Bucket Drop's buckets go, from the measured field size.
 *
 * Pure geometry: no React, no DOM. The stage measures its field (ResizeObserver) and
 * calls `layoutPerimeter`; the slot count that comes back IS the number of live buckets
 * the run shows at once (docs/BUCKET_DROP_GAME.md § 2). The rules are in
 * constants.ts → "Perimeter geometry".
 *
 * Buckets sit in ONE ROW along the top edge of the field — none down the sides or along
 * the bottom (both removed on request 2026-10-06). Every slot is the SAME SQUARE
 * (`rules.size`); only the count and the spacing respond to the field.
 *
 * The spacing is EVEN — CSS `space-evenly`, extended to the top edge: with n squares, the
 * gap g = (width − n·size) / (n + 1) separates neighbours, separates the end squares from
 * the side edges, and insets the row from the top edge. A corner bucket is therefore the
 * same distance from both edges it touches. The one exception: the top inset is capped at
 * `maxEdgeInset`, which only binds on a field far wider than a tablet (see the constant).
 *
 * Slots are numbered left → right.
 *
 * Referenced by: BucketDropStage. Tested by src/__tests__/bucketDropPerimeter.test.ts.
 */

/** One bucket position, in field coordinates (px, top-left origin). */
export interface PerimeterSlot {
    index: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PerimeterLayout {
    slots: PerimeterSlot[];
    /** The open area below the row — where the opening pile is dealt. */
    stack: Rect;
}

/** The knobs, defaulted from constants.ts — overridable so tests can pin a rule. */
export interface PerimeterRules {
    /** Every bucket's side length. */
    size: number;
    /** The minimum even gap — around every bucket and against every edge. */
    minGap: number;
    /** Ceiling on the rows' top/bottom inset. */
    maxEdgeInset: number;
    maxBuckets: number;
}

export const DEFAULT_PERIMETER_RULES: PerimeterRules = {
    size: BUCKET_SIZE,
    minGap: BUCKET_GAP,
    maxEdgeInset: MAX_EDGE_INSET,
    maxBuckets: MAX_LIVE_BUCKETS,
};

export function layoutPerimeter(
    fieldWidth: number,
    fieldHeight: number,
    rules: PerimeterRules = DEFAULT_PERIMETER_RULES,
): PerimeterLayout {
    const { size, minGap, maxEdgeInset, maxBuckets } = rules;

    // How many squares fit with at least `minGap` on both sides of each:
    // n·size + (n+1)·minGap ≤ width, capped.
    const fit = Math.floor((fieldWidth - minGap) / (size + minGap));
    const perRow = Math.min(fit, maxBuckets);
    // The one even gap (see the header), used horizontally AND as the row's top inset.
    const gap = perRow > 0 ? (fieldWidth - perRow * size) / (perRow + 1) : 0;
    const inset = Math.min(gap, maxEdgeInset);

    // The open area below the row — where the pile is dealt.
    const bandTop = inset + size + gap;
    const bandHeight = fieldHeight - bandTop - inset;

    // Too small for a row with room beneath it (a field still measuring at 0×0, or a
    // collapsed layout). No slots: the stage then simply shows nothing to drop into until
    // the next measure.
    if (perRow < 1 || bandHeight <= 0) {
        return {
            slots: [],
            stack: { x: 0, y: 0, width: Math.max(0, fieldWidth), height: Math.max(0, fieldHeight) },
        };
    }

    const slots: PerimeterSlot[] = Array.from({ length: perRow }, (_, i) => ({
        index: i,
        x: gap + i * (size + gap),
        y: inset,
        width: size,
        height: size,
    }));

    return {
        slots,
        stack: { x: gap, y: bandTop, width: fieldWidth - 2 * gap, height: bandHeight },
    };
}
