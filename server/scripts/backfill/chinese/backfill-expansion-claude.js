/**
 * Backfill Script: AI-powered expansion + literal translation for dictionaryentries_zh.
 *
 * Multi-agent pipeline:
 *   1. Generator agent → proposes an expansion
 *   2. Deterministic checks (validateExpansion) → mechanical rules (char-order, length, etc.)
 *   3. Validator agent (only if det. checks pass) → semantic critique
 *   4. On rejection: one retry — regenerator agent informed by violations + critique
 *   5. Once accepted: GSA segments the expansion + det.definition arrays are looked up
 *   6. Literal-translation agent receives expansion + segments + per-segment defs and
 *      composes a short colloquial English phrase (no full sentences)
 *
 * Sentinel convention: '' (empty string) means "attempted, no valid expansion."
 * This distinguishes from NULL ("never attempted") so future runs skip already-tried entries.
 *
 * The script handles two modes automatically:
 *   - Full enrichment: entry has expansion IS NULL → run full pipeline (expansion + literal)
 *   - Literal-only:   entry has expansion but missing literal → only literal-translation agent
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill-expansion-claude.js
 *   docker exec cow-backend-local npx tsx scripts/backfill-expansion-claude.js --dry-run
 *   docker exec cow-backend-local npx tsx scripts/backfill-expansion-claude.js --concurrency=8
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import {
  getAllSubstrings,
  buildDictMap,
  buildExcludeSet,
  segmentWithDict,
} from '../../../dal/shared/segmentString.js';
import { initRunLog, cachedSystem } from '../run-log.js';
import { parseModelJson } from '../shared/lib/json.js';
const SCRIPT_VERSION = 2; // bump when this script's logic/prompt changes (v2: cached system blocks for all four agents)

const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '5', 10);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries } = initRunLog({ script: 'chinese/backfill-expansion-claude', version: SCRIPT_VERSION, anthropic: anthropic });

const MODEL = 'claude-sonnet-4-6';

// ─────────────────────────────────────────────────────────────────────────────
//  Shared rule text — single source of truth referenced by every prompt
// ─────────────────────────────────────────────────────────────────────────────

const EXPANSION_RULES_TEXT = `Hard rules for a valid expansion (must all hold):
1. Every character from the original word must appear in the expansion, in their original order. You may add characters before, between, or after the originals — but never replace or omit any. It is fine for some original characters to be left unexpanded; e.g. for original "AB", an expansion like "ABb" (where lowercase letters represent newly added characters) is acceptable.
2. The expansion must use natural, everyday Mandarin that a native speaker would actually say.
3. Every added chunk must meaningfully expand a morpheme into a more common everyday word (e.g. 规 → 规矩, 知 → 知道, 早 → 早上). Filler characters that don't illuminate a morpheme are not allowed.

Goal (preferred but not strictly required): The expansion should reveal insight a learner couldn't get from seeing the original alone — it should make the word's internal structure transparent. Prefer expansions that achieve this, but do not reject solely on the basis that the insight is modest.

Form: A short phrase is preferred. A full sentence is acceptable ONLY if the original word is genuinely so short that a phrase wouldn't read naturally — and even then, every added character must still meaningfully expand a morpheme (rule 3). Do NOT pad with sentence scaffolding that fails rule 3.

Rejection cases (return null):
  - The word is already maximally vernacular (e.g. 吃饭, 喝水, 走路, 睡觉)
  - The expansion would be circular or tautological (e.g. 学生 → 学习的学生)
  - The expansion only appends a weak suffix or classifier (e.g. 太极拳 → 太极拳法, 母亲节 → 母亲节日)
  - The expansion only reduplicates characters (e.g. 干净 → 干干净净)
  - The expansion only adds grammatical particles without illuminating a morpheme (e.g. 游泳 → 游着泳)
  - The expansion just appends a synonym of the whole word (e.g. 重要 → 重要紧要)
  - No natural-sounding expansion exists that meaningfully explains the structure

Good examples:
  * 违规 → 违反规矩
  * 不知不觉 → 不知道不觉得
  * 早晚 → 早上晚上
  * 规则 → 规矩法则
  * 客厅 → 客人厅堂

Null examples: 吃饭, 学生, 干净, 重要, 今天, 网络, 感冒`;

// Maps deterministic check failures to validator-style violation codes,
// so the regenerator gets a uniform vocabulary regardless of which layer rejected.
const DETERMINISTIC_RULE_LABELS = {
  not_string: 'Result was not a string.',
  too_short: 'Expansion was not longer than the original word.',
  identical: 'Expansion was identical to the original word.',
  reduplication: 'Expansion reduplicated an original character (e.g. 干 → 干干净净).',
  char_order: 'Original characters did not all appear in the expansion in their original order.',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Deterministic post-processing checks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns { ok: bool, violations: string[] } — violations are codes from DETERMINISTIC_RULE_LABELS.
 */
