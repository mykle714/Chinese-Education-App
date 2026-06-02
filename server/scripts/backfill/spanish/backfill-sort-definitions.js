/**
 * Backfill Script: AI-powered definition sorting for dictionaryentries_es (SPANISH)
 *
 * Spanish counterpart of backfill/chinese/backfill-sort-definitions.js.
 *
 * TODO(es-linguistics): the ranking prompt + worked examples below were adapted
 * from the Chinese version. The principles (modern frequency, restrictive
 * parentheticals, archaic-last) carry over, but the worked examples use Spanish
 * words chosen first-pass — have a Spanish speaker sanity-check them, and note
 * that regional senses (e.g. peninsular vs Latin-American) may need their own
 * handling.
 *
 * Two-pass design:
 *   Pass 1 (Sonnet) — first ordering using a tuned prompt with few-shots.
 *   Pass 2 (Sonnet) — critic that sees the original list + Pass 1's output,
 *     and either confirms, refines with a one-line reason, or flags
 *     low_confidence for human review.
 *   On validation failure (length/element/JSON), the prompt is retried on
 *   Opus before giving up.
 *
 * Disagreements (Pass 2 ≠ Pass 1) and low_confidence flags are dumped to a
 * timestamped review file in /tmp so the user can skim post-run.
 *
 * Usage:
 *   npx tsx scripts/backfill/spanish/backfill-sort-definitions.js                # discoverable es entries
 *   npx tsx scripts/backfill/spanish/backfill-sort-definitions.js --all          # all es entries
 *   npx tsx scripts/backfill/spanish/backfill-sort-definitions.js --spot-check   # 5 entries, no writes
 *   npx tsx scripts/backfill/spanish/backfill-sort-definitions.js --ids=1,2,3    # target specific IDs
 *   npx tsx scripts/backfill/spanish/backfill-sort-definitions.js --no-critic    # skip Pass 2
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';

const isSpotCheck = process.argv.includes('--spot-check');
const includeAll  = process.argv.includes('--all');
const skipCritic  = process.argv.includes('--no-critic');

const idsArg = process.argv.find(a => a.startsWith('--ids='));
const targetIds = idsArg ? idsArg.replace('--ids=', '').split(',').map(Number) : null;

// --words=未来,摸脉 → scope to specific entries only
const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PASS1_MODEL = 'claude-sonnet-4-6';
const PASS2_MODEL = 'claude-sonnet-4-6';
const RETRY_MODEL = 'claude-opus-4-8'; // used when a Sonnet response fails validation

const REVIEW_LOG_PATH = `/tmp/sort-definitions-review-${Date.now()}.log`;

// ─── Pass 1 prompt ──────────────────────────────────────────────────────────
// Tuned for the failures we observed: parenthetical confusion (一下), modern
// frequency vs linguistic prototypicality (密码), and cedict's bias of listing
// archaic senses first.

const PASS1_SYSTEM = `You are a Spanish linguistics expert ranking English definitions of a Spanish word for a modern (2020s) Spanish learner's vocabulary card.`;

function pass1Prompt(word, definitions) {
  return `Reorder the definitions of "${word}" from most to least useful for a modern learner.

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
- Return ALL definitions — do not add, remove, rephrase, or alter any string in any way.
- Each string must be copied character-for-character exactly as it appears in the input, including parenthetical notes, punctuation, and formatting.
- Return ONLY a valid JSON array of strings, no explanation.

Word: ${word}

Definitions:
${JSON.stringify(definitions, null, 2)}`;
}

// ─── Pass 2 critic prompt ───────────────────────────────────────────────────

const PASS2_SYSTEM = `You are a Spanish linguistics expert reviewing a junior annotator's ranking of English definitions for a modern Spanish learner's vocabulary card.`;

function pass2Prompt(word, original, pass1) {
  return `Review the proposed ordering for "${word}" and decide whether to confirm, refine, or flag it.

Ranking principles (the junior was given these — apply the same ones):
1. FIRST — sense a modern (2020s) Spanish learner is most likely to encounter; for everyday/tech terms, modern usage beats etymological core.
2. NEXT — core lexical meaning + metaphorical extensions.
3. LATER — senses with restrictive parentheticals "(of a person)", "(in cooking)", "(grammar)", "(regional)", "(colloquial)", etc.
4. LATER — grammaticalized/functional uses (auxiliary, discourse markers, set-phrase-only senses).
5. LAST — archaic/literary/dialectal/regional/technical-only/rare senses.

Common mistakes to catch:
- Demoting a sense because of an EXPLANATORY parenthetical (e.g. "(softening the request)") — these are not restrictive.
- Promoting an etymological "core" over a more frequent modern sense (e.g. ranking "motive" above "mobile phone" for "móvil").
- Trusting the input order. The Wiktionary source often lists archaic/etymological senses first.
- Burying a high-frequency colloquial sense just because it has "(colloquial)".

Word: ${word}

Original input order:
${JSON.stringify(original, null, 2)}

Junior's proposed order:
${JSON.stringify(pass1, null, 2)}

Decide:
- "confirmed" — the junior's order is fine as-is.
- "refined" — you have a clearly better order. Provide it.
- "low_confidence" — multiple defensible orderings; flag for human review. Still provide your best guess for finalOrder.

Return ONLY a JSON object, no explanation outside the JSON:
{
  "action": "confirmed" | "refined" | "low_confidence",
  "finalOrder": [<all original definitions, reordered>],
  "reason": "<one short sentence — required for refined and low_confidence; empty string for confirmed>"
}

Rules:
- finalOrder must contain EVERY string from the original input, character-for-character, exactly once.
- Do not rephrase, edit, or alter any definition string.
- Return ONLY the JSON object.`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseJsonFromResponse(raw) {
  let cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

function validateSameSet(original, candidate) {
  if (!Array.isArray(candidate)) return { ok: false, error: 'not an array' };
  if (candidate.length !== original.length) return { ok: false, error: 'length mismatch' };
  const originalSet = new Set(original);
  const candidateSet = new Set(candidate);
  const dropped = original.filter(d => !candidateSet.has(d));
  const added   = candidate.filter(d => !originalSet.has(d));
  if (dropped.length || added.length) return { ok: false, error: 'element mismatch', dropped, added };
  return { ok: true };
}

async function callPass1(word, definitions, model) {
  const response = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: PASS1_SYSTEM,
    messages: [{ role: 'user', content: pass1Prompt(word, definitions) }],
  });
  const raw = response.content[0].text;
  const arrMatch = raw.match(/\[[\s\S]*\]/);
  if (!arrMatch) return { error: 'no array in response', raw };
  let parsed;
  try { parsed = JSON.parse(arrMatch[0]); }
  catch (e) { return { error: `JSON parse: ${e.message}`, raw }; }
  const v = validateSameSet(definitions, parsed);
  if (!v.ok) return { error: v.error, dropped: v.dropped, added: v.added, parsed };
  return { order: parsed };
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
    system: PASS2_SYSTEM,
    messages: [{ role: 'user', content: pass2Prompt(word, original, pass1) }],
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
  const v = validateSameSet(original, parsed.finalOrder);
  if (!v.ok) return { error: v.error, dropped: v.dropped, added: v.added, parsed };
  return {
    action: parsed.action,
    order: parsed.finalOrder,
    reason: parsed.reason || '',
  };
}

async function pass2Critique(word, original, pass1) {
  const first = await callPass2(word, original, pass1, PASS2_MODEL);
  if (!first.error) return { ...first, model: PASS2_MODEL };
  const retry = await callPass2(word, original, pass1, RETRY_MODEL);
  if (!retry.error) return { ...retry, model: RETRY_MODEL, retried: true, firstError: first.error };
  return { error: `pass2 failed both models (sonnet: ${first.error}, opus: ${retry.error})` };
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
  console.log(`Starting AI definition sort backfill — ${modeLabel}${criticLabel}\n`);

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

    console.log(`Found ${entries.length} entries to sort\n`);

    let updated  = 0;
    let unchanged = 0;
    let failed   = 0;
    let confirmed = 0;
    let refined   = 0;
    let lowConf   = 0;
    let opusRetries = 0;

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

        const orderChanged = JSON.stringify(finalOrder) !== JSON.stringify(definitions);
        const pass2Disagreed = !skipCritic && JSON.stringify(finalOrder) !== JSON.stringify(p1.order);

        // Log entries that need human review:
        // - refined (critic overrode pass1)
        // - low_confidence (critic uncertain)
        if (action === 'refined' || action === 'low_confidence') {
          logReview({
            id: row.id, word: row.word1, action,
            original: definitions, pass1: p1.order, final: finalOrder, reason,
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
          if (reason) console.log(`    Reason: ${reason}`);
          unchanged++; // not actually written
          continue;
        }

        await client.query(
          `UPDATE dictionaryentries_es SET definitions = $1::jsonb WHERE id = $2`,
          [JSON.stringify(finalOrder), row.id]
        );

        updated++;
        const tag = pass2Disagreed ? `sorted [${action}]` : `sorted [${action}]`;
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
    }
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
