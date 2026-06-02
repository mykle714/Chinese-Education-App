# Audit Dictionary Definitions & Parts of Speech

Audit `dictionaryentries_zh` rows for integrity problems in the `definitions` (jsonb array of English glosses) and `partsOfSpeech` (jsonb array of POS tags) columns, then propose fixes for the user to approve before applying.

## Scope

By default, audit **discoverable** entries only (`discoverable = TRUE`) — that is the learner-facing set and the only set guaranteed to have POS tags. If the user asks for the whole table, drop the `discoverable` filter (expect ~99% of rows to have no POS, so the POS checks won't fire there).

## Key principle: POS order and gloss order are independent

`partsOfSpeech` describes the word's **Chinese** grammatical category. `definitions` are **English** glosses whose word-class often differs in translation (e.g. 看起来 is a verb but glosses naturally as the adverb "apparently"). So:

- A gloss whose English word-class differs from the POS is **NOT automatically wrong** — it is a translation artifact. Report it as a **WARNING for human review**, never an automatic deletion.
- Do **not** reorder definitions to "match" POS order, and do not reorder POS to match definitions. They are decoupled.

## Run the checks

> ⚠️ Read `amIOnTheProdMachine.md` first. On DEV, normal work is safe. On PROD, confirm before any `UPDATE`.

Local container is `cow-postgres-local` / db `cow_db` / user `cow_user`. Output CJK reliably with `-At` (terminal rendering of wide tables in this environment is unreliable; prefer `-At` or writing to a temp file and reading it).

### ERROR checks (structural — these are real bugs)

**1. Empty / missing definitions** (regression example: 体检 had `[]`)
```bash
docker exec cow-postgres-local psql -U cow_user -d cow_db -At -c "
SELECT id||' | '||word1 FROM dictionaryentries_zh
WHERE discoverable AND (definitions IS NULL OR jsonb_array_length(definitions)=0);"
```

**2. Duplicate glosses within one entry** (regression: 上 had \"above\"×2, 床 had \"bed\"×2)
```bash
docker exec cow-postgres-local psql -U cow_user -d cow_db -At -c "
SELECT id||' | '||word1||' | dups='||
  (jsonb_array_length(definitions) - (SELECT count(DISTINCT lower(v)) FROM jsonb_array_elements_text(definitions) v))
FROM dictionaryentries_zh
WHERE discoverable
  AND (jsonb_array_length(definitions) - (SELECT count(DISTINCT lower(v)) FROM jsonb_array_elements_text(definitions) v)) > 0;"
```

**3. Unknown / non-canonical POS tags** (catches drift like \"measure word\" vs the canonical \"classifier\")
The canonical tag list is `scripts/lib/posTags.js` (`ALLOWED_POS_TAGS`). Read it first, then flag any tag outside it:
```bash
docker exec cow-postgres-local psql -U cow_user -d cow_db -At -c "
SELECT id||' | '||word1||' | '||tag
FROM dictionaryentries_zh, jsonb_array_elements_text(\"partsOfSpeech\") tag
WHERE discoverable
  AND tag NOT IN ('noun','verb','adjective','adverb','pronoun','numeral','classifier','conjunction','particle','preposition','interjection');"
```
(Update the `IN (...)` list to match `ALLOWED_POS_TAGS` if it has changed.)

**4. Discoverable entry with no POS at all** (should have at least one)
```bash
docker exec cow-postgres-local psql -U cow_user -d cow_db -At -c "
SELECT id||' | '||word1 FROM dictionaryentries_zh
WHERE discoverable AND (\"partsOfSpeech\" IS NULL OR jsonb_array_length(\"partsOfSpeech\")=0);"
```

### WARNING checks (judgment required — review, don't auto-fix)

**5. Bare suffix-form glosses** (regression: 有 had standalone \"-ful\", \"-ed\", \"-al\")
Match only **leading-hyphen** glosses (English suffix forms, which read as noise on their own). Do **not** match trailing-hyphen prefix forms like \"un-\", \"multi-\", \"poly-\", \"post-\" — those are legitimate bound-form glosses.
```bash
docker exec cow-postgres-local psql -U cow_user -d cow_db -At -c "
SELECT id||' | '||word1||' | '||v
FROM dictionaryentries_zh, jsonb_array_elements_text(definitions) v
WHERE discoverable AND v ~ '^-[a-z]';"
```

**6. Gloss-class not covered by declared POS** — the 看起来 / 是 / 贴 family.
Pure SQL can't reliably classify English word-class, so do this as a judgment pass:
1. Pull every discoverable entry's `id | word1 | partsOfSpeech | definitions` (use `-At` with a `|` separator, or write to a temp file and Read it).
2. For each gloss, infer its likely English class with these conservative heuristics (only fire on strong signals):
   - starts with `to ` → **verb**
   - starts with `a `/`an `/`the ` → **noun**
   - first word ends in `-ly` (excluding non-adverbs like *family, only, ugly, grizzly, unsightly, likely*) → **adverb**
   - parenthetical/grammatical notes (`(...)`, `also pr ...`) and bare nouns → **unknown** (never flag)
3. A finding = the gloss's class is verb/adverb/noun **and** no declared POS covers it (`verb`→`verb`; `adverb`→`adverb`; `noun`→`noun` or `pronoun`).
4. **Triage each finding into one of two buckets:**
   - **Genuine missing POS** — the Chinese word really has that grammatical function but the tag is absent → propose **adding the POS tag** (e.g. 是 missing `verb`, 贴 missing `verb`, 了/位/和/就/差/节/零).
   - **Translation artifact** — the gloss just reads as another class but the POS is correct (e.g. numeral 一些 glossed \"a few\"; adjective 新 glossed \"newly\"; verb 看起来 glossed \"apparently\") → **leave as-is**, mention only as informational.

## Report

Present findings grouped as: 🔴 Errors (1–4) · 🧹 Subtract (2, 5) · ➕ Add POS (6, missing-POS bucket) · ✅ Leave alone (6, artifact bucket). For each proposed change show the `id`, `word1`, before → after. **Get user approval before writing.**

## Apply fixes

Batch the approved changes in a single transaction so a mistake rolls back cleanly:
```bash
docker exec -i cow-postgres-local psql -U cow_user -d cow_db <<'SQL'
BEGIN;
UPDATE dictionaryentries_zh SET definitions   = '[...]'::jsonb     WHERE id=<id> AND word1='<word>';
UPDATE dictionaryentries_zh SET "partsOfSpeech" = '[...]'::jsonb   WHERE id=<id> AND word1='<word>';
COMMIT;
SQL
```
Always include `AND word1='<word>'` as a guard so a wrong id can't silently edit the wrong row. Then re-run the relevant check queries to confirm the findings are cleared.

## After applying

Remind the user these are **local-DB** edits — pushing to production is a separate step via `/data-deploy`.

## Notes

- The full editorial review (reorder/add/subtract per entry) is a superset of these mechanical checks and needs human taste; these queries surface the *candidates*, the user decides.
- This audit is read-only until the Apply step. Safe to run anytime for a health check.
