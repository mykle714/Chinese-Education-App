/**
 * continentSeal — the GROWTH-SAFETY invariant for template placement
 * (docs/NIGHT_MARKET_TEMPLATES.md § "Placement algorithm" → the seal constraint).
 *
 * LAYER: dep-free shared engine (same `server/dal/shared/*` family as versionSelection +
 * templatePlacement). No DB, no React, no assets.
 *
 * ── The invariant ───────────────────────────────────────────────────────────────────────
 * A continent must ALWAYS retain at least one OPEN street condition: a border-street condition
 * island — on the version that will actually render — whose outer edge does NOT abut a neighbor.
 * That open stub is exactly what {@link ./templatePlacement.exposedAnchors} later offers as an
 * attachment point, so a continent with zero of them is SEALED: it can never grow again, and the
 * unlock economy silently stalls the moment the last slot fills.
 *
 * A placement can seal the continent in two ways, and this module catches both because it
 * re-derives the FINAL rendered version of every placement:
 *   1. directly — the new template plugs the last open stub and exposes none of its own;
 *   2. indirectly — abutting a neighbor flips THAT neighbor to a higher-scoring version whose
 *      street mask closes the edge that used to be open.
 * Case 2 is why we cannot just count exposed anchors at the placements' persisted versions: the
 * persisted version is only a stability cache, and the next layout read re-selects it
 * (NightMarketWorldService, recompute-on-read).
 *
 * ── No fixpoint ─────────────────────────────────────────────────────────────────────────
 * Version selection keys on neighbor FOOTPRINTS, not neighbor versions (see the versionSelection
 * module doc), so resolving the whole world takes a single pass — this simulation is exact, not
 * iterative.
 *
 * DEPENDS ON: {@link ./versionSelection} (analyzeConditions, abuttingBorderIslandIds,
 * conditionScoreSelector, globalOccupied, boardCells).
 * CONSUMED BY: {@link ./templatePlacement.planSpawn} via the injected `sealCheck` predicate,
 * wired by {@link ../../services/NightMarketPlacementService.planNextPlacement} — so BOTH the
 * live continent and the author sandbox's Iterate run the identical rule.
 */

import {
  analyzeConditions,
  abuttingBorderIslandIds,
  boardCells,
  conditionScoreSelector,
  globalOccupied,
  type PlacementOccupancy,
  type VersionConditionState,
} from './versionSelection.js';
import type { PlaceholderArea } from './placeholderArea.js';

/**
 * One placement as the seal simulation sees it: where it sits, its shared board geometry, EVERY
 * authored version's masks (the selector needs them all), and which of its placeholder slots an
 * occupant currently fills. Structurally satisfied by a live continent row + its template's
 * {@link ../../services/NightMarketTemplateService.VersionScoringInputs}, and by a candidate
 * placement not yet persisted (its `filledPlaceholderIds` is empty — nothing has unlocked in it).
 */
export interface SealPlacement {
  /** Stable identity within one simulation (placement row id, or any unique candidate key). */
  key: string;
  templateName: string;
  offsetCol: number;
  offsetRow: number;
  width: number;
  height: number;
  /** The shared (version-0) placeholder areas of this template name. */
  placeholderAreas: readonly PlaceholderArea[];
  /** Every authored version's street + condition masks, LOCAL coords. */
  versions: ReadonlyArray<{ version: number; street: Set<string>; condition: Set<string> }>;
  /** The version numbers the selector may choose among (normally `versions.map(v => v.version)`). */
  availableVersions: number[];
  /** Placeholder-area ids ("col_row") currently filled by an occupant in THIS placement. */
  filledPlaceholderIds: Set<string>;
}

/** One border-street condition that is NOT satisfied on a placement's final rendered version. */
export interface OpenStreetCondition {
  /** {@link SealPlacement.key} of the placement carrying the open stub. */
  placementKey: string;
  templateName: string;
  /** The final version selected for that placement (the one the stub was counted on). */
  version: number;
  /** Condition-island id (`"col_row"`) within that version's analyzed mask. */
  islandId: string;
}

