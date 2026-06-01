/**
 * Backfill Script: AI-powered example sentences for dictionaryentries
 *
 * For each discoverable zh entry with no exampleSentences, uses Claude AI to generate
 * natural, contextually appropriate example sentences using the word in different
 * grammatical roles. Each sentence includes Chinese, English translation, and
 * a partOfSpeechDict keyed by sentence tokens (single or multi-character words).
 *
 * Multi-agent pipeline (mirrors backfill-expansion-claude.js):
 *   1. Generator agent (Sonnet) → proposes the batch of sentences
 *   2. Shape check (isValidSentenceShape) → mechanical field/POS-dict validation
 *   3. Validator agent (Sonnet) → flags common AI mistakes per sentence
 *      (e.g. degree-complement word order like 一些贵 instead of 贵一些)
 *   4. Repair agent (Opus) → for each flagged sentence, drafts a corrected
 *      replacement informed by the validator's critique, re-validated once
 *
 * Usage:
 *   npx tsx /app/scripts/backfill-example-sentences.js             # full backfill
 *   npx tsx /app/scripts/backfill-example-sentences.js --spot-check # test 3 entries
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../db.js';
import { ALLOWED_POS_TAGS } from './lib/posTags.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// When --spot-check is passed, process only 3 entries and print full sentence output
const isSpotCheck = process.argv.includes('--spot-check');

// --all-discoverable → regenerate for every discoverable entry, overwriting existing exampleSentences.
// Default behavior only targets entries where exampleSentences IS NULL OR '[]'.
const isAllDiscoverable = process.argv.includes('--all-discoverable');

// --words=未来,摸脉 → scope to specific entries only; omit to target all discoverable entries with exampleSentences IS NULL
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
// looks for. Single source of truth referenced by the validator prompt. The
// first rule is the degree-complement word-order error observed in generated
// 比 comparisons (一些贵 / 一点大 instead of 贵一些 / 大一点).
const COMMON_MISTAKES_TEXT = `Common AI mistakes to flag (each maps to a violation code):
- "degree_complement_order": A degree/quantity complement such as 一些 / 一点 / 一点儿 / 得多 / 多了 is placed BEFORE the adjective instead of after it. In natural Mandarin these FOLLOW the adjective: 贵一些, 大一点, 高得多 — never 一些贵, 一点大, 得多高. This most often appears in 比 comparisons (WRONG: 这件衣服比那件一些贵; RIGHT: 这件衣服比那件贵一些).
- "unnatural_phrasing": Grammatical word-by-word but not what a native speaker would actually say.
- "forced_construction": A grammar pattern (把 / 被 / 比 / 是…的, etc.) has been forced onto a sentence where it does not fit, producing stilted Mandarin.
- "target_word_misused": The target word is missing, or used with the wrong meaning or part of speech for this sentence.
- "measure_word_error": A wrong, missing, or mismatched classifier / measure word.
- "translation_mismatch": The English translation does not faithfully match the Chinese meaning or clause structure.
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
    typeof s.chinese === 'string' && s.chinese.length > 0 &&
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
 * Ask Claude to generate 3 natural example sentences for a Chinese word.
 * Returns an array of { chinese, english, partOfSpeechDict } objects.
 */
