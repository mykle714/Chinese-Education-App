# App Navigation

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).

There is **no hamburger / nav drawer** and **no desktop sidebar** (both removed —
`MobileNavDrawer` is deleted and `Layout` carries no chrome). Navigation is:

1. **Footer tabs** (`MobileFooter`) — the top-level destinations, left to right in
   the order below. Two footer looks: the flat full-width **bar** (text-only tabs — the
   shelf redesign's A2a/D5, [SHELF_REDESIGN.md](./SHELF_REDESIGN.md)) and the floating
   **slab** (with Material Symbols icons), chosen per route by `routeMeta`'s
   `footerStyle` (`routeFooterStyle`). The slab is worn by `/`, `/lessons`, `/dictionary`,
   the cdp and acp; every Menu-reached page keeps the bar.

   | Tab        | `FooterTab`   | Route         | Page                                                         |
   | ---------- | ------------- | ------------- | ------------------------------------------------------------ |
   | Flashcards | `deck`        | `/`           | the Deck Tower (`DeckTowerPage` — [DECK_TOWER.md](./DECK_TOWER.md)), the app's landing page |
   | Lessons    | `lessons`     | `/lessons`    | a "Coming soon" placeholder (`src/features/lessons/LessonsPage.tsx` → `LessonsPage`) on a td Tier-2 ground (`useTier2Look`) with the slab footer; took Arena's slot 2026-11-10. Not flagged |
   | Dictionary | `dictionary`  | `/dictionary` | the dictionary search                                        |
   | Menu       | `menu`        | *(none)*      | **not a page**: raises the Menu popover (`MenuPopover`, see 3 below) |

   Add Cards (acp, `/discover/sort/:language` — the `/discover/` prefix is kept so
   existing links work) is a **Deck drill-in**: reached from the main world's sort
   platform on td (`DeckTowerPage` → `sortPath` with `state.exitTo` = `SORT_EXIT`), it
   lights the Flashcards tab and its Back returns to `/` (main world)
   ([DISCOVER_FLOW.md](./DISCOVER_FLOW.md)). Quick Mark has no route of its own — it
   is a panel inside the sort page ([QUICK_MARK.md](./QUICK_MARK.md)).

   There is **no `/account` route** — the account surface is a sheet raised from td's
   header avatar (see 2 below).

   **Double-tapping the Dictionary tab focuses the search field** (two taps within
   `DOUBLE_TAP_WINDOW_MS`, 350 ms). A single tap only navigates — the page does not
   auto-focus on visit. If the page is already mounted, the focus happens synchronously
   inside the second tap's gesture (iOS raises the keyboard only for a focus made during a
   gesture). If the page is still loading, the request waits and is applied one frame after
   mount. Code: `src/features/dictionary/dictionarySearchFocus.ts` →
   `registerDictionaryTabTap`, `requestDictionarySearchFocus`,
   `registerDictionarySearchFocus`; `src/components/MobileFooter.tsx` → `TABS`;
   `src/features/dictionary/DictionaryPage.tsx` (focus-registration effect).

   The **active** tab is resolved from the current route by `FooterPresenter`
   (`routeFooterTab` in `src/routes/routeMeta.ts`). Pages do not declare it: the
   `activePage` prop that used to run through `MobileTabScreen` / `NodePage` fed the
   header's tab badge, and both were removed by the shelf redesign's A2b.

   **Which tab each drill-in lights** (the `footerTab` field of its `routeMeta` row;
   leaf pages have no footer and so no `footerTab`):

   | Lights | Routes |
   | --- | --- |
   | `deck` | `/`, `/flashcards/card/:id`, `/discover/sort/:language` |
   | `menu` | `/community`, `/friends/requests`, `/friends/sent`, `/friends/remove`, `/friends/challenges*`, `/users/:userId`, `/reader` |
   | `arena` | `/arena` |
   | `dictionary` | `/dictionary` |

   The union type is `FooterTab` (exported from `MobileFooter.tsx`). The tab list
   itself is the `TABS` array in that file.

