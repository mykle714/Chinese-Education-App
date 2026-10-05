import { Box } from "@mui/material";
import Icon from "../../components/Icon";
import { COLORS } from "../../theme/colors";

/** The eye's square tap target. Larger than its 19px glyph on purpose. */
const EYE_TAP_PX = 32;
/**
 * Gap from the strip's right edge to the eye's tap target. `GameHud` and `GameTimer`
 * both pad 15px; the glyph sits ~6.5px inside its 32px target, so 8px here lands the
 * visible glyph on that same 15px line.
 */
const EYE_EDGE_INSET_PX = 8;

interface TimerEyeToggleProps {
    /** Whether the clock it controls is currently visible. */
    shown: boolean;
    onToggle: () => void;
    /** BEM block prefix, e.g. "word-search__hud-timer-toggle". */
    className: string;
}

/**
 * TimerEyeToggle — the eye that shows/hides a game's clock (Word Search's HUD,
 * Writing Grid's `GameTimer`). Docs: docs/WORD_SEARCH_GAME.md §3,
 * docs/WRITING_PRACTICE_REWORK.md § 2.
 *
 * Absolutely positioned, so the parent strip must be `position: relative`; being out
 * of flow, the 32px target never makes the strip taller than its text. The owner hides
 * the clock with `visibility` (never unmounts it) so toggling mid-run doesn't reflow
 * the board under the player's finger.
 *
 *   shown  → pinned to the strip's right edge, leaving the clock dead-centre.
 *   hidden → the eye takes the centre the clock vacated.
 * The move is an instant jump — deliberately not animated.
 */
export default function TimerEyeToggle({ shown, onToggle, className }: TimerEyeToggleProps) {
    return (
        <Box
            className={`${className} ${className}--${shown ? "shown" : "hidden"}`}
            role="button"
            aria-pressed={shown}
            aria-label={shown ? "Hide timer" : "Show timer"}
            onClick={onToggle}
            sx={{
                position: "absolute",
                top: "50%",
                left: shown ? `calc(100% - ${EYE_EDGE_INSET_PX + EYE_TAP_PX}px)` : `calc(50% - ${EYE_TAP_PX / 2}px)`,
                transform: "translateY(-50%)",
                width: EYE_TAP_PX,
                height: EYE_TAP_PX,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
            }}
        >
            {/* The glyph states what a tap will DO, not the current state: slashed eye
                while the clock shows (tap to hide), open eye while it is hidden (tap to
                show). Full ink like every other strip fact — the strip sits on the hue's
                tint, where --ink2 reads washed out. */}
            <Icon name={shown ? "visibility_off" : "visibility"} size={19} color={COLORS.onSurface} />
        </Box>
    );
}
