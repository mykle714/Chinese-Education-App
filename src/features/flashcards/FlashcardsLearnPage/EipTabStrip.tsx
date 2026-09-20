import { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { EipTabStripContainer, EipEntryTab, EIP_PILL_IN_MS } from "./styled";
import { useDragScroll } from "../../../hooks/useDragScroll";
import type { EipTab } from "./useEipTabs";

interface EipTabStripProps {
    tabs: EipTab[];
    activeIndex: number;
    onSelect: (index: number) => void;
    // Latched to true the moment a 2nd tab is first opened; stays true even if
    // tabs are closed back to 1 so the strip remains visible for the panel's life.
    isTabbedMode: boolean;
}

// The WORD TRAIL (`.wtrail`, artboards 20/24/25): the words opened in this panel, as
// filled pills. Rendered between the grabber and the entry header.
//
// ⚠️ THERE IS NO ✕ ON THIS ROW ANY MORE. The strip once drew the panel's only close
// button; that became SheetPanel's single close cluster (SheetCloseX + the minute-points
// flame), which for a while SLID DOWN into this row when the strip appeared — so the strip
// reserved a 41px `CLOSE_COLUMN_PX` on the right to keep the pill list from running under
// it. The cluster now lives permanently in the panel's header and never moves
// (2026-09-05), so that reservation is gone and the trail gets the full width back. What
// the ✕ DOES is still the trail's rule (close the showing word; the last one closes the
// panel) — the host page passes that in as SheetPanel's `onCloseX`.
//
// ⚠️ THE ROW SCROLLS (2026-09-06). It used to be a fixed row that REFUSED any word that
// would not fit (`fitsNewTab` in useEipTabs, now deleted), because a pill hanging off the
// edge reads as "scroll for more" on a row that does not scroll. It scrolls now, so that
// reading is correct and the trail is capped by COUNT instead (`MAX_EIP_TABS` = 50).
// Touch pans it natively (`touch-action: pan-x`); desktop drags it with the shared
// `useDragScroll` mouse-drag hook, the same gesture the card shelves use.
//
// Hidden entirely when only the root entry is open — a trail of one is not a trail.
function EipTabStrip({ tabs, activeIndex, onSelect, isTabbedMode }: EipTabStripProps) {
    const isVisible = isTabbedMode;
    // The scroller (the pill row), not the padded container: it is what overflows.
    const listRef = useRef<HTMLDivElement | null>(null);
    // Desktop click-and-drag panning. Touch already pans natively via touch-action.
    useDragScroll(listRef);

    // Keep the showing word on screen. A tab is normally APPENDED, so without this the
    // pill for the word the panel just opened would sit past the right edge — the strip
    // would look unchanged at the very moment it changed. Also covers selecting a tab
    // that is only partly visible, and the closing of a tab shifting the active index.
    // `inline: "nearest"` scrolls the minimum distance, so an already-visible pill does
    // not move; `block: "nearest"` keeps it from scrolling any ancestor vertically.
    //
    // Run TWICE: once now, and once after the pill's entrance animation (`eipPillIn`
    // widens it from max-width 0). Scrolling to a pill that is still mid-entrance aims at
    // a nearly zero-width box and lands short of where it ends up, so the second pass is
    // what actually finishes the job for a just-pushed tab; for an already-mounted pill
    // it is a no-op (`nearest` on a fully visible target scrolls nothing).
    useEffect(() => {
        if (!isVisible) return;
        const scrollActiveIntoView = () => {
            const pill = listRef.current?.children[activeIndex] as HTMLElement | undefined;
            pill?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
        };
        scrollActiveIntoView();
        const timer = window.setTimeout(scrollActiveIntoView, EIP_PILL_IN_MS);
        return () => window.clearTimeout(timer);
    }, [activeIndex, tabs.length, isVisible]);

    return (
        <EipTabStripContainer
            className="eip-entry-tab-strip"
            sx={isVisible ? undefined : { padding: 0, minHeight: 0 }}
        >
            {isVisible && (
                <Box
                    ref={listRef}
                    className="eip-entry-tab-list"
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: "7px",
                        flex: 1,
                        minWidth: 0,
                        overflowX: "auto",
                        overflowY: "hidden",
                        // The row is the ONLY thing a horizontal touch-pan here may move;
                        // vertical touches stay with the sheet (drag-to-resize / scroll).
                        touchAction: "pan-x",
                        // A trail that has scrolled to its end must not rubber-band the
                        // sheet behind it.
                        overscrollBehaviorX: "contain",
                        // No visible scrollbar: this is a pill row, not a scroll region,
                        // and the partly-visible pill at the edge is the affordance.
                        scrollbarWidth: "none",
                        "&::-webkit-scrollbar": { display: "none" },
                    }}
                >
                    {tabs.map((tab, i) => (
                        <EipEntryTab
                            key={tab.id}
                            isActive={i === activeIndex}
                            toneColor={tab.toneColor}
                            onClick={() => onSelect(i)}
                            className={`eip-entry-tab eip-entry-tab--${i === activeIndex ? "active" : "inactive"}`}
                        >
                            {tab.kind === "compare" ? "Compare" : tab.entry.entryKey}
                        </EipEntryTab>
                    ))}
                </Box>
            )}
        </EipTabStripContainer>
    );
}

export default EipTabStrip;
