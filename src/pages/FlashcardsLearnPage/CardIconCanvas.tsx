import React, { useRef, useState } from "react";
import { Box } from "@mui/material";
import { useGesture } from "@use-gesture/react";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import type { IconLayoutItem } from "../../types";
import {
    iconImageUrl,
    iconItemStyle,
    iconFlipTransform,
    clampScale,
    BASE_ICON_FRAC,
} from "./cardIconLayout";

/**
 * CardIconCanvas — the interactive editor for a custom flashcard icon arrangement,
 * overlaid on the back face while edit mode is on (docs/CARD_ICON_LAYOUT.md).
 *
 * Controlled component: `layout` is the source of truth (owned by the page) and every
 * change is pushed up via `onChange`. The card box itself is the canvas; the layer
 * fills it (overflow hidden) so icons are clipped to the card boundary.
 *
 * Gestures (via @use-gesture/react):
 *   - one-finger drag  → move an icon (release with its center off-card = delete).
 *   - two-finger pinch → resize + rotate.
 *   - selecting an icon shows a selection outline + a corner handle that resizes/rotates
 *     via drag (desktop + touch fallback for the pinch gesture). Selection does NOT change
 *     paint order — render order is owned by the toolbar's reorder list. The selected icon
 *     floats to the front (high zIndex) ONLY while it is actively being dragged/pinched/
 *     resized (`interacting`), then drops back to its real `z`. Pinning it for the whole
 *     selection would mask the order list's reordering of that icon (a fixed bug).
 *   - tapping empty canvas deselects.
 *
 * Selection is CONTROLLED by the page (`selected`/`onSelect`) so the advanced toolbar's
 * per-icon controls (delete / align / mirror) can act on it. `onInteractionStart` fires
 * once at the start of each gesture so the page can snapshot the undo history.
 *
 * Coordinates are normalized; drag deltas (px) are converted to fractions using the
 * canvas element's measured rect.
 */
