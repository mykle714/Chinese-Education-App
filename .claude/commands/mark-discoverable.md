# Mark Words as Discoverable

Set `discoverable = TRUE` for a list of words and run that language's full
enrichment pipeline scoped to those words. The procedure differs by language
because the dictionary tables differ — pick the section that matches.

## 0. Route by language

| Language | Table | Key | Pipeline |
|---|---|---|---|
| Chinese (`zh`) | `dictionaryentries_zh` | `word1` | §A — 10-step CJK pipeline |
| Spanish (`es`) | `dictionaryentries_es` | `(word1, pos)` (gender collapsed) | §B — 7-step es pipeline |

If the user doesn't say, infer from the script (Han characters → zh; Latin → es)
and confirm. Always read `amIOnTheProdMachine.md` first; on PROD, confirm writes.

---

# §A — Chinese (`dictionaryentries_zh`)

The user provides words as hanzi, numbered pinyin, or tone-marked pinyin. Convert
numbered/pinyin to hanzi by querying the DB before proceeding.

### A1. Resolve words to hanzi

```sql
SELECT word1, pronunciation, "numberedPinyin" FROM dictionaryentries_zh
WHERE language = 'zh' AND "numberedPinyin" = ANY(ARRAY['wei4 lai2', ...]);
```

Confirm the matches with the user before proceeding.

### A1.5. Verify the chosen pronunciation is the most popular reading

A row in `dictionaryentries_zh` has one `pronunciation` / `numberedPinyin` per word, but cedict often lists multiple readings (e.g. 说 has both `shui4` "persuade" and `shuo1` "speak"). The initial import sometimes picks a less popular reading, which would surface a wrong-meaning card to learners.

For each word about to be made discoverable, look up *all* cedict readings:

```bash
grep -P "^\S+\s+<HANZI>\s+\[" /home/cow/server/cedict_ts.u8
```

Compare each row's current `numberedPinyin` against the cedict readings. If the row's reading is **not** the most popular one (heuristic: shorter/sparser definition list, or clearly archaic/literary meaning), flag it to the user with the alternatives and proposed fix. Apply the fix BEFORE setting `discoverable = TRUE` so enrichment runs against the right pronunciation:

```sql
UPDATE dictionaryentries_zh SET
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

Nulling the enrichment columns lets the pipeline regenerate everything against the corrected pronunciation. Skip the fix if the cedict alternatives are clearly archaic, literary, or rare (e.g. 六 has a literary `lu4` reading but `liu4` is correct for "six").

### A2. Set discoverable = TRUE

```sql
UPDATE dictionaryentries_zh
SET discoverable = TRUE
WHERE word1 = ANY(ARRAY['未来', '摸脉', ...]) AND language = 'zh'
RETURNING id, word1, discoverable;
```

### A3. Run the pipeline scoped to the words

Run all steps in order with `--words=word1,word2,...` (comma-joined hanzi).

```bash
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-tones.js --words=未来,摸脉
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-numbered-pinyin.js --words=未来,摸脉
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-dictionary-breakdown.js --words=未来,摸脉
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-process-definitions-array.js --words=未来,摸脉
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-parts-of-speech.js --words=未来,摸脉
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-word-forms.js --words=未来,摸脉
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-hsk-level.js --words=未来,摸脉
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-long-definitions.js --words=未来,摸脉
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-example-sentences.js --words=未来,摸脉
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-classifier.js --words=未来,摸脉
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-vernacular-score.js --words=未来,摸脉
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --words=未来,摸脉
```

**Parts of speech must run before `backfill-word-forms`, `backfill-long-definitions`, AND `backfill-example-sentences`.** All three depend on `partsOfSpeech`: word-forms and long-definitions only process rows where `partsOfSpeech IS NOT NULL` (they silently skip otherwise), and the example-sentence prompt enforces at least one sentence per listed POS. `backfill-word-forms` additionally reads `definitions[0]`, so it must also run after `backfill-process-definitions-array`. It writes an English `wordForms` map (e.g. `{"past":"ran",...}`), or `{}` when no forms apply, so re-runs skip already-processed rows.

**`backfill-cluster-definitions` runs last** (it reads the finalized `definitions` and writes `definitionClusters` — orthogonal sense clusters; see `docs/DEFINITION_CLUSTERS.md`). It self-flags any sense it is even slightly unsure about by printing **`⚠ CLUSTER REVIEW <word> (id=...): <reason>`** lines to stdout (uncertain readings/heteronyms, borderline split/merge calls, low-confidence ordering, etc.). **Scan this step's output for `⚠ CLUSTER REVIEW` lines and surface every one of them to the user for human review** — these are the cases most likely to need a manual fix (e.g. a wrong heteronym reading) before `/data-deploy`.

### A4. Verify enrichment

```sql
SELECT word1, tone, "hskLevel",
  "longDefinition" IS NOT NULL AS has_long_def,
  "partsOfSpeech" IS NOT NULL AS has_parts_of_speech,
  "wordForms" IS NOT NULL AS has_word_forms,
  "exampleSentences" IS NOT NULL AS has_examples,
  breakdown IS NOT NULL AS has_breakdown,
  classifier IS NOT NULL AS has_classifier,
  "vernacularScore" IS NOT NULL AS has_vernacular_score,
  discoverable
