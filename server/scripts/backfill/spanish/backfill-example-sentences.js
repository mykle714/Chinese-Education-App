/**
 * Backfill Script: AI-powered example sentences for dictionaryentries_es (SPANISH)
 *
 * Spanish counterpart of backfill/chinese/backfill-example-sentences.js.
 * For each discoverable es entry with no exampleSentences, uses Claude AI to generate
 * natural, contextually appropriate example sentences using the word in different
 * grammatical roles. Each sentence object has a `foreignText` field (the Spanish
 * sentence), an `english` translation, `translatedVocab`, `tense`, and a
 * `partOfSpeechDict` keyed by the sentence's word tokens.
 *
 * Integration notes (resolved):
 *   - The sentence text is stored under the shared `foreignText` key (renamed from
 *     `chinese`; the zh script and the VocabEntry type use the same key now).
 *   - Per-token segmentMetadata is computed at query time by
 *     DictionaryDAL.enrichExampleSentencesMetadataBatch — for es it splits on
 *     whitespace and looks up each word's definition in dictionaryentries_es
 *     (no pinyin / greedy character segmentation).
 *   - partOfSpeechDict token tags use a Spanish set (ALLOWED_POS_TAGS); the entry's
 *     raw Wiktionary partsOfSpeech are normalized for coverage via normalizePosList.
 *
 * Multi-agent pipeline (mirrors backfill-expansion-claude.js):
 *   1. Generator agent (Sonnet) → proposes the batch of sentences
 *   2. Shape check (isValidSentenceShape) → mechanical field/POS-dict validation
 *   3. Validator agent (Sonnet) → flags common AI mistakes per sentence
 *      (e.g. ser/estar confusion, gender/number agreement)
 *   4. Repair agent (Opus) → for each flagged sentence, drafts a corrected
 *      replacement informed by the validator's critique, re-validated once
 *
 * Usage:
 *   npx tsx /app/scripts/backfill/spanish/backfill-example-sentences.js             # full backfill
 *   npx tsx /app/scripts/backfill/spanish/backfill-example-sentences.js --spot-check # test 3 entries
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';

// Spanish POS vocabulary + raw→friendly mapping. Shared with
// backfill-parts-of-speech.js (see scripts/backfill/shared/lib/esPos.js).
import { ALLOWED_POS_TAGS, normalizePosList } from '../shared/lib/esPos.js';
import { initRunLog, cachedSystem } from '../run-log.js';
const SCRIPT_VERSION = 1; // bump when this script's logic/prompt changes

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries, validatedClause } = initRunLog({ script: 'spanish/backfill-example-sentences', version: SCRIPT_VERSION, anthropic: anthropic });
// This script regenerates the WHOLE exampleSentences array, so skip any entry
// whose example sentences a validator has approved/flagged (migration 104,
// docs/DATA_VALIDATION_SYSTEM.md).
const validatedFilter = `AND ${validatedClause(['exampleSentence0', 'exampleSentence1', 'exampleSentence2'], 'dictionaryentries_es')}`;

// When --spot-check is passed, process only 3 entries and print full sentence output
const isSpotCheck = process.argv.includes('--spot-check');

// --all-discoverable → regenerate for every discoverable entry, overwriting existing exampleSentences.
// Default behavior only targets entries where exampleSentences IS NULL OR '[]'.
const isAllDiscoverable = process.argv.includes('--all-discoverable');

// --words=correr,banco → scope to specific entries only; omit to target all discoverable entries with exampleSentences IS NULL
const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';

const emptinessFilter = isAllDiscoverable
  ? ''
  : `AND ("exampleSentences" IS NULL OR "exampleSentences" = '[]'::jsonb)`;

// ─────────────────────────────────────────────────────────────────────────────
//  Models — generation + validation run on Sonnet; the repair step escalates to
//  Opus for higher-quality corrections of any sentence the validator flags.
// ─────────────────────────────────────────────────────────────────────────────
const GENERATOR_MODEL = 'claude-sonnet-4-6';
const VALIDATOR_MODEL = 'claude-sonnet-4-6';
const REGENERATOR_MODEL = 'claude-opus-4-8';

const ALLOWED_TENSES = new Set(['past', 'present', 'future']);
const ALLOWED_POS_TAG_SET = new Set(ALLOWED_POS_TAGS);

// Shared rule text — the catalogue of common AI mistakes the validator agent
// looks for. Single source of truth referenced by the validator prompt.
// TODO(es-linguistics): example words per category are first-pass — a Spanish
// speaker should sanity-check them, but the category set is intended to be complete.
const COMMON_MISTAKES_TEXT = `Common AI mistakes to flag (each maps to a violation code):
- "agreement_error": Gender or number agreement is wrong between a noun and its article/adjective/determiner (e.g. WRONG: "el casa blanca", "los problema"; RIGHT: "la casa blanca", "los problemas").
- "ser_estar_error": "ser" and "estar" are confused (e.g. WRONG: "Estoy profesor", "La sopa es fría" for a current state; RIGHT: "Soy profesor", "La sopa está fría").
- "por_para_error": "por" and "para" are swapped for their intended meaning (purpose/destination vs cause/exchange/duration).
- "mood_tense_error": Indicative is used where the subjunctive is required (or vice versa), or the verb conjugation does not match the subject/temporal meaning (e.g. WRONG: "Espero que vienes"; RIGHT: "Espero que vengas").
- "aspect_error": Preterite vs imperfect is confused for the intended past meaning (e.g. WRONG: "Ayer comía a las dos" for a completed action; RIGHT: "Ayer comí a las dos"; imperfect for ongoing/habitual past: "De niño comía mucho").
- "personal_a_error": The personal "a" before a specific human (or personified) direct object is missing or wrongly added (e.g. WRONG: "Veo mi madre"; RIGHT: "Veo a mi madre").
- "accent_error": A written-accent / spelling error changes or breaks the word, including diacritic minimal pairs (tú vs tu, él vs el, sí vs si, sé vs se, más vs mas, qué vs que) and missing/incorrect accent marks.
- "false_friend_or_calque": A word is used with an English-derived meaning it does not have in Spanish, or the phrasing is a literal calque from English (e.g. WRONG: "Estoy embarazada" to mean "embarrassed"; "realizar" to mean "to realize/notice").
- "unnatural_phrasing": Grammatical word-by-word but not what a native speaker would actually say; often a calque from English word order.
- "forced_construction": A grammar pattern has been forced onto a sentence where it does not fit, producing stilted Spanish.
- "target_word_misused": The target word is missing, or used with the wrong meaning or part of speech for this sentence.
- "translation_mismatch": The English translation does not faithfully match the Spanish meaning or clause structure.
- "tense_label_wrong": The "tense" label does not match the sentence's actual temporal meaning.`;

// ─────────────────────────────────────────────────────────────────────────────
//  Anthropic response helper — strips code fences and extracts the outermost
//  JSON value (object by default, or array when { array: true }).
// ─────────────────────────────────────────────────────────────────────────────
function parseJsonFromResponse(content, { array = false } = {}) {
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const match = stripped.match(array ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// Normalizes the jsonb definitions column into a short text blurb for prompts.
function formatDefinitions(definitions) {
  return Array.isArray(definitions) ? definitions.slice(0, 3).join('; ') : definitions;
}

// Mechanical shape check for a single sentence object (fields + POS dict + tense).
// Used both for generator output and for any Opus-repaired replacement sentence.
function isValidSentenceShape(s) {
  return !!(
    s &&
    typeof s.foreignText === 'string' && s.foreignText.length > 0 &&
    typeof s.english === 'string' && s.english.length > 0 &&
    typeof s.translatedVocab === 'string' && s.translatedVocab.trim().length > 0 &&
    typeof s.tense === 'string' && ALLOWED_TENSES.has(s.tense) &&
    s.partOfSpeechDict &&
    typeof s.partOfSpeechDict === 'object' &&
    !Array.isArray(s.partOfSpeechDict) &&
    Object.keys(s.partOfSpeechDict).length > 0 &&
    Object.entries(s.partOfSpeechDict).every(([token, tag]) =>
      typeof token === 'string' &&
      token.length > 0 &&
      !/[\s，。！？；：,.!?;:]/.test(token) &&
      typeof tag === 'string' &&
      ALLOWED_POS_TAG_SET.has(tag)
    )
  );
}

/**
 * Ask Claude to generate 3 natural example sentences for a Spanish word.
 * Returns an array of { foreignText, english, translatedVocab, tense, partOfSpeechDict } objects.
 */
