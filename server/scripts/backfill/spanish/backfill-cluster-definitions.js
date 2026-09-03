/**
 * Backfill Script: AI sense clustering for dictionaryentries_es (SPANISH).
 *
 * Spanish counterpart of backfill/chinese/backfill-cluster-definitions.js. For each
 * target word1 it partitions the entry's `definitions` into orthogonal SENSE CLUSTERS
 * and writes them to `definitionClusters` (+ the friendly `partsOfSpeech` tag array).
 *
 * ── Replaces backfill-parts-of-speech.js ────────────────────────────────────────
 * Until migration 123, a Spanish headword was MATERIALIZED AS ROWS — one det row per
 * (pos, gender) — so the old script's job was row reconciliation: UPDATE the row for
 * each POS, INSERT missing ones, PRUNE folded ones, and collapse a gender-homograph's
 * second sense into scalar `alternateGender`/`alternateMeaning` columns because there
 * was nowhere else to put it. That collapse was lossy by construction: a third
 * distinct-gender meaning could only be reported to `droppedSenses` for a human.
 *
 * Migration 123 made word1 unique and moved the split into `definitionClusters`, so
 * ALL of that disappears. A gender-homograph is simply two clusters; a third meaning is
 * a third cluster. This script only ever writes columns on ONE row — it never inserts,
 * deletes, or hides a row.
 *
 * ── What a cluster is ───────────────────────────────────────────────────────────
 *   { sense, reading: null, pos: [...], gender, frequencyScore, glosses: [...] }
 * Chinese's hard sense boundary is `reading` (heteronyms); Spanish's is pos + gender,
 * because gender carries distinct meaning (cura/f "cure" vs cura/m "priest"). Spanish
 * clusters always carry `reading: null` — pronunciation is not per-sense in Spanish.
 *
 * ── Seed clusters are input, not output ─────────────────────────────────────────
 * Migration 123 seeded a MECHANICAL cluster per old row for the 9,087 multi-row words,
 * carrying Wiktionary's own pos/gender tagging. Those tags are authoritative, so they
 * are fed to the model as the source senses rather than being re-derived. A word with
 * no seed (single-row) is fed its flat `definitions` with no pos/gender hints.
 *
 * ── Ownership ───────────────────────────────────────────────────────────────────
 * Like the zh clusterer, this NEVER writes `definitions` — that array stays owned by
 * backfill-process-definitions-array.js, and ~40 consumers depend on it. Clusters are
 * additive metadata; the two are allowed to diverge (see docs/DEFINITION_CLUSTERS.md).
 *
 * Pipeline position (REQUIRED_SCRIPTS_ES step 6): after the deterministic definition
 * cleanup (split-semicolon, expand-abbreviations) AND after backfill-process-definitions-array,
 * and BEFORE long-definitions / example-sentences, which read the cluster `sense` labels
 * to tag what they generate.
 *
 * process-definitions-array must come FIRST because `checkShape` below enforces an EXACT
 * PARTITION of `definitions` — every gloss in exactly one cluster. process-defs re-orders
 * and PRUNES that array, so clustering ahead of it leaves the stored partition referencing
 * glosses the row no longer has.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-cluster-definitions.js              # discoverable, not yet clustered
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-cluster-definitions.js --force      # re-cluster (ignores the seeded/AI state)
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-cluster-definitions.js --words=cura,perro
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-cluster-definitions.js --dry-run    # print clusters, write nothing
 *   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-cluster-definitions.js --spot-check # first 5 words, no writes, verbose
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { posAbbrevToFriendly } from '../shared/lib/esPos.js';
import { SCALE_AND_GUIDELINES, POLYSEMY_GUIDELINE } from './lib/frequencyRubric.js';
import { parseModelJson } from '../shared/lib/json.js';
import { initRunLog, cachedSystem } from '../run-log.js';
import { reconcileFrequencyScore } from '../shared/lib/senseClusters.js';

const SCRIPT_VERSION = 3; // bump when this script's logic/prompt changes (v3: rule 7 — clusters must now be EMITTED most- to least-common, with same-score ties ordered by the marginal difference the 1-5 scale cannot record; array order is what every read-side stable sort uses to break a score tie, so this decides the starred/default sense. zh does the same job in a separate Stage C.5 pass (shared/lib/tiebreakOrder.js) because its scorer never sees a cluster's siblings; here one call already sees them all. v2: Stage-C scoring now receives the FULL rubric from lib/frequencyRubric.js — it previously had only the five band names — and that rubric's axis changed to conversational commonality; pre-2026-08-28 cluster scores are stale)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const { stampEntries, staleClause, validatedClause } = initRunLog({
  script: 'spanish/backfill-cluster-definitions',
  version: SCRIPT_VERSION,
  anthropic,
});

const isSpotCheck = process.argv.includes('--spot-check');
// --spot-check implies --dry-run: it is a "show me what this would do" mode.
const isDryRun = process.argv.includes('--dry-run') || isSpotCheck;
const isForce = process.argv.includes('--force');
// --stale: also (re)process rows this script already touched but stamped below
// SCRIPT_VERSION. Without this the doneGate below is a one-shot "never touched"
// check with no version awareness, so a SCRIPT_VERSION bump could never actually
// reach an already-clustered row short of --force re-clustering the whole table.
const isStale = process.argv.includes('--stale');

const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg
  ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean)
  : null;

const GEN_MODEL = 'claude-opus-4-8';
const VALIDATOR_MODEL = 'claude-sonnet-4-6';
const RETRY_MODEL = 'claude-opus-4-8';

// Marker the mark-discoverable skill agent greps for, mirroring the zh clusterer's
// convention: the model self-flags anything it is unsure about and we print it to
// stdout rather than to a file (see docs/DEFINITION_CLUSTERS.md § Human review).
const REVIEW_MARKER = '⚠ CLUSTER REVIEW';

// ─────────────────────────────────────────────────────────────────────────────
//  Shared rule text — injected into generator, validator and regenerator so all
//  three judge by identical criteria.
// ─────────────────────────────────────────────────────────────────────────────

const CLUSTER_RULES = `
You are grouping a Spanish dictionary headword's glosses into SENSE CLUSTERS for a
learner app. A cluster is one learnable meaning: the glosses inside it all say the
same thing, and different clusters mean genuinely different things.

You are given every gloss the source has, grouped as the source tagged them, with a
raw part-of-speech abbreviation and (for nouns) a gender token.

Raw POS abbreviations you will see and must reuse VERBATIM:
  n=noun, v=verb, adj=adjective, adv=adverb, pron=pronoun, art=article,
  determiner, num=numeral, prep=preposition, conj=conjunction, interj=interjection,
  part=particle, prop=proper noun, phrase, proverb, contraction, letter, symbol.

Gender tokens: m, f, mf, mfbysense, mfequiv, m-p, f-p, mf-p, gneut, or null.
  - m / f          → concrete masculine / feminine.
  - mf / mfbysense / mfequiv → "common gender": the SAME meaning takes either gender
    depending on the referent (el/la agente). That is ONE sense, not two.

Hard rules:

1. POS + GENDER IS A HARD BOUNDARY. Glosses with different parts of speech never
   share a cluster, and neither do noun glosses whose genders carry different
   meanings (cura f="cure" vs m="priest" are two clusters). Common-gender tokens
   describing one meaning stay in ONE cluster.

2. PARTITION EVERY GLOSS. Every input gloss must appear in exactly one cluster,
   VERBATIM — do not reword, merge, invent, or drop any gloss.

3. CLUSTER BY SHARED CORE IDEA within a (pos, gender). A part of speech with two
   unrelated meanings gets two clusters; err toward FINER, precise senses rather
   than one vague catch-all.

4. ORDER GLOSSES within a cluster from the most prototypical//useful meaning to the
   most peripheral. The first gloss becomes the sense's display definition.

5. LABEL each cluster with a short English "sense" (2-6 words, lowercase unless a
   proper noun) naming the shared meaning. Labels must be UNIQUE within the word —
   they are how a learner's saved sense choice is addressed.

6. SCORE each cluster's conversational commonality 1-5, independently, on this scale:
${SCALE_AND_GUIDELINES}
${POLYSEMY_GUIDELINE.sense}
   Score THE SENSE, not the spelling: a very common word can have a rare sense.

7. ORDER THE CLUSTERS most- to least-common, using the same scores you just gave.
   Where two clusters share a score, the array order is what decides between them:
   every read path sorts these clusters by score with a stable sort, so a tie falls
   through to the order you emit here, and the first of the tied clusters is the
   sense the flashcard shows by default. Break such a tie on the MARGINAL difference
   the 1-5 scale was too coarse to record — the sense a learner meets first and hears
   most: everyday concrete usage before figurative or specialist usage, plain modern
   usage before anything formal, regional or dated. Do not change a score to express
   the difference; express it in the order.

8. FLAG YOUR DOUBTS. Add a short note to "reviewNotes" for anything you are even
   slightly unsure about — an ambiguous sense boundary, a gloss that could sit in
   two clusters, an uncertain gender, a broken or unintelligible source gloss. Err
   heavily toward flagging; these notes are read by a human.
`;

// ─────────────────────────────────────────────────────────────────────────────
//  Utility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the model's input: one object per source sense. Prefers the seeded clusters
 * (they carry Wiktionary's pos/gender) and falls back to the flat definitions array
 * for a word that was never seeded.
 */