2. **Deck** (`/`, `src/features/deckTower/DeckTowerPage.tsx` → `DeckTowerPage`) — the
   Deck Tower ([DECK_TOWER.md](./DECK_TOWER.md)), in a non-scrolling `MobileTabScreen`
   whose title names the world on screen. Its header carries, around the minute-points
   flame:
   - right of the flame (`headerTrailingActions`): the learner's **profile picture**
     (`src/features/deckTower/DeckTowerAvatar.tsx` → `DeckTowerAvatar`, over
     `src/components/HeaderAvatarButton.tsx`) → raises the **AccountSheet**
     (`src/pages/AccountSheet.tsx`), a maximizable `SheetPanel` with three tabs: Account,
     Friends and Settings (Friends is `FriendsBody`, which has no page of its own since
     `/friends` was deleted 2026-11-06; Settings is the `/settings` body; their
     drill-ins leave the sheet and return to those routes). It shows the icons8
     `avatarIconId`, falling back to the name's initial on `COLORS.bluM`. Settings is
     the sheet's Settings tab (there is no header gear).

3. **Menu** — the footer's LAST tab, and the only one that is **not a destination**.
   There is no `/menu` route (the bento page that used to live there, `MenuPage`, was
   deleted 2026-11-06). A tap raises the **Menu popover** over whatever page is on screen:
   a list of rows, one per secondary destination; tapping a row goes to that page.

   - **Rows** (`src/components/menuPopover/menuDestinations.ts` → `useMenuDestinations`,
     returning `{ main, gated }`): **Reader**, **Arena** and **Community** (Arena and Community
     only while their flags are on). Arena (`/arena`, `ArenaPage` —
     [ARENA_FEATURE.md](./ARENA_FEATURE.md)) was a footer tab 2026-11-04 → 2026-11-10 and is a
     Node drill-in again (`chrome: "node"`, `footerTab: "menu"`, back → history else `/`). Every row navigates to
     its `route`. There is **no Friends row**: the `/friends` page was deleted 2026-11-06,
     and Friends lives only in the AccountSheet's Friends tab (td's header avatar). There is
     **no Games row**: the Games hub (`/games`) was deleted 2026-11-06 and the routed games'
     pages are off behind the `standaloneGames` flag; games are played only as flp breaks
     inside the Deck Tower ([GAMES_FEATURE.md](./GAMES_FEATURE.md)).
     Below a hairline, only for accounts holding the grant: **Tester Dashboard** (feature
     tester with testing features on, or admin) — the only gated row. The hairline and the gated group appear together or not at all.
     There is **no Dictionary or Lessons row**: both are footer tabs, and a row would be a
     second door to the same room. There is deliberately **no Compare Words row**: Compare
     is a sheet raised over the word you are already looking at
     ([WORD_COMPARE_FEATURE.md](./WORD_COMPARE_FEATURE.md)).
   - **Look** (`src/components/menuPopover/MenuPopover.tsx` → `MenuPopover`): the Deck
     Tower's card-stock style, matching the slab footer ([DECK_TOWER.md](./DECK_TOWER.md)
     § Footer). A `cardFace` card on a 6px `cardWall` lip with a down-right `10px 16px`
     cast shadow, radius 22. Rows are 52px keycaps: the row for the page on screen (the
     most specific match, so `/friends/sent` lights Friends) and any pressed row wear the
     slab's active-tab keycap (`cardBeige` + 3px inset `cardWall` lip). Each row leads with
     a 34px chip in the destination's ramp hue (`mid` face, `mark` lip, filled ink icon).
     Card colours read `tier2Var(...)` like the slab, so on a Tier 2 page they turn slate
     at night together. No `COLORS.border` outline, which departs from CLAUDE.md § Buttons &
     cards on purpose, as the slab does.
   - **Placement**: anchored bottom-right, 16px from the right edge, 12px above the footer
     (`MobileFooter` passes `footerClearance`: `FOOTER_TOTAL_HEIGHT` for the bar,
     `SLAB_FOOTER_TOTAL_HEIGHT` for the slab). It grows from its bottom-right corner
     (220 ms enter, 140 ms exit).
   - **Dim**: a frame-hosted `COLORS.scrim` (`useScreenOverlayHost`, z-index 200) over the
     whole screen, footer included (overlayHost.ts § "THE RULE FOR A DIM").
   - **Closes on** a scrim tap (which includes a second tap on the Menu tab, now under the
     scrim), Escape, a row tap, or any other route change. Tapping the row for the exact
     page on screen only closes the popover.
   - **State** lives in `MobileFooter` (`menuOpen`); the footer is rendered once at frame
     level by `FooterPresenter`.

