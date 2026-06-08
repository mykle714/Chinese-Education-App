/**
 * Backfill Script: AI-powered longDefinition for dictionaryentries_es (SPANISH)
 *
 * Spanish counterpart of backfill/chinese/backfill-long-definitions.js. Writes the
 * AI-generated English definition *elaboration* into longDefinition. NOTE: on the
 * Spanish table, Wiktionary etymology was moved to its own `etymology` column
 * (migration 59), so longDefinition starts NULL and is owned by this script.
 *
 * Pipeline:
 *   1. Generator agent (Sonnet) — writes a per-POS definition OBJECT { "<pos>": "..." }.
 *   2. Validator agent (Sonnet) — checks all hard constraints; may reject with a critique.
 *   3. Regenerator agent (Opus) — on rejection, retries once informed by the validator critique.
 *   4. Chooser agent (Opus) — picks the better definition object between Sonnet's and Opus's attempts.
 *
 * Only processes entries where partsOfSpeech is already populated so definitions
 * accurately reflect every grammatical role. For Spanish, partsOfSpeech is set by
 * the importer (import-esdict-temp.ts) from the Wiktionary POS tags — no separate
 * es parts-of-speech backfill is needed.
 *
 * OUTPUT SHAPE: a JSON OBJECT keyed by part of speech — one definition per POS
 * (e.g. { "noun": "...", "verb": "..." }). Single-POS words emit a one-key object.
 * Stored verbatim in the JSONB `longDefinition` column (migration 70) and joined back
 * into a labeled "pos: ... \n\n pos: ..." string at the read boundary
 * (longDefObjectToDisplayString) for the API/renderer.
 *
 * LENGTH is per POS value: each definition value must be MIN_LEN..MAX_LEN_PER_POS
 * (25–125) chars, independent of how many POS the word has. A final enforceMaxLen step
 * (Opus tightener) guarantees every value respects the budget.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-long-definitions.js              # full backfill
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-long-definitions.js --spot-check # test 5 entries
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-long-definitions.js --words=correr,banco
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog } from '../run-log.js';
const SCRIPT_VERSION = 2; // bump when this script's logic/prompt changes

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries } = initRunLog({ script: 'spanish/backfill-long-definitions', version: SCRIPT_VERSION, anthropic: anthropic });
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
//  Length budget + object-shape helpers (mirrors chinese/backfill-long-definitions.js)
//  A definition is a plain object keyed by POS: { "<pos>": "<text>", ... }. The budget
//  is PER POS VALUE — each sense gets its own independent definition and budget.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_LEN = 25;
const MAX_LEN_PER_POS = 125;

// String values of a definition object (defensive against non-string entries).
function defValues(def) {
  return def && typeof def === 'object' && !Array.isArray(def)
    ? Object.values(def).filter(v => typeof v === 'string')
    : [];
}

// POS keys whose value exceeds the per-POS ceiling.
function overBudgetKeys(def) {
  return Object.entries(def || {})
    .filter(([, v]) => typeof v === 'string' && v.length > MAX_LEN_PER_POS)
    .map(([k]) => k);
}

// Every value within [MIN_LEN, MAX_LEN_PER_POS]; used by enforceMaxLen.
function defWithinBudget(def) {
  const vals = defValues(def);
  return vals.length > 0 && vals.every(v => v.length >= MIN_LEN && v.length <= MAX_LEN_PER_POS);
}

// Longest value length — surfaced in spot-check tags so an over-budget value is visible.
function maxValueLen(def) {
  const vals = defValues(def);
  return vals.length ? Math.max(...vals.map(v => v.length)) : 0;
}

// Compact, length-annotated rendering of an object for inclusion in agent prompts.
function annotateDefForPrompt(def) {
  return Object.entries(def || {})
    .map(([pos, v]) => `  "${pos}" (${typeof v === 'string' ? v.length : 0} chars): "${v}"`)
    .join('\n');
}

// Human-readable one-liner for console/spot-check logging.
function defToLogString(def) {
  return Object.entries(def || {})
    .map(([pos, v]) => `${pos}: ${v}`)
    .join('  |  ');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Shared rule text — injected into generator, validator, regenerator, chooser,
//  and tightener prompts so all agents judge by the exact same criteria.
// ─────────────────────────────────────────────────────────────────────────────

const DEFINITION_RULES_TEXT = `
Output shape — a JSON object keyed by part of speech:
- Write ONE definition per part of speech, as a JSON object whose KEYS are the parts of speech (exactly
  as given) and whose VALUES are that POS's definition string, ordered primary POS first, e.g.:
      {"noun": "<nuance for the noun sense>", "verb": "<nuance for the verb sense>"}
- If the word has only ONE part of speech, still emit a one-key object, e.g. {"noun": "..."}.
- Each VALUE is an independent definition for that single sense — do NOT label it with the POS inside the
  string, and do NOT cram other senses into it.

Hard constraints — all must be satisfied:

1. LENGTH — EACH value must be between ${MIN_LEN} and ${MAX_LEN_PER_POS} characters (inclusive). This
   budget is PER POS value, not a shared total. Count each value precisely and never exceed
   ${MAX_LEN_PER_POS} for any one value.
2. ENGLISH ONLY — Pure ASCII output only. Each value must be in English; Spanish-language text, accented/special characters (á, é, í, ó, ú, ñ, ü, ¿, ¡, etc.), and all non-ASCII letters are forbidden.
3. NO CONTRASTIVE CONSTRUCTIONS — Do not use "rather than", "instead of", "as opposed to", "not just X but Y", or "X, not Y" framings. Describe what the word means directly.
4. NO SELF-REFERENCE — Do not repeat the target Spanish word itself or any literal gloss of it in quotes.
5. POS COVERAGE & FORMAT — The object must contain exactly one key per part of speech given (cover every POS), keyed and ordered as specified above. Do not omit a POS, invent extra POS, or merge senses.

Quality goals (address whichever are most relevant):
- Dispel common misconceptions or mistranslations
- Clarify how this word differs from similar or easily confused concepts
`;

const VIOLATION_CODE_LABELS = {
  too_short: `One or more POS values is under ${MIN_LEN} characters (rule 1)`,
  too_long: `One or more POS values exceeds the ${MAX_LEN_PER_POS}-character per-POS budget (rule 1)`,
  contains_non_english: 'Contains Spanish-language text, accented characters, or non-ASCII letters (rule 2)',
  contrastive_construction: 'Uses a forbidden contrastive phrase such as "rather than" or "instead of" (rule 3)',
  self_reference: 'Repeats the target word or its transliteration (rule 4)',
  poor_pos_coverage: 'Object does not contain exactly one key per part of speech (missing/extra POS, or wrong object shape) (rule 5)',
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

// Parse an agent response into a normalized definition object keyed by the expected
// POS (in posList order). Tolerates markdown fences / extra prose around the JSON.
// Keeps only string values for the expected POS; trims them. Returns null if no
// expected POS has a non-empty value.
function parseDefObject(responseText, posList) {
  const raw = parseJsonFromResponse(responseText);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const pos of posList) {
    const v = raw[pos];
    if (typeof v === 'string' && v.trim().length > 0) out[pos] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 1: generator (Sonnet) — emits the per-POS definition OBJECT
// ─────────────────────────────────────────────────────────────────────────────

async function generateDefinition(word, partsOfSpeech, model = GEN_MODEL) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];
  const posLine = posList.length > 0 ? `Parts of speech: ${posList.join(', ')}` : '';

  const prompt = `You are a Spanish language expert writing concise English definitions for a learner dictionary.

Word: ${word}
${posLine}

${DEFINITION_RULES_TEXT}

Respond with ONLY the JSON object (keys = the parts of speech above, values = each definition) — no markdown fences, no extra prose.`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 600,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  return parseDefObject(response.content[0].text, posList);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 2: validator (Sonnet)
//  Returns { accept, violatedRules: string[], critique }
// ─────────────────────────────────────────────────────────────────────────────

async function validateDefinition(word, partsOfSpeech, proposed) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];

  const prompt = `You are a strict reviewer checking a per-POS English definition object for a Spanish word. Apply every constraint formally — do not approve if any rule is violated, including for any single POS value.

${DEFINITION_RULES_TEXT}

Word: ${word}
Parts of speech: ${posList.join(', ') || 'N/A'}
Proposed definition object (per-POS char counts shown; per-POS budget is ${MAX_LEN_PER_POS}):
${annotateDefForPrompt(proposed)}

Violation codes you may cite:
${Object.entries(VIOLATION_CODE_LABELS).map(([k, v]) => `  - "${k}": ${v}`).join('\n')}

If the object satisfies every constraint, respond with: {"accept": true}
If any constraint is violated (for any POS value), respond with:
  {"accept": false, "violatedRules": ["code1", "code2"], "critique": "1-2 sentences naming which POS value(s) fail and what a corrected object should look like"}

Respond with ONLY valid JSON, no markdown.`;

  const response = await anthropic.messages.create({
    model: VALIDATOR_MODEL,
    max_tokens: 300,
    temperature: 0.1,
    system: 'You are a strict reviewer of English definitions for Spanish words. Respond only with valid JSON.',
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

  const prompt = `Your previous per-POS English definition object for a Spanish word was rejected by a strict reviewer. Produce a corrected object that fixes all flagged violations.

${DEFINITION_RULES_TEXT}

Word: ${word}
Parts of speech: ${posList.join(', ') || 'N/A'}

Previous attempt:
${annotateDefForPrompt(priorDef)}
Violated rules:
${violationLines || '  (none specified)'}
Reviewer critique:
${critique || '(none)'}

Apply all constraints precisely. You may keep, change, or restructure any value. Respond with ONLY the corrected JSON object — no markdown fences, no extra prose.`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 600,
    // Note: claude-opus-4-8 does not accept the `temperature` parameter — omit it.
    system: 'You are a Spanish language expert writing concise, rule-compliant per-POS English definition objects. Respond only with the JSON object.',
    messages: [{ role: 'user', content: prompt }],
  });

  return parseDefObject(response.content[0].text, posList);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 4: chooser (Opus) — final adjudicator between Sonnet's and Opus's objects
//  Returns { winner: 'sonnet' | 'opus', reason: string }
// ─────────────────────────────────────────────────────────────────────────────

async function chooseDefinition(word, partsOfSpeech, sonnetDef, opusDef) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];

  const prompt = `Two per-POS English definition objects have been proposed for a Spanish word. Pick the better one as written — do not propose a third.

${DEFINITION_RULES_TEXT}

Word: ${word}
Parts of speech: ${posList.join(', ') || 'N/A'}

Option A (sonnet):
${annotateDefForPrompt(sonnetDef)}
Option B (opus):
${annotateDefForPrompt(opusDef)}

Judge which object better satisfies all constraints and quality goals. Penalize constraint violations (including any value exceeding the ${MAX_LEN_PER_POS}-character per-POS budget) AND vague or unhelpful definitions.

Respond with ONLY one of:
  {"winner": "sonnet", "reason": "1 short sentence"}
or
  {"winner": "opus", "reason": "1 short sentence"}`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 200,
    // Note: claude-opus-4-8 does not accept the `temperature` parameter — omit it.
    system: 'You are a strict adjudicator picking between two dictionary definition objects. Respond only with valid JSON.',
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
//  Agent 5: tightener (Opus) — compresses over-budget POS values to <= MAX_LEN_PER_POS
//  without losing nuance. The validator only length-checks the first (Sonnet) attempt;
//  the retry/chooser path can otherwise emit over-budget values never re-measured.
// ─────────────────────────────────────────────────────────────────────────────

async function tightenDefinition(word, partsOfSpeech, tooLongDef) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];
  const offenders = overBudgetKeys(tooLongDef);

  const prompt = `A per-POS English definition object for a Spanish word has one or more values over the ${MAX_LEN_PER_POS}-character per-POS budget. Staying within ${MAX_LEN_PER_POS} characters PER VALUE is MANDATORY and is the top priority — cut whatever it takes from the over-long value(s), dropping the least-essential details, to land at ${MAX_LEN_PER_POS} characters or fewer for EACH value. Keep the single most important nuance per value; losing secondary nuance is acceptable. Keep the same POS keys; do not drop or add a POS.

${DEFINITION_RULES_TEXT}

Word: ${word}
Parts of speech: ${posList.join(', ') || 'N/A'}

Over-budget object (per-POS char counts shown; values over budget: ${offenders.join(', ') || 'n/a'}):
${annotateDefForPrompt(tooLongDef)}

Respond with ONLY the shortened JSON object — no markdown fences, no extra prose. EVERY value MUST be ${MAX_LEN_PER_POS} characters or fewer.`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 600,
    // Note: claude-opus-4-8 does not accept the `temperature` parameter — omit it.
    system: 'You are a Spanish language expert compressing per-POS definition objects to a strict per-value length while preserving nuance. Respond only with the JSON object.',
    messages: [{ role: 'user', content: prompt }],
  });

  return parseDefObject(response.content[0].text, posList);
}

// Programmatic length guard. The validator only checks Sonnet's first attempt, so the
// Opus retry/chooser path can return objects with over-budget values. Given candidate
// objects ordered best-first, return the first whose every value is within
// [MIN_LEN, MAX_LEN_PER_POS]; otherwise ask Opus to compress (up to 4 tries); as a last
// resort return the candidate with the smallest worst-case value and flag it.
async function enforceMaxLen(word, partsOfSpeech, candidates) {
  const valid = candidates.filter(Boolean);
  for (const c of valid) {
    if (defWithinBudget(c)) return { definition: c, tightened: false, overBudget: false };
  }
  let current = valid[0];
  for (let i = 0; i < 4 && current; i++) {
    const t = await tightenDefinition(word, partsOfSpeech, current);
    if (t && defWithinBudget(t)) return { definition: t, tightened: true, overBudget: false };
    // Keep shrinking from whichever has the smaller worst-case value so far.
    if (t && maxValueLen(t) < maxValueLen(current)) current = t;
  }
  const all = [...valid, current].filter(Boolean).sort((a, b) => maxValueLen(a) - maxValueLen(b));
  const best = all[0];
  return { definition: best, tightened: true, overBudget: maxValueLen(best) > MAX_LEN_PER_POS };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Orchestrator: generator → validator → (opus retry → opus chooser) → final
//  Returns { definition, attempts, model, accepted, finalCritique, ... }
// ─────────────────────────────────────────────────────────────────────────────

async function runDefinitionPipeline(word, partsOfSpeech) {
  // Per-POS budget is constant (MAX_LEN_PER_POS); kept in the result for logging.
  const maxLen = MAX_LEN_PER_POS;

  const firstDef = await generateDefinition(word, partsOfSpeech, GEN_MODEL);
  if (!firstDef) {
    return { definition: null, attempts: 1, model: GEN_MODEL, accepted: false, maxLen, finalCritique: 'Generator returned empty/unparseable output' };
  }

  const verdict1 = await validateDefinition(word, partsOfSpeech, firstDef);
  if (verdict1.accept) {
    // Validator already enforced length, but guard anyway in case it miscounted.
    const enforced = await enforceMaxLen(word, partsOfSpeech, [firstDef]);
    return { definition: enforced.definition, attempts: 1, model: GEN_MODEL, accepted: true, maxLen, tightened: enforced.tightened, overBudget: enforced.overBudget, finalCritique: '' };
  }

  // Sonnet's attempt was rejected — retry with Opus, informed by the critique.
  const retryDef = await regenerateDefinition(word, partsOfSpeech, firstDef, verdict1.violatedRules, verdict1.critique);
  if (!retryDef) {
    const enforced = await enforceMaxLen(word, partsOfSpeech, [firstDef]);
    return {
      definition: enforced.definition,
      attempts: 2,
      model: GEN_MODEL,
      accepted: false,
      maxLen,
      tightened: enforced.tightened,
      overBudget: enforced.overBudget,
      finalCritique: `Opus retry returned empty output; falling back to Sonnet's attempt. Original critique: ${verdict1.critique}`,
    };
  }

  // Opus chooser picks between Sonnet's original and Opus's correction.
  const choice = await chooseDefinition(word, partsOfSpeech, firstDef, retryDef);
  const winnerDef = choice.winner === 'sonnet' ? firstDef : retryDef;
  const winnerModel = choice.winner === 'sonnet' ? GEN_MODEL : RETRY_MODEL;
  const otherDef = choice.winner === 'sonnet' ? retryDef : firstDef;
  // Enforce the budget, preferring the chooser's winner, then the other candidate.
  const enforced = await enforceMaxLen(word, partsOfSpeech, [winnerDef, otherDef]);
  return {
    definition: enforced.definition,
    attempts: 2,
    model: winnerModel,
    chooser: choice.winner,
    chooserReason: choice.reason,
    sonnetDef: firstDef,
    opusDef: retryDef,
    maxLen,
    tightened: enforced.tightened,
    overBudget: enforced.overBudget,
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
    // correctly reflect every grammatical role the word can take. For Spanish,
    // partsOfSpeech is populated by the importer (import-esdict-temp.ts); if rows
    // are skipped here, confirm the import ran and set partsOfSpeech.
    const { rows: entries } = await client.query(`
      SELECT id, word1, "partsOfSpeech"
      FROM dictionaryentries_es
      WHERE language = 'es'
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

        // longDefinition is a JSONB object keyed by POS — serialize for the jsonb param.
        await client.query(
          `UPDATE dictionaryentries_es SET "longDefinition" = $1::jsonb WHERE id = $2`,
          [JSON.stringify(result.definition), row.id]
        );
        await stampEntries(client, 'dictionaryentries_es', row.id);

        // Tag shows the worst-case value length against the per-POS budget and whether
        // the tightener had to run (and whether it still came up short).
        const lenTag = `[max ${maxValueLen(result.definition)}/${result.maxLen}${result.tightened ? ' tightened' : ''}${result.overBudget ? ' ⚠OVER' : ''}]`;
        const defStr = defToLogString(result.definition);

        if (result.attempts === 1) {
          acceptedFirst++;
          console.log(`"${defStr}"  [sonnet ✓] ${lenTag}`);
        } else {
          opusRetries++;
          if (result.chooser === 'sonnet') chooserPickedSonnet++;
          else chooserPickedOpus++;
          console.log(
            `"${defStr}"  [chooser → ${result.chooser}] ${lenTag}  ` +
            `reason: ${result.chooserReason}`
          );
          if (isSpotCheck) {
            console.log(`    sonnet: "${defToLogString(result.sonnetDef)}"`);
            console.log(`    opus:   "${defToLogString(result.opusDef)}"`);
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