function buildSenseInput(row) {
  const seeded = Array.isArray(row.definitionClusters) ? row.definitionClusters : null;
  if (seeded?.length) {
    return seeded.map(c => ({
      pos: Array.isArray(c.pos) ? c.pos[0] ?? null : c.pos ?? null,
      gender: c.gender ?? null,
      glosses: Array.isArray(c.glosses) ? c.glosses : [],
    }));
  }
  return [{ pos: null, gender: null, glosses: Array.isArray(row.definitions) ? row.definitions : [] }];
}

/** Every gloss handed to the model, flattened, for the partition check. */
function inputGlosses(senses) {
  return senses.flatMap(s => s.glosses.map(g => String(g).trim()));
}

/**
 * Mechanical validation of a model result: shape, label uniqueness, score range, and
 * an EXACT PARTITION over the input glosses (each used once, none invented, none
 * lost). Returns { ok, problems: string[] }.
 */
function checkShape(result, senses) {
  const problems = [];
  if (!result || !Array.isArray(result.clusters) || result.clusters.length === 0) {
    return { ok: false, problems: ['no clusters array'] };
  }

  const labels = new Set();
  for (const c of result.clusters) {
    if (!c || typeof c.sense !== 'string' || !c.sense.trim()) {
      problems.push('cluster with missing sense label');
      continue;
    }
    if (labels.has(c.sense)) problems.push(`duplicate sense label: "${c.sense}"`);
    labels.add(c.sense);
    if (!Array.isArray(c.glosses) || c.glosses.length === 0) {
      problems.push(`sense "${c.sense}": empty glosses`);
    }
    if (c.frequencyScore != null && !(Number.isInteger(c.frequencyScore) && c.frequencyScore >= 1 && c.frequencyScore <= 5)) {
      problems.push(`sense "${c.sense}": frequencyScore ${c.frequencyScore} out of range 1-5`);
    }
  }

  // Exact partition: multiset of assigned glosses must equal the multiset of inputs.
  const assigned = result.clusters.flatMap(c => (c.glosses ?? []).map(g => String(g).trim()));
  const inputs = inputGlosses(senses);
  const remaining = [...inputs];
  for (const g of assigned) {
    const at = remaining.indexOf(g);
    if (at === -1) problems.push(`gloss not in source (invented/reworded): "${g.slice(0, 40)}"`);
    else remaining.splice(at, 1);
  }
  for (const g of remaining) problems.push(`gloss dropped: "${g.slice(0, 40)}"`);

  return { ok: problems.length === 0, problems };
}

