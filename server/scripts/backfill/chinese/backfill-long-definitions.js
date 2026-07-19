/**
 * Backfill Script: AI-powered longDefinition for dictionaryentries_zh
 *
 * Pipeline (mirrors backfill-parts-of-speech.js):
 *   1. Generator agent (Sonnet) — writes a per-POS definition OBJECT { "<pos>": "..." }.
 *   2. Validator agent (Sonnet) — checks all hard constraints; may reject with a critique.
 *   3. Regenerator agent (Opus) — on rejection, retries once informed by the validator critique.
 *   4. Chooser agent (Opus) — picks the better definition object between Sonnet's and Opus's attempts.
 *
 * Only processes entries where partsOfSpeech is already populated so definitions
 * accurately reflect every grammatical role. Run backfill-parts-of-speech.js first.
 *
 * PHILOSOPHY — ANCHOR FIRST, THEN ENRICH (v13). Every agent is shown the "displayed
 * gloss" the learner already sees on the flp flashcard (definitions[0] with
 * parentheticals stripped — see deriveDisplayDefinition / the frontend's
 * stripParentheses). Each POS value is written in one of two modes:
 *   MODE A (clean match) — when the gloss word already captures the everyday sense
 *     (INCLUDING the English word's own breadth: 水 = "water" and English "water"
 *     already spans rivers/floods, so 水 is a clean match), the value MUST open with
 *     the verbatim anchor sentence "Matches the common English definition for <gloss>."
 *     followed — only when there is something worth adding — by a SECOND paragraph
 *     (literal \n\n) of plain cultural context and/or an extended sense the English
 *     word lacks (e.g. 马's xiangqi piece).
 *   MODE B (disambiguate) — when the POS carries a sense the gloss word does NOT cover
 *     (e.g. 大's noun "eldest/senior"), no anchor: pin down the sense(s) plainly.
 * Wording must be SIMPLE (beginner-level). The anchor is the ONE sanctioned place to
 * restate the gloss and reference English; elsewhere those remain forbidden. Still no
 * synonym lists, register commentary, or regional-usage elaboration. Chinese characters
 * ARE allowed for citing culturally significant idioms (pinyin is not); output stays
 * primarily English.
 *
 * OUTPUT SHAPE: a JSON OBJECT keyed by part of speech — one definition per POS,
 * primary POS first (e.g. { "noun": "...", "verb": "..." }). Single-POS words emit a
 * one-key object. This is stored verbatim in the JSONB `longDefinition` column
 * (migration 70) and joined back into a labeled "pos: ... \n\n pos: ..." string at the
 * read boundary (longDefObjectToDisplayString) for the API/renderer.
 *
 * LENGTH is per POS value: each definition value must be MIN_LEN..MAX_LEN_PER_POS
 * (25–125) chars, independent of how many POS the word has. Because the validator only
 * length-checks the first attempt, a final enforceMaxLen step (Opus tightener)
 * guarantees every value respects the budget.
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
import { initRunLog, cachedSystem } from '../run-log.js';
const SCRIPT_VERSION = 13; // bump when this script's logic/prompt changes

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

// Length budget is PER POS VALUE. Each POS gets its own independent definition with
// its own budget — total length is no longer split across senses. A 1-POS word and
// each sense of a 3-POS word are all bounded by the same [MIN_LEN, MAX_LEN_PER_POS].
const MIN_LEN = 25;
// Raised from 125 to fit the anchor-first, two-paragraph Mode-A shape: a ~48-char
// anchor sentence ("Matches the common English definition for horse.") plus a blank
// line plus one or two plain culture sentences. Still a CEILING, not a target — an
// anchor-only value (no culture to add) is perfectly valid and far shorter.
const MAX_LEN_PER_POS = 250;

// ── Object-shape helpers ─────────────────────────────────────────────────────
// A definition is a plain object keyed by POS: { "<pos>": "<text>", ... }.

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

// True when the object covers exactly the expected POS and every value is in range.
function isValidDefObject(def, posList) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return false;
  const keys = Object.keys(def);
  if (keys.length === 0) return false;
  // Every expected POS must be present (extra keys are tolerated but discouraged).
  for (const pos of posList) {
    if (!(pos in def)) return false;
  }
  return defValues(def).every(v => v.length >= MIN_LEN && v.length <= MAX_LEN_PER_POS);
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

function definitionRulesText() {
  return `
A "long definition" is a plain-language enrichment shown in the extra-info panel. Its job is to ANCHOR
the learner in the word's ordinary meaning first, then add cultural or extended nuance. The learner also
sees a short gloss (provided below as the "displayed gloss").

WRITE EACH POS VALUE IN ONE OF TWO MODES — decide per part of speech:

MODE A — CLEAN MATCH. Use this whenever the word's everyday meaning for this POS is fully captured by the
displayed gloss word. IMPORTANT: the English gloss word's OWN breadth counts as a match — if English
speakers already use the gloss word for the same range of things, it is still a clean match. Example:
水 means "water", and English "water" already covers rivers, floods, and liquids in general, so 水 is a
CLEAN MATCH, not a word to disambiguate. Test: told only that this word means "<gloss>", would a native
English speaker already understand its core everyday use correctly? If yes → Mode A. Format:
  1. FIRST SENTENCE, VERBATIM: "Matches the common English definition for <gloss>." — swap in the gloss
     word as given, but normalized to its bare dictionary form: drop a leading article ("a"/"an"/"the")
     and, for a verb gloss written as an infinitive, drop the leading "to" (gloss "horse" → "...for
     horse."; gloss "to eat" → "...for eat."; gloss "a knife" → "...for knife."). Keep the noun singular.
     This required opening sentence is the ONE place you state the gloss and reference English; both are
     mandatory here.
  2. THEN, ONLY IF there is something genuinely worth adding, a SECOND PARAGRAPH separated by a blank line
     — write a literal \\n\\n between the two paragraphs in the string value. The second paragraph gives
     CULTURAL CONTEXT (how the concept figures in daily life, customs, associations, or a common set
     phrase) and/or a notable EXTENDED sense the English word lacks (e.g. 马 also names the horse piece in
     xiangqi). Keep it to ONE or TWO plain sentences, and never repeat the anchor. If there is nothing
     genuinely useful to add, STOP after the first sentence — do NOT pad.

MODE B — DISAMBIGUATE. Use this when this POS carries a meaning the displayed gloss word does NOT cover —
a genuinely different concept (e.g. 大's noun sense "the eldest / a senior", which "big" never means). Do
NOT use the anchor sentence in Mode B. Instead, in plain language, pin down which sense(s) the word
actually covers and any scope limit or connotation. One to three sentences, no anchor.

How to write it (BOTH modes):
- WRITE SIMPLY. Use short, common words and short sentences, as if explaining to a beginner. Avoid
  academic, abstract, or flowery wording. Plain and clear always beats clever.
- BE BRIEF. The length cap is a CEILING, not a target. Say only what matters and stop.
- IGNORE RARE LITERARY / FORMAL SENSES; STAY ON EVERYDAY MEANING. If the word has an everyday sense AND a
  much more literary, classical, archaic, formal, technical, or legal sense (what a register scorer would
  rate 1 "literary/classical/formal-only" or 2 "formal/written-leaning"), cover ONLY the everyday sense(s)
  and OMIT the rare one entirely — do not cite, gloss, or allude to it. EXCEPTION: if EVERY sense of the
  word is itself formal/literary, define it normally. Omit the rare sense silently; never announce that a
  sense is formal or literary.
- USE CHINESE CHARACTERS SPARINGLY — only to cite a term that is itself CULTURALLY SIGNIFICANT (a real
  idiom / chengyu, or a culturally loaded phrase such as 九五之尊 or 关系网). Do NOT use Chinese for
  constructed example sentences or trivial collocations; describe ordinary usage in English. When you do
  cite a culturally significant term, use characters (never pinyin) woven into a sentence — never a bare
  list.
- DO NOT LIST SYNONYMS. This is a definition, not a thesaurus.

Output shape — a JSON object keyed by part of speech:
- Write ONE value per part of speech, as a JSON object whose KEYS are the parts of speech (exactly as
  given) and whose VALUES are that POS's definition string, ordered from the MOST common/primary POS to
  the least, e.g.:
      {"noun": "<mode A or B text for the noun sense>", "verb": "<mode A or B text for the verb sense>"}
- If the word has only ONE part of speech, still emit a one-key object, e.g. {"noun": "..."}.
- Each VALUE is an independent definition for that single sense — do NOT label it with the POS inside the
  string, and do NOT cram other senses into it.

Hard constraints — all must be satisfied:

1. LENGTH — EACH value must be between ${MIN_LEN} and ${MAX_LEN_PER_POS} characters (the \\n\\n break
   counts). This budget is PER POS value, not a shared total. The upper bound is a hard CEILING, never a
   target — a much shorter, anchor-only value is perfectly fine. Never exceed ${MAX_LEN_PER_POS} for any
   one value.
2. ANCHOR FORMAT (MODE A) — When the POS is a clean match, the value MUST begin with the exact sentence
   "Matches the common English definition for <gloss>." using the displayed gloss word verbatim (singular,
   no article). Anything after it must be a distinct SECOND paragraph separated by a literal \\n\\n, and
   must not repeat the anchor. A clean-match value that omits or mangles this opening sentence is invalid.
3. PRIMARILY ENGLISH — CHINESE ONLY WHEN CULTURALLY SIGNIFICANT, NO PINYIN — Write in English. Include Chinese characters ONLY to cite a term that is itself culturally significant (an established idiom, chengyu, or culturally loaded set phrase, e.g. 九五之尊, 关系网). Do NOT use Chinese for ad-hoc example sentences, trivial collocations, or to illustrate ordinary grammar (e.g. 你能来吗, 现在几点) — describe such usage in English. This holds even for grammatical/function words. Do NOT cite the headword itself in Chinese, nor ordinary compounds/derived words that merely contain it (e.g. 能量, 能力) — reserve Chinese for STANDALONE, culturally significant idioms or set phrases. NEVER romanize Chinese into pinyin (with or without tone marks). Other non-ASCII letters (e.g. accented Latin letters) are forbidden.
4. NO SYNONYM LIST — Do not present the meaning as a string of synonymous words.
5. POS COVERAGE & FORMAT — The object must contain exactly one key per part of speech given (cover every POS), keyed and ordered as specified above. Do not omit a POS, invent extra POS, or merge senses.
6. REFERENCE ENGLISH ONLY IN THE ANCHOR — Do not mention "English", "the English word", or compare the word to its English rendering ANYWHERE except the required Mode-A anchor sentence. Outside that one sentence, describe the word on its own terms.
7. NO REGISTER COMMENTARY — Do not describe how formal, colloquial, literary, slangy, or technical the word is. The learner already infers register from the word's vernacular score; spend the space on meaning and concept instead.
8. NO REGIONAL-USAGE ELABORATION — Do not describe which regions, dialects, or countries use the word, or note regional variants. Focus on meaning, not geographic distribution.
9. NO "APPEARS IN" FILLER — Do not append example-word lists with "appears in", "found in", "seen in", or similar tacked-on phrasing. Cite a related phrase only when it is woven into a sentence explaining a nuance, never as a list to fill space.
10. SENTENCE COUNT — Use between 1 and 3 sentences total (inclusive). In Mode A that is the anchor sentence plus at most two culture sentences. Reject a value with 4 or more sentences, or one whose extra sentence is a tacked-on citation or a padding aside that adds no distinct nuance.
11. NO RARE-SENSE COVERAGE — Do not define, cite, or allude to a sense that is markedly more literary/classical/formal/technical/legal than the word's everyday sense(s) — a sense a register scorer would rate 1 or 2 — WHEN the word also has a common everyday sense. Cover only the everyday sense(s). EXCEPTION: if every sense of the word is formal/literary, define it normally.
`;
}

const VIOLATION_CODE_LABELS = {
  too_short: `One or more POS values is under ${MIN_LEN} characters (rule 1)`,
  too_long: `One or more POS values exceeds the ${MAX_LEN_PER_POS}-character per-POS budget (rule 1)`,
  missing_anchor: 'A clean-match (Mode A) POS value omits the required opening "Matches the common English definition for <gloss>." sentence, or does not put it first (rule 2)',
  malformed_anchor: 'The anchor sentence is not verbatim — wrong gloss word, altered wording, added article/plural, or not separated from the culture paragraph by a blank line (rule 2)',
  wrong_mode: 'Anchors (Mode A) a POS that carries a sense the gloss word does not cover, or disambiguates (Mode B) a POS that is a clean match and should be anchored (rule 2)',
  uses_pinyin: 'Romanizes a Chinese word into pinyin instead of using Chinese characters (rule 3)',
  gratuitous_chinese: 'Uses Chinese for an ad-hoc example, the headword itself, or an ordinary compound/derived word rather than a standalone culturally significant term (rule 3)',
  contains_non_english: 'Contains non-ASCII letters other than Chinese characters (e.g. accented Latin letters / pinyin diacritics) (rule 3)',
  lists_synonyms: 'Presents the meaning as a list/string of synonymous words (rule 4)',
  poor_pos_coverage: 'Object does not contain exactly one key per part of speech (missing/extra POS, or wrong object shape) (rule 5)',
  references_english: 'Mentions English or compares the word to its English rendering OUTSIDE the allowed Mode-A anchor sentence (rule 6)',
  comments_on_register: 'Comments on register / formality / colloquialness (rule 7)',
  elaborates_regional: 'Elaborates on regional, dialectal, or geographic usage (rule 8)',
  appears_in_filler: 'Uses an "appears in" / "found in" style tacked-on example listing (rule 9)',
  extra_sentence: 'Exceeds 3 sentences, or pads with a tacked-on sentence citing a related phrase/chengyu or a filler aside (rule 10)',
  covers_rare_sense: 'Defines, cites, or alludes to a rare literary/classical/formal-only sense (register 1–2) when the word also has an everyday sense (rule 11)',
  inaccurate: 'Definition is factually misleading or incorrect for a learner',
};

// Mirror of the frontend's stripParentheses (src/utils/definitionUtils.ts): the flp
// flashcard shows definitions[0] with parentheticals removed, so we derive the
// "displayed gloss" the same way to give the agents exactly what the learner sees.
function stripParentheses(text) {
  return (text ?? '').replace(/\s*\([^)]*\)/g, '').trim();
}

// The display definition shown in flp is the FIRST element of the (already
// usefulness-ranked) definitions array, parentheticals stripped.
function deriveDisplayDefinition(definitions) {
  if (!Array.isArray(definitions) || definitions.length === 0) return '';
  return stripParentheses(definitions[0]);
}

// Context block injected into every agent prompt so all agents know — but never
// restate — the gloss the learner already sees on the flashcard.
function displayDefinitionBlock(displayDefinition) {
  return `Displayed gloss (already shown to the learner on the flashcard — for your context only; do NOT restate or paraphrase it): "${displayDefinition || '(none)'}"`;
}

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

async function generateDefinition(word, partsOfSpeech, displayDefinition, model = GEN_MODEL) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];
  const posLine = posList.length > 0 ? `Parts of speech (primary first): ${posList.join(', ')}` : '';

  // Static instruction prefix (identical for every entry) → cached system block.
  // Per-entry data (word/POS/displayed gloss) stays in the user message so the
  // cached prefix is byte-identical across the run. See cachedSystem in run-log.js.
  const systemText = `You are a Chinese language expert writing concise English definitions for a learner dictionary.

${definitionRulesText()}

Respond with ONLY the JSON object (keys = the parts of speech given, values = each definition) — no markdown fences, no extra prose.`;

  const prompt = `Word: ${word}
${posLine}
${displayDefinitionBlock(displayDefinition)}`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 600,
    temperature: 0.3,
    system: cachedSystem(systemText),
    messages: [{ role: 'user', content: prompt }],
  });

  return parseDefObject(response.content[0].text, posList);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 2: validator (Sonnet)
//  Returns { accept, violatedRules: string[], critique }
// ─────────────────────────────────────────────────────────────────────────────

async function validateDefinition(word, partsOfSpeech, displayDefinition, proposed) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];

  // Static reviewer scaffold (rules + violation codes + response format) → cached
  // system block; the per-entry word/POS/gloss/proposed object → user message.
  const systemText = `You are a strict reviewer checking a per-POS English definition object for a Chinese word. Apply every constraint formally — do not approve if any rule is violated, including for any single POS value. Respond only with valid JSON.

${definitionRulesText()}

Violation codes you may cite:
${Object.entries(VIOLATION_CODE_LABELS).map(([k, v]) => `  - "${k}": ${v}`).join('\n')}

The per-POS budget is ${MAX_LEN_PER_POS} characters.

If the object satisfies every constraint, respond with: {"accept": true}
If any constraint is violated (for any POS value), respond with:
  {"accept": false, "violatedRules": ["code1", "code2"], "critique": "1-2 sentences naming which POS value(s) fail and what a corrected object should look like"}

Respond with ONLY valid JSON, no markdown.`;

  const prompt = `Word: ${word}
Parts of speech (primary first): ${posList.join(', ') || 'N/A'}
${displayDefinitionBlock(displayDefinition)}
Proposed definition object (per-POS char counts shown):
${annotateDefForPrompt(proposed)}`;

  const response = await anthropic.messages.create({
    model: VALIDATOR_MODEL,
    max_tokens: 300,
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

async function regenerateDefinition(word, partsOfSpeech, displayDefinition, priorDef, violatedRules, critique) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];
  const violationLines = violatedRules
    .map(code => `  - ${code}: ${VIOLATION_CODE_LABELS[code] ?? code}`)
    .join('\n');

  const prompt = `Your previous per-POS English definition object for a Chinese word was rejected by a strict reviewer. Produce a corrected object that fixes all flagged violations.

${definitionRulesText()}

Word: ${word}
Parts of speech (primary first): ${posList.join(', ') || 'N/A'}
${displayDefinitionBlock(displayDefinition)}

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
    system: 'You are a Chinese language expert writing concise, rule-compliant per-POS English definition objects. Respond only with the JSON object.',
    messages: [{ role: 'user', content: prompt }],
  });

  return parseDefObject(response.content[0].text, posList);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 4: chooser (Opus) — final adjudicator between Sonnet's and Opus's objects
//  Returns { winner: 'sonnet' | 'opus', reason: string }
// ─────────────────────────────────────────────────────────────────────────────

async function chooseDefinition(word, partsOfSpeech, displayDefinition, sonnetDef, opusDef) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];

  const prompt = `Two per-POS English definition objects have been proposed for a Chinese word. Pick the better one as written — do not propose a third.

${definitionRulesText()}

Word: ${word}
Parts of speech (primary first): ${posList.join(', ') || 'N/A'}
${displayDefinitionBlock(displayDefinition)}

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
//  without losing nuance. Needed because the validator only length-checks the
//  first (Sonnet) attempt; the retry/chooser path can otherwise emit over-budget
//  values that are never re-measured.
// ─────────────────────────────────────────────────────────────────────────────

async function tightenDefinition(word, partsOfSpeech, displayDefinition, tooLongDef) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];
  const offenders = overBudgetKeys(tooLongDef);

  const prompt = `A per-POS English definition object for a Chinese word has one or more values over the ${MAX_LEN_PER_POS}-character per-POS budget. Staying within ${MAX_LEN_PER_POS} characters PER VALUE is MANDATORY and is the top priority — cut whatever it takes from the over-long value(s), dropping the least-essential details, to land at ${MAX_LEN_PER_POS} characters or fewer for EACH value. Keep the single most important nuance per value; losing secondary nuance is acceptable. Keep the same POS keys; do not drop or add a POS.

${definitionRulesText()}

Word: ${word}
Parts of speech (primary first): ${posList.join(', ') || 'N/A'}
${displayDefinitionBlock(displayDefinition)}

Over-budget object (per-POS char counts shown; values over budget: ${offenders.join(', ') || 'n/a'}):
${annotateDefForPrompt(tooLongDef)}

Respond with ONLY the shortened JSON object — no markdown fences, no extra prose. EVERY value MUST be ${MAX_LEN_PER_POS} characters or fewer.`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 600,
    // Note: claude-opus-4-8 does not accept the `temperature` parameter — omit it.
    system: 'You are a Chinese language expert compressing per-POS definition objects to a strict per-value length while preserving nuance. Respond only with the JSON object.',
    messages: [{ role: 'user', content: prompt }],
  });

  return parseDefObject(response.content[0].text, posList);
}

// Programmatic length guard. The validator only checks Sonnet's first attempt, so
// the Opus retry/chooser path can return objects with over-budget values. Given
// candidate objects ordered best-first, return the first whose every value is within
// [MIN_LEN, MAX_LEN_PER_POS]; otherwise ask Opus to compress (up to 4 tries); as a
// last resort return the candidate with the smallest worst-case value and flag it.
async function enforceMaxLen(word, partsOfSpeech, displayDefinition, candidates) {
  const valid = candidates.filter(Boolean);
  for (const c of valid) {
    if (defWithinBudget(c)) return { definition: c, tightened: false, overBudget: false };
  }
  let current = valid[0];
  for (let i = 0; i < 4 && current; i++) {
    const t = await tightenDefinition(word, partsOfSpeech, displayDefinition, current);
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

async function runDefinitionPipeline(word, partsOfSpeech, displayDefinition) {
  // Per-POS budget is constant (MAX_LEN_PER_POS); kept in the result for logging.
  const maxLen = MAX_LEN_PER_POS;

  const firstDef = await generateDefinition(word, partsOfSpeech, displayDefinition, GEN_MODEL);
  if (!firstDef) {
    return { definition: null, attempts: 1, model: GEN_MODEL, accepted: false, maxLen, finalCritique: 'Generator returned empty/unparseable output' };
  }

  const verdict1 = await validateDefinition(word, partsOfSpeech, displayDefinition, firstDef);
  if (verdict1.accept) {
    // Validator already enforced length, but guard anyway in case it miscounted.
    const enforced = await enforceMaxLen(word, partsOfSpeech, displayDefinition, [firstDef]);
    return { definition: enforced.definition, attempts: 1, model: GEN_MODEL, accepted: true, maxLen, tightened: enforced.tightened, overBudget: enforced.overBudget, finalCritique: '' };
  }

  // Sonnet's attempt was rejected — retry with Opus, informed by the critique.
  const retryDef = await regenerateDefinition(word, partsOfSpeech, displayDefinition, firstDef, verdict1.violatedRules, verdict1.critique);
  if (!retryDef) {
    const enforced = await enforceMaxLen(word, partsOfSpeech, displayDefinition, [firstDef]);
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
  const choice = await chooseDefinition(word, partsOfSpeech, displayDefinition, firstDef, retryDef);
  const winnerDef = choice.winner === 'sonnet' ? firstDef : retryDef;
  const winnerModel = choice.winner === 'sonnet' ? GEN_MODEL : RETRY_MODEL;
  const otherDef = choice.winner === 'sonnet' ? retryDef : firstDef;
  // Enforce the budget, preferring the chooser's winner, then the other candidate.
  const enforced = await enforceMaxLen(word, partsOfSpeech, displayDefinition, [winnerDef, otherDef]);
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
    // correctly reflect every grammatical role the word can take. Run
    // backfill-parts-of-speech.js first if entries are being skipped here.
    const { rows: entries } = await client.query(`
      SELECT id, word1, "partsOfSpeech", definitions
      FROM dictionaryentries_zh
      WHERE language = 'zh'
        ${discoverableFilter}
        ${validatedFilter}
        ${needsBackfillFilter}
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

        const displayDefinition = deriveDisplayDefinition(row.definitions);
        const result = await runDefinitionPipeline(row.word1, row.partsOfSpeech ?? [], displayDefinition);

        if (!result.definition) {
          console.log(`FAILED: ${result.finalCritique}`);
          failed++;
          continue;
        }

        // longDefinition is a JSONB object keyed by POS — serialize for the jsonb param.
        await client.query(
          `UPDATE dictionaryentries_zh SET "longDefinition" = $1::jsonb WHERE id = $2`,
          [JSON.stringify(result.definition), row.id]
        );
        await stampEntries(client, 'dictionaryentries_zh', row.id);

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
