# Example-sentence target index + per-occurrence tags — deploy runbook (no migration)

> **TEMPORARY.** Delete this file once PPE is verified (step 4 passes and someone has
> opened 了's est on PPE and seen 心中**了**然 underlined, not 听**了**).
>
> **Status: NOT YET DEPLOYED to PPE** (written 2026-10-09). Dev is partially healed
> (~38 of the ~135 affected words; the dev heal was stopped early on purpose). Do not
> trust this line on its own: check with the SQL in step 1.

Feature doc: [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) § Repeated segments.

## What ships

* **Backfill** `server/scripts/backfill/chinese/backfill-example-sentences.js` →
  `SCRIPT_VERSION 8`. The generator wraps the demonstrated target occurrence in 【】
  (`applyTargetMarker` → stored `vocabCharIndex`). The tagging pass labels a repeated
  segment string per occurrence (`buildTagItems` → stored `segmentOccurrenceTags`).
  There is a new heal mode, `--locate-targets`.
* **Read path** `DictionaryDAL.enrichExampleSentencesMetadataBatch` →
  `buildOccurrenceSegmentMetadata` (`server/dal/shared/segmentString.ts`) ships a
  sparse `segmentMetadataByIndex`.
* **Client** `src/components/SegmentedSentenceDisplay.tsx` underlines at
  `vocabCharIndex`, and prefers the per-occurrence metadata and tags.
* `rewrite-parenthetical-glosses.js` → `retagTargetOccurrence` (keeps the new tag in
  step).

## Why this is not a plain `/deploy`

There is no schema change. Every new field lives inside the existing
`dictionaryentries_zh."exampleSentences"` jsonb, and every reader treats it as
optional. So the code can deploy in any order, and old rows render exactly as before
(first-occurrence underline).

The fix only becomes **visible** after a **manual data step**: the `--locate-targets`
heal over PPE's stored sentences. `/deploy` does not run it, and PPE is the source of
truth for det data, so dev's healed rows never reach PPE (and the next
`/data-ppe-to-dev` pull overwrites dev's partial heal with PPE's copy).

**Deliberately NOT bumped:** `shared/lib/requiredScripts.js` stays at
`chinese/backfill-example-sentences` **version 7**. Bumping it would make every v7 row
stale, and `run-lazy-enrichment` would then **regenerate the whole sentence corpus**
for a change that affects ~0.4% of sentences. Do not "fix" the mismatch between the
script (8) and the manifest (7).

## Steps

### 1. Pre-checks (on PPE, after the normal `/deploy` divergence check)

```bash
git status --short          # PPE usually has local work — commit/push it first (docs/DEPLOY_RUNBOOKS.md)
docker exec cow-backend sh -c 'test -n "$ANTHROPIC_API_KEY" && echo key-present'   # heal makes live API calls
```

Baseline (save the numbers):

```sql
-- docker exec -i cow-postgres psql -U cow_user -d cow_db
WITH s AS (
  SELECT d.word1, e
  FROM dictionaryentries_zh d, jsonb_array_elements(d."exampleSentences") e
  WHERE d.language = 'zh' AND jsonb_typeof(d."exampleSentences") = 'array'
)
SELECT
  count(*) FILTER (WHERE (length(e->>'foreignText') - length(replace(e->>'foreignText', word1, ''))) / length(word1) >= 2)                              AS headword_repeats,
  count(*) FILTER (WHERE (length(e->>'foreignText') - length(replace(e->>'foreignText', word1, ''))) / length(word1) >= 2 AND NOT (e ? 'vocabCharIndex')) AS unhealed,
  count(*) FILTER (WHERE e ? 'segmentOccurrenceTags')                                                                                                  AS with_occurrence_tags
FROM s;
```

**Expected before the heal:** `headword_repeats` ≈ 150 (dev showed 149),
`unhealed` = `headword_repeats`, `with_occurrence_tags` = 0. A non-zero
`with_occurrence_tags` just means the oracle cron already regenerated some rows
under v8. That is fine.

