import React, { useState } from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { FONTS } from "../../theme/fonts";
import { SIZE, WEIGHT } from "../../theme/scale";
import { ISO, prefersReducedMotion } from "./iso";

/**
 * WorldIndicator — the floating arrow in the Deck Tower's bottom-left or bottom-right
 * corner that says another world lies that way, with the world's name beside it on the
 * inner side ("‹ Reading", "Writing ›") (docs/DECK_TOWER.md § "Worlds"). It sits just
 * above the footer bar, out of the tower's way.
 *
 * Layer: page-private component (feature module `src/features/deckTower`). The swipe is
 * the main way across; the arrow is the hint, and a tap on it does the same (the desktop
 * path, and an accessible one).
 *
 * Drawn straight on the sky in white (`ISO.white`, the page title's ink), with no box:
 * the arrow and its name drift gently outward and back together ("floating" — the float
 * rides an inner wrapper, so the tap target itself stays put), still under reduced
 * motion. The two edges' indicators float IN STEP — both out, then both in — however far
 * apart they mounted (`floatPhaseDelay`). ⚠️
 * Being boxless, it is an exception to the app-wide outline rule for tappable things
 * (CLAUDE.md § Buttons & cards) — it reads as part of the scene, like the title.
 *
 * Depended on by: DeckTowerPage.tsx.
 */

/** How far (px) the arrow drifts outward at the top of its float. */
const FLOAT_PX = 4;
const FLOAT_MS = 2800;
/** Gap (px) between the indicator and the top of the footer bar. */
const FOOTER_GAP_PX = 12;

/**
 * A negative `animation-delay` that puts this mount's float on a shared page clock:
 * whenever an arrow mounts (a world change can mount one edge's arrow apart from the
 * other's), its cycle is at the same phase as every other arrow's — `performance.now()`
 * mod FLOAT_MS — so the pair always move together.
 */
const floatPhaseDelay = () => `-${Math.round(performance.now() % FLOAT_MS)}ms`;

const floatLeft = keyframes`
    0%, 100% { transform: translateX(0); }
    50% { transform: translateX(-${FLOAT_PX}px); }
`;
const floatRight = keyframes`
    0%, 100% { transform: translateX(0); }
    50% { transform: translateX(${FLOAT_PX}px); }
`;

interface WorldIndicatorProps {
    side: "left" | "right";
    /** The neighbouring world's name. */
    name: string;
    onTap: () => void;
    /** Hidden (a pan or deck swap is running). */
    hidden: boolean;
    /** CSS length the stage's bottom edge is held off the screen bottom by (the footer's
     *  height), as on SpaceBackdrop / SpeedLines; the indicator sits FOOTER_GAP_PX above it. */
    bottom: string;
    /** The arrow's and name's ink: `ISO.white` under the time-of-day wash (timeOfDay.ts). Default unwashed. */
    color?: string;
}

const WorldIndicator: React.FC<WorldIndicatorProps> = ({ side, name, onTap, hidden, bottom, color = ISO.white }) => {
    const isLeft = side === "left";
    const Arrow = isLeft ? ChevronLeftIcon : ChevronRightIcon;
    // Read once per mount: the delay only has to align the cycle's START.
    const [phaseDelay] = useState(floatPhaseDelay);
    const arrow = <Arrow className="deck-tower-page__world-indicator-arrow" sx={{ fontSize: 32 }} />;
    return (
        <ButtonBase
            className={`deck-tower-page__world-indicator deck-tower-page__world-indicator--${side}`}
            aria-label={`Go to the ${name} world`}
            onClick={onTap}
            disabled={hidden}
            disableRipple
            sx={{
                position: "absolute",
                zIndex: 2,
                bottom: `calc(${bottom} + ${FOOTER_GAP_PX}px)`,
                [side]: 2,
                // The arrow hugs the screen edge; the name sits on its inner side.
                [isLeft ? "pr" : "pl"]: "8px",
                py: "8px",
                color,
                opacity: hidden ? 0 : 1,
                transition: "opacity 160ms ease-out",
            }}
        >
            {/* Arrow + name float as one unit; the button around them stays still. */}
            <Box
                component="span"
                className="deck-tower-page__world-indicator-float"
                sx={{
                    display: "flex",
                    alignItems: "center",
                    animation: prefersReducedMotion() ? undefined : `${isLeft ? floatLeft : floatRight} ${FLOAT_MS}ms ease-in-out ${phaseDelay} infinite`,
                }}
            >
                {isLeft && arrow}
                <Box component="span" className="deck-tower-page__world-indicator-label">
                    <Typography
                        component="span"
                        sx={{
                            display: "block",
                            fontFamily: FONTS.cjk,
                            fontSize: SIZE.body,
                            fontWeight: WEIGHT.bold,
                            lineHeight: 1,
                        }}
                    >
                        {name}
                    </Typography>
                </Box>
                {!isLeft && arrow}
            </Box>
        </ButtonBase>
    );
};

export default WorldIndicator;
