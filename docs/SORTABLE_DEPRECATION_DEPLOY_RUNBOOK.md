# TEMPORARY — `sortable` deprecation deploy runbook

> **Delete this file once prod is verified.**
> **Status: NOT YET DEPLOYED.** Migration `142-drop-sortable-from-zh.sql` has **not**
> been run on prod (or dev). The code in this commit no longer reads the column, but
> the column is still there — that is the intended intermediate state.

## What ships

The zh-only `sortable` flag (migration 110) is retired. Discover Sort Cards, Quick
Mark, the level-bar progress query and the provisional-card lender all gate on
`discoverable = TRUE` again, for every language.

Removed: `promote-sortable.js`, `buildSortableReadyPredicate` / `isSortableReady`,
`PRE_PASS_STEP_IDS` / `PRE_PASS_SCRIPTS_ZH`, `oracle-plan.js --unsortable`, and the
`/oracle-backfill` §3b pre-pass procedure. The `--unsortable` scope's candidate-quality
filter and `CHAR_FREQ_CTE` commonness ordering were **kept** — they moved onto
`oracle-plan.js --new` for zh.

Rationale + numbers: [DISCOVER_FLOW.md](./DISCOVER_FLOW.md) § Card supply gate, and the
post-mortem under §4b of [DISCOVER_LAZY_ENRICHMENT.md](./DISCOVER_LAZY_ENRICHMENT.md).

## ⚠️ This is an EXPAND/CONTRACT pair — order is not optional

`142-drop-sortable-from-zh.sql` is the **contract** step. It must run **AFTER** the new
backend is live. If it runs first, every discover supply query on the old backend hits
a missing column and 500s.

`migrate.sh` runs pending migrations automatically, so **do not let the normal
`/deploy` flow apply 142 in its usual pre-code slot.** Sequence:

| # | Step | Notes |
|---|---|---|
| 1 | `server/scripts/backfill/backup-det.sh sortable-drop` | Cheap insurance; the column lives on the det table. |
| 2 | Deploy the backend + frontend as usual | **Hold back migration 142.** No other migration in this change. |
| 3 | Smoke-test discover (below) on the new code | The column still exists at this point — a rollback here is a plain code rollback, no DB work. |
| 4 | Run migration 142 only after step 3 passes | `docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < database/migrations/142-drop-sortable-from-zh.sql` |
| 5 | Re-run the verification SQL | Confirms the column is gone and discover still serves. |

If your `/deploy` run applies all pending migrations unconditionally, temporarily move
`142-drop-sortable-from-zh.sql` out of `database/migrations/` for the deploy and put it
back for step 4.

## Verification

**Step 3 (code live, column still present).** Both counts unchanged from before the
deploy, and discover must serve cards:

```sql
-- expected at time of writing: discoverable = 1299, sortable = 1517
SELECT count(*) FILTER (WHERE discoverable) AS discoverable,
       count(*) FILTER (WHERE sortable)     AS sortable
FROM dictionaryentries_zh WHERE language = 'zh';
```

Then, as a real user: `/discover` → Sort Cards → cards appear; Quick Mark → the grid
populates; the level bar shows a non-zero total. Nothing should reference `sortable` in
the backend log.

**Step 5 (column dropped).**

```sql
-- MUST return 0 rows
SELECT column_name FROM information_schema.columns
WHERE table_name = 'dictionaryentries_zh' AND column_name = 'sortable';

-- MUST return 0 rows
SELECT indexname FROM pg_indexes WHERE indexname = 'idx_dictionary_sortable_language';

-- sanity: the gate the app now uses still matches a healthy set
-- expected: ~1299 (it does NOT change — dropping the column touches no discoverable row)
SELECT count(*) FROM dictionaryentries_zh
WHERE language = 'zh' AND discoverable AND difficulty BETWEEN 1 AND 6;
```

Re-run the Sort Cards / Quick Mark smoke test.

## User-visible change to expect

**~218 words disappear from discover.** Those were `sortable` but not `discoverable` —
partially enriched, shown as sort cards only. They are not deleted and nothing they
carry is lost: their `difficulty`, cleaned `definitions` and `enrichmentLog` stamps
remain, so they promote to `discoverable` normally once the rest of the manifest runs
on them. Users who already sorted one keep their vet row and their marks — vet rows are
keyed by word, never by this flag.

No other surface changes: `discoverable` already gated the dictionary, reader and
flashcard surfaces.

## If a check fails

| Symptom | Action |
|---|---|
| Discover 500s after step 2 (before 142) | A code path still selects `sortable`. `grep -rn "sortable" server/ --include=*.ts --include=*.js`. Roll back the code; no DB work needed. |
| Discover 500s after step 4 | Same cause, but the column is gone. Fastest recovery is `ALTER TABLE dictionaryentries_zh ADD COLUMN sortable BOOLEAN NOT NULL DEFAULT false;` then re-run migration 110's backfill UPDATE, and roll the code back. |
| Sort Cards shows "no cards" for a level | Expected at sparse levels if the missing 218 were concentrated there. Check `SELECT difficulty, count(*) FROM dictionaryentries_zh WHERE language='zh' AND discoverable GROUP BY 1 ORDER BY 1;` before declaring a bug. |

## Rollback

Steps 1–3 only: redeploy the previous image. Nothing in the DB changed.

After step 4: the drop is not reversible from the data (the flag was derived state, not
user data), but it is fully **re-derivable** — re-add the column and re-run migration
110's backfill (`sortable = true WHERE discoverable OR difficulty BETWEEN 1 AND 6`).
That reconstructs every row except any promoted by `promote-sortable.js` between
migration 110 and this deploy whose `difficulty` later went NULL — a set that is
provably empty, since nothing nulls `difficulty`.
