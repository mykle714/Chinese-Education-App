import React from "react";
import { Button, useTheme } from "@mui/material";
import MinutePointsFireBadge from "../../minutePoints/MinutePointsFireBadge";
import { SIZE } from "../../theme/scale";

interface WordSearchHeaderControlsProps {
    showPinyin: boolean;
    onTogglePinyin: () => void;
    /** Whether pinyin renders in tone colors vs. the default theme color. Only
     *  meaningful (and only shown) while pinyin is on. */
    showPinyinColor: boolean;
    onTogglePinyinColor: () => void;
    showTimer: boolean;
    onToggleTimer: () => void;
}

/**
 * Right-side header controls for Word Search: a pinyin on/off toggle (mirrors the
 * Bubble Match control) and the minute-points fire badge.
 *
 * Word Search is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md), so the header bar +
 * down-arrow back button come from LeafPage/LeafPageHeader; this component just
 * fills LeafPage's `rightContent` slot. Unlike Bubble Match there is no autoplay
 * toggle — audio only fires on a correct find / discovery.
 */
const WordSearchHeaderControls: React.FC<WordSearchHeaderControlsProps> = ({
    showPinyin,
    onTogglePinyin,
    showPinyinColor,
    onTogglePinyinColor,
    showTimer,
    onToggleTimer,
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
            {/* Only meaningful while pinyin is shown: toggles tone colors vs. the
                default theme color for the pinyin overlay. */}
            {showPinyin && (
                <Button
                    className="pinyin-color-toggle-btn"
                    variant={showPinyinColor ? "contained" : "text"}
                    size="small"
                    onClick={onTogglePinyinColor}
                    sx={toggleSx(showPinyinColor)}
                >
                    color
                </Button>
            )}
            {/* Toggles only the timer's VISIBILITY — the clock keeps ticking so the
                finish time / medal is still accurate when it's hidden. */}
            <Button
                className="timer-toggle-btn"
                variant={showTimer ? "contained" : "text"}
                size="small"
                onClick={onToggleTimer}
                sx={toggleSx(showTimer)}
            >
                timer
            </Button>
            <MinutePointsFireBadge />
        </>
    );
};

export default WordSearchHeaderControls;
