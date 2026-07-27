/**
 * Backfill Script: longDefinitionCitations for dictionaryentries_zh (migration 126)
 *
 * WHAT IT DOES. An AI long definition may quote Chinese inline ("as in 开会, to hold a
 * meeting"). At read time `DictionaryDAL.segmentLongDefinitionTexts` splits each maximal
 * CJK run out as a `foreign` part that the client renders as cpcd. This script translates
 * each of those runs into English and stores the pairs in `longDefinitionCitations`, so the
 * read path can attach the translation to its part and the client can highlight the WHOLE
 * run on tap and show what the cited phrase MEANS — instead of glossing whichever single
 * word happened to be under the finger.
 *
 * PIPELINE POSITION: runs immediately AFTER chinese/backfill-long-definitions.js — it reads
 * that script's output and cannot produce anything before it exists. Rerunning
 * backfill-long-definitions.js for a word INVALIDATES this column for that word (the runs
 * may have changed), so re-run this script for the same words afterwards. See
 * .claude/commands/mark-discoverable.md.
 *
 * RUN EXTRACTION IS SHARED CODE, NOT A COPY. The runs are pulled with the very same
 * `splitHanRuns` the read path uses (server/dal/shared/segmentString.ts), because the
 * citation's `zh` is the JOIN KEY back to a `foreign` part's `foreignText`: a key produced by
 * a divergent regex would silently never match and the feature would no-op. Every sense's
 * definition is scanned (the column is a per-(sense, POS) array — docs/DEFINITION_CLUSTERS.md)
 * and the runs are deduped across them, since the key is the run text alone.
 *
 * ONLY RUNS THAT ARE NOT THEMSELVES DICTIONARY WORDS ARE TRANSLATED. If the whole run has its
 * own `dictionaryentries_zh` row (光明磊落, 看见, …), the dictionary already glosses it and the
 * card can drill into the eip — attaching a translation would REPLACE that with a whole-run
 * highlight and take the drill-in away. So a run with a det row is skipped here (no API call)
 * and left to the per-segment popup; translation is for what det has no answer for: clauses
 * and sentences. Discoverable or not is irrelevant — any row counts, because a row means
 * definitions exist. The read path enforces the same rule independently
 * (DictionaryDAL.segmentLongDefinitionTexts), since the live Compare generator can't know
 * det's contents; this skip just avoids paying for translations that would never render.
 *
 * ONE MODEL CALL PER ENTRY. All of an entry's runs are translated together, with the full
 * long definition supplied as context — a bare run like 会 is ambiguous, but "the sense this
 * definition is explaining" disambiguates it. The model is told to translate the run AS USED
 * THERE.
 *
 * NO-RUN ENTRIES ARE STAMPED, NOT SKIPPED. A definition with no embedded Chinese writes `[]`
 * (not NULL) so the "needs backfill" gate treats it as done and a full re-run doesn't keep
 * re-examining it forever.
 *
 * SELF-FLAGGING: a run the model failed to translate (missing from its answer, or an answer
 * whose `zh` doesn't match a requested run character-for-character) is dropped and printed as
 * a `⚠ CITATION REVIEW` line for the human sweep — the same contract the clusterer and the
 * long-definition script use. A partially-covered entry is still written; the uncovered runs
 * simply keep the old per-segment popup.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-longdef-citations.js              # full backfill
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-longdef-citations.js --spot-check # test 5 entries
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-longdef-citations.js --words=快,会
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-longdef-citations.js --stale      # revisit rows stamped below SCRIPT_VERSION
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog, cachedSystem } from '../run-log.js';
import { splitHanRuns } from '../../../dal/shared/segmentString.js';

// v2: runs that are themselves det headwords are no longer translated (see header) — rows
// written by v1 can hold citations that the read path now ignores, so --stale rewrites them.
const SCRIPT_VERSION = 2; // bump when this script's logic/prompt changes

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries, validatedClause, staleClause } = initRunLog({
  script: 'chinese/backfill-longdef-citations',
  version: SCRIPT_VERSION,
  anthropic,
});

// The translations describe the validated `definitions` bundle's text but are NOT part of it
// (they live in their own column precisely so approvals stay valid — see migration 126).
// Still, a validator-reviewed definition is the one text we must not silently re-interpret:
// if a human approved it, its citations were reviewed alongside it in the same document, so
// leave the row alone. Same guard every definition-touching script applies.
const validatedFilter = `AND ${validatedClause(['definitions'], 'dictionaryentries_zh')}`;

const isSpotCheck = process.argv.includes('--spot-check');
const isStale = process.argv.includes('--stale');

const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';

// An explicit --words= run is a targeted REGENERATION (the usual case right after re-running
// backfill-long-definitions.js for those words), so it bypasses the discoverable gate and the
// already-populated gate. The validated-field guard still applies.
const isTargeted = !!targetWords?.length;
const discoverableFilter = isTargeted ? '' : 'AND discoverable = TRUE';
const needsBackfillFilter = isTargeted
  ? ''
  : (isStale
      ? `AND ("longDefinitionCitations" IS NULL OR ${staleClause()})`
      : 'AND "longDefinitionCitations" IS NULL');

const MODEL = 'claude-sonnet-4-6';
const REVIEW_MARKER = '⚠ CITATION REVIEW';

// ─────────────────────────────────────────────────────────────────────────────
//  Run extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every distinct Chinese run cited anywhere in an entry's longDefinition, in first-appearance
 * order, keyed exactly as the read path will key them.
 *
 * `longDefinition` is JSONB: the per-(sense, POS) ARRAY for current zh rows, or — on rows the
 * per-sense migration hasn't reached — a per-POS object or a bare string. All three shapes are
 * accepted so this script never depends on which generation of the column it meets.
 */
