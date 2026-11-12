/**
 * Carry sense-label renames forward when a word is re-clustered.
 *
 * LAYER: data-enrichment (backfill) utility layer. Called INSIDE the clusterer's write
 * transaction (chinese/backfill-cluster-definitions.js), so the new clusters and every
 * pointer to them land atomically.
 *
 * WHY: four stored values point at a word's sense by its cluster LABEL, and resolve it by
 * exact string match:
 *   1. example-sentence tags — exampleSentences[*].senseDict[word],
 *      .segmentOccurrenceTags[i].sense (where segments[i] = word), and the host row's own
 *      generation-level .sense                         (read: segmentString.ts → resolveSenseView)
 *   2. long-definition keys  — the word's own longDefinition[*].sense
 *   3. learner sense picks   — vocabentries_zh."selectedSense" (user data, migration 99)
 *   4. breakdown tags        — breakdown[word].sense on compounds containing the character
 * Re-clustering renames labels, so before this every re-cluster orphaned all four —
 * measured 2026-11-11 on PPE: 85k sentence tags, 6.5k long-definition keys.
 *
 * HOW A RENAME IS DETECTED: a cluster's `glosses` partition the word's definitions
 * (validatePartition), so an old cluster whose glosses ALL land in ONE new cluster was
 * renamed or merged — carry it forward. One whose glosses scatter across several new
 * clusters was SPLIT: no single label is right for every pointer, so it is reported for
 * chinese/reconcile-sentence-senses.js, which judges each pointer in context. When an old
 * cluster's glosses appear nowhere (all rewritten), the label-text rule
 * (deterministicRemap) is the fallback.
 *
 * Referenced by: chinese/backfill-cluster-definitions.js, docs/DEFINITION_CLUSTERS.md
 * § "Renaming a sense", docs/EXAMPLE_SENTENCES.md § "Stale sense labels".
 */

import { deterministicRemap } from './sentenceSenseOrphans.js';

/**
 * SQL guard (det alias `d`): no validator has approved or flagged this row's `definitions`.
 * Mirrors run-log.js → validatedClause(['definitions']) for callers without a run-log handle.
 */
export const DEFINITIONS_NOT_REVIEWED = `NOT EXISTS (SELECT 1 FROM validations val
  WHERE val."entryId" = d.id AND val.language = d.language
    AND val.field = 'definitions' AND val.action IN ('approve','flag'))`;

/**
 * @param {{sense: string, glosses?: string[]}[]|null} oldClusters - as stored before the write
 * @param {{sense: string, glosses?: string[]}[]} newClusters - about to be written
 * @returns {{ renames: Map<string, string>, splits: string[] }} old label → new label for
 *   every carried-forward rename; `splits` = old labels no single new label replaces.
 */
export function buildSenseRenameMap(oldClusters, newClusters) {
  const renames = new Map();
  const splits = [];
  if (!Array.isArray(oldClusters) || !Array.isArray(newClusters)) return { renames, splits };
  const newLabels = new Set(newClusters.map((c) => c?.sense));
  for (const old of oldClusters) {
    const label = old?.sense;
    if (typeof label !== 'string' || newLabels.has(label)) continue; // unchanged label: nothing to do
    const glosses = new Set(Array.isArray(old.glosses) ? old.glosses : []);
    const homes = newClusters.filter((c) => Array.isArray(c?.glosses) && c.glosses.some((g) => glosses.has(g)));
    if (homes.length === 1) renames.set(label, homes[0].sense);
    else if (homes.length > 1) splits.push(label);
    else {
      const byText = deterministicRemap(label, newClusters);
      if (byText) renames.set(label, byText);
      else splits.push(label);
    }
  }
  return { renames, splits };
}

/**
 * Rewrite every pointer to a renamed label of `word`. Must run on the caller's client
 * inside its transaction (it does not BEGIN/COMMIT itself).
 *
 * @param {import('pg').PoolClient} client
 * @param {{ word: string, rowId: number, renames: Map<string, string> }} args
 * @returns {Promise<{ sentenceRows: number, sentenceTags: number, longDefKeys: number, picks: number, breakdownRows: number }>}
 */
