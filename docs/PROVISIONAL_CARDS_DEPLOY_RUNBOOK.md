# ⚠️ TEMPORARY — Provisional Cards deploy runbook

**Delete this file once verified on prod.**
**Deployed to prod yet? NO.**

Covers migration **140** (`140-add-provisional-bucket-to-vocabentries.sql`) and the
baseline/provisional-card rework. Full design: [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md).

---

## Why this needs a runbook

There is an **ordering constraint between the DB and the code**. The new code inserts
vet rows with `starterPackBucket = 'provisional'`, a value the current prod CHECK
constraint **rejects**. If the code ships first, every game and flp entry that needs a
top-up throws a constraint violation.

The migration is otherwise safe to auto-run and is **not** held back from `migrate.sh` —
it just has to land **before** the new backend starts.

Migration 140 is backward compatible on its own: widening a CHECK breaks nothing, and
old code simply never writes the new value. So the safe order is DB first.

---

## Step order

1. **Pre-deploy dump** (standard `/deploy` step). Migration 140 only widens a CHECK and
   adds two partial indexes, but the rollback path deletes rows, so take the dump.

2. **Run migrations** — `migrate.sh` picks up 140 with no special handling.
   ⚠️ Note 137, 138 and 139 are also unshipped at time of writing; 140 is independent of
   all three and can run in any order relative to them.

3. **Verify the constraint landed** (SQL below) — do this *before* starting the new code.

4. **Deploy the backend + frontend** as normal.

5. **Post-deploy verification** (SQL + UI below).

---

## Verification SQL

### After step 2 — constraint widened

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN ('chk_zh_starter_pack_bucket','chk_es_starter_pack_bucket');
```

**Expected:** two rows, each `CHECK (... = ANY (ARRAY['library','skip','provisional']))`.

If either still shows only `('library','skip')`, migration 140 did not apply — **stop**,
do not start the new backend, and re-run the migration.

```sql
SELECT indexname FROM pg_indexes
WHERE indexname IN ('idx_vocabentries_zh_provisional','idx_vocabentries_es_provisional');
```

**Expected:** both rows present.

### After step 4 — provisioning actually works

Pick a real account with a small zh deck (or make one), sign in, and open **Bubble
Match**. Then:

```sql
SELECT "starterPackBucket", count(*)
FROM vocabentries_zh
WHERE "userId" = '<user-uuid>'
GROUP BY 1;
```

**Expected:** a `provisional` row count that brings `library + provisional` up to **20**
(the Bubble Match baseline). A user who already had ≥20 sorted cards gets **no**
provisional rows — that is correct, not a failure.

Check the words chosen are sensible (level-appropriate, common):

```sql
SELECT ve."entryKey", de."difficulty", de."frequencyScore"
FROM vocabentries_zh ve
JOIN dictionaryentries_zh de ON de.word1 = ve."entryKey" AND de.language = ve.language
WHERE ve."userId" = '<user-uuid>' AND ve."starterPackBucket" = 'provisional'
ORDER BY de."difficulty", de."frequencyScore" DESC;
```

**Expected:** tightly clustered around the user's level, `frequencyScore` mostly 4–5.
For a brand-new account this should be level-1 words like 一 / 一下 / 三 / 上.

### Leak check — the most important one

Provisional cards must be invisible to every deck surface. With the same user:

```sql
-- What the decks page reports as deck size (must EXCLUDE provisional).
SELECT compute_utcm_category(ve."typedMarkHistory", u."readingGoal", u."writingGoal") AS category,
       count(*)
FROM vocabentries_zh ve
JOIN users u ON u.id = ve."userId"
WHERE ve."userId" = '<user-uuid>'
  AND ve.language = 'zh'
  AND ve."starterPackBucket" = 'library'
