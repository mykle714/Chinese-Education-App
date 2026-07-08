# Leaf Pages & Node Pages

> ↑ Part of [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).

Two page archetypes for back-arrow drill-in surfaces inside the phone frame
(`MobileDemoFrame`). Both replace the old ad-hoc "`PageHeader` with `showBack`"
pattern and add an iOS-style enter/exit slide transition.

## The two archetypes

| | Leaf page | Node page |
|---|---|---|
| Wrapper | `src/components/LeafPage.tsx` | `src/components/NodePage.tsx` |
| Header | `LeafPageHeader` (DOWN chevron) | `NodePageHeader` / `MobileTabScreen` (LEFT chevron) |
| Footer | **none** | **kept** (floating footer pill) |
| Exit options | **back arrow only** | back arrow + footer tabs |
| Enter motion | slides **up** (translateY 100% → 0) | slides **in from the right** (translateX 100% → 0) |
| Exit motion | slides **down** on back | slides **right** on back — **only via the arrow** |

### Leaf page — terminal drill-in
A leaf has no children: the only way out is the down-arrow back button. Because
of that, a **leaf page renders no footer**, and the back arrow is the sole exit.
The wrapper owns the exit: tapping back plays the slide-down, then runs the
caller's `onBack`. Vertical slide (sheet-style presentation).

### Node page — hub still in lateral nav
A node keeps the footer so the user can jump laterally (footer tabs) without
backing out. It uses the left arrow and a horizontal slide. The slide-**out** to
the right fires **iff the back arrow is used** — footer-tab navigation just
swaps routes with no slide (the wrapper only hooks the arrow, so footer nav is
untouched by design). Built on `MobileTabScreen`, so it inherits the scroll-away
header, floating footer, and edge fade.

## Rule of thumb
**No footer ⇒ leaf. Has footer ⇒ node.**

## Header component hierarchy (compose, don't fork)

```
PageHeader (base bar; arrowDirection: "down" | "left")
 ├─ LeafPageHeader   = PageHeader, arrowDirection="down", showBack   (used by LeafPage)
 ├─ NodePageHeader   = PageHeader, arrowDirection="left", showBack   (direct use: ReaderDocumentSurface)
 └─ MobileDemoHeader = PageHeader (+ activePage badge, arrowDirection pass-through)
        └─ MobileTabScreen threads arrowDirection → used by NodePage with "left"
```

`PageHeader` renders the **same** MUI `ExpandMoreIcon` for both directions;
`"left"` simply rotates it 90°, so the two back buttons share one glyph.

## Forward navigation — new page slides OVER the old (View Transitions)

Navigating INTO a leaf/node page slides the **new** page over the **old** one,
which the browser holds visible beneath. This uses the **View Transitions API**,
not a DOM clone: an earlier clone-beneath approach janked the incoming page's CSS
transition (a heavy cloned subtree forces a live-document relayout). The browser's
view transition snapshots the old page as a composited image (zero layout cost),
so nothing breaks.

- **Trigger:** `src/hooks/useSlideNavigate.ts` — `useSlideNavigate()` returns a
  `slideNavigate(to)`. It looks up the direction (`routeSlideDir` in
  `src/utils/pageTransition.ts`: leaf → `up`, node → `right`), publishes it on
  `<html data-vt-dir>`, arms the skip-enter latch (so the real page mounts in its
  FINAL position — otherwise its own enter would offset the captured snapshot),
  and runs `document.startViewTransition(() => flushSync(() => navigate(to)))`.
  (Manual `startViewTransition` + `flushSync` because this app uses the component
  `<BrowserRouter>`/`<Routes>`, where React Router's `<Link viewTransition>` does
  not fire one.) Used by `HubMenuRow` (all hub drill-ins), the Decks→Mastered link,
  and the Decks/Mastered → Card Detail card taps.
