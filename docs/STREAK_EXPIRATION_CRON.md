# Inactivity Penalty Cron (prod only)

> **PER-LANGUAGE since migration 130.** Every piece of state below is keyed
> `(userId, language)` in **`user_language_points`**, not on `users`. A user
> studying `zh` and `es` has two independent penalty tracks, and a lapse in both
> debits both on the same tick. Wherever this document says `lastStreakDate`,
> `lastPenaltyDate`, `currentStreak` or `totalMinutePoints`, read
> `user_language_points.<column>` — those four columns were **dropped from
> `users`** by migration 130. `users.timezone` is unchanged: the local-day
> boundary belongs to the person, not the language.
> Design: [PER_LANGUAGE_STREAKS.md](./PER_LANGUAGE_STREAKS.md).

An hourly Postgres cron. It debits minute points from users who fall below the
`RETENTION_MINUTES` (3-min) streak threshold, on an **escalating schedule** that
grows with each consecutive missed local day, and — in the **same transaction** —
decays their Night Market occupants back down to what the lowered minute total now
entitles (`database/cron/expire-stale-streaks.sql`). A **companion job** then prunes
any template that decay left empty and dangling (compiled JS, see Branch 2).

Both are `ExecStart=` steps of **one** systemd user unit, `cow-maintenance.service`,
fired hourly by `cow-maintenance.timer` and installed together by
`database/cron/install-maintenance-timer.sh`. See
[Scheduling](#scheduling-systemd-user-timer-not-cron) — "cron" survives in this
document's title and in the `logs/streak-expire.log` filename only for continuity.

## Branch 1 — Escalating penalty

A user "misses" a day when they do not reach the 3-min threshold that local day.
Missing is tracked purely by `user_language_points.lastStreakDate` — the last local day
the language **on its own** hit the threshold (it is no longer a cross-language sum),
advanced **only** by the minute-points increment path and **never** by this cron. The number of consecutive full missed days is therefore
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

**Per (user, language) since migration 130.** The unit of penalty is a language balance, not a user: each language derives its own tier from its own `lastStreakDate`, so one tick can penalize several of a user's languages independently, and keeping up Chinese no longer shields neglected Spanish.

Each tick, at most once per (user, language) per local day (guarded by that row's `"lastPenaltyDate"`):

- debit the tier penalty from that language's `"totalMinutePoints"`, floored at 0;
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
`"totalMinutePoints"` alone; in the DAL that means `UserLanguagePointsDAL.adjustPoints`, never
`incrementPoints` (which credits both). See
[MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md) § Database.

Because the tier is derived from `lastStreakDate` (which the cron never moves),
the gap grows by exactly one each continued local day, so the penalty climbs
3 → 15 → 30 → … automatically, and **resets to 0 the moment the user hits the
threshold again** (the increment path sets `lastStreakDate = that day`, driving
`tier` back below 1 and out of scope).

**Exemptions.** A (user, language) pair with `totalMinutePoints = 0` (nothing to
debit) or that has never hit the threshold (`lastStreakDate IS NULL` — no
reference day to escalate from) is out of scope. The second condition is what
implements the **"only languages ever studied"** rule: a language enters the
penalty system the first time it reaches 3 minutes, and a language you have never
touched is never penalized. Both conditions are evaluated per language, so a user can be
exempt in one language and penalized in another on the same tick.

> **This cron is the sole authority for streak breaks and INACTIVITY penalties.** No
> application code debits points for inactivity (`UserDAL.applyStreakPenalty` was removed
> as a dead alternate to this SQL). One narrow exception writes `penaltyMinutes` from app
> code: the **template-author dev tool** (`UserMinutePointsService.adjustMinutesForAuthor`
> via the re-introduced `UserMinutePointsDAL.addPenaltyMinutesForDate`) stamps an
> *artificial* penalty when an author clicks the nmp −N button — a deliberate test signal,
> not an inactivity penalty. It also debits that language's `"totalMinutePoints"` (floored, like
> this cron) and reconciles the night market. As of migration 130 it stamps the **actually
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

Because Branch 1 *lowers* `totalMinutePoints`, this branch (same transaction, three
data-modifying CTEs: `decay_targets` → `decay_ranked` → `decay_delete`) trims each
penalized **(user, language)** pair's Night Market **occupants** (`nightmarketunlocks` rows) down to their
new entitlement `target = unlocks(new_total)`:

**The entitlement is PER (user, language) since migration 130.** `nightmarketunlocks` and
`nightmarkettemplatelocations` both carry `language`, so each penalized language decays its **own**
market from its **own** post-debit balance (`final.new_total`) — matching what the application
grant path feeds `grantUnlocks(userId, language, net)`. Decaying Spanish must never delete a
Chinese occupant, which is why every join in the branch carries the language and `decay_ranked`
partitions by `(userId, language)`.

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
It targets exactly the **(user, language) pairs** this SQL just penalized via
`user_language_points.lastPenaltyDate`, pruning each market separately — no `DISTINCT`, because
a market is per (user, language) and each penalized language needs its own pass. A failure on one
pair is caught and logged so it cannot abort the rest of the run. The live
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
  - `user_language_points.lastPenaltyDate`, `.lastStreakDate`, `.currentStreak`,
    `.totalMinutePoints` — migration `130-per-language-streaks.sql` (these moved off `users`,
    which had them from migrations `54`/earlier; the same migration drops the global columns).
    Reads all four; writes `.totalMinutePoints`, `.currentStreak`, `.lastPenaltyDate` — never
    `.lastStreakDate`, which is what makes the tier gap grow by one per continued missed day.
  - `user_language_points."lifetimeMinutesEarned"` — migration `134-add-lifetime-minutes-earned.sql`,
    and a **deliberate non-dependency**: the cron reads and writes it nowhere, and must keep
    doing so, because gross is monotonic.
  - `users.selectedLanguage`
  - `userminutepoints.language` (+ 3-col PK) — migration `62-add-language-to-userminutepoints.sql`
- **Still user-level (not per language)**: `users.timezone` only (the 4 AM boundary is shared by
  all of a user's languages). The night-market decay target became per-language in the same
  migration `130-per-language-streaks.sql`, which added `language` to `nightmarketunlocks` +
  `nightmarkettemplatelocations` and widened their corner/lookup indexes to include it.
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
   `users.timezone` and `user_language_points."lastPenaltyDate"` exist.

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
   the schedule is a **systemd user timer** installed by
   `database/cron/install-maintenance-timer.sh`, which `/deploy` runs on every
   deploy. To install/refresh manually (**no sudo**):
   ```bash
   bash /home/michael/vocabulary-app/database/cron/install-maintenance-timer.sh
   ```
   Idempotent. Runs at `HH:01` so the 4 AM local boundary has ticked over for any
   timezone. Details in [Scheduling](#scheduling-systemd-user-timer-not-cron).

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
FROM user_language_points t
JOIN users u ON u.id = t."userId"
WHERE t."totalMinutePoints" > 0
  AND t."lastStreakDate" IS NOT NULL
  AND (((now() AT TIME ZONE u.timezone) - INTERVAL '4 hours')::date
       - t."lastStreakDate"::date) >= 2
GROUP BY 1, 2 ORDER BY 1, 2;
```

If the high-tier count is nontrivial and you want to avoid retroactive wipes,
seed `"lastPenaltyDate" = today_local` on the affected `user_language_points` rows before the first tick
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

## Scheduling (systemd user timer, not cron)

**Depends on:** `database/cron/install-maintenance-timer.sh`,
`database/cron/cow-maintenance.service.template`,
`database/cron/cow-maintenance.timer.template`, and the `/deploy` skill
(`.claude/commands/deploy.md` Step 3, which runs the installer every deploy).

| Artifact | Path |
|---|---|
| Schedule source of truth (WHEN) | `database/cron/cow-maintenance.timer.template` |
| Job definition (WHAT) | `database/cron/cow-maintenance.service.template` |
| Installer (no sudo) | `database/cron/install-maintenance-timer.sh` |
| Rendered units on prod | `~/.config/systemd/user/cow-maintenance.{service,timer}` |

The installer renders each template, substituting `__REPO_DIR__` with the absolute
repo path, then runs `systemctl --user daemon-reload` and
`systemctl --user enable --now cow-maintenance.timer`.

### Why a user timer replaced `/etc/cron.d` (2026-08-07)

The schedule previously lived in an `/etc/cron.d/cow-maintenance` drop-in. That is
unreachable without root on two counts — the directory is root-owned, *and*
`man 8 cron` requires the files themselves be root-owned and not group/other-writable
— so every deploy needed an interactive sudo password, and in practice the step got
skipped (see `docs/oracle-runs/oracle-run-20260720T1003Z.md`). `~/.config/systemd/user`
is owned by the deploying user, so the install needs no privilege at all.

Two behaviours improved in the move, both worth knowing when reading the logs:

- **Ordering is enforced, not hoped for.** The two jobs were separate cron lines at
  `:01` and `:02`; the prune reads rows the penalty pass writes (it targets
  `lastPenaltyDate = today`), and one minute was merely assumed to be enough. They
  are now two `ExecStart=` lines in one `Type=oneshot` unit, which systemd runs
  strictly in sequence. Consequence: **if the penalty step fails, the prune step does
  not run** and the unit is marked failed — correct, since the prune would have had
  nothing to act on.
- **Overlapping runs are impossible.** A service is a singleton, so a long run cannot
  race the next tick on the `CREATE OR REPLACE FUNCTION` at the top of the SQL.

`Persistent=true` on the timer catches up a run missed to a reboot at next start;
this is safe because the penalty SQL is idempotent within a local day
(`lastPenaltyDate` guard).

### Lingering is required

User units only run while the user is logged in **unless** lingering is enabled. It
is enabled on prod, is a one-time machine setup step rather than a per-deploy one,
and is the single thing here that needs root:

```bash
sudo loginctl enable-linger michael      # one time; verify with: loginctl show-user michael -p Linger
```

The installer warns loudly if it is ever off — that failure is otherwise silent.

### Operator commands

```bash
systemctl --user list-timers cow-maintenance.timer   # when it next fires / last fired
systemctl --user status cow-maintenance.service      # last run's exit status
journalctl --user -u cow-maintenance -n 50           # per-run history systemd keeps
systemctl --user start cow-maintenance.service       # run both steps now (safe; idempotent)
```

The two log files are unchanged (`logs/streak-expire.log`, `logs/prune-templates.log`),
so the verification steps elsewhere in this document still apply. The journal adds
exit status per run, which the log files never recorded.

### ⚠️ Never let two schedulers run this

If the schedule exists in more than one place (the old cron drop-in, a stale user
crontab line, and/or the timer), both fire in the same minute and race on the SQL's
`CREATE OR REPLACE FUNCTION`, producing `ERROR: tuple concurrently updated` followed
by a full `ROLLBACK` — that tick's penalties silently do not apply. This actually
happened: the drop-in and a legacy user-crontab line coexisted for weeks, logging 453
such errors before the 2026-08-07 cleanup. The installer checks both legacy locations
and warns if either is still present.

## Maintenance

The penalty schedule is hard-coded in the SQL (`3, 15, 30, 60, 90, 120`, then
wipe). Keep it in sync with `STREAK_CONFIG.PENALTY_SCHEDULE_MINUTES` in
`server/constants.ts` and its mirror in `src/constants.ts`.
