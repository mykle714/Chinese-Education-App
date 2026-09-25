# TEMPORARY — Drop `shortDefinitionPronunciationOverride` deploy runbook

> **TEMPORARY. Delete this file once PPE is verified.**
> **Status: NOT YET DEPLOYED to PPE** (written 2026-09-23; PPE was at migration 163, dev at 166).
> Renumbered 2026-09-23: the drop was 165 and became **166** so the expand-only `searchReadings`
> column (165) could land with 164 before the rebuild; the contract migration goes last.
> Per CLAUDE.md, derive what is actually pending from `schema_migrations` and
> `migrate.sh --dry-run`, not from this line.

## What ships

| Piece | Kind | Must land |
|---|---|---|
| Migration **164** (`users.gender` / `users."birthDate"`) | expand | **BEFORE** the rebuild — the new `UserDAL` selects both columns by name |
| Code: `DictionaryDAL` stops selecting / mapping `shortDefinitionPronunciationOverride`; pinyin resolves through `resolveDisplayPronunciation` everywhere (docs/DEFINITION_CLUSTERS.md) | code | the rebuild |
| Migration **165** (`dictionaryentries_zh."searchReadings"`) | expand | **BEFORE** the rebuild — the new `DictionaryDAL.searchByWord1` matches the column by name |
| Migration **166** (drop `shortDefinitionPronunciationOverride` on `dictionaryentries_zh` + `_es`) | **contract** | **AFTER** the rebuild — the OLD `DictionaryDAL` selects the column by name, so old code + dropped column 500s every dictionary read |

**Do not run a single `migrate.sh` pass before the rebuild** — it would apply 164, 165 AND 166
together, and the old containers would 500 on every dictionary read until the rebuild
finished. Split it as below (the 2026-08-17 lesson in CLAUDE.md).

## Step order

1. **Pre-check** (on PPE):
   ```sql
   SELECT max(version) FROM schema_migrations;                         -- expect 163
   SELECT count(*) FROM dictionaryentries_zh WHERE "shortDefinitionPronunciationOverride" IS NOT NULL;  -- expect 1 (着)
   SELECT count(*) FROM dictionaryentries_es WHERE "shortDefinitionPronunciationOverride" IS NOT NULL;  -- expect 0
   ```
   If the zh count is more than 1, stop and show the rows to the user — 166's header records
   only 着's value as the data being discarded.

2. **Apply 164 and 165 by hand** (before the rebuild), each with its tracking row, in one transaction:
   ```bash
   for m in 164-add-user-demographics 165-add-search-readings; do v=${m%%-*}
   { echo "BEGIN;"; cat database/migrations/$m.sql; \
     echo "INSERT INTO schema_migrations (version, name) VALUES ($v, '$m.sql'); COMMIT;"; } \
   | docker exec -i cow-postgres psql -U cow_user -d cow_db -v ON_ERROR_STOP=1; done
   ```

3. **Rebuild the containers** per `/deploy`.

4. **Run `migrate.sh`** — it now picks up 166 alone. Confirm with `--dry-run` first that
   166 is the ONLY pending file.

5. **Populate `searchReadings`** (deterministic, no API calls, safe to re-run):
   `docker exec cow-backend npx tsx scripts/backfill/chinese/backfill-search-readings.js --apply`.
   Until it runs the column is NULL and heteronyms are findable only under their primary reading (the pre-165 behaviour).

## Verification

```sql
SELECT version FROM schema_migrations WHERE version IN (164, 165, 166) ORDER BY 1;   -- 164, 165, 166
SELECT count(*) FROM information_schema.columns
 WHERE column_name = 'shortDefinitionPronunciationOverride';                    -- 0
```
Then open the dictionary search for 行 and confirm it returns results (a 500 here means the
old code is still running against the dropped column — see Rollback). In an IW scene, a line
containing 行 should show `xíng`.

## Rollback

- Before step 4: nothing to undo — the column still exists.
- After step 4, if dictionary reads 500: the running code is the OLD image. Either finish the
  rebuild, or restore the column (empty) until it is done:
  ```sql
  ALTER TABLE dictionaryentries_zh ADD COLUMN IF NOT EXISTS "shortDefinitionPronunciationOverride" JSONB DEFAULT NULL;
  ALTER TABLE dictionaryentries_es ADD COLUMN IF NOT EXISTS "shortDefinitionPronunciationOverride" JSONB DEFAULT NULL;
  ```
  着's old value (`{"definition": "'in-progress' particle", "pronunciation": "zhe"}`) is
  recorded in 166's header if it is ever wanted back.

## User-visible change

Heteronyms with no chosen sense now show their most common sense's reading on every surface
(IW bubbles, Reader, dictionary search, synonyms, Word Search bonus words, Speed Reading
audio). 着 reads `zhe` via its top cluster rather than via the dropped override.
