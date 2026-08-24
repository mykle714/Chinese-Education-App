/**
 * Step 7 of the gloss confusability pipeline (docs/GLOSS_CONFUSABILITY.md § 5a):
 * push `gloss_meaning_groups` from the dev box UP to prod.
 *
 * LAYER: offline deploy script. It is the ONLY writer of prod's copy of this table.
 *
 * ⚠️ THIS INVERTS THE APP-WIDE RULE that prod is the source of truth. It is safe for this
 * table and this table ONLY, because the contents are DERIVED — a pure function of
 * (det corpus, model revision, template version, thresholds). No user writes it, nothing
 * on prod authors it, and losing it costs a rebuild and nothing else. Skew degrades
 * harmlessly in both directions: a gloss prod has and dev never saw simply gets no row,
 * and § 6 rule 1 says no row means NO CONSTRAINT. Skew can only ever cause a MISSING
 * suppression, never a wrong one.
 *
 * § 5a's five requirements, and where each is met here:
 *   1. Single-table scope   — the only table named in this file is gloss_meaning_groups.
 *                             It cannot touch det: there is no other table name in it, and
 *                             a --confirm-table guard re-checks before writing. The deleted
 *                             /data-deploy skill is why this is spelled out (2026-07-02).
 *   2. Atomic replace       — TRUNCATE + insert inside ONE transaction, so live readers see
 *                             the previous snapshot until commit. Never a piecemeal upsert.
 *   3. Stamp provenance     — every row carries modelRevision / templateVersion /
 *                             corpusSnapshot, copied from the dev rows unchanged.
 *   4. Committed to the repo — this file, not someone's home directory.
 *   5. Rollback is TRUNCATE  — with the table empty the app degrades to phase-1 behaviour
 *                             with no code change. Prefer that to debugging a bad push.
 *
 * Run from server/ with the PROD connection in the environment:
 *   npx tsx scripts/gloss-pipeline/push-groups.ts --dry-run
 *   PROD_DB_HOST=... PROD_DB_PASSWORD=... npx tsx scripts/gloss-pipeline/push-groups.ts
 */
import pg from 'pg';
import { config as devConfig } from '../../db-config.js';

const TABLE = 'gloss_meaning_groups';   // the ONLY table this script may name
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = 1000;

interface GroupRow {
  glossKey: string;
  meaningGroupId: number;
  modelRevision: string;
  templateVersion: string;
  corpusSnapshot: string;
}

/** Prod connection, from PROD_* env vars only — never inherited from the dev config, so a
 *  missing variable fails loudly instead of silently pushing dev's table onto itself. */
function prodConfig(): pg.PoolConfig {
  const host = process.env.PROD_DB_HOST;
  const password = process.env.PROD_DB_PASSWORD;
  if (!host || !password) {
    throw new Error('PROD_DB_HOST and PROD_DB_PASSWORD must be set (see /deploy for the tunnel)');
  }
  return {
    host,
    port: parseInt(process.env.PROD_DB_PORT || '5432'),
    database: process.env.PROD_DB_NAME || 'cow_db',
    user: process.env.PROD_DB_USER || 'cow_user',
    password,
    ssl: process.env.PROD_DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

async function readDevGroups(): Promise<GroupRow[]> {
  const pool = new pg.Pool(devConfig);
  try {
    const { rows } = await pool.query(
      `SELECT "glossKey", "meaningGroupId", "modelRevision", "templateVersion", "corpusSnapshot"
         FROM ${TABLE} ORDER BY "glossKey"`
    );
    return rows;
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const rows = await readDevGroups();
  if (rows.length === 0) {
    throw new Error(`dev ${TABLE} is EMPTY — refusing to push. Run cluster.py first.`);
  }

  // A build must be internally consistent: one modelRevision, one templateVersion, one
  // corpusSnapshot across every row. A mixture means cluster.py was interrupted or two
  // builds were merged, and pushing it would make prod's provenance stamps meaningless.
  const stamps = new Set(rows.map((r) => `${r.modelRevision}|${r.templateVersion}|${r.corpusSnapshot}`));
  if (stamps.size !== 1) {
    throw new Error(`dev ${TABLE} carries ${stamps.size} different provenance stamps — rebuild before pushing`);
  }
  const groups = new Set(rows.map((r) => r.meaningGroupId)).size;
  console.log(`dev ${TABLE}: ${rows.length} rows, ${groups} groups`);
  console.log(`provenance: ${[...stamps][0]}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: prod not contacted, nothing written');
    return;
  }

  const pool = new pg.Pool(prodConfig());
  const client = await pool.connect();
  try {
    const before = await client.query(`SELECT count(*)::int AS n FROM ${TABLE}`);
    console.log(`prod ${TABLE} before: ${before.rows[0].n} rows`);

    // Requirement 2: one transaction. Readers keep seeing the old snapshot until COMMIT.
    await client.query('BEGIN');
    await client.query(`TRUNCATE ${TABLE}`);
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const values = chunk
        .map((_, j) => `($${j * 5 + 1}, $${j * 5 + 2}, $${j * 5 + 3}, $${j * 5 + 4}, $${j * 5 + 5})`)
        .join(', ');
      await client.query(
        `INSERT INTO ${TABLE} ("glossKey", "meaningGroupId", "modelRevision",
                               "templateVersion", "corpusSnapshot")
         VALUES ${values}`,
        chunk.flatMap((r) => [r.glossKey, r.meaningGroupId, r.modelRevision,
                              r.templateVersion, r.corpusSnapshot])
      );
    }
    await client.query('COMMIT');

    const after = await client.query(`SELECT count(*)::int AS n FROM ${TABLE}`);
    console.log(`prod ${TABLE} after:  ${after.rows[0].n} rows`);
    if (after.rows[0].n !== rows.length) {
      throw new Error(`row count mismatch — expected ${rows.length}, got ${after.rows[0].n}`);
    }
    console.log('\npush complete. Rollback if anything looks wrong:');
    console.log(`  TRUNCATE ${TABLE};   -- degrades to phase-1 exact-dd, no code change`);
  } catch (err) {
    // ROLLBACK may itself fail if the connection died; never let that mask the real error.
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('push-groups failed:', err.message);
  process.exit(1);
});
