/**
 * Backfill Script: AI-powered longDefinition for dictionaryentries_zh
 *
 * Pipeline (mirrors backfill-parts-of-speech.js):
 *   1. Generator agent (Sonnet) — writes a per-(sense, POS) definition ARRAY.
 *   2. Validator agent (Sonnet) — checks all hard constraints; may reject with a critique.
 *   3. Regenerator agent (Opus) — on rejection, retries once informed by the validator critique.
 *   4. Chooser agent (Opus) — picks the better definition array between Sonnet's and Opus's attempts.
 *
 * ONE DEFINITION PER (SENSE, PART OF SPEECH) PAIR (v15). Through v13 this wrote one definition
 * per PART OF SPEECH ({ "noun": "...", "verb": "..." }), which collapsed a polyseme's unrelated
 * meanings into a single blob per grammatical role — 会 "can" and 会 "a meeting" are different
 * words to a learner, not different rows of one table. The unit is now the SENSE × POS pair:
 * each entry's `definitionClusters` (migration 90, docs/DEFINITION_CLUSTERS.md) supplies the
 * senses, and a cluster's `pos` LIST is honored in full — every part of speech that sense takes
 * gets its own definition, because the roles mean different things (坏 "broken / to break down"
 * is `["adjective","verb"]`: the adjective is the STATE "it is broken", the verb is the EVENT
 * "it breaks down"). `buildSlots` expands clusters into those pairs; a cluster with no `pos` of
 * its own yields ONE slot whose POS the model chooses from the word's `partsOfSpeech`.
 * Entries are gated on `definitionClusters IS NOT NULL` — run backfill-cluster-definitions.js
 * first (the mark-discoverable pipeline already orders it so).
 *
 * The `sense` label is the join key back to `definitionClusters` (and to the learner's
 * per-card `selectedSense`, migration 99), so it must be copied VERBATIM from the cluster —
 * a drifted label silently un-links the definition from its sense.
 *
 * PHILOSOPHY — DEFINE THE SENSE, PLAINLY, THEN ENRICH. Each value explains what this ONE
 * sense means in plain beginner English and, when there is something genuinely worth adding,
 * gives cultural context or an extended use in a second paragraph. There is NO anchor
 * sentence: the "Matches the common English definition for <gloss>." opener (v13's Mode A)
 * was removed — with several senses on screen it read as noise, and it re-stated a gloss the
 * learner is already looking at. No synonym lists, no register commentary, no regional-usage
 * elaboration. Chinese characters ARE allowed for citing culturally significant idioms
 * (pinyin is not); output stays primarily English.
 *
 * OUTPUT SHAPE: a JSON ARRAY of per-pair objects, ordered default-sense-first (the same
 * highest-frequency-first order the flp sense-picker uses, so element 0 is the fallback for
 * readers with no clusters to resolve against) and, within a sense, in the cluster's own `pos`
 * order:
 *   [{ "sense": "<cluster label, verbatim>", "pos": "<one POS>", "definition": "..." }, ...]
 * SEVERAL ELEMENTS MAY SHARE A `sense` — one per POS. Stored verbatim in the JSONB
 * `longDefinition` column (migration 70). At the read boundary the LEARNER surfaces show the
 * sense the card is on, with its POS blocks labeled and joined when it has more than one
 * (`resolveLongDefinition` in server/utils/definitions.ts); the validator review document
 * shows every pair (`longDefToDisplayString`).
 *
 * HEADWORD-CITATION GUARD: rule 4 bans citing the headword (or a compound merely containing
 * it) in Chinese, and the LLM reviewers enforce that unreliably — in testing the validator
 * passed "as in 学说 (a theory…)" for 说 and the chooser then PREFERRED it. So the check is
 * deterministic (`headwordCitations`, a substring test), with one Opus repair pass
 * (`repairHeadwordCitations`); anything surviving is still written but printed to stdout as a
 * `⚠ LONGDEF REVIEW` line for the human sweep — the same self-flagging contract the clusterer
 * uses (see .claude/commands/mark-discoverable.md §A3).
 *
 * LENGTH is per PAIR: each definition must be MIN_LEN..MAX_LEN_PER_SENSE (25–200) chars,
 * independent of how many pairs the word has. Because the validator only
 * length-checks the first attempt, a final enforceMaxLen step (Opus tightener) guarantees
 * every value respects the budget.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-long-definitions.js              # full backfill
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-long-definitions.js --spot-check # test 5 entries
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-long-definitions.js --words=快,打
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog, cachedSystem } from '../run-log.js';
const SCRIPT_VERSION = 15; // bump when this script's logic/prompt changes

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries, validatedClause, staleClause } = initRunLog({ script: 'chinese/backfill-long-definitions', version: SCRIPT_VERSION, anthropic: anthropic });
// Never regenerate a longDefinition that a validator has approved/flagged as part
// of the definitions bundle (migration 104, docs/DATA_VALIDATION_SYSTEM.md).
const validatedFilter = `AND ${validatedClause(['definitions'], 'dictionaryentries_zh')}`;
const isSpotCheck = process.argv.includes('--spot-check');
const isStale = process.argv.includes('--stale');

const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';
// An explicit --words= run is a targeted REGENERATION of exactly those headwords (for
// spot-checking / previewing prompt changes), so it bypasses the two "needs backfill"
// guards a full run applies: the discoverable gate and the longDefinition-IS-NULL gate.
// Without this, a --words run silently matches nothing once the words already have a
// definition (or aren't discoverable yet). The validated-field guard still applies —
// we never overwrite a human-reviewed definition.
const isTargeted = !!targetWords?.length;
const discoverableFilter = isTargeted ? '' : 'AND discoverable = TRUE';
// --stale (untargeted): also revisit rows stamped below SCRIPT_VERSION or never stamped.
// NOTE: rows written before v14 hold the OLD per-POS object shape and v14 rows hold at most
// one POS per sense, so a --stale sweep is how existing entries get migrated to the per-pair array.
const needsBackfillFilter = isTargeted
  ? ''
  : (isStale ? `AND ("longDefinition" IS NULL OR ${staleClause()})` : 'AND "longDefinition" IS NULL');

const GEN_MODEL = 'claude-sonnet-4-6';
const VALIDATOR_MODEL = 'claude-sonnet-4-6';
const RETRY_MODEL = 'claude-opus-4-8';

// ─────────────────────────────────────────────────────────────────────────────
//  Shared rule text — injected into generator, validator, regenerator, chooser,
//  and tightener prompts so all agents judge by the exact same criteria.
// ─────────────────────────────────────────────────────────────────────────────

// Length budget is PER (sense, POS) PAIR. Each pair gets its own independent definition with
// its own budget — total length is not split across them. A one-pair word and each pair of a
// five-pair word are all bounded by the same [MIN_LEN, MAX_LEN_PER_SENSE].
const MIN_LEN = 25;
// 250 in v13 only to fit the ~48-char anchor sentence plus a culture paragraph. With the
// anchor gone (see the header), 200 leaves room for two plain paragraphs. Still a CEILING,
// not a target — a single clear sentence is a perfectly good definition.
const MAX_LEN_PER_SENSE = 200;

// ── Array-shape helpers ──────────────────────────────────────────────────────
// A definition is an array of { sense, pos, definition }, one element per (sense, POS) pair —
// so a sense taking two parts of speech contributes two elements sharing a `sense`.

// Definition strings of a definition array (defensive against malformed elements).
function defValues(def) {
  return Array.isArray(def)
    ? def.filter(d => d && typeof d.definition === 'string').map(d => d.definition)
    : [];
}

// Pair labels whose definition exceeds the per-pair ceiling (sense + POS, since a sense alone
// no longer identifies one definition).
function overBudgetSenses(def) {
  return (Array.isArray(def) ? def : [])
    .filter(d => d && typeof d.definition === 'string' && d.definition.length > MAX_LEN_PER_SENSE)
    .map(d => `${d.sense} (${d.pos ?? '?'})`);
}

// Every value within [MIN_LEN, MAX_LEN_PER_SENSE]; used by enforceMaxLen.
function defWithinBudget(def) {
  const vals = defValues(def);
  return vals.length > 0 && vals.every(v => v.length >= MIN_LEN && v.length <= MAX_LEN_PER_SENSE);
}

// Longest value length — surfaced in spot-check tags so an over-budget value is visible.
function maxValueLen(def) {
  const vals = defValues(def);
  return vals.length ? Math.max(...vals.map(v => v.length)) : 0;
}

// Compact, length-annotated rendering of an array for inclusion in agent prompts.
function annotateDefForPrompt(def) {
  return (Array.isArray(def) ? def : [])
    .map(d => `  sense "${d?.sense}" [pos: ${d?.pos ?? '?'}] (${typeof d?.definition === 'string' ? d.definition.length : 0} chars): "${d?.definition}"`)
    .join('\n');
}

// Human-readable one-liner for console/spot-check logging.
function defToLogString(def) {
  return (Array.isArray(def) ? def : [])
    .map(d => `${d?.sense} (${d?.pos ?? '?'}): ${d?.definition}`)
    .join('  |  ');
}

// ── Sense (cluster) helpers ──────────────────────────────────────────────────

// Cluster order the READ boundary assumes: highest frequencyScore first (nulls last),
// identical to the client's sortedSenseClusters / server resolveSelectedCluster. Writing
// the array in this order makes element 0 the default sense, which is what a reader with
// no clusters on hand falls back to (resolveLongDefinition).
function sortedClusters(clusters) {
  return [...clusters].sort((a, b) => (b?.frequencyScore ?? -1) - (a?.frequencyScore ?? -1));
}

// Usable sense clusters for an entry: must carry a non-empty `sense` label (the join key).
function usableClusters(clusters) {
  return Array.isArray(clusters)
    ? sortedClusters(clusters.filter(c => c && typeof c.sense === 'string' && c.sense.trim().length > 0))
    : [];
}

/**
 * The unit of generation: one SLOT per (sense, POS) PAIR.
 *
 * A cluster's `pos` is a LIST because a sense can be used in more than one grammatical
 * role, and those roles carry genuinely different meanings for a learner — 坏's
 * "broken / spoiled / to break down" is `["adjective","verb"]`: the adjective is "it is
 * broken", the verb is "it breaks down". Collapsing that to one pick silently drops a
 * meaning, so EVERY listed POS gets its own definition.
 *
 * A cluster carrying no `pos` of its own yields a single slot with `pos: null`; the word's
 * `partsOfSpeech` is offered to the model as the candidate list and it fills the POS in.
 * (We deliberately do NOT fan a pos-less cluster out across the whole word-level POS set —
 * that would invent sense/POS combinations the clusterer never asserted.)
 *
 * Order: cluster order (default sense first) and, within a cluster, the cluster's own
 * `pos` order — which is what the read boundary and the validator document both display.
 */
