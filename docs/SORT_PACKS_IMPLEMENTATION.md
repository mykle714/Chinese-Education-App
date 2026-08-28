# Sort Packs — Implementation Plan

> ↑ Part of [DISCOVER_FLOW.md](./DISCOVER_FLOW.md). Behavior spec:
> [SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md). Curation/authoring:
> [DISCOVER_BEGINNER_CURATION.md](./DISCOVER_BEGINNER_CURATION.md).

This is the build plan for reworking the Sort Cards (scp) flow from single-card sorting
to **multi-card sort packs**, plus the new **Skipped Cards page**. It is forward-looking
(the work is not yet built). Decisions below are locked unless noted "OPEN".

---

## 1. Concept recap (the target behavior)

- The on-deck unit is a **sort pack**: **up to 3 draggable cards**. No sentence is
  shown in this flow. See requirements §4.5.
- **Two pack sources:** *authored* packs (curated, stored in `sort_packs`) and
  *system fallback* packs-of-1 (built on the fly from a single fresh word).
- **Two destinations** (Learn Now / Already Learned). **Skip** is a de-emphasized
  header button that defers all remaining unsorted cards in the pack.
- A pack the user finishes or skips is **never shown again** (tracked in
  `users.seenPacks`).
- **Undo** reverses one card action at a time (sort or skip), 3 deep.
- **Skipped Cards page** lists skipped words; tap → action popup; header **Recycle all**.

---

## 2. Layer 0 — Data model (migration 93; sentence columns dropped in migration 95)

Migrations live in `database/migrations/` (run by `database/deploy/migrate.sh`; see the
`/migrate` skill). `93-create-sort-packs-and-seen-packs.sql` created the table;
`95-drop-sort-packs-sentence-columns.sql` later dropped the authored-sentence columns
(§below); `96-add-entry-words-to-sort-packs.sql` added the derived `entryWords` column
(§below). Current shape:

```sql
-- Authored sort packs (reference data; delivered via SEED MIGRATIONS — see §2.1.
-- NOT movable by any data-sync skill: prod->dev covers det/icons8/pct/validations only).
CREATE TABLE sort_packs (
  id                SERIAL PRIMARY KEY,
  language          VARCHAR   NOT NULL,            -- 'zh' | 'es'
  level             SMALLINT  NOT NULL,            -- 1..6 (matches det.difficulty, mig 92)
  "packOrder"       INTEGER   NOT NULL,            -- curation key within (language, level)
  "entryIds"        INTEGER[] NOT NULL,            -- up to 3 det ids (the cards)
  "entryWords"      TEXT[]    NOT NULL             -- denormalized word1s, trigger-maintained (mig 96)
);
CREATE INDEX sort_packs_lang_level_order ON sort_packs(language, level, "packOrder");

-- Per-user record of packs already finished/skipped (authored pack ids; globally
-- unique since sort_packs is one table). Un-scoped int[] is unambiguous across langs.
ALTER TABLE users ADD COLUMN "seenPacks" INTEGER[] NOT NULL DEFAULT '{}';
```

`discover_skips` (migration 80) is reused unchanged.

**`entryIds` design note:** an `INTEGER[]` of det ids (not a join table) keeps a pack a
single row and preserves card order. `entryIds` stays the real key rather than switching
to `word1` because es det identity is `(word1, pos, gender)` — `word1` alone collides
across Spanish gender/POS homographs (e.g. `cura` n/f "cure" vs n/m "priest"), so it
can't safely stand in for `id`.

**`entryWords` (migration 96).** A denormalized `TEXT[]` of the `entryIds`' `word1`
values, in the same order, maintained by a `BEFORE INSERT OR UPDATE OF "entryIds",
language` trigger (`sort_packs_sync_entry_words`) that reads from `dictionaryentries_zh`
or `dictionaryentries_es` depending on `language`. It exists purely so `sort_packs` rows
are human-readable when browsing/authoring the table directly (e.g. `psql`) — no app
code should treat it as a join key; `entryIds` is authoritative.
`scripts/validate-sort-packs.ts` asserts it hasn't drifted from `entryIds`.