FROM dictionaryentries_zh
WHERE word1 = ANY(ARRAY['未来', '摸脉']) AND language = 'zh';
```

---

# §B — Spanish (`dictionaryentries_es`)

Spanish differs in two ways that matter here:

1. **The key is `(word1, pos)`** (gender was collapsed out by migration 64). A
   single `word1` therefore has **one row per part of speech** — e.g. `vivir`
   gets a verb row, `perro` gets a noun row and an adjective row.
2. **Gender-homographs** (same spelling, different meaning by gender, e.g.
   `cura` f="cure" / m="priest") keep the **most common** sense as the row's
   primary meaning; the secondary gender is parked in the scalar
   `alternateGender` + `alternateMeaning` (short gloss) columns. The
   parts-of-speech step (B3) does this collapse automatically.

There is **no** pinyin / tone / HSK / breakdown / classifier for Spanish, and
`partsOfSpeech` is produced by the POS step (B3), not the Wiktionary import.

### B1. Resolve the word + pick the meaning to surface

Spanish rows are split by `(pos, gender)` until B3 collapses them. Inspect the
candidate rows so you (and the user) can see every POS/gender sense:

```sql
SELECT id, word1, pos, gender, jsonb_array_length(definitions) AS n_defs,
       left(definitions->>0, 40) AS def0
FROM dictionaryentries_es
WHERE language = 'es' AND word1 = ANY(ARRAY['cura', 'perro', ...])
ORDER BY word1, pos, gender;
```

Confirm with the user which words to make discoverable. Marking the word
discoverable makes **all of its genuine POS rows** discoverable (B3 rebuilds them
holistically), so flag any junk/vulgar sense (e.g. `leche`/interj = "shit") the
user may not want surfaced.

### B2. Set discoverable = TRUE

Mark the canonical row id(s) for each word (B3 reads ALL rows of the word1 and
rebuilds them, so marking one representative row per word is enough):

```sql
UPDATE dictionaryentries_es
SET discoverable = TRUE
WHERE id = ANY(ARRAY[28814, 89876, ...])
RETURNING id, word1, pos, gender;
```

### B3. Run the es pipeline scoped to the words

Either run each step with `--words=...`, or run the whole runner (it auto-scopes
the AI steps to `discoverable = TRUE`). Per-step form:

```bash
# 1-2 deterministic definition cleanup
docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-split-semicolon-definitions.js
docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-expand-abbreviations.js
# 3 POS + gender collapse — materializes one row per POS. --dry-run first to review!
docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-parts-of-speech.js --words=cura,perro --dry-run
docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-parts-of-speech.js --words=cura,perro
# 4-7 AI enrichment (auto-scoped to discoverable rows)
docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-process-definitions-array.js --words=cura,perro
docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-long-definitions.js
docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-example-sentences.js
docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-vernacular-score.js
```

Or the whole pipeline at once: `bash server/scripts/run-discoverable-enrichment-es.sh local`

**Notes on the POS step (B3):**
- Default `--prune-mode=soft` *hides* (sets `discoverable=FALSE`) the folded
  secondary-gender rows. Use `--prune-mode=hard` to DELETE them — required before
  the eventual `(word1, pos)` unique-constraint swap, but destructive.
- Always do a `--dry-run` first and review the printed UPDATE/INSERT/HIDE actions.
- Any 3rd distinct-meaning gender is printed as `⚠ DROPPED (manual review)` — it
  is not auto-lost; decide what to do with it by hand.
- When B3 changes a row's definitions it NULLs that row's `longDefinition` /
  `exampleSentences` / `vernacularScore` so steps 5-7 regenerate them.

### B4. Verify enrichment

```sql
SELECT word1, pos, gender, "alternateGender", "alternateMeaning",
  "partsOfSpeech" IS NOT NULL AS has_pos,
  "longDefinition" IS NOT NULL AS has_long_def,
  "exampleSentences" IS NOT NULL AS has_examples,
  "vernacularScore" IS NOT NULL AS has_vern,
  discoverable
FROM dictionaryentries_es
WHERE language = 'es' AND word1 = ANY(ARRAY['cura', 'perro'])
ORDER BY word1, pos;
```

All discoverable rows should have non-null `partsOfSpeech`, `longDefinition`,
`exampleSentences`, `vernacularScore`.

---

## Finally (both languages): remind about data deployment

After enrichment is complete, remind the user to run `/data-deploy` to push the
changes to production.

## Notes

- Scripts run inside `cow-backend-local` via `npx tsx` — do not use `node` directly.
- The `--words` flag filters the SQL query; the deterministic/AI steps skip entries
  whose target column is already populated, so re-runs are safe.
- Chinese full reference: `docs/newDictionaryEntriesBackfillInstructions.md`
- Spanish POS/gender model: `database/migrations/64-add-alternate-gender-to-dictionaryentries-es.sql`
  and `server/scripts/backfill/spanish/backfill-parts-of-speech.js`.