function buildSlots(clusters, partsOfSpeech) {
  const wordPos = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];
  const slots = [];
  for (const c of clusters) {
    const posOptions = Array.isArray(c.pos) ? c.pos.filter(Boolean) : [];
    const glosses = Array.isArray(c.glosses) ? c.glosses.join('; ') : '';
    if (posOptions.length === 0) {
      slots.push({ sense: c.sense, pos: null, glosses, candidates: wordPos });
    } else {
      for (const pos of posOptions) slots.push({ sense: c.sense, pos, glosses, candidates: posOptions });
    }
  }
  return slots;
}

// The per-entry slot block every agent sees: the exact (sense, POS) pairs to cover, the
// labels to copy back verbatim, and each sense's source glosses (what the sense covers).
function slotContextBlock(slots) {
  return slots
    .map((s, i) => {
      const posLine = s.pos
        ? `     part of speech: ${s.pos}`
        : `     part of speech: CHOOSE ONE from: ${s.candidates.join(', ') || 'unknown'}`;
      return `  ${i + 1}. sense: "${s.sense}"\n${posLine}\n     source glosses for this sense (what it covers — context only, do NOT restate): ${s.glosses || '(none)'}`;
    })
    .join('\n');
}

// Slots that share a sense label with at least one other slot — the pairs whose definitions
// must NOT be interchangeable, called out explicitly in the prompt.
function multiPosSenses(slots) {
  const counts = new Map();
  for (const s of slots) counts.set(s.sense, (counts.get(s.sense) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 1).map(([sense]) => sense);
}

function definitionRulesText(slots) {
  const shared = multiPosSenses(slots);
  const sharedNote = shared.length
    ? `\nNOTE — these senses appear MORE THAN ONCE below, once per part of speech: ${shared.map(s => `"${s}"`).join(', ')}.
Each of those pairs needs its OWN definition describing the word AS THAT PART OF SPEECH. They must not
be paraphrases of each other. Example: a sense glossed "broken / to break down" listed as both adjective
and verb — the adjective describes the resulting STATE (something is out of order / no longer usable),
the verb describes the EVENT (it stops working / goes bad). Write the state one for the adjective and
the event one for the verb.\n`
    : '';

  return `
A "long definition" is a plain-language enrichment shown in the extra-info panel, written PER SENSE AND
PART OF SPEECH. The learner is looking at ONE sense of the word at a time (they pick it from the card's
sense menu), and sees that sense's short gloss right above your text. Your job is to explain what that
one sense means in that one grammatical role, plainly, and then add cultural or extended nuance only if
there is something worth adding.

The word's (sense, part of speech) PAIRS are listed below. Write exactly one definition for EACH PAIR —
a sense that takes two parts of speech gets TWO definitions, one per role:

${slotContextBlock(slots)}
${sharedNote}
How to write each definition:
- STAY INSIDE THE ASSIGNED SENSE **AND** PART OF SPEECH. Define only what THIS sense means when used in
  THIS grammatical role. Do not define, contrast with, or allude to the word's other senses — or to the
  same sense's other part of speech — each pair gets its own definition, and the learner sees only the
  one they are on. Never write "this can also mean ..." or "as a verb it means ...".
- DO NOT RESTATE THE GLOSS. The learner already sees this sense's gloss. Say what the gloss cannot:
  what the sense actually covers, where its edges are, and any nuance a bare gloss loses. Do NOT open
  by echoing the gloss back.
- WRITE SIMPLY. Use short, common words and short sentences, as if explaining to a beginner. Avoid
  academic, abstract, or flowery wording. Plain and clear always beats clever.
- BE BRIEF. The length cap is a CEILING, not a target. Say only what matters and stop.
- CULTURAL CONTEXT IS OPTIONAL AND GOES LAST. When the sense figures in daily life, customs,
  associations, or a common set phrase in a way a learner would not guess, add it as a SECOND
  PARAGRAPH separated by a literal \\n\\n. If there is nothing genuinely useful to add, STOP after the
  first paragraph — do NOT pad.
- USE CHINESE CHARACTERS SPARINGLY — only to cite a term that is itself CULTURALLY SIGNIFICANT (a real
  idiom / chengyu, or a culturally loaded phrase such as 九五之尊 or 关系网). Do NOT use Chinese for
  constructed example sentences or trivial collocations; describe ordinary usage in English. When you do
  cite a culturally significant term, use characters (never pinyin) woven into a sentence — never a bare
  list.
- DO NOT LIST SYNONYMS. This is a definition, not a thesaurus.

Output shape — a JSON array, one object per (sense, part of speech) PAIR:
[
  {"sense": "<the sense label, copied VERBATIM from the list above>", "pos": "<that pair's part of speech>", "definition": "<the text>"},
  ...
]
- Cover EVERY numbered pair listed above, in the SAME ORDER, and copy each \`sense\` label
  character-for-character — it is the key that links this definition back to the sense the learner
  picked. Never invent, merge, split, reword, or drop a pair. A sense listed twice (two parts of
  speech) MUST produce two entries with the same \`sense\` and different \`pos\`.
- A word with one sense and one part of speech still emits a one-element array.

Hard constraints — all must be satisfied:

1. LENGTH — EACH definition must be between ${MIN_LEN} and ${MAX_LEN_PER_SENSE} characters (the \\n\\n break
   counts). This budget is PER PAIR, not a shared total. The upper bound is a hard CEILING, never a
   target — a much shorter, one-sentence definition is perfectly fine. Never exceed ${MAX_LEN_PER_SENSE}
   for any one definition.
2. PAIR COVERAGE & LABELS — Exactly one element per listed (sense, POS) pair, in the given order, each
   \`sense\` copied verbatim. No missing pairs, no extra pairs, no reworded labels, no dropping one part
   of speech of a sense.
3. POS — \`pos\` is a single part-of-speech string: the one given for that pair (or, where the pair says
   CHOOSE ONE, the one from the candidate list that the sense really is). Never a list.
3b. DISTINCT PER POS — When a sense appears under two parts of speech, the two definitions must describe
   genuinely different things (the state vs. the event, the thing vs. the act). Two definitions that
   could be swapped without anyone noticing are a violation.
4. PRIMARILY ENGLISH — CHINESE ONLY WHEN CULTURALLY SIGNIFICANT, NO PINYIN — Write in English. Include Chinese characters ONLY to cite a term that is itself culturally significant (an established idiom, chengyu, or culturally loaded set phrase, e.g. 九五之尊, 关系网). Do NOT use Chinese for ad-hoc example sentences, trivial collocations, or to illustrate ordinary grammar (e.g. 你能来吗, 现在几点) — describe such usage in English. This holds even for grammatical/function words. Do NOT cite the headword itself in Chinese, nor ordinary compounds/derived words that merely contain it (e.g. 能量, 能力) — reserve Chinese for STANDALONE, culturally significant idioms or set phrases. NEVER romanize Chinese into pinyin (with or without tone marks). Other non-ASCII letters (e.g. accented Latin letters) are forbidden.
5. NO SYNONYM LIST — Do not present the meaning as a string of synonymous words.
6. NO GLOSS RESTATEMENT — Do not open by repeating or lightly paraphrasing the sense's own gloss, and do
   not mention "English", "the English word", or compare the word to its English rendering.
7. NO CROSS-PAIR COVERAGE — Do not define, cite, or allude to any OTHER sense of the word — or to the
   same sense's other part of speech — inside a pair's definition.
8. NO REGISTER COMMENTARY — Do not describe how formal, colloquial, literary, slangy, or technical the word is; spend the space on meaning and concept instead.
9. NO REGIONAL-USAGE ELABORATION — Do not describe which regions, dialects, or countries use the word, or note regional variants. Focus on meaning, not geographic distribution.
10. NO "APPEARS IN" FILLER — Do not append example-word lists with "appears in", "found in", "seen in", or similar tacked-on phrasing. Cite a related phrase only when it is woven into a sentence explaining a nuance, never as a list to fill space.
11. SENTENCE COUNT — Use between 1 and 3 sentences per definition (inclusive). Reject a definition with 4 or more sentences, or one whose extra sentence is a tacked-on citation or a padding aside that adds no distinct nuance.
`;
}

const VIOLATION_CODE_LABELS = {
  too_short: `One or more sense definitions is under ${MIN_LEN} characters (rule 1)`,
  too_long: `One or more sense definitions exceeds the ${MAX_LEN_PER_SENSE}-character per-pair budget (rule 1)`,
  poor_sense_coverage: 'Array does not contain exactly one element per listed (sense, POS) pair, in order — a missing/extra/merged pair, a sense whose second part of speech was dropped, or a wrong array shape (rule 2)',
  altered_sense_label: 'A `sense` label was reworded, trimmed, or invented rather than copied verbatim from the sense list (rule 2)',
  bad_pos: 'A `pos` is missing, is a list, or is not the part of speech assigned to that pair (rule 3)',
  duplicate_pos_definitions: "A sense's two part-of-speech definitions say the same thing — they are interchangeable rather than describing the state vs. the event / the thing vs. the act (rule 3b)",
  uses_pinyin: 'Romanizes a Chinese word into pinyin instead of using Chinese characters (rule 4)',
  gratuitous_chinese: 'Uses Chinese for an ad-hoc example, the headword itself, or an ordinary compound/derived word rather than a standalone culturally significant term (rule 4)',
  contains_non_english: 'Contains non-ASCII letters other than Chinese characters (e.g. accented Latin letters / pinyin diacritics) (rule 4)',
  lists_synonyms: 'Presents the meaning as a list/string of synonymous words (rule 5)',
  restates_gloss: "Opens by repeating/paraphrasing the sense's gloss, or references English / the English rendering (rule 6)",
  covers_other_sense: "Defines, cites, or alludes to another of the word's senses inside this sense's definition (rule 7)",
  comments_on_register: 'Comments on register / formality / colloquialness (rule 8)',
  elaborates_regional: 'Elaborates on regional, dialectal, or geographic usage (rule 9)',
  appears_in_filler: 'Uses an "appears in" / "found in" style tacked-on example listing (rule 10)',
  extra_sentence: 'Exceeds 3 sentences, or pads with a tacked-on sentence citing a related phrase/chengyu or a filler aside (rule 11)',
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

// Parse an agent response into a normalized per-(sense, POS) definition array. Tolerates
// markdown fences / extra prose around the JSON. Elements are matched back to the requested
// SLOTS on (sense, pos), case/whitespace-insensitively so a re-cased label or POS still links
// up, and emitted in slot order — the order the read boundary and validator document assume.
// A slot the model skipped is simply absent; the validator's coverage rule catches that.
// Returns null if no slot got a usable definition.
function parseDefArray(responseText, slots) {
  const raw = parseJsonFromResponse(responseText);
  const items = Array.isArray(raw) ? raw : null;
  if (!items) return null;

  const norm = s => (typeof s === 'string' ? s.trim().toLowerCase() : '');
  const key = (sense, pos) => `${norm(sense)} ${norm(pos)}`;

  // Index every usable response element twice: by (sense, pos) for the normal match, and by
  // sense alone as the fallback for a pos-less slot (or a model that omitted `pos`).
  const byPair = new Map();
  const bySense = new Map();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.definition !== 'string' || item.definition.trim().length === 0) continue;
    const pairKey = key(item.sense, item.pos);
    if (!byPair.has(pairKey)) byPair.set(pairKey, item);
    const senseKey = norm(item.sense);
    if (senseKey && !bySense.has(senseKey)) bySense.set(senseKey, item);
  }

  const used = new Set();
  const out = [];
  for (const slot of slots) {
    // Exact pair first; for a slot with no assigned POS fall back to any not-yet-consumed
    // element carrying that sense (the model chose the POS for us).
    let item = byPair.get(key(slot.sense, slot.pos));
    if (!item && slot.pos === null) {
      const cand = bySense.get(norm(slot.sense));
      if (cand && !used.has(cand)) item = cand;
    }
    if (!item || used.has(item)) continue;
    used.add(item);
    out.push({
      // Always the CLUSTER's label and the SLOT's POS (when assigned), never the model's echo —
      // the join key must match the cluster exactly.
      sense: slot.sense,
      pos: slot.pos ?? (typeof item.pos === 'string' && item.pos.trim() ? item.pos.trim() : null),
      definition: item.definition.trim(),
    });
  }
  return out.length > 0 ? out : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 1: generator (Sonnet) — emits the per-sense definition ARRAY
// ─────────────────────────────────────────────────────────────────────────────

async function generateDefinition(word, slots, model = GEN_MODEL) {
  // The rules text embeds this entry's sense list, so — unlike v13 — the system block is
  // per-entry and NOT byte-identical across the run. cachedSystem still marks it cacheable
  // (harmless; it just won't hit for a fresh word) and keeps the call shape uniform with
  // the other backfills.
  const systemText = `You are a Chinese language expert writing concise English definitions for a learner dictionary.

${definitionRulesText(slots)}

Respond with ONLY the JSON array (one object per sense) — no markdown fences, no extra prose.`;

  const prompt = `Word: ${word}`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1200,
    temperature: 0.3,
    system: cachedSystem(systemText),
    messages: [{ role: 'user', content: prompt }],
  });

  return parseDefArray(response.content[0].text, slots);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 2: validator (Sonnet)
