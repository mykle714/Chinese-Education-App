import React, { useRef, useState } from "react";
import { Box } from "@mui/material";
import { useGesture } from "@use-gesture/react";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import LockIcon from "@mui/icons-material/Lock";
import type { IconLayoutItem, SnapConfig, TextBlock, TextLayoutItem } from "../../../types";
import {
    iconImageUrl,
    iconItemStyle,
    iconFlipTransform,
    clampScale,
    sanitizeRotation,
    clampIconCenter,
    snapCenterToGrid,
    snapScaleToStep,
    snapRotation,
    BASE_ICON_FRAC,
} from "../../../cardIcons/cardIconLayout";
import {
    clampTextScale,
    sanitizeTextRotation,
    clampTextCenterFully,
    snapTextScale,
    textItemTransform,
    TEXT_BLOCKS,
} from "../../../cardIcons/cardTextLayout";

/** Live snap toggles fed from the toolbar — each quantizes its gesture to a discrete
 *  increment (move grid / 22.5° rotation / 5%-of-width size). Canonical type lives in
 *  ../../types; re-exported here for the editor modules. See docs/CARD_ICON_LAYOUT.md. */
export type { SnapConfig };

/** A unified canvas selection target: either an icon (by index into `layout`) or one of the
 *  two movable text blocks. The page maps this onto its mutually-exclusive `selectedIcon` /
 *  `selectedText` state. See docs/CARD_ICON_LAYOUT.md "Movable text". */
export type CanvasTarget = { kind: "icon"; index: number } | { kind: "text"; block: TextBlock };

/** The two text blocks the canvas positions while editing — both always present (the page
 *  seeds absent saved blocks to their default). */
export type TextCanvasLayout = { foreign: TextLayoutItem; english: TextLayoutItem };

