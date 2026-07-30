import { Box, Typography, useTheme } from "@mui/material";
import ForeignText from "../../../components/ForeignText";
import { stripParentheses } from "../../../utils/definitionUtils";
import { FC_FONT } from "../constants";
import { SIZE } from "../../../theme/scale";

export interface InfoCardBlockButtonProps {
    character: string;
    pinyin: string;
    definition: string;
    showPinyin: boolean;
    showPinyinColor?: boolean;
    onClick?: () => void;
    className?: string;
}

/**
 * A single square block-button used by the breakdown tab's multi-char breakdown
 * list (one button per component character). Each button stacks a CPCDBlock (the
 * character laid out via ForeignText layout="block") over its English gloss, all
 * inside one clickable element. Buttons sit side-by-side in a wrapping row (see
 * the breakdown-list containers in InfoCardPanelBody / VocabCardDetailBody).
 * (The single-char "used in" list uses the full-width InfoCardListRow instead.)
 */
function InfoCardBlockButton({
    character,
    pinyin,
    definition,
    showPinyin,
    showPinyinColor = true,
    onClick,
    className,
}: InfoCardBlockButtonProps) {
    const theme = useTheme();
    const fc = theme.palette.flashcard;
    const clickable = !!onClick;

    // The button fills its grid cell and derives its height from aspect-ratio 1/1.
    // Uniform sizing comes from the container's equal-width grid tracks (see the
    // breakdown-grid in InfoCardPanelBody / VocabCardDetailBody), NOT from a fixed
    // side here — that way every button is identical, including a partly-filled
    // last row. Content is centered and clipped if it can't fit.

    return (
        <Box
            component={clickable ? "button" : "div"}
            className={className}
            onClick={onClick}
            sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                width: "100%",
                minWidth: 0,
                aspectRatio: "1 / 1",
                overflow: "hidden",
                padding: "8px",
                background: "transparent",
                border: `1px solid ${fc.border}`,
                borderRadius: "12px",
                font: "inherit",
                color: "inherit",
                cursor: clickable ? "pointer" : "default",
                transition: "background-color 0.12s ease-out",
                "&:hover": clickable ? { background: fc.subtleBg } : undefined,
                "&:active": clickable ? { background: fc.subtleBg } : undefined,
            }}
        >
            {/* Block layout so a multi-glyph character rendering stays compact;
                single breakdown characters fall through to the row layout. */}
            <ForeignText
                size="md"
                text={character}
                pronunciation={pinyin}
                useToneColor={showPinyinColor}
                showPinyin={showPinyin}
                layout="block"
            />
            <Typography
                sx={{
                    fontSize: SIZE.caption,
                    color: fc.onSurface,
                    fontFamily: FC_FONT,
                    lineHeight: 1.3,
                    textAlign: "center",
                }}
            >
                {stripParentheses(definition)}
            </Typography>
        </Box>
    );
}

export default InfoCardBlockButton;
