# ⚠️ TEMPORARY — Three mastery bars deploy runbook

**Delete this file once verified on prod.**
**Deployed to prod yet? NO.**

Covers migration **143** (`143-three-mastery-bars.sql`) and the three-bar mastery
rework. Design: [MASTERY_REWORK.md](./MASTERY_REWORK.md) § "Three bars".

This runbook **supersedes** [COLLECTION_SORT_DEPLOY_RUNBOOK.md](./COLLECTION_SORT_DEPLOY_RUNBOOK.md)
where the two disagree — 142 and 143 ship together and 143 rewrites the column 142 adds.
Read that one for the 142-specific reasoning, then follow the step order here.

---

## Why this needs a runbook

Three reasons, in descending order of how badly they bite:

1. **The migration MUST land before the code.** The new server reads and writes
   `vet."masteredAt"` as **jsonb** and inserts `category_promotions.bar`. Under the old
   schema every mark that carries a card into Mastered 500s, and every undo 500s.
2. **142 and 143 must run back to back, in that order, in the same window.** 142 adds
   `masteredAt` as `timestamptz`; 143 converts it to `jsonb`. Prod has never seen 142, so
   no deployed code ever wrote the timestamptz form — which is exactly why the conversion
   is safe here and would not be later. Do not ship 142 alone.
3. **A function is deliberately held back from being dropped.** `compute_utcm_category()`
   is dead after this deploy but is NOT dropped by 143, because the pre-143 code calls it
   on every deck read during the window. It needs a **follow-up contract migration** (see
   below). Leaving it is harmless; dropping it early takes prod down.

No backfill, no cron change, no held-back migration.

---

## Step order

1. **Pre-deploy dump** — the standard `/deploy` step. Take it seriously this time: 143
   performs a **type conversion** on a live column. The rollback needs the dump if the
   conversion is interrupted mid-way (it will not be — it is one transactional `ALTER` per
   table — but a column-type rollback is not a `DROP COLUMN`).

2. **Run migrations FIRST, before `docker-compose up --build -d`.** Reorder the standard
   deploy block so all outstanding migrations sit *above* the compose lines:

   ```bash
   cd ~/vocabulary-app
   sudo systemctl stop nginx   # only if host nginx is running
   git pull origin main

   # ⚠️ MIGRATIONS BEFORE CODE — see this runbook.
   for m in 142-add-mastered-at-to-vocabentries 143-three-mastery-bars; do
     docker cp "database/migrations/$m.sql" "cow-postgres-prod:/tmp/$m.sql"
     docker exec cow-postgres-prod psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 -f "/tmp/$m.sql"
     docker exec cow-postgres-prod psql -U cow_user -d cow_db \
       -c "INSERT INTO schema_migrations (version, name) VALUES (${m%%-*}, '$m.sql');"
   done
   ```

   ⚠️ Migrations **137–141** are also unshipped at time of writing (140 has its own
   runbook, [PROVISIONAL_CARDS_DEPLOY_RUNBOOK.md](./PROVISIONAL_CARDS_DEPLOY_RUNBOOK.md)).
   Run the whole group in `sort -V` order, all of it above the compose lines. 143 is
   independent of 137–141; it only depends on 142.

   The postgres container keeps running across a code deploy, so it is available to
   migrate before the app containers are rebuilt.

3. **Verify the schema landed** (SQL below) — *before* starting the new code. If any check
   fails, stop: the old code is still running and still correct.

4. **Bring the app up** — the rest of the standard block, unchanged
   (`docker-compose down` → `up --build -d` → cron install → verify).

5. **Post-deploy verification** (below).

6. **Later, once prod is verified and stable:** write and ship the contract migration that
   drops `compute_utcm_category(jsonb, boolean, boolean)`. Nothing in the deployed tree
   calls it after step 4 — confirm with
   `grep -rn "compute_utcm_category" server/ database/` (expect hits only in migrations
   101/143 and this runbook).

---

## Verification SQL

### After step 2 — `masteredAt` is jsonb on both vet tables

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE column_name = 'masteredAt'
ORDER BY table_name;
```

**Expected — exactly two rows, both `jsonb`:**

```
    table_name    | column_name | data_type | is_nullable
------------------+-------------+-----------+-------------
 vocabentries_es  | masteredAt  | jsonb     | YES
 vocabentries_zh  | masteredAt  | jsonb     | YES
```

**If a row still says `timestamp with time zone`:** the guarded `DO` block did not fire.
Do NOT start the new code. Re-run 143 (it is idempotent) and re-check.

### After step 2 — the core band function exists and is correct

```sql
SELECT
  compute_core_category(jsonb_build_object(
    'recognition', (SELECT jsonb_agg(jsonb_build_object('timestamp','2026-01-01T00:00:00.000Z','isCorrect',true)) FROM generate_series(1,6)),
    'production',  (SELECT jsonb_agg(jsonb_build_object('timestamp','2026-01-01T00:00:00.000Z','isCorrect',true)) FROM generate_series(1,6))
  )) AS six_six,
  compute_core_category(jsonb_build_object(
    'recognition', (SELECT jsonb_agg(jsonb_build_object('timestamp','2026-01-01T00:00:00.000Z','isCorrect',true)) FROM generate_series(1,8))
  )) AS eight_zero,
  compute_core_category('{}'::jsonb) AS empty;
```

**Expected:**

```
 six_six  | eight_zero  |   empty
----------+-------------+------------
 Mastered | Comfortable | Unfamiliar
