# Sort Packs — Implementation Plan

> ↑ Part of [DISCOVER_FLOW.md](./DISCOVER_FLOW.md). Behavior spec:
> [SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md). Curation/authoring:
> [DISCOVER_BEGINNER_CURATION.md](./DISCOVER_BEGINNER_CURATION.md).

This is the build plan for reworking the Sort Cards (scp) flow from single-card sorting
to **multi-card sort packs**, plus the new **Skipped Cards page**. It is forward-looking
(the work is not yet built). Decisions below are locked unless noted "OPEN".

---

## 1. Concept recap (the target behavior)

- The on-deck unit is a **sort pack**: a sentence band (zh = cpcd row, es = plain text)
  + **up to 3 draggable cards**. See requirements §4.5.
- **Two pack sources:** *authored* packs (curated, own sentence + translation, stored
  in `sort_packs`) and *system fallback* packs-of-1 (built on the fly from a single
  word's first example sentence).
- **Two destinations** (Learn Now / Already Learned). **Skip** is a de-emphasized
  header button that defers all remaining unsorted cards in the pack.
- A pack the user finishes or skips is **never shown again** (tracked in
  `users.seenPacks`).
- **Undo** reverses one card action at a time (sort or skip), 3 deep.
- **Skipped Cards page** lists skipped words; tap → action popup; header **Recycle all**.

---

## 2. Layer 0 — Data model (migration 93)

Migrations live in `database/migrations/` (run by `database/deploy/migrate.sh`; see the
`/migrate` skill). Latest is `92-*`. Add **`93-create-sort-packs-and-seen-packs.sql`**:

```sql
-- Authored sort packs (reference data; synced to prod via /data-deploy).
CREATE TABLE sort_packs (
  id                SERIAL PRIMARY KEY,
  language          VARCHAR   NOT NULL,            -- 'zh' | 'es'
  level             SMALLINT  NOT NULL,            -- 1..6 (matches det.difficulty, mig 92)
  "packOrder"       INTEGER   NOT NULL,            -- curation key within (language, level)
  "sentenceForeign" TEXT      NOT NULL,            -- authored sentence
  "sentenceEnglish" TEXT      NOT NULL,            -- authored translation
  "entryIds"        INTEGER[] NOT NULL             -- up to 3 det ids (the cards)
);
CREATE INDEX sort_packs_lang_level_order ON sort_packs(language, level, "packOrder");

-- Per-user record of packs already finished/skipped (authored pack ids; globally
-- unique since sort_packs is one table). Un-scoped int[] is unambiguous across langs.
ALTER TABLE users ADD COLUMN "seenPacks" INTEGER[] NOT NULL DEFAULT '{}';
```

`discover_skips` (migration 80) is reused unchanged.

**`entryIds` design note:** an `INTEGER[]` of det ids (not a join table) keeps a pack a
single row and preserves card order.

**No stored gloss (simplification).** `enrichExampleSentencesMetadataBatch`
(`DictionaryDAL.ts:309`) already derives `_segments` + `segmentMetadata` (incl. pinyin)
**on the fly from just `foreignText`** via the gsa + dictionary — it needs no
pre-authored gloss. So both authored and fallback packs compute their band the same way:
wrap the sentence as a synthetic `{ foreignText, english }` `exampleSentences[0]`, run
the batch enrich, and hand the result to `SegmentedSentenceDisplay` (the same component
the est tab uses). Authored sentences simply lack an AI `partOfSpeechDict`, which only
disables optional classifier/particle annotations — segmentation + pinyin are
unaffected.

## 3. Layer 1 — Server (`server/services/StarterPacksService.ts`)

### 3.1 New supply method `getNextPacks(language, userId, excludeIds, limit=2)`
Replaces `getNextCards` as the client-facing supply (the old method can remain as an
internal helper for fallback-card selection). Algorithm:

1. `estimateLevel` (unchanged).
2. **LEVEL is honored before the packs-first rule.** Walk levels nearest-first
   (`_levelDriftOrder`: estimate, then outward, tie-break UPWARD — e.g. L2 → `[2,3,1,4,5,6]`).
   WITHIN each level, serve authored packs THEN fallback singles before drifting to the
   next level. So a level-2 user exhausts ALL level-2 supply (packs **and** singles)
   before seeing any level-1/level-3 card.
   - **Authored packs at a level** via `SortPacksDAL.fetchPacksAtLevel(language, lvl,
     excludePackIds, …)` (ordered by `packOrder`), excluding `seenPacks` + client-held
     packs and dropping any pack whose `entryIds` are **all** already sorted. Each
     returned pack's cards are hydrated + tagged `sorted` (vet row → locked "sorted!") /
     `skipped` (discover_skips → draggable again).
   - **Fallback packs-of-1 at the SAME level** from remaining fresh (un-sorted,
     **un-skipped**) words (`_fetchSupplyRows` pinned via `exactLevel`), each wrapped in
     a synthetic pack using the word's own `exampleSentences[0]`, enriched on the fly.
3. Skips are **not** auto-recycled here (requirements §5.2).

`SortPack` shape returned to the client:
```ts
{ packKey: string;           // authored: "pack:<id>"; fallback: "single:<cardId>"
  packId: number | null;     // sort_packs.id for authored; null for fallback
  level: number;
  sentence: EnrichedSentence;  // { foreignText, english, _segments, segmentMetadata, ... }
                               // the enrichExampleSentencesMetadataBatch output shape,
                               // fed straight into <SegmentedSentenceDisplay>
  cards: DiscoverCard[];       // each with added `sorted` / `skipped` flags
}
```

### 3.2 Pack lifecycle methods
- `markPackSeen(userId, packId)` — append to `users.seenPacks` (array_append, dedup).
  Called when a pack is **completed** (all cards sorted) or **skipped**. Fallback
  packs (no packId) skip this.
- `skipPack(userId, cardIds[], language, packId|null)` — insert `discover_skips` for
  each card id; `markPackSeen` if `packId`. Returns the next pack.
- `sortCard(...)` — reuse existing; **add**: delete any `discover_skips` row for the
  card (sorting clears a prior skip). Completion (all of a pack's cards now sorted) is
  detected by the client, which then calls `markPackSeen` (or `sort` carries a
  `packId` + `lastInPack` flag — see API).
- `undoSort(...)` — reuse + **add**: when undoing, also (a) re-insert nothing but
  remove the vet/skip record (already does for vet; add skip-delete), and (b) if a
  `packId` is supplied, `array_remove` it from `seenPacks` (un-see the pack).

### 3.3 Skipped page methods
- `listSkipped(userId, language)` — `discover_skips ⨝ det` → card list for the grid.
- `recycleAllSkips(userId, language)` — `DELETE FROM discover_skips WHERE userId,language`.

## 4. Layer 2 — API (`StarterPacksController` + `server.ts`)

| Method | Route | Body / params | Returns |
|---|---|---|---|
| GET  | `/api/starter-packs/:language` | — | `{ packs: SortPack[], exhausted, level }` |
| POST | `/api/starter-packs/sort` | `{ cardId, bucket, language, packId?, lastInPack? }` | `{ success, level }` (+ marks pack seen when `lastInPack`) |
| POST | `/api/starter-packs/skip-pack` | `{ cardIds[], language, packId? }` | `{ nextPack, exhausted, level }` |
| POST | `/api/starter-packs/next-pack` | `{ language, excludeIds[] }` | `{ nextPack, exhausted, level }` |
| POST | `/api/starter-packs/undo` | `{ cardId, bucket, language, packId? }` | `{ success }` |
| GET  | `/api/starter-packs/:language/skipped` | — | `DiscoverCard[]` |
| POST | `/api/starter-packs/:language/recycle-skips` | — | `{ recycled: number }` |

`bucket` stays `already-learned` | `library` (skip no longer flows through `/sort`).
`VALID_LANGUAGES` validation pattern reused.

## 5. Layer 3 — Client

### 5.1 Types (`src/types.ts`)
Add `SortPack`; extend `DiscoverCard` with `sorted?: boolean` / `skipped?: boolean`.
Replace `DiscoverFetchResponse.cards` with `packs`.

### 5.2 `src/pages/SortCardsPage.tsx` (rework)
- FIFO is now a **queue of packs** (target 2: on-deck + buffer).
- Render: **sentence band** across the top via `<SegmentedSentenceDisplay>` fed the
  pack's enriched `sentence` (handles zh cpcd overlay and es plain/latin internally);
  below it up to **3 resized draggable cards**. Locked (`sorted`) cards: undraggable +
  "sorted!" watermark.
- Per-card drag → `POST /sort` (`lastInPack` true on the final unsorted card). Card
  animates out; pack stays on deck (immutability §4.2).
- Pack complete → pop head, append buffer, `POST /next-pack` to refill tail.
- **Skip button** → header `rightContent`; `POST /skip-pack` with remaining unsorted
  card ids → advance.
- **Undo:** client keeps a stack of the last 3 card actions (`{cardId, bucket|'skip',
  packId}`); undo pops one, calls `POST /undo`, and re-shows the card (bringing its
  pack back on deck if it had advanced).

### 5.3 `SkippedCardsPage.tsx` (new — mirror `MasteredCardsPage`)
- `NodePage` + `MiniVocabCardGrid`; fetch `GET /:language/skipped`.
- Header `rightContent`: **Recycle all** → `POST /recycle-skips`, then refetch.
- Tap a card → **action popup** (Cancel / Mark as Already Learned / Mark as Learn Now)
  → `POST /sort`; on success remove from the local list. No detail-page navigation.

### 5.4 Navigation wiring
- `src/hooks/useDiscoverNavigation.ts`: add `skippedPath` = `/discover/skipped/{language}`
  + `goToSkipped()`.
- `src/pages/DiscoverPage.tsx`: add a "Skipped Cards" `HubMenuRow` → `skippedPath`.
- `src/App.tsx`: register `/discover/skipped/:language` → `SkippedCardsPage`. Both
  Sort Cards and Skipped Cards are **node pages** (keep the footer): registered in
  `pageTransition.ts` `NODE_PREFIXES` and covered by `Layout.tsx`'s phone-frame check.

## 6. Layer 4 — Curation & validation

- Authoring: build `sort_packs` rows from the beginner CSV (sparse `packOrder`). The
  band is enriched on the fly at serve time — nothing extra to precompute. See
  [DISCOVER_BEGINNER_CURATION.md](./DISCOVER_BEGINNER_CURATION.md) §4–5.
- **Build/deploy test (required):** `server/scripts/validate-sort-packs.ts`. For every
  `sort_packs` row it asserts each `entryIds` card's `word1` occurs within
  `sentenceForeign` (zh: segmentation/substring; es: token), and that **zh sentences are
  ≤ 11 code points including punctuation** (`MAX_ZH_SENTENCE_CHARS`; keeps the on-deck
  band from wrapping). Enforces these invariants at build time, not runtime.
- Sync `sort_packs` to prod via `/data-deploy`.

## 7. Suggested sequencing

1. Migration 93 (`sort_packs` + `users.seenPacks`) + a `SortPacksDAL` + hand-author a
   few zh packs to test against.
2. Server `getNextPacks` + skip/next-pack/undo/skipped/recycle methods + endpoints.
3. Client `SortCardsPage` pack rework (largest piece).
4. `SkippedCardsPage` + Discover row + nav wiring.
5. Curation tooling + validation test + es support.

## 8. Edge cases / notes

- **Pack with no example sentence (fallback):** a word lacking `exampleSentences[0]`
  renders as a bare single card (no band).
- **All-sorted authored pack:** never served (filtered in `getNextPacks`).
- **seenPacks vs undo:** undoing the completing/skipping action must `array_remove` the
  pack from `seenPacks`, else the pack is wrongly suppressed.
- **Immutability:** sorting/ skipping affects the current pack only; the buffer pack is
  never reordered by a re-estimation.

## 9. Code touch-points (current)

- `server/services/StarterPacksService.ts` — supply, leveling, sort/undo (rework).
- `server/controllers/StarterPacksController.ts` + `server/server.ts:998–1025` — routes.
- `src/pages/SortCardsPage.tsx` — pack UI rework.
- `src/pages/DiscoverPage.tsx`, `src/hooks/useDiscoverNavigation.ts`, `src/App.tsx` — nav.
- `src/features/flashcards/MasteredCardsPage.tsx` — template for `SkippedCardsPage`.
- `src/types.ts` (`DiscoverCard`, `DiscoverFetchResponse`, new `SortPack`).
