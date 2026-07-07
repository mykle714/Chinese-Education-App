# Character Rationale (per-character "why these characters")

**Status:** active. Introduced migration 102 (2026-07-07), replacing the retired
*expansion* feature.

Character Rationale explains, **character by character, why each character is used**
in a multi-char Chinese word. It is the successor to the old `expansion` feature
(which produced one blended vernacular phrase per word plus an English gloss of that
phrase). The display unit is now the **character**, not the whole phrase.

For 违规 the rationale is:

| char | reason |
|------|--------|
| 违 | to violate — short for 违反 |
| 规 | rules/norms — short for 规矩 |

When a lone character is a terse stand-in for a fuller everyday word, the reason cites
that longer word inline (`— short for 违反`) — the same "知 → 知道" insight the old
expansion prompt encoded, but attached per-character instead of fused into one string.

---

## Data model

- **Column:** `dictionaryentries_zh."characterRationale"` — `jsonb`, **zh-only**
  (migration 102). The Spanish det (`dictionaryentries_es`) does **not** have this
  column; the `dictJoin` es UNION branch substitutes `NULL::jsonb`.
- **Shape:** array aligned to `word1`'s characters, one object per character:
  ```json
  [ {"char": "违", "reason": "to violate — short for 违反"},
    {"char": "规", "reason": "rules/norms — short for 规矩"} ]
  ```
  `reason` is a **short English learner-facing** gloss (a phrase, not a sentence).
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
  `characterRationale?: Array<{ char: string; reason: string }> | null`.
- **Client (render):**
  - `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx` — the eip
    breakdown tab renders a **"Why These Characters"** list under the per-character
    breakdown rows.
  - `src/features/flashcards/VocabCardDetailBody.tsx` — the cdp renders the same list.
  - Empty/absent → **"No breakdown explanation available"**.
  - `src/features/flashcards/FlashcardsLearnPage/dictEntryAdapter.ts` carries the field
    from a det-fallback entry onto the client `VocabEntry`.

---

## Backfill pipeline

`backfill-character-rationale.js` mirrors the retired expansion script's multi-agent
structure (cached system blocks via `run-log.js`, `parseModelJson` from
`shared/lib/json.js`, `--dry-run` / `--concurrency` / `--words=` flags):

1. **Generator agent** → proposes `[{char, reason}]` (or `[]` if the word is opaque).
2. **Deterministic check** → exactly one entry per character, in `word1`'s order, each
   `char` matching and each `reason` a non-empty string. An empty array is a legal
   sentinel and always passes.
3. **Validator agent** (only if the deterministic check passes) → judges accuracy of
   each reason and any cited "short for" word; can flag `should_be_empty` /
   `should_not_be_empty`.
4. **One retry** — a regenerator agent informed by the violations + critique.
5. Accept → write the array; two rejections or a deliberate `[]` → write `'[]'`.

Selection query: discoverable zh rows with `char_length(word1) > 1` and
`characterRationale IS NULL`, oldest/shortest first.

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
