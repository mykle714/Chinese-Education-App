import React from "react";
import { Box } from "@mui/material";
import { EipTabStripContainer, EipEntryTab } from "./styled";
import type { EipTab } from "./useEipTabs";

interface EipTabStripProps {
    tabs: EipTab[];
    activeIndex: number;
    onSelect: (index: number) => void;
    // Latched to true the moment a 2nd tab is first opened; stays true even if
    // tabs are closed back to 1 so the strip remains visible for the panel's life.
    isTabbedMode: boolean;
    stripRef: React.RefObject<HTMLDivElement | null>;
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
// Hidden entirely when only the root entry is open — a trail of one is not a trail —
// but the container still MOUNTS in that case, invisibly: the overflow math in
// useEipTabs measures its clientWidth before it is allowed to push a 2nd tab, and an
// unmounted strip measures zero and would reject every tab forever.
function EipTabStrip({ tabs, activeIndex, onSelect, isTabbedMode, stripRef }: EipTabStripProps) {
    const isVisible = isTabbedMode;
    return (
        <EipTabStripContainer
            ref={stripRef}
            className="eip-entry-tab-strip"
            sx={isVisible ? undefined : { padding: 0, minHeight: 0 }}
        >
            {isVisible && (
                <>
                    {/* Scrollable tab area fills the remaining space. */}
                    <Box
                        className="eip-entry-tab-list"
                        sx={{ display: "flex", alignItems: "center", gap: "7px", flex: 1, minWidth: 0, overflow: "hidden" }}
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
                </>
            )}
        </EipTabStripContainer>
    );
}

export default EipTabStrip;
