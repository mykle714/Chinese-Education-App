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
 * The longDefinition is an ENRICHMENT, not a gloss: every agent is shown the
 * "displayed gloss" the learner already sees on the flp flashcard (definitions[0]
 * with parentheticals stripped — see deriveDisplayDefinition / the frontend's
 * stripParentheses) as context, and is instructed to add ONLY nuance beyond it
 * (which senses/contexts the word covers, scope; cultural context when the gloss
 * already captures the meaning fully). It must never restate the gloss, list
 * synonyms, reference the English language (unless the word's own meaning is about
 * English), comment on register/formality (the learner gets that from
 * vernacularScore), or elaborate on regional usage. Chinese characters ARE allowed
 * for citing words/phrases (pinyin is not — use the characters); output stays
 * primarily English. Multi-POS entries use a labeled "noun: ... \n\n verb: ..."
 * format ordered most-common POS first.
 *
 * LENGTH is dynamic: maxChars = 100 * (posCount + 1) (see maxLenForPos). Because the
 * validator only length-checks the first attempt, a final enforceMaxLen step (Opus
 * tightener) guarantees the written value respects the budget.
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
import { initRunLog } from '../run-log.js';
const SCRIPT_VERSION = 10; // bump when this script's logic/prompt changes

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries } = initRunLog({ script: 'chinese/backfill-long-definitions', version: SCRIPT_VERSION, anthropic: anthropic });
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
//  Shared rule text — injected into generator, validator, regenerator, chooser,
//  and tightener prompts so all agents judge by the exact same criteria. It is a
//  FUNCTION because the max length is dynamic (scales with POS count — see
//  maxLenForPos).
// ─────────────────────────────────────────────────────────────────────────────

const MIN_LEN = 25;

// Length budget scales with the number of parts of speech so multi-POS entries
// (which use the labeled "noun: ... \n\n verb: ..." format) get room for each
// sense:  maxChars = 100 * (posCount + 1)  →  1 POS = 200, 2 POS = 300, 3 POS = 400.
function maxLenForPos(posCount) {
  return 100 * (Math.max(1, posCount) + 1);
}

