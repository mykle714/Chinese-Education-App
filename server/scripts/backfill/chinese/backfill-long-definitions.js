/**
 * Backfill Script: AI-powered longDefinition for dictionaryentries_zh
 *
 * Pipeline (mirrors backfill-parts-of-speech.js):
 *   1. Generator agent (Sonnet) — writes a concise English definition (25–150 chars).
 *   2. Validator agent (Sonnet) — checks all hard constraints; may reject with a critique.
 *   3. Regenerator agent (Opus) — on rejection, retries once informed by the validator critique.
 *   4. Chooser agent (Opus) — picks the better definition between Sonnet's and Opus's attempts.
 *
 * Only processes entries where partsOfSpeech is already populated so definitions
 * accurately reflect every grammatical role. Run backfill-parts-of-speech.js first.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill-long-definitions.js              # full backfill
 *   docker exec cow-backend-local npx tsx scripts/backfill-long-definitions.js --spot-check # test 5 entries
 *   docker exec cow-backend-local npx tsx scripts/backfill-long-definitions.js --words=快,打
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const isSpotCheck = process.argv.includes('--spot-check');

const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';

const GEN_MODEL = 'claude-sonnet-4-6';
const VALIDATOR_MODEL = 'claude-sonnet-4-6';
const RETRY_MODEL = 'claude-opus-4-8';

// ─────────────────────────────────────────────────────────────────────────────
//  Shared rule text — injected into generator, validator, and regenerator prompts
//  so all agents judge by the exact same criteria.
// ─────────────────────────────────────────────────────────────────────────────

const DEFINITION_RULES_TEXT = `
Hard constraints — all must be satisfied:

1. LENGTH — The definition must be between 25 and 150 characters (inclusive). Count precisely.
2. ENGLISH ONLY — Pure ASCII output only. Chinese characters, pinyin tone diacritics (ā, é, ě, ǐ, ò, ú, ǔ, ü, etc.), and all non-ASCII letters are forbidden.
3. NO CONTRASTIVE CONSTRUCTIONS — Do not use "rather than", "instead of", "as opposed to", "not just X but Y", or "X, not Y" framings. Describe what the word means directly.
4. NO SELF-REFERENCE — Do not repeat the target word itself, its pinyin, or any literal gloss of it in quotes.
5. POS COVERAGE — When the word has multiple parts of speech, reflect the distinct roles where meaningful (e.g. a word that is both noun and verb should convey both uses).

Quality goals (address whichever are most relevant):
- Dispel common misconceptions or mistranslations
- Clarify how this word differs from similar or easily confused concepts
`;

const VIOLATION_CODE_LABELS = {
  too_short: 'Definition is under 25 characters (rule 1)',
  too_long: 'Definition is over 150 characters (rule 1)',
  contains_non_english: 'Contains Chinese characters, pinyin diacritics, or non-ASCII letters (rule 2)',
  contrastive_construction: 'Uses a forbidden contrastive phrase such as "rather than" or "instead of" (rule 3)',
  self_reference: 'Repeats the target word or its transliteration (rule 4)',
  poor_pos_coverage: 'Word has multiple parts of speech but definition addresses only one role (rule 5)',
  inaccurate: 'Definition is factually misleading or incorrect for a learner',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Utility
// ─────────────────────────────────────────────────────────────────────────────

function parseJsonFromResponse(text) {
  if (!text) return null;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const jsonMatch = trimmed.match(/[{[][\s\S]*[}\]]/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 1: generator (Sonnet)
// ─────────────────────────────────────────────────────────────────────────────

async function generateDefinition(word, partsOfSpeech, model = GEN_MODEL) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];
  const posLine = posList.length > 0 ? `Parts of speech: ${posList.join(', ')}` : '';

  const prompt = `You are a Chinese language expert writing concise English definitions for a learner dictionary.

Word: ${word}
${posLine}

${DEFINITION_RULES_TEXT}

Respond with ONLY the definition text — no quotes, no JSON, no extra text.`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 256,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  return text.length >= 25 ? text : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 2: validator (Sonnet)
//  Returns { accept, violatedRules: string[], critique }
// ─────────────────────────────────────────────────────────────────────────────

async function validateDefinition(word, partsOfSpeech, proposed) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];

  const prompt = `You are a strict reviewer checking an English dictionary definition for a Chinese word. Apply every constraint formally — do not approve a definition that violates any rule.

${DEFINITION_RULES_TEXT}

Word: ${word}
Parts of speech: ${posList.join(', ') || 'N/A'}
Proposed definition (${proposed.length} chars): "${proposed}"

Violation codes you may cite:
${Object.entries(VIOLATION_CODE_LABELS).map(([k, v]) => `  - "${k}": ${v}`).join('\n')}

If the definition satisfies every constraint, respond with: {"accept": true}
If any constraint is violated, respond with:
  {"accept": false, "violatedRules": ["code1", "code2"], "critique": "1-2 sentences on the specific failures and what a corrected definition should look like"}

Respond with ONLY valid JSON, no markdown.`;

  const response = await anthropic.messages.create({
    model: VALIDATOR_MODEL,
    max_tokens: 300,
    temperature: 0.1,
    system: 'You are a strict reviewer of English definitions for Chinese words. Respond only with valid JSON.',
    messages: [{ role: 'user', content: prompt }],
  });

  const parsed = parseJsonFromResponse(response.content[0].text);
  if (!parsed) {
    // Fail closed so the retry path runs
    return { accept: false, violatedRules: ['unparseable_validator_response'], critique: 'Validator response could not be parsed.' };
  }
  if (parsed.accept === true) {
    return { accept: true, violatedRules: [], critique: '' };
  }
  return {
    accept: false,
    violatedRules: Array.isArray(parsed.violatedRules) ? parsed.violatedRules : [],
    critique: typeof parsed.critique === 'string' ? parsed.critique : '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 3: regenerator (Opus) — corrects an attempt that failed validation
// ─────────────────────────────────────────────────────────────────────────────

async function regenerateDefinition(word, partsOfSpeech, priorDef, violatedRules, critique) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];
  const violationLines = violatedRules
    .map(code => `  - ${code}: ${VIOLATION_CODE_LABELS[code] ?? code}`)
    .join('\n');

  const prompt = `Your previous English definition for a Chinese word was rejected by a strict reviewer. Produce a corrected definition that fixes all flagged violations.

${DEFINITION_RULES_TEXT}

Word: ${word}
Parts of speech: ${posList.join(', ') || 'N/A'}

Previous attempt: "${priorDef}"
Violated rules:
${violationLines || '  (none specified)'}
Reviewer critique:
${critique || '(none)'}

Apply all constraints precisely. You may keep, change, or restructure any part of the previous attempt. Respond with ONLY the corrected definition text — no quotes, no JSON, no extra text.`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 256,
    // Note: claude-opus-4-8 does not accept the `temperature` parameter — omit it.
    system: 'You are a Chinese language expert writing concise, rule-compliant English definitions. Respond only with the definition text.',
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  return text.length >= 25 ? text : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 4: chooser (Opus) — final adjudicator between Sonnet's and Opus's definitions
//  Returns { winner: 'sonnet' | 'opus', reason: string }
// ─────────────────────────────────────────────────────────────────────────────

async function chooseDefinition(word, partsOfSpeech, sonnetDef, opusDef) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];

  const prompt = `Two English definitions have been proposed for a Chinese word. Pick the better one as written — do not propose a third.

${DEFINITION_RULES_TEXT}

Word: ${word}
Parts of speech: ${posList.join(', ') || 'N/A'}

Option A (sonnet): "${sonnetDef}"
Option B (opus):   "${opusDef}"

Judge which definition better satisfies all constraints and quality goals. Penalize constraint violations AND vague or unhelpful definitions.

Respond with ONLY one of:
  {"winner": "sonnet", "reason": "1 short sentence"}
or
  {"winner": "opus", "reason": "1 short sentence"}`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 200,
    // Note: claude-opus-4-8 does not accept the `temperature` parameter — omit it.
    system: 'You are a strict adjudicator picking between two dictionary definitions. Respond only with valid JSON.',
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
//  Returns { definition, attempts, model, accepted, finalCritique, ... }
// ─────────────────────────────────────────────────────────────────────────────

async function runDefinitionPipeline(word, partsOfSpeech) {
  const firstDef = await generateDefinition(word, partsOfSpeech, GEN_MODEL);
  if (!firstDef) {
    return { definition: null, attempts: 1, model: GEN_MODEL, accepted: false, finalCritique: 'Generator returned empty output' };
  }

  const verdict1 = await validateDefinition(word, partsOfSpeech, firstDef);
  if (verdict1.accept) {
    return { definition: firstDef, attempts: 1, model: GEN_MODEL, accepted: true, finalCritique: '' };
  }

  // Sonnet's attempt was rejected — retry with Opus, informed by the critique.
  const retryDef = await regenerateDefinition(word, partsOfSpeech, firstDef, verdict1.violatedRules, verdict1.critique);
  if (!retryDef) {
    return {
      definition: firstDef,
      attempts: 2,
      model: GEN_MODEL,
      accepted: false,
      finalCritique: `Opus retry returned empty output; falling back to Sonnet's attempt. Original critique: ${verdict1.critique}`,
    };
  }

  // Opus chooser picks between Sonnet's original and Opus's correction.
  const choice = await chooseDefinition(word, partsOfSpeech, firstDef, retryDef);
  const winnerDef = choice.winner === 'sonnet' ? firstDef : retryDef;
  const winnerModel = choice.winner === 'sonnet' ? GEN_MODEL : RETRY_MODEL;
  return {
    definition: winnerDef,
    attempts: 2,
    model: winnerModel,
    chooser: choice.winner,
    chooserReason: choice.reason,
    sonnetDef: firstDef,
    opusDef: retryDef,
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
  console.log('🚀 Starting AI-powered longDefinition backfill (generator → validator → opus retry → opus chooser)...\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    // Only process entries that already have partsOfSpeech so long definitions
    // correctly reflect every grammatical role the word can take. Run
    // backfill-parts-of-speech.js first if entries are being skipped here.
    const { rows: entries } = await client.query(`
      SELECT id, word1, "partsOfSpeech"
      FROM dictionaryentries_zh
      WHERE language = 'zh'
        AND discoverable = TRUE
        AND "longDefinition" IS NULL
        AND "partsOfSpeech" IS NOT NULL
        AND jsonb_array_length("partsOfSpeech") > 0
        ${wordsFilter}
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 5' : ''}
    `);

    console.log(`📊 Found ${entries.length} entries needing longDefinition backfill\n`);

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
        process.stdout.write(`  ${row.word1} [${(row.partsOfSpeech ?? []).join(', ')}] ... `);

        const result = await runDefinitionPipeline(row.word1, row.partsOfSpeech ?? []);

        if (!result.definition) {
          console.log(`FAILED: ${result.finalCritique}`);
          failed++;
          continue;
        }

        await client.query(
          `UPDATE dictionaryentries_zh SET "longDefinition" = $1 WHERE id = $2`,
          [result.definition, row.id]
        );

        if (result.attempts === 1) {
          acceptedFirst++;
          console.log(`"${result.definition}"  [sonnet ✓]`);
        } else {
          opusRetries++;
          if (result.chooser === 'sonnet') chooserPickedSonnet++;
          else chooserPickedOpus++;
          console.log(
            `"${result.definition}"  [chooser → ${result.chooser}]  ` +
            `reason: ${result.chooserReason}`
          );
          if (isSpotCheck) {
            console.log(`    sonnet: "${result.sonnetDef}"`);
            console.log(`    opus:   "${result.opusDef}"`);
          }
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
