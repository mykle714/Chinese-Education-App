/**
 * Build/deploy validation for authored sort packs (sort_packs, migration 93; sentence
 * columns dropped in migration 95).
 *
 * LAYER: reference-data integrity check (read-only). Run before deploying sort_packs
 * to prod (or in CI). Flags structural problems: empty/oversized packs, non-existent
 * entryIds, level out of 1..6.
 *
 * Usage (from server/):  npx tsx scripts/validate-sort-packs.ts
 * Exit code 0 = all valid; 1 = at least one violation (fails the pipeline).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import db from '../db.js';
import { dictTableForLanguage } from '../dal/shared/dictTable.js';

const MAX_CARDS_PER_PACK = 3;

interface PackRow {
  id: number;
  language: string;
  level: number;
  packOrder: number;
  entryIds: number[];
  entryWords: string[];
}

async function main(): Promise<void> {
  const client = await db.getClient();
  const violations: string[] = [];

  try {
    const { rows: packs } = await client.query<PackRow>(
      `SELECT id, language, level, "packOrder", "entryIds", "entryWords"
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

      // Load the referenced cards' headwords from the per-language det table.
      const det = dictTableForLanguage(pack.language);
      const { rows: cards } = await client.query<{ id: number; word1: string }>(
        `SELECT id, word1 FROM ${det} WHERE id = ANY($1::int[])`,
        [pack.entryIds]
      );
      const byId = new Map(cards.map((c) => [c.id, c.word1]));

      for (const id of pack.entryIds) {
        if (!byId.has(id)) {
          violations.push(`${where}: entryId ${id} not found in ${det}`);
        }
      }

      // entryWords (migration 96) is trigger-maintained, but check it hasn't drifted
      // (e.g. from a bulk write that bypassed the trigger's UPDATE OF columns).
      const expectedWords = pack.entryIds.map((id) => byId.get(id)).filter((w): w is string => w !== undefined);
      if (JSON.stringify(pack.entryWords) !== JSON.stringify(expectedWords)) {
        violations.push(`${where}: entryWords ${JSON.stringify(pack.entryWords)} out of sync with entryIds (expected ${JSON.stringify(expectedWords)})`);
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
