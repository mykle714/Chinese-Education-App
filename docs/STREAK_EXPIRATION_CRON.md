# Inactivity Penalty Cron (prod only)

An hourly Postgres cron. It debits minute points from users who fall below the
`RETENTION_MINUTES` (3-min) streak threshold, on an **escalating schedule** that
grows with each consecutive missed local day, and — in the **same transaction** —
decays their Night Market occupants back down to what the lowered minute total now
entitles (`database/cron/expire-stale-streaks.sql`). A **companion job** one minute
later then prunes any template that decay left empty and dangling (compiled JS, see
Branch 2). Two crontab lines, installed together by `database/cron/install-cron.sh`.

## Branch 1 — Escalating penalty

A user "misses" a day when they do not reach the 3-min threshold that local day.
Missing is tracked purely by that language's `"lastStreakDate"` in
`user_language_minute_totals` — the last local day the language **on its own** hit the
threshold, advanced **only** by the minute-points increment path and **never** by this cron. The number of consecutive full missed days is therefore
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

**Per (user, language) since migration 134.** The unit of penalty is a language balance, not a user: each language derives its own tier from its own `lastStreakDate`, so one tick can penalize several of a user's languages independently, and keeping up Chinese no longer shields neglected Spanish.

Each tick, at most once per (user, language) per local day (guarded by that row's `"lastPenaltyDate"`):

- debit the tier penalty from that language's `"netMinutePoints"`, floored at 0;
- stamp the **actual** amount removed (`total − new_total`) as `penaltyMinutes` on
  the just-completed missed day (`today_local − 1`), so the calendar shows the real
  deduction even when a small balance underflows the nominal tier;
- reset that language's `"currentStreak"` to 0 (a missed day always breaks it);
- set `lastPenaltyDate = today_local` (idempotency — later ticks the same local
  day are no-ops).

**The cron must never touch `"lifetimeMinutesEarned"`** (the GROSS counter, per-language as of
migration 134). Gross is monotonic by definition — it records what the user *earned*, which a
penalty does not undo — so a penalty moves the NET counter only, and the two numbers diverge by
exactly the total penalized amount. If you add a new debit path here or anywhere else, debit
`"netMinutePoints"` alone; in the DAL that means `UserLanguageTotalsDAL.adjustNetMinutes`, never
`creditEarnedMinutes` (which credits both). See
[MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md) § Database.

Because the tier is derived from `lastStreakDate` (which the cron never moves),
the gap grows by exactly one each continued local day, so the penalty climbs
3 → 15 → 30 → … automatically, and **resets to 0 the moment the user hits the
threshold again** (the increment path sets `lastStreakDate = that day`, driving
`tier` back below 1 and out of scope).

**Exemptions.** Language rows with `"netMinutePoints" = 0` (nothing to debit) and rows for a
language that has never hit the threshold (`"lastStreakDate" IS NULL` — no reference day to
escalate from) are out of scope. Both are evaluated per language, so a user can be exempt in
one language and penalized in another on the same tick.

> **This cron is the sole authority for streak breaks and INACTIVITY penalties.** No
> application code debits points for inactivity (`UserDAL.applyStreakPenalty` was removed
> as a dead alternate to this SQL). One narrow exception writes `penaltyMinutes` from app
> code: the **template-author dev tool** (`UserMinutePointsService.adjustMinutesForAuthor`
> via the re-introduced `UserMinutePointsDAL.addPenaltyMinutesForDate`) stamps an
> *artificial* penalty when an author clicks the nmp −N button — a deliberate test signal,
> not an inactivity penalty. It also debits that language's `"netMinutePoints"` (floored, like
> this cron) and reconciles the night market. As of migration 134 it stamps the **actually
> removed** amount rather than the requested one, matching this cron — the old behaviour is why
> historical ledger data can reconstruct to a negative balance. See docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md.

> **Removed: weekly achievement reset.** This cron used to have a branch that
> wiped each user's `weeklies` rows at their local week rollover. The `weeklies`
> table is gone — weekly achievements are now derived as a timestamp filter over
> the persistent append-only `wins` log (the most recent **Sunday 04:00** in
> `users.timezone`; see `WinsDAL.getWeeklyCountsByUser` / `getWeeklyWins`,
> migration `78-create-wins-table.sql`). Nothing is wiped, so lifetime win history
> is preserved and no cron branch is needed.

## Branch 2 — Night Market occupant decay

Because Branch 1 *lowers* `"netMinutePoints"`, this branch (same transaction, four
data-modifying CTEs: `user_new_totals` → `decay_targets` → `decay_ranked` → `decay_delete`)
trims each penalized user's Night Market **occupants** (`nightmarketunlocks` rows) down to
their new entitlement `target = unlocks(new GLOBAL total)`.

**The entitlement is PER (user, language) since migration 136.** `nightmarketunlocks` and
`nightmarkettemplatelocations` both carry `language`, so each penalized language decays its **own**
market from its **own** post-debit balance (`final.new_total`) — matching what the application
grant path feeds `grantUnlocks(userId, language, net)`. Decaying Spanish must never delete a
Chinese occupant, which is why every join in the branch carries the language.

