# Discover Flow

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).
> → Card supply / lazy enrichment: [DISCOVER_LAZY_ENRICHMENT.md](./DISCOVER_LAZY_ENRICHMENT.md)
> (which det entries appear, and on-first-sort enrichment).

The Discover feature is a **two-level** surface, mirroring the Games hub.

```
Footer "Discover" tab
        │  goToDiscover()
        ▼
/discover            ← Discover hub (DiscoverPage): a HubMenu of activities.
        │              Has the floating footer (footer-tab surface).
        │  HubMenuRow "Sort Cards"    → sortPath
        │  HubMenuRow "Quick Mark"    → quickMarkPath
        │  HubMenuRow "Skipped Cards" → skippedPath
        ├───────────────────┬───────────────────────┐
        ▼                   ▼                       ▼
/discover/sort/     /discover/quick-mark/     /discover/skipped/
  :language           :language                 :language
  ← Sort Cards        ← Quick Mark              ← Skipped Cards
    (SortCardsPage):    (QuickMarkPage): bulk-    (SkippedCardsPage): a
    drag-to-sort.       triage grid at one        Mastered-style list of
    Node page (keeps    level; tap cards to        skipped words. Node page.
    footer). Back→hub.  cycle a 3-state mark,      Tap → action popup
                        Save commits all.          (Cancel / Already
                        Node page. Back→hub.       Learned / Learn Now).
```

## Pages

| Route                          | Component          | Header                                  | Footer        |
| ------------------------------ | ------------------ | --------------------------------------- | ------------- |
| `/discover`                     | `DiscoverPage`     | `MobileDemoHeader` (Discover badge)     | Floating pill |
| `/discover/sort/:language`      | `SortCardsPage`    | `NodePage` (← back arrow) → `/discover`  | Floating pill |
| `/discover/quick-mark/:language`| `QuickMarkPage`    | `NodePage` (← back arrow) → `/discover` | Floating pill |
| `/discover/skipped/:language`   | `SkippedCardsPage` | `NodePage` (← back arrow) → `/discover` | Floating pill |

- **`/discover` (hub):** built on `MobileTabScreen` (`activePage="discover"`) +
  the shared `HubMenu` / `HubMenuRow` (same components the Games hub uses). It has three
  rows, in order: **Sort Cards** (the drag-to-sort page), **Quick Mark** (the bulk-triage
  grid), and **Skipped Cards** (the skipped-words list), all language-keyed.
- **`/discover/quick-mark/:language` (quick mark):** a **node page** (`NodePage`, keeps
  the footer, ← back → `/discover`). A level dropdown (no Auto) filters to every
  not-yet-sorted discoverable word at that level, shown in the shared `MiniVocabCardGrid`
  ordered by frequency score. Each card has a frequency badge (top-left) and a tappable
  3-state indicator (top-right: empty / green "Add to Learn Now" / blue "Mastered");
  Save commits all marks at once, Clear resets them. See [QUICK_MARK.md](./QUICK_MARK.md).
- **`/discover/sort/:language` (sort):** a **node page** (see
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)) — wrapped in `NodePage`, which **keeps
  the footer** (lateral nav stays available while sorting), owns the ← back arrow
  (`onBack` → `/discover`) and the horizontal slide. Its `headerExtraActions` slot
  holds the page actions (autoplay toggle, **Skip** button, undo, streak badge).
- **`/discover/skipped/:language` (skipped):** a **node page** (`NodePage`, keeps the
  footer + horizontal slide, ← back arrow → `/discover`) listing the user's skipped
  words for the language via `MiniVocabCardGrid` (modeled on the Mastered cards page). A
  **Recycle all** action at the top of the content returns every skipped card to the
  sort supply. Tapping a card opens an **action popup** (Cancel / Mark as Already
  Learned / Mark as Learn Now); choosing a destination sorts the card and removes it
  from the skipped list. See [SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md) §7.

## Card supply gate

Every discover surface draws its cards from the per-language det table through **one**
predicate, `StarterPacksService._supplyGate()`
(`server/services/StarterPacksService.ts:205`):

```sql
de.discoverable = TRUE
```

No language branch, no second flag. Its four callers are `_fetchSupplyRows` (Sort
Cards), `listQuickMarkCards` (Quick Mark), `getProgress` (the level bar), and — kept
deliberately identical — `ProvisionalCardDAL._supplyGate`
(`server/dal/implementations/ProvisionalCardDAL.ts:28`), so a word lent as a
provisional card is always a word the sort flow can later offer. On top of the gate
each query still applies the Tier-1 level filter `difficulty BETWEEN 1 AND 6`
(`_levelConfig().validPredicate`).

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
| `goToDiscover()`| navigate → `/discover`         | footer Discover tab, decks nudges    |
| `sortPath`      | `/discover/sort/{language}`    | the hub's Sort Cards row             |
| `goToSort()`    | navigate → `sortPath`          | (available for direct sort entry)    |
| `quickMarkPath` | `/discover/quick-mark/{language}` | the hub's Quick Mark row          |
| `goToQuickMark()`| navigate → `quickMarkPath`    | (available for direct quick-mark entry) |
| `skippedPath`   | `/discover/skipped/{language}` | the hub's Skipped Cards row          |
| `goToSkipped()` | navigate → `skippedPath`       | (available for direct skipped entry) |

`language` resolves from `user.selectedLanguage`, defaulting to `zh`.

## Related

- Hub layout / floating footer: [MOBILE_TAB_SCREEN_LAYOUT.md](./MOBILE_TAB_SCREEN_LAYOUT.md)
- Shared hub menu + header model: [GAMES_FEATURE.md](./GAMES_FEATURE.md)
- Hand-crafted beginner card order (CSV export + authored `sort_packs`): [DISCOVER_BEGINNER_CURATION.md](./DISCOVER_BEGINNER_CURATION.md)
- Sort packs rework build plan (multi-card packs + Skipped page): [SORT_PACKS_IMPLEMENTATION.md](./SORT_PACKS_IMPLEMENTATION.md)
