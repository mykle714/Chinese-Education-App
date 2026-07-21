/**
 * Backfill Script: AI-powered example sentences for dictionaryentries_zh
 *
 * For each discoverable zh entry, uses Claude AI to generate natural, contextually
 * appropriate example sentences. Each stored sentence includes Chinese, an English
 * translation, a `translatedVocab` pointer, a `sense` (the target word's
 * EXACT `definitionClusters` label), the authoritative GSA `segments`, and four
 * segment-keyed dicts — `partOfSpeechDict`, `numberDict`, `tenseDict`, `senseDict`.
 *
 * TWO-PHASE PIPELINE (generation → segment-wise tagging):
 *   Generation emits ONLY sentence text + `translatedVocab` + `sense`
 *   (target, multi-sense) + `targetPos` (the target word's POS, used solely for
 *   coverage steering; NOT stored). A separate post-generation pass
 *   (tagSentenceSegments) then runs the SAME greedy segmentation the read path uses
 *   and tags EACH segment with its contextual POS, sense (from THAT segment's own
 *   clusters), number (nouns), and tense (verbs) — all keyed by the GSA segment
 *   string. Segmentation is persisted (`segments`) so read-time lookups align exactly.
 *   This replaced the old design where generation emitted an AI-token-keyed
 *   partOfSpeechDict/numberDict that could misalign with the read-time segmentation,
 *   and where `tense` was a single sentence-level label (wrong for a sentence with two
 *   verbs in different tenses). See docs/EXAMPLE_SENTENCES.md.
 *
 * SENSE TAGGING (replaces the old `segmentGloss`):
 *   The senses come from `definitionClusters` (migration 90; see
 *   docs/DEFINITION_CLUSTERS.md), so **clustering MUST run before this script**
 *   (the mark-discoverable §A pipeline is ordered accordingly). Two prompt shapes:
 *     • Multi-sense entry → the sense list is passed in and the model must pick
 *       one label per sentence, verbatim; the pick is validated against the list.
 *     • Single-sense entry → a DIFFERENT prompt is used that never mentions senses
 *       (nothing to disambiguate); the one sense label is auto-filled server-side.
 *   Entries that are not yet clustered (`definitionClusters` IS NULL) are SKIPPED
 *   with a warning — every generated sentence is guaranteed a validated sense.
 *
 * COVERAGE: the generator is asked to cover (a) every part of speech the word can
 * take, and (b) every sense scored 4–5 (the vernacular/common senses). After the
 * batch, any uncovered POS or high-value sense is backfilled one sentence at a time.
 *
 * PROMPT CACHING: the large static instruction set is hoisted into a cached
 * `system` block (cachedSystem); only the small per-entry tail (word, senses,
 * counts) rides in the user message, so consecutive entries reuse the cached prefix.
 *
 * Multi-agent pipeline (mirrors backfill-expansion-claude.js):
 *   1. Generator agent (Sonnet) → proposes the batch of sentences
 *   2. Shape check (isValidSentenceShape) + sense-membership check
 *   3. Validator agent (Sonnet) → flags common AI mistakes per sentence
 *   4. Repair agent (Opus) → for each flagged sentence, drafts a corrected
 *      replacement informed by the validator's critique, re-validated once
 *   5. Tagging pass (Sonnet, tagSentenceSegments) → per-sentence: GSA-segment the
 *      final text, then tag each segment with POS + sense + number
 *
 * Usage:
 *   npx tsx /app/scripts/backfill-example-sentences.js             # full backfill
 *   npx tsx /app/scripts/backfill-example-sentences.js --spot-check # test 3 entries
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { ALLOWED_POS_TAGS } from '../shared/lib/posTags.js';
import { initRunLog, cachedSystem } from '../run-log.js';
import {
  getAllSubstrings,
  buildDictMap,
  buildExcludeSet,
  segmentWithDict,
} from '../../../dal/shared/segmentString.js';
const SCRIPT_VERSION = 6; // bump when this script's logic/prompt changes (v6: move `tense` from a single sentence-level generation field to a per-verb segment-keyed `tenseDict` emitted by the tagging pass; generation no longer emits `tense`) (v5: pull per-token POS/number out of generation into a post-generation segment-wise tagging pass — GSA-segment-keyed partOfSpeechDict/numberDict/senseDict + persisted `segments`; generation now emits only `targetPos` for coverage)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries, validatedClause, staleClause } = initRunLog({ script: 'chinese/backfill-example-sentences', version: SCRIPT_VERSION, anthropic: anthropic });
// This script regenerates the WHOLE exampleSentences array, so skip any entry
// whose example sentences a validator has approved/flagged (migration 104,
// docs/DATA_VALIDATION_SYSTEM.md).
const validatedFilter = `AND ${validatedClause(['exampleSentence0', 'exampleSentence1', 'exampleSentence2'], 'dictionaryentries_zh')}`;
const isStale = process.argv.includes('--stale');

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
// Targeted runs enrich the named words regardless of discoverable (worker candidates
// are not-yet-discoverable); untargeted full runs keep the discoverable gate.
const discoverableGate = targetWords?.length ? '' : 'AND discoverable = TRUE';

const emptinessFilter = isAllDiscoverable
  ? ''
  : (isStale
      // --stale: also regenerate rows stamped below SCRIPT_VERSION (bumps invalidate old sentences).
      ? `AND ("exampleSentences" IS NULL OR "exampleSentences" = '[]'::jsonb OR ${staleClause()})`
      : `AND ("exampleSentences" IS NULL OR "exampleSentences" = '[]'::jsonb)`);

// ─────────────────────────────────────────────────────────────────────────────
//  Models — generation + validation run on Sonnet; the repair step escalates to
//  Opus for higher-quality corrections of any sentence the validator flags.
// ─────────────────────────────────────────────────────────────────────────────
const GENERATOR_MODEL = 'claude-sonnet-4-6';
const VALIDATOR_MODEL = 'claude-sonnet-4-6';
const REGENERATOR_MODEL = 'claude-opus-4-8';
// Post-generation segment-wise tagger (POS + sense + number per GSA segment).
const TAGGER_MODEL = 'claude-sonnet-4-6';

const ALLOWED_TENSES = new Set(['past', 'present', 'future']);
const ALLOWED_NUMBERS = new Set(['singular', 'plural']);
const ALLOWED_POS_TAG_SET = new Set(ALLOWED_POS_TAGS);
const ALLOWED_POS_LINE = ALLOWED_POS_TAGS.join(', ');

// A sense qualifies as a coverage target when its per-cluster vernacularScore is
// at least this — i.e. the common/vernacular senses a learner is most likely to meet.
const HIGH_VALUE_SENSE_SCORE = 4;

// Minimum number of senses a multi-sense word must be steered to cover — a floor
// so diversity steering never fully switches off even for a 2-sense word whose
// scores are both low (see selectCoverageSenses + buildSenseContext).
const MIN_COVERAGE_SENSES = 2;

// True when a cluster's POS list marks it a bound form (e.g. 节's "to save" =
// 节约/节省 — 节 never stands alone as a verb). Bound-form senses can't form a
// natural STANDALONE sentence, so they're ranked below equally-scored free senses
// as coverage targets — a free sense fills the slot cleanly instead of forcing a
// bound compound (which the single-sentence re-roll then tends to fail on).
function isBoundFormCluster(c) {
  return Array.isArray(c.pos) && c.pos.some(p => typeof p === 'string' && p.toLowerCase().includes('bound'));
}

// The set of POS tags the word can carry in a NATURAL STANDALONE sentence — i.e.
// POS tags that appear in at least one NON-bound-form cluster. A POS that occurs
// only in bound-form senses (e.g. 节's "verb", which lives solely in the bound
// 节约/节省) can't head its own sentence, so it must be excluded from the POS
// coverage targets — otherwise the coverage re-roll keeps firing on an impossible
// role and fabricates a redundant, off-target sentence. Ties the POS-coverage axis
// to the same bound-form reality selectCoverageSenses already respects.
function coverablePosSet(clusters) {
  const set = new Set();
  for (const c of clusters) {
    if (isBoundFormCluster(c) || !Array.isArray(c.pos)) continue;
    for (const p of c.pos) if (typeof p === 'string' && p.trim()) set.add(p);
  }
  return set;
}

// Pick the coverage-target senses (the senses the generator is REQUIRED to
// demonstrate) for a multi-sense entry, sized to `desired` (the sentence budget).
// Ranking: vernacularScore desc → free forms before bound forms → original order.
// The required set = every register-≥-HIGH_VALUE_SENSE_SCORE sense, extended down
// the ranking until it reaches `desired` senses (capped at the senses that exist).
// This guarantees (a) a word whose senses are all register 1–3 (e.g. 节, top score
// 3) still gets a spread rather than none, and (b) enough distinct senses to fill
// every sentence slot, so extra slots don't collapse into duplicates.
function selectCoverageSenses(clusters, desired) {
  const ranked = clusters
    .map((c, i) => ({ sense: c.sense, score: Number(c.vernacularScore) || 0, bound: isBoundFormCluster(c), i }))
    .sort((a, b) => b.score - a.score || Number(a.bound) - Number(b.bound) || a.i - b.i);

  const highValueCount = ranked.filter(c => c.score >= HIGH_VALUE_SENSE_SCORE).length;
  // Always include every high-value sense; then top up to the sentence budget
  // (but never request more senses than the word actually has).
  const n = Math.min(ranked.length, Math.max(highValueCount, desired, MIN_COVERAGE_SENSES));
  return ranked.slice(0, n).map(c => c.sense);
}

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
- "translation_mismatch": The English translation does not faithfully match the Chinese meaning or clause structure.`;

// ─────────────────────────────────────────────────────────────────────────────
//  Static prompt fragments (no per-entry data → safe to hoist into a cached
//  `system` block). Everything variable (the word, its senses, the counts) is
//  supplied in the user message so the cached prefix stays byte-identical across
//  entries. See cachedSystem() in run-log.js for the caching contract.
// ─────────────────────────────────────────────────────────────────────────────
const PERSONA = `You are a Chinese language teacher creating example sentences for a vocabulary app.`;

// Per-sentence field rules shared by every generation path. Refers to "the target
// word" generically (the concrete word arrives in the user message).
const CORE_FIELD_RULES = `Each sentence must:
- Use the target word naturally, exactly as a native speaker would
- Be simple enough for an intermediate learner (HSK 3–4 level vocabulary otherwise)
- Have an accurate English translation
- Mirror the punctuation of the Chinese sentence in the English translation — if the Chinese uses a comma to separate two clauses, use a comma in the same position in English; match question marks, exclamation points, etc.
- Match the clause structure of the Chinese sentence — if the Chinese has two clauses separated by a conjunction or comma, the English should have two parallel clauses in the same order
- Include a "translatedVocab" field: the English word or short phrase in your English translation that directly corresponds to the target word (e.g. if the word is 贴 and the sentence is "She stuck the photo on the wall.", translatedVocab is "stuck")
- Include a "targetPos" field: the part of speech the TARGET word carries IN THIS sentence — one of: ${ALLOWED_POS_LINE}. If the target word is a verb but is used as a gerund or nominal subject/object here (e.g. 下单很简单 — "Ordering is simple"), tag it "noun", not "verb". (Per-segment POS for the whole sentence is derived later by a separate pass — you only report the target word's role here.)`;

// Extra rule appended ONLY for multi-sense entries: the model must pick a sense
// label per sentence. This is what the code validates against the provided list.
const SENSE_FIELD_RULE = `- Include a "sense" field: the EXACT sense label (copied verbatim from the "Senses" list in the message below) that the target word carries IN THIS sentence. It MUST be one of the provided labels, character-for-character — never invent, translate, paraphrase, shorten, or combine labels.`;

const VARIETY_RULE = `Vary the sentence structure so the set doesn't feel templated. Do NOT start most sentences with a time word followed by a verb, and avoid leaning on a single repeated mold: vary the sentence-initial element, include a question where natural, and draw on a diverse range of grammatical constructions.`;

// Coverage guidance differs by prompt shape.
const COVERAGE_MULTI = `Aim to cover BOTH dimensions listed in the message below: (a) every part of speech the target word can take, and (b) every sense marked "cover this sense". Give each its own sentence where possible — a single sentence may satisfy one POS and one sense at once.

Maximize the number of DISTINCT senses shown across the set. Do NOT write two sentences that demonstrate the same sense (identical "sense" value) while any other listed sense still has no sentence — spend each remaining slot on a sense not yet shown. Only repeat a sense once every listed sense has appeared at least once, or when a sense simply cannot form a natural standalone sentence (e.g. a bound form). Near-duplicate sentences for the same meaning (e.g. two "Spring Festival is the most important holiday" variants) are the specific failure to avoid.`;
const COVERAGE_SINGLE = `Aim to give the target word a variety of grammatical roles and contexts — ideally at least one sentence for every part of speech it can take.`;

// JSON output templates. The "sense" key is present only in the multi-sense template.
const JSON_ARRAY_TEMPLATE_MULTI = `Respond with ONLY a JSON array of the requested number of objects. Fill in every field of the template below for each sentence — do not skip, rename, or omit any key, and every string value must be immediately preceded by its key name (e.g. "english": "..."); never write a bare string value with no key name before it:
[
  {
    "foreignText": "<Chinese sentence>",
    "english": "<English translation>",
    "translatedVocab": "<english word or phrase>",
    "sense": "<one of the provided sense labels, verbatim>",
    "targetPos": "<pos_tag the target word carries here>"
  }
]`;
const JSON_ARRAY_TEMPLATE_SINGLE = `Respond with ONLY a JSON array of the requested number of objects. Fill in every field of the template below for each sentence — do not skip, rename, or omit any key, and every string value must be immediately preceded by its key name (e.g. "english": "..."); never write a bare string value with no key name before it:
[
  {
    "foreignText": "<Chinese sentence>",
    "english": "<English translation>",
    "translatedVocab": "<english word or phrase>",
    "targetPos": "<pos_tag the target word carries here>"
  }
]`;
const JSON_OBJECT_TEMPLATE_MULTI = `Respond with ONLY one JSON object. Fill in every field of the template below — do not skip, rename, or omit any key, and every string value must be immediately preceded by its key name:
{"foreignText": "...", "english": "...", "translatedVocab": "...", "sense": "<one of the provided sense labels, verbatim>", "targetPos": "<pos_tag the target word carries here>"}`;
const JSON_OBJECT_TEMPLATE_SINGLE = `Respond with ONLY one JSON object. Fill in every field of the template below — do not skip, rename, or omit any key, and every string value must be immediately preceded by its key name:
{"foreignText": "...", "english": "...", "translatedVocab": "...", "targetPos": "<pos_tag the target word carries here>"}`;

// Assembled, cached system prompts (four shapes: batch/single-object × multi/single-sense).
// Concatenation happens once at module load, so each constant is byte-stable → cacheable.
const SYSTEM_BATCH_MULTI = [PERSONA, `The word below has several distinct senses; show a range of them across the sentences.`, CORE_FIELD_RULES, SENSE_FIELD_RULE, VARIETY_RULE, COVERAGE_MULTI, JSON_ARRAY_TEMPLATE_MULTI].join('\n\n');
const SYSTEM_BATCH_SINGLE = [PERSONA, `Write several example sentences for the single-meaning word below.`, CORE_FIELD_RULES, VARIETY_RULE, COVERAGE_SINGLE, JSON_ARRAY_TEMPLATE_SINGLE].join('\n\n');
const SYSTEM_ONE_MULTI = [PERSONA, `Write ONE example sentence for the word below (which has several distinct senses).`, CORE_FIELD_RULES, SENSE_FIELD_RULE, JSON_OBJECT_TEMPLATE_MULTI].join('\n\n');
const SYSTEM_ONE_SINGLE = [PERSONA, `Write ONE example sentence for the single-meaning word below.`, CORE_FIELD_RULES, JSON_OBJECT_TEMPLATE_SINGLE].join('\n\n');

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

// ─────────────────────────────────────────────────────────────────────────────
//  Sense helpers — read the entry's definitionClusters (migration 90).
// ─────────────────────────────────────────────────────────────────────────────

// Human-readable senses block for the user message. Each line shows the exact
// label the model must copy into the "sense" field, plus pos/register/glosses
// as disambiguating context.
function formatSenses(clusters) {
  return clusters.map((c) => {
    const pos = c.pos?.join('/');  // definitionClusters.pos is always string[] | null
    const glosses = Array.isArray(c.glosses) ? c.glosses.join('; ') : '';
    const score = c.vernacularScore;
    return `- "${c.sense}"${pos ? ` (${pos})` : ''}${score != null ? ` [register ${score}/5]` : ''}${glosses ? ` — ${glosses}` : ''}`;
  }).join('\n');
}

// Mechanical shape check for a single GENERATED sentence object (core fields +
// the target word's POS). Per-segment POS/number/sense/tense are no longer part
// of generation — they are produced later by tagSentenceSegments — so this only
// validates what the generator emits. Does NOT check `sense`: sense validation is
// mode-dependent and handled by the caller (membership check for multi-sense;
// auto-fill for single).
function isValidSentenceShape(s) {
  return !!(
    s &&
    typeof s.foreignText === 'string' && s.foreignText.length > 0 &&
    typeof s.english === 'string' && s.english.length > 0 &&
    typeof s.translatedVocab === 'string' && s.translatedVocab.trim().length > 0 &&
    typeof s.targetPos === 'string' && ALLOWED_POS_TAG_SET.has(s.targetPos)
  );
}

/**
 * Finalize a parsed sentence for a given sense-mode:
 *   • single-sense → auto-fill the one sense label (the model was never asked for it)
 *   • multi-sense  → require the model-picked `sense` to be one of the valid labels
 * Returns the finalized sentence, or null if it fails the shape or sense check.
 */