- **CSS (`src/index.css`):** `::view-transition-new(root)` runs `vt-slide-in-up` /
  `vt-slide-in-right` per `data-vt-dir`; `::view-transition-old(root)` has
  `animation: none` so the old page is **held static** beneath (z-index below the
  new). The footer pill carries its own `view-transition-name: app-footer`, so it
  is captured as a separate group and morphs independently instead of riding the
  page slide.
- **Fallback:** browsers without view transitions (or navigations not routed
  through `slideNavigate` — browser back/forward, deep links) fall back to
  `usePageSlide`'s own rAF enter slide (over a blank frame).

## Slide hook

`src/hooks/usePageSlide.ts` — `usePageSlide({ axis })`. Plain CSS `transform`
transition (percentage units), **not** react-spring — the surface translates by
100% of its own size, which a string-percentage spring interpolation does not
animate. Returns `{ surfaceRef, style, exit }`:
- **Enter:** on mount the first paint is off-screen (`translateX/Y(100%)`); a
  `requestAnimationFrame` flips to in-place so the browser transitions 100% → 0.
  Spread `style` onto the surface and attach `surfaceRef` to it. (This is the
  **fallback** enter — forward navigation normally goes through the view
  transition above, with the skip-enter latch keeping this static.)
- **Exit:** `exit(performNavigate)` navigates **immediately** (so the destination
  mounts underneath) and slides a detached **clone** of the leaving page off the
  top. The incoming page is therefore already there beneath the departing one,
  rather than rendering after it leaves. The clone is appended to the phone frame
  (`.mobile-demo-frame`) so it stays clipped to the card and paints above the new
  route. (Bubble Match's stage is DOM, not canvas, so the clone copies cleanly.
  Caveat: Night Market renders a Pixi.js **canvas**, which `cloneNode` does not
  copy — its exit clone shows the dark background + DOM header overlay but not the
  live scene during the brief down-slide. Acceptable since the destination beneath
  is what matters; revisit with the View Transitions API if it ever looks wrong.)
- **Skip-enter latch:** makes a page mount **static** (in place, no rAF slide) so
  something else owns the motion. It is armed (`armSkipNextEnter`) by (a) `exit`,
  so the destination sits static beneath the departing clone, and (b)
  `slideNavigate`, so the view transition animates the snapshot rather than the
  live page double-animating. The destination reads it on mount; `Layout` clears it
  (`clearSkipNextEnter`) in a pathname effect that runs after the destination's
  render, so a later un-latched navigation still animates normally.
- `LeafPage` uses `axis: "y"`; `NodePage` uses `axis: "x"`.

The animated surface is `position: absolute; inset: 0` inside `MobileDemoFrame`
(`position: relative; overflow: hidden`), so the slide stays inside the phone card.

## Footer (animated independently)

The floating footer pill is **not** part of any page-slide surface. It is rendered
**once** by `FooterPresenter` (mounted in `MobileDemoFrame`, above the page
surfaces + exit clone at `z-index: 100`) and is **omitted from the page slides**.
Instead it animates on its own vertical axis: it slides up from / down past the
bottom of the phone card when you move between footer-bearing and footerless
routes. So a node page slides horizontally while the footer stays put; entering a
leaf page slides the page up while the footer drops away.

`FooterPresenter` holds the single source of truth for which routes show the
footer (and which tab is active). Two match modes:

- **Exact** (`FOOTER_ROUTES`): `/` (home), `/flashcards/decks`, `/discover`,
  `/account`, `/games`, `/community`, `/flashcards/mastered`, `/dictionary` (→ `home`).
- **Prefix** (`FOOTER_ROUTE_PREFIXES`, for parameterized node routes): `/discover/sort/`
  and `/discover/skipped/` (both → `discover`), `/flashcards/card/` (→ `flashcards`,
  the saved-card cdp) and `/dictionary/card/` (→ `home`, the read-only dictionary cdp).
  Because these paths carry a `:language` / `:id` / `:word` segment, an exact-key
  lookup would miss them and the footer would slide away — so node pages reached via a
  parameterized path must be registered here. Keep in sync with `NODE_PREFIXES` in
  `utils/pageTransition.ts`.

