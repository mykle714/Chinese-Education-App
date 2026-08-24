# Gloss Groups Push (dev → prod, `gloss_meaning_groups`)

Push the GPU-pipeline-computed `gloss_meaning_groups` table from the dev box up to prod.
This is the **one table in the app whose source of truth is DEV**, inverting the
prod-is-authoritative rule every other data table follows — see
[`/data-prod-to-dev`](./data-prod-to-dev.md)'s own ⛔ warning against ever pulling this
table down, and [docs/GLOSS_CONFUSABILITY.md](../../docs/GLOSS_CONFUSABILITY.md) § 5a for
why the inversion is safe here and nowhere else.

**Direction is dev → prod, always.** There is no counterpart flow. Never restore a
`gloss_meaning_groups` dump into `cow-postgres-local` from anywhere but the pipeline
itself running on dev.

> Structurally this mirrors [`/data-prod-to-dev`](./data-prod-to-dev.md) with the halves
> swapped: here dev is SOURCE and prod is TARGET.

## What this unblocks

The runtime guard (§ 6 of the owner doc) is already built and deployed in
`OnDeckVocabService.getGameVocabPool`/`getWordSearchGrid`, but it is **inert** while
`gloss_meaning_groups` is empty on prod — every `glossKeyToGroup` lookup misses, so
behaviour stays byte-for-byte phase-1 (exact-dd only) until this push lands rows. This
skill is what turns phase 2 on.

## ⚠️ FIRST: Which machine are you on?

Read [amIOnTheProdMachine.md](../../amIOnTheProdMachine.md) (gitignored, present on every
machine).

