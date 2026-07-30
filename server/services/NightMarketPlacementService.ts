import { INightMarketPlacementDAL } from '../dal/interfaces/INightMarketPlacementDAL.js';
import {
  NightMarketTemplateService,
  VersionScoringInputs,
  NIGHT_MARKET_HUB_TEMPLATE_NAME,
} from './NightMarketTemplateService.js';
import { placeholderAreaId } from '../dal/shared/versionSelection.js';
import { placeholderUnitSlotsOf } from '../dal/shared/placeholderArea.js';
import { sealsContinent, type SealPlacement } from '../dal/shared/continentSeal.js';
import { unlocksForMinutes } from '../dal/shared/unlockSchedule.js';
import { prunableDanglingPlacements, type PruneRect } from '../dal/shared/templatePrune.js';
import {
  planSpawn,
  deriveAnchors,
  type PlacedTemplate,
  type CatalogVersion,
  type SpawnPlan,
  type SpawnFailure,
  type CandidatePlacement,
  type SpawnTraceEvent,
} from '../dal/shared/templatePlacement.js';
import { TemplatePlacementRow } from '../types/nightMarket.js';

/**
 * The asset an unlock places into a placeholder slot. The legacy asset-unlock pool is retired and
 * the real stand-asset catalog + occupant→stand rendering are a later visual slice
 * (docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md), so every occupant is tagged with this generic id
 * for now — the economy (fill/decay slots) is fully functional; only the sprite is a placeholder.
 */
const GENERIC_OCCUPANT_ASSET_ID = 'occupant-generic';

/** Log prefix for the opt-in placement decision trace (nms Iterate). Grep-able in `docker logs`. */
const TRACE_TAG = '[NightMarket:placement]';

/**
 * Safety cap on how many templates {@link NightMarketPlacementService.ensureFreeSlot} may spawn
 * back-to-back while hunting for one that exposes a free placeholder slot.
 *
 * Not every template carries placeholder areas (pure street/decoration pieces exist), so a single
 * spawn is NOT guaranteed to produce a slot — the grant loop keeps growing the continent until one
 * does. Each spawn makes real progress (the continent strictly grows), so the loop terminates on
 * its own once the catalog offers a placeholder-bearing template; this cap only bounds the
 * pathological case where the anchor algorithm can only ever mate slot-less templates, which would
 * otherwise balloon a user's continent inside one tick. Hitting it logs and defers the remaining
 * entitlement to the next tick (grants are idempotent, so nothing is lost).
 */
const MAX_CONSECUTIVE_SPAWNS_PER_GRANT = 8;

/**
 * Render one {@link SpawnTraceEvent} to human-readable console lines. Lives here (service layer),
 * not in the dep-free geometry engine, because the engine must not own an output format — see
 * {@link ../dal/shared/templatePlacement.SpawnTraceEvent}.
 *
 * Returns LINES rather than printing, because the same text has two sinks and must read identically
 * in both: the server console, and the nms client's devtools console (the lines ride back on the
 * Iterate response as `trace`). Formatting once server-side is what keeps them identical — the
 * client is a dumb printer and never re-derives this text.
 *
 * Only the nms Iterate button turns tracing on (NightMarketSandboxService.iteratePlacement); the
 * live growth path passes no trace at all, so production spawns stay silent apart from the existing
 * `template-match-not-found` warnings.
 */
