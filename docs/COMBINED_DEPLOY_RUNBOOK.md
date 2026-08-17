# ⚠️ TEMPORARY — Combined deploy runbook (the 2026-08-16 Arena drop)

**Delete this file once verified on prod.**
**Deployed to prod yet? YES — 2026-08-16, migrations 145 + 146 applied and verified.**
All § Verification queries passed; both timers armed. This file is now retained only as
the record of *why* the previous version's two hazards were retracted — it is safe to
delete along with the four runbooks listed under § Runbook cleanup.

> **Rewritten 2026-08-16 against prod's real state.** The previous version of this file
> was authored on the assumption that a five-migration backlog (130, 132, 133, 134, 140)
> was still unshipped. **It is not** — it went out in the 2026-08-08 and 2026-08-11
> deploys. Both hazards that version was built around are therefore **void**, and acting
> on them would have been actively harmful (see § Retracted). What remains is a two-file
> migration and one new systemd timer.

| Ships | Migrations |
|---|---|
| `user_language_points` → `user_languages` rename | **145** |
| [ARENA_DEPLOY_RUNBOOK.md](./ARENA_DEPLOY_RUNBOOK.md) — Arena weekly leaderboard | **146** |

Everything else previously listed here (per-language minutes, provisional cards,
unit-slot unlocks) is **already on prod**. Their runbooks are stale in the same way; see
§ Runbook cleanup.

---

## Prod's actual state (measured 2026-08-16, keep this evidence)

```
==> 137 migration(s) already recorded (highest: 144)
    PENDING: 145-rename-user-language-points-to-user-languages.sql
    PENDING: 146-create-arenas.sql
==> 2 migration(s) pending.
```

`schema_migrations` contains 130, 132, 133, 134, 140 — applied 2026-07-30 and 2026-08-08.
Confirmed independently against the schema:

| Check | Result | Means |
|---|---|---|
| `to_regclass('user_language_points')` | **not null** | 130 ran; the table 145 renames exists |
| `to_regclass('user_languages')` | null | 145 has not run |
| `users."totalMinutePoints"` exists | **false** | 130 ran; global columns already dropped |
| `chk_zh_starter_pack_bucket` | **includes `'provisional'`** | 140 ran |
| `nightmarket_unlocks_for_minutes(int)` | **exists** | unit-slot cron SQL already deployed |

Both pending versions are **above** prod's highest recorded version (144), so the
out-of-order guard does not fire and `migrate.sh` needs **no flags at all**.

## Retracted: the two "problems" the previous version warned about

**Do not reintroduce either.** Both were real for the state the file assumed and are
wrong for the state prod is in.

* **~~Problem 1 — `migrate.sh` halts, pass `--allow-out-of-order`~~.** Void. Nothing is
  pending below 144. The dry-run above completes cleanly. Passing
  `--allow-out-of-order` here would be a no-op, but it is still wrong to paste blindly:
  it exists to suppress a safety guard, and the guard is what would tell you prod is not
  where you think it is. **Never `--baseline`** — it records migrations as applied
  *without running them*.
* **~~Problem 2 — the runbooks give opposite step orders~~.** Void as argued. Both
  drivers (140's CHECK, 130's column drop) are already on prod.

**DB-first is still the order used below**, for a different and simpler reason stated in
its own right: **145 is a rename**, so it breaks old code (reads `user_language_points`)
and new code (reads `user_languages`) in *opposite* directions. There is no ordering that
avoids a window; stopping the app containers across the migration makes that window
deliberate and short rather than served as errors.

---

## ⚠️ Live hazard: pulling breaks the hourly cron until 145 lands

`cow-maintenance.service` runs `database/cron/expire-stale-streaks.sql` **straight from
the working tree**:

```
ExecStart=... psql -U cow_user -d cow_db < /home/michael/vocabulary-app/database/cron/expire-stale-streaks.sql
```

