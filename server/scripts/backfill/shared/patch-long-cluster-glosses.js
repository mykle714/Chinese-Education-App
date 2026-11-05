/**
 * Repair Script: give every over-long sense-cluster lead gloss a ≤20-char headline.
 *
 * THE PROBLEM. The dd of a multi-sense word is `ddt(cluster)` = the cluster's first
 * gloss with parentheticals stripped. Step 4 (process-definitions-array) keeps
 * `definitions[0]` ≤20 chars by prepending a synthesized short gloss, but the
 * clusterer (step 6) copies source glosses verbatim and re-sorts them with no length
 * rule, so that guarantee never reached the clusters: the short gloss was sorted
 * behind the long one (一下, 下发) or sat in a different sense (上火), and non-default
 * senses were never checked. Dev audit 2026-11-03: 1,621 zh / 449 es cluster leads
 * over 20 displayed characters.
 *
 * THE FIX. Both clusterers now run the same step for every new clustering (zh Stage
 * C.6, es before writeClusters — shared/lib/senseShortGloss.js). This script applies
 * that step ONCE to rows clustered before it existed, IN PLACE, instead of bumping
 * either clusterer's SCRIPT_VERSION — a bump would mark the whole corpus stale and a
 * `--stale` run would re-partition it, re-minting the sense labels that
 * vet.selectedSense / longDefinition / est tags / breakdown senses address.
 *
 * WHAT IT WRITES
 *   - `definitionClusters`: for each long-lead cluster on a multi-sense entry, the
 *     new gloss goes first (or an existing identical gloss is moved first). Labels,
 *     scores, readings, pos and cluster ORDER are untouched, so frequencyScore,
 *     pronunciation and searchReadings need no re-derivation.
 *   - zh only, `breakdown[char].definition` on multi-char words: that field is a
 *     MATERIALIZED copy of the tagged cluster's lead gloss (chinese/
 *     backfill-breakdown-senses.js → clusterLeadGloss), so every breakdown pointing at
 *     a patched (char, sense) is refreshed to the new lead. Word Search re-resolves
 *     live and needs nothing.
 *   Nothing else is materialized from the lead gloss: est segment definitions and
 *   ddCollisionKey are derived at read time; icons key off `definitions[0]`.
 *
 * SAFETY
 *   - Idempotent / resumable: a patched cluster's lead is ≤20, so a re-run skips it.
 *   - Optimistic write: the UPDATE matches on the clusters it read, so a row changed
 *     by a concurrent backfill is skipped with a warning rather than overwritten.
 *   - Skips rows a validator reviewed on `definitions` or `senseFrequencyScore`
 *     (the clusterers' own guard; docs/DATA_VALIDATION_SYSTEM.md).
 *   - Every synthesized gloss prints a "⚠ SHORT GLOSS REVIEW" line for human review.
 *
 * LAYER: data-enrichment (backfill), zh + es. One Sonnet call per long cluster
 * (Opus on retry).
 *
 * Usage (from the backend container, so it sees .env.docker):
 *   docker exec cow-backend npx tsx scripts/backfill/shared/patch-long-cluster-glosses.js --dry-run
 *   docker exec cow-backend npx tsx scripts/backfill/shared/patch-long-cluster-glosses.js --lang=zh
 *   ... --words=一下,上火      # scope to headwords
 *   ... --limit=20             # first N candidate entries
 *   ... --concurrency=6        # entries in flight (default 6)
 *
 * Referenced by: docs/DEFINITION_CLUSTERS.md § "Short lead gloss per sense".
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog, cachedSystem } from '../run-log.js';
import { parseBackfillArgs } from './lib/cli.js';
import { clusterLeadGloss } from './lib/senseClusters.js';
import fs from 'fs';
import {
  createSenseShortGlosser, needsNewHeadline, printShortGlossReview, MAX_SENSE_GLOSS_LEN,
  displayedLead, withShortGlossFirst,
} from './lib/senseShortGloss.js';

const SCRIPT_VERSION = 1;
const LANGUAGES = { zh: 'Chinese', es: 'Spanish' };

const argv = process.argv.slice(2);
const { targetWords } = parseBackfillArgs(argv);
const DRY_RUN = argv.includes('--dry-run');
const langArg = argv.find((a) => a.startsWith('--lang='))?.slice('--lang='.length);
const LANGS = langArg ? [langArg] : ['zh', 'es'];
const LIMIT = Number(argv.find((a) => a.startsWith('--limit='))?.slice('--limit='.length)) || null;
const CONCURRENCY = Number(argv.find((a) => a.startsWith('--concurrency='))?.slice('--concurrency='.length)) || 6;
// --redo=<file.json>: [{ id, sense, gloss }] — REPLACE a gloss this step generated
// earlier (it must still be that sense's glosses[0]) with a fresh one, e.g. after the
// prompt/validator were tightened. The old gloss is kept if regeneration fails, and an
// entry only ever loses a gloss this step wrote — list only "prepended" glosses, never
// "promoted" ones (those are source text).
const REDO_PATH = argv.find((a) => a.startsWith('--redo='))?.slice('--redo='.length) ?? null;
const REDO = REDO_PATH ? JSON.parse(fs.readFileSync(REDO_PATH, 'utf8')) : null;

for (const l of LANGS) if (!LANGUAGES[l]) { console.error(`unknown --lang=${l}`); process.exit(1); }

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const { stampEntries, validatedClause, finalize } = initRunLog({
  script: 'shared/patch-long-cluster-glosses', version: SCRIPT_VERSION, anthropic,
});

/** Bounded-concurrency map: each worker pulls the next item until the list is drained. */
async function mapPool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/**
 * zh only: refresh the materialized `breakdown[char].definition` on every multi-char
 * row whose breakdown points at a patched (char, sense). `patched` maps a single
 * character → Map(sense label → its new cluster).
 */