async function generateExampleSentences(word, pronunciation, definitions, partsOfSpeech) {
  const allowedPosTags = ALLOWED_POS_TAGS;
  const definitionText = formatDefinitions(definitions);

  // partsOfSpeech is a JSONB array of raw Wiktionary POS tags from the
  // dictionaryentries_es row. Normalize to friendly, sentence-worthy roles so we
  // enforce at least one sentence per role the word can actually take.
  const posList = normalizePosList(partsOfSpeech);
  const sentenceCount = Math.max(3, posList.length);
  const posCoverageClause = posList.length > 0
    ? `\n- The target word "${word}" must appear used as EACH of these parts of speech across the sentences, with at least one sentence per POS: ${posList.join(', ')}. If a POS has no sentence dedicated to it, add another sentence that demonstrates that role.`
    : '';

  const wordLine = pronunciation ? `${word} (${pronunciation})` : word;
  const prompt = `You are a Spanish language teacher creating example sentences for a vocabulary app.

Word: ${wordLine}
Meaning: ${definitionText}${posList.length > 0 ? `\nParts of speech this word can take: ${posList.join(', ')}` : ''}

Write exactly ${sentenceCount} natural example sentences using "${word}". Each sentence should:
- Use the word naturally as a native speaker would, with correct gender/number agreement and verb conjugation
- Be simple enough for an intermediate learner (CEFR A2–B1 level vocabulary otherwise)
- Show a different grammatical role or context for the word for each sentence${posCoverageClause}
- Have an accurate English translation
- Mirror the punctuation of the Spanish sentence in the English translation — if the Spanish uses a comma to separate two clauses, use a comma in the same position in English; match question marks, exclamation points, etc.
- Match the clause structure of the Spanish sentence — if the Spanish has two clauses separated by a conjunction or comma, the English should have two parallel clauses in the same order
- Include a "translatedVocab" field: the English word or short phrase in your English translation that directly corresponds to "${word}" (e.g. if the word is "pegar" and the sentence is "She stuck the photo on the wall.", translatedVocab is "stuck")
- Include a "tense" field: the temporal meaning of the sentence — one of "past", "present", or "future". Reason from what the sentence *means* in context, not just which grammatical markers are present (e.g. the Spanish present tense can express habitual or near-future meaning). Use "past" for completed or past actions, "present" for ongoing, habitual, or stative situations, and "future" for intended or upcoming actions.
- Include a "partOfSpeechDict" object for each sentence
- partOfSpeechDict keys must be word tokens (each word, separated by spaces) that appear in the Spanish sentence
- Make sure to include every word in the sentence as a key in partOfSpeechDict
- partOfSpeechDict values must be one of:
  ${allowedPosTags.join(', ')}
- Do not include punctuation as keys
- Include the target word "${word}" as one of the keys in partOfSpeechDict
- If the target word is a verb but is used as an infinitive nominal subject/object in this sentence (e.g. "Correr es sano" — "Running is healthy", where "correr" is the sentence subject), tag it as "noun", not "verb"

Across the ${sentenceCount} sentences, vary the sentence structure so they don't feel templated. Do NOT start most sentences with a time word followed by a verb, and avoid leaning on a single repeated mold. Mix it up: vary the sentence-initial element, include a question where natural, and draw on a diverse range of grammatical constructions rather than reusing the same one.

Respond with ONLY a JSON array of exactly ${sentenceCount} objects in this format (no markdown, no explanation):
[
  {
    "foreignText": "Spanish sentence",
    "english": "English translation",
    "translatedVocab": "english word",
    "tense": "past" | "present" | "future",
    "partOfSpeechDict": {
      "wordToken1": "pos_tag",
      "wordToken2": "pos_tag"
    }
  }
]`;

  const response = await anthropic.messages.create({
    model: GENERATOR_MODEL,
    max_tokens: Math.max(600, 250 * sentenceCount),
    temperature: 0.7,
    messages: [{ role: 'user', content: prompt }],
  });

  const parsed = parseJsonFromResponse(response.content[0].text, { array: true });
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  // Keep only sentences with the required fields + a well-formed partOfSpeechDict
  const valid = parsed.filter(isValidSentenceShape);

  return valid.length > 0 ? valid : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Validator agent — reviews the generated batch for common AI mistakes.
//  Returns a Map<index, { accept, violatedRules, critique }>. Fails OPEN
//  (returns an empty Map) if the response can't be parsed, so a flaky reviewer
//  never blocks an otherwise-good batch.
// ─────────────────────────────────────────────────────────────────────────────
async function validatorAgent(word, pronunciation, definitionText, sentences) {
  const numbered = sentences
    .map((s, i) => `${i}. ${s.foreignText}  —  ${s.english}  [tense: ${s.tense}]`)
    .join('\n');

  // Static reviewer instructions (persona + common-mistakes catalog + response
  // format) → cached system; the per-entry word + numbered sentences → user.
  const systemText = `You are a strict native-Spanish reviewer of example sentences for a Spanish learning app. You catch subtle grammatical and naturalness errors that automated generation tends to make. Respond only with valid JSON.

Judge each sentence independently. Accept sentences that are natural and correct, even if simple — only reject on a genuine error.

${COMMON_MISTAKES_TEXT}

Respond with ONLY a JSON array with one object per sentence index given:
[
  {"index": 0, "accept": true},
  {"index": 1, "accept": false, "violatedRules": ["degree_complement_order"], "critique": "1-2 sentence explanation of the error and how to fix it"}
]
Include "violatedRules" and "critique" only when accept is false.`;

  const response = await anthropic.messages.create({
    model: VALIDATOR_MODEL,
    max_tokens: 900,
    temperature: 0.1,
    system: cachedSystem(systemText),
    messages: [{
      role: 'user',
      content: `Review each example sentence below for the target word "${word}" (${pronunciation}; meaning: ${definitionText}).

Sentences:
${numbered}`,
    }],
  });

  const parsed = parseJsonFromResponse(response.content[0].text, { array: true });
  const verdicts = new Map();
  if (!Array.isArray(parsed)) return verdicts; // fail open — don't block a good batch
  for (const v of parsed) {
    if (v && Number.isInteger(v.index)) {
      verdicts.set(v.index, {
        accept: v.accept !== false,
        violatedRules: Array.isArray(v.violatedRules) ? v.violatedRules : [],
        critique: typeof v.critique === 'string' ? v.critique : '',
      });
    }
  }
  return verdicts;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Repair agent (Opus) — drafts a single replacement for a flagged sentence,
//  informed by the validator's violation codes + critique. Returns a shape-valid
//  sentence object, or null if the repair was unusable.
// ─────────────────────────────────────────────────────────────────────────────
async function regenerateSentenceWithOpus(word, pronunciation, definitionText, badSentence, violatedRules, critique) {
  const allowedPosTags = ALLOWED_POS_TAGS;
  const violationLines = violatedRules.length ? violatedRules.map(v => `  - ${v}`).join('\n') : '  (unspecified)';

  const response = await anthropic.messages.create({
    model: REGENERATOR_MODEL,
    max_tokens: 700,
    // Note: claude-opus-4-8 deprecates the `temperature` parameter, so it is omitted here.
    system: 'You are a native Spanish teacher rewriting a single flawed example sentence. Respond only with valid JSON.',
    messages: [{
      role: 'user',
      content: `A reviewer rejected the example sentence below for the word "${word}" (${pronunciation}; meaning: ${definitionText}). Write ONE new, natural replacement sentence that uses "${word}" in the same grammatical role and a similar context, but fully fixes the problem. Do not reproduce the error.

Rejected sentence: ${badSentence.foreignText}
English: ${badSentence.english}
Violated rules:
${violationLines}
Reviewer critique: ${critique || '(none)'}

The replacement must follow the same requirements as the original generation:
- Natural, native-sounding Spanish, intermediate (CEFR A2–B1) level.
- "translatedVocab": the English word/phrase in your translation that corresponds to "${word}".
- "tense": one of "past", "present", or "future" — the sentence's natural temporal meaning.
- "partOfSpeechDict": every word token in the Spanish sentence as a key (no punctuation keys), each value one of: ${allowedPosTags.join(', ')}. Include "${word}" as a key.
- The English translation must mirror the Spanish punctuation and clause structure.

Respond with ONLY one JSON object:
{"foreignText": "...", "english": "...", "translatedVocab": "...", "tense": "past|present|future", "partOfSpeechDict": {"token": "pos_tag"}}`,
    }],
  });

  const parsed = parseJsonFromResponse(response.content[0].text);
  return parsed && isValidSentenceShape(parsed) ? parsed : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Orchestrator: validate the batch, then repair each flagged sentence with Opus
//  and re-validate the replacement once (mirrors the single-retry policy in
//  backfill-expansion-claude.js). Returns the repaired batch + stats.
// ─────────────────────────────────────────────────────────────────────────────
async function validateAndRepairSentences(word, pronunciation, definitionText, sentences) {
  const verdicts = await validatorAgent(word, pronunciation, definitionText, sentences);
  const out = [...sentences];
  const repairedIndexes = new Set();
  let flagged = 0;
  let repaired = 0;
  let stillFlagged = 0;

  for (let i = 0; i < out.length; i++) {
    const verdict = verdicts.get(i);
    if (!verdict || verdict.accept) continue;
    flagged++;

    const fix = await regenerateSentenceWithOpus(
      word, pronunciation, definitionText, out[i], verdict.violatedRules, verdict.critique,
    );
    if (!fix) continue; // repair unusable — keep the original rather than lose POS coverage

    // Re-validate the single repaired sentence once. Keep the Opus version
    // regardless (it is almost always better), but track if it still trips a rule.
    const recheck = await validatorAgent(word, pronunciation, definitionText, [fix]);
    const recheckVerdict = recheck.get(0);
    if (recheckVerdict && !recheckVerdict.accept) stillFlagged++;

    out[i] = fix;
    repairedIndexes.add(i);
    repaired++;
  }

  return { sentences: out, flagged, repaired, stillFlagged, repairedIndexes };
}

async function run() {
  if (isSpotCheck) {
    console.log('🔍 SPOT CHECK MODE — processing 3 entries only\n');
  }
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);
  console.log('🚀 Starting AI-powered example sentences backfill...\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(`
      SELECT id, word1, pronunciation, definitions, "partsOfSpeech"
      FROM dictionaryentries_es
      WHERE language = 'es'
        AND discoverable = TRUE
        ${validatedFilter}
        ${emptinessFilter}
        ${wordsFilter}
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 3' : ''}
    `);

    console.log(`📊 Found ${entries.length} entries needing example sentences\n`);

    let updated = 0;
    let failed = 0;
    let totalFlagged = 0;     // sentences the validator rejected
    let totalRepaired = 0;    // flagged sentences successfully replaced by Opus
    let totalStillFlagged = 0; // Opus replacements that still tripped a rule (kept anyway)

    for (const row of entries) {
      try {
        process.stdout.write(`  ${row.word1} (${row.pronunciation}) ... `);

        const sentences = await generateExampleSentences(row.word1, row.pronunciation, row.definitions, row.partsOfSpeech);

        if (!sentences) {
          console.log('no valid sentences returned');
          failed++;
          continue;
        }

        // Validator agent → Opus repair for any flagged sentence.
        const { sentences: finalSentences, flagged, repaired, stillFlagged, repairedIndexes } =
          await validateAndRepairSentences(row.word1, row.pronunciation, formatDefinitions(row.definitions), sentences);
        totalFlagged += flagged;
        totalRepaired += repaired;
        totalStillFlagged += stillFlagged;

        await client.query(
          `UPDATE dictionaryentries_es SET "exampleSentences" = $1::jsonb WHERE id = $2`,
          [JSON.stringify(finalSentences), row.id]
        );
        await stampEntries(client, 'dictionaryentries_es', row.id);

        updated++;

        if (isSpotCheck) {
          // Print full sentence details in spot-check mode
          console.log(`✓ (${finalSentences.length} sentences${repaired ? `, ${repaired} repaired by Opus` : ''})`);
          finalSentences.forEach((s, i) => {
            const tag = repairedIndexes.has(i) ? '   🔧 Opus repair' : '';
            console.log(`    ${s.foreignText}${tag}`);
            console.log(`           ${s.english}`);
            console.log(`           translatedVocab: ${s.translatedVocab}`);
            console.log(`           tense: ${s.tense}`);
            console.log(`           POS: ${JSON.stringify(s.partOfSpeechDict)}`);
          });
        } else {
          console.log(`✓${repaired ? ` (${repaired} repaired)` : ''}`);
          if (updated % 50 === 0) {
            console.log(`\n📈 Progress: ${updated}/${entries.length} (${Math.round(updated / entries.length * 100)}%)\n`);
          }
        }
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      // Small delay to avoid hammering the API
      await new Promise(r => setTimeout(r, 300));
    }

    console.log('\n' + '='.repeat(60));
    console.log(isSpotCheck ? '📊 Spot Check Complete!' : '📊 Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total processed   : ${entries.length}`);
    console.log(`Updated           : ${updated}`);
    console.log(`Failed            : ${failed}`);
    console.log(`Flagged sentences : ${totalFlagged}`);
    console.log(`Repaired by Opus  : ${totalRepaired}`);
    if (totalStillFlagged) console.log(`Still flagged*    : ${totalStillFlagged} (Opus version kept anyway)`);
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
