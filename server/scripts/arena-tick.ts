/**
 * arena-tick.ts — run one arena formation + resolution pass by hand.
 *
 * WHY THIS EXISTS. The real driver is an hourly cron that is installed only on
 * prod (docs/ARENA_FEATURE.md § 10), so on a dev machine arenas would never form
 * and the board would be permanently empty — the feature would be untestable
 * locally. This script is the dev-side trigger. `POST /api/arena/admin/tick` is
 * the same thing over HTTP for when the server is already up.
 *
 * Usage, from the server/ directory:
 *
 *   npx tsx scripts/arena-tick.ts              # form + resolve at the real "now"
 *   npx tsx scripts/arena-tick.ts --at "2026-08-18T08:05:00Z"
 *   npx tsx scripts/arena-tick.ts --seed-opt-ins   # opt every user in, for testing
 *
 * Both operations are IDEMPOTENT — formation checks arenaExistsForBucket and
 * resolution guards on `resolvedAt IS NULL` — so re-running is safe.
 */
import { arenaService, arenaDAL } from '../dal/setup.js';
import { dbManager } from '../dal/base/DatabaseManager.js';
import { nextArenaWeekKey, arenaWeekStart, arenaCloseFor, isBreakPeriod } from '../shared/arenaWeek.js';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Opt every (user, language) into the coming week.
 *
 * Test scaffolding only. Real opt-in is a deliberate act during the break
 * (§ 8); this exists so a dev machine can get a populated board without 25
 * people tapping a button.
 */
async function seedOptIns(now: Date): Promise<number> {
  const weekKey = nextArenaWeekKey(now, 'UTC');
  const result = await dbManager.executeQuery(async (client) =>
    client.query(
      `UPDATE user_languages SET "arenaOptInWeek" = $1::date WHERE "arenaOptInWeek" IS DISTINCT FROM $1::date`,
      [weekKey],
    ),
  );
  console.log(`  seeded opt-ins for week ${weekKey}: ${result.rowsAffected} row(s)`);
  return result.rowsAffected;
}

async function main() {
  const atArg = argValue('--at');
  const now = atArg ? new Date(atArg) : new Date();
  if (isNaN(now.getTime())) {
    console.error(`Invalid --at value: ${atArg}`);
    process.exit(1);
  }

  console.log('=== arena tick ===');
  console.log(`  now:        ${now.toISOString()}`);
  console.log(`  week start: ${arenaWeekStart(now, 'UTC').toISOString()} (UTC bucket)`);
  console.log(`  closes:     ${arenaCloseFor(arenaWeekStart(now, 'UTC'), 'UTC').toISOString()}`);
  console.log(`  in break:   ${isBreakPeriod(now, 'UTC')}`);

  if (process.argv.includes('--seed-opt-ins')) {
    await seedOptIns(now);
  }

  const candidates = await arenaDAL.listCandidates(nextArenaWeekKey(now, 'UTC'));
  console.log(`  candidates: ${candidates.length}`);

  // Resolve BEFORE forming — see ArenaService.tick for why the order matters.
  const { resolved, formed } = await arenaService.tick(now);
  console.log(`  resolved:   ${resolved} arena(s)`);
  console.log(`  formed:     ${formed} arena(s)`);

  console.log('=== done ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('arena-tick failed:', err);
  process.exit(1);
});
