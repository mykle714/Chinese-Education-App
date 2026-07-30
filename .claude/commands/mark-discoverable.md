# Mark Words as Discoverable

Set `discoverable = TRUE` for a list of words and run that language's full
enrichment pipeline scoped to those words. The procedure differs by language
because the dictionary tables differ — pick the section that matches.

## 0. Route by language

| Language | Table | Key | Pipeline |
|---|---|---|---|
| Chinese (`zh`) | `dictionaryentries_zh` | `word1` | §A — 10-step CJK pipeline |
| Spanish (`es`) | `dictionaryentries_es` | `word1` | §B — 7-step es pipeline |

If the user doesn't say, infer from the script (Han characters → zh; Latin → es)
and confirm.

> ⚠️ **This pipeline writes directly to PRODUCTION.** Backfills are no longer run on
> dev and pushed with `/data-deploy` — they run against the prod det tables, so
> every change reaches learners immediately. Read `amIOnTheProdMachine.md`, confirm
> the word list with the user, and take a backup
> (`server/scripts/backfill/backup-det.sh <label>`) before the first write.

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
  synonyms = NULL, "exampleSentences" = NULL, classifier = NULL,
  "frequencyScore" = NULL,
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
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-tones.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-numbered-pinyin.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-dictionary-breakdown.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-process-definitions-array.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-parts-of-speech.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/backfill-icons.js --lang=zh --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-word-forms.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-hsk-level.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-frequency-score.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-cluster-definitions.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-long-definitions.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-longdef-citations.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-example-sentences.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-classifier.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-breakdown-senses.js --words=未来,摸脉
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-breakdown-elaboration.js --words=未来,摸脉
```

**The two breakdown steps are no-ops on single-character words.** Both carry
`when: 'multiChar'` in the manifest and gate on `char_length(word1) > 1`, so a
single-char batch will report "0 entries" — that is correct, not a failure.

**`backfill-cluster-definitions` must run BEFORE `backfill-long-definitions`.** Long-definitions writes ONE definition per SENSE, keyed by the cluster's `sense` label (docs/DEFINITION_CLUSTERS.md), so it takes its sense list straight from `definitionClusters` and **skips any row that isn't clustered yet** (`definitionClusters IS NOT NULL` is in its WHERE clause). This is why long-definitions moved after clustering in the sequence above.

**Parts of speech must run before `backfill-word-forms`, `backfill-long-definitions`, AND `backfill-example-sentences`.** All three depend on `partsOfSpeech`: word-forms and long-definitions only process rows where `partsOfSpeech IS NOT NULL` (they silently skip otherwise), and the example-sentence prompt enforces at least one sentence per listed POS. `backfill-word-forms` additionally reads `definitions[0]`, so it must also run after `backfill-process-definitions-array`. It writes an English `wordForms` map (e.g. `{"past":"ran",...}`), or `{}` when no forms apply, so re-runs skip already-processed rows.

**`backfill-icons` must run AFTER `backfill-process-definitions-array` and `backfill-parts-of-speech`.** Its icons8 search-term cascade starts from the dd (`definitions[0]`), and both of those steps can still rewrite or reorder `definitions` — searching earlier would key the icon off a gloss the card never shows. It is deterministic (no LLM) but it *does* make outbound icons8 HTTP calls, so it is the one manifest step an oracle run cannot answer locally; it lives at the backfill root (not `chinese/`) because it is language-shared — pass `--lang=zh|es`. Rows whose every candidate term misses are stamped with `iconId` left NULL, so a word icons8 does not carry still completes.

**`backfill-cluster-definitions` must run BEFORE `backfill-example-sentences`.** Example-sentences reads `definitionClusters` to tag each generated sentence with the exact `sense` label it demonstrates (and to steer coverage toward every register-4/5 sense); it **skips any row whose `definitionClusters` IS NULL**. Clustering reads the finalized `definitions` (so it must run after `backfill-process-definitions-array`) and writes `definitionClusters` — orthogonal sense clusters; see `docs/DEFINITION_CLUSTERS.md`.

**`backfill-parts-of-speech` and `backfill-frequency-score` must run BEFORE `backfill-cluster-definitions`.** Clustering's single-definition fast path copies the word-level `partsOfSpeech` and `frequencyScore` straight onto the lone cluster (instead of spending API calls to re-derive them), so those columns must already be populated or the fast-path cluster gets `pos`/`frequencyScore` = null. (Multi-definition entries are unaffected — they score each cluster independently in Stage C.) This is why frequency-score was moved ahead of clustering in the sequence above.

**`backfill-longdef-citations` must run IMMEDIATELY AFTER `backfill-long-definitions`.** It reads the long definition, pulls out every embedded Chinese run with the same `splitHanRuns` the read path uses, and stores an English translation per run in `longDefinitionCitations` (migration 126) so a tap on a cited phrase highlights the WHOLE phrase and shows what it means, instead of glossing one word of it. It therefore cannot run before the definition exists, and **any later re-run of `backfill-long-definitions` for a word invalidates this column for that word** (the runs may have changed) — re-run it with the same `--words=` afterwards. Entries whose definition has nothing translatable are stamped `[]`, not left NULL, so a full run doesn't keep re-examining them.

**`[]` and short citation lists are normal, not failures.** Only runs that are NOT themselves dictionary words get translated: if the whole run has its own `dictionaryentries_zh` row (`光明磊落`, `看见`), the dictionary already glosses it and the eip can drill into it, so it is skipped with no API call and keeps the per-segment popup. Translation exists for what det has no answer for — clauses and sentences. A definition that only quotes headwords therefore ends up with `[]`, and the script prints `[N det headwords skipped: …]` on that word's line. Do not treat either as a miss.

**Scan the `backfill-longdef-citations` output for `⚠ CITATION REVIEW <word> (id=...)` lines.** A run is flagged when the model returned no usable translation for it (or returned a `zh` that doesn't match the run character-for-character, which would never join back to the rendered part). Those runs are simply left untranslated and keep the per-segment popup — a quality nit fixable with `--words=<word>`, not a blocker. A run skipped for being a det headword is NOT flagged: that is the intended outcome, not a failure.

**Scan the `backfill-long-definitions` output for `⚠ LONGDEF REVIEW <word> (id=...): <reason>` lines and surface them too.** A definition is flagged when it still cites the headword — or an ordinary compound containing it (说 → 学说) — in Chinese after one automatic repair pass. Rule 4 forbids that (the learner gains nothing from being shown the word they are already looking at), but the LLM validator/chooser enforce it unreliably, so the check is deterministic in the script. The flagged text IS written, so these are quality nits to fix by re-running `--words=<word>` or hand-editing, not blockers.

**`backfill-breakdown-senses` must run AFTER `backfill-dictionary-breakdown` AND `backfill-breakdown-elaboration` after BOTH.** The chain is generate → sense-correct → judge. `backfill-dictionary-breakdown` glosses each component character with its GLOBAL lead gloss (`definitions[0]`), which is frequently the wrong sense inside the compound (会议 → 会 as "can"). The sense-tagger replaces those with the correct `definitionClusters` sense, and only then is it meaningful to ask whether the breakdown needs explaining. Both sit at the END of the sequence because both read text that earlier steps can still rewrite. ⚠️ **The sense-tagger has a cross-row dependency the ordering cannot enforce**: it reads `definitionClusters` off the COMPONENT CHARACTERS' own det rows, so a component that has not itself been through `backfill-cluster-definitions` is carried through unchanged (no `sense`) and healed on a later re-run. That is a soft miss, not a failure.

**`backfill-breakdown-elaboration` writes NULL for most words, and that is the intended answer.** It judges whether a word's breakdown is opaque enough to need a sentence of explanation (东西 east+west = "thing"), and stays silent — NULL — for the ~70% of words whose parts plainly add up. **NULL therefore does NOT mean "the step didn't run"**: done-ness lives in the `enrichmentLog` stamp under `chinese/backfill-breakdown-elaboration`, which is written for every decided row including the NULL ones. Do not add a `breakdownElaboration IS NOT NULL` check to the §A4 verification query — it would read a correct run as a failure. See docs/BREAKDOWN_FEATURE_IMPLEMENTATION.md § 5c.

**Scan the `backfill-breakdown-elaboration` output for `⚠ BREAKDOWN ELABORATION REVIEW <word>` lines.** A word is flagged when the model's answer was unparseable, or still over its character budget after one shortening retry. Those rows are left **unwritten AND unstamped** on purpose, so a later run retries them rather than freezing in a truncated sentence — they will simply reappear as pending in the next `oracle-plan` round. Same for `⚠ BREAKDOWN SENSE REVIEW` from the tagger.

**Scan the `backfill-cluster-definitions` output for `⚠ CLUSTER REVIEW <word> (id=...): <reason>` lines and surface every one of them to the user for human review.** It self-flags any sense it is even slightly unsure about (uncertain readings/heteronyms, borderline split/merge calls, low-confidence ordering, etc.). These are the cases most likely to need a manual fix (e.g. a wrong heteronym reading) before `/data-deploy` — and a wrong cluster here now also feeds a wrong `sense` into the example sentences downstream.

### A4. Verify enrichment

```sql
SELECT word1, tone, "hskLevel",
  "longDefinition" IS NOT NULL AS has_long_def,
  -- has_longdef_citations is TRUE even for '[]' — a definition with nothing translatable
  -- (quotes no Chinese, or every quoted run is itself a det headword) records "done" as [].
  -- NULL means the step never ran (or failed) for this word.
  "longDefinitionCitations" IS NOT NULL AS has_longdef_citations,
  "partsOfSpeech" IS NOT NULL AS has_parts_of_speech,
  "wordForms" IS NOT NULL AS has_word_forms,
  "exampleSentences" IS NOT NULL AS has_examples,
  breakdown IS NOT NULL AS has_breakdown,
  classifier IS NOT NULL AS has_classifier,
  "frequencyScore" IS NOT NULL AS has_frequency_score,
  -- has_icon may legitimately be false: icons8 carries no match for some words. The
  -- backfill-icons stamp in "enrichmentLog" is what proves the step ran.
  "iconId" IS NOT NULL AS has_icon,
  discoverable
