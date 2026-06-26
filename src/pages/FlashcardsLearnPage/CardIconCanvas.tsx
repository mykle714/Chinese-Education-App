import React, { useRef, useState } from "react";
import { Box } from "@mui/material";
import { useGesture } from "@use-gesture/react";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import type { IconLayoutItem } from "../../types";
import {
    iconImageUrl,
    iconItemStyle,
    clampScale,
    maxZ,
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
 *   - selecting an icon brings it to the front (z = max + 1) and shows a selection
 *     outline + a corner handle that resizes/rotates via drag (desktop + touch
 *     fallback for the pinch gesture).
 *   - tapping empty canvas deselects.
 *
 * Coordinates are normalized; drag deltas (px) are converted to fractions using the
 * canvas element's measured rect.
 */
const CardIconCanvas: React.FC<{
    layout: IconLayoutItem[];
    onChange: (layout: IconLayoutItem[]) => void;
}> = ({ layout, onChange }) => {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [selected, setSelected] = useState<number | null>(null);

    const rect = () => rootRef.current?.getBoundingClientRect() ?? null;

    // Replace one item (by index) with a patch; pushes the new array upward.
    const updateItem = (i: number, patch: Partial<IconLayoutItem>) => {
        onChange(layout.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
    };

    const deleteItem = (i: number) => {
        onChange(layout.filter((_, idx) => idx !== i));
        setSelected(null);
    };

    // Select an icon and bring it to the front (unless already topmost).
    const selectAndFront = (i: number) => {
        setSelected(i);
        const top = maxZ(layout);
        if (layout[i] && layout[i].z < top) updateItem(i, { z: top + 1 });
    };

    // Per-icon drag (move) + pinch (resize/rotate). One hook, bound per icon via
    // bind(index); the handler reads the index from `args`.
    const bindIcon = useGesture(
        {
            onDragStart: ({ args: [i] }) => selectAndFront(i),
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
                    // Released with the icon's center off the card → delete it.
                    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) {
                        deleteItem(i);
                        return undefined;
                    }
                }
                updateItem(i, { x: nx, y: ny });
                return start;
            },
            onPinchStart: ({ args: [i] }) => selectAndFront(i),
            onPinch: ({ args: [i], da: [d, a], memo }) => {
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
        onDrag: ({ xy: [px, py], event }) => {
            event?.stopPropagation?.();
            if (selected === null) return;
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
            onPointerDown={() => setSelected(null)}
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
                            selectAndFront(i);
                            gestureDown?.(e);
                        }}
                        className={`card-icon-canvas__icon${isSel ? " card-icon-canvas__icon--selected" : ""}`}
                        sx={{
                            ...iconItemStyle(item),
                            // Selected icon floats above the rest regardless of its z.
                            zIndex: isSel ? 9999 : item.z,
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
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
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
