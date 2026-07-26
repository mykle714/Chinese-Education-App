# Deploy Runbook — `vernacularScore` → `frequencyScore` (migration 122)

**Audience:** the agent performing the production deploy. Read this end to end before
running anything. It covers only what is unusual about this change; the standard
deploy procedure still comes from the `/deploy` skill (`.claude/commands/deploy.md`).

**Status:** code + migration complete and verified on dev. Not yet deployed.

---

## 1. What this change is

The det column `vernacularScore` was renamed to `frequencyScore` on **both**
`dictionaryentries_zh` and `dictionaryentries_es`, and its meaning was changed:

| | Old (`vernacularScore`) | New (`frequencyScore`) |
|---|---|---|
| Measures | **register** — how colloquial vs. literary a word sounds | **frequency** — how often it comes up in everyday conversation |
| 5 | Natural vernacular | Constant in daily speech |
| 4 | Informal-leaning | Common |
| 3 | Neutral register | Moderately common |
| 2 | Formal/written-leaning | Uncommon in speech |
| 1 | Literary/classical only | Almost never spoken |

Why: every consumer of the number already ranked by "how common is this word" — the
gsa tie-break, dictionary search relevance, starter-pack ordering, the Quick Mark
`BETWEEN 3 AND 5` gate, and dd's top-cluster pick. Under register semantics a
colloquial-but-rare word outranked a very common register-neutral one.

Full rationale and the consumer list: **docs/DEFINITION_MAPPING.md**, section
"`frequencyScore` — what the 1–5 number means".

The user-facing label stays **"Commonality"** — no user-visible copy changed.

---

## 2. ⚠️ Ordering constraint — read this first

Two migrations are pending. **They must apply in numeric order, 122 before 123.**

| # | File | Depends on |
|---|---|---|
| 122 | `122-rename-vernacular-score-to-frequency-score.sql` | column still named `vernacularScore` |
| 123 | `123-es-word1-unique-clustered-senses.sql` | column **already** named `frequencyScore` (12 references) |

`migrate.sh` and the `/deploy` skill both apply in `sort -V` order, so the default
path is correct. **Do not hand-apply 123 first**, and do not reorder them. If 123 runs
against a pre-122 database it fails with `column "frequencyScore" does not exist`.

If prod's `schema_migrations` already shows 123 applied but not 122, **stop and
escalate** — that combination cannot have succeeded and means someone hand-patched
the DB.

---

## 3. Preconditions

Run these before touching anything. All are read-only.

```bash
# a) Confirm prod's current migration state. Expect max(version) = 120.
docker exec cow-postgres-prod psql -U cow_user -d cow_db \
  -c "SELECT version, name, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 5;"

# b) Confirm the OLD column name is still in place on prod (both tables).
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_name IN ('dictionaryentries_zh','dictionaryentries_es')
    AND column_name IN ('vernacularScore','frequencyScore') ORDER BY 1,2;"

# c) Record the pre-migration row counts — used to verify nothing was lost.
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT 'zh' t, count(*) rows, count(\"vernacularScore\") scored,
         count(\"definitionClusters\") clustered FROM dictionaryentries_zh
  UNION ALL
  SELECT 'es', count(*), count(\"vernacularScore\"), NULL FROM dictionaryentries_es;"
```

**Expected:** (a) max = 120; (b) exactly two rows, both `vernacularScore`; (c) note
the numbers down.

If (a) is **below 120**, there are older pending migrations — apply those first, in
order, per the `/deploy` skill. If (b) already shows `frequencyScore`, migration 122
has somehow already run: verify with §5 and just record the tracking row.

---

## 4. Applying the migration

Use the standard `/deploy` block shape (`docker cp` → `psql -f` → `INSERT`). Never
use `<` redirection — it breaks in pasted blocks. The tracking row is **mandatory**;
without it `migrate.sh` will try to re-run the file later and fail.

```bash
cd ~/vocabulary-app

docker cp database/migrations/122-rename-vernacular-score-to-frequency-score.sql \
  cow-postgres-prod:/tmp/122-rename-vernacular-score-to-frequency-score.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 \
  -f /tmp/122-rename-vernacular-score-to-frequency-score.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db \
  -c "INSERT INTO schema_migrations (version, name) VALUES (122, '122-rename-vernacular-score-to-frequency-score.sql');"
```

Then 123 (that migration is owned by separate work — follow its own instructions;
it is listed here only to fix the ordering).

### What 122 does, in order

The whole file is wrapped in `BEGIN`/`COMMIT`, so it is all-or-nothing. This matters
because `migrate.sh` applies files with a plain `psql -f` (no `--single-transaction`)
and records the tracking row only after the file exits 0 — an unwrapped partial
failure would leave the DB half-renamed *and* untracked.