function finalizeSentence(parsed, { isSingleSense, singleSenseLabel, senseLabelSet }) {
  if (!parsed || !isValidSentenceShape(parsed)) return null;
  if (isSingleSense) {
    parsed.sense = singleSenseLabel;
    return parsed;
  }
  return typeof parsed.sense === 'string' && senseLabelSet.has(parsed.sense) ? parsed : null;
}

/**
 * Render the per-slot sense assignment for the multi-sense batch prompt (SOFT
 * assignment). Each required sense (already ranked + budget-sized by
 * selectCoverageSenses) is SUGGESTED for one sentence slot, so the batch itself
 * emits one sentence per distinct sense — making duplicates the exception rather
 * than something the coverage re-roll has to patch after the fact. Assignment is
 * advisory: the model may deviate when a sense can't form a natural sentence
 * (e.g. a bound form), and the code-side coverage loop still backstops any gap.
 * Extra slots (when the sentence budget exceeds the number of required senses —
 * a word with many POS but few senses) are left free and steered toward an
 * as-yet-uncovered sense or part of speech.
 */
function buildSlotAssignmentBlock(assignedSenses, sentenceCount) {
  if (!assignedSenses.length) {
    // No required set (shouldn't happen for multi-sense post-selection, but stay safe):
    // fall back to the generic "show a range" nudge.
    return 'Show a range of the senses listed above; give each its own sentence where one reads naturally.';
  }
  const slotLines = [];
  for (let i = 0; i < sentenceCount; i++) {
    slotLines.push(i < assignedSenses.length
      ? `  Sentence ${i + 1} — demonstrate sense: "${assignedSenses[i]}"`
      : `  Sentence ${i + 1} — free: use any sense not yet shown above, or an uncovered part of speech`);
  }
  return `Suggested sense for each sentence (deviate ONLY if an assigned sense cannot form a natural, native sentence — e.g. a bound form — and if so, cover a DIFFERENT not-yet-shown sense instead of repeating one):
${slotLines.join('\n')}`;
}

