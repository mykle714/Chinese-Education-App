# Discover Flow

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
| `/discover/sort/:language`  | `SortCardsPage` | `MobileDemoHeader` `showBack` (↓ back arrow) → `/discover` | **none** |

- **`/discover` (hub):** built on `MobileTabScreen` (`activePage="discover"`) +
  the shared `HubMenu` / `HubMenuRow` (same components the Games hub uses). Today
  it has a single row, **Sort Cards**, linking to the language-keyed sort page.
- **`/discover/sort/:language` (sort):** a focused drill-in. The header is a
  `MobileDemoHeader` with `showBack` (the down-chevron back arrow in the left
  slot) whose `onBack` returns to `/discover`; its right slot holds the page's
  `extraActions` (autoplay toggle, undo, streak badge). The sort page renders
  **no** `MobileFooter`. (Global nav is the footer tabs + Home menu — there is no
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
