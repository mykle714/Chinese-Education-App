/**
 * The first ancestor of `el` that actually scrolls vertically, or null when the page
 * itself does.
 *
 * Used by: useWindowedRows (rows windowed against their scroller), usePinScrollBottom
 * (a returning Reading Center pinned to its foot).
 */
export const scrollParentOf = (el: HTMLElement | null): HTMLElement | null => {
    let node = el?.parentElement ?? null;
    while (node) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") return node;
        node = node.parentElement;
    }
    return null;
};
