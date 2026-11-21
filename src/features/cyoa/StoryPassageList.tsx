import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Box, Typography } from "@mui/material";
import { FONTS } from "../../theme/fonts";
import { SIZE } from "../../theme/scale";
import type { StoryPassageEdit } from "../../../server/contracts/stories";
import type { Tier2Look } from "../../timeOfDay/tier2Look";
import StoryPassageRow from "./StoryPassageRow";
import StoryPassageLinks from "./StoryPassageLinks";
import { layoutPassageLinks, linkGutterWidth, type RowBox } from "./passageLinkLayout";
import { passageLabel } from "./storyEditorModel";
import { dropIndex, moveItem, rowShift } from "./passageReorder";

/**
 * StoryPassageList — the story editor's passage rows with the LINK GUTTER on their right
 * (docs/CYOA_FEATURE.md § 5.2):
 *
 *   ┌────────────────────────┐
 *   │ Passage 1  [Start]   › │●─┐
 *   ├────────────────────────┤  │
 *   │ The forest           › │◀─┘
 *   └────────────────────────┘
 *
 * It owns the measuring: the gutter draws in pixels, but a row's height depends on how its
 * label and chips wrap, so each row's box is read from the DOM after layout and again
 * whenever the list resizes (a rotation, a chip wrapping). The rows narrow by the gutter's
 * width, which grows with the lanes in use (none → full width, no gutter).
 *
 * ── Reordering (§ 5.3) ──
 * It also owns the DRAG. Pressing a row's ⠿ handle captures the pointer; the row follows
 * the finger (a transform, not a re-layout) and the rows it passes step aside
 * (passageReorder.ts → dropIndex / rowShift, computed from the boxes measured above). On
 * release the new order goes to `onReorder` once; the page applies it optimistically and
 * saves it. Near the top or bottom of the scrolling column the column auto-scrolls, and the
 * scroll distance counts toward the drag. The link gutter fades out during a drag — its
 * lanes describe the old order — and is redrawn for the new one.
 *
 * Layer: feature presentation (src/features/cyoa). Rendered by StoryEditorPage.tsx.
 */

/** Vertical gap between rows, px (MUI spacing 1). */
const ROW_GAP = 8;
/** Auto-scroll band at the scroller's top and bottom edges, px, and its top speed (px/frame). */
const EDGE_BAND = 56;
const EDGE_SPEED = 10;
/** How fast passed rows step aside. */
const SHIFT_TRANSITION = "transform 160ms ease-out";

/** A drag in flight. `dy` is the row's offset from rest, px (pointer + scroll travel). */
interface DragState {
    from: number;
    over: number;
    dy: number;
}

interface StoryPassageListProps {
    look: Tier2Look;
    passages: StoryPassageEdit[];
    labels: Map<string, string>;
    startPassageId: string | null;
    onOpen: (passageId: string) => void;
    /** A drop that changed the order: every passage id, in the new order. */
    onReorder: (passageIds: string[]) => void;
    /** A row's copy button. */
    onDuplicate: (passageId: string) => void;
    /** A save is in flight (the copy buttons wait). */
    busy: boolean;
    /** The element that scrolls the list (auto-scroll while dragging near its edges). */
    scrollerRef: RefObject<HTMLElement | null>;
}

