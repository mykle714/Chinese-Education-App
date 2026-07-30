# Deploy Runbook — Per-Language Minute Points & Night Market (migrations 130, 134)

**TEMPORARY.** Delete this file once the change is live on prod and verified. It exists
only because this deploy has notes the standard `/deploy` flow does not cover.

**Status:** merged and verified on DEV. **Not yet deployed to prod.**

> **History.** An earlier version of this runbook described an expand/contract pair
> (migrations 133/134/135) whose DROP had to be held back. That implementation was
> **superseded** — `130-per-language-streaks.sql` from `origin/main` won the reconciliation and
> does the whole move in ONE transaction, so **there is nothing to hold back any more.** If you
> are looking for the `mv database/migrations/135-… /tmp/` step, it is gone on purpose.

---

## What ships

| Migration | Role | Notes |
|---|---|---|
| `130-per-language-streaks.sql` | creates `user_language_points`, backfills it, adds `language` to the two night-market tables, **then drops 4 `users` columns** — all in one transaction | Has an internal `DO $$` verification block that `RAISE EXCEPTION`s (aborting the whole transaction) if the wallet is not conserved or a ledger language has no progress row. A failure leaves the DB **untouched**. |
| `132-split-parts-of-speech-validation-field.sql` | unrelated (validation fields) | additive |
| `133-add-breakdown-elaboration-to-zh.sql` | unrelated (zh breakdown elaboration) | additive |
| `134-add-lifetime-minutes-earned.sql` | adds the monotonic gross counter to `user_language_points` | **Must run after 130** (it needs the table). `migrate.sh` orders by version, so this is automatic. |

All four are safe for `migrate.sh` to auto-apply in one pass. No manual `psql -f`, no
`INSERT INTO schema_migrations` by hand.

## ⚠️ The one nonstandard thing: a brief 5xx window either way

Migration 130 both **creates** what the new code reads and **drops** what the old code reads,
in a single transaction. On a single-box deploy that makes a short window unavoidable:

| Order | Window | Symptom |
|---|---|---|
| Rebuild containers first, then migrate (**what `/deploy` does**) | between container start and migration 130 | new code queries `user_language_points`, which does not exist yet → minute-points + night-market endpoints 500 |
| Migrate first, then rebuild | between migration 130 and container restart | old code selects `users."totalMinutePoints"` → same endpoints 500 |

Either way it is **seconds**, and only the minute-points/night-market endpoints are affected
(auth, dictionary, flashcards are untouched). **Recommendation: keep the standard `/deploy`
order** and accept the first window — a failed read is strictly better than the old code
writing to columns that are about to vanish. Decide deliberately; do not discover it in the
logs.

## Step order

1. Run the normal `/deploy` skill, unmodified. `migrate.sh` applies 130, 132, 133, 134 in order.
2. **Redeploy the cron SQL** — see
   [UNIT_SLOT_UNLOCKS_DEPLOY_RUNBOOK.md](./UNIT_SLOT_UNLOCKS_DEPLOY_RUNBOOK.md), which ships in
   the same commit and covers it. `database/cron/expire-stale-streaks.sql` is now per-language
   AND installs the generated `nightmarket_unlocks_for_minutes()` function; the old copy on prod
   reads dropped `users` columns and **will error every tick until replaced.** Do not skip this.
3. Verify (below).

## Verification SQL

Migration 130 self-verifies internally, so these are belt-and-braces. Run after step 1:

```sql
-- 1. Every language that has ever earned a minute has a progress row. Expect 0.
SELECT count(*) AS missing_rows
FROM (SELECT DISTINCT "userId", language FROM userminutepoints) m
LEFT JOIN user_language_points p
  ON p."userId" = m."userId" AND p.language = m.language
WHERE p."userId" IS NULL;

-- 2. Per user, gross >= net. Expect 0. (Per ROW it can legitimately fail right after
--    backfill — 130 puts the whole old wallet on the primary language while gross is
--    genuinely per-language. See the invariant note in migration 134.)
SELECT count(*) AS bad_users FROM (
  SELECT "userId" FROM user_language_points
  GROUP BY "userId"
  HAVING SUM("lifetimeMinutesEarned") < SUM("totalMinutePoints")
) x;

-- 3. Gross matches the ledger per language. Expect 0.
SELECT count(*) AS gross_mismatches
FROM user_language_points p
JOIN (SELECT "userId", language, SUM("minutesEarned") g
      FROM userminutepoints GROUP BY 1,2) l
  ON l."userId" = p."userId" AND l.language = p.language
WHERE p."lifetimeMinutesEarned" <> l.g;

-- 4. The global columns are gone. Expect 0.
SELECT count(*) AS stale_columns
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('totalMinutePoints','currentStreak','lastStreakDate','lastPenaltyDate');

-- 5. Both night-market tables carry a NOT NULL language. Expect 2 rows, both is_nullable = NO.
SELECT table_name, is_nullable
FROM information_schema.columns
WHERE table_name IN ('nightmarketunlocks','nightmarkettemplatelocations')
  AND column_name = 'language';
```

**All of 1–4 must return 0.** If #1 or #3 is non-zero the backfill is wrong: the ledger
(`userminutepoints`) is untouched by this migration and remains the source of truth, so the
fix is to re-derive `user_language_points` from it — not to roll back the code.

Then smoke-test the API with a real user token:

```
GET /api/users/minutePoints/summary?language=zh&tz=…&timestamp=…
GET /api/users/minutePoints/summary?language=es&tz=…&timestamp=…
```

Both must return `{ totalMinutePoints, lifetimeMinutesEarned, todayMinutes, currentStreak }`
with **different** values per language (a never-studied language correctly returns all zeros).
Also load `/night-market` and confirm the market renders, then switch language and confirm a
**different** market loads.

## Rollback

Migration 130 is **not reversible by re-running anything** — it drops columns. To roll back:

1. Redeploy the previous image (code only).
2. The old code will 500 on minute-points/night-market endpoints, because the columns it reads
   are gone. So a code-only rollback is **not sufficient** — you must also restore `users`'
   four columns and re-derive them from `user_language_points`:
   ```sql
   ALTER TABLE users
     ADD COLUMN "totalMinutePoints" integer DEFAULT 0,
     ADD COLUMN "currentStreak"     integer NOT NULL DEFAULT 0,
     ADD COLUMN "lastStreakDate"    date,
     ADD COLUMN "lastPenaltyDate"   date;
   UPDATE users u SET
     "totalMinutePoints" = COALESCE(s.net, 0),
     "currentStreak"     = COALESCE(s.streak, 0),
     "lastStreakDate"    = s.last_streak,
     "lastPenaltyDate"   = s.last_penalty
   FROM (SELECT "userId",
                SUM("totalMinutePoints") net,
                MAX("currentStreak")     streak,
                MAX("lastStreakDate")    last_streak,
                MAX("lastPenaltyDate")   last_penalty
         FROM user_language_points GROUP BY "userId") s
   WHERE u.id = s."userId";
   DELETE FROM schema_migrations WHERE version IN (130, 134);
   ```
   This collapses per-language state back to one global figure, which **loses the split** (two
   streaks become their max). Acceptable as an emergency measure only.

Because rollback is this awkward, prefer fixing forward. Migration 130 aborting cleanly on bad
data is what makes that safe.

## User-visible behaviour change to expect

- Streaks and wallets are **per language**. A user who studied both will see their whole
  balance on their primary language and **0 on the other** — this is the intended backfill, not
  data loss (the ledger still holds every minute; `lifetimeMinutesEarned` per language is
  correct).
- The night market is per language: switching language loads a **different** continent, and the
  second language starts with just its seeded hub.
- The leaderboard is unchanged in shape — it still ranks everyone globally, now on the sum of
  each user's language wallets, showing their **best** per-language streak.
- `GET /api/users/:id/totalMinutePoints` is **gone** (410-by-absence: it 404s). No client calls
  it; the summary endpoint replaced it.
