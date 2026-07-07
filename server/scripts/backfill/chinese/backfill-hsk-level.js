/**
 * Backfill Script: AI-powered HSK level assignment for dictionaryentries_zh
 *
 * For each discoverable zh entry where difficulty IS NULL, asks Claude Sonnet
 * to assign a single HSK level, stored as the bare integer 1..6 in the smallint
 * `difficulty` column (migration 92; the model's "HSKn" token is parsed to n).
 *
 * PROMPT CACHING: the static rules live in a cachedSystem block and only the
 * per-word line varies in the user message, so the prefix is byte-identical
 * across the run. (This prompt is below the model's minimum cacheable prefix,
 * so the marker is currently a silent no-op — the structure is kept correct so
 * caching engages automatically if the rules grow.)
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-hsk-level.js               # full backfill (serial)
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-hsk-level.js --batch       # full backfill via Batches API (50% price)
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-hsk-level.js --spot-check  # test 5 entries
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-hsk-level.js --words=未来,摸脉
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
import { runBackfill } from '../shared/lib/runner.js';

const SCRIPT_VERSION = 2; // bump when this script's logic/prompt changes (v2: cached system block + shared runner/batch mode)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries, accrueUsage, staleClause } = initRunLog({ script: 'chinese/backfill-hsk-level', version: SCRIPT_VERSION, anthropic });
const { isSpotCheck, isBatch, isStale, targetWords } = parseBackfillArgs();
// --stale: also re-process rows stamped below the current SCRIPT_VERSION.
const doneGate = isStale ? `("difficulty" IS NULL OR ${staleClause()})` : '"difficulty" IS NULL';

const MODEL = 'claude-sonnet-4-6';

// Static instruction block — identical for every entry → cached system prefix.
const SYSTEM_TEXT = `You are a Chinese pedagogy expert.

Task: Assign exactly one HSK level for the given word.

Rules:
- Return one label only: HSK1, HSK2, HSK3, HSK4, HSK5, or HSK6.
- Choose the level that best reflects when a typical learner would encounter and need this word.
- Do NOT default to HSK6 simply because the word is absent from standard HSK word lists.
  Instead, use these guidelines:
  · HSK1–2: Basic everyday survival words (greetings, numbers, family, simple verbs).
  · HSK3–4: Common everyday vocabulary encountered in daily life, travel, shopping, food, modern culture (including frequent loanwords like coffee drinks, technology, etc.).
  · HSK5: Less common words, academic or formal registers, nuanced vocabulary.
  · HSK6: Rare, literary, highly technical, or specialized professional vocabulary.
- Modern loanwords for common everyday items (food, beverages, technology) are typically HSK3–4.
- Technical jargon, literary idioms, and obscure terms are typically HSK5–6.
- Proper nouns (place names, people's names) that lack general vocabulary utility should be HSK6.
- Do not include explanation.

Respond with ONLY the level token.`;

/** Build the messages.create params for one entry (per-word data only in the user turn). */
function buildRequest(row) {
  const definitionText = Array.isArray(row.definitions)
    ? row.definitions.slice(0, 5).join('; ')
    : String(row.definitions ?? '');
  return {
    model: MODEL,
    max_tokens: 16,
    temperature: 0,
    system: cachedSystem(SYSTEM_TEXT),
    messages: [{
      role: 'user',
      content: `Word: ${row.word1}\nPronunciation: ${row.pronunciation || 'N/A'}\nDefinitions: ${definitionText}`,
    }],
  };
}

async function run() {
  if (isSpotCheck) console.log('🔍 SPOT CHECK MODE — processing 5 entries only\n');
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);
  console.log(`🚀 Starting AI-powered HSK level backfill${isBatch ? ' (batch mode)' : ''}...\n`);

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
        AND ${doneGate}
        ${wordsFilter}
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 5' : ''}
    `, params);

    console.log(`📊 Found ${entries.length} entries needing HSK level backfill\n`);

    if (entries.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    await runBackfill({
      anthropic,
      entries,
      batch: isBatch,
      buildRequest,
      accrueUsage,
      // Parse the model's "HSKn" token to the bare smallint 1..6 (migration 92 —
      // storing the literal 'HSK1' would fail the cast), then update + stamp.
      handleResponse: async (row, message) => {
        const text = (message.content[0]?.text ?? '').trim().toUpperCase();
        const match = text.match(/HSK([1-6])/);
        if (!match) return false;
        const difficulty = Number(match[1]);
        await client.query(
          `UPDATE dictionaryentries_zh SET "difficulty" = $1 WHERE id = $2`,
          [difficulty, row.id]
        );
        await stampEntries(client, 'dictionaryentries_zh', row.id);
        console.log(difficulty);
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
