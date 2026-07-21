import { INightMarketPlacementDAL } from '../dal/interfaces/INightMarketPlacementDAL.js';
import {
  NightMarketTemplateService,
  NIGHT_MARKET_HUB_TEMPLATE_NAME,
  TemplateDefinition,
  VersionScoringInputs,
} from './NightMarketTemplateService.js';
import {
  boardCells,
  globalOccupied,
  type PlacementOccupancy,
} from '../dal/shared/versionSelection.js';
import { resolvePlacementVersion } from '../dal/shared/continentSeal.js';
import { TemplatePlacementRow } from '../types/nightMarket.js';
import { NotFoundError } from '../types/dal.js';

/**
 * One placed template in the user's layout, as sent to the client runtime. Mirrors the engine's
 * `PlacedTemplate` (src/engine/market/templateStitch.ts) plus the loaded definition, board dims,
 * and the set of placeholder slots currently filled by occupants.
 */
export interface PlacedTemplatePayload {
  /** Catalog name of the placed template. */
  name: string;
  /** The version being rendered (persisted on the placement row, clamped to an existing version). */
  activeVersion: number;
  /** SW (min-iso) corner offset of this placement, in template-cell units (col→+isoX, row→+isoY). */
  offsetCol: number;
  offsetRow: number;
  /** Board size of the placed template (all versions of a name share one W×H). */
  width: number;
  height: number;
  /** The loaded version's definition (placeholder + description merged from version 0). */
  def: TemplateDefinition;
  /**
   * Placeholder-area ids ("col_row") that an occupant currently fills in THIS placement. Empty
   * until the Slice-4 grant flow writes occupants; drives which slots render a stand vs. empty.
   */
  filledPlaceholderIds: string[];
}

/** Response for GET /api/night-market/layout. */
export interface UserLayoutResponse {
  layout: PlacedTemplatePayload[];
}

/**
 * Night Market WORLD Service — the runtime LAYOUT read (docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md
 * slice 3).
 *
 * LAYER: service. Turns a user's persisted placement rows into the rendered layout the client
 * assembles into a MarketWorld: it reads placements (NightMarketPlacementDAL), loads each
 * referenced catalog definition (NightMarketTemplateService), and attaches each placement's
 * filled-placeholder set (occupants). It also SEEDS the origin hub for any user who has none.
 *
 * Version selection — RECOMPUTE ON READ (decision 2026-07-17, supersedes the earlier write-time
 * plan): every layout read re-derives each placement's active version from live DB state
 * (its filled occupant slots + which neighbors' footprints abut its edges) via the pure
 * {@link ../dal/shared/versionSelection} engine, and PERSISTS the result only when it changes.
 * The persisted `activeVersion` is therefore a stability cache, not the source of truth. This
 * makes BOTH condition-changing moments correct for free: an unlock inserts an occupant row and
 * an hourly-decay cron deletes occupant rows — neither needs to know about versions, because the
 * NEXT layout read reconciles the version. Selection has no fixpoint (conditions depend on
 * neighbor FOOTPRINTS, not neighbor versions), so a single pass over placements suffices.
 *
 * A persisted version that no longer exists in the catalog is clamped to 0 and re-persisted
 * (self-healing) — though recompute normally only ever selects an existing version.
 */
export class NightMarketWorldService {
  constructor(
    private placementDAL: INightMarketPlacementDAL,
    private templateService: NightMarketTemplateService,
  ) {}

  /**
   * The user's rendered layout. Seeds the origin hub if the user has no placements (see
   * {@link seedHubIfAbsent}), recomputes+persists each placement's active version from live
   * conditions, then materializes every placement into a {@link PlacedTemplatePayload}.
   */
  async getUserLayout(userId: string): Promise<UserLayoutResponse> {
    // First-load safety net: guarantee every user has a hub, even pre-existing accounts that
    // predate the account-creation seed (see seedHubIfAbsent — deprecated-on-arrival).
    await this.seedHubIfAbsent(userId);

    const placements = await this.placementDAL.findPlacementsByUser(userId);

    // Group occupants by placement so each placement's filled-slot set is its own.
    const occupants = await this.placementDAL.findOccupantsByUser(userId);
    const filledByPlacement = new Map<string, Set<string>>();
    for (const occ of occupants) {
      const set = filledByPlacement.get(occ.placedTemplateId) ?? new Set<string>();
      set.add(occ.placeholderAreaId);
      filledByPlacement.set(occ.placedTemplateId, set);
    }

    // Load each distinct template's per-version scoring masks once (placements may share a name).
    const scoringByName = new Map<string, VersionScoringInputs>();
    for (const p of placements) {
      if (!scoringByName.has(p.templateName)) {
        scoringByName.set(p.templateName, await this.templateService.getVersionScoringInputs(p.templateName));
      }
    }

    // Every placement's GLOBAL footprint (full board rect) — the version-agnostic occupancy the
    // border-street conditions test for abutment. Built once so each placement can exclude itself.
    const footprintByPlacement = new Map<string, PlacementOccupancy>();
    for (const p of placements) {
      const dims = scoringByName.get(p.templateName)!;
      footprintByPlacement.set(p.id, {
        offsetCol: p.offsetCol,
        offsetRow: p.offsetRow,
        cells: boardCells(dims.width, dims.height),
      });
    }

    const layout: PlacedTemplatePayload[] = [];
    for (const p of placements) {
      const scoring = scoringByName.get(p.templateName)!;
      const filled = filledByPlacement.get(p.id) ?? new Set<string>();

      // Neighbor footprints (everyone but this placement) → the abutment test's "others" set.
      const others: PlacementOccupancy[] = [];
      for (const q of placements) if (q.id !== p.id) others.push(footprintByPlacement.get(q.id)!);
      const occupiedByOthers = globalOccupied(others);

      const selected = this.selectVersion(p, scoring, filled, occupiedByOthers);

      // Persist only when the recompute changed the active version (stability cache).
      if (selected !== p.activeVersion) {
        await this.placementDAL.updateActiveVersion(p.id, selected);
      }

      // Load the SELECTED version's full definition for rendering (self-heals a vanished version).
      const loaded = await this.loadPlacementVersion(userId, p.id, p.templateName, selected);
      layout.push({
        name: p.templateName,
        activeVersion: loaded.version,
        offsetCol: p.offsetCol,
        offsetRow: p.offsetRow,
        width: loaded.width,
        height: loaded.height,
        def: loaded.definition,
        filledPlaceholderIds: [...filled],
      });
    }

    return { layout };
  }

