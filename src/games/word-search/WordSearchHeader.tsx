import React from "react";
import { Button, IconButton, useTheme } from "@mui/material";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SettingsIcon from "@mui/icons-material/Settings";
import MinutePointsFireBadge from "../../minutePoints/MinutePointsFireBadge";
import { SIZE } from "../../theme/scale";

interface WordSearchHeaderControlsProps {
    /** Whether the hint button is armed (enough meter units collected, and at
     *  least one word is still unfound). */
    hintReady: boolean;
    /** Spend a hint (reveal the next pinyin unit of the least-hinted unfound word). */
    onHint: () => void;
    /** Discard the current board and load a fresh one. */
    onRestart: () => void;
    /** Open the settings sheet (pinyin display + timer visibility). */
    onSettingsClick: () => void;
}

/**
 * Right-side header controls for Word Search: a restart button, a hint
 * button, and the settings cog. Pinyin display and timer visibility used to
 * live here as toggle buttons — they now live in the settings sheet (see
 * WordSearchSettingsDialog), mirroring flp's "quick controls in the header,
 * everything else behind the cog" split. Ends with the minute-points fire
 * badge.
 *
 * Word Search is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md), so the header bar +
 * down-arrow back button come from LeafPage/LeafPageHeader; this component just
 * fills LeafPage's `rightContent` slot. See docs/WORD_SEARCH_GAME.md §3.
 */
const WordSearchHeaderControls: React.FC<WordSearchHeaderControlsProps> = ({
    hintReady,
    onHint,
    onRestart,
    onSettingsClick,
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
            <IconButton
                className="word-search__restart-btn"
                size="small"
                sx={{ color: fc.onSurface }}
                onClick={onRestart}
                aria-label="Restart board"
            >
                <RestartAltIcon />
            </IconButton>
            {/* Hint: greyed out (disabled) until the meter reaches HINT_COST and
                at least one word is still unfound. Reveals one pinyin unit at
                a time — see WordSearchHintRow / pinyinUnits.ts. */}
            <Button
                className="word-search__hint-btn"
                variant="contained"
                size="small"
                disabled={!hintReady}
                onClick={onHint}
                sx={{
                    ...toggleSx(hintReady),
                    backgroundColor: hintReady ? "#FFB74D" : fc.toggleInactiveBg,
                    "&:hover": { backgroundColor: hintReady ? "#FFA726" : fc.toggleInactiveBg },
                    "&.Mui-disabled": { color: fc.onSurface, opacity: 0.4 },
                }}
            >
                hint
            </Button>
            <IconButton
                className="word-search__settings-btn"
                size="small"
                sx={{ color: fc.onSurface }}
                onClick={onSettingsClick}
                aria-label="Open settings"
            >
                <SettingsIcon />
            </IconButton>
            <MinutePointsFireBadge />
        </>
    );
};

export default WordSearchHeaderControls;
