# Inactivity Penalty Cron (prod only)

An hourly Postgres cron. It debits minute points from users who fall below the
`RETENTION_MINUTES` (3-min) streak threshold, on an **escalating schedule** that
grows with each consecutive missed local day. One transaction, one crontab line
(`database/cron/expire-stale-streaks.sql`).

## Escalating penalty (single branch)

A user "misses" a day when they do not reach the 3-min threshold that local day.
Missing is tracked purely by `users.lastStreakDate` — the last local day the user
hit the threshold, advanced **only** by the minute-points increment path and
**never** by this cron. The number of consecutive full missed days is therefore
derived, not stored:

```
tier = today_local - lastStreakDate - 1     (# of full missed days)
```

| Tier (consecutive missed day) | Penalty (min) | Cumulative |
|---|---|---|
| 1 | 3 | 3 |
| 2 | 15 | 18 |
| 3 | 30 | 48 |
| 4 | 60 | 108 |
| 5 | 90 | 198 |
| 6 | 120 | 318 |
| 7+ | **all remaining → 0** | — |

Each tick, at most once per user per local day (guarded by `users.lastPenaltyDate`):

- debit the tier penalty from `totalMinutePoints`, floored at 0;
- stamp the **actual** amount removed (`total − new_total`) as `penaltyMinutes` on
  the just-completed missed day (`today_local − 1`), so the calendar shows the real
  deduction even when a small balance underflows the nominal tier;
- reset `currentStreak` to 0 (a missed day always breaks the streak);
- set `lastPenaltyDate = today_local` (idempotency — later ticks the same local
  day are no-ops).

Because the tier is derived from `lastStreakDate` (which the cron never moves),
the gap grows by exactly one each continued local day, so the penalty climbs
3 → 15 → 30 → … automatically, and **resets to 0 the moment the user hits the
threshold again** (the increment path sets `lastStreakDate = that day`, driving
`tier` back below 1 and out of scope).

**Exemptions.** Users with `totalMinutePoints = 0` (nothing to debit) and users
who have never hit the threshold (`lastStreakDate IS NULL` — no reference day to
escalate from) are out of scope.

> **This cron is the sole authority for streak breaks and point penalties.** No
> application code writes `penaltyMinutes` or debits points for inactivity — the
> former `UserDAL.applyStreakPenalty` and `UserMinutePointsDAL.addPenaltyMinutesForDate`
> methods were removed once they became dead alternates to this SQL.

> **Removed: weekly achievement reset.** This cron used to have a branch that
> wiped each user's `weeklies` rows at their local week rollover. The `weeklies`
> table is gone — weekly achievements are now derived as a timestamp filter over
> the persistent append-only `wins` log (the most recent **Sunday 04:00** in
> `users.timezone`; see `WinsDAL.getWeeklyCountsByUser` / `getWeeklyWins`,
> migration `78-create-wins-table.sql`). Nothing is wiped, so lifetime win history
> is preserved and no cron branch is needed.

