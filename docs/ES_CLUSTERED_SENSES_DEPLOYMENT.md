# Deploying the Spanish Clustered-Senses Change (migration 123)

> Operational runbook for the change that makes `dictionaryentries_es.word1` unique and
> moves a Spanish word's POS/gender senses into `definitionClusters`. Read this **with**
> the `/deploy` skill — that skill owns the generic deploy procedure (ports, containers,
> `migrate.sh`, nginx); this document owns everything specific to THIS change.
>
> Design/behavior reference: [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md).
> Table identities: [../CLAUDE.md](../CLAUDE.md) § Dictionary Tables.

---

## 1. What ships

**Two migrations, and the order between them is load-bearing:**

| # | File | Owner | Why it matters here |
|---|---|---|---|
| 122 | `122-rename-vernacular-score-to-frequency-score.sql` | a **separate, pre-existing** workstream | Renames `vernacularScore` → `frequencyScore` on both det tables and inside the zh cluster jsonb |
| 123 | `123-es-word1-unique-clustered-senses.sql` | this change | Merges the es rows, adds `definitionClusters`, swaps both unique keys, drops 5 + 1 columns |

> ⚠️ **123 reads and writes `"frequencyScore"`. If 122 has not been applied, 123 fails
> immediately** with `column "frequencyScore" does not exist`, inside its transaction, and
> rolls back cleanly. The application code also assumes the renamed column everywhere. So:
> **122 must be committed and applied before 123, in the same deploy or an earlier one.**
> Verify before you start — see the pre-flight check in §3.

**Application code** (all of it typechecks clean; `npm run build` must pass before deploy):

- `server/dal/shared/dictJoin.ts` — both language branches are now identical bar the table
  name; `match_rank` removed; the es branch selects the real `definitionClusters` column.
- `server/dal/shared/vetTable.ts` — `vetReadFrom` no longer wraps the zh table in a
  subquery synthesizing a NULL `pos`.
- `server/dal/implementations/VocabEntryDAL.ts` + `IVocabEntryDAL.ts` — `findByUserAndKey`
  lost its `pos` parameter.
- `server/services/StarterPacksService.ts` — ~8 `isEs` POS branches removed across supply,
  hydrate, insert, undo and skipped-list paths.
- `server/dal/implementations/Icons8DAL.ts`, `IIcons8DAL.ts`, `Icons8Controller.ts`,
  `src/cardIcons/cardIconApi.ts` — the `/api/icons8/default-results` body no longer carries
  `pos`. **Old clients that still send it are fine** (the field is ignored), so there is no
  client/server version coupling to sequence.
- `src/components/PosBadge.tsx` + `.css` — **deleted**; usages removed from `SortCardsPage`
  and `InfoCardPanelBody`.
- `src/utils/definitionUtils.ts` — new `senseGrammarTag`; `FlashCardSection.tsx` renders a
  flat sense list with that tag when clusters carry no `reading` (es).
- `server/scripts/backfill/spanish/backfill-parts-of-speech.js` — **deleted**, replaced by
  `server/scripts/backfill/spanish/backfill-cluster-definitions.js`.
- Types: `DefinitionCluster` gains `gender`, `reading` becomes nullable; `pos` /
  `hasMultiplePos` / `alternateGender` / `alternateMeaning` removed from the entry shapes.

**No API route, request shape, or response field that an old client depends on is removed.**
The dropped response fields (`pos`, `hasMultiplePos`, …) are only read by code shipping in
the same bundle. A stale browser tab keeps working; it just still shows a POS badge until
reload.

---

## 2. What migration 123 actually does, in order

All of it inside **one transaction**. If any step fails, the whole thing rolls back and the
database is untouched.

1. `ADD COLUMN "definitionClusters" jsonb` (nullable).
2. Pick one **survivor** row per multi-row `word1`, ranked: `discoverable` → `frequencyScore`
   → POS priority (verbs, then nouns, then modifiers, then closed-class/interjections) →
   definition count → lowest id. The survivor defines the word's default sense.
