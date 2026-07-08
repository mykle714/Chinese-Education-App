import { useRef } from "react";
import { Box, useMediaQuery, useTheme } from "@mui/material";

interface ReaderTapOverlayProps {
    inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

const LONG_PRESS_MS = 500;
const MOVE_THRESHOLD_PX = 10;

function ReaderTapOverlay({ inputRef }: ReaderTapOverlayProps) {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("md"));

    // Per-gesture state lives in refs so we don't re-render mid-touch.
    const gestureRef = useRef<{
        startX: number;
        startY: number;
        startTime: number;
        longPressTimer: number | null;
        passthrough: boolean;
        // Set once a drag is recognised as a vertical scroll. The overlay then
        // proxies the gesture: it scrolls the textarea beneath it by hand
        // (the textarea is a sibling, not an ancestor, so the browser would
        // otherwise have nothing in the overlay's scroll chain to scroll).
        scrolling: boolean;
        lastY: number;
    } | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);

    if (!isMobile) return null;

    const clearLongPressTimer = () => {
        const g = gestureRef.current;
        if (g && g.longPressTimer !== null) {
            window.clearTimeout(g.longPressTimer);
            g.longPressTimer = null;
        }
    };

    // Engage native textarea selection: hide the overlay from pointer events and
    // synthesize a pointerdown on whatever sits beneath the finger so iOS/Android
    // start their native selection gesture without the user lifting.
    const engagePassthrough = (clientX: number, clientY: number) => {
        const g = gestureRef.current;
        if (!g || g.passthrough) return;
        g.passthrough = true;

        const overlay = overlayRef.current;
        if (overlay) overlay.style.pointerEvents = "none";

        const target = document.elementFromPoint(clientX, clientY);
        if (target) {
            const synth = new PointerEvent("pointerdown", {
                bubbles: true,
                cancelable: true,
                clientX,
                clientY,
                pointerType: "touch",
                isPrimary: true,
            });
            target.dispatchEvent(synth);
        }

        // Restore pointer-events on the next pointerup anywhere in the window.
        const restore = () => {
            if (overlay) overlay.style.pointerEvents = "auto";
            window.removeEventListener("pointerup", restore);
            window.removeEventListener("pointercancel", restore);
        };
        window.addEventListener("pointerup", restore);
        window.addEventListener("pointercancel", restore);
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        // Keep the textarea focused so useTextSelection's blur handler doesn't
        // race in and snap the caret back to lastSelectionRef before our
        // pointerup runs selectRelativeSpan (via the synthetic arrow keydown).
        e.preventDefault();
        gestureRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startTime: performance.now(),
            longPressTimer: null,
            passthrough: false,
            scrolling: false,
            lastY: e.clientY,
        };
        const startX = e.clientX;
        const startY = e.clientY;
        gestureRef.current.longPressTimer = window.setTimeout(() => {
            engagePassthrough(startX, startY);
        }, LONG_PRESS_MS);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const g = gestureRef.current;
        if (!g || g.passthrough) return;

        // Once in scroll mode, keep proxying the drag to the textarea's scrollTop.
        if (g.scrolling) {
            const textarea = inputRef.current;
            if (textarea) textarea.scrollTop -= e.clientY - g.lastY;
            g.lastY = e.clientY;
            return;
        }

        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;
        if (Math.hypot(dx, dy) > MOVE_THRESHOLD_PX) {
            clearLongPressTimer();
            // A vertical-dominant drag is a scroll: proxy it to the textarea.
            // A horizontal-dominant drag hands off to native text selection.
            if (Math.abs(dy) > Math.abs(dx)) {
                g.scrolling = true;
                const textarea = inputRef.current;
                if (textarea) textarea.scrollTop -= e.clientY - g.lastY;
                g.lastY = e.clientY;
            } else {
                engagePassthrough(e.clientX, e.clientY);
            }
        }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        const g = gestureRef.current;
        if (!g) return;
        clearLongPressTimer();

        // A scroll drag has no tap/selection follow-up — just end the gesture.
        if (g.passthrough || g.scrolling) {
            gestureRef.current = null;
            return;
        }

        const elapsed = performance.now() - g.startTime;
        const moved = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
        gestureRef.current = null;

        if (elapsed >= LONG_PRESS_MS || moved >= MOVE_THRESHOLD_PX) return;

        const textarea = inputRef.current;
        if (!textarea) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const relativeX = e.clientX - rect.left;
        const zone = relativeX / rect.width;

        e.preventDefault();
        e.stopPropagation();

        // Reuse the existing keyboard navigation: dispatch the same Arrow
        // keydown the textarea's onKeyDown handler already processes. That
        // handler correctly distinguishes collapsed-caret vs selected-word
        // cases and respects the autoSelectEnabled setting. The trailing
        // keyup is what makes React's onSelect polyfill notice the selection
        // change and re-run the auto-highlight expansion.
        const key = zone < 1 / 3 ? "ArrowLeft" : "ArrowRight";
        textarea.dispatchEvent(new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
        }));
        textarea.dispatchEvent(new KeyboardEvent("keyup", {
            key,
            bubbles: true,
            cancelable: true,
        }));
    };

    const handlePointerCancel = () => {
        clearLongPressTimer();
        gestureRef.current = null;
    };

    return (
        <Box
            ref={overlayRef}
            className="reader-page-tap-overlay"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            sx={{
                position: "absolute",
                inset: 0,
                zIndex: 2,
                backgroundColor: "transparent",
                // The overlay proxies scrolling itself (see handlePointerMove),
                // so suppress the browser's own touch gestures to receive the
                // full pointer stream — otherwise a vertical pan is swallowed
                // with nothing in the overlay's scroll chain to move.
                touchAction: "none",
            }}
        />
    );
}

export default ReaderTapOverlay;
