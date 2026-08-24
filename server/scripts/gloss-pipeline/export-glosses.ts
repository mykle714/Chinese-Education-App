/**
 * Step 1 of the gloss confusability pipeline (docs/GLOSS_CONFUSABILITY.md § 4).
 *
 * LAYER: offline build script (read-only over det). Writes a TSV, never the database.
 *
 * Emits every DISTINCT dd key a game could put on a board, using the REAL
 * `ddCollisionKey` / `resolveDisplayDefinition` from server/utils/definitions.ts. The
 * Python half of the pipeline must never re-implement dd resolution: dd resolves through
 * `definitionClusters`, `selectedSense` and the parenthetical strip, and a Python twin of
 * that would be a second source of truth that silently drifts. Node owns dd; Python owns
 * only the model.
 *
 * ⚠️ ONE ROW YIELDS SEVERAL KEYS. dd is sense-resolved, so a clustered entry shows
 * DIFFERENT English to different learners depending on their `selectedSense`. Every sense
 * a learner could have selected is a string that could appear on a board, so the key set
 * is (default dd) ∪ (dd under each cluster label), not one key per row. § 4 step 1 says
 * "extract distinct dd keys from det" without spelling this out; the § 1 census implies it
 * (5,169 distinct dds from 4,224 rows).
 *
 * Scope is DISCOVERABLE rows only, on both zh and es. Those are the words games can
 * actually serve, and the incremental cadence (§ 7) hangs off /mark-discoverable, which is
 * precisely the operation that adds them. `--all` widens to the full det for a sizing run.
 *
 * Run from server/:
 *   npx tsx scripts/gloss-pipeline/export-glosses.ts            # discoverable zh + es
 *   npx tsx scripts/gloss-pipeline/export-glosses.ts --all      # every det row (sizing)
 *   npx tsx scripts/gloss-pipeline/export-glosses.ts --lang zh
 *
 * Output: glosses.tsv, one line per distinct key:  glossKey \t languages \t sampleWords
 * plus corpus-snapshot.txt, the provenance stamp that travels into gloss_meaning_groups.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../../db.js';
import { ddCollisionKey } from '../../utils/definitions.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const langArg = args.indexOf('--lang');
const LANGS: Array<'zh' | 'es'> =
  langArg >= 0 ? [args[langArg + 1] as 'zh' | 'es'] : ['zh', 'es'];

interface Cluster { sense?: string | null; glosses?: string[] | null }

/** Every dd string this entry could display, across all sense picks a learner can make. */
function keysForEntry(row: {
  definitions: string[];
  definitionClusters: Cluster[] | null;
}): string[] {
  const entry = {
    definition: row.definitions?.[0] ?? null,
    definitionClusters: row.definitionClusters as never,
  };
  const keys = new Set<string>();

  // The default view: no sense picked. Also the ONLY view for unclustered entries.
  keys.add(ddCollisionKey({ ...entry, selectedSense: null }));

  // Every other sense a learner may have selected. Matched by LABEL, exactly as the
  // runtime does — labels are stable across re-clustering, indices are not.
  for (const cluster of row.definitionClusters ?? []) {
    if (cluster?.sense) keys.add(ddCollisionKey({ ...entry, selectedSense: cluster.sense }));
  }

  // Empty keys never collide (the phase-1 contract), so they must not enter the key set:
  // a group id on the empty string would make every gloss-less entry mutually exclusive.
  return [...keys].filter((k) => k.length > 0);
}

async function main(): Promise<void> {
  const byKey = new Map<string, { langs: Set<string>; words: string[] }>();
  let rowCount = 0;

  for (const language of LANGS) {
    const table = language === 'zh' ? 'dictionaryentries_zh' : 'dictionaryentries_es';
    const client = await db.getClient();
    try {
      const { rows } = await client.query(
        `SELECT word1, definitions, "definitionClusters"
           FROM ${table}
          WHERE ($1::boolean OR discoverable = TRUE)`,
        [ALL]
      );
      rowCount += rows.length;
      for (const row of rows) {
        for (const key of keysForEntry(row)) {
          let slot = byKey.get(key);
          if (!slot) byKey.set(key, (slot = { langs: new Set(), words: [] }));
          slot.langs.add(language);
          if (slot.words.length < 3) slot.words.push(row.word1);
        }
      }
      console.log(`${table}: ${rows.length} rows`);
    } finally {
      // Release in a finally so a malformed row cannot leak the client (a query error
      // here would otherwise hold a pool slot until the process exits).
      client.release();
    }
  }

  const keys = [...byKey.keys()].sort();
  const out = keys
    .map((k) => `${k}\t${[...byKey.get(k)!.langs].sort().join(',')}\t${byKey.get(k)!.words.join(' ')}`)
    .join('\n');
  fs.writeFileSync(path.join(HERE, 'glosses.tsv'), out + '\n');

  // corpusSnapshot travels onto every gloss_meaning_groups row (§ 5a rule 3), so a
  // grouping on prod can be traced back to the exact corpus it was built from.
  const snapshot = `${LANGS.join('+')}${ALL ? '-all' : '-discoverable'}-${rowCount}rows-${keys.length}keys`;
  fs.writeFileSync(path.join(HERE, 'corpus-snapshot.txt'), snapshot + '\n');

  console.log(`\n${rowCount} rows -> ${keys.length} distinct dd keys`);
  console.log(`corpusSnapshot: ${snapshot}`);
  console.log('wrote glosses.tsv, corpus-snapshot.txt');
  process.exit(0);
}

main().catch((err) => {
  console.error('export-glosses failed:', err);
  process.exit(1);
});
