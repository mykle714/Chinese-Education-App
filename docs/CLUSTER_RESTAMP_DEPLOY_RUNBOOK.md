# ⚠️ TEMPORARY — Cluster v11/v5 re-stamp + migration 179 deploy runbook

> **Delete once verified on PPE** (and move its row in [DEPLOY_RUNBOOKS.md](./DEPLOY_RUNBOOKS.md) to the history).
> **Status:** written 2026-10-30, deploying the same day.

## Why this deploy is nonstandard

1. **Cluster `SCRIPT_VERSION` bumps** — zh 10 → 11
   (`server/scripts/backfill/chinese/backfill-cluster-definitions.js`), es 4 → 5
   (`server/scripts/backfill/spanish/backfill-cluster-definitions.js`). Every planner
   (`oracle-plan.js`, `run-lazy-enrichment.js`, `--stale`) treats a row stamped below the
   manifest version as pending. PPE's hourly oracle cron (`:17` / `:47`, zh) would then
   **re-cluster the whole zh corpus**, minting new `sense` labels and orphaning every
   label-keyed dependent (`selectedSense`, longDefinition keying, est `sense` tags,
   breakdown sense labels). The fix is
   `server/scripts/backfill/shared/restamp-cluster-version.js`, which raises the stamp on
   every row the 2026-10-29 audit did **not** flag
   (`server/scripts/backfill/shared/cluster-overcompaction-2026-10-29.json`), so only the
   flagged rows re-cluster. See [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md)
   § "Over-compaction: the translation test".
2. **Migration 179** (`179-add-zh-max-char-stroke-count.sql`) — expand-only, but the
   shipped `DICT_COLS` select `"maxCharStrokeCount"` by name, so it must land **before**
   the container rebuild. It uses `ON COMMIT DROP`, so run it by hand with `psql -1 -f`
   (single transaction) or via `migrate.sh` (which wraps each file in a transaction).

## Step order (on PPE, `~/vocabulary-app`)

1. `git pull origin main`
2. Apply 179 **before** the rebuild:
   ```bash
   docker cp database/migrations/179-add-zh-max-char-stroke-count.sql cow-postgres:/tmp/179.sql
   docker exec cow-postgres psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 -1 -f /tmp/179.sql
   docker exec cow-postgres psql -U cow_user -d cow_db \
     -c "INSERT INTO schema_migrations (version, name) VALUES (179, '179-add-zh-max-char-stroke-count.sql');"
   ```
3. `docker-compose -f docker-compose.ppe.yml down && docker-compose -f docker-compose.ppe.yml up --build -d`
4. **Re-stamp immediately, before the next oracle tick (`:17` / `:47`)** — dry run first:
   ```bash
   docker exec cow-backend npx tsx scripts/backfill/shared/restamp-cluster-version.js --language=zh --from=10 --to=11 --dry-run
   docker exec cow-backend npx tsx scripts/backfill/shared/restamp-cluster-version.js --language=zh --from=10 --to=11
   docker exec cow-backend npx tsx scripts/backfill/shared/restamp-cluster-version.js --language=es --from=4 --to=5 --dry-run
   docker exec cow-backend npx tsx scripts/backfill/shared/restamp-cluster-version.js --language=es --from=4 --to=5
   ```
5. `bash database/cron/install-timers.sh`, then `curl http://localhost/api/health`.

## Verification SQL

```sql
-- 179 landed and populated: expect a large non-null count (most zh rows), column SMALLINT
SELECT COUNT(*) FILTER (WHERE "maxCharStrokeCount" IS NOT NULL) AS filled, COUNT(*) AS total
FROM dictionaryentries_zh;

-- Re-stamp: discoverable zh rows still at cluster v10 should be ~ the audit's zh
-- headwords only (≈93), NOT thousands.
SELECT COUNT(*) FROM dictionaryentries_zh
WHERE discoverable
  AND ("enrichmentLog"->'chinese/backfill-cluster-definitions'->>'version')::int = 10;
```

(Check the key shape in `restamp-cluster-version.js` if the `enrichmentLog` path above
returns 0 for everything.)

**If the re-stamp count is in the thousands:** do not let the oracle run — comment out
the two `oracle-cron.sh` crontab lines, investigate, re-run the re-stamp, restore them.

## Rollback

179 is expand-only — leaving the column in place under old code is harmless. The re-stamp
is metadata-only (`ranAt` kept, `restampedFrom` recorded); undoing it would mean setting
`version` back to `restampedFrom` on rows that carry that key.

## User-visible change

None from the re-stamp. Flagged (over-compacted) senses re-cluster over the following
oracle rounds; the writing flp's easiest-first tier now orders by stroke count.
