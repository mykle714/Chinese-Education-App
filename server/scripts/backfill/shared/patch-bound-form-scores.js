/**
 * One-off repair: lower sense-cluster frequencyScores inflated by the removed
 * "BOUND FORMS COUNT THROUGH THEIR COMPOUNDS" rubric rule.
 *
 * THE PROBLEM. From 2026-08-28 to 2026-11-17 the shared scoring rubric
 * (chinese/lib/frequencyScore.js → SCALE_AND_GUIDELINES) told the scorer to credit a
 * sense with the frequency of the compounds it appears in. Senses that exist only inside
 * compounds therefore scored 4–5 and were starred (isStarredSense, score ≥ 4) next to
 * the word's real meanings: 的 "taxi" (的士) and "bull's-eye" (目的), 机 "aircraft"
 * (飞机), 方 "method" (方法) …
 *
 * THE FIX. The rule was deleted from the rubric WITHOUT a SCRIPT_VERSION bump (a bump
 * would mark the whole clustered corpus stale for a defect in ~0.5% of its senses).
 * The existing damage was sized and hand-judged instead: every starred non-default
 * sense of a discoverable single-char zh entry (526 senses / 328 entries, PPE
 * 2026-11-17) was reviewed and the compound-only ones listed in
 * bound-form-rescore-2026-11-17.json (136 senses / 109 entries). This script applies
 * that list.
 *
 * WHAT IT WRITES
 *   - `definitionClusters[i].frequencyScore` for each listed (headword, sense label).
 *     Labels, glosses, readings and ARRAY ORDER are untouched, so vet.selectedSense,
 *     est sense tags and breakdown senses keep resolving.
 *   - Nothing else. Only NON-default senses are lowered (enforced below), so the
 *     default sense, the dd and det."frequencyScore" (== MAX of the clusters, the
 *     invariant in shared/lib/senseClusters.js → reconcileFrequencyScore) do not move.
 *   - An `enrichmentLog` stamp `shared/patch-bound-form-scores` on each patched row.
 *
 * SAFETY
 *   - Idempotent: a cluster already at or below its target score is skipped.
 *   - Never RAISES a score, never touches the default (sorted rank 1) sense — such a
 *     listing is reported and skipped.
 *   - Optimistic write: the UPDATE matches on the clusters it read.
 *   - Skips rows a validator reviewed on `frequencyScore` / `senseFrequencyScore`.
 *   - zh only (Spanish is paused, CLAUDE.md). No API calls.
 *
 * LAYER: data-enrichment (backfill), deterministic repair.
 *
 * Usage:
 *   docker exec cow-backend npx tsx scripts/backfill/shared/patch-bound-form-scores.js --dry-run
 *   server/scripts/backfill/run-ppe.sh scripts/backfill/shared/patch-bound-form-scores.js
 *
 * Referenced by: docs/DEFINITION_CLUSTERS.md § "Bound forms".
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import db from '../../../db.js';
import { initRunLog } from '../run-log.js';

const SCRIPT_VERSION = 1;
const TABLE = 'dictionaryentries_zh';
const DRY_RUN = process.argv.includes('--dry-run');
const LIST_PATH = path.join(__dirname, 'bound-form-rescore-2026-11-17.json');

const { stampEntries, validatedClause, finalize } = initRunLog({
  script: 'shared/patch-bound-form-scores', version: SCRIPT_VERSION,
});

/** Index of the default sense: highest score, array order breaking ties — the same
 *  stable sort the read side (sortedSenseClusters) and isStarredSense index 0 use. */
function defaultIndex(clusters) {
  let best = -1;
  clusters.forEach((c, i) => {
    if (best < 0 || (c.frequencyScore ?? 0) > (clusters[best].frequencyScore ?? 0)) best = i;
  });
  return best;
}

async function run() {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(LIST_PATH, 'utf8')).patches;
  } catch (err) {
    throw new Error(`cannot read ${LIST_PATH}: ${err.message}`);
  }

  // Group the listing by headword: one read + one write per entry.
  const byWord = new Map();
  for (const [word, sense, score] of list) {
    if (!byWord.has(word)) byWord.set(word, []);
    byWord.get(word).push({ sense, score });
  }

  const client = await db.pool.connect();
  const stats = { entries: 0, senses: 0, already: 0, missing: 0, refusedDefault: 0, conflicts: 0 };
  try {
    const { rows } = await client.query(
      `SELECT id, word1, "definitionClusters" FROM ${TABLE}
        WHERE language = 'zh' AND discoverable = TRUE AND word1 = ANY($1::text[])
          AND jsonb_typeof("definitionClusters") = 'array'
          AND ${validatedClause(['frequencyScore', 'senseFrequencyScore'], TABLE)}`,
      [[...byWord.keys()]]
    );
    const seen = new Set(rows.map((r) => r.word1));
    for (const w of byWord.keys()) {
      if (!seen.has(w)) { stats.missing += byWord.get(w).length; console.log(`  ? ${w}: no discoverable, unvalidated row`); }
    }

    for (const row of rows) {
      const clusters = row.definitionClusters;
      const def = defaultIndex(clusters);
      let changed = false;
      const next = clusters.map((c) => ({ ...c }));

      for (const { sense, score } of byWord.get(row.word1)) {
        const i = next.findIndex((c) => c.sense === sense);
        if (i < 0) { stats.missing++; console.log(`  ? ${row.word1}: sense "${sense}" not found (re-clustered?)`); continue; }
        if (i === def) { stats.refusedDefault++; console.log(`  ✖ ${row.word1}: "${sense}" is the DEFAULT sense — not lowered`); continue; }
        const from = next[i].frequencyScore ?? null;
        if (from !== null && from <= score) { stats.already++; continue; }
        next[i].frequencyScore = score;
        changed = true;
        stats.senses++;
        console.log(`  ${row.word1} (id=${row.id}) "${sense}": ${from} → ${score}`);
      }
      if (!changed) continue;

      // The default and its score are untouched, so MAX(cluster) — and with it the
      // word-level score invariant — cannot move. Assert rather than trust it.
      const max = (cs) => Math.max(...cs.map((c) => c.frequencyScore ?? 0));
      if (max(next) !== max(clusters)) throw new Error(`${row.word1}: max cluster score would change — aborting`);

      if (DRY_RUN) { stats.entries++; continue; }
      const res = await client.query(
        `UPDATE ${TABLE} SET "definitionClusters" = $1::jsonb
          WHERE id = $2 AND "definitionClusters" = $3::jsonb`,
        [JSON.stringify(next), row.id, JSON.stringify(clusters)]
      );
      if (res.rowCount === 0) { stats.conflicts++; console.log(`  ⚠ ${row.word1}: clusters changed since read — skipped`); continue; }
      await stampEntries(client, TABLE, row.id);
      stats.entries++;
    }
  } finally {
    client.release();
  }

  console.log(`\n${DRY_RUN ? 'DRY RUN — ' : ''}entries patched: ${stats.entries}, senses lowered: ${stats.senses}, `
    + `already at/below target: ${stats.already}, not found: ${stats.missing}, `
    + `refused (default sense): ${stats.refusedDefault}, write conflicts: ${stats.conflicts}`);
}

run()
  .catch((err) => { console.error('Fatal error:', err); process.exitCode = 1; })
  .finally(async () => { finalize?.(); await db.pool.end(); });