export async function carryForwardSenseRenames(client, { word, rowId, renames }) {
  const counts = { sentenceRows: 0, sentenceTags: 0, longDefKeys: 0, picks: 0, breakdownRows: 0 };
  if (!renames || renames.size === 0) return counts;
  const oldLabels = [...renames.keys()];

  // 1. Example-sentence tags. Candidate rows: those whose sentences mention the word as a
  //    segment AND contain one of the old labels as a JSON string (cheap text pre-filter;
  //    the exact match happens in JS below). Row-locked so a concurrent writer can't interleave.
  const { rows: hosts } = await client.query(
    `SELECT id, word1, "exampleSentences" es
       FROM dictionaryentries_zh
      WHERE language = 'zh' AND jsonb_typeof("exampleSentences") = 'array'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements("exampleSentences") s WHERE s->'segments' ? $1)
        AND "exampleSentences"::text LIKE ANY ($2)
      FOR UPDATE`,
    [word, oldLabels.map((l) => `%${JSON.stringify(l).replace(/[\\%_]/g, '\\$&')}%`)]
  );
  for (const h of hosts) {
    let changed = 0;
    for (const s of h.es) {
      if (!s || typeof s !== 'object') continue;
      const dictTo = renames.get(s.senseDict?.[word]);
      if (dictTo) { s.senseDict[word] = dictTo; changed++; }
      if (s.segmentOccurrenceTags && Array.isArray(s.segments)) {
        for (const [i, tag] of Object.entries(s.segmentOccurrenceTags)) {
          const to = s.segments[Number(i)] === word ? renames.get(tag?.sense) : undefined;
          if (to) { tag.sense = to; changed++; }
        }
      }
      // The host's own headword sense (generation field) on the word's own row.
      if (h.word1 === word && renames.get(s.sense)) { s.sense = renames.get(s.sense); changed++; }
    }
    if (changed) {
      await client.query(`UPDATE dictionaryentries_zh SET "exampleSentences" = $1::jsonb WHERE id = $2`, [JSON.stringify(h.es), h.id]);
      counts.sentenceRows++;
      counts.sentenceTags += changed;
    }
  }

  // 2. Long-definition keys on the word's own row. The array is one entry per (sense, POS)
  //    pair (backfill-long-definitions.js v15) — a sense may legitimately own several. If a
  //    rename MERGES two old senses into one, two entries can collide on the same
  //    (sense, POS); keep the first so the array stays one-per-pair.
  //    Skipped when a validator approved/flagged `definitions`: that review covers the
  //    composed longDefinition (ValidationService → composeDefinitionsBody), so re-keying it
  //    would void the approval — the same guard every longDefinition writer carries
  //    (run-log.js → validatedClause). The orphaned key then waits for a human.
  const { rows: own } = await client.query(
    `SELECT d."longDefinition" ld FROM dictionaryentries_zh d
      WHERE d.id = $1 AND ${DEFINITIONS_NOT_REVIEWED}`, [rowId]);
  const ld = own[0]?.ld;
  if (Array.isArray(ld)) {
    const seen = new Set();
    const next = [];
    for (const entry of ld) {
      if (entry && typeof entry === 'object' && renames.has(entry.sense)) {
        entry.sense = renames.get(entry.sense);
        counts.longDefKeys++;
      }
      const pairKey = typeof entry?.sense === 'string' ? `${entry.sense}\t${entry.pos ?? ''}` : null;
      if (pairKey && seen.has(pairKey)) continue;
      if (pairKey) seen.add(pairKey);
      next.push(entry);
    }
    if (counts.longDefKeys) {
      await client.query(`UPDATE dictionaryentries_zh SET "longDefinition" = $1::jsonb WHERE id = $2`, [JSON.stringify(next), rowId]);
    }
  }

  // 3. Learner sense picks (user data): re-point, never clear — a split label keeps the
  //    old (orphaned) pick, which renders the default sense exactly as before.
  for (const [from, to] of renames) {
    const r = await client.query(
      `UPDATE vocabentries_zh SET "selectedSense" = $1 WHERE language = 'zh' AND "entryKey" = $2 AND "selectedSense" = $3`,
      [to, word, from]
    );
    counts.picks += r.rowCount;
  }

  // 4. Breakdown tags on compounds that contain this character (single-char words only —
  //    breakdowns are keyed by component character).
  if ([...word].length === 1) {
    for (const [from, to] of renames) {
      const r = await client.query(
        `UPDATE dictionaryentries_zh
            SET breakdown = jsonb_set(breakdown, ARRAY[$1::text, 'sense'], to_jsonb($2::text))
          WHERE language = 'zh' AND jsonb_typeof(breakdown) = 'object'
            AND breakdown->$1->>'sense' = $3`,
        [word, to, from]
      );
      counts.breakdownRows += r.rowCount;
    }
  }
  return counts;
}
