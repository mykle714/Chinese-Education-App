# App Navigation

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).

There is **no hamburger / nav drawer** and **no desktop sidebar** (both removed —
`MobileNavDrawer` is deleted and `Layout` carries no chrome). Navigation is:

1. **Footer tabs** (`MobileFooter`) — the four top-level destinations, always the
   flat full-width bar. Tabs are **text-only**; the icons were removed by the shelf
   redesign's A2a/D5 ([SHELF_REDESIGN.md](./SHELF_REDESIGN.md)), and the bar is laid
   out left-to-right in the order below, matching the design's `.fbar`:

   | Tab        | `FooterTab`   | Route         | Page                                                         |
   | ---------- | ------------- | ------------- | ------------------------------------------------------------ |
   | Home       | `home`        | `/`           | the fdp (`FlashcardsDecksPage`) wrapped by `HomePage`        |
   | Menu       | `menu`        | `/menu`       | the hub bento (`MenuPage`)                                   |
   | Deck       | `deck`        | `/deck-tower` | the Deck Tower (`DeckTowerPage`, experimental — [DECK_TOWER.md](./DECK_TOWER.md)) |
   | Dictionary | `dictionary`  | `/dictionary` | the dictionary search                                        |

   **Deck took Discover's slot on 2026-10-17**, and the Discover hub page (`/discover`,
   `DiscoverPage`) was deleted the same day — its only tile was Sort Cards. Sort Cards
   (scp, `/discover/sort/:language`, the `/discover/` prefix kept so existing links
   work) is now a **Home drill-in**: reached from the decks rail's Sort shortcut
   (`src/features/flashcards/DecksTopRail.tsx` → `goToSort`) and Memory Map's empty
   state, it lights the Home tab and its back arrow returns to `/`
   ([DISCOVER_FLOW.md](./DISCOVER_FLOW.md)). Quick Mark has no route of its own — it
   is a panel inside the sort page ([QUICK_MARK.md](./QUICK_MARK.md)).

   Dictionary took Account's slot on 2026-10-09. There is **no `/account` route** any
   more — the account surface is a sheet raised from the Home header (see 2 below).
   On 2026-10-10 Home and Menu **swapped contents**: the decks page (formerly the
   Flashcards tab at `/flashcards/decks`) became Home, and the hub bento (formerly Home)
   moved to the new Menu tab. The `flashcards` `FooterTab` key is gone, and
   `/flashcards/decks` survives only as a legacy redirect to `/`
   (`src/features/flashcards/DecksRedirect.tsx` → `DecksRedirect`, same pattern as
   `MasteredRedirect`; its `routeMeta` row lights `home`).

   The **active** tab is resolved from the current route by `FooterPresenter`
   (`routeFooterTab` in `src/routes/routeMeta.ts`). Pages do not declare it: the
   `activePage` prop that used to run through `MobileTabScreen` / `NodePage` fed the
   header's tab badge, and both were removed by the shelf redesign's A2b.

   **Which tab each drill-in lights** (the `footerTab` field of its `routeMeta` row;
   leaf pages have no footer and so no `footerTab`):

   | Lights | Routes |
   | --- | --- |
   | `home` | `/`, `/flashcards/decks` (redirect), `/flashcards/collection/:builtin`, `/flashcards/deck/:id`, `/flashcards/reading`, `/flashcards/writing`, `/flashcards/mastered` (redirect), `/flashcards/card/:id`, `/discover/sort/:language` |
   | `menu` | `/menu`, `/games`, `/community`, `/arena`, `/friends`, `/friends/requests`, `/friends/sent`, `/friends/remove`, `/friends/challenges*`, `/users/:userId`, `/reader` |
   | `deck` | `/deck-tower` |
   | `dictionary` | `/dictionary`, `/dictionary/card/:word` |

   The union type is `FooterTab` (exported from `MobileFooter.tsx`). The tab list
   itself is the `TABS` array in that file.

