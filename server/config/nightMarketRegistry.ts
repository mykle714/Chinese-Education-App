import { NightMarketAssetDef } from '../types/nightMarket.js';

/**
 * Night Market Asset Registry (Server)
 *
 * Defines all unlockable items for the night market feature.
 * Assets are static files managed in code — no DB table needed.
 * Image files live in public/assets/night-market/.
 *
 * Assets are positioned using isometric grid coordinates (isoX, isoY).
 * The frontend converts these to screen coordinates via isoToScreen().
 */

/** Configuration constants */
export const NIGHT_MARKET_CONFIG = {
  /** Work points required per unlock (1 unlock per 60 points = 1 hour of study) */
  POINTS_PER_UNLOCK: 60,
};

/**
 * Base set — items every user receives automatically on first visit.
 * These are seeded with unlockOrder = 0.
 * Placeholder entries until real assets are provided.
 */
export const NIGHT_MARKET_BASE_SET: NightMarketAssetDef[] = [
  {
    assetId: 'base-ground-01',
    unlockType: 'stall',
    displayName: 'Market Ground',
    description: 'The foundation of your night market.',
    layers: [{ imagePath: 'base.png', slot: 'background' }],
    isoX: 0,
    isoY: 0,
    scale: 1.0,
  },
];

// Empty until real assets are provided — populate with actual assetId/imagePath values
export const NIGHT_MARKET_UNLOCK_POOL: NightMarketAssetDef[] = [];
