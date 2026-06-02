# Inactivity Penalty Cron (prod only)

An hourly Postgres cron that debits minute points from inactive users.
Two branches run in one transaction:

1. **Streak break** — for users whose `currentStreak > 0` but whose
   `lastStreakDate` is ≥ 2 local days behind, reset `currentStreak` to
   0, stamp a 10-minute penalty row on the first missed day, deduct 10
   from `totalMinutePoints`, and roll `lastStreakDate` forward.
   Mirrors `UserMinutePointsService.newDayOperation` and remains the
   sole authority for streak breaks.
2. **Daily inactivity penalty** — for any user with
   `totalMinutePoints > 0` whose `lastMinutePointIncrement` is ≥ 2
   local days behind, debit 10 minutes per local day of continued
   inactivity. Independent of streak state — even users who never had
   a streak get charged. Idempotency is via `users.lastPenaltyDate`,
   which the cron stamps to today's local date after each debit.

Both branches use each user's stored `users.timezone` against the 4 AM
local-day boundary.

- **SQL**: `database/cron/expire-stale-streaks.sql` (filename kept for
  backward compatibility with the prod crontab; consider renaming to
  `apply-inactivity-penalty.sql` next time the crontab is touched)
- **Schema dependencies**:
  - `users.timezone` — migration `50-add-user-timezone.sql`
  - `users.lastPenaltyDate` — migration `54-add-user-last-penalty-date.sql`
  - `userminutepoints.language` (+ 3-col PK) — migration `62-add-language-to-userminutepoints.sql`
- **Refresh path for `users.timezone`**: written by the client on
  (a) every successful login or session restore via
  `POST /api/auth/on-login` (`UserController.onLogin`), and
  (b) every minute-points increment via `UserMinutePointsService`.

When the streak-break branch fires for a user, it also stamps
`lastPenaltyDate = today_local` so the daily-penalty branch skips them
on the same tick. Subsequent days of continued inactivity still trigger
the daily penalty.

**Language attribution (migration 62).** `userminutepoints` is keyed by
`(userId, streakDate, language)`. The streak/inactivity penalty is global,
so both branches stamp the penalty row on the user's
`COALESCE("selectedLanguage", 'zh')` and use a 3-column
`ON CONFLICT ("userId", "streakDate", "language")`. The penalty therefore
shows on the calendar of whichever language the user had selected when the
penalty fired.

## Dev

Not installed. Run manually to test:

```bash
psql "$DATABASE_URL" -f database/cron/expire-stale-streaks.sql
```

## Prod adoption (one-time, after `/deploy`)

1. **Verify migrations applied.** `/deploy` runs them automatically;
   confirm both `users.timezone` and `users.lastPenaltyDate` exist,
   plus the partial indexes
   `idx_users_laststreakdate_currentstreak` and
   `idx_users_lastpenaltydate_totalpoints`.

2. **Let timezones backfill organically.** Existing rows default to
   `'UTC'` and get rewritten the next time the user hits the
   minute-points endpoint. Optionally hold the cron install for ~a
   week so most active users have reported their real timezone before
   the first sweep.

3. **Smoke-test the SQL on prod** before scheduling. Prod postgres
   runs in the `cow-postgres-prod` container — pipe the SQL in over
   stdin instead of needing a `$DATABASE_URL` on the host:
   ```bash
   docker exec -i cow-postgres-prod psql -U cow_user -d cow_db \
     < /home/michael/vocabulary-app/database/cron/expire-stale-streaks.sql
   ```
   Safe to re-run within the same local day (idempotent — second run
   returns `UPDATE 0` for both branches).

4. **Crontab line** on the prod server (unchanged from before):
   ```
   # Hourly inactivity penalty — see docs/STREAK_EXPIRATION_CRON.md
   # Runs at HH:01 so the 4 AM local-day boundary has definitely ticked
   # over for any user whose tz puts their day-rollover on the hour.
   1 * * * * /usr/bin/docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < /home/michael/vocabulary-app/database/cron/expire-stale-streaks.sql >> /home/michael/vocabulary-app/logs/streak-expire.log 2>&1
   ```
   First run `mkdir -p /home/michael/vocabulary-app/logs`.

5. **Verify** `/home/michael/vocabulary-app/logs/streak-expire.log`
   the morning after install — one `BEGIN / DO / COMMIT` block per
   hour, plus a `NOTICE:` line on any tick that actually charged users
   (see "Log format" below).

## First-tick behavior

`lastPenaltyDate` starts NULL for every existing user. The first tick
after deploy charges each currently-inactive user **exactly one
10-minute penalty** (not a per-day backlog) and stamps
`lastPenaltyDate = today_local`. We chose this over backfilling missed
history because only steady-state behavior matters — from the next
local day onward, the cron debits 10 per missed day, indefinitely,
until `totalMinutePoints` reaches 0 and the user falls out of scope.

Preview the first-tick blast radius:

```sql
SELECT COUNT(*) FROM users
WHERE "totalMinutePoints" > 0
  AND "lastMinutePointIncrement" IS NOT NULL
  AND ((((now() AT TIME ZONE timezone) - INTERVAL '4 hours')::date)
       - ((("lastMinutePointIncrement" AT TIME ZONE 'UTC' AT TIME ZONE timezone)
            - INTERVAL '4 hours')::date)) >= 2;
```

## Risks to weigh

- **Users still on default `'UTC'`** are evaluated in UTC until the
  client backfills. Edge cases (e.g. UTC-10 users who haven't opened
  the app since the timezone migration) could see the penalty fire up
  to ~half a day before their real local 4 AM.
- **Total points can hit 0.** Once a user's `totalMinutePoints`
  reaches 0 they fall out of branch B's candidate set. Branch A can
  still fire on the day their streak breaks (since the `GREATEST(0,
  …)` clamp prevents negatives), but no further daily penalties
  accrue.

## Log format

Idle ticks (no users penalized) write only the default psql output:

```
BEGIN
DO
COMMIT
```

When ≥1 user is penalized, one or two `RAISE NOTICE` lines are
emitted *before* the `DO` line — one per branch that fired:

```
NOTICE:  inactivity-cron streak-break 2026-05-25 04:17:02+00 count=1 user_ids={30093a9b-...} missed_dates={2026-05-23}
NOTICE:  inactivity-cron daily-penalty 2026-05-25 04:17:02+00 count=5 user_ids={a36e5ebf-..., ...} penalty_dates={2026-05-25, ...}
```

To find every cleanup event:

```bash
grep '^NOTICE:  inactivity-cron' /home/michael/vocabulary-app/logs/streak-expire.log
```

Arrays in each line are parallel — same index ⇒ same user. The
corresponding `userminutepoints` audit row is keyed by
`(userId, streakDate)` where `streakDate` equals the date in the
array.

## Maintenance

The penalty amount is **hard-coded to 10 minutes** in the SQL for both
branches. Keep it in sync with `STREAK_CONFIG.DAILY_PENALTY_MINUTES`
in `server/constants.ts`.