async function refreshBreakdowns(client, patched) {
  let updated = 0;
  for (const [char, senses] of patched) {
    const { rows } = await client.query(
      `SELECT id, word1, breakdown FROM dictionaryentries_zh
        WHERE language = 'zh' AND char_length(word1) > 1
          AND breakdown ? $1 AND breakdown -> $1 ->> 'sense' = ANY($2::text[])
          AND ${validatedClause(['breakdown'], 'dictionaryentries_zh')}`,
      [char, [...senses.keys()]]
    );
    const touched = new Map(); // "old → new" → [word1…], for one summary line per change
    for (const row of rows) {
      const entry = row.breakdown[char];
      const definition = clusterLeadGloss(senses.get(entry.sense));
      if (!definition || entry.definition === definition) continue;
      const key = `"${entry.definition}" → "${definition}"`;
      if (!touched.has(key)) touched.set(key, []);
      touched.get(key).push(row.word1);
      if (!DRY_RUN) {
        // jsonb_set on the one key, so a concurrent edit to another char survives.
        await client.query(
          `UPDATE dictionaryentries_zh
              SET breakdown = jsonb_set(breakdown, ARRAY[$2::text, 'definition'], to_jsonb($3::text))
            WHERE id = $1`,
          [row.id, char, definition]
        );
      }
      updated++;
    }
    for (const [key, words] of touched) {
      const sample = words.slice(0, 5).join('、') + (words.length > 5 ? ` …+${words.length - 5}` : '');
      console.log(`  ↻ breakdown [${char}] ${key} in ${words.length} word(s): ${sample}`);
    }
  }
  return updated;
}

/**
 * --redo: regenerate the listed senses' generated lead. Returns the same
 * { clusters, changes, errors } shape as shortenLongLeads.
 */
async function redoLeads(generateSenseShortGloss, row, items) {
  const changes = [];
  const errors = [];
  const clusters = row.definitionClusters.map((c) => ({ ...c }));
  for (const item of items) {
    const i = clusters.findIndex((c) => c.sense === item.sense);
    if (i < 0 || clusters[i].glosses?.[0] !== item.gloss) {
      errors.push({ sense: item.sense, error: `skipped — "${item.gloss}" is no longer this sense's lead` });
      continue;
    }
    const without = { ...clusters[i], glosses: clusters[i].glosses.slice(1) };
    const others = clusters.filter((_, j) => j !== i).map(displayedLead).filter(Boolean);
    const r = await generateSenseShortGloss(row.word1, without, others);
    if (r.error) { errors.push({ sense: item.sense, error: `${r.error} — kept "${item.gloss}"` }); continue; }
    if (r.gloss === item.gloss) continue; // same answer: nothing to change
    const { glosses, action } = withShortGlossFirst(without.glosses, r.gloss);
    clusters[i] = { ...without, glosses };
    changes.push({ sense: item.sense, from: item.gloss, to: r.gloss, action: `redo/${action}`, model: r.model });
  }
  return { clusters, changes, errors };
}

