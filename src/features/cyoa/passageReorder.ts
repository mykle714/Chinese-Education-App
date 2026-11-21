import type { RowBox } from "./passageLinkLayout";

/**
 * passageReorder.ts — the pure maths of dragging a passage row to a new place in the story
 * editor's list (docs/CYOA_FEATURE.md § 5.3). StoryPassageList.tsx owns the pointer and
 * the DOM; this file only answers "where would it land?" and "how far does each other row
 * step aside?", from the rows' measured boxes. Unit-tested in
 * src/features/cyoa/__tests__/passageReorder.test.ts.
 *
 * Layer: feature model (src/features/cyoa). Depended on by: StoryPassageList.tsx.
 */

/**
 * The index the dragged row would take: its centre (moved by `dy`) is compared with every
 * OTHER row's centre at rest — it lands after each one it has passed.
 */
export function dropIndex(rows: RowBox[], from: number, dy: number): number {
    const dragged = rows[from];
    if (!dragged) return from;
    const centre = dragged.top + dragged.height / 2 + dy;
    let index = 0;
    rows.forEach((row, i) => {
        if (i !== from && row.top + row.height / 2 < centre) index += 1;
    });
    return index;
}

/**
 * How far (px) row `i` steps aside while row `from` hovers at index `over`: the rows it
 * has passed close the gap it left, by the dragged row's height plus the gap between rows.
 */
export function rowShift(rows: RowBox[], from: number, over: number, i: number, gap: number): number {
    const step = (rows[from]?.height ?? 0) + gap;
    if (from < over && i > from && i <= over) return -step;
    if (over < from && i >= over && i < from) return step;
    return 0;
}

/** `items` with the one at `from` moved to `to` (a new array). */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}
