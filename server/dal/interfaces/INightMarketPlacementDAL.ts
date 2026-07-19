import { TemplatePlacementRow, PlacementOccupant } from '../../types/nightMarket.js';

/**
 * Night Market PLACEMENT Data Access Layer interface (migrations 112/113).
 *
 * Persistence for the per-user template LAYOUT: which catalog template (by name) a user has
 * dropped where (`nightmarkettemplatelocations`), plus the occupants filling each placement's
 * placeholder slots (`nightmarketunlocks` joined by placement). This is the read side the
 * runtime renders; the write side (spawn/place) is built by the Slice-3/4 placement service.
 *
 * Distinct from INightMarketDAL (the retired legacy asset-unlock reads).
 */
export interface INightMarketPlacementDAL {
  /** All placements for a user, in chronological placement order (createdAt ASC). */
  findPlacementsByUser(userId: string): Promise<TemplatePlacementRow[]>;

  /** How many placements a user has — drives the "seed the hub if absent" check. */
  countPlacementsByUser(userId: string): Promise<number>;

  /** Insert one placement; returns the created row (id/createdAt filled by the DB). */
  insertPlacement(
    userId: string,
    templateName: string,
    activeVersion: number,
    offsetCol: number,
    offsetRow: number,
  ): Promise<TemplatePlacementRow>;

  /**
   * All occupants across a user's placements (unlocks joined to their placement). Read to
   * compute each placement's filled-placeholder set.
   */
  findOccupantsByUser(userId: string): Promise<PlacementOccupant[]>;

  /** How many occupants a user has across all placements — the grant/decay economy count. */
  countOccupantsByUser(userId: string): Promise<number>;

  /**
   * Place one occupant into a placement's placeholder slot (the grant flow's write). `userId` is
   * the placement owner (denormalized onto the unlock row, NOT NULL). The UNIQUE (placedTemplateId,
   * placeholderAreaId) index makes a double-fill of the same slot a loud error, not a silent dup.
   */
  insertOccupant(
    userId: string,
    placedTemplateId: string,
    placeholderAreaId: string,
    assetId: string,
  ): Promise<void>;

  /**
   * Decay: keep the `keep` OLDEST occupants across a user's placements and delete the rest (newest
   * first). Used when the user's entitlement drops below their occupant count. Returns how many
   * were deleted. This removes OCCUPANTS only; the decay caller then prunes any template left
   * empty + dangling (deletePlacements / pruneDanglingTemplates). (The hourly cron does the same
   * occupant trim in SQL, but removes RANDOM occupants; this live path removes newest-first so the
   * tester tool is predictable.)
   */
  deleteSurplusOccupants(userId: string, keep: number): Promise<number>;

  /** Persist a re-selected active version for one placement (version-selection recompute). */
  updateActiveVersion(placementId: string, activeVersion: number): Promise<void>;

  /**
   * Remove whole PLACEMENTS by id (scoped to `userId` as a safety guard). Used by the decay-time
   * "prune dangling templates" pass (NightMarketPlacementService.pruneDanglingTemplates) to cull
   * empty, weakly-attached templates. Occupants cascade-delete with their placement (migration 113
   * ON DELETE CASCADE), though pruned placements are occupant-free by definition. Returns the number
   * of placement rows deleted. No-op (returns 0) for an empty id list.
   */
  deletePlacements(userId: string, placementIds: string[]): Promise<number>;
}
