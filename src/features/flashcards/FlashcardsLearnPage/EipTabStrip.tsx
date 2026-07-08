import React from "react";
import { Box, IconButton } from "@mui/material";
import { Close } from "@mui/icons-material";
import { EipTabStripContainer, EipEntryTab } from "./styled";
import type { EipTab } from "./useEipTabs";

interface EipTabStripProps {
    tabs: EipTab[];
    activeIndex: number;
    onSelect: (index: number) => void;
    onCloseActiveTab: () => void;
    // Latched to true the moment a 2nd tab is first opened; stays true even if
    // tabs are closed back to 1 so the strip remains visible for the panel's life.
    isTabbedMode: boolean;
    stripRef: React.RefObject<HTMLDivElement | null>;
}

// Entry-tab strip rendered between the grabber and the entry header. Hidden
// entirely when only the root entry is open — overflow math in useEipTabs
// assumes the strip is mounted before pushing a 2nd tab, so we still mount
// an invisible container in that case to keep clientWidth measurable.
function EipTabStrip({ tabs, activeIndex, onSelect, onCloseActiveTab, isTabbedMode, stripRef }: EipTabStripProps) {
    const isVisible = isTabbedMode;
    return (
        <EipTabStripContainer
            ref={stripRef}
            className="eip-entry-tab-strip"
            sx={isVisible ? {} : { padding: 0, borderBottom: "none", minHeight: 0 }}
        >
            {isVisible && (
                <>
                    {/* Scrollable tab area fills the remaining space. */}
                    <Box
                        className="eip-entry-tab-list"
                        sx={{ display: "flex", gap: "4px", flex: 1, minWidth: 0, overflow: "hidden" }}
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

                    {/* X button closes the active tab. Positioned flush right, outside
                        the tab list so it's always reachable regardless of tab count. */}
                    <IconButton
                        className="eip-close-tab-btn"
                        size="small"
                        onClick={onCloseActiveTab}
                        aria-label="Close tab"
                        sx={{
                            alignSelf: "center",
                            flexShrink: 0,
                            padding: "4px",
                            marginLeft: "2px",
                            color: "inherit",
                            opacity: 0.55,
                            "&:hover": { opacity: 1 },
                        }}
                    >
                        <Close sx={{ fontSize: 16 }} />
                    </IconButton>
                </>
            )}
        </EipTabStripContainer>
    );
}

export default EipTabStrip;