function definitionRulesText(maxLen) {
  return `
A "long definition" is an enrichment shown in the extra-info panel. The learner ALREADY sees a short
gloss (provided below as the "displayed gloss"); your job is to deepen understanding BEYOND it.

How to write it:
- ADD ONLY WHAT THE GLOSS DOES NOT ALREADY CONVEY. Omit anything a reader could infer just from the
  displayed gloss. Never restate, paraphrase, or summarize it.
- PIN DOWN WHICH CONTEXTS THE WORD COVERS AND DOES NOT COVER. This matters most when the gloss word
  itself spans several meanings or contexts: specify which of those senses this word actually applies
  to, and any connotation or scope limit on its meaning.
- IF THE GLOSS ALREADY CAPTURES THE MEANING FULLY (a clean one-to-one concept with nothing left to
  disambiguate), instead give genuine CULTURAL CONTEXT about the concept — how it figures in daily
  life, customs, associations, or common set phrases.
- USE CHINESE CHARACTERS SPARINGLY — only to cite a term that is itself CULTURALLY SIGNIFICANT (a real
  idiom / chengyu, or a culturally loaded phrase such as 九五之尊 or 关系网) and that adds genuine cultural
  insight. Do NOT pepper the definition with constructed example sentences or trivial collocations in
  Chinese; describe ordinary usage in English instead — this applies even to grammatical/function words,
  whose constructions must be explained in English, not shown in Chinese. When you do cite a culturally
  significant term, use characters, never pinyin, and weave it into a sentence — never a bare example list.
- BREVITY IS GOOD. The length cap is a CEILING, not a target. A short, dense definition that fully
  conveys the nuance is better than a padded one; stop once you have said what matters.
- DO NOT LIST SYNONYMS. This is a definition, not a thesaurus.

Multiple parts of speech — required format:
- If the word has MORE THAN ONE part of speech, write one labeled segment per POS, ordered from the
  MOST common/primary POS to the least, each separated by a blank line, exactly like:
      noun: <nuance for the noun sense>

      verb: <nuance for the verb sense>
- If the word has only ONE part of speech, write a single unlabeled definition (no "noun:" prefix).

Hard constraints — all must be satisfied:

1. LENGTH — Between ${MIN_LEN} and ${maxLen} characters. The upper bound is a hard CEILING, never a target — do not pad to approach it; a much shorter definition is perfectly fine. Count precisely and never exceed ${maxLen}.
2. PRIMARILY ENGLISH — CHINESE ONLY WHEN CULTURALLY SIGNIFICANT, NO PINYIN — Write in English. Include Chinese characters ONLY to cite a term that is itself culturally significant (an established idiom, chengyu, or culturally loaded set phrase, e.g. 九五之尊, 关系网). Do NOT use Chinese for ad-hoc example sentences, trivial collocations, contrast words, or to illustrate ordinary grammar (e.g. 你能来吗, 现在几点, 外面刮风了, 红薯) — describe such usage in English. This holds even for grammatical/function words (particles, pronouns, conjunctions, measure words): explain their senses and constructions in plain English; do NOT show them with Chinese example phrases. Also do NOT cite the headword (the target word) itself in Chinese, and do NOT cite ordinary compounds or derived words that merely contain it (e.g. 能量, 能力, 工作单位) — reserve Chinese for STANDALONE, culturally significant idioms or set phrases. NEVER romanize Chinese into pinyin (with or without tone marks). Other non-ASCII letters (e.g. accented Latin letters) are forbidden.
3. NO CONTRAST AGAINST THE GLOSS — Do not frame the meaning as a contrast with the displayed gloss or its English wording (e.g. "rather than [the gloss]", "instead of X", "not X but Y", "as opposed to" the English sense). Contrast is allowed ONLY when it describes the word's OWN semantics — distinguishing two of its senses, or an earlier vs. later state.
4. NO BARE SELF-REFERENCE — Do not define the word by merely restating it or quoting a literal gloss of it. (Citing the target inside a genuine example phrase, in characters, is fine.)
5. POS COVERAGE & FORMAT — Cover every part of speech, using the labeled multi-POS format above whenever there is more than one.
6. NO SYNONYM LIST — Do not present the meaning as a string of synonymous words.
7. NO GLOSS RESTATEMENT — Add only nuance the displayed gloss does not convey; never quote, paraphrase, or restate it, and never state what a reader could already infer from it.
8. DO NOT REFERENCE ENGLISH — Never mention "English", "the English word", "its English equivalent/translation", or compare the word to its English rendering. Describe the word on its own terms. The ONLY exception is when the word's own meaning is about the English language itself.
9. NO REGISTER COMMENTARY — Do not describe how formal, colloquial, literary, slangy, or technical the word is. The learner already infers register from the word's vernacular score; spend the space on meaning and concept instead.
10. NO REGIONAL-USAGE ELABORATION — Do not describe which regions, dialects, or countries use the word, or note regional variants. Focus on meaning, not geographic distribution.
11. NO "APPEARS IN" FILLER — Do not append example-word lists with "appears in", "found in", "seen in", or similar tacked-on phrasing. Cite a related phrase only when it is woven into a sentence explaining a nuance, never as a list to fill space.
`;
}

const VIOLATION_CODE_LABELS = {
  too_short: `Definition is under ${MIN_LEN} characters (rule 1)`,
  too_long: 'Definition exceeds the character budget allowed for its POS count (rule 1)',
  uses_pinyin: 'Romanizes a Chinese word into pinyin instead of using Chinese characters (rule 2)',
  gratuitous_chinese: 'Uses Chinese for an ad-hoc example, the headword itself, or an ordinary compound/derived word rather than a standalone culturally significant term (rule 2)',
  contains_non_english: 'Contains non-ASCII letters other than Chinese characters (e.g. accented Latin letters / pinyin diacritics) (rule 2)',
  contrastive_construction: 'Frames the meaning as a contrast against the displayed gloss / its English wording (rule 3)',
  self_reference: 'Defines the word by merely restating it or quoting a literal gloss (rule 4)',
  poor_pos_coverage: 'Does not cover every part of speech, or omits the labeled multi-POS format (rule 5)',
  lists_synonyms: 'Presents the meaning as a list/string of synonymous words (rule 6)',
  restates_display_definition: 'Restates, paraphrases, or only echoes inferences from the displayed gloss (rule 7)',
  references_english: 'Mentions English or compares the word to its English rendering (rule 8)',
  comments_on_register: 'Comments on register / formality / colloquialness (rule 9)',
  elaborates_regional: 'Elaborates on regional, dialectal, or geographic usage (rule 10)',
  appears_in_filler: 'Uses an "appears in" / "found in" style tacked-on example listing (rule 11)',
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

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 1: generator (Sonnet)
// ─────────────────────────────────────────────────────────────────────────────

async function generateDefinition(word, partsOfSpeech, displayDefinition, maxLen, model = GEN_MODEL) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];
  const posLine = posList.length > 0 ? `Parts of speech (primary first): ${posList.join(', ')}` : '';

  const prompt = `You are a Chinese language expert writing concise English definitions for a learner dictionary.

Word: ${word}
${posLine}
${displayDefinitionBlock(displayDefinition)}

${definitionRulesText(maxLen)}

Respond with ONLY the definition text — no quotes, no JSON, no extra text.`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 400,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  return text.length >= MIN_LEN ? text : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 2: validator (Sonnet)
//  Returns { accept, violatedRules: string[], critique }
// ─────────────────────────────────────────────────────────────────────────────