3. Build one cluster per source row (`sense` = that row's lead gloss, plus its pos/gender,
   frequencyScore and glosses). Colliding labels within a word are suffixed with pos/gender.
4. Merge the siblings' data onto the survivor: arrays unioned or concatenated in rank order,
   `longDefinition`/`enrichmentLog` merged per key, every other column first-non-null,
   `discoverable` OR'd.
5. *(No vet `pos` → `selectedSense` migration — deliberate. See §6.)*
6. **Repoint soft id references** (`validations."entryId"`, `discover_skips."cardId"`,
   `sort_packs."entryIds"`) from losing rows onto their survivor, de-duplicating against the
   unique constraints on the first two.
7. `DELETE` the losing rows; swap `uq_es_word1_pos_gender` → `uq_es_word1_language`; drop the
   now-redundant `idx_es_word1`.
8. Drop `pos`, `gender`, `hasMultiplePos`, `alternateGender`, `alternateMeaning` from sdet.
9. Swap `vocabentries_es`'s unique key to `(userId, entryKey, language)` and drop its `pos`.

### Locking & runtime

The `ALTER TABLE` statements take an **ACCESS EXCLUSIVE** lock on `dictionaryentries_es` and
`vocabentries_es` for the whole transaction, so **every Spanish read blocks until it commits**
(Chinese is unaffected). Observed on dev's 121k-row table:

- **with fresh planner statistics: well under a minute**;
- **on a freshly restored table with no statistics: ~4 minutes.**

So **run `ANALYZE dictionaryentries_es;` immediately before the migration** — it costs seconds
and is the difference between the two figures above. Expect a short Spanish-side outage; do
this in the same window as the container restart rather than as a separate live event.

### Idempotency

`ADD COLUMN IF NOT EXISTS`, `DROP … IF EXISTS`, and the merge steps all no-op on a second run
(no word has >1 row any more). **The one statement that is NOT re-runnable is
`ADD CONSTRAINT uq_es_word1_language`** — Postgres has no `IF NOT EXISTS` for it, so a second
run fails there and rolls back. That is a safe failure (nothing is left half-applied) but it
means: **record the migration in `schema_migrations` so `migrate.sh` never retries it.**

---

## 3. Pre-flight checks (run these on PROD before deploying)

Prod's Spanish data is **not** the same data as dev's, so gather the real numbers rather
than assuming dev's. Report each result to the user before proceeding.

```bash
# a. Is migration 122 already applied? (MUST be yes, or ship 122 in this deploy ahead of 123)
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT column_name FROM information_schema.columns
   WHERE table_name='dictionaryentries_zh' AND column_name IN ('vernacularScore','frequencyScore');"
#    -> expect 'frequencyScore'. If you see 'vernacularScore', 122 is pending: apply it first.

# b. Which migrations does prod have? (authoritative)
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT max(version) FROM schema_migrations;"

# c. Scale of the merge on prod — record before/after
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT count(*) AS rows, count(DISTINCT word1) AS words,
         count(*) - count(DISTINCT word1) AS rows_to_delete
    FROM dictionaryentries_es;"

# d. Spanish learners affected: every one of these cards moves to its word's DEFAULT sense
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT count(*) AS es_cards, count(DISTINCT \"userId\") AS users,
         count(*) FILTER (WHERE pos IS NOT NULL) AS cards_with_pos
    FROM vocabentries_es;"

# e. Would any two of a user's cards collide under the new (userId, entryKey, language) key?
#    MUST return 0 rows — if not, STOP and see §7.
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT \"userId\", \"entryKey\", count(*) FROM vocabentries_es
   GROUP BY 1,2 HAVING count(*) > 1;"

# f. Soft references to es det ids (the migration remaps these automatically; this is
#    just so you can verify the counts survive)
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT (SELECT count(*) FROM validations    WHERE language='es') AS es_validations,
         (SELECT count(*) FROM discover_skips WHERE language='es') AS es_skips,
         (SELECT count(*) FROM sort_packs     WHERE language='es') AS es_sort_packs;"
```