  /**
   * Recompute the active version for one placement from live conditions: score every available
   * version by how many of its conditions (filled placeholder slots + neighbor-abutting border
   * streets) are satisfied, and pick the winner.
   *
   * Delegates to the shared {@link resolvePlacementVersion} — the SAME resolver the placement
   * seal guard ({@link ../dal/shared/continentSeal}) simulates with, so what the spawn algorithm
   * predicts will render is exactly what this read then renders. Pure over the inputs — no DB, no
   * persistence (the caller persists on change).
   */
  private selectVersion(
    placement: TemplatePlacementRow,
    scoring: VersionScoringInputs,
    filled: Set<string>,
    occupiedByOthers: Set<string>,
  ): number {
    return resolvePlacementVersion(
      {
        key: placement.id,
        templateName: placement.templateName,
        offsetCol: placement.offsetCol,
        offsetRow: placement.offsetRow,
        width: scoring.width,
        height: scoring.height,
        placeholderAreas: scoring.placeholderAreas,
        versions: scoring.versions,
        availableVersions: scoring.availableVersions,
        filledPlaceholderIds: filled,
      },
      occupiedByOthers,
    ).version;
  }

  /**
   * Load a placement's persisted version, self-healing if it was deleted from the catalog: on a
   * 404 for the persisted version, fall back to version 0 and re-persist `activeVersion = 0` so
   * subsequent reads are stable. Returns the loaded row (its `version` is the one actually used).
   */
  private async loadPlacementVersion(
    userId: string,
    placementId: string,
    templateName: string,
    activeVersion: number,
  ) {
    try {
      return await this.templateService.getTemplate(userId, templateName, activeVersion);
    } catch (err) {
      if (err instanceof NotFoundError && activeVersion !== 0) {
        // The persisted version is gone (a validator deleted it). Clamp to the base and heal.
        console.warn(
          `[NightMarketWorld] placement ${placementId} (${templateName}) had missing version ${activeVersion}; falling back to version 0.`,
        );
        await this.placementDAL.updateActiveVersion(placementId, 0);
        return await this.templateService.getTemplate(userId, templateName, 0);
      }
      throw err; // hub template genuinely missing, or some other error — surface it
    }
  }

  /**
   * ⚠️ DEPRECATED-ON-ARRIVAL first-load safety net. Idempotently seed the origin hub for a user
   * who has ZERO placements. This covers PRE-EXISTING accounts that predate the canonical
   * account-creation seed (UserService/registration). Once every existing account has a hub row
   * (organic first-load coverage or a one-time backfill), DELETE this branch — new accounts get
   * their hub at creation and never reach here. Do not treat this as load-bearing runtime logic.
   */
  private async seedHubIfAbsent(userId: string): Promise<void> {
    const count = await this.placementDAL.countPlacementsByUser(userId);
    if (count === 0) {
      await this.seedHubPlacement(userId);
    }
  }

  /**
   * Canonical hub seed: insert the origin hub placement (name = hub constant, offset (0,0),
   * version 0). Called once at account creation (permanent path) and by the first-load safety
   * net above. The UNIQUE (userId, offsetCol, offsetRow) index makes a duplicate origin seed a
   * loud error rather than silent double-placement, so callers must only seed a user once.
   */
  async seedHubPlacement(userId: string): Promise<void> {
    await this.placementDAL.insertPlacement(userId, NIGHT_MARKET_HUB_TEMPLATE_NAME, 0, 0, 0);
  }
}
