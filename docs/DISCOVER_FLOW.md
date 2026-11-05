# Discover Flow

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).
> → Card supply / lazy enrichment: [DISCOVER_LAZY_ENRICHMENT.md](./DISCOVER_LAZY_ENRICHMENT.md)
> (which det entries appear, and on-first-sort enrichment).

"Discover" is the card-intake flow: **Add New Cards** (ancp) — the drag-to-sort page — plus
the skipped-cards sheet that lives inside it. It is a single **drill-in from the Deck
Tower** (`/`), not a hub.

The Discover hub page (`/discover`, `DiscoverPage`) was **deleted 2026-10-17**.
`/discover` is no longer a route (`findRoute("/discover")` is undefined) and `"discover"`
is not a `FooterTab` key (`src/components/MobileFooter.tsx` → `FooterTab`). Only the
`/discover/` **URL prefix** survives, as ancp's path, so existing links (e.g.
`?set=provisional` sort offers) keep working.

```
Deck Tower (/) — main world's mini sort platform
  (DeckTowerPage → sortBin, state.exitTo = SORT_EXIT)
                               │
                               ▼
/discover/sort/:language
  ← Add New Cards (AddNewCardsPage): drag-to-sort.
    Node page (keeps footer, Deck tab lit). Back → / (main world).
    Hold Skip 2 s → skipped-cards sheet (hidden).
```

## Pages

| Route                          | Component          | Header                                  | Footer        |
| ------------------------------ | ------------------ | --------------------------------------- | ------------- |
| `/discover/sort/:language`      | `AddNewCardsPage`    | `NodePage` (← back arrow) → `/`          | Slab, **Deck** tab lit |

- **`/discover/sort/:language` (sort):** a **node page** (see
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)) — wrapped in `NodePage`, which **keeps
  the footer** (lateral nav stays available while sorting), owns the ← back arrow and
  the horizontal slide. Its `ROUTE_META` row (`src/routes/routeMeta.ts`) sets
  `footerTab: "deck"` and `footerStyle: "slab"` — ancp is a Deck Tower drill-in.
  - **Back arrow:** in normal mode `onBack` (`AddNewCardsPage` → `leave`) follows the
    launch's `state.exitTo`: the Deck Tower's mini sort platform opens ancp with the
    circle transition and `exitTo` = the tower's main world (`SORT_EXIT`), and Back closes
    the circle onto that platform and returns there ([DECK_TOWER.md](./DECK_TOWER.md)
    § The sort platform). Without `exitTo` (a deep link) Back goes to `/` with
    `state.towerWorld: "core"`. With `exitTo`, the footer's Deck tab plays Back too
    (`backOnFooterTab = "deck"`). In **set mode** (`?set=provisional`, a sort offer) it
    calls `exitToOrigin` instead (`src/features/discover/AddNewCardsPage.tsx` →
    `exitToOrigin`): `navigate(-1)` when there is history, else the recorded `?from=`
    origin, else `/`.
  - The **Skip** button sits on the on-deck platform's top-right (`OnDeckToolbar`), not
    in the header.
  - **Skipped cards live here, hidden:** holding Skip for 2 s opens
    `SkippedCardsSheet`, the only way to reach skipped cards (tap a card → eip, hold a
    card → recycle it, Recycle all). The old `/discover/skipped/:language` page
    (`SkippedCardsPage`) and its hub tile were removed 2026-10-12. See
    [SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md) §5.1a and §7.
  - **Quick Mark is not mounted.** `src/features/discover/QuickMarkPanel.tsx` (with
    `useQuickMarkGrid`) is still in the tree but nothing renders it — ancp has no ⊞
    button. See [QUICK_MARK.md](./QUICK_MARK.md).

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
route + default language. It returns only `sortPath`:

| Member          | Value                          | Used by                              |
| --------------- | ------------------------------ | ------------------------------------ |
| `sortPath`      | `/discover/sort/{language}`    | the Deck Tower's mini sort platform (`DeckTowerPage` → `sortBin`) |

`language` resolves from `user.selectedLanguage`, defaulting to `zh`. The hub members
`discoverPath` / `goToDiscover` were removed with the hub (2026-10-17).

## Related

- Node-page (drill-in) archetype: [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)
- Footer tabs: [NAVIGATION.md](./NAVIGATION.md)
- Hand-crafted beginner card order (CSV export + authored `sort_packs`): [DISCOVER_BEGINNER_CURATION.md](./DISCOVER_BEGINNER_CURATION.md)
- Sort packs rework build plan (multi-card packs + Skipped page): [SORT_PACKS_IMPLEMENTATION.md](./SORT_PACKS_IMPLEMENTATION.md)