function deterministicCheck(original, expansion) {
  const violations = [];

  if (!expansion || typeof expansion !== 'string') {
    return { ok: false, violations: ['not_string'] };
  }
  if (expansion.length <= original.length) violations.push('too_short');
  if (expansion === original) violations.push('identical');

  for (const char of original) {
    if (expansion.includes(char + char)) {
      violations.push('reduplication');
      break;
    }
  }

  let pos = 0;
  let orderOk = true;
  for (const char of original) {
    const idx = expansion.indexOf(char, pos);
    if (idx === -1) { orderOk = false; break; }
    pos = idx + 1;
  }
  if (!orderOk) violations.push('char_order');

  return { ok: violations.length === 0, violations };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 1: initial expansion generator
// ─────────────────────────────────────────────────────────────────────────────

// Static prompt (persona + task + rules + response format) → cached system
// block; only the word varies per call. See cachedSystem in run-log.js.
const GENERATOR_SYSTEM = `You are a Chinese language expert. Respond only with valid JSON — no explanations, no reasoning, no extra text.

Your task is to expand a Chinese word into a more vernacular phrase that reveals *why the word is constructed the way it is* — what each morpheme means in everyday speech.

${EXPANSION_RULES_TEXT}

Respond with ONLY a JSON object:
{"expansion": "expanded form"}
or
{"expansion": null}`;

async function generateExpansion(word) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    temperature: 0.3,
    system: cachedSystem(GENERATOR_SYSTEM),
    messages: [{ role: 'user', content: `Word: ${word}` }],
  });

  const parsed = parseModelJson(response.content[0].text);
  if (!parsed) return null;
  return typeof parsed.expansion === 'string' ? parsed.expansion : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 2: semantic validator
//  Returns { accept: bool, violatedRules: string[], critique: string }
// ─────────────────────────────────────────────────────────────────────────────

// Static reviewer scaffold (persona + rules + violation codes + response
// format) → cached system block; per-entry word/expansion → user message.
const VALIDATOR_SYSTEM = `You are a strict reviewer of Chinese word expansions. You enforce semantic rules. Respond only with valid JSON.

An expansion has been proposed for a Chinese word. Judge whether it satisfies the hard rules. The "insight" goal is preferred but not required — do not reject solely because the insight is modest. Sentence form is also not by itself a reason to reject; reject only if the sentence scaffolding includes characters that don't meaningfully expand a morpheme (rule 3).

${EXPANSION_RULES_TEXT}

Use these violation codes when the expansion fails:
  - "weak_suffix": only appends a weak suffix or classifier
  - "reduplication_only": only reduplicates characters
  - "circular": circular or tautological — re-uses the original word inside the expansion
  - "synonym_append": only appends a synonym of the whole word
  - "particle_only": only adds grammatical particles or filler that doesn't expand a morpheme
  - "no_morpheme_expansion": at least one added chunk doesn't meaningfully expand a morpheme (rule 3 violation)
  - "unnatural_phrasing": doesn't sound like something a native would naturally say
  - "already_vernacular": the original word is already maximally vernacular

Respond with ONLY:
{"accept": true}
or
{"accept": false, "violatedRules": ["code1", "code2"], "critique": "1-2 sentence explanation of why this fails and what would make it better"}`;

