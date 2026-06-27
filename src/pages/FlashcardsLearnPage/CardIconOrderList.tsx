import React, { useMemo, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import type { IconLayoutItem } from "../../types";
import { iconImageUrl } from "./cardIconLayout";

/**
 * CardIconOrderList — the body of the advanced toolbar's "render order" dropdown
 * (docs/CARD_ICON_LAYOUT.md). Lists every icon on the card in paint order, TOP of the
 * list = rendered on TOP (highest z). The user drags a row up/down to change z by
 * pressing ANYWHERE on the row (the trailing handle is just a visual movement
 * indicator); a blank dashed placeholder marks where the row will land and updates live
 * as the pointer moves, while a translucent, shrunken clone of the row follows the
 * pointer. The card restacks LIVE: every time the placeholder lands on a new slot the new
 * z-order is pushed up via `onReorder`, so the arrangement previews in real time as you
 * drag (release just ends the gesture — there is nothing extra to commit).
 *
 * The move + up/cancel listeners are attached to WINDOW for the duration of the drag
 * (not to the row or via setPointerCapture): the dragged row is swapped for a placeholder
 * the instant a drag starts, so a handler bound to the row would unmount mid-drag and its
 * pointer-up would never fire (the original "release freezes" bug). Window listeners also
 * sidestep setPointerCapture entirely — capture can throw / be lost on some touch+Safari
 * paths, which silently aborted the whole gesture ("drag does nothing"). With window
 * listeners the drag always completes no matter where the pointer travels or releases.
 *
 * Controlled: `layout` is the source of truth; each live reorder is pushed up via
 * `onReorder` with `z` reassigned so the displayed top row gets the highest z, and
 * `onReorderStart` fires once at the first change so the page records a single undo step
 * for the whole drag. The layout ARRAY order is left untouched (only z values permute) so
 * selection indices the page holds stay valid.
 */
const ROW_H = 46; // px — fixed row height; drop position is derived from pointer / ROW_H.

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

type DragState = {
    layoutIdx: number;        // index into `layout` of the row being dragged
    order: number[];          // live display order (layout indices, top→bottom)
    pointerY: number;         // current pointer clientY
    grabOffset: number;       // pointer offset within the grabbed row (for the clone)
    containerLeft: number;
    containerWidth: number;
};

const CardIconOrderList: React.FC<{
    layout: IconLayoutItem[];
    onReorder: (next: IconLayoutItem[]) => void;
    // Called ONCE per drag, the first time the order actually changes, so the page can
    // snapshot undo history before the (live) reorder mutates the draft.
    onReorderStart: () => void;
    // Select the icon for the pressed row (so the canvas highlights it + the per-icon
    // tools target it). Fired on row press, before/regardless of any reorder drag.
    onSelectIcon: (layoutIdx: number) => void;
}> = ({ layout, onReorder, onReorderStart, onSelectIcon }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [drag, setDrag] = useState<DragState | null>(null);

    // Resting display order: layout indices sorted by z DESCENDING (top = on top).
    const baseOrder = useMemo(
        () => layout.map((_, i) => i).sort((a, b) => layout[b].z - layout[a].z),
        [layout],
    );
    const order = drag ? drag.order : baseOrder;

    // Start a drag. The window move/up/cancel listeners are attached SYNCHRONOUSLY here
    // (not via a useEffect that runs after the next render) so there is no window in which
    // the browser can fire a pointermove/pointercancel before we're listening — that gap
    // was letting touch gestures get cancelled into a no-op ("drag does nothing").
    //
    // The reorder is applied LIVE: every time the placeholder lands on a new slot we push
    // the new z-order up via `onReorder`, so the card restacks in real time as the user
    // drags (not only on release). `onReorderStart` snapshots undo exactly once — on the
    // first change — so the whole drag is a single undo step. `end` therefore has nothing
    // to commit; it just clears the drag UI.
    //
    // `layout`/`onReorder` are captured at drag-start. Live `onReorder` calls change only
    // `z` (never the array order or an icon's other fields), so reassigning all z from the
    // captured `layout` on each move stays correct even as the prop updates underneath.
    const onRowDown = (e: React.PointerEvent, layoutIdx: number) => {
        e.preventDefault();
        e.stopPropagation();
        // Pressing a row selects its icon (whether or not a reorder drag follows), so the
        // canvas highlights it and the per-icon tools act on it.
        onSelectIcon(layoutIdx);
        const cont = containerRef.current;
        if (!cont) return;
        const cr = cont.getBoundingClientRect();
        const startOrder = baseOrder.slice();
        const pos = startOrder.indexOf(layoutIdx);
        const rowTop = cr.top + pos * ROW_H;
        let appliedOrder = startOrder.slice(); // last order pushed to the card
        let snapshotted = false;

        setDrag({
            layoutIdx,
            order: startOrder,
            pointerY: e.clientY,
            grabOffset: e.clientY - rowTop,
            containerLeft: cr.left,
            containerWidth: cr.width,
        });

        // Reassign z from a top→bottom order (position 0 = highest z = painted on top) and
        // push it up. Snapshots undo once, lazily, on the first real change of the drag.
        const apply = (ord: number[]) => {
            if (!snapshotted) {
                onReorderStart();
                snapshotted = true;
            }
            const n = layout.length;
            const next = layout.map((it) => ({ ...it }));
            ord.forEach((li, position) => {
                next[li].z = n - 1 - position;
            });
            onReorder(next);
            appliedOrder = ord;
        };

        const move = (ev: PointerEvent) => {
            const c = containerRef.current;
            if (!c) return;
            const rel = ev.clientY - c.getBoundingClientRect().top;
            const without = startOrder.filter((x) => x !== layoutIdx);
            const dropPos = clamp(Math.floor(rel / ROW_H), 0, without.length);
            const liveOrder = [...without.slice(0, dropPos), layoutIdx, ...without.slice(dropPos)];
            // Live-preview on the card whenever the computed order changes.
            if (liveOrder.some((idx, i) => idx !== appliedOrder[i])) apply(liveOrder);
            setDrag((d) => (d ? { ...d, order: liveOrder, pointerY: ev.clientY } : d));
        };

        const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            // Nothing to commit — each placeholder move already applied the order live.
            setDrag(null);
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    };

    const draggedItem = drag ? layout[drag.layoutIdx] : null;

    return (
        <Box
            ref={containerRef}
            className="card-icon-order-list"
            sx={{ position: "relative", py: 0.5, width: "max-content", userSelect: "none", touchAction: "none" }}
        >
            {order.length === 0 && (
                <Typography sx={{ px: 1.5, py: 1, fontSize: 13, color: "text.secondary" }}>
                    No icons on this card.
                </Typography>
            )}
            {order.map((layoutIdx) => {
                const item = layout[layoutIdx];
                const isDragged = drag?.layoutIdx === layoutIdx;
                if (isDragged) {
                    // Blank placeholder showing where the row will land.
                    return (
                        <Box
                            key={`placeholder-${layoutIdx}`}
                            className="card-icon-order-list__placeholder"
                            sx={{
                                height: ROW_H,
                                mx: 1,
                                borderRadius: "8px",
                                border: "2px dashed rgba(0,0,0,0.25)",
                                backgroundColor: "rgba(0,0,0,0.03)",
                            }}
                        />
                    );
                }
                return (
                    // The whole row is the drag trigger — press anywhere on it to reorder.
                    <Box
                        key={`row-${layoutIdx}`}
                        className="card-icon-order-list__row"
                        onPointerDown={(e) => onRowDown(e, layoutIdx)}
                        sx={{
                            height: ROW_H,
                            display: "flex",
                            alignItems: "center",
                            gap: 1.25,
                            px: 1.5,
                            cursor: "grab",
                            touchAction: "none",
                            "&:active": { cursor: "grabbing" },
                        }}
                    >
                        <Box
                            component="img"
                            src={iconImageUrl(item.iconId)}
                            alt=""
                            draggable={false}
                            sx={{
                                width: 30,
                                height: 30,
                                objectFit: "contain",
                                transform: `rotate(${item.rotation}deg) scaleX(${item.flipX ? -1 : 1})`,
                            }}
                        />
                        {/* Trailing triple-dot — purely a visual movement indicator. */}
                        <DragIndicatorIcon sx={{ fontSize: 20, color: "rgba(0,0,0,0.4)", ml: "auto" }} />
                    </Box>
                );
            })}

            {/* Floating translucent clone of the dragged row, tracking the pointer. */}
            {drag && draggedItem && (
                <Box
                    className="card-icon-order-list__floating"
                    sx={{
                        position: "fixed",
                        left: drag.containerLeft,
                        width: drag.containerWidth,
                        top: drag.pointerY - drag.grabOffset,
                        height: ROW_H,
                        display: "flex",
                        alignItems: "center",
                        gap: 1.25,
                        px: 1.5,
                        opacity: 0.7,
                        transform: "scale(0.9)",
                        transformOrigin: "left center",
                        pointerEvents: "none",
                        backgroundColor: "#fff",
                        borderRadius: "8px",
                        boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
                        zIndex: 2000,
                    }}
                >
                    <Box
                        component="img"
                        src={iconImageUrl(draggedItem.iconId)}
                        alt=""
                        draggable={false}
                        sx={{
                            width: 30,
                            height: 30,
                            objectFit: "contain",
                            transform: `rotate(${draggedItem.rotation}deg) scaleX(${draggedItem.flipX ? -1 : 1})`,
                        }}
                    />
                    <DragIndicatorIcon sx={{ fontSize: 20, color: "rgba(0,0,0,0.4)", ml: "auto" }} />
                </Box>
            )}
        </Box>
    );
};

export default CardIconOrderList;
