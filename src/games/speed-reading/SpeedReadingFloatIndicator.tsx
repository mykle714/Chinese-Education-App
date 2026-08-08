import React from "react";
import { Box } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { WRONG_PENALTY_MS, indicatorLifetime } from "./constants";

/** What just happened, which decides both the glyph and the colour. */
export type FloatKind = "correct" | "wrong";

/** Where the player tapped, plus what that tap did. */
export interface FloatIndicator {
    /** Tap point, in px relative to the play area's top-left. */
    x: number;
    y: number;
    kind: FloatKind;
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
 * The ✓ / ✗ that floats up from the exact point the player tapped, then fades —
 * and, when the action cost time, the red **+3s** underneath it.
 *
 * ── Why anchored to the tap and not to the button ───────────────────────────
 * The eye is already at the tap point at the instant of the tap. Feedback that
 * appears there is read without a saccade, which is what lets FEEDBACK_MS stay
 * short enough to keep the game fast.
 *
 * ── Why the penalty is shown HERE and not as a pause ────────────────────────
 * The 3s penalty is arithmetic on the final score, NOT a delay: the game never
 * stops for it, and `FEEDBACK_MS` is unchanged at 180ms. But a cost the player
 * cannot see is a cost they cannot learn from, so it is announced at the same
 * place and instant as the ✗ — one glance, no clock-watching.
 *
 * Purely decorative: `pointerEvents: "none"` so it can never swallow the next
 * round's tap, and `aria-hidden` because the round's colour feedback already
 * carries the meaning.
 *
 * Rendered by: src/games/speed-reading/SpeedReadingPage.tsx.
 * Documented in: docs/SPEED_READING_GAME.md.
 */
const SpeedReadingFloatIndicator: React.FC<SpeedReadingFloatIndicatorProps> = ({ indicator }) => {
    // A wrong answer is the only charged outcome — there is no Skip.
    const correct = indicator.kind === "correct";
    const lifetime = indicatorLifetime(indicator.kind);

    return (
        <Box
            className={`speed-reading__float speed-reading__float--${indicator.kind}`}
            aria-hidden
            sx={{
                position: "absolute",
                left: indicator.x,
                top: indicator.y,
                // Nothing under this element should lose a tap to it.
                pointerEvents: "none",
                zIndex: 5,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.25,
                fontFamily: FONTS.sans,
                fontWeight: WEIGHT.bold,
                lineHeight: 1,
                color: correct ? COLORS.greenMain : COLORS.redMain,
                // A dark halo keeps the glyph legible over the tinted option button.
                textShadow: "0 2px 6px rgba(0,0,0,0.28)",
                // translate(-50%, -50%) centres the glyph on the tap point; the
                // animation then layers the upward drift on top of that centring.
                animation: `speed-reading-float-up ${lifetime}ms ease-out forwards`,
                "@keyframes speed-reading-float-up": {
                    "0%": { opacity: 0, transform: "translate(-50%, -50%) scale(0.6)" },
                    // Quick pop-in — the indicator must be fully visible almost
                    // immediately, since the round advances after FEEDBACK_MS.
                    "22%": { opacity: 1, transform: "translate(-50%, -68%) scale(1.15)" },
                    "45%": { transform: "translate(-50%, -95%) scale(1)" },
                    "100%": { opacity: 0, transform: "translate(-50%, -190%) scale(0.95)" },
                },
            }}
        >
            <Box className="speed-reading__float-glyph" sx={{ fontSize: SIZE.heading }}>
                {correct ? "✓" : "✗"}
            </Box>
            {!correct && (
                <Box className="speed-reading__float-penalty" sx={{ fontSize: SIZE.body }}>
                    +{Math.round(WRONG_PENALTY_MS / 1000)}s
                </Box>
            )}
        </Box>
    );
};

export default SpeedReadingFloatIndicator;
