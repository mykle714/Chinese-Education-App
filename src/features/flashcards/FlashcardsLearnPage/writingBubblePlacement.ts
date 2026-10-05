/**
 * writingBubblePlacement — where one writing-flp used-in bubble goes along the top of
 * the card (docs/WRITING_PRACTICE_REWORK.md § 3b "Placement").
 *
 * Every bubble sits on ONE level, on the card's top edge; only x varies. Coordinates
 * are CARD-RELATIVE so a placement survives the card re-laying out:
 *   x    — px from the card's left edge to the bubble's left edge;
 *   w, h — the bubble's measured size.
 *
 * The rule (decided 2026-10-04, replacing the same day's stack-upward version):
 *   1. the bubble may start anywhere in [EDGE_INSET, cardWidth − EDGE_INSET − w];
 *   2. every already-placed bubble rules out the starts that would overlap it (with
 *      BUBBLE_GAP clearance);
 *   3. x is drawn UNIFORMLY from what is left, so every free position is equally likely.
 *   If nothing is left (the card is too narrow for both), the bubble takes whichever
 *   end of the range overlaps the others least. With at most 2 bubbles of at most
 *   140 px, that only happens on a card narrower than ~300 px.
 *   A bubble wider than the whole range is centred on the card.
 *
 * Pure (inject `random` for tests). Layer: client flp page util.
 * Used by: WritingUsedInBubbles.tsx. Tests: src/__tests__/writingBubblePlacement.test.ts.
 */
export interface BubblePlacement {
    x: number;
    w: number;
    h: number;
}

/** Horizontal clearance between two bubbles, px. */
export const BUBBLE_GAP = 6;
/** Keep bubbles this far in from the card's left/right edges, px. */
export const EDGE_INSET = 4;

/** Horizontal overlap (px, ≥ 0) between a bubble at `x` of width `w` and `other`, gap included. */
function overlap(x: number, w: number, other: BubblePlacement): number {
    return Math.max(0, Math.min(x + w + BUBBLE_GAP, other.x + other.w + BUBBLE_GAP) - Math.max(x, other.x));
}

export function placeBubble(
    size: { w: number; h: number },
    cardWidth: number,
    placed: readonly BubblePlacement[],
    random: () => number = Math.random,
): BubblePlacement {
    const minX = EDGE_INSET;
    const maxX = cardWidth - EDGE_INSET - size.w;
    if (maxX < minX) return { x: (cardWidth - size.w) / 2, ...size };

    // Free start positions: [minX, maxX] minus each placed bubble's blocked span
    // (p.x − w − GAP, p.x + p.w + GAP). Processed in x order so one sweep suffices.
    const blocked = placed
        .map((p) => [p.x - size.w - BUBBLE_GAP, p.x + p.w + BUBBLE_GAP] as const)
        .sort((a, b) => a[0] - b[0]);
    const free: Array<[number, number]> = [];
    let cursor = minX;
    for (const [from, to] of blocked) {
        if (from > cursor) free.push([cursor, Math.min(from, maxX)]);
        cursor = Math.max(cursor, to);
        if (cursor >= maxX) break;
    }
    if (cursor <= maxX) free.push([cursor, maxX]);
    const usable = free.filter(([from, to]) => to >= from);
    const total = usable.reduce((sum, [from, to]) => sum + (to - from), 0);

    if (usable.length > 0) {
        // Uniform over the union: walk the intervals until the drawn offset lands.
        let offset = random() * total;
        for (const [from, to] of usable) {
            if (offset <= to - from) return { x: from + offset, ...size };
            offset -= to - from;
        }
        const [, lastTo] = usable[usable.length - 1];
        return { x: lastTo, ...size };
    }

    // No free spot: take the end of the range that overlaps the others least.
    const cost = (x: number) => placed.reduce((sum, p) => sum + overlap(x, size.w, p), 0);
    return { x: cost(minX) <= cost(maxX) ? minX : maxX, ...size };
}
