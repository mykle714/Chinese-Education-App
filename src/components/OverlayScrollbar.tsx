import React, { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { COLORS } from "../theme";

/**
 * A scrollbar thumb drawn OVER a scroll container's content, instead of the native
 * bar that takes up width beside it.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 * Touch platforms already draw overlay scrollbars, but desktop browsers with classic
 * scrollbars put a ~15px bar beside the content, and there is no CSS that makes it
 * float (`overflow: overlay` was removed from Chromium). Reserving the gutter
 * (`scrollbar-gutter: stable`) avoids reflow but pushes the content off-center. So the
 * scroller hides its native bar (`hiddenNativeScrollbarSx`) and this component draws
 * a thin thumb in its place.
 *
 * ── How to mount it ────────────────────────────────────────────────────────────
 * Render it as a SIBLING of the scroller, inside a `position: relative` wrapper that
 * does not scroll. A thumb inside the scroller would scroll away with the content, and
 * would also be clipped by any mask the scroller carries (e.g. `sheetEdgeFadeSx`).
 *
 * It is display-only (`pointer-events: none`): wheel, trackpad and touch scrolling all
 * reach the scroller underneath. The thumb appears while the box is scrolling and fades
 * out shortly after, like a native overlay bar. Geometry is written straight to the
 * DOM in the scroll handler, so scrolling never re-renders React.
 *
 * Used by: src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx (eip tab
 * panes). Docs: docs/EIP_SHEET_GESTURES.md § Pane scrollbar.
 */

/** Spread into a scroller's `sx` to hide its native scrollbar (it must keep scrolling). */
export const hiddenNativeScrollbarSx = {
    scrollbarWidth: "none",
    "&::-webkit-scrollbar": { display: "none" },
} as const;

const THUMB_WIDTH_PX = 4;
const EDGE_INSET_PX = 3;       // gap between the thumb and the box's right/top/bottom edges
const MIN_THUMB_PX = 24;       // a very long pane still gets a thumb you can see
const FADE_DELAY_MS = 900;     // how long the thumb lingers after the last scroll event

interface OverlayScrollbarProps {
    /** The scroll container this thumb tracks. Read in an effect, so a ref filled on mount is fine. */
    getScroller: () => HTMLElement | null;
    className?: string;
}

const OverlayScrollbar: React.FC<OverlayScrollbarProps> = ({ getScroller, className }) => {
    const thumbRef = useRef<HTMLDivElement | null>(null);
    // Keep the latest getter without re-running the effect when the parent passes a new arrow.
    const getScrollerRef = useRef(getScroller);
    getScrollerRef.current = getScroller;

    useEffect(() => {
        const scroller = getScrollerRef.current();
        const thumb = thumbRef.current;
        if (!scroller || !thumb) return;

        let fadeTimer: ReturnType<typeof setTimeout> | undefined;

        // Position + size the thumb from the scroller's current metrics. Returns false
        // when the content fits (nothing to scroll), so callers keep the thumb hidden.
        const layout = (): boolean => {
            const { scrollTop, scrollHeight, clientHeight } = scroller;
            const overflow = scrollHeight - clientHeight;
            if (overflow <= 1) {
                thumb.style.opacity = "0";
                return false;
            }
            const track = clientHeight - EDGE_INSET_PX * 2;
            const thumbHeight = Math.max(MIN_THUMB_PX, (track * clientHeight) / scrollHeight);
            const top = EDGE_INSET_PX + (scrollTop / overflow) * (track - thumbHeight);
            thumb.style.height = `${thumbHeight}px`;
            thumb.style.transform = `translateY(${top}px)`;
            return true;
        };

        const onScroll = () => {
            if (!layout()) return;
            thumb.style.opacity = "1";
            if (fadeTimer) clearTimeout(fadeTimer);
            fadeTimer = setTimeout(() => { thumb.style.opacity = "0"; }, FADE_DELAY_MS);
        };

        // Content or box size changes (new entry, image load, panel resize) move the
        // thumb without a scroll event — re-measure, but don't flash it into view.
        const resizeObserver = new ResizeObserver(() => { layout(); });
        resizeObserver.observe(scroller);
        for (const child of Array.from(scroller.children)) resizeObserver.observe(child);

        scroller.addEventListener("scroll", onScroll, { passive: true });
        layout();
        return () => {
            scroller.removeEventListener("scroll", onScroll);
            resizeObserver.disconnect();
            if (fadeTimer) clearTimeout(fadeTimer);
        };
    }, []);

    return (
        <Box
            ref={thumbRef}
            className={className ? `overlay-scrollbar-thumb ${className}` : "overlay-scrollbar-thumb"}
            aria-hidden
            sx={{
                position: "absolute",
                top: 0,
                right: `${EDGE_INSET_PX}px`,
                width: `${THUMB_WIDTH_PX}px`,
                borderRadius: `${THUMB_WIDTH_PX / 2}px`,
                // --scrim ink: a neutral, translucent ink that reads on both the paper and
                // the beige eip surface without introducing a new colour.
                backgroundColor: COLORS.scrim,
                opacity: 0,
                transition: "opacity 200ms ease",
                pointerEvents: "none",
                zIndex: 1,
            }}
        />
    );
};

export default OverlayScrollbar;
