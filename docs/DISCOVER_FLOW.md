# Discover Flow

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).
> → Card supply / lazy enrichment: [DISCOVER_LAZY_ENRICHMENT.md](./DISCOVER_LAZY_ENRICHMENT.md)
> (which det entries appear, and on-first-sort enrichment).

"Discover" is the card-intake flow: **Sort Cards** (scp) — the drag-to-sort page — plus
the Quick Mark panel and skipped-cards sheet that live inside it. It is a single
**drill-in from Home** (`/`), not a hub.

The Discover hub page (`/discover`, `DiscoverPage`) was **deleted 2026-10-17**; its only
tile was Sort Cards. Its footer tab had already been replaced by **Deck** (`/deck-tower`,
[DECK_TOWER.md](./DECK_TOWER.md)). `/discover` is no longer a route (`findRoute("/discover")`
is undefined) and `"discover"` is no longer a `FooterTab` key
(`src/components/MobileFooter.tsx` → `FooterTab`). Only the `/discover/` **URL prefix**
survives, as scp's path, so existing links (e.g. `?set=provisional` sort offers) keep
working.

```
Home (/) — decks rail "Sort Cards" tile          Memory Map empty state
  (DecksTopRail → goToSort)                       "Find words" (goToSort)
        │                                                   │
        └──────────────────────┬────────────────────────────┘
                               ▼
/discover/sort/:language
  ← Sort Cards (SortCardsPage): drag-to-sort.
    Node page (keeps footer, Home tab lit). Back → Home (/).
    Hold Skip 2 s → skipped-cards sheet (hidden).
    ⊞ beside Skip → Quick Mark panel (QuickMarkPanel):
      bulk-triage grid at one level; swipe a card
      ← Learning / → Mastered, saved per swipe.
      ✕ collapses back to the on-deck platform.
```

## Pages

| Route                          | Component          | Header                                  | Footer        |
| ------------------------------ | ------------------ | --------------------------------------- | ------------- |
| `/discover/sort/:language`      | `SortCardsPage`    | `NodePage` (← back arrow) → `/`          | Floating pill, **Home** tab lit |

- **`/discover/sort/:language` (sort):** a **node page** (see
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)) — wrapped in `NodePage`, which **keeps
  the footer** (lateral nav stays available while sorting), owns the ← back arrow and
  the horizontal slide. Its `ROUTE_META` row (`src/routes/routeMeta.ts`) sets
  `footerTab: "home"`, so the Home tab lights — scp is a Home drill-in.
  - **Back arrow:** in normal mode `onBack` navigates to `/` (Home), the only screen
    that links here besides Memory Map's empty state. In **set mode**
    (`?set=provisional`, a sort offer) it calls `exitToOrigin` instead
    (`src/features/discover/SortCardsPage.tsx` → `exitToOrigin`): `navigate(-1)` when
    there is history, else the recorded `?from=` origin, else `/`.
  - The **Skip** button sits on the on-deck platform's top-right (`OnDeckToolbar`), not
    in the header.
  - **Skipped cards live here, hidden:** holding Skip for 2 s opens
    `SkippedCardsSheet`, the only way to reach skipped cards (tap a card → eip, hold a
    card → recycle it, Recycle all). The old `/discover/skipped/:language` page
    (`SkippedCardsPage`) and its hub tile were removed 2026-10-12. See
    [SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md) §5.1a and §7.
  - **Quick Mark lives here too:** the ⊞ button beside Skip maximizes the on-deck
    platform into the Quick Mark grid (`src/features/discover/QuickMarkPanel.tsx` →
    `QuickMarkPanel`; state in `src/features/discover/useQuickMarkGrid.ts` →
    `useQuickMarkGrid`), maximized over the whole frame (page header included), with the on-deck
    pack's unsorted cards pinned first. A level chip (no Auto) filters to not-yet-sorted
    discoverable words at that level; each card is swiped (axis-locked): left = Add to
    Learning, right = Mastered, saved immediately, with an Undo toast. The panel's ✕
    collapses it back. See [QUICK_MARK.md](./QUICK_MARK.md) and
    [SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md) § 4.8.

