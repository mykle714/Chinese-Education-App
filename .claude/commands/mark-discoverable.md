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

### 1.5. Verify the chosen pronunciation is the most popular reading

A row in `dictionaryentries` has one `pronunciation` / `numberedPinyin` per word, but cedict often lists multiple readings (e.g. 说 has both `shui4` "persuade" and `shuo1` "speak"). The initial import sometimes picks a less popular reading, which would surface a wrong-meaning card to learners.

For each word about to be made discoverable, look up *all* cedict readings:

```bash
grep -P "^\S+\s+<HANZI>\s+\[" /home/cow/server/cedict_ts.u8
```

Compare each row's current `numberedPinyin` against the cedict readings. If the row's reading is **not** the most popular one (heuristic: shorter/sparser definition list, or clearly archaic/literary meaning), flag it to the user with the alternatives and proposed fix. Apply the fix BEFORE setting `discoverable = TRUE` so enrichment runs against the right pronunciation:

```sql
UPDATE dictionaryentries SET
  pronunciation = '<diacritic form>',
  "numberedPinyin" = '<numbered form>',
  definitions = '<cedict defs JSON for new pinyin>'::jsonb,
  tone = NULL, "hskLevel" = NULL, "longDefinition" = NULL, breakdown = NULL,
  synonyms = NULL, "exampleSentences" = NULL, expansion = NULL, classifier = NULL,
  "expansionLiteralTranslation" = NULL, "vernacularScore" = NULL,
  "shortDefinitionPronunciationOverride" = NULL,
  "exampleSentenceDefinitionPronunciationOverride" = NULL
WHERE id = <id>;
```

Nulling the enrichment columns lets the Step 3 pipeline regenerate everything against the corrected pronunciation. Skip the fix if the cedict alternatives are clearly archaic, literary, or rare (e.g. 六 has a literary `lu4` reading but `liu4` is correct for "six").

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