- **On the DEV/GPU-pipeline box** → you are the SOURCE. Run every step below yourself.
- **On PROD** → you have no work to do here. You cannot run the pipeline or reach the dev
  Postgres instance from prod; hand the steps below to whoever is on the dev box, then
  return to this session to run [step 4](#4-verification-sql-run-against-prod) against
  prod once they confirm the push completed.

## 1. Pre-flight (on the dev box — every one of these is a read)

```bash
cd ~/vocabulary-app/server/scripts/gloss-pipeline
```

**1a. The dev table is built, non-empty, and internally consistent.**

```bash
docker exec cow-postgres-local psql -U cow_user -d cow_db -c '
  SELECT count(*) AS rows,
         count(DISTINCT "meaningGroupId") AS groups,
         count(DISTINCT "corpusSnapshot") AS snapshots,
         min("builtAt") AS built
    FROM gloss_meaning_groups;'
```

Note the counts — they are your baseline for the § 4 checks below. As of the 2026-08-24
build documented in the owner doc's § 8k this was `rows=7647, groups=5076`, but that
number moves every time the discoverable corpus or the pipeline changes; **read the live
count off this query, do not assume the doc's number is still current.**
`snapshots` must be exactly **1** — if it's more than 1, the build was interrupted or two
builds got merged. **Stop, re-run `cluster.py` on dev, do not push.**

**1b. Gold-set rates (§ 7 of the owner doc requires these be recorded on every push).**

```bash
~/.venvs/gloss-pipeline/bin/python validate.py
```

Expect a `must-block recall` rate, a `must-NOT-block wrong` rate, and a `group size
distribution:` line. **`must-NOT-block wrong` is the number that gates the push** —
recall slipping just means a missed suppression (invisible, harmless), but a rising
wrong-block rate means the runtime will refuse to pair two cards that mean *different*
things, which is a live gameplay regression. **If it is not 0, do not push.**

`cannot-link violations after clustering: 0` and `size alarm: clear` are printed by
`cluster.py` at **build** time, not by `validate.py` — check those on the build log for
the run that produced the snapshot you're about to push, not here.

Record the recall rate, the wrong-block rate, and the `corpusSnapshot` value somewhere
durable (a deploy note, a commit message on the pipeline repo state) — a rate is only
interpretable against the previous one.

**1c. Dry run — reads dev only, never contacts prod.**

```bash
cd ~/vocabulary-app/server && npx tsx scripts/gloss-pipeline/push-groups.ts --dry-run
```

Expect a `dev gloss_meaning_groups: <rows> rows, <groups> groups` line matching 1a, one
provenance line, then `--dry-run: prod not contacted, nothing written`.

## 2. The push

`push-groups.ts` is the only writer of prod's copy of this table, and the only script in
the repo that writes prod from dev — it is structurally scoped to this one table.

```bash
cd ~/vocabulary-app/server
PROD_DB_HOST=<host> PROD_DB_PASSWORD=<password> \
  npx tsx scripts/gloss-pipeline/push-groups.ts
```

Source `<host>`/`<password>` the same way [`/deploy`](./deploy.md) sources prod DB
credentials. **`PROD_*` variables only** — the script refuses to fall back to dev config,
so a missing variable fails loudly instead of silently pushing dev's table onto itself.

The write is `TRUNCATE` + batched `INSERT` in **one transaction**, so prod readers keep
seeing the previous snapshot (or empty, on the first push) until commit. It verifies the
row count after committing and throws on a mismatch — a throw mid-write means nothing
committed; re-run once the cause is fixed.

## 3. No migration, no deploy step, no ordering constraint

Migration 154 (the table itself) is already live on prod. This push writes rows into an
existing table that no other deploy step touches — it can run minutes or weeks after any
`/deploy`, in any order relative to a container rebuild, and does not itself require one.

## 4. Verification SQL (run against PROD)

```sql
-- 4a. Provenance: exactly one build, and it is the one you just pushed.
SELECT "modelRevision", "templateVersion", "corpusSnapshot",
       count(*) AS rows, count(DISTINCT "meaningGroupId") AS groups
  FROM gloss_meaning_groups
 GROUP BY 1, 2, 3;
```
Expect **exactly one row**, matching the counts and `corpusSnapshot` from step 1a/1c.
More than one row means the truncate did not take — re-run the push.

```sql
-- 4b. Known contrast pairs must land in DIFFERENT groups.
SELECT a."glossKey", a."meaningGroupId", b."glossKey", b."meaningGroupId",
       (a."meaningGroupId" = b."meaningGroupId") AS BROKEN
  FROM gloss_meaning_groups a, gloss_meaning_groups b
 WHERE (a."glossKey", b."glossKey") IN
       (('big','small'), ('to buy','to sell'), ('to come','to go'), ('hot','cold'));
```
Expect `broken = false` on every row. A `true` here means the wrong build was pushed —
the ids are copied verbatim, so this should be structurally impossible otherwise.

```sql
-- 4c. Size alarm, re-derived on prod. The largest real group in the 2026-08-24 build
-- was 11; nothing should exceed 12 (owner doc § 10 Q8).
SELECT "meaningGroupId", count(*) AS n
  FROM gloss_meaning_groups GROUP BY 1 HAVING count(*) > 12 ORDER BY n DESC;
```
Expect 0 rows.

```sql
-- 4d. Sanity: an intended near-miss cluster actually holds together.
SELECT "glossKey", "meaningGroupId" FROM gloss_meaning_groups
 WHERE "glossKey" IN ('a little', 'a bit', 'a little bit', 'somewhat') ORDER BY 2, 1;
```
Expect all four to share one id.

## 5. When a check fails

| Failure | Do this |
| --- | --- |
| 1a shows `snapshots > 1` | Re-run `cluster.py` on dev. Do not push. |
| 1b `must-NOT-block wrong` > 0 | **Do not push.** Investigate on dev — a wrong-block is a gameplay regression, and there is no hurry since prod is unaffected either way. |
| Push throws mid-write | Nothing was committed; the transaction rolled back. Prod still holds the previous snapshot (or is still empty). Fix and re-run. |
| 4a shows >1 provenance row | Re-run the push. If it persists, `TRUNCATE gloss_meaning_groups;` on prod and push again. |
| 4c shows an oversized group | Not a push failure — the alarm is doing its job. Leave the data in place (harmless, the runtime guard just skips groups it can't safely act on per the owner doc's size cap) and take it to the owner doc's § 10 Q8. |

## 6. Rollback

```sql
TRUNCATE gloss_meaning_groups;
```

With the table empty, the runtime guard's rule 1 ("no group id ⇒ no constraint")
degrades the app to phase-1 exact-dd behaviour with **no code change and no redeploy**.
`DROP TABLE` also works and is only needed when reverting migration 154 itself.

Nothing is lost by rolling back — the contents are a pure function of (det corpus, model
revision, template version, thresholds); rebuilding costs one GPU run on dev (~5 min end
to end per the owner doc § 4, plus the `validate.py` gold-set check). No user data lives
here, and prod never authors a row.

⚠️ Because the runtime guard is now live (unlike when the original data-only deploy of
migration 154 happened), this rollback **silently turns phase 2 off** rather than merely
reverting an inert table. After truncating, re-check the owner doc's § 6 to confirm what
"phase 2 off" should look like in the game boards before treating the rollback as done.

## 7. User-visible behaviour change to expect

Once this push lands non-empty rows and the runtime guard is deployed (both conditions
required — see the owner doc's status table), same-meaning near-miss card pairs (e.g. "a
little" / "a bit") stop appearing together on the same game board, the same way exact
duplicates already don't. No other behaviour changes; nothing here touches det, mastery,
or scoring.

## 8. Do NOT do these

- ❌ **Do not add `gloss_meaning_groups` to `/data-prod-to-dev`'s table list.** Its source
  of truth is dev — pulling it down overwrites dev's freshly computed groups with prod's
  copy of what dev just sent up, silently.
- ❌ **Do not create `gloss_vectors` / `gloss_pair_verdicts` on prod.** They are dev-only
  build caches (`dev-tables.sql`), deliberately not migrations. Prod runs no model and
  needs no GPU.
- ❌ **Do not hand-edit rows on prod.** The table is replaced wholesale on every push; a
  hand edit is silently overwritten by the next push and invalidates the provenance stamp
  in the meantime.
- ❌ **Do not push a build whose `corpusSnapshot` you cannot tie to a `validate.py` run.**
  The stamp is the only thread from a grouping on prod back to the evidence for it.

Full context: [docs/GLOSS_CONFUSABILITY.md](../../docs/GLOSS_CONFUSABILITY.md) § 5, § 5a, § 6, § 7, § 8k, § 10 Q8.
