# Discover — Hand-Crafted Beginner Card Order

> ↑ Part of [DISCOVER_FLOW.md](./DISCOVER_FLOW.md).

This doc describes how we **export** the exact sequence of cards a brand-new user
sees in Sort Cards (scp), so we can **hand-curate** a deliberate beginner experience.

> **Direction update.** The original plan here was a `discoverOrder` integer column
> that re-sorted individual cards. That has been **superseded** by **authored sort
> packs** (`sort_packs`) — the curation unit is now a small pack (a sentence + up to 3
> cards), not a single re-ordered card. The export below is still the right starting
> point (it tells us which beginner words exist, in what order), but the hand-crafted
> output is now authored packs, ordered by `sort_packs.packOrder`, not a per-card
> `discoverOrder`. See [SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md)
> §4.5 / §6.3 for the runtime behavior and §5 below for the schema.

It is a reproducible recipe: run it once per language (zh done first, es next).

---

## 1. Why the current order looks the way it does

For a user who has **never sorted any card**, the server picks cards in
`StarterPacksService` (`server/services/StarterPacksService.ts`):

1. `estimateLevel(userId, language)` returns **1** — a fresh user has zero mastered
   and zero learning cards, so level 1 is the first *uncleared* level
   (`StarterPacksService.ts:193`).
2. `_fetchSupplyRows` selects discoverable cards ordered **nearest-level-first**
   around the estimate (`StarterPacksService.ts:305`):

   ```sql
   ORDER BY ABS(CAST(difficulty AS INTEGER) - 1) ASC, de.id ASC
   ```

   Because every difficulty is ≥ 1, `ABS(difficulty − 1)` collapses to **difficulty
   ascending**, with ties broken by **`id` ascending** (dictionary insertion order).

So today the beginner order is an accident of two things: the curated `difficulty`
(HSK level for zh) and the surrogate `id`. Within a difficulty band the order is
arbitrary (whatever `id` the row happened to get on import). **That arbitrary
within-band order is exactly what we want to replace with a hand-crafted one.**

Filters applied to the supply (all in `_fetchSupplyRows`):

- `de.discoverable = TRUE`
- valid difficulty: `de."difficulty" ~ '^[1-6]$'`
- not already sorted by the user (vet `NOT EXISTS`) — empty for a fresh user
- not currently skipped (`discover_skips`) — empty for a fresh user

---

## 2. Export recipe (reproducible)

Run on the **dev** machine (the `discoverable` flag is curated on dev and synced to
prod via `/data-deploy`, so dev is the source of truth). Swap the table name to do
the other language.

| Language | Dict table | Extra columns |
| --- | --- | --- |
| zh | `dictionaryentries_zh` | — |
| es | `dictionaryentries_es` | add `pos` (Spanish POS badge) |

### zh — first 400

```bash
docker exec cow-postgres-local psql -U cow_user -d cow_db --csv -c "
SELECT
  row_number() OVER (ORDER BY ABS(CAST(difficulty AS INTEGER) - 1) ASC, id ASC) AS sort_order,
  id,
  word1,
  pronunciation,
  difficulty,
  (definitions->>0) AS definition,
  CASE WHEN \"iconId\" IS NOT NULL THEN 'yes' ELSE '' END AS has_icon
FROM dictionaryentries_zh
WHERE language='zh' AND discoverable=TRUE AND difficulty BETWEEN 1 AND 6
ORDER BY ABS(CAST(difficulty AS INTEGER) - 1) ASC, id ASC
LIMIT 400;
" > discover-beginner-csv/beginner_cards_zh_first400.csv
```

### es — first 400 (when we do Spanish)

Same query against `dictionaryentries_es`, plus a `pos` column in the SELECT (Spanish
identity is `(word1, pos)`, so the same `word1` can appear as multiple rows):

```bash
docker exec cow-postgres-local psql -U cow_user -d cow_db --csv -c "
SELECT
  row_number() OVER (ORDER BY ABS(CAST(difficulty AS INTEGER) - 1) ASC, id ASC) AS sort_order,
  id, word1, pronunciation, pos, difficulty,
  (definitions->>0) AS definition,
  CASE WHEN \"iconId\" IS NOT NULL THEN 'yes' ELSE '' END AS has_icon
FROM dictionaryentries_es
WHERE language='es' AND discoverable=TRUE AND difficulty BETWEEN 1 AND 6
ORDER BY ABS(CAST(difficulty AS INTEGER) - 1) ASC, id ASC
LIMIT 400;
" > discover-beginner-csv/beginner_cards_es_first400.csv
```

