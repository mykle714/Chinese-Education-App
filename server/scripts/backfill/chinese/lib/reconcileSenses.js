/**
 * Orphaned sense-label reconcile for stored zh example sentences — the engine behind
 * chinese/reconcile-sentence-senses.js (the CLI) and backfill-example-sentences.js
 * --reconcile (what the oracle planner's `sentenceSenseOrphan` drift probe schedules).
 *
 * LAYER: data-enrichment (backfill) utility layer. Writes dictionaryentries_zh."exampleSentences"
 * — only the `senseDict` / `segmentOccurrenceTags[i].sense` / headword `sense` pointers,
 * never sentence text, so validator approvals (which cover foreignText/english only —
 * DictionaryDAL → isSentenceHumanApproved) are unaffected.
 *
 * PROBLEM: re-clustering a word renames its definitionClusters labels; every sentence
 * tagged earlier keeps the old label, which the read path can no longer resolve, so the
 * segment loses its sense-aware gloss AND pinyin (heteronyms fall back to the default
 * reading — 地 dì instead of de). See ./sentenceSenseOrphans.js. Renames are now carried
 * forward by the clusterer itself (./senseCarryForward.js); what still lands here are the
 * SPLIT labels it cannot carry, plus the pre-existing backlog.
 *
 * THREE PASSES, cheapest first, over every orphaned (segment, stale label) PAIR:
 *   0. deterministic — `deterministicRemap` (same-sense rename / broadened cluster). Free.
 *   A. pair mapper — ONE model call per remaining pair: given the stale label, the word's
 *      current labels and sample sentences, name the one current label every sample uses,
 *      or null when the samples need different labels (the old cluster was SPLIT).
 *   B. per-sentence re-tag — for pairs A left null: the shared segment tagger
 *      (./segmentTagger.js) re-labels ONLY the stale occurrences, one call per sentence.
 *      A tag the model still cannot place is DELETED (renders exactly like the orphan did,
 *      but stops counting as one), so a full run converges to zero orphans. An API failure
 *      is never read as "cannot place" — it leaves the orphan for the next run.
 *
 * Writes are row-by-row read-modify-write under SELECT … FOR UPDATE and only replace a
 * label that still equals the stale one, so a concurrent oracle round cannot be clobbered.
 *
 * Referenced by: chinese/reconcile-sentence-senses.js, chinese/backfill-example-sentences.js
 * (--reconcile), shared/lib/requiredScripts.js (DRIFT_PROBES.sentenceSenseOrphan),
 * docs/EXAMPLE_SENTENCES.md § "Stale sense labels".
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cachedSystem } from '../../run-log.js';
import { parseModelJson } from '../../shared/lib/json.js';
import { buildTagItems, createSegmentTagger, TAGGER_MODEL } from './segmentTagger.js';
import { deterministicRemap, findOrphanedSenseTags, replaceSenseLabel } from './sentenceSenseOrphans.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_PER_PAIR = 10;

// Rough per-call token sizes for `estimate` (measured on the prompts below; the tagger's
// system prompt is under Sonnet's ~1024-token cache floor, so no cache discount applies).
const EST = { pairIn: 750, pairOut: 25, tagIn: 800, tagOut: 70 };
const SONNET_PER_MTOK = { input: 3, output: 15 }; // mirrors run-log.js PRICING_PER_MTOK['claude-sonnet-4-6']

// ── pass A prompt ───────────────────────────────────────────────────────────
const PAIR_MAPPER_SYSTEM = `A Chinese dictionary entry's list of senses was revised. Some example sentences still point at a sense label from the OLD list, which no longer exists. You decide which CURRENT label those sentences mean.

You are given the word, the OLD label, the word's CURRENT labels (with each one's reading), and sample sentences that were tagged with the OLD label — the word's occurrence marked with 【】, plus the English translation.

If ONE current label correctly describes the marked word in EVERY sample, answer it, copied verbatim, character-for-character. If the samples need DIFFERENT current labels (the old sense was split), or no current label fits, answer null. Never invent, paraphrase, shorten or combine labels.

The samples are only a few of many sentences. So if the OLD label itself names two or more of the current senses (e.g. "completed-action / change-of-state particle" when "completed-action particle" and "change-of-state particle" are now separate), answer null even when every sample happens to agree — each sentence must then be judged on its own.

Respond with ONLY: {"label": "<exact current label>"} or {"label": null}`;

/** One sample line: the marked sentence + translation. */
function sampleLine(s, seg, index) {
  const segs = Array.isArray(s.segments) ? s.segments : null;
  let marked = s.foreignText;
  if (segs) {
    const at = Number.isInteger(index) ? index : segs.indexOf(seg);
    if (at >= 0) marked = segs.map((x, i) => (i === at ? `【${x}】` : x)).join('');
  }
  return `- ${marked} — ${s.english}`;
}

