# Discover Flow

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).
> → Card supply / lazy enrichment: [DISCOVER_LAZY_ENRICHMENT.md](./DISCOVER_LAZY_ENRICHMENT.md)
> (which det entries appear, and on-first-sort enrichment).

The Discover feature is a **two-level** surface, mirroring the Games hub.

```
Footer "Discover" tab
        │  goToDiscover()
        ▼
/discover            ← Discover hub (DiscoverPage): a Bento of activities.
        │              Has the floating footer (footer-tab surface).
        │  BentoTile "Sort Cards"    → sortPath       (hero)
        │  BentoTile "Quick Mark"    → quickMarkPath  (fullWidth)
        ├───────────────────┬
        ▼                   ▼
/discover/sort/     /discover/quick-mark/
  :language           :language
  ← Sort Cards        ← Quick Mark
    (SortCardsPage):    (QuickMarkPage): bulk-
    drag-to-sort.       triage grid at one
    Node page (keeps    level; swipe a card ←
    footer). Back→hub.  Learn Now / → Mastered,
    Hold Skip 2 s →     saved per swipe.
    skipped-cards       Node page. Back→hub.
    sheet (hidden).
```

## Pages

| Route                          | Component          | Header                                  | Footer        |
| ------------------------------ | ------------------ | --------------------------------------- | ------------- |
| `/discover`                     | `DiscoverPage`     | `MobileDemoHeader` (Discover badge)     | Floating pill |
| `/discover/sort/:language`      | `SortCardsPage`    | `NodePage` (← back arrow) → `/discover`  | Floating pill |
| `/discover/quick-mark/:language`| `QuickMarkPage`    | `NodePage` (← back arrow) → `/discover` | Floating pill |

- **`/discover` (hub):** built on `MobileTabScreen` +
  the shared `Bento` / `BentoTile` (see [BENTO_SYSTEM.md](./BENTO_SYSTEM.md); `HubMenu` was
  deleted 2026-08-21). It has two tiles, in order: **Sort Cards** (the drag-to-sort page, `hero`) and **Quick
  Mark** (the bulk-triage grid, `fullWidth` so it owns its row), both language-keyed.
  There is deliberately **no Skipped Cards tile** — see the sort bullet below.
- **`/discover/quick-mark/:language` (quick mark):** a **node page** (`NodePage`, keeps
  the footer, ← back → `/discover`). A level dropdown (no Auto) filters to every
  not-yet-sorted discoverable word at that level, shown in the shared `MiniVocabCardGrid`
  ordered by frequency score. Each card is swiped (axis-locked, so vertical drags still
  scroll): left = Add to Learn Now, right = Mastered — saved immediately, the card flies
  off and the grid closes up, with an Undo toast for the last swipe. A tap opens the eip.
  See [QUICK_MARK.md](./QUICK_MARK.md).
- **`/discover/sort/:language` (sort):** a **node page** (see
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)) — wrapped in `NodePage`, which **keeps
  the footer** (lateral nav stays available while sorting), owns the ← back arrow
  (`onBack` → `/discover`) and the horizontal slide. The **Skip** button sits on the
  on-deck platform's top-right (`OnDeckToolbar`), not in the header.
  - **Skipped cards live here, hidden:** holding Skip for 2 s opens
    `SkippedCardsSheet`, the only way to reach skipped cards (tap a card → eip, hold a
    card → recycle it, Recycle all). The old `/discover/skipped/:language` page
    (`SkippedCardsPage`) and its hub tile were removed 2026-10-12. See
    [SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md) §5.1a and §7.

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

`src/hooks/useDiscoverNavigation.ts` centralizes the routes + default language:

| Member          | Value                          | Used by                              |
| --------------- | ------------------------------ | ------------------------------------ |
| `discoverPath`  | `/discover`                    | hub navigation                       |
| `goToDiscover()`| navigate → `/discover`         | footer Discover tab (`MobileFooter`) |
| `sortPath`      | `/discover/sort/{language}`    | the hub's Sort Cards row             |
| `goToSort()`    | navigate → `sortPath`          | fdp Sort Cards tile (`DecksTopRail`) |
| `quickMarkPath` | `/discover/quick-mark/{language}` | the hub's Quick Mark row          |
| `goToQuickMark()`| navigate → `quickMarkPath`    | (available for direct quick-mark entry) |

`language` resolves from `user.selectedLanguage`, defaulting to `zh`.

## Related

- Hub layout / floating footer: [MOBILE_TAB_SCREEN_LAYOUT.md](./MOBILE_TAB_SCREEN_LAYOUT.md)
- Shared hub menu + header model: [GAMES_FEATURE.md](./GAMES_FEATURE.md)
- Hand-crafted beginner card order (CSV export + authored `sort_packs`): [DISCOVER_BEGINNER_CURATION.md](./DISCOVER_BEGINNER_CURATION.md)
- Sort packs rework build plan (multi-card packs + Skipped page): [SORT_PACKS_IMPLEMENTATION.md](./SORT_PACKS_IMPLEMENTATION.md)