async function runLanguage(client, lang) {
  const table = `dictionaryentries_${lang}`;
  const { shortenLongLeads, generateSenseShortGloss } = createSenseShortGlosser({ anthropic, cachedSystem, language: LANGUAGES[lang] });
  const redoById = new Map();
  for (const it of REDO ?? []) { if (!redoById.has(it.id)) redoById.set(it.id, []); redoById.get(it.id).push(it); }

  const params = [];
  let wordsFilter = '';
  if (targetWords?.length) { params.push(targetWords); wordsFilter = `AND word1 = ANY($1::text[])`; }
  const { rows: all } = await client.query(
    `SELECT id, word1, "definitionClusters" FROM ${table}
      WHERE language = $${params.length + 1} AND discoverable = TRUE
        AND jsonb_typeof("definitionClusters") = 'array'
        AND jsonb_array_length("definitionClusters") > 1
        AND ${validatedClause(['definitions', 'senseFrequencyScore'], table)}
        ${wordsFilter}
      ORDER BY id`,
    [...params, lang]
  );
  // The length test uses the real stripParentheses, so it runs here, not in SQL.
  // Normal mode: leads over the budget, or pure classifier senses not yet in
  // "classifier for …" form. --redo mode: exactly the listed entries.
  let candidates = REDO
    ? all.filter((r) => redoById.has(r.id))
    : all.filter((r) => r.definitionClusters.some(needsNewHeadline));
  if (LIMIT) candidates = candidates.slice(0, LIMIT);
  const work = REDO
    ? (REDO.filter((it) => candidates.some((r) => r.id === it.id))).length
    : candidates.reduce((n, r) => n + r.definitionClusters.filter(needsNewHeadline).length, 0);
  console.log(`\n[${lang}] ${candidates.length} entries / ${work} clusters ${REDO ? 'to redo' : `with a lead over ${MAX_SENSE_GLOSS_LEN} chars or a classifier lead to format`}${DRY_RUN ? ' — DRY RUN (calls the model, writes nothing)' : ''}`);

  const stats = { entries: 0, glosses: 0, promoted: 0, errors: 0, conflicts: 0, failed: 0 };
  const patchedChars = new Map(); // zh single char → Map(sense → new cluster)

  await mapPool(candidates, CONCURRENCY, async (row) => {
    try {
      const sg = REDO
        ? await redoLeads(generateSenseShortGloss, row, redoById.get(row.id))
        : await shortenLongLeads(row.word1, row.definitionClusters);
      printShortGlossReview(row.word1, row.id, sg);
      stats.errors += sg.errors.length;
      if (!sg.changes.length) return;
      stats.glosses += sg.changes.length;
      stats.promoted += sg.changes.filter((c) => c.action === 'promoted').length;

      if (!DRY_RUN) {
        // Optimistic: only write if the clusters are still the ones we read.
        const res = await client.query(
          `UPDATE ${table} SET "definitionClusters" = $1::jsonb
            WHERE id = $2 AND "definitionClusters" = $3::jsonb`,
          [JSON.stringify(sg.clusters), row.id, JSON.stringify(row.definitionClusters)]
        );
        if (res.rowCount === 0) {
          stats.conflicts++;
          console.log(`  ⚠ ${row.word1} (id=${row.id}): clusters changed since read — skipped`);
          return;
        }
        await stampEntries(client, table, row.id);
      }
      stats.entries++;
      if (lang === 'zh' && [...row.word1].length === 1) {
        const changedSenses = new Set(sg.changes.map((c) => c.sense));
        const bySense = new Map(sg.clusters.filter((c) => changedSenses.has(c.sense)).map((c) => [c.sense, c]));
        patchedChars.set(row.word1, bySense);
      }
    } catch (err) {
      if (err?.oracleExport) throw err;
      stats.failed++;
      console.log(`  ✖ ${row.word1} (id=${row.id}): ${err.message}`);
    }
  });

  const breakdowns = lang === 'zh' ? await refreshBreakdowns(client, patchedChars) : 0;
  console.log(`[${lang}] entries patched: ${stats.entries}, glosses placed: ${stats.glosses} (${stats.promoted} were existing glosses moved first), `
    + `model failures: ${stats.errors}, write conflicts: ${stats.conflicts}, row errors: ${stats.failed}`
    + (lang === 'zh' ? `, breakdown definitions refreshed: ${breakdowns}` : ''));
  return stats;
}

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }
  // A pooled query per statement (not one checked-out client): workers run
  // concurrently, and a single pg client serializes them anyway.
  const client = db.pool;
  try {
    for (const lang of LANGS) await runLanguage(client, lang);
  } finally {
    finalize?.();
    await db.pool.end();
  }
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
