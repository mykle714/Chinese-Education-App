import React from "react";
import { Box } from "@mui/material";
import { COLORS } from "../../theme/colors";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { CLEAR_BANNER_MS } from "./constants";

/**
 * "Board Cleared!" — the pop-and-fade banner shown when the last pair leaves the
 * board.
 *
 * Layer: presentational. It is **purely an indicator**: no score, no medal, no
 * mark, no phase change. Clearing the board is already its own reward (the board
 * refills either way), so this exists only to acknowledge a moment the game
 * otherwise passes over in silence.
 *
 * Decorative in the strict sense — `pointerEvents: "none"` so it can never
 * swallow a tap on a card fading in underneath it, and `aria-hidden` because it
 * carries no information a screen reader needs. It mirrored the same contract as
 * Speed Reading's float indicator (`SpeedReadingFloatIndicator.tsx`) — that
 * component has since been deleted, so this is now the only transient
 * tap-anchored feedback in the games.
 *
 * Takes NO props: the board gives it a `key` that changes on every clear, which
 * is what re-mounts it and replays the animation. A prop would be redundant —
 * the banner's text and timing are the same on every clear.
 *
 * Rendered by: src/games/match-speed/MatchSpeedBoard.tsx.
 * Documented in: docs/MATCH_SPEED_GAME.md § Board cleared celebration.
 */
const MatchSpeedClearBanner: React.FC = () => (
    <Box
        className="match-speed__clear-banner"
        aria-hidden
        sx={{
            // Centred over the whole grid, above the cards but out of their way.
            position: "absolute",
            left: "50%",
            top: "50%",
            pointerEvents: "none",
            zIndex: 5,
            whiteSpace: "nowrap",
            fontFamily: FONTS.sans,
            fontSize: SIZE.heading,
            fontWeight: WEIGHT.bold,
            lineHeight: 1,
            color: COLORS.greenMain,
            // A soft halo keeps the text legible over the cards fading in beneath
            // it on the next refill tick.
            textShadow: "0 2px 10px rgba(255,255,255,0.9), 0 2px 6px rgba(0,0,0,0.18)",
            // `forwards` parks it at opacity 0 rather than snapping back to
            // visible, so the element can stay mounted until the next clear
            // replaces it. translate(-50%, -50%) does the centring; the animation
            // layers the rise on top of it.
            animation: `match-speed-clear-pop ${CLEAR_BANNER_MS}ms ease-out forwards`,
            "@keyframes match-speed-clear-pop": {
                "0%": { opacity: 0, transform: "translate(-50%, -50%) scale(0.7)" },
                // Fast pop-in: the board can refill 3 seconds later, so the whole
                // gesture has to read well before then.
                "18%": { opacity: 1, transform: "translate(-50%, -54%) scale(1.12)" },
                "34%": { transform: "translate(-50%, -56%) scale(1)" },
                "70%": { opacity: 1, transform: "translate(-50%, -62%) scale(1)" },
                "100%": { opacity: 0, transform: "translate(-50%, -84%) scale(0.98)" },
            },
        }}
    >
        Board Cleared!
    </Box>
);

export default MatchSpeedClearBanner;