/**
 * Ask Claude to generate a batch of natural example sentences for a Chinese word.
 * Returns the raw parsed array (not shape/sense-filtered) or null if unparseable.
 * Static instructions ride in a cached system prompt; only per-entry data is in user.
 */
async function generateSentenceBatch({ word, pronunciation, senseCtx, posList, sentenceCount }) {
  const posLine = posList.length > 0 ? posList.join(', ') : '(any)';
  const userText = senseCtx.isSingleSense
    ? `Target word: ${word} (${pronunciation})
Meaning: ${senseCtx.meaningText}
Parts of speech to cover: ${posLine}

Write exactly ${sentenceCount} sentences.`
    : `Target word: ${word} (${pronunciation})

Senses (choose each sentence's "sense" value from these labels, verbatim):
${senseCtx.sensesText}

${buildSlotAssignmentBlock(senseCtx.highValueSenses, sentenceCount)}
Parts of speech to cover: ${posLine}

Write exactly ${sentenceCount} sentences.`;

  const response = await anthropic.messages.create({
    model: GENERATOR_MODEL,
    max_tokens: Math.max(1000, 400 * sentenceCount),
    temperature: 0.7,
    system: cachedSystem(senseCtx.isSingleSense ? SYSTEM_BATCH_SINGLE : SYSTEM_BATCH_MULTI),
    messages: [{ role: 'user', content: userText }],
  });

  return parseJsonFromResponse(response.content[0].text, { array: true });
}