async function validateDefinition(word, partsOfSpeech, displayDefinition, maxLen, proposed) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];

  const prompt = `You are a strict reviewer checking an English dictionary definition for a Chinese word. Apply every constraint formally — do not approve a definition that violates any rule.

${definitionRulesText(maxLen)}

Word: ${word}
Parts of speech (primary first): ${posList.join(', ') || 'N/A'}
${displayDefinitionBlock(displayDefinition)}
Proposed definition (${proposed.length} chars; budget is ${maxLen}): "${proposed}"

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

async function regenerateDefinition(word, partsOfSpeech, displayDefinition, maxLen, priorDef, violatedRules, critique) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];
  const violationLines = violatedRules
    .map(code => `  - ${code}: ${VIOLATION_CODE_LABELS[code] ?? code}`)
    .join('\n');

  const prompt = `Your previous English definition for a Chinese word was rejected by a strict reviewer. Produce a corrected definition that fixes all flagged violations.

${definitionRulesText(maxLen)}

Word: ${word}
Parts of speech (primary first): ${posList.join(', ') || 'N/A'}
${displayDefinitionBlock(displayDefinition)}

Previous attempt: "${priorDef}"
Violated rules:
${violationLines || '  (none specified)'}
Reviewer critique:
${critique || '(none)'}

Apply all constraints precisely. You may keep, change, or restructure any part of the previous attempt. Respond with ONLY the corrected definition text — no quotes, no JSON, no extra text.`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 400,
    // Note: claude-opus-4-8 does not accept the `temperature` parameter — omit it.
    system: 'You are a Chinese language expert writing concise, rule-compliant English definitions. Respond only with the definition text.',
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  return text.length >= MIN_LEN ? text : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent 4: chooser (Opus) — final adjudicator between Sonnet's and Opus's definitions
//  Returns { winner: 'sonnet' | 'opus', reason: string }
// ─────────────────────────────────────────────────────────────────────────────

async function chooseDefinition(word, partsOfSpeech, displayDefinition, maxLen, sonnetDef, opusDef) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];

  const prompt = `Two English definitions have been proposed for a Chinese word. Pick the better one as written — do not propose a third.

${definitionRulesText(maxLen)}

Word: ${word}
Parts of speech (primary first): ${posList.join(', ') || 'N/A'}
${displayDefinitionBlock(displayDefinition)}

Option A (sonnet, ${sonnetDef.length} chars): "${sonnetDef}"
Option B (opus, ${opusDef.length} chars):   "${opusDef}"

Judge which definition better satisfies all constraints and quality goals. Penalize constraint violations (including exceeding the ${maxLen}-character budget) AND vague or unhelpful definitions.

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
//  Agent 5: tightener (Opus) — compresses an over-budget definition to <= maxLen
//  without losing nuance. Needed because the validator only length-checks the
//  first (Sonnet) attempt; the retry/chooser path can otherwise emit over-budget
//  text that is never re-measured.
// ─────────────────────────────────────────────────────────────────────────────

