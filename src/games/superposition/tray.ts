/**
 * Superposition's tray layout (docs/SUPERPOSITION_GAME.md § Tray) — pure, no React.
 *
 * The tray holds one slot per tile, in centred rows that wrap at the tray's width. Slot
 * rects are computed here rather than left to CSS flex-wrap because the board's one pointer
 * handler hit-tests them (`SuperpositionBoard` → `handlePointerDown`): the drawn slot and the
 * pressed slot must be the same rectangle.
 */

/** A slot's box inside the tray, in px from the tray's top-left corner. */
export interface SlotRect {
    left: number;
    top: number;
    size: number;
}

export interface TrayLayout {
    slots: SlotRect[];
    /** The tray's full height, padding included (px). */
    height: number;
}

export interface TrayMetrics {
    miniPx: number;
    gapPx: number;
    paddingPx: number;
}

/**
 * Lay out `count` slots across a tray `widthPx` wide: as many per row as fit, each row
 * centred on its own (so a short last row sits in the middle, not at the left). A tray too
 * narrow for even one slot still gets one per row.
 */
export function trayLayout(count: number, widthPx: number, { miniPx, gapPx, paddingPx }: TrayMetrics): TrayLayout {
    if (count <= 0) return { slots: [], height: 0 };
    const usable = Math.max(0, widthPx - 2 * paddingPx);
    const perRow = Math.max(1, Math.floor((usable + gapPx) / (miniPx + gapPx)));
    const rowCount = Math.ceil(count / perRow);
    const slots: SlotRect[] = [];
    for (let slot = 0; slot < count; slot++) {
        const row = Math.floor(slot / perRow);
        const column = slot % perRow;
        const inRow = row === rowCount - 1 ? count - row * perRow : perRow;
        const rowWidth = inRow * miniPx + (inRow - 1) * gapPx;
        slots.push({
            left: (widthPx - rowWidth) / 2 + column * (miniPx + gapPx),
            top: paddingPx + row * (miniPx + gapPx),
            size: miniPx,
        });
    }
    return { slots, height: 2 * paddingPx + rowCount * miniPx + (rowCount - 1) * gapPx };
}

/** The slot under a point (tray px), or -1. */
export function slotAt(slots: readonly SlotRect[], x: number, y: number): number {
    return slots.findIndex((rect) => x >= rect.left && x < rect.left + rect.size && y >= rect.top && y < rect.top + rect.size);
}