function StoryPassageList({ look, passages, labels, startPassageId, onOpen, onReorder, onDuplicate, busy, scrollerRef }: StoryPassageListProps) {
    const layout = useMemo(() => layoutPassageLinks(passages), [passages]);
    const gutter = linkGutterWidth(layout.laneCount);

    const listRef = useRef<HTMLDivElement | null>(null);
    const [measured, setMeasured] = useState<{ rows: RowBox[]; height: number }>({ rows: [], height: 0 });

    // Read each row's box (relative to the list) after layout, and on every resize. Rows
    // are the list's direct children, in passage order.
    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const measure = () => {
            const rows = Array.from(list.children, (child) => {
                const element = child as HTMLElement;
                return { top: element.offsetTop, height: element.offsetHeight };
            });
            setMeasured((previous) => {
                const same = previous.height === list.offsetHeight
                    && previous.rows.length === rows.length
                    && previous.rows.every((row, i) => row.top === rows[i].top && row.height === rows[i].height);
                return same ? previous : { rows, height: list.offsetHeight };
            });
        };
        measure();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(list);
        return () => observer.disconnect();
    }, [passages, gutter]);

    // ── Drag ──
    const [drag, setDrag] = useState<DragState | null>(null);
    // The pointer's start and latest y, and the scroller's start offset — read by the move
    // handler and the auto-scroll loop, which must not wait for a render.
    const pointerRef = useRef<{ id: number; startY: number; lastY: number; startScroll: number } | null>(null);
    const dragRef = useRef<DragState | null>(null);
    dragRef.current = drag;
    // The rows as last measured, for the auto-scroll loop (which outlives a render).
    const rowsRef = useRef<RowBox[]>([]);
    rowsRef.current = measured.rows;

    /** Recompute dy / over from the pointer's latest y and the scroll travelled. */
    const track = () => {
        const pointer = pointerRef.current;
        const current = dragRef.current;
        if (!pointer || !current) return;
        const scrollTravel = (scrollerRef.current?.scrollTop ?? 0) - pointer.startScroll;
        const dy = pointer.lastY - pointer.startY + scrollTravel;
        const over = dropIndex(rowsRef.current, current.from, dy);
        if (dy !== current.dy || over !== current.over) setDrag({ from: current.from, over, dy });
    };

    const handlePropsFor = (index: number): React.HTMLAttributes<HTMLDivElement> => ({
        onPointerDown: (event) => {
            if (event.button !== 0 || pointerRef.current) return;
            event.preventDefault(); // no text selection, no focus shift
            event.currentTarget.setPointerCapture(event.pointerId);
            pointerRef.current = {
                id: event.pointerId,
                startY: event.clientY,
                lastY: event.clientY,
                startScroll: scrollerRef.current?.scrollTop ?? 0,
            };
            setDrag({ from: index, over: index, dy: 0 });
        },
        onPointerMove: (event) => {
            if (pointerRef.current?.id !== event.pointerId) return;
            pointerRef.current.lastY = event.clientY;
            track();
        },
        onPointerUp: (event) => {
            if (pointerRef.current?.id !== event.pointerId) return;
            const current = dragRef.current;
            pointerRef.current = null;
            setDrag(null);
            // Batched with setDrag(null): the list re-renders once, already in the new order,
            // so no row animates back from its shifted place.
            if (current && current.over !== current.from) {
                onReorder(moveItem(passages, current.from, current.over).map((passage) => passage.id));
            }
        },
        onPointerCancel: (event) => {
            if (pointerRef.current?.id !== event.pointerId) return;
            pointerRef.current = null;
            setDrag(null);
        },
    });

    // Auto-scroll while the pointer sits in the scroller's top or bottom band; faster the
    // deeper it is. Runs only during a drag.
    const dragging = drag !== null;
    useEffect(() => {
        if (!dragging) return;
        let frame = 0;
        const step = () => {
            const scroller = scrollerRef.current;
            const pointer = pointerRef.current;
            if (scroller && pointer) {
                const rect = scroller.getBoundingClientRect();
                const intoTop = rect.top + EDGE_BAND - pointer.lastY;
                const intoBottom = pointer.lastY - (rect.bottom - EDGE_BAND);
                const delta = intoTop > 0 ? -intoTop : intoBottom > 0 ? intoBottom : 0;
                if (delta !== 0) {
                    const before = scroller.scrollTop;
                    scroller.scrollTop += Math.max(-EDGE_SPEED, Math.min(EDGE_SPEED, delta / 4));
                    if (scroller.scrollTop !== before) track();
                }
            }
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
        // `track` reads only refs (pointer, drag, rows, scroller), so the loop started at the
        // drag's first frame stays correct; it is deliberately not a dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dragging, scrollerRef]);

    return (
        <Box className="story-passage-list" sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            <Box className="story-passage-list__graph" sx={{ position: "relative", pr: `${gutter}px` }}>
                <Box ref={listRef} className="story-passage-list__rows" sx={{ position: "relative", display: "flex", flexDirection: "column", gap: `${ROW_GAP}px` }}>
                    {passages.map((passage, index) => {
                        const isEnding = passage.choices.length === 0;
                        const isDragged = drag?.from === index;
                        const offset = !drag ? 0 : isDragged ? drag.dy : rowShift(measured.rows, drag.from, drag.over, index, ROW_GAP);
                        return (
                            <Box
                                key={passage.id}
                                className="story-passage-list__slot"
                                style={{
                                    transform: offset ? `translateY(${offset}px)` : undefined,
                                    // Only the passed rows glide; the dragged row tracks the
                                    // finger exactly, and nothing animates on the drop.
                                    transition: drag && !isDragged ? SHIFT_TRANSITION : "none",
                                    position: "relative",
                                    zIndex: isDragged ? 2 : undefined,
                                }}
                            >
                                <StoryPassageRow
                                    look={look}
                                    label={passageLabel(passage.id, labels)}
                                    isStart={passage.id === startPassageId}
                                    endingTitle={isEnding ? passage.endingTitle ?? "" : null}
                                    unlinkedCount={passage.choices.filter((choice) => !choice.targetPassageId).length}
                                    onOpen={() => onOpen(passage.id)}
                                    handleProps={handlePropsFor(index)}
                                    dragging={isDragged}
                                    onDuplicate={() => onDuplicate(passage.id)}
                                    busy={busy}
                                />
                            </Box>
                        );
                    })}
                </Box>
                {/* Faded while dragging: its lanes describe the order before the drop. */}
                <Box className="story-passage-list__links" sx={{ opacity: drag ? 0 : 1, transition: "opacity 120ms ease-out" }}>
                    <StoryPassageLinks look={look} layout={layout} rows={measured.rows} height={measured.height} />
                </Box>
            </Box>
            {layout.hiddenCount > 0 && (
                <Typography className="story-passage-list__hidden" sx={{ fontFamily: FONTS.sans, fontSize: SIZE.micro, color: look.muted, textAlign: "right" }}>
                    {layout.hiddenCount === 1 ? "1 link not shown" : `${layout.hiddenCount} links not shown`}
                </Typography>
            )}
        </Box>
    );
}

export default StoryPassageList;