That file was updated to say `user_languages` in the same commit as migration 145. So the
moment you `git pull`, **every hourly tick fails** with `relation "user_languages" does
not exist` until the migration runs. This is already observable in
`logs/streak-expire.log`.

**Severity: low, but do not leave it sitting.** The penalty logic keys off each balance's
`lastStreakDate` versus the local day, not off "did the previous hour run", so a skipped
tick is caught up by the next successful one — no penalty is permanently lost. It does
mean inactivity penalties and night-market occupant decay are **paused** between the pull
and step 4.

Consequence for sequencing: **pull and migrate in the same session.** Do not pull, walk
away, and migrate tomorrow.

---

## Step order (authoritative)

1. **Pre-deploy dump.**
   ```bash
   docker exec cow-postgres-prod pg_dump -U cow_user -d cow_db --format=custom \
     > ~/db-backups/prod-predeploy-$(date +%Y%m%d)-arena.dump
   ```
   145 is a rename and 146 is additive, so both are cleanly reversible — but 145's
   rollback also has to undo the index/constraint renames, so take the dump.

2. **Verify the build before stopping anything.** `npm run build`. A failure discovered
   after the containers are down turns a 2-minute window into however long the fix takes.

3. **Stop the app containers, leaving the DB up.**
   ```bash
   docker stop cow-frontend-prod cow-backend-prod
   ```

4. **Dry-run, read the list, then apply.** Expect **exactly two** files, 145 then 146 —
   146 adds columns to `user_languages`, which does not exist until 145 renames it.
   `sort -V` guarantees the order; read it rather than assuming. Anything other than
   these two means prod is not where this runbook says: **stop and re-derive.**
   ```bash
   export PGPASSWORD=$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
   ./database/deploy/migrate.sh --dry-run 127.0.0.1 5432 cow_db cow_user
   ./database/deploy/migrate.sh           127.0.0.1 5432 cow_db cow_user
   ```
   Each file runs in its own transaction with its `schema_migrations` row, so a failure
   leaves that migration neither applied nor recorded.

5. **Verify the schema before any code starts** — § Verification, queries 1–2.

6. **Rebuild and start.** ⚠️ Never with `-v`.
   ```bash
   docker-compose -f docker-compose.prod.yml up --build -d
   ```

7. **Install the systemd timers.**
   ```bash
   bash database/cron/install-timers.sh
   ```
   **No sudo** — these are systemd *user* units. Two things make this the step most
   likely to be skipped:
   - The script was **renamed** from `install-maintenance-timer.sh`. Any older pasted
     deploy block fails with "No such file" — loud, but only if you read the output.
   - It now installs **two** timers: the existing `cow-maintenance` (HH:01) and the new
     `cow-arena` (HH:06). Idempotent; safe to re-run.

   It must run **after** step 4 (or the first arena pass fails on missing tables —
   harmless, it logs and retries) and **after** step 6 (`cow-arena` executes
   `dist/scripts/arena-cron.js` inside the rebuilt backend image). Without it **Arena
   ships inert**: every user sees a Join button that never produces a board.

   The cron SQL itself needs no separate redeploy step — the unit reads it from the
   working tree, so the `git pull` already updated it. Step 4 is what makes it run again.

8. **Post-deploy verification** — § Verification, and [ARENA_DEPLOY_RUNBOOK.md](./ARENA_DEPLOY_RUNBOOK.md).

---

## Verification

```sql
-- 1. The rename landed, in both directions. Expect: <not null> | <null>
SELECT to_regclass('user_languages')       AS should_exist,
       to_regclass('user_language_points') AS should_be_null;

-- 2. No stale index/constraint names survived the rename. Expect 0 rows.
SELECT indexname FROM pg_indexes WHERE indexname LIKE '%language_points%';

-- 3. Arena tables + the constraint that matters most. Expect: t | t | t
SELECT to_regclass('arenas')        IS NOT NULL AS arenas,
       to_regclass('arena_members') IS NOT NULL AS members,
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_arena_member_live') AS live_uq;

-- 4. Arena columns landed. Expect 3 rows.
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name = 'user_languages' AND column_name IN ('division','arenaOptInWeek'))
   OR (table_name = 'users' AND column_name = 'geoCell');

-- 5. Everyone starts at the bottom rung. Expect one row: 1 | <all rows>
SELECT division, count(*) FROM user_languages GROUP BY division ORDER BY division;

-- 6. Nothing backfills location; it is opt-in. Expect 0.
SELECT count(*) AS with_location FROM users WHERE "geoCell" IS NOT NULL;
```

