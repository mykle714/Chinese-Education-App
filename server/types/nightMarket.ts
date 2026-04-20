/**
 * Night Market Types
 * Defines interfaces for the night market unlock system
 */

/** A single unlock record persisted in the database */
export interface NightMarketUnlock {
  id: string;              // UUID primary key
  userId: string;          // FK to Users
  assetId: string;         // key into the asset registry
  unlockType: string;      // 'stall' | 'person' (extensible for future types)
  unlockOrder: number;     // 0 = base set, 1+ = earned unlocks
  createdAt: Date;
}

/**
 * Render slot determines sub-layer ordering within a stand's depth.
 * Each slot adds a fractional z-offset so layers interleave correctly
 * with entities at nearby depths.
 *
 * Back-to-front order: background → entity → foreground → overlay
 */
export type RenderSlot = 'background' | 'entity' | 'foreground' | 'overlay';

/** Fractional z-offsets per render slot (must sum to < 1.0) */
export const RENDER_SLOT_Z: Record<RenderSlot, number> = {
  background: 0.0,   // shadows, floor details, back walls
  entity: 0.25,      // humans, merchants
  foreground: 0.5,   // counters, roofs
  overlay: 0.75,     // tall signs, floating effects
};

/** A single sub-image within a stand's layer stack */
export interface StandLayer {
  imagePath: string;       // filename (server) or Vite-resolved URL (frontend)
  slot: RenderSlot;        // which render slot this sub-image belongs to
  offsetX?: number;        // screen-pixel offset from stand anchor (default 0)
  offsetY?: number;        // screen-pixel offset from stand anchor (default 0)
  scale?: number;          // overrides parent asset's default scale if set
}

/** Static definition of an unlockable asset (lives in the registry config, not DB) */
export interface NightMarketAssetDef {
  assetId: string;         // unique key, e.g. 'stall-dumpling-01'
  unlockType: 'stall' | 'person';
  displayName: string;     // shown on tap, e.g. "Dumpling Stand"
  description: string;     // flavor text shown on tap
  layers: StandLayer[];    // sub-images composing this asset, each in a render slot
  isoX: number;            // isometric X position (continuous float, not grid-snapped)
  isoY: number;            // isometric Y position (continuous float, not grid-snapped)
  scale: number;           // default render scale for sub-layers (1.0 = original size)
}

/** Response for GET /api/night-market/unlocks */
export interface NightMarketUnlocksResponse {
  unlocks: NightMarketUnlock[];
  nextThreshold: number;   // work points needed for next unlock
  totalUnlockable: number; // total items in the unlock pool
}

/** Response for POST /api/night-market/unlock */
export interface NightMarketNewUnlockResponse {
  unlock: NightMarketUnlock;
  nextThreshold: number;   // work points needed for the unlock after this one
}
