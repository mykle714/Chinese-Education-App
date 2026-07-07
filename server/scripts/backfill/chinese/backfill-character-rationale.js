/**
 * Backfill Script: AI-powered per-character rationale for dictionaryentries_zh.
 *
 * Replaces the old expansion backfill (backfill-expansion-claude.js). Instead of a
 * single blended phrase per word, this produces a CHARACTER-level explanation: for
 * every character of a multi-char word, a short English learner-facing reason for why
 * that character is there — folding in an implied longer word when it is genuinely
 * illuminating (e.g. 违 → "to violate — short for 违反").
 *
 * Output column: dictionaryentries_zh."characterRationale" (jsonb), migration 102.
 * Shape: array aligned to the word's characters, one object per character:
 *   [ {"char":"违","reason":"to violate — short for 违反"},
 *     {"char":"规","reason":"rules/norms — short for 规矩"} ]
 *
 * Multi-agent pipeline (mirrors the retired expansion script):
 *   1. Generator agent → proposes [{char, reason}] (or [] if the word is opaque)
 *   2. Deterministic check → one entry per character, in the word's exact order
 *   3. Validator agent (only if det. checks pass) → semantic critique
 *   4. On rejection: one retry — regenerator agent informed by violations + critique
 *
 * Sentinel convention: '[]' (empty jsonb array) means "attempted, no worthwhile
 * breakdown." This distinguishes from NULL ("never attempted") so future runs skip
 * already-tried entries. Single-char words are never eligible (nothing to break down).
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-character-rationale.js
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-character-rationale.js --dry-run
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-character-rationale.js --concurrency=8
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-character-rationale.js --words=违规,不知不觉
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog, cachedSystem } from '../run-log.js';
import { parseModelJson } from '../shared/lib/json.js';

const SCRIPT_VERSION = 1; // bump when this script's logic/prompt changes

const DRY_RUN = process.argv.includes('--dry-run');
const STALE = process.argv.includes('--stale'); // also re-process rows stamped below SCRIPT_VERSION
const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '5', 10);

// --words=违规,不知不觉 scopes the run to specific headwords (used by the
// mark-discoverable pipeline). Empty/absent → process every eligible entry.
const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries, staleClause } = initRunLog({ script: 'chinese/backfill-character-rationale', version: SCRIPT_VERSION, anthropic });
// --stale: also re-process rows stamped below the current SCRIPT_VERSION.
const doneGate = STALE ? `("characterRationale" IS NULL OR ${staleClause()})` : '"characterRationale" IS NULL';

const MODEL = 'claude-sonnet-4-6';

// ─────────────────────────────────────────────────────────────────────────────
//  Shared rule text — single source of truth referenced by every prompt
// ─────────────────────────────────────────────────────────────────────────────

const RATIONALE_RULES_TEXT = `You are explaining, character by character, WHY each character is used in a given multi-character Chinese word — what that character contributes to the word's overall meaning.

Hard rules for a valid result (must all hold):
1. Output exactly one entry per character of the word, in the word's original order. Every character (including repeated ones) gets its own entry.
2. Each "reason" is a SHORT English learner-facing gloss (a phrase, not a sentence) of what that character means or does in THIS word — not a general dictionary dump of every meaning the character can have.
3. When a single character is a terse stand-in for a fuller everyday word, cite that longer word to make the structure transparent — append it as "— short for 规矩" (Chinese word only, no pinyin). Only do this when the longer word genuinely illuminates the character's role; do NOT invent or force one.

Goal (preferred but not strictly required): the reasons together should reveal why the word is built the way it is — insight a learner couldn't get from the whole-word definition alone. Prefer results that achieve this, but modest insight is acceptable.

Return an empty array [] (meaning "no worthwhile breakdown") when:
  - The word is a phonetic transliteration whose characters carry no meaning (e.g. 咖啡, 沙发, 巧克力)
  - A proper noun / brand where per-character meaning is not illuminating
  - The characters cannot be meaningfully separated (a lexicalized whole where per-character glosses would mislead)

Do NOT return [] merely because the word is common — 吃饭, 喝水 still have a clean per-character breakdown (吃 "to eat", 饭 "rice/meal — short for 米饭").

Good examples:
  * 违规 → [{"char":"违","reason":"to violate — short for 违反"},{"char":"规","reason":"rules/norms — short for 规矩"}]
  * 不知不觉 → [{"char":"不","reason":"not"},{"char":"知","reason":"to know — short for 知道"},{"char":"不","reason":"not"},{"char":"觉","reason":"to sense/feel — short for 觉得"}]
  * 早晚 → [{"char":"早","reason":"morning — short for 早上"},{"char":"晚","reason":"evening — short for 晚上"}]
  * 客厅 → [{"char":"客","reason":"guest — short for 客人"},{"char":"厅","reason":"hall — short for 厅堂"}]

Empty examples: 咖啡, 沙发, 巧克力 → []`;

// Maps deterministic check failures to validator-style violation codes,
// so the regenerator gets a uniform vocabulary regardless of which layer rejected.
const DETERMINISTIC_RULE_LABELS = {
  not_array: 'Result was not a JSON array.',
  wrong_length: 'The array did not have exactly one entry per character of the word.',
  char_mismatch: "The entries' `char` values did not match the word's characters in order.",
  missing_reason: 'At least one entry had an empty or non-string `reason`.',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Deterministic post-processing checks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate the structural contract of a rationale array against the word.
 * An empty array is a legal "no worthwhile breakdown" sentinel and always passes.
 * Returns { ok: bool, violations: string[] } — violation codes from DETERMINISTIC_RULE_LABELS.
 */
