/**
 * Sense-cluster TIEBREAK ORDERING — the pass that decides which of two
 * equally-scored senses a card shows by default.
 *
 * LAYER: data-enrichment (backfill) shared lib — language-neutral, beside
 * senseClusters.js. Nothing here reads `reading`/`gender`, so zh and es can both
 * use it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Every read path orders a word's senses with the SAME comparator — highest
 * `frequencyScore` first, nulls last (`sortedSenseClusters` in
 * src/utils/definitionUtils.ts, `resolveSelectedCluster` in
 * server/utils/definitions.ts, `defaultClusterIndex` in ./senseClusters.js) — and
 * that comparator returns 0 for two clusters sharing a score. All three sorts are
 * stable, so a TIE is silently decided by the clusters' order in the stored
 * `definitionClusters` array, and the winner gets the star in the sense picker and
 * becomes the card's dd.
 *
 * The 1-5 commonality scale is coarse on purpose (see chinese/lib/frequencyScore.js
 * § SCALE_AND_GUIDELINES), and Stage C scores each cluster in an INDEPENDENT call
 * that never sees its siblings — so it cannot break its own ties even in principle.
 * This pass is the missing comparison: it shows one model all the clusters that
 * landed on the same band and asks only which of them a learner meets first. The
 * differences it rules on are deliberately too small to move a cluster's band; the
 * score is an input here, never an output.
 *
 * ── WHAT IT MAY CHANGE ───────────────────────────────────────────────────────
 * ONLY the order of clusters that already share a score, and only among the array
 * slots those clusters already occupy. Cross-band order is untouched, because the
 * read-side sort owns that and two opinions about it would be one too many. No
 * cluster's `sense`, `glosses`, `reading`, `pos` or `frequencyScore` is edited, so
 * this can never break a `vet.selectedSense` label, a per-sense `longDefinition`
 * key or an est sentence tag — all of which address a cluster BY LABEL.
 *
 * Non-displayable clusters (lead gloss entirely parenthetical — 上来 "(verb
 * complement indicating success)") are excluded from every tie group: they are
 * filtered out of the picker before it sorts, so ranking them would spend tokens
 * on an order nobody sees.
 *
 * Referenced by:
 *   - scripts/backfill/chinese/backfill-cluster-definitions.js (Stage C.5)
 *   - scripts/backfill/spanish/backfill-cluster-definitions.js (prompt rule 7 does
 *     the same job inline — its single call already sees every cluster and its score)
 * Documented in: docs/DEFINITION_CLUSTERS.md
 */

import { isDisplayable } from './senseClusters.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

const TIEBREAK_SYSTEM = (language) =>
  `You are a ${language} linguistics expert ranking equally-common senses of a word for a modern (2020s) learner's vocabulary card.`;

const TIEBREAK_INSTRUCTIONS = `You are given a word and one or more GROUPS of its sense clusters. Every cluster inside a group was independently given the SAME 1-5 commonality score (how much that sense would stand out if a friend used it in casual conversation), so the score cannot say which of them the learner should see first. Rank each group.

Rules:
1. RANK BY MARGINAL COMMONALITY, WITHIN the band. The senses in a group really are about equally common — you are separating differences far too small to change anyone's 1-5 score. Never argue that a cluster's score is wrong and never propose a different one; the score is given, your only output is an order.
2. Rank first the sense a learner is most likely to MEET FIRST and hear most often. Useful tie-breakers, in rough priority: everyday concrete usage over extended or figurative usage; the sense that stands alone as a word over one that only lives inside fixed compounds or set phrases; the sense that covers more ordinary situations over a narrower or domain-specific one; plain modern usage over anything with a formal, regional or dated flavour.
3. The winner MATTERS: the top-ranked cluster of the highest-scoring group is the sense the flashcard shows by default and the one starred in the sense picker. Pick the one you would want a learner to see with no further context.
4. Return EVERY cluster id of a group exactly once in that group's "order", and never move a cluster between groups.
5. reviewNotes is for GENUINE COIN FLIPS only — two senses you truly cannot separate, or a group where you think the shared score itself is the problem. This pass runs on nearly every polysemous word, so do NOT note ordinary close calls; an empty array is the normal answer.

Return ONLY a valid JSON object, no explanation:
{"groups":[{"group":<the group number you were given>,"order":[<cluster ids, most common first>]}],"reviewNotes":[<strings>]}`;

function tiebreakUser(word, groups) {
  return `Word: ${word}

Tied groups:
${JSON.stringify(groups, null, 2)}`;
}

