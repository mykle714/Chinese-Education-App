/**
 * Repair Script: one consistent shape for CLASSIFIER senses in `definitionClusters`.
 *
 * THE PROBLEM (dev audit 2026-11-03). Classifier (measure-word) senses had no house
 * style and two structural defects:
 *   1. `pos` used two vocabularies — "classifier" on 171 senses, "measure word" on two
 *      (下 "times", 一个 "a / one").
 *   2. 23 senses fused a noun with its classifier use in ONE cluster, e.g. 间
 *      ["room", "classifier for rooms", …] pos ["noun","classifier"]. The card can show
 *      only one headline per sense, so the classifier use was hidden behind the noun.
 *   3. 回 "classifier for times / occurrences" was tagged ["classifier","noun"] although
 *      its label already names it the classifier sense.
 *
 * THE FIX (agreed with the project owner 2026-11-03)
 *   1. Every "measure word" pos entry becomes "classifier".
 *   2. SPLIT a fused noun + classifier sense when the source already carries a
 *      classifier gloss ("classifier for …", "classifier: …", "classifier used …"): those
 *      glosses move VERBATIM into a new sense right after the original, pos
 *      ["classifier"], scored by the shared per-sense frequency scorer. The original
 *      sense keeps its LABEL (an address for vet.selectedSense, longDefinition[].sense,
 *      est tags and breakdown[char].sense) and drops "classifier" from its pos.
 *      NOT split:
 *        - units of measure / currency (米 meter, 千克 kilogram, 元 yuan): Chinese counts
 *          them directly, so a separate "classifier for meters" sense would be clutter.
 *          They have no classifier gloss, so the gloss test excludes them on its own;
 *        - nouns with a classifier use but NO classifier gloss (群, 队, 条, 双 …): a
 *          split would need an invented gloss.
 *   3. 回's "classifier for times / occurrences" becomes a pure ["classifier"] sense.
 *
 * Headlines are NOT written here. The "classifier for …" lead for every pure
 * classifier sense (new and existing) is written afterwards by
 * shared/patch-long-cluster-glosses.js, whose shortener now applies the classifier
 * format (shared/lib/senseShortGloss.js → needsClassifierFormat).
 *
 * KNOWN GAPS left for the owner to decide (printed at the end):
 *   - a new sense has no `longDefinition` entry, so readers fall back to the default
 *     sense's; `backfill-long-definitions.js --words=` would regenerate every sense of
 *     those words, not just the new one;
 *   - est sentences tagged to the original sense that actually show the classifier use
 *     stay tagged to the noun sense.
 *
 * SAFETY: idempotent (a split sense has no classifier gloss left to move; pos fixes are
 * no-ops once applied); optimistic write (skips a row whose clusters changed since
 * read); skips rows a validator reviewed on `definitions` or `senseFrequencyScore`;
 * enforces det."frequencyScore" == MAX(cluster score) in the same UPDATE, like the
 * clusterer. One Sonnet call per new sense (its frequency score). No SCRIPT_VERSION
 * bump anywhere: this touches ~25 rows (see the patch-not-bump rule).
 *
 * LAYER: data-enrichment (backfill), zh only.
 *
 * Usage (from the backend container):
 *   docker exec cow-backend npx tsx scripts/backfill/chinese/patch-classifier-senses.js --dry-run
 *   docker exec cow-backend npx tsx scripts/backfill/chinese/patch-classifier-senses.js
 *
 * Referenced by: docs/DEFINITION_CLUSTERS.md § "Classifier senses".
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog } from '../run-log.js';
import { createFrequencyScorer } from './lib/frequencyScore.js';
import { reconcileFrequencyScore } from '../shared/lib/senseClusters.js';

const SCRIPT_VERSION = 1;
const TABLE = 'dictionaryentries_zh';
const DRY_RUN = process.argv.includes('--dry-run');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const { stampEntries, validatedClause, finalize } = initRunLog({
  script: 'chinese/patch-classifier-senses', version: SCRIPT_VERSION, anthropic,
});
const { scoreFrequency } = createFrequencyScorer({ anthropic });

// A source gloss that names the classifier use itself — the part that moves out.
const CLASSIFIER_GLOSS = /^\(?classifier\)?\b|\bclassifier (for|used|:)/i;

// (word, sense label) → the pos to set. Case 3 above.
const POS_OVERRIDES = [
  { word: '回', sense: 'classifier for times / occurrences', pos: ['classifier'] },
];

const normalizePos = (pos) => {
  if (!Array.isArray(pos)) return pos;
  const out = [...new Set(pos.map((p) => (p === 'measure word' ? 'classifier' : p)))];
  return out;
};

/** Plan one entry's changes. Returns { clusters, notes, newSenses } (clusters unchanged → notes empty). */
async function planRow(row) {
  const notes = [];
  const newSenses = [];
  const out = [];
  for (const c of row.definitionClusters) {
    let cluster = { ...c, pos: normalizePos(c.pos) };
    if (JSON.stringify(cluster.pos) !== JSON.stringify(c.pos)) {
      notes.push(`pos ${JSON.stringify(c.pos)} → ${JSON.stringify(cluster.pos)} [${c.sense}]`);
    }
    const override = POS_OVERRIDES.find((o) => o.word === row.word1 && o.sense === c.sense);
    if (override && JSON.stringify(cluster.pos) !== JSON.stringify(override.pos)) {
      notes.push(`pos ${JSON.stringify(cluster.pos)} → ${JSON.stringify(override.pos)} [${c.sense}]`);
      cluster.pos = override.pos;
    }

    const pos = Array.isArray(cluster.pos) ? cluster.pos : [];
    const isFused = pos.includes('classifier') && pos.length > 1;
    const moving = isFused ? (cluster.glosses ?? []).filter((g) => CLASSIFIER_GLOSS.test(g)) : [];
    const staying = (cluster.glosses ?? []).filter((g) => !moving.includes(g));
    if (moving.length && staying.length) {
      const nounPart = { ...cluster, pos: pos.filter((p) => p !== 'classifier'), glosses: staying };
      // Label: unique within the entry, derived from the noun sense so a reader of the
      // data can see which sense it was split from. Never shown to the learner (the
      // card shows the gloss); it is an address.
      let sense = `${cluster.sense} — classifier`;
      for (let n = 2; row.definitionClusters.some((x) => x.sense === sense) || out.some((x) => x.sense === sense); n++) {
        sense = `${cluster.sense} — classifier ${n}`;
      }
      let frequencyScore = null;
      try {
        const s = await scoreFrequency(row.word1, cluster.reading, moving, { sense, pos: ['classifier'] });
        frequencyScore = Number.isInteger(s.score) ? s.score : null;
      } catch (e) {
        if (e?.oracleExport) throw e;
        notes.push(`⚠ frequency score failed for new sense "${sense}" (left null): ${e.message}`);
      }
      const classifierPart = { sense, reading: cluster.reading, pos: ['classifier'], frequencyScore, glosses: moving };
      out.push(nounPart, classifierPart);
      newSenses.push(sense);
      notes.push(`split [${cluster.sense}] → noun ${JSON.stringify(staying)} + "${sense}" ${JSON.stringify(moving)} (score ${frequencyScore})`);
    } else {
      out.push(cluster);
    }
  }
  return { clusters: out, notes, newSenses };
}

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }
  console.log(`Classifier-sense patch${DRY_RUN ? ' — DRY RUN (scores new senses, writes nothing)' : ''}`);
  const client = await db.getClient();
  const stats = { rows: 0, changed: 0, splits: 0, conflicts: 0, failed: 0 };
  const splitWords = [];
  try {
    // Candidates: any discoverable row with a "measure word" pos, a fused classifier
    // sense, or a POS_OVERRIDES word. The per-row planner decides what actually changes.
    const { rows } = await client.query(
      `SELECT id, word1, "frequencyScore", "definitionClusters" FROM ${TABLE}
        WHERE language = 'zh' AND discoverable = TRUE
          AND jsonb_typeof("definitionClusters") = 'array'
          AND ${validatedClause(['definitions', 'senseFrequencyScore'], TABLE)}
          AND (EXISTS (SELECT 1 FROM jsonb_array_elements("definitionClusters") c
                        WHERE jsonb_typeof(c->'pos') = 'array'
                          AND (c->'pos' ? 'measure word'
                               OR (c->'pos' ? 'classifier' AND jsonb_array_length(c->'pos') > 1)))
               OR word1 = ANY($1::text[]))
        ORDER BY id`,
      [POS_OVERRIDES.map((o) => o.word)]
    );
    stats.rows = rows.length;
    for (const row of rows) {
      try {
        const plan = await planRow(row);
        if (!plan.notes.length) continue;
        stats.changed++;
        stats.splits += plan.newSenses.length;
        if (plan.newSenses.length) splitWords.push(row.word1);
        for (const n of plan.notes) console.log(`  ${row.word1} (id=${row.id}): ${n}`);
        if (DRY_RUN) continue;
        // Same invariant as the clusterer's write: word score == MAX(cluster score),
        // with a validator-approved word score left alone.
        const reconciled = reconcileFrequencyScore(row.frequencyScore, plan.clusters);
        const res = await client.query(
          `UPDATE ${TABLE}
              SET "definitionClusters" = $1::jsonb,
                  "frequencyScore" = CASE WHEN ${validatedClause(['frequencyScore'], TABLE)}
                                          THEN $3::int ELSE "frequencyScore" END
            WHERE id = $2 AND "definitionClusters" = $4::jsonb`,
          [JSON.stringify(reconciled.clusters ?? plan.clusters), row.id, reconciled.wordScore,
           JSON.stringify(row.definitionClusters)]
        );
        if (res.rowCount === 0) { stats.conflicts++; console.log(`  ⚠ ${row.word1}: clusters changed since read — skipped`); continue; }
        await stampEntries(client, TABLE, row.id);
      } catch (err) {
        if (err?.oracleExport) throw err;
        stats.failed++;
        console.log(`  ✖ ${row.word1} (id=${row.id}): ${err.message}`);
      }
    }
  } finally {
    client.release();
    finalize?.();
    await db.pool.end();
  }
  console.log(`\ncandidates: ${stats.rows}, rows changed: ${stats.changed}, new classifier senses: ${stats.splits}, conflicts: ${stats.conflicts}, failed: ${stats.failed}`);
  if (splitWords.length) {
    console.log(`ℹ split words (new senses have no longDefinition yet; readers fall back to the default sense): ${splitWords.join(',')}`);
  }
}

run().catch((err) => { console.error('Fatal error:', err); process.exit(1); });
