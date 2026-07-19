/**
 * Cron companion to `database/cron/expire-stale-streaks.sql` — the DECAY-side template prune.
 *
 * The hourly SQL cron debits inactive users' minute points and decays their OCCUPANTS in pure SQL,
 * but the "remove empty, weakly-attached templates" pass is an iterative rectangle-adjacency
 * fixpoint that is impractical in plpgsql, so it lives in TypeScript
 * (NightMarketPlacementService.pruneDanglingTemplates). This script runs that pass for every user
 * the cron just penalized, so the geometry stays single-sourced with the live author-tool path.
 *
 * "Just penalized" = `users.lastPenaltyDate` equals the user's current local day (the SQL cron
 * stamps exactly that on debit). Re-running within the same day is a safe no-op — the prune is
 * idempotent once a user has nothing left to cull.
 *
 * LAYER: operational script (prod cron). Run AFTER the SQL cron in the same crontab entry:
 *   tsx server/scripts/night-market/prune-dangling-templates.ts
 * On dev, run manually to test. Exits 0 on success, 1 on error.
 */
import db from '../../db.js';
import { dbManager } from '../../dal/base/DatabaseManager.js';
import { nightMarketPlacementService } from '../../dal/setup.js';

async function main(): Promise<void> {
  // Users penalized in their current local day (4 AM-bounded, per their stored tz) — the exact set
  // the SQL cron just decayed. Mirrors the cron's own local-day arithmetic.
  const { recordset: users } = await dbManager.executeQuery<{ id: string }>(async (client) =>
    client.query(`
      SELECT id
      FROM users
      WHERE "lastPenaltyDate" = ((now() AT TIME ZONE COALESCE(timezone, 'UTC')) - INTERVAL '4 hours')::date
    `),
  );

  let usersPruned = 0;
  let templatesRemoved = 0;
  for (const u of users) {
    const { removedIds } = await nightMarketPlacementService.pruneDanglingTemplates(u.id);
    if (removedIds.length > 0) {
      usersPruned++;
      templatesRemoved += removedIds.length;
    }
  }

  console.log(
    `[NightMarket] prune-dangling-templates ${new Date().toISOString()} ` +
      `candidates=${users.length} users_pruned=${usersPruned} templates_removed=${templatesRemoved}`,
  );
}

main()
  .then(() => db.pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[NightMarket] prune-dangling-templates FAILED:', err);
    await db.pool.end().catch(() => {});
    process.exit(1);
  });
