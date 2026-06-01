/**
 * Backfill Script: AI-powered partsOfSpeech assignment for dictionaryentries
 *
 * Pipeline (mirrors backfill-expansion-claude.js):
 *   1. Generator agent (Sonnet) — proposes a POS list from the canonical 12-tag set.
 *   2. Validator agent (Sonnet) — applies formal Chinese-grammar tests to each
 *      proposed tag. If it accepts, the generator's list is written and the
 *      pipeline stops (single attempt).
 *   3. Regenerator agent (Opus) — only on rejection. Retries once, informed by the
 *      validator's rejected tags + critique. Free to add, remove, or keep tags.
 *   4. Chooser agent (Opus) — only after a regeneration. Adjudicates between the
 *      generator's original list and the regenerator's corrected list and picks
 *      one of the two verbatim (it cannot propose a third list). The winner is
 *      what gets written.
 *
 * Note: there is no final re-validation. Once a regeneration happens, the
 * chooser's pick is authoritative regardless of whether it would re-pass the
 * validator.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill-parts-of-speech.js               # full backfill
 *   docker exec cow-backend-local npx tsx scripts/backfill-parts-of-speech.js --spot-check  # test 5 entries
 *   docker exec cow-backend-local npx tsx scripts/backfill-parts-of-speech.js --words=未来,摸脉
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../db.js';
import { ALLOWED_POS_TAGS, ALLOWED_POS_TAG_SET } from './lib/posTags.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const isSpotCheck = process.argv.includes('--spot-check');

const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';

// Default (untargeted) runs only fill in missing/empty partsOfSpeech. But when
// the caller names specific words via --words, the intent is to re-evaluate
// those entries, so we drop the "needs backfill" guard and reprocess them even
// if they already carry a (possibly wrong) value.
const posNullFilter = targetWords?.length
  ? ''
  : `AND ("partsOfSpeech" IS NULL OR jsonb_array_length("partsOfSpeech") = 0)`;

const GEN_MODEL = 'claude-sonnet-4-6';
const VALIDATOR_MODEL = 'claude-sonnet-4-6';
const RETRY_MODEL = 'claude-opus-4-8'; // used when Sonnet's first attempt fails validation

// ─────────────────────────────────────────────────────────────────────────────
//  Shared rule text — injected into both the generator and validator prompts
//  so the validator judges by the exact same criteria the generator was given.
// ─────────────────────────────────────────────────────────────────────────────

const POS_RULES_TEXT = `
Allowed tags (choose ONLY from these): ${ALLOWED_POS_TAGS.join(', ')}.

Hard rules — apply formal tests, not English-translation intuition:

1. CONSERVATIVE TAGGING — Most Chinese words have only 1 or 2 parts of speech.
   3 or more should be rare. Do not pad the list.

2. NO COMPOSITIONAL TAGS, BUT DO TAG THE WHOLE-WORD FUNCTION — Do not credit a
   multi-character word with the *classifier* tag that belongs only to one of
   its component characters. However, a 一X / numeral+classifier phrase is itself
   a NUMERAL (quantity) phrase: tag it "numeral" for that quantity sense, and add
   "adverb" ONLY if the whole phrase can stand bare before a verb (rule 3). Do
   not let the quantity sense fall through to "noun only."
     - 一排 is NOT a classifier (排 is) — 一排 itself is a numeral phrase → tag "numeral".
     - 一下 is NOT a classifier — it is a numeral / verbal-quantity phrase → "numeral".
     - 一点 ("a little / a bit") is NOT a classifier — the quantity sense is a
       numeral phrase → tag "numeral". It is NOT an adverb (it trails the verb/
       adjective: 慢一点, 多一点, not *一点慢). Keep "noun" for 点 senses (o'clock,
       dot, decimal point).
     - 几点 is NOT a classifier (it's an interrogative noun phrase).

3. ADJECTIVE ≠ ADVERB — Chinese adjectives can directly modify verbs and fill
   complement slots (V得Adj, V+Adj resultative) WITHOUT becoming adverbs.
   Tag a word as "adverb" ONLY if it can appear bare BEFORE a verb as a true
   pre-verbal modifier (like 都, 也, 常常, 慢慢, 一般, 经常).
     - 坏 is NOT an adverb (累坏了 — 坏 is a resultative adjective).
     - 高 is NOT an adverb. 短 is NOT an adverb.
     - 第一, 不少, 未来 are NOT adverbs (they don't pre-modify verbs bare).
     - 请 is NOT an adverb (请坐 — 请 is an imperative verb, not an adverb).

4. NOUN-AS-VERB ≠ VERB — Colloquial verbing of a noun (我们火锅吧) does NOT
   make the noun a verb. Tag "verb" only if the word has a real lexical
   verb sense documented in the definitions.
     - 火锅 is NOT a verb. 同事 is NOT a verb.

5. ORDINALS / QUANTIFIERS — 第N words are numerals (optionally adjectives).
   Quantity words like 不少 / 很多 are adjectives or numerals, NOT adverbs.

6. CONJUNCTIVE ADVERBS ARE STILL ADVERBS — Words like 结果 ("as a result"),
   一般 ("generally"), 然后 ("then") DO function as discourse-level adverbs
   when they pre-modify a clause. Tag adverb in those cases.

7. DIRECTIONAL COMPLEMENTS — 起来 / 下来 / 出来 etc. are verbs in their
   literal sense (站起来 = "stand up") and may also be tagged "particle"
   when used as stative/aspectual markers (看起来 = "it seems").
`;

const VIOLATION_CODE_LABELS = {
  spurious_adverb: 'Tagged as adverb but fails the bare-pre-verbal test (rule 3)',
  spurious_verb: 'Tagged as verb but only noun-as-verb / no lexical verb sense (rule 4)',
  spurious_classifier: 'Tagged as classifier but the word is a numeral+classifier phrase (rule 2)',
  compositional: 'Tag inherited from a component character, not the whole word (rule 2)',
  over_tagged: 'List has 3+ tags but the word does not genuinely take that many roles (rule 1)',
  archaic_or_rare: 'Tag reflects an archaic or technical use a learner would never see',
  missing_tag: 'A clearly valid POS is missing from the list',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Utility
// ─────────────────────────────────────────────────────────────────────────────

function parseJsonFromResponse(text) {
  if (!text) return null;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const jsonMatch = trimmed.match(/[\[{][\s\S]*[\]}]/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function normalizeTags(parsed) {
  if (!Array.isArray(parsed)) return null;
  const cleaned = [];
  for (const tag of parsed) {
    if (typeof tag !== 'string') continue;
    const lower = tag.toLowerCase().trim();
    if (ALLOWED_POS_TAG_SET.has(lower) && !cleaned.includes(lower)) {
      cleaned.push(lower);
    }
  }
  return cleaned.length > 0 ? cleaned : null;
}

function formatDefinitions(definitions) {
  // Pass the full definition list to the agents — polysemous words (是, 贴, 和…)
  // carry senses past the 5th entry that determine valid POS tags, so we no
  // longer truncate here.
  return Array.isArray(definitions)
    ? definitions.join('; ')
    : String(definitions ?? '');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 1: generator (Sonnet)
// ─────────────────────────────────────────────────────────────────────────────

async function generatePartsOfSpeech(word, definitions, model = GEN_MODEL) {
  const definitionText = formatDefinitions(definitions);

  const prompt = `You are a Chinese linguistics expert assigning parts of speech for a learner dictionary.

Word: ${word}
Definitions: ${definitionText}

${POS_RULES_TEXT}

Task: List every part of speech this word genuinely functions as in modern Mandarin, across ALL of its pronunciations/readings, ordered from most to least common. The definitions above may span multiple readings — include the POS for every sense that appears, regardless of which reading it belongs to.

Respond with ONLY a JSON array of lowercase strings, e.g. ["noun", "verb"]. No markdown, no explanation.`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 64,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  const parsed = parseJsonFromResponse(response.content[0].text);
  return normalizeTags(parsed);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 2: validator (Sonnet)
//  Returns { accept, rejectedTags: string[], violatedRules: string[], critique }
// ─────────────────────────────────────────────────────────────────────────────

async function validatePartsOfSpeech(word, definitions, proposedTags) {
  const definitionText = formatDefinitions(definitions);

  const prompt = `You are a strict Chinese-grammar reviewer judging a proposed parts-of-speech assignment for a learner dictionary. Apply the rules formally — do not approve a tag just because the English translation suggests it.

${POS_RULES_TEXT}

Word: ${word}
Definitions: ${definitionText}
Proposed tags: ${JSON.stringify(proposedTags)}

The proposed list should cover every reading/pronunciation represented in the definitions — do not reject a tag merely because it belongs to a different reading than another sense. For each proposed tag, judge whether it passes the formal tests above. Also consider whether any clearly valid POS is missing.

Violation codes you may use (per tag):
${Object.entries(VIOLATION_CODE_LABELS).map(([k, v]) => `  - "${k}": ${v}`).join('\n')}

Respond with ONLY one of these JSON forms:
  {"accept": true}
or
  {"accept": false, "rejectedTags": ["tag1", "tag2"], "violatedRules": ["code1", "code2"], "critique": "1-2 sentences explaining the specific failures and what the corrected list should look like"}`;

  const response = await anthropic.messages.create({
    model: VALIDATOR_MODEL,
    max_tokens: 300,
    temperature: 0.1,
    system: 'You are a strict reviewer of Chinese parts-of-speech assignments. Respond only with valid JSON.',
    messages: [{ role: 'user', content: prompt }],
  });

  const parsed = parseJsonFromResponse(response.content[0].text);
  if (!parsed) {
    // Fail closed so the retry path runs
    return {
      accept: false,
      rejectedTags: [],
      violatedRules: ['unparseable_validator_response'],
      critique: 'Validator response could not be parsed.',
    };
  }
  if (parsed.accept === true) {
    return { accept: true, rejectedTags: [], violatedRules: [], critique: '' };
  }
  return {
    accept: false,
    rejectedTags: Array.isArray(parsed.rejectedTags) ? parsed.rejectedTags : [],
    violatedRules: Array.isArray(parsed.violatedRules) ? parsed.violatedRules : [],
    critique: typeof parsed.critique === 'string' ? parsed.critique : '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 3: regenerator (Opus) — corrects an attempt that failed validation
// ─────────────────────────────────────────────────────────────────────────────

async function regeneratePartsOfSpeech(word, definitions, priorTags, rejectedTags, violatedRules, critique) {
  const definitionText = formatDefinitions(definitions);
  const violationLines = violatedRules
    .map(code => `  - ${code}: ${VIOLATION_CODE_LABELS[code] ?? code}`)
    .join('\n');

  const prompt = `Your previous parts-of-speech assignment for a Chinese word was rejected by a strict reviewer. Produce a corrected list that addresses the specific failures.

${POS_RULES_TEXT}

Word: ${word}
Definitions: ${definitionText}

Previous attempt: ${JSON.stringify(priorTags)}
Reviewer flagged these tags as problematic: ${JSON.stringify(rejectedTags)}
Violated rules:
${violationLines || '  (none)'}
Reviewer critique:
${critique || '(none)'}

You are free to ADD, REMOVE, or KEEP any tag. Use your own judgment — the reviewer can be wrong, both by rejecting a legitimate tag and by missing a tag that should have been included. Apply the formal tests directly to each tag (proposed, rejected, or new) and produce the list you believe is correct.

Aim for an accurate list, not a minimal one — most words have 1–2 parts of speech, but multi-category words exist and their extra tags should be retained when justified. The list must cover every reading/pronunciation represented in the definitions; do not drop a tag merely because its sense belongs to a different reading than the others.

Respond with ONLY a JSON array of lowercase strings, e.g. ["noun", "verb"]. No markdown, no explanation.`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 64,
    // Note: claude-opus-4-8 does not accept the `temperature` parameter — omit it.
    system: 'You are a Chinese linguistics expert correcting a flawed parts-of-speech assignment. Respond only with a JSON array.',
    messages: [{ role: 'user', content: prompt }],
  });

  const parsed = parseJsonFromResponse(response.content[0].text);
  return normalizeTags(parsed);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 4: chooser (Opus) — final adjudicator between Sonnet's and Opus's tags
//  Returns { winner: 'sonnet' | 'opus', reason: string }
// ─────────────────────────────────────────────────────────────────────────────

async function choosePartsOfSpeech(word, definitions, sonnetTags, opusTags) {
  const definitionText = formatDefinitions(definitions);

  const prompt = `Two parts-of-speech assignments have been proposed for a Chinese word. Pick the better one as written. You must choose exactly one — do not propose a third list.

${POS_RULES_TEXT}

Word: ${word}
Definitions: ${definitionText}

Option A (sonnet): ${JSON.stringify(sonnetTags)}
Option B (opus):   ${JSON.stringify(opusTags)}

Judge which list more accurately reflects the word's parts of speech across ALL readings under the rules above. Penalize over-tagging (rule 1) AND under-tagging (missing a clearly valid POS from any reading).

Respond with ONLY:
  {"winner": "sonnet", "reason": "1 short sentence"}
or
  {"winner": "opus", "reason": "1 short sentence"}`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 200,
    // Note: claude-opus-4-8 does not accept the `temperature` parameter — omit it.
    system: 'You are a strict Chinese-grammar adjudicator picking between two parts-of-speech assignments. Respond only with valid JSON.',
    messages: [{ role: 'user', content: prompt }],
  });

  const parsed = parseJsonFromResponse(response.content[0].text);
  if (!parsed || (parsed.winner !== 'sonnet' && parsed.winner !== 'opus')) {
    // If the chooser produces garbage, fall back to Opus (the corrected attempt).
    return { winner: 'opus', reason: 'chooser response unparseable; defaulted to opus' };
  }
  return { winner: parsed.winner, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Orchestrator: generator → validator → (opus retry → opus chooser) → final
//  Returns { tags, attempts, model, accepted, finalCritique }
// ─────────────────────────────────────────────────────────────────────────────

async function runPosPipeline(word, definitions) {
  const firstTags = await generatePartsOfSpeech(word, definitions, GEN_MODEL);
  if (!firstTags) {
    return { tags: null, attempts: 1, model: GEN_MODEL, accepted: false, finalCritique: 'Generator returned unparseable output' };
  }

  const verdict1 = await validatePartsOfSpeech(word, definitions, firstTags);
  if (verdict1.accept) {
    return { tags: firstTags, attempts: 1, model: GEN_MODEL, accepted: true, finalCritique: '' };
  }

  // Sonnet's attempt was rejected — retry with Opus, informed by the critique.
  const retryTags = await regeneratePartsOfSpeech(
    word,
    definitions,
    firstTags,
    verdict1.rejectedTags,
    verdict1.violatedRules,
    verdict1.critique
  );
  if (!retryTags) {
    return {
      tags: firstTags,
      attempts: 2,
      model: GEN_MODEL,
      accepted: false,
      finalCritique: `Opus retry returned unparseable output; falling back to Sonnet's attempt. Original critique: ${verdict1.critique}`,
    };
  }

  // Opus chooser picks between Sonnet's original and Opus's correction.
  const choice = await choosePartsOfSpeech(word, definitions, firstTags, retryTags);
  const winnerTags = choice.winner === 'sonnet' ? firstTags : retryTags;
  const winnerModel = choice.winner === 'sonnet' ? GEN_MODEL : RETRY_MODEL;
  return {
    tags: winnerTags,
    attempts: 2,
    model: winnerModel,
    chooser: choice.winner,
    chooserReason: choice.reason,
    sonnetTags: firstTags,
    opusTags: retryTags,
    finalCritique: '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  if (isSpotCheck) {
    console.log('🔍 SPOT CHECK MODE — processing 5 entries only\n');
  }
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);
  console.log('🚀 Starting AI-powered partsOfSpeech backfill (generator → validator → opus retry → opus chooser)...\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(`
      SELECT id, word1, pronunciation, definitions
      FROM dictionaryentries
      WHERE language = 'zh'
        AND discoverable = TRUE
        ${posNullFilter}
        ${wordsFilter}
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 5' : ''}
    `);

    console.log(`📊 Found ${entries.length} entries needing partsOfSpeech backfill\n`);

    if (entries.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    let updated = 0;
    let failed = 0;
    let acceptedFirst = 0;
    let opusRetries = 0;
    let chooserPickedSonnet = 0;
    let chooserPickedOpus = 0;

    for (const row of entries) {
      try {
        process.stdout.write(`  ${row.word1} (${row.pronunciation || 'N/A'}) ... `);

        const result = await runPosPipeline(row.word1, row.definitions);

        if (!result.tags) {
          console.log(`FAILED: ${result.finalCritique}`);
          failed++;
          continue;
        }

        await client.query(
          `UPDATE dictionaryentries SET "partsOfSpeech" = $1::jsonb WHERE id = $2`,
          [JSON.stringify(result.tags), row.id]
        );

        if (result.attempts === 1) {
          acceptedFirst++;
          console.log(`${JSON.stringify(result.tags)}  [sonnet ✓]`);
        } else {
          opusRetries++;
          if (result.chooser === 'sonnet') chooserPickedSonnet++;
          else chooserPickedOpus++;
          console.log(
            `${JSON.stringify(result.tags)}  [chooser → ${result.chooser}]  ` +
            `sonnet=${JSON.stringify(result.sonnetTags)} opus=${JSON.stringify(result.opusTags)} ` +
            `reason: ${result.chooserReason}`
          );
        }
        updated++;
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total processed         : ${entries.length}`);
    console.log(`Updated                 : ${updated}`);
    console.log(`Accepted on 1st pass    : ${acceptedFirst}`);
    console.log(`Opus retries triggered  : ${opusRetries}`);
    console.log(`  Chooser picked sonnet : ${chooserPickedSonnet}`);
    console.log(`  Chooser picked opus   : ${chooserPickedOpus}`);
    console.log(`Errors                  : ${failed}`);
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