async function generateExampleSentences(word, pronunciation, definitions, partsOfSpeech) {
  const allowedPosTags = ALLOWED_POS_TAGS;
  const definitionText = formatDefinitions(definitions);

  // partsOfSpeech is a JSONB array of POS tags from the dictionaryentries row.
  // We enforce at least one sentence per listed POS so every grammatical role
  // the word can take is exemplified.
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];
  const sentenceCount = Math.max(3, posList.length);
  const posCoverageClause = posList.length > 0
    ? `\n- The target word "${word}" must appear used as EACH of these parts of speech across the sentences, with at least one sentence per POS: ${posList.join(', ')}. If a POS has no sentence dedicated to it, add another sentence that demonstrates that role.`
    : '';

  const prompt = `You are a Chinese language teacher creating example sentences for a vocabulary app.

Word: ${word} (${pronunciation})
Meaning: ${definitionText}${posList.length > 0 ? `\nParts of speech this word can take: ${posList.join(', ')}` : ''}

Write exactly ${sentenceCount} natural example sentences using "${word}". Each sentence should:
- Use the word naturally as a native speaker would
- Be simple enough for an intermediate learner (HSK 3–4 level vocabulary otherwise)
- Show a different grammatical role or context for the word for each sentence${posCoverageClause}
- Have an accurate English translation
- Mirror the punctuation of the Chinese sentence in the English translation — if the Chinese uses a comma to separate two clauses, use a comma in the same position in English; match question marks, exclamation points, etc.
- Match the clause structure of the Chinese sentence — if the Chinese has two clauses separated by a conjunction or comma, the English should have two parallel clauses in the same order
- Include a "translatedVocab" field: the English word or short phrase in your English translation that directly corresponds to "${word}" (e.g. if the word is 贴 and the sentence is "She stuck the photo on the wall.", translatedVocab is "stuck")
- Include a "tense" field: the temporal meaning of the sentence — one of "past", "present", or "future". Reason from what the sentence *means* in context, not just which grammatical markers are present (e.g. 了 can mark a present state change, progressive aspect can appear in past or future contexts). Use "past" for completed or past actions, "present" for ongoing, habitual, or stative situations, and "future" for intended or upcoming actions.
- Include a "partOfSpeechDict" object for each sentence
- partOfSpeechDict keys must be word tokens that appear in the Chinese sentence (single or multi-character words are both allowed)
- Make sure to include every word in the sentence as a key in partOfSpeechDict
- partOfSpeechDict values must be one of:
  ${allowedPosTags.join(', ')}
- Do not include punctuation as keys
- Include the target word "${word}" as one of the keys in partOfSpeechDict
- If the target word is a verb but is used as a gerund or nominal subject/object in this sentence (e.g. 下单很简单 — "Ordering is simple", where 下单 is the sentence subject), tag it as "noun", not "verb"

Across the ${sentenceCount} sentences, vary the sentence structure so they don't feel templated. Do NOT start most sentences with a time word followed by a verb, and avoid leaning on a single repeated mold. Mix it up: vary the sentence-initial element, include a question where natural, and draw on a diverse range of grammatical constructions rather than reusing the same one.

Respond with ONLY a JSON array of exactly ${sentenceCount} objects in this format (no markdown, no explanation):
[
  {
    "chinese": "Chinese sentence",
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
    .map((s, i) => `${i}. ${s.chinese}  —  ${s.english}  [tense: ${s.tense}]`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: VALIDATOR_MODEL,
    max_tokens: 900,
    temperature: 0.1,
    system: 'You are a strict native-Mandarin reviewer of example sentences for a Chinese learning app. You catch subtle grammatical and naturalness errors that automated generation tends to make. Respond only with valid JSON.',
    messages: [{
      role: 'user',
      content: `Review each example sentence below for the target word "${word}" (${pronunciation}; meaning: ${definitionText}). Judge each sentence independently. Accept sentences that are natural and correct, even if simple — only reject on a genuine error.

${COMMON_MISTAKES_TEXT}

Sentences:
${numbered}

Respond with ONLY a JSON array with one object per sentence index above:
[
  {"index": 0, "accept": true},
  {"index": 1, "accept": false, "violatedRules": ["degree_complement_order"], "critique": "1-2 sentence explanation of the error and how to fix it"}
]
Include "violatedRules" and "critique" only when accept is false.`,
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
    system: 'You are a native Mandarin teacher rewriting a single flawed example sentence. Respond only with valid JSON.',
    messages: [{
      role: 'user',
      content: `A reviewer rejected the example sentence below for the word "${word}" (${pronunciation}; meaning: ${definitionText}). Write ONE new, natural replacement sentence that uses "${word}" in the same grammatical role and a similar context, but fully fixes the problem. Do not reproduce the error.

Rejected sentence: ${badSentence.chinese}
English: ${badSentence.english}
Violated rules:
${violationLines}
Reviewer critique: ${critique || '(none)'}

The replacement must follow the same requirements as the original generation:
- Natural, native-sounding Mandarin, intermediate (HSK 3–4) level.
- "translatedVocab": the English word/phrase in your translation that corresponds to "${word}".
- "tense": one of "past", "present", or "future" — the sentence's natural temporal meaning.
- "partOfSpeechDict": every word token in the Chinese sentence as a key (no punctuation keys), each value one of: ${allowedPosTags.join(', ')}. Include "${word}" as a key.
- The English translation must mirror the Chinese punctuation and clause structure.

Respond with ONLY one JSON object:
{"chinese": "...", "english": "...", "translatedVocab": "...", "tense": "past|present|future", "partOfSpeechDict": {"token": "pos_tag"}}`,
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
      FROM dictionaryentries
      WHERE language = 'zh'
        AND discoverable = TRUE
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
          `UPDATE dictionaryentries SET "exampleSentences" = $1::jsonb WHERE id = $2`,
          [JSON.stringify(finalSentences), row.id]
        );

        updated++;

        if (isSpotCheck) {
          // Print full sentence details in spot-check mode
          console.log(`✓ (${finalSentences.length} sentences${repaired ? `, ${repaired} repaired by Opus` : ''})`);
          finalSentences.forEach((s, i) => {
            const tag = repairedIndexes.has(i) ? '   🔧 Opus repair' : '';
            console.log(`    ${s.chinese}${tag}`);
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
