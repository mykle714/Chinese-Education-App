# New Dictionary Entries Backfill Instructions

When new entries in `dictionaryentries_zh` are marked `discoverable = TRUE`, they need to be enriched with several derived and AI-generated columns before they are fully usable. This document catalogs every backfill script, what it populates, and the order in which scripts must be run.

All scripts are run from the **project root** unless noted otherwise.

---

## Column Coverage Map

Every column in `dictionaryentries_zh` and the script responsible for populating it:

| Column | Populated By | Method | Scoped To `discoverable`? | Language |
|---|---|---|---|---|
| `id` | DB auto-increment | — | — | all |
| `language` | Import / seed data | — | — | all |
| `word1` | Import / seed data | — | — | all |
| `word2` | Import / seed data | — | — | all |
| `pronunciation` | Import / seed data | — | — | all |
| `tone` | `backfill/chinese/backfill-tones.js` | Deterministic | No | zh |
| `numberedPinyin` | `backfill/chinese/backfill-numbered-pinyin.js` | Deterministic | No | zh |
| `definitions` | Import / seed data | — | — | all |
| `discoverable` | Manual / admin action | — | — | all |
| `script` | Import / seed data | — | — | all |
| `hskLevel` | `backfill/chinese/backfill-hsk-level.js` or import/seed data | AI (Claude Sonnet) or — | **Yes** (for backfill) | zh |
| `shortDefinition` | *Not stored — computed at runtime* | Deterministic via `server/utils/definitions.ts` | — | all |
| `longDefinition` | `backfill/chinese/backfill-long-definitions.js` | AI (Claude Haiku) | **Yes** | zh |
| `synonyms` | *Deprecated — no longer backfilled (script removed)* | — | — | zh |
| `synonymsMetadata` | *Not stored — computed at runtime from existing `synonyms` data* | Deterministic via `DictionaryService.enrichEntriesWithSynonymMetadata()` | — | zh |
| `exampleSentences` | `backfill/chinese/backfill-example-sentences.js` | AI (Claude) | **Yes** | zh |
| `segmentMetadata` | *Not stored — computed at runtime* | Deterministic via `DictionaryDAL.enrichExampleSentencesMetadataBatch()` | — | zh |
| `breakdown` | `backfill/chinese/backfill-dictionary-breakdown.js` | Deterministic | **Yes** | zh (multi-char only) |
| `classifier` | `backfill/chinese/backfill-classifier.js` | AI (Claude Sonnet) | **Yes** | zh |
| `expansion` | `backfill/chinese/backfill-expansion-claude.js` | AI (Claude Sonnet) | **Yes** | zh |
| `expansionLiteralTranslation` | `backfill/chinese/backfill-expansion-claude.js` | AI (Claude Sonnet) | **Yes** | zh |
| `createdAt` | DB auto-set | — | — | all |

**Note on runtime-computed fields:** `shortDefinition`, `synonymsMetadata`, and `segmentMetadata` (per-sentence pronunciation/definition/particle data for example sentences) are **never stored in the database**. They are computed on-the-fly at the service layer for every API response.

---

## Section A — Run Order When Marking Entries Discoverable

When a batch of entries has `discoverable` flipped to `TRUE`, run the following scripts in this order. Deterministic scripts first (no API cost, safe to re-run freely), then AI scripts (incur API cost).

All scripts support a `--words=word1,word2` flag to scope the backfill to a specific set of entries (e.g. `--words=未来,摸脉,折裙`). Omitting the flag targets all qualifying discoverable entries. **When marking specific words as discoverable, always use `--words` to limit cost and avoid re-processing the full table.**

Use the `/mark-discoverable` skill to handle the full flow — it sets `discoverable = TRUE` and runs all 8 steps scoped to the specified words.

### 1. Deterministic Scripts (run first, always safe to re-run)

**Step 1 — Tones**
```bash
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-tones.js --words=word1,word2
```
Populates: `tone`
Reads: `pronunciation`
Filter: `language = 'zh' AND pronunciation IS NOT NULL AND tone IS NULL`

---

**Step 2 — Numbered Pinyin**
```bash
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-numbered-pinyin.js --words=word1,word2
```
Populates: `numberedPinyin`
Reads: `pronunciation`
Filter: `language = 'zh' AND pronunciation IS NOT NULL AND "numberedPinyin" IS NULL`
Format: Numbered tone notation (e.g. "gan1 huo4"), ü → v, neutral tone gets no number

---

**Step 3 — Character Breakdown**
```bash
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-dictionary-breakdown.js --words=word1,word2
```
Populates: `breakdown`
Reads: `word1`, `language`
Filter: `language = 'zh' AND discoverable = TRUE AND char_length(word1) > 1 AND breakdown IS NULL`
Note: Only applies to multi-character Chinese entries.

---

### 2. AI Scripts (incur API cost — run after deterministic scripts)

