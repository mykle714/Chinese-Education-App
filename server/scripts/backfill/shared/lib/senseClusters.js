/**
 * Shared sense-cluster helpers for the data-enrichment (backfill) layer.
 *
 * LAYER: data-enrichment (backfill) shared lib — language-neutral, so it sits
 * beside frequencyLabels.js rather than in chinese/lib or spanish/lib. The zh and
 * es cluster shapes are identical (docs/DEFINITION_CLUSTERS.md § Data model); only
 * the `reading`/`gender` fields differ, and nothing here touches them.
 *
 * Owns TWO things:
 *   1. The backfill-side analogues of the frontend's `ddt()` / `sortedSenseClusters`
 *      (src/utils/definitionUtils.ts) — previously copy-pasted into
 *      chinese/backfill-breakdown-senses.js.
 *   2. THE WORD/CLUSTER FREQUENCY INVARIANT (`reconcileFrequencyScore`), see below.
 *
 * ── THE INVARIANT ────────────────────────────────────────────────────────────
 *   det."frequencyScore"  ==  MAX(definitionClusters[*].frequencyScore)
 *
 * WHY it must hold: the word-level score is defined as "score its most
 * frequently-heard everyday meaning" (the `word` polysemy guideline in
 * chinese/lib/frequencyScore.js), and the clusters ARE that word's meanings. So the
 * word-level number is not independent evidence — it is the max of the per-sense
 * numbers, by definition.
 *
 * WHY it drifted: the two numbers are written by two independent AI passes that
 * never see each other (chinese/backfill-frequency-score.js writes the column;
 * chinese/backfill-cluster-definitions.js Stage C writes the per-cluster scores),
 * with no reconciliation step between them. A 2026-08-28 audit found the invariant
 * violated on 430 / 4276 comparable zh rows (10%) and 562 / 885 comparable
 * discoverable es rows (63%).
 *
 * WHY that is user-visible and not just untidy: the two numbers feed DIFFERENT
 * surfaces, so a learner can see both at once and they contradict. The eip/cdp
 * "Commonality" chip shows the selected CLUSTER's score (resolveCommonality,
 * src/utils/definitionUtils.ts), while the WORD column drives starter-pack and
 * provisional-card ordering, search relevance and the gsa tie-break. 讨论 shipped
 * as word=3 with its only sense scored 5.
 *
 * WHY the repair ratchets UP (max of the two) rather than trusting one pass:
 * neither pass dominates. The sense pass deflates common words (讨论 word 3 vs
 * sense 5) because its guideline pushes back against headword familiarity; the word
 * pass inflates rare senses of common words (老公 word 5 vs senses 3/1). In both
 * directions the HIGHER number was the defensible one on inspection, and taking the
 * max is also the direction consistent with the project's rule that a morpheme's
 * occurrences inside compounds count toward its commonality (a bound form like 自 is
 * "heard" constantly via 自己/自由/来自). Raising never demotes a sense below a score
 * a human validator may have approved.
 *
 * Referenced by:
 *   - scripts/backfill/chinese/repair-frequency-score-drift.js  (the repair pass)
 *   - scripts/backfill/chinese/backfill-cluster-definitions.js  (Stage C post-write)
 *   - scripts/backfill/chinese/backfill-breakdown-senses.js     (lead gloss / default)
 * Documented in: docs/DEFINITION_CLUSTERS.md, docs/DEFINITION_MAPPING.md
 */

import { stripParentheses } from './stripParentheses.js';

/** Well-formed clusters only — anything without a usable `sense` label is ignored. */
export function usableClusters(definitionClusters) {
  return Array.isArray(definitionClusters)
    ? definitionClusters.filter((c) => c && typeof c.sense === 'string' && c.sense.trim().length > 0)
    : [];
}

/**
 * Lead gloss of a cluster with parentheticals stripped — the backfill analogue of
 * the frontend `ddt()`. Falls back to the sense label when the lead gloss is
 * entirely parenthetical (e.g. 上来 "(verb complement indicating success)").
 */
export function clusterLeadGloss(cluster) {
  const g = Array.isArray(cluster?.glosses)
    ? cluster.glosses.find((x) => typeof x === 'string' && x.trim())
    : null;
  const stripped = stripParentheses(g ?? '');
  return stripped || (typeof cluster?.sense === 'string' ? cluster.sense : '');
}

