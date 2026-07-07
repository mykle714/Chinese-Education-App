/**
 * Backfill Script: split a Chinese entry's flat `definitions` into orthogonal
 * SENSE CLUSTERS → writes the `definitionClusters` jsonb column (migration 90).
 *
 * Motivation: many headwords carry mutually-unrelated meanings (会 = "can" /
 * "will" / "to meet" / "meeting" / the kuai4 "to reckon accounts" sense). A
 * single globally-ranked list forces those orthogonal senses to interleave.
 * Clustering groups each sense, ranks glosses prototypical→vernacular WITHIN the
 * cluster, scores each cluster's register independently, and keeps clusters
 * themselves orthogonal. See docs/DEFINITION_CLUSTERS.md.
 *
 * Pipeline (per entry):
 *   Stage A — CLUSTER (Sonnet, Opus on retry): partition the entry's glosses
 *     into orthogonal sense clusters, verbatim (every input gloss → exactly one
 *     cluster; no add/rephrase/drop). Each cluster gets a sense label, a reading
 *     (heteronyms differ, e.g. 会计 kuai4), and pos. Clusters come back ordered
 *     most→least useful.
 *   Stage B — ORDER/PRUNE WITHIN each cluster, reusing the shared Pass-1/2
 *     gloss-ordering pipeline (lib/orderGlosses.js). Standalone-safe: works on
 *     raw cedict glosses too, since Pass-1 prunes broken/archaic glosses. (≤1
 *     gloss clusters skip the API.)
 *   Stage C — SCORE each cluster's vernacular register 1–5 (lib/vernacularScore.js),
 *     independently — the whole point of clustering (会 "can"=5 vs "accounts"=1).
 *
 * HUMAN REVIEW: there is no review file. Anything the clustering model is even
 * slightly unsure about (prompt rule 6 → reviewNotes), plus low-confidence
 * ordering and scoring failures, is printed to stdout as a "⚠ CLUSTER REVIEW"
 * line so the agent driving the mark-discoverable skill can detect and surface
 * it. Err toward over-flagging.
 *
 * OWNERSHIP: this script writes ONLY definitionClusters. The flat `definitions`
 * cache stays owned by backfill-process-definitions-array.js and is NOT touched
 * here (they intentionally diverge — see migration 90 / the docs). Difficulty
 * stays at the WORD level and is not duplicated per cluster.
 *
 * Usage:
 *   npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js               # discoverable, not-yet-clustered
 *   npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --all         # all zh entries (still skips clustered)
 *   npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --force       # re-cluster even if already set
 *   npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --spot-check  # 5 entries, NO writes, verbose
 *   npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --words=会,中  # specific words
 *   npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --ids=1,2,3
 *   npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --no-critic   # skip the Stage B critic
 *   npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --merge-pass  # Stage A.5: consolidate over-fine clusters
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog, cachedSystem } from '../run-log.js';
import { createGlossOrderer } from './lib/orderGlosses.js';
import { createVernacularScorer } from './lib/vernacularScore.js';

const SCRIPT_VERSION = 4; // bump when this script's logic/prompt changes (v4: Stage A.5 merge prompt no longer fuses etymologically-related but context-distinct senses, e.g. 月 moon vs month; v2: cluster single-definition entries too — dropped the `definitions > 1` gate; single-def uses a zero-API fast path, definition verbatim as the sense; cluster `pos` now always a string[] via toPosArray)

const isSpotCheck = process.argv.includes('--spot-check');
const includeAll  = process.argv.includes('--all');
const force       = process.argv.includes('--force');
const stale       = process.argv.includes('--stale'); // also re-cluster rows stamped below SCRIPT_VERSION
const skipCritic  = process.argv.includes('--no-critic');
const mergePass   = process.argv.includes('--merge-pass'); // Stage A.5 consolidation

const idsArg = process.argv.find(a => a.startsWith('--ids='));
const targetIds = idsArg ? idsArg.replace('--ids=', '').split(',').map(Number) : null;

const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const { stampEntries, staleClause } = initRunLog({ script: 'chinese/backfill-cluster-definitions', version: SCRIPT_VERSION, anthropic });

// Stage-A model is overridable via CLUSTER_MODEL env for A/B testing (e.g. run
// the whole pass on Opus); defaults to Sonnet. Retry escalation stays on Opus.
const CLUSTER_MODEL = process.env.CLUSTER_MODEL || 'claude-sonnet-4-6';
const RETRY_MODEL   = 'claude-opus-4-8';

// Opus 4.8 REJECTS the `temperature` param (400 "temperature is deprecated for this
// model"); Sonnet 4.6 still honors it. We want temperature 0 for a deterministic
// partition/merge (see 月 moon/month), so send it only to models that accept it —
// the Opus retry/escalation path must omit it or it errors.
const tempParams = (model) => /opus-4-8/.test(model) ? {} : { temperature: 0 };

// Stdout marker for anything needing human eyes. Kept greppable + consistent so
// the agent driving the mark-discoverable skill can detect and surface these.
const REVIEW_MARKER = '⚠ CLUSTER REVIEW';

// Shared cores (decision 5: one source of truth for ordering + register).
const { pass1Sort, pass2Critique } = createGlossOrderer({ anthropic, cachedSystem });
const { scoreVernacular } = createVernacularScorer({ anthropic });

// ─── Stage A: clustering prompt ───────────────────────────────────────────────

const CLUSTER_SYSTEM = `You are a Chinese linguistics expert grouping the English definitions of a Chinese word into sense clusters — each cluster one origin-sense (a prototype and its extensions) — for a modern (2020s) Mandarin learner's vocabulary card.`;

// Static instructions → cached system block; per-entry word/reading/glosses →
// user message (clusterUser). The entry's primary reading is interpolated into
// the per-entry message, not here, so this prefix stays byte-identical.
const CLUSTER_INSTRUCTIONS = `You are given a Chinese word and its English definitions (glosses). Partition the glosses into CLUSTERS. Each cluster is ONE core sense of the word — a group of glosses that mean the same thing. Aim for clean, precise senses; a separate consolidation pass will merge any clusters that turn out too similar, so do NOT force distinct ideas together here.

Rules:
1. PARTITION, never edit. Every input gloss must appear in exactly one cluster, copied character-for-character (including parentheticals/punctuation). Never add, rephrase, merge the text of, split, or drop a gloss. The union of all clusters' glosses must equal the input set exactly.

2. READING IS A HARD BOUNDARY. Each cluster has exactly one "reading". Every gloss in a cluster must be pronounceable with that reading. A gloss that takes a different reading belongs in a different cluster — ALWAYS, even if the meanings feel related. Never mix readings inside one cluster.

3. CLUSTER BY SHARED CORE IDEA. Within a single reading, put in ONE cluster the glosses that express the SAME core idea — near-synonyms, inflections, or one underlying image applied in a slightly different frame — even if they differ in part of speech, grammatical role, domain, or surface context. Those surface differences are NOT reasons to split. Split into different clusters when two groups of glosses are genuinely different senses. It is fine to err toward FINER, precise clusters here — a later consolidation pass will merge any that turn out too similar. Aim for clean, self-consistent atomic senses.

4. REGISTER SPLIT (the one exception that ADDS clusters). Within a single origin, if the glosses straddle a LARGE register/frequency gap — some are everyday modern usage while others are literary, classical, archaic, or narrowly technical — split that origin into register-homogeneous clusters (same reading and sense family, but grouped so each cluster's members share a similar register). This keeps the later per-cluster register score honest. Do NOT split for small register differences — only for a clear everyday-vs-literary/archaic gap (e.g. 别 everyday "don't …!" vs. literary "to part from").

5. Order the clusters most- to least-useful for a modern learner: frequent everyday senses first; archaic/literary/technical/dialectal senses last.

6. For each cluster provide:
   - "sense": a short English label (2–5 words) naming the shared meaning.
   - "reading": the numbered-pinyin reading for THIS sense. Use the entry's primary reading unless this sense is a genuine heteronym pronounced differently (e.g. 会 in 会计 "accounting" is kuai4, not hui4) — then give that reading.
   - "pos": the part(s) of speech for this sense — ALWAYS a JSON array of strings, even when only one applies (e.g. ["verb"] or ["verb","noun"]).
   - "glosses": the input glosses belonging to this sense (any order — they are re-ranked later).

7. FLAG YOUR UNCERTAINTY. If you are even slightly unsure about ANY decision, add a short note to "reviewNotes" so a human can double-check. Err heavily toward flagging — a false alarm is cheap, a wrong card is not. Flag things like: an ambiguous origin boundary (could reasonably split or merge), a gloss that plausibly belongs in two clusters, a register split you were unsure whether to make, an uncertain or guessed "reading" (especially heteronyms), a sense whose register/pos you're unsure of, broken/cryptic source glosses, or anything that just looks off. If you are fully confident, return an empty array.

Worked example (note the origin-merges: "can/know-how" and "likely to" are one modal origin; "meeting" senses stay together across noun/verb):
Word: 会  (primary reading: hui4)
Input: ["can","to know how to","to have the skill","to be likely to","to be sure to","meeting","gathering","to meet","to get together","association","group","(suffix) union","(bound form) a moment (Taiwan pr. [hui3])","(bound form) to reckon accounts"]
Output:
{
  "clusters": [
    {"sense":"to be able to / will (likely)","reading":"hui4","pos":["verb"],"glosses":["can","to know how to","to have the skill","to be likely to","to be sure to"]},
    {"sense":"to assemble / a meeting","reading":"hui4","pos":["verb","noun"],"glosses":["meeting","gathering","to meet","to get together","association","group","(suffix) union"]},
    {"sense":"a moment","reading":"hui4","pos":["noun"],"glosses":["(bound form) a moment (Taiwan pr. [hui3])"]},
    {"sense":"to reckon accounts","reading":"kuai4","pos":["verb"],"glosses":["(bound form) to reckon accounts"]}
  ],
  "reviewNotes": ["Merged 'to be likely to / sure to' with 'can / know how' as one modal origin (ability → probability); flag in case you'd separate future-probability."]
}

Return ONLY a valid JSON object with keys "clusters" and "reviewNotes", no explanation.`;

function clusterUser(word, primaryReading, definitions) {
  return `Word: ${word}  (primary reading: ${primaryReading})

Definitions:
${JSON.stringify(definitions, null, 2)}`;
}

// ─── Stage A.5: cluster consolidation (merge pass) ─────────────────────────────
// Stage A splits into fine, atomic senses; this second model reviews those
// candidate clusters and merges any that are too similar, so granularity is
// decided by a dedicated pass instead of over-tuning the split prompt. It only
// REGROUPS existing glosses — never edits/adds/drops — so the result is still an
// exact partition of the original input (re-checked with validatePartition).
const MERGE_SYSTEM = `You are a Chinese linguistics expert consolidating candidate sense clusters for a modern (2020s) Mandarin learner's vocabulary card.`;

const MERGE_INSTRUCTIONS = `You are given a Chinese word and a list of CANDIDATE sense clusters (each with a reading and a set of English glosses). The candidates were split conservatively and may be TOO fine-grained. Your job is to MERGE any clusters that a learner would reasonably treat as the same sense, and leave genuinely distinct senses apart.

Rules:
1. REGROUP ONLY, never edit text. You may only move whole glosses between clusters and combine clusters. Never add, rephrase, split the text of, or drop a gloss. Every input gloss must appear in exactly one output cluster, copied character-for-character. The union of all output glosses must equal the input set exactly.
2. NEVER merge clusters with different "reading" values. Reading is a hard boundary — a merged cluster's members must all share one reading.
3. Merge two clusters whenever their meanings are the same, overlap substantially, OR are connected as near-synonyms, a shared function, or one sense being a natural extension of the other. You do NOT need a learner to see them as identical — a clear thread of relation is enough.
4. For each output cluster provide:
   - "sense": a short English label (2–5 words) for the (possibly merged) meaning.
   - "reading": the shared numbered-pinyin reading.
   - "pos": the part(s) of speech — ALWAYS a JSON array of strings, even for a single POS (e.g. ["noun"]).
   - "glosses": all glosses belonging to this cluster (any order).
5. FLAG uncertainty in "reviewNotes": any merge you were unsure about, or two clusters you left apart but might belong together. Empty array if fully confident.

Return ONLY a valid JSON object with keys "clusters" and "reviewNotes", no explanation.`;

function mergeUser(word, clusters) {
  // Feed only the fields the merge decision needs (sense/reading/glosses).
  const candidates = clusters.map(c => ({ sense: c.sense, reading: c.reading, glosses: c.glosses }));
  return `Word: ${word}

Candidate clusters:
${JSON.stringify(candidates, null, 2)}`;
}

// Numbered-pinyin reading: one or more space-separated syllables (multi-character
// words/idioms are multi-syllable, e.g. "gong1 zuo4" 工作, "dui4 bu qi3" 对不起).
// Each syllable's tone digit (1-4, 5 = neutral) is OPTIONAL — the project's own
// numberedPinyin data drops it entirely for neutral tone ("de" 的, "le" 了, "men"
// 们), so cluster readings follow the same convention.
const READING_RE = /^[A-Za-z]+[1-5]?(?:\s[A-Za-z]+[1-5]?)*$/;

// Single syllable WITH an explicit tone digit — the narrower shape that
// participates in the same-syllable-different-tone heuristic below. A heteronym
// tone mix-up (see docs/DEFINITION_CLUSTERS_EVAL.md, Open issue #1) is a
// single-hanzi-character phenomenon; multi-syllable compound readings and
// digit-less neutral tones don't fit the same check.
const SINGLE_TONED_SYLLABLE_RE = /^[A-Za-z]+[1-5]$/;

// ─── Stage A validation ───────────────────────────────────────────────────────
// Stage A must be an exact PARTITION of the input glosses (pruning is Stage B's
// job). Verifies: well-formed cluster objects, every gloss assigned exactly once,
// verbatim, with no additions, and that each reading is well-formed numbered
// pinyin (catches garbled/missing tones, e.g. "gan" or "gan9").
function validatePartition(inputGlosses, clusters) {
  if (!Array.isArray(clusters) || clusters.length === 0) {
    return { ok: false, error: 'clusters not a non-empty array' };
  }
  const inputSet = new Set(inputGlosses);
  const seen = new Map(); // gloss → times assigned
  for (const c of clusters) {
    if (!c || typeof c.sense !== 'string' || !c.sense.trim()) return { ok: false, error: 'cluster missing sense label' };
    if (typeof c.reading !== 'string' || !c.reading.trim()) return { ok: false, error: `cluster "${c.sense}" missing reading` };
    if (!READING_RE.test(c.reading.trim())) return { ok: false, error: `cluster "${c.sense}" has malformed reading (expected syllable+tone digit): ${JSON.stringify(c.reading)}` };
    if (!Array.isArray(c.glosses) || c.glosses.length === 0) return { ok: false, error: `cluster "${c.sense}" has no glosses` };
    for (const g of c.glosses) {
      if (!inputSet.has(g)) return { ok: false, error: `cluster gloss not in input (added/rephrased): ${JSON.stringify(g)}` };
      seen.set(g, (seen.get(g) || 0) + 1);
    }
  }
  const duped = [...seen.entries()].filter(([, n]) => n > 1).map(([g]) => g);
  if (duped.length) return { ok: false, error: `gloss assigned to multiple clusters: ${JSON.stringify(duped)}` };
  const missing = inputGlosses.filter(g => !seen.has(g));
  if (missing.length) return { ok: false, error: `gloss not assigned to any cluster: ${JSON.stringify(missing)}` };
  return { ok: true };
}

// A wrong Stage-A tone can't be caught by exact-partition validation (the
// reading is well-formed, just factually wrong — e.g. 干 "tree trunk" tagged
// gan1 instead of gan4). It also can't be fixed by the merge pass, since merge
// refuses to cross a reading boundary (see docs/DEFINITION_CLUSTERS_EVAL.md,
// Open issue #1). The one structural signal available without a ground-truth
// reading list: two clusters landing on the SAME syllable but DIFFERENT tones
// is exactly the shape a tone typo takes, so flag it for human review rather
// than trusting the split silently.
function flagSameSyllableToneMismatch(clusters) {
  const notes = [];
  const tonesBySyllable = new Map(); // lowercased syllable → Set(reading strings)
  for (const c of clusters) {
    if (!SINGLE_TONED_SYLLABLE_RE.test(c.reading)) continue;
    const syllable = c.reading.slice(0, -1).toLowerCase();
    if (!tonesBySyllable.has(syllable)) tonesBySyllable.set(syllable, new Set());
    tonesBySyllable.get(syllable).add(c.reading);
  }
  for (const [syllable, readings] of tonesBySyllable) {
    if (readings.size > 1) {
      notes.push(`possible tone mix-up: clusters on ${[...readings].join('/')} share syllable "${syllable}" — verify each cluster's tone is correct`);
    }
  }
  return notes;
}

// Normalize a cluster `pos` to the canonical array shape (`string[] | null`).
// Stage-A model output may be a bare string ("verb") or an array (["verb","noun"]);
// the fast path passes the word-level partsOfSpeech array. We always store an array
// so every consumer sees one shape (single-POS senses → a 1-element array).
function toPosArray(pos) {
  if (pos == null) return null;
  const arr = (Array.isArray(pos) ? pos : [pos]).filter(p => typeof p === 'string' && p.trim());
  return arr.length ? arr : null;
}

async function callCluster(word, primaryReading, definitions, model) {
  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    ...tempParams(model), // temperature 0 (Sonnet); omitted for Opus 4.8 which rejects it
    system: cachedSystem(`${CLUSTER_SYSTEM}\n\n${CLUSTER_INSTRUCTIONS}`),
    messages: [{ role: 'user', content: clusterUser(word, primaryReading, definitions) }],
  });
  const raw = response.content[0].text;
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (!objMatch) return { error: 'no object in response', raw };
  let parsed;
  try { parsed = JSON.parse(objMatch[0]); }
  catch (e) { return { error: `JSON parse: ${e.message}`, raw }; }
  if (!parsed || !Array.isArray(parsed.clusters)) return { error: 'missing clusters array', parsed };
  const v = validatePartition(definitions, parsed.clusters);
  if (!v.ok) return { error: v.error, parsed };
  // reviewNotes is the model's own "I'm not fully sure" channel (prompt rule 6).
  const reviewNotes = Array.isArray(parsed.reviewNotes)
    ? parsed.reviewNotes.filter(n => typeof n === 'string' && n.trim())
    : [];
  return { clusters: parsed.clusters, reviewNotes };
}

async function clusterEntry(word, primaryReading, definitions) {
  const first = await callCluster(word, primaryReading, definitions, CLUSTER_MODEL);
  if (!first.error) return { ...first, model: CLUSTER_MODEL };
  const retry = await callCluster(word, primaryReading, definitions, RETRY_MODEL);
  if (!retry.error) return { ...retry, model: RETRY_MODEL, retried: true, firstError: first.error };
  return { error: `clustering failed both models (sonnet: ${first.error}, opus: ${retry.error})` };
}

// Stage A.5 — consolidate over-fine clusters. Returns merged clusters (validated
// as an exact partition of `definitions`) plus any merge reviewNotes, or the
// ORIGINAL clusters unchanged if the merge model errors/fails validation (the
// merge pass must never lose a gloss, so on any doubt we keep Stage A's output).
async function mergeClusters(word, definitions, clusters, model) {
  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    ...tempParams(model), // temperature 0 (Sonnet); omitted for Opus 4.8 which rejects it
    system: cachedSystem(`${MERGE_SYSTEM}\n\n${MERGE_INSTRUCTIONS}`),
    messages: [{ role: 'user', content: mergeUser(word, clusters) }],
  });
  const raw = response.content[0].text;
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (!objMatch) return { error: 'no object in merge response' };
  let parsed;
  try { parsed = JSON.parse(objMatch[0]); }
  catch (e) { return { error: `merge JSON parse: ${e.message}` }; }
  if (!parsed || !Array.isArray(parsed.clusters)) return { error: 'merge missing clusters array' };
  const v = validatePartition(definitions, parsed.clusters);
  if (!v.ok) return { error: `merge broke partition: ${v.error}` };
  const reviewNotes = Array.isArray(parsed.reviewNotes)
    ? parsed.reviewNotes.filter(n => typeof n === 'string' && n.trim())
    : [];
  return { clusters: parsed.clusters, reviewNotes };
}

// ─── Review flagging (stdout) ─────────────────────────────────────────────────
// No file log: anything the clustering model is even slightly unsure about is
// printed to stdout with REVIEW_MARKER so the calling agent (mark-discoverable
// skill) can detect and surface it for human review. Each note is one line.
function printReviewFlags(word, id, notes) {
  for (const note of notes) {
    console.log(`${REVIEW_MARKER} ${word} (id=${id}): ${note}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const modeLabel = isSpotCheck ? 'SPOT CHECK (no writes)'
    : targetWords?.length ? `scoped to: ${targetWords.join(', ')}`
    : includeAll ? 'ALL zh entries' : 'discoverable zh entries';
  const filterLabel = force ? ' (re-clustering, --force)' : ' (not-yet-clustered only)';
  console.log(`Starting definition-clustering backfill — ${modeLabel}${filterLabel}${skipCritic ? ' [no critic]' : ''}\n`);

  const client = await db.getClient();

  try {
    // Every entry with ≥1 definition is clustered (single-gloss words too — they
    // become a trivial one-cluster array, never left NULL, so downstream consumers
    // like backfill-example-sentences that key on "definitionClusters IS NULL" treat
    // them as clustered). --force re-clusters; otherwise skip already-set rows.
    const { rows: entries } = await client.query(
      targetIds
        ? `SELECT id, word1, pronunciation, "numberedPinyin", definitions, "partsOfSpeech", "vernacularScore"
           FROM dictionaryentries_zh WHERE id = ANY($1) ORDER BY id ASC`
        : targetWords?.length
        ? `SELECT id, word1, pronunciation, "numberedPinyin", definitions, "partsOfSpeech", "vernacularScore"
           FROM dictionaryentries_zh
           WHERE language = 'zh' AND word1 = ANY($1)
             AND jsonb_array_length(definitions) >= 1
           ORDER BY id ASC`
        : `SELECT id, word1, pronunciation, "numberedPinyin", definitions, "partsOfSpeech", "vernacularScore"
           FROM dictionaryentries_zh
           WHERE language = 'zh'
             ${includeAll ? '' : 'AND discoverable = TRUE'}
             AND jsonb_array_length(definitions) >= 1
             ${force ? '' : stale ? `AND ("definitionClusters" IS NULL OR ${staleClause()})` : 'AND "definitionClusters" IS NULL'}
           ORDER BY id ASC
           ${isSpotCheck ? 'LIMIT 5' : ''}`,
      targetIds ? [targetIds] : targetWords?.length ? [targetWords] : []
    );

    console.log(`Found ${entries.length} entries to cluster\n`);

    let updated = 0, failed = 0, opusRetries = 0;
    let totalClusters = 0, multiClusterWords = 0, flaggedEntries = 0;

    for (const row of entries) {
      const definitions = Array.isArray(row.definitions)
        ? row.definitions
        : JSON.parse(row.definitions || '[]');
      const primaryReading = row.numberedPinyin || row.pronunciation || '';

      if (definitions.length === 0) { console.log(`  [${row.id}] ${row.word1} — no definitions, skipped`); continue; }

      try {
        process.stdout.write(`  [${row.id}] ${row.word1} (${definitions.length} defs) ... `);

        let finalClusters;
        let reviewNotes;

        if (definitions.length === 1) {
          // ── Fast path (zero API calls) ──────────────────────────────────────
          // A single-definition entry is trivially one cluster, so skip EVERY model
          // call — Stage A split, A.5 merge, B ordering, C scoring — and use the lone
          // definition verbatim as BOTH the sense label and the cluster's only gloss.
          // `pos`/`vernacularScore` are pulled straight from the WORD-LEVEL columns
          // (`partsOfSpeech`, `vernacularScore`) instead of re-deriving them per cluster:
          // for a single-sense word the word-level values already describe that one
          // sense, so no API call is needed. Both fall back to null if their column
          // isn't populated yet (e.g. clustering run standalone before those backfills;
          // in the mark-discoverable pipeline both run before clustering). There is
          // nothing for a human to review, so reviewNotes is empty.
          const gloss = String(definitions[0]);
          finalClusters = [{
            sense: gloss,
            reading: primaryReading,
            pos: toPosArray(row.partsOfSpeech),
            vernacularScore: row.vernacularScore != null ? Number(row.vernacularScore) : null,
            glosses: [gloss],
          }];
          reviewNotes = [];
        } else {
          // Stage A — cluster (fine, atomic senses)
          const c = await clusterEntry(row.word1, primaryReading, definitions);
          if (c.error) { console.log(`FAIL cluster (${c.error})`); failed++; continue; }
          if (c.retried) opusRetries++;

          // Collect everything a human should double-check. Seeded by the model's
          // own uncertainty (prompt rule 6), then augmented with low-confidence
          // signals from the per-cluster ordering critic + scoring failures.
          reviewNotes = [...c.reviewNotes, ...flagSameSyllableToneMismatch(c.clusters)];

          // Stage A.5 — consolidate over-fine clusters (opt-in). On any error we
          // keep Stage A's clusters (the merge pass must never lose a gloss).
          let clusters = c.clusters;
          if (mergePass && clusters.length > 1) {
            const m = await mergeClusters(row.word1, definitions, clusters, CLUSTER_MODEL);
            if (m.error) {
              reviewNotes.push(`merge pass skipped (${m.error})`);
            } else {
              clusters = m.clusters;
              reviewNotes.push(...flagSameSyllableToneMismatch(clusters));
              reviewNotes.push(...m.reviewNotes);
            }
          }

          // Stages B + C — order/prune + score each cluster
          finalClusters = [];
          for (const cluster of clusters) {
            let glosses = cluster.glosses;

            // Stage B: reuse the shared Pass-1/2 ordering+pruning. Skip the API
            // for trivial (≤1 gloss) clusters — nothing to reorder.
            if (glosses.length > 1) {
              const p1 = await pass1Sort(row.word1, glosses);
              if (!p1.error) {
                if (p1.retried) opusRetries++;
                glosses = p1.order;
                if (!skipCritic) {
                  const p2 = await pass2Critique(row.word1, cluster.glosses, p1.order);
                  if (!p2.error) {
                    glosses = p2.order;
                    if (p2.retried) opusRetries++;
                    // The ordering critic is itself unsure about this cluster's gloss order.
                    if (p2.action === 'low_confidence') {
                      reviewNotes.push(`uncertain gloss order in "${cluster.sense}" cluster${p2.reason ? `: ${p2.reason}` : ''}`);
                    }
                  }
                }
              }
              // On ordering failure, keep the model's original cluster order.
            }

            // Stage C: per-cluster vernacular register (1–5), scored independently.
            let vernacularScore = null;
            try {
              const s = await scoreVernacular(row.word1, cluster.reading, glosses);
              vernacularScore = s.score;
            } catch {
              reviewNotes.push(`vernacular score failed for "${cluster.sense}" cluster (left null)`);
            }

            finalClusters.push({
              sense: cluster.sense,
              reading: cluster.reading,
              pos: toPosArray(cluster.pos),
              vernacularScore,
              glosses,
            });
          }
        }

        totalClusters += finalClusters.length;
        if (finalClusters.length > 1) multiClusterWords++;
        if (reviewNotes.length) flaggedEntries++;

        if (isSpotCheck) {
          console.log(`${finalClusters.length} cluster(s)`);
          for (const fc of finalClusters) {
            console.log(`      • [${fc.reading}] ${fc.sense}  (v=${fc.vernacularScore}, pos=${JSON.stringify(fc.pos)})`);
            console.log(`          ${JSON.stringify(fc.glosses)}`);
          }
          printReviewFlags(row.word1, row.id, reviewNotes);
          continue; // no writes in spot-check
        }

        // Print review flags to stdout for the calling agent to surface.
        printReviewFlags(row.word1, row.id, reviewNotes);

        await client.query(
          `UPDATE dictionaryentries_zh SET "definitionClusters" = $1::jsonb WHERE id = $2`,
          [JSON.stringify(finalClusters), row.id]
        );
        await stampEntries(client, 'dictionaryentries_zh', row.id);
        updated++;
        console.log(`${finalClusters.length} cluster(s) written`);

        if (updated % 100 === 0) {
          console.log(`\n  Progress: ${updated}/${entries.length}\n`);
        }
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      // Rate-limit delay only matters after a real API call; the single-definition
      // fast path makes none, so don't sleep between those rows.
      if (definitions.length > 1) await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n' + '='.repeat(60));
    console.log('CLUSTERING SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total processed   : ${entries.length}`);
    if (isSpotCheck) {
      console.log(`(Spot check — no writes performed)`);
    } else {
      console.log(`Updated           : ${updated}`);
      console.log(`Failed/invalid    : ${failed}`);
    }
    console.log(`Total clusters    : ${totalClusters}`);
    console.log(`Multi-cluster words: ${multiClusterWords}`);
    console.log(`Flagged for review: ${flaggedEntries} entr${flaggedEntries === 1 ? 'y' : 'ies'} (see "${REVIEW_MARKER}" lines above)`);
    console.log(`Opus retries      : ${opusRetries}`);
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
