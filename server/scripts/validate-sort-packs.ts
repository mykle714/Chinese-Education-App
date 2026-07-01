/**
 * Build/deploy validation for authored sort packs (sort_packs, migration 93).
 *
 * LAYER: reference-data integrity check (read-only). Run before deploying sort_packs
 * to prod (or in CI) to enforce the invariant the sort-pack UX relies on:
 *
 *   EVERY card referenced by a pack (entryIds) must actually appear in that pack's
 *   authored sentence (sentenceForeign).
 *
 * The runtime does NOT re-check this (docs/SORT_CARDS_REQUIREMENTS.md §4.5 — "author
 * will make it so"), so this script is the guardrail. Also flags structural problems:
 * empty/oversized packs, non-existent entryIds, level out of 1..6, and zh sentences
 * longer than MAX_ZH_SENTENCE_CHARS code points (punctuation included).
 *
 * Usage (from server/):  npx tsx scripts/validate-sort-packs.ts
 * Exit code 0 = all valid; 1 = at least one violation (fails the pipeline).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import db from '../db.js';
import { dictTableForLanguage } from '../dal/shared/dictTable.js';

const MAX_CARDS_PER_PACK = 3;
// zh sort-pack sentences must stay short enough to render on the on-deck band without
// wrapping/shrinking. The cap counts EVERY code point, punctuation included (。，etc.).
// zh only — Spanish sentences are whitespace-delimited words and are naturally longer.
const MAX_ZH_SENTENCE_CHARS = 11;

interface PackRow {
  id: number;
  language: string;
  level: number;
  packOrder: number;
  sentenceForeign: string;
  entryIds: number[];
}

async function main(): Promise<void> {
  const client = await db.getClient();
  const violations: string[] = [];

  try {
    const { rows: packs } = await client.query<PackRow>(
      `SELECT id, language, level, "packOrder", "sentenceForeign", "entryIds"
       FROM sort_packs ORDER BY language, level, "packOrder", id`
    );
    console.log(`Validating ${packs.length} sort pack(s)…`);

    for (const pack of packs) {
      const where = `pack ${pack.id} (${pack.language} L${pack.level} #${pack.packOrder})`;

      // Structural checks.
      if (!pack.entryIds || pack.entryIds.length === 0) {
        violations.push(`${where}: has no entryIds`);
        continue;
      }
      if (pack.entryIds.length > MAX_CARDS_PER_PACK) {
        violations.push(`${where}: ${pack.entryIds.length} cards (max ${MAX_CARDS_PER_PACK})`);
      }
      if (pack.level < 1 || pack.level > 6) {
        violations.push(`${where}: level ${pack.level} out of range 1..6`);
      }
      // zh sentence-length cap (code points, punctuation included).
      if (pack.language === 'zh') {
        const len = [...pack.sentenceForeign].length;
        if (len > MAX_ZH_SENTENCE_CHARS) {
          violations.push(`${where}: zh sentence is ${len} chars (max ${MAX_ZH_SENTENCE_CHARS}): "${pack.sentenceForeign}"`);
        }
      }

      // Load the referenced cards' headwords from the per-language det table.
      const det = dictTableForLanguage(pack.language);
      const { rows: cards } = await client.query<{ id: number; word1: string }>(
        `SELECT id, word1 FROM ${det} WHERE id = ANY($1::int[])`,
        [pack.entryIds]
      );
      const byId = new Map(cards.map((c) => [c.id, c.word1]));

      for (const id of pack.entryIds) {
        const word1 = byId.get(id);
        if (!word1) {
          violations.push(`${where}: entryId ${id} not found in ${det}`);
          continue;
        }
        // The invariant: the card's headword occurs in the authored sentence.
        // Substring match works for both scripts (zh characters; es whitespace words).
        if (!pack.sentenceForeign.includes(word1)) {
          violations.push(`${where}: card "${word1}" (id ${id}) not found in sentence "${pack.sentenceForeign}"`);
        }
      }
    }
  } finally {
    client.release();
  }

  if (violations.length > 0) {
    console.error(`\n❌ ${violations.length} sort-pack violation(s):`);
    for (const v of violations) console.error(`   - ${v}`);
    process.exit(1);
  }
  console.log('✅ All sort packs valid.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