async function tightenDefinition(word, partsOfSpeech, displayDefinition, maxLen, tooLongDef) {
  const posList = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean) : [];

  const prompt = `An English definition for a Chinese word is too long. Staying within ${maxLen} characters is MANDATORY and is the top priority — cut whatever it takes, dropping the least-essential details, to land at ${maxLen} characters or fewer. Keep the single most important nuance; losing secondary nuance is acceptable. Preserve the labeled multi-POS format ("noun: ... \\n\\n verb: ...") if the original uses it.

${definitionRulesText(maxLen)}

Word: ${word}
Parts of speech (primary first): ${posList.join(', ') || 'N/A'}
${displayDefinitionBlock(displayDefinition)}

Too-long definition (${tooLongDef.length} chars; budget is ${maxLen}): "${tooLongDef}"

Respond with ONLY the shortened definition text — no quotes, no JSON, no extra text. It MUST be ${maxLen} characters or fewer.`;

  const response = await anthropic.messages.create({
    model: RETRY_MODEL,
    max_tokens: 400,
    // Note: claude-opus-4-8 does not accept the `temperature` parameter — omit it.
    system: 'You are a Chinese language expert compressing definitions to a strict length while preserving nuance. Respond only with the definition text.',
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  return text.length >= MIN_LEN ? text : null;
}

// Programmatic length guard. The validator only checks Sonnet's first attempt, so
// the Opus retry/chooser path can return over-budget text. Given candidates ordered
// best-first, return the first already within [MIN_LEN, maxLen]; otherwise ask Opus
// to compress (up to 2 tries); as a last resort return the shortest seen and flag it.
async function enforceMaxLen(word, partsOfSpeech, displayDefinition, maxLen, candidates) {
  const valid = candidates.filter(Boolean);
  for (const c of valid) {
    if (c.length >= MIN_LEN && c.length <= maxLen) return { definition: c, tightened: false, overBudget: false };
  }
  let current = valid[0];
  for (let i = 0; i < 4 && current; i++) {
    const t = await tightenDefinition(word, partsOfSpeech, displayDefinition, maxLen, current);
    if (t && t.length >= MIN_LEN && t.length <= maxLen) return { definition: t, tightened: true, overBudget: false };
    if (t && t.length < current.length) current = t; // keep shrinking from the shortest so far
  }
  const all = [...valid, current].filter(Boolean).sort((a, b) => a.length - b.length);
  const shortest = all[0];
  return { definition: shortest, tightened: true, overBudget: shortest.length > maxLen };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Orchestrator: generator → validator → (opus retry → opus chooser) → final
//  Returns { definition, attempts, model, accepted, finalCritique, ... }
// ─────────────────────────────────────────────────────────────────────────────

async function runDefinitionPipeline(word, partsOfSpeech, displayDefinition) {
  const posCount = Array.isArray(partsOfSpeech) ? partsOfSpeech.filter(Boolean).length : 0;
  const maxLen = maxLenForPos(posCount);

  const firstDef = await generateDefinition(word, partsOfSpeech, displayDefinition, maxLen, GEN_MODEL);
  if (!firstDef) {
    return { definition: null, attempts: 1, model: GEN_MODEL, accepted: false, maxLen, finalCritique: 'Generator returned empty output' };
  }

  const verdict1 = await validateDefinition(word, partsOfSpeech, displayDefinition, maxLen, firstDef);
  if (verdict1.accept) {
    // Validator already enforced length, but guard anyway in case it miscounted.
    const enforced = await enforceMaxLen(word, partsOfSpeech, displayDefinition, maxLen, [firstDef]);
    return { definition: enforced.definition, attempts: 1, model: GEN_MODEL, accepted: true, maxLen, tightened: enforced.tightened, overBudget: enforced.overBudget, finalCritique: '' };
  }

  // Sonnet's attempt was rejected — retry with Opus, informed by the critique.
  const retryDef = await regenerateDefinition(word, partsOfSpeech, displayDefinition, maxLen, firstDef, verdict1.violatedRules, verdict1.critique);
  if (!retryDef) {
    const enforced = await enforceMaxLen(word, partsOfSpeech, displayDefinition, maxLen, [firstDef]);
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
  const choice = await chooseDefinition(word, partsOfSpeech, displayDefinition, maxLen, firstDef, retryDef);
  const winnerDef = choice.winner === 'sonnet' ? firstDef : retryDef;
  const winnerModel = choice.winner === 'sonnet' ? GEN_MODEL : RETRY_MODEL;
  const otherDef = choice.winner === 'sonnet' ? retryDef : firstDef;
  // Enforce the budget, preferring the chooser's winner, then the other candidate.
  const enforced = await enforceMaxLen(word, partsOfSpeech, displayDefinition, maxLen, [winnerDef, otherDef]);
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

        const displayDefinition = deriveDisplayDefinition(row.definitions);
        const result = await runDefinitionPipeline(row.word1, row.partsOfSpeech ?? [], displayDefinition);

        if (!result.definition) {
          console.log(`FAILED: ${result.finalCritique}`);
          failed++;
          continue;
        }

        await client.query(
          `UPDATE dictionaryentries_zh SET "longDefinition" = $1 WHERE id = $2`,
          [result.definition, row.id]
        );
        await stampEntries(client, 'dictionaryentries_zh', row.id);

        // Tags appended to every line so spot-checks surface the length budget and
        // whether the tightener had to run (and whether it still came up short).
        const lenTag = `[${result.definition.length}/${result.maxLen}${result.tightened ? ' tightened' : ''}${result.overBudget ? ' ⚠OVER' : ''}]`;

        if (result.attempts === 1) {
          acceptedFirst++;
          console.log(`"${result.definition}"  [sonnet ✓] ${lenTag}`);
        } else {
          opusRetries++;
          if (result.chooser === 'sonnet') chooserPickedSonnet++;
          else chooserPickedOpus++;
          console.log(
            `"${result.definition}"  [chooser → ${result.chooser}] ${lenTag}  ` +
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
