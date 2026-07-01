# Discover Flow

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).

The Discover feature is a **two-level** surface, mirroring the Games hub.

```
Footer "Discover" tab
        │  goToDiscover()
        ▼
/discover            ← Discover hub (DiscoverPage): a HubMenu of activities.
        │              Has the floating footer (footer-tab surface).
        │  HubMenuRow "Sort Cards"    → sortPath
        │  HubMenuRow "Skipped Cards" → skippedPath
        ├───────────────────────────────┐
        ▼                               ▼
/discover/sort/:language          /discover/skipped/:language
  ← Sort Cards page                  ← Skipped Cards page
    (SortCardsPage): the drag-to-       (SkippedCardsPage): a Mastered-style
    sort screen. Node page              list of the user's skipped words.
    (keeps footer). Back → hub.         Node page (keeps footer). Back → hub.
                                        Tap a card → action popup
                                        (Cancel / Already Learned / Learn Now).
```

## Pages

| Route                          | Component          | Header                                  | Footer        |
| ------------------------------ | ------------------ | --------------------------------------- | ------------- |
| `/discover`                    | `DiscoverPage`     | `MobileDemoHeader` (Discover badge)     | Floating pill |
| `/discover/sort/:language`     | `SortCardsPage`    | `NodePage` (← back arrow) → `/discover`  | Floating pill |
| `/discover/skipped/:language`  | `SkippedCardsPage` | `NodePage` (← back arrow) → `/discover` | Floating pill |

- **`/discover` (hub):** built on `MobileTabScreen` (`activePage="discover"`) +
  the shared `HubMenu` / `HubMenuRow` (same components the Games hub uses). It has two
  rows: **Sort Cards** (the drag-to-sort page) and **Skipped Cards** (the skipped-words
  list), both language-keyed.
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

## Navigation helper

`src/hooks/useDiscoverNavigation.ts` centralizes the routes + default language:

| Member          | Value                          | Used by                              |
| --------------- | ------------------------------ | ------------------------------------ |
| `discoverPath`  | `/discover`                    | hub navigation                       |
| `goToDiscover()`| navigate → `/discover`         | footer Discover tab, decks nudges    |
| `sortPath`      | `/discover/sort/{language}`    | the hub's Sort Cards row             |
| `goToSort()`    | navigate → `sortPath`          | (available for direct sort entry)    |
| `skippedPath`   | `/discover/skipped/{language}` | the hub's Skipped Cards row          |
| `goToSkipped()` | navigate → `skippedPath`       | (available for direct skipped entry) |

`language` resolves from `user.selectedLanguage`, defaulting to `zh`.

## Related

- Hub layout / floating footer: [MOBILE_TAB_SCREEN_LAYOUT.md](./MOBILE_TAB_SCREEN_LAYOUT.md)
- Shared hub menu + header model: [GAMES_FEATURE.md](./GAMES_FEATURE.md)
- Hand-crafted beginner card order (CSV export + authored `sort_packs`): [DISCOVER_BEGINNER_CURATION.md](./DISCOVER_BEGINNER_CURATION.md)
- Sort packs rework build plan (multi-card packs + Skipped page): [SORT_PACKS_IMPLEMENTATION.md](./SORT_PACKS_IMPLEMENTATION.md)
