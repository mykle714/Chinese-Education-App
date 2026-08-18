# Study Challenge — week-counter migration (150) · TEMPORARY RUNBOOK

> **TEMPORARY.** Delete this file once migration 150 is verified on prod.
> **Status: NOT YET DEPLOYED.** Prod is current through migration **149**.
> Derive the real pending set from `schema_migrations` + `migrate.sh --dry-run`;
> this line is a claim, not evidence (CLAUDE.md § "A runbook's own status line is
> not evidence").

Superseded [STUDY_CHALLENGE_DEPLOY_RUNBOOK.md], which covered migration 148 and was
retired on 2026-08-17 when 147/148/149 shipped. This one covers the single follow-up
migration.

## 1. Why this needs a runbook

`database/migrations/150-study-challenge-week-index.sql` **renames a column and
changes its type**: `study_challenges."weekStart"` (timestamptz) becomes
`"weekIndex"` (integer — whole weeks since Monday 2026-01-05 00:00 UTC), and
`study_challenges_pair_week_uniq` is rebuilt on the new column.

A rename has no window in which both code versions work:

| | old schema | new schema |
|---|---|---|
| **old code** (reads `weekStart`) | ✅ | ❌ every challenge read 500s |
| **new code** (reads `weekIndex`) | ❌ every challenge read 500s | ✅ |

The standard `/deploy` order — `up --build` and *then* migrate — therefore leaves a
few seconds of new-code-on-old-schema. **Apply 150 before rebuilding the containers.**

**Why it is low risk anyway:** the feature has never been played on prod, so
`study_challenges` is empty there — the backfill converts nothing and the only
observable failure window would be a request to a page nobody can reach yet.

**The bug it fixes** (docs/STUDY_CHALLENGE.md Q77): `weekStart` stored the
*challenger's* local Monday 04:00 as a UTC instant, so the same calendar week had a
different value in every timezone and the pair-week unique index never fired for a
pair in two zones — Alice and Bob challenging each other at the same moment produced
two live challenges for one pair, two generated decks, two cap slots, and a crown
that could change hands twice. The integer counter is identical for every observer.
Deadlines are unaffected and stay per-player local; only "which week is this" went
global. The epoch is duplicated in three places — the migration, the cron SQL, and
`CHALLENGE_WEEK_EPOCH_UTC` in `server/shared/challengeWeek.ts`.

## 2. Step order

```bash
cd ~/vocabulary-app
git pull origin main

# 1. MIGRATION FIRST — before the rebuild (see the table above).
cd database/deploy && ./migrate.sh --dry-run    # expect: 150 only
./migrate.sh
cd ~/vocabulary-app

# 2. Then the containers.
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up --build -d

# 3. Timers (idempotent, no sudo — safe to run every deploy).
bash database/cron/install-timers.sh
```

## 3. Verification SQL

```sql
-- a. The column swapped. Expect EXACTLY ONE row: weekIndex | integer
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'study_challenges' AND column_name IN ('weekStart', 'weekIndex');

-- b. The pair-week rule keys on the counter. Expect "weekIndex" as the third key,
--    and the index NOT partial (expired/no_contest rows must hold their slot too).
SELECT indexdef FROM pg_indexes WHERE indexname = 'study_challenges_pair_week_uniq';

-- c. Tracking row recorded.
SELECT version, name FROM schema_migrations WHERE version = 150;
```

Then re-run the maintenance SQL by hand once — it reads the new column, so it is the
cheapest end-to-end check that schema and code agree:

```bash
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 \
  < database/cron/expire-study-challenges.sql
```
Expect `BEGIN / DO / COMMIT` and no NOTICE lines on a prod with no challenges.

## 4. When a check fails

| Symptom | What it means / what to do |
|---|---|
| `migrate.sh --dry-run` lists more than 150 | Prod is behind where this runbook assumes. Stop and reconcile against `schema_migrations` before applying anything |
| (a) returns `weekStart` | 150 did not run. Apply it, then restart the backend |
| Challenge reads 500 with `column "weekIndex" does not exist` | Same cause — the rebuild beat the migration. Apply 150 and restart; no data is at risk |
| 150 fails on the unique index | The table already holds two challenges for one pair in one week — the exact bug it prevents, and impossible on a prod that has never run the feature. The migration's own comment carries the `SELECT` that finds them; delete the later row of each colliding pair |
| Index in (b) is partial | Re-run 150's `DROP INDEX` + `CREATE UNIQUE INDEX` block by hand; both are idempotent |

## 5. Rollback

The code is revertible; the migration is not worth reverting. Rolling back to the
previous image against the new schema breaks challenge reads exactly as the table in
§1 shows, so a code rollback must be paired with restoring `weekStart` — which no
one should do for an empty table. Roll **forward** instead.

## 6. User-visible change to expect

None on prod. The feature is not reachable yet (the scored round runner is still
unbuilt — docs/STUDY_CHALLENGE.md). The only behavioural change, once it is live, is
that the **issue** window rolls at Monday 00:00 UTC rather than each player's local
Monday 04:00 (up to 4h late in Shanghai, 11h early in Los Angeles). Deadlines stay
per-player local.
