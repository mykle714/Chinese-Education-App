/**
 * Backfill Script: AI-powered English word forms for dictionaryentries_zh
 *
 * For each discoverable zh entry where "wordForms" IS NULL and partsOfSpeech IS NOT NULL,
 * asks Claude Sonnet to extract the base English word from definitions[0] and produce a map
 * of conjugated/inflected forms keyed by: past, present, future, gerund, adverb, adjective, noun, noun_plural.
 * Only keys relevant to the entry's partsOfSpeech are included.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-word-forms.js               # full backfill (serial)
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-word-forms.js --batch       # via Batches API (50% price)
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-word-forms.js --spot-check  # test 5 entries
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-word-forms.js --words=跑,快  # specific words
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog, cachedSystem } from '../run-log.js';
import { parseBackfillArgs, wordsWhereClause } from '../shared/lib/cli.js';
import { extractJsonSlice } from '../shared/lib/json.js';
import { runBackfill } from '../shared/lib/runner.js';

const SCRIPT_VERSION = 3; // bump when this script's logic/prompt changes (v3: cached system block + shared runner/batch mode)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries, accrueUsage, staleClause } = initRunLog({ script: 'chinese/backfill-word-forms', version: SCRIPT_VERSION, anthropic });
const { isSpotCheck, isBatch, isStale, targetWords } = parseBackfillArgs();
// --stale: also re-process rows stamped below the current SCRIPT_VERSION.
const doneGate = isStale ? `("wordForms" IS NULL OR ${staleClause()})` : '"wordForms" IS NULL';

const MODEL = 'claude-sonnet-4-6';

const ALLOWED_KEYS = new Set(['past', 'present', 'future', 'gerund', 'adverb', 'adjective', 'noun', 'noun_plural']);

// Static instruction block — identical for every entry → cached system prefix.
// PROMPT CACHING: only the per-word lines vary in the user message. (Below the
// model's minimum cacheable prefix today, so the marker is a silent no-op —
// structure kept caching-correct.)
const SYSTEM_TEXT = `You are an English linguistics expert helping a Chinese vocabulary app.

Task: Extract the base English word from the given definition (strip "to ", articles, and parenthetical notes), then produce a JSON object containing ONLY the forms relevant to the given parts of speech:

- If parts of speech includes "verb" AND the base English word is actually a real English verb (e.g. "run", "learn", "like"): include "past", "present" (3rd person singular), "future" (with "will"), and "gerund" (present participle)
- If parts of speech includes "adverb": include "adverb"
- If parts of speech includes "adjective": include "adjective" (the base adjective form)
- If parts of speech includes "noun": include "noun" (singular form) AND "noun_plural" (the English plural form). Use the correct irregular plural where applicable (e.g. "child" → "children", "person" → "people", "mouse" → "mice"), and handle regular -s/-es/-ies rules ("book" → "books", "box" → "boxes", "city" → "cities"). For uncountable/mass nouns with no natural plural (e.g. "water", "information"), set "noun_plural" equal to the singular form.

CRITICAL RULE — adjectives tagged as verbs:
If the base English word is an adjective (e.g. "happy", "fast", "good") but the POS includes "verb", do NOT generate verb conjugations for the adjective. Instead, only include the "adjective" key. Chinese adjectives are often tagged as verbs grammatically, but "happy" does not conjugate as an English verb.

Rules:
- Use the actual correctly inflected English word — not a template like "{word}ed"
- Handle irregular verbs (e.g. "run" → past: "ran", not "runned")
- Only include keys that are applicable to the parts of speech given
- Values must be non-empty strings

Examples:
  word=跑, definition="to run", pos=["verb"] → {"past":"ran","present":"runs","future":"will run","gerund":"running"}
  word=快, definition="fast", pos=["adjective","adverb"] → {"adjective":"fast","adverb":"quickly"}
  word=高兴, definition="happy", pos=["adjective","verb"] → {"adjective":"happy"}  ← adjective only, "happy" is not a real English verb
  word=喜欢, definition="to like", pos=["verb"] → {"past":"liked","present":"likes","future":"will like","gerund":"liking"}
  word=书, definition="book", pos=["noun"] → {"noun":"book","noun_plural":"books"}
  word=孩子, definition="child", pos=["noun"] → {"noun":"child","noun_plural":"children"}
  word=水, definition="water", pos=["noun"] → {"noun":"water","noun_plural":"water"}  ← mass noun, no distinct plural

Respond with ONLY valid JSON, no explanation.`;

/** Build the messages.create params for one entry (per-word data only in the user turn). */
function buildRequest(row) {
  const firstDefinition = Array.isArray(row.definitions) ? row.definitions[0] : null;
  return {
    model: MODEL,
    max_tokens: 256,
    temperature: 0,
    system: cachedSystem(SYSTEM_TEXT),
    messages: [{
      role: 'user',
      content: `Chinese word: ${row.word1}\nFirst English definition: ${firstDefinition}\nParts of speech: ${row.partsOfSpeech.join(', ')}`,
    }],
  };
}

