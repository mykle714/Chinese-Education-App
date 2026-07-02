/**
 * Backfill Script: AI-powered measure word (量词) classifier for dictionaryentries_zh
 *
 * For each discoverable zh entry where classifier IS NULL, asks Claude Sonnet to:
 *   1. Determine whether the word is a count noun that takes a measure word in Chinese
 *   2. If yes, return the standard measure word(s) as Chinese characters
 *   3. If no (verb, adjective, abstract noun without measure word, etc.), return []
 *
 * The column is left NULL for entries Claude has not yet processed.
 * After processing, it is set to either a non-empty array (e.g. ["辆"]) or an empty
 * array [] — both are "done". NULL means "not yet run".
 *
 * PROMPT CACHING: static rules live in a cachedSystem block; only the per-word
 * line varies in the user message. (Below the model's minimum cacheable prefix
 * today, so the marker is a silent no-op — structure kept caching-correct.)
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-classifier.js               # full backfill (serial)
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-classifier.js --batch       # via Batches API (50% price)
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-classifier.js --spot-check  # test 5 entries
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
import { parseModelJson } from '../shared/lib/json.js';
import { runBackfill } from '../shared/lib/runner.js';

const SCRIPT_VERSION = 2; // bump when this script's logic/prompt changes (v2: cached system block + shared runner/batch mode)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries, accrueUsage } = initRunLog({ script: 'chinese/backfill-classifier', version: SCRIPT_VERSION, anthropic });
const { isSpotCheck, isBatch, targetWords } = parseBackfillArgs();

const MODEL = 'claude-sonnet-4-6';

// Static instruction block — identical for every entry → cached system prefix.
const SYSTEM_TEXT = `You are a Chinese linguistics expert.

Task: Determine whether the given word is a count noun that takes a Chinese measure word (量词/liàngcí).

Rules:
- If it is a concrete or animate noun that Chinese speakers count with a specific measure word, list all standard measure words used with it (most common first).
- Only include measure words that are genuinely standard and natural for this word — not edge-case or poetic usage.
- If it is a verb, adjective, adverb, conjunction, abstract concept that simply uses 个 generically (not as its own dedicated classifier), pronoun, or a word that does not typically take a specific measure word, return an empty array.
- 个 should only be included when it is the dedicated, natural measure word for that specific word — not as a catch-all fallback.

Respond with ONLY a JSON array of Chinese measure word characters, e.g. ["辆"] or ["只", "条"] or [].
No markdown, no explanation.`;

/** Build the messages.create params for one entry (per-word data only in the user turn). */
function buildRequest(row) {
  const definitionText = Array.isArray(row.definitions)
    ? row.definitions.slice(0, 4).join('; ')
    : row.definitions;
  return {
    model: MODEL,
    max_tokens: 128,
    temperature: 0.1,
    system: cachedSystem(SYSTEM_TEXT),
    messages: [{
      role: 'user',
      content: `Word: ${row.word1} (${row.pronunciation})\nDefinitions: ${definitionText}`,
    }],
  };
}

async function run() {
  if (isSpotCheck) {
    console.log('🔍 SPOT CHECK MODE — processing 5 entries only\n');
  }
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);
  console.log(`🚀 Starting AI-powered classifier (量词) backfill${isBatch ? ' (batch mode)' : ''}...\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const params = [];
    const wordsFilter = wordsWhereClause('word1', targetWords, params);
    const { rows: entries } = await client.query(`
      SELECT id, word1, pronunciation, definitions
      FROM dictionaryentries_zh
      WHERE language = 'zh'
        AND discoverable = TRUE
        AND classifier IS NULL
        ${wordsFilter}
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 5' : ''}
    `, params);

    console.log(`📊 Found ${entries.length} entries needing classifier backfill\n`);

    if (entries.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    let withClassifier = 0;
    let noClassifier = 0;

    await runBackfill({
      anthropic,
      entries,
      batch: isBatch,
      buildRequest,
      accrueUsage,
      handleResponse: async (row, message) => {
        const parsed = parseModelJson(message.content[0]?.text ?? '');
        if (!Array.isArray(parsed)) return false;
        const classifiers = parsed.filter(s => typeof s === 'string' && s.length > 0);

        if (classifiers.length > 0) {
          console.log(`[${classifiers.join(', ')}]`);
          // Store the array; non-empty means this word has dedicated classifiers
          await client.query(
            `UPDATE dictionaryentries_zh SET classifier = $1::jsonb WHERE id = $2`,
            [JSON.stringify(classifiers), row.id]
          );
          withClassifier++;
        } else {
          console.log('no classifier');
          // Store empty array to mark as processed — NULL means "not yet run"
          await client.query(
            `UPDATE dictionaryentries_zh SET classifier = '[]'::jsonb WHERE id = $1`,
            [row.id]
          );
          noClassifier++;
        }
        await stampEntries(client, 'dictionaryentries_zh', row.id);
        return true;
      },
    });

    console.log(`With classifier  : ${withClassifier}`);
    console.log(`No classifier    : ${noClassifier}\n`);
  } finally {
    client.release();
    await db.end?.();
  }
}

run().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
