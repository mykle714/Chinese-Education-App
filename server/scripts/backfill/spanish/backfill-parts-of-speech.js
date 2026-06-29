/**
 * Backfill Script: AI-powered parts-of-speech + gender collapse for
 * dictionaryentries_es (SPANISH).
 *
 * Spanish counterpart of backfill/chinese/backfill-parts-of-speech.js, but the
 * task is structurally different because of the es key model:
 *
 *   - Chinese: one row per word1; POS is a jsonb array on that single row. The
 *     Chinese script just *writes the array*.
 *   - Spanish: the logical key is (word1, pos) (gender having been collapsed out
 *     by migration 64). So POS is *materialized as rows* — one row per pos — and
 *     gender-homographs are folded into scalar alternateGender / alternateMeaning
 *     columns on the primary row.
 *
 * For each target word1 this script:
 *   1. Pools the definitions of ALL its current rows (every pos/gender).
 *   2. Runs an agent pipeline that returns one group per genuine POS, each with a
 *      primary gender + delegated definitions and, for a true gender-homograph,
 *      the secondary gender token + a short gloss. A definition may be delegated
 *      to more than one POS (duplicates allowed). Up to two distinct-meaning
 *      genders per pos collapse into (primary, alternate); any third distinct
 *      meaning is reported in `droppedSenses` for manual review, never silently
 *      lost.
 *   3. Reconciles rows: UPDATE the existing (word1,pos) row in place (preserving
 *      its id and — when its definitions are unchanged — its enrichment), INSERT a
 *      missing pos row, and PRUNE the folded secondary-gender rows.
 *
 * Pipeline position: runs AFTER the deterministic definition cleanup
 * (split-semicolon, expand-abbreviations) and BEFORE sort-definitions /
 * long-definitions / example-sentences, because it rewrites each row's
 * `definitions` and `partsOfSpeech`, which those steps consume. When this script
 * changes a row's definitions it NULLs that row's longDefinition /
 * exampleSentences / vernacularScore so the later steps regenerate them against
 * the new definition set.
 *
 * Prune safety: `--prune-mode=soft` (default) merely sets discoverable=FALSE on a
 * folded secondary-gender row (reversible, and safe while the table still carries
 * the old uq_es_word1_pos_gender constraint). `--prune-mode=hard` DELETEs it —
 * required before the (word1,pos) unique-constraint swap, but destructive.
 *
 * Usage:
 *   npx tsx /app/scripts/backfill/spanish/backfill-parts-of-speech.js                 # all discoverable words
 *   npx tsx /app/scripts/backfill/spanish/backfill-parts-of-speech.js --words=cura,perro
 *   npx tsx /app/scripts/backfill/spanish/backfill-parts-of-speech.js --dry-run       # print actions, write nothing
 *   npx tsx /app/scripts/backfill/spanish/backfill-parts-of-speech.js --prune-mode=hard
 *   npx tsx /app/scripts/backfill/spanish/backfill-parts-of-speech.js --spot-check    # first 5 discoverable words
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { posAbbrevToFriendly } from '../shared/lib/esPos.js';
import { initRunLog, cachedSystem } from '../run-log.js';
const SCRIPT_VERSION = 1; // bump when this script's logic/prompt changes

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries } = initRunLog({ script: 'spanish/backfill-parts-of-speech', version: SCRIPT_VERSION, anthropic: anthropic });

const isSpotCheck = process.argv.includes('--spot-check');
const isDryRun = process.argv.includes('--dry-run');
const pruneArg = process.argv.find(a => a.startsWith('--prune-mode='));
const pruneMode = pruneArg ? pruneArg.slice('--prune-mode='.length) : 'soft';

const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg
  ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean)
  : null;

const GEN_MODEL = 'claude-opus-4-8';
const VALIDATOR_MODEL = 'claude-sonnet-4-6';
const RETRY_MODEL = 'claude-opus-4-8';

// ─────────────────────────────────────────────────────────────────────────────
//  Shared rule text — injected into generator, validator and regenerator so they
//  judge by identical criteria.
// ─────────────────────────────────────────────────────────────────────────────

const DELEGATION_RULES = `
You are reorganizing a Spanish dictionary headword into one entry per PART OF
SPEECH for a learner app. You are given every sense the source has for the word,
each tagged with a raw part-of-speech abbreviation and (for nouns) a gender token.

Raw POS abbreviations you will see and must reuse VERBATIM in your output:
  n=noun, v=verb, adj=adjective, adv=adverb, pron=pronoun, art=article,
  determiner, num=numeral, prep=preposition, conj=conjunction, interj=interjection,
  part=particle, prop=proper noun, phrase, proverb, contraction, letter, symbol.

Gender tokens: m, f, mf, mfbysense, mfequiv, m-p, f-p, mf-p, gneut, or null.
  - m / f          → concrete masculine / feminine.
  - mf / mfbysense / mfequiv → "common gender": the SAME meaning takes either
    gender depending on the referent (e.g. el/la agente). Treat these as ONE sense.

Hard rules:

1. ONE GROUP PER POS. Output exactly one group per distinct part of speech the
   word genuinely has. Merge all same-POS senses into that group's definitions.

2. DELEGATE EVERY DEFINITION. Every input definition must appear in at least one
   group's "definitions". A definition that legitimately functions as two parts of
   speech may be placed in BOTH groups (duplicates allowed). Do not invent
   definitions and do not drop a real one.

3. GENDER COLLAPSE (nouns only):
   a. If a noun POS has senses of only one effective gender (including a concrete
      gender plus a same-meaning common-gender token), set primaryGender to the
      most representative token and leave alternateGender / alternateMeaning null.
      Prefer a concrete m/f token over a meta-token when they mean the same thing.
   b. If a noun POS has TWO genders with DIFFERENT meanings (a true homograph, e.g.
      cura f="cure" vs m="priest"), choose the MORE COMMON / more learner-relevant
      sense as the primary (its gender → primaryGender, its definitions →
      definitions) and put the other gender token in alternateGender with a SHORT
      gloss (2-5 words, lowercase) of that secondary sense in alternateMeaning.
   c. If a noun POS has THREE OR MORE distinct-meaning genders, keep the top two as
      (primary, alternate) and list each remaining {gender, gloss} in droppedSenses.

4. NON-NOUN POS carry no gender: primaryGender / alternateGender are null.

5. BE FAITHFUL, NOT INVENTIVE. Keep the source's wording for definitions. Order
   each group's definitions from most common/useful to least.
`;

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

// Build the agent input: pooled senses for one word1, one object per source row.
function buildSenseInput(rows) {
  return rows.map(r => ({
    pos: r.pos,
    gender: r.gender ?? null,
    definitions: Array.isArray(r.definitions) ? r.definitions : [],
  }));
}

// Mechanical validation of a generator/regenerator result against the input.
// Returns { ok, problems: string[] }.
function checkShape(result, senses) {
  const problems = [];
  if (!result || !Array.isArray(result.groups) || result.groups.length === 0) {
    return { ok: false, problems: ['no groups array'] };
  }

  const seenPos = new Set();
  for (const g of result.groups) {
    if (!g || typeof g.pos !== 'string' || !g.pos.trim()) {
      problems.push('group with missing pos');
      continue;
    }
    if (seenPos.has(g.pos)) problems.push(`duplicate pos group: ${g.pos}`);
    seenPos.add(g.pos);
    if (!Array.isArray(g.definitions) || g.definitions.length === 0) {
      problems.push(`pos ${g.pos}: empty definitions`);
    }
    if (g.alternateGender && !g.alternateMeaning) {
      problems.push(`pos ${g.pos}: alternateGender without alternateMeaning`);
    }
    if (g.alternateMeaning && !g.alternateGender) {
      problems.push(`pos ${g.pos}: alternateMeaning without alternateGender`);
    }
  }

  // Coverage: every input definition must land in some group (duplicates allowed).
  const assigned = new Set();
  for (const g of result.groups) {
    for (const d of g.definitions ?? []) assigned.add(String(d).trim());
  }
  for (const s of senses) {
    for (const d of s.definitions) {
      if (!assigned.has(String(d).trim())) {
        problems.push(`definition not delegated: "${String(d).slice(0, 40)}"`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 1: generator (Opus)
// ─────────────────────────────────────────────────────────────────────────────

async function generateGroups(word, senses, model = GEN_MODEL) {
  // Static delegation rules + output shape → cached system; per-entry word +
  // source senses → user message.
  const systemText = `You are a Spanish lexicographer reorganizing dictionary senses by part of speech. Respond only with valid JSON.

${DELEGATION_RULES}

Respond with ONLY this JSON shape, no markdown, no commentary:
{
  "groups": [
    {
      "pos": "<raw abbreviation, reused verbatim>",
      "primaryGender": "<token or null>",
      "definitions": ["<delegated definition>", "..."],
      "alternateGender": "<token or null>",
      "alternateMeaning": "<short gloss or null>"
    }
  ],
  "droppedSenses": [ { "pos": "<abbrev>", "gender": "<token>", "gloss": "<short gloss>" } ]
}`;

  const prompt = `Word: ${word}
Source senses (JSON): ${JSON.stringify(senses)}`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1500,
    system: cachedSystem(systemText),
    messages: [{ role: 'user', content: prompt }],
  });
  return parseJsonFromResponse(response.content[0].text);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 2: validator (Sonnet) — judges delegation + gender collapse quality
//  Returns { accept, critique }
// ─────────────────────────────────────────────────────────────────────────────

async function validateGroups(word, senses, proposed) {
  // Static reviewer scaffold (rules + checklist + response format) → cached system;
  // per-entry word + senses + proposed grouping → user message.
  const systemText = `You are a strict reviewer of a Spanish dictionary reorganization. Apply the rules formally. Respond only with valid JSON.

${DELEGATION_RULES}

Check specifically:
  - Is every source definition delegated to the right POS (rule 2)?
  - For a true gender-homograph, is the MORE COMMON sense the primary, and is the
    secondary correctly parked in alternateGender + a short alternateMeaning gloss
    (rule 3b)? alternateMeaning must NOT merely repeat the primary meaning.
  - Were same-meaning common-gender tokens collapsed (rule 3a) rather than turned
    into a bogus alternate?

Respond with ONLY one of:
  {"accept": true}
or
  {"accept": false, "critique": "1-2 sentences naming the specific fix needed"}`;

  const prompt = `Word: ${word}
Source senses (JSON): ${JSON.stringify(senses)}
Proposed grouping (JSON): ${JSON.stringify(proposed)}`;

  const response = await anthropic.messages.create({
    model: VALIDATOR_MODEL,
    max_tokens: 300,
    temperature: 0.1,
    system: cachedSystem(systemText),
    messages: [{ role: 'user', content: prompt }],
  });
  const parsed = parseJsonFromResponse(response.content[0].text);
  if (!parsed) return { accept: false, critique: 'Validator response unparseable.' };
  if (parsed.accept === true) return { accept: true, critique: '' };
  return { accept: false, critique: typeof parsed.critique === 'string' ? parsed.critique : '' };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 3: regenerator (Opus) — corrects a rejected attempt
// ─────────────────────────────────────────────────────────────────────────────

async function regenerateGroups(word, senses, priorAttempt, critique) {
  const prompt = `${DELEGATION_RULES}

Word: ${word}
Source senses (JSON): ${JSON.stringify(senses)}

Your previous grouping was rejected.
Previous attempt: ${JSON.stringify(priorAttempt)}
Reviewer critique: ${critique || '(none)'}

Produce a corrected grouping that addresses the critique. Respond with ONLY the
same JSON shape as before (groups + droppedSenses), no markdown, no commentary.`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 1500,
    system: 'You are a Spanish lexicographer correcting a flawed sense reorganization. Respond only with valid JSON.',
    messages: [{ role: 'user', content: prompt }],
  });
  return parseJsonFromResponse(response.content[0].text);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Orchestrator: generator → shape-check/validator → (opus retry) → final
//  Returns { groups, droppedSenses, attempts, accepted, note }
// ─────────────────────────────────────────────────────────────────────────────

async function runPipeline(word, senses) {
  const first = await generateGroups(word, senses, GEN_MODEL);
  const firstShape = checkShape(first, senses);

  let verdict = { accept: false, critique: '' };
  if (firstShape.ok) {
    verdict = await validateGroups(word, senses, first);
    if (verdict.accept) {
      return { groups: first.groups, droppedSenses: first.droppedSenses ?? [], attempts: 1, accepted: true, note: '' };
    }
  }

  const critique = firstShape.ok ? verdict.critique : `shape errors: ${firstShape.problems.join('; ')}`;
  const retry = await regenerateGroups(word, senses, first, critique);
  const retryShape = checkShape(retry, senses);
  if (!retryShape.ok) {
    // Fall back to whichever attempt is shape-valid; prefer the retry.
    if (firstShape.ok) {
      return { groups: first.groups, droppedSenses: first.droppedSenses ?? [], attempts: 2, accepted: false, note: `retry shape invalid (${retryShape.problems.join('; ')}); kept first attempt` };
    }
    return { groups: null, droppedSenses: [], attempts: 2, accepted: false, note: `both attempts shape-invalid: ${retryShape.problems.join('; ')}` };
  }
  return { groups: retry.groups, droppedSenses: retry.droppedSenses ?? [], attempts: 2, accepted: false, note: `opus retry (critique: ${critique})` };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Reconcile agent output → rows, inside a per-word transaction.
//  Returns a summary of actions for logging.
// ─────────────────────────────────────────────────────────────────────────────

function definitionsEqual(a, b) {
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) if (String(aa[i]) !== String(bb[i])) return false;
  return true;
}

async function reconcileWord(client, word, rows, groups) {
  const actions = [];
  // Index existing rows by pos.
  const rowsByPos = new Map();
  for (const r of rows) {
    if (!rowsByPos.has(r.pos)) rowsByPos.set(r.pos, []);
    rowsByPos.get(r.pos).push(r);
  }
  const keptIds = new Set();

  // A word1 with >1 surviving POS row needs a disambiguating POS badge on the
  // client. Stamp the same flag on every row we keep/insert for this word.
  const hasMultiplePos = groups.length > 1;

  for (const g of groups) {
    const friendly = posAbbrevToFriendly(g.pos);
    const partsOfSpeech = friendly ? [friendly] : [];
    const candidates = rowsByPos.get(g.pos) ?? [];

    // Pick the row to keep for this pos: prefer one matching the primary gender,
    // then a currently-discoverable one (preserves its enrichment), then lowest id.
    let target =
      candidates.find(r => (r.gender ?? null) === (g.primaryGender ?? null)) ||
      candidates.find(r => r.discoverable) ||
      candidates.slice().sort((a, b) => a.id - b.id)[0];

    const newDefs = g.definitions;
    if (target) {
      const defsChanged = !definitionsEqual(target.definitions, newDefs);
      // If the definition set changed, null the dependent enrichment so the later
      // pipeline steps regenerate it against the new definitions.
      const nullEnrichment = defsChanged
        ? `, "longDefinition" = NULL, "exampleSentences" = NULL, "vernacularScore" = NULL`
        : '';
      if (!isDryRun) {
        await client.query(
          `UPDATE dictionaryentries_es
             SET definitions = $1::jsonb,
                 "partsOfSpeech" = $2::jsonb,
                 gender = $3,
                 "alternateGender" = $4,
                 "alternateMeaning" = $5,
                 "hasMultiplePos" = $6,
                 discoverable = TRUE
                 ${nullEnrichment}
           WHERE id = $7`,
          [JSON.stringify(newDefs), JSON.stringify(partsOfSpeech), g.primaryGender ?? null,
           g.alternateGender ?? null, g.alternateMeaning ?? null, hasMultiplePos, target.id]
        );
        await stampEntries(client, 'dictionaryentries_es', target.id);
      }
      keptIds.add(target.id);
      actions.push(`UPDATE id=${target.id} pos=${g.pos} gender=${g.primaryGender ?? '∅'}` +
        (g.alternateGender ? ` alt=${g.alternateGender}:"${g.alternateMeaning}"` : '') +
        (defsChanged ? ' [defs changed → enrichment reset]' : ''));
    } else {
      // No existing row for this pos — INSERT. Copy raw/etymology from any source row.
      const donor = rows[0];
      if (!isDryRun) {
        const inserted = await client.query(
          `INSERT INTO dictionaryentries_es
             (language, word1, pos, gender, definitions, "partsOfSpeech",
              "alternateGender", "alternateMeaning", "hasMultiplePos", raw, etymology, discoverable)
           VALUES ('es', $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9::jsonb, $10, TRUE)
           RETURNING id`,
          [word, g.pos, g.primaryGender ?? null, JSON.stringify(newDefs),
           JSON.stringify(partsOfSpeech), g.alternateGender ?? null, g.alternateMeaning ?? null,
           hasMultiplePos, donor?.raw ? JSON.stringify(donor.raw) : null, donor?.etymology ?? null]
        );
        await stampEntries(client, 'dictionaryentries_es', inserted.rows[0].id);
      }
      actions.push(`INSERT pos=${g.pos} gender=${g.primaryGender ?? '∅'}` +
        (g.alternateGender ? ` alt=${g.alternateGender}:"${g.alternateMeaning}"` : ''));
    }
  }

  // Prune leftover rows whose pos IS covered by a group but were not kept
  // (the folded secondary-gender rows). Rows for a pos the agent produced NO group
  // for are left untouched (we never destroy a pos the agent didn't account for).
  for (const r of rows) {
    if (keptIds.has(r.id)) continue;
    const posCoveredByGroup = groups.some(g => g.pos === r.pos);
    if (!posCoveredByGroup) {
      actions.push(`SKIP id=${r.id} pos=${r.pos} (pos not in agent output — left untouched)`);
      continue;
    }
    const hadEnrichment = r.has_long_def || r.has_examples;
    if (pruneMode === 'hard') {
      if (!isDryRun) await client.query(`DELETE FROM dictionaryentries_es WHERE id = $1`, [r.id]);
      actions.push(`DELETE id=${r.id} pos=${r.pos} gender=${r.gender ?? '∅'} (folded)` + (hadEnrichment ? ' ⚠ had enrichment' : ''));
    } else {
      if (!isDryRun) await client.query(`UPDATE dictionaryentries_es SET discoverable = FALSE WHERE id = $1`, [r.id]);
      actions.push(`HIDE id=${r.id} pos=${r.pos} gender=${r.gender ?? '∅'} (folded, discoverable→false)`);
    }
  }
  return actions;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }
  console.log('🚀 Spanish parts-of-speech / gender-collapse backfill');
  console.log(`   mode: ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE'} | prune: ${pruneMode}`);
  if (targetWords?.length) console.log(`   scoped to: ${targetWords.join(', ')}`);
  console.log('');

  const client = await db.getClient();
  try {
    // Target word1 set: every word1 that has at least one discoverable row
    // (so we process the word holistically), optionally narrowed by --words.
    const wordsFilter = targetWords?.length ? `AND word1 = ANY($1::text[])` : '';
    const params = targetWords?.length ? [targetWords] : [];
    const { rows: wordRows } = await client.query(
      `SELECT DISTINCT word1 FROM dictionaryentries_es
        WHERE language = 'es' AND discoverable = TRUE ${wordsFilter}
        ORDER BY word1 ${isSpotCheck ? 'LIMIT 5' : ''}`,
      params
    );
    const words = wordRows.map(r => r.word1);
    console.log(`📊 ${words.length} word(s) to process\n`);

    let processed = 0, failed = 0, totalDropped = 0;

    for (const word of words) {
      try {
        const { rows } = await client.query(
          `SELECT id, pos, gender, definitions, raw, etymology, discoverable,
                  ("longDefinition" IS NOT NULL) AS has_long_def,
                  ("exampleSentences" IS NOT NULL) AS has_examples
             FROM dictionaryentries_es
            WHERE language = 'es' AND word1 = $1
            ORDER BY id ASC`,
          [word]
        );
        if (rows.length === 0) { console.log(`  ${word}: no rows, skipped`); continue; }

        const senses = buildSenseInput(rows);
        const result = await runPipeline(word, senses);
        if (!result.groups) {
          console.log(`  ❌ ${word}: ${result.note}`);
          failed++;
          continue;
        }

        if (!isDryRun) await client.query('BEGIN');
        let actions;
        try {
          actions = await reconcileWord(client, word, rows, result.groups);
          if (!isDryRun) await client.query('COMMIT');
        } catch (err) {
          if (!isDryRun) await client.query('ROLLBACK');
          throw err;
        }

        const posList = result.groups.map(g => g.pos).join('/');
        console.log(`  ${word} → [${posList}]${result.attempts > 1 ? '  (' + result.note + ')' : ''}`);
        for (const a of actions) console.log(`      ${a}`);
        if (result.droppedSenses?.length) {
          totalDropped += result.droppedSenses.length;
          for (const d of result.droppedSenses) {
            console.log(`      ⚠ DROPPED (manual review): pos=${d.pos} gender=${d.gender} "${d.gloss}"`);
          }
        }
        processed++;
      } catch (err) {
        console.log(`  ❌ ${word}: ${err.message}`);
        failed++;
      }
      await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Processed : ${processed}`);
    console.log(`Failed    : ${failed}`);
    console.log(`Dropped senses needing manual review: ${totalDropped}`);
    if (isDryRun) console.log('DRY RUN — no changes were written.');
    console.log('='.repeat(60));
  } finally {
    client.release();
    await db.end?.();
  }
}

run().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