**No authored sentence.** `sentenceForeign`/`sentenceEnglish` were dropped in migration
95. They were never rendered by the client — they existed only to constrain authoring
(`validate-sort-packs.ts`, §6, used to assert every `entryIds` card's `word1` occurred in
the sentence). Authoring a pack is now just picking its up-to-3 `entryIds` directly; no
sentence is authored or validated.

### 2.1 Getting authored packs into another environment (seed migrations)

`sort_packs` is hand-authored reference data, and no data-sync skill carries it
(`/data-prod-to-dev` covers `dictionaryentries_zh`, `dictionaryentries_es`,
`particlesandclassifiers`, `icons8`, `validations` only — and it only moves prod →
dev; the old dev → prod push skill has been deleted). There is no dump
file and no import script. **Authored packs travel as seed migrations, which means
they ship with the ordinary code deploy** — `/deploy` picks the file up in its pending
migration set like any other, `database/deploy/migrate.sh` applies it in `sort -V`
order and records it in `schema_migrations`. There is no separate pack-deployment
step, no out-of-band data push, and nothing to remember: authoring a new pack means
writing the next seed migration, and it reaches prod the next time code does.

> **Failure mode if you forget.** An environment with an empty `sort_packs` is not
> visibly broken — `fetchPacksAtLevel` returns nothing at every level and
> `getNextPacks` silently falls through to system packs-of-1, so the sort flow serves
> 100% single cards and no authored pack is ever offered. This is exactly what shipped
> to production between migration 93 and migration 131.

`131-seed-zh-sort-packs.sql` is the reference implementation for such a seed. Its
rules, which any future pack seed should follow:

| Rule | Why |
|---|---|
| Seed rows **by `word1`**, resolving to `entryIds` at run time | det ids are not portable across environments — prod is the source of truth for `dictionaryentries_zh` and its ids need not match the authoring box. Safe for `zh` (word1 is unique per language there); do **not** generalize to `es` without re-checking the homograph caveat above. |
| Insert **explicit `id`s**, then `setval` the sequence past them | `users."seenPacks"` stores raw `sort_packs.id` values, so an id is user-visible state — every environment must agree on which id is which pack. |
| `ON CONFLICT (id) DO NOTHING` | Idempotent; never clobbers a pack that environment already has under that id. |
| Skip (with `RAISE WARNING`) any pack whose words don't all resolve; `RAISE NOTICE` the inserted/existing/skipped counts | A dictionary missing one word must not abort a deploy. Read the NOTICE after running — a nonzero skip count means that environment's det table is behind. |
| Don't write `entryWords` | `trg_sort_packs_sync_entry_words` (migration 96) derives it on INSERT. |

**Authoring a new pack** (e.g. filling the level 3/4 gap): insert it locally, confirm
`npx tsx server/scripts/validate-sort-packs.ts` passes, then write the next-numbered
seed migration for the new rows only and commit it. The deploy carries it.

Post-deploy verification, on the target box — part of the normal deploy's verify step:

```bash
docker exec cow-postgres-prod psql -U cow_user -d cow_db \
  -c "SELECT language, level, count(*) FROM sort_packs GROUP BY 1,2 ORDER BY 1,2;"
```

Expected on prod today: `zh` → **19 packs at level 1, 2 at level 2, and nothing
else** (21 total). Levels 3 and 4 are legitimately empty (none authored yet); levels 5
and 6 are empty **by decision** — see below.

### 2.2 Levels 5 and 6 have no authored packs

Migration 131 seeded 34 packs at levels 5–6. They were **withdrawn on 2026-08-11 by a
one-off ad-hoc `DELETE` against prod**, deliberately *not* shipped as a migration: this
is a content decision about the rows one seed happened to insert, not a schema change,
and a migration file would replay the withdrawal on every freshly-bootstrapped database
forever. Every withdrawn pack was the same genre — an **idiom decomposition**, i.e.
`{first half, second half, whole 4-char idiom}` (`{脚踏, 实地, 脚踏实地}`) — 23/23 at L5
and 11/11 at L6, versus the **thematic** grouping used at L1/L2 (`{昨天, 今天, 明天}`).
Two teaching genres shared one schema with no column distinguishing them, and the
literary idiom packs were not the right content for those levels.

Consequences to know:
- The det entries are untouched and still reachable — a level-5/6 sorter now gets
  100% system fallback packs-of-1 at those levels (the documented degradation path in
  §2.1, here intentional rather than accidental).
