/**
 * Backfill Script: AI-powered conversation-frequency + difficulty scoring for
 * dictionaryentries_es (SPANISH)
 *
 * Spanish counterpart of backfill/chinese/backfill-frequency-score.js.
 * For each discoverable es entry where "frequencyScore" IS NULL, asks Claude Sonnet
 * (in a single call) for TWO independent 1–5 scores:
 *
 * (A) frequencyScore — how often the word comes up in everyday conversation:
 *   5 = Constant — comes up daily in ordinary talk
 *   4 = Common — comes up most weeks; met early and often
 *   3 = Moderately common — comes up when the topic calls for it
 *   2 = Uncommon in speech — mostly met while reading or in specialist talk
 *   1 = Almost never spoken — literary, archaic, or narrowly technical
 *   → written to the "frequencyScore" column.
 *
 *   NOTE (migration 122): this was a REGISTER score (colloquial↔literary) until it
 *   was renamed and re-pointed at frequency, because every consumer — search
 *   relevance, starter-pack ordering, the quick-mark 3–5 gate, dd cluster pick —
 *   already treated it as "how common is this word". Register is no longer scored
 *   anywhere; do not re-introduce register language into this prompt.
 *
 * (B) difficulty — how hard the word is for an English-speaking learner to ACQUIRE
 *   (1 = easiest .. 5 = hardest). This is the Spanish analog of the Chinese HSK
 *   difficulty signal, so it is written to the shared "difficulty" column as a bare
 *   integer string '1'..'5' (NOT the 'HSK1'..'HSK6' encoding Chinese uses). The
 *   discover flow (StarterPacksService._levelConfig) reads this to band Spanish
 *   cards by difficulty, exactly as it bands Chinese cards by HSK level.
 *
 * Frequency and difficulty are related but distinct: a word can be extremely frequent
 * yet grammatically/semantically hard (or rare yet easy), so both are scored. See the
 * OVERLAP note on DIFFICULTY_SCALE_AND_GUIDELINES below.
 *
 * NULL "frequencyScore" means "not yet scored". After processing, frequencyScore
 * holds an integer 1–5 and difficulty holds the integer 1..5 (smallint, migration 92).
 *
 * TODO(es-linguistics): The frequency scale examples below were adapted from the
 * Chinese version to plausible Spanish words. Have a Spanish speaker review the
 * example words per band before a production run, and decide a dialect baseline
 * (the examples currently lean neutral/Latin-American + peninsular). Spanish also
 * has strong regional variation (e.g. vosotros, voseo, regional slang) not yet
 * accounted for — a word can be band-5 frequent in one dialect and unheard in another.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-frequency-score.js                          # full backfill (serial)
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-frequency-score.js --batch                  # via Batches API (50% price)
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-frequency-score.js --stale                  # also re-score rows stamped below SCRIPT_VERSION
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-frequency-score.js --spot-check             # test 5 entries with reasoning
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-frequency-score.js --spot-check --random    # random 5 entries
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-frequency-score.js --spot-check --random --limit=25
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog, cachedSystem } from '../run-log.js';
import { parseBackfillArgs } from '../shared/lib/cli.js';
import { parseModelJson } from '../shared/lib/json.js';
import { runBackfill } from '../shared/lib/runner.js';
import { FREQUENCY_SCORE_LABELS } from '../shared/lib/frequencyLabels.js';
import { SCALE_AND_GUIDELINES, POLYSEMY_GUIDELINE } from './lib/frequencyRubric.js';
import { reconcileFrequencyScore } from '../shared/lib/senseClusters.js';

const SCRIPT_VERSION = 5; // bump when this script's logic/prompt changes (v5: THE AXIS CHANGED — conversational commonality (stands-out) rather than frequency-of-occurrence; bands 4+5 merged, old band 1 split; rubric extracted to lib/frequencyRubric.js and now shared with the clusterer. Pre-2026-08-28 scores are on the old axis. v4: register rubric → everyday-conversation frequency, migration 122)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries, accrueUsage, staleClause, validatedClause } = initRunLog({ script: 'spanish/backfill-frequency-score', version: SCRIPT_VERSION, anthropic });
// This script writes BOTH columns in one pass, so a validator review of EITHER chip
// protects the row (migration 132, docs/DATA_VALIDATION_SYSTEM.md). Coarser than the
// zh side, where the two columns have separate scripts and separate guards.
const validatedFilter = `AND ${validatedClause(['frequencyScore', 'difficulty'], 'dictionaryentries_es')}`;

// Guard for the cluster half of the write: a validator's approved per-sense score
// outranks the invariant, so the CASE leaves their clusters untouched.
const senseValidated = validatedClause(['senseFrequencyScore'], 'dictionaryentries_es');


const { isSpotCheck, isBatch, targetWords } = parseBackfillArgs();
const isRandom = process.argv.includes('--random');
// --stale: also (re)process rows already scored but stamped below SCRIPT_VERSION
// (or never stamped) — the zh scorer's flag, mirrored here so a rubric change can
// be rolled out without hand-nulling the column. Needed by migration 122, which
// left v3 REGISTER values in place for the new frequency rubric to overwrite.
const isStale = process.argv.includes('--stale');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const spotCheckLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 5;

const MODEL = 'claude-sonnet-4-6';

// The scale, guidelines and polysemy split now live in ./lib/frequencyRubric.js so the
// Spanish CLUSTERER scores on the same brief (it previously had only the band names).
// Imported above as SCALE_AND_GUIDELINES / POLYSEMY_GUIDELINE.

// Difficulty scale: how hard the word is for an English-speaking learner to ACQUIRE.
// Measures acquisition cost, not how often the word is heard.
//
// ⚠ OVERLAP (introduced by migration 122): when (A) scored REGISTER, the two axes
// were genuinely orthogonal. Now that (A) scores FREQUENCY, they partly overlap —
// the difficulty rubric's first factor below is also frequency. They are still
// distinct (a very frequent word can be hard: idiomatic, abstract, a false friend;
// a rare word can be easy: a transparent cognate), but expect correlation, and do
// not read difficulty as an independent signal from frequencyScore.
// TODO(es-linguistics): example words per band are first-pass and need a Spanish
// speaker's review (and a dialect baseline) before a real production run.
const DIFFICULTY_SCALE_AND_GUIDELINES = `Difficulty scale (acquisition difficulty for an English-speaking learner, 1 = easiest):
  1 = Core beginner — extremely high-frequency everyday word, concrete and easy to map to English; learned in the first weeks (e.g. casa, comer, agua, bueno, yo)
  2 = Elementary — common, mostly concrete, regular form; learned early (e.g. trabajar, ciudad, rápido, ayudar)
  3 = Intermediate — moderate frequency, or somewhat abstract, or a function/grammar word that takes practice (e.g. aunque, lograr, sin embargo, acuerdo)
  4 = Advanced — lower frequency, abstract, idiomatic, or a likely false-friend / nuance trap (e.g. acaso, índole, desempeñar, soler)
  5 = Expert/rare — rare, archaic, literary, technical, or highly idiomatic; encountered only by advanced learners (e.g. henchir, otrora, soslayar, escarnio)

Difficulty guidelines:
  - Weigh how early a learner meets the word first, then form regularity, abstractness, and false-friend / idiomatic risk.
  - Difficulty is NOT the inverse of score (A): a word can be very frequent yet hard (idiomatic, abstract, a false friend — e.g. quedar, soler), or infrequent yet easy (a transparent cognate — e.g. bilateral). Judge acquisition cost on its own; do not simply mirror the frequency score.
  - Transparent English cognates that mean what they look like are easier; false friends are harder.
  - If a word has multiple senses, score difficulty for its most common everyday sense.`;

/**
 * Validate a value is an integer 1–5, throwing a descriptive error otherwise.
 * Accepts numbers or numeric strings (Claude may return either in JSON).
 */
