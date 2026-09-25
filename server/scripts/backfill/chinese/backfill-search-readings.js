/**
 * Backfill Script: populate dictionaryentries_zh."searchReadings" (migration 165), and
 * optionally re-point each heteronym's PRIMARY reading at its default sense.
 *
 * LAYER: data-enrichment (backfill) — offline, deterministic, NO API calls.
 *
 * WHAT IT WRITES
 *   searchReadings   every reading of the headword, from CC-CEDICT ∪ its sense clusters ∪ its
 *                    primary columns (old and new) ∪ what the row already holds. Format and
 *                    rationale: ./lib/searchReadings.js. NULL for single-reading headwords.
 *
 *   --repair-primary ALSO rewrites pronunciation / numberedPinyin / tone to the reading of the
 *                    entry's DEFAULT sense (`defaultPrimaryForms` in ./lib/searchReadings.js) — `resolveDefaultPronunciation`
 *                    (server/utils/definitions.ts), the same value an untagged sentence
 *                    segment shows: the highest-frequencyScore cluster among ALL clusters
 *                    (particles included — 了 stays `le`), a score tie broken by array order
 *                    (which backfill-cluster-definitions' Stage C.5 sets deliberately). NOT the
 *                    card resolver, which skips gloss-less particle clusters. Rows the
 *                    resolver would not change (unclustered, or a reading whose syllable count
 *                    disagrees with the column) are left alone. The old primary is folded into
 *                    searchReadings in the same UPDATE, so no word becomes unfindable under
 *                    the reading it used to be listed as.
 *                    Why the column matters at all once every surface resolves: it is still
 *                    what pinyin search ranks as the headword's "complete" reading, the
 *                    shape guard's reference, and the fallback for every unclustered row.
 *
 * SAFE TO RE-RUN: both values are recomputed from sources and only differing rows are written.
 *
 * Usage (from the backend container — tsx is needed for the server/utils TS import):
 *   docker exec cow-backend npx tsx scripts/backfill/chinese/backfill-search-readings.js                    # dry run
 *   docker exec cow-backend npx tsx scripts/backfill/chinese/backfill-search-readings.js --apply
 *   docker exec cow-backend npx tsx scripts/backfill/chinese/backfill-search-readings.js --repair-primary [--apply]
 *   ... --words=行,了                # scope to specific headwords
 *
 * Referenced by: docs/DICTIONARY_NUMBERED_PINYIN_SEARCH.md, docs/DEFINITION_CLUSTERS.md,
 * database/migrations/165-add-search-readings.sql.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import db from '../../../db.js';
import { initRunLog } from '../run-log.js';
import { parseBackfillArgs, wordsWhereClause } from '../shared/lib/cli.js';
import { readCedict } from './lib/cedictPinyin.js';
import { buildSearchReadings, defaultPrimaryForms } from './lib/searchReadings.js';

const SCRIPT_VERSION = 1; // bump when this script's logic changes
const { stampEntries } = initRunLog({ script: 'chinese/backfill-search-readings', version: SCRIPT_VERSION });

const CEDICT_PATH = path.join(__dirname, '../../../cedict_ts.u8');
const APPLY = process.argv.includes('--apply');
const REPAIR_PRIMARY = process.argv.includes('--repair-primary');
const { targetWords } = parseBackfillArgs();

/** simplified headword → every raw CEDICT pinyin listed for it (one CEDICT line per reading). */
function cedictReadingsByHeadword() {
  const map = new Map();
  for (const { simplified, rawPinyin } of readCedict(CEDICT_PATH)) {
    if (!map.has(simplified)) map.set(simplified, []);
    map.get(simplified).push(rawPinyin);
  }
  return map;
}

async function main() {
  console.log(`Search-readings backfill — ${APPLY ? 'APPLY' : 'DRY RUN'}${REPAIR_PRIMARY ? ' + repair-primary' : ''}`);
  const cedict = cedictReadingsByHeadword();
  console.log(`CEDICT: ${cedict.size} headwords`);

  const client = await db.getClient();
  try {
    const params = [];
    const wordsFilter = wordsWhereClause('word1', targetWords, params);
    const { rows } = await client.query(
      `SELECT id, word1, pronunciation, "numberedPinyin", tone, "definitionClusters", "searchReadings"
         FROM dictionaryentries_zh
        WHERE language = 'zh' ${wordsFilter}
        ORDER BY id`,
      params
    );
    console.log(`Rows examined: ${rows.length}`);

    const changes = [];
    for (const row of rows) {
      const primary = REPAIR_PRIMARY ? defaultPrimaryForms(row) : null;
      const searchReadings = buildSearchReadings({
        cedictReadings: cedict.get(row.word1) ?? [],
        clusters: row.definitionClusters,
        primaryNumbered: [row.numberedPinyin, primary?.numberedPinyin],
        existing: row.searchReadings,
      });
      if (!primary && searchReadings === row.searchReadings) continue;
      changes.push({ row, primary, searchReadings });
    }

    const primaryChanges = changes.filter(c => c.primary);
    console.log(`searchReadings to write: ${changes.filter(c => c.searchReadings !== c.row.searchReadings).length}`);
    if (REPAIR_PRIMARY) {
      console.log(`primary readings to repair: ${primaryChanges.length}`);
      for (const { row, primary } of primaryChanges) {
        console.log(`  ${row.word1}: ${row.pronunciation} (${row.numberedPinyin}) → ${primary.pronunciation} (${primary.numberedPinyin})`);
      }
    }
    for (const { row, searchReadings } of changes.slice(0, 15)) {
      console.log(`  sample ${row.word1}: ${searchReadings}`);
    }

    if (!APPLY) {
      console.log('\nDry run — nothing written. Re-run with --apply.');
      return;
    }

    // One transaction: a half-applied primary repair would leave some heteronyms re-pointed
    // and others not, which is harder to reason about than either end state.
    await client.query('BEGIN');
    for (const { row, primary, searchReadings } of changes) {
      await client.query(
        `UPDATE dictionaryentries_zh
            SET "searchReadings" = $2,
                pronunciation    = COALESCE($3, pronunciation),
                "numberedPinyin" = COALESCE($4, "numberedPinyin"),
                tone             = COALESCE($5, tone)
          WHERE id = $1`,
        [row.id, searchReadings, primary?.pronunciation ?? null, primary?.numberedPinyin ?? null, primary?.tone ?? null]
      );
      await stampEntries(client, 'dictionaryentries_zh', row.id);
    }
    await client.query('COMMIT');
    console.log(`\n✅ Wrote ${changes.length} rows (${primaryChanges.length} primary repairs).`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('FAILED — rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit();
  }
}

main();