function deterministicCheck(word, rationale) {
  if (!Array.isArray(rationale)) return { ok: false, violations: ['not_array'] };
  if (rationale.length === 0) return { ok: true, violations: [] }; // legal sentinel

  const chars = [...word];
  const violations = [];

  if (rationale.length !== chars.length) violations.push('wrong_length');

  // Compare char-by-char up to the shorter length; a length mismatch already flagged above
  const n = Math.min(rationale.length, chars.length);
  let charOk = true;
  let reasonOk = true;
  for (let i = 0; i < n; i++) {
    const entry = rationale[i];
    if (!entry || entry.char !== chars[i]) charOk = false;
    if (!entry || typeof entry.reason !== 'string' || entry.reason.trim().length === 0) reasonOk = false;
  }
  if (!charOk) violations.push('char_mismatch');
  if (!reasonOk) violations.push('missing_reason');

  return { ok: violations.length === 0, violations };
}

/** Normalize an accepted rationale to just {char, reason} with trimmed reasons. */
function normalizeRationale(rationale) {
  return rationale.map(e => ({ char: e.char, reason: String(e.reason).trim() }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 1: initial rationale generator
// ─────────────────────────────────────────────────────────────────────────────

// Static prompt (persona + task + rules + response format) → cached system
// block; only the word varies per call. See cachedSystem in run-log.js.
const GENERATOR_SYSTEM = `You are a Chinese language expert. Respond only with valid JSON — no explanations, no reasoning, no extra text.

${RATIONALE_RULES_TEXT}

Respond with ONLY a JSON object whose "rationale" is the array:
{"rationale": [{"char": "…", "reason": "…"}, …]}
or, for no worthwhile breakdown:
{"rationale": []}`;

async function generateRationale(word) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    temperature: 0.3,
    system: cachedSystem(GENERATOR_SYSTEM),
    messages: [{ role: 'user', content: `Word: ${word}` }],
  });

  const parsed = parseModelJson(response.content[0].text);
  if (!parsed) return null;
  return Array.isArray(parsed.rationale) ? parsed.rationale : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 2: semantic validator
//  Returns { accept: bool, violatedRules: string[], critique: string }
// ─────────────────────────────────────────────────────────────────────────────

// Static reviewer scaffold → cached system block; per-entry word/rationale → user message.
const VALIDATOR_SYSTEM = `You are a strict reviewer of per-character rationales for Chinese words. You enforce semantic accuracy. Respond only with valid JSON.

A per-character rationale has been proposed for a Chinese word. Judge whether each character's reason is ACCURATE for its role in this specific word and whether any cited "short for" longer word is correct and genuinely illuminating. The "insight" goal is preferred but not required — do not reject solely because the insight is modest.

${RATIONALE_RULES_TEXT}

Use these violation codes when the rationale fails:
  - "inaccurate_reason": at least one character's reason is wrong for its role in this word
  - "wrong_implied_word": a cited "short for" longer word is incorrect or does not contain that character
  - "over_glossed": a reason dumps unrelated dictionary senses instead of the meaning used in this word
  - "should_be_empty": the word is a transliteration / opaque whole and should have returned []
  - "should_not_be_empty": the word has a clean per-character breakdown but [] was returned

Respond with ONLY:
{"accept": true}
or
{"accept": false, "violatedRules": ["code1"], "critique": "1-2 sentence explanation of what is wrong and how to fix it"}`;

async function validatorAgent(word, rationale) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    temperature: 0.1,
    system: cachedSystem(VALIDATOR_SYSTEM),
    messages: [{
      role: 'user',
      content: `Word: ${word}\nProposed rationale: ${JSON.stringify(rationale)}`,
    }],
  });

  const parsed = parseModelJson(response.content[0].text);
  if (!parsed) {
    // If validator response is unparseable, fail closed (treat as reject) so the retry path runs
    return { accept: false, violatedRules: ['unparseable_validator_response'], critique: 'Validator response could not be parsed.' };
  }
  if (parsed.accept === true) return { accept: true, violatedRules: [], critique: '' };
  return {
    accept: false,
    violatedRules: Array.isArray(parsed.violatedRules) ? parsed.violatedRules : [],
    critique: typeof parsed.critique === 'string' ? parsed.critique : '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 3: regenerator — correction-task prompt informed by prior failure
// ─────────────────────────────────────────────────────────────────────────────

// Static corrector scaffold → cached system block; the per-attempt failure details go in the user message.
const REGENERATOR_SYSTEM = `You are a Chinese language expert correcting a previous flawed per-character rationale. Respond only with valid JSON.

Your previous attempt was rejected. Produce a new rationale that addresses the specific issues given.

${RATIONALE_RULES_TEXT}

Take the feedback seriously. If the word genuinely has no worthwhile per-character breakdown, return {"rationale": []} rather than forcing meanings.

Respond with ONLY:
{"rationale": [{"char": "…", "reason": "…"}, …]}
or
{"rationale": []}`;

async function regenerateRationale(word, priorAttempt, violations, critique) {
  const violationLines = violations
    .map(v => `  - ${v}: ${DETERMINISTIC_RULE_LABELS[v] ?? v}`)
    .join('\n');

  const critiqueBlock = critique ? `\nCritique from reviewer:\n${critique}\n` : '';

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    temperature: 0.5,
    system: cachedSystem(REGENERATOR_SYSTEM),
    messages: [{
      role: 'user',
      content: `Original word: ${word}
Previous attempt: ${priorAttempt ? JSON.stringify(priorAttempt) : '(none)'}
Violated rules:
${violationLines || '  (none)'}
${critiqueBlock}`,
    }],
  });

  const parsed = parseModelJson(response.content[0].text);
  if (!parsed) return null;
  return Array.isArray(parsed.rationale) ? parsed.rationale : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Orchestrator: generator → det check → validator → (retry once) → accept|sentinel
