import React from "react";
import { Box, Badge, Button, IconButton, useTheme } from "@mui/material";
import UndoIcon from "@mui/icons-material/Undo";
import SettingsIcon from "@mui/icons-material/Settings";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import { Typography } from "@mui/material";
import PageHeader from "../../components/PageHeader";
import { FIRE_ACTIVE_COLOR } from "./constants";
import type { LastMarkUndoSnapshot } from "./types";
import { useMinutePoints } from "../../hooks/useMinutePoints";

interface FlashcardsLearnHeaderProps {
    selectedCategory: string | null;
    lastMarkUndoSnapshot: LastMarkUndoSnapshot | null;
    isAnimating: boolean;
    isUndoing: boolean;
    onBack: () => void;
    onUndo: () => void;
    minutePoints: ReturnType<typeof useMinutePoints>;
    showPinyin: boolean;
    onTogglePinyin: () => void;
    showSegmentSpaces: boolean;
    onToggleSegmentSpaces: () => void;
}

const FlashcardsLearnHeader: React.FC<FlashcardsLearnHeaderProps> = ({
    selectedCategory,
    lastMarkUndoSnapshot,
    isAnimating,
    isUndoing,
    onBack,
    onUndo,
    minutePoints,
    showPinyin,
    onTogglePinyin,
    showSegmentSpaces,
    onToggleSegmentSpaces,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    const rightItems = (
        <>
            <IconButton
                className="mobile-demo-tool-button"
                size="small"
                sx={{ color: fc.onSurface }}
                onClick={onUndo}
                disabled={!lastMarkUndoSnapshot || isAnimating || isUndoing}
            >
                <UndoIcon />
            </IconButton>
            {/* Pinyin visibility toggle */}
            <Button
                className="pinyin-toggle-btn"
                variant={showPinyin ? "contained" : "text"}
                size="small"
                onClick={onTogglePinyin}
                sx={{
                    minWidth: "unset",
                    px: 1,
                    py: 0.25,
                    height: "30px",
                    fontSize: "0.65rem",
                    textTransform: "lowercase",
                    lineHeight: 1.4,
                    borderRadius: "6px",
                    backgroundColor: showPinyin ? fc.toggleActiveBg : fc.toggleInactiveBg,
                    color: fc.onSurface,
                    "&:hover": {
                        backgroundColor: showPinyin ? fc.toggleActiveBg : fc.toggleInactiveBg,
                    },
                }}
            >
                pinyin
            </Button>
            {/* Segment spaces toggle */}
            <Button
                className="segment-spaces-toggle-btn"
                variant={showSegmentSpaces ? "contained" : "text"}
                size="small"
                onClick={onToggleSegmentSpaces}
                sx={{
                    minWidth: "unset",
                    px: 1,
                    py: 0.25,
                    height: "30px",
                    fontSize: "0.65rem",
                    textTransform: "lowercase",
                    lineHeight: 1.4,
                    borderRadius: "6px",
                    backgroundColor: showSegmentSpaces ? fc.toggleActiveBg : fc.toggleInactiveBg,
                    color: fc.onSurface,
                    "&:hover": {
                        backgroundColor: showSegmentSpaces ? fc.toggleActiveBg : fc.toggleInactiveBg,
                    },
                }}
            >
                spaces
            </Button>
            <IconButton className="mobile-demo-tool-button" size="small" sx={{ color: fc.onSurface }}>
                <SettingsIcon />
            </IconButton>
            {/* Work Points Fire Icon with Seconds Counter */}
            <Box className="mobile-demo-minute-points" sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
                <Badge
                    className="mobile-demo-minute-points-badge"
                    badgeContent={minutePoints.currentPoints}
                    color="primary"
                    max={99}
                    sx={{
                        "& .MuiBadge-badge": {
                            fontSize: "0.625rem",
                            fontWeight: "bold",
                            minWidth: "16px",
                            height: "16px",
                            padding: "0 4px",
                            backgroundColor: minutePoints.isActive ? FIRE_ACTIVE_COLOR : fc.textSecondary,
                            color: "white",
                            border: `1px solid ${fc.toggleInactiveBg}`,
                        },
                    }}
                >
                    <IconButton
                        className="mobile-demo-tool-button minute-points-fire-icon"
                        size="small"
                        sx={{ padding: "4px" }}
                    >
                        <LocalFireDepartmentIcon
                            className="mobile-demo-fire-icon"
                            sx={{
                                color: minutePoints.isActive ? FIRE_ACTIVE_COLOR : fc.textSecondary,
                                fontSize: "1.25rem",
                                filter: minutePoints.isActive ? "drop-shadow(0 0 4px rgba(230, 81, 0, 0.6))" : "none",
                                animation: minutePoints.isAnimating ? "pulse 0.6s ease-out" : "none",
                                "@keyframes pulse": {
                                    "0%, 100%": { transform: "scale(1)" },
                                    "50%": { transform: "scale(1.2)", filter: "drop-shadow(0 0 8px rgba(230, 81, 0, 0.8))" },
                                },
                            }}
                        />
                    </IconButton>
                </Badge>
                {/* Seconds counter — driven by hook's live 1s timer */}
                <Typography
                    className="mobile-demo-seconds-counter"
                    sx={{
                        fontSize: "0.625rem",
                        fontWeight: "bold",
                        color: minutePoints.isActive ? FIRE_ACTIVE_COLOR : fc.textSecondary,
                        lineHeight: 1,
                        marginTop: "-2px",
                    }}
                >
                    {minutePoints.liveSeconds}s
                </Typography>
            </Box>
        </>
    );

    return (
        <PageHeader
            title={selectedCategory ? `Learn: ${selectedCategory}` : "Learn"}
            onBack={onBack}
            rightContent={rightItems}
        />
    );
};

export default FlashcardsLearnHeader;
