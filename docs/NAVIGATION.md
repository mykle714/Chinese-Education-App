# App Navigation

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).

There is **no hamburger / nav drawer** and **no desktop sidebar** (both removed —
`MobileNavDrawer` is deleted and `Layout` carries no chrome). Navigation is:

1. **Footer tabs** (`MobileFooter`) — the four top-level destinations, always the
   flat full-width bar. Tabs are **text-only**; the icons were removed by the shelf
   redesign's A2a/D5 ([SHELF_REDESIGN.md](./SHELF_REDESIGN.md)), and the bar is laid
   out left-to-right in the order below, matching the design's `.fbar`:

   | Tab        | `FooterTab`   | Route               |
   | ---------- | ------------- | ------------------- |
   | Home       | `home`        | `/`                 |
   | Flashcards | `flashcards`  | `/flashcards/decks` |
   | Discover   | `discover`    | `/discover`         |
   | Account    | `account`     | `/account`          |

   The **active** tab is resolved from the current route by `FooterPresenter`.
   Pages do not declare it: the `activePage` prop that used to run through
   `MobileTabScreen` / `NodePage` fed the header's tab badge, and both were removed
   by the shelf redesign's A2b.

   The union type is `FooterTab` (exported from `MobileFooter.tsx`). The tab list
   itself is the `TABS` array in that file.

2. **Home menu** (`/`, `HomePage`) — a `HubMenu` (the shared row component, also
   used by Discover + Games hubs) of secondary destinations:
   **Night Market**, **Games**, **Community**, **Reader**, **Dictionary**,
   **Compare Words** (`/compare` — see
   [WORD_COMPARE_FEATURE.md](./WORD_COMPARE_FEATURE.md))
   (plus a validator-only **Tester Dashboard** row and two template-author-only rows).

3. **Back-arrow drill-ins** — every page reached from a hub has a common header
   with a back button. These come in two archetypes (see
   [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)): **leaf pages** (down arrow, no
   footer, back-arrow-only exit, slide up/down) and **node pages** (left arrow,
   keep the footer, slide in-from-right / out-to-right via the arrow).
   - Home-menu destinations → back to `/`: `/dictionary` (node), `/games` (node);
     `/night-market`, `/reader`, `/tester-dashboard` use their own headers.
   - Sort Cards (`/discover/sort/:language`) → back to `/discover` (leaf).
   - Card Detail (`/flashcards/card/:id`, saved-card cdp) → back (node); Mastered
     Cards (`/flashcards/mastered`) → back to Decks (node). Its breakdown/used-in/
     example drill-ins open the tapped word's saved card when the learner has one,
     else the read-only dictionary cdp (`src/hooks/useOpenWordCard.ts`).
   - Dictionary result tap → the read-only dictionary cdp (`/dictionary/card/:word`,
     node); its breakdown/example drill-ins open more read-only cdps. See
     [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) "Card detail (cdp): two surfaces".
   - Settings (`/settings`) → back to `/account` (leaf; opened from the Account
     header gear via `slideNavigate`, so it slides up into the phone frame).

## Account page absorbs the old drawer footer

The drawer's two global controls moved onto `AccountPage`:
- **Settings** → a gear `IconButton` in the Account header (`headerExtraActions`)
  that `slideNavigate`s to `/settings` (a leaf page rendered inside the phone frame).
- **Log Out** → a button in the Account body (`account-page__logout-section`),
  with the same confirm-then-`logout()` flow the drawer used.

## Layout / frame

`Layout.tsx` has two modes:
- Mobile-demo routes (`MOBILE_DEMO_PATHS`, which now includes `/`) → wrapped in
  `MobileDemoFrame` (full-bleed on mobile, centered phone card on desktop).
- Everything else (auth pages, etc.) → full-height, no chrome; each owns its
  `PageHeader`. (Reader / Night Market / Settings / Tester Dashboard render inside
  the frame as leaf pages; Dictionary + both card-detail cdps render inside the frame
  as node pages.)

## Tester Dashboard

`/tester-dashboard` (`TesterDashboardPage`) holds the **former landing-page**
content (study time, streak, monthly calendar, leaderboard). The old `/` landing
is now the Home menu.

**Validator-gated.** The surface is for testers/curators, not ordinary learners,
so it is gated on `users.isValidator` (migration 104, see
[DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md)) in two places, mirroring
the `isTemplateAuthor` gate on the Night Market template editor:

- `src/pages/HomePage.tsx` — the `tester-dashboard` hub row is spread in only when
  `user?.isValidator`, so non-validators never see the entry point.
- `src/pages/TesterDashboardPage.tsx` — a `useEffect` bounces a resolved,
  non-validator user to `/` (`replace: true`), covering deep links and bookmarks.

The route in `src/App.tsx` stays `allowPublic` on purpose: a validator may be a
public account, and the generic `isPublic` redirect must not pre-empt the
validator gate. This is a **UX gate, not a security boundary** — the page only
renders the caller's own minute-point data, and those endpoints remain
user-scoped server-side.

## Related

- [MOBILE_TAB_SCREEN_LAYOUT.md](./MOBILE_TAB_SCREEN_LAYOUT.md) — hub layout shell
- [DISCOVER_FLOW.md](./DISCOVER_FLOW.md) — Discover hub → Sort Cards
- [GAMES_FEATURE.md](./GAMES_FEATURE.md) — Games hub + registry
