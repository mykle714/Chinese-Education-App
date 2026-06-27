import React, { useRef, useState } from "react";
import { Box } from "@mui/material";
import { useGesture } from "@use-gesture/react";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import LockIcon from "@mui/icons-material/Lock";
import type { IconLayoutItem } from "../../types";
import {
    iconImageUrl,
    iconItemStyle,
    iconFlipTransform,
    clampScale,
    clampIconCenter,
    snapCenterToGrid,
    snapScaleToStep,
    snapRotation,
    BASE_ICON_FRAC,
} from "./cardIconLayout";

/** Live snap toggles fed from the toolbar — each quantizes its gesture to a discrete
 *  increment (move grid / 11.25° rotation / 5%-of-width size). See docs/CARD_ICON_LAYOUT.md. */
export interface SnapConfig {
    move: boolean;
    rotate: boolean;
    resize: boolean;
}

/**
 * CardIconCanvas — the interactive editor for a custom flashcard icon arrangement,
 * overlaid on the back face while edit mode is on (docs/CARD_ICON_LAYOUT.md).
 *
 * Controlled component: `layout` is the source of truth (owned by the page) and every
 * change is pushed up via `onChange`. The card box itself is the canvas; the layer
 * fills it (overflow hidden) so icons are clipped to the card boundary.
 *
 * Gestures (via @use-gesture/react):
 *   - one-finger drag  → move an icon (release far off-card snaps it back so at least
 *     15% of the icon stays on-card; see clampIconCenter).
 *   - two-finger pinch → resize + rotate.
 *   - selecting an icon shows a selection outline + a corner handle that resizes/rotates
 *     via drag (desktop + touch fallback for the pinch gesture). Selection does NOT change
 *     paint order — render order is owned by the toolbar's reorder list. The selected icon
 *     floats to the front (high zIndex) ONLY while it is actively being dragged/pinched/
 *     resized (`interacting`), then drops back to its real `z`. Pinning it for the whole
 *     selection would mask the order list's reordering of that icon (a fixed bug).
 *   - tapping empty canvas deselects.
 *
 * Selection switching during a gesture (`resolveTarget` / `withinSelectedZone`): a tap
 * selects the pressed icon. A drag/pinch keeps acting on the currently-selected icon while
 * it starts inside that icon's PROTECTED ZONE (its box + a 15%-card-width margin), so an
 * overlapping neighbour can't steal a fine manipulation; a gesture starting OUTSIDE the zone
 * auto-switches selection to the icon it landed on and acts there. Actions only ever apply
 * to this resolved target — it is committed synchronously to `gestureTargetRef` at gesture
 * start, so the switch and the motion happen in the SAME gesture (not select-now-move-later).
 * A LOCKED selected icon has no protected zone (it can't be manipulated anyway), so any
 * gesture passes straight through to whatever icon it landed on. A locked TARGET still
 * becomes selected but is frozen against move/resize/rotate.
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
    // Live snap toggles: while a toggle is on, the matching gesture quantizes to its
    // discrete increment (move grid / 11.25° rotation / 5%-of-width size).
    snap: SnapConfig;
}> = ({ layout, onChange, selected, onSelect, onInteractionStart, snap }) => {
    const rootRef = useRef<HTMLDivElement | null>(null);

    // True only WHILE the selected icon is being actively manipulated (drag / pinch /
    // handle-resize). The selected icon floats to the front (zIndex 9999) during that
    // manipulation so it's fully visible, then drops back to its real `z`. Merely being
    // selected must NOT pin it on top — otherwise reordering it via the toolbar's order
    // list has no visible effect (the pin always wins). See docs/CARD_ICON_LAYOUT.md.
    const [interacting, setInteracting] = useState(false);

    // The icon the IN-FLIGHT gesture is acting on, resolved synchronously at gesture start
    // (see resolveTarget). Actions only ever apply to this target — which is also the icon
    // we switch selection to — so a gesture that switches selection mid-stroke still acts on
    // the new target THIS gesture, without waiting for the async `selected` state to commit.
    const gestureTargetRef = useRef<number | null>(null);

    const rect = () => rootRef.current?.getBoundingClientRect() ?? null;

    // Replace one item (by index) with a patch; pushes the new array upward.
    const updateItem = (i: number, patch: Partial<IconLayoutItem>) => {
        onChange(layout.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
    };

    // The selected (unlocked) icon owns a "protected zone" = its box expanded outward by a
    // fixed margin of 15% of the CARD WIDTH on every side. A drag/pinch STARTING inside the
    // zone keeps acting on the selected icon so an overlapping neighbour can't steal it; one
    // starting outside switches to the icon under the pointer. A LOCKED selected icon has NO
    // zone (it can't be manipulated, so any gesture passes straight through to whatever it
    // landed on). See docs/CARD_ICON_LAYOUT.md.
    const PROTECT_MARGIN_FRAC = 0.15; // fraction of card width

    // Is a client-space point within the selected icon's boundary + 15%-card-width margin?
    // Rotation is ignored (axis-aligned box approximation) — close enough for this
    // grab-vs-switch test.
    const withinSelectedZone = (px: number, py: number): boolean => {
        if (selected === null) return false;
        const r = rect();
        if (!r) return false;
        const sel = layout[selected];
        // Half-extent as a fraction of card width (icons are square in px), plus the fixed
        // 15%-card-width margin. The same px margin applies on the y-axis, so converting the
        // width-fraction extent to a height-fraction via the aspect ratio keeps it square.
        const hx = (BASE_ICON_FRAC * sel.scale) / 2 + PROTECT_MARGIN_FRAC;
        const hy = hx * (r.width / r.height); // convert width-fraction → height-fraction
        const pnx = (px - r.left) / r.width;
        const pny = (py - r.top) / r.height;
        return Math.abs(pnx - sel.x) <= hx && Math.abs(pny - sel.y) <= hy;
    };

    // Which icon a gesture that landed on icon `i` (at client point px,py) should act on:
    //  - no selection, or the selected icon is LOCKED → `i` (switch selection there; a
    //    locked icon needs no protected zone since it can't be manipulated).
    //  - selected icon UNLOCKED → keep the selected icon if the gesture started inside its
    //    protected zone, else switch to `i`.
    const resolveTarget = (i: number, px: number, py: number): number => {
        if (selected === null || layout[selected].locked) return i;
        return withinSelectedZone(px, py) ? selected : i;
    };

    // Which icon a TAP at client point (px,py) should select. The pressed icon `i` is the
    // topmost one under the pointer (it owns the DOM hit), but a locked icon should never
    // steal selection from an unlocked one sitting beneath it — locked icons can't be
    // manipulated, so reaching the editable icon under the stack matters more. So we
    // hit-test ALL icon boxes at the point and PREFER unlocked icons: pick the topmost
    // (highest `z`) unlocked icon under the tap, and only fall back to the topmost locked
    // icon when every icon there is locked. `i` is the fallback if nothing boxes the point.
    // Rotation is ignored (axis-aligned box approximation), matching withinSelectedZone.
    const pickTapTarget = (i: number, px: number, py: number): number => {
        const r = rect();
        if (!r) return i;
        const pnx = (px - r.left) / r.width;
        const pny = (py - r.top) / r.height;
        const aspect = r.width / r.height; // convert a width-fraction extent → height-fraction
        const hits = layout
            .map((it, idx) => ({ it, idx }))
            .filter(({ it }) => {
                const hx = (BASE_ICON_FRAC * it.scale) / 2; // half-extent as fraction of card width
                const hy = hx * aspect;
                return Math.abs(pnx - it.x) <= hx && Math.abs(pny - it.y) <= hy;
            });
        if (hits.length === 0) return i;
        const unlocked = hits.filter(({ it }) => !it.locked);
        const pool = unlocked.length > 0 ? unlocked : hits;
        // Topmost = highest paint order (z).
        return pool.reduce((best, cur) => (cur.it.z > best.it.z ? cur : best)).idx;
    };

    type DragMemo = { t: number; x: number; y: number };
    type PinchMemo = { t: number; d0: number; a0: number; scale: number; rot: number };

    // Per-icon drag (move) + pinch (resize/rotate). One hook, bound per icon via
    // bind(index); the handler reads the index from `args`.
    //
    // SELECTION RULE: a TAP selects the pressed icon. A drag/pinch resolves its target ONCE
    // at gesture start via `resolveTarget` — it keeps acting on the selected icon while the
    // gesture starts inside that icon's protected zone, otherwise it AUTO-SWITCHES selection
    // to the icon it landed on and acts there. The resolved target is committed synchronously
    // to `gestureTargetRef` (and pinned in `memo`), so the ACTION ALWAYS APPLIES TO THE
    // SELECTED TARGET — even on the very gesture that switched the selection, without waiting
    // for the async `selected` state to commit (the old bug: a switch only selected and the
    // motion was dropped because the target was re-derived from a not-yet-updated `selected`).
    // `filterTaps` lets us tell a tap (select) from a drag.
    const bindIcon = useGesture(
        {
            onDragStart: ({ args: [i], xy: [px, py] }) => {
                const t = resolveTarget(i, px, py);
                gestureTargetRef.current = t;    // synchronous source of truth for this gesture
                if (t !== selected) onSelect(t); // gesture switched selection to a new target
                // Deliberately NO snapshot / float-to-front here. A TAP also fires
                // onDragStart (tap-vs-drag isn't decided until release), so snapshotting here
                // pushed a no-op undo entry on EVERY tap-to-select — which then made undo /
                // redo appear to "do nothing" for a press or two (you were undoing the
                // phantom snapshots first). We snapshot on the first REAL movement in onDrag
                // instead. See docs/CARD_ICON_LAYOUT.md.
            },
            onDrag: ({ args: [i], xy: [px, py], movement: [mx, my], last, tap, memo }) => {
                // A tap (no real movement) selects an icon — locked icons included (only
                // their dragging is frozen, not their selectability). Among overlapping
                // icons under the tap, prefer the topmost UNLOCKED one (pickTapTarget), only
                // landing on a locked icon when there's no unlocked one there. No history push.
                if (tap) {
                    onSelect(pickTapTarget(i, px, py));
                    return memo;
                }
                // Target was resolved synchronously at onDragStart (gestureTargetRef); pin it
                // for the gesture via memo. The first real (non-tap) drag frame is also where
                // we snapshot for undo + float the icon to the front — NOT on gesture start,
                // which fires for taps too. (Falls back to a fresh resolve only if onDragStart
                // somehow didn't run.)
                const m =
                    (memo as DragMemo | undefined) ??
                    (() => {
                        const t = gestureTargetRef.current ?? resolveTarget(i, px, py);
                        if (!layout[t].locked) {
                            onInteractionStart();
                            setInteracting(true);
                        }
                        return { t, x: layout[t].x, y: layout[t].y };
                    })();
                if (layout[m.t].locked) return m; // frozen target: no translation
                const r = rect();
                if (!r) return m;
                let nx = m.x + mx / r.width;
                let ny = m.y + my / r.height;
                // Snap the center onto the move grid live while the toggle is on.
                if (snap.move) ({ x: nx, y: ny } = snapCenterToGrid(nx, ny));
                if (last) {
                    setInteracting(false);
                    gestureTargetRef.current = null; // clear the per-gesture target
                    // Snap an icon dragged too far off-card back onto it, keeping at least
                    // 15% of the icon on-card (replaces the old drag-off-to-delete).
                    const clamped = clampIconCenter({ x: nx, y: ny, scale: layout[m.t].scale }, r);
                    nx = clamped.x;
                    ny = clamped.y;
                }
                updateItem(m.t, { x: nx, y: ny });
                return m;
            },
            onPinchStart: ({ args: [i], origin: [ox, oy] }) => {
                const t = resolveTarget(i, ox, oy);
                gestureTargetRef.current = t;    // synchronous source of truth for this gesture
                if (t !== selected) onSelect(t); // gesture switched selection to a new target
                // Snapshot + float happen on the first real onPinch frame (see onDragStart).
            },
            onPinch: ({ args: [i], origin: [ox, oy], da: [d, a], last, memo }) => {
                // Target resolved synchronously at onPinchStart (gestureTargetRef); pin the
                // scale/rotate baselines in memo. The first frame snapshots for undo + floats.
                const m =
                    (memo as PinchMemo | undefined) ??
                    (() => {
                        const t = gestureTargetRef.current ?? resolveTarget(i, ox, oy);
                        if (!layout[t].locked) {
                            onInteractionStart();
                            setInteracting(true);
                        }
                        return { t, d0: d || 1, a0: a, scale: layout[t].scale, rot: layout[t].rotation };
                    })();
                if (layout[m.t].locked) return m; // frozen target: no resize/rotate
                if (last) { setInteracting(false); gestureTargetRef.current = null; }
                let nScale = clampScale(m.scale * (d / m.d0));
                let nRot = m.rot + (a - m.a0);
                // Quantize size / rotation live per the active snap toggles.
                if (snap.resize) nScale = snapScaleToStep(nScale);
                if (snap.rotate) nRot = snapRotation(nRot);
                updateItem(m.t, { scale: nScale, rotation: nRot });
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
            // A locked icon's corner indicator is inert — no resize/rotate via the handle.
            if (layout[selected].locked) return;
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
            let nScale = clampScale(dist / baseDiag);
            let nRot = angle - 45;
            // Quantize size / rotation live per the active snap toggles.
            if (snap.resize) nScale = snapScaleToStep(nScale);
            if (snap.rotate) nRot = snapRotation(nRot);
            updateItem(selected, { scale: nScale, rotation: nRot });
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
                // spread would otherwise override it and break dragging). We do NOT select
                // here — selection is driven only by the gesture's TAP branch (onDrag), so
                // a drag across an unselected icon never grabs or selects it.
                const bound = bindIcon(i);
                const gestureDown = (bound as React.HTMLAttributes<HTMLDivElement>).onPointerDown;
                return (
                    <Box
                        key={`${item.iconId}-${i}`}
                        {...bound}
                        onPointerDown={(e) => {
                            e.stopPropagation(); // keep the root's deselect from firing
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
                            // A locked icon can't be dragged, so it shows the default cursor
                            // instead of the grab/grabbing affordance.
                            cursor: item.locked ? "default" : "grab",
                            "&:active": { cursor: item.locked ? "default" : "grabbing" },
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
                            const locked = !!item.locked;
                            return (
                            // Corner indicator at the icon's bottom-right. Normally the
                            // resize/rotate handle (OpenWith glyph); when the icon is LOCKED
                            // it turns into a golden lock symbol and is inert (the bindHandle
                            // drag is guarded above), signalling the icon is frozen.
                            <Box
                                {...hbound}
                                onPointerDown={(e) => { e.stopPropagation(); handleDown?.(e); }}
                                className={`card-icon-canvas__handle${locked ? " card-icon-canvas__handle--locked" : ""}`}
                                sx={{
                                    position: "absolute",
                                    right: "-12px",
                                    bottom: "-12px",
                                    width: "24px",
                                    height: "24px",
                                    borderRadius: "50%",
                                    // Golden fill in the locked state; white otherwise.
                                    backgroundColor: locked ? "#E0A82E" : "#fff",
                                    boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: locked ? "#fff" : "rgba(0,0,0,0.6)",
                                    cursor: locked ? "default" : "nwse-resize",
                                    touchAction: "none",
                                }}
                            >
                                {locked ? <LockIcon sx={{ fontSize: 14 }} /> : <OpenWithIcon sx={{ fontSize: 14 }} />}
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
