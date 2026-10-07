import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { resolveDisplayDefinition, resolveDisplayPronunciation } from "../../utils/definitionUtils";
import type { VocabEntry } from "../../types";
import DropBucket from "./DropBucket";
import StackWord, { type DropVerdict } from "./StackWord";
import { layoutPerimeter, type PerimeterSlot } from "./perimeterLayout";
import { dealQueue, resizeQueue, resolveDrop, type BucketQueueState } from "./bucketQueue";
import {
    BUCKET_EXIT_MS,
    DROP_FALL_END_SCALE,
    DROP_FALL_MS,
    HELD_OPACITY,
    HELD_SCALE,
    PILE_JITTER_X,
    PILE_JITTER_Y,
    SNAP_BACK_MS,
    WRONG_SHAKE_MS,
} from "./constants";

/**
 * BucketDropStage — the play field: the perimeter of buckets, every word of the run, and
 * every drop (docs/BUCKET_DROP_GAME.md § 2–5).
 *
 * Owns the RUN MODEL (bucketQueue) and the field GEOMETRY (perimeterLayout); the page
 * owns everything that is not on the board — clock, marks, challenge scoring, popups.
 * The page remounts this per run (`key={runId}`), so a new run is a fresh deal.
 *
 * ── The deal ─────────────────────────────────────────────────────────────────
 * Once the field is first measured, every word is dealt as a PILE in the open centre —
 * a small random jitter around the centre point so it reads as a heap — with a word
 * whose bucket is showing on top. From then on each word owns its own resting spot
 * (StackWord): it stays wherever it was last let go, clamped inside the field.
 *
 * ── Hit-testing is against slot GEOMETRY, never DOM rects ─────────────────────
 * A bucket's position is a pure function of the field size, so a drop is resolved by
 * converting the pointer into field coordinates and testing the slot squares.
 *
 * ── Correct drop ─────────────────────────────────────────────────────────────
 * Resolved IMMEDIATELY: the queue retires the word and refills the slot. Two short-lived
 * ghosts carry the animation so the player never waits on it — the word falling into its
 * hole (`FallingWord`) and the emptied bucket fading out (`DropBucket leaving`) while the
 * slot's new bucket fades in beneath it after BUCKET_EXIT_MS.
 *
 * ── Wrong drop ───────────────────────────────────────────────────────────────
 * Released over ANOTHER word's bucket: the word springs back to where the drag started,
 * the bucket's outline goes red and it shakes, and input is LOCKED for
 * max(SNAP_BACK_MS, WRONG_SHAKE_MS). No time penalty.
 *
 * Released anywhere else (open field, an empty slot) is a MOVE, not a drop: no mark.
 */

interface BucketDropStageProps {
    pool: VocabEntry[];
    showPinyin: boolean;
    showPinyinColor: boolean;
    /** No pickup while the run is paused (a popup, or backgrounding). */
    paused: boolean;
    /** A word was picked up — the page narrates it unless it is a reading run. */
    onPickUp: (entry: VocabEntry) => void;
    /** A drop landed in a bucket: `correct` is whether it was the word's own. */
    onDrop: (entry: VocabEntry, correct: boolean) => void;
    /** The last word was dropped. Fires in the same tick as its `onDrop`. */
    onComplete: () => void;
}

/** A bucket fading out after its word fell in — drawn over its slot for BUCKET_EXIT_MS. */
interface LeavingGhost {
    key: string;
    slot: PerimeterSlot;
    text: string;
}

/** A correctly-dropped word falling into its hole, in FIELD coordinates. */
interface FallingGhost {
    key: string;
    entry: VocabEntry;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
}

/** Forgiveness around a bucket for a release just outside its edge (px). */
const HIT_SLOP = 4;
/** How long input stays locked after a wrong drop. */
const WRONG_LOCK_MS = Math.max(SNAP_BACK_MS, WRONG_SHAKE_MS);

/** The bucket whose slot holds the field point, or -1. */
function slotAt(slots: readonly PerimeterSlot[], x: number, y: number): number {
    return slots.findIndex((s) =>
        x >= s.x - HIT_SLOP && x <= s.x + s.width + HIT_SLOP && y >= s.y - HIT_SLOP && y <= s.y + s.height + HIT_SLOP,
    );
}