FROM dictionaryentries_zh
WHERE word1 = ANY(ARRAY['未来', '摸脉']) AND language = 'zh';
```

---

# §B — Spanish (`dictionaryentries_es`)

Spanish is keyed by `word1` exactly like Chinese (migration 123). A word's several
parts of speech and its gender-homographs (`cura` f="cure" / m="priest") live INSIDE
the row as `definitionClusters` — the same sense-cluster column Chinese uses — so
there is one row, one card, and the learner picks the sense. Before migration 123
each (pos, gender) was its own det row and its own card.

There is **no** pinyin / tone / HSK / breakdown / classifier for Spanish, and
`partsOfSpeech` is produced by the clustering step (B3), not the Wiktionary import.

### B1. Resolve the word + review its senses

One row per word, so inspect the row and the senses it carries:

```sql
SELECT id, word1, jsonb_array_length(definitions) AS n_defs,
       left(definitions->>0, 40) AS def0,
       (SELECT jsonb_agg(c->>'sense') FROM jsonb_array_elements("definitionClusters") c) AS senses
FROM dictionaryentries_es
WHERE language = 'es' AND word1 = ANY(ARRAY['cura', 'perro', ...]);
```

Confirm with the user which words to make discoverable. **Every sense of the word
becomes reachable** from the card's sense picker, so flag any junk/vulgar sense
(e.g. `leche` = "shit", `perro` = "asshole") the user may not want surfaced — the
remedy is to remove that gloss from `definitions` before clustering, not to hide a
row.

### B2. Set discoverable = TRUE

```sql
UPDATE dictionaryentries_es
SET discoverable = TRUE
WHERE language = 'es' AND word1 = ANY(ARRAY['cura', 'perro'])
RETURNING id, word1;
```

### B3. Run the es pipeline scoped to the words

Either run each step with `--words=...`, or run the whole runner (it auto-scopes
the AI steps to `discoverable = TRUE`). Per-step form:

The order below is authoritative and is encoded in `REQUIRED_SCRIPTS_ES`
(`server/scripts/backfill/shared/lib/requiredScripts.js`) — that manifest, not this
list, is what `oracle-plan.js --lang=es` plans against. Keep the two in sync.

```bash
# 1-2 deterministic definition cleanup (table-wide; they rewrite `definitions` in place)
server/scripts/backfill/run-prod.sh scripts/backfill/spanish/backfill-split-semicolon-definitions.js
server/scripts/backfill/run-prod.sh scripts/backfill/spanish/backfill-expand-abbreviations.js
# 3 order + prune `definitions` (AI) — MUST precede clustering, see the note below
server/scripts/backfill/run-prod.sh scripts/backfill/spanish/backfill-process-definitions-array.js --words=cura,perro
# 4 icons8 icon — after every step that can still rewrite definitions[0]; shared script, es table via --lang
server/scripts/backfill/run-prod.sh scripts/backfill/backfill-icons.js --lang=es --words=cura,perro
# 5 word-level frequency score
server/scripts/backfill/run-prod.sh scripts/backfill/spanish/backfill-frequency-score.js
# 6 sense clustering (also writes partsOfSpeech). --dry-run first to review!
server/scripts/backfill/run-prod.sh scripts/backfill/spanish/backfill-cluster-definitions.js --words=cura,perro --dry-run
server/scripts/backfill/run-prod.sh scripts/backfill/spanish/backfill-cluster-definitions.js --words=cura,perro
# 7-8 sense-tagged generation — both read the cluster `sense` labels, so they follow clustering
server/scripts/backfill/run-prod.sh scripts/backfill/spanish/backfill-long-definitions.js
server/scripts/backfill/run-prod.sh scripts/backfill/spanish/backfill-example-sentences.js
```

Or the whole pipeline at once: `bash server/scripts/run-discoverable-enrichment-es.sh local  # dev-shaped (local Docker); prefer per-step run-prod.sh for prod`

