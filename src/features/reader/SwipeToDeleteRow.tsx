import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Box, ButtonBase } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { SIZE, WEIGHT } from "../../theme/scale";

// SWIPE-TO-DELETE ROW — the iPhone list pattern for the Reader's document list
// (TextSidebar). Drag the row LEFT to slide its content aside and uncover a Delete
// button pinned behind its right edge; release past half the button's width and the
// row stays open, otherwise it springs shut. Tapping the open row (anywhere but the
// button) closes it instead of opening the document, and only one row is open at a
// time: the parent owns `open` (TextSidebar's `openRowId`).
//
// Gesture notes (docs/UX_AND_NAVIGATION.md § touch rules):
//   - `touchAction: 'pan-y'` hands VERTICAL drags to the browser, so the list still
//     scrolls natively; only horizontal movement reaches the handlers below.
//   - The axis is decided once, after AXIS_LOCK_PX of travel. A drag that starts
//     vertical never moves the row, and one that starts horizontal captures the
//     pointer so it keeps tracking even if the finger drifts off the row.
//   - A drag ends with a `click` on the content underneath. `suppressClickRef`
//     swallows that one click (capture phase) so a swipe never also opens the doc.
// Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § Deleting a document.

/** Width of the uncovered Delete button, and how far an open row rests. */
const DELETE_BUTTON_WIDTH_PX = 80;
/** Travel before the gesture commits to an axis (horizontal swipe vs vertical scroll). */
const AXIS_LOCK_PX = 8;
/** Past the open position the row follows the finger at this fraction (rubber band). */
const OVERDRAG_RESISTANCE = 0.25;
const SETTLE_TRANSITION = "transform 220ms cubic-bezier(0.2, 0, 0, 1)";

interface SwipeToDeleteRowProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDelete: () => void;
    /** Disables the swipe (e.g. while the row's delete request is in flight). */
    disabled?: boolean;
    children: ReactNode;
}

function SwipeToDeleteRow({ open, onOpenChange, onDelete, disabled = false, children }: SwipeToDeleteRowProps) {
    const restingOffset = open ? -DELETE_BUTTON_WIDTH_PX : 0;
    // Live offset while a finger is down; null = not dragging (render the resting offset).
    const [dragOffset, setDragOffset] = useState<number | null>(null);
    const gestureRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        startOffset: number;
        axis: "undecided" | "x" | "y";
    } | null>(null);
    const suppressClickRef = useRef(false);

    // A row closed from outside (another row opened) must drop any stale drag.
    useEffect(() => {
        if (!open) setDragOffset(null);
    }, [open]);

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
        gestureRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startOffset: restingOffset,
            axis: "undecided",
        };
    }, [disabled, restingOffset]);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;
        const dx = e.clientX - gesture.startX;
        const dy = e.clientY - gesture.startY;

        if (gesture.axis === "undecided") {
            if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
            gesture.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            if (gesture.axis === "y") return;
            e.currentTarget.setPointerCapture(e.pointerId);
        }
        if (gesture.axis !== "x") return;

        // Clamp right of closed (0); rubber-band left of the open position.
        let next = Math.min(0, gesture.startOffset + dx);
        if (next < -DELETE_BUTTON_WIDTH_PX) {
            next = -DELETE_BUTTON_WIDTH_PX + (next + DELETE_BUTTON_WIDTH_PX) * OVERDRAG_RESISTANCE;
        }
        setDragOffset(next);
    }, []);

    const endGesture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;
        gestureRef.current = null;
        if (gesture.axis !== "x") return;
        suppressClickRef.current = true;
        const finalOffset = dragOffset ?? gesture.startOffset;
        setDragOffset(null);
        onOpenChange(finalOffset < -DELETE_BUTTON_WIDTH_PX / 2);
    }, [dragOffset, onOpenChange]);

    // Capture-phase click guard on the content: eat the click that ends a swipe, and
    // turn a tap on an open row into "close" rather than "open the document".
    const handleClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (suppressClickRef.current) {
            suppressClickRef.current = false;
            e.stopPropagation();
            e.preventDefault();
            return;
        }
        if (open) {
            e.stopPropagation();
            e.preventDefault();
            onOpenChange(false);
        }
    }, [open, onOpenChange]);

    const offset = dragOffset ?? restingOffset;
    // How much of the Delete button is uncovered (0 closed … 1 fully open); the
    // button is only interactive once the row has settled open.
    const reveal = Math.min(1, -offset / DELETE_BUTTON_WIDTH_PX);

    return (
        <Box
            className="reader-swipe-row"
            sx={{ position: "relative", overflow: "hidden", borderRadius: 2 }}
        >
            {/* Behind the content, pinned to the right edge. */}
            <ButtonBase
                className="reader-swipe-row-delete-button"
                onClick={onDelete}
                disabled={!open || disabled}
                aria-label="Delete document"
                tabIndex={open ? 0 : -1}
                sx={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    bottom: 0,
                    width: DELETE_BUTTON_WIDTH_PX,
                    // ⚠️ Palette note: the v2 `dangerInk` role is plain ink, so the
                    // iPhone-red fill comes from the red ramp's MARK tier with ink on it
                    // (white never sits on a ramp colour — docs/SHELF_REDESIGN.md).
                    backgroundColor: COLORS.redMk,
                    color: COLORS.onSurface,
                    fontSize: SIZE.body,
                    fontWeight: WEIGHT.bold,
                    opacity: reveal > 0 ? 1 : 0,
                }}
            >
                Delete
            </ButtonBase>

            <Box
                className="reader-swipe-row-content"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
                onClickCapture={handleClickCapture}
                sx={{
                    position: "relative",
                    // Opaque so the Delete button only shows where the content has slid away.
                    backgroundColor: COLORS.background,
                    transform: `translateX(${offset}px)`,
                    transition: dragOffset === null ? SETTLE_TRANSITION : "none",
                    touchAction: "pan-y",
                }}
            >
                {children}
            </Box>
        </Box>
    );
}

export default SwipeToDeleteRow;