/** Numeric score, or null when unscored/malformed — same rule as senseClusters.js. */
function scoreOf(cluster) {
  const n = cluster?.frequencyScore;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Build the tie groups: displayable clusters bucketed by identical score, keeping
 * only buckets with a real choice in them. `null` (unscored) is its own bucket —
 * those clusters tie with each other at the bottom of the read-side sort.
 * Returns [{ key, indices }] in first-appearance order.
 */
function tieGroups(clusters) {
  const buckets = new Map(); // score (or 'null') → original indices
  clusters.forEach((c, i) => {
    if (!isDisplayable(c)) return;
    const key = String(scoreOf(c));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  });
  return [...buckets.entries()]
    .filter(([, indices]) => indices.length > 1)
    .map(([key, indices]) => ({ key, indices }));
}

/**
 * Bind the tiebreaker to an Anthropic client.
 *
 * tiebreakClusterOrder(word, clusters) → { clusters, notes, called }
 *   - `clusters`: a NEW array, tied clusters permuted within their own slots. The
 *     input array is never mutated.
 *   - `notes`: reviewNotes to merge into the entry's stdout review flags.
 *   - `called`: whether an API call was made (false when nothing tied — the common
 *     case, and the reason this pass is nearly free on most entries).
 *
 * On ANY failure the original order is returned with a note: an unresolved tie is
 * the status quo, so a broken tiebreak must never cost the caller a write.
 * An oracle-mode export throw (`e.oracleExport`) is control flow and propagates —
 * see run-log.js § ORACLE MODE.
 */
export function createClusterTiebreaker({ anthropic, cachedSystem, model = DEFAULT_MODEL, language = 'Chinese' }) {
  // Opus 4.8 rejects `temperature`; Sonnet honors it and we want a deterministic
  // ranking. Same guard as the caller's tempParams().
  const tempParams = () => (/opus-4-8/.test(model) ? {} : { temperature: 0 });

  async function tiebreakClusterOrder(word, clusters) {
    if (!Array.isArray(clusters) || clusters.length < 2) return { clusters, notes: [], called: false };
    const groups = tieGroups(clusters);
    if (groups.length === 0) return { clusters, notes: [], called: false };

    // The model sees ids (original array indices), the sense label and the glosses —
    // not the cluster objects, so it cannot be tempted to rewrite one.
    const payload = groups.map((g, n) => ({
      group: n,
      score: g.key === 'null' ? null : Number(g.key),
      clusters: g.indices.map((i) => ({
        id: i,
        sense: clusters[i].sense,
        glosses: clusters[i].glosses,
      })),
    }));

    let parsed;
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        ...tempParams(),
        system: cachedSystem(`${TIEBREAK_SYSTEM(language)}\n\n${TIEBREAK_INSTRUCTIONS}`),
        messages: [{ role: 'user', content: tiebreakUser(word, payload) }],
      });
      const raw = response.content[0].text;
      const objMatch = raw.match(/\{[\s\S]*\}/);
      if (!objMatch) return { clusters, notes: ['tiebreak skipped (no object in response) — tied senses left in array order'], called: true };
      parsed = JSON.parse(objMatch[0]);
    } catch (e) {
      if (e?.oracleExport) throw e;
      return { clusters, notes: [`tiebreak skipped (${e.message}) — tied senses left in array order`], called: true };
    }

    const notes = Array.isArray(parsed?.reviewNotes)
      ? parsed.reviewNotes.filter((n) => typeof n === 'string' && n.trim()).map((n) => `tied senses: ${n}`)
      : [];
    if (!Array.isArray(parsed?.groups)) {
      return { clusters, notes: [...notes, 'tiebreak skipped (missing groups array) — tied senses left in array order'], called: true };
    }

    const reordered = [...clusters];
    for (let n = 0; n < groups.length; n++) {
      const slots = groups[n].indices;
      const answer = parsed.groups.find((g) => Number(g?.group) === n);
      const order = Array.isArray(answer?.order) ? answer.order.map(Number) : null;
      // A group's answer must be an exact permutation of the ids it was given.
      // Anything else (a dropped, duplicated or invented id) leaves THAT group in
      // its original order — a partial answer still improves the groups it got right.
      const valid =
        order &&
        order.length === slots.length &&
        new Set(order).size === slots.length &&
        order.every((i) => slots.includes(i));
      if (!valid) {
        notes.push(`tiebreak ignored for the ${slots.length} senses scored ${groups[n].key === 'null' ? 'null' : groups[n].key} (bad order) — left in array order`);
        continue;
      }
      // Permute WITHIN the slots the group already occupies, so clusters of other
      // scores never move and the stored order still agrees with the read-side sort.
      slots.forEach((slot, k) => { reordered[slot] = clusters[order[k]]; });
    }
    return { clusters: reordered, notes, called: true };
  }

  return { tiebreakClusterOrder };
}