**`backfill-process-definitions-array` MUST run BEFORE `backfill-cluster-definitions`.**
The clusterer's `checkShape` validator requires the clusters to be an **exact partition**
of `definitions` — every gloss assigned to exactly one sense. process-defs re-orders and
*prunes* that array, so running it afterwards leaves stored clusters referencing glosses
the row no longer has. This mirrors the zh manifest, where process-defs is step 4 and
clustering is step 10.

**Notes on the clustering step (step 6):**
- It only ever writes `definitionClusters` + `partsOfSpeech` on the ONE row for the
  word. It never inserts, deletes, or hides a row — the row-reconciling
  `backfill-parts-of-speech.js` it replaced did all three (migration 123 removed the
  need; see the script header).
- Always do a `--dry-run` first and review the printed clusters. Each line shows
  `[frequency] sense (pos gender): glosses`.
- It re-runs only on words it has never clustered; pass `--force` to re-cluster. The
  mechanical clusters seeded by migration 123 do NOT count as clustered.
- Grep the output for `⚠ CLUSTER REVIEW` — the model self-flags every sense boundary,
  gender, or broken gloss it is unsure about, and those lines need a human read
  before the words go live. **Surface them to the user.**
- It never rewrites `definitions` (owned by `backfill-process-definitions-array`), so
  no dependent enrichment is invalidated by this step.