function formatSpawnTrace(event: SpawnTraceEvent): string[] {
  switch (event.type) {
    case 'anchors':
      return [
        `── anchor queue (${event.anchors.length}), closest-to-origin first ──`,
        ...event.anchors.map(
          (a) =>
            `  #${a.index} ${a.edge}/w${a.width} dist=${a.originDistance} ` +
            `alongStart=${a.globalAlongStart} owner=${a.owner}`,
        ),
        'catalog mateable widths by edge: ' +
          Object.entries(event.catalogWidthsByEdge)
            .map(([edge, widths]) => `${edge}=[${widths.join(',')}]`)
            .join(' '),
      ];
    case 'anchor':
      return [
        `#${event.index} TRY ${event.edge}/w${event.width} dist=${event.originDistance} ` +
          `owner=${event.owner} → ${event.candidateCount} width-matched catalog candidate(s)`,
      ];
    case 'anchor-no-candidates':
      return [
        `#${event.index} SKIP — no catalog template exposes a ${event.neededEdge} anchor of ` +
          `width ${event.neededWidth} (available ${event.neededEdge} widths: [${event.availableWidths.join(',')}]). ` +
          `Widths must match EXACTLY, and the catalog carries one version per template (the richest).`,
      ];
    case 'candidate-rejected':
      return [
        `#${event.index}   ✗ ${event.templateName} v${event.version} @(${event.offsetCol},${event.offsetRow}) ` +
          `— ${event.reason}${event.blocker ? ` vs ${event.blocker}` : ''}` +
          (event.flankedAnchors?.length ? ` would flank [${event.flankedAnchors.join(' ')}]` : ''),
      ];
    case 'candidate-legal':
      return [
        `#${event.index}   ✓ ${event.templateName} v${event.version} @(${event.offsetCol},${event.offsetRow}) ` +
          `${event.isCap ? 'CAP ' : ''}dupAdj=${event.dupAdjacent} runs=${event.matchedRuns} touch=${event.touchCount} spread=${event.spread}`,
      ];
    case 'anchor-winner':
      return [
        `#${event.index} WINNER ${event.chosen.templateName} v${event.chosen.version} ` +
          `@(${event.chosen.offsetCol},${event.chosen.offsetRow}) — bestDupAdj=${event.bestDupAdjacent} ` +
          `bestRuns=${event.bestRuns} bestTouch=${event.bestTouch} bestSpread=${event.bestSpread} ` +
          `randomAmong=${event.survivors}` +
          // Loud for the same reason: a cap ENDS this branch, and it only wins when every legal
          // candidate at the anchor was a one-anchor dead end.
          (event.bestIsCap ? ` ⚠ forced cap (no non-cap candidate — road ends here)` : '') +
          // Loud, because it means the deprioritization had to yield: every legal candidate at this
          // anchor touched a copy of itself. Usually an authoring gap (too few mateable templates).
          (event.bestDupAdjacent > 0 ? ` ⚠ forced duplicate-adjacent (no duplicate-free candidate)` : ''),
      ];
    case 'anchor-failed':
      return [
        `#${event.index} FAILED reason=${event.failure.reason}` +
          (event.failure.sealedCandidates ? ` sealedCandidates=${event.failure.sealedCandidates}` : '') +
          (event.failure.flankedCandidates ? ` flankedCandidates=${event.failure.flankedCandidates}` : ''),
      ];
    case 'exhausted':
      return ['EXHAUSTED — no legal placement at any exposed anchor'];
  }
}

/** Summary of one grant pass — how the entitlement gap was closed (for logging/telemetry). */
export interface GrantResult {
  /** The entitlement the schedule maps `totalMinutePoints` to. */
  target: number;
  /** New occupants placed into slots this pass. */
  granted: number;
  /** New templates spawned onto the continent this pass (to make room for occupants). */
  spawned: number;
  /** The user's occupant count after the pass. */
  total: number;
}

/**
 * The minimum a placed template must expose for {@link NightMarketPlacementService.planNextPlacement}
 * to treat it as part of the layout being grown. Structurally satisfied by both a
 * `nightmarkettemplatelocations` row (the real continent) and a `nightmarkettemplatesandbox` row
 * (an author's scratch layout).
 */
export interface SpawnSourcePlacement {
  id: string;
  templateName: string;
  activeVersion: number;
  offsetCol: number;
  offsetRow: number;
}

/** A slot an occupant landed in (or would). */
export interface PlacedSlot {
  placementId: string;
  placeholderAreaId: string;
}

/**
 * Night Market PLACEMENT Service — the WRITE side of the template runtime (Slices 3–4,
 * docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md; algorithm spec: NIGHT_MARKET_TEMPLATES.md
 * § "Tiling & Placement" + § "Unlock economy").
 *
 * LAYER: service. Turns earned minutes into placed occupants and, when the continent is full,
 * grows it with a new template. Reads/writes placements + occupants via {@link INightMarketPlacementDAL}
 * and resolves template geometry via {@link NightMarketTemplateService}; the spawn geometry itself
 * is the pure {@link ../dal/shared/templatePlacement} engine.
 *
 * Entry points:
 *   • {@link grantUnlocks} — idempotent reconcile: fill unit slots up to the schedule's entitlement
 *     for the user's current minutes, growing the continent ONLY when an unlock finds no free slot
 *     (lazy spawn). Safe to call on every minute tick.
 *   • {@link ensureFreeSlot} — guarantee a free slot exists, growing the continent if it doesn't.
 *   • {@link placeUnlock} — fill exactly one free slot across all placements (null when full; does
 *     not grow the continent).
 *   • {@link spawnTemplate} — run the anchor algorithm once and persist the new placement.
 *
 * Version selection is NOT this service's job: it inserts/omits occupant rows and appends
 * placements at activeVersion 0; the next layout read (NightMarketWorldService, recompute-on-read)
 * settles each placement's active version from the live occupant/neighbor state.
 */