1. `ALTER TABLE dictionaryentries_zh RENAME COLUMN "vernacularScore" TO "frequencyScore"` + column comment
2. Same for `dictionaryentries_es`
3. Rewrites the `vernacularScore` key → `frequencyScore` inside every element of zh's
   `definitionClusters` jsonb. Uses `WITH ORDINALITY … ORDER BY ord` so **cluster order
   is preserved** — critical, because `vocabentries.selectedSense` and the flp
   sense-picker address clusters by index.
4. Renames the run-log stamp key in `enrichmentLog` on both tables
   (`chinese/backfill-vernacular-score` → `chinese/backfill-frequency-score`, and the
   `spanish/` equivalent). Renamed rather than dropped so per-row run history survives.

**Expected output:** `ALTER TABLE, COMMENT, ALTER TABLE, COMMENT, UPDATE <n>, COMMENT,
UPDATE <n>, UPDATE <n>` with no errors.

### Verified behaviors (dry-run on a scratch DB with the pre-rename schema)

- Cluster array order preserved
- Unrelated `enrichmentLog` keys preserved (only the one key is renamed)
- Rows with `NULL` score, `[]` clusters, or `NULL` `enrichmentLog` are skipped cleanly
- Re-running the file fails at step 1 (rename is not `IF EXISTS`) — this is intended;
  the `schema_migrations` row is what prevents a re-run

---

## 5. Post-migration verification

```bash
# 1. Both columns renamed, old name gone.
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_name IN ('dictionaryentries_zh','dictionaryentries_es')
    AND column_name IN ('vernacularScore','frequencyScore') ORDER BY 1,2;"
# EXPECT: two rows, both 'frequencyScore'. Zero rows named 'vernacularScore'.

# 2. No stale jsonb keys anywhere.
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT count(*) AS stale_cluster_keys FROM dictionaryentries_zh,
    jsonb_array_elements(\"definitionClusters\") c WHERE c ? 'vernacularScore';"
# EXPECT: 0

docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT count(*) FILTER (WHERE \"enrichmentLog\" ? 'chinese/backfill-vernacular-score') AS stale_zh,
         (SELECT count(*) FROM dictionaryentries_es
           WHERE \"enrichmentLog\" ? 'spanish/backfill-vernacular-score') AS stale_es
  FROM dictionaryentries_zh;"
# EXPECT: 0, 0

# 3. Row counts + score counts unchanged vs. the §3(c) baseline.
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT 'zh' t, count(*) rows, count(\"frequencyScore\") scored,
         count(\"definitionClusters\") clustered FROM dictionaryentries_zh
  UNION ALL
  SELECT 'es', count(*), count(\"frequencyScore\"), NULL FROM dictionaryentries_es;"
```

Then app-level smoke checks after the containers are up:

