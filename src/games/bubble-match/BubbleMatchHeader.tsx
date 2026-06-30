import React from "react";
import { Button, useTheme } from "@mui/material";
import MinutePointsFireBadge from "../../minutePoints/MinutePointsFireBadge";
import { SIZE } from "../../theme/scale";

interface BubbleMatchHeaderControlsProps {
    showPinyin: boolean;
    onTogglePinyin: () => void;
    autoplayChinese: boolean;
    onToggleAutoplayChinese: () => void;
}

/**
 * Right-side header controls for the Bubble Match game: two quick toggles (pinyin
 * + autoplay, mirroring FlashcardsLearnHeader) and the minute-points fire badge.
 *
 * Bubble Match is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md), so the header bar +
 * down-arrow back button come from LeafPage/LeafPageHeader; this component just
 * fills LeafPage's `rightContent` slot.
 */
const BubbleMatchHeaderControls: React.FC<BubbleMatchHeaderControlsProps> = ({
    showPinyin,
    onTogglePinyin,
    autoplayChinese,
    onToggleAutoplayChinese,
}) => {
    const theme = useTheme();
    const fc = theme.palette.flashcard;

    const toggleSx = (active: boolean) => ({
        minWidth: "unset",
        px: 1,
        py: 0.25,
        height: "30px",
        fontSize: SIZE.micro,
        textTransform: "lowercase" as const,
        lineHeight: 1.4,
        borderRadius: "6px",
        backgroundColor: active ? fc.toggleActiveBg : fc.toggleInactiveBg,
        color: fc.onSurface,
        "&:hover": { backgroundColor: active ? fc.toggleActiveBg : fc.toggleInactiveBg },
    });

    return (
        <>
            <Button
                className="pinyin-toggle-btn"
                variant={showPinyin ? "contained" : "text"}
                size="small"
                onClick={onTogglePinyin}
                sx={toggleSx(showPinyin)}
            >
                pinyin
            </Button>
            <Button
                className="autoplay-toggle-btn"
                variant={autoplayChinese ? "contained" : "text"}
                size="small"
                onClick={onToggleAutoplayChinese}
                sx={toggleSx(autoplayChinese)}
            >
                autoplay
            </Button>
            <MinutePointsFireBadge />
        </>
    );
};

export default BubbleMatchHeaderControls;
