import React from "react";
import { Box, Typography } from "@mui/material";
import { getToneColor } from "../utils/toneColors";

interface CharacterPinyinColorDisplayProps {
    character: string;
    pinyin: string;
    showPinyin?: boolean;
    useToneColor?: boolean;
    size?: "xs" | "sm" | "md";
    compact?: boolean;
    interactive?: boolean;
    selected?: boolean;
    onHoverStart?: () => void;
    onTapToggle?: () => void;
}

// Fixed column widths — sized to fit the longest common pinyin syllables (e.g. "zhuāng") at each size.
// Adjust these two constants to resize all cpcd instances across the app simultaneously.
const CPCD_XS_WIDTH = "28px";
const CPCD_SM_WIDTH = "32px";
const CPCD_MD_WIDTH = "50px";

const SIZE_STYLES = {
    xs: {
        characterFontSize: "18px",
        characterFontWeight: 400,
        characterFontFamily: '"Inter", "Noto Sans JP", sans-serif',
        pinyinFontSize: "9px",
        pinyinFontStyle: "normal" as const,
        columnWidth: CPCD_XS_WIDTH,
        columnMinHeight: "38px",
        verticalPadding: "2px",
    },
    sm: {
        characterFontSize: "26px",
        characterFontWeight: 400,
        characterFontFamily: '"Inter", "Noto Sans JP", sans-serif',
        pinyinFontSize: "13px",
        pinyinFontStyle: "normal" as const,
        columnWidth: CPCD_SM_WIDTH,
        columnMinHeight: "48px",
        verticalPadding: "4px",
    },
    md: {
        characterFontSize: "2.25rem",
        characterFontWeight: 400,
        characterFontFamily: '"Inter", "Noto Sans JP", sans-serif',
        pinyinFontSize: "1rem",
        pinyinFontStyle: "normal" as const,
        columnWidth: CPCD_MD_WIDTH,
        columnMinHeight: "auto",
        verticalPadding: "8px",
    },
};

// Compact overrides reduce font sizes slightly for use in dense info card contexts
const COMPACT_SIZE_OVERRIDES = {
    xs: { characterFontSize: "16px", pinyinFontSize: "8px" },
    sm: { characterFontSize: "22px", pinyinFontSize: "11px" },
    md: { characterFontSize: "1.875rem", pinyinFontSize: "0.875rem" },
};

const CharacterPinyinColorDisplay: React.FC<CharacterPinyinColorDisplayProps> = ({
    character,
    pinyin,
    showPinyin = true,
    useToneColor = true,
    size = "sm",
    compact = false,
    interactive = false,
    selected = false,
    onHoverStart,
    onTapToggle,
}) => {
    const styles = { ...SIZE_STYLES[size], ...(compact ? COMPACT_SIZE_OVERRIDES[size] : {}) };
    const color = useToneColor ? getToneColor(pinyin) : "inherit";

    return (
        <Box
            className="char-pinyin-display"
            onMouseEnter={interactive ? onHoverStart : undefined}
            onTouchEnd={
                interactive && onTapToggle
                    ? (event) => {
                        event.preventDefault();
                        onTapToggle();
                    }
                    : undefined
            }
            sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: styles.columnWidth,
                minHeight: styles.columnMinHeight,
                textAlign: "center",
                boxSizing: "border-box",
                paddingY: styles.verticalPadding,
                borderRadius: "6px",
                border: selected ? "1px solid" : "1px solid transparent",
                borderColor: selected ? "text.primary" : "transparent",
                backgroundColor: selected ? "rgba(119, 155, 231, 0.15)" : "transparent",
                cursor: interactive ? "pointer" : "default",
                transition: "border-color 0.15s ease, background-color 0.15s ease",
            }}
        >
            <Typography
                className="char-pinyin-display__character"
                sx={{
                    fontSize: styles.characterFontSize,
                    fontWeight: styles.characterFontWeight,
                    fontFamily: styles.characterFontFamily,
                    color: "text.primary",
                    lineHeight: 1.21,
                }}
            >
                {character}
            </Typography>
            {/* Always rendered so the box height stays constant; visibility hides it without collapsing layout */}
            <Typography
                className="char-pinyin-display__pinyin"
                sx={{
                    fontSize: styles.pinyinFontSize,
                    fontStyle: styles.pinyinFontStyle,
                    fontFamily: '"Noto Sans Display", sans-serif',
                    fontStretch: 'condensed',
                    color,
                    lineHeight: 1.21,
                    visibility: showPinyin ? "visible" : "hidden",
                }}
            >
                {pinyin}
            </Typography>
        </Box>
    );
};

export default CharacterPinyinColorDisplay;