/**
 * Ask Claude to generate exactly ONE natural example sentence — used to backfill a
 * missing/malformed slot without re-rolling the whole batch. `target`, when given,
 * pins the sentence to a specific coverage need (a POS role or a sense) so the
 * batch's coverage gaps get filled. Returns a finalized (shape + sense valid)
 * sentence object, or null.
 */
async function generateSingleExampleSentence({ word, pronunciation, senseCtx, posList, target }) {
  let targetClause = '';
  if (target?.kind === 'pos') {
    targetClause = `\nThis sentence specifically must use "${word}" as a ${target.value}.`;
  } else if (target?.kind === 'sense') {
    targetClause = `\nThis sentence specifically must use "${word}" in this sense: "${target.value}". Set the "sense" field to exactly that label.`;
  } else if (posList.length > 0) {
    targetClause = `\nParts of speech this word can take: ${posList.join(', ')}.`;
  }

  const userText = senseCtx.isSingleSense
    ? `Target word: ${word} (${pronunciation})
Meaning: ${senseCtx.meaningText}${targetClause}

Write ONE sentence.`
    : `Target word: ${word} (${pronunciation})

Senses (choose the "sense" value from these labels, verbatim):
${senseCtx.sensesText}${targetClause}

Write ONE sentence.`;

  const response = await anthropic.messages.create({
    model: GENERATOR_MODEL,
    max_tokens: 600,
    temperature: 0.7,
    system: cachedSystem(senseCtx.isSingleSense ? SYSTEM_ONE_SINGLE : SYSTEM_ONE_MULTI),
    messages: [{ role: 'user', content: userText }],
  });

  const parsed = parseJsonFromResponse(response.content[0].text);
  return finalizeSentence(parsed, senseCtx);
}

