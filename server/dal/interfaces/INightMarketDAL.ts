import { NightMarketUnlock } from '../../types/nightMarket.js';

/**
 * Night Market Data Access Layer interface
 *
 * ⚠️ The legacy asset-unlock write path was RETIRED (2026-07-17) when migrations 112/113
 * repurposed `nightmarketunlocks` for the template-placement OCCUPANT model. The old-shape
 * writers (`createUnlock`/`createBulkUnlocks`/`hasAnyUnlocks`/`getEarnedUnlockCount`/
 * `getUnlockedAssetIds`) were removed because they can no longer satisfy the NOT NULL
 * `placedTemplateId`/`placeholderAreaId` columns. Only the read below remains; the occupant
 * DAL is built in Slice 3/4. See NightMarketService header.
 */
export interface INightMarketDAL {
  /** Legacy read: all unlock rows for a user, ordered by unlockOrder. Retained for back-compat. */
  findByUserId(userId: string): Promise<NightMarketUnlock[]>;
}
