/**
 * Orphaned sense keys in zh `longDefinition` — reconcile engine.
 *
 * LAYER: data-enrichment (backfill) utility layer. Writes dictionaryentries_zh."longDefinition"
 * — only an entry's `sense` key (or drops a duplicate entry), never definition text.
 *
 * PROBLEM: longDefinition is an array of { sense, pos, definition }, one per (sense, POS)
 * pair (backfill-long-definitions.js v15). `sense` is the join key to definitionClusters, so
 * a re-cluster that renamed the label un-links the paragraph from its sense and the eip
 * sense list stops showing it. Measured 2026-11-11 on PPE: 6,479 orphaned keys on 4,381
 * entries. Renames are now carried forward at re-cluster time (./senseCarryForward.js);
 * this engine repairs the backlog and any SPLIT the carry-forward could not decide.
 *
 * TWO PASSES per orphaned entry:
 *   0. deterministic — `deterministicRemap` on the label text. Free.
 *   A. one model call per remaining entry: the paragraph itself says which sense it
 *      explains, so the model reads it against the word's CURRENT clusters and names the
 *      matching label, or null.
 * Resolution, per row under SELECT … FOR UPDATE:
 *   - mapped, and no current entry already holds that (sense, POS) → re-key it;
 *   - mapped, but that (sense, POS) already has a current paragraph → drop the orphan
 *     (the current one was written for the current clusters and wins);
 *   - null → leave it, and report the word: a sense with no paragraph can only be filled by
 *     regenerating the word's whole array (backfill-long-definitions.js --words=…; a targeted
 *     run skips the IS-NULL gate), because that script writes per word, not per sense.
 * Rows a validator approved/flagged for `definitions` are skipped (DEFINITIONS_NOT_REVIEWED).
 *
 * Referenced by: chinese/reconcile-sentence-senses.js (--long-definitions),
 * docs/EXAMPLE_SENTENCES.md § "Stale sense labels", docs/DEFINITION_CLUSTERS.md.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cachedSystem } from '../../run-log.js';
import { parseModelJson } from '../../shared/lib/json.js';
import { TAGGER_MODEL } from './segmentTagger.js';
import { deterministicRemap } from './sentenceSenseOrphans.js';
import { DEFINITIONS_NOT_REVIEWED } from './senseCarryForward.js';
import { mapPool } from './reconcileSenses.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EST = { in: 700, out: 25 };
const SONNET_PER_MTOK = { input: 3, output: 15 }; // mirrors run-log.js PRICING_PER_MTOK['claude-sonnet-4-6']

const LONGDEF_MAPPER_SYSTEM = `A Chinese dictionary entry's list of senses was revised. One of its learner explanations still points at a sense label from the OLD list, which no longer exists. You decide which CURRENT sense that explanation describes.

You are given the word, the explanation (its old label, part of speech and text), and the word's CURRENT senses (label, reading, parts of speech, glosses).

If the explanation clearly describes exactly ONE current sense, answer that sense's label, copied verbatim, character-for-character. If it describes several current senses at once, or none of them, answer null. Never invent, paraphrase, shorten or combine labels.

Respond with ONLY: {"label": "<exact current label>"} or {"label": null}`;

/**
 * @param {import('pg').PoolClient} client
 * @param {{ anthropic: object, hostWords?: string[]|null, estimate?: boolean, dryRun?: boolean,
 *           concurrency?: number }} opts
 * @returns {Promise<object>} stats, incl. `regenWords` (words left with an unmappable paragraph)
 */
