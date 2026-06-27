/**
 * SQL expression for a user's current week boundary as a timestamptz, given a `users` row
 * aliased `u`. Boundary = most-recent Sunday 04:00 in the user's local timezone (a logical day
 * starts at 04:00; the week resets on Sunday).
 *
 * This is the SAME derivation the inactivity cron uses to wipe stale weeklies (see
 * database/cron/expire-stale-streaks.sql) — kept identical so "this week" means the same thing
 * across the app: wins (server/dal/implementations/WinsDAL.ts) and community-layout votes
 * (server/dal/implementations/CommunityLayoutDAL.ts) both filter on it. Postgres
 * date_trunc('week') is Monday-based, so it is deliberately NOT used here.
 *
 * Usage: any query that references ${WEEK_BOUNDARY} must JOIN users aliased `u` so the per-user
 * timezone is in scope.
 */
export const WEEK_BOUNDARY = `(
  (
    (
      ((now() AT TIME ZONE COALESCE(u.timezone, 'UTC')) - INTERVAL '4 hours')::date
      - EXTRACT(DOW FROM ((now() AT TIME ZONE COALESCE(u.timezone, 'UTC')) - INTERVAL '4 hours'))::int
    )::timestamp + INTERVAL '4 hours'
  ) AT TIME ZONE COALESCE(u.timezone, 'UTC')
)`;