function parseScore(raw, label) {
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1 || n > 5) {
    throw new Error(`Invalid ${label} from Claude: ${JSON.stringify(raw)}`);
  }
  return n;
}

// Static instruction prefix (identical for every entry) → cached system block.
// PROMPT CACHING: the scales/guidelines/response-format all live here; only the
// per-word lines vary in the user message. Spot-check and normal mode have
// DIFFERENT system texts (reasoning fields requested), which is fine — each mode
// caches its own prefix within a run.
function systemText() {
  const responseFormat = isSpotCheck
    ? `Respond with ONLY a JSON object with four fields:
  "frequency": integer 1–5
  "difficulty": integer 1–5
  "frequencyReasoning": one sentence explaining the frequency score
  "difficultyReasoning": one sentence explaining the difficulty score

Example: {"frequency": 2, "difficulty": 4, "frequencyReasoning": "Clinical, written register.", "difficultyReasoning": "Low-frequency and abstract for learners."}
No markdown, no extra text.`
    : `Respond with ONLY a JSON object with two integer fields:
  "frequency": integer 1–5
  "difficulty": integer 1–5

Example: {"frequency": 4, "difficulty": 2}
No markdown, no extra text.`;

  return `You are a Spanish linguistics expert with deep knowledge of spoken-usage frequency and second-language acquisition.

Task: Give the given word TWO independent scores, each an integer from 1 to 5.

(A) CONVERSATIONAL COMMONALITY — if a friend said this word to you in casual conversation, how much would it stand out? A plain, unglamorous word that everyone says scores 5; a word that would make a listener blink scores low. Formality by itself is not the question — conspicuousness is.

${SCALE_AND_GUIDELINES}
${POLYSEMY_GUIDELINE.word}

(B) DIFFICULTY — how hard is this word for an English-speaking learner to acquire?

${DIFFICULTY_SCALE_AND_GUIDELINES}

${responseFormat}`;
}

