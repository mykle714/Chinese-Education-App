# New Dictionary Entries Backfill Instructions

When new entries in `dictionaryentries` are marked `discoverable = TRUE`, they need to be enriched with several derived and AI-generated columns before they are fully usable. This document catalogs every backfill script, what it populates, and the order in which scripts must be run.

All scripts are run from the **project root** unless noted otherwise.

---

## Column Coverage Map

Every column in `dictionaryentries` and the script responsible for populating it:

| Column | Populated By | Method | Scoped To `discoverable`? | Language |
|---|---|---|---|---|
| `id` | DB auto-increment | — | — | all |
| `language` | Import / seed data | — | — | all |
| `word1` | Import / seed data | — | — | all |
| `word2` | Import / seed data | — | — | all |
| `pronunciation` | Import / seed data | — | — | all |
| `tone` | `backfill-tones.js` | Deterministic | No | zh |
| `numberedPinyin` | `backfill-numbered-pinyin.js` | Deterministic | No | all |
| `definitions` | Import / seed data | — | — | all |
| `discoverable` | Manual / admin action | — | — | all |
| `script` | Import / seed data | — | — | all |
| `hskLevelTag` | Import / seed data | — | — | zh |
| `shortDefinition` | *Not stored — computed at runtime* | Deterministic via `server/utils/definitions.ts` | — | all |
| `longDefinition` | `backfill-short-long-definitions.js` | AI (Claude Haiku) | **Yes** | zh |
| `synonyms` | `backfill-synonyms.js` | AI (Claude) | **Yes** | zh |
| `synonymsMetadata` | `backfill-synonyms.js` | AI (Claude) | **Yes** | zh |
| `exampleSentences` | `backfill-example-sentences.js` | AI (Claude) | **Yes** | zh |
| `exampleSentencesMetadata` | `backfill-example-sentences-metadata.js` | Deterministic (depends on `exampleSentences`) | **Yes** | zh |
| `breakdown` | `backfill-dictionary-breakdown.js` | Deterministic | **Yes** | zh (multi-char only) |
| `expansion` | Manual / AI enrichment pipeline | — | — | zh |
| `expansionMetadata` | `backfill-enrichment.js` | Deterministic (depends on `expansion`) | No | zh |
| `createdAt` | DB auto-set | — | — | all |

---

## Section A — Run Order When Marking Entries Discoverable

When a batch of entries has `discoverable` flipped to `TRUE`, run the following scripts in this order. Deterministic scripts first (no API cost, safe to re-run freely), then AI scripts (incur API cost).

### 1. Deterministic Scripts (run first, always safe to re-run)

**Step 1 — Tones**
```bash
node server/scripts/backfill-tones.js
```
Populates: `tone`
Reads: `pronunciation`
Filter: `language = 'zh' AND pronunciation IS NOT NULL AND tone IS NULL`

---

**Step 2 — Numbered Pinyin**
```bash
node server/scripts/backfill-numbered-pinyin.js
```
Populates: `numberedPinyin`
Reads: `pronunciation`
Filter: `pronunciation IS NOT NULL AND "numberedPinyin" IS NULL` (all languages)
Format: Numbered tone notation (e.g. "gan1 huo4"), ü → v, neutral tone gets no number

---

**Step 3 — Character Breakdown**
```bash
node server/scripts/backfill-dictionary-breakdown.js
```
Populates: `breakdown`
Reads: `word1`, `language`
Filter: `language = 'zh' AND discoverable = TRUE AND char_length(word1) > 1 AND breakdown IS NULL`
Note: Only applies to multi-character Chinese entries.

---

### 2. AI Scripts (incur API cost — run after deterministic scripts)

**Step 4 — Long Definitions**
```bash
node server/scripts/backfill-short-long-definitions.js
```
Populates: `longDefinition` (Claude Haiku)
Filter: `language = 'zh' AND discoverable = TRUE AND longDefinition IS NULL`
Note: `shortDefinition` is no longer stored — it is computed at runtime from `definitions` via `server/utils/definitions.ts`.

---

**Step 5 — Synonyms**
```bash
docker exec cow-backend-local npx tsx scripts/backfill-synonyms.js
```
Populates: `synonyms`, `synonymsMetadata`
Filter: `language = 'zh' AND discoverable = TRUE AND synonyms IS NULL`
Note: Validates each AI-suggested synonym exists in `dictionaryentries` before saving.

---

**Step 6 — Example Sentences**
```bash
node server/scripts/backfill-example-sentences.js
```
Populates: `exampleSentences`
Filter: `language = 'zh' AND discoverable = TRUE AND exampleSentences IS NULL`
Note: Generates 3 sentences per entry (Chinese, English, usage label). Use `--spot-check` flag for manual review before full run.

---

**Step 7 — Example Sentences Metadata** _(depends on Step 6)_
```bash
node server/scripts/backfill-example-sentences-metadata.js
```
Populates: `exampleSentencesMetadata`
Reads: `exampleSentences`
Filter: `discoverable = TRUE AND exampleSentences IS NOT NULL AND exampleSentencesMetadata IS NULL`
Note: Must run after Step 6. Uses greedy longest-match segmentation — no AI cost.

---

## Section B — One-Time Data Repair Scripts

These are not part of the standard discoverable-entry flow. Run them only when repairing specific data quality issues.

| Script | Purpose | When To Run |
|---|---|---|
| `backfill-pinyin-ucolon.js` | Fixes malformed `u:N` CEDICT notation in `pronunciation` (e.g. `lu:3` → `lǚ`). Also recomputes `tone`. | Only needed once after initial CEDICT import. |
| `backfill-enrichment.js` | Populates `expansionMetadata` for rows that have `expansion` but no metadata. | After manually adding or importing `expansion` values. |

---

## Section C — DAL / Type Wiring Status

The following columns exist in the database but are **not yet surfaced through the DAL or TypeScript types**. They need to be added to `DictionaryDAL.ts` (SELECT list + `mapRowToEntity`) and `server/types/index.ts` (`DictionaryEntry` interface) before the app layer can use them:

All enrichment columns (`numberedPinyin`, `synonyms`, `exampleSentences`, `breakdown`, etc.) are wired through the DAL and TypeScript types.

---

## Section D — Quick Verification Queries

After running backfills, use these queries to confirm coverage:

```sql
-- Check numberedPinyin coverage
SELECT
  COUNT(*) FILTER (WHERE "numberedPinyin" IS NULL AND pronunciation IS NOT NULL) AS missing_numbered_pinyin,
  COUNT(*) FILTER (WHERE "numberedPinyin" IS NOT NULL) AS has_numbered_pinyin
FROM dictionaryentries;

-- Check discoverable zh enrichment coverage
SELECT
  COUNT(*) AS total_discoverable,
  COUNT(*) FILTER (WHERE "longDefinition" IS NULL)  AS missing_long_def,
  COUNT(*) FILTER (WHERE synonyms IS NULL)           AS missing_synonyms,
  COUNT(*) FILTER (WHERE "exampleSentences" IS NULL) AS missing_sentences,
  COUNT(*) FILTER (WHERE breakdown IS NULL AND char_length(word1) > 1) AS missing_breakdown
FROM dictionaryentries
WHERE language = 'zh' AND discoverable = TRUE;

-- Spot-check numberedPinyin output
SELECT pronunciation, "numberedPinyin"
FROM dictionaryentries
WHERE pronunciation IS NOT NULL
LIMIT 20;
```