- `curl http://localhost/api/health`
- Open a card detail page — the **"Commonality"** 5-dot meter renders (any value)
- Dictionary search returns results in a sensible order (the ORDER BY uses this column)
- The Quick Mark page lists cards (its universe gate filters `frequencyScore BETWEEN 3 AND 5` — an empty page means the column didn't survive)

---

## 6. Expected state after deploy — this is intentional

**Prod will display old register values under the new name.** The migration
deliberately preserves the existing numbers (product decision: no blank meters). Until
the backfills in §7 run on prod, a "Commonality 3/5" on prod still means "register-neutral",
not "moderately common".

This affects the displayed number and the ranking order only. **No user data is at
risk**, and no det rows are created, deleted, or rebuilt by 122.

Do not "fix" this by nulling the column — that also blanks the gsa tie-break, search
relevance, and pack ordering, which is worse than a slightly-wrong number.

---

## 7. Re-scoring prod (separate step, after the deploy is green)

`SCRIPT_VERSION` was bumped on every affected script, so `staleClause()` treats all
existing rows as stale. Backfills run **from the host** via `run-prod.sh` (the prod
backend image ships neither `scripts/backfill/` nor `tsx`, so `docker exec
cow-backend-prod` cannot work). Requires `POSTGRES_PASSWORD` in the repo-root `.env`.

**Order matters** — word-level score must precede clustering, because clustering's
single-definition fast path copies the word-level `frequencyScore` onto the lone
cluster instead of spending an API call.

```bash
# 1. Chinese word-level  (~930 discoverable rows on dev; count prod first)
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-frequency-score.js --stale

# 2. Spanish word-level + difficulty  (~843 discoverable rows on dev)
server/scripts/backfill/run-prod.sh scripts/backfill/spanish/backfill-frequency-score.js --stale
```

Both are one Sonnet call per row and safe to re-run (idempotent, per-row commit).
Spot-check first with `--spot-check --stale --random --limit=5`, which prints one-line
reasoning per word — confirm the reasoning talks about *how often a word comes up*,
not about how formal it sounds. If it mentions register, stop: the wrong prompt shipped.

> **`--stale` on the Spanish script is new.** It did not exist before this change;
> without it that run finds nothing to do because every row already has a score.

### Optional / deferrable: per-cluster scores

```bash
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-cluster-definitions.js --stale
```

⚠️ **Cost warning:** `--stale` on this script re-runs the *entire* clustering pipeline
(Stage A partition + Stage B gloss ordering + Stage C scoring) for every already-clustered
row — several API calls each, not one. There is no score-only mode today.

The per-cluster `frequencyScore` drives dd's top-cluster pick and the flp sense-picker
ordering. Leaving it on old register values is a real but contained inconsistency
(word-level frequency, cluster-level register). **Confirm with the user before running
this one.** It is not required for the deploy to be correct.

### After re-scoring

```bash
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT \"frequencyScore\", count(*) FROM dictionaryentries_zh
  WHERE discoverable GROUP BY 1 ORDER BY 1;"
```

Sanity-check a few known words — under the new rubric expect roughly:
`吃饭` 5, `时间` 5, `搞定` 4, `手术` 3, `自由` 3, `阐述` 2, `余` 2, `翌日` 1.
(These are the dev spot-check results; ±1 variance is normal, but a `手术` of 2 or a
`翌日` of 4 means the old rubric is still in play.)

---

## 8. Rollback

If the migration must be undone **before** any re-scoring, it is a clean reverse — the
values themselves were never touched, only names:

```sql
BEGIN;
ALTER TABLE dictionaryentries_zh RENAME COLUMN "frequencyScore" TO "vernacularScore";
ALTER TABLE dictionaryentries_es RENAME COLUMN "frequencyScore" TO "vernacularScore";

UPDATE dictionaryentries_zh
SET "definitionClusters" = (
  SELECT jsonb_agg(
    CASE WHEN cluster ? 'frequencyScore'
      THEN (cluster - 'frequencyScore') || jsonb_build_object('vernacularScore', cluster -> 'frequencyScore')
      ELSE cluster END
    ORDER BY ord)
  FROM jsonb_array_elements("definitionClusters") WITH ORDINALITY AS t(cluster, ord))
WHERE "definitionClusters" IS NOT NULL
  AND jsonb_typeof("definitionClusters") = 'array'
  AND jsonb_array_length("definitionClusters") > 0;

UPDATE dictionaryentries_zh
SET "enrichmentLog" = ("enrichmentLog" - 'chinese/backfill-frequency-score')
  || jsonb_build_object('chinese/backfill-vernacular-score', "enrichmentLog" -> 'chinese/backfill-frequency-score')
WHERE "enrichmentLog" ? 'chinese/backfill-frequency-score';

UPDATE dictionaryentries_es
SET "enrichmentLog" = ("enrichmentLog" - 'spanish/backfill-frequency-score')
  || jsonb_build_object('spanish/backfill-vernacular-score', "enrichmentLog" -> 'spanish/backfill-frequency-score')
WHERE "enrichmentLog" ? 'spanish/backfill-frequency-score';

DELETE FROM schema_migrations WHERE version = 122;
COMMIT;
```

Then redeploy the previous application commit — the app code references
`frequencyScore` everywhere and will break against a rolled-back column.

**Rollback is NOT clean once §7 has run**: the re-scored values are frequency
judgments, and reverting the name would relabel them as register. At that point roll
forward (fix and re-run) rather than back.

**Rollback is impossible once 123 has applied** — that migration restructures
`dictionaryentries_es` on top of the renamed column. Roll forward instead.

---

## 9. Do NOT

- Do not run `docker-compose -f docker-compose.prod.yml down -v` (destroys the prod volume)
- Do not apply 123 before 122
- Do not `/data-deploy` the det tables to "fix" the scores — prod is the source of
  truth for `dictionaryentries_zh`/`_es`; that direction is deprecated and would
  clobber prod-side edits
- Do not set `discoverable = TRUE` on any row as part of this work — that is only
  legal inside the `/mark-discoverable` pipeline
- Do not skip the `INSERT INTO schema_migrations` row after a hand-applied migration
- Do not re-run migration 122 after a successful apply — the rename is not `IF EXISTS`
  and will error

---

## 10. Reference

| Thing | Where |
|---|---|
| Migration | `database/migrations/122-rename-vernacular-score-to-frequency-score.sql` |
| Ordering-dependent migration | `database/migrations/123-es-word1-unique-clustered-senses.sql` |
| Rubric (zh, shared by word + cluster scorers) | `server/scripts/backfill/chinese/lib/frequencyScore.js` |
| Rubric (es) | `server/scripts/backfill/spanish/backfill-frequency-score.js` |
| Band labels (language-neutral) | `server/scripts/backfill/shared/lib/frequencyLabels.js` |
| Semantics + consumer list | `docs/DEFINITION_MAPPING.md` § "`frequencyScore` — what the 1–5 number means" |
| Prod backfill shim | `server/scripts/backfill/run-prod.sh` |
| Standard deploy procedure | `.claude/commands/deploy.md` (`/deploy` skill) |
| Migration runner | `database/deploy/migrate.sh` |

**Verified on dev before handoff:** frontend + server `tsc` clean, `npm run build`
clean, migration dry-run on a scratch DB with the pre-rename schema, and live
spot-checks of both the zh and es scorers against the new rubric.
