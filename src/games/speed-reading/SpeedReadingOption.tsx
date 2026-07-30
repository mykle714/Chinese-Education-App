import React from "react";
import { Box, ButtonBase } from "@mui/material";
import GlyphSvg from "../../components/handwriting/GlyphSvg";
import { COLORS } from "../../theme/colors";
import { MIN_OPTION_HEIGHT_PX, OPTION_CHAR_GAP_PX, OPTION_PADDING_X_PX } from "./constants";
import type { RoundOption } from "./types";

/** How the button is currently painted. */
export type OptionFeedback = "none" | "correct" | "wrong";

interface SpeedReadingOptionProps {
    option: RoundOption;
    feedback: OptionFeedback;
    disabled: boolean;
    /**
     * Receives the click event so the page can read the tap coordinates and
     * float its ✓/✗ indicator up from that exact point.
     */
    onPick: (event: React.MouseEvent<HTMLElement>) => void;
    /** Glyph size in px, derived by the page from the available width. */
    glyphSize: number;
}

/**
 * One tappable word option.
 *
 * ── Fixed height, always ─────────────────────────────────────────────────────
 * Both buttons are exactly the same height regardless of how many characters
 * they carry. A height difference between the two would leak the answer before
 * the player read anything.
 *
 * ── Side by side, so both are in view at once ───────────────────────────────
 * The page lays the two buttons out in a ROW with equal flex, so the pair reads
 * as a single comparison — which is what the game asks for, since they differ by
 * exactly one character. The cost is width: each button gets about half the row.
 *
 * That is why `glyphSize` is MEASURED by the page off the real row width rather
 * than tabulated by word length — at half width a fixed ladder would overflow a
 * 4-character word. The horizontal padding and inter-glyph gap below are the
 * fixed costs in that calculation and are kept in `constants.ts` so both sides
 * read the same numbers.
 */
const SpeedReadingOption: React.FC<SpeedReadingOptionProps> = ({
    option,
    feedback,
    disabled,
    onPick,
    glyphSize,
}) => {
    // Feedback colours: green for the correct word, red for a wrong pick. Both
    // are shown at once on a wrong answer — the round still teaches.
    const border =
        feedback === "correct" ? COLORS.greenMain
        : feedback === "wrong" ? COLORS.redMain
        : "rgba(0,0,0,0.10)";
    const bg =
        feedback === "correct" ? "rgba(5, 199, 147, 0.14)"
        : feedback === "wrong" ? "rgba(239, 71, 111, 0.14)"
        : COLORS.card;

    return (
        <ButtonBase
            className={`speed-reading__option speed-reading__option--${feedback}`}
            disabled={disabled}
            onClick={onPick}
            sx={{
                // Equal share of the row — never a content-driven width, which
                // would make the wider button the obvious "longer word".
                flex: 1,
                minWidth: 0,
                px: `${OPTION_PADDING_X_PX}px`,
                // Fixed height so the two buttons are always identical boxes. The
                // floor keeps a 4-character word's small glyphs from collapsing the
                // button below a comfortable tap target.
                height: Math.max(glyphSize + 28, MIN_OPTION_HEIGHT_PX),
                borderRadius: "18px",
                backgroundColor: bg,
                border: `2px solid ${border}`,
                // Transition INTO feedback only. On the way back to neutral the
                // change must be instant: a 140ms fade there means the previous
                // round's green/red is still draining out of the button while the
                // next word is already on screen, which reads as lag.
                transition: feedback === "none"
                    ? "none"
                    : "background-color 140ms ease, border-color 140ms ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: `${OPTION_CHAR_GAP_PX}px`,
                // Nothing here scrolls, and a drag must not become a scroll gesture.
                touchAction: "none",
            }}
        >
            <Box
                className="speed-reading__option-glyphs"
                sx={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: `${OPTION_CHAR_GAP_PX}px`,
                }}
            >
                {option.chars.map((ch, i) => (
                    <GlyphSvg
                        // Index-keyed on purpose: the two options of a round can
                        // repeat a character, and position is the identity here.
                        key={`${i}-${ch}`}
                        className="speed-reading__option-glyph"
                        character={ch}
                        size={glyphSize}
                        color={COLORS.onSurface}
                    />
                ))}
            </Box>
        </ButtonBase>
    );
};

export default SpeedReadingOption;
