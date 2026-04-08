/**
 * Backfill Script: AI-powered definition sorting for dictionaryentries
 *
 * For each zh entry with more than one definition, asks Claude to reorder the
 * definitions array from most prototypical/primary to least. The core meaning
 * (e.g. "good" for 好) is ranked first; derived, contextually-restricted,
 * grammaticalized, and archaic senses are ranked progressively lower.
 *
 * Usage:
 *   npx tsx scripts/backfill-sort-definitions.js                # discoverable zh entries
 *   npx tsx scripts/backfill-sort-definitions.js --all          # all zh entries
 *   npx tsx scripts/backfill-sort-definitions.js --spot-check   # 5 entries, verbose output
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../db.js';

const isSpotCheck = process.argv.includes('--spot-check');
const includeAll  = process.argv.includes('--all');

// --ids=21082,28907,38020 — target specific entry IDs only
const idsArg = process.argv.find(a => a.startsWith('--ids='));
const targetIds = idsArg ? idsArg.replace('--ids=', '').split(',').map(Number) : null;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Ask Claude to reorder a definitions array from most prototypical to least.
 * Returns the reordered array, or null if the response can't be validated.
 */
async function sortDefinitions(word, definitions) {
  const prompt = `You are a Chinese linguistics expert. Reorder the following English definitions for the Chinese word "${word}" from most prototypical to least prototypical.

Ranking principles (apply in order):
1. FIRST — The core, fundamental meaning: the sense the word is built around, from which all other meanings derive. For 好, this is "good".
2. NEXT — Extended or metaphorical senses that clearly flow from the core meaning.
3. LATER — Contextually restricted senses: definitions prefixed with qualifiers like "(after a personal pronoun)", "(before a verb)", "(of two people)", etc. These describe narrow grammatical environments, not the word's primary sense.
4. LATER — Grammaticalized or functional uses: verb complements, particles, discourse markers, filler words.
5. LAST — Archaic, literary, dialectal, or rare senses: anything marked "(archaic)", "(literary)", "(old)", "(dialect)", "(Tw)", "(slang)", etc.

Rules:
- Return ALL definitions — do not add, remove, rephrase, or alter any string in any way.
- Each string must be copied character-for-character exactly as it appears in the input, including parenthetical notes, punctuation, and formatting.
- Return ONLY a valid JSON array of strings, no explanation or commentary.

Word: ${word}

Definitions:
${JSON.stringify(definitions, null, 2)}`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].text.trim();

  // Strip markdown code fences if present
  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  // Extract outermost JSON array
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrMatch) return null;

  const parsed = JSON.parse(arrMatch[0]);
  if (!Array.isArray(parsed)) return { error: 'not an array', raw };

  // Validate: same length and same elements (order-independent)
  const originalSet = new Set(definitions);
  const returnedSet = new Set(parsed);
  const dropped = definitions.filter(d => !returnedSet.has(d));
  const added   = parsed.filter(d => !originalSet.has(d));

  if (parsed.length !== definitions.length || dropped.length || added.length) {
    return { error: 'element mismatch', dropped, added, parsed };
  }

  return parsed;
}

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const modeLabel = isSpotCheck ? 'SPOT CHECK' : includeAll ? 'ALL zh entries' : 'discoverable zh entries';
  console.log(`Starting AI definition sort backfill — ${modeLabel}\n`);

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(
      targetIds
        ? `SELECT id, word1, pronunciation, definitions
           FROM dictionaryentries
           WHERE id = ANY($1)
           ORDER BY id ASC`
        : `SELECT id, word1, pronunciation, definitions
           FROM dictionaryentries
           WHERE language = 'zh'
             ${includeAll ? '' : 'AND discoverable = TRUE'}
             AND jsonb_array_length(definitions) > 1
           ORDER BY id ASC
           ${isSpotCheck ? 'LIMIT 5' : ''}`,
      targetIds ? [targetIds] : []
    );

    console.log(`Found ${entries.length} entries to sort\n`);

    let updated  = 0;
    let skipped  = 0; // already in good order or no change
    let failed   = 0;

    for (const row of entries) {
      const definitions = Array.isArray(row.definitions)
        ? row.definitions
        : JSON.parse(row.definitions || '[]');

      try {
        process.stdout.write(`  [${row.id}] ${row.word1} (${definitions.length} defs) ... `);

        const sorted = await sortDefinitions(row.word1, definitions);

        if (!Array.isArray(sorted)) {
          console.log('invalid response — skipped');
          if (targetIds) {
            console.log(`    Error: ${sorted.error}`);
            if (sorted.dropped?.length) console.log(`    Dropped: ${JSON.stringify(sorted.dropped)}`);
            if (sorted.added?.length)   console.log(`    Added:   ${JSON.stringify(sorted.added)}`);
          }
          failed++;
          continue;
        }

        // Skip write if order is already identical
        if (JSON.stringify(sorted) === JSON.stringify(definitions)) {
          console.log('unchanged');
          skipped++;
          continue;
        }

        if (isSpotCheck) {
          // Show before/after without writing
          console.log('');
          console.log(`    Before: ${JSON.stringify(definitions)}`);
          console.log(`    After:  ${JSON.stringify(sorted)}`);
          skipped++;
          continue;
        }

        await client.query(
          `UPDATE dictionaryentries SET definitions = $1::jsonb WHERE id = $2`,
          [JSON.stringify(sorted), row.id]
        );

        updated++;
        console.log('sorted');

        if (updated % 100 === 0) {
          const pct = Math.round(updated / entries.length * 100);
          console.log(`\n  Progress: ${updated}/${entries.length} (${pct}%)\n`);
        }

      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      // Pause between API calls to avoid rate-limiting
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
      console.log(`Unchanged       : ${skipped}`);
      console.log(`Failed/invalid  : ${failed}`);
    }
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
