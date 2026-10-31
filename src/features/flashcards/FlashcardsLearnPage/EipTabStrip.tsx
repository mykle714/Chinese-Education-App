import { Fragment, useEffect, useRef } from "react";
import { Box } from "@mui/material";
import Icon from "../../../components/Icon";
import { EipTabStripContainer, EipEntryTab, EIP_PILL_IN_MS } from "./styled";
import { useEipColors } from "./useEipPalette";
import { useDragScroll } from "../../../hooks/useDragScroll";
import type { EipTab } from "./useEipTabs";

interface EipTabStripProps {
    tabs: EipTab[];
    activeIndex: number;
    onSelect: (index: number) => void;
    // useEipTabs.trailShown — false until the learner first navigates to another word. While
    // false the strip keeps its (empty) slot so the trail row's caret / Add key do not move.
    showCrumbs?: boolean;
}

// The WORD TRAIL (`.trail`, Tower Tier 2 design): the words opened in this panel as a
// breadcrumb (`过去 › 去`). Rendered by EipUpperPanel's trail row, which also carries the
// panel's down caret (close) and (Dictionary eip) the Add key, so the ROW is always there; the crumbs
// themselves stay hidden until the learner first navigates to another word (`showCrumbs`).
//
// It is a STACK (useEipTabs): the showing word is always the LAST crumb. Tapping an earlier
// crumb pops everything above it (`onSelect` = useEipTabs.popTo); Escape pops the top, and
// popping the root closes the panel — the host passes that in as InfoCardSection's `onCloseX`.
// Docs: docs/EIP_SHEET_GESTURES.md § The trail is a breadcrumb stack.
//
// ⚠️ THE ROW SCROLLS (2026-09-06). The trail is capped by COUNT (`MAX_EIP_TABS` = 50), not
// width. Touch pans it natively (`touch-action: pan-x`); desktop drags it with the shared
// `useDragScroll` mouse-drag hook, the same gesture the card shelves use.
function EipTabStrip({ tabs, activeIndex, onSelect, showCrumbs = true }: EipTabStripProps) {
    const colors = useEipColors();
    // The scroller (the pill row), not the padded container: it is what overflows.
    const listRef = useRef<HTMLDivElement | null>(null);
    // Desktop click-and-drag panning. Touch already pans natively via touch-action.
    useDragScroll(listRef);

    // Keep the showing word (the last crumb) on screen. A pushed word is APPENDED, so
    // without this its crumb would sit past the right edge — the strip would look
    // unchanged at the very moment it changed. A pop needs it too: the new last crumb may
    // have been scrolled off to the left.
    // Scrolls the minimum distance, so an already-visible pill does not move.
    //
    // ⛔ NOT `scrollIntoView`. That scrolls EVERY scrollable ancestor to reveal the pill —
    // `block: "nearest"` included, whenever the pill is off-screen vertically. During the
    // sheet's open slide (SheetPanel "Entry slide") the whole sheet is still below the
    // frame, so opening Compare (which pushes a second crumb) scrolled the phone frame
    // itself; the frame is `overflow: hidden`, so nothing ever scrolled it back and the app
    // stayed shifted (2026-10-30). Only the pill row's own scrollLeft is moved here.
    //
    // Run TWICE: once now, and once after the pill's entrance animation (`eipPillIn`
    // widens it from max-width 0). Scrolling to a pill that is still mid-entrance aims at
    // a nearly zero-width box and lands short of where it ends up, so the second pass is
    // what actually finishes the job for a just-pushed tab; for an already-mounted pill
    // it is a no-op (`nearest` on a fully visible target scrolls nothing).
    useEffect(() => {
        const scrollActiveIntoView = () => {
            const list = listRef.current;
            const pill = list?.querySelector<HTMLElement>(`[data-trail-index="${activeIndex}"]`);
            if (!list || !pill) return;
            // Horizontal only, in viewport px (a vertical transform does not change these).
            const listRect = list.getBoundingClientRect();
            const pillRect = pill.getBoundingClientRect();
            // The list may run to the screen edge with an end padding (EipUpperPanel); the
            // showing word rests inside that padding, not against the edge.
            const listRight = listRect.right - (parseFloat(getComputedStyle(list).paddingRight) || 0);
            const delta = pillRect.left < listRect.left
                ? pillRect.left - listRect.left
                : pillRect.right > listRight ? pillRect.right - listRight : 0;
            if (delta !== 0) list.scrollBy({ left: delta, behavior: "smooth" });
        };
        scrollActiveIntoView();
        const timer = window.setTimeout(scrollActiveIntoView, EIP_PILL_IN_MS);
        return () => window.clearTimeout(timer);
    }, [activeIndex, tabs.length, showCrumbs]);

    return (
        <EipTabStripContainer className="eip-entry-tab-strip">
            {(
                <Box
                    ref={listRef}
                    className="eip-entry-tab-list"
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: "2px",
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
                    {showCrumbs && tabs.map((tab, i) => (
                        <Fragment key={tab.id}>
                            {/* `.trail > .ms` — the breadcrumb chevron between words. */}
                            {i > 0 && (
                                <Icon
                                    name="chevron_right"
                                    className="eip-entry-tab-separator"
                                    size={16}
                                    color={colors.muted}
                                    sx={{ flexShrink: 0 }}
                                />
                            )}
                            <EipEntryTab
                                data-trail-index={i}
                                isActive={i === activeIndex}
                                toneColor={tab.toneColor}
                                ink={colors.ink}
                                muted={colors.muted}
                                onClick={() => onSelect(i)}
                                className={`eip-entry-tab eip-entry-tab--${i === activeIndex ? "active" : "inactive"}`}
                            >
                                {tab.kind === "compare" ? "Compare" : tab.entry.entryKey}
                            </EipEntryTab>
                        </Fragment>
                    ))}
                </Box>
            )}
        </EipTabStripContainer>
    );
}

export default EipTabStrip;