/**
 * Run `fn` over `items` with at most `limit` in flight. Model calls are I/O-bound, so a
 * small pool turns a ~day-long sequential pass into hours without stressing rate limits.
 */
export async function mapPool(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Reconcile every orphaned sense tag in scope.
 *
 * @param {import('pg').PoolClient} client
 * @param {object} opts
 * @param {import('@anthropic-ai/sdk').default} opts.anthropic - the caller's (run-log-wrapped) client
 * @param {string[]|null} [opts.hostWords]  - scope to these HOST rows (default: every discoverable row)
 * @param {string[]|null} [opts.segments]   - scope to orphans of these SEGMENTS
 * @param {boolean} [opts.estimate]         - count + price only: no model calls, no writes
 * @param {boolean} [opts.dryRun]           - real model calls, no writes
 * @param {'0'|'A'|'B'} [opts.lastPass]     - stop after this pass (default 'B')
 * @param {number|null} [opts.limitPairs]   - only the N largest pairs
 * @param {number} [opts.concurrency]       - model calls in flight (default 8)
 * @param {string|null} [opts.replayPath]   - reuse pass-B answers from an earlier decisions log
 * @param {string} [opts.logLabel]          - decisions-log file prefix
 * @returns {Promise<object>} run stats; `pairs === 0` ⟺ nothing was orphaned in scope
 */
export async function runSenseReconcile(client, opts) {
  const {
    anthropic,
    hostWords: HOST_WORDS = null,
    estimate: ESTIMATE = false,
    lastPass = 'B',
    limitPairs: LIMIT_PAIRS = null,
    concurrency: CONCURRENCY = 8,
    replayPath: REPLAY_PATH = null,
    logLabel = 'reconcile-sentence-senses',
  } = opts;
  const DRY_RUN = !!opts.dryRun || ESTIMATE;
  const SEGMENTS = opts.segments?.length ? new Set(opts.segments) : null;
  const LAST_PASS = String(lastPass).toUpperCase();
  const callSegmentTagger = createSegmentTagger({ anthropic });
  const LOG_PATH = path.join(__dirname, '../../../../logs', `${logLabel}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const logDecision = (obj) => { if (!ESTIMATE) fs.appendFileSync(LOG_PATH, JSON.stringify(obj) + '\n'); };

  async function mapPairWithModel(seg, staleLabel, clusters, samples) {
    const userText = `Word: ${seg}
  OLD label: "${staleLabel}"
  CURRENT labels:
  ${clusters.map((c) => `- "${c.sense}" (${c.reading ?? '?'})`).join('\n')}

  Samples tagged with the OLD label:
  ${samples.join('\n')}`;
    const response = await anthropic.messages.create({
      model: TAGGER_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: cachedSystem(PAIR_MAPPER_SYSTEM),
      messages: [{ role: 'user', content: userText }],
    });
    const parsed = parseModelJson(response.content[0]?.text ?? '');
    const label = parsed && typeof parsed === 'object' ? parsed.label : undefined;
    // Only an exact current label counts; anything else (null, a paraphrase) goes to pass B.
    return typeof label === 'string' && clusters.some((c) => c.sense === label) ? label : null;
  }

  async function loadClusters(client) {
    const { rows } = await client.query(`
      SELECT DISTINCT ON (word1) word1, "definitionClusters"
      FROM dictionaryentries_zh
      WHERE language = 'zh' AND jsonb_typeof("definitionClusters") = 'array'
      ORDER BY word1, id`);
    // First row per word1 wins, mirroring buildDictMap on the read path.
    const clusters = new Map();
    for (const r of rows) clusters.set(r.word1, r.definitionClusters.filter((c) => c && typeof c.sense === 'string'));
    return clusters;
  }

  async function loadHosts(client) {
    const params = [];
    let scope = 'AND discoverable = TRUE';
    if (HOST_WORDS?.length) { params.push(HOST_WORDS); scope = `AND word1 = ANY($1)`; }
    const { rows } = await client.query(`
      SELECT id, word1, "exampleSentences"
      FROM dictionaryentries_zh
      WHERE language = 'zh' AND jsonb_typeof("exampleSentences") = 'array' ${scope}
      ORDER BY id`, params);
    return rows;
  }

  /**
   * Apply `edits` ([{ sentenceIdx, tag, newLabel }]) to one row under a row lock. Re-reads
   * the row so edits land on the CURRENT array; replaceSenseLabel skips any tag a concurrent
   * writer already changed. Returns the number of tag sources changed.
   */
  async function applyRowEdits(client, rowId, edits) {
    if (DRY_RUN) return edits.length;
    await client.query('BEGIN');
    try {
      const { rows } = await client.query(
        `SELECT word1, "exampleSentences" es FROM dictionaryentries_zh WHERE id = $1 FOR UPDATE`, [rowId]);
      const es = rows[0]?.es;
      if (!Array.isArray(es)) { await client.query('ROLLBACK'); return 0; }
      let changed = 0;
      for (const e of edits) {
        const s = es[e.sentenceIdx];
        if (s) changed += replaceSenseLabel(s, e.tag, e.newLabel, rows[0].word1);
      }
      if (changed) await client.query(`UPDATE dictionaryentries_zh SET "exampleSentences" = $1::jsonb WHERE id = $2`, [JSON.stringify(es), rowId]);
      await client.query('COMMIT');
      return changed;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }

  /**
   * Serialize every DB write through one promise chain: the script holds ONE pg client, and
   * two interleaved BEGIN…COMMIT blocks on one client would merge into one transaction.
   * Results are written as soon as each model answer lands, so a crash mid-pass keeps
   * everything already paid for.
   */
  let writeChain = Promise.resolve();
  function serialWrites(task) {
    const run = writeChain.then(task);
    writeChain = run.catch(() => {});
    return run;
  }

  /** Group a flat edit list by host row and write each row once. */
  async function writeEdits(client, edits, stats, statKey) {
    const byRow = new Map();
    for (const e of edits) (byRow.get(e.rowId) ?? byRow.set(e.rowId, []).get(e.rowId)).push(e);
    for (const [rowId, rowEdits] of byRow) {
      try {
        stats[statKey] += await applyRowEdits(client, rowId, rowEdits);
      } catch (err) {
        stats.failedRows++;
        console.log(`    FAILED row ${rowId}: ${err.message}`);
      }
    }
  }

  /** Pass-B answers from an earlier run, keyed `${row}#${i}\t${seg}\t${from}` → label|null. */
  /**
   * Answers already paid for, from one or more earlier decisions logs (comma-separated).
   *   b      — pass-B answers, keyed `${row}#${i}\t${seg}\t${from}` → label|null
   *   splits — pairs pass A already judged SPLIT (`${seg}\t${from}`), so a resumed run sends
   *            them straight to pass B instead of re-asking. (A pair pass A MAPPED was
   *            written at once and is no longer orphaned, so it never comes back.)
   */
  function loadReplay() {
    const b = new Map();
    const splits = new Set();
    if (!REPLAY_PATH) return { b, splits };
    for (const file of String(REPLAY_PATH).split(',').map((s) => s.trim()).filter(Boolean)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          if (d.pass === 'B') b.set(`${d.row}#${d.i}\t${d.seg}\t${d.from}`, d.to ?? null);
          else if (d.pass === 'A' && !d.to) splits.add(`${d.seg}\t${d.from}`);
        } catch { /* a torn last line from a killed run — skip it */ }
      }
    }
    console.log(`♻️  replay: ${b.size} pass-B answers, ${splits.size} pass-A split verdicts from ${REPLAY_PATH}`);
    return { b, splits };
  }

  const stats = { pairs: 0, pass0Tags: 0, passATags: 0, passBTags: 0, passBDeleted: 0, pairCalls: 0, tagCalls: 0, apiFailures: 0, oracleCaptured: 0, failedRows: 0 };
  try {
    const clusters = await loadClusters(client);
    const clustersOf = (seg) => clusters.get(seg);
    const hosts = await loadHosts(client);

    // Collect every orphan, grouped into (segment, stale label) pairs.
    const pairs = new Map(); // key → { seg, label, hits: [{ rowId, sentenceIdx, tag, sentence }] }
    for (const row of hosts) {
      row.exampleSentences.forEach((sentence, sentenceIdx) => {
        for (const tag of findOrphanedSenseTags(sentence, clustersOf)) {
          if (SEGMENTS && !SEGMENTS.has(tag.seg)) continue;
          const key = `${tag.seg}\t${tag.label}`;
          if (!pairs.has(key)) pairs.set(key, { seg: tag.seg, label: tag.label, hits: [] });
          pairs.get(key).hits.push({ rowId: row.id, sentenceIdx, tag, sentence });
        }
      });
    }
    let pairList = [...pairs.values()].sort((a, b) => b.hits.length - a.hits.length);
    if (LIMIT_PAIRS) pairList = pairList.slice(0, LIMIT_PAIRS);
    stats.pairs = pairList.length;
    const totalTags = pairList.reduce((n, p) => n + p.hits.length, 0);
    console.log(`🔎 ${hosts.length} host rows, ${pairList.length} orphaned (segment, label) pairs, ${totalTags} tags${DRY_RUN ? ' — DRY RUN' : ''}`);

    // ── pass 0: deterministic ──
    const pass0Edits = [];
    const remaining = [];
    for (const p of pairList) {
      const to = deterministicRemap(p.label, clustersOf(p.seg));
      if (to) {
        logDecision({ pass: '0', seg: p.seg, from: p.label, to, n: p.hits.length });
        for (const h of p.hits) pass0Edits.push({ ...h, newLabel: to });
      } else remaining.push(p);
    }
    await writeEdits(client, pass0Edits, stats, 'pass0Tags');
    console.log(`✅ pass 0 (free): ${pairList.length - remaining.length} pairs, ${pass0Edits.length} tags`);

    if (ESTIMATE) {
      const sentencesLeft = new Set(remaining.flatMap((p) => p.hits.map((h) => `${h.rowId}#${h.sentenceIdx}`))).size;
      const usd = (inTok, outTok) => (inTok * SONNET_PER_MTOK.input + outTok * SONNET_PER_MTOK.output) / 1e6;
      const aCost = usd(remaining.length * EST.pairIn, remaining.length * EST.pairOut);
      const bMax = usd(sentencesLeft * EST.tagIn, sentencesLeft * EST.tagOut);
      console.log(`\n💰 ESTIMATE (Sonnet 4.6, no calls made)`);
      console.log(`   pass A: ${remaining.length} pair calls ≈ $${aCost.toFixed(2)}`);
      console.log(`   pass B: ≤ ${sentencesLeft} sentence calls ≈ ≤ $${bMax.toFixed(2)} (only pairs A leaves null)`);
      console.log(`   total ≤ $${(aCost + bMax).toFixed(2)}`);
      stats.estimateUsdMax = Number((aCost + bMax).toFixed(2));
      return stats;
    }
    if (LAST_PASS === '0') return stats;

    // ── pass A: one call per pair ──
    let passATagCount = 0;
    let passADone = 0;
    const splitPairs = [];
    const replay = loadReplay();
    stats.replayed = 0;
    await mapPool(remaining, CONCURRENCY, async (p) => {
      if (replay.splits.has(`${p.seg}\t${p.label}`)) { splitPairs.push(p); stats.replayed++; return; }
      const cl = clustersOf(p.seg);
      // Spread the samples across the pair's hits rather than taking the first few.
      const step = Math.max(1, Math.floor(p.hits.length / SAMPLES_PER_PAIR));
      const samples = [];
      for (let k = 0; k < p.hits.length && samples.length < SAMPLES_PER_PAIR; k += step) {
        const h = p.hits[k];
        samples.push(sampleLine(h.sentence, p.seg, h.tag.index));
      }
      stats.pairCalls++;
      let to;
      try {
        to = await mapPairWithModel(p.seg, p.label, cl, samples);
      } catch (err) {
        // Oracle mode: the prompt was captured for authoring. Unwind THIS pair only and
        // keep going, so one export pass captures every pair (run-log.js ORACLE MODE).
        if (err?.oracleExport) { stats.oracleCaptured++; return; }
        // An API failure is NOT a "split" verdict: leave the pair orphaned for the next run
        // rather than spending pass-B calls (or deleting tags) on a transport error.
        stats.apiFailures++;
        console.log(`    API FAILED pair ${p.seg} "${p.label}": ${err.message}`);
        return;
      }
      logDecision({ pass: 'A', seg: p.seg, from: p.label, to, n: p.hits.length, samples });
      if (to) {
        const edits = p.hits.map((h) => ({ ...h, newLabel: to }));
        passATagCount += edits.length;
        await serialWrites(() => writeEdits(client, edits, stats, 'passATags'));
      } else splitPairs.push(p);
      if (++passADone % 100 === 0) console.log(`   pass A: ${passADone}/${remaining.length}`);
    });
    console.log(`✅ pass A: ${remaining.length - splitPairs.length - stats.apiFailures}/${remaining.length} pairs mapped, ${passATagCount} tags; ${splitPairs.length} split pairs → pass B`);
    if (LAST_PASS === 'A') return stats;

    // ── pass B: per sentence, only the stale occurrences ──
    const bySentence = new Map(); // `${rowId}#${idx}` → { rowId, sentenceIdx, sentence, tags: [] }
    for (const p of splitPairs) for (const h of p.hits) {
      const k = `${h.rowId}#${h.sentenceIdx}`;
      if (!bySentence.has(k)) bySentence.set(k, { rowId: h.rowId, sentenceIdx: h.sentenceIdx, sentence: h.sentence, tags: [] });
      bySentence.get(k).tags.push(h.tag);
    }
    let done = 0;
    let passBTagCount = 0;
    await mapPool([...bySentence.values()], CONCURRENCY, async (job) => {
      const { sentence } = job;
      const segs = Array.isArray(sentence.segments) ? sentence.segments : null;
      if (!segs || !sentence.foreignText) {
        // No stored segmentation to tag against: drop the dead pointer.
        const edits = job.tags.map((tag) => ({ ...job, tag, newLabel: null }));
        stats.passBDeleted += edits.length;
        await serialWrites(() => writeEdits(client, edits, stats, 'passBTags'));
        return;
      }
      // Every stale tag in this sentence already answered by the replay log → no call.
      const replayKey = (tag) => `${job.rowId}#${job.sentenceIdx}\t${tag.seg}\t${tag.label}`;
      if (job.tags.every((tag) => replay.b.has(replayKey(tag)))) {
        const edits = job.tags.map((tag) => {
          const to = replay.b.get(replayKey(tag));
          const valid = typeof to === 'string' && (clustersOf(tag.seg) ?? []).some((c) => c.sense === to);
          if (!valid) stats.passBDeleted++;
          logDecision({ pass: 'B', replayed: true, row: job.rowId, i: job.sentenceIdx, seg: tag.seg, from: tag.label, to: valid ? to : null, text: sentence.foreignText });
          return { ...job, tag, newLabel: valid ? to : null };
        });
        stats.replayed += edits.length;
        passBTagCount += edits.length;
        await serialWrites(() => writeEdits(client, edits, stats, 'passBTags'));
        return;
      }
      // Tagger items for exactly the stale occurrences. isTarget is forced false so the
      // model is offered candidates even for the headword (whose own re-cluster orphaned it).
      const all = buildTagItems(sentence.foreignText, segs, null, sentence.vocabCharIndex);
      const itemsFor = (tag) => tag.source === 'occurrence'
        ? all.filter((it) => it.index === tag.index)
        : [all.find((it) => it.seg === tag.seg)].filter(Boolean); // the dict owns the FIRST occurrence
      const wanted = job.tags.map((tag) => ({ tag, item: itemsFor(tag)[0] }));
      const items = [...new Map(wanted.filter((w) => w.item).map((w) => [w.item.key, { ...w.item, isTarget: false }])).values()];
      stats.tagCalls++;
      let tags;
      try {
        tags = await callSegmentTagger(sentence, items, clusters);
      } catch (err) {
        // callSegmentTagger re-throws only the oracle capture signal (see pass A).
        if (err?.oracleExport) { stats.oracleCaptured++; return; }
        throw err;
      }
      // callSegmentTagger fails OPEN (empty map) on any API/parse error. Here that must NOT
      // read as "untaggable" — a rate-limit burst would otherwise delete every tag it
      // touched. An empty answer leaves the orphans for the next run.
      if (items.length > 0 && tags.size === 0) {
        stats.apiFailures++;
        return;
      }
      const edits = [];
      for (const { tag, item } of wanted) {
        const sense = item ? tags.get(item.key)?.sense : undefined;
        const valid = typeof sense === 'string' && (clustersOf(tag.seg) ?? []).some((c) => c.sense === sense);
        edits.push({ ...job, tag, newLabel: valid ? sense : null });
        logDecision({ pass: 'B', row: job.rowId, i: job.sentenceIdx, seg: tag.seg, from: tag.label, to: valid ? sense : null, text: sentence.foreignText });
        if (!valid) stats.passBDeleted++;
      }
      passBTagCount += edits.length;
      await serialWrites(() => writeEdits(client, edits, stats, 'passBTags'));
      if (++done % 200 === 0) console.log(`   pass B: ${done}/${bySentence.size}`);
    });
    console.log(`✅ pass B: ${bySentence.size} sentences, ${passBTagCount} tags (${stats.passBDeleted} untaggable → sense removed)`);
  } finally {
    console.log('\n' + '='.repeat(60));
    console.log(`📊 ${logLabel} ${DRY_RUN ? 'DRY RUN ' : ''}summary`);
    for (const [k, v] of Object.entries(stats)) console.log(`   ${k.padEnd(14)} ${v}`);
    if (!ESTIMATE) console.log(`   decisions log  ${LOG_PATH}`);
    console.log('='.repeat(60));
  }
  return stats;
}
