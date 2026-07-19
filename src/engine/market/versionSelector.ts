/**
 * versionSelector — the pluggable seam that picks ONE active version for a placed
 * template (docs/NIGHT_MARKET_TEMPLATES.md § "Template versions",
 * docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md § versionSelector).
 *
 * LAYER: pure engine. No React, no DB, no assets.
 *
 * A template name can carry several versions (full walkability snapshots). At load the
 * runtime must collapse that set to a single version per PLACEMENT. This module is only
 * the SEAM: slice 1 ships a random stub. The real rule — scored on the placement's
 * neighbours + filled placeholder islands, and constrained so it never severs a street a
 * live neighbour leans on (the decay-safety constraint) — replaces only
 * {@link randomVersionSelector}'s body later; nothing else here changes.
 */

import type { ConditionAnalysis } from './conditionAnalysis';

/**
 * Per-version condition state the scored selector needs: that version's analyzed condition
 * islands + count, and which of its BORDER-STREET islands currently abut a neighbor (resolved
 * upstream by {@link ./seamAdjacency abuttingBorderIslandIds} — geometry stays out of here so
 * the selector is pure scoring). Placeholder-island satisfaction comes from
 * {@link VersionSelectContext.filledPlaceholderIds}, which is per-placement (version-agnostic).
 */
export interface VersionConditionState {
  analysis: ConditionAnalysis;
  abuttingBorderIslandIds: Set<string>;
}

/**
 * What a selector may key on. The random stub uses only `name`/offsets; the scored selector
 * ({@link conditionScoreSelector}) additionally reads `filledPlaceholderIds` (the placeholder
 * area ids occupied by an unlock, per placement) and `byVersion` (each candidate version's
 * {@link VersionConditionState}). Both are optional so the stub and slice-1 callers are
 * unaffected; the scored selector floors to the base version when they are absent.
 */
export interface VersionSelectContext {
  name: string;
  offsetCol: number;
  offsetRow: number;
  /** Placeholder-area ids filled by an unlock, for THIS placement (same across versions). */
  filledPlaceholderIds?: Set<string>;
  /** Per-candidate-version condition state (islands, count, abutting border islands). */
  byVersion?: Map<number, VersionConditionState>;
}

/** A version-selection strategy: given the available version numbers, pick exactly one. */
export type VersionSelector = (availableVersions: number[], ctx: VersionSelectContext) => number;

/**
 * Slice-1 stub: pick a uniformly random available version. Version 0 is the guaranteed
 * base (every template name has it), so an empty/degenerate input floors to 0.
 *
 * NOTE ON STABILITY: this is random PER CALL. The design wants a version that is stable
 * per PLACEMENT (chosen once, persisted) — not re-rolled every render — so the caller is
 * responsible for calling this once per placement and holding the result (slice 1's
 * useMarketWorld selects once per mount; slice 3 persists it on the placement row).
 */
export const randomVersionSelector: VersionSelector = (availableVersions) => {
  if (availableVersions.length === 0) return 0;
  const i = Math.floor(Math.random() * availableVersions.length);
  return availableVersions[i] ?? 0;
};

/**
 * Pick the active version for a placement. Thin indirection over a {@link VersionSelector}
 * (defaults to {@link randomVersionSelector}) so tests and future callers can inject a
 * deterministic strategy without threading it through every layer.
 */
export function selectVersion(
  availableVersions: number[],
  ctx: VersionSelectContext,
  sel: VersionSelector = randomVersionSelector,
): number {
  return sel(availableVersions, ctx);
}

/** A version's satisfaction breakdown — `score = satisfied / count` (0/0 defined as 0). */
export interface VersionScore {
  satisfied: number;
  count: number;
  score: number;
}

/**
 * Score one version: how many of its conditions are currently satisfied, over its total.
 *
 * - PLACEHOLDER island → satisfied when its `placeholderAreaId` is in `filledPlaceholderIds`.
 *   (An island with no area match — malformed — is never satisfiable, matching its intent.)
 * - BORDER-STREET island → satisfied when its id is in the version's `abuttingBorderIslandIds`.
 *
 * `score = satisfied / count`, with the base version's `0/0` defined as 0 (the default floor).
 */
export function scoreVersion(
  state: VersionConditionState,
  filledPlaceholderIds: Set<string>,
): VersionScore {
  const { islands, conditionCount } = state.analysis;
  let satisfied = 0;
  for (const island of islands) {
    if (island.kind === 'placeholder') {
      if (island.placeholderAreaId && filledPlaceholderIds.has(island.placeholderAreaId)) satisfied++;
    } else if (state.abuttingBorderIslandIds.has(island.id)) {
      satisfied++;
    }
  }
  const score = conditionCount > 0 ? satisfied / conditionCount : 0;
  return { satisfied, count: conditionCount, score };
}

/**
 * The REAL version-selection rule (docs/NIGHT_MARKET_TEMPLATES.md § "Version selection rule").
 * Renders the version satisfying the most conditions in ABSOLUTE terms — highest `satisfied`
 * count — so a version that realizes more concrete conditions always wins even if it also carries
 * more unmet ones (a lower ratio).
 *
 * Tiebreaks, in order: higher `satisfied / conditionCount` RATIO, then LOWEST version number.
 * Version 0 carries no conditions (`satisfied = 0`, `0/0` ratio defined as 0) and the final
 * tiebreak favors the lowest number, so version 0 wins every all-zero tie — the base renders when
 * nothing is satisfied.
 *
 * Decay safety is a SOFT bias here (decision 2026-07-17: scored selector is the final form):
 * a version that keeps a border street can score it when a neighbor abuts; one that flips the
 * edge to communal has no border-street condition there and cannot. The HARD graph-invariant
 * guarantee (never drop a depended-on street) is a separate, deferred item.
 *
 * Falls back to the lowest available version if the scoring inputs are absent (mis-wiring).
 */
export const conditionScoreSelector: VersionSelector = (availableVersions, ctx) => {
  if (availableVersions.length === 0) return 0;
  const versions = [...availableVersions].sort((a, b) => a - b);
  if (!ctx.byVersion) return versions[0]; // no scoring inputs → base version

  const filled = ctx.filledPlaceholderIds ?? new Set<string>();
  let best = versions[0];
  let bestSatisfied = -1;
  let bestScore = -1;

  // Iterate ascending; strict `>` improvements mean full ties keep the LOWER version.
  // Primary key: absolute satisfied count. Tiebreak: the satisfied/count ratio.
  for (const v of versions) {
    const state = ctx.byVersion.get(v);
    const { satisfied, score } = state
      ? scoreVersion(state, filled)
      : { satisfied: 0, score: 0 };
    if (satisfied > bestSatisfied || (satisfied === bestSatisfied && score > bestScore)) {
      best = v;
      bestSatisfied = satisfied;
      bestScore = score;
    }
  }
  return best;
};