1. `decay_targets` computes each penalized language's `target` by calling the SQL function
   **`nightmarket_unlocks_for_minutes(new_total)`**. The cron restates **no breakpoints of its
   own**: that function's body is *generated* from the single source
   `server/dal/shared/unlockSchedule.ts` into a marked `-- >>> BEGIN GENERATED …` block near the
   top of the cron file (renderer `server/dal/shared/unlockScheduleSql.ts`, writer
   `npm run gen:unlock-schedule-sql`), and the file `CREATE OR REPLACE`s it every tick — so
   **redeploying this cron file is the whole install; there is no migration.** Change a
   breakpoint → edit the TS table, regenerate, redeploy this file.
   `src/__tests__/unlockScheduleSqlSync.test.ts` fails the build while the block is stale.
2. `decay_ranked` ranks each user's occupants in **random** order (`row_number() …
   ORDER BY random()`).
3. `decay_delete` deletes the surplus (`rn > target`).

This SQL branch deletes **only occupants**; an emptied template renders its unoccupied
version on the next layout read (recompute-on-read settles each placement's active version),
so the branch stays **pure SQL** and never computes a version. Freed slots return to the pool
and a later grant (`NightMarketPlacementService.grantUnlocks`) backfills them before spawning
anything new. No new table — the minute deduction is already audited via
`userminutepoints.penaltyMinutes`. The NOTICE line adds `decayed_unlocks=<n>`.

**Template pruning (companion job, not this SQL).** Emptied templates are no longer kept
forever. A second cron job — `:02`, one minute after this SQL — removes any template that
decay left **empty AND weakly attached** (0 occupants; touched on {0, 1, or 2 *adjacent*}
sides; never the starter hub; never a 2-*opposite*-side bridge), iterated to a fixpoint.
That is an iterative rectangle-adjacency computation that is impractical in plpgsql, so it
lives in TypeScript (`NightMarketPlacementService.pruneDanglingTemplates`, pure core in
`server/dal/shared/templatePrune.ts`) and runs as **compiled JS inside `cow-backend-prod`**
(`node dist/scripts/night-market/prune-dangling-templates.js`; the prod image has no tsx).
It targets exactly the users this SQL just penalized, via `user_language_minute_totals."lastPenaltyDate"` (per-language since migration 134), `DISTINCT`-ed back to one prune pass per user because pruning is a whole-market operation. The live
author minute-loss tool reaches the same prune through
`NightMarketPlacementService.reconcileUnlocks`. This **reverses** the former "placements are
append-only, never removed" invariant. See
[NIGHT_MARKET_TEMPLATES.md § Losing minutes removes unlocks](./NIGHT_MARKET_TEMPLATES.md#losing-minutes-removes-unlocks)
and [NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md](./NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md).

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
  - `user_language_minute_totals."lastPenaltyDate"` — migration `134-…`; superseded the global
    `users.lastPenaltyDate` from migration `54-add-user-last-penalty-date.sql`, dropped by `135-…`
  - `user_language_minute_totals` — migration `134-create-user-language-minute-totals.sql`:
    reads `"netMinutePoints"`, `"lastStreakDate"`, `"lastPenaltyDate"`; writes the first plus
    `"currentStreak"`/`"lastPenaltyDate"`. The global equivalents on `users` were dropped by
    migration `135-drop-global-minute-counters.sql`.
  - `user_language_minute_totals."lifetimeMinutesEarned"` — a **deliberate non-dependency**: the
    cron reads and writes it nowhere, and must keep doing so.
  - `userminutepoints.language` (+ 3-col PK) — migration `62-add-language-to-userminutepoints.sql`
- **Still user-level (not per language)**: `users.timezone` only (the 4 AM boundary is shared by
  all of a user's languages). The night-market decay target became per-language with migration
  `136-add-language-to-night-market.sql`, which added `language` to `nightmarketunlocks` +
  `nightmarkettemplatelocations`.
- **Refresh path for `users.timezone`**: written by the client on (a) every
  successful login or session restore via `POST /api/auth/onLogin`
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
   `users.timezone` and `user_language_minute_totals."lastPenaltyDate"` exist.

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

`"lastPenaltyDate"` is seeded by migration 134 from each user's old global
`users.lastPenaltyDate`, so migration day cannot double-charge someone the old cron
already hit. After that guard lapses, the first tick charges each currently-eligible
**language** for whatever tier its own date gap implies. Because the tier is **derived from `lastStreakDate`**, a user who has been
inactive for many days lands on their true (possibly high) tier immediately —
there is no gentle ramp for pre-existing inactivity.

In practice this blast radius is small: the previous flat-10/day cron already
drained most long-inactive balances to 0, so few users carry a balance into this
change, and those who do are recently inactive at low tiers. Preview it:

```sql
-- Per (user, language) since migration 134: one candidate per language balance.
SELECT
  t.language,
  (((now() AT TIME ZONE u.timezone) - INTERVAL '4 hours')::date
    - t."lastStreakDate"::date - 1) AS tier,
  COUNT(*)
FROM user_language_minute_totals t
JOIN users u ON u.id = t."userId"
WHERE t."netMinutePoints" > 0
  AND t."lastStreakDate" IS NOT NULL
  AND (((now() AT TIME ZONE u.timezone) - INTERVAL '4 hours')::date
       - t."lastStreakDate"::date) >= 2
GROUP BY 1, 2 ORDER BY 1, 2;
```

If the high-tier count is nontrivial and you want to avoid retroactive wipes,
seed `"lastPenaltyDate" = today_local` on the affected `user_language_minute_totals` rows before the first tick
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
