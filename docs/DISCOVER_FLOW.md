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
  ordered by vernacular score. Each card has a vernacular badge (top-left) and a tappable
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
