import React, { useCallback, useLayoutEffect, useRef } from "react";
import { Box } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { resolveDisplayPronunciation } from "../../utils/definitionUtils";
import type { VocabEntry } from "../../types";
import { HELD_OPACITY, HELD_SCALE, SNAP_BACK_MS } from "./constants";

/**
 * StackWord — one draggable foreign word on Bucket Drop's field
 * (docs/BUCKET_DROP_GAME.md § 5).
 *
 * Every word of the run is on the field from the first frame: dealt as a pile in the
 * centre, and from then on it RESTS WHEREVER IT WAS LAST LET GO. Any word can be picked
 * up — whichever is topmost under the finger (z-order is the DOM's, bumped on pickup).
 *
 * BARE TEXT, NO TILE: characters with their pinyin, through `ForeignText` (the app's only
 * foreign-word container). A thin invisible padding is the grab target — kept thin because
 * on a pile the padding of an upper word would otherwise steal grabs meant for the one
 * beneath it.
 *
 * ── Position is owned HERE, imperatively ─────────────────────────────────────
 * The node sits at the field's (0, 0) and is placed purely by `transform`, from
 * `restRef` (its resting centre, field px) plus the live drag offset. React never
 * re-renders a word to move it: a state-driven drag would re-render the CPCDRow inside
 * ForeignText on every move, and its layout effect runs a forced-layout pinyin pass per
 * render (docs/GAMES_FEATURE.md § Grab latency). The stage only supplies the starting
 * spot (`initialX/Y`, read once) and the verdict on release.
 *
 * Release verdicts (decided by the stage, which owns the slot geometry):
 *   correct — dropped into its own bucket: hidden at once; the stage draws the fall and
 *             unmounts this word.
 *   wrong   — dropped into another word's bucket: springs back to where the drag STARTED.
 *   moved   — let go anywhere else: rests there (the stage clamps it into the field).
 */
export type DropVerdict =
    | { kind: "correct" }
    | { kind: "wrong" }
    | { kind: "moved"; x: number; y: number };

interface StackWordProps {
    entry: VocabEntry;
    /** Starting centre in field px — read on mount only (see above). */
    initialX: number;
    initialY: number;
    /** Starting stacking order in the pile — read on mount only. */
    initialZ: number;
    showPinyin: boolean;
    showPinyinColor: boolean;
    /** No pickup while true (a wrong drop's lockout, a paused or ended run). */
    disabled: boolean;
    /** Picked up. Returns the z-index the word should keep once it is put down. */
    onPickUp: (entry: VocabEntry) => number;
    /** The pointer moved while held. Client coordinates. */
    onHover: (clientX: number, clientY: number) => void;
    /**
     * Released (or cancelled — then `point` is null). `wordRect` is where the word was let
     * go, in client coordinates: the fall's start, and what "moved" is clamped by.
     */
    onRelease: (entry: VocabEntry, point: { x: number; y: number } | null, wordRect: DOMRect) => DropVerdict;
}

/** z-index while held: above every resting word and the leaving buckets. */
const HELD_Z = 1000;

/** The node's transform for a centre (field px) and a scale. */
const placed = (x: number, y: number, scale: number) =>
    `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`;

const StackWord: React.FC<StackWordProps> = ({
    entry, initialX, initialY, initialZ, showPinyin, showPinyinColor, disabled, onPickUp, onHover, onRelease,
}) => {
    const nodeRef = useRef<HTMLDivElement | null>(null);
    /** The resting centre, field px. Moves only on a "moved" release. */
    const restRef = useRef({ x: initialX, y: initialY });
    /** The z-index to rest at between drags. */
    const restZRef = useRef(initialZ);
    /** The pointer's start, while a drag is live. Null when not held. */
    const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

    // Place once on mount; every later placement is imperative.
    useLayoutEffect(() => {
        const node = nodeRef.current;
        if (!node) return;
        node.style.transform = placed(restRef.current.x, restRef.current.y, 1);
        node.style.zIndex = String(restZRef.current);
    }, []);

    /** Settle at the resting spot — animated (a spring back) or instant (a move). */
    const settle = useCallback((animated: boolean) => {
        const node = nodeRef.current;
        if (!node) return;
        node.style.transition = animated
            ? `transform ${SNAP_BACK_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1.2), opacity ${SNAP_BACK_MS}ms ease-out`
            : "transform 120ms ease-out, opacity 120ms ease-out";
        node.style.transform = placed(restRef.current.x, restRef.current.y, 1);
        node.style.opacity = "1";
        node.style.zIndex = String(restZRef.current);
    }, []);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (disabled || dragRef.current) return;
        const node = nodeRef.current;
        if (!node) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
        restZRef.current = onPickUp(entry);
        // Lift + fade ONCE at pickup and hold it for the whole drag (Bubble Match's
        // SCALE_HELD rule): being over a bucket does not change the word, the bucket
        // shows the cue instead.
        node.style.zIndex = String(HELD_Z);
        node.style.transition = "opacity 120ms ease-out";
        node.style.transform = placed(restRef.current.x, restRef.current.y, HELD_SCALE);
        node.style.opacity = String(HELD_OPACITY);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        const node = nodeRef.current;
        if (!drag || !node || e.pointerId !== drag.pointerId) return;
        node.style.transition = "none";
        node.style.transform = placed(
            restRef.current.x + e.clientX - drag.startX,
            restRef.current.y + e.clientY - drag.startY,
            HELD_SCALE,
        );
        onHover(e.clientX, e.clientY);
    };

    const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
        const drag = dragRef.current;
        const node = nodeRef.current;
        if (!drag || !node || e.pointerId !== drag.pointerId) return;
        dragRef.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        const verdict = onRelease(entry, cancelled ? null : { x: e.clientX, y: e.clientY }, node.getBoundingClientRect());
        if (verdict.kind === "correct") {
            // The stage draws the fall from this rect and unmounts this word; hide it now
            // so there is never a frame with two copies of it.
            node.style.transition = "none";
            node.style.opacity = "0";
            return;
        }
        if (verdict.kind === "moved") {
            restRef.current = { x: verdict.x, y: verdict.y };
            settle(false);
            return;
        }
        // Wrong (or cancelled): back to where this drag started.
        settle(true);
    };

    return (
        <Box
            ref={nodeRef}
            className={`bucket-drop__word${disabled ? " bucket-drop__word--locked" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => finish(e, false)}
            onPointerCancel={(e) => finish(e, true)}
            sx={{
                position: "absolute",
                left: 0,
                top: 0,
                padding: "6px 8px",
                touchAction: "none",
                cursor: disabled ? "default" : "grab",
                willChange: "transform",
                whiteSpace: "nowrap",
            }}
        >
            <ForeignText
                // `md` (36px). Launched at `lg`, dropped to `sm` (26px, −30%), then raised
                // back one step, on request. A step on the shared cpcd scale rather than a
                // transform, so the pinyin follows it.
                size="md"
                justifyContent="center"
                text={entry.entryKey}
                // Sense-resolved, matching the dd its bucket shows.
                pronunciation={resolveDisplayPronunciation(entry)}
                showPinyin={showPinyin}
                useToneColor={showPinyinColor}
                pinyinShift
            />
        </Box>
    );
};

// Memoized: the stage re-renders on every hover change mid-drag, and a re-render here
// would re-run the CPCDRow layout pass inside ForeignText (see the header). Every prop
// the stage passes is stable across those renders.
export default React.memo(StackWord);