/**
 * CardIconCanvas — the interactive editor for a custom flashcard icon arrangement,
 * overlaid on the back face while edit mode is on (docs/CARD_ICON_LAYOUT.md).
 *
 * Controlled component: `layout` is the source of truth (owned by the page) and every
 * change is pushed up via `onChange`. The card box itself is the canvas; the layer
 * fills it (overflow hidden) so icons are clipped to the card boundary.
 *
 * Gestures (via @use-gesture/react). All three transforms work FROM ANYWHERE on the canvas
 * and act on the SELECTED icon; they differ only in whether they can switch the selection:
 *   - one-finger drag → TRANSLATE. Targets the topmost UNLOCKED icon under the pointer when
 *     there is one (grabbing + selecting it — "a drag over an unselected unlocked icon moves
 *     that icon"), and otherwise the selected icon (so a drag over empty space, a locked icon,
 *     or the selection itself moves the selection). See `resolveDragTarget`. Release far
 *     off-card snaps the icon back so at least 15% stays on-card (see clampIconCenter).
 *   - two-finger pinch → RESIZE + ROTATE the SELECTED icon, never switching selection. Pinch
 *     deliberately ignores which icon the fingers are over and acts on the current selection
 *     (`beginPinch`/`runPinch`), so a zoom/rotate works in empty space or over a different
 *     icon WITHOUT selecting it; it falls back to the icon under the pinch only when nothing
 *     is selected. Pinches over an icon route through the per-icon `bindIcon`; pinches over
 *     empty space route through the canvas-level `bindCanvas` — both call the same shared
 *     handlers. The pinch's first finger also drives the drag recognizer, so both drag
 *     handlers short-circuit on `touches >= 2` to keep the resize/rotate from grabbing or
 *     selecting whatever the fingers landed on.
 *   - selecting an icon shows a selection outline + a corner handle that resizes/rotates
 *     via drag (desktop + touch fallback for the pinch gesture). Selection does NOT change
 *     paint order — render order is owned by the toolbar's reorder list. The selected icon
 *     floats to the front (high zIndex) ONLY while it is actively being dragged/pinched/
 *     resized (`interacting`), then drops back to its real `z`. Pinning it for the whole
 *     selection would mask the order list's reordering of that icon (a fixed bug).
 *   - tapping empty canvas deselects.
 *
 * Selection switching during a gesture: a tap selects the pressed icon (`pickTapTarget`,
 * preferring an unlocked icon under the point). A DRAG resolves its target ONCE at gesture
 * start via `resolveDragTarget` — the topmost unlocked icon under the pointer, else the
 * selection — and auto-switches selection to it. A PINCH never switches selection (it acts on
 * the selection from anywhere). The drag target is committed synchronously to
 * `gestureTargetRef` at gesture start, so the switch and the motion happen in the SAME gesture
 * (not select-now-move-later). A locked drag TARGET (only reachable as the locked selection
 * under an empty/locked-only pointer) is frozen against translation (shake feedback).
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
    // Selection is split into two mutually-exclusive page-owned pieces so the rest of this
    // file's (heavily tuned) ICON gesture logic keeps operating on a plain icon index. The
    // canvas reports selection changes through the unified `onSelectTarget`.
    selectedIcon: number | null;
    selectedText: TextBlock | null;
    onSelectTarget: (t: CanvasTarget | null) => void;
    onInteractionStart: () => void;
    // Live snap toggles: while a toggle is on, the matching gesture quantizes to its
    // discrete increment (move grid / 22.5° rotation / 5%-of-width size).
    snap: SnapConfig;
    // ── Movable text (migration 91) ───────────────────────────────────────────
    // The two back-face text blocks the canvas positions/edits, and the live content to
    // render inside each draggable box (the real cpcd / English nodes, so it's WYSIWYG). The
    // static renderer suppresses its own back-face text while the canvas is mounted.
    textLayout: TextCanvasLayout;
    onTextChange: (next: TextCanvasLayout) => void;
    foreignNode: React.ReactNode;
    englishNode: React.ReactNode;
}> = ({ layout, onChange, selectedIcon, selectedText, onSelectTarget, onInteractionStart, snap, textLayout, onTextChange, foreignNode, englishNode }) => {
    const rootRef = useRef<HTMLDivElement | null>(null);
    // Alias the icon selection back to the names the existing icon gesture code uses, so none
    // of that logic below needs to change. `onSelect(i)` reports an ICON selection (or null to
    // clear everything); text selection is reported separately via onSelectTarget.
    const selected = selectedIcon;
    const onSelect = (i: number | null) =>
        onSelectTarget(i === null ? null : { kind: "icon", index: i });

    // True only WHILE the selected icon is being actively manipulated (drag / pinch /
    // handle-resize). The selected icon floats to the front (zIndex 9999) during that
    // manipulation so it's fully visible, then drops back to its real `z`. Merely being
    // selected must NOT pin it on top — otherwise reordering it via the toolbar's order
    // list has no visible effect (the pin always wins). See docs/CARD_ICON_LAYOUT.md.
    const [interacting, setInteracting] = useState(false);

    // The icon the IN-FLIGHT drag is acting on, resolved synchronously at gesture start
    // (see resolveDragTarget). Actions only ever apply to this target — which is also the icon
    // we switch selection to — so a drag that switches selection mid-stroke still acts on
    // the new target THIS gesture, without waiting for the async `selected` state to commit.
    const gestureTargetRef = useRef<number | null>(null);

    // Latches true the moment a gesture ever sees two fingers (a pinch), and stays true until
    // that whole gesture ends (all fingers up). While latched, the drag handlers refuse to
    // translate. This closes the "resize repositions on release" bug: the drag recognizer is
    // driven by the pinch's FIRST finger, so its `touches >= 2` short-circuit holds only WHILE
    // both fingers are down — as the fingers lift, `touches` drops below 2 for the final drag
    // frame(s) and, with no drag `memo` yet, `beginDragMotion` would start a fresh drag and
    // apply the first finger's ENTIRE accumulated pinch movement (plus the last-frame clamp),
    // jumping the icon. The latch makes the post-pinch tail a no-op. Reset on each drag `first`
    // frame and cleared on the final frame, so a brand-new pure drag always starts unlatched.
    const pinchLatchRef = useRef(false);

    // Drives the "denied" shake on a LOCKED icon: when a translate / resize / rotate gesture
    // is attempted on a locked icon (and therefore frozen), we shake that icon to signal the
    // action can't be performed — mirroring the front-card shake in FlashCardSection. `i` is
    // the icon index; `nonce` increments per trigger so the keyframe NAME changes each time,
    // which restarts the CSS animation WITHOUT remounting the icon box (a remount would kill
    // the in-flight pointer gesture). Cleared on animation end. See docs/CARD_ICON_LAYOUT.md.
    const [shake, setShake] = useState<{ i: number; nonce: number } | null>(null);
    const triggerShake = (i: number) =>
        setShake(prev => ({ i, nonce: (prev?.nonce ?? 0) + 1 }));

    const rect = () => rootRef.current?.getBoundingClientRect() ?? null;

    // Replace one item (by index) with a patch; pushes the new array upward.
    const updateItem = (i: number, patch: Partial<IconLayoutItem>) => {
        onChange(layout.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
    };

    // Shared icon hit-test: every icon whose (axis-aligned, rotation-ignored) box contains
    // the client point, as { it, idx }. Rotation is ignored — a good-enough heuristic for
    // grab/select resolution. The basis for tap selection, the pinch fallback, and the drag
    // (translate) target. See docs/CARD_ICON_LAYOUT.md.
    const iconHitsAt = (px: number, py: number): { it: IconLayoutItem; idx: number }[] => {
        const r = rect();
        if (!r) return [];
        const pnx = (px - r.left) / r.width;
        const pny = (py - r.top) / r.height;
        const aspect = r.width / r.height; // convert a width-fraction extent → height-fraction
        return layout
            .map((it, idx) => ({ it, idx }))
            .filter(({ it }) => {
                const hx = (BASE_ICON_FRAC * it.scale) / 2; // half-extent as fraction of card width
                const hy = hx * aspect;
                return Math.abs(pnx - it.x) <= hx && Math.abs(pny - it.y) <= hy;
            });
    };

    // Topmost (highest paint order `z`) of a set of hits, or null when empty.
    const topmostHit = (hits: { it: IconLayoutItem; idx: number }[]): number | null =>
        hits.length === 0 ? null : hits.reduce((best, cur) => (cur.it.z > best.it.z ? cur : best)).idx;

    // Topmost icon whose box contains the point, or null. The pinch FALLBACK target when
    // nothing is selected yet (a pinch landing directly on an icon still grabs it).
    const topmostIconAt = (px: number, py: number): number | null => topmostHit(iconHitsAt(px, py));

    // Topmost UNLOCKED icon whose box contains the point, or null. The basis of the drag
    // (translate) target: a drag grabs the unlocked icon under the pointer; locked icons are
    // invisible to translation so a drag over one falls through to the selected icon.
    const topmostUnlockedIconAt = (px: number, py: number): number | null =>
        topmostHit(iconHitsAt(px, py).filter(({ it }) => !it.locked));

    // Which icon a TAP at client point (px,py) should select. The pressed icon `i` is the
    // topmost one under the pointer (it owns the DOM hit), but a locked icon should never
    // steal selection from an unlocked one sitting beneath it — locked icons can't be
    // manipulated, so reaching the editable icon under the stack matters more. So we PREFER
    // unlocked icons: pick the topmost unlocked icon under the tap, and only fall back to the
    // topmost locked icon when every icon there is locked. `i` is the fallback if nothing
    // boxes the point.
    const pickTapTarget = (i: number, px: number, py: number): number => {
        const hits = iconHitsAt(px, py);
        if (hits.length === 0) return i;
        const unlocked = hits.filter(({ it }) => !it.locked);
        return topmostHit(unlocked.length > 0 ? unlocked : hits) ?? i;
    };

    // Which icon a DRAG (translate) at client point (px,py) should act on:
    //  - the topmost UNLOCKED icon under the pointer, if any — so "a translation over an
    //    unselected unlocked icon translates that icon instead" (the gesture grabs + selects
    //    it). This includes the selected icon when it is the unlocked icon under the pointer.
    //  - otherwise the currently-selected icon — so a drag over EMPTY space, over a LOCKED
    //    icon, or over the selected icon translates the selection FROM ANYWHERE on the canvas.
    // Returns null only when there is nothing to translate (no unlocked icon under the
    // pointer and nothing selected). See docs/CARD_ICON_LAYOUT.md.
    const resolveDragTarget = (px: number, py: number): number | null => {
        const u = topmostUnlockedIconAt(px, py);
        return u !== null ? u : selected;
    };

    // mx0/my0 = the gesture movement already accumulated at the instant the drag is first
    // recognized. filterTaps + threshold hold back the first few px (tap-vs-drag disambiguation),
    // so `movement` is NON-ZERO on the first drag frame; subtracting this baseline in runDrag
    // makes the icon track from exactly where it was picked up instead of jumping forward by
    // that accumulated distance on the first frame (most visible on a slow, careful drag).
    type DragMemo = { t: number; x: number; y: number; mx0: number; my0: number };
    type PinchMemo = { t: number; d0: number; a0: number; scale: number; rot: number };

    // PINCH always targets the SELECTED icon, regardless of where on the canvas the
    // fingers land (the request: a zoom gesture should work from anywhere in the card
    // canvas and resize the currently-selected icon). When nothing is selected yet, it
    // falls back to the icon under the pinch (so a pinch directly on an icon still grabs
    // it). Shared by the per-icon binding (pinches starting on an icon) and the
    // canvas-level binding (pinches starting on empty space). NOTE: unlike drag, pinch
    // NEVER switches selection to a different icon — it deliberately ignores which icon the
    // fingers are over and acts on the current selection. See docs/CARD_ICON_LAYOUT.md.
    const beginPinch = (fallback: number | null, d: number, a: number): PinchMemo | null => {
        const t = selected !== null ? selected : fallback;
        if (t === null) return null; // nothing selected and no icon under the pinch
        const target = layout[t];
        if (!target) return null; // stale/out-of-range index — don't dereference undefined
        if (t !== selected) onSelect(t); // adopt the fallback icon as the selection
        if (!target.locked) {
            onInteractionStart(); // snapshot undo history once, on the first real frame
            setInteracting(true); // float the target to the front while pinching
        } else {
            triggerShake(t); // frozen target: signal the denied resize/rotate with a shake
        }
        return { t, d0: d || 1, a0: a, scale: target.scale, rot: target.rotation };
    };
    const runPinch = (m: PinchMemo, d: number, a: number, last: boolean) => {
        const target = layout[m.t];
        if (!target) return; // target deleted mid-gesture — nothing to update
        if (target.locked) return; // frozen target: no resize/rotate
        if (last) setInteracting(false);
        let nScale = clampScale(m.scale * (d / m.d0));
        let nRot = sanitizeRotation(m.rot + (a - m.a0));
        // Quantize size / rotation live per the active snap toggles.
        if (snap.resize) nScale = snapScaleToStep(nScale);
        if (snap.rotate) nRot = snapRotation(nRot);
        updateItem(m.t, { scale: nScale, rotation: nRot });
    };

    // First real (non-tap) drag frame for the resolved translate target `t`: do the one-time
    // undo snapshot + float-to-front (or shake a LOCKED target), and return the drag memo
    // that pins the target for the rest of the gesture. Shared by the per-icon drag
    // (`bindIcon`) and the empty-canvas drag (`bindCanvas`). Returns null when there is
    // nothing to translate (`t === null`). NOT called on a tap — the tap branch only selects.
    const beginDragMotion = (t: number | null, mx: number, my: number): DragMemo | null => {
        if (t === null) return null;
        const target = layout[t];
        if (!target) return null; // stale/out-of-range index — don't dereference undefined
        if (!target.locked) {
            onInteractionStart(); // snapshot undo history once, on the first real frame
            setInteracting(true); // float the target to the front while dragging
        } else {
            triggerShake(t); // frozen target: signal the denied move with a shake
        }
        // Baseline the accumulated movement (mx0/my0) so runDrag measures displacement FROM this
        // pickup point — no first-frame jump by the pre-recognition distance. See DragMemo.
        return { t, x: target.x, y: target.y, mx0: mx, my0: my };
    };
    const runDrag = (m: DragMemo, mx: number, my: number, last: boolean) => {
        const target = layout[m.t];
        if (!target) return; // target deleted mid-gesture — nothing to update
        if (target.locked) return; // frozen target: no translation
        const r = rect();
        if (!r) return;
        let nx = m.x + (mx - m.mx0) / r.width;
        let ny = m.y + (my - m.my0) / r.height;
        // Snap the center onto the move grid live while the toggle is on.
        if (snap.move) ({ x: nx, y: ny } = snapCenterToGrid(nx, ny));
        if (last) {
            setInteracting(false);
            gestureTargetRef.current = null; // clear the per-gesture target
            // Snap an icon dragged too far off-card back onto it, keeping at least 15% of the
            // icon on-card (replaces the old drag-off-to-delete).
            const clamped = clampIconCenter({ x: nx, y: ny, scale: target.scale }, r);
            nx = clamped.x;
            ny = clamped.y;
        }
        updateItem(m.t, { x: nx, y: ny });
    };

    // Per-icon drag (move) + pinch (resize/rotate). One hook, bound per icon via
    // bind(index); the handler reads the index from `args`.
    //
    // SELECTION RULE: a TAP selects the pressed icon. A DRAG (translate) resolves its target
    // ONCE at gesture start via `resolveDragTarget` — it grabs the topmost UNLOCKED icon under
    // the pointer (auto-switching selection to it), and only falls back to the already-selected
    // icon when the drag is over empty space, a locked icon, or the selection itself. The
    // resolved target is committed synchronously to `gestureTargetRef` (and pinned in `memo`),
    // so the ACTION ALWAYS APPLIES TO THE RESOLVED TARGET — even on the very gesture that
    // switched the selection, without waiting for the async `selected` state to commit (the old
    // bug: a switch only selected and the motion was dropped because the target was re-derived
    // from a not-yet-updated `selected`). `filterTaps` lets us tell a tap (select) from a drag.
    //
    // `touches >= 2` short-circuits both drag handlers: a two-finger pinch's first finger also
    // drives this drag recognizer, but resize/rotate must act on the SELECTED icon WITHOUT
    // switching selection to whatever the fingers landed on — so the drag side (which would
    // grab/select) stands down and leaves the gesture to `onPinch`/`beginPinch`.
    const bindIcon = useGesture(
        {
            onDragStart: ({ xy: [px, py], touches }) => {
                if (touches >= 2) return; // pinch's stray finger — let onPinch own it
                const t = resolveDragTarget(px, py);
                gestureTargetRef.current = t;            // synchronous source of truth for this gesture
                if (t !== null && t !== selected) onSelect(t); // drag grabbed a new target → select it
                // Deliberately NO snapshot / float-to-front here. A TAP also fires
                // onDragStart (tap-vs-drag isn't decided until release), so snapshotting here
                // pushed a no-op undo entry on EVERY tap-to-select — which then made undo /
                // redo appear to "do nothing" for a press or two (you were undoing the
                // phantom snapshots first). We snapshot on the first REAL movement in onDrag
                // instead. See docs/CARD_ICON_LAYOUT.md.
            },
            onDrag: ({ args: [i], xy: [px, py], movement: [mx, my], first, last, tap, touches, memo }) => {
                if (first) pinchLatchRef.current = false; // fresh gesture starts unlatched
                if (touches >= 2) { pinchLatchRef.current = true; return memo; } // pinch's stray finger — no translate/select
                // A pinch happened this gesture — ignore the single-finger tail so lifting fingers
                // doesn't start a fresh drag from the first finger's accumulated pinch movement.
                if (pinchLatchRef.current) { if (last) pinchLatchRef.current = false; return memo; }
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
                    beginDragMotion(gestureTargetRef.current ?? resolveDragTarget(px, py), mx, my);
                if (!m) return memo;
                runDrag(m, mx, my, last);
                return m;
            },
            // Pinch starting ON an icon. Targets the SELECTED icon (beginPinch), falling
            // back to the pressed icon `i` only when nothing is selected. The matching
            // empty-canvas pinch is handled by bindCanvas below — together they make a
            // zoom gesture work from ANYWHERE on the canvas.
            onPinch: ({ args: [i], da: [d, a], last, memo }) => {
                const m = (memo as PinchMemo | undefined) ?? beginPinch(i, d, a);
                if (!m) return memo;
                runPinch(m, d, a, last);
                return m;
            },
        },
        { drag: { filterTaps: true, threshold: 1, tapsThreshold: 1 } }
    );

    // The selected icon's corner handle: drag to resize + rotate. Computes scale from
    // the pointer's distance to the icon center and rotation from its angle (the
    // handle sits at the icon's bottom-right = 45° baseline).
    const bindHandle = useGesture({
        onDrag: ({ xy: [px, py], event, first, last, touches }) => {
            event?.stopPropagation?.();
            // A two-finger pinch's first finger can land on/near the handle (it sits at the
            // selected icon's corner). Since the handle stops propagation, that would otherwise
            // HIJACK the pinch: bindHandle would read the lone finger as a drag and write the
            // ABSOLUTE-angle rotation every frame, so the icon could only rotate (never
            // resize/translate) until all fingers lift — "locked into a rotate command". Stand
            // down on multi-touch so the gesture falls through to the pinch recognizer, matching
            // the `touches >= 2` short-circuit on the icon/canvas drag handlers.
            if (touches >= 2) return;
            if (selected === null) return;
            const it = layout[selected];
            if (!it) return; // stale/out-of-range selection — don't dereference undefined
            // A locked icon's corner indicator is inert — no resize/rotate via the handle.
            // Shake the icon on the first frame to signal the action is denied.
            if (it.locked) {
                if (first) triggerShake(selected);
                return;
            }
            // Snapshot once at the start of a resize/rotate drag for undo; float the icon
            // to the front for the duration of the resize, then drop it back to its z.
            if (first) { onInteractionStart(); setInteracting(true); }
            if (last) setInteracting(false);
            const r = rect();
            if (!r) return;
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
            let nRot = sanitizeRotation(angle - 45);
            // Quantize size / rotation live per the active snap toggles.
            if (snap.resize) nScale = snapScaleToStep(nScale);
            if (snap.rotate) nRot = snapRotation(nRot);
            updateItem(selected, { scale: nScale, rotation: nRot });
        },
        // A pinch can START on the handle (it sits at the selected icon's corner, and the
        // handle stops propagation so neither the icon nor the canvas pinch can see it). Route
        // it through the SAME shared resize/rotate handlers as everywhere else so the handle is
        // not a pinch dead zone — it acts on the selected icon (beginPinch falls back to it).
        onPinch: ({ da: [d, a], last, memo }) => {
            const m = (memo as PinchMemo | undefined) ?? beginPinch(selected, d, a);
            if (!m) return memo;
            runPinch(m, d, a, last);
            return m;
        },
    });

    // Canvas-level gestures, bound to the ROOT (not a specific icon) so they fire for
    // presses on EMPTY space:
    //   - DRAG anywhere → translate the SELECTED icon (beginDragMotion/runDrag). Empty-space
    //     drags can't land on an icon, so resolveDragTarget falls back to the selection — this
    //     is what lets a translate gesture work from anywhere in the card canvas and move the
    //     selected icon. Drags that start ON an icon are handled by bindIcon above (their
    //     onPointerDown stopPropagation keeps them from also reaching this binding).
    //   - PINCH anywhere → resize/rotate the SELECTED icon (beginPinch/runPinch). Same idea:
    //     a zoom/rotate gesture works from anywhere and targets the selected icon, even when
    //     the fingers land on empty space or a non-selected icon.
    //   - a TAP on empty canvas deselects (moved here off the raw onPointerDown so the
    //     first finger of an empty-space pinch no longer wipes the selection before the
    //     pinch can read it — `filterTaps` means a pinch is never reported as a tap).
    // `touches >= 2` short-circuits the drag handler so an empty-space pinch's first finger
    // doesn't also translate — onPinch owns that gesture.
    const bindCanvas = useGesture(
        {
            onDrag: ({ xy: [px, py], movement: [mx, my], first, last, tap, touches, memo }) => {
                if (first) pinchLatchRef.current = false; // fresh gesture starts unlatched
                if (touches >= 2) { pinchLatchRef.current = true; return memo; } // pinch's stray finger — no translate
                // A pinch happened this gesture — ignore the single-finger tail so lifting fingers
                // doesn't start a fresh drag from the first finger's accumulated pinch movement.
                if (pinchLatchRef.current) { if (last) pinchLatchRef.current = false; return memo; }
                if (tap) {
                    onSelect(null);
                    return memo;
                }
                // Empty-space drag → translate the selected icon (resolveDragTarget finds no
                // unlocked icon under the pointer, so it returns the selection). No-op when
                // nothing is selected.
                const m = (memo as DragMemo | undefined) ?? beginDragMotion(resolveDragTarget(px, py), mx, my);
                if (!m) return memo;
                runDrag(m, mx, my, last);
                return m;
            },
            onPinch: ({ origin: [ox, oy], da: [d, a], last, memo }) => {
                const m = (memo as PinchMemo | undefined) ?? beginPinch(topmostIconAt(ox, oy), d, a);
                if (!m) return memo;
                runPinch(m, d, a, last);
                return m;
            },
        },
        { drag: { filterTaps: true, threshold: 1, tapsThreshold: 1 } }
    );

    // ── Movable text gestures (migration 91) ──────────────────────────────────
    // The two text blocks are a separate, simpler gesture system than icons: there are only
    // two fixed blocks (no add/delete/duplicate, no selection-switching heuristics), and they
    // must stay FULLY on-card (a stricter clamp than icons). They reuse the same shared idea —
    // tap selects, drag translates, pinch/handle resize+rotate, lock freezes + shakes — but
    // operate on the text draft, not the icon array. See docs/CARD_ICON_LAYOUT.md.

    // Live DOM refs to each text wrapper so the on-release clamp can measure the rendered
    // (scaled + rotated) bounding box and keep the WHOLE block on-card.
    const textRefs = useRef<Record<TextBlock, HTMLDivElement | null>>({ foreign: null, english: null });
    // Denied-gesture shake for a LOCKED text block (mirrors the icon shake), keyed by block.
    const [textShake, setTextShake] = useState<{ block: TextBlock; nonce: number } | null>(null);
    const triggerTextShake = (block: TextBlock) =>
        setTextShake((prev) => ({ block, nonce: (prev?.nonce ?? 0) + 1 }));
    // True while a text block is being actively dragged/pinched/resized (floats it above the
    // other block + icons during the manipulation).
    const [textInteracting, setTextInteracting] = useState(false);

    const updateText = (block: TextBlock, patch: Partial<TextLayoutItem>) =>
        onTextChange({ ...textLayout, [block]: { ...textLayout[block], ...patch } });

    // Clamp a text block's center on release so the whole rendered box stays on-card. Measures
    // the wrapper's AABB (already includes scale + rotation) and converts px → fractions.
    const clampTextRelease = (block: TextBlock, x: number, y: number): { x: number; y: number } => {
        const r = rect();
        const el = textRefs.current[block];
        if (!r || !el) return { x, y };
        const box = el.getBoundingClientRect();
        const halfWFrac = box.width / 2 / r.width;
        const halfHFrac = box.height / 2 / r.height;
        return clampTextCenterFully(x, y, halfWFrac, halfHFrac);
    };

    // mx0/my0 baseline the pre-recognition movement — same first-frame-jump fix as the icon
    // DragMemo (filterTaps + threshold make `movement` non-zero on the first drag frame).
    type TextDragMemo = { block: TextBlock; x: number; y: number; mx0: number; my0: number };
    type TextPinchMemo = { block: TextBlock; d0: number; a0: number; scale: number; rot: number };

    const beginTextDrag = (block: TextBlock, mx: number, my: number): TextDragMemo | null => {
        const item = textLayout[block];
        if (!item) return null;
        if (block !== selectedText) onSelectTarget({ kind: "text", block }); // grabbing selects it
        if (!item.locked) { onInteractionStart(); setTextInteracting(true); }
        else triggerTextShake(block);
        return { block, x: item.x, y: item.y, mx0: mx, my0: my };
    };
    const runTextDrag = (m: TextDragMemo, mx: number, my: number, last: boolean) => {
        const item = textLayout[m.block];
        if (!item || item.locked) return;
        const r = rect();
        if (!r) return;
        let nx = m.x + (mx - m.mx0) / r.width;
        let ny = m.y + (my - m.my0) / r.height;
        if (snap.move) ({ x: nx, y: ny } = snapCenterToGrid(nx, ny));
        if (last) {
            setTextInteracting(false);
            ({ x: nx, y: ny } = clampTextRelease(m.block, nx, ny));
        }
        updateText(m.block, { x: nx, y: ny });
    };
    const beginTextPinch = (block: TextBlock, d: number, a: number): TextPinchMemo | null => {
        const item = textLayout[block];
        if (!item) return null;
        if (block !== selectedText) onSelectTarget({ kind: "text", block }); // pinching selects it
        if (!item.locked) { onInteractionStart(); setTextInteracting(true); }
        else { triggerTextShake(block); }
        return { block, d0: d || 1, a0: a, scale: item.scale, rot: item.rotation };
    };
    const runTextPinch = (m: TextPinchMemo, d: number, a: number, last: boolean) => {
        const item = textLayout[m.block];
        if (!item || item.locked) return;
        if (last) setTextInteracting(false);
        let nScale = clampTextScale(m.scale * (d / m.d0));
        let nRot = sanitizeTextRotation(m.rot + (a - m.a0));
        if (snap.resize) nScale = snapTextScale(nScale);
        if (snap.rotate) nRot = snapRotation(nRot);
        updateText(m.block, { scale: nScale, rotation: nRot });
    };

    // Per-block drag (move) + pinch (resize/rotate). Bound per block via bindText(block).
    const bindText = useGesture(
        {
            onDrag: ({ args: [block], movement: [mx, my], first, last, tap, touches, memo }) => {
                if (first) pinchLatchRef.current = false; // fresh gesture starts unlatched
                if (touches >= 2) { pinchLatchRef.current = true; return memo; } // pinch's stray finger — let onPinch own it
                // A pinch happened this gesture — ignore the single-finger tail so lifting fingers
                // doesn't start a fresh drag from the first finger's accumulated pinch movement.
                if (pinchLatchRef.current) { if (last) pinchLatchRef.current = false; return memo; }
                if (tap) { onSelectTarget({ kind: "text", block }); return memo; }
                const m = (memo as TextDragMemo | undefined) ?? beginTextDrag(block, mx, my);
                if (!m) return memo;
                runTextDrag(m, mx, my, last);
                return m;
            },
            onPinch: ({ args: [block], da: [d, a], last, memo }) => {
                const m = (memo as TextPinchMemo | undefined) ?? beginTextPinch(block, d, a);
                if (!m) return memo;
                runTextPinch(m, d, a, last);
                return m;
            },
        },
        { drag: { filterTaps: true, threshold: 1, tapsThreshold: 1 } },
    );

    // The selected text block's corner handle (desktop): RELATIVE resize/rotate (text boxes
    // aren't square, so absolute distance→scale like the icon handle doesn't map cleanly). The
    // memo captures the start pointer distance/angle to the block center + the start scale/rot.
    type TextHandleMemo = { block: TextBlock; cx: number; cy: number; dist0: number; ang0: number; scale: number; rot: number };
    const bindTextHandle = useGesture({
        onDrag: ({ xy: [px, py], event, first, last, touches, memo }) => {
            event?.stopPropagation?.();
            if (touches >= 2) return memo; // multi-touch → let the pinch recognizer own it
            if (selectedText === null) return memo;
            const block = selectedText;
            const item = textLayout[block];
            if (!item) return memo;
            if (item.locked) { if (first) triggerTextShake(block); return memo; }
            const r = rect();
            if (!r) return memo;
            const cx = r.left + item.x * r.width;
            const cy = r.top + item.y * r.height;
            let m = memo as TextHandleMemo | undefined;
            if (!m) {
                onInteractionStart();
                setTextInteracting(true);
                m = { block, cx, cy, dist0: Math.hypot(px - cx, py - cy) || 1, ang0: Math.atan2(py - cy, px - cx), scale: item.scale, rot: item.rotation };
            }
            if (last) setTextInteracting(false);
            const dist = Math.hypot(px - m.cx, py - m.cy);
            const ang = Math.atan2(py - m.cy, px - m.cx);
            let nScale = clampTextScale(m.scale * (dist / m.dist0));
            let nRot = sanitizeTextRotation(m.rot + ((ang - m.ang0) * 180) / Math.PI);
            if (snap.resize) nScale = snapTextScale(nScale);
            if (snap.rotate) nRot = snapRotation(nRot);
            updateText(block, { scale: nScale, rotation: nRot });
            return m;
        },
        onPinch: ({ da: [d, a], last, memo }) => {
            if (selectedText === null) return memo;
            const m = (memo as TextPinchMemo | undefined) ?? beginTextPinch(selectedText, d, a);
            if (!m) return memo;
            runTextPinch(m, d, a, last);
            return m;
        },
    });

    // The selected icon (guarded against a stale index, e.g. just after a delete) — drives
    // the selection-overlay layer below. Its outline + corner handle are drawn there, NOT on
    // the icon box, so they paint ON TOP OF ALL ICONS and can OVERFLOW THE CARD EDGE.
    const selItem = selected !== null && selected < layout.length ? layout[selected] : null;

    return (
        <Box
            ref={rootRef}
            className="card-icon-canvas"
            // Canvas-level gestures: pinch-to-zoom the selected icon from anywhere, and a
            // tap on empty canvas deselects (both in bindCanvas). NOTE: deselect lives on
            // the gesture's TAP (not raw onPointerDown) so the first finger of an
            // empty-space pinch doesn't clear the selection the pinch needs to target.
            {...bindCanvas()}
            // Stop touch/mouse from reaching the card's drag/flip handlers on the ancestor
            // slot while editing.
            onTouchStart={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            sx={{
                position: "absolute",
                inset: 0,
                // Sits BEHIND the card content (which is zIndex 1) so the cpcd / English
                // / buttons always read on top — matching the saved appearance. The
                // content is made non-interactive while editing, so pointer events fall
                // through to this canvas even where they overlap the text. The explicit
                // zIndex also establishes a stacking context that CONFINES the per-icon z
                // values (and the float-to-front 9999) to the clip layer below, so the
                // selection overlay always paints above every icon.
                zIndex: 0,
                // Root is NOT clipped — the selection overlay is allowed to overflow the
                // card edge. Icons are clipped by the inner clip layer instead (so a
                // partially-off-card icon is still cut at the card boundary). The card face
                // around us is overflow:visible too (see CardFaceSide), so the indicators
                // can poke into the padding around the card.
                touchAction: "none",
            }}
        >
            {/* Clip layer — holds every icon and is the ONLY thing clipped to the card
                boundary (icons partially off the card are cut off here). zIndex 0 +
                position establishes a stacking context that keeps each icon's z (incl. the
                transient float-to-front 9999) BELOW the selection overlay. */}
            <Box
                className="card-icon-canvas__clip"
                sx={{
                    position: "absolute",
                    inset: 0,
                    overflow: "hidden",
                    borderRadius: "12px",
                    zIndex: 0,
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
                    // "Denied" shake on a locked icon. The animation must COMPOSE with the icon's
                    // own positioning transform (translate(-50%,-50%) rotate(...) from
                    // iconItemStyle), so each keyframe prepends a SCREEN-SPACE horizontal offset
                    // to that base — at rest (0%/100%) it equals the static transform, so the icon
                    // settles back exactly where it was. The keyframe NAME carries the nonce so a
                    // repeat trigger is a brand-new animation that restarts cleanly (no remount).
                    const isShaking = shake?.i === i;
                    const baseTransform = `translate(-50%, -50%) rotate(${item.rotation}deg)`;
                    const shakeName = isShaking ? `cardIconShake-${shake!.nonce}` : "";
                    return (
                        <Box
                            key={`${item.iconId}-${i}`}
                            {...bound}
                            onPointerDown={(e) => {
                                e.stopPropagation(); // keep this press out of the canvas-level
                                // bindCanvas gesture (its tap-deselect + empty-space pinch) — an
                                // icon press is handled here by bindIcon instead.
                                gestureDown?.(e);
                            }}
                            onAnimationEnd={isShaking ? () => setShake(null) : undefined}
                            className={`card-icon-canvas__icon${isSel ? " card-icon-canvas__icon--selected" : ""}`}
                            sx={{
                                // Mirror is applied to the inner <img> (below), NOT this wrapper,
                                // so flipping the icon never moves the resize/rotate handle.
                                ...iconItemStyle(item, false),
                                ...(isShaking ? {
                                    animation: `${shakeName} 0.42s ease-in-out`,
                                    [`@keyframes ${shakeName}`]: {
                                        "0%, 100%": { transform: baseTransform },
                                        "20%": { transform: `translate(-6px, 0) ${baseTransform}` },
                                        "40%": { transform: `translate(6px, 0) ${baseTransform}` },
                                        "60%": { transform: `translate(-4px, 0) ${baseTransform}` },
                                        "80%": { transform: `translate(4px, 0) ${baseTransform}` },
                                    },
                                } : {}),
                                // The selected icon floats above the rest ONLY while it is being
                                // actively manipulated; otherwise it keeps its real `z` so the
                                // order list's reordering is visible immediately. (The selection
                                // outline + handle live in the overlay layer, which is always on
                                // top regardless of this.)
                                zIndex: isSel && interacting ? 9999 : item.z,
                                touchAction: "none",
                                // A locked icon can't be dragged, so it shows the default cursor
                                // instead of the grab/grabbing affordance.
                                cursor: item.locked ? "default" : "grab",
                                "&:active": { cursor: item.locked ? "default" : "grabbing" },
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
                        </Box>
                    );
                })}
            </Box>

            {/* Text layer — holds the two movable text blocks. Sits ABOVE the icon clip layer
                (text always paints over icons) but below the icon selection overlay. Clipped to
                the card so text dragged toward the edge is cut at the boundary (it is also
                clamped fully on-card on release). Its explicit zIndex establishes a stacking
                context that confines each block's float-to-front below the overlay. */}
            <Box
                className="card-icon-canvas__text-layer"
                sx={{
                    position: "absolute",
                    inset: 0,
                    overflow: "hidden",
                    borderRadius: "12px",
                    zIndex: 1,
                    // The layer spans the whole canvas (above the icon clip layer), but only the
                    // two text blocks should be interactive — make the layer itself transparent
                    // to hits so empty-area presses fall through to the icons / canvas below.
                    pointerEvents: "none",
                }}
            >
                {TEXT_BLOCKS.map((block) => {
                    const item = textLayout[block];
                    const isSel = selectedText === block;
                    const locked = !!item.locked;
                    const node = block === "foreign" ? foreignNode : englishNode;
                    const bound = bindText(block);
                    const gestureDown = (bound as React.HTMLAttributes<HTMLDivElement>).onPointerDown;
                    // Denied-gesture shake (locked block) — same keyframe-name-with-nonce restart
                    // trick as icons, composed onto the block's base positioning transform.
                    const isShaking = textShake?.block === block;
                    const baseTransform = textItemTransform(item);
                    const shakeName = isShaking ? `cardTextShake-${textShake!.nonce}` : "";
                    // english paints above foreign by default; the actively-manipulated block
                    // floats above everything in this layer.
                    const baseZ = block === "english" ? 2 : 1;
                    return (
                        <Box
                            key={block}
                            ref={(el: HTMLDivElement | null) => { textRefs.current[block] = el; }}
                            {...bound}
                            onPointerDown={(e) => { e.stopPropagation(); gestureDown?.(e); }}
                            onAnimationEnd={isShaking ? () => setTextShake(null) : undefined}
                            className={`card-icon-canvas__text card-icon-canvas__text--${block}${isSel ? " card-icon-canvas__text--selected" : ""}`}
                            sx={{
                                position: "absolute",
                                left: `${item.x * 100}%`,
                                top: `${item.y * 100}%`,
                                // Hug the content: the inner blocks set width:100%, so `max-content`
                                // makes the wrapper size to the text (capped so long English wraps
                                // instead of overflowing). Centered + scaled + rotated about its
                                // center, matching the static renderer's textItemTransform.
                                width: "max-content",
                                maxWidth: "92%",
                                transform: baseTransform,
                                transformOrigin: "center center",
                                ...(isShaking ? {
                                    animation: `${shakeName} 0.42s ease-in-out`,
                                    [`@keyframes ${shakeName}`]: {
                                        "0%, 100%": { transform: baseTransform },
                                        "20%": { transform: `translate(-6px, 0) ${baseTransform}` },
                                        "40%": { transform: `translate(6px, 0) ${baseTransform}` },
                                        "60%": { transform: `translate(-4px, 0) ${baseTransform}` },
                                        "80%": { transform: `translate(4px, 0) ${baseTransform}` },
                                    },
                                } : {}),
                                zIndex: isSel && textInteracting ? 9999 : baseZ,
                                // Re-enable hits on the block itself (the layer is pointer-none).
                                pointerEvents: "auto",
                                touchAction: "none",
                                cursor: locked ? "default" : "grab",
                                "&:active": { cursor: locked ? "default" : "grabbing" },
                                // Dashed selection outline drawn directly on the block (text stays
                                // fully on-card, so — unlike icons — it never needs to overflow).
                                ...(isSel ? { outline: "2px dashed rgba(0,0,0,0.45)", outlineOffset: "4px", borderRadius: "4px" } : {}),
                            }}
                        >
                            {/* The real text content, made inert so taps reach the wrapper gesture.
                                The `& *` !important defeats cpcd pinyin's inline pointer-events:auto
                                (same defense as CardContent while editing). */}
                            <Box sx={{ pointerEvents: "none", userSelect: "none", "& *": { pointerEvents: "none !important" } }}>
                                {node}
                            </Box>
                            {/* Corner resize/rotate handle for the SELECTED block (desktop). Placed
                                just INSIDE the bottom-right corner so the clip layer never cuts it
                                (text can sit flush to the card edge). Locked → golden, inert. */}
                            {isSel && (() => {
                                const hbound = bindTextHandle();
                                const handleDown = (hbound as React.HTMLAttributes<HTMLDivElement>).onPointerDown;
                                return (
                                    <Box
                                        {...hbound}
                                        onPointerDown={(e) => { e.stopPropagation(); handleDown?.(e); }}
                                        className={`card-icon-canvas__text-handle${locked ? " card-icon-canvas__text-handle--locked" : ""}`}
                                        sx={{
                                            position: "absolute",
                                            right: "-2px",
                                            bottom: "-2px",
                                            width: "22px",
                                            height: "22px",
                                            borderRadius: "50%",
                                            backgroundColor: locked ? "#E0A82E" : "#fff",
                                            boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            color: locked ? "#fff" : "rgba(0,0,0,0.6)",
                                            cursor: locked ? "default" : "nwse-resize",
                                            touchAction: "none",
                                            pointerEvents: "auto",
                                        }}
                                    >
                                        {locked ? <LockIcon sx={{ fontSize: 13 }} /> : <OpenWithIcon sx={{ fontSize: 13 }} />}
                                    </Box>
                                );
                            })()}
                        </Box>
                    );
                })}
            </Box>

            {/* Selection overlay — NOT clipped (overflow visible) and at a higher zIndex than
                the clip + text layers, so the selected icon's outline + corner handle paint ON
                TOP OF ALL ICONS and may overflow the card edge into the surrounding padding. The
                layer is pointer-transparent (so a drag through it still reaches the icon
                below); only the handle re-enables pointer events. The overlay box mirrors the
                selected icon's exact geometry (iconItemStyle, no flip) so the outline tracks
                the icon, and shakes in lockstep when the selected icon is a denied locked
                target. */}
            <Box
                className="card-icon-canvas__overlay"
                sx={{
                    position: "absolute",
                    inset: 0,
                    overflow: "visible",
                    pointerEvents: "none",
                    // Above the clip (0) AND the text layer (1) so an icon's selection outline
                    // sits on top of everything.
                    zIndex: 2,
                }}
            >
                {selItem && (() => {
                    // Same handler-composition concern as the icon: preserve the gesture's
                    // onPointerDown while stopping propagation so the handle drag doesn't also
                    // move/deselect the icon.
                    const hbound = bindHandle();
                    const handleDown = (hbound as React.HTMLAttributes<HTMLDivElement>).onPointerDown;
                    const locked = !!selItem.locked;
                    // Shake the outline together with its icon when a denied gesture targets
                    // the SELECTED (locked) icon, so the indicator doesn't drift away from the
                    // shaking icon. Same keyframe-name-with-nonce restart trick as the icon box.
                    const isShaking = shake?.i === selected;
                    const baseTransform = `translate(-50%, -50%) rotate(${selItem.rotation}deg)`;
                    const shakeName = isShaking ? `cardIconShake-${shake!.nonce}` : "";
                    return (
                        <Box
                            className="card-icon-canvas__selection"
                            sx={{
                                // Match the selected icon's box exactly (no flip — the outline
                                // shouldn't mirror), so the dashed outline frames the icon.
                                ...iconItemStyle(selItem, false),
                                ...(isShaking ? {
                                    animation: `${shakeName} 0.42s ease-in-out`,
                                    [`@keyframes ${shakeName}`]: {
                                        "0%, 100%": { transform: baseTransform },
                                        "20%": { transform: `translate(-6px, 0) ${baseTransform}` },
                                        "40%": { transform: `translate(6px, 0) ${baseTransform}` },
                                        "60%": { transform: `translate(-4px, 0) ${baseTransform}` },
                                        "80%": { transform: `translate(4px, 0) ${baseTransform}` },
                                    },
                                } : {}),
                                // The outline must not intercept the drag of the icon beneath it.
                                pointerEvents: "none",
                                outline: "2px dashed rgba(0,0,0,0.45)",
                                outlineOffset: "2px",
                                borderRadius: "4px",
                            }}
                        >
                            {/* Corner indicator at the icon's bottom-right. Normally the
                                resize/rotate handle (OpenWith glyph); when the icon is LOCKED
                                it turns into a golden lock symbol and is inert (the bindHandle
                                drag is guarded above), signalling the icon is frozen. */}
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
                                    // Re-enable pointer events on the handle only (the overlay
                                    // layer + outline box are pointer-transparent).
                                    pointerEvents: "auto",
                                }}
                            >
                                {locked ? <LockIcon sx={{ fontSize: 14 }} /> : <OpenWithIcon sx={{ fontSize: 14 }} />}
                            </Box>
                        </Box>
                    );
                })()}
            </Box>
        </Box>
    );
};

export default CardIconCanvas;