GROUP BY 1;
```

**Expected:** matches the counts shown on `/flashcards/decks` exactly. If the decks page
shows MORE than this, a `vetSortedClause()` is missing somewhere — see the
classification table in PROVISIONAL_CARDS.md §2.

**UI leak checks** (all must show *only* sorted cards):
the decks page deck list and counts, the deck search bar, reader word highlighting,
the eip Shared-Characters / Used-In tabs, and the community feed.

### Sort promotion preserves progress

Play a round so a provisional card takes at least one mark, then sort it via the
end-of-round **"Keep these cards"** button.

```sql
SELECT "entryKey", "starterPackBucket", "totalMarkCount", "typedMarkHistory"
FROM vocabentries_zh
WHERE "userId" = '<user-uuid>' AND "entryKey" = '<the-word>';
```

**Expected:** `starterPackBucket = 'library'`, and `totalMarkCount` /
`typedMarkHistory` **unchanged** from before the sort. A reset history means the
promotion path deleted-and-recreated instead of updating in place — a real bug, report it.

Then hit **Undo** in the sort flow and re-run the query.

**Expected:** back to `'provisional'` with the history **still intact** (not deleted),
because the row has marks.

---

## What to do when a check fails

| Failure | Action |
|---|---|
| Constraint still `('library','skip')` after step 2 | Do **not** start the new backend. Re-run migration 140. Old code is unaffected. |
| Games throw `chk_*_starter_pack_bucket` violations | The code started before the migration. Run migration 140 now; no restart needed, the next request succeeds. |
| Decks page count > the sorted-only SQL count | A vet read is missing `vetSortedClause()`. Not data corruption — no rollback needed. Patch the query and redeploy. |
| Marks reset after sorting a provisional card | Promotion path bug. Data loss is limited to that card's history. Roll back the code (not the DB) and investigate. |
| No provisional rows created for an empty-deck user | Check the backend log for `[Provisional] Lent …`. If absent, the `surface` param isn't reaching the endpoint or the supply gate (`sortable = TRUE` for zh) matches nothing on prod. |

---

## Rollback

**Code-only rollback is safe and sufficient for most problems.** Old code ignores
`'provisional'` rows in most reads — but note those rows would then be *invisible*
everywhere while still occupying `(userId, entryKey, language)`, so the affected words
could not be sorted normally. If you roll the code back and intend to stay there, also
clean up the rows:

```sql
BEGIN;
DELETE FROM vocabentries_zh WHERE "starterPackBucket" = 'provisional';
DELETE FROM vocabentries_es WHERE "starterPackBucket" = 'provisional';
COMMIT;
```

⚠️ This **discards any marks** learners earned on lent cards. Check the blast radius first:

```sql
SELECT count(*) FROM vocabentries_zh
WHERE "starterPackBucket" = 'provisional' AND "totalMarkCount" > 0;
```

The full DB rollback (dropping the value from the CHECK) is in the DOWN block at the
bottom of the migration file. Only needed if you are reverting the schema entirely.

---

## User-visible behaviour changes to expect

* **No game or flp entry point can block on card count any more.** Support reports of
  "the Play button does nothing" should disappear.
* New/small-deck learners see a **"Here are some cards to play with"** popup before a
  round, and a **"Keep these N cards"** button after it.
* The `/flashcards/decks` **"add at least 20 cards"** toast is gone entirely.
* Word Search's "you need cards with distinct characters" message is replaced by a
  genuine-dead-end message that should now be very rare.
* Match Speed **Review** (Comfortable+Mastered) is playable by learners with no mastery
  progress yet — it falls back across all four buckets rather than blocking. **Challenge**
  (Unfamiliar+Target) is filled directly by lent cards, which are Unfamiliar.
* On `/flashcards/decks`, **Challenge is never greyed out any more** (its buckets are what
  provisioning fills). **Review is still greyed** until the learner has a Comfortable or
  Mastered card — that is intended, not a regression.
* Deck sizes on `/flashcards/decks` are **unchanged** — they still count sorted cards only.
