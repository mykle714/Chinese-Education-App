# Discover Flow

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).

The Discover feature is a **two-level** surface, mirroring the Games hub.

```
Footer "Discover" tab
        │  goToDiscover()
        ▼
/discover            ← Discover hub (DiscoverPage): a HubMenu of activities.
        │              Has the floating footer (footer-tab surface).
        │  HubMenuRow "Sort Cards" → sortPath
        ▼
/discover/sort/:language   ← Sort Cards page (SortCardsPage): the drag-to-sort
                             screen. NO footer. Back-arrow header returns to
                             the hub.
```

## Pages

| Route                       | Component       | Header                              | Footer            |
| --------------------------- | --------------- | ----------------------------------- | ----------------- |
| `/discover`                 | `DiscoverPage`  | `MobileDemoHeader` (Discover badge) | Floating pill     |
| `/discover/sort/:language`  | `SortCardsPage` | `LeafPage` (↓ back arrow) → `/discover` | **none** |

- **`/discover` (hub):** built on `MobileTabScreen` (`activePage="discover"`) +
  the shared `HubMenu` / `HubMenuRow` (same components the Games hub uses). Today
  it has a single row, **Sort Cards**, linking to the language-keyed sort page.
- **`/discover/sort/:language` (sort):** a **leaf page** (see
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)) — wrapped in `LeafPage`, which owns
  the down-chevron back arrow (`onBack` → `/discover`), the slide-up/down
  transition, and the back-arrow-only exit. Its right slot holds the page's
  `rightContent` (autoplay toggle, undo, streak badge). A leaf page renders **no**
  `MobileFooter`. (Global nav is the footer tabs + Home menu — there is no
  hamburger; see [NAVIGATION.md](./NAVIGATION.md).)

## Navigation helper

`src/hooks/useDiscoverNavigation.ts` centralizes the routes + default language:

| Member          | Value                          | Used by                              |
| --------------- | ------------------------------ | ------------------------------------ |
| `discoverPath`  | `/discover`                    | hub navigation                       |
| `goToDiscover()`| navigate → `/discover`         | footer Discover tab, decks nudges    |
| `sortPath`      | `/discover/sort/{language}`    | the hub's Sort Cards row             |
| `goToSort()`    | navigate → `sortPath`          | (available for direct sort entry)    |

`language` resolves from `user.selectedLanguage`, defaulting to `zh`.

## Related

- Hub layout / floating footer: [MOBILE_TAB_SCREEN_LAYOUT.md](./MOBILE_TAB_SCREEN_LAYOUT.md)
- Shared hub menu + header model: [GAMES_FEATURE.md](./GAMES_FEATURE.md)
