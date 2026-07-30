import React from "react";
import { Box } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { FLOAT_INDICATOR_MS } from "./constants";

/** Where the player tapped, plus whether that tap was right. */
export interface FloatIndicator {
    /** Tap point, in px relative to the play area's top-left. */
    x: number;
    y: number;
    correct: boolean;
    /**
     * Bumped on every pick. Used as the React key so a fresh element mounts each
     * time — without it, React would reuse the node and the CSS animation would
     * not restart on a second tap at the same spot.
     */
    id: number;
}

interface SpeedReadingFloatIndicatorProps {
    indicator: FloatIndicator;
}

/**
 * The ✓ / ✗ that floats up from the exact point the player tapped, then fades.
 *
 * ── Why anchored to the tap and not to the button ───────────────────────────
 * The eye is already at the tap point at the instant of the tap. Feedback that
 * appears there is read without a saccade, which is what lets FEEDBACK_MS stay
 * short enough to keep the game fast.
 *
 * Purely decorative: `pointerEvents: "none"` so it can never swallow the next
 * round's tap, and `aria-hidden` because the round's colour feedback already
 * carries the meaning.
 *
 * Rendered by: src/games/speed-reading/SpeedReadingPage.tsx.
 * Documented in: docs/SPEED_READING_GAME.md.
 */
const SpeedReadingFloatIndicator: React.FC<SpeedReadingFloatIndicatorProps> = ({ indicator }) => (
    <Box
        className={`speed-reading__float speed-reading__float--${indicator.correct ? "correct" : "wrong"}`}
        aria-hidden
        sx={{
            position: "absolute",
            left: indicator.x,
            top: indicator.y,
            // Nothing under this element should lose a tap to it.
            pointerEvents: "none",
            zIndex: 5,
            fontFamily: FONTS.sans,
            fontSize: SIZE.heading,
            fontWeight: WEIGHT.bold,
            lineHeight: 1,
            color: indicator.correct ? COLORS.greenMain : COLORS.redMain,
            // A dark halo keeps the glyph legible over the tinted option button.
            textShadow: "0 2px 6px rgba(0,0,0,0.28)",
            // translate(-50%, -50%) centres the glyph on the tap point; the
            // animation then layers the upward drift on top of that centring.
            animation: `speed-reading-float-up ${FLOAT_INDICATOR_MS}ms ease-out forwards`,
            "@keyframes speed-reading-float-up": {
                "0%": { opacity: 0, transform: "translate(-50%, -50%) scale(0.6)" },
                // Quick pop-in — the indicator must be fully visible almost
                // immediately, since the whole round lasts only FEEDBACK_MS.
                "22%": { opacity: 1, transform: "translate(-50%, -68%) scale(1.15)" },
                "45%": { transform: "translate(-50%, -95%) scale(1)" },
                "100%": { opacity: 0, transform: "translate(-50%, -190%) scale(0.95)" },
            },
        }}
    >
        {indicator.correct ? "✓" : "✗"}
    </Box>
);

export default SpeedReadingFloatIndicator;