/** Build the messages.create params for one entry (per-word data only in the user turn). */
function buildRequest(row) {
  const definitionText = Array.isArray(row.definitions)
    ? row.definitions.slice(0, 4).join('; ')
    : row.definitions;
  // Spanish det rows usually have no `pronunciation` (no IPA imported) — only
  // show it when present so the prompt doesn't read "(null)".
  const wordLine = row.pronunciation ? `${row.word1} (${row.pronunciation})` : row.word1;
  return {
    model: MODEL,
    max_tokens: isSpotCheck ? 300 : 40,
    temperature: 0.1,
    system: cachedSystem(systemText()),
    messages: [{ role: 'user', content: `Word: ${wordLine}\nDefinitions: ${definitionText}` }],
  };
}

/**
 * Parse + validate the model output. The two judgments are orthogonal but share
 * the same word context, so one call is cheaper and keeps them consistent.
 *
 * Normal mode:     returns { frequency: number, difficulty: number }
 * Spot-check mode: returns { frequency, difficulty, frequencyReasoning, difficultyReasoning }
 */
function parseScores(text) {
  const parsed = parseModelJson(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Unparseable JSON from Claude: ${String(text).slice(0, 120)}`);
  }
  const result = {
    frequency: parseScore(parsed.frequency, 'frequency score'),
    difficulty: parseScore(parsed.difficulty, 'difficulty score'),
  };
  if (isSpotCheck) {
    result.frequencyReasoning = parsed.frequencyReasoning ?? '';
    result.difficultyReasoning = parsed.difficultyReasoning ?? '';
  }
  return result;
}

async function run() {
  if (isSpotCheck) {
    console.log(`SPOT CHECK MODE — processing ${spotCheckLimit} entries with reasoning${isRandom ? ' (random sample)' : ''}\n`);
  }
  console.log(`Starting AI-powered frequencyScore + difficulty backfill${isBatch ? ' (batch mode)' : ''}...\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const params = targetWords?.length ? [targetWords] : [];
    const wordsFilter = targetWords?.length ? 'AND word1 = ANY($1::text[])' : '';
    // --words= is an explicit instruction (mirrors chinese/backfill-frequency-score.js):
    // skip the discoverable gate so a not-yet-shipped word can still be scoped directly.
    const discoverableGate = targetWords?.length ? '' : 'AND discoverable = TRUE';
    const { rows: entries } = await client.query(`
      SELECT id, word1, pronunciation, definitions, "definitionClusters"
      FROM dictionaryentries_es
      WHERE language = 'es'
        ${discoverableGate}
        ${wordsFilter}
        ${validatedFilter}
        AND (("frequencyScore" IS NULL OR "difficulty" IS NULL)${isStale ? ` OR ${staleClause()}` : ''})
      ORDER BY ${isRandom ? 'RANDOM()' : 'id ASC'}
      ${isSpotCheck ? `LIMIT ${spotCheckLimit}` : ''}
    `, params);

    console.log(`Found ${entries.length} entries needing frequencyScore/difficulty backfill\n`);

    if (entries.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    let processed = 0;

    // Tally per score value for the final distribution summaries (both scores)
    const frequencyCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const difficultyCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    await runBackfill({
      anthropic,
      entries,
      batch: isBatch,
      buildRequest,
      accrueUsage,
      handleResponse: async (row, message) => {
        const result = parseScores(message.content[0]?.text ?? '');

        console.log(`freq=${result.frequency} diff=${result.difficulty}`);
        if (isSpotCheck) {
          console.log(`      vern: ${result.frequencyReasoning}`);
          console.log(`      diff: ${result.difficultyReasoning}`);
        }

        // Difficulty is stored in the shared difficulty column as a bare integer
        // 1..5 (the Spanish encoding — see _levelConfig in StarterPacksService).
        // The column is a smallint (migration 92), so the score is written as a
        // number. Both columns are written in one statement.
        // Enforce the word/cluster frequency invariant on the way in:
        // "frequencyScore" == MAX(cluster scores). A model score BELOW the best cluster
        // is lifted to it; a model score ABOVE every cluster lifts the entry's DEFAULT
        // cluster instead, so the two agree without changing which sense the card shows.
        // See scripts/backfill/shared/lib/senseClusters.js. $4 is NULL unless the
        // clusters actually changed, so an unclustered entry never gets a jsonb 'null'.
        const reconciled = reconcileFrequencyScore(result.frequency, row.definitionClusters);
        await client.query(
          `UPDATE dictionaryentries_es
             SET "frequencyScore" = $1::int,
                 "difficulty" = $2,
                 "definitionClusters" = CASE WHEN $4::jsonb IS NOT NULL AND ${senseValidated}
                                             THEN $4::jsonb ELSE "definitionClusters" END
           WHERE id = $3`,
          [
            reconciled.wordScore,
            result.difficulty,
            row.id,
            reconciled.clustersChanged ? JSON.stringify(reconciled.clusters) : null,
          ]
        );
        await stampEntries(client, 'dictionaryentries_es', row.id);

        frequencyCounts[result.frequency]++;
        difficultyCounts[result.difficulty]++;
        processed++;
        return true;
      },
    });

    const difficultyLabels = {
      1: 'Core beginner',
      2: 'Elementary',
      3: 'Intermediate',
      4: 'Advanced',
      5: 'Expert/rare',
    };

    if (processed > 0) {
      console.log('Conversation-frequency distribution:');
      for (const score of [1, 2, 3, 4, 5]) {
        console.log(`  ${score} (${FREQUENCY_SCORE_LABELS[score]}): ${frequencyCounts[score]}`);
      }
      console.log('\nDifficulty (difficulty) distribution:');
      for (const score of [1, 2, 3, 4, 5]) {
        console.log(`  ${score} (${difficultyLabels[score]}): ${difficultyCounts[score]}`);
      }
      console.log('');
    }
  } finally {
    client.release();
    await db.end?.();
  }
}

run().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