### Check (e) is the one that can stop the deploy

The old vet key was `(userId, entryKey, language, pos)`, so **a learner could hold the same
Spanish spelling twice** — `vivir`(v) and `vivir`(n) as two separate cards. The new key
forbids that, and `ADD CONSTRAINT vocabentries_es_user_key_language_unique` will fail on any
such pair, rolling the migration back.

Dev had zero collisions (28 cards, 28 distinct pairs). **If prod returns any rows, do not
improvise a fix — report the list to the user and ask which card to keep.** The two cards
have independent review histories (`typedMarkHistory`, `totalMarkCount`) and possibly
independent icon layouts, so merging them is a product decision, not a mechanical one. The
mechanical option, once the user approves it, is to keep the row with the most review
history and delete the other:

```sql
-- ONLY after the user picks this policy.
DELETE FROM vocabentries_es ve
USING vocabentries_es keep
WHERE ve."userId" = keep."userId" AND ve."entryKey" = keep."entryKey"
  AND ve.language = keep.language AND ve.id <> keep.id
  AND (keep."totalMarkCount", keep.id) > (ve."totalMarkCount", ve.id);
```

---

## 4. Backups

The generic deploy takes no data backup. **This migration deletes rows, so take one**, before
anything else, and keep it until §6's verification passes:

```bash
docker exec cow-postgres-prod pg_dump -U cow_user -d cow_db \
  -t dictionaryentries_es -t vocabentries_es \
  -t validations -t discover_skips -t sort_packs \
  --format=custom > ~/es-pre-123-$(date +%Y%m%d-%H%M).dump
```

The last three tables are included because step 6 rewrites ids inside them.

---

## 5. Deploy sequence

Follow `/deploy` for the container/build mechanics. The migration-specific ordering is:

```bash
cd ~/vocabulary-app
git pull origin main
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up --build -d

# --- migrations, in this order ---

# 122 FIRST (if pre-flight (a) showed it pending)
docker cp database/migrations/122-rename-vernacular-score-to-frequency-score.sql cow-postgres-prod:/tmp/
docker exec cow-postgres-prod psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 -f /tmp/122-rename-vernacular-score-to-frequency-score.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c \
  "INSERT INTO schema_migrations (version, name) VALUES (122, '122-rename-vernacular-score-to-frequency-score.sql') ON CONFLICT DO NOTHING;"

# Fresh planner stats — turns a ~4-minute exclusive lock into well under a minute
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "ANALYZE dictionaryentries_es;"

# 123
docker cp database/migrations/123-es-word1-unique-clustered-senses.sql cow-postgres-prod:/tmp/
docker exec cow-postgres-prod psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 -f /tmp/123-es-word1-unique-clustered-senses.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c \
  "INSERT INTO schema_migrations (version, name) VALUES (123, '123-es-word1-unique-clustered-senses.sql') ON CONFLICT DO NOTHING;"

# Refresh stats over the merged table before real traffic hits it
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "ANALYZE dictionaryentries_es; ANALYZE vocabentries_es;"
```

`migrate.sh` also works and does the `schema_migrations` bookkeeping for you; the explicit
form above is written out so the `ANALYZE` can sit between the two migrations.

**Expected `psql` output for 123** — the row counts will differ from dev's, but the shape and
the statement sequence should match exactly. There is no `ROLLBACK`, and the last line is
`COMMIT`:

```
BEGIN … ALTER TABLE … COMMENT
SELECT <2× rows_to_delete-ish>   -- rows belonging to multi-row words
CREATE INDEX ×2
SELECT <n multi-row words>
UPDATE <n multi-row words>       -- survivors merged
SELECT <rows_to_delete>          -- id remap table
CREATE INDEX
DELETE/UPDATE ×5                 -- soft-reference remap (mostly 0 on a prod with no es refs)
DELETE <rows_to_delete>          -- losing rows
ALTER TABLE ×2, DROP INDEX, ALTER TABLE ×4
COMMIT
```

