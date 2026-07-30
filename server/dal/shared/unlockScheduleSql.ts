/**
 * unlockScheduleSql — renders the minutes→unlocks curve of {@link ./unlockSchedule} as a Postgres
 * function, so the decay cron can ask the SAME schedule the grant flow uses instead of restating
 * its breakpoints in SQL.
 *
 * WHY. `database/cron/expire-stale-streaks.sql` needs `target = unlocks(new_total)` to know how
 * many occupants to trim, and SQL can't import TypeScript. It used to hard-code the whole
 * breakpoint ladder as a `CASE`, i.e. a hand-synced MIRROR that silently drifts the moment a
 * breakpoint moves — a drifted cron deletes occupants the grant flow immediately re-grants (or
 * leaves surplus forever). Now the ladder is GENERATED from the TS table into a marked block of
 * that file, and a guard test fails the build when the block is stale.
 *
 * LAYER: dep-free shared codegen (same `server/dal/shared/*` family). Pure string building — no
 * DB, no fs; the generator script (`server/scripts/generate-unlock-schedule-sql.ts`) does the I/O
 * and the guard test (`src/__tests__/unlockScheduleSqlSync.test.ts`) does the comparison.
 *
 * DEPENDS ON: {@link ./unlockSchedule} (UNLOCK_BREAKPOINTS + the steady-state constants).
 * DEPENDED ON BY: the generator script, the guard test, and — through the generated block —
 * database/cron/expire-stale-streaks.sql. Documented in docs/NIGHT_MARKET_TEMPLATES.md
 * § "Unlock economy" and docs/STREAK_EXPIRATION_CRON.md.
 */

import {
  UNLOCK_BREAKPOINTS,
  STEADY_STATE_MINUTES,
  STEADY_STATE_UNLOCKS,
  MINUTES_PER_STEADY_UNLOCK,
} from './unlockSchedule.js';

/** Opening marker of the generated block in the cron SQL (matched verbatim). */
export const UNLOCK_SQL_BEGIN_MARKER = '-- >>> BEGIN GENERATED: nightmarket_unlocks_for_minutes >>>';
/** Closing marker of the generated block in the cron SQL (matched verbatim). */
export const UNLOCK_SQL_END_MARKER = '-- <<< END GENERATED <<<';

/** The Postgres function name the cron calls. */
export const UNLOCKS_FN_NAME = 'nightmarket_unlocks_for_minutes';

/**
 * The generated SQL block: a `CREATE OR REPLACE FUNCTION` whose body is the exact curve
 * {@link ./unlockSchedule unlocksForMinutes} computes — the explicit breakpoints as descending
 * `WHEN minutes >= n` arms (descending so the FIRST match is the highest threshold ≤ minutes,
 * mirroring the TS loop's "last breakpoint that fits"), preceded by the steady-state arm.
 *
 * `IMMUTABLE` (a pure function of its argument). The outer `GREATEST(0, …)` mirrors the TS floor:
 * negatives fall to the `ELSE 0` arm and a NULL argument yields 0 (GREATEST ignores NULLs), so the
 * cron can never compute a negative trim target. Includes the marker lines so the generator/guard can
 * locate it, and the block is idempotent — the cron re-runs it every tick, which is also how a
 * schedule change reaches prod (no migration: the cron file IS the install).
 */
export function renderUnlocksForMinutesSql(): string {
  // Explicit breakpoints, highest threshold first. `[0, 0]` is dropped (it is the ELSE arm), and so
  // is any breakpoint at/above the steady-state threshold — the steady-state arm above already
  // covers those minutes, so emitting them would produce dead, confusing SQL.
  const arms = [...UNLOCK_BREAKPOINTS]
    .filter(([minMinutes]) => minMinutes > 0 && minMinutes < STEADY_STATE_MINUTES)
    .sort((a, b) => b[0] - a[0])
    .map(([minMinutes, unlocks]) => `      WHEN minutes >= ${minMinutes} THEN ${unlocks}`);

  return [
    UNLOCK_SQL_BEGIN_MARKER,
    '-- GENERATED — DO NOT EDIT BY HAND.',
    '--   source:     server/dal/shared/unlockSchedule.ts (UNLOCK_BREAKPOINTS + steady state)',
    '--   regenerate: npm run gen:unlock-schedule-sql',
    '-- Guarded by src/__tests__/unlockScheduleSqlSync.test.ts, which fails if this block is stale.',
    `CREATE OR REPLACE FUNCTION ${UNLOCKS_FN_NAME}(minutes int)`,
    'RETURNS int',
    'LANGUAGE sql',
    'IMMUTABLE',
    'AS $fn$',
    '  SELECT GREATEST(0,',
    '    CASE',
    `      WHEN minutes >= ${STEADY_STATE_MINUTES} THEN ${STEADY_STATE_UNLOCKS} + ` +
      `floor((minutes - ${STEADY_STATE_MINUTES}) / ${MINUTES_PER_STEADY_UNLOCK})::int`,
    ...arms,
    '      ELSE 0',
    '    END)',
    '$fn$;',
    UNLOCK_SQL_END_MARKER,
  ].join('\n');
}

/**
 * Replace the marked generated block in a cron SQL file's text with the current render.
 * Throws when the markers are missing or out of order, so a mangled file fails loudly instead
 * of silently keeping a stale ladder. Pure (text in → text out) so the guard test can call it.
 */
export function withRenderedUnlockSql(fileText: string): string {
  const start = fileText.indexOf(UNLOCK_SQL_BEGIN_MARKER);
  const endMarkerAt = fileText.indexOf(UNLOCK_SQL_END_MARKER, start + 1);
  if (start === -1 || endMarkerAt === -1) {
    throw new Error(
      `unlockScheduleSql: generated-block markers not found (expected ${UNLOCK_SQL_BEGIN_MARKER} … ` +
        `${UNLOCK_SQL_END_MARKER}). Was the cron SQL edited by hand?`,
    );
  }

  const end = endMarkerAt + UNLOCK_SQL_END_MARKER.length;
  return fileText.slice(0, start) + renderUnlocksForMinutesSql() + fileText.slice(end);
}