export class NightMarketPlacementService {
  constructor(
    private placementDAL: INightMarketPlacementDAL,
    private templateService: NightMarketTemplateService,
  ) {}

  /**
   * Two-way reconcile of a user's occupants to their entitlement `unlocks(netMinutePoints)`:
   * GRANT (fill/spawn) when under, DECAY (remove newest occupants) when over. This is the single
   * "make the world match the balance" entry point — used by the author minute-adjust tool and any
   * future live balance change. `grantUnlocks` is the grant-only half (still called every study
   * tick, where the balance only rises). Returns the resulting occupant count.
   */
  async reconcileUnlocks(userId: string, language: string, netMinutePoints: number): Promise<{ target: number; total: number }> {
    const target = unlocksForMinutes(netMinutePoints);
    const current = await this.placementDAL.countOccupantsByUser(userId, language);

    if (current > target) {
      // Over entitlement (points were lost) → trim the surplus occupants, then prune any template
      // that decay left empty AND weakly attached (see pruneDanglingTemplates). Emptying a stall can
      // strand its whole template on the fringe; we shrink the continent to match the lost content.
      await this.placementDAL.deleteSurplusOccupants(userId, language, target);
      await this.pruneDanglingTemplates(userId, language);
      return { target, total: target };
    }

    // At/under entitlement → the grant path fills/spawns up to target (no-op when already there).
    const result = await this.grantUnlocks(userId, language, netMinutePoints);
    return { target, total: result.total };
  }

  /**
   * Decay-time cleanup: iteratively remove PLACEMENTS that decay has left both EMPTY and only
   * weakly attached to the rest of the continent, until no more qualify (a fixpoint).
   *
   * A placement is removable when ALL hold:
   *   • it holds **0 occupants** (every placeholder slot is empty — nothing is lost visually);
   *   • it is **not the starter hub** ({@link NIGHT_MARKET_HUB_TEMPLATE_NAME}, always kept);
   *   • its touched sides are **{0, 1, or 2 ADJACENT}** — never an opposing pair. Concretely
   *     `!(hasEast && hasWest) && !(hasHigh && hasLow)`: at most one neighbour per axis. This
   *     both (a) leaves well-anchored interior pieces (3–4 sides) alone and (b) never removes a
   *     corridor/bridge (two OPPOSITE sides), so pruning can't sever the continent in two.
   *
   * A "touched side" is a same-owner neighbouring placement whose rectangle sits flush against
   * that edge with the perpendicular span overlapping. Removing one placement only ever REDUCES a
   * neighbour's touched-side set, so the predicate is monotonic and the fixpoint is order-
   * independent — we can peel every currently-removable placement each pass and re-evaluate until a
   * pass removes nothing. Placement counts per user are tiny (tens), so the O(n²)/pass scan is cheap.
   *
   * Runs on every DECAY (see {@link reconcileUnlocks}) — the author minute-loss tool today, plus the
   * inactivity cron via its companion prune script. Occupants cascade with the placement (they are
   * zero here by the empty rule). Returns the ids removed. NOTE: this deliberately REVERSES the old
   * "placements are append-only, never removed" invariant (migration 112 / streak-cron docs).
   */
  async pruneDanglingTemplates(userId: string, language: string): Promise<{ removedIds: string[] }> {
    const placements = await this.placementDAL.findPlacementsByUser(userId, language);
    if (placements.length === 0) return { removedIds: [] };

    // Per-placement occupant count (empty test) — group the user's occupants by placement.
    const occupants = await this.placementDAL.findOccupantsByUser(userId, language);
    const occCount = new Map<string, number>();
    for (const o of occupants) {
      occCount.set(o.placedTemplateId, (occCount.get(o.placedTemplateId) ?? 0) + 1);
    }

    // Each placement's rectangle in continent-cell units: [colMin,colMax) × [rowMin,rowMax).
    // Dims come from the template definition (v0 board size), cached across repeated names.
    const scoringCache = new Map<string, VersionScoringInputs>();
    const rects: PruneRect[] = [];
    for (const p of placements) {
      const scoring = await this.scoringFor(p.templateName, scoringCache);
      rects.push({
        id: p.id,
        templateName: p.templateName,
        colMin: p.offsetCol,
        colMax: p.offsetCol + scoring.width,
        rowMin: p.offsetRow,
        rowMax: p.offsetRow + scoring.height,
      });
    }

    // Pure adjacency fixpoint (unit-tested in templatePrune.ts) decides what to cull.
    const removedIds = prunableDanglingPlacements(rects, occCount, NIGHT_MARKET_HUB_TEMPLATE_NAME);
    if (removedIds.length > 0) {
      await this.placementDAL.deletePlacements(userId, removedIds);
    }
    return { removedIds };
  }