function extractRuns(longDefinition) {
  const texts = [];
  if (typeof longDefinition === 'string') {
    texts.push(longDefinition);
  } else if (Array.isArray(longDefinition)) {
    for (const el of longDefinition) {
      if (el && typeof el.definition === 'string') texts.push(el.definition);
    }
  } else if (longDefinition && typeof longDefinition === 'object') {
    for (const value of Object.values(longDefinition)) {
      if (typeof value === 'string') texts.push(value);
    }
  }

  const runs = [];
  const seen = new Set();
  for (const text of texts) {
    for (const run of splitHanRuns(text)) {
      if (run.type !== 'han' || seen.has(run.value)) continue;
      seen.add(run.value);
      runs.push(run.value);
    }
  }
  return { runs, texts };
}

/**
 * Split `runs` into the ones worth translating and the ones that are dictionary words in
 * their own right (see the header: those keep the per-segment popup and are never cited).
 *
 * Membership is "any row in dictionaryentries_zh", discoverable or not — a row means the
 * segment popup has a definition to show. Note this cannot be folded into the read path's
 * segmentation lookup: that one only ever asks about ≤4-char tokens, whereas a cited run can
 * be a 5+ char idiom that also has its own entry.
 */
async function partitionRunsByDetMembership(client, runs) {
  if (runs.length === 0) return { translatable: [], detWords: [] };
  const { rows } = await client.query(
    `SELECT word1 FROM dictionaryentries_zh WHERE language = 'zh' AND word1 = ANY($1)`,
    [runs]
  );
  const inDet = new Set(rows.map(r => r.word1));
  return {
    translatable: runs.filter(r => !inDet.has(r)),
    detWords: runs.filter(r => inDet.has(r)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Translation agent
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You translate short Chinese excerpts that appear inside an English dictionary definition.

You are given a headword, the full text of its definition(s), and a numbered list of the Chinese runs quoted inside that text. Translate EACH run into English AS IT IS USED IN THAT DEFINITION — the surrounding text tells you which sense is meant, so never translate a run in a sense the definition is not talking about.

Rules:
- A run that is a full clause or sentence gets a natural English sentence ("He can speak Chinese.").
- A run that is a word or short phrase gets a short gloss, not a sentence ("to hold a meeting").
- Translate the run itself only. Do not add commentary, pinyin, romanization, or the Chinese text.
- Copy each "zh" value back VERBATIM from the list you were given, character for character, including any Chinese punctuation inside it. A value that differs from the given run is discarded.
- Return every run in the list, once each.

Respond with ONLY a JSON array, no markdown fences and no surrounding commentary:
[{"zh": "<run, verbatim>", "en": "<translation>"}]`;

/**
 * Translate one entry's runs. Returns { citations, missing } — `citations` in the order the
 * runs were requested, `missing` listing runs the model didn't return usably (dropped, and
 * reported under REVIEW_MARKER by the caller).
 *
 * Throws on an API failure so the caller counts the entry as failed and leaves the column
 * NULL for a later re-run — a partial write would be indistinguishable from "no runs".
 */
async function translateRuns(word1, texts, runs) {
  const userText =
    `Headword: ${word1}\n\n` +
    `Definition text:\n${texts.map(t => `- ${t}`).join('\n')}\n\n` +
    `Chinese runs to translate:\n${runs.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    // ~40 tokens per translation plus JSON overhead; entries rarely exceed a handful of runs.
    max_tokens: 200 + runs.length * 80,
    temperature: 0.2,
    system: cachedSystem(SYSTEM_PROMPT),
    messages: [{ role: 'user', content: userText }],
  });

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  // Slice first '[' → last ']': the payload is an array of objects, so a brace-matching scan
  // wouldn't find it, and models occasionally wrap the array in prose or a fenced block.
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  let parsed = null;
  if (start !== -1 && end > start) {
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch { /* unparseable — treated as "nothing returned" below */ }
  }

  // Index the answer by its (verbatim) zh, keeping only runs we actually asked for. This is
  // the guard that keeps the join key honest: a hallucinated or re-typed run is dropped here
  // rather than written as a citation that can never match a part.
  const requested = new Set(runs);
  const byRun = new Map();
  for (const item of Array.isArray(parsed) ? parsed : []) {
    if (!item || typeof item.zh !== 'string' || typeof item.en !== 'string') continue;
    const zh = item.zh;
    const en = item.en.trim();
    if (!en || !requested.has(zh) || byRun.has(zh)) continue;
    byRun.set(zh, en);
  }

  const citations = runs.filter(r => byRun.has(r)).map(r => ({ zh: r, en: byRun.get(r) }));
  const missing = runs.filter(r => !byRun.has(r));
  return { citations, missing };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  if (isSpotCheck) console.log('🔍 SPOT CHECK MODE — processing 5 entries only\n');
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);
  console.log('🚀 Starting longDefinitionCitations backfill (translate embedded Chinese runs)...\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(`
      SELECT id, word1, "longDefinition"
      FROM dictionaryentries_zh
      WHERE language = 'zh'
        ${discoverableFilter}
        ${validatedFilter}
        ${needsBackfillFilter}
        AND "longDefinition" IS NOT NULL
        ${wordsFilter}
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 5' : ''}
    `);

    console.log(`📊 Found ${entries.length} entries needing longDefinitionCitations backfill\n`);

    if (entries.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    let updated = 0;      // entries with ≥1 citation written
    let noRuns = 0;       // entries stamped with [] because the definition cites nothing translatable
    let partial = 0;      // entries where at least one run came back unusable
    let failed = 0;

    for (const row of entries) {
      try {
        const { runs: allRuns, texts } = extractRuns(row.longDefinition);
        // Runs that are dictionary words keep the per-segment popup and are never sent to
        // the model (header: "ONLY RUNS THAT ARE NOT THEMSELVES DICTIONARY WORDS").
        const { translatable: runs, detWords } = await partitionRunsByDetMembership(client, allRuns);
        const skipNote = detWords.length
          ? ` [${detWords.length} det headword${detWords.length === 1 ? '' : 's'} skipped: ${detWords.join(', ')}]`
          : '';

        if (runs.length === 0) {
          // Stamp [] so the NULL gate counts this entry as done (see the header). Covers both
          // "no embedded Chinese at all" and "every quoted run is its own dictionary word" —
          // in each case there is nothing left to translate and no API call is made.
          await client.query(
            `UPDATE dictionaryentries_zh SET "longDefinitionCitations" = '[]'::jsonb WHERE id = $1`,
            [row.id]
          );
          await stampEntries(client, 'dictionaryentries_zh', row.id);
          const reason = allRuns.length === 0 ? 'no embedded Chinese' : 'all runs are det headwords';
          console.log(`  ${row.word1} ... ${reason} [stamped []]${skipNote}`);
          noRuns++;
          continue;
        }

        process.stdout.write(`  ${row.word1} [${runs.length} run${runs.length === 1 ? '' : 's'}]${skipNote} ... `);

        const { citations, missing } = await translateRuns(row.word1, texts, runs);

        if (citations.length === 0) {
          // Nothing usable came back — leave the column NULL so a re-run retries this entry
          // rather than recording "translated, found nothing".
          console.log('FAILED: no usable translations returned');
          failed++;
          continue;
        }

        await client.query(
          `UPDATE dictionaryentries_zh SET "longDefinitionCitations" = $1::jsonb WHERE id = $2`,
          [JSON.stringify(citations), row.id]
        );
        await stampEntries(client, 'dictionaryentries_zh', row.id);

        console.log(citations.map(c => `${c.zh} → "${c.en}"`).join('  |  '));

        if (missing.length > 0) {
          partial++;
          console.log(
            `${REVIEW_MARKER} ${row.word1} (id=${row.id}): no usable translation for ` +
            `${missing.map(m => `"${m}"`).join(', ')} — ${missing.length === 1 ? 'that run keeps' : 'those runs keep'} the per-segment popup`
          );
        }

        updated++;
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      await new Promise(r => setTimeout(r, 300));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total processed          : ${entries.length}`);
    console.log(`Updated                  : ${updated}`);
    console.log(`Nothing to translate     : ${noRuns} (no embedded Chinese, or every run is a det headword)`);
    console.log(`Partially covered        : ${partial}${partial ? ` (see "${REVIEW_MARKER}" lines above)` : ''}`);
    console.log(`Errors                   : ${failed}`);
    console.log('='.repeat(60) + '\n');
  } finally {
    client.release();
    await db.end?.();
  }
}

run().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
