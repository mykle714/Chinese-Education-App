import React from "react";
import { Box } from "@mui/material";
import { FONTS } from "../../../theme/fonts";
import { WEIGHT } from "../../../theme/scale";

/**
 * HomeTitle — the app's title at the top of the home screen (docs/HOME_SCREEN.md § "The title").
 *
 * ⚠️ PLACEHOLDER. Until the real title asset exists this is a typeset wordmark: the app's name
 * ("Cow", as `index.html` / usePageTitle's `APP_NAME` spell it) in the face td paints on its sky
 * ("Tap to Start", "Swipe down to enter": `FONTS.cjk`, bold), white under the hour's wash, with a hard diagonal cast shadow on the sky —
 * the same (1, 1) shadow the home keys and td's filter keys throw, read from the stage's
 * `--home-ground-shadow`. When the asset arrives, replace this component's body with it and
 * keep the box (HomeStage places the box, not the letters).
 *
 * Layer: feature page view (src/features/deckTower/home). Rendered by HomeStage.
 */

/** The wordmark's size, px. */
const TITLE_FONT_PX = 64;
/** The cast shadow's reach down the (1, 1) diagonal, px. */
const TITLE_CAST_PX = 4;

interface HomeTitleProps {
    /** White under the hour's wash (HomeStage → `wash(COLORS.white)`). */
    paint: string;
}

const HomeTitle: React.FC<HomeTitleProps> = ({ paint }) => (
    <Box
        component="h1"
        className="home-title home-title--placeholder"
        sx={{
            m: 0,
            fontFamily: FONTS.cjk,
            fontWeight: WEIGHT.bold,
            fontSize: TITLE_FONT_PX,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: paint,
            textAlign: "center",
            textShadow: `${TITLE_CAST_PX}px ${TITLE_CAST_PX}px 0 var(--home-ground-shadow)`,
        }}
    >
        Cow
    </Box>
);

export default HomeTitle;