/** A dropped word's fall into its hole, played once on mount (Web Animations API). */
const FallingWord: React.FC<{ ghost: FallingGhost; showPinyin: boolean; showPinyinColor: boolean; onDone: (key: string) => void }> = ({ ghost, showPinyin, showPinyinColor, onDone }) => {
    const ref = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        const node = ref.current;
        if (!node) return;
        // Starts exactly where the held word was let go (its lift and fade included),
        // homes in on the bucket's centre and shrinks away, as if into the recess —
        // the sort flow's drop "fall" (SortCardsPage → DROP_FALL_MS).
        const at = (x: number, y: number, scale: number) => `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`;
        const animation = node.animate(
            [
                { transform: at(ghost.fromX, ghost.fromY, HELD_SCALE), opacity: HELD_OPACITY },
                { transform: at(ghost.toX, ghost.toY, DROP_FALL_END_SCALE), opacity: 0 },
            ],
            { duration: DROP_FALL_MS, easing: "cubic-bezier(0.4, 0, 0.6, 1)", fill: "forwards" },
        );
        animation.onfinish = () => onDone(ghost.key);
        return () => animation.cancel();
        // One animation per ghost, on mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <Box
            ref={ref}
            className="bucket-drop__falling-word"
            sx={{ position: "absolute", left: 0, top: 0, padding: "6px 8px", whiteSpace: "nowrap", pointerEvents: "none", zIndex: 2000 }}
        >
            <ForeignText
                size="sm"
                justifyContent="center"
                text={ghost.entry.entryKey}
                pronunciation={resolveDisplayPronunciation(ghost.entry)}
                showPinyin={showPinyin}
                useToneColor={showPinyinColor}
                pinyinShift
            />
        </Box>
    );
};

/** One word's spot in the opening pile: centre (field px) and stacking order. */
interface PileSpot {
    x: number;
    y: number;
    z: number;
}

/**
 * Deal the opening pile around (cx, cy): random order, small random jitter, and a word
 * whose bucket is SHOWING on top — the first word the player sees can always be placed.
 */
function dealPile(words: readonly number[], shown: ReadonlySet<number>, cx: number, cy: number): Map<number, PileSpot> {
    const order = [...words].sort(() => Math.random() - 0.5);
    const topIndex = order.findIndex((id) => shown.has(id));
    if (topIndex >= 0) order.push(order.splice(topIndex, 1)[0]);
    const jitter = (span: number) => (Math.random() * 2 - 1) * span;
    return new Map(order.map((id, i) => [id, { x: cx + jitter(PILE_JITTER_X), y: cy + jitter(PILE_JITTER_Y), z: i + 1 }]));
}

