/**
 * Re-stamp Script: raise the cluster-definitions `enrichmentLog` version on rows that
 * DON'T need re-clustering, so a SCRIPT_VERSION bump re-triggers only the rows it fixes.
 *
 * Why this exists: every planner (oracle-plan.js, run-lazy-enrichment.js, `--stale`)
 * treats a row stamped below its manifest `version` as pending. A prompt bump that
 * fixes a FEW rows would otherwise re-cluster the whole corpus — and re-clustering
 * mints new `sense` labels, which orphans everything addressed by label
 * (vet.selectedSense, longDefinition keying, est `sense`/`senseDict` tags, breakdown
 * sense labels). So after an audit names the rows that need the new prompt, every
 * OTHER row stamped at exactly the previous version is moved up to the new one
 * without being re-run.
 *
 * Scope rules:
 *   - Only rows stamped at EXACTLY `--from` move. A row already below it was stale for
 *     an older reason and stays stale; a row with no stamp stays unstamped.
 *   - Only `discoverable` rows (the audit only reviewed shipped rows); an unshipped row
 *     is re-clustered with the new prompt when the pipeline reaches it.
 *   - Headwords listed in the audit file (by word1, so the list is portable between
 *     dev and PPE whatever their ids) are skipped — they stay stale and re-cluster.
 *   - `ranAt` is kept (the content is still what that run produced); the stamp gains
 *     `restampedFrom: <old version>` so a re-stamp is distinguishable from a real run.
 *
 * LAYER: data-enrichment (backfill). Language-generic, NO API calls.
 * Depended on by: the v11 (zh) / v5 (es) notes on SCRIPT_VERSION in
 * chinese/ and spanish/backfill-cluster-definitions.js; docs/DEFINITION_CLUSTERS.md
 * § "Over-compaction audit (2026-10-29)".
 *
 * Usage (from server/). Dev: the backend container, so it sees .env.docker:
 *   docker exec cow-backend npx tsx scripts/backfill/shared/restamp-cluster-version.js --language=zh --from=10 --to=11 --dry-run
 * PPE: the host checkout via run-ppe.sh — the PPE image does not ship scripts/, and the host
 * .env.docker carries the dev password:
 *   scripts/backfill/run-ppe.sh scripts/backfill/shared/restamp-cluster-version.js --language=zh --from=10 --to=11
 *   ... --exclude=scripts/backfill/shared/cluster-overcompaction-2026-10-29.json   # the default
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import db from '../../../db.js';

const SCRIPTS = {
  zh: { table: 'dictionaryentries_zh', script: 'chinese/backfill-cluster-definitions' },
  es: { table: 'dictionaryentries_es', script: 'spanish/backfill-cluster-definitions' },
};

const arg = (name) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const dryRun = process.argv.includes('--dry-run');
const language = arg('language');
const from = Number(arg('from'));
const to = Number(arg('to'));
const excludePath = path.resolve(arg('exclude') ?? path.join(__dirname, 'cluster-overcompaction-2026-10-29.json'));

async function run() {
  const target = SCRIPTS[language];
  if (!target) throw new Error('--language must be zh or es');
  if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from) throw new Error('--from and --to must be integers with to > from');

  let excluded;
  try {
    excluded = JSON.parse(fs.readFileSync(excludePath, 'utf8'))[language];
  } catch (e) {
    throw new Error(`could not read the exclusion list ${excludePath}: ${e.message}`);
  }
  if (!Array.isArray(excluded)) throw new Error(`${excludePath} has no "${language}" word list`);

  const { table, script } = target;
  console.log(`${dryRun ? 'DRY RUN — ' : ''}${table}: ${script} v${from} → v${to}, ${excluded.length} headwords held back (${path.basename(excludePath)})`);

  const client = await db.getClient();
  try {
    // Same predicate for the preview and the write, so the dry run counts exactly what moves.
    const where = `discoverable = TRUE
      AND ("enrichmentLog" #>> ARRAY[$1::text, 'version'])::int = $2
      AND NOT (word1 = ANY($3::text[]))`;
    const params = [script, from, excluded];

    const { rows: [{ moving }] } = await client.query(`SELECT count(*)::int AS moving FROM ${table} WHERE ${where}`, params);
    const { rows: [{ held }] } = await client.query(
      `SELECT count(*)::int AS held FROM ${table}
        WHERE discoverable = TRUE AND ("enrichmentLog" #>> ARRAY[$1::text, 'version'])::int = $2 AND word1 = ANY($3::text[])`,
      params);
    const { rows: missing } = await client.query(
      `SELECT w FROM unnest($1::text[]) w WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE word1 = w AND discoverable = TRUE)`,
      [excluded]);
    console.log(`  re-stamp: ${moving} rows · held back (stay stale): ${held} rows`);
    if (missing.length) console.log(`  ⚠ ${missing.length} listed headwords are not discoverable here: ${missing.map(r => r.w).join(', ')}`);

    if (dryRun) return;
    const { rowCount } = await client.query(
      `UPDATE ${table}
          SET "enrichmentLog" = jsonb_set("enrichmentLog", ARRAY[$1::text],
                ("enrichmentLog" -> $1) || jsonb_build_object('version', $4::int, 'restampedFrom', $2::int))
        WHERE ${where}`,
      [...params, to]);
    console.log(`  ✓ re-stamped ${rowCount} rows`);
  } finally {
    client.release();
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