const RESPONSE_SHAPE = `Respond with ONLY this JSON shape, no markdown, no commentary:
{
  "clusters": [
    {
      "sense": "<short English label, unique within this word>",
      "pos": ["<raw abbreviation, reused verbatim>"],
      "gender": "<token or null>",
      "frequencyScore": <1-5>,
      "glosses": ["<source gloss, verbatim>", "..."]
    }
  ],
  "reviewNotes": ["<short note about anything uncertain>"]
}`;

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 1: generator (Opus)
// ─────────────────────────────────────────────────────────────────────────────

async function generateClusters(word, senses, model = GEN_MODEL) {
  // Static rules + output shape → cached system; per-entry word + senses → user message.
  const systemText = `You are a Spanish lexicographer partitioning dictionary glosses into learnable senses. Respond only with valid JSON.

${CLUSTER_RULES}

${RESPONSE_SHAPE}`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    system: cachedSystem(systemText),
    messages: [{ role: 'user', content: `Word: ${word}\nSource senses (JSON): ${JSON.stringify(senses)}` }],
  });
  return parseModelJson(response.content[0].text);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 2: validator (Sonnet) — judges cluster quality, not mechanics
//  (the partition itself is checked deterministically by checkShape)
// ─────────────────────────────────────────────────────────────────────────────

