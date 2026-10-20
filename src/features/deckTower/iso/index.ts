/**
 * The iso art framework — the "Good Job!"-style isometric drawing kit
 * (docs/ISO_ART_FRAMEWORK.md). Import from here, not from the individual files.
 *
 * Lives under features/deckTower/ because the Deck Tower is its only user; per
 * docs/FRONTEND_LAYERING.md § 1 it moves to src/components/iso/ when a second feature
 * imports it.
 */

// Scene + primitives
export { default as IsoScene } from "./IsoScene";
export { default as IsoSolid } from "./IsoSolid";
export { default as IsoShadow } from "./IsoShadow";
export { default as IsoLevitate } from "./IsoLevitate";

// Objects
export { default as IsoPlatform, RIM_WIDTH } from "./IsoPlatform";
export { default as IsoCarpet } from "./IsoCarpet";
export { default as IsoCard } from "./IsoCard";
export { default as IsoCardStack } from "./IsoCardStack";
export { default as IsoCardImprint } from "./IsoCardImprint";
export { default as IsoFloorLabel, RAISED_HEIGHT } from "./IsoFloorLabel";
export { default as IsoLever } from "./IsoLever";
export { leverFootprint, LEVER_HOLE } from "./leverGeometry";
export { default as IsoWallSlider, type WallSliderLayout } from "./IsoWallSlider";
export { default as IsoCardRuns } from "./IsoCardRuns";
export { default as IsoSmokePuff } from "./IsoSmokePuff";
export { default as IsoPawn } from "./IsoPawn";
export { depthRankAmong, type PawnRoam, type PawnEntranceCue, type PawnStep } from "./usePawnMotion";
export {
    PAWN_ENTRANCES,
    FALL_FROM_SKY,
    pickPawnEntrance,
    entranceStartFor,
    type PawnEntrance,
    type PawnEntranceFrame,
} from "./pawnEntrances";
export { default as IsoBird } from "./IsoBird";
export { useBirdFlights, type BirdFlight, type BirdSide, type BirdSky } from "./useBirdFlights";
export { default as IsoCloud } from "./IsoCloud";
export { useCloudDrifts, sortCloudsBackToFront, type CloudDrift, type CloudPuff, type CloudSky } from "./useCloudDrifts";
export { default as IsoWind } from "./IsoWind";
export { useWindGusts, type WindGust, type WindStrand, type WindPt, type WindSky } from "./useWindGusts";
export { planSidePath, useSkyTraffic, prefersReducedMotion, type SkyRegion, type SkySide, type SidePath } from "./skyTraffic";

// Rules + math
export * from "./geometry";
export { ISO, mixHex, platformTone, shadeHex, spaceOver, type Material, type PlatformTone } from "./palette";
export { shadowFootprint, shadowTone, type IsoSurface } from "./light";
export { BOB_HEIGHT, BOB_PERIOD_MS } from "./levitation";
export { cardStackMetrics, CARD_THICKNESS, type CardStackMetrics } from "./cardStackMetrics";
export { planCardCollapse, cardsShowingAt, fallMsFor, shadowLandTiming, type CardCollapsePlan, type CollapseRun, type GhostChunk } from "./cardCollapse";
