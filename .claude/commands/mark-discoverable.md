# Mark Words as Discoverable

Given a list of Chinese words, set `discoverable = TRUE` and run the full 9-step enrichment pipeline scoped to those words.

## Arguments

The user provides words in any form: hanzi, numbered pinyin, or tone-marked pinyin. Convert numbered/pinyin to hanzi by querying the DB before proceeding.

## Steps

### 1. Resolve words to hanzi

If the user gave numbered pinyin or tone-marked pinyin, look up the hanzi first:

```sql
SELECT word1, pronunciation, "numberedPinyin" FROM dictionaryentries
WHERE language = 'zh' AND "numberedPinyin" = ANY(ARRAY['wei4 lai2', ...]);
```

Confirm the matches with the user before proceeding.

### 2. Set discoverable = TRUE

```sql
UPDATE dictionaryentries
SET discoverable = TRUE
WHERE word1 = ANY(ARRAY['未来', '摸脉', ...]) AND language = 'zh'
RETURNING id, word1, discoverable;
```

### 3. Run the full enrichment pipeline scoped to the words

Run all 9 steps in order with `--words=word1,word2,...`. Use the comma-joined hanzi list as the value.

**Step 1 — Tones (deterministic)**
```bash
docker exec cow-backend-local npx tsx scripts/backfill-tones.js --words=未来,摸脉
```

**Step 2 — Numbered Pinyin (deterministic)**
```bash
docker exec cow-backend-local npx tsx scripts/backfill-numbered-pinyin.js --words=未来,摸脉
```

**Step 3 — Breakdown (deterministic)**
```bash
docker exec cow-backend-local npx tsx scripts/backfill-dictionary-breakdown.js --words=未来,摸脉
```

**Step 4 — HSK Level (AI)**
```bash
docker exec cow-backend-local npx tsx scripts/backfill-hsk-level.js --words=未来,摸脉
```

**Step 5 — Long Definitions (AI)**
```bash
docker exec cow-backend-local npx tsx scripts/backfill-short-long-definitions.js --words=未来,摸脉
```

**Step 6 — Synonyms (AI)**
```bash
docker exec cow-backend-local npx tsx scripts/backfill-synonyms.js --words=未来,摸脉
```

**Step 7 — Example Sentences (AI)**
```bash
docker exec cow-backend-local npx tsx scripts/backfill-example-sentences.js --words=未来,摸脉
```

**Step 8 — Classifier (AI)**
```bash
docker exec cow-backend-local npx tsx scripts/backfill-classifier.js --words=未来,摸脉
```

**Step 9 — Vernacular Score (AI)**
```bash
docker exec cow-backend-local npx tsx scripts/backfill-vernacular-score.js --words=未来,摸脉
```

### 4. Verify enrichment

```sql
SELECT
  word1, tone, "hskLevel",
  "longDefinition" IS NOT NULL AS has_long_def,
  synonyms IS NOT NULL AS has_synonyms,
  "exampleSentences" IS NOT NULL AS has_examples,
  breakdown IS NOT NULL AS has_breakdown,
  classifier IS NOT NULL AS has_classifier,
  "vernacularScore" IS NOT NULL AS has_vernacular_score,
  discoverable
FROM dictionaryentries
WHERE word1 = ANY(ARRAY['未来', '摸脉']) AND language = 'zh';
```

All columns should be non-null and `discoverable = true`.

### 5. Remind the user to do a data deployment

After enrichment is complete, remind the user to run `/data-deploy` to push the changes to production.

## Notes

- Scripts run inside `cow-backend-local` via `npx tsx` — do not use `node` directly.
- The `--words` flag filters the SQL query; scripts skip entries where the enrichment column is already populated, so re-runs are safe.
- Full reference: `docs/newDictionaryEntriesBackfillInstructions.md`