async function validateClusters(word, senses, proposed) {
  const systemText = `You are a strict reviewer of a Spanish dictionary sense partition. Apply the rules formally. Respond only with valid JSON.

${CLUSTER_RULES}

Check specifically:
  - Does any cluster mix two genuinely different meanings (rule 3)?
  - Does any pair of clusters say the SAME thing and belong merged (rule 3)?
  - Is any pos/gender boundary violated — different POS, or different-meaning
    genders, sharing one cluster (rule 1)?
  - Was a same-meaning common-gender token wrongly split into two clusters (rule 1)?
  - Is each cluster's lead gloss its most prototypical one (rule 4)?
  - Is any frequencyScore obviously wrong for THAT SENSE (rule 6)?
  - Are the clusters ordered most- to least-common, and is the FIRST of any group
    sharing a score the one a learner meets first (rule 7)? A wrong order here
    silently picks the card's default sense.

Respond with ONLY one of:
  {"accept": true}
or
  {"accept": false, "critique": "1-2 sentences naming the specific fix needed"}`;

  const response = await anthropic.messages.create({
    model: VALIDATOR_MODEL,
    max_tokens: 300,
    temperature: 0.1,
    system: cachedSystem(systemText),
    messages: [{
      role: 'user',
      content: `Word: ${word}\nSource senses (JSON): ${JSON.stringify(senses)}\nProposed clusters (JSON): ${JSON.stringify(proposed)}`,
    }],
  });
  const parsed = parseModelJson(response.content[0].text);
  if (!parsed) return { accept: false, critique: 'Validator response unparseable.' };
  if (parsed.accept === true) return { accept: true, critique: '' };
  return { accept: false, critique: typeof parsed.critique === 'string' ? parsed.critique : '' };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 3: regenerator (Opus) — corrects a rejected attempt
// ─────────────────────────────────────────────────────────────────────────────

async function regenerateClusters(word, senses, priorAttempt, critique) {
  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 2000,
    system: 'You are a Spanish lexicographer correcting a flawed sense partition. Respond only with valid JSON.',
    messages: [{
      role: 'user',
      content: `${CLUSTER_RULES}

Word: ${word}
Source senses (JSON): ${JSON.stringify(senses)}

Your previous partition was rejected.
Previous attempt: ${JSON.stringify(priorAttempt)}
Reviewer critique: ${critique || '(none)'}

Produce a corrected partition that addresses the critique.

${RESPONSE_SHAPE}`,
    }],
  });
  return parseModelJson(response.content[0].text);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Orchestrator: generator → shape-check/validator → (opus retry) → final
// ─────────────────────────────────────────────────────────────────────────────