  /**
   * Reconcile a user's occupant count up to their entitlement `unlocks(netMinutePoints)`.
   *
   * LAZY-SPAWN MODEL (decision 2026-07-29, docs/NIGHT_MARKET_TEMPLATES.md § "Unlock economy").
   * The continent grows ONLY on demand: a template is placed at the moment an unlock needs a slot
   * and the continent has none left, and that same unlock then occupies a slot in the new template.
   * Nothing is placed speculatively — the continent never carries a template the user has not yet
   * earned something on. Growing is still FREE (it never consumes an unlock), so the invariant
   * `occupantCount === unlocks(m)` holds and nothing about decay, the cron's `unlocks(m)` target, or
   * the schedule is involved.
   *
   * The pass is therefore just: while under target, `ensureFreeSlot` (which spawns only when nothing
   * is free) → occupy that slot. Nothing runs after the loop.
   *
   * (An earlier build spawned EAGERLY — one extra pass after the loop so the next template stood
   * ready and empty before it was earned. That was reverted: it put unearned templates on screen.
   * With one unlock per UNIT slot, a freshly spawned template still fills up gradually — its first
   * unit is taken by the unlock that triggered the spawn, and the rest light up one at a time.)
   *
   * Each iteration makes guaranteed progress (a fill, or a break), so it always terminates; only an
   * impossible spawn (no legal placement) or the spawn cap stops the pass early. Idempotent: when
   * already at target it does nothing, and a deferred pass simply resumes on the next tick.
   * GRANT-ONLY — use {@link reconcileUnlocks} when the balance may have DROPPED (it also decays).
   */
  async grantUnlocks(userId: string, language: string, netMinutePoints: number): Promise<GrantResult> {
    const target = unlocksForMinutes(netMinutePoints);
    let current = await this.placementDAL.countOccupantsByUser(userId, language);

    let granted = 0;
    let spawned = 0;

    while (current < target) {
      // Growth on demand: this spawns ONLY when the continent has no free unit slot left — the
      // unlock about to be placed is what pays for (well, triggers) the new template.
      const vacancy = await this.ensureFreeSlot(userId, language, current, target);
      spawned += vacancy.spawned;
      if (!vacancy.slot) {
        // No legal spawn, or the cap burned on slot-less templates (both already logged). Stop the
        // pass; the next tick retries (grants are idempotent and the entitlement gap persists).
        break;
      }

      await this.placementDAL.insertOccupant(
        userId,
        language,
        vacancy.slot.placementId,
        vacancy.slot.placeholderAreaId,
        GENERIC_OCCUPANT_ASSET_ID,
      );
      current++;
      granted++;
    }

    return { target, granted, spawned, total: current };
  }

