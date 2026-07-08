# Character Rationale (per-character "why these characters")

**Status:** active. Introduced migration 102 (2026-07-07), replacing the retired
*expansion* feature.

Character Rationale maps, **character by character, the fuller everyday word each
character abbreviates** within a multi-char Chinese word. It is the successor to the old
`expansion` feature (which produced one blended vernacular phrase per word plus an
English gloss of that phrase). The display unit is now the **character**, not the whole
phrase, and — as of the v2 backfill (2026-07-07) — each character maps to **only the
implied Chinese word** (no English gloss).

For 违规 the rationale is:

| char | impliedWord |
|------|-------------|
| 违 | 违反 |
| 规 | 规矩 |

Each character maps to the fuller everyday word it is a terse stand-in for — the same
"知 → 知道" insight the old expansion prompt encoded, but attached per-character. A
character that abbreviates **no** illuminating longer word maps to the empty string `""`
(e.g. both 不 in 不知不觉). The display works **char by char**: rows are shown only for
characters that have a non-empty `impliedWord` — `""` characters are omitted entirely,
and the whole section is hidden when no character qualifies.

---

## Data model

- **Column:** `dictionaryentries_zh."characterRationale"` — `jsonb`, **zh-only**
  (migration 102). The Spanish det (`dictionaryentries_es`) does **not** have this
  column; the `dictJoin` es UNION branch substitutes `NULL::jsonb`.
- **Shape:** array aligned to `word1`'s characters, one object per character:
  ```json
  [ {"char": "违", "impliedWord": "违反"},
    {"char": "规", "impliedWord": "规矩"} ]
  ```
  `impliedWord` is **the fuller Chinese word** the character abbreviates (Chinese
  characters only — no pinyin, no English gloss, no `short for` prefix), or `""` when
  the character abbreviates nothing illuminating. A result whose characters are **all**
  `""` collapses to the `[]` sentinel (nothing worthwhile to show).
- **Sentinel convention** (mirrors expansion's old `''`):
  - `NULL` = never attempted
  - `'[]'::jsonb` = attempted, no worthwhile breakdown (transliterations like 咖啡,
    opaque proper nouns, lexicalized wholes) — future backfill runs skip it
- **Eligibility:** multi-char words only (`char_length(word1) > 1`). A single character
  has nothing to break down.

Unlike expansion — whose raw phrase had to be GSA-segmented + dictionary-looked-up at
**runtime** (`DictionaryDAL.enrichExpansionMetadataBatch`, now deleted) — this column is
**display-ready**: read paths just SELECT it and pass it through, no enrichment step.

---

## Layers

- **Data / enrichment (backfill):**
  `server/scripts/backfill/chinese/backfill-character-rationale.js` — the multi-agent
  writer (see below). Invoked last in the `/mark-discoverable` pipeline
  (`.claude/commands/mark-discoverable.md`).
- **DB read (DAL):**
  - `server/dal/implementations/DictionaryDAL.ts` — `characterRationale` in
    `DICTIONARY_COLUMNS` + `mapRowToDictionaryEntry`.
  - `server/dal/shared/dictJoin.ts` — `de."characterRationale"` in `DICT_COLS`; the
    zh lateral selects the column, the es lateral selects `NULL::jsonb`.
- **Service:** no enrichment methods — the old
  `DictionaryService.generateExpansion` / `validateExpansion` /
  `enrichExpansionMetadataBatch` (and the DAL/interface method) were **removed**.
  `StarterPacksService` selects the column per-language (NULL for es);
  `VocabEntryService` / `OnDeckVocabService` dropped the expansion pipeline stage.
- **Types:** `server/types/index.ts` and `src/types.ts` —
  `characterRationale?: Array<{ char: string; impliedWord: string }> | null`.
- **Client (render):**
  - `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx` — the eip
    breakdown tab renders a **"Why These Characters"** list under the per-character
    breakdown rows: one row per character **with a non-empty `impliedWord`**, drawn as
    `char → impliedWord` (both `ForeignText`, tone-colored). Characters with `""` are
    filtered out (`rationaleItems`), and the whole section renders only when at least
    one character qualifies (`hasRationale`).
  - `src/features/flashcards/VocabCardDetailBody.tsx` — the cdp renders the same list.
  - No qualifying characters (null, `[]`, or all-`""`) → the section is **not rendered**
    at all (no placeholder).
  - `src/features/flashcards/FlashcardsLearnPage/dictEntryAdapter.ts` carries the field
    from a det-fallback entry onto the client `VocabEntry`.

---

## Backfill pipeline

`backfill-character-rationale.js` mirrors the retired expansion script's multi-agent
structure (cached system blocks via `run-log.js`, `parseModelJson` from
`shared/lib/json.js`, `--dry-run` / `--concurrency` / `--words=` flags):

1. **Generator agent** → proposes `[{char, impliedWord}]` (or `[]` if the word is opaque).
2. **Deterministic check** → exactly one entry per character, in `word1`'s order, each
   `char` matching and each `impliedWord` a string (`""` allowed). An empty array is a
   legal sentinel and always passes; a result whose `impliedWord`s are **all** `""`
   collapses to the `[]` sentinel.
3. **Validator agent** (only if the deterministic check passes) → judges each cited
   word (`wrong_implied_word`, `unnecessary_word`, `missing_word`) and the empty-vs-not
   choice (`should_be_empty` / `should_not_be_empty`).
4. **One retry** — a regenerator agent informed by the violations + critique.
5. Accept → write the array; two rejections or a deliberate `[]` → write `'[]'`.

The script carries a `SCRIPT_VERSION` (currently **2** — v2 dropped the English gloss,
storing `impliedWord` only). Re-run with `--stale` to re-process rows stamped below the
current version.

Selection query: discoverable zh rows with `char_length(word1) > 1` and
`characterRationale IS NULL` (plus below-version rows under `--stale`), oldest/shortest first.

```bash
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-character-rationale.js
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-character-rationale.js --dry-run
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-character-rationale.js --words=违规,不知不觉
```

---

## Deploy note

Migration 102 **drops** `expansion` + `expansionLiteralTranslation` in the same
migration that adds `characterRationale`. On prod, run the backfill so the new column
is populated before the old feature disappears from the UI. See
[DATA_DEPLOYMENT_GUIDE.md](./DATA_DEPLOYMENT_GUIDE.md).