### Migration number gap

There is **no migration 121** — this change was drafted as 121 and renumbered to 123 so it
would sort after 122. `migrate.sh` applies everything numbered above `MAX(version)` in `sort -V`
order, so a gap is harmless. Do not create a 121 to fill it.

---

## 6. Post-deploy verification

```sql
-- 1. word1 is unique, and the row count dropped by exactly rows_to_delete
SELECT count(*) AS rows, count(DISTINCT word1) AS words FROM dictionaryentries_es;   -- must be equal

-- 2. The dropped columns are gone and the new one is present
SELECT column_name FROM information_schema.columns
 WHERE table_name='dictionaryentries_es'
   AND column_name IN ('pos','gender','hasMultiplePos','alternateGender','alternateMeaning','definitionClusters');
-- expect exactly one row: definitionClusters

-- 3. Constraints swapped
SELECT conname FROM pg_constraint
 WHERE conrelid IN ('dictionaryentries_es'::regclass,'vocabentries_es'::regclass) AND contype='u';
-- expect uq_es_word1_language + vocabentries_es_user_key_language_unique

-- 4. Seeded clusters look sane on a known polyseme
SELECT word1, definitions->>0 AS dd,
       (SELECT jsonb_agg(c->>'sense') FROM jsonb_array_elements("definitionClusters") c) AS senses
  FROM dictionaryentries_es WHERE word1 IN ('cura','perro','leche','comer');
-- perro's dd must be the DOG sense, not "awful"; comer's must be "to eat", not "eating, food".
-- If a word defaults to an obviously secondary sense, that is a survivor-ranking miss —
-- it is cosmetic and the AI clusterer in §8 corrects it. Note it, don't roll back.

-- 5. Every soft reference still resolves (counts must match pre-flight (f))
SELECT 'skips' AS src, count(*) FILTER (WHERE de.id IS NULL) AS dangling
  FROM discover_skips ds LEFT JOIN dictionaryentries_es de ON de.id = ds."cardId"
 WHERE ds.language='es'
UNION ALL
SELECT 'validations', count(*) FILTER (WHERE de.id IS NULL)
  FROM validations v LEFT JOIN dictionaryentries_es de ON de.id = v."entryId" WHERE v.language='es'
UNION ALL
SELECT 'sort_packs', count(*) FILTER (WHERE de.id IS NULL)
  FROM sort_packs sp, unnest(sp."entryIds") e(elem)
  LEFT JOIN dictionaryentries_es de ON de.id = e.elem WHERE sp.language='es';
-- all three dangling counts must be 0
```

**Then exercise the app** (both languages — the join changed for zh too, even though its data
did not): log in as a Spanish learner and a Chinese learner and confirm the flashcards page,
the discover/sort flow, and a dictionary lookup all render. A Spanish word with several senses
should now show the sense-picker dropdown with a grammar tag (`n · m`) on each row.

---

## 7. Rollback

The migration is transactional, so a **failure** needs no rollback — nothing was applied.
Rolling back a **successful** migration means restoring the dump from §4, because the merge is
not reversible in SQL (the losing rows are gone):

```bash
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c \
  "DROP TABLE dictionaryentries_es CASCADE; DROP TABLE vocabentries_es CASCADE;"
docker exec -i cow-postgres-prod pg_restore -U cow_user -d cow_db --no-owner < ~/es-pre-123-<stamp>.dump
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c \
  "DELETE FROM schema_migrations WHERE version = 123;"
```

⚠️ That restore also rewinds `validations`, `discover_skips` and `sort_packs` to the dump —
**any zh activity in those tables since the dump is lost.** Only do the full restore if the
es data is genuinely wrong. Because the code deploy and the migration are independent, the
usual smaller remedy is to **revert the code** (`git revert` the deploy commit, rebuild) and
leave the migrated data in place: the merged rows are valid data that the previous code
cannot read correctly, so this is a stop-gap, not a resting state. Prefer fixing forward.

---