const BucketDropStage: React.FC<BucketDropStageProps> = ({ pool, showPinyin, showPinyinColor, paused, onPickUp, onDrop, onComplete }) => {
    const entryById = useMemo(() => new Map(pool.map((e) => [e.id, e])), [pool]);

    // ── Field geometry ───────────────────────────────────────────────────────
    const fieldRef = useRef<HTMLDivElement | null>(null);
    const [fieldSize, setFieldSize] = useState({ width: 0, height: 0 });
    useLayoutEffect(() => {
        const node = fieldRef.current;
        if (!node) return;
        const measure = () => setFieldSize({ width: node.clientWidth, height: node.clientHeight });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);
    const layout = useMemo(() => layoutPerimeter(fieldSize.width, fieldSize.height), [fieldSize]);
    const layoutRef = useRef(layout);
    layoutRef.current = layout;
    const fieldSizeRef = useRef(fieldSize);
    fieldSizeRef.current = fieldSize;

    // ── Run model ────────────────────────────────────────────────────────────
    // Dealt into 0 slots, then sized by the effect below once the field is measured.
    // The ref is the source of truth for the synchronous release handler (a release must
    // be judged against the queue as it is NOW, not as of the last render).
    const [queue, setQueueState] = useState<BucketQueueState>(() => dealQueue(pool.map((e) => e.id), 0));
    const queueRef = useRef(queue);
    const setQueue = useCallback((next: BucketQueueState) => {
        queueRef.current = next;
        setQueueState(next);
    }, []);
    const slotCount = layout.slots.length;

    // The opening pile, dealt ONCE — the first time the field has slots. After that each
    // word owns its own position (StackWord), so a resize never re-deals.
    const [pile, setPile] = useState<Map<number, PileSpot> | null>(null);
    useEffect(() => {
        if (queueRef.current.slots.length !== slotCount) setQueue(resizeQueue(queueRef.current, slotCount));
        if (slotCount > 0 && !pile) {
            const { stack } = layoutRef.current;
            const shown = new Set(queueRef.current.slots.filter((id): id is number => id !== null));
            setPile(dealPile(queueRef.current.remaining, shown, stack.x + stack.width / 2, stack.y + stack.height / 2));
        }
    }, [slotCount, setQueue, pile]);

    // Buckets that arrived by REFILL fade in; the dealt board appears at once.
    const refillKeysRef = useRef<Set<string>>(new Set());
    const bucketKey = (slotIndex: number, id: number) => `${slotIndex}-${id}`;

    // ── Feedback state ───────────────────────────────────────────────────────
    const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
    const hoveredRef = useRef<number | null>(null);
    const [wrong, setWrong] = useState<{ slotIndex: number; nonce: number } | null>(null);
    const [locked, setLocked] = useState(false);
    const [leaving, setLeaving] = useState<LeavingGhost[]>([]);
    const [falling, setFalling] = useState<FallingGhost[]>([]);
    const ghostSeqRef = useRef(0);
    /** The next resting z-index — every word put down goes on top of the others. */
    const zCounterRef = useRef(pool.length + 1);

    // Every pending timer, cleared on unmount so none fires into a dead run.
    const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
    const later = useCallback((ms: number, fn: () => void) => {
        const id = setTimeout(() => {
            timersRef.current.delete(id);
            fn();
        }, ms);
        timersRef.current.add(id);
    }, []);
    useEffect(() => {
        const timers = timersRef.current;
        return () => timers.forEach(clearTimeout);
    }, []);

    // Callbacks the page passes are read through a ref so the handlers below keep a
    // STABLE identity — StackWord is memoized, and re-rendering it mid-drag would
    // re-run its CPCDRow layout pass (see StackWord's header).
    const propsRef = useRef({ onPickUp, onDrop, onComplete });
    propsRef.current = { onPickUp, onDrop, onComplete };

    /** Client point → field point. */
    const toField = useCallback((x: number, y: number) => {
        const rect = fieldRef.current?.getBoundingClientRect();
        return rect ? { x: x - rect.left, y: y - rect.top } : null;
    }, []);

    const handlePickUp = useCallback((entry: VocabEntry): number => {
        propsRef.current.onPickUp(entry);
        zCounterRef.current += 1;
        return zCounterRef.current;
    }, []);

    const handleHover = useCallback((clientX: number, clientY: number) => {
        const point = toField(clientX, clientY);
        const index = point ? slotAt(layoutRef.current.slots, point.x, point.y) : -1;
        // Only an occupied slot is a target worth cueing.
        const next = index >= 0 && queueRef.current.slots[index] !== null ? index : null;
        if (next !== hoveredRef.current) {
            hoveredRef.current = next;
            setHoveredSlot(next);
        }
    }, [toField]);

    const handleRelease = useCallback((entry: VocabEntry, point: { x: number; y: number } | null, wordRect: DOMRect): DropVerdict => {
        hoveredRef.current = null;
        setHoveredSlot(null);
        const fieldRect = fieldRef.current?.getBoundingClientRect();
        if (!point || !fieldRect) return { kind: "wrong" }; // cancelled → back to the drag start
        const current = queueRef.current;
        const { onDrop: drop, onComplete: complete } = propsRef.current;
        const fieldPoint = { x: point.x - fieldRect.left, y: point.y - fieldRect.top };
        // Where the word's CENTRE is now, in field px — its new resting spot on a move.
        const centre = { x: wordRect.left + wordRect.width / 2 - fieldRect.left, y: wordRect.top + wordRect.height / 2 - fieldRect.top };

        const slots = layoutRef.current.slots;
        const slotIndex = slotAt(slots, fieldPoint.x, fieldPoint.y);
        const occupant = slotIndex >= 0 ? current.slots[slotIndex] : null;

        // ── A move: open field, or an empty slot ─────────────────────────────
        if (occupant === null || occupant === undefined) {
            // Keep the whole word inside the field (its resting box is the unscaled size).
            const { width, height } = fieldSizeRef.current;
            const halfW = Math.min(width / 2, wordRect.width / HELD_SCALE / 2);
            const halfH = Math.min(height / 2, wordRect.height / HELD_SCALE / 2);
            return {
                kind: "moved",
                x: Math.min(Math.max(centre.x, halfW), width - halfW),
                y: Math.min(Math.max(centre.y, halfH), height - halfH),
            };
        }

        // ── Wrong bucket ─────────────────────────────────────────────────────
        const next = resolveDrop(current, slotIndex, entry.id);
        if (next === current) {
            setWrong({ slotIndex, nonce: Date.now() });
            setLocked(true);
            later(WRONG_LOCK_MS, () => {
                setLocked(false);
                setWrong(null);
            });
            drop(entry, false);
            return { kind: "wrong" };
        }

        // ── Its own bucket ───────────────────────────────────────────────────
        const slot = slots[slotIndex];
        const seq = ++ghostSeqRef.current;
        setFalling((prev) => [...prev, {
            key: `fall-${seq}`,
            entry,
            fromX: centre.x,
            fromY: centre.y,
            toX: slot.x + slot.width / 2,
            toY: slot.y + slot.height / 2,
        }]);
        const leavingKey = `leave-${seq}`;
        setLeaving((prev) => [...prev, { key: leavingKey, slot, text: resolveDisplayDefinition(entry) }]);
        later(BUCKET_EXIT_MS, () => setLeaving((prev) => prev.filter((g) => g.key !== leavingKey)));

        const refilled = next.slots[slotIndex];
        if (refilled !== null) refillKeysRef.current.add(bucketKey(slotIndex, refilled));
        setQueue(next);
        drop(entry, true);
        if (next.remaining.length === 0) complete();
        return { kind: "correct" };
    }, [later, setQueue]);

    const removeFalling = useCallback((key: string) => setFalling((prev) => prev.filter((g) => g.key !== key)), []);

    return (
        <Box
            ref={fieldRef}
            className="bucket-drop__field"
            sx={{ position: "relative", flex: 1, minHeight: 0, width: "100%", overflow: "hidden", touchAction: "none" }}
        >
            {layout.slots.map((slot) => {
                const id = queue.slots[slot.index];
                const entry = id === null || id === undefined ? undefined : entryById.get(id);
                if (!entry) return null;
                const key = bucketKey(slot.index, entry.id);
                return (
                    <DropBucket
                        key={key}
                        slot={slot}
                        text={resolveDisplayDefinition(entry)}
                        hovered={hoveredSlot === slot.index}
                        wrong={wrong?.slotIndex === slot.index}
                        shakeKey={wrong?.slotIndex === slot.index ? wrong.nonce : 0}
                        enter={refillKeysRef.current.has(key)}
                    />
                );
            })}

            {/* Emptied buckets fading out, drawn OVER their slot's replacement. */}
            {leaving.map((ghost) => (
                <DropBucket key={ghost.key} slot={ghost.slot} text={ghost.text} leaving />
            ))}

            {/* Every word still in play. Keyed by id: a word keeps its node (and so its
                resting spot) for the whole run, and unmounts when it is placed. */}
            {pile && queue.remaining.map((id) => {
                const entry = entryById.get(id);
                const spot = pile.get(id);
                if (!entry || !spot) return null;
                return (
                    <StackWord
                        key={id}
                        entry={entry}
                        initialX={spot.x}
                        initialY={spot.y}
                        initialZ={spot.z}
                        showPinyin={showPinyin}
                        showPinyinColor={showPinyinColor}
                        disabled={paused || locked}
                        onPickUp={handlePickUp}
                        onHover={handleHover}
                        onRelease={handleRelease}
                    />
                );
            })}

            {falling.map((ghost) => (
                <FallingWord
                    key={ghost.key}
                    ghost={ghost}
                    showPinyin={showPinyin}
                    showPinyinColor={showPinyinColor}
                    onDone={removeFalling}
                />
            ))}
        </Box>
    );
};

export default BucketDropStage;
