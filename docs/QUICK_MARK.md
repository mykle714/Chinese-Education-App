# Quick Mark — bulk card triage grid

> ↑ Part of [DISCOVER_FLOW.md](./DISCOVER_FLOW.md) → [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).
>
> STATUS: **IMPLEMENTED.** All open questions resolved (see §9). This doc describes
> the shipped structure.

## 1. What it is

**Quick Mark** is the **second** Discover-hub activity (after Sort Cards). Where
Sort Cards is a slow, one-pack-at-a-time drag flow, Quick Mark is a **fast bulk
triage grid**: the user picks a difficulty level, sees every not-yet-sorted
discoverable word at that level as a wall of mini cards ordered by conversation-frequency
score, taps each card to assign it a destination, and hits **Save** to commit
them all in one request.

It reuses the exact same two bucket effects as Sort Cards (§4), so it introduces
**no new persistence** — same vet rows, same `starterPackBucket`, same
`already-learned → Mastered` history trick.

### Route / navigation

| Route                             | Component        | Page type                         | Footer        |
| --------------------------------- | ---------------- | --------------------------------- | ------------- |
| `/discover/quick-mark/:language`  | `QuickMarkPage`  | `NodePage` (← back → `/discover`) | Floating pill |

`useDiscoverNavigation` (`src/hooks/useDiscoverNavigation.ts`) exposes
`quickMarkPath` / `goToQuickMark()`, language-keyed exactly like `sortPath`. The
route is registered in `src/App.tsx`. `DiscoverPage` (`src/features/discover/DiscoverPage.tsx`)
renders the `HubMenuRow` as the **second** row — between Sort Cards and Skipped Cards
(purple `COLORS.purpleAccent`, `PlaylistAddCheckIcon`).

## 2. Page layout (top → bottom)

```
NodePage header:  ← back        Quick Mark        [Clear] [Save]   🔥
────────────────────────────────────────────────────────────────────
Level bar:                    [ HSK 3 ▾ ]          (dropdown, no Auto)
Legend:     ○ skip/none    ✓ Add to Learn Now    Ⓜ Mastered
────────────────────────────────────────────────────────────────────
                       ┌────┐  ┌────┐  ┌────┐
                       │card│  │card│  │card│      ← MiniVocabCardGrid
                       └────┘  └────┘  └────┘        (3-wide, cascade 15)
                       ┌────┐  ┌────┐  ┌────┐
                          … scrolls …
```

- **Header** (`NodePage.headerExtraActions`): **Clear** and **Save** buttons
  (mirrors SortCardsPage's header actions). The `MinutePointsFireBadge` sits to their
  right but is NOT passed here — `PageHeader` renders it on every header.
- **Level bar**: the same HSK/difficulty `Chip`+`Menu` dropdown as
  `SortCardsPage` (`src/features/discover/SortCardsPage.tsx`) **minus the `Auto`
  menu item** — Quick Mark is always a concrete level. Label is `HSK N` for zh,
  `Level N` otherwise (`difficultyLabel`).
- **Legend**: a static row explaining the three indicator states (§3).
- **Grid**: `MiniVocabCardGrid` (`src/components/MiniVocabCardGrid.tsx`) — the
  same 364px 3-wide wrapping grid used by the `/decks` Learn Now preview and
  `/flashcards/mastered`, in its `staggerReveal` mode: the first 15 cards fan in
  via per-card animation delay, the rest render with no entrance animation.

## 3. The three-state indicator

Each card carries **two** corner badges:

- **Top-left — frequency badge** (unchanged): the word's `frequencyScore`
  (1 = literary … 5 = natural colloquial), same circular dot Sort Cards draws at
  `SortCardsPage.tsx`.
- **Top-right — 3-state mark indicator** (new). Tapping the card **cycles** it:

  | State | Visual (top-right)          | Destination on Save        |
  | ----- | --------------------------- | -------------------------- |
  | 0     | empty circle `○`            | nothing (card left alone)  |
  | 1     | green check `✓`             | **library** ("Add to Learn Now") |
  | 2     | blue **M**                  | **already-learned** (Mastered)   |

  Cycle order: `empty → green → blue → empty`. The mark is **local UI state
  until Save**, and stays editable *after* Save too (§6 — Save reconciles).

`MiniVocabCard` draws a UTCM category badge top-left and has no top-right slot / no
frequency badge, and Quick Mark cards are det rows (not saved `VocabEntry`s). So the
grid renders a dedicated **`QuickMarkCard`** (`src/components/QuickMarkCard.tsx`) — same
92×132 thumbnail geometry, but driven by a `DiscoverCard` and carrying the two corner
badges. ⚠️ **It does not re-declare that geometry** (2026-09-01): the size, radius,
hairline ring, elevation, containment and pop-in all come from the shared
`miniCardFaceSx` (`src/components/miniCardFace.ts`), which `MiniVocabCard` and the
challenge word card also draw. They ARE the same tile and had already drifted — only
the fdp card carried the design's 1px inset ring — so anything about the tile itself
belongs in that file, never here. It is plugged in via a new **`renderCard`** prop on `MiniVocabCardGrid` (which
otherwise still owns the loading/error/empty states + the cascade-15 reveal). The
3-state value + cycle helper live in `src/components/quickMarkState.ts` (kept out of the
`.tsx` so the card file stays a component-only module for fast-refresh).

## 4. Persistence — reuses Sort Cards' buckets verbatim

No new tables/columns. Both destinations already exist in
`StarterPacksService.sortCard` (`server/services/StarterPacksService.ts`):

| Quick Mark state | Internal bucket    | Effect                                                          |
| ---------------- | ------------------ | -------------------------------------------------------------- |
| green ✓          | `library`          | upsert vet row, empty history → core band `Unfamiliar` |
| blue M           | `already-learned`  | upsert vet row + 8/8 on the **core** tracks (reading/writing stay 0) → core band `Mastered` |

Because both write a vet row, and the supply query excludes any word the user
has a vet row for (`_fetchSupplyRows` `NOT EXISTS (vet …)`,
`StarterPacksService.ts`), **cards already in the user's library/mastered
never appear in Quick Mark** — satisfying the "never override progress the user
already made" requirement automatically. (A card saved *this session* stays in
view for undo — §6 — because the current page is not refetched; a fresh page or
revisit will exclude it.)

