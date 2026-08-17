/**
 * arena-cron.ts — the hourly prod driver for the Arena (docs/ARENA_FEATURE.md § 10).
 *
 * WHY A SEPARATE FILE FROM arena-tick.ts. `arena-tick.ts` is the DEV trigger and
 * carries test scaffolding — most importantly `--seed-opt-ins`, which opts every
 * user in the database into next week. That flag must not exist on any code path
 * a scheduler can reach. This file is the production entry point and takes no
 * arguments at all: there is no way to ask it to do anything except the real
 * hourly pass at the real current time.
 *
 * WHAT IT DOES. One call to ArenaService.tick(), which resolves closed arenas
 * BEFORE forming new ones. That order is not a preference — resolution releases
 * members' live seats and formation consumes them, so forming first makes an
 * outage self-escalating (last week's unresolved arenas hold every seat, the new
 * formation is rejected by uq_arena_member_live, and nobody races). tick() exists
 * so the ordering cannot be got wrong at a call site; do not inline the two calls
 * here.
 *
 * IDEMPOTENT. Formation checks arenaExistsForBucket, resolution guards on
 * `resolvedAt IS NULL`. A retry, a double-fire, or a systemd catch-up run after a
 * reboot is harmless — which is what makes `Persistent=true` safe on the timer.
 *
 * EXIT CODE IS THE MONITORING SIGNAL. Exiting non-zero is how a failure becomes
 * visible in `systemctl --user status cow-arena` instead of being buried in the
 * log file, so every failure path must exit 1.
 *
 * Run on prod by the cow-arena systemd user timer:
 *   docker exec cow-backend-prod node dist/scripts/arena-cron.js
 */
import { arenaService } from '../dal/setup.js';

async function main() {
  const startedAt = new Date();
  // Every line is prefixed with an ISO timestamp: this appends to a long-lived
  // log file, so a bare message cannot be tied back to the hour it came from.
  console.log(`[${startedAt.toISOString()}] arena-cron: start`);

  const { resolved, formed } = await arenaService.tick(startedAt);

  const elapsedMs = Date.now() - startedAt.getTime();
  console.log(
    `[${new Date().toISOString()}] arena-cron: done — resolved ${resolved}, formed ${formed} (${elapsedMs}ms)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // The pg pool holds the event loop open, so an explicit exit is required in
    // both directions — without it a successful run would hang the systemd unit
    // until its timeout and be recorded as a failure.
    console.error(`[${new Date().toISOString()}] arena-cron: FAILED`, err);
    process.exit(1);
  });
