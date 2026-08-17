# ⚠️ TEMPORARY — Arena deploy runbook (migration 146)

**Delete this file once verified on prod.**
**Deployed to prod yet? NO.** Built and verified on dev 2026-08-16.

Covers migration **146** (`146-create-arenas.sql`) and the Arena feature.
Design: [ARENA_FEATURE.md](./ARENA_FEATURE.md).

---

## Why this needs a runbook

Two reasons, neither visible from the diff:

1. **It has a hard prerequisite that is itself unshipped.** Migration 146 adds
   `division` and `arenaOptInWeek` to **`user_languages`** — a table that does not exist on
   prod yet. It is created by 130 and renamed by 145, both of which are in the batch
   described by [COMBINED_DEPLOY_RUNBOOK.md](./COMBINED_DEPLOY_RUNBOOK.md). **146 must not
   ship before that batch lands**, or it fails on a missing table.
2. **The feature does nothing without its cron, and the cron install is a new step.**
   Formation and resolution are driven by an hourly job — without it every user gets a
   permanently empty arena and a Join button that silently never produces a board. The
   `cow-arena` systemd timer now exists and `/deploy` installs it, but the installer was
   **renamed** (`install-maintenance-timer.sh` → `install-timers.sh`) and must run *after*
   the migration. Details under [The cron](#the-cron).

---

## Order

1. **Ship the combined backlog first** ([COMBINED_DEPLOY_RUNBOOK.md](./COMBINED_DEPLOY_RUNBOOK.md)).
   Verify `user_languages` exists on prod before going further.
2. Deploy this change; `migrate.sh` picks up 146 with no special handling — by then prod's
   highest recorded version is 145 and 146 is above it, so the out-of-order guard does not
   fire. (If for any reason 146 lands in the *same* run as the backlog, it needs the same
   `--allow-out-of-order` flag that batch does.)
3. **Install the timers** — `bash database/cron/install-timers.sh`, *after* the migration.
   Until this is done the feature is inert. Already part of the `/deploy` block.
4. Verify.

## Verification SQL

```sql
-- 1. Tables and the constraint that matters most. Expect: t | t | t
SELECT to_regclass('arenas')        IS NOT NULL AS arenas,
       to_regclass('arena_members') IS NOT NULL AS members,
       EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_arena_member_live') AS live_uq;

-- 2. Columns landed. Expect 3 rows.
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name = 'user_languages' AND column_name IN ('division','arenaOptInWeek'))
   OR (table_name = 'users' AND column_name = 'geoCell');

-- 3. Everyone starts at the bottom rung. Expect a single row: 1 | <all users>
SELECT division, count(*) FROM user_languages GROUP BY division ORDER BY division;

-- 4. No location has been collected yet — it is opt-in and nothing backfills it. Expect 0.
SELECT count(*) AS with_location FROM users WHERE "geoCell" IS NOT NULL;
```

### The one invariant to re-check after every arena resolves

```sql
-- A resolved arena must have NO live members. Expect 0 rows, forever.
-- A non-empty result means the isLive flip was missed and those users are LOCKED OUT
-- of every future arena (docs/ARENA_FEATURE.md § 9, Q21).
SELECT a.id, count(*) AS stuck_live
FROM arenas a JOIN arena_members m ON m."arenaId" = a.id
WHERE a."resolvedAt" IS NOT NULL AND m."isLive"
GROUP BY a.id;
```

**If this ever returns rows**, the fix is safe and immediate — the flip is idempotent:

```sql
UPDATE arena_members m SET "isLive" = false
FROM arenas a WHERE a.id = m."arenaId" AND a."resolvedAt" IS NOT NULL AND m."isLive";
```

## The cron

**Written — installed by the standard deploy step.** It is the `cow-arena` systemd user
timer (hourly at **HH:06**), a sibling of the existing `cow-maintenance` timer:

| Piece | File |
|---|---|
| Entry point | `server/scripts/arena-cron.ts` → `dist/scripts/arena-cron.js` |
| Service unit | `database/cron/cow-arena.service.template` |
| Timer unit | `database/cron/cow-arena.timer.template` |
| Installer | `database/cron/install-timers.sh` (installs **both** timers) |

The installer was renamed from `install-maintenance-timer.sh` in this change and now
installs both schedules. **The `/deploy` block already runs it**, so nothing extra is
needed — but it must run *after* migration 146, or the first arena pass fails on missing
tables (harmlessly: it logs, exits 1, and retries the next hour).

Why HH:06 and not HH:01: `cow-maintenance` fires at HH:01 and updates `user_languages`
row-by-row, and arena formation reads and writes the same table. Five minutes of stagger
keeps them off each other's row locks. Formation runs on a 60-minute lead, so a few
minutes of lateness is invisible.

Why a separate unit rather than a third `ExecStart` on `cow-maintenance`: systemd aborts a
oneshot when a step fails, so appending it would mean a failed inactivity-penalty run
silently prevents arenas from forming — and formation only happens in the hours around the
Tuesday boundary, so a failure in the wrong hour costs a whole week of arenas for everyone.

⚠️ **Do not point the timer at `arena-tick.ts`.** That is the dev trigger and accepts
`--seed-opt-ins`, which opts every user in the database into next week. The prod entry
point is `arena-cron.ts`, which takes no arguments at all.

⚠️ **Do not split this into two scheduled jobs, and do not call `formArenas` before
`resolveDue`.** Resolution releases live seats; formation consumes them. Forming first
makes an outage self-escalating: last week's unresolved arenas hold their members' seats,
the new formation is rejected by `uq_arena_member_live`, and nobody gets an arena.
`ArenaService.tick()` exists precisely so this ordering cannot be got wrong at a call site.

Both halves are idempotent (`arenaExistsForBucket` for formation, `resolvedAt IS NULL` for
resolution), which is what makes `Persistent=true` safe on the timer — a run missed to a
reboot is caught up rather than skipped.

### Verifying the timer after deploy

```bash
systemctl --user list-timers cow-arena.timer --no-pager   # expect NEXT = the coming HH:06
systemctl --user status cow-arena.service --no-pager      # expect inactive (dead), Result: success
tail -n 20 ~/vocabulary-app/logs/arena-cron.log           # expect "arena-cron: done — resolved N, formed M"
```

A manual pass can be forced at any time, and is the fastest way to confirm the wiring:

```bash
systemctl --user start cow-arena.service
# or, straight to the container:
docker exec cow-backend-prod node dist/scripts/arena-cron.js
```

`POST /api/arena/admin/tick` (validator-only) remains available as an HTTP trigger.

## Rollback

Additive and cleanly reversible; no data is transformed.

```sql
DROP TABLE IF EXISTS arena_members;
DROP TABLE IF EXISTS arenas;
ALTER TABLE user_languages DROP COLUMN IF EXISTS division,
                           DROP COLUMN IF EXISTS "arenaOptInWeek";
ALTER TABLE users DROP COLUMN IF EXISTS "geoCell";
DELETE FROM schema_migrations WHERE version = 146;
```

Dropping `users."geoCell"` discards collected locations; users would be re-prompted on
their next join. That is the intended behaviour, not a loss to avoid.

## User-visible changes

- A new **Arena** row on the Home hub, leading to `/arena`.
- On first Join, a **browser location permission prompt**, preceded by our own explanatory
  line. Declining is fully supported — the user joins the location-less pool. This is the
  app's first use of the Geolocation API; expect questions about it.
- Everyone starts in **division 1** and can only be in one arena per language at a time.
