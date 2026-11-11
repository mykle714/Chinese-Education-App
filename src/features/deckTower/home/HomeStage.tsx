import React, { useRef } from "react";
import { Box } from "@mui/material";
import { shadowTone, type FogCloud, type IsoRainFall, type IsoSnowFall, type IsoWash, type Projector } from "../iso";
import type { TowerWorld } from "../towerWorlds";
import type { ScreenPoint } from "../../../utils/pageTransition";
import { SLAB_FOOTER_BOTTOM, SLAB_FOOTER_TOTAL_HEIGHT } from "../../../components/MobileFooter";
import HomeScene, { type HomeSceneFrame } from "./HomeScene";
import HomeButtons from "./HomeButtons";
import HomeTitle from "./HomeTitle";
import HomeEnterHint from "./HomeEnterHint";
import { tapHintBaselineY } from "../tapToStartGeometry";
import { useEnterSwipe } from "./useHomePull";
import { COLORS } from "../../../theme/colors";

/**
 * HomeStage — the home screen the app opens on (docs/HOME_SCREEN.md): the app's title at the
 * top, the "Swipe down to enter" hint mid-screen, the home platform with its pawn, and under
 * it the Dictionary key. A swipe anywhere on the stage that scrolls down toward the tower
 * enters (`useEnterSwipe`); so does a tap on the hint.
 *
 * It is a STAGE OF THE DECK TOWER PAGE, not a route: a layer over td's scroller, transparent
 * so td's own sky (SpaceBackdrop — the hour, the weather, the stars, the aurora) is its
 * backdrop. That is what lets Enter and the pull back home read as camera moves: the sky
 * never remounts, only the two scenes move across it (useHomeEntrance).
 *
 * No header and no footer while it is up (DeckTowerPage hides both): the screen is the sky,
 * the title, the platform, the Dictionary key and the enter hint.
 *
 * LAYOUT — td's, exactly. The scene is laid out the way td's scroller lays out its own: full
 * width, its bottom edge on the footer slab's top (`SLAB_FOOTER_TOTAL_HEIGHT` up from the
 * screen's bottom), drawn in td's frame (HomeScene) — so the platform stands at td's size and
 * on td's spot, and Enter's shift lands td's platform exactly where the home's stood. The
 * Dictionary key takes the hidden footer slab's footprint: its 16px side insets, standing on its bottom
 * gap (`SLAB_FOOTER_BOTTOM`, which carries the safe area), their tops on the slab's top line.
 * The title (HomeTitle — a placeholder wordmark) sits `TITLE_TOP_PX` under the safe area's
 * top, centred, in the sky the missing header leaves.
 *
 * The enter hint (HomeEnterHint) stands on td's "Tap to Start" line: its baseline is
 * `tapHintBaselineY(hintTipY)` in the scene frame, converted to screen px against the scene
 * box's width (the svg is full width, so 1 viewBox unit = boxWidth / `frame.width` px). The
 * anchor is a zero-height box lifted off the scene box's bottom by `padding-bottom` in %, which
 * CSS resolves against the containing block's WIDTH — so it scales with the svg, with no
 * measuring. It sits above the svg's own top; that is fine, the box does not clip.
 *
 * `shiftY` is the shift's offset for this layer, in stage heights (0 at rest, −1 parked above
 * the screen — the home stands above the tower).
 *
 * Layer: feature page view (src/features/deckTower/home). Rendered by DeckTowerPage.
 */

/** The title's gap under the top safe area, px. */
const TITLE_TOP_PX = 56;

interface HomeStageProps {
    proj: Projector;
    /** td's scene frame (left edge, width, bottom edge, rain ceiling), so the platform is drawn where td draws it. */
    frame: HomeSceneFrame;
    /** viewBox y td's Tap to Start arrow aims at (DeckTowerPage → `hintFit.towerTopY`); the enter hint stands on its words' line. */
    hintTipY: number;
    /** The main world, lit for the hour. */
    world: TowerWorld;
    wash: IsoWash;
    rain?: IsoRainFall;
    /** The weather's platform snow, when it is snowing (DeckTowerPage → `snowFall`). */
    snowFall?: IsoSnowFall;
    fog?: { opacity: number; clouds: FogCloud[] };
    /** The sky colour (the key's and the title's cast shadow is a shade of it). */
    sky: string;
    shiftY: number;
    /** Keys dead (the shift has started). */
    busy: boolean;
    onDictionary: (at: ScreenPoint) => void;
    onEnter: () => void;
}

const HomeStage: React.FC<HomeStageProps> = ({ proj, frame, hintTipY, world, wash, rain, snowFall, fog, sky, shiftY, busy, onDictionary, onEnter }) => {
    const stageRef = useRef<HTMLDivElement>(null);
    useEnterSwipe({ stageRef, enabled: !busy, onEnter });
    // White painted on the sky, dimmed with the hour like everything else on it (TapToStartHint's paint).
    const skyWhite = wash(COLORS.white);
    // The hint's baseline, as a height above the scene box's bottom, in % of the box's width.
    const hintLiftPct = ((frame.maxY - tapHintBaselineY(hintTipY)) / frame.width) * 100;
    return (
        <Box
            ref={stageRef}
            className="home-stage"
            sx={{
                position: "absolute",
                inset: 0,
                // Over td's scroller (1) and header layer (2); under nothing else td draws while it is up.
                zIndex: 4,
                transform: shiftY !== 0 ? `translateY(${(shiftY * 100).toFixed(2)}%)` : undefined,
                pointerEvents: busy ? "none" : undefined,
                touchAction: "none",
                ["--home-ground-shadow" as string]: shadowTone(sky),
            }}
        >
            <Box
                className="home-stage__title-box"
                sx={{ position: "absolute", left: 0, right: 0, top: `calc(env(safe-area-inset-top, 0px) + ${TITLE_TOP_PX}px)`, pointerEvents: "none" }}
            >
                <HomeTitle paint={skyWhite} />
            </Box>
            {/* Full width, bottom on the footer slab's top: td's scroller's placement of its scene. */}
            <Box className="home-stage__scene-box" sx={{ position: "absolute", left: 0, right: 0, bottom: SLAB_FOOTER_TOTAL_HEIGHT }}>
                <HomeScene proj={proj} frame={frame} world={world} wash={wash} rain={rain} snowFall={snowFall} fog={fog} />
                {/* The enter hint's anchor: its top edge is Tap to Start's baseline (see header). */}
                <Box
                    className="home-stage__enter-anchor"
                    sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 0, pb: `${hintLiftPct.toFixed(3)}%`, pointerEvents: "none" }}
                >
                    <HomeEnterHint paint={skyWhite} disabled={busy} onTap={onEnter} />
                </Box>
            </Box>
            {/* In the footer slab's footprint: its side insets, its bottom gap, tops on its top line. */}
            <Box
                className="home-stage__keys"
                sx={{ position: "absolute", left: "16px", right: "16px", bottom: SLAB_FOOTER_BOTTOM, height: `calc(${SLAB_FOOTER_TOTAL_HEIGHT} - ${SLAB_FOOTER_BOTTOM})` }}
            >
                <HomeButtons onDictionary={onDictionary} disabled={busy} />
            </Box>
        </Box>
    );
};

export default HomeStage;