const CardIconCanvas: React.FC<{
    layout: IconLayoutItem[];
    onChange: (layout: IconLayoutItem[]) => void;
    selected: number | null;
    onSelect: (i: number | null) => void;
    onInteractionStart: () => void;
}> = ({ layout, onChange, selected, onSelect, onInteractionStart }) => {
    const rootRef = useRef<HTMLDivElement | null>(null);

    // True only WHILE the selected icon is being actively manipulated (drag / pinch /
    // handle-resize). The selected icon floats to the front (zIndex 9999) during that
    // manipulation so it's fully visible, then drops back to its real `z`. Merely being
    // selected must NOT pin it on top — otherwise reordering it via the toolbar's order
    // list has no visible effect (the pin always wins). See docs/CARD_ICON_LAYOUT.md.
    const [interacting, setInteracting] = useState(false);

    const rect = () => rootRef.current?.getBoundingClientRect() ?? null;

    // Replace one item (by index) with a patch; pushes the new array upward.
    const updateItem = (i: number, patch: Partial<IconLayoutItem>) => {
        onChange(layout.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
    };

    const deleteItem = (i: number) => {
        onChange(layout.filter((_, idx) => idx !== i));
        onSelect(null);
    };

    // Per-icon drag (move) + pinch (resize/rotate). One hook, bound per icon via
    // bind(index); the handler reads the index from `args`.
    const bindIcon = useGesture(
        {
            onDragStart: ({ args: [i] }) => { onInteractionStart(); onSelect(i); setInteracting(true); },
            onDrag: ({ args: [i], movement: [mx, my], last, memo }) => {
                const r = rect();
                if (!r) return memo;
                const start = (memo as { x: number; y: number } | undefined) ?? {
                    x: layout[i].x,
                    y: layout[i].y,
                };
                const nx = start.x + mx / r.width;
                const ny = start.y + my / r.height;
                if (last) {
                    setInteracting(false);
                    // Released with the icon's center off the card → delete it.
                    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) {
                        deleteItem(i);
                        return undefined;
                    }
                }
                updateItem(i, { x: nx, y: ny });
                return start;
            },
            onPinchStart: ({ args: [i] }) => { onInteractionStart(); onSelect(i); setInteracting(true); },
            onPinch: ({ args: [i], da: [d, a], last, memo }) => {
                if (last) setInteracting(false);
                const m =
                    (memo as { d0: number; a0: number; scale: number; rot: number } | undefined) ?? {
                        d0: d || 1,
                        a0: a,
                        scale: layout[i].scale,
                        rot: layout[i].rotation,
                    };
                updateItem(i, {
                    scale: clampScale(m.scale * (d / m.d0)),
                    rotation: m.rot + (a - m.a0),
                });
                return m;
            },
        },
        { drag: { filterTaps: true } }
    );

    // The selected icon's corner handle: drag to resize + rotate. Computes scale from
    // the pointer's distance to the icon center and rotation from its angle (the
    // handle sits at the icon's bottom-right = 45° baseline).
    const bindHandle = useGesture({
        onDrag: ({ xy: [px, py], event, first, last }) => {
            event?.stopPropagation?.();
            if (selected === null) return;
            // Snapshot once at the start of a resize/rotate drag for undo; float the icon
            // to the front for the duration of the resize, then drop it back to its z.
            if (first) { onInteractionStart(); setInteracting(true); }
            if (last) setInteracting(false);
            const r = rect();
            if (!r) return;
            const it = layout[selected];
            const cx = r.left + it.x * r.width;
            const cy = r.top + it.y * r.height;
            const dx = px - cx;
            const dy = py - cy;
            const dist = Math.hypot(dx, dy);
            // Unscaled icon half-width in px = the distance for scale === 1 at 45°.
            const baseHalf = (BASE_ICON_FRAC * r.width) / 2;
            const baseDiag = baseHalf * Math.SQRT2;
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            updateItem(selected, {
                scale: clampScale(dist / baseDiag),
                rotation: angle - 45,
            });
        },
    });

    return (
        <Box
            ref={rootRef}
            className="card-icon-canvas"
            // Deselect when tapping empty canvas. Stop touch/mouse from reaching the
            // card's drag/flip handlers on the ancestor slot while editing.
            onPointerDown={() => onSelect(null)}
            onTouchStart={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            sx={{
                position: "absolute",
                inset: 0,
                // Sits BEHIND the card content (which is zIndex 1) so the cpcd / English
                // / buttons always read on top — matching the saved appearance. The
                // content is made non-interactive while editing, so pointer events fall
                // through to this canvas even where they overlap the text.
                zIndex: 0,
                overflow: "hidden",
                borderRadius: "12px",
                touchAction: "none",
            }}
        >
            {layout.map((item, i) => {
                const isSel = i === selected;
                // @use-gesture's bind returns an onPointerDown that STARTS the gesture; we
                // must call it from our own handler (declaring onPointerDown after the
                // spread would otherwise override it and break dragging). We also select
                // here so a plain tap selects — filterTaps suppresses onDragStart for taps.
                const bound = bindIcon(i);
                const gestureDown = (bound as React.HTMLAttributes<HTMLDivElement>).onPointerDown;
                return (
                    <Box
                        key={`${item.iconId}-${i}`}
                        {...bound}
                        onPointerDown={(e) => {
                            e.stopPropagation(); // keep the root's deselect from firing
                            onSelect(i);
                            gestureDown?.(e);
                        }}
                        className={`card-icon-canvas__icon${isSel ? " card-icon-canvas__icon--selected" : ""}`}
                        sx={{
                            // Mirror is applied to the inner <img> (below), NOT this wrapper,
                            // so flipping the icon never moves the resize/rotate handle.
                            ...iconItemStyle(item, false),
                            // The selected icon floats above the rest ONLY while it is being
                            // actively manipulated; otherwise it keeps its real `z` so the
                            // order list's reordering is visible immediately.
                            zIndex: isSel && interacting ? 9999 : item.z,
                            touchAction: "none",
                            cursor: "grab",
                            "&:active": { cursor: "grabbing" },
                            outline: isSel ? "2px dashed rgba(0,0,0,0.45)" : "none",
                            outlineOffset: "2px",
                            borderRadius: "4px",
                        }}
                    >
                        <Box
                            component="img"
                            src={iconImageUrl(item.iconId)}
                            alt=""
                            draggable={false}
                            sx={{
                                // `display: block` removes the inline <img>'s baseline
                                // descender gap, which would otherwise inflate this icon's
                                // box ~4px taller than its `aspect-ratio: 1/1` target. Since
                                // the box is centered via translate(-50%, -50%), that extra
                                // height shifted the icon ~2px UP versus the static
                                // CardIconLayer (where the icon IS the <img>, no wrapper/gap)
                                // — the visible jump on entering/exiting the editor.
                                display: "block",
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                                // Horizontal mirror lives here (not on the wrapper) so the
                                // handle stays put when the icon is flipped.
                                transform: iconFlipTransform(item),
                                pointerEvents: "none",
                                userSelect: "none",
                            }}
                        />
                        {isSel && (() => {
                            // Same handler-composition concern as the icon: preserve the
                            // gesture's onPointerDown while stopping propagation so the
                            // handle drag doesn't also move/deselect the icon.
                            const hbound = bindHandle();
                            const handleDown = (hbound as React.HTMLAttributes<HTMLDivElement>).onPointerDown;
                            return (
                            // Resize/rotate handle at the icon's bottom-right corner.
                            <Box
                                {...hbound}
                                onPointerDown={(e) => { e.stopPropagation(); handleDown?.(e); }}
                                className="card-icon-canvas__handle"
                                sx={{
                                    position: "absolute",
                                    right: "-12px",
                                    bottom: "-12px",
                                    width: "24px",
                                    height: "24px",
                                    borderRadius: "50%",
                                    backgroundColor: "#fff",
                                    boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "rgba(0,0,0,0.6)",
                                    cursor: "nwse-resize",
                                    touchAction: "none",
                                }}
                            >
                                <OpenWithIcon sx={{ fontSize: 14 }} />
                            </Box>
                            );
                        })()}
                    </Box>
                );
            })}
        </Box>
    );
};

export default CardIconCanvas;
