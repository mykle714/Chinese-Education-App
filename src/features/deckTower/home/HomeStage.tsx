import React, { useRef } from "react";
import { Box } from "@mui/material";
import { shadowTone, type FogCloud, type IsoRainFall, type IsoSnowFall, type IsoWash, type Projector } from "../iso";
import type { TowerWorld } from "../towerWorlds";
import type { ScreenPoint } from "../../../utils/pageTransition";
import { SLAB_FOOTER_BOTTOM, SLAB_FOOTER_TOTAL_HEIGHT } from "../../../components/MobileFooter";
import HomeScene, { type HomeSceneFrame } from "./HomeScene";
import HomeButtons from "./HomeButtons";
import HomeTitle from "./HomeTitle";
import { useEnterSwipe } from "./useHomePull";
import { COLORS } from "../../../theme/colors";

/**
 * HomeStage — the home screen the app opens on (docs/HOME_SCREEN.md): the app's title at the
 * top, the home platform with its pawn, and under it the Dictionary key and the "Swipe down to
 * enter" hint. A swipe anywhere on the stage that scrolls down toward the tower enters
 * (`useEnterSwipe`); so does a tap on the hint.
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
 * on td's spot, and Enter's shift lands td's platform exactly where the home's stood. The two
 * keys take the hidden footer slab's footprint: its 16px side insets, standing on its bottom
 * gap (`SLAB_FOOTER_BOTTOM`, which carries the safe area), their tops on the slab's top line.
 * The title (HomeTitle — a placeholder wordmark) sits `TITLE_TOP_PX` under the safe area's
 * top, centred, in the sky the missing header leaves.
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

const HomeStage: React.FC<HomeStageProps> = ({ proj, frame, world, wash, rain, snowFall, fog, sky, shiftY, busy, onDictionary, onEnter }) => {
    const stageRef = useRef<HTMLDivElement>(null);
    useEnterSwipe({ stageRef, enabled: !busy, onEnter });
    // White painted on the sky, dimmed with the hour like everything else on it (TapToStartHint's paint).
    const skyWhite = wash(COLORS.white);
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
            </Box>
            {/* In the footer slab's footprint: its side insets, its bottom gap, tops on its top line. */}
            <Box
                className="home-stage__keys"
                sx={{ position: "absolute", left: "16px", right: "16px", bottom: SLAB_FOOTER_BOTTOM, height: `calc(${SLAB_FOOTER_TOTAL_HEIGHT} - ${SLAB_FOOTER_BOTTOM})` }}
            >
                <HomeButtons onDictionary={onDictionary} onEnter={onEnter} hintPaint={skyWhite} disabled={busy} />
            </Box>
        </Box>
    );
};

export default HomeStage;
