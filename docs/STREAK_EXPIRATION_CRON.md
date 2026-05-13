# Streak Expiration Cron (prod only)

An hourly Postgres cron job that expires streaks for users who stop opening the
app. Mirrors the client-side logic in `UserMinutePointsService.newDayOperation`,
using each user's stored `users.timezone` against the 4 AM local-day boundary.

- **SQL**: `database/cron/expire-stale-streaks.sql`
- **Schema dependency**: `users.timezone` (added by migration
  `database/migrations/50-add-user-timezone.sql`)
- **Refresh path**: the client writes `users.timezone` on every minute-points
  increment / new-day call via `UserMinutePointsService`.

The job is wrapped in a transaction and is idempotent — once `lastStreakDate`
is bumped to the user's local "today", they fall out of the candidate set until
they start a new streak.

## Dev

Not installed. Run manually to test:

```bash
psql "$DATABASE_URL" -f database/cron/expire-stale-streaks.sql
```

## Prod adoption (one-time, after `/deploy`)

1. **Verify the migration applied.** `/deploy` runs it automatically; confirm
   `users.timezone` exists and the partial index
   `idx_users_laststreakdate_currentstreak` is present.

2. **Let timezones backfill organically.** Existing rows default to `'UTC'`
   and get rewritten the next time the user hits the minute-points endpoint.
   Optionally hold the cron install for ~a week so most active users have
   reported their real timezone before the first sweep.

3. **Smoke-test the SQL on prod** before scheduling:
   ```bash
   psql "$DATABASE_URL" -f database/cron/expire-stale-streaks.sql
   ```
   Safe to re-run.

4. **Install the crontab line** on the prod server:
   ```
   0 * * * * psql "$DATABASE_URL" -f /path/to/repo/database/cron/expire-stale-streaks.sql >> /var/log/streak-expire.log 2>&1
   ```
   Replace `/path/to/repo` with the prod checkout path.

5. **Verify** `/var/log/streak-expire.log` the morning after install.

## Risks to weigh before the first run

- **Backlog blast radius.** The first tick penalizes every user whose
  `currentStreak > 0` and `lastStreakDate` is ≥ 2 local days behind. Preview
  with:
  ```sql
  SELECT COUNT(*) FROM users
  WHERE "currentStreak" > 0
    AND "lastStreakDate" IS NOT NULL
    AND ((((now() AT TIME ZONE timezone) - INTERVAL '4 hours')::date)
         - "lastStreakDate"::date) >= 2;
  ```
- **Users still on default `'UTC'`** are evaluated in UTC until the client
  backfills. Edge cases (e.g. UTC-10 users who haven't opened the app since
  the migration) could see the penalty fire up to ~half a day before their
  real local 4 AM.

## Maintenance

The penalty amount is **hard-coded to 10 minutes** in the SQL. Keep it in sync
with `STREAK_CONFIG.DAILY_PENALTY_MINUTES` in `server/constants.ts`.
