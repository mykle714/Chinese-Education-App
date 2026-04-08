import React from "react";
import { Box, Badge, Button, IconButton } from "@mui/material";
import UndoIcon from "@mui/icons-material/Undo";
import SettingsIcon from "@mui/icons-material/Settings";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import { Typography } from "@mui/material";
import PageHeader from "../../components/PageHeader";
import { COLORS } from "./constants";
import type { LastMarkUndoSnapshot } from "./types";
import { useWorkPoints } from "../../hooks/useWorkPoints";

interface FlashcardsLearnHeaderProps {
    selectedCategory: string | null;
    lastMarkUndoSnapshot: LastMarkUndoSnapshot | null;
    isAnimating: boolean;
    isUndoing: boolean;
    onBack: () => void;
    onUndo: () => void;
    workPoints: ReturnType<typeof useWorkPoints>;
    showPinyin: boolean;
    onTogglePinyin: () => void;
}

const FlashcardsLearnHeader: React.FC<FlashcardsLearnHeaderProps> = ({
    selectedCategory,
    lastMarkUndoSnapshot,
    isAnimating,
    isUndoing,
    onBack,
    onUndo,
    workPoints,
    showPinyin,
    onTogglePinyin,
}) => {
    const rightItems = (
        <>
            <IconButton
                className="mobile-demo-tool-button"
                size="small"
                sx={{ color: COLORS.onSurface }}
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
                    backgroundColor: showPinyin ? COLORS.gray : COLORS.header,
                    color: showPinyin ? "#fff" : COLORS.onSurface,
                    "&:hover": {
                        backgroundColor: showPinyin ? COLORS.gray : COLORS.header,
                    },
                }}
            >
                pinyin
            </Button>
            <IconButton className="mobile-demo-tool-button" size="small" sx={{ color: COLORS.onSurface }}>
                <SettingsIcon />
            </IconButton>
            {/* Work Points Fire Icon with Seconds Counter */}
            <Box className="mobile-demo-work-points" sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
                <Badge
                    className="mobile-demo-work-points-badge"
                    badgeContent={workPoints.currentPoints}
                    color="primary"
                    max={99}
                    sx={{
                        "& .MuiBadge-badge": {
                            fontSize: "0.625rem",
                            fontWeight: "bold",
                            minWidth: "16px",
                            height: "16px",
                            padding: "0 4px",
                            backgroundColor: workPoints.isActive ? COLORS.fireActive : COLORS.gray,
                            color: "white",
                            border: `1px solid ${COLORS.header}`,
                        },
                    }}
                >
                    <IconButton
                        className="mobile-demo-tool-button work-points-fire-icon"
                        size="small"
                        sx={{ padding: "4px" }}
                    >
                        <LocalFireDepartmentIcon
                            className="mobile-demo-fire-icon"
                            sx={{
                                color: workPoints.isActive ? COLORS.fireActive : COLORS.gray,
                                fontSize: "1.25rem",
                                filter: workPoints.isActive ? "drop-shadow(0 0 4px rgba(230, 81, 0, 0.6))" : "none",
                                animation: workPoints.isAnimating ? "pulse 0.6s ease-out" : "none",
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
                        color: workPoints.isActive ? COLORS.fireActive : COLORS.gray,
                        lineHeight: 1,
                        marginTop: "-2px",
                    }}
                >
                    {workPoints.liveSeconds}s
                </Typography>
            </Box>
        </>
    );

    return (
        <PageHeader
            title={selectedCategory ? `Learn: ${selectedCategory}` : "Learn"}
            onBack={onBack}
            rightItems={rightItems}
        />
    );
};

export default FlashcardsLearnHeader;
