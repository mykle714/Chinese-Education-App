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

3. **Smoke-test the SQL on prod** before scheduling. Prod postgres runs in
   the `cow-postgres-prod` container — pipe the SQL in over stdin instead of
   needing a `$DATABASE_URL` on the host:
   ```bash
   docker exec -i cow-postgres-prod psql -U cow_user -d cow_db \
     < /home/michael/vocabulary-app/database/cron/expire-stale-streaks.sql
   ```
   Safe to re-run (idempotent — second run returns `UPDATE 0`).

4. **Install the crontab line** on the prod server. Note: `/var/log` is not
   writable by `michael`, so the log lives next to the project (already
   gitignored by `logs` / `*.log`). The absolute path to `docker` matters
   because cron's PATH is minimal.
   ```
   # Hourly streak expiration — see docs/STREAK_EXPIRATION_CRON.md
   0 * * * * /usr/bin/docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < /home/michael/vocabulary-app/database/cron/expire-stale-streaks.sql >> /home/michael/vocabulary-app/logs/streak-expire.log 2>&1
   ```
   First run `mkdir -p /home/michael/vocabulary-app/logs`.

5. **Verify** `/home/michael/vocabulary-app/logs/streak-expire.log` the
   morning after install — should show one `BEGIN / DO / COMMIT` block per
   hour, plus a `NOTICE:` line on any tick that actually penalized users
   (see "Log format" below).

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

## Log format

Idle ticks (no users penalized) write only the default psql output:

```
BEGIN
DO
COMMIT
```

When at least one user is penalized, a single `RAISE NOTICE` line is emitted
*before* the `DO` line, with the timestamp, affected count, user IDs, and
missed dates:

```
NOTICE:  streak-expire 2026-05-13 04:17:02.291416+00 penalized=1 user_ids={30093a9b-8cf4-4005-b7da-fca59686149d} missed_dates={2026-05-10}
```

To find every cleanup event:

```bash
grep '^NOTICE:  streak-expire' /home/michael/vocabulary-app/logs/streak-expire.log
```

The `missed_dates` array is parallel to `user_ids` — same index ⇒ same user.
Each entry equals `lastStreakDate + 1 day` (the first local day the user
failed to maintain). The corresponding `userminutepoints` audit row is keyed
by `(user_id, missed_date)`.

## Maintenance

The penalty amount is **hard-coded to 10 minutes** in the SQL. Keep it in sync
with `STREAK_CONFIG.DAILY_PENALTY_MINUTES` in `server/constants.ts`.
