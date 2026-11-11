/**
 * The iso art framework — the "Good Job!"-style isometric drawing kit
 * (docs/ISO_ART_FRAMEWORK.md). Import from here, not from the individual files.
 *
 * Lives under features/deckTower/ because the Deck Tower was its only user. Since
 * 2026-10-29 acp's bins (features/discover/SortBins.tsx) import it too, so per
 * docs/FRONTEND_LAYERING.md § 1 it is due to move to src/components/iso/
 * (docs/DEFERRED_WORK.md #28).
 */

// Scene + primitives
export { default as IsoScene } from "./IsoScene";
export { default as IsoSolid } from "./IsoSolid";
export { default as IsoShadow } from "./IsoShadow";
export { default as IsoLevitate } from "./IsoLevitate";
export { default as IsoSpacedText } from "./IsoSpacedText";
export { default as IsoText, INK_CENTRE_DY } from "./IsoText";

// Objects
export { default as IsoPlatform, RIM_WIDTH } from "./IsoPlatform";
export { default as IsoCard } from "./IsoCard";
export { default as IsoCardStack } from "./IsoCardStack";
export { default as IsoCardImprint } from "./IsoCardImprint";
export { default as IsoFloorPrint } from "./IsoFloorPrint";
export { default as IsoPaperStack } from "./IsoPaperStack";
export { default as IsoSortPlatform } from "./IsoSortPlatform";
export { sortPlatformTopZ, SORT_PLATFORM_JUMP, SLAB_THICKNESS } from "./sortPlatformMetrics";
export { PAPER_SHEET_THICKNESS, paperStackHeight } from "./paperStackMetrics";
export { default as IsoFloorLabel, RAISED_HEIGHT } from "./IsoFloorLabel";
export { default as IsoLever } from "./IsoLever";
export { default as IsoHatch } from "./IsoHatch";
export {
    hatchFootprint,
    leverFootprint,
    openingSweepPath,
    LEVER_HOLE,
} from "./hatchGeometry";
export { default as IsoCardRuns } from "./IsoCardRuns";
export { default as IsoSmokePuff } from "./IsoSmokePuff";
export { default as IsoPawn } from "./IsoPawn";
export { default as IsoPawnStill } from "./IsoPawnStill";
export {
    backToFront,
    depthRankAmong,
    PLATE_LAUNCH_APEX_MS,
    type PawnRoam,
    type PawnEntranceCue,
    type PawnStretchCue,
    type PawnStep,
    type PawnTapReaction,
} from "./usePawnMotion";
export { LASTING_IDLES, type PawnIdleCue, type PawnIdleKind } from "./pawnIdles";
export {
    PAWN_ENTRANCES,
    FALL_FROM_SKY,
    fallFromHeight,
    pickPawnEntrance,
    entranceStartFor,
    type PawnEntrance,
    type PawnEntranceFrame,
} from "./pawnEntrances";
export { default as IsoCloud } from "./IsoCloud";
export { default as IsoCloudShadow } from "./IsoCloudShadow";
export { default as IsoBalloon } from "./IsoBalloon";
export { default as IsoFog, type IsoFogPiercer } from "./IsoFog";
export { planFogClouds, FOG_LEVELS, type FogCloud, type FogCover } from "./fogClouds";
export { default as IsoRain, type IsoRainFall, type IsoRainSolid } from "./IsoRain";
export { default as IsoSnow, type IsoSnowFall } from "./IsoSnow";
export { IsoSnowCap, IsoCardSnow, IsoBallSnow, IsoSnowShed, SnowSlab, SNOW_CAP_DEPTH, SNOW_SHED_MS, type SnowCover } from "./IsoSnowCap";
export { IsoFloorSnow, IsoSnowSkirt, FLOOR_SNOW_DEPTH } from "./IsoSnowFloor";
export { newSnowTrail, MAX_TRAIL_POINTS, type SnowTrail } from "./snowTrail";
export { useSnowTrailRecorder, type SnowWalker } from "./snowChannel";
export { openFloorSpot, hiddenBehind, type FloorSolid, type OpenFloorSpot } from "./openFloor";
export { default as IsoBurnMark, BURN_MARK_RADIUS } from "./IsoBurnMark";
export { default as IsoLightningBolt } from "./IsoLightningBolt";
export { seededRandom } from "./seededRandom";
export { useCloudDrifts, sortCloudsBackToFront, type CloudDrift, type CloudDriftKind, type CloudPuff, type CloudSky } from "./useCloudDrifts";
export { default as IsoWind } from "./IsoWind";
export { useWindGusts, type WindGust, type WindStrand, type WindPt, type WindSky } from "./useWindGusts";
export { planSidePath, useSkyTraffic, prefersReducedMotion, type SkyRegion, type SkySide, type SidePath } from "./skyTraffic";

// Rules + math
export * from "./geometry";
export { dimetricView, makeCameraProjector, type CameraView } from "./camera";
export { bandMaterial, deckUnderLayerMaterial, floorSlabMaterial, holeTone, ISO, mixHex, platformTone, shadeHex, snowMaterial, spaceOver, type Material, type PlatformTone } from "./palette";
export { shadowFootprint, shadowSpread, shadowTone, type IsoSurface } from "./light";
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