//  Returns { accept, violatedRules: string[], critique }
// ─────────────────────────────────────────────────────────────────────────────

async function validateDefinition(word, slots, proposed) {
  const systemText = `You are a strict reviewer checking a per-(sense, POS) English definition array for a Chinese word. Apply every constraint formally — do not approve if any rule is violated, including for any single (sense, POS) pair. Respond only with valid JSON.

${definitionRulesText(slots)}

Violation codes you may cite:
${Object.entries(VIOLATION_CODE_LABELS).map(([k, v]) => `  - "${k}": ${v}`).join('\n')}

The per-pair budget is ${MAX_LEN_PER_SENSE} characters.

If the array satisfies every constraint, respond with: {"accept": true}
If any constraint is violated (for any pair), respond with:
  {"accept": false, "violatedRules": ["code1", "code2"], "critique": "1-2 sentences naming which pair(s) fail and what a corrected array should look like"}

Respond with ONLY valid JSON, no markdown.`;

  const prompt = `Word: ${word}
Proposed definition array (per-pair char counts shown):
${annotateDefForPrompt(proposed)}`;

  const response = await anthropic.messages.create({
    model: VALIDATOR_MODEL,
    max_tokens: 400,
    temperature: 0.1,
    system: cachedSystem(systemText),
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

async function regenerateDefinition(word, slots, priorDef, violatedRules, critique) {
  const violationLines = violatedRules
    .map(code => `  - ${code}: ${VIOLATION_CODE_LABELS[code] ?? code}`)
    .join('\n');

  const prompt = `Your previous per-(sense, POS) English definition array for a Chinese word was rejected by a strict reviewer. Produce a corrected array that fixes all flagged violations.

${definitionRulesText(slots)}

Word: ${word}

Previous attempt:
${annotateDefForPrompt(priorDef)}
Violated rules:
${violationLines || '  (none specified)'}
Reviewer critique:
${critique || '(none)'}

Apply all constraints precisely. You may keep, change, or restructure any definition. Respond with ONLY the corrected JSON array — no markdown fences, no extra prose.`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 1200,
    // Note: claude-opus-4-8 does not accept the `temperature` parameter — omit it.
    system: 'You are a Chinese language expert writing concise, rule-compliant per-sense English definition arrays. Respond only with the JSON array.',
    messages: [{ role: 'user', content: prompt }],
  });

  return parseDefArray(response.content[0].text, slots);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 4: chooser (Opus) — final adjudicator between Sonnet's and Opus's arrays
//  Returns { winner: 'sonnet' | 'opus', reason: string }
// ─────────────────────────────────────────────────────────────────────────────

async function chooseDefinition(word, slots, sonnetDef, opusDef) {
  const prompt = `Two per-(sense, POS) English definition arrays have been proposed for a Chinese word. Pick the better one as written — do not propose a third.

${definitionRulesText(slots)}

Word: ${word}

Option A (sonnet):
${annotateDefForPrompt(sonnetDef)}
Option B (opus):
${annotateDefForPrompt(opusDef)}

Judge which array better satisfies all constraints and quality goals. Penalize constraint violations (including any definition exceeding the ${MAX_LEN_PER_SENSE}-character per-pair budget, a missing pair, a dropped part of speech, or a reworded sense label) AND vague or unhelpful definitions.

Respond with ONLY one of:
  {"winner": "sonnet", "reason": "1 short sentence"}
or
  {"winner": "opus", "reason": "1 short sentence"}`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 200,
    // Note: claude-opus-4-8 does not accept the `temperature` parameter — omit it.
    system: 'You are a strict adjudicator picking between two dictionary definition arrays. Respond only with valid JSON.',
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
//  Agent 5: tightener (Opus) — compresses over-budget definitions to <= MAX_LEN_PER_SENSE
//  without losing nuance. Needed because the validator only length-checks the
//  first (Sonnet) attempt; the retry/chooser path can otherwise emit over-budget
//  definitions that are never re-measured.
// ─────────────────────────────────────────────────────────────────────────────

async function tightenDefinition(word, slots, tooLongDef) {
  const offenders = overBudgetSenses(tooLongDef);

  const prompt = `A per-(sense, POS) English definition array for a Chinese word has one or more definitions over the ${MAX_LEN_PER_SENSE}-character per-pair budget. Staying within ${MAX_LEN_PER_SENSE} characters PER DEFINITION is MANDATORY and is the top priority — cut whatever it takes from the over-long definition(s), dropping the least-essential details, to land at ${MAX_LEN_PER_SENSE} characters or fewer for EACH. Keep the single most important nuance per definition; losing secondary nuance is acceptable. Keep the same (sense, POS) pairs and their verbatim labels; do not drop or add a pair.

${definitionRulesText(slots)}

Word: ${word}

Over-budget array (per-pair char counts shown; pairs over budget: ${offenders.join(', ') || 'n/a'}):
${annotateDefForPrompt(tooLongDef)}

Respond with ONLY the shortened JSON array — no markdown fences, no extra prose. EVERY definition MUST be ${MAX_LEN_PER_SENSE} characters or fewer.`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 1200,
    // Note: claude-opus-4-8 does not accept the `temperature` parameter — omit it.
    system: 'You are a Chinese language expert compressing per-sense definition arrays to a strict per-definition length while preserving nuance. Respond only with the JSON array.',
    messages: [{ role: 'user', content: prompt }],
  });

  return parseDefArray(response.content[0].text, slots);
}

// Programmatic length guard. The validator only checks Sonnet's first attempt, so
// the Opus retry/chooser path can return arrays with over-budget definitions. Given
// candidate arrays ordered best-first, return the first whose every definition is within
// [MIN_LEN, MAX_LEN_PER_SENSE]; otherwise ask Opus to compress (up to 4 tries); as a
// last resort return the candidate with the smallest worst-case definition and flag it.
async function enforceMaxLen(word, slots, candidates) {
  const valid = candidates.filter(Boolean);
  for (const c of valid) {
    if (defWithinBudget(c)) return { definition: c, tightened: false, overBudget: false };
  }
  let current = valid[0];
  for (let i = 0; i < 4 && current; i++) {
    const t = await tightenDefinition(word, slots, current);
    if (t && defWithinBudget(t)) return { definition: t, tightened: true, overBudget: false };
    // Keep shrinking from whichever has the smaller worst-case definition so far.
    if (t && maxValueLen(t) < maxValueLen(current)) current = t;
  }
  const all = [...valid, current].filter(Boolean).sort((a, b) => maxValueLen(a) - maxValueLen(b));
  const best = all[0];
  return { definition: best, tightened: true, overBudget: maxValueLen(best) > MAX_LEN_PER_SENSE };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Headword-citation guard (deterministic)
//
//  Rule 4 forbids citing the HEADWORD itself, or an ordinary compound that merely
//  contains it (说 → 学说), in Chinese — those are exactly the citations a learner
//  gains nothing from. The LLM reviewers enforce this unreliably: observed in
//  testing, the validator passed "A parent 说 a child means …" / "as in 学说 (a
//  theory…)" and the Opus chooser then PREFERRED that candidate *because* of the
//  example. So the check is done in code, where it cannot be argued with.
//
//  A plain substring test on the headword catches both cases at once: the bare
//  headword, and any compound containing it. Culturally significant idioms that do
//  NOT contain the headword stay allowed (rule 4 permits them), so this guard is
//  narrow by construction.
// ─────────────────────────────────────────────────────────────────────────────

// Marker for the stdout review lines. Kept stable — the mark-discoverable skill agent
// greps for it and surfaces the flagged entries to the user (same contract as the
// clusterer's "⚠ CLUSTER REVIEW"). See .claude/commands/mark-discoverable.md §A3.
const REVIEW_MARKER = '⚠ LONGDEF REVIEW';

// The "<sense> (<pos>)" labels of every definition that cites the headword.
function headwordCitations(def, word) {
  return (Array.isArray(def) ? def : [])
    .filter(d => d && typeof d.definition === 'string' && d.definition.includes(word))
    .map(d => `${d.sense} (${d.pos ?? '?'})`);
}

// One corrective pass over a definition array that cites the headword, reusing the
// regenerator (Opus) with the violation named. Returns the corrected array when it is
// strictly better (fewer citing pairs), otherwise the original — a repair that fixes
// nothing must not cost us the candidate we already had.
async function repairHeadwordCitations(word, slots, def) {
  const citing = headwordCitations(def, word);
  if (citing.length === 0) return def;

  const critique =
    `These definitions cite the headword ${word} in Chinese — either alone or inside a compound ` +
    `that contains it (e.g. a word like 学说 for the headword 说): ${citing.join('; ')}. ` +
    `Rewrite those definitions to describe the usage entirely in English. Do not replace the ` +
    `citation with a different Chinese word unless it is a standalone, culturally significant ` +
    `idiom that does NOT contain ${word}. Leave the other definitions unchanged.`;

  const repaired = await regenerateDefinition(word, slots, def, ['gratuitous_chinese'], critique);
  if (!repaired) return def;
  return headwordCitations(repaired, word).length < citing.length ? repaired : def;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Orchestrator: generator → validator → (opus retry → opus chooser) → final
//  Returns { definition, attempts, model, accepted, finalCritique, ... }
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared tail of every pipeline branch: repair headword citations, then enforce the
 * length budget, then re-check citations on whatever actually won (the tightener can
 * reintroduce one, and enforceMaxLen may fall back to a different candidate).
 * Surviving citations are returned as `cited` for the caller to flag — never silently
 * dropped, and never a reason to discard an otherwise good definition.
 */
async function finalizeDefinition(word, slots, candidates) {
  const [first, ...rest] = candidates.filter(Boolean);
  const repaired = first ? await repairHeadwordCitations(word, slots, first) : null;
  const enforced = await enforceMaxLen(word, slots, [repaired, ...rest]);
  return { ...enforced, cited: headwordCitations(enforced.definition, word) };
}

async function runDefinitionPipeline(word, slots) {
  // Per-sense budget is constant (MAX_LEN_PER_SENSE); kept in the result for logging.
  const maxLen = MAX_LEN_PER_SENSE;

  const firstDef = await generateDefinition(word, slots, GEN_MODEL);
  if (!firstDef) {
    return { definition: null, attempts: 1, model: GEN_MODEL, accepted: false, maxLen, finalCritique: 'Generator returned empty/unparseable output' };
  }

  const verdict1 = await validateDefinition(word, slots, firstDef);
  if (verdict1.accept) {
    // Validator already enforced length, but guard anyway in case it miscounted — and run
    // the deterministic headword-citation guard, which the validator does NOT reliably apply.
    const enforced = await finalizeDefinition(word, slots, [firstDef]);
    return { definition: enforced.definition, attempts: 1, model: GEN_MODEL, accepted: true, maxLen, tightened: enforced.tightened, overBudget: enforced.overBudget, cited: enforced.cited, finalCritique: '' };
  }

  // Sonnet's attempt was rejected — retry with Opus, informed by the critique.
  const retryDef = await regenerateDefinition(word, slots, firstDef, verdict1.violatedRules, verdict1.critique);
  if (!retryDef) {
    const enforced = await finalizeDefinition(word, slots, [firstDef]);
    return {
      definition: enforced.definition,
      attempts: 2,
      model: GEN_MODEL,
      accepted: false,
      maxLen,
      tightened: enforced.tightened,
      overBudget: enforced.overBudget,
      cited: enforced.cited,
      finalCritique: `Opus retry returned empty output; falling back to Sonnet's attempt. Original critique: ${verdict1.critique}`,
    };
  }

  // Opus chooser picks between Sonnet's original and Opus's correction.
  const choice = await chooseDefinition(word, slots, firstDef, retryDef);
  const winnerDef = choice.winner === 'sonnet' ? firstDef : retryDef;
  const winnerModel = choice.winner === 'sonnet' ? GEN_MODEL : RETRY_MODEL;
  const otherDef = choice.winner === 'sonnet' ? retryDef : firstDef;
  // Repair headword citations, then enforce the budget, preferring the chooser's winner and
  // falling back to the other candidate. The citation guard runs on the WINNER specifically
  // because the chooser has been observed rewarding a citing candidate over a clean one.
  const enforced = await finalizeDefinition(word, slots, [winnerDef, otherDef]);
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
    cited: enforced.cited,
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
  console.log('🚀 Starting AI-powered per-sense longDefinition backfill (generator → validator → opus retry → opus chooser)...\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    // Senses come from definitionClusters, so clustering must have run first
    // (backfill-cluster-definitions.js — the mark-discoverable pipeline orders it before
    // this script). partsOfSpeech is still required as the fallback POS list for a
    // cluster that carries none of its own.
    const { rows: entries } = await client.query(`
      SELECT id, word1, "partsOfSpeech", "definitionClusters"
      FROM dictionaryentries_zh
      WHERE language = 'zh'
        ${discoverableFilter}
        ${validatedFilter}
        ${needsBackfillFilter}
        AND "partsOfSpeech" IS NOT NULL
        AND jsonb_array_length("partsOfSpeech") > 0
        AND "definitionClusters" IS NOT NULL
        AND jsonb_array_length("definitionClusters") > 0
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
    let skipped = 0;
    let acceptedFirst = 0;
    let flaggedEntries = 0;   // entries whose final text still cites the headword (see REVIEW_MARKER)
    let opusRetries = 0;
    let chooserPickedSonnet = 0;
    let chooserPickedOpus = 0;

    for (const row of entries) {
      try {
        const clusters = usableClusters(row.definitionClusters);
        if (clusters.length === 0) {
          // Clustered but every cluster lacks a usable `sense` label — there is no join key
          // to write against, so skip rather than produce definitions nothing can address.
          console.log(`  ${row.word1} ... SKIPPED: no sense-labeled clusters`);
          skipped++;
          continue;
        }

        // Expand the clusters into (sense, POS) pairs — the unit of generation.
        const slots = buildSlots(clusters, row.partsOfSpeech ?? []);
        const senseCount = clusters.length;
        process.stdout.write(
          `  ${row.word1} [${senseCount} sense${senseCount === 1 ? '' : 's'} → ${slots.length} pair${slots.length === 1 ? '' : 's'}] ... `
        );

        const result = await runDefinitionPipeline(row.word1, slots);

        if (!result.definition) {
          console.log(`FAILED: ${result.finalCritique}`);
          failed++;
          continue;
        }

        // longDefinition is a JSONB array of per-(sense, POS) objects — serialize for the jsonb param.
        await client.query(
          `UPDATE dictionaryentries_zh SET "longDefinition" = $1::jsonb WHERE id = $2`,
          [JSON.stringify(result.definition), row.id]
        );
        await stampEntries(client, 'dictionaryentries_zh', row.id);

        // A citation that survived the repair pass is written, not discarded — the definition
        // is still useful — but flagged to stdout for the human review sweep. See REVIEW_MARKER.
        if (result.cited?.length) {
          flaggedEntries++;
          console.log(
            `\n${REVIEW_MARKER} ${row.word1} (id=${row.id}): cites the headword (or a compound ` +
            `containing it) after one repair pass — ${result.cited.join('; ')}`
          );
        }

        // Tag shows the worst-case definition length against the per-pair budget, how many of
        // the entry's (sense, POS) pairs got covered, and whether the tightener had to run.
        const coverage = `${result.definition.length}/${slots.length} pairs`;
        const lenTag = `[${coverage}, max ${maxValueLen(result.definition)}/${result.maxLen}${result.tightened ? ' tightened' : ''}${result.overBudget ? ' ⚠OVER' : ''}]`;
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
    console.log(`Skipped (no sense label): ${skipped}`);
    console.log(`Accepted on 1st pass    : ${acceptedFirst}`);
    console.log(`Flagged for review      : ${flaggedEntries} entr${flaggedEntries === 1 ? 'y' : 'ies'}${flaggedEntries ? ` (see "${REVIEW_MARKER}" lines above)` : ''}`);
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
