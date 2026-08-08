# Per-Sense Commonality — Deploy Runbook

> **TEMPORARY.** Delete this file once prod is verified.
> **Status: NOT YET DEPLOYED TO PROD.**

Covers migration **139** (`139-add-sense-label-to-validations.sql`) and the code that
makes the eip/cdp "Commonality" chip show the **selected sense's** score instead of the
entry's, with its own per-sense Approve/Flag.

Why this needs a runbook rather than a plain `/deploy`: migration 139 **drops and
recreates `validations_unique_per_user`**, and the new code's `ON CONFLICT ON CONSTRAINT
validations_unique_per_user` upsert assumes the WIDE key. Run the migration **before**
the new backend starts, and never leave the constraint dropped.

---

## Step order

1. **Pre-deploy snapshot of `validations` only** (small table, cheap insurance — it is
   the one table here that cannot be regenerated):
   ```bash
   pg_dump -U <user> -d <db> -t validations -Fc -f validations-pre-139.dump
   ```
2. **Run migrations normally.** 139 is safe to auto-run via `migrate.sh` — nothing is
   held back. It is idempotent (`ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`).
3. **Verify the schema** (SQL below) *before* starting the new backend.
4. **Deploy the code** (`/deploy` as usual). Frontend + backend ship together; there is
   no expand/contract window and no backfill to run.

There is no data backfill: every existing `validations` row takes `senseLabel = ''` from
the column DEFAULT, which is exactly the entry-level semantics it already had.

---

## Verification SQL

**A. Column and constraint are in place.**
```sql
SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'validations' AND column_name = 'senseLabel';
```
Expected: exactly one row — `senseLabel | NO | ''::text`.

```sql
SELECT pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname = 'validations_unique_per_user';
```
Expected: `UNIQUE ("entryId", language, field, "senseLabel", "validatorUserId")`.
**If `senseLabel` is missing from that list, stop** — the upsert in
`ValidationService.submitEntryValidation` will overwrite one sense's vote with another's.

**B. No pre-existing row was disturbed.**
```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE "senseLabel" = '') AS entry_level
  FROM validations;
```
Expected: `total = entry_level` immediately after the migration (nothing per-sense exists
until a validator votes on a sense).

**C. After a validator has used the new chip** (smoke test — optional but recommended):
```sql
SELECT field, "senseLabel", action, left(content, 60) AS body
  FROM validations
 WHERE field = 'senseFrequencyScore'
 ORDER BY "createdAt" DESC LIMIT 5;
```
Expected: `senseLabel` is a sense phrase (e.g. `to reckon accounts`), and for an
`approve` the body reads `Commonality (<that same label>): N/5`. A mismatch between the
label column and the label inside the body means the compose path and the key path
disagree — file it, the read-path flag will simply never light up.

---

## When a check fails

| Symptom | Cause | Action |
|---|---|---|
| Constraint still shows the 4-column key | Migration 139 didn't run (or errored after the DROP) | Re-run 139 — it is idempotent. **Confirm a constraint exists at all** before letting traffic in; a missing constraint makes every upsert insert a duplicate row |
| `senseLabel` column exists but is nullable | Someone hand-applied a partial version | `ALTER TABLE validations ALTER COLUMN "senseLabel" SET DEFAULT ''; UPDATE validations SET "senseLabel" = '' WHERE "senseLabel" IS NULL; ALTER TABLE validations ALTER COLUMN "senseLabel" SET NOT NULL;` then re-create the constraint |
| Commonality chip shows no Approve/Flag for a validator | Unrelated to 139 — that pair is hidden when the entry has no `language` (det-fallback entries) | Not a deploy failure |

---

## Rollback

Code rollback alone is safe and needs no DB change: the old backend ignores the
`senseLabel` column, and the widened constraint is strictly more permissive for the rows
it writes (all `senseLabel = ''`, which behaves exactly like the old key).

Only if you must fully revert the schema:
```sql
DELETE FROM validations WHERE field = 'senseFrequencyScore';  -- per-sense rows only
ALTER TABLE validations DROP CONSTRAINT validations_unique_per_user;
ALTER TABLE validations ADD CONSTRAINT validations_unique_per_user
  UNIQUE ("entryId", language, field, "validatorUserId");
ALTER TABLE validations DROP COLUMN "senseLabel";
```
The DELETE must come first — without it the narrow constraint can fail to build if one
validator reviewed two senses of the same word.

---

## User-visible behaviour change

- The **Commonality** chip on the eip definition tab and the cdp Definition box now
  tracks the sense picker on a clustered word. Switching senses changes the dots. On
  unclustered / single-sense words nothing changes.
- A word whose entry-level `frequencyScore` was approved will show the chip as
  **AI-generated (orange)** again if it is a clustered word — the per-sense score it now
  displays has not been reviewed by anyone. This is correct, not a regression; validators
  re-approve per sense.
- **Validators only:** the chip's Approve/Flag pair now records a vote against one sense.
  Each sense holds an independent vote, and switching senses refetches that sense's vote.

## Knock-on effect worth watching

Both `backfill-cluster-definitions` scripts (zh + es) now carry a `validatedClause`
guard on `senseFrequencyScore`. Because `definitionClusters` is rewritten as a whole
column, **one approved sense freezes re-clustering for that entire word**. Expect the
clusterer's candidate count to shrink as validators work. That is the intended safe
direction; see docs/DATA_VALIDATION_SYSTEM.md § Backfill guard for the note on what a
finer-grained fix would require.
