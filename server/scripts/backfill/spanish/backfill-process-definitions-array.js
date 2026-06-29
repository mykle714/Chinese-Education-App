/**
 * Backfill Script: AI-powered definition-array processing for dictionaryentries_es (SPANISH)
 *
 * Spanish counterpart of backfill/chinese/backfill-process-definitions-array.js.
 *
 * Two jobs in one pass over the `definitions` array:
 *   (a) REORDER the glosses from most to least useful for a modern learner.
 *   (b) PRUNE very low-confidence glosses — broken English, or incredibly
 *       rare/archaic senses already covered by another gloss. Exclusively
 *       parenthetical glosses (e.g. "(literary)") are KEPT but may never rank
 *       first. The model may drop but never add or rephrase a string.
 *
 * TODO(es-linguistics): the ranking prompt + worked examples below were adapted
 * from the Chinese version. The principles (modern frequency, restrictive
 * parentheticals, archaic-last) carry over, but the worked examples use Spanish
 * words chosen first-pass — have a Spanish speaker sanity-check them, and note
 * that regional senses (e.g. peninsular vs Latin-American) may need their own
 * handling.
 *
 * Two-pass design:
 *   Pass 1 (Sonnet) — first ordering + pruning using a tuned prompt with few-shots.
 *   Pass 2 (Sonnet) — critic that sees the original list + Pass 1's output,
 *     and either confirms, refines with a one-line reason, or flags
 *     low_confidence for human review. The critic may also restore a wrongly
 *     dropped gloss or prune one the junior missed.
 *   On validation failure (added/rephrased element, empty result, JSON), the
 *   prompt is retried on Opus before giving up. A parenthetical-only gloss that
 *   leads is fixed up locally (second entry promoted), not retried.
 *
 * Short leading gloss (post-pass):
 *   After ordering/pruning, if the final leading definition is longer than
 *   MAX_FIRST_GLOSS_LEN (20) chars, a single short (≤20 char) gloss for the word
 *   is synthesized (Sonnet, Opus on retry) and PREPENDED, keeping the long gloss
 *   right behind it. This is the only step that intentionally writes a
 *   NON-source string, so every generated gloss is surfaced in the review log.
 *
 * Disagreements (Pass 2 ≠ Pass 1), low_confidence flags, any pruned glosses, and
 * every generated short gloss are dumped to a timestamped review file in /tmp so
 * the user can skim post-run.
 *
 * Usage:
 *   npx tsx scripts/backfill/spanish/backfill-process-definitions-array.js                # discoverable es entries
 *   npx tsx scripts/backfill/spanish/backfill-process-definitions-array.js --all          # all es entries
 *   npx tsx scripts/backfill/spanish/backfill-process-definitions-array.js --spot-check   # 5 entries, no writes
 *   npx tsx scripts/backfill/spanish/backfill-process-definitions-array.js --ids=1,2,3    # target specific IDs
 *   npx tsx scripts/backfill/spanish/backfill-process-definitions-array.js --no-critic    # skip Pass 2
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog, cachedSystem } from '../run-log.js';
const SCRIPT_VERSION = 3; // bump when this script's logic/prompt changes

const isSpotCheck = process.argv.includes('--spot-check');
const includeAll  = process.argv.includes('--all');
const skipCritic  = process.argv.includes('--no-critic');

const idsArg = process.argv.find(a => a.startsWith('--ids='));
const targetIds = idsArg ? idsArg.replace('--ids=', '').split(',').map(Number) : null;

// --words=未来,摸脉 → scope to specific entries only
const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries } = initRunLog({ script: 'spanish/backfill-process-definitions-array', version: SCRIPT_VERSION, anthropic: anthropic });

const PASS1_MODEL = 'claude-sonnet-4-6';
const PASS2_MODEL = 'claude-sonnet-4-6';
const RETRY_MODEL = 'claude-opus-4-8'; // used when a Sonnet response fails validation

// The card's headline slot wants a punchy gloss. If the final leading
// definition exceeds this many characters, we synthesize a short replacement
// gloss to prepend (see generateShortGloss).
const MAX_FIRST_GLOSS_LEN = 20;

const REVIEW_LOG_PATH = `/tmp/process-definitions-array-review-${Date.now()}.log`;

// ─── Pass 1 prompt ──────────────────────────────────────────────────────────
// Tuned for the failures we observed: parenthetical confusion (一下), modern
// frequency vs linguistic prototypicality (密码), and cedict's bias of listing
// archaic senses first.

const PASS1_SYSTEM = `You are a Spanish linguistics expert ranking English definitions of a Spanish word for a modern (2020s) Spanish learner's vocabulary card.`;

// Static instruction body (identical every call) → cached system block; the
// per-entry word + definitions array stays in the user message (pass1User).
const PASS1_INSTRUCTIONS = `Reorder the given word's definitions from most to least useful for a modern learner, and remove very low-confidence glosses.

Ranking principles (apply in order):
1. FIRST — The sense a modern Spanish learner is most likely to encounter today. For everyday and tech terms, this is the modern usage, not the etymological core. (e.g. for "móvil", "mobile phone" beats "motive"; for "ratón", "computer mouse" is a common modern sense alongside the animal.)
2. NEXT — The core lexical meaning the word is built around, and metaphorical/extended senses that flow from it.
3. LATER — Contextually RESTRICTED senses: definitions whose parenthetical narrows *when/where* the sense applies. Examples that count as restrictive: "(of a person)", "(in cooking)", "(grammar)", "(formal)", "(colloquial)".
4. LATER — Grammaticalized or functional uses: auxiliary uses, discourse markers, filler words, set-phrase-only senses.
5. LAST — Archaic, literary, dialectal/regional, technical-only, or rare senses: "(archaic)", "(literary)", "(dated)", "(regional)", "(Latin America)", "(Spain)", "(vulgar)", "(math.)", etc.

Important distinctions:
- A parenthetical that EXPLAINS a sense (e.g. "a little (softening the request)") does NOT make it restrictive — it's just clarifying the same primary meaning. Do not demote it.
- A parenthetical that NARROWS the sense to a specific context (e.g. "(Latin America, vulgar) to have sex") IS restrictive — demote.
- The input order is NOT a signal. The Wiktionary source often lists archaic, literary, or etymological senses first; ignore that.
- When two senses are equally core, prefer whichever a learner hears more often in everyday spoken Spanish today.

Removal (be conservative — when in doubt, KEEP the gloss and just rank it low):
Remove a definition ONLY if it is genuinely low-value for a modern learner:
- Broken English — the gloss is grammatically broken or reads as unintelligible English on its own (e.g. "doing while").
- Incredibly rare / archaic — a sense so obscure, archaic, or specialized that a modern learner will essentially never meet it, AND its meaning is already covered by another surviving gloss.
Never remove a sense that is the only one of its kind, and never remove every definition — always return at least one.

Parenthetical-only entries:
- An "exclusively parenthetical" gloss is one whose entire text is a parenthetical note (e.g. "(literary)", "(grammar)"). KEEP these — they carry usage information — but they must NEVER be placed first. Always rank at least one substantive (non-parenthetical) gloss ahead of any exclusively-parenthetical one.

Worked examples (TODO(es-linguistics): review these example words/orderings):

Word: móvil
Input:  ["motive", "mobile, movable", "mobile phone", "mobile (decorative hanging object)"]
Output: ["mobile phone", "mobile, movable", "motive", "mobile (decorative hanging object)"]
Reason: In modern Spanish (esp. Spain) "móvil" overwhelmingly means "mobile phone". The adjective sense is core; "motive" and the decorative sense are less frequent.

Word: coger
Input:  ["(Latin America, vulgar) to have sex", "to take, to grab", "to catch"]
Output: ["to take, to grab", "to catch", "(Latin America, vulgar) to have sex"]
Reason: The everyday transitive senses dominate; the regional/vulgar sense is contextually restricted and goes last.

Word: banco
Input:  ["shoal (of fish)", "bench", "bank (financial institution)"]
Output: ["bank (financial institution)", "bench", "shoal (of fish)"]
Reason: The financial sense is the most frequent for a modern learner, then the concrete "bench", then the restricted "(of fish)" sense.

Rules:
- You MAY drop low-value definitions per the Removal guidance above, but you must NEVER add, rephrase, or alter any string. Every definition you return must be copied character-for-character exactly as it appears in the input, including parenthetical notes, punctuation, and formatting.
- Return at least one definition; never return an empty array.
- Do not place an exclusively-parenthetical gloss first.
- Return ONLY a valid JSON array of strings, no explanation.`;

function pass1User(word, definitions) {
  return `Word: ${word}

Definitions:
${JSON.stringify(definitions, null, 2)}`;
}

// ─── Pass 2 critic prompt ───────────────────────────────────────────────────

const PASS2_SYSTEM = `You are a Spanish linguistics expert reviewing a junior annotator's ranking of English definitions for a modern Spanish learner's vocabulary card.`;

// Static instruction body → cached system block; per-entry word + the two orderings
// go in the user message (pass2User). All instructions lead so the cached prefix is
// byte-identical across calls.
const PASS2_INSTRUCTIONS = `Review the proposed ordering for the given word and decide whether to confirm, refine, or flag it.

Ranking principles (the junior was given these — apply the same ones):
1. FIRST — sense a modern (2020s) Spanish learner is most likely to encounter; for everyday/tech terms, modern usage beats etymological core.
2. NEXT — core lexical meaning + metaphorical extensions.
3. LATER — senses with restrictive parentheticals "(of a person)", "(in cooking)", "(grammar)", "(regional)", "(colloquial)", etc.
4. LATER — grammaticalized/functional uses (auxiliary, discourse markers, set-phrase-only senses).
5. LAST — archaic/literary/dialectal/regional/technical-only/rare senses.

The junior was also told to PRUNE very low-confidence glosses:
- Broken English (e.g. "doing while").
- Incredibly rare/archaic senses already covered by another surviving gloss.
Exclusively parenthetical glosses (e.g. "(literary)") are kept but must never rank first.

Common mistakes to catch:
- Demoting a sense because of an EXPLANATORY parenthetical (e.g. "(softening the request)") — these are not restrictive.
- Promoting an etymological "core" over a more frequent modern sense (e.g. ranking "motive" above "mobile phone" for "móvil").
- Trusting the input order. The Wiktionary source often lists archaic/etymological senses first.
- Burying a high-frequency colloquial sense just because it has "(colloquial)".
- Keeping a broken-English or never-used archaic gloss the junior should have pruned — drop it.
- Wrongly dropping a valid, useful sense — restore it (copy it verbatim from the original input).
- Placing an exclusively-parenthetical gloss first.

Decide:
- "confirmed" — the junior's order is fine as-is.
- "refined" — you have a clearly better order. Provide it.
- "low_confidence" — multiple defensible orderings; flag for human review. Still provide your best guess for finalOrder.

Return ONLY a JSON object, no explanation outside the JSON:
{
  "action": "confirmed" | "refined" | "low_confidence",
  "finalOrder": [<kept definitions, reordered and pruned>],
  "reason": "<one short sentence — required for refined and low_confidence; empty string for confirmed>"
}

Rules:
- finalOrder may DROP low-value definitions (broken English, incredibly rare/archaic), but every string it contains must come from the original input, character-for-character. Never add or rephrase.
- You may restore a definition the junior wrongly dropped — it must still come verbatim from the original input.
- Keep at least one definition, and do not place an exclusively-parenthetical gloss first.
- Return ONLY the JSON object.`;

function pass2User(word, original, pass1) {
  return `Word: ${word}

Original input order:
${JSON.stringify(original, null, 2)}

Junior's proposed order:
${JSON.stringify(pass1, null, 2)}`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseJsonFromResponse(raw) {
  let cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

// An "exclusively parenthetical" gloss is one that, after trimming whitespace,
// both opens with "(" and closes with ")" (e.g. "(literary)", "(grammar)").
// These are kept but must never rank first.
function isExclusivelyParenthetical(def) {
  return typeof def === 'string' && /^\(.*\)$/.test(def.trim());
}

// If a parenthetical-only gloss leads while a substantive gloss survives, promote
// the second entry to first (a simple swap — per spec we do NOT retry the model
// for this). Returns the order unchanged when no fix is needed.
function demoteLeadingParenthetical(order) {
  if (
    order.length > 1 &&
    isExclusivelyParenthetical(order[0]) &&
    order.some(d => !isExclusivelyParenthetical(d))
  ) {
    return [order[1], order[0], ...order.slice(2)];
  }
  return order;
}

// Validates a processed ordering that MAY prune entries. Invariants:
//   - it is a non-empty array
//   - every element exists verbatim in the original (no additions/rephrasing)
//   - no duplicates
// (The parenthetical-first rule is fixed up post-validation by
// demoteLeadingParenthetical, not enforced here.)
// `dropped` (entries present in original but not the candidate) is returned for
// logging so a human can review every removal.
function validateProcessed(original, candidate) {
  if (!Array.isArray(candidate)) return { ok: false, error: 'not an array' };
  if (candidate.length === 0) return { ok: false, error: 'empty result' };
  const originalSet = new Set(original);
  const added = candidate.filter(d => !originalSet.has(d));
  if (added.length) return { ok: false, error: 'added/rephrased element', added };
  const candidateSet = new Set(candidate);
  if (candidateSet.size !== candidate.length) return { ok: false, error: 'duplicate element' };
  const dropped = original.filter(d => !candidateSet.has(d));
  return { ok: true, dropped };
}

async function callPass1(word, definitions, model) {
  const response = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: cachedSystem(`${PASS1_SYSTEM}\n\n${PASS1_INSTRUCTIONS}`),
    messages: [{ role: 'user', content: pass1User(word, definitions) }],
  });
  const raw = response.content[0].text;
  const arrMatch = raw.match(/\[[\s\S]*\]/);
  if (!arrMatch) return { error: 'no array in response', raw };
  let parsed;
  try { parsed = JSON.parse(arrMatch[0]); }
  catch (e) { return { error: `JSON parse: ${e.message}`, raw }; }
  const v = validateProcessed(definitions, parsed);
  if (!v.ok) return { error: v.error, dropped: v.dropped, added: v.added, parsed };
  return { order: demoteLeadingParenthetical(parsed), dropped: v.dropped };
}

async function pass1Sort(word, definitions) {
  const first = await callPass1(word, definitions, PASS1_MODEL);
  if (!first.error) return { ...first, model: PASS1_MODEL };
  // Validation failed on Sonnet — retry with Opus
  const retry = await callPass1(word, definitions, RETRY_MODEL);
  if (!retry.error) return { ...retry, model: RETRY_MODEL, retried: true, firstError: first.error };
  return { error: `pass1 failed both models (sonnet: ${first.error}, opus: ${retry.error})` };
}

async function callPass2(word, original, pass1, model) {
  const response = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: cachedSystem(`${PASS2_SYSTEM}\n\n${PASS2_INSTRUCTIONS}`),
    messages: [{ role: 'user', content: pass2User(word, original, pass1) }],
  });
  const raw = response.content[0].text;
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (!objMatch) return { error: 'no object in response', raw };
  let parsed;
  try { parsed = JSON.parse(objMatch[0]); }
  catch (e) { return { error: `JSON parse: ${e.message}`, raw }; }
  if (!parsed.action || !Array.isArray(parsed.finalOrder)) {
    return { error: 'malformed critic response', parsed };
  }
  const v = validateProcessed(original, parsed.finalOrder);
  if (!v.ok) return { error: v.error, dropped: v.dropped, added: v.added, parsed };
  return {
    action: parsed.action,
    order: demoteLeadingParenthetical(parsed.finalOrder),
    reason: parsed.reason || '',
    dropped: v.dropped,
  };
}

async function pass2Critique(word, original, pass1) {
  const first = await callPass2(word, original, pass1, PASS2_MODEL);
  if (!first.error) return { ...first, model: PASS2_MODEL };
  const retry = await callPass2(word, original, pass1, RETRY_MODEL);
  if (!retry.error) return { ...retry, model: RETRY_MODEL, retried: true, firstError: first.error };
  return { error: `pass2 failed both models (sonnet: ${first.error}, opus: ${retry.error})` };
}

// ─── Short leading-gloss synthesis ────────────────────────────────────────
// When the final leading definition is too long for the card's headline slot
// (> MAX_FIRST_GLOSS_LEN chars), ask the model for ONE short gloss capturing the
// word's most common modern sense and prepend it. Unlike pass 1/2, this is
// intentionally a NEW string (not copied from the source), so it is validated
// only for length/shape and always surfaced for human review.

const SHORT_GLOSS_SYSTEM = `You are a Spanish linguistics expert writing an ultra-concise English headword gloss for a modern Spanish learner's vocabulary card.`;

// Static instruction body → cached system block; word + definitions → user message.
const SHORT_GLOSS_INSTRUCTIONS = `The given word's card leads with a definition longer than ${MAX_FIRST_GLOSS_LEN} characters, which is too long for the card's headline slot.

Write ONE short English gloss — at most ${MAX_FIRST_GLOSS_LEN} characters, including spaces — that captures the word's most common modern (2020s) meaning. It will be shown first, ahead of the fuller definitions.

Requirements:
- ${MAX_FIRST_GLOSS_LEN} characters or fewer total.
- Reads like a clean dictionary headword gloss, NOT a sentence. No trailing period.
- No parentheticals, no usage notes, no examples.
- Base it on the most prototypical modern sense; the provided definitions (already ordered most- to least-useful) are your guide.

Return ONLY a JSON object, no explanation:
{ "gloss": "<short gloss>" }`;

function shortGlossUser(word, definitions) {
  return `Word: ${word}

Existing definitions:
${JSON.stringify(definitions, null, 2)}`;
}

async function callShortGloss(word, definitions, model) {
  const response = await anthropic.messages.create({
    model,
    max_tokens: 256,
    system: cachedSystem(`${SHORT_GLOSS_SYSTEM}\n\n${SHORT_GLOSS_INSTRUCTIONS}`),
    messages: [{ role: 'user', content: shortGlossUser(word, definitions) }],
  });
  const raw = response.content[0].text;
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (!objMatch) return { error: 'no object in response', raw };
  let parsed;
  try { parsed = JSON.parse(objMatch[0]); }
  catch (e) { return { error: `JSON parse: ${e.message}`, raw }; }
  const gloss = typeof parsed.gloss === 'string' ? parsed.gloss.trim() : '';
  if (!gloss) return { error: 'empty gloss' };
  if (gloss.length > MAX_FIRST_GLOSS_LEN) return { error: `gloss too long (${gloss.length} chars)` };
  if (isExclusivelyParenthetical(gloss)) return { error: 'gloss is parenthetical-only' };
  return { gloss };
}

async function generateShortGloss(word, definitions) {
  const first = await callShortGloss(word, definitions, PASS1_MODEL);
  if (!first.error) return { ...first, model: PASS1_MODEL };
  // Validation failed on Sonnet — retry with Opus.
  const retry = await callShortGloss(word, definitions, RETRY_MODEL);
  if (!retry.error) return { ...retry, model: RETRY_MODEL, retried: true, firstError: first.error };
  return { error: `short-gloss failed both models (sonnet: ${first.error}, opus: ${retry.error})` };
}

// ─── Review log ─────────────────────────────────────────────────────────────

let reviewEntries = [];

function logReview(entry) {
  reviewEntries.push(entry);
}

function flushReviewLog() {
  if (reviewEntries.length === 0) return;
  const out = reviewEntries.map(e => {
    return [
      `[${e.id}] ${e.word} (${e.action})`,
      `  Original: ${JSON.stringify(e.original)}`,
      `  Pass 1:   ${JSON.stringify(e.pass1)}`,
      `  Final:    ${JSON.stringify(e.final)}`,
      e.dropped && e.dropped.length ? `  Dropped:  ${JSON.stringify(e.dropped)}` : null,
      e.generated ? `  Generated: ${JSON.stringify(e.generated)} (synthetic leading gloss)` : null,
      e.reason ? `  Reason:   ${e.reason}` : null,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
  fs.writeFileSync(REVIEW_LOG_PATH, out + '\n');
  console.log(`\nReview log written to ${REVIEW_LOG_PATH} (${reviewEntries.length} entries)`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const modeLabel = isSpotCheck ? 'SPOT CHECK' : targetWords?.length ? `scoped to: ${targetWords.join(', ')}` : includeAll ? 'ALL es entries' : 'discoverable es entries';
  const criticLabel = skipCritic ? ' (Pass 1 only)' : ' (Pass 1 + critic)';
  console.log(`Starting AI definition-array processing backfill — ${modeLabel}${criticLabel}\n`);

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(
      targetIds
        ? `SELECT id, word1, pronunciation, definitions
           FROM dictionaryentries_es
           WHERE id = ANY($1)
           ORDER BY id ASC`
        : targetWords?.length
        ? `SELECT id, word1, pronunciation, definitions
           FROM dictionaryentries_es
           WHERE language = 'es'
             AND word1 = ANY($1)
             AND jsonb_array_length(definitions) > 1
           ORDER BY id ASC`
        : `SELECT id, word1, pronunciation, definitions
           FROM dictionaryentries_es
           WHERE language = 'es'
             ${includeAll ? '' : 'AND discoverable = TRUE'}
             AND jsonb_array_length(definitions) > 1
           ORDER BY id ASC
           ${isSpotCheck ? 'LIMIT 5' : ''}`,
      targetIds ? [targetIds] : targetWords?.length ? [targetWords] : []
    );

    console.log(`Found ${entries.length} entries to process\n`);

    let updated  = 0;
    let unchanged = 0;
    let failed   = 0;
    let confirmed = 0;
    let refined   = 0;
    let lowConf   = 0;
    let opusRetries = 0;
    let glossesPruned = 0; // total glosses removed across all entries
    let shortGenerated = 0; // total synthetic short leading glosses prepended

    for (const row of entries) {
      const definitions = Array.isArray(row.definitions)
        ? row.definitions
        : JSON.parse(row.definitions || '[]');

      try {
        process.stdout.write(`  [${row.id}] ${row.word1} (${definitions.length} defs) ... `);

        const p1 = await pass1Sort(row.word1, definitions);
        if (p1.error) {
          console.log(`FAIL pass1 (${p1.error})`);
          failed++;
          continue;
        }
        if (p1.retried) opusRetries++;

        let finalOrder = p1.order;
        let action = 'pass1_only';
        let reason = '';

        if (!skipCritic) {
          const p2 = await pass2Critique(row.word1, definitions, p1.order);
          if (p2.retried) opusRetries++;
          if (p2.error) {
            console.log(`pass2 fail (${p2.error}) — using pass1`);
            // Keep p1 result, but log for review
            logReview({
              id: row.id, word: row.word1, action: 'pass2_failed',
              original: definitions, pass1: p1.order, final: p1.order,
              reason: `Critic error: ${p2.error}`,
            });
          } else {
            action = p2.action;
            finalOrder = p2.order;
            reason = p2.reason;
            if (action === 'confirmed') confirmed++;
            else if (action === 'refined') refined++;
            else if (action === 'low_confidence') lowConf++;
          }
        }

        // Short leading-gloss synthesis: if the curated leading definition is too
        // long for the card headline, prepend a freshly generated short gloss
        // (keeping the long one right behind it). This is the one place we write a
        // non-source string, so it is always surfaced for human review.
        let generatedFirst = null;
        if (finalOrder.length && finalOrder[0].length > MAX_FIRST_GLOSS_LEN) {
          const sg = await generateShortGloss(row.word1, finalOrder);
          if (sg.retried) opusRetries++;
          if (sg.error) {
            console.log(`short-gloss fail (${sg.error}) — leaving long gloss first`);
            logReview({
              id: row.id, word: row.word1, action: 'short_gloss_failed',
              original: definitions, pass1: p1.order, final: finalOrder,
              reason: `Short-gloss error: ${sg.error}`,
            });
          } else {
            generatedFirst = sg.gloss;
            // De-dupe: if the model echoed an existing gloss, promote it rather
            // than inserting a duplicate.
            finalOrder = [generatedFirst, ...finalOrder.filter(d => d !== generatedFirst)];
            shortGenerated++;
          }
        }

        const orderChanged = JSON.stringify(finalOrder) !== JSON.stringify(definitions);
        const pass2Disagreed = !skipCritic && JSON.stringify(finalOrder) !== JSON.stringify(p1.order);
        // Glosses present in the original but pruned from the final result.
        const finalSet = new Set(finalOrder);
        const droppedGlosses = definitions.filter(d => !finalSet.has(d));

        // Log entries that need human review:
        // - refined (critic overrode pass1)
        // - low_confidence (critic uncertain)
        // - any pruning (removals are destructive — always surface for review)
        // - any generated short gloss (synthetic non-source string)
        if (action === 'refined' || action === 'low_confidence' || droppedGlosses.length || generatedFirst) {
          logReview({
            id: row.id, word: row.word1, action,
            original: definitions, pass1: p1.order, final: finalOrder,
            dropped: droppedGlosses, generated: generatedFirst, reason,
          });
        }

        if (!orderChanged) {
          console.log(`unchanged${pass2Disagreed ? ' (pass2 differed but matched original)' : ''}`);
          unchanged++;
          continue;
        }

        if (isSpotCheck) {
          console.log(`[${action}]`);
          console.log(`    Before: ${JSON.stringify(definitions)}`);
          console.log(`    Pass1:  ${JSON.stringify(p1.order)}`);
          if (pass2Disagreed) console.log(`    Final:  ${JSON.stringify(finalOrder)}  ← critic refined`);
          if (droppedGlosses.length) console.log(`    Pruned: ${JSON.stringify(droppedGlosses)}`);
          if (generatedFirst) console.log(`    Short:  ${JSON.stringify(generatedFirst)}  ← generated leading gloss`);
          if (reason) console.log(`    Reason: ${reason}`);
          unchanged++; // not actually written
          continue;
        }

        await client.query(
          `UPDATE dictionaryentries_es SET definitions = $1::jsonb WHERE id = $2`,
          [JSON.stringify(finalOrder), row.id]
        );
        await stampEntries(client, 'dictionaryentries_es', row.id);

        updated++;
        glossesPruned += droppedGlosses.length;
        const tag = droppedGlosses.length
          ? `processed [${action}], pruned ${droppedGlosses.length}`
          : `processed [${action}]`;
        console.log(tag);

        if (updated % 100 === 0) {
          const pct = Math.round(updated / entries.length * 100);
          console.log(`\n  Progress: ${updated}/${entries.length} (${pct}%)\n`);
        }

      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n' + '='.repeat(60));
    console.log('BACKFILL SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total processed : ${entries.length}`);
    if (isSpotCheck) {
      console.log(`(Spot check — no writes performed)`);
    } else {
      console.log(`Updated         : ${updated}`);
      console.log(`Unchanged       : ${unchanged}`);
      console.log(`Failed/invalid  : ${failed}`);
      console.log(`Glosses pruned  : ${glossesPruned}`);
    }
    console.log(`Short glosses   : ${shortGenerated} generated`);
    if (!skipCritic) {
      console.log(`Critic confirmed: ${confirmed}`);
      console.log(`Critic refined  : ${refined}`);
      console.log(`Low confidence  : ${lowConf}`);
    }
    console.log(`Opus retries    : ${opusRetries}`);
    console.log('='.repeat(60));

    flushReviewLog();

  } finally {
    client.release();
    await db.pool.end();
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
