/**
 * Backfill Script: AI-powered vernacular register + difficulty scoring for
 * dictionaryentries_es (SPANISH)
 *
 * Spanish counterpart of backfill/chinese/backfill-vernacular-score.js.
 * For each discoverable es entry where "vernacularScore" IS NULL, asks Claude Sonnet
 * (in a single call) for TWO independent 1–5 scores:
 *
 * (A) vernacularScore — how vernacular (everyday spoken) vs. literary/formal the word is:
 *   5 = Natural vernacular — everyday spoken Spanish; sounds completely natural in casual speech
 *   4 = Informal-leaning — more common in speech than writing; slightly colloquial feel
 *   3 = Neutral register — appropriate in both spoken and written contexts; no strong register markedness
 *   2 = Formal/written-leaning — more at home in writing, news, or formal speech than casual conversation
 *   1 = Literary/classical/formal only — archaic, poetic, or restricted to written/formal contexts; sounds unnatural in everyday speech
 *   → written to the "vernacularScore" column.
 *
 * (B) difficulty — how hard the word is for an English-speaking learner to ACQUIRE
 *   (1 = easiest .. 5 = hardest). This is the Spanish analog of the Chinese HSK
 *   difficulty signal, so it is written to the shared "difficulty" column as a bare
 *   integer string '1'..'5' (NOT the 'HSK1'..'HSK6' encoding Chinese uses). The
 *   discover flow (StarterPacksService._levelConfig) reads this to band Spanish
 *   cards by difficulty, exactly as it bands Chinese cards by HSK level.
 *
 * Register and difficulty are orthogonal: a word can be everyday-vernacular yet
 * grammatically/semantically hard (or formal yet easy), so both are scored.
 *
 * NULL "vernacularScore" means "not yet scored". After processing, vernacularScore
 * holds an integer 1–5 and difficulty holds the integer 1..5 (smallint, migration 92).
 *
 * TODO(es-linguistics): The register scale examples below were adapted from the
 * Chinese version to plausible Spanish words. Have a Spanish speaker review the
 * example words per band before a production run, and decide a dialect baseline
 * (the examples currently lean neutral/Latin-American + peninsular). Spanish also
 * has strong regional register variation (e.g. vosotros, voseo, regional slang)
 * not yet accounted for.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-vernacular-score.js                          # full backfill
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-vernacular-score.js --spot-check             # test 5 entries with reasoning
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-vernacular-score.js --spot-check --random    # random 5 entries
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-vernacular-score.js --spot-check --random --limit=25
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog } from '../run-log.js';
const SCRIPT_VERSION = 2; // bump when this script's logic/prompt changes (v2: + difficulty score → difficulty column)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries } = initRunLog({ script: 'spanish/backfill-vernacular-score', version: SCRIPT_VERSION, anthropic: anthropic });

const isSpotCheck = process.argv.includes('--spot-check');
const isRandom = process.argv.includes('--random');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const spotCheckLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 5;

// Shared scale and guidelines used in both prompt modes
// TODO(es-linguistics): example words per band are first-pass and need a Spanish
// speaker's review. Consider the target dialect baseline before a real run.
const SCALE_AND_GUIDELINES = `Scale:
  5 = Natural vernacular — the word sounds completely natural and at home in everyday casual spoken Spanish; native speakers use it without thinking in conversation (e.g. comer, rico, papá, vale, guay, chido)
  4 = Informal-leaning — more common in spoken language than in writing; has a slightly casual or conversational feel, though not slang (e.g. un montón, más o menos, charlar, currar)
  3 = Neutral register — equally appropriate in spoken and written contexts; neither marked as casual nor as formal (e.g. trabajo, estudiar, teléfono, problema, mañana)
  2 = Formal/written-leaning — more natural in written, academic, news, or formal speech contexts than in casual conversation; would sound slightly stiff in everyday chat (e.g. actualmente, no obstante, por consiguiente, cirugía, exponer)
  1 = Literary/classical/formal only — archaic or elevated literary register; sounds unnatural or pretentious in everyday spoken Spanish (e.g. otrora, asaz, mas meaning "but", henchir)

Guidelines:
  - Score based on how natural this word sounds in everyday casual spoken Spanish — not whether it is formally correct or widely known.
  - A word that is universally known but primarily lives in formal/written contexts scores 2 (e.g. cirugía — everyone knows it, but it has a clinical, written feel; it does not belong in casual small talk).
  - A word used freely and naturally in casual conversation scores 4–5, regardless of whether it also appears in formal writing.
  - Archaic or literary words that survive only in set phrases or literary texts score 1.
  - If a word has multiple meanings with different registers, score the most common everyday usage.`;

// Difficulty scale: how hard the word is for an English-speaking learner to ACQUIRE.
// Orthogonal to register — measures acquisition cost, not formality.
// TODO(es-linguistics): example words per band are first-pass and need a Spanish
// speaker's review (and a dialect baseline) before a real production run.
const DIFFICULTY_SCALE_AND_GUIDELINES = `Difficulty scale (acquisition difficulty for an English-speaking learner, 1 = easiest):
  1 = Core beginner — extremely high-frequency everyday word, concrete and easy to map to English; learned in the first weeks (e.g. casa, comer, agua, bueno, yo)
  2 = Elementary — common, mostly concrete, regular form; learned early (e.g. trabajar, ciudad, rápido, ayudar)
  3 = Intermediate — moderate frequency, or somewhat abstract, or a function/grammar word that takes practice (e.g. aunque, lograr, sin embargo, acuerdo)
  4 = Advanced — lower frequency, abstract, idiomatic, or a likely false-friend / nuance trap (e.g. acaso, índole, desempeñar, soler)
  5 = Expert/rare — rare, archaic, literary, technical, or highly idiomatic; encountered only by advanced learners (e.g. henchir, otrora, soslayar, escarnio)

Difficulty guidelines:
  - Weigh frequency first (how often a learner will encounter the word), then form regularity, abstractness, and false-friend / idiomatic risk.
  - Difficulty is INDEPENDENT of register: a word can be everyday-vernacular yet hard (idiomatic/abstract), or formal yet easy (transparent cognate). Do not let the register score pull the difficulty score.
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

/**
 * Ask Claude Sonnet, in a SINGLE call, for both the vernacular-register score and
 * the learner-acquisition difficulty score of a Spanish word. The two judgments
 * are orthogonal but share the same word context, so one call is cheaper and
 * keeps them consistent.
 *
 * Normal mode:    returns { vernacular: number, difficulty: number }
 * Spot-check mode: returns { vernacular, difficulty, vernacularReasoning, difficultyReasoning }
 */
