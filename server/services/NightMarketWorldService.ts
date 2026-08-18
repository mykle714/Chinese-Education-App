import { INightMarketPlacementDAL } from '../dal/interfaces/INightMarketPlacementDAL.js';
import {
  NightMarketTemplateService,
  NIGHT_MARKET_HUB_TEMPLATE_NAME,
  TemplateDefinition,
  VersionScoringInputs,
} from './NightMarketTemplateService.js';
import { globalOccupiedRects } from '../dal/shared/versionSelection.js';
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

/** Response for GET /api/nightMarket/layout. */
export interface UserLayoutResponse {
  layout: PlacedTemplatePayload[];
}

/**
 * One loaded template version, plus whether loading it had to fall back to version 0 because the
 * requested version no longer exists. See {@link NightMarketWorldService.loadVersionDefinition}
 * for why the fallback is REPORTED rather than repaired in place.
 */
interface LoadedVersion {
  row: Awaited<ReturnType<NightMarketTemplateService['getTemplate']>>;
  healed: boolean;
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
   * ONE MARKET's rendered layout — the user's continent for `language`. Seeds the origin hub if
   * that market has no placements (see {@link seedHubPlacement}), recomputes+persists each
   * placement's active version from live conditions, then materializes every placement into a
   * {@link PlacedTemplatePayload}.
   *
   * QUERY SHAPE. This is the single hottest read in the night market — every nmp mount, every
   * language switch, every author minute-adjust. It is written to keep its round-trip DEPTH flat
   * rather than proportional to continent size: the placement/occupant reads go out together, the
   * per-name scoring reads fan out with `Promise.all`, the version persists are batched, and the
   * definition loads are de-duplicated by (name, version) before being fanned out. Previously each
   * of those was a serial `await` inside a per-placement loop, so a 20-placement continent took
   * ~45 sequential queries; it is now a handful regardless of size. Keep it that way — an `await`
   * added inside a loop here is a latency regression that scales with how much a user has played.
   */
  async getUserLayout(
    userId: string,
    language: string,
    options: { seedIfEmpty?: boolean } = {}
  ): Promise<UserLayoutResponse> {
    // VISITOR READS MUST NOT WRITE. When one user opens another's market
    // (docs/USER_PROFILE_PAGE.md § Night market visit) the seeding branch below is
    // suppressed: seeding is a write, and a stranger's page view must never
    // materialise a hub in someone else's world. A visited market with no placements
    // simply comes back empty and the client says so.
    const seedIfEmpty = options.seedIfEmpty !== false;
    // Independent reads — issue them together rather than stacking two round trips.
    let [placements, occupants] = await Promise.all([
      this.placementDAL.findPlacementsByUser(userId, language),
      this.placementDAL.findOccupantsByUser(userId, language),
    ]);

    // First-load safety net: guarantee every user has a hub IN THIS MARKET, even pre-existing
    // accounts that predate the account-creation seed (see seedHubIfAbsent). Since migration 130
    // each language has its own continent, so each also gets its own hub on first read.
    //
    // Driven off the placements read rather than its own COUNT: "has no placements" is already
    // answered above, so the previous `seedHubIfAbsent` pre-check was a query on EVERY layout
    // read to detect a condition that is true at most once per (user, language). The extra
    // re-read below is paid only on that one first load.
    if (placements.length === 0 && seedIfEmpty) {
      await this.seedHubPlacement(userId, language);
      placements = await this.placementDAL.findPlacementsByUser(userId, language);
    }

    // Group occupants by placement so each placement's filled-slot set is its own.
    const filledByPlacement = new Map<string, Set<string>>();
    for (const occ of occupants) {
      const set = filledByPlacement.get(occ.placedTemplateId) ?? new Set<string>();
      set.add(occ.placeholderAreaId);
      filledByPlacement.set(occ.placedTemplateId, set);
    }

    // Load each DISTINCT template's per-version scoring masks once — a tiled continent reuses the
    // same handful of templates, so this is far fewer reads than placements. Fanned out with
    // Promise.all: they are independent, and awaiting them in a loop made the layout read's
    // latency scale with the catalog's variety for no reason.
    const distinctNames = [...new Set(placements.map((p) => p.templateName))];
    const scoringByName = new Map<string, VersionScoringInputs>(
      await Promise.all(
        distinctNames.map(async (name) =>
          [name, await this.templateService.getVersionScoringInputs(name)] as const,
        ),
      ),
    );

    // ONE global occupancy union for the whole continent, not one per placement.
    //
    // This used to rebuild an "everyone but me" union inside the per-placement loop, making the
    // read O(N² · cells) — with N placements of w×h cells, N × (N−1) × w × h cell keys encoded,
    // parsed and re-encoded on every layout GET. Passing the single full union (this placement
    // included) is EQUIVALENT, because the only consumer probes strictly outward from board-edge
    // cells and so can never see its own footprint — the invariant is spelled out, with its
    // rectangular-footprint precondition, at {@link globalOccupiedRects}.
    const occupied = globalOccupiedRects(
      placements.map((p) => {
        const dims = scoringByName.get(p.templateName)!;
        return {
          offsetCol: p.offsetCol,
          offsetRow: p.offsetRow,
          width: dims.width,
          height: dims.height,
        };
      }),
    );

    // Recompute every placement's version first (pure + synchronous), so the DB work below can be
    // batched instead of interleaved one placement at a time.
    const selectedByPlacement = placements.map((p) => {
      const filled = filledByPlacement.get(p.id) ?? new Set<string>();
      return {
        placement: p,
        filled,
        selected: this.selectVersion(p, scoringByName.get(p.templateName)!, filled, occupied),
      };
    });

    // Persist only the placements whose recompute actually changed the active version (the
    // persisted value is a stability cache, not the source of truth). Fired together: on a steady
    // continent this list is empty and costs nothing.
    await Promise.all(
      selectedByPlacement
        .filter(({ placement, selected }) => selected !== placement.activeVersion)
        .map(({ placement, selected }) => this.placementDAL.updateActiveVersion(placement.id, selected)),
    );

    // Load each placement's SELECTED version definition, de-duplicated by (name, version): a
    // continent typically tiles a few templates many times, so this collapses ~2 queries per
    // PLACEMENT into ~2 per distinct (name, version) pair. Caching the PROMISE (not the resolved
    // row) also collapses concurrent asks for the same pair into a single in-flight query.
    //
    // Request-scoped on purpose. A process-wide catalog cache would be a bigger win still - the
    // catalog is account-independent and every user's layout read re-fetches it - but it is
    // MUTABLE (the template editor writes it) and would need explicit invalidation on save. That
    // is a worthwhile follow-up, not something to smuggle in here.
    //
    // The cache holds only the version FETCH, which is a pure function of (name, version). The
    // self-heal WRITE is deliberately kept OUTSIDE it: several placements can share a vanished
    // version, and a cached heal would repair only whichever placement happened to ask first.
    const definitionCache = new Map<string, Promise<LoadedVersion>>();
    const loadCached = (name: string, version: number) => {
      const cacheKey = `${name}\u0000${version}`; // NUL-separated - names may contain anything
      let pending = definitionCache.get(cacheKey);
      if (!pending) {
        pending = this.loadVersionDefinition(userId, name, version);
        definitionCache.set(cacheKey, pending);
      }
      return pending;
    };

    const loadedByPlacement = await Promise.all(
      selectedByPlacement.map(async (entry) => ({
        ...entry,
        loaded: await loadCached(entry.placement.templateName, entry.selected),
      })),
    );

    // Self-heal, PER PLACEMENT: a placement whose selected version turned out to be missing is
    // re-pointed at version 0 so the next read is stable. Normally a no-op - `selected` is drawn
    // from the catalog's live `availableVersions`, so this only fires if a version is deleted
    // between the scoring read and the definition read.
    await Promise.all(
      loadedByPlacement
        .filter(({ loaded }) => loaded.healed)
        .map(({ placement }) => this.placementDAL.updateActiveVersion(placement.id, 0)),
    );

    const layout: PlacedTemplatePayload[] = loadedByPlacement.map(
      ({ placement: p, filled, loaded }) => ({
        name: p.templateName,
        activeVersion: loaded.row.version,
        offsetCol: p.offsetCol,
        offsetRow: p.offsetRow,
        width: loaded.row.width,
        height: loaded.row.height,
        def: loaded.row.definition,
        filledPlaceholderIds: [...filled],
      }),
    );

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
   * Load ONE (template name, version) definition, falling back to version 0 if that version was
   * deleted from the catalog. Returns the loaded row plus a `healed` flag saying the fallback was
   * taken.
   *
   * PURE OVER (name, version) BY DESIGN. The old shape took a `placementId` and performed the
   * `activeVersion = 0` repair write itself, which made it un-cacheable: a continent tiles the
   * same template many times, and de-duplicating the read would then have silently repaired only
   * the first placement that asked. Reporting `healed` and letting the CALLER write the repair for
   * every affected placement keeps the fetch cacheable and the heal complete.
   */
  private async loadVersionDefinition(
    userId: string,
    templateName: string,
    version: number,
  ): Promise<LoadedVersion> {
    try {
      return { row: await this.templateService.getTemplate(userId, templateName, version), healed: false };
    } catch (err) {
      if (err instanceof NotFoundError && version !== 0) {
        // The version is gone (a validator deleted it). Clamp to the base; caller persists it.
        console.warn(
          `[NightMarketWorld] template ${templateName} is missing version ${version}; falling back to version 0.`,
        );
        return { row: await this.templateService.getTemplate(userId, templateName, 0), healed: true };
      }
      throw err; // hub template genuinely missing, or some other error - surface it
    }
  }

  /**
   * Canonical hub seed: insert the origin hub placement (name = hub constant, offset (0,0),
   * version 0) for ONE MARKET. Called once at account creation (permanent path) and by the
   * first-load safety net above. The UNIQUE (userId, language, offsetCol, offsetRow) index makes a
   * duplicate origin seed a loud error rather than silent double-placement, so callers must only
   * seed a given (user, language) once — but every language legitimately gets its own hub at (0,0).
   */
  async seedHubPlacement(userId: string, language: string): Promise<void> {
    await this.placementDAL.insertPlacement(userId, language, NIGHT_MARKET_HUB_TEMPLATE_NAME, 0, 0, 0);
  }
}
