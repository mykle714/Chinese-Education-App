import React from "react";
import { Box, Typography } from "@mui/material";
import { getToneColor } from "../utils/toneColors";

interface CharacterPinyinColorDisplayProps {
    character: string;
    pinyin: string;
    showPinyin?: boolean;
    useToneColor?: boolean;
    size?: "sm" | "md";
}

const SIZE_STYLES = {
    sm: {
        characterFontSize: "26px",
        characterFontWeight: 400,
        characterFontFamily: '"Inter", "Noto Sans JP", sans-serif',
        pinyinFontSize: "13px",
        pinyinFontStyle: "normal" as const,
        columnWidth: "auto",
        columnMinHeight: "48px",
    },
    md: {
        characterFontSize: "2.25rem",
        characterFontWeight: 700,
        characterFontFamily: '"Noto Serif SC", "Inter", sans-serif',
        pinyinFontSize: "1rem",
        pinyinFontStyle: "italic" as const,
        columnWidth: "auto",
        columnMinHeight: "auto",
    },
};

const CharacterPinyinColorDisplay: React.FC<CharacterPinyinColorDisplayProps> = ({
    character,
    pinyin,
    showPinyin = true,
    useToneColor = true,
    size = "sm",
}) => {
    const styles = SIZE_STYLES[size];
    const color = useToneColor ? getToneColor(pinyin) : "inherit";

    return (
        <Box
            className="char-pinyin-display"
            sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: styles.columnWidth,
                minHeight: styles.columnMinHeight,
                textAlign: "center",
            }}
        >
            <Typography
                className="char-pinyin-display__character"
                sx={{
                    fontSize: styles.characterFontSize,
                    fontWeight: styles.characterFontWeight,
                    fontFamily: styles.characterFontFamily,
                    color,
                    lineHeight: 1.21,
                }}
            >
                {character}
            </Typography>
            {showPinyin && (
                <Typography
                    className="char-pinyin-display__pinyin"
                    sx={{
                        fontSize: styles.pinyinFontSize,
                        fontStyle: styles.pinyinFontStyle,
                        fontFamily: '"Inter", sans-serif',
                        color,
                        lineHeight: 1.21,
                    }}
                >
                    {pinyin}
                </Typography>
            )}
        </Box>
    );
};

export default CharacterPinyinColorDisplay;