//  Returns { rationale: Array|[], attempts: 1|2, finalViolations: string[] }
//  A returned [] means the sentinel ("attempted, no worthwhile breakdown").
// ─────────────────────────────────────────────────────────────────────────────

async function runRationalePipeline(word) {
  let attempts = 0;
  let candidate = null;
  let priorViolations = [];
  let priorCritique = '';

  for (let pass = 0; pass < 2; pass++) {
    attempts++;
    candidate = pass === 0
      ? await generateRationale(word)
      : await regenerateRationale(word, candidate, priorViolations, priorCritique);

    // Unparseable / non-array response — retry if we have a pass left, else sentinel
    if (!Array.isArray(candidate)) {
      priorViolations = ['not_array'];
      priorCritique = '';
      continue;
    }

    // Model deliberately returned [] — accept the sentinel immediately
    if (candidate.length === 0) {
      return { rationale: [], attempts, finalViolations: [] };
    }

    const det = deterministicCheck(word, candidate);
    if (!det.ok) {
      // Skip the validator entirely on structural failure — feed violations directly to retry
      priorViolations = det.violations;
      priorCritique = '';
      continue;
    }

    // Det passed — run semantic validator
    const verdict = await validatorAgent(word, candidate);
    if (verdict.accept) {
      return { rationale: normalizeRationale(candidate), attempts, finalViolations: [] };
    }
    priorViolations = verdict.violatedRules;
    priorCritique = verdict.critique;
  }

  // Both attempts rejected — fall through to the empty-array sentinel
  return { rationale: [], attempts, finalViolations: priorViolations };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Per-entry processor
// ─────────────────────────────────────────────────────────────────────────────

async function processEntry(row, client, stats) {
  try {
    process.stdout.write(`  ${row.word1} ... `);
    const { rationale, attempts, finalViolations } = await runRationalePipeline(row.word1);

    if (rationale.length === 0) {
      process.stdout.write(`— [] after ${attempts} attempt(s) [${finalViolations.join(',') || 'no_breakdown'}]\n`);
      stats.emptySentinel++;
    } else {
      const display = rationale.map(e => `${e.char}=${e.reason}`).join(' | ');
      const acceptedTag = attempts === 1 ? 'accepted-1st' : 'accepted-retry';
      if (attempts === 1) stats.firstAttemptAccepted++;
      else stats.retryAccepted++;
      process.stdout.write(`[${acceptedTag}] ${display}\n`);
    }

    if (!DRY_RUN) {
      await client.query(
        `UPDATE dictionaryentries_zh SET "characterRationale" = $1::jsonb WHERE id = $2`,
        [JSON.stringify(rationale), row.id]
      );
      await stampEntries(client, 'dictionaryentries_zh', row.id);
    }
  } catch (err) {
    process.stdout.write(`  ❌ ${row.word1} → ERROR: ${err.message}\n`);
    stats.failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`Starting Claude character-rationale backfill... ${DRY_RUN ? '(DRY RUN)' : ''}`);
  console.log(`Concurrency: ${CONCURRENCY}\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    // Only multi-char words are eligible — a single character has nothing to break down.
    const { rows: entries } = await client.query(`
      SELECT id, word1
      FROM dictionaryentries_zh
      WHERE language = 'zh'
        AND discoverable = TRUE
        AND char_length(word1) > 1
        AND ${doneGate}
        ${wordsFilter}
      ORDER BY char_length(word1), word1
    `);

    console.log(`Found ${entries.length} entries to process\n`);

    const stats = {
      firstAttemptAccepted: 0,
      retryAccepted: 0,
      emptySentinel: 0,
      failed: 0,
    };

    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const batch = entries.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(row => processEntry(row, client, stats)));
      if (i + CONCURRENCY < entries.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('BACKFILL SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total processed         : ${entries.length}`);
    console.log(`Accepted on 1st pass    : ${stats.firstAttemptAccepted}`);
    console.log(`Accepted on retry       : ${stats.retryAccepted}`);
    console.log(`Empty sentinel ([])     : ${stats.emptySentinel}`);
    console.log(`Errors                  : ${stats.failed}`);
    if (DRY_RUN) console.log('\n(DRY RUN — no changes written)');
    console.log('='.repeat(60));

  } finally {
    client.release();
    await db.pool.end();
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