2. **Home** (`/`, `src/pages/HomePage.tsx` → `HomePage`) — the fdp. `HomePage` is a
   thin wrapper: it mounts `DailyBankingProvider` (see
   [DAILY_MINUTE_BANKING.md](./DAILY_MINUTE_BANKING.md)), renders
   `FlashcardsDecksPage` with the account header passed in as props, and adds
   `BankingEmbers` and the `AccountSheet`. The decks page takes the header controls as
   props (`headerExtraActions`, `headerTrailingActions`) because `features/` must not
   import `pages/` ([FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md)). The header title
   is **"Home"**; the browser tab title is just "Cow" (`usePageTitle()` with no name).
   The header carries, around the minute-points flame:
   - left of the flame: the feature-tester-only `SoftIntroToggle` and
     `BankingAlwaysPlayToggle` (`headerExtraActions`; `users.isFeatureTester`, migration
     178; both render null for everyone else);
   - right of the flame (`headerTrailingActions` → `PageHeader`'s `trailingContent`),
     in order **flame · Settings gear · avatar**:
     - the **Settings gear** (outlined `HeaderIconButton`, `home-page__settings-button`)
       → `slideNavigate("/settings")`;
     - the learner's **profile picture** as a round 32px button in the far-right corner
       (`src/minutePoints/dailyBanking/BankingAvatarButton.tsx` wrapping
       `src/components/HeaderAvatarButton.tsx`) → raises the **AccountSheet**
       (`src/pages/AccountSheet.tsx`), a maximizable `SheetPanel` over Home with three
       tabs: Account, Friends and Settings (the last two are the `/friends` and
       `/settings` bodies; their drill-ins leave the sheet and return to those routes). It shows
       the icons8 `avatarIconId`, falling back to the name's initial on `COLORS.bluM`,
       matching the sheet's own avatar row.

3. **Menu** (`/menu`, `src/pages/MenuPage.tsx` → `MenuPage`) — a `Bento` mosaic (the
   shared tile primitive, also used by the Games hub; `HubMenu` was deleted
   2026-08-21 — see [BENTO_SYSTEM.md](./BENTO_SYSTEM.md)) of secondary destinations:
   **Night Market**, **Games**, **Arena**, **Immersive World**, **Reader**,
   **Community**, **Friends** (plus a feature-tester- or admin-only **Tester Dashboard** tile
   and template-author-only tiles). There is **no Dictionary tile** — Dictionary is a
   footer tab, and a tile would be a second door to the same room. Its header is just the
   title "Menu" and the normal minute-points flame — no Settings gear, no avatar, no
   banking run (those stayed with the Home tab). Classes are `menu-page__*`.
   There is deliberately **no Compare Words row**: Compare is a sheet raised over the
   word you are already looking at, not a destination — see
   [WORD_COMPARE_FEATURE.md](./WORD_COMPARE_FEATURE.md).

4. **Back-arrow drill-ins** — how Back behaves (arrow vs. browser back vs. edge swipe,
   restoring state, guards) is specified in [BACK_NAVIGATION.md](./BACK_NAVIGATION.md).
   Every page reached from a hub has a common header
   with a back button. These come in two archetypes (see
   [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)): **leaf pages** (down arrow, no
   footer, back-arrow-only exit, slide up/down) and **node pages** (left arrow,
   keep the footer, slide in-from-right / out-to-right via the arrow).
   - Menu destinations → back to `/menu`: `/games`, `/arena`, `/friends`, `/community`,
     `/reader` (node); `/night-market`, `/tester-dashboard`, `/immersive-world`, the
     Template Editor / Sandbox and leaving the Scene Editor (leaf).
   - Home (fdp) drill-ins → back to `/`: the Mastery Centers (`/flashcards/reading`,
     `/flashcards/writing`), collection and deck pages
     (`/flashcards/collection/:builtin`, `/flashcards/deck/:id`; the legacy
     `/flashcards/mastered` redirects to the Mastered collection), Card Detail
     (`/flashcards/card/:id`, saved-card cdp), Sort Cards (`/discover/sort/:language`,
     node; set mode exits to its origin instead — [DISCOVER_FLOW.md](./DISCOVER_FLOW.md))
     and leaving the flp. The cdp's
     breakdown/used-in/example drill-ins open the tapped word's saved card when the
     learner has one, else the read-only dictionary cdp (`src/hooks/useOpenWordCard.ts`).
   - Dictionary result tap → **no navigation**: the eip rises as a bottom sheet over the
     results (`EipSheet`, 2026-10-10); its drill-ins (breakdown/used-in rows, example and
     long-definition segments, Compare) open as eip TABS, not pages. Closing the sheet
     leaves the reader on their results. The read-only dictionary cdp
     (`/dictionary/card/:word`) is now reached only from the saved-card cdp's drill-in
     fallback above. See [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) "Card detail (cdp)".
   - Settings (`/settings`) → back to `/` (leaf; opened from the Home header gear via
     `slideNavigate`, so it slides up into the phone frame).

## Where the old drawer's global controls live

The drawer's two global controls first moved onto the Account page; since Account
became a sheet (2026-10-09) they are:
- **Settings** → the gear in the Home header, beside the avatar (see 2 above). Code:
  `src/pages/HomePage.tsx` → `headerTrailingActions`.
- **Log Out** → a button at the bottom of the AccountSheet body
  (`account-sheet__logout-button`), with the same confirm-then-`logout()` flow the
  drawer used. Logging out unmounts the sheet immediately rather than animating it
  away. Code: `src/pages/AccountSheet.tsx` → `handleLogout`.

## Layout / frame

`Layout.tsx` has two modes:
- Frame routes (`shell: "frame"` in `src/routes/routeMeta.ts`, which replaced the old
  `MOBILE_DEMO_PATHS` array; includes `/` and `/menu`) → wrapped in `MobileDemoFrame` (full-bleed on mobile, centered phone card on desktop).
- Everything else (auth pages, etc.) → full-height, no chrome; each owns its
  `PageHeader`. (Reader / Night Market / Settings / Tester Dashboard render inside
  the frame as leaf pages; both card-detail cdps render inside the frame as node pages;
  Dictionary is a footer tab.)

## Tester Dashboard

`/tester-dashboard` (`TesterDashboardPage`) holds the **former landing-page**
content (study time, streak, monthly calendar, leaderboard). The old `/` landing
became the hub menu, which now lives at `/menu`; `/` is the fdp (see 1 above).

**Feature-tester- or admin-gated.** The surface is for testers, not ordinary
learners, so it is gated on `users.isFeatureTester` (migration 178 — it rode
`users.isValidator` until that data-validation flag was split from feature testing, see
[DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md)) **or** `users.isAdmin`
(migration 168) in two places, mirroring the `isTemplateAuthor` gate on the Night
Market template editor:

- `src/pages/MenuPage.tsx` → `gatedTiles` — the `tester-dashboard` Bento tile is
  spread in only when `user?.isFeatureTester || user?.isAdmin`, so nobody else sees the
  entry point.
- `src/pages/TesterDashboardPage.tsx` — a `useEffect` bounces a resolved user who is
  neither to `/` (`replace: true`), covering deep links and bookmarks. Its back arrow
  returns to `/menu`.

The route (`src/routes/routeMeta.ts`, `/tester-dashboard`) is `access: "any"` on
purpose: a feature tester may be a public account, and the generic `isPublic` redirect
must not pre-empt the role gate. For the personal widgets this is a **UX gate, not a
security boundary** — they render the caller's own minute-point data from user-scoped
endpoints.

**User Usage section (admin-only).** Below the leaderboard, an account with
`users.isAdmin` also sees cross-user usage (`UsageDashboardSection`). That one reads
OTHER accounts' data, so it has a real server-side gate as well — see
[USAGE_DASHBOARD.md](./USAGE_DASHBOARD.md).

## Related

- [MOBILE_TAB_SCREEN_LAYOUT.md](./MOBILE_TAB_SCREEN_LAYOUT.md) — hub layout shell
- [DISCOVER_FLOW.md](./DISCOVER_FLOW.md) — Sort Cards (scp), a Home drill-in
- [GAMES_FEATURE.md](./GAMES_FEATURE.md) — Games hub + registry