```

`eight_zero` is the one that matters: eight recognition marks and no production must
**not** reach Mastered. If it says `Mastered`, the `LEAST(6, …)` cap is wrong and cards
will be over-promoted — block the deploy.

### After step 2 — `category_promotions.bar` exists, constrained, backfilled

```sql
SELECT bar, count(*) FROM category_promotions GROUP BY bar;
```

**Expected:** a single row, `core | <all existing promotions>`. Every pre-143 row is core
by construction.

```sql
SELECT conname FROM pg_constraint WHERE conname = 'category_promotions_bar_check';
```

**Expected:** one row.

### After step 2 — the migrations are recorded

```sql
SELECT version, name FROM schema_migrations WHERE version IN (142, 143) ORDER BY version;
```

**Expected:** two rows. If either is missing, `migrate.sh` re-runs it next deploy —
harmless (both are idempotent), but insert the tracking row anyway.

### After step 4 — nobody was demoted by the deploy

The whole point of the rework is that a card's band no longer depends on the goal flags.
Compare the new core band against what the old goal-blended function said, for accounts
that actually have a goal set:

```sql
SELECT count(*) AS changed_band
FROM vocabentries_zh ve
JOIN users u ON u.id = ve."userId"
WHERE (u."readingGoal" IS TRUE OR u."writingGoal" IS TRUE)
  AND compute_core_category(ve."typedMarkHistory")
      <> compute_utcm_category(ve."typedMarkHistory", u."readingGoal", u."writingGoal");
```

**Expected:** a nonzero number, and **every one of those changes is upward.** These are
precisely the cards that the old formula was diluting. Confirm the direction:

```sql
SELECT compute_utcm_category(ve."typedMarkHistory", u."readingGoal", u."writingGoal") AS was,
       compute_core_category(ve."typedMarkHistory") AS now, count(*)
FROM vocabentries_zh ve JOIN users u ON u.id = ve."userId"
WHERE (u."readingGoal" IS TRUE OR u."writingGoal" IS TRUE)
GROUP BY 1, 2 ORDER BY 3 DESC;
```

**Expected:** no row where `now` is a *lower* band than `was` (band order:
Unfamiliar < Target < Comfortable < Mastered). A downward row means the core formula
regressed someone — capture the output and roll the code back.

Run this **before** step 6 drops `compute_utcm_category()`; afterwards the comparison is
no longer expressible.

### After step 4 — a live crossing stamps the right bar

Have a tester carry one card into Mastered through the flp, then:

```sql
SELECT id, "entryKey", "masteredAt" FROM vocabentries_zh
WHERE "masteredAt" IS NOT NULL ORDER BY id DESC LIMIT 5;
```

**Expected:** `{"core": "<iso>"}` — the ISO string equal to the timestamp of the mark that
promoted it (**not** `now()`; it is stamped with the mark's own timestamp so undo can match
on it). A reading-drill crossing stamps `{"reading": …}` instead, leaving any `core` key
intact.

Then hit **undo** on that same mark: the key should disappear from the object (the object
itself may remain as `{}`), and no other bar's key may be touched.

```sql
SELECT bar, "fromCategory", "toCategory", "promotedAt"
FROM category_promotions ORDER BY "promotedAt" DESC LIMIT 5;
```

**Expected:** the promotion logged against the bar the mark belongs to — a reading mark
writes `bar = 'reading'`, never `'core'`.

---

## What to expect in the UI

* **Account page:** the goal toggles' warning copy is gone. Turning a goal on now adds a
  bar rather than re-banding cards, and the new copy says so.
* **cdp / flp:** one progress bar per active bar, captioned **Know** / **Read** / **Write**.
  With no goals set the page looks as it does today (one bar).
* **Mini cards:** up to three hairline bars along the bottom edge, left-justified, each
  split into the same per-type color segments as the cdp bar; the English definition sits
  slightly higher to make room. The badge stays, colored by core.
* **fdp:** up to three **Mastered** collection rows, goal-gated. Their counts come from the
  new `GET /api/onDeck/masteredCounts`.
* **Collection Sort by:** gains a mastery pair per active bar; "Recently mastered" reads
  the latest stamp across the **active** bars only.
* **Deck counts, the level estimate, and the Night Market community Learning feed** are all
  **core only** — they should read exactly as before for an account with no goals, and
  slightly *higher* for one with goals (see the no-demotion check above).
* Learners with a reading or writing goal who have been drilling those tracks will see
  those bars appear **already partly filled** — the marks were being recorded all along.
  This is intended; say it out loud if a tester reports it as a bug.

---

## Rollback

**Code rollback alone is safe and is the first move.** The old code does not know about
`category_promotions.bar` (the column has a `DEFAULT 'core'`, so its inserts stay valid)
and does not know about `compute_core_category` (still present, just unused). The one
thing it *cannot* tolerate is `masteredAt` being jsonb — 142's code reads it as a
timestamp.

So a code-only rollback requires converting the column back:

```sql
ALTER TABLE vocabentries_zh ALTER COLUMN "masteredAt" TYPE timestamptz
  USING ("masteredAt" ->> 'core')::timestamptz;
ALTER TABLE vocabentries_es ALTER COLUMN "masteredAt" TYPE timestamptz
  USING ("masteredAt" ->> 'core')::timestamptz;
DELETE FROM schema_migrations WHERE version = 143;
```

This **discards the reading and writing stamps** (they have nowhere to live in a single
timestamptz). Acceptable: they are decorative sort keys, not accounting.

To go all the way back past 142 as well, follow the rollback in
[COLLECTION_SORT_DEPLOY_RUNBOOK.md](./COLLECTION_SORT_DEPLOY_RUNBOOK.md).

Leave `compute_core_category()` and `category_promotions.bar` in place either way —
neither is reachable from the old code, and both are wanted again on the retry.

⚠️ Roll the **code back first**, then the column. In the other order every mark and undo
500s for the length of the gap.