> **Planned branch (DESIGN): Night Market unlock cleanup.** Because the penalty
> *lowers* `totalMinutePoints`, a planned branch will run in the same transaction
> to remove Night Market unlocks at random down to the count the minute total now
> allows, and delete any template left with no occupants (the hub/origin template
> is exempt). No new table — the deduction is already audited via
> `userminutepoints.penaltyMinutes`. See
> [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md#losing-minutes-removes-unlocks).

The cron evaluates each user against the 4 AM local-day boundary using their
stored `users.timezone`.

- **SQL**: `database/cron/expire-stale-streaks.sql` (filename kept for backward
  compatibility with the prod crontab; consider renaming to e.g.
  `hourly-maintenance.sql` next time the crontab is touched).
- **Config source of truth**: `STREAK_CONFIG.PENALTY_SCHEDULE_MINUTES` in
  `server/constants.ts` (mirrored in `src/constants.ts`). The values are
  hard-coded in the SQL — keep all three in sync.
- **Schema dependencies**:
  - `users.timezone` — migration `50-add-user-timezone.sql`
  - `users.lastPenaltyDate` — migration `54-add-user-last-penalty-date.sql`
  - `users.lastStreakDate`, `currentStreak`, `totalMinutePoints`, `selectedLanguage`
  - `userminutepoints.language` (+ 3-col PK) — migration `62-add-language-to-userminutepoints.sql`
- **Refresh path for `users.timezone`**: written by the client on (a) every
  successful login or session restore via `POST /api/auth/on-login`
  (`UserController.onLogin`), and (b) every minute-points increment via
  `UserMinutePointsService`.

**Language attribution (migration 62).** `userminutepoints` is keyed by
`(userId, streakDate, language)`. The penalty is global, so the row is stamped on
the user's `COALESCE("selectedLanguage", 'zh')` with a 3-column
`ON CONFLICT ("userId", "streakDate", "language")`. The penalty shows on the
calendar of whichever language the user had selected when it fired.

## Dev

Not installed. Run manually to test:

```bash
psql "$DATABASE_URL" -f database/cron/expire-stale-streaks.sql
```

## Prod adoption (one-time, after `/deploy`)

1. **Verify migrations applied.** `/deploy` runs them automatically; confirm
   `users.timezone` and `users.lastPenaltyDate` exist.

2. **Let timezones backfill organically.** Existing rows default to `'UTC'` and
   get rewritten the next time the user hits the minute-points endpoint.

3. **Smoke-test the SQL on prod** before scheduling. Prod postgres runs in the
   `cow-postgres-prod` container — pipe the SQL in over stdin:
   ```bash
   docker exec -i cow-postgres-prod psql -U cow_user -d cow_db \
     < /home/michael/vocabulary-app/database/cron/expire-stale-streaks.sql
   ```
   Safe to re-run within the same local day (idempotent — a second run returns
   `UPDATE 0`).

4. **Install the schedule.** Both the SQL logic and the schedule are git-tracked;
   the schedule is installed as a dedicated `/etc/cron.d/cow-maintenance` drop-in
   from `database/cron/install-cron.sh`, which `/deploy` runs on every deploy. To
   install/refresh manually (needs sudo — `/etc/cron.d` is root-owned):
   ```bash
   bash /home/michael/vocabulary-app/database/cron/install-cron.sh
   ```
   Idempotent; cron auto-detects the new file. Runs at `HH:01` so the 4 AM local
   boundary has ticked over for any timezone.

   > **`/etc/cron.d` filenames:** cron ignores any file whose name contains a `.`.
   > Keep the name `cow-maintenance` (letters/hyphens only).

5. **Verify** `/home/michael/vocabulary-app/logs/streak-expire.log` the morning
   after install — one `BEGIN / DO / COMMIT` block per hour, plus a `NOTICE:` line
   on any tick that charged users.

## First-tick behavior

`lastPenaltyDate` starts NULL for every existing user, so the first tick after
deploy charges each currently-eligible user for whatever tier their date gap
implies. Because the tier is **derived from `lastStreakDate`**, a user who has been
inactive for many days lands on their true (possibly high) tier immediately —
there is no gentle ramp for pre-existing inactivity.

In practice this blast radius is small: the previous flat-10/day cron already
drained most long-inactive balances to 0, so few users carry a balance into this
change, and those who do are recently inactive at low tiers. Preview it:

```sql
SELECT
  (((now() AT TIME ZONE timezone) - INTERVAL '4 hours')::date
    - "lastStreakDate"::date - 1) AS tier,
  COUNT(*)
FROM users
WHERE "totalMinutePoints" > 0
  AND "lastStreakDate" IS NOT NULL
  AND (((now() AT TIME ZONE timezone) - INTERVAL '4 hours')::date
       - "lastStreakDate"::date) >= 2
GROUP BY 1 ORDER BY 1;
```

If the high-tier count is nontrivial and you want to avoid retroactive wipes,
seed `lastPenaltyDate = today_local` for the affected users before the first tick
(this only defers, not cancels — they still escalate from the next local day).

## Risks to weigh

- **Users still on default `'UTC'`** are evaluated in UTC until the client
  backfills their timezone; edge cases could see a penalty fire up to ~half a day
  before their real local 4 AM.
- **Balances reach 0 quickly.** Cumulative penalties hit 318 min by tier 6 and
  wipe the remainder at tier 7, so an inactive account zeroes out within a week
  regardless of prior balance. Once at 0 the user falls out of scope.

## Log format

Idle ticks write only `BEGIN / DO / COMMIT`. When ≥1 user is penalized, one
`RAISE NOTICE` line is emitted before the `DO` line:

```
NOTICE:  inactivity-cron escalating-penalty 2026-05-25 04:17:02+00 count=5 user_ids={a36e5ebf-..., ...} missed_dates={2026-05-24, ...}
```

Arrays are parallel — same index ⇒ same user. The corresponding
`userminutepoints` audit row is keyed by `(userId, streakDate)` where `streakDate`
equals the `missed_dates` entry (always the prior local day).

```bash
grep '^NOTICE:  inactivity-cron' /home/michael/vocabulary-app/logs/streak-expire.log
```

## Maintenance

The penalty schedule is hard-coded in the SQL (`3, 15, 30, 60, 90, 120`, then
wipe). Keep it in sync with `STREAK_CONFIG.PENALTY_SCHEDULE_MINUTES` in
`server/constants.ts` and its mirror in `src/constants.ts`.