/**
 * Is this cluster offered to the learner? Mirrors the `< 2` displayable gate in
 * resolveSelectedCluster (server/utils/definitions.ts): a cluster whose lead gloss
 * is entirely parenthetical has no displayable English and never becomes a card's
 * default sense.
 */
export function isDisplayable(cluster) {
  const g = Array.isArray(cluster?.glosses)
    ? cluster.glosses.find((x) => typeof x === 'string' && x.trim())
    : null;
  return stripParentheses(g ?? '').length > 0;
}

/** Numeric per-cluster frequencyScore, or null when unscored/malformed. */
function score(cluster) {
  const n = cluster?.frequencyScore;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Index (in the ORIGINAL array) of the cluster the learner sees by default: highest
 * frequencyScore first, ties broken by array order, unscored last — the same stable
 * sort as the client's `sortedSenseClusters`. Displayable clusters win outright,
 * because a non-displayable one can never be the default.
 *
 * "Ties broken by array order" is a deliberate contract, not a fallback: the clusterer
 * ranks tied clusters by marginal commonality before writing them (see ./tiebreakOrder.js).
 * Returns -1 for an empty list.
 */
export function defaultClusterIndex(clusters) {
  if (!Array.isArray(clusters) || clusters.length === 0) return -1;
  const rank = (c) => (isDisplayable(c) ? 1 : 0);
  let best = -1;
  for (let i = 0; i < clusters.length; i++) {
    if (best === -1) { best = i; continue; }
    const a = clusters[i], b = clusters[best];
    if (rank(a) !== rank(b)) { if (rank(a) > rank(b)) best = i; continue; }
    // Strictly greater only — a tie keeps the earlier index, matching a stable sort.
    if ((score(a) ?? -1) > (score(b) ?? -1)) best = i;
  }
  return best;
}

/** Highest per-cluster frequencyScore, or null when no cluster is scored. */
export function maxClusterScore(clusters) {
  const scores = usableClusters(clusters).map(score).filter((n) => n !== null);
  return scores.length ? Math.max(...scores) : null;
}

/**
 * Enforce the word/cluster frequency invariant on ONE entry (see the header).
 *
 * Ratchets both sides up to `max(wordScore, maxClusterScore)`:
 *   - the word column is raised to the target;
 *   - if every cluster is below the target, the DEFAULT cluster is raised to it —
 *     the default, not an arbitrary one, so the learner's current default sense
 *     never changes as a side effect of the repair.
 *
 * Pure: returns a new cluster array and never mutates the input. Cluster array
 * ORDER is preserved, because order is the documented tie-break for the default
 * sense pick.
 *
 * @param {number|null} wordScore              det."frequencyScore"
 * @param {object[]|null} definitionClusters   det."definitionClusters"
 * @returns {{ wordScore: number|null, clusters: object[]|null,
 *             wordChanged: boolean, clustersChanged: boolean,
 *             raisedSense: string|null }}
 */
export function reconcileFrequencyScore(wordScore, definitionClusters) {
  const clusters = Array.isArray(definitionClusters) ? definitionClusters : null;
  const word = typeof wordScore === 'number' && Number.isFinite(wordScore) ? wordScore : null;
  const maxCluster = maxClusterScore(clusters);

  const unchanged = {
    wordScore: word, clusters, wordChanged: false, clustersChanged: false, raisedSense: null,
  };

  // Nothing to reconcile: an unclustered entry, or an entry where neither side has
  // been scored yet. A one-sided null is left alone on purpose — filling it would be
  // inventing a score the invariant cannot justify, and the owning backfill will do
  // it properly on its next run.
  if (!clusters || clusters.length === 0 || word === null || maxCluster === null) return unchanged;

  const target = Math.max(word, maxCluster);
  if (word === target && maxCluster === target) return unchanged;

  let nextClusters = clusters;
  let raisedSense = null;
  if (maxCluster < target) {
    const idx = defaultClusterIndex(clusters);
    if (idx >= 0) {
      nextClusters = clusters.map((c, i) => (i === idx ? { ...c, frequencyScore: target } : c));
      raisedSense = clusters[idx]?.sense ?? null;
    }
  }

  return {
    wordScore: target,
    clusters: nextClusters,
    wordChanged: word !== target,
    clustersChanged: nextClusters !== clusters,
    raisedSense,
  };
}
