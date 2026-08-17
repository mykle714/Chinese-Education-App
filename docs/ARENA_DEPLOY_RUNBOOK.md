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
2. **The feature does nothing without a cron that has not been written.** Formation and
   resolution are driven by an hourly job. There is a dev trigger
   (`server/scripts/arena-tick.ts`) and an HTTP trigger (`POST /api/arena/admin/tick`), but
   **no prod cron exists yet**. Shipping the code without one gives every user a permanently
   empty arena and a Join button that silently never produces a board.

---

## Order

1. **Ship the combined backlog first** ([COMBINED_DEPLOY_RUNBOOK.md](./COMBINED_DEPLOY_RUNBOOK.md)).
   Verify `user_languages` exists on prod before going further.
2. Deploy this change; `migrate.sh` picks up 146 with no special handling — by then prod's
   highest recorded version is 145 and 146 is above it, so the out-of-order guard does not
   fire. (If for any reason 146 lands in the *same* run as the backlog, it needs the same
   `--allow-out-of-order` flag that batch does.)
3. **Install the cron** (below). Until this is done the feature is inert.
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

**Not yet written.** It must call, hourly:

```
ArenaService.tick()   -- resolve first, then form
```

⚠️ **Do not reimplement this as two separate scheduled jobs, and do not call `formArenas`
before `resolveDue`.** Resolution releases live seats; formation consumes them. Forming
first makes a cron outage self-escalating: last week's unresolved arenas hold their
members' seats, the new formation is rejected by `uq_arena_member_live`, and nobody gets an
arena. `tick()` exists precisely so this ordering cannot be got wrong at the call site.

Follow the pattern in [STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md) — it is the
existing prod-only, local-boundary cron and its idempotency guard is the model here. Both
arena operations are already idempotent (`arenaExistsForBucket` for formation,
`resolvedAt IS NULL` for resolution), so a retry or a double-fire is harmless.

Interim option: prod can be ticked by hand via `POST /api/arena/admin/tick` (validator-only)
until the cron is installed. That is acceptable for a soft launch and unacceptable as a
steady state — a missed Tuesday means no arenas that week.

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