async function askClaudeForScores(word, pronunciation, definitions) {
  const definitionText = Array.isArray(definitions)
    ? definitions.slice(0, 4).join('; ')
    : definitions;

  // Spanish det rows usually have no `pronunciation` (no IPA imported) — only
  // show it when present so the prompt doesn't read "(null)".
  const wordLine = pronunciation ? `${word} (${pronunciation})` : word;

  const header = `You are a Spanish linguistics expert specializing in sociolinguistics, register, and second-language acquisition.

Word: ${wordLine}
Definitions: ${definitionText}

Task: Give the word "${word}" TWO independent scores, each an integer from 1 to 5.

(A) VERNACULAR REGISTER — does this word live primarily in casual everyday speech (score high), or in written, formal, or literary contexts (score low)? The question is not whether the word is common or well-known, but whether it sounds natural and at home in everyday spoken Spanish.

${SCALE_AND_GUIDELINES}

(B) DIFFICULTY — how hard is this word for an English-speaking learner to acquire?

${DIFFICULTY_SCALE_AND_GUIDELINES}`;

  // Both modes now return JSON (difficulty makes a bare-digit response impossible).
  const prompt = isSpotCheck
    ? `${header}

Respond with ONLY a JSON object with four fields:
  "vernacular": integer 1–5
  "difficulty": integer 1–5
  "vernacularReasoning": one sentence explaining the vernacular score
  "difficultyReasoning": one sentence explaining the difficulty score

Example: {"vernacular": 2, "difficulty": 4, "vernacularReasoning": "Clinical, written register.", "difficultyReasoning": "Low-frequency and abstract for learners."}
No markdown, no extra text.`
    : `${header}

Respond with ONLY a JSON object with two integer fields:
  "vernacular": integer 1–5
  "difficulty": integer 1–5

Example: {"vernacular": 4, "difficulty": 2}
No markdown, no extra text.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: isSpotCheck ? 300 : 40,
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  // Strip markdown code fences if present, then parse the JSON object.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned);

  const result = {
    vernacular: parseScore(parsed.vernacular, 'vernacular score'),
    difficulty: parseScore(parsed.difficulty, 'difficulty score'),
  };
  if (isSpotCheck) {
    result.vernacularReasoning = parsed.vernacularReasoning ?? '';
    result.difficultyReasoning = parsed.difficultyReasoning ?? '';
  }
  return result;
}

async function run() {
  if (isSpotCheck) {
    console.log(`SPOT CHECK MODE — processing ${spotCheckLimit} entries with reasoning${isRandom ? ' (random sample)' : ''}\n`);
  }
  console.log('Starting AI-powered vernacularScore + difficulty (difficulty) backfill...\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(`
      SELECT id, word1, pronunciation, definitions
      FROM dictionaryentries_es
      WHERE language = 'es'
        AND discoverable = TRUE
        AND ("vernacularScore" IS NULL OR "difficulty" IS NULL)
      ORDER BY ${isRandom ? 'RANDOM()' : 'id ASC'}
      ${isSpotCheck ? `LIMIT ${spotCheckLimit}` : ''}
    `);

    console.log(`Found ${entries.length} entries needing vernacularScore/difficulty backfill\n`);

    if (entries.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    let processed = 0;
    let failed = 0;

    // Tally per score value for the final distribution summaries (both scores)
    const vernacularCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const difficultyCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    for (const row of entries) {
      try {
        process.stdout.write(`  ${row.word1} (${row.pronunciation}) ... `);

        const result = await askClaudeForScores(row.word1, row.pronunciation, row.definitions);

        if (isSpotCheck) {
          console.log(`vern=${result.vernacular} diff=${result.difficulty}`);
          console.log(`      vern: ${result.vernacularReasoning}`);
          console.log(`      diff: ${result.difficultyReasoning}`);
        } else {
          console.log(`vern=${result.vernacular} diff=${result.difficulty}`);
        }

        // Difficulty is stored in the shared difficulty column as a bare integer
        // 1..5 (the Spanish encoding — see _levelConfig in StarterPacksService).
        // The column is a smallint (migration 92), so the score is written as a
        // number. Both columns are written in one statement.
        await client.query(
          `UPDATE dictionaryentries_es
             SET "vernacularScore" = $1, "difficulty" = $2
           WHERE id = $3`,
          [result.vernacular, result.difficulty, row.id]
        );
        await stampEntries(client, 'dictionaryentries_es', row.id);

        vernacularCounts[result.vernacular]++;
        difficultyCounts[result.difficulty]++;
        processed++;
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      // Small delay to avoid rate-limiting
      await new Promise(r => setTimeout(r, 200));
    }

    const vernacularLabels = {
      1: 'Literary/classical/formal only',
      2: 'Formal/written-leaning',
      3: 'Neutral register',
      4: 'Informal-leaning',
      5: 'Natural vernacular',
    };
    const difficultyLabels = {
      1: 'Core beginner',
      2: 'Elementary',
      3: 'Intermediate',
      4: 'Advanced',
      5: 'Expert/rare',
    };

    console.log('\n' + '='.repeat(60));
    console.log('Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total processed  : ${processed + failed}`);
    console.log(`Successfully set : ${processed}`);
    console.log(`Errors           : ${failed}`);
    if (processed > 0) {
      console.log('\nVernacular (register) distribution:');
      for (const score of [1, 2, 3, 4, 5]) {
        console.log(`  ${score} (${vernacularLabels[score]}): ${vernacularCounts[score]}`);
      }
      console.log('\nDifficulty (difficulty) distribution:');
      for (const score of [1, 2, 3, 4, 5]) {
        console.log(`  ${score} (${difficultyLabels[score]}): ${difficultyCounts[score]}`);
      }
    }
    console.log('='.repeat(60) + '\n');
  } finally {
    client.release();
    await db.end?.();
  }
}

run().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