## Card supply gate

Every discover surface draws its cards from the per-language det table through **one**
predicate, `StarterPacksService._supplyGate()`
(`server/services/StarterPacksService.ts`):

```sql
de.discoverable = TRUE
```

No language branch, no second flag. Its four callers are `_fetchSupplyRows` (Sort
Cards), `listQuickMarkCards` (Quick Mark), `getProgress` (the level bar), and — kept
deliberately identical — `ProvisionalCardDAL._supplyGate`
(`server/dal/implementations/ProvisionalCardDAL.ts`), so a word lent as a
provisional card is always a word the sort flow can later offer. On top of the gate
each query still applies the Tier-1 level filter `difficulty BETWEEN 1 AND 6`
(`_levelConfig().validPredicate`).

The gate also guards the **write** side, not only supply. `sortCard`'s id lookup
(`StarterPacksService._findDiscoverCardById`) applies `_supplyGate()` too, because a
hand-rolled `POST /api/starterPacks/sort` can send any det id — without it, that call
adds an arbitrary dictionary row to the caller's library, including rows whose
enrichment columns are still null. Safe for provisional promotion: lent cards are
drawn from `discoverable = TRUE` rows as well. See
[API_ABUSE_HARDENING.md](./API_ABUSE_HARDENING.md) § 1b.

⚠️ The two `_supplyGate` implementations are byte-identical copies kept in sync by
hand. They agree today; a change to one silently desynchronises discover from
provisional lending.

### Historical: the retired `sortable` flag

Migration 110 added a zh-only second flag, `sortable` — a lower bar meaning
"level-assigned + lead gloss cleaned, safe as a sort card" — so partially-enriched
rows could reach discover ahead of the full 13-step manifest, with
`discoverable ⇒ sortable` as a corpus invariant.

**Migration 144 drops it.** The split only pays off if the cheap two-step corpus
pre-pass behind it actually runs, and it never did: at the point of removal 1,517 of
114,774 zh rows were sortable (1.3%) and only **218** were sortable-but-not-
discoverable, because the oracle backfill's `--discoverable` heal queue refills on
every manifest version bump and starved the `--unsortable` pre-pass scope. The cost
was a language fork in every supply query, a second promotion script
(`promote-sortable.js`), a second completeness bar (`buildSortableReadyPredicate`), a
second planner scope, and an invariant every writer of `discoverable` had to
maintain. Those 218 rows simply left discover; their pre-pass work is still in
`difficulty` / `definitions` / `enrichmentLog`, so they promote normally once the
rest of the manifest lands.

## Navigation helper

`src/hooks/useDiscoverNavigation.ts` → `useDiscoverNavigation` centralizes the sort
route + default language:

| Member          | Value                          | Used by                              |
| --------------- | ------------------------------ | ------------------------------------ |
| `sortPath`      | `/discover/sort/{language}`    | — (returned for link-style callers)  |
| `goToSort()`    | navigate → `sortPath`          | Home decks rail Sort Cards tile (`src/features/flashcards/DecksTopRail.tsx`), Memory Map's empty-state "Find words" CTA (`src/games/memory-map/MemoryMapPage.tsx`) |

`language` resolves from `user.selectedLanguage`, defaulting to `zh`. The hub members
`discoverPath` / `goToDiscover` were removed with the hub (2026-10-17).

## Related

- Node-page (drill-in) archetype: [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)
- Footer tabs / Home: [NAVIGATION.md](./NAVIGATION.md)
- Hand-crafted beginner card order (CSV export + authored `sort_packs`): [DISCOVER_BEGINNER_CURATION.md](./DISCOVER_BEGINNER_CURATION.md)
- Sort packs rework build plan (multi-card packs + Skipped page): [SORT_PACKS_IMPLEMENTATION.md](./SORT_PACKS_IMPLEMENTATION.md)
