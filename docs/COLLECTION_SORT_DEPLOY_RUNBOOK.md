# ⚠️ TEMPORARY — Collection "Sort by" / `masteredAt` deploy runbook

**Delete this file once verified on prod.**
**Deployed to prod yet? NO.**

Covers migration **142** (`142-add-mastered-at-to-vocabentries.sql`) and the collection
Sort-by feature. Design: [DECKS_FEATURE.md](./DECKS_FEATURE.md) § "Sort by" and
[MASTERY_REWORK.md](./MASTERY_REWORK.md) § `masteredAt`.

---

## Why this needs a runbook

**Ordering constraint between the DB and the code.** The standard `/deploy` block brings
the containers up (`up --build -d`) and runs migrations *after*. This change cannot
tolerate that order: the new backend reads and writes a column that does not exist yet.

Two paths break in that window:

| Path | What happens without the column |
|---|---|
| `POST /api/flashcards/mark` | Only when a mark carries a card into **Mastered**: the UPDATE grows a `SET "masteredAt" = $6` clause → `column "masteredAt" does not exist`, 500, and the learner's mark is lost. |
| `POST /api/flashcards/undoLastMark` | **Every** undo: the `SELECT … "masteredAt" … FOR UPDATE` fails → 500. The transaction rolls back, so no data is corrupted, but undo is dead for the whole window. |

Migration 142 is backward compatible on its own — it only ADDs two nullable columns, and
the currently-deployed code never references them. So **DB first** is safe and is the
required order.

Nothing else about this deploy is unusual: no backfill, no cron change, no held-back
migration, no expand/contract pair.

---

## Step order

1. **Pre-deploy dump** — the standard `/deploy` step. (Migration 142 is additive and its
   rollback is a plain `DROP COLUMN`, so the dump is routine insurance, not a
   prerequisite.)

2. **Run migration 142 FIRST, before `docker-compose up --build -d`.** Reorder the
   standard deploy block so the `docker cp` + `psql -f` + `INSERT` triple for 142 sits
   *above* the compose lines:

   ```bash
   cd ~/vocabulary-app
   sudo systemctl stop nginx   # only if host nginx is running
   git pull origin main

   # ⚠️ MIGRATION BEFORE CODE — see this runbook.
   docker cp database/migrations/142-add-mastered-at-to-vocabentries.sql cow-postgres-prod:/tmp/142-add-mastered-at-to-vocabentries.sql
   docker exec cow-postgres-prod psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 -f /tmp/142-add-mastered-at-to-vocabentries.sql
   docker exec cow-postgres-prod psql -U cow_user -d cow_db \
     -c "INSERT INTO schema_migrations (version, name) VALUES (142, '142-add-mastered-at-to-vocabentries.sql');"
   ```

   The postgres container keeps running across a code deploy, so it is available to
   migrate before the app containers are rebuilt.

   ⚠️ Migrations **137–141** are also unshipped at time of writing. 142 is independent of
   all of them; run them in `sort -V` order as usual, with the whole group before the
   compose lines.

3. **Verify the column landed** (SQL below) — *before* starting the new code.

4. **Bring the app up** — the rest of the standard block, unchanged
   (`docker-compose down` → `up --build -d` → cron install → verify).

5. **Post-deploy verification** (below).

---

## Verification SQL

### After step 2 — the column exists on both vet tables

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE column_name = 'masteredAt'
ORDER BY table_name;
```

**Expected — exactly two rows:**

```
    table_name    | column_name |          data_type          | is_nullable
------------------+-------------+-----------------------------+-------------
 vocabentries_es  | masteredAt  | timestamp with time zone    | YES
 vocabentries_zh  | masteredAt  | timestamp with time zone    | YES
```

**If it fails** (0 or 1 rows): do NOT start the new code. Re-run the migration file;
it is idempotent (`ADD COLUMN IF NOT EXISTS`). If it still fails, the deploy is
blocked — roll back to the previous commit and investigate.

### After step 2 — the migration is recorded

```sql
SELECT version, name FROM schema_migrations WHERE version = 142;
```

**Expected:** one row. If it is missing, `migrate.sh` will try to re-run 142 on the next
deploy — harmless (idempotent), but insert the tracking row anyway.

### After step 4 — every existing card is NULL

```sql
SELECT count(*) AS total, count("masteredAt") AS stamped FROM vocabentries_zh;
```

**Expected immediately after deploy:** `stamped = 0`. This is correct and intended —
the column is deliberately **not backfilled** (the crossing moment is unrecoverable from
the rolling 8-mark window). `stamped` should start climbing as learners push cards into
Mastered.

### After step 4 — a live crossing stamps the column

Have a tester carry one card into Mastered through the flp, then:

```sql
SELECT id, "entryKey", "masteredAt" FROM vocabentries_zh
WHERE "masteredAt" IS NOT NULL ORDER BY "masteredAt" DESC LIMIT 5;
```

**Expected:** the card appears, with `masteredAt` equal to the timestamp of the mark that
promoted it (**not** `now()` — it is stamped with the mark's own timestamp so undo can
match on it).

Then hit **undo** on that same mark and re-run the query: the row should drop back to
NULL. Any other card's stamp must be untouched.

---

## What to expect in the UI

* Every collection page (`/flashcards/collection/learn-now`, `…/mastered`,
  `/flashcards/deck/:id`) gains a **Sort by** button under the search field.
* Inside a deck the default ordering is unchanged (**Recently added to this deck**), and
  Learn Now / Mastered still open on **Recently added** — so the pages look exactly as
  before until someone taps the button.
* **Recently mastered** will look empty-ish at first: every pre-existing mastered card
  has a NULL date and sorts to the bottom. This is expected, not a bug, and is worth
  saying out loud if a tester reports it.

---

## Rollback

The column is additive and nothing reads it except the client sort, so rolling back the
**code** alone is sufficient and safe — the column can simply stay.

If the column itself must go:

```sql
ALTER TABLE vocabentries_zh DROP COLUMN IF EXISTS "masteredAt";
ALTER TABLE vocabentries_es DROP COLUMN IF EXISTS "masteredAt";
DELETE FROM schema_migrations WHERE version = 142;
```

⚠️ Roll the **code back first**. Dropping the column under the new code reintroduces
exactly the two 500s described at the top.
