import React, { memo, useMemo, useRef } from "react";
import { BOB_HEIGHT, IsoScene, prism, type FogCloud, type IsoRainFall, type IsoSnowFall, type IsoWash, type Projector } from "../iso";
import DeckTowerPlatform from "../DeckTowerPlatform";
import { PLATFORM_THICKNESS, TOWER_LAYOUT } from "../towerPlatforms";
import type { TowerWorld } from "../towerWorlds";
import type { SwapPawn } from "../useDeckSwap";

/**
 * HomeScene — the home screen's platform and its pawn (docs/HOME_SCREEN.md § "The platform").
 *
 * It IS td's platform: the same component (DeckTowerPlatform), the same layout
 * (towerPlatforms.ts → `TOWER_LAYOUT` — the 11 × 11 slab, the pawn's first spot, its roam),
 * the same projector and the same framing, so it stands at exactly the size and on exactly
 * the spot td's platform does (HomeStage pins this svg the way td's scroller pins its scene:
 * full width, its bottom edge on the footer slab's top). Only what stands on it differs: no
 * deck, no "0 cards" imprint, no deck plate, no focus lever, no corner fixture — the pawn
 * alone, the default unlock. The empty deck spot stays an obstacle (`TOWER_LAYOUT.roam`), so
 * the pawn walks round it as it does round td's tower; with no cards its summit is closed.
 *
 * The world is the main world lit for the hour (`litWorld(core, light)`); the hour's wash,
 * the weather's platform rain and fog come from td, drawn the way td draws them.
 *
 * WHAT STANDS ON IT LATER. Unlocks are meant to spawn on this platform as the learner
 * progresses; none exist yet and there is deliberately no plumbing (owner, 2026-11-09: "pawn
 * only, no plumbing"). The first one will need a slot in DeckTowerPlatform's obstacle layers
 * (its `layers` / `roam.obstacles` pairing).
 *
 * Layer: feature page view (src/features/deckTower/home). Rendered by HomeStage.
 * Depends on: DeckTowerPlatform.tsx (`plate` / `lever` optional for this caller),
 * towerPlatforms.ts, the iso kit. Docs: docs/HOME_SCREEN.md.
 */

/** World units of sky over the slab's back corner (room for the pawn's tap-jump and its `!`). */
const HEADROOM_Z = 5;

/** td's frame, which the home scene shares: the same left edge, width and bottom edge as td's scene. */
export interface HomeSceneFrame {
    /** td's scene viewBox left edge and width (`fitScene` → `minX`, `width`). */
    minX: number;
    width: number;
    /** td's scene viewBox bottom edge (`fitScene` → `maxY`): the platform shadow plus td's bottom margin. */
    maxY: number;
    /** IsoRain's cloud base (`fitScene` → `rainCeilingY`). */
    rainCeilingY: number;
}

interface HomeSceneProps {
    /** td's projector (DeckTowerPage → `proj`). */
    proj: Projector;
    frame: HomeSceneFrame;
    /** The main world, lit for the hour (`litWorld`). */
    world: TowerWorld;
    /** The hour's wash over the platform and the pawn (`light.wash`). */
    wash: IsoWash;
    /** The weather's platform rain, when it is raining (DeckTowerPage → `rainFall`). */
    rain?: IsoRainFall;
    /** The weather's platform snow, when it is snowing (DeckTowerPage → `snowFall`). Settled snow is td's only. */
    snowFall?: IsoSnowFall;
    /** The fog over the platform, when foggy (DeckTowerPage → `fogClouds`, `weatherFx.fog`). */
    fog?: { opacity: number; clouds: FogCloud[] };
}

/** The one pawn, never swapped out. */
const HOME_PAWNS: SwapPawn[] = [{ key: 0, outgoing: false }];

const HomeScene: React.FC<HomeSceneProps> = ({ proj, frame, world, wash, rain, snowFall, fog }) => {
    // td's left edge, width and bottom edge; only the top is the home's own (td's grows to
    // its tower's top, and there is no tower here).
    const fit = useMemo(() => {
        const slab = prism(proj, TOWER_LAYOUT.platform, -PLATFORM_THICKNESS, BOB_HEIGHT).bounds;
        const minY = slab.minY - proj.heightUnit * HEADROOM_Z;
        const height = frame.maxY - minY;
        return { viewBox: `${frame.minX} ${minY} ${frame.width} ${height}`, aspectRatio: `${frame.width} / ${height}` };
    }, [proj, frame.minX, frame.width, frame.maxY]);
    // Where a pawn on the tower's top stands; never set here (no tower), but the platform wants one.
    const summitSpot = useRef<{ x: number; y: number } | null>(null);

    return (
        <IsoScene
            proj={proj}
            wash={wash}
            viewBox={fit.viewBox}
            className="home-stage__scene"
            style={{ width: "100%", aspectRatio: fit.aspectRatio, display: "block", overflow: "visible" }}
        >
            <DeckTowerPlatform
                world={world}
                hingeAngle={0}
                stack={null}
                showImprint={false}
                stackFalling={false}
                dropPx={0}
                pawns={HOME_PAWNS}
                cardsOnTower={0}
                towerCountKnown
                summitCards={0}
                summitHeld={false}
                summitSpot={summitSpot}
                swapOutgoing={false}
                rain={rain}
                snowFall={snowFall}
                rainCeilingY={frame.rainCeilingY}
                fog={fog}
            />
        </IsoScene>
    );
};

export default memo(HomeScene);
