import React from "react";
import { Box, IconButton } from "@mui/material";
import Icon from "../../../components/Icon";
import { COLORS } from "../../../theme/colors";
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

// The WORD TRAIL (`.wtrail`, artboards 20/24/25): the words opened in this panel, as
// filled pills, with a close on the right. Rendered between the grabber and the entry
// header.
//
// Hidden entirely when only the root entry is open — a trail of one is not a trail —
// but the container still MOUNTS in that case, invisibly: the overflow math in
// useEipTabs measures its clientWidth before it is allowed to push a 2nd tab, and an
// unmounted strip measures zero and would reject every tab forever.
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

                    {/* Closes the ACTIVE word, dropping it out of the trail. Flush right,
                        outside the pill list so it stays reachable however many words are
                        open — and never inside a pill, where it would turn every word in
                        the trail into two targets a thumb-width apart. */}
                    <IconButton
                        className="eip-close-tab-btn"
                        size="small"
                        onClick={onCloseActiveTab}
                        aria-label="Close tab"
                        sx={{
                            alignSelf: "center",
                            flexShrink: 0,
                            padding: "4px",
                            marginLeft: "auto",
                            "&:hover": { opacity: 0.75 },
                        }}
                    >
                        <Icon name="close" size={17} color={COLORS.textFaint} />
                    </IconButton>
                </>
            )}
        </EipTabStripContainer>
    );
}

export default EipTabStrip;