  /**
   * Guarantee the continent exposes at least one free placeholder slot, growing it if it does not,
   * and return that slot (`null` when growth is impossible or capped).
   *
   * A spawn is NOT guaranteed to produce a slot: not every template carries placeholder areas (pure
   * street/decoration pieces exist) and the anchor algorithm picks by geometry, not slot count. So
   * this keeps spawning until a slot appears, bounded by {@link MAX_CONSECUTIVE_SPAWNS_PER_GRANT} —
   * every spawn strictly grows the continent, so the hunt ends as soon as the catalog offers a
   * placeholder-bearing mate. `current`/`target` are for the cap log only.
   */
  async ensureFreeSlot(
    userId: string,
    language: string,
    current?: number,
    target?: number,
  ): Promise<{ slot: PlacedSlot | null; spawned: number }> {
    let slot = await this.findFreeSlot(userId, language);
    let spawned = 0;

    // Nothing placed yet (an account whose starter hub has not been seeded — seeding happens on
    // account creation / first layout read): there is no anchor to grow from, so spawning could only
    // fail noisily every tick. Leave it to the seed; the next pass grows normally.
    if (!slot && (await this.placementDAL.countPlacementsByUser(userId, language)) === 0) {
      return { slot: null, spawned: 0 };
    }

    while (!slot && spawned < MAX_CONSECUTIVE_SPAWNS_PER_GRANT) {
      const row = await this.spawnTemplate(userId, language);
      if (!row) break; // no legal spawn (logged in spawnTemplate) — can't grow further
      spawned++;
      slot = await this.findFreeSlot(userId, language);
    }

    if (!slot && spawned >= MAX_CONSECUTIVE_SPAWNS_PER_GRANT) {
      console.warn(
        `[NightMarket] grant-spawn-cap user=${userId.substring(0, 8)}… ` +
          `spawned=${spawned} without exposing a free placeholder slot; ` +
          `current=${current ?? '?'} target=${target ?? '?'} — deferring the remaining entitlement`,
      );
    }

    return { slot, spawned };
  }

  /**
   * Fill the FIRST free placeholder slot across the user's placements. Thin wrapper over
   * {@link findFreeSlot} + occupant insert; does NOT grow the continent, so it returns `null` when
   * every slot is occupied. (The grant loop uses {@link ensureFreeSlot} + insert directly so it
   * doesn't re-scan for the slot it was just handed.)
   */
  async placeUnlock(userId: string, language: string): Promise<PlacedSlot | null> {
    const slot = await this.findFreeSlot(userId, language);
    if (!slot) return null;
    await this.placementDAL.insertOccupant(
      userId,
      language,
      slot.placementId,
      slot.placeholderAreaId,
      GENERIC_OCCUPANT_ASSET_ID,
    );
    return slot;
  }

  /**
   * The FIRST free placeholder slot across the user's placements (placement creation order, then
   * the template's stored area order, then each area's unit order — deterministic), or `null` when
   * every slot is occupied. Read-only: this is the "is there room?" probe both {@link placeUnlock}
   * and {@link ensureFreeSlot} share, so occupancy is decided in exactly one place.
   *
   * ONE UNLOCK = ONE UNIT SLOT. An authored area is split by
   * {@link ../dal/shared/placeholderArea placeholderUnitSlots} into
   * occupant-sized (4×5 / 5×4) units, so a double-sized 4×10/10×4 area is TWO slots that fill one
   * at a time. Iterating whole areas here is what used to make a single earned minute occupy both
   * halves of such an area at once.
   */
  private async findFreeSlot(userId: string, language: string): Promise<PlacedSlot | null> {
    const placements = await this.placementDAL.findPlacementsByUser(userId, language);
    const filled = await this.filledByPlacement(userId, language);
    const scoringCache = new Map<string, VersionScoringInputs>();

    for (const p of placements) {
      const scoring = await this.scoringFor(p.templateName, scoringCache);
      const occupied = filled.get(p.id) ?? new Set<string>();
      for (const unit of placeholderUnitSlotsOf(scoring.placeholderAreas)) {
        const slotId = placeholderAreaId(unit);
        if (!occupied.has(slotId)) return { placementId: p.id, placeholderAreaId: slotId };
      }
    }

    return null;
  }

  /**
   * Grow the continent by one template: run the pure anchor algorithm ({@link planSpawn}) against
   * the user's current placements + the v0 catalog, and persist the chosen placement (at
   * activeVersion 0 — recompute-on-read settles its real version). Emits a `template-match-not-found`
   * log for each failed anchor. Returns the new placement row, or `null` when no legal spawn exists.
   */
  async spawnTemplate(userId: string, language: string): Promise<TemplatePlacementRow | null> {
    const placements = await this.placementDAL.findPlacementsByUser(userId, language);
    // Real occupants matter to the seal guard: a filled slot can flip a placement to a version
    // whose street mask closes an edge, so the simulation must see the live fill state.
    const filled = await this.filledByPlacement(userId, language);
    const { plan, failures, placed } = await this.planNextPlacement(placements, filled);

    // Structured diagnostics — one line per anchor that yielded no legal candidate (spec logging).
    for (const failure of failures) {
      console.warn(
        `[NightMarket] template-match-not-found user=${userId.substring(0, 8)}… ` +
          `reason=${failure.reason}` +
          (failure.edge ? ` anchor=${failure.edge}/${failure.width}@dist${failure.originDistance}` : '') +
          (failure.sealedCandidates ? ` sealedCandidates=${failure.sealedCandidates}` : '') +
          ` layout=[${placed.map((p) => `${p.templateName}@(${p.offsetCol},${p.offsetRow})`).join(', ')}]`,
      );
    }

    if (!plan) return null;
    return this.placementDAL.insertPlacement(userId, language, plan.templateName, plan.version, plan.offsetCol, plan.offsetRow);
  }

