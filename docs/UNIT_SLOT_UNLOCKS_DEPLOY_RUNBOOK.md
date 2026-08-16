# TEMPORARY — Unit-slot unlocks + generated unlock schedule: deploy runbook

> **Delete this file once verified on prod.**
> **Status: NOT YET DEPLOYED.** Written 2026-07-29 alongside the change.

Two coupled changes ship together:

1. **One unlock = one UNIT SLOT.** A placeholder area of 4×10 / 10×4 holds **two** occupant
   footprints; occupants are now keyed to the footprint (unit), not the authored area. Before,
   a single unlock lit up *both* houses at once.
2. **The unlock schedule is single-sourced.** The cron's hard-coded breakpoint `CASE` is gone;
   it now calls a SQL function generated from `server/dal/shared/unlockSchedule.ts`.

## There is NO migration

- **No schema change.** `nightmarketunlocks.placeholderAreaId` still stores a `"col_row"` anchor
  id — the string just now names a unit instead of an area.
- **No data backfill.** The FIRST unit of every area inherits the parent area's anchor, so every
  existing occupant row is already a valid unit id (it reads as "first half filled"). Verified
  against the local dev DB.
- **No new table/column/index.** The existing `UNIQUE (placedTemplateId, placeholderAreaId)` keeps
  doing exactly the right thing at unit granularity.

## Step order

1. **Deploy the code as usual** (`/deploy`). Nothing about the deploy is special for the app.
2. **Redeploy the cron SQL** — `database/cron/expire-stale-streaks.sql` — to wherever prod's copy
   lives, and leave the crontab/pg_cron schedule alone. **This step is now MANDATORY, not
   optional:** the same commit makes the cron per-language (migration 130 dropped the `users`
   columns the old copy reads), so an un-redeployed cron errors every tick. See
   [PER_LANGUAGE_MINUTES_DEPLOY_RUNBOOK.md](./PER_LANGUAGE_MINUTES_DEPLOY_RUNBOOK.md). This file is the *entire* install of the
   new SQL function: it runs `CREATE OR REPLACE FUNCTION nightmarket_unlocks_for_minutes(int)`
   inside its own transaction on **every tick**, then calls it.
   - Order does not matter relative to step 1 (the app never calls the SQL function; the cron
     never calls the app).
   - ⚠️ If step 2 is forgotten, the **old** cron file errors on every tick: it selects
     `users."totalMinutePoints"` / `"currentStreak"` / `"lastStreakDate"` / `"lastPenaltyDate"`,
     which migration 130 dropped. The whole transaction aborts, so **no** inactivity penalty and
     **no** occupant decay is applied until it is replaced — silently, apart from the cron log.
     Check `docker logs` for one clean `inactivity-cron` NOTICE (or a quiet BEGIN/DO/COMMIT) after
     the first tick. This used to be a harmless "finish it later" step; it no longer is.

## Verification SQL

After step 2, wait for one tick (or run the file by hand) and check the function exists and
matches the TS curve:

```sql
SELECT m, nightmarket_unlocks_for_minutes(m) AS unlocks
FROM (VALUES (-5),(0),(1),(2),(3),(4),(5),(26),(59),(60),(61),(120),(600)) v(m);
```

Expected (identical to `unlocksForMinutes` in the TS table):

| m | unlocks |
|---:|---:|
| -5 | 0 |
| 0 | 0 |
| 1 | 1 |
| 2 | 2 |
| 3 | 3 |
| 4 | 3 |
| 5 | 4 |
| 26 | 10 |
| 59 | 16 |
| 60 | 17 |
| 61 | 17 |
| 120 | 18 |
| 600 | 26 |

**If it fails** (`function ... does not exist`): the cron file on prod is still the old copy — redo
step 2. A *wrong* number means the generated block is stale; run `npm run gen:unlock-schedule-sql`
locally, commit, redeploy (the guard test `src/__tests__/unlockScheduleSqlSync.test.ts` should have
caught this before shipping).

Then confirm no market is over-occupied relative to entitlement (should return **0 rows**):

```sql
SELECT n."userId", n.language, count(*) AS occupants,
       nightmarket_unlocks_for_minutes(p."totalMinutePoints") AS entitled
FROM nightmarketunlocks n
JOIN user_languages p
  ON p."userId" = n."userId" AND p.language = n.language
GROUP BY n."userId", n.language, p."totalMinutePoints"
HAVING count(*) > nightmarket_unlocks_for_minutes(p."totalMinutePoints");
```

## User-visible change to expect

**Existing players lose half of some houses.** A learner whose 10×4 slot rendered two houses off
one unlock now sees **one** house there; the second appears when they earn the next unlock. Total
occupant *rows* are unchanged — only the rendering, which was previously double-counting. New
capacity also means the continent grows more slowly (more slots to fill per template before an
unlock has to trigger a spawn), which is the intended economy.

## Rollback

Revert the code commit. No DB state has to be undone:

- The occupant rows are valid under both models (old code reads a first-unit id as the parent
  area's id, because they are the same string).
- The SQL function can be left installed — the reverted cron file simply stops calling it. Drop it
  only if you want the schema clean:
  ```sql
  DROP FUNCTION IF EXISTS nightmarket_unlocks_for_minutes(int);
  ```