**Step 4 — HSK Level**
```bash
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-hsk-level.js --words=word1,word2
```
Populates: `hskLevel`
Filter: `language = 'zh' AND discoverable = TRUE AND "hskLevel" IS NULL`
Note: Assigns one level token per entry (`HSK1`..`HSK6`). Use `--spot-check` to preview 5 entries first.

---

**Step 5 — Long Definitions**
```bash
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-long-definitions.js --words=word1,word2
```
Populates: `longDefinition` (Claude Haiku)
Filter: `language = 'zh' AND discoverable = TRUE AND longDefinition IS NULL`
Note: `shortDefinition` is no longer stored — it is computed at runtime from `definitions` via `server/utils/definitions.ts`.

---


**Step 7 — Example Sentences**
```bash
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-example-sentences.js --words=word1,word2
```
Populates: `exampleSentences`
Filter: `language = 'zh' AND discoverable = TRUE AND exampleSentences IS NULL`
Note: Generates 3 sentences per entry. Each sentence contains `chinese`, `english`, `translatedVocab`, and `partOfSpeechDict`. Segment metadata (pronunciation, definition, particle/classifier per token) is computed at runtime via `enrichExampleSentencesMetadataBatch()` — not stored. Use `--spot-check` flag for manual review before full run.

---

**Step 8 — Classifier (量词)**
```bash
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-classifier.js --words=word1,word2
```
Populates: `classifier`
Filter: `language = 'zh' AND discoverable = TRUE AND classifier IS NULL`
Note: Determines measure words for count nouns. Sets `[]` (not a count noun) or a non-empty array (e.g. `["辆"]`). NULL means not yet processed. Use `--spot-check` flag to preview 5 entries first.

---

**Step 9 — Expansion + Literal Translation**
```bash
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-expansion-claude.js --words=word1,word2
```
Populates: `expansion`, `expansionLiteralTranslation`
Filter: `language = 'zh' AND discoverable = TRUE AND (expansion IS NULL OR (expansion != '' AND "expansionLiteralTranslation" IS NULL))`
Note: Runs **last** — it segments the accepted expansion and looks up each segment's `definitions`, so it benefits from neighboring words already being enriched. Multi-agent generator → deterministic checks → validator → one retry. Writes the sentinel `''` (empty string) when no valid expansion exists — this is a legitimate terminal state, not a coverage gap, so many discoverable words will have a blank `expansion`. `expansionSegments`/`expansionMetadata` are computed at runtime, not stored here.

---

## Section B — One-Time Data Repair Scripts

These are not part of the standard discoverable-entry flow. Run them only when repairing specific data quality issues.

| Script | Purpose | When To Run |
|---|---|---|
| `backfill/chinese/backfill-pinyin-ucolon.js` | Fixes malformed `u:N` CEDICT notation in `pronunciation` (e.g. `lu:3` → `lǚ`). Also recomputes `tone`. | Only needed once after initial CEDICT import. |
| `backfill/chinese/backfill-enrichment.js` | Populates `expansionMetadata` for rows that have `expansion` but no metadata. | After manually adding or importing `expansion` values. |

---

## Section C — DAL / Type Wiring Status

All enrichment columns (`numberedPinyin`, `synonyms`, `exampleSentences`, `breakdown`, etc.) are wired through the DAL and TypeScript types.

---

## Section D — Quick Verification Queries

After running backfills, use these queries to confirm coverage:

```sql
-- Check numberedPinyin coverage
SELECT
  COUNT(*) FILTER (WHERE "numberedPinyin" IS NULL AND pronunciation IS NOT NULL) AS missing_numbered_pinyin,
  COUNT(*) FILTER (WHERE "numberedPinyin" IS NOT NULL) AS has_numbered_pinyin
FROM dictionaryentries_zh;

-- Check discoverable zh enrichment coverage
SELECT
  COUNT(*) AS total_discoverable,
  COUNT(*) FILTER (WHERE "longDefinition" IS NULL)  AS missing_long_def,
  COUNT(*) FILTER (WHERE synonyms IS NULL)           AS missing_synonyms,
  COUNT(*) FILTER (WHERE "exampleSentences" IS NULL) AS missing_sentences,
  COUNT(*) FILTER (WHERE breakdown IS NULL AND char_length(word1) > 1) AS missing_breakdown,
  COUNT(*) FILTER (WHERE classifier IS NULL) AS missing_classifier
FROM dictionaryentries_zh
WHERE language = 'zh' AND discoverable = TRUE;

-- Spot-check numberedPinyin output
SELECT pronunciation, "numberedPinyin"
FROM dictionaryentries_zh
WHERE pronunciation IS NOT NULL
LIMIT 20;
```

---

## Section E — Deploying Enriched Entries to Production

Use the `/data-deploy` skill. Full reference: `docs/DATA_DEPLOYMENT_GUIDE.md`.