### B4. Verify enrichment

```sql
SELECT word1,
  jsonb_array_length("definitionClusters") AS n_senses,
  "partsOfSpeech" IS NOT NULL AS has_pos,
  "longDefinition" IS NOT NULL AS has_long_def,
  -- has_longdef_citations is TRUE even for '[]' — a definition with nothing translatable
  -- (quotes no Chinese, or every quoted run is itself a det headword) records "done" as [].
  -- NULL means the step never ran (or failed) for this word.
  "longDefinitionCitations" IS NOT NULL AS has_longdef_citations,
  "exampleSentences" IS NOT NULL AS has_examples,
  "frequencyScore" IS NOT NULL AS has_freq,
  discoverable
FROM dictionaryentries_es
WHERE language = 'es' AND word1 = ANY(ARRAY['cura', 'perro'])
ORDER BY word1;
```

All discoverable rows should have non-null `definitionClusters`, `partsOfSpeech`,
`longDefinition`, `exampleSentences`, `frequencyScore`.

---

## Finally (both languages): enrichment is already live

**Enrichment now runs directly against production** — there is no dev→prod push
step for det data any more, so `/data-deploy` is NOT part of this flow. The rows
you just enriched are visible to learners as soon as the pipeline finishes, which
is exactly why the backup and the verification steps above are mandatory rather
than optional.

To burn a Max-plan session answering these prompts locally instead of spending API
credit, use `/oracle-backfill` — same pipeline and validators, local answerer.

## Notes

- Scripts run **on the host** via `server/scripts/backfill/run-prod.sh <script> [args]`,
  which points them at `cow-postgres-prod` on 127.0.0.1. The prod backend image ships
  neither `scripts/backfill/` nor `tsx`, so `docker exec cow-backend-prod` cannot work,
  and `cow-backend-local` does not exist on this machine.
- Take a snapshot first: `server/scripts/backfill/backup-det.sh <label>`.
- The `--words` flag filters the SQL query; the deterministic/AI steps skip entries
  whose target column is already populated, so re-runs are safe.
- Chinese full reference: `docs/newDictionaryEntriesBackfillInstructions.md`
- Spanish sense model: `database/migrations/123-es-word1-unique-clustered-senses.sql`
  (made `word1` unique and moved the per-(pos, gender) split into `definitionClusters`,
  superseding migration 64's `alternateGender`/`alternateMeaning` columns) and
  `server/scripts/backfill/spanish/backfill-cluster-definitions.js`, which replaced the
  deleted `backfill-parts-of-speech.js`. Model docs: `docs/DEFINITION_CLUSTERS.md`.
- Pipeline manifests (what the oracle planner uses):
  `server/scripts/backfill/shared/lib/requiredScripts.js`.