/**
 * Generate the full set of example sentences for a word. A whole-batch parse
 * failure (or a malformed individual item) no longer discards everything — valid
 * sentences from the batch are kept, and the shortfall + coverage gaps are re-rolled
 * one sentence at a time (generateSingleExampleSentence), targeting any POS role or
 * high-value sense the batch failed to cover.
 */
async function generateExampleSentences(word, pronunciation, senseCtx, partsOfSpeech) {
  // partsOfSpeech is a JSONB array of POS tags from the dictionaryentries_zh row.
  const rawPosList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];

  // Drop POS roles that the word carries ONLY in a bound form (per its clusters) —
  // they can't head a standalone sentence, so demanding coverage for them fabricates
  // a redundant off-target sentence (see coverablePosSet). A POS the clusters don't
  // mention at all is kept (we don't assume it's bound on missing data).
  const coverablePos = coverablePosSet(senseCtx.clusters);
  const clusterPos = new Set(
    senseCtx.clusters.flatMap(c => (Array.isArray(c.pos) ? c.pos.filter(p => typeof p === 'string') : []))
  );
  const posList = rawPosList.filter(p => !(clusterPos.has(p) && !coverablePos.has(p)));

  // Sentence budget: at least 3, and enough to give every (coverable) POS role its own slot.
  const budget = Math.max(3, posList.length);
  // Required senses, sized to the budget: pick enough distinct senses (top-ranked)
  // to fill every slot with a fresh sense, so extra slots can't collapse into
  // duplicates (see selectCoverageSenses). Single-sense entries have nothing to
  // steer. Assigned onto senseCtx so the batch prompt + coverage queue below read
  // the same set.
  senseCtx.highValueSenses = senseCtx.isSingleSense ? [] : selectCoverageSenses(senseCtx.clusters, budget);
  const sentenceCount = Math.max(budget, senseCtx.highValueSenses.length);

  const batch = await generateSentenceBatch({ word, pronunciation, senseCtx, posList, sentenceCount });
  const valid = (Array.isArray(batch) ? batch : [])
    .map(s => finalizeSentence(s, senseCtx))
    .filter(Boolean);

  // Build the queue of still-uncovered coverage targets (POS roles + high-value senses).
  // Coverage now reads the generator's `targetPos` (the target word's role) — the full
  // per-segment POS dict is produced later by tagSentenceSegments and isn't available here.
  const coveredPos = new Set(valid.map(s => s.targetPos).filter(Boolean));
  const coveredSenses = new Set(valid.map(s => s.sense).filter(Boolean));
  const targets = [
    ...posList.filter(p => !coveredPos.has(p)).map(value => ({ kind: 'pos', value })),
    ...senseCtx.highValueSenses.filter(s => !coveredSenses.has(s)).map(value => ({ kind: 'sense', value })),
  ];

  // Fill to the base count AND cover every outstanding target. Each iteration
  // consumes at most one target (or does a plain count-fill when none remain), so
  // the loop strictly makes progress and terminates.
  const MAX_ATTEMPTS_PER_SLOT = 3;
  while (valid.length < sentenceCount || targets.length > 0) {
    const target = targets.shift() || null; // null → plain count-fill
    let sentence = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_SLOT && !sentence; attempt++) {
      sentence = await generateSingleExampleSentence({ word, pronunciation, senseCtx, posList, target });
    }
    if (!sentence) {
      if (target) continue;   // this coverage target failed — move on rather than loop forever
      break;                  // plain count-fill failed — stop (avoid an unbounded loop)
    }
    valid.push(sentence);
    // A count-fill sentence may incidentally cover a still-pending target; drop it if so.
    if (!target && sentence.targetPos) {
      const idx = targets.findIndex(t =>
        (t.kind === 'pos' && t.value === sentence.targetPos) ||
        (t.kind === 'sense' && t.value === sentence.sense));
      if (idx !== -1) targets.splice(idx, 1);
    }
  }

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
    .map((s, i) => `${i}. ${s.foreignText}  —  ${s.english}`)
    .join('\n');

  // Static reviewer instructions (persona + common-mistakes catalog + response
  // format) → cached system; the per-entry word + numbered sentences → user.
  const systemText = `You are a strict native-Mandarin reviewer of example sentences for a Chinese learning app. You catch subtle grammatical and naturalness errors that automated generation tends to make. Respond only with valid JSON.

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
//  informed by the validator's violation codes + critique. Preserves the flagged
//  sentence's sense (so coverage isn't lost). Returns a finalized sentence, or null.
// ─────────────────────────────────────────────────────────────────────────────
async function regenerateSentenceWithOpus(word, pronunciation, definitionText, senseCtx, badSentence, violatedRules, critique) {
  const violationLines = violatedRules.length ? violatedRules.map(v => `  - ${v}`).join('\n') : '  (unspecified)';
  // For multi-sense entries the replacement must REPORT the sense it actually
  // demonstrates (validated against the list) rather than blindly inheriting the
  // original's label — a free rewrite that drifts to a different sense must not
  // keep a stale, now-mismatched label. Prefer the original sense when it still fits.
  const senseClause = senseCtx.isSingleSense
    ? ''
    : `\n- "sense": the EXACT label (verbatim, character-for-character) from the sense list below that YOUR replacement sentence actually demonstrates. Keep the original sense — "${badSentence.sense}" — if the fix can naturally use it; otherwise pick whichever listed label truly matches. Never stamp a label the sentence does not demonstrate.