The `sort_order` column is the position the card appears in the queue for a fresh
user — i.e. the order we are about to hand-edit.

---

## 3. Current export snapshots (as of this writing)

Discoverable pool sizes (valid difficulty 1–6), so we know how much room there is:

| Lang | Total discoverable | L1 | L2 | L3 | L4 | L5 | L6 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| zh | 674 | 228 | 112 | 205 | 113 | 15 | 1 |
| es | 190 | 98 | 48 | 37 | 7 | — | — |

The **first 400 zh** therefore covers: all 228 of L1 + all 112 of L2 + the first 60
of L3 (boundary card = `感谢 / gǎn xiè`).

Exported files live in `discover-beginner-csv/` (gitignored working area):

- `beginner_cards_zh_first400.csv` — the 400 we are hand-curating
- `beginner_cards_zh.csv` / `beginner_cards_es.csv` — full pools for reference

---

## 4. Hand-curation workflow

1. Export the CSV (§2) to see which beginner words exist at each level, in order.
2. Group words into **authored packs**: a short sentence + the up-to-3 cards it
   teaches. The author writes the sentence + English translation and lists the cards
   (by `id` / `word1`), guaranteeing every listed card actually appears in the
   sentence (validated by the build-time test in §5).
3. Import the packs into `sort_packs` (one row per pack), assigning `packOrder` to
   control the beginner sequence within each level.
4. Sync `sort_packs` to prod via `/data-deploy` (reference-table change).

---

## 5. Mechanism: authored `sort_packs`  *(NOT yet built — schema confirmed, see implementation plan)*

The curation unit is a **sort pack**, stored per-language. A pack carries its own
authored sentence (not a det example sentence) plus references to up-to-3 cards:

```sql
-- confirmed shape (see SORT_PACKS_IMPLEMENTATION.md §2 for the migration)
CREATE TABLE sort_packs (
  id               SERIAL PRIMARY KEY,
  language         VARCHAR  NOT NULL,            -- 'zh' | 'es'
  level            SMALLINT NOT NULL,            -- 1..6, the pack's difficulty band
  "packOrder"      INTEGER  NOT NULL,            -- curation sort key within a level
  "sentenceForeign" TEXT    NOT NULL,            -- authored sentence (zh chars / es text)
  "sentenceEnglish"  TEXT   NOT NULL,            -- authored translation
  "entryIds"       INTEGER[] NOT NULL            -- up to 3 det ids, the draggable cards
);
```

- **No stored gloss.** The cpcdRow is enriched on the fly from `sentenceForeign` at
  serve time via `enrichExampleSentencesMetadataBatch` (same path as est) — nothing to
  precompute. zh gets the pinyin overlay; es renders as plain text.
- **`entryIds`** reference the per-language det table (`dictionaryentries_zh` /
  `_es`). Cards already in the user's library render locked + "sorted!"; a pack whose
  cards are *all* already sorted is skipped at serve time.
- **`packOrder`** — recommend sparse numbering (10, 20, 30…) so packs can be inserted
  later without renumbering.

**Serving** (see [SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md) §6.3):
at the user's level, authored packs are served first (by `packOrder`), then system
fallback packs-of-1 built on the fly from any remaining un-packed, un-skipped words
(using each word's own first example sentence). Level drift is nearest-first.

**Build/deploy validation test (required):** `server/scripts/validate-sort-packs.ts`.
For every `sort_packs` row it asserts each `entryIds` card's `word1` actually occurs
within `sentenceForeign` (zh: substring / segmentation match; es: token match), and that
**zh `sentenceForeign` is ≤ 11 code points, punctuation included**. This enforces the
"cards-appear-in-sentence" and zh sentence-length invariants at build/deploy time rather
than at runtime.

---

## 6. Doc-reference note

`StarterPacksService.ts` / `SortCardsPage.tsx` previously referenced a non-existent
`docs/SORT_CARDS_DESIGN.md`; those comments have been **repointed** to
[SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md) (the real requirements doc;
navigation lives in [DISCOVER_FLOW.md](./DISCOVER_FLOW.md)).

---

## Code references

- `server/services/StarterPacksService.ts`
  - `estimateLevel` (fresh user → level 1): ~`:193`
  - `_fetchSupplyRows` (the ORDER BY we are changing): ~`:244`–`:308`
  - `_levelConfig` (`levelExpr`, `validPredicate`): ~`:164`