async function validatorAgent(word, expansion) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    temperature: 0.1,
    system: cachedSystem(VALIDATOR_SYSTEM),
    messages: [{
      role: 'user',
      content: `Word: ${word}\nProposed expansion: ${expansion}`,
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

// Static corrector scaffold (persona + task + rules + response format) →
// cached system block; the per-attempt failure details go in the user message.
const REGENERATOR_SYSTEM = `You are a Chinese language expert correcting a previous flawed expansion attempt. Respond only with valid JSON.

Your previous attempt to expand a Chinese word was rejected. Produce a new expansion that addresses the specific issues given.

${EXPANSION_RULES_TEXT}

Take the feedback seriously. If no valid expansion can be crafted that satisfies all rules, return null rather than producing another flawed attempt.

Respond with ONLY:
{"expansion": "corrected expansion"}
or
{"expansion": null}`;

async function regenerateExpansion(word, priorAttempt, violations, critique) {
  const violationLines = violations
    .map(v => `  - ${v}: ${DETERMINISTIC_RULE_LABELS[v] ?? v}`)
    .join('\n');

  const critiqueBlock = critique
    ? `\nCritique from reviewer:\n${critique}\n`
    : '';

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    temperature: 0.5,
    system: cachedSystem(REGENERATOR_SYSTEM),
    messages: [{
      role: 'user',
      content: `Original word: ${word}
Previous attempt: ${priorAttempt ?? '(none)'}
Violated rules:
${violationLines || '  (none)'}
${critiqueBlock}`,
    }],
  });

  const parsed = parseModelJson(response.content[0].text);
  if (!parsed) return null;
  return typeof parsed.expansion === 'string' ? parsed.expansion : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Orchestrator: generator → det check → validator → (retry once) → accept|sentinel
//  Returns { expansion: string|null, attempts: 1|2, finalViolations: string[] }
// ─────────────────────────────────────────────────────────────────────────────

async function runExpansionPipeline(word) {
  let attempts = 0;
  let candidate = null;
  let priorViolations = [];
  let priorCritique = '';

  for (let pass = 0; pass < 2; pass++) {
    attempts++;
    candidate = pass === 0
      ? await generateExpansion(word)
      : await regenerateExpansion(word, candidate, priorViolations, priorCritique);

    // Generator chose null — give up immediately (model has signaled no valid expansion exists)
    if (!candidate) {
      return { expansion: null, attempts, finalViolations: ['generator_returned_null'] };
    }

    const det = deterministicCheck(word, candidate);
    if (!det.ok) {
      // Skip the validator entirely on mechanical failure — feed violations directly to retry
      priorViolations = det.violations;
      priorCritique = '';
      continue;
    }

    // Det passed — run semantic validator
    const verdict = await validatorAgent(word, candidate);
    if (verdict.accept) {
      return { expansion: candidate, attempts, finalViolations: [] };
    }
    priorViolations = verdict.violatedRules;
    priorCritique = verdict.critique;
  }

  // Both attempts rejected — fall through to sentinel
  return { expansion: null, attempts, finalViolations: priorViolations };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Segment the accepted expansion + look up det.definition arrays
//  Returns Array<{ segment: string, definitions: string[] }>
// ─────────────────────────────────────────────────────────────────────────────

async function segmentAndFetchDefinitions(client, expansion) {
  const candidates = getAllSubstrings(expansion.trim());
  if (candidates.length === 0) return [];

  // Fetch all dict entries that match any substring of the expansion
  const { rows } = await client.query(
    `SELECT word1, pronunciation, definitions, "vernacularScore", "matchException",
            "exampleSentenceDefinitionPronunciationOverride"
     FROM dictionaryentries_zh
     WHERE language = 'zh' AND word1 = ANY($1::text[])`,
    [candidates]
  );

  // Adapt rows into the shape buildDictMap expects (DictionaryEntry-like)
  const dictEntries = rows.map(r => ({
    word1: r.word1,
    pronunciation: r.pronunciation || '',
    definitions: Array.isArray(r.definitions) ? r.definitions : [r.definitions],
    vernacularScore: r.vernacularScore ?? null,
    matchException: r.matchException ?? [],
    exampleSentenceDefinitionPronunciationOverride: r.exampleSentenceDefinitionPronunciationOverride ?? null,
  }));

  const dictMap = buildDictMap(dictEntries);
  const excludeTokens = buildExcludeSet(dictEntries);
  const segments = segmentWithDict(expansion, dictMap, excludeTokens);

  return segments.map(seg => {
    const meta = dictMap.get(seg);
    return {
      segment: seg,
      definitions: meta?.definitions ?? [],
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 4: literal-translation generator
//  Receives expansion + segments + per-segment def arrays, picks best gloss per
//  segment, composes a short colloquial English phrase.
// ─────────────────────────────────────────────────────────────────────────────

// Static gloss-composer scaffold (persona + task + output rules + examples +
// response format) → cached system block; word/expansion/segments → user message.
const LITERAL_SYSTEM = `You are a Chinese language expert producing literal English glosses. Respond only with valid JSON.

A Chinese word has been expanded to a more vernacular phrase. For each segment of the expansion, dictionary glosses are provided. For each segment, pick the gloss that best fits the meaning of the expansion in context, then weave the chosen glosses into a short colloquial English phrase or concept that captures how the expansion explains the word.

Output rules:
  - Output a short phrase or concept, NOT a full sentence
  - Use natural English words (avoid hyphenated dictionary tokens unless needed for compactness)
  - The phrase should read as a colloquial gloss of the expansion's structure, not as a translation of the original word's meaning
  - If the segments don't compose into anything coherent as a short phrase, return null

Examples:
  * 违规, expansion 违反规矩, segments 违反 + 规矩 → "breaking the rules"
  * 不知不觉, expansion 不知道不觉得, segments 不 + 知道 + 不 + 觉得 → "without knowing or feeling it"
  * 早晚, expansion 早上晚上, segments 早上 + 晚上 → "morning and evening"
  * 客厅, expansion 客人厅堂, segments 客人 + 厅堂 → "guest hall"

Respond with ONLY:
{"expansionLiteralTranslation": "short colloquial phrase"}
or
{"expansionLiteralTranslation": null}`;

async function generateLiteralTranslation(word, expansion, segmentsWithDefs) {
  const segmentLines = segmentsWithDefs.map(({ segment, definitions }) => {
    if (definitions.length === 0) {
      return `  - ${segment}: (no dictionary entry — use your own knowledge)`;
    }
    const defList = definitions.map(d => `      • ${d}`).join('\n');
    return `  - ${segment}:\n${defList}`;
  }).join('\n');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    temperature: 0.3,
    system: cachedSystem(LITERAL_SYSTEM),
    messages: [{
      role: 'user',
      content: `The Chinese word "${word}" has been expanded to "${expansion}".

Segments and their dictionary definitions:
${segmentLines}`,
    }],
  });

  const parsed = parseModelJson(response.content[0].text);
  if (!parsed) return null;
  return typeof parsed.expansionLiteralTranslation === 'string'
    ? parsed.expansionLiteralTranslation
    : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Per-entry processor
// ─────────────────────────────────────────────────────────────────────────────

async function processEntry(row, client, stats) {
  const hasExpansion = typeof row.expansion === 'string' && row.expansion !== '';

  try {
    if (hasExpansion) {
      // Branch B: expansion already exists, only need literal translation
      process.stdout.write(`  ${row.word1} [literal only] ... `);
      const segmentsWithDefs = await segmentAndFetchDefinitions(client, row.expansion);
      const literal = await generateLiteralTranslation(row.word1, row.expansion, segmentsWithDefs);
      process.stdout.write(`${literal ?? 'null'}\n`);
      stats.literalOnly++;

      if (!DRY_RUN) {
        await client.query(
          `UPDATE dictionaryentries_zh SET "expansionLiteralTranslation" = $1 WHERE id = $2`,
          [literal, row.id]
        );
        await stampEntries(client, 'dictionaryentries_zh', row.id);
      }
      return;
    }

    // Branch A: full pipeline (expansion + literal)
    process.stdout.write(`  ${row.word1} ... `);
    const { expansion, attempts, finalViolations } = await runExpansionPipeline(row.word1);

    if (!expansion) {
      process.stdout.write(`— null after ${attempts} attempt(s) [${finalViolations.join(',') || 'no_valid_expansion'}]\n`);
      stats.bothRejected++;
      if (!DRY_RUN) {
        await client.query(
          `UPDATE dictionaryentries_zh SET expansion = '', "expansionLiteralTranslation" = NULL WHERE id = $1`,
          [row.id]
        );
        await stampEntries(client, 'dictionaryentries_zh', row.id);
      }
      return;
    }

    // Expansion accepted — run segmentation + literal translation
    const acceptedTag = attempts === 1 ? 'accepted-1st' : 'accepted-retry';
    if (attempts === 1) stats.firstAttemptAccepted++;
    else stats.retryAccepted++;

    const segmentsWithDefs = await segmentAndFetchDefinitions(client, expansion);
    const segDisplay = segmentsWithDefs.map(s => s.segment).join('|');
    const literal = await generateLiteralTranslation(row.word1, expansion, segmentsWithDefs);

    process.stdout.write(`${expansion} [${acceptedTag}] segs=${segDisplay} → ${literal ?? 'no literal'}\n`);

    if (!DRY_RUN) {
      await client.query(
        `UPDATE dictionaryentries_zh SET expansion = $1, "expansionLiteralTranslation" = $2 WHERE id = $3`,
        [expansion, literal, row.id]
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
  console.log(`Starting Claude expansion backfill... ${DRY_RUN ? '(DRY RUN)' : ''}`);
  console.log(`Concurrency: ${CONCURRENCY}\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(`
      SELECT id, word1, pronunciation, expansion, "expansionLiteralTranslation"
      FROM dictionaryentries_zh
      WHERE language = 'zh'
        AND discoverable = TRUE
        AND (
          expansion IS NULL                                                -- never attempted
          OR (expansion != '' AND "expansionLiteralTranslation" IS NULL)  -- has expansion, needs literal
        )
      ORDER BY char_length(word1), word1
    `);

    console.log(`Found ${entries.length} entries to process\n`);

    const stats = {
      firstAttemptAccepted: 0,
      retryAccepted: 0,
      bothRejected: 0,
      literalOnly: 0,
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
    console.log(`Total processed       : ${entries.length}`);
    console.log(`Accepted on 1st pass  : ${stats.firstAttemptAccepted}`);
    console.log(`Accepted on retry     : ${stats.retryAccepted}`);
    console.log(`Both rejected (sentinel): ${stats.bothRejected}`);
    console.log(`Literal only          : ${stats.literalOnly}`);
    console.log(`Errors                : ${stats.failed}`);
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