- No user data was invalidated: sorted cards (vet) and skips (`discover_skips`) key
  off det ids, not pack ids. The withdrawal also stripped the deleted ids out of
  `users."seenPacks"`, which has no FK — orphaned ids are inert today but would
  wrongly suppress a future pack that reused the id.
- **Freed pack ids (45–78) must never be reused.** `sort_packs_id_seq` was deliberately
  left at 78 rather than rewound; a pack id is user-visible state via `seenPacks`.
- Before re-authoring anything at these levels, settle the genre question — a
  `packType` column (`'thematic' | 'compositional'`) is the proposed fix, not yet built.

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
     excludePackIds, …)` — **served in `packOrder`, the DAL's order, never re-sorted by
     the service** (curation order is authoritative; see requirements §6.4) — excluding `seenPacks` + client-held
     packs and dropping any pack whose `entryIds` are **all** already sorted. Each
     returned pack's cards are hydrated + tagged `sorted` (vet row → locked "sorted!") /
     `skipped` (discover_skips → draggable again).
   - **Fallback packs-of-1 at the SAME level** from remaining fresh (un-sorted,
     **un-skipped**) words (`_fetchSupplyRows` pinned via `exactLevel`), wrapped as a
     single-card pack.
3. Skips are **not** auto-recycled here (requirements §5.2).

`SortPack` shape returned to the client:
```ts
{ packKey: string;           // authored: "pack:<id>"; fallback: "single:<cardId>"
  packId: number | null;     // sort_packs.id for authored; null for fallback
  level: number;
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

## 4. Layer 2 — API (`StarterPacksController` + `routes/starterPacksRoutes.ts`)

| Method | Route | Body / params | Returns |
|---|---|---|---|
| GET  | `/api/starterPacks/:language` | — | `{ packs: SortPack[], exhausted, level }` |
| POST | `/api/starterPacks/sort` | `{ cardId, bucket, language, packId?, lastInPack? }` | `{ success, level }` (+ marks pack seen when `lastInPack`) |
| POST | `/api/starterPacks/skipPack` | `{ cardIds[], language, packId? }` | `{ nextPack, exhausted, level }` |
| POST | `/api/starterPacks/nextPack` | `{ language, excludeIds[] }` | `{ nextPack, exhausted, level }` |
| POST | `/api/starterPacks/undo` | `{ cardId, bucket, language, packId? }` | `{ success }` |
| GET  | `/api/starterPacks/:language/skipped` | — | `DiscoverCard[]` |
| POST | `/api/starterPacks/:language/recycleSkips` | — | `{ recycled: number }` |

`bucket` stays `already-learned` | `library` (skip no longer flows through `/sort`).
`VALID_LANGUAGES` validation pattern reused.

## 5. Layer 3 — Client

### 5.1 Types (`src/types.ts`)
Add `SortPack`; extend `DiscoverCard` with `sorted?: boolean` / `skipped?: boolean`.
Replace `DiscoverFetchResponse.cards` with `packs`.

### 5.2 `src/features/discover/SortCardsPage.tsx`
- FIFO is now a **queue of packs** (target 2: on-deck + buffer).
- Render: up to **3 resized draggable cards** (no sentence band — removed). Autoplay
  is pack-level, not per-pickup: an effect keyed on `currentPack.packKey` narrates
  every card's own word audio via `tts.autoSpeakSentence(card.entryKey, card.pronunciation)`
  left to right, once per pack landing on-deck, whenever `tts.autoplay` is true. (The
  page-local `discoverSettings.autoplay` and the master `tts.enabled` flag are both
  gone — narration autoplay is one app-wide setting now, and `autoSpeakSentence`
  enforces it internally. See [AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md).) Drag start only unlocks audio (mobile gesture
  requirement) via `unlockAudio`, on **every** pickup — the page deliberately keeps
  no "already unlocked" ref, because `unlock()` is the app's only recovery from an
  OS-suspended AudioContext (see [AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md) § 5); it
  no longer triggers narration itself. Locked (`sorted`) cards:
  undraggable + "sorted!" watermark, but still narrated in the sequence.
- Per-card drag → `POST /sort` (`lastInPack` true on the final unsorted card). Card
  animates out; pack stays on deck (immutability §4.2).
- Pack complete → pop head, append buffer, `POST /next-pack` to refill tail.
- **Skip button** → header `rightContent`; `POST /skip-pack` with remaining unsorted
  card ids → advance.
- **Undo:** client keeps a stack of the last 3 card actions (`{cardId, bucket|'skip',
  packId}`); undo pops one, calls `POST /undo`, and re-shows the card (bringing its
  pack back on deck if it had advanced).

### 5.3 `SkippedCardsPage.tsx` (new — mirrored the then-current `MasteredCardsPage`)
- `NodePage` + `MiniVocabCardGrid`; fetch `GET /:language/skipped`.
- Header `rightContent`: **Recycle all** → `POST /recycle-skips`, then refetch.
- Tap a card → **action popup** (Cancel / Mark as Already Learned / Mark as Learn Now)
  → `POST /sort`; on success remove from the local list. No detail-page navigation.

### 5.4 Navigation wiring
- `src/hooks/useDiscoverNavigation.ts`: add `skippedPath` = `/discover/skipped/{language}`
  + `goToSkipped()`.
- `src/features/discover/DiscoverPage.tsx`: add a "Skipped Cards" `HubMenuRow` → `skippedPath`.
- `src/App.tsx`: register `/discover/skipped/:language` → `SkippedCardsPage`. Both
  Sort Cards and Skipped Cards are **node pages** (keep the footer): registered in
  `pageTransition.ts` `NODE_PREFIXES` and covered by `Layout.tsx`'s phone-frame check.

## 6. Layer 4 — Curation & validation

- Authoring: build `sort_packs` rows from the beginner CSV (sparse `packOrder`) — just
  group up to 3 `entryIds` per pack, no sentence to write (§2). See
  [DISCOVER_BEGINNER_CURATION.md](./DISCOVER_BEGINNER_CURATION.md) §4–5.
- **Build/deploy test (required):** `server/scripts/validate-sort-packs.ts`. For every
  `sort_packs` row it asserts structural validity (1–3 `entryIds`, level in 1..6, every
  `entryId` exists in the per-language det table). Enforced at build time, not runtime.
- Get `sort_packs` onto prod via a **seed migration** (§2.1) — there is no data-sync
  skill that moves it, and none that moves anything dev → prod.

## 7. Suggested sequencing

1. Migration 93 (`sort_packs` + `users.seenPacks`) + a `SortPacksDAL` + hand-author a
   few zh packs to test against.
2. Server `getNextPacks` + skip/next-pack/undo/skipped/recycle methods + endpoints.
3. Client `SortCardsPage` pack rework (largest piece).
4. `SkippedCardsPage` + Discover row + nav wiring.
5. Curation tooling + validation test + es support.

## 8. Edge cases / notes

- **All-sorted authored pack:** never served (filtered in `getNextPacks`).
- **seenPacks vs undo:** undoing the completing/skipping action must `array_remove` the
  pack from `seenPacks`, else the pack is wrongly suppressed.
- **Immutability:** sorting/ skipping affects the current pack only; the buffer pack is
  never reordered by a re-estimation.

## 9. Code touch-points (current)

- `server/services/StarterPacksService.ts` — supply, leveling, sort/undo (rework).
- `server/controllers/StarterPacksController.ts` + `server/routes/starterPacksRoutes.ts` — routes.
- `src/features/discover/SortCardsPage.tsx` — pack UI rework.
- `src/features/discover/DiscoverPage.tsx`, `src/hooks/useDiscoverNavigation.ts`, `src/App.tsx` — nav.
- `src/features/flashcards/CollectionViewPage.tsx` — the generalized collection view that
  replaced `MasteredCardsPage.tsx` (deleted in the decks work, migration 141); it was
  `MasteredCardsPage` that `SkippedCardsPage` was originally copied from.
- `src/types.ts` (`DiscoverCard`, `DiscoverFetchResponse`, new `SortPack`).
- `database/migrations/131-seed-zh-sort-packs.sql` — the zh pack seed (§2.1); the only
  delivery path for authored packs into a non-authoring environment.
  (No companion migration withdraws the L5/L6 idiom-decomposition packs 131 seeded —
  that was a one-off ad-hoc DELETE on prod, §2.2. A database bootstrapped from the
  migrations alone therefore still has them.)