/** A placement's resolved render state after the whole-world version pass. */
export interface ResolvedPlacementVersion {
  version: number;
  /** Per-version condition state, keyed by version number (the selector's scoring input). */
  byVersion: Map<number, VersionConditionState>;
}

/**
 * Resolve ONE placement's active version against a fixed neighbor occupancy: analyze every
 * authored version's conditions, resolve which of its border-street islands abut, and score.
 *
 * This is the single implementation of "which version does this placement render at" — the
 * layout read ({@link ../../services/NightMarketWorldService}) and the seal simulation both call
 * it, so recompute-on-read and the placement constraint can never disagree.
 */
export function resolvePlacementVersion(
  placement: SealPlacement,
  occupiedByOthers: Set<string>,
): ResolvedPlacementVersion {
  const byVersion = new Map<number, VersionConditionState>();

  for (const v of placement.versions) {
    const analysis = analyzeConditions({
      condition: v.condition,
      placeholderAreas: placement.placeholderAreas,
      street: v.street,
      width: placement.width,
      height: placement.height,
    });
    const abutting = abuttingBorderIslandIds({
      islands: analysis.islands,
      offsetCol: placement.offsetCol,
      offsetRow: placement.offsetRow,
      width: placement.width,
      height: placement.height,
      occupiedByOthers,
    });
    byVersion.set(v.version, { analysis, abuttingBorderIslandIds: abutting });
  }

  const version = conditionScoreSelector(placement.availableVersions, {
    name: placement.templateName,
    offsetCol: placement.offsetCol,
    offsetRow: placement.offsetRow,
    filledPlaceholderIds: placement.filledPlaceholderIds,
    byVersion,
  });

  return { version, byVersion };
}

/**
 * Every OPEN street condition in a world: for each placement, select its final version, then
 * collect that version's border-street condition islands that no neighbor abuts.
 *
 * Note the two-phase shape — occupancy for ALL placements is built first (footprints are
 * version-agnostic), so the pass is order-independent and needs no iteration.
 */
export function openStreetConditions(placements: readonly SealPlacement[]): OpenStreetCondition[] {
  return collectOpenStreetConditions(placements, false);
}

/** Shared body of {@link openStreetConditions} / {@link sealsContinent}; `stopEarly` returns the first find. */
function collectOpenStreetConditions(
  placements: readonly SealPlacement[],
  stopEarly: boolean,
): OpenStreetCondition[] {
  // Phase 1: every placement's global footprint (version-agnostic — all versions share one W×H).
  const footprintByKey = new Map<string, PlacementOccupancy>();
  for (const p of placements) {
    footprintByKey.set(p.key, {
      offsetCol: p.offsetCol,
      offsetRow: p.offsetRow,
      cells: boardCells(p.width, p.height),
    });
  }

  // Phase 2: resolve each placement's final version against everyone else's footprints, and
  // report its unsatisfied border-street islands.
  const open: OpenStreetCondition[] = [];
  for (const p of placements) {
    const others: PlacementOccupancy[] = [];
    for (const q of placements) if (q.key !== p.key) others.push(footprintByKey.get(q.key)!);
    const occupiedByOthers = globalOccupied(others);

    const { version, byVersion } = resolvePlacementVersion(p, occupiedByOthers);
    const state = byVersion.get(version);
    if (!state) continue; // selector floored to a version with no masks (degenerate catalog row)

    for (const island of state.analysis.islands) {
      if (island.kind !== 'border-street') continue;
      if (state.abuttingBorderIslandIds.has(island.id)) continue;
      open.push({ placementKey: p.key, templateName: p.templateName, version, islandId: island.id });
      if (stopEarly) return open;
    }
  }

  return open;
}

/**
 * The placement guard: would this world state be SEALED — no open street condition left anywhere,
 * on any placement's final rendered version? A `true` here forbids the placement that produced it.
 *
 * Short-circuits on the first open stub found, so the common (healthy) case is cheap.
 */
export function sealsContinent(placements: readonly SealPlacement[]): boolean {
  return collectOpenStreetConditions(placements, true).length === 0;
}
