/**
 * generate-unlock-schedule-sql — rewrites the GENERATED block in the inactivity-penalty cron SQL
 * from the one place the unlock schedule is written down (server/dal/shared/unlockSchedule.ts).
 *
 * Run after ANY change to UNLOCK_BREAKPOINTS or the steady-state constants:
 *
 *     npm run gen:unlock-schedule-sql
 *
 * Then redeploy `database/cron/expire-stale-streaks.sql` to prod (the cron file is the install —
 * it CREATE OR REPLACEs the function every tick, so there is no migration to write).
 *
 * LAYER: build/codegen script. The string building is in the pure shared module
 * {@link ../dal/shared/unlockScheduleSql}; this file only does fs I/O, so the guard test
 * `src/__tests__/unlockScheduleSqlSync.test.ts` can verify the same render without touching disk
 * beyond a read.
 *
 * Exit codes: 0 wrote (or already current), 1 markers missing / unreadable file.
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { withRenderedUnlockSql } from '../dal/shared/unlockScheduleSql.js';

/** The cron file that carries the generated block. Resolved from this script, not the CWD. */
export const CRON_SQL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../database/cron/expire-stale-streaks.sql',
);

function main(): void {
  const before = readFileSync(CRON_SQL_PATH, 'utf8');
  const after = withRenderedUnlockSql(before); // throws if the markers were removed

  if (after === before) {
    console.log(`[gen:unlock-schedule-sql] already current — ${CRON_SQL_PATH}`);
    return;
  }

  writeFileSync(CRON_SQL_PATH, after, 'utf8');
  console.log(`[gen:unlock-schedule-sql] regenerated block in ${CRON_SQL_PATH}`);
  console.log('  → redeploy this cron file to prod so the function is replaced there too.');
}

try {
  main();
} catch (err) {
  console.error(`[gen:unlock-schedule-sql] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