export async function runLongDefReconcile(client, opts) {
  const { anthropic, hostWords = null, estimate = false, concurrency = 8 } = opts;
  const dryRun = !!opts.dryRun || estimate;
  const logPath = path.join(__dirname, '../../../../logs', `reconcile-longdef-senses-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const logDecision = (obj) => { if (!estimate) fs.appendFileSync(logPath, JSON.stringify(obj) + '\n'); };
  const stats = { rows: 0, orphans: 0, pass0: 0, passA: 0, droppedDuplicates: 0, unmapped: 0, calls: 0, apiFailures: 0, oracleCaptured: 0, failedRows: 0, regenWords: [] };

  const params = [];
  let scope = '';
  if (hostWords?.length) { params.push(hostWords); scope = 'AND d.word1 = ANY($1)'; }
  const { rows } = await client.query(`
    SELECT d.id, d.word1, d."longDefinition" ld, d."definitionClusters" dc
      FROM dictionaryentries_zh d
     WHERE d.language = 'zh'
       AND jsonb_typeof(d."longDefinition") = 'array'
       AND jsonb_typeof(d."definitionClusters") = 'array' AND jsonb_array_length(d."definitionClusters") > 0
       AND ${DEFINITIONS_NOT_REVIEWED} ${scope}
     ORDER BY d.id`, params);

  // Every orphaned entry, with the pass-0 answer when the label text alone decides it.
  const jobs = []; // { rowId, word, entryIdx, entry, clusters, to? }
  for (const r of rows) {
    const labels = new Set(r.dc.map((c) => c?.sense));
    r.ld.forEach((entry, entryIdx) => {
      if (!entry || typeof entry.sense !== 'string' || labels.has(entry.sense)) return;
      const to = deterministicRemap(entry.sense, r.dc);
      jobs.push({ rowId: r.id, word: r.word1, entryIdx, entry, clusters: r.dc, to, pass: to ? '0' : 'A' });
    });
  }
  stats.rows = new Set(jobs.map((j) => j.rowId)).size;
  stats.orphans = jobs.length;
  const needModel = jobs.filter((j) => !j.to);
  console.log(`🔎 long definitions: ${stats.orphans} orphaned keys on ${stats.rows} rows; ${jobs.length - needModel.length} decided free, ${needModel.length} need the model${dryRun ? ' — DRY RUN' : ''}`);

  if (estimate) {
    const usd = (needModel.length * (EST.in * SONNET_PER_MTOK.input + EST.out * SONNET_PER_MTOK.output)) / 1e6;
    console.log(`💰 ESTIMATE: ${needModel.length} calls ≈ $${usd.toFixed(2)} (Sonnet 4.6, no calls made)`);
    stats.estimateUsdMax = Number(usd.toFixed(2));
    return stats;
  }

  // ── per row: ask for that row's undecided entries, then write the row at once ──
  // Row-at-a-time (not "all calls, then all writes") so an interrupted run keeps every
  // answer it paid for: a re-run finds those keys already fixed and skips them.
  async function askModel(j) {
    const userText = `Word: ${j.word}
Explanation — old label: "${j.entry.sense}", part of speech: ${j.entry.pos ?? '?'}
${j.entry.definition ?? ''}

CURRENT senses:
${j.clusters.map((c) => `- "${c.sense}" (${c.reading ?? '?'}; ${[].concat(c.pos ?? []).join(', ')}): ${(c.glosses ?? []).slice(0, 6).join('; ')}`).join('\n')}`;
    stats.calls++;
    try {
      const response = await anthropic.messages.create({
        model: TAGGER_MODEL, max_tokens: 200, temperature: 0,
        system: cachedSystem(LONGDEF_MAPPER_SYSTEM),
        messages: [{ role: 'user', content: userText }],
      });
      const label = parseModelJson(response.content[0]?.text ?? '')?.label;
      j.to = typeof label === 'string' && j.clusters.some((c) => c.sense === label) ? label : null;
    } catch (err) {
      if (err?.oracleExport) { stats.oracleCaptured++; j.skip = true; return; }
      stats.apiFailures++; j.skip = true; // transport error ≠ "no match": retry next run
      console.log(`    API FAILED ${j.word} "${j.entry.sense}": ${err.message}`);
    }
  }

  /** Apply one row's decided jobs under a row lock (re-reads the CURRENT array). */
  async function applyRow(rowId, rowJobs) {
    if (!dryRun) await client.query('BEGIN');
    try {
      const { rows: cur } = dryRun
        ? { rows: [{ ld: rows.find((r) => r.id === rowId).ld }] }
        : await client.query(`SELECT d."longDefinition" ld FROM dictionaryentries_zh d WHERE d.id = $1 AND ${DEFINITIONS_NOT_REVIEWED} FOR UPDATE`, [rowId]);
      const ld = cur[0]?.ld;
      if (!Array.isArray(ld)) { if (!dryRun) await client.query('ROLLBACK'); return; }
      // (sense, POS) pairs held by entries that are NOT being reconciled — they win collisions.
      const orphanIdx = new Set(rowJobs.map((j) => j.entryIdx));
      const held = new Set(ld.filter((e, i) => !orphanIdx.has(i)).map((e) => `${e?.sense}\t${e?.pos ?? ''}`));
      const drop = new Set();
      for (const j of rowJobs) {
        const entry = ld[j.entryIdx];
        if (!entry || entry.sense !== j.entry.sense) continue; // changed underneath us
        const { pass } = j;
        logDecision({ pass, row: rowId, word: j.word, pos: entry.pos, from: entry.sense, to: j.to ?? null });
        if (!j.to) { stats.unmapped++; regen.add(j.word); continue; }
        const pairKey = `${j.to}\t${entry.pos ?? ''}`;
        if (held.has(pairKey)) { drop.add(j.entryIdx); stats.droppedDuplicates++; continue; }
        entry.sense = j.to;
        held.add(pairKey);
        stats[pass === '0' ? 'pass0' : 'passA']++;
      }
      if (!dryRun) {
        await client.query(`UPDATE dictionaryentries_zh SET "longDefinition" = $1::jsonb WHERE id = $2`, [JSON.stringify(ld.filter((_, i) => !drop.has(i))), rowId]);
        await client.query('COMMIT');
      }
    } catch (err) {
      if (!dryRun) await client.query('ROLLBACK');
      stats.failedRows++;
      console.log(`    FAILED row ${rowId}: ${err.message}`);
    }
  }

  // One pg client: two interleaved BEGIN…COMMIT blocks would merge, so writes are chained.
  let writeChain = Promise.resolve();
  const serialWrite = (task) => { const run = writeChain.then(task); writeChain = run.catch(() => {}); return run; };

  const byRow = new Map();
  for (const j of jobs) (byRow.get(j.rowId) ?? byRow.set(j.rowId, []).get(j.rowId)).push(j);
  const regen = new Set();
  let rowsDone = 0;
  await mapPool([...byRow.entries()], concurrency, async ([rowId, rowJobs]) => {
    for (const j of rowJobs) if (!j.to) await askModel(j);
    const decided = rowJobs.filter((j) => !j.skip);
    if (decided.length) await serialWrite(() => applyRow(rowId, decided));
    if (++rowsDone % 250 === 0) console.log(`   long definitions: ${rowsDone}/${byRow.size} rows`);
  });
  stats.regenWords = [...regen];

  console.log('\n' + '='.repeat(60));
  console.log(`📊 reconcile-longdef-senses ${dryRun ? 'DRY RUN ' : ''}summary`);
  for (const [k, v] of Object.entries(stats)) if (k !== 'regenWords') console.log(`   ${k.padEnd(18)} ${v}`);
  if (stats.regenWords.length) {
    console.log(`   ⚠ ${stats.regenWords.length} word(s) keep an unmappable paragraph — regenerate with:`);
    console.log(`     backfill-long-definitions.js --words=${stats.regenWords.slice(0, 40).join(',')}${stats.regenWords.length > 40 ? ',…' : ''}`);
  }
  console.log(`   decisions log      ${logPath}`);
  console.log('='.repeat(60));
  return stats;
}
