import React from "react";
import { Button, useTheme } from "@mui/material";
import MinutePointsFireBadge from "../../minutePoints/MinutePointsFireBadge";
import { SIZE } from "../../theme/scale";
import { TONE_COLORS } from "../../utils/toneColors";

/** The three states of the pinyin display toggle, in cycle order. */
export type PinyinMode = "off" | "plain" | "color";

interface WordSearchHeaderControlsProps {
    /** Current pinyin display mode (off → plain → color, cycled by the button). */
    pinyinMode: PinyinMode;
    onCyclePinyin: () => void;
    showTimer: boolean;
    onToggleTimer: () => void;
    /** Whether the hint button is armed (enough meter units collected). */
    hintReady: boolean;
    /** Spend a hint (highlight the first cell of a random unfound word). */
    onHint: () => void;
}

// "pinyin", one tone color per letter, shown when the toggle is in color mode so
// the button previews what colored pinyin looks like.
const PINYIN_LETTER_TONES = [1, 2, 3, 4, 1, 2];

/**
 * Right-side header controls for Word Search: a THREE-STATE pinyin toggle
 * (off → plain → tone-colored, replacing the old separate pinyin + color
 * buttons), a timer-visibility toggle, and a hint button. Ends with the
 * minute-points fire badge.
 *
 * Word Search is a LEAF PAGE (see docs/LEAF_NODE_PAGES.md), so the header bar +
 * down-arrow back button come from LeafPage/LeafPageHeader; this component just
 * fills LeafPage's `rightContent` slot. See docs/WORD_SEARCH_GAME.md §3.
 */
const WordSearchHeaderControls: React.FC<WordSearchHeaderControlsProps> = ({
    pinyinMode,
    onCyclePinyin,
    showTimer,
    onToggleTimer,
    hintReady,
    onHint,
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

    // The 3-state pinyin button reads as active in both "on" states; the color
    // state additionally tints each letter of "pinyin" with a tone color.
    const pinyinActive = pinyinMode !== "off";
    const pinyinLabel =
        pinyinMode === "color"
            ? "pinyin".split("").map((ch, i) => (
                  <span key={i} style={{ color: TONE_COLORS[PINYIN_LETTER_TONES[i]] }}>
                      {ch}
                  </span>
              ))
            : "pinyin";

    return (
        <>
            {/* One button cycling off → plain → color; the color state previews
                tone-colored pinyin in its own label. */}
            <Button
                className={`pinyin-toggle-btn pinyin-toggle-btn--${pinyinMode}`}
                variant={pinyinActive ? "contained" : "text"}
                size="small"
                onClick={onCyclePinyin}
                sx={toggleSx(pinyinActive)}
            >
                {pinyinLabel}
            </Button>
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
            {/* Hint: greyed out (disabled) until the meter reaches HINT_COST. */}
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
            <MinutePointsFireBadge />
        </>
    );
};

export default WordSearchHeaderControls;
