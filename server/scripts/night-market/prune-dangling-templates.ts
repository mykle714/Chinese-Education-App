/**
 * Cron companion to `database/cron/expire-stale-streaks.sql` — the DECAY-side template prune.
 *
 * The hourly SQL cron debits inactive users' minute points and decays their OCCUPANTS in pure SQL,
 * but the "remove empty, weakly-attached templates" pass is an iterative rectangle-adjacency
 * fixpoint that is impractical in plpgsql, so it lives in TypeScript
 * (NightMarketPlacementService.pruneDanglingTemplates). This script runs that pass for every user
 * the cron just penalized, so the geometry stays single-sourced with the live author-tool path.
 *
 * "Just penalized" = `user_language_points.lastPenaltyDate` equals that user's current local day
 * (the SQL cron stamps exactly that on debit). Since migration 130 penalties are per-(user,
 * language), so the candidate set is PAIRS, not users: a Spanish lapse prunes only the Spanish
 * continent. The local-day boundary still comes from `users.timezone` — it belongs to the person.
 * Re-running within the same day is a safe no-op — the prune is idempotent once a market has
 * nothing left to cull.
 *
 * LAYER: operational script (prod cron). Run AFTER the SQL cron in the same crontab entry:
 *   tsx server/scripts/night-market/prune-dangling-templates.ts
 * On dev, run manually to test. Exits 0 on success, 1 on error.
 */
import db from '../../db.js';
import { dbManager } from '../../dal/base/DatabaseManager.js';
import { nightMarketPlacementService } from '../../dal/setup.js';

async function main(): Promise<void> {
  // (user, language) pairs penalized in that user's current local day (4 AM-bounded, per their
  // stored tz) — the exact set the SQL cron just decayed. Mirrors the cron's own local-day
  // arithmetic, joining users only for the timezone.
  const { recordset: pairs } = await dbManager.executeQuery<{ userid: string; language: string }>(
    async (client) =>
      client.query(`
        SELECT p."userId" AS userid, p.language
        FROM user_language_points p
        JOIN users u ON u.id = p."userId"
        WHERE p."lastPenaltyDate"
              = ((now() AT TIME ZONE COALESCE(u.timezone, 'UTC')) - INTERVAL '4 hours')::date
      `),
  );

  let marketsPruned = 0;
  let templatesRemoved = 0;
  for (const pair of pairs) {
    // One market at a time. A failure on one pair must not abort the rest of the cron run, so each
    // is caught and logged individually rather than rejecting the whole loop.
    try {
      const { removedIds } = await nightMarketPlacementService.pruneDanglingTemplates(
        pair.userid,
        pair.language,
      );
      if (removedIds.length > 0) {
        marketsPruned++;
        templatesRemoved += removedIds.length;
      }
    } catch (err) {
      console.error(
        `[NightMarket] prune failed for user=${pair.userid.substring(0, 8)}… lang=${pair.language}:`,
        err,
      );
    }
  }

  console.log(
    `[NightMarket] prune-dangling-templates ${new Date().toISOString()} ` +
      `candidates=${pairs.length} markets_pruned=${marketsPruned} templates_removed=${templatesRemoved}`,
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