```bash
# 7. Both timers armed.
systemctl --user list-timers cow-maintenance.timer cow-arena.timer --no-pager

# 8. The cron is healthy again — no more "relation ... does not exist".
tail -n 20 logs/streak-expire.log

# 9. A forced arena pass wires end to end.
systemctl --user start cow-arena.service
tail -n 20 logs/arena-cron.log      # expect "arena-cron: done — resolved N, formed M"
```

### The one invariant to re-check after every arena resolves

```sql
-- A resolved arena must have NO live members. Expect 0 rows, forever.
-- Rows here mean the isLive flip was missed and those users are LOCKED OUT of every
-- future arena (docs/ARENA_FEATURE.md § 9, Q21).
SELECT a.id, count(*) AS stuck_live
FROM arenas a JOIN arena_members m ON m."arenaId" = a.id
WHERE a."resolvedAt" IS NOT NULL AND m."isLive"
GROUP BY a.id;
```

The fix is idempotent and safe to run at any time:

```sql
UPDATE arena_members m SET "isLive" = false
FROM arenas a WHERE a.id = m."arenaId" AND a."resolvedAt" IS NOT NULL AND m."isLive";
```

## Rollback

Both migrations are cleanly reversible and no data is transformed. Prefer fixing forward.

```sql
-- 146
DROP TABLE IF EXISTS arena_members;
DROP TABLE IF EXISTS arenas;
ALTER TABLE user_languages DROP COLUMN IF EXISTS division,
                           DROP COLUMN IF EXISTS "arenaOptInWeek";
ALTER TABLE users DROP COLUMN IF EXISTS "geoCell";
DELETE FROM schema_migrations WHERE version = 146;

-- 145 — see the migration file for the index/constraint names to rename back.
DELETE FROM schema_migrations WHERE version = 145;
```

⚠️ Rolling back 145 without also reverting the checkout re-breaks the cron, which reads
`user_languages` from the working tree.

## Expected user-visible changes

- A new **Arena** row on the Home hub, leading to `/arena`.
- On first Join, a **browser location permission prompt**, preceded by our own
  explanatory line. Declining is fully supported — the user joins the location-less pool.
  This is the app's first use of the Geolocation API; expect questions about it.
- Everyone starts in **division 1**, one arena per language at a time.
- The rename is invisible to users.

---

## Runbook cleanup

Once prod is verified, delete this file **and** the three now-shipped runbooks, and drop
their "Current open runbooks" entries from [CLAUDE.md](../CLAUDE.md):

| File | Status |
|---|---|
| `COMBINED_DEPLOY_RUNBOOK.md` (this file) | delete after verification |
| `ARENA_DEPLOY_RUNBOOK.md` | delete after verification |
| `PROVISIONAL_CARDS_DEPLOY_RUNBOOK.md` | **already shipped** (140, 2026-08-08) — safe to delete now |
| `UNIT_SLOT_UNLOCKS_DEPLOY_RUNBOOK.md` | **already shipped** (function present on prod) — safe to delete now |
| `PER_LANGUAGE_MINUTES_DEPLOY_RUNBOOK.md` | 130/134 shipped; **145 is in this deploy** — delete with this file |

**Also outstanding, unrelated to this deploy:** `compute_utcm_category(jsonb, boolean,
boolean)` is dead but deliberately not dropped (143 retained it for its deploy window).
It still needs a contract migration.