### Empty state = no vet row (Save can delete)

Because saved cards remain on-page and re-editable (§6), the third effect is
un-saving: a card cycled **back to empty** and re-Saved must **delete** the vet
row created by an earlier Save. So the batch is a **reconcile**, not an append —
it drives each card's vet state to match its on-screen mark:
empty → *no vet row* (delete if present), green → library/Unfamiliar,
blue → already-learned/Mastered. `sortCard` already has the delete path
(`undoSort`, `StarterPacksService.ts`) to reuse.

## 5. Supply query

Service method `listQuickMarkCards(language, userId, level, cursor, limit=100)`
(`server/services/StarterPacksService.ts`):

- `WHERE de.language = $1 AND <supplyGate> AND <validPredicate>` — the supply gate is
  `_supplyGate()`: `de.discoverable = TRUE`, for every language (the zh-only `sortable`
  bar was retired by migration 144 — see docs/DISCOVER_FLOW.md § Card supply gate)
- `AND <levelExpr> = $level`  (exact level, no ±drift)
- `AND NOT EXISTS (vet row for this user/word[/pos])`  — excludes already-sorted
- **Skips are INCLUDED** (resolved): unlike Sort Cards' fresh supply, Quick Mark
  does **not** add the `discover_skips` exclusion (`StarterPacksService.ts` `skipFilter`)
  — a skipped word still has no vet row and gets a second chance to be triaged here.
- `ORDER BY de."frequencyScore" DESC NULLS LAST, de.id ASC`

**Pagination is KEYSET, not offset** (this is a correctness requirement, not a
preference): the batch save creates vet rows for the marked cards, which drops them
out of this vet-excluding result set. A numeric `OFFSET` would then skip that many
still-unsorted cards on the next page. Instead the client sends the last card's
`{ score, id }` as a cursor and the query resumes strictly after it on the stable sort
key — immune to rows removed above. `cursorScore` may be empty (the trailing
NULL-`frequencyScore` block); the query switches to `(frequencyScore IS NULL AND
id > cursorId)` there. `hasMore` is probed by fetching `limit + 1`.

**Default level** (resolved): opening the page with no `level` seeds from the user's
adaptive frontier — reuses Sort Cards' cold-start `estimateLevel` (mastered/learning
vet counts) and returns it as `level` with the first page.

Returns `{ cards: DiscoverCard[], level, hasMore }` (`DiscoverCard`, `src/types.ts`).

## 6. Save / Clear

- **Save** (header button): reconciles every **touched** card (its `marks` entry) to
  its on-screen mark in one request. Endpoint:
  `POST /api/starterPacks/quickMarkBatch`
  `Body: { language, marks: { cardId, state: 'empty'|'library'|'already-learned' }[] }`
  Server (`quickMarkBatch`), per mark: `library`/`already-learned` → `sortCard(…, { packId: null })`
  (the lightweight pack-mode return path — writes the vet row + clears any skip, no
  replacement-card compute); `empty` → `undoSort` deletes any vet row for that card
  (no-op if none). Per-card failures are logged and skipped; response is
  `{ success, applied }`.
  **Dirty-gated button** (`QuickMarkPage.tsx`, `isDirty` + `savedMarks`): the button is
  **grey/disabled when there is nothing to save** and **green/pressable once the marks
  diverge from the last-saved state**; a successful save re-baselines `savedMarks` to the
  committed snapshot, so it returns to grey and starts tracking anew. Dirtiness is a
  key-union comparison of `marks` vs `savedMarks` treating a missing key as `empty`, so:
  a card cycled all the way back to empty reads as *clean*, but a **Clear of a
  previously-saved mark reads as dirty** (it still needs a save to delete the vet row) —
  which is why the gate can't simply be "something is marked". A failed save leaves the
  baseline untouched, so the button stays green for a retry. Re-entrancy is guarded both
  by `disabled={… || saving}` and an early return in the handler.
