import React, { useState } from "react";
import { Box } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { FONTS } from "../../../theme/fonts";
import { SIZE, WEIGHT } from "../../../theme/scale";
import { prefersReducedMotion } from "../iso";
import { FLOAT_MS, floatPhaseDelay } from "../skyCueFloat";

/**
 * HomeEnterHint — "Swipe down to enter" painted on the home screen's sky over one down chevron
 * (docs/HOME_SCREEN.md § "The enter hint").
 *
 * WHERE. In the middle of the screen, on the line where td paints "Tap to Start": HomeStage
 * anchors the words' baseline to `tapHintBaselineY` (tapToStartGeometry.ts) in the shared scene
 * frame, so the hint the learner reads on the home and the one they read on the tower stand
 * at the same height. This component only lays the words out around that anchor: the
 * anchor box's top edge is the baseline, the words sit on it, the chevron hangs under it
 * (where Tap to Start's arrow shaft would be).
 *
 * LOOK. A white sky cue in td's sky-cue family (WorldIndicator's world labels): `FONTS.cjk`,
 * bold, white under the hour's wash (`paint`), the MUI chevron turned down (`ExpandMore`),
 * and the shared sky-cue float (skyCueFloat) — drifting DOWN, the way the swipe goes. One size
 * up from the world labels (`SIZE.title`, 22 px, chevron scaled with it) so it reads as the
 * screen's call to action.
 *
 * It is a <button>, so a tap (or the keyboard) also enters; the swipe (HomeStage →
 * `useEnterSwipe`) is what it advertises.
 *
 * Layer: feature page view (src/features/deckTower/home). Rendered by HomeStage.
 * Depends on: theme/fonts, theme/scale, skyCueFloat.ts. Docs: docs/HOME_SCREEN.md § "The enter hint".
 */

/** The words' size: `SIZE.title` (22 px) — kept as a number too, for the baseline offset. */
const WORDS_PX = 22;
/** The chevron, px — WorldIndicator's 32 px scaled with the words (16 → 22). */
const CHEVRON_PX = 44;
/** How far (px) the cue drifts down at the top of its float — WorldIndicator's `FLOAT_PX`. */
const FLOAT_PX = 4;
/**
 * How far the words' box top sits above their baseline, as a fraction of the font size
 * (≈ the face's ascent at `lineHeight: 1`). Puts the baseline on the anchor line.
 */
const ASCENT_EM = 0.8;

const floatDown = keyframes`
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(${FLOAT_PX}px); }
`;

interface HomeEnterHintProps {
    /** White under the hour's wash. */
    paint: string;
    /** Dead (the Enter shift has started). */
    disabled: boolean;
    /** Starts the Enter shift (the tap; the swipe is HomeStage's). */
    onTap: () => void;
}

const HomeEnterHint: React.FC<HomeEnterHintProps> = ({ paint, disabled, onTap }) => {
    // Read once per mount: the delay only aligns the cycle's start with td's other sky cues.
    const [phaseDelay] = useState(floatPhaseDelay);
    return (
        <Box
            component="button"
            type="button"
            className="home-enter-hint"
            disabled={disabled}
            onClick={onTap}
            sx={{
                // Centred on the screen's axis (= the platform's), words' baseline on the anchor line.
                position: "absolute",
                left: "50%",
                top: `${-ASCENT_EM * WORDS_PX}px`,
                transform: "translateX(-50%)",
                // The anchor around it ignores the pointer; the hint itself is tappable.
                pointerEvents: "auto",
                display: "flex",
                padding: 0,
                border: "none",
                background: "none",
                cursor: "pointer",
                color: paint,
                whiteSpace: "nowrap",
                WebkitTapHighlightColor: "transparent",
                "&:disabled": { cursor: "default" },
            }}
        >
            {/* Words + chevron float as one unit; the button around them stays still. */}
            <Box
                component="span"
                className="home-enter-hint__float"
                sx={{
                    display: "flex",
                    // The words, and the chevron centred under them (it points the swipe's way).
                    flexDirection: "column",
                    alignItems: "center",
                    animation: prefersReducedMotion() ? undefined : `${floatDown} ${FLOAT_MS}ms ease-in-out ${phaseDelay} infinite`,
                }}
            >
                <Box
                    component="span"
                    className="home-enter-hint__words"
                    sx={{ fontFamily: FONTS.cjk, fontSize: SIZE.title, fontWeight: WEIGHT.bold, lineHeight: 1, textAlign: "center" }}
                >
                    Swipe down to enter
                </Box>
                <ExpandMoreIcon className="home-enter-hint__chevron" sx={{ fontSize: CHEVRON_PX, display: "block", mt: "-2px" }} />
            </Box>
        </Box>
    );
};

export default HomeEnterHint;