  /**
   * Run the pure spawn algorithm ({@link planSpawn}) over ANY layout of placed templates and return
   * the winning placement WITHOUT persisting it. Split out of {@link spawnTemplate} so the template
   * SANDBOX (NightMarketSandboxService.iteratePlacement) can step the very same algorithm over an
   * author's scratch layout — the sandbox's whole purpose is previewing what the runtime would do,
   * so the two must never diverge into separate implementations.
   *
   * `placements` is any surface's rows (the user's continent, or a sandbox layout); the caller
   * decides what to do with the plan. `placed` is returned alongside for the failure logs.
   *
   * `filledByPlacement` (optional, `placementId → filled placeholder-area ids`) feeds the SEAL
   * guard's version simulation. The live continent passes its real occupants; the author sandbox
   * has no occupant rows and passes nothing (every slot reads as empty) — the guard itself is
   * identical on both surfaces.
   */
  async planNextPlacement(
    placements: readonly SpawnSourcePlacement[],
    filledByPlacement?: ReadonlyMap<string, Set<string>>,
    options?: { trace?: boolean },
  ): Promise<{ plan: SpawnPlan | null; failures: SpawnFailure[]; placed: PlacedTemplate[]; trace: string[] }> {
    // Collected decision lines (empty unless `options.trace`). Mirrored to the server console AND
    // returned, so the nms client can replay the exact same text into the browser console.
    const traceLines: string[] = [];
    const emit = (lines: string[]): void => {
      for (const line of lines) {
        traceLines.push(line);
        console.log(`${TRACE_TAG} ${line}`);
      }
    };
    const scoringCache = new Map<string, VersionScoringInputs>();

    // Existing continent: each placement rendered at its persisted active version's street mask.
    const placed: PlacedTemplate[] = [];
    for (const p of placements) {
      const scoring = await this.scoringFor(p.templateName, scoringCache);
      const ver = scoring.versions.find((v) => v.version === p.activeVersion) ?? scoring.versions[0];
      placed.push({
        id: p.id,
        templateName: p.templateName,
        activeVersion: p.activeVersion,
        offsetCol: p.offsetCol,
        offsetRow: p.offsetRow,
        width: scoring.width,
        height: scoring.height,
        street: ver?.street ?? new Set<string>(),
      });
    }

    // Candidate catalog: one entry per authored template, matched at its MOST-CONDITIONED version —
    // NOT the base v0. The base is a template's EMPTY state (no streets → no anchors), so matching on
    // it makes almost everything untileable; a template's full road connectivity — hence every edge it
    // could tile against — lives in its condition-rich versions. We pick the version with the largest
    // `condition` mask to reflect the template's maximum attachment potential. The actual render
    // version is chosen AFTER the template is placed, by the version selector (recompute-on-read), so
    // this choice governs CANDIDACY only, not what finally renders.
    //
    // The starter hub is SEED-ONLY: exactly one hub exists per user, planted at the origin (0,0) by
    // seedHubPlacement, and must never be spawned again by the growth algorithm (that produced the
    // duplicate-hub layouts). So it is filtered out of the spawn candidates here.
    const names = (await this.templateService.getCatalogNames()).filter(
      (name) => name !== NIGHT_MARKET_HUB_TEMPLATE_NAME,
    );
    const catalog: CatalogVersion[] = [];
    for (const name of names) {
      const scoring = await this.scoringFor(name, scoringCache);
      if (scoring.versions.length === 0) continue;
      // Richest = max condition-cell count; ties keep the earliest (lowest version) for determinism.
      const richest = scoring.versions.reduce((best, v) =>
        v.condition.size > best.condition.size ? v : best,
      );
      catalog.push({
        templateName: name,
        version: richest.version,
        width: scoring.width,
        height: scoring.height,
        street: richest.street,
        anchors: deriveAnchors(richest.street, scoring.width, scoring.height),
      });
    }

    // The existing world as the seal simulation sees it — EVERY authored version of each placed
    // name, so the guard can re-select each neighbour's final version after the candidate lands.
    const sealWorld: SealPlacement[] = placements.map((p) =>
      this.toSealPlacement(p.id, p.templateName, p.offsetCol, p.offsetRow, scoringCache.get(p.templateName)!, filledByPlacement?.get(p.id)),
    );

    /**
     * The growth-safety veto (docs/NIGHT_MARKET_TEMPLATES.md § "The seal constraint"): simulate the
     * post-placement world at every placement's FINAL version and forbid the candidate if not one
     * open (unabutting) border-street condition survives anywhere. Synchronous because every
     * template name it can be asked about — placed names and catalog names — is already in
     * `scoringCache` by the time `planSpawn` runs.
     */
    const sealCheck = (candidate: CandidatePlacement): boolean => {
      const scoring = scoringCache.get(candidate.templateName);
      if (!scoring) return false; // unreachable (the catalog loop cached it); never veto blindly
      const candidateSeal = this.toSealPlacement(
        // A not-yet-persisted candidate needs a key unique within this simulation only.
        `candidate:${candidate.templateName}@${candidate.offsetCol},${candidate.offsetRow}`,
        candidate.templateName,
        candidate.offsetCol,
        candidate.offsetRow,
        scoring,
        undefined, // a fresh placement holds no occupants yet
      );
      return sealsContinent([...sealWorld, candidateSeal]);
    };

    if (options?.trace) {
      // The inputs the anchor queue is derived from — without these the per-anchor lines have no
      // frame of reference (origin (0,0) is the seeded hub's SW corner, not the continent centre).
      emit([
        `══ plan start ══ placed=${placed.length} catalog=${catalog.length}`,
        ...placed.map(
          (p) =>
            `  placed ${p.templateName} v${p.activeVersion} @(${p.offsetCol},${p.offsetRow}) ` +
            `${p.width}×${p.height} streetCells=${p.street.size}`,
        ),
        'catalog (richest version per template):',
        ...catalog.map(
          (c) =>
            `  ${c.templateName} v${c.version} ${c.width}×${c.height} anchors=[` +
            c.anchors.map((a) => `${a.edge}/w${a.width}@${a.alongStart}`).join(' ') +
            ']',
        ),
      ]);
    }

    const { plan, failures } = planSpawn(
      placed,
      catalog,
      Math.random,
      sealCheck,
      options?.trace ? (event) => emit(formatSpawnTrace(event)) : undefined,
    );
    return { plan, failures, placed, trace: traceLines };
  }