### 2. Deploy the code

Run the normal `/deploy`. No migration. The backend rebuild is the only thing that
matters for the read path, and the frontend rebuild is the only thing that matters
for the underline.

### 3. Run the heal (on PPE)

Dry run on one word first. It must print 弄不【了】 and 心中【了】然 (not 复杂【了】 or
听【了】):

```bash
docker exec cow-backend npx tsx scripts/backfill/chinese/backfill-example-sentences.js \
  --locate-targets --words=了 --dry-run
```

Then the full heal (~150 sentences, about 3 Sonnet calls each: locate, segmentation
audit, tag; on the order of a dollar; ~10 min):

```bash
docker exec cow-backend npx tsx scripts/backfill/chinese/backfill-example-sentences.js \
  --locate-targets 2>&1 | tee /tmp/locate-targets.log
```

It is idempotent: a sentence that already has `vocabCharIndex` is skipped, so it is
safe to re-run or to resume after an interruption. It never changes sentence text and
does not re-stamp rows. Human approvals (which compare `foreignText`/`english`) are
unaffected.

Optional, wider: add `--repeated-segments` to also re-tag sentences where some
*other* segment repeats (two 的, two 是). That set is much larger and mostly
harmless, so run it only if wanted, and dry-run it first to see the count.

### 4. Verify

Re-run the step-1 SQL. **Expected:** `unhealed` drops to a small residue (dev:
about 10% of the affected sentences). The residue is the sentences the log reports as
`⚠ could not locate target`. Those use the word twice **on purpose**
(一会儿…一会儿, 韩国的合气道和日本的合气道), so there is no single right occurrence
and they keep the first-occurrence underline. `with_occurrence_tags` rises by roughly
the healed count.

Spot check:

```sql
SELECT e->>'foreignText', e->>'vocabCharIndex'
FROM dictionaryentries_zh d, jsonb_array_elements(d."exampleSentences") e
WHERE word1 = '了' AND e ? 'vocabCharIndex';
```

**Expected:** the 弄不了 sentence → the offset of its *last* 了, and the 心中了然
sentence → the offset of the 了 before 然. Count code points (dev: 13 and 11 for
the same two sentences). PPE's sentence text may differ from dev's.

Then, in the app: open 了 → eip → est. The underline sits under 了然's 了, and tapping
听了's 了 shows the particle gloss with pinyin *le*, not "to understand".

**If a check fails:** if `unhealed` barely moved, read `/tmp/locate-targets.log`.
`FAILED:` lines are row-level errors (often API/key problems), so fix and re-run.
Step 3 is resumable.

## Rollback

* **Code:** revert the commit and redeploy. Old code ignores the new jsonb fields,
  so no data step is needed.
* **Data (only if the heal itself is wrong):** the heal does not change text, so
  stripping its fields restores pre-heal rendering exactly:

  ```sql
  UPDATE dictionaryentries_zh d
  SET "exampleSentences" = (
    SELECT jsonb_agg(e - 'vocabCharIndex' - 'segmentOccurrenceTags' ORDER BY ord)
    FROM jsonb_array_elements(d."exampleSentences") WITH ORDINALITY AS t(e, ord)
  )
  WHERE language = 'zh' AND jsonb_typeof("exampleSentences") = 'array'
    AND "exampleSentences"::text LIKE ANY (ARRAY['%vocabCharIndex%', '%segmentOccurrenceTags%']);
  ```

  This also strips the fields from any row the oracle cron regenerated under v8. That
  is harmless: those rows just fall back to the old behaviour.

## User-visible behaviour change

* In sentences that repeat the headword, the underline moves to the demonstrated
  occurrence.
* Each occurrence of a repeated word gets its own popup gloss, pinyin and word form.
  Previously all occurrences shared the target's sense.
* Known gap, unchanged: 了然 in 了's own sentences still renders as 了 + 然, because
  `prioritySegments` forces the headword to win segmentation. The tag on 了 is right;
  only the word boundary is not.
