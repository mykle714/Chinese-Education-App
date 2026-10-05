/**
 * Phase 1's reorder rule (docs/WRITING_PRACTICE_REWORK.md § 2): the 8 cells are ONE
 * ordered list in reading order, so dragging cell `from` to `to` MOVES it — everything
 * between shifts one place — rather than swapping the two.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
    const next = list.slice();
    if (from === to || from < 0 || from >= next.length) return next;
    const [item] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
    return next;
}