4. **Back-arrow drill-ins** — how Back behaves (arrow vs. browser back vs. edge swipe,
   restoring state, guards) is specified in [BACK_NAVIGATION.md](./BACK_NAVIGATION.md).
   Every page reached from a hub has a common header
   with a back button. These come in two archetypes (see
   [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)): **leaf pages** (down arrow, no
   footer, back-arrow-only exit, slide up/down) and **node pages** (left arrow,
   keep the footer, slide in-from-right / out-to-right via the arrow).
   - Menu destinations → **back one history entry**, i.e. to the page the Menu popover
     was opened over, or `/` on a cold deep link (`src/utils/navigateBack.ts` →
     `navigateBackOr(navigate, "/")`): `/community`, `/reader` (node); `/tester-dashboard` (leaf).
   - Friends drill-ins (`/friends/requests`, `/friends/sent`, `/friends/remove`,
     `/friends/challenges`), opened from the AccountSheet's Friends tab → back one history
     entry (`navigateBackOr(navigate, "/")`), landing on the page the sheet was over with
     the sheet closed. (They used to `slideNavigate("/friends")`.)
   - Deck (td) drill-ins → back to `/`: Card Detail (`/flashcards/card/:id`, the
     saved-card cdp, opened from td's cards page), Add Cards
     (`/discover/sort/:language`, node; set mode exits to its origin instead —
     [DISCOVER_FLOW.md](./DISCOVER_FLOW.md)) and the Writing Notebook (leaf, back to the
     writing world). The flp has no route: it runs inside td. The cdp's
     breakdown/used-in/example drill-ins do not navigate: they push the tapped word as a
     crumb on the eip's word trail in the cdp's own sheet (`EipSheet`).
   - Dictionary result tap → **no navigation**: the eip rises as a bottom sheet over the
     results (`EipSheet`, 2026-10-10); its drill-ins (breakdown/used-in rows, example and
     long-definition segments, Compare) open as eip TABS, not pages. Closing the sheet
     leaves the reader on their results. There is no dictionary card page: a word that is
     not a saved card is shown only in the eip sheet. See
     [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) "Card detail (cdp)".
   - Settings (`/settings`, leaf) → back to `/` (`SettingsPage`). Normally read as
     AccountSheet's Settings tab; the route is where `/settings/account`'s Back lands.

## Where the old drawer's global controls live

The drawer's two global controls first moved onto the Account page; since Account
became a sheet (2026-10-09) they are:
- **Settings** → the AccountSheet's Settings tab, raised from td's header avatar (see
  2 above). Code: `src/pages/AccountSheet.tsx`; `DeckTowerAvatar.tsx`.
- **Log Out** → a button at the bottom of the AccountSheet body
  (`account-sheet__logout-button`), with the same confirm-then-`logout()` flow the
  drawer used. Logging out unmounts the sheet immediately rather than animating it
  away. Code: `src/pages/AccountSheet.tsx` → `handleLogout`.

## Layout / frame

`Layout.tsx` has two modes:
- Frame routes (`shell: "frame"` in `src/routes/routeMeta.ts`, which replaced the old
  `MOBILE_DEMO_PATHS` array; includes `/`) → wrapped in `MobileDemoFrame` (full-bleed on mobile, centered phone card on desktop).
- Everything else (auth pages, etc.) → full-height, no chrome; each owns its
  `PageHeader`. (Reader / Settings / Tester Dashboard render inside
  the frame as leaf pages; both card-detail cdps render inside the frame as node pages;
  Dictionary is a footer tab.)

## Tester Dashboard

`/tester-dashboard` (`TesterDashboardPage`) holds the **former landing-page**
content (study time, streak, monthly calendar, leaderboard). The old `/` landing
became the hub menu (later `/menu`, now the Menu popover); `/` is the Deck Tower (see 1 above).

**Feature-tester- or admin-gated.** The surface is for testers, not ordinary
learners, so it is gated on `users.isFeatureTester` (migration 178 — it rode
`users.isValidator` until that data-validation flag was split from feature testing, see
[DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md)) **or** `users.isAdmin`
(migration 168) in two places:

- `src/components/menuPopover/menuDestinations.ts` → `useMenuDestinations` (`gated`) —
  the `tester-dashboard` row is spread in only when `useTestingFeatures() || user?.isAdmin` (the tester half also needs
  the device's "Enable testing features" switch — [FEATURE_TESTING.md](./FEATURE_TESTING.md)), so nobody else sees the
  entry point.
- `src/pages/TesterDashboardPage.tsx` — a `useEffect` bounces a resolved user who is
  neither to `/` (`replace: true`), covering deep links and bookmarks. Its back arrow
  goes back one history entry (`navigateBackOr`, else `/`).

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
- [DISCOVER_FLOW.md](./DISCOVER_FLOW.md) — Add Cards (acp), a Deck drill-in
- [GAMES_FEATURE.md](./GAMES_FEATURE.md) — games registry (no hub since 2026-11-06)