Sense list (choose "sense" from these, verbatim):
${senseCtx.sensesText}`;

  const response = await anthropic.messages.create({
    model: REGENERATOR_MODEL,
    max_tokens: 900,
    // Note: claude-opus-4-8 deprecates the `temperature` parameter, so it is omitted here.
    system: cachedSystem('You are a native Mandarin teacher rewriting a single flawed example sentence. Respond only with valid JSON.'),
    messages: [{
      role: 'user',
      content: `A reviewer rejected the example sentence below for the word "${word}" (${pronunciation}; meaning: ${definitionText}). Write ONE new, natural replacement sentence that uses "${word}" in the same grammatical role and a similar context, but fully fixes the problem. Do not reproduce the error.

Rejected sentence: ${badSentence.foreignText}
English: ${badSentence.english}
Violated rules:
${violationLines}
Reviewer critique: ${critique || '(none)'}

The replacement must follow the same requirements as the original generation:
- Natural, native-sounding Mandarin, intermediate (HSK 3–4) level.
- "translatedVocab": the English word/phrase in your translation that corresponds to "${word}".
- "targetPos": the part of speech "${word}" carries in your replacement — one of: ${ALLOWED_POS_LINE}. (A separate pass tags the other segments; only report the target word's role.)${senseClause}
- The English translation must mirror the Chinese punctuation and clause structure.

Respond with ONLY one JSON object:
{"foreignText": "...", "english": "...", "translatedVocab": "...",${senseCtx.isSingleSense ? '' : ' "sense": "...",'} "targetPos": "<pos_tag>"}`,
    }],
  });

  const parsed = parseJsonFromResponse(response.content[0].text);
  return finalizeSentence(parsed, senseCtx);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Orchestrator: validate the batch, then repair each flagged sentence with Opus
//  and re-validate the replacement once (mirrors the single-retry policy in
//  backfill-expansion-claude.js). Returns the repaired batch + stats.
// ─────────────────────────────────────────────────────────────────────────────
async function validateAndRepairSentences(word, pronunciation, definitionText, senseCtx, sentences) {
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
      word, pronunciation, definitionText, senseCtx, out[i], verdict.violatedRules, verdict.critique,
    );
    if (!fix) continue; // repair unusable — keep the original rather than lose coverage

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

/**
 * Build the per-entry sense context from definitionClusters (migration 90).
 * Returns null when the entry is not yet clustered (caller SKIPS it — every
 * generated sentence must carry a validated sense; see docs/DEFINITION_CLUSTERS.md).
 */
function buildSenseContext(definitionClusters) {
  const clusters = Array.isArray(definitionClusters)
    ? definitionClusters.filter(c => c && typeof c.sense === 'string' && c.sense.trim().length > 0)
    : [];
  if (clusters.length === 0) return null;

  const senseLabels = clusters.map(c => c.sense);
  const isSingleSense = clusters.length === 1;
  return {
    isSingleSense,
    singleSenseLabel: senseLabels[0],
    senseLabelSet: new Set(senseLabels),
    sensesText: formatSenses(clusters),
    // Cleaned clusters are retained so the coverage-target set can be sized to the
    // sentence budget at generation time (selectCoverageSenses needs the budget,
    // which depends on the entry's POS count — known only in generateExampleSentences).
    clusters,
    // Single-meaning prompt shows a plain gloss blurb from the one cluster's glosses.
    meaningText: Array.isArray(clusters[0].glosses) && clusters[0].glosses.length
      ? clusters[0].glosses.slice(0, 3).join('; ')
      : senseLabels[0],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Segment-wise tagging pass (runs AFTER a sentence is generated + repaired)
//
//  Generation no longer emits per-token POS/number. Once the sentence text is final
//  we run the SAME greedy segmentation the read path uses (dal/shared/segmentString)
//  and tag EACH resulting segment with:
//    • pos    — the segment's contextual part of speech (drives form modification +
//               the particle/classifier annotation),
//    • sense  — the definitionClusters sense label the segment carries here, chosen
//               from THAT segment's OWN clusters (read path resolves the segment's
//               dd = ddt(matchingCluster)),
//    • number — singular/plural for noun segments (plural English form selection).
//
//  All three dicts are keyed by the GSA segment string, and the segmentation itself
//  is persisted (`segments`), so read-time lookups align exactly. Classifiers are NOT
//  force-split: a classifier GSA absorbs into a longer word is simply tagged as that
//  whole word (its own sense/definition). See docs/EXAMPLE_SENTENCES.md.
// ─────────────────────────────────────────────────────────────────────────────

// Load the dictionary rows needed to (a) segment `foreignText` and (b) know each
// segment's clusters + dictionary POS. Returns null when the text has no candidates.
async function loadSegmentDictData(client, foreignText) {
  const candidates = getAllSubstrings(foreignText.trim());
  if (candidates.length === 0) return null;

  const { rows } = await client.query(
    `SELECT word1, pronunciation, definitions, "vernacularScore", "matchException",
            "definitionClusters", "partsOfSpeech"
     FROM dictionaryentries_zh
     WHERE language = 'zh' AND word1 = ANY($1::text[])`,
    [candidates]
  );

  // Adapt rows into the DictionaryEntry-like shape buildDictMap expects (now carries
  // definitionClusters so the read-path SegmentMeta gets them too).
  const dictEntries = rows.map(r => ({
    word1: r.word1,
    pronunciation: r.pronunciation || '',
    definitions: Array.isArray(r.definitions) ? r.definitions : [r.definitions],
    vernacularScore: r.vernacularScore ?? null,
    matchException: r.matchException ?? [],
    definitionClusters: Array.isArray(r.definitionClusters) ? r.definitionClusters : null,
  }));

  // Side maps keyed by word1 for the tagger (clusters → sense candidates; partsOfSpeech
  // → POS fallback). First row per word1 wins, mirroring buildDictMap.
  const clustersBySeg = new Map();
  const posBySeg = new Map();
  for (const r of rows) {
    if (clustersBySeg.has(r.word1)) continue;
    clustersBySeg.set(r.word1, Array.isArray(r.definitionClusters) ? r.definitionClusters : []);
    posBySeg.set(r.word1, Array.isArray(r.partsOfSpeech) ? r.partsOfSpeech.filter(Boolean) : []);
  }

  return { dictMap: buildDictMap(dictEntries), excludeTokens: buildExcludeSet(dictEntries), clustersBySeg, posBySeg };
}

// Static tagger instructions → cached system; only the per-sentence text + segment
// list ride in the user message.
const SEGMENT_TAGGER_SYSTEM = `You label the segments of a Chinese sentence with grammatical metadata for a language-learning app. You are given the sentence, its English translation, and its FIXED segmentation — use exactly the segments provided, in the given order; never re-split, merge, or add segments.

For EACH segment return:
- "pos": the segment's part of speech IN THIS sentence — one of: ${ALLOWED_POS_LINE}. If a verb segment is used nominally (gerund / subject / object), tag it "noun".
- "sense": ONLY for segments shown with a "candidate senses" list — copy verbatim the ONE listed label that matches how the segment is used in this sentence, character-for-character. Never invent, translate, paraphrase, shorten, or combine labels. Omit "sense" for segments with no candidate list.
- "number": ONLY for segments you tag "noun" — "singular" or "plural", judged from the English translation. Omit for non-nouns.
- "tense": ONLY for segments you tag "verb" or "auxiliary verb" — "past", "present", or "future", judged from THAT verb's own temporal meaning in this sentence (a sentence may contain verbs in different tenses; label each on its own). Reason from meaning, not just grammatical markers (了 can mark a present state change; progressive aspect can appear in past or future contexts). Omit for non-verbs.

Respond with ONLY a JSON object mapping each segment string to its metadata:
{"<segment>": {"pos": "<pos_tag>", "sense": "<label>", "number": "singular|plural", "tense": "past|present|future"}}`;

// One model call per sentence → Map<segment, { pos?, sense?, number?, tense? }>. Fails OPEN
// (empty map) so a flaky/unparseable response never blocks storage: the caller still
// auto-fills single-cluster + target senses and falls back to the dictionary POS.
async function callSegmentTagger(sentence, targetWord, uniqueSegments, clustersBySeg) {
  const result = new Map();
  if (uniqueSegments.length === 0) return result;

  const segLines = uniqueSegments.map((seg, i) => {
    const clusters = clustersBySeg.get(seg) ?? [];
    // Offer sense candidates only for multi-sense NON-target segments: the target
    // segment's sense is already fixed (generation-validated), and single-sense
    // segments are auto-filled by the caller without spending the model on them.
    const offerCandidates = clusters.length > 1 && !(targetWord && seg === targetWord);
    const candidates = offerCandidates
      ? ` — candidate senses: ${clusters.map(c => `"${c.sense}"`).join('; ')}`
      : '';
    return `${i + 1}. "${seg}"${candidates}`;
  }).join('\n');

  const userText = `Chinese: ${sentence.foreignText}
English: ${sentence.english}

Segments (label every one, keyed by the exact segment string):
${segLines}`;

  try {
    const response = await anthropic.messages.create({
      model: TAGGER_MODEL,
      max_tokens: Math.max(500, 120 * uniqueSegments.length),
      temperature: 0.1,
      system: cachedSystem(SEGMENT_TAGGER_SYSTEM),
      messages: [{ role: 'user', content: userText }],
    });
    const parsed = parseJsonFromResponse(response.content[0].text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [seg, meta] of Object.entries(parsed)) {
        if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
          result.set(seg, {
            pos: typeof meta.pos === 'string' ? meta.pos : undefined,
            sense: typeof meta.sense === 'string' ? meta.sense : undefined,
            number: typeof meta.number === 'string' ? meta.number : undefined,
            tense: typeof meta.tense === 'string' ? meta.tense : undefined,
          });
        }
      }
    }
  } catch (err) {
    // An oracle export capture is a control-flow signal, not a tagger failure — it must
    // propagate so the round can author the tag prompt. Swallowing it (the old bare
    // `catch {}`) silently produced empty numberDict/tenseDict on every stamped row.
    if (err?.oracleExport) throw err;
    // swallow — see fail-open note above
  }
  return result;
}

/**
 * Produce the segment-keyed render data for one finished sentence:
 *   { segments, partOfSpeechDict, senseDict, numberDict, tenseDict }.
 * `targetWord` is forced to win segmentation (prioritySegments) so it always surfaces
 * as its own segment, matching the read path.
 */
async function tagSentenceSegments(client, sentence, targetWord) {
  const data = await loadSegmentDictData(client, sentence.foreignText);
  const segments = data
    ? segmentWithDict(sentence.foreignText, data.dictMap, data.excludeTokens, targetWord ? [targetWord] : undefined)
    : [...sentence.foreignText];

  const clustersBySeg = data?.clustersBySeg ?? new Map();
  const posBySeg = data?.posBySeg ?? new Map();

  // Unique, order-preserving list of Han-bearing segments (punctuation is never tagged).
  const uniqueSegments = [];
  const seen = new Set();
  for (const seg of segments) {
    if (seen.has(seg) || !/\p{Script=Han}/u.test(seg)) continue;
    seen.add(seg);
    uniqueSegments.push(seg);
  }

  const modelTags = await callSegmentTagger(sentence, targetWord, uniqueSegments, clustersBySeg);

  const partOfSpeechDict = {};
  const senseDict = {};
  const numberDict = {};
  const tenseDict = {};

  for (const seg of uniqueSegments) {
    const clusters = clustersBySeg.get(seg) ?? [];
    const tag = modelTags.get(seg) ?? {};
    const isTarget = !!targetWord && seg === targetWord;

    // POS — the target segment reuses the generation-validated targetPos; other
    // segments take the model's tag, falling back to the dictionary's primary POS.
    let pos = null;
    if (isTarget && ALLOWED_POS_TAG_SET.has(sentence.targetPos)) {
      pos = sentence.targetPos;
    } else if (ALLOWED_POS_TAG_SET.has(tag.pos)) {
      pos = tag.pos;
    } else {
      pos = (posBySeg.get(seg) ?? []).find(p => ALLOWED_POS_TAG_SET.has(p)) ?? null;
    }
    if (pos) partOfSpeechDict[seg] = pos;

    // Sense — target: the fixed generation sense; single-cluster: that cluster;
    // multi-cluster: the model's pick if it is one of this segment's own labels.
    let sense = null;
    if (isTarget && sentence.sense) {
      sense = sentence.sense;
    } else if (clusters.length === 1) {
      sense = clusters[0].sense;
    } else if (clusters.length > 1 && typeof tag.sense === 'string') {
      if (clusters.some(c => c.sense === tag.sense)) sense = tag.sense;
    }
    if (sense) senseDict[seg] = sense;

    // Number — only for noun segments with a valid value.
    if (pos === 'noun' && ALLOWED_NUMBERS.has(tag.number)) numberDict[seg] = tag.number;

    // Tense — only for verb segments with a valid value. Per-verb (not per-sentence)
    // so a sentence mixing tenses inflects each verb's popup gloss independently.
    if ((pos === 'verb' || pos === 'auxiliary verb') && ALLOWED_TENSES.has(tag.tense)) {
      tenseDict[seg] = tag.tense;
    }
  }

  return { segments, partOfSpeechDict, senseDict, numberDict, tenseDict };
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
      SELECT id, word1, pronunciation, definitions, "partsOfSpeech", "definitionClusters"
      FROM dictionaryentries_zh
      WHERE language = 'zh'
        ${discoverableGate}
        ${validatedFilter}
        ${emptinessFilter}
        ${wordsFilter}
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 3' : ''}
    `);

    console.log(`📊 Found ${entries.length} entries needing example sentences\n`);

    let updated = 0;
    let failed = 0;
    let skipped = 0;         // entries not yet clustered (definitionClusters IS NULL)
    let totalFlagged = 0;     // sentences the validator rejected
    let totalRepaired = 0;    // flagged sentences successfully replaced by Opus
    let totalStillFlagged = 0; // Opus replacements that still tripped a rule (kept anyway)

    for (const row of entries) {
      try {
        process.stdout.write(`  ${row.word1} (${row.pronunciation}) ... `);

        // Senses come from definitionClusters — clustering MUST run before this
        // script. An unclustered entry is skipped so we never ship a sentence with
        // an unvalidated sense.
        const senseCtx = buildSenseContext(row.definitionClusters);
        if (!senseCtx) {
          console.log('⚠ SKIPPED — not yet clustered (run backfill-cluster-definitions first)');
          skipped++;
          continue;
        }

        const sentences = await generateExampleSentences(row.word1, row.pronunciation, senseCtx, row.partsOfSpeech);

        if (!sentences) {
          console.log('no valid sentences returned');
          failed++;
          continue;
        }

        // Validator agent → Opus repair for any flagged sentence.
        const { sentences: finalSentences, flagged, repaired, stillFlagged, repairedIndexes } =
          await validateAndRepairSentences(row.word1, row.pronunciation, formatDefinitions(row.definitions), senseCtx, sentences);
        totalFlagged += flagged;
        totalRepaired += repaired;
        totalStillFlagged += stillFlagged;

        // Segment-wise tagging pass: attach persisted `segments` + segment-keyed
        // partOfSpeechDict/senseDict/numberDict/tenseDict. `targetPos` was a
        // generation-time coverage signal only — drop it before storing (the pass
        // folds it into partOfSpeechDict[targetWord]).
        const taggedSentences = [];
        for (const s of finalSentences) {
          const { segments, partOfSpeechDict, senseDict, numberDict, tenseDict } =
            await tagSentenceSegments(client, s, row.word1);
          const { targetPos, ...rest } = s;
          taggedSentences.push({ ...rest, segments, partOfSpeechDict, senseDict, numberDict, tenseDict });
        }

        await client.query(
          `UPDATE dictionaryentries_zh SET "exampleSentences" = $1::jsonb WHERE id = $2`,
          [JSON.stringify(taggedSentences), row.id]
        );
        await stampEntries(client, 'dictionaryentries_zh', row.id);

        updated++;

        if (isSpotCheck) {
          // Print full sentence details in spot-check mode
          console.log(`✓ (${taggedSentences.length} sentences${repaired ? `, ${repaired} repaired by Opus` : ''})`);
          taggedSentences.forEach((s, i) => {
            const tag = repairedIndexes.has(i) ? '   🔧 Opus repair' : '';
            console.log(`    ${s.foreignText}${tag}`);
            console.log(`           ${s.english}`);
            console.log(`           translatedVocab: ${s.translatedVocab}`);
            console.log(`           sense (target): ${s.sense}`);
            console.log(`           segments: ${JSON.stringify(s.segments)}`);
            console.log(`           POS: ${JSON.stringify(s.partOfSpeechDict)}`);
            console.log(`           senses: ${JSON.stringify(s.senseDict)}`);
            console.log(`           number: ${JSON.stringify(s.numberDict)}`);
            console.log(`           tense: ${JSON.stringify(s.tenseDict)}`);
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
    console.log(`Skipped (no cluster): ${skipped}`);
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
