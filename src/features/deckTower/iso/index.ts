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
export { default as IsoFloorLabel } from "./IsoFloorLabel";
export { default as IsoPawn } from "./IsoPawn";
export { depthRankAmong, type PawnRoam } from "./usePawnMotion";
export { default as IsoBird } from "./IsoBird";
export { useBirdFlights, type BirdFlight, type BirdSide, type BirdSky } from "./useBirdFlights";
export { default as IsoCloud } from "./IsoCloud";
export { useCloudDrifts, sortCloudsBackToFront, type CloudDrift, type CloudPuff, type CloudSky } from "./useCloudDrifts";
export { default as IsoWind } from "./IsoWind";
export { useWindGusts, type WindGust, type WindStrand, type WindPt, type WindSky } from "./useWindGusts";
export { planSidePath, useSkyTraffic, prefersReducedMotion, type SkyRegion, type SkySide, type SidePath } from "./skyTraffic";

// Rules + math
export * from "./geometry";
export { ISO, mixHex, shadeHex, type Material } from "./palette";
export { shadowFootprint, shadowTone, type IsoSurface } from "./light";
export { BOB_HEIGHT, BOB_PERIOD_MS } from "./levitation";
export { cardStackMetrics, CARD_THICKNESS, type CardStackMetrics } from "./cardStackMetrics";
