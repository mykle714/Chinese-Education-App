/**
 * The iso art framework — the "Good Job!"-style isometric drawing kit
 * (docs/ISO_ART_FRAMEWORK.md). Import from here, not from the individual files.
 *
 * Lives under features/deckTower/ because the Deck Tower was its only user. Since
 * 2026-10-29 scp's bins (features/discover/SortBins.tsx) import it too, so per
 * docs/FRONTEND_LAYERING.md § 1 it is due to move to src/components/iso/
 * (docs/DEFERRED_WORK.md #28).
 */

// Scene + primitives
export { default as IsoScene } from "./IsoScene";
export { default as IsoSolid } from "./IsoSolid";
export { default as IsoShadow } from "./IsoShadow";
export { default as IsoLevitate } from "./IsoLevitate";
export { default as IsoSpacedText } from "./IsoSpacedText";

// Objects
export { default as IsoPlatform, RIM_WIDTH } from "./IsoPlatform";
export { default as IsoCarpet } from "./IsoCarpet";
export { default as IsoCard } from "./IsoCard";
export { default as IsoCardStack } from "./IsoCardStack";
export { default as IsoCardImprint } from "./IsoCardImprint";
export { default as IsoFloorLabel, RAISED_HEIGHT } from "./IsoFloorLabel";
export { default as IsoLever } from "./IsoLever";
export { default as IsoHatch } from "./IsoHatch";
export { default as IsoModeSwitch } from "./IsoModeSwitch";
export {
    hatchFootprint,
    leverFootprint,
    modeSwitchFootprint,
    openingSweepPath,
    LEVER_HOLE,
    MODE_SWITCH_HOLE,
} from "./hatchGeometry";
export { default as IsoCardRuns } from "./IsoCardRuns";
export { default as IsoSmokePuff } from "./IsoSmokePuff";
export { default as IsoPawn } from "./IsoPawn";
export { backToFront, depthRankAmong, PLATE_LAUNCH_APEX_MS, type PawnRoam, type PawnEntranceCue, type PawnStep } from "./usePawnMotion";
export {
    PAWN_ENTRANCES,
    FALL_FROM_SKY,
    pickPawnEntrance,
    entranceStartFor,
    type PawnEntrance,
    type PawnEntranceFrame,
} from "./pawnEntrances";
export { default as IsoCloud } from "./IsoCloud";
export { useCloudDrifts, sortCloudsBackToFront, type CloudDrift, type CloudPuff, type CloudSky } from "./useCloudDrifts";
export { default as IsoWind } from "./IsoWind";
export { useWindGusts, type WindGust, type WindStrand, type WindPt, type WindSky } from "./useWindGusts";
export { planSidePath, useSkyTraffic, prefersReducedMotion, type SkyRegion, type SkySide, type SidePath } from "./skyTraffic";

// Rules + math
export * from "./geometry";
export { dimetricView, makeCameraProjector, type CameraView } from "./camera";
export { bandMaterial, floorSlabMaterial, holeTone, ISO, mixHex, platformTone, shadeHex, spaceOver, type Material, type PlatformTone } from "./palette";
export { shadowFootprint, shadowTone, type IsoSurface } from "./light";
export {
    blendWash,
    hexToOklch,
    hueTurn,
    lightWash,
    NO_WASH,
    oklchToHex,
    washMaterial,
    washPalette,
    washTone,
    type IsoPalette,
    type IsoWash,
    type WashLight,
} from "./wash";
export { useIsoPalette, useIsoWash } from "./sceneContext";
export { BOB_HEIGHT, BOB_PERIOD_MS, frozenBobOffsetPx } from "./levitation";
export { cardStackMetrics, CARD_THICKNESS, type CardStackMetrics } from "./cardStackMetrics";
export { planCardCollapse, cardsShowingAt, fallMsFor, shadowLandTiming, type CardCollapsePlan, type CollapseRun, type GhostChunk } from "./cardCollapse";