  /** Build one {@link SealPlacement} from a placement's coordinates + its template's scoring inputs. */
  private toSealPlacement(
    key: string,
    templateName: string,
    offsetCol: number,
    offsetRow: number,
    scoring: VersionScoringInputs,
    filled: Set<string> | undefined,
  ): SealPlacement {
    return {
      key,
      templateName,
      offsetCol,
      offsetRow,
      width: scoring.width,
      height: scoring.height,
      placeholderAreas: scoring.placeholderAreas,
      versions: scoring.versions,
      availableVersions: scoring.availableVersions,
      filledPlaceholderIds: filled ?? new Set<string>(),
    };
  }

  // ── internals ───────────────────────────────────────────────────────────────────────────

  /** Group a user's occupants into `placementId → Set<placeholderAreaId>` (the filled slots). */
  private async filledByPlacement(userId: string, language: string): Promise<Map<string, Set<string>>> {
    const occupants = await this.placementDAL.findOccupantsByUser(userId, language);
    const filled = new Map<string, Set<string>>();
    for (const o of occupants) {
      const set = filled.get(o.placedTemplateId) ?? new Set<string>();
      set.add(o.placeholderAreaId);
      filled.set(o.placedTemplateId, set);
    }
    return filled;
  }

  /** Cache-backed scoring-inputs load (placements/catalog often reuse a name within one call). */
  private async scoringFor(name: string, cache: Map<string, VersionScoringInputs>): Promise<VersionScoringInputs> {
    let scoring = cache.get(name);
    if (!scoring) {
      scoring = await this.templateService.getVersionScoringInputs(name);
      cache.set(name, scoring);
    }
    return scoring;
  }
}