async function runPipeline(word, senses) {
  const first = await generateClusters(word, senses, GEN_MODEL);
  const firstShape = checkShape(first, senses);

  let verdict = { accept: false, critique: '' };
  if (firstShape.ok) {
    verdict = await validateClusters(word, senses, first);
    if (verdict.accept) {
      return { clusters: first.clusters, reviewNotes: first.reviewNotes ?? [], attempts: 1, note: '' };
    }
  }

  const critique = firstShape.ok ? verdict.critique : `shape errors: ${firstShape.problems.join('; ')}`;
  const retry = await regenerateClusters(word, senses, first, critique);
  const retryShape = checkShape(retry, senses);
  if (!retryShape.ok) {
    // Prefer the retry, but never write a partition that loses a gloss: fall back to
    // the first attempt when it was mechanically sound, else give up on this word.
    if (firstShape.ok) {
      return {
        clusters: first.clusters,
        reviewNotes: [...(first.reviewNotes ?? []), `retry rejected (${retryShape.problems.join('; ')}); kept first attempt`],
        attempts: 2,
        note: 'retry shape invalid; kept first attempt',
      };
    }
    return { clusters: null, reviewNotes: [], attempts: 2, note: `both attempts shape-invalid: ${retryShape.problems.join('; ')}` };
  }
  return {
    clusters: retry.clusters,
    reviewNotes: [...(retry.reviewNotes ?? []), `regenerated after critique: ${critique}`],
    attempts: 2,
    note: 'opus retry',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Persist
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize one model cluster into the stored `DefinitionCluster` shape: `pos` is
 * always a string[] (or null) and `reading` is always null for Spanish, so every
 * reader can treat the two languages' clusters identically.
 */
function toStoredCluster(c) {
  const pos = Array.isArray(c.pos) ? c.pos.filter(Boolean) : (c.pos ? [c.pos] : []);
  return {
    sense: String(c.sense).trim(),
    reading: null,
    pos: pos.length ? pos : null,
    gender: c.gender ?? null,
    frequencyScore: Number.isInteger(c.frequencyScore) ? c.frequencyScore : null,
    glosses: (c.glosses ?? []).map(g => String(g)),
  };
}

/**
 * The word-level friendly POS tags, unioned across clusters and de-duplicated. Consumed
 * by the example-sentence generator's per-token partOfSpeechDict. Abbreviations with no
 * friendly equivalent (phrase, proverb, letter, …) map to null and are dropped.
 */
function friendlyPosTags(clusters) {
  const tags = new Set();
  for (const c of clusters) {
    for (const p of c.pos ?? []) {
      const friendly = posAbbrevToFriendly(p);
      if (friendly) tags.add(friendly);
    }
  }
  return [...tags];
}

/**
 * Write one entry's clusters, and enforce the word/cluster frequency invariant in the
 * same statement: det."frequencyScore" == MAX(cluster.frequencyScore). Doing it here
 * rather than in a later pass is what stops the two numbers drifting apart — see the
 * header of scripts/backfill/shared/lib/senseClusters.js for the rule and its history.
 *
 * The word column is guarded separately from the clusters: a validator who approved
 * `frequencyScore` outranks the invariant, and the CASE leaves their number untouched
 * (the only way an entry can remain inconsistent, by design).
 *
 * @param {number|null} wordScore - the entry's current det."frequencyScore"
 */
async function writeClusters(client, id, clusters, wordScore) {
  const reconciled = reconcileFrequencyScore(wordScore, clusters);
  await client.query(
    `UPDATE dictionaryentries_es
        SET "definitionClusters" = $1::jsonb,
            "partsOfSpeech" = $2::jsonb,
            "frequencyScore" = CASE WHEN ${validatedClause(['frequencyScore'], 'dictionaryentries_es')}
                                    THEN $4::int ELSE "frequencyScore" END
      WHERE id = $3`,
    [
      JSON.stringify(reconciled.clusters ?? clusters),
      JSON.stringify(friendlyPosTags(clusters)),
      id,
      reconciled.wordScore,
    ]
  );
  await stampEntries(client, 'dictionaryentries_es', id);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }
  console.log('🚀 Spanish definition-cluster backfill');
  console.log(`   mode: ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE'}${isForce ? ' | --force (re-cluster)' : ''}`);
  if (targetWords?.length) console.log(`   scoped to: ${targetWords.join(', ')}`);
  console.log('');

  const client = await db.getClient();
  try {
    const params = targetWords?.length ? [targetWords] : [];
    const wordsFilter = targetWords?.length ? `AND word1 = ANY($1::text[])` : '';

    // Without --force, skip words an AI run already clustered. The seeded clusters from
    // migration 123 do NOT count as clustered — they are mechanical, one per old row —
    // so they are selected here on the first run. `enrichmentLog` is the discriminator:
    // the migration seeded clusters WITHOUT stamping a run, so an unstamped row is one
    // this script has never touched, however many clusters it already carries.
    const clusteredFilter = isForce
      ? ''
      : isStale
        ? `AND ${staleClause()}`
        : `AND NOT ("enrichmentLog" ? 'spanish/backfill-cluster-definitions')`;

    // Never rewrite a word a validator has reviewed. Two fields protect a row here:
    //   - 'definitions', because re-clustering changes how those definitions are
    //     PRESENTED (docs/DATA_VALIDATION_SYSTEM.md, migration 104);
    //   - 'senseFrequencyScore', because the per-cluster score this script writes is
    //     itself reviewable on the card's Commonality chip (migration 139), and a
    //     wholesale rewrite of `definitionClusters` would discard that review.
    const validatedFilter = `AND id NOT IN (
      SELECT val."entryId" FROM validations val
       WHERE val.language = 'es' AND val.field IN ('definitions','senseFrequencyScore')
         AND val.action IN ('approve','flag'))`;

    const { rows } = await client.query(
      `SELECT id, word1, definitions, "definitionClusters", "frequencyScore"
         FROM dictionaryentries_es
        WHERE language = 'es' AND discoverable = TRUE
          AND jsonb_array_length(definitions) > 0
          ${wordsFilter} ${clusteredFilter} ${validatedFilter}
        ORDER BY word1 ${isSpotCheck ? 'LIMIT 5' : ''}`,
      params
    );
    console.log(`📊 ${rows.length} word(s) to process\n`);

    let processed = 0, failed = 0, flagged = 0;

    for (const row of rows) {
      try {
        const senses = buildSenseInput(row);
        if (inputGlosses(senses).length === 0) {
          console.log(`  ${row.word1}: no glosses, skipped`);
          continue;
        }

        // Single-sense fast path (zero API calls), mirroring the zh clusterer: one gloss
        // means there is nothing to partition. The lone gloss becomes both the label and
        // the only gloss; frequencyScore is left null for the word-level scorer to own.
        let result;
        const flat = inputGlosses(senses);
        if (flat.length === 1) {
          result = {
            clusters: [{
              sense: flat[0],
              pos: senses[0].pos ? [senses[0].pos] : null,
              gender: senses[0].gender ?? null,
              frequencyScore: null,
              glosses: [flat[0]],
            }],
            reviewNotes: [],
            attempts: 0,
            note: 'single-gloss fast path',
          };
        } else {
          result = await runPipeline(row.word1, senses);
        }

        if (!result.clusters) {
          console.log(`  ❌ ${row.word1}: ${result.note}`);
          failed++;
          continue;
        }

        const stored = result.clusters.map(toStoredCluster);
        if (!isDryRun) await writeClusters(client, row.id, stored, row.frequencyScore);

        console.log(`  ${row.word1} → ${stored.length} cluster(s)${result.note ? '  (' + result.note + ')' : ''}`);
        for (const c of stored) {
          const tag = [c.pos?.join('/'), c.gender].filter(Boolean).join(' ');
          console.log(`      [${c.frequencyScore ?? '–'}] ${c.sense}${tag ? ` (${tag})` : ''}: ${c.glosses.join(' | ')}`);
        }
        if (result.reviewNotes?.length) {
          flagged++;
          for (const n of result.reviewNotes) {
            console.log(`  ${REVIEW_MARKER} ${row.word1} (id=${row.id}): ${n}`);
          }
        }
        processed++;
      } catch (err) {
        console.log(`  ❌ ${row.word1}: ${err.message}`);
        failed++;
      }
      await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Processed : ${processed}`);
    console.log(`Failed    : ${failed}`);
    console.log(`Flagged for review: ${flagged} entries`);
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
