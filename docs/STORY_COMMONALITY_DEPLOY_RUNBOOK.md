# Story Commonality — Deploy Runbook

> ⚠️ **TEMPORARY.** Delete this file (and its row in [DEPLOY_RUNBOOKS.md](./DEPLOY_RUNBOOKS.md))
> once every check below has passed on PPE.
>
> **Status: NOT DEPLOYED** (written 2026-11-21). Design: [CYOA_FEATURE.md](./CYOA_FEATURE.md) § 6.2a.

## What ships

- **Migration 200** (expand, safe to auto-run): adds `stories.commonality` (smallint 1–5) and
  rebuilds `stories_published_list_idx` on it. The old code ignores the new column.
- **Migration 205** (contract; renumbered from 201 on 2026-11-23 so it is the highest in the
  batch): drops `stories.difficulty`. **Held back until after the rebuild.** The old code selects `difficulty` on every `/api/stories` read.
- **Backfill:** `server/scripts/backfill/cyoa/backfill-story-commonality.ts` fills
  `commonality` for stories already published (PPE has two: michael2's seed stories). It
  does not re-publish, so `publishedAt` is unchanged.
- Code, with changes learners can see:
  - **Adventures** shows a 5-circle commonality meter where "HSK n" used to be. The list is
    now ordered most-common first.
  - **eip**: the Difficulty meter is gone from the Definition tab, including the validators'
    Approve/Flag for difficulty.
  - **acp**: the level pill, its dropdown and the "DIFFICULTY" caption are gone. Levelling is
    always automatic.

## Step order

This deploy ships in ONE batch with three other additive migrations, which all go in BEFORE the
rebuild: **202** (Voice Tutor tables — [VOICE_ASSISTANT_DEPLOY_RUNBOOK.md](./VOICE_ASSISTANT_DEPLOY_RUNBOOK.md)),
**203** (the `'tracked'` vet bucket — [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) § "Tracked rows")
and **204** (Sentence Tiles — [SENTENCE_TILES_DEPLOY_RUNBOOK.md](./SENTENCE_TILES_DEPLOY_RUNBOOK.md)).
`migrate.sh` has no "stop at N" option, so the pre-rebuild migrations are applied by hand.

1. `git pull` on PPE. Do **NOT** run `migrate.sh` yet: it would apply 205 too.
2. Apply **200, 202, 203, 204**, by hand, each with its tracking row, in one transaction
   (run from the repo root on PPE):
   ```bash
   for f in 200-add-commonality-to-stories 202-create-voice-sessions 203-add-tracked-bucket-to-vocabentries 204-create-sentence-tiles; do
     v=${f%%-*}
     { echo "BEGIN;"; cat "database/migrations/$f.sql"; echo "INSERT INTO schema_migrations (version, name) VALUES ($v, '$f.sql');"; echo "COMMIT;"; } \
       | docker exec -i cow-postgres psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 || break
   done
   ```
   Check `migrate.sh --dry-run` now lists **205 only**.
3. Rebuild **both** containers (backend and frontend) per `/deploy`.
4. Run the backfill from the repo's `server/` directory:
   ```bash
   scripts/backfill/run-ppe.sh scripts/backfill/cyoa/backfill-story-commonality.ts
   ```
   Expected: one line per published story with `commonality = 1…5`, then `done.`
5. Run `migrate.sh`. It now applies **205** alone, in order (no flag needed).
6. Verification (below), plus the Voice and Sentence Tiles runbooks' checks.

## Verification

```sql
-- V1: the new column exists and the old one is gone (expect one row: commonality)
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'stories' AND column_name IN ('commonality', 'difficulty');
-- V2: every published story has a value (expect 0)
SELECT count(*) FROM stories WHERE "publishedAt" IS NOT NULL AND commonality IS NULL;
-- V3: the list index is on commonality (expect a definition containing "commonality DESC")
SELECT indexdef FROM pg_indexes WHERE indexname = 'stories_published_list_idx';
-- V4: migrations applied (expect 205)
SELECT max(version) FROM schema_migrations;
```

In the app:
- **V5** `/adventures` loads. Each published story card shows the circle meter and
  "Endings f/t". There is no "HSK" anywhere.
- **V6** In the editor, a published story's status line reads "Published · ●●●○○ — edits
  go live right away."

## If a check fails

- **V2 > 0 after step 4:** a story whose words have no `frequencyScore` stays NULL by design.
  Check its log line ("NULL (no scored words)"). Any other failure is in the script's output;
  re-run it (it is idempotent).
- **`/api/stories` 500s between steps 3 and 5:** 205 ran before the rebuild. Roll back by
  re-adding the column (`ALTER TABLE stories ADD COLUMN difficulty smallint CHECK (difficulty
  BETWEEN 1 AND 6);`) and finish the rebuild.
- **Rollback of the whole change** (before 205): redeploy the previous commit. 200's column
  is additive and the old code ignores it. After 205, a rollback also needs the column re-added
  as above. Its values are lost, but the old code recomputes them on the next publish.
