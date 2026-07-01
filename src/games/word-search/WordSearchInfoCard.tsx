import React, { useEffect } from "react";
import { Box, Typography } from "@mui/material";
import ForeignText from "../../components/ForeignText";
import { SIZE, WEIGHT, LEADING } from "../../theme/scale";
import { stripParentheses } from "../../utils/definitionUtils";
import { INFO_CARD_DURATION_MS } from "./constants";

export interface InfoCardData {
    word: string;
    pronunciation?: string | null;
    definition?: string | null;
    /** True when this was one of the 20 targets (vs. a bonus discovery). */
    isTarget: boolean;
}

interface WordSearchInfoCardProps {
    data: InfoCardData;
    showPinyin: boolean;
    showPinyinColor: boolean;
    onDismiss: () => void;
}

/**
 * The little animated dictionary card thrown up when the player selects a valid
 * multi-character word (a found target or a bonus discovery). Shows the word as
 * cpcd + a short gloss, pops in, and auto-dismisses. Audio is played by the
 * caller (WordSearchGrid) alongside mounting this. See docs/WORD_SEARCH_GAME.md §4.
 */
const WordSearchInfoCard: React.FC<WordSearchInfoCardProps> = ({
    data,
    showPinyin,
    showPinyinColor,
    onDismiss,
}) => {
    // Auto-dismiss after a beat; tapping the card dismisses immediately.
    useEffect(() => {
        const t = setTimeout(onDismiss, INFO_CARD_DURATION_MS);
        return () => clearTimeout(t);
    }, [onDismiss, data]);

    const gloss = stripParentheses(data.definition || "").trim();

    return (
        <Box
            className="word-search__info-card"
            onClick={onDismiss}
            sx={{
                position: "absolute",
                top: 12,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 30,
                minWidth: 180,
                maxWidth: "88%",
                px: 2,
                py: 1.25,
                borderRadius: "16px",
                backgroundColor: "rgba(255,255,255,0.97)",
                boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
                border: data.isTarget ? "2px solid #4CAF50" : "1px solid rgba(0,0,0,0.08)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.5,
                pointerEvents: "auto",
                animation: "wordSearchInfoPop 220ms ease-out",
                "@keyframes wordSearchInfoPop": {
                    "0%": { opacity: 0, transform: "translateX(-50%) translateY(-8px) scale(0.9)" },
                    "100%": { opacity: 1, transform: "translateX(-50%) translateY(0) scale(1)" },
                },
            }}
        >
            {data.isTarget && (
                <Typography
                    className="word-search__info-card-badge"
                    sx={{ fontSize: SIZE.micro, fontWeight: WEIGHT.bold, color: "#4CAF50", letterSpacing: 0.5 }}
                >
                    ✓ FOUND
                </Typography>
            )}
            <ForeignText
                size="sm"
                justifyContent="center"
                text={data.word}
                pronunciation={data.pronunciation}
                showPinyin={showPinyin}
                useToneColor={showPinyinColor}
                pinyinShift
            />
            {gloss && (
                <Typography
                    className="word-search__info-card-gloss"
                    sx={{ fontSize: SIZE.body, color: "#555", textAlign: "center", lineHeight: LEADING.normal }}
                >
                    {gloss}
                </Typography>
            )}
        </Box>
    );
};

export default WordSearchInfoCard;
