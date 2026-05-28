import { Box, Typography, useTheme } from "@mui/material";
import CPCDRow from "../../components/CPCDRow";
import { stripParentheses } from "../../utils/definitionUtils";

export interface InfoCardListRowProps {
    character: string;
    pinyin: string;
    definition: string;
    size: "sm" | "md";
    showPinyin: boolean;
    showPinyinColor?: boolean;
    isLast: boolean;
    onClick?: () => void;
    className?: string;
}

/**
 * Shared row used by the breakdown tab for both the multi-char breakdown list
 * and the single-char "used in" list. Identical visuals; `size` controls the
 * CharacterPinyinColorDisplay sizing (sm for used-in, md for breakdown).
 */
function InfoCardListRow({
    character,
    pinyin,
    definition,
    size,
    showPinyin,
    showPinyinColor = true,
    isLast,
    onClick,
    className,
}: InfoCardListRowProps) {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const clickable = !!onClick;

    return (
        <Box
            component={clickable ? "button" : "div"}
            className={className}
            onClick={onClick}
            sx={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                padding: "10px 4px",
                background: "transparent",
                border: "none",
                borderBottom: !isLast ? `1px solid ${fc.border}` : "none",
                borderRadius: 0,
                width: "100%",
                textAlign: "left",
                font: "inherit",
                color: "inherit",
                cursor: clickable ? "pointer" : "default",
                transition: "background-color 0.12s ease-out",
                "&:hover": clickable ? { background: fc.subtleBg } : undefined,
                "&:active": clickable ? { background: fc.subtleBg } : undefined,
            }}
        >
            {/* Render one cpcd per character so multi-syllable pinyin (used-in rows
                like 朋友 → péng yǒu) gets per-syllable tone coloring. Single-char
                inputs (breakdown rows) produce a one-element CPCDRow. */}
            <CPCDRow
                size={size}
                flexWrap="nowrap"
                items={[...character].map((ch, i) => ({
                    character: ch,
                    pinyin: pinyin.split(" ")[i] ?? "",
                    useToneColor: showPinyinColor,
                    showPinyin,
                }))}
            />
            <Typography sx={{ fontSize: 14, color: fc.onSurface, flex: 1, fontFamily: '"Inter", sans-serif' }}>
                {stripParentheses(definition)}
            </Typography>
            {clickable && (
                <Typography sx={{ fontSize: 14, color: fc.textSecondary, flexShrink: 0 }}>›</Typography>
            )}
        </Box>
    );
}

export default InfoCardListRow;