## 8. After the deploy: run the Spanish clusterer

The migration seeds **mechanical** clusters — one per old row, one cluster per (pos, gender),
with the source's own gloss as the sense label. That is lossless but crude. The AI clusterer
refines the discoverable words into real senses with per-sense frequency scores, which is also
what fixes any survivor-ranking miss found in verification step 4.

**This is a separate, optional, billable step — confirm with the user before running it.**
It calls Opus + Sonnet per word (843 words in scope on dev; check prod's count first —
single-gloss words take a zero-API-call fast path, so the billable subset is smaller).

```bash
# How many words are in scope on prod
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "
  SELECT count(*) FROM dictionaryentries_es
   WHERE language='es' AND discoverable AND jsonb_array_length(definitions) > 0
     AND NOT (\"enrichmentLog\" ? 'spanish/backfill-cluster-definitions');"

# Always dry-run a sample first and show the user the output
server/scripts/backfill/run-prod.sh scripts/backfill/spanish/backfill-cluster-definitions.js --spot-check

# Then a narrow live run, then the full run
server/scripts/backfill/run-prod.sh scripts/backfill/spanish/backfill-cluster-definitions.js --words=cura,perro,leche
server/scripts/backfill/run-prod.sh scripts/backfill/spanish/backfill-cluster-definitions.js
```

- It only UPDATEs `definitionClusters` + `partsOfSpeech` on one row — never inserts, deletes,
  or changes `discoverable`, and never touches `definitions`. Safe to interrupt and resume.
- Its "already done" gate is the `enrichmentLog` stamp, **not** `definitionClusters IS NULL`
  (the migration's seeds are non-NULL but unstamped, and must be re-clustered).
- **Grep the output for `⚠ CLUSTER REVIEW`** and surface those lines to the user — the model
  self-flags uncertain sense boundaries, genders and broken source glosses. On dev it flagged
  real issues (e.g. `perro` "clothes peg" being regional/uncommon).
- Skips any word whose `definitions` a validator has approved or flagged.

Long-definitions and example-sentences read cluster `sense` labels, so if you re-cluster words
that already have those, they will describe stale sense labels until regenerated. For the
words in scope here that content is regenerated by the normal §B pipeline in
`/mark-discoverable`.

---

## 9. Behavior changes worth telling the user about

1. **Every existing Spanish card moves to its word's default sense.** Vet `pos` was NOT
   migrated into `selectedSense`, on purpose: on dev the stored values were demonstrably
   wrong (`leche`, `hombre` and `amigo` were all saved as `interj`, and `amigo` has no
   interjection row in the dictionary at all — so the value cannot have come from the row the
   card was displaying). Migrating it faithfully would have pinned learners' cards to "shit"
   for `leche` and "awful" for `perro`. Learners re-pick a sense once and it persists as a
   stable label. Pre-flight (d) tells you how many cards this touches on prod.
2. **A learner can no longer hold one Spanish spelling as two cards.** One word, one card,
   with a sense picker.
3. **The POS badge is gone.** Spanish headwords no longer show "(v)"/"(n)"; the disambiguation
   moved into the sense-picker rows as a grammar tag ("n · m").
4. **Some Spanish cards will show a different definition than before** wherever the merged
   row's default sense differs from the row that card used to resolve to.

---

## 10. Known loose end (not blocking)

The **dev** database has migrations 122 and 123 applied but **not recorded** in
`schema_migrations` (it sits at 120), because both were applied by hand during development.
Running `migrate.sh` on dev would therefore retry them and fail on 123's `ADD CONSTRAINT`. Fix
dev bookkeeping with:

```bash
docker exec cow-postgres-local psql -U cow_user -d cow_db -c "
  INSERT INTO schema_migrations (version, name) VALUES
    (122, '122-rename-vernacular-score-to-frequency-score.sql'),
    (123, '123-es-word1-unique-clustered-senses.sql')
  ON CONFLICT DO NOTHING;"
```

This is dev-only housekeeping and has no bearing on the prod deploy.
