# App Navigation

There is **no hamburger / nav drawer** and **no desktop sidebar** (both removed —
`MobileNavDrawer` is deleted and `Layout` carries no chrome). Navigation is:

1. **Footer tabs** (`MobileFooter`) — the four top-level destinations, always the
   floating pill:

   | Tab        | `activePage`  | Route               | Icon              |
   | ---------- | ------------- | ------------------- | ----------------- |
   | Flashcards | `flashcards`  | `/flashcards/decks` | `StyleIcon`       |
   | Discover   | `discover`    | `/discover`         | `LanguageIcon`    |
   | Home       | `home`        | `/`                 | `HomeIcon`        |
   | Account    | `account`     | `/account`          | `AccountCircleIcon` |

   The union type is `FooterTab` (exported from `MobileFooter.tsx`).

2. **Home menu** (`/`, `HomePage`) — a `HubMenu` (the shared row component, also
   used by Discover + Games hubs) of secondary destinations:
   **Night Market**, **Games**, **Reader**, **Dictionary**, **Tester Dashboard**.

3. **Back-arrow drill-ins** — every page reached from a hub has a common header
   with a down-chevron back button:
   - Home-menu destinations (`/night-market`, `/games`, `/reader`, `/dictionary`,
     `/tester-dashboard`) → back to `/`.
   - Sort Cards (`/discover/sort/:language`) → back to `/discover`.
   - Settings (`/settings`) → back to `/account` (opened from the Account header
     gear).

## Account page absorbs the old drawer footer

The drawer's two global controls moved onto `AccountPage`:
- **Settings** → a gear `IconButton` in the Account header (`headerExtraActions`)
  that navigates to `/settings`.
- **Log Out** → a button in the Account body (`account-page__logout-section`),
  with the same confirm-then-`logout()` flow the drawer used.

## Layout / frame

`Layout.tsx` has two modes:
- Mobile-demo routes (`MOBILE_DEMO_PATHS`, which now includes `/`) → wrapped in
  `MobileDemoFrame` (full-bleed on mobile, centered phone card on desktop).
- Everything else (Reader / Dictionary / Night Market / Settings / Tester
  Dashboard / auth) → full-height, no chrome; each owns its `PageHeader`.

## Tester Dashboard

`/tester-dashboard` (`TesterDashboardPage`) holds the **former landing-page**
content (study time, streak, monthly calendar, leaderboard). The old `/` landing
is now the Home menu.

## Related

- [MOBILE_TAB_SCREEN_LAYOUT.md](./MOBILE_TAB_SCREEN_LAYOUT.md) — hub layout shell
- [DISCOVER_FLOW.md](./DISCOVER_FLOW.md) — Discover hub → Sort Cards
- [GAMES_FEATURE.md](./GAMES_FEATURE.md) — Games hub + registry