- **Saved cards stay in view** (resolved): the current page is **not** refetched
  after Save, so the user keeps their last chance to undo — re-cycle a card's mark
  and Save again to move/remove it. Once they **leave the page**, saved cards are
  gone from this flow (their vet row excludes them from any future Quick Mark
  fetch); undoing later means deleting the card manually from their decks.
- **Clear** (header button): resets every **touched** card's mark to empty (untouched
  cards already render empty and have no vet row, so they're left out — keeping the
  next Save's payload proportional to what the user did, not the whole loaded page). No
  server call. To actually un-save previously-saved cards the user Clears *then* Saves —
  Save's reconcile deletes their vet rows.

### Footer clearance

The page keeps the nav footer (it's registered in all three route gates —
`Layout.tsx` `isMobileDemoPage` mounts the phone frame + footer, `FooterPresenter`
`FOOTER_ROUTE_PREFIXES` picks the Discover tab, `pageTransition.ts` `NODE_PREFIXES`
gives the node-page horizontal slide). The grid renders an explicit `FooterSpacer`
below its cards (in the grid `footer` slot): the ScrollArea's bottom padding is not
honored at scroll-end in this flex + overflow-scroll layout, so without the in-flow
spacer the last card row overlaps the footer bar by ~50px.

## 7. Layer summary

| Layer            | Piece                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| Route/nav        | `useDiscoverNavigation` (quickMarkPath), `App` route, `DiscoverPage` row |
| Page (view)      | `QuickMarkPage` (`NodePage` + level dropdown + legend + grid)          |
| Component        | `QuickMarkCard` (mini-card geometry + frequency badge + 3-state badge)|
| HTTP route       | `POST /api/starterPacks/quickMarkBatch`, `GET …/:language/quickMark` |
| Controller       | `StarterPacksController` (new handlers)                                |
| Service          | `StarterPacksService.listQuickMarkCards`, `.quickMarkBatch`           |
| DAL / DB         | **unchanged** — reuses vet rows + existing bucket effects              |

## 8. Referenced code

- `src/features/discover/QuickMarkPage.tsx` — the page (level dropdown, legend, grid, Save/Clear, keyset infinite scroll)
- `src/components/QuickMarkCard.tsx` + `src/components/quickMarkState.ts` — the 3-state card + cycle helper
- `src/components/MiniVocabCardGrid.tsx` — the shared grid; `renderCard` + `footer` + `staggerReveal` props added for Quick Mark. `staggerReveal` renders all cards at once and fans the first 15 in by a per-card animation-delay (instead of the paced batch reveal, which stepped as "3, then a batch, then the rest").
- `server/services/StarterPacksService.ts` — `listQuickMarkCards`, `quickMarkBatch` (reuse `sortCard` / `undoSort`)
- `server/controllers/StarterPacksController.ts` — `getQuickMarkCards`, `quickMarkBatch`
- `server/routes/starterPacksRoutes.ts` — the two Quick Mark routes
- `src/hooks/useDiscoverNavigation.ts`, `src/features/discover/DiscoverPage.tsx`, `src/App.tsx` — hub + route wiring
- `src/components/Layout.tsx` (`isMobileDemoPage`), `src/components/FooterPresenter.tsx`, `src/utils/pageTransition.ts` — the three route gates that give the page its phone frame, nav footer (Discover tab), and node-page slide
- `src/components/MobileFooter.tsx` `FooterSpacer` — the explicit bottom clearance the grid renders below its cards

### Dependency: the "already-learned" → Mastered write

Quick Mark's blue-M path delegates to `sortCard`'s `already-learned` branch, which
seeds `coreMasteredTypedMarkHistory` so the card's **core** bar reads Mastered —
recognition + production at 8/8, reading and writing left at 0 (migration 143; see
[MASTERY_REWORK § "Declaring a card already known"](./MASTERY_REWORK.md)). That write
goes through `VocabEntryDAL.updateTypedMarkHistory` (`typedMarkHistory`, migration
101), NOT the old generated `category` / `markHistory`. Quick Mark inherits whatever
`sortCard` does here — this very change needed no Quick Mark code, which is the point
of the delegation.

## 9. Resolved decisions

| Question              | Decision                                                                 |
| --------------------- | ------------------------------------------------------------------------ |
| Grid volume           | **Paginate** — infinite scroll, ~100 rows/page (KEYSET cursor, `hasMore`) |
| Skipped words         | **Included** — no `discover_skips` exclusion; skips get a second triage   |
| Post-save             | **Leave in view**, still editable/re-savable; no refetch of current page |
| Default level         | **User's current level** — seed from Sort Cards' adaptive frontier estimate |
| Cycle order           | `empty → green(library) → blue(mastered) → empty`                        |
| New tables/columns    | **None** — reuses vet rows + existing `library`/`already-learned` effects |
</content>
</invoke>