/**
 * Parse + validate the model output into a wordForms map.
 * Returns a Record<string, string> or null when no applicable forms parse out.
 */
function parseWordForms(text) {
  const extracted = extractJsonSlice(text);
  if (!extracted) return null;
  let parsed;
  try {
    parsed = JSON.parse(extracted);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  // Validate keys and values
  const result = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (ALLOWED_KEYS.has(key) && typeof val === 'string' && val.trim().length > 0) {
      result[key] = val.trim();
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

async function run() {
  if (isSpotCheck) console.log('🔍 SPOT CHECK MODE — processing 5 entries only\n');
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);
  console.log(`🚀 Starting AI-powered word forms backfill${isBatch ? ' (batch mode)' : ''}...\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const params = [];
    const wordsFilter = wordsWhereClause('word1', targetWords, params);
    // A targeted (--words) run enriches the named words regardless of discoverable:
    // the pre-pass / on-first-sort paths enrich rows that are NOT yet discoverable, so
    // keeping the gate here would make this step unreachable for exactly the rows that
    // need it (the deadlock backfill-icons and backfill-hsk-level both had). Untargeted
    // full-table runs keep the gate. Mirrors backfill-long-definitions.
    const discoverableFilter = targetWords?.length ? '' : 'AND discoverable = TRUE';
    const { rows: entries } = await client.query(`
      SELECT id, word1, pronunciation, definitions, "partsOfSpeech"
      FROM dictionaryentries_zh
      WHERE language = 'zh'
        ${discoverableFilter}
        AND ${doneGate}
        AND "partsOfSpeech" IS NOT NULL
        AND jsonb_array_length("partsOfSpeech") > 0
        ${wordsFilter}
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 5' : ''}
    `, params);

    console.log(`📊 Found ${entries.length} entries needing word forms backfill\n`);
    if (entries.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    // Rows with no definitions can't be prompted — filter them up front so the
    // runner only sees promptable entries (they were counted as failures before).
    const promptable = entries.filter(row => {
      const firstDefinition = Array.isArray(row.definitions) ? row.definitions[0] : null;
      if (!firstDefinition) console.log(`  ${row.word1}: SKIPPED — no definitions`);
      return Boolean(firstDefinition);
    });

    await runBackfill({
      anthropic,
      entries: promptable,
      batch: isBatch,
      buildRequest,
      accrueUsage,
      handleResponse: async (row, message) => {
        const wordForms = parseWordForms(message.content[0]?.text ?? '');

        if (!wordForms) {
          // No applicable forms for this POS (e.g. classifier, conjunction) — write {} to mark
          // as processed so it is not retried on future runs. Falls back to base definition at runtime.
          await client.query(
            `UPDATE dictionaryentries_zh SET "wordForms" = '{}'::jsonb WHERE id = $1`,
            [row.id]
          );
          await stampEntries(client, 'dictionaryentries_zh', row.id);
          console.log('(no applicable forms — marked as processed)');
          return true;
        }

        await client.query(
          `UPDATE dictionaryentries_zh SET "wordForms" = $1::jsonb WHERE id = $2`,
          [JSON.stringify(wordForms), row.id]
        );
        await stampEntries(client, 'dictionaryentries_zh', row.id);

        console.log(JSON.stringify(wordForms));
        return true;
      },
    });
  } finally {
    client.release();
    await db.end?.();
  }
}

run().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
