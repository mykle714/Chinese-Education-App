import { INightMarketDAL } from '../dal/interfaces/INightMarketDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { NightMarketUnlocksResponse, NightMarketNewUnlockResponse } from '../types/nightMarket.js';
import { NIGHT_MARKET_CONFIG } from '../config/nightMarketRegistry.js';
import { ValidationError } from '../types/dal.js';

/**
 * Night Market Service
 *
 * ⚠️ LEGACY ASSET-UNLOCK ECONOMY — RETIRED (2026-07-17).
 * This service used to own the old asset-based unlock economy: a base set seeded on
 * first visit plus points-gated random unlocks, all stored in `nightmarketunlocks`
 * (`assetId`/`unlockType`/`unlockOrder`). Migrations 112/113 REPURPOSED that table for
 * the template-placement OCCUPANT model — a row is now an occupant placed into a
 * placeholder slot of a placed template (`placedTemplateId`/`placeholderAreaId`, both
 * NOT NULL). The old-shape INSERTs can no longer satisfy the schema, so the legacy
 * writers are retired here:
 *   - `getUnlocks` no longer seeds or reads the table; it returns a stable empty shape
 *     so the existing client (`useNightMarket`) stops 400-ing while the engine viewer
 *     takes over rendering.
 *   - `unlockNext` no longer writes old-shape rows; it rejects with a clear message.
 * The real unlock economy is rebuilt on the occupant model in Slice 4
 * (docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md). Delete this service once the client no
 * longer calls these endpoints.
 */
export class NightMarketService {
  constructor(
    private nightMarketDAL: INightMarketDAL,
    private userDAL: IUserDAL
  ) {}

  /**
   * Legacy endpoint (GET /api/night-market/unlocks). The asset-unlock economy is retired
   * (see class header), so this returns a stable empty response — no seeding, no table
   * read — purely to keep the old client from erroring. Superseded by the engine viewer's
   * layout render + the Slice-4 occupant economy.
   */
  async getUnlocks(_userId: string): Promise<NightMarketUnlocksResponse> {
    return {
      unlocks: [],
      nextThreshold: NIGHT_MARKET_CONFIG.POINTS_PER_UNLOCK,
      totalUnlockable: 0,
    };
  }

  /**
   * Legacy endpoint (POST /api/night-market/unlock). Retired: it can no longer write the
   * old asset-unlock shape into the repurposed `nightmarketunlocks` table. Rejects with a
   * clear message; the occupant-model grant flow replaces it in Slice 4.
   */
  async unlockNext(_userId: string): Promise<NightMarketNewUnlockResponse> {
    throw new ValidationError(
      'The night market unlock economy is being rebuilt and is temporarily unavailable.'
    );
  }
}
