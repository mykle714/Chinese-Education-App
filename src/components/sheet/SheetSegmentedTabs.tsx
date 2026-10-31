import { Box, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { useDrag } from "@use-gesture/react";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { WEIGHT } from "../../theme/scale";
import { SHADOW } from "../../theme/shadows";
import { TAB_SWIPE_TRANSITION } from "./sheetStyled";

/**
 * SheetSegmentedTabs — a sheet's tab selector, as the Tower Tier 2 design draws the eip's
 * `.tabs`: a SUNKEN SEGMENTED TRACK (a well with a 2px inner top lip) in which ONE raised
 * chip SLIDES to the selected segment. Moved here from the flp's styled.ts when the account
 * panel took the same control.
 *
 * Replaced the shelf system's underlined `.tabs2` (2026-10-29). In the eip the word trail
 * above is bare breadcrumb text, so this is the panel's one filled control.
 *
 * Layer: shared presentational. Depended on by: InfoCardPanelBody, AccountSheet.
 * Docs: docs/EIP_SHEET_GESTURES.md § Telescope, § Page-style sheet header.
 */

export interface SheetSegmentedTabsColors {
    track: string;
    trackShadow: string;
    chip: string;
    ink: string;
    muted: string;
}

// For a sheet on the paper ground. The eip overrides these with its time-of-day palette.
const DEFAULT_COLORS: SheetSegmentedTabsColors = {
    track: COLORS.grey,
    trackShadow: COLORS.rowBorder,
    chip: COLORS.white,
    ink: COLORS.onSurface,
    muted: COLORS.textSecondary,
};

// The track's inner padding and the gap between segments — shared by the track and the
// sliding chip, whose width and travel are computed from them.
const TRACK_PAD = 3;
const SEGMENT_GAP = 2;
// Space between the selector and the content below it.
const TRACK_BOTTOM_GAP = 8;

const Track = styled(Box, {
    shouldForwardProp: (prop) => prop !== "trackColor" && prop !== "trackShadow",
})<{ trackColor: string; trackShadow: string }>(({ trackColor, trackShadow }) => ({
    // Positioning context for the sliding chip.
    position: "relative",
    display: "flex",
    gap: SEGMENT_GAP,
    padding: TRACK_PAD,
    // The bottom margin is fixed space under the selector for every host. Panes pad their
    // own tops too, but that padding scrolls away and lets content run up to the track.
    margin: `0 18px ${TRACK_BOTTOM_GAP}px`,
    borderRadius: 12,
    background: trackColor,
    boxShadow: `inset 0 2px 0 ${trackShadow}`,
    flexShrink: 0,
}));

// The selected-tab chip (design `.tabs b.on`): ONE element that slides rather than a fill
// that jumps from tab to tab. Absolutely positioned, one segment wide, moved by
// translateX(index × (segment + gap)); `100%` in a translate is the chip's OWN width, i.e.
// one segment. Rides TAB_SWIPE_TRANSITION so the chip and the pane below arrive together.
const Chip = styled(Box, {
    shouldForwardProp: (prop) => prop !== "index" && prop !== "count" && prop !== "chipColor",
})<{ index: number; count: number; chipColor: string }>(({ index, count, chipColor }) => ({
    position: "absolute",
    top: TRACK_PAD,
    bottom: TRACK_PAD,
    left: TRACK_PAD,
    width: `calc((100% - ${2 * TRACK_PAD}px - ${(count - 1) * SEGMENT_GAP}px) / ${count})`,
    borderRadius: 9,
    background: chipColor,
    // Design `0 1px 2px rgba(23,22,26,.12)` → SHADOW.rest (same geometry, 0.05 alpha).
    boxShadow: SHADOW.rest,
    transform: `translateX(calc(${index} * (100% + ${SEGMENT_GAP}px)))`,
    transition: TAB_SWIPE_TRANSITION,
    pointerEvents: "none",
    "@media (prefers-reduced-motion: reduce)": { transition: "none" },
}));

// One tab — a transparent segment over the track. No outline ring (CLAUDE.md § Buttons &
// cards): these are segments of one control, and the chip is already set off by its fill.
//
// An EMPTY tab stays legible but dimmed: it is still a real destination that says "nothing
// here", which is an answer.
const Segment = styled(Box, {
    shouldForwardProp: (prop) => prop !== "isActive" && prop !== "isEmpty",
})<{ isActive: boolean; isEmpty?: boolean }>(({ isActive, isEmpty }) => ({
    // Above the sliding chip.
    position: "relative",
    zIndex: 1,
    flex: 1,
    textAlign: "center",
    padding: "7px 2px",
    borderRadius: 9,
    border: "none",
    cursor: "pointer",
    fontFamily: FONTS.sans,
    userSelect: "none",
    opacity: isEmpty && !isActive ? 0.4 : 1,
    background: "transparent",
    transition: "opacity 0.2s ease",
}));

interface SheetSegmentedTabsProps {
    tabs: readonly { label: string; isEmpty?: boolean; className?: string }[];
    selected: number;
    onSelect: (index: number) => void;
    colors?: SheetSegmentedTabsColors;
    className?: string;
    /** Makes the strip a sheet resize handle; filterTaps keeps the segments tappable. */
    dragBind?: ReturnType<typeof useDrag>;
}

function SheetSegmentedTabs({ tabs, selected, onSelect, colors = DEFAULT_COLORS, className, dragBind }: SheetSegmentedTabsProps) {
    return (
        <Track
            className={className}
            role="tablist"
            trackColor={colors.track}
            trackShadow={colors.trackShadow}
            {...(dragBind ? dragBind() : {})}
            sx={dragBind ? { touchAction: "none", cursor: "grab" } : undefined}
        >
            <Chip className="sheet-segmented-tabs__chip" index={selected} count={tabs.length} chipColor={colors.chip} />
            {tabs.map((tab, index) => (
                <Segment
                    key={index}
                    role="tab"
                    aria-selected={selected === index}
                    isActive={selected === index}
                    isEmpty={tab.isEmpty}
                    onClick={() => onSelect(index)}
                    className={tab.className}
                >
                    {/* Design `.tabs b`: 14px semibold, ink when selected. */}
                    <Typography
                        className="sheet-segmented-tabs__label"
                        sx={{
                            fontSize: 14,
                            fontWeight: WEIGHT.semibold,
                            color: selected === index ? colors.ink : colors.muted,
                            fontFamily: FONTS.sans,
                            userSelect: "none",
                            lineHeight: 1,
                        }}
                    >
                        {tab.label}
                    </Typography>
                </Segment>
            ))}
        </Track>
    );
}

export default SheetSegmentedTabs;