Every other route (all leaf pages, login, etc.) is absent → the footer slides out.
`MobileTabScreen` no longer renders `MobileFooter` itself (it still reserves
`FLOATING_FOOTER_CLEARANCE` and uses `activePage` for the header badge).

## Current classification

| Route | Page | Archetype |
|---|---|---|
| `/discover/sort/:language` | `SortCardsPage` | Node |
| `/discover/skipped/:language` | `SkippedCardsPage` | Node |
| `/dictionary` | `DictionaryPage` | Node (footer added; tapping a result opens the dictionary cdp) |
| `/dictionary/card/:word` | `DictionaryCardDetailPage` | Node (read-only cdp; det-keyed by word) |
| `/reader` | `ReaderPage` | Node (document list; footer kept, Home tab) — opening a document routes to `/reader/:id`, a footerless node-style surface, see § below |
| `/reader/:id` | `ReaderDocumentPage` | Node-style (footerless) — the open-document cdp-style page, see § below |
| `/tester-dashboard` | `TesterDashboardPage` | Leaf |
| `/night-market` | `NightMarketEnginePage` | Leaf |
| `/flashcards/card/:id` | `VocabCardDetailPage` | Node (saved-card cdp; footer added) |
| `/games/bubble-match` | `BubbleMatchPage` | Leaf (footer removed; the info/picker screen no longer shows the footer) |
| `/flashcards/mastered` | `MasteredCardsPage` | Node |
| `/games` | `GamesPage` | Node |
| `/community` | `CommunityPage` | Node |

### Dictionary browse-state persistence

`DictionaryPage`'s query, pagination page, and scroll position are held in an
in-memory singleton, `dictionaryBrowseState` (`src/pages/dictionaryBrowseState.ts`),
so the list ⇄ card-detail (cdp) drill-in restores where the user was. The state is
seeded into `useDictionarySearch` via its `initial` argument and kept in sync by
effects in `DictionaryPage.tsx`.

It is meant to survive **only** moves inside the Dictionary space (`/dictionary`
and `/dictionary/card/*`). The route watcher in `Layout.tsx` calls
`resetDictionaryBrowseState()` on the first transition from an in-space pathname to
an out-of-space one, so every exit — the back arrow to Home, a footer-tab tap, and
browser back — clears the query; `isDictionarySpacePath()` defines the space. A full
page reload also starts fresh (the singleton is not persisted to storage).

## Card detail (cdp): two surfaces, one shared body

There are two card-detail pages, both **Node** pages that share the presentational
sections below the hero (`src/features/flashcards/VocabCardDetailBody.tsx` —
`VocabCardBadges` + `VocabCardSections`: definition / breakdown+used-in+expansion /
examples / synonyms+related):

- **Saved-card cdp** (`/flashcards/card/:id`, `VocabCardDetailPage`) — loads a vet
  row by id; editable (icon-editor toolbar + delete). Reached from Decks/Mastered, so
  the **Flashcards** tab stays active. Passes no `onWordOpen`, so breakdown/example
  rows are passive.
- **Read-only dictionary cdp** (`/dictionary/card/:word`, `DictionaryCardDetailPage`)
  — fetches the det row via `/api/dictionary/lookup/:word` and adapts it
  (`dictEntryAdapter`, which now carries `iconId`). **No edits**: no toolbar/delete,
  and the hero always renders the det's representative icon in **basic** layout
  (`iconLayout`/`textLayout` null, advanced off). Reached from the Dictionary node, so
  the **Home** tab stays active. Passes `onWordOpen`, so breakdown/used-in rows and
  example-sentence segments drill into the cdp of the tapped word (the same drill-in
  the eip offers, except it navigates to a cdp instead of opening a nested eip tab).
  Every linked page is itself this read-only cdp, so read-only propagates recursively.

## Reader: node list + node-style document page (cdp-style)

The Reader is TWO routed pages, following the same fetch-by-id cdp pattern as
`VocabCardDetailPage` (`/flashcards/card/:id`):

- **Document list** (`/reader`, `ReaderPage.tsx`) — a NODE page reached from the
  Home menu (`NodePage`, `activePage="home"`, LEFT arrow → Home, footer kept —
  same shape as `GamesPage`/`DictionaryPage`). Registered in `NODE_ROUTES`
  (`src/utils/pageTransition.ts`) and `FOOTER_ROUTES` (`FooterPresenter.tsx`).
  Fixed non-scrolling shell (`scrollable={false}`) — `TextSidebar` owns its own
  internal scroll region for the document list, matching the fixed-layout
  `NodePage` pattern used by `SortCardsPage`; `MobileTabScreen`'s scroll area
  reserves `FLOATING_FOOTER_CLEARANCE` regardless of `scrollable`, so no manual
  footer spacer is needed. `TextSidebar`'s `onTextSelect` calls
  `useSlideNavigate()` to `/reader/${text.id}`.
- **Open document** (`/reader/:id`, `ReaderDocumentPage.tsx`) — fetches its own
  `Text` by id (`GET /api/texts/:id`), so it is deep-linkable and survives a hard
  refresh, and supports the browser back button like every other routed page.
  Rendered inside `src/features/reader/ReaderDocumentSurface.tsx`, a **footerless
  node-style drill-in**: LEFT arrow, horizontal slide, but no footer. Its header
  right slot (`docHeaderRightContent`) carries Edit/Delete icon buttons ahead of
  the validator-download button + streak badge, so `TextHeader.tsx` itself only
  renders title/description/meta + validation actions — no back/edit/delete
  buttons of its own. `ReaderDocumentSurface` is deliberately NOT the shared
  `NodePage`: `MobileTabScreen` would reserve `FLOATING_FOOTER_CLEARANCE` for a
  footer pill `/reader/:id` never shows (it isn't in `FooterPresenter`'s route
  maps) and add a scroll-away header to a fixed layout. Instead it composes
  `NodePageHeader` + `usePageSlide({ axis: "x" })` directly, per the header
  hierarchy above. The back arrow calls `navigate("/reader")` — an ordinary route
  change, so `Layout`'s pathname effect clears the skip-enter latch normally, same
  as every other routed leaf/node page.

`/reader/:id` is registered in `NODE_PREFIXES` (`src/utils/pageTransition.ts`) so
`useSlideNavigate` slides it in from the right — it is the one FOOTERLESS
exception to that list (every other `NODE_PREFIXES` entry is also footer-bearing).
This is likewise the one exception to the "no footer ⇒ leaf" rule of thumb: the
document page uses node **motion and arrow** (lateral: you're moving within the
Reader, not stacking a terminal sheet) while remaining footerless like its parent
leaf.

Shared logic between the two pages (list-refresh-after-CRUD via the dialogs, the
validator-download call) is factored into `src/features/reader/validationApi.ts`
(`downloadValidationDoc`) rather than duplicated. `src/hooks/useLockBodyScroll.ts`
(the html/body scroll-lock effect) is used only by `ReaderDocumentPage` now — its
fixed `ReaderDocumentSurface` layout sits outside the standard `NodePage`/
`MobileTabScreen` shell, unlike the list page.

## Not yet classified
The generic in-game shell `src/games/runtime/GamePage.tsx` (used by any future
registry game that does not ship its own page) still has a down arrow **and** a
footer, so it fits neither rule cleanly. It is intentionally left on the older
`MobileDemoHeader` + `MobileFooter` composition until classified. Bubble Match
ships its own page (`BubbleMatchPage`) and is a leaf.
