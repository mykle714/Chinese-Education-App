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
| Footer | **none** | **kept** (the flat footer bar) |
| Exit options | **back arrow only** | back arrow + footer tabs |
| Enter motion | slides **up** (translateY 100% → 0) | slides **in from the right** (translateX 100% → 0) |
| Exit motion | slides **down** on back | slides **right** on back — **only via the arrow** |

### Leaf page — terminal drill-in
A leaf has no children: the only way out is the down-arrow back button. Because
of that, a **leaf page renders no footer**, and the back arrow is the sole exit.
The wrapper owns the exit: tapping back plays the slide-down, then runs the
caller's `onBack`. Vertical slide (sheet-style presentation).

#### `hideHeader` — sideways pages draw their own header
A **landscape** leaf page cannot use the built-in header: an upright header on a
rotated game is unreadable. `LeafPage` therefore accepts `hideHeader`, which
suppresses `LeafPageHeader` and switches `children` to a **render-prop** form:

```tsx
<LeafPage title="…" onBack={…} hideHeader>
    {({ onBack }) => ( /* draw LeafPageHeader yourself, inside your stage */ )}
</LeafPage>
```

The `onBack` handed back is the **exit-aware** one — it plays the slide-down and
then runs the caller's `onBack`. A `hideHeader` page **must** wire it to its own
back control, or the page has no exit, which breaks the leaf archetype's core
rule. Everything else (no footer, the slide, the clone-on-exit) is unchanged.

Only Speed Reading uses this today —
see [SPEED_READING_GAME.md](./SPEED_READING_GAME.md) § Sideways rendering.

#### `surfaceColor` and `surfaceSx` — repainting the ground
`surfaceColor` is the plain case: one background colour for the whole surface. **No page
passes it today** — the two card-detail pages were the last callers and moved to the
default `COLORS.background` ground (2026-08-28); the prop stays because it is the cheap
way to repaint a page that has a reason to.

`surfaceSx` is for the case where repainting the ground also changes what has to be drawn
ON it. Its only caller is the game surface — `gameSurfaceSx` in
`src/games/shared/gameSurface.ts` ([SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A6b) — which
floods the page with a saturated accent and therefore has to flip the title, the back
chevron, the right slot's icons, `HeaderMetaLabel` and both toggle-chip states to white.
It does that with **descendant selectors on the `page-header__*` classes** rather than by
threading an `onAccent` prop through `LeafPage` → `PageHeader` → the four header atoms.

Games do not pass either one directly: they render `GameLeafPage`
(`src/games/shared/GameSurface.tsx`), which takes a `hue` and supplies both this and the
context the play panel reads.

⚠️ A caller passing `surfaceColor` AND `surfaceSx` gets the `surfaceSx` value on the
overlap — the array form appends it last.

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
PageHeader (no bar — title on the paper ground; arrowDirection: "down" | "left")
 ├─ LeafPageHeader   = PageHeader, arrowDirection="down", showBack   (used by LeafPage)
 ├─ NodePageHeader   = PageHeader, arrowDirection="left", showBack   (direct use: ReaderDocumentSurface)
 └─ MobileDemoHeader = PageHeader (arrowDirection pass-through)
        └─ MobileTabScreen threads arrowDirection → used by NodePage with "left"
```

**`arrowDirection` picks the GLYPH, and the glyph picks the size.** Since the shelf
redesign's A2b the two directions are two different Material Symbols, not one rotated
one: `"left"` draws `arrow_back` at 21px (the design's `.hd .back`) and `"down"` draws
`keyboard_arrow_down` at 22px (`.lhd`). They used to be a single `ExpandMoreIcon`
rotated 90°, which is not the same shape as an arrow.

The chevron and the title are **one tappable group**, tight at 9px — not a chevron
button with a title beside it. That is what makes the chevron read as belonging to the
title now that there is no header bar holding them together.

### Header sizes

`PageHeader` takes a `size` of `"hub" | "node" | "dense" | "leaf"`, but **you almost never pass
it**: it defaults from the props you are already passing.

**Scaled up ~15% on 2026-11-05** from the design's 24/21/18/17: the titles AND every
right-slot control (icon 19→22, outlined button 32→36, back arrow 21→24, down chevron
22→25, mono chips 10→11.5px, meta label 10.5→12, outlined chip text 12→14 / glyph 15→17,
header flame 22.5→26 with a 14→16px count (count later raised to 18px, `SIZE.subtitle`, the same day), td avatar 40→46) moved together so the
hierarchy is unchanged. Source of truth: `src/components/PageHeader.tsx` → `SIZE_SPEC` and
the `HEADER_*` constants, `src/components/pageHeaderSizing.ts`,
`src/components/cycleChipSizing.ts` → `CYCLE_CHIP_FONT_PX`, `src/minutePoints/FireCount.tsx`
→ `HEADER_FIRE_GLYPH_PX` / `HEADER_FIRE_COUNT_FONT_SIZE`,
`src/components/HeaderAvatarButton.tsx` → `AVATAR_SIZE_PX`.

| `size` | Title | Padding | Defaulted when | Design class |
| --- | --- | --- | --- | --- |
| `hub` | 28px / 600 / -0.025em | `23px 22px 0` | `showBack` is false | `.hd` |
| `node` | 24px / 600 / -0.02em | `23px 22px 0` | `arrowDirection="left"` | `.hd` + back |
| `dense` | 21px / 600 / -0.018em | `23px 22px 0` | **never — ask for it** | `.hd` (Card Detail, Learn) |
| `leaf` | 20px / 600 / -0.015em | `27px 18px 8px` | `arrowDirection="down"` | `.lhd` |

⚠️ **`leaf` is the one size whose padding is not the design's.** The design writes
`.lhd { padding: 21px 18px 0 }`; the app ships `27px 18px 8px` (2026-09-05). The leaf
title is the app's smallest (17px then, 20px since the 2026-11-05 scale-up), so the design's padding — tuned under a 24px hub
title — read as a cramped, short header, and the bottom padding is additive to whatever
top gutter the body brings (on Settings the first `SettingsSection` contributes only
14px). Deepening the band was preferred over enlarging the title, which would collide
with the crowded right slots leaf/game pages carry. Source of truth: `SIZE_SPEC.leaf`
in `src/components/PageHeader.tsx`.

**`dense` is the one you have to ask for.** The other three follow from the navigation
shape, which the props already describe. `dense` follows from what the *page* put in
the right slot — three or more controls, where 21px starts colliding — and no other
prop knows that. Counting `rightContent`'s children instead is a trap: most callers
pass a single wrapping `Box` or fragment, so the count is 1 however many buttons are
inside it.

Reach it through `size` on `PageHeader` / `MobileDemoHeader`, or `headerSize` on
`MobileTabScreen` / `NodePage`. Current users: both Card Detail pages and
`FlashcardsLearnHeader`.

### The `rightContent` slot

Compose it from the primitives exported beside `PageHeader` — do **not** hand-roll a
styled MUI `Button`/`IconButton`. Three headers each carried a byte-identical
`toggleSx` helper before these existed.

| Export | Design class | Shape |
| --- | --- | --- |
| `HeaderMetaLabel` | `.hd .meta` | mono uppercase metadata (a count, a status word) |
| `HeaderIconButton` | `.hd .btn` | an icon action. `variant="bare"` (default) for drill-in/game headers carrying 2–4 actions; `variant="outlined"` for a hub header's single lone action, which needs the 36×36 box to separate it from bare paper. Optional `title` (tooltip), `pressed` (`aria-pressed`, for a toggle) and `fill` (filled glyph for a toggle's on state). **Every header icon action uses this** — no raw MUI `IconButton` in a header slot, or it misses header-wide size changes |
| `HeaderToggleChip` | `.lhd .tg` | a mono toggle chip. On = solid ink ground + white text — an inversion, not a tint change |
| `HeaderActionChip` | AudioModeChip's `outlined` skin (`outlinedChipSx`, pageHeaderSizing.ts) | a labelled action — glyph + words in `ink` (default ink2), no fill, a thin pill outline in that ink, the tower's study lettering (`TOWER_STUDY_FONT`), no on state. For an action a glyph alone doesn't explain (the Writing Notebook's "Change") |

The design's fourth slot shape, `.fire`, is **not** re-exported here and is **not
passed by pages at all**: `PageHeader` renders `src/minutePoints/MinutePointsFireBadge.tsx`
itself, LAST in the right slot (flush right, after whatever `rightContent` the page
supplies), on every header in the app. Its `COLORS.fireActive` is the design's `#E65100`
exactly. Do not put it in `rightContent` — that draws it twice, and a second live
`useMinutePoints` instance double-counts accrual on an earning page.

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
  not fire one.) Used by td's cards page → cdp (`DeckTowerPage` → `onOpenTowerCard`) and
  its notebook stack (circle, below) and sort platform (dash, below), Reader list taps,
  Friends / Study Challenge / Arena pages, Account → Settings → Account security, and
  `WordSearchHubItem`. The Bento hubs (Menu, Games) do **not** use it — their
  tiles navigate plainly. ⚠️ Several of those pages also call it from their **back**
  arrow, which runs a forward slide on a back action — see
  [BACK_NAVIGATION.md](./BACK_NAVIGATION.md) § 3.2 finding 1.
- **CSS (`src/index.css`):** `::view-transition-new(root)` runs `vt-slide-in-up` /
  `vt-slide-in-right` per `data-vt-dir`; `::view-transition-old(root)` has
  `animation: none` so the old page is **held static** beneath (z-index below the
  new). The footer bar carries its own `view-transition-name: app-footer`, so it
  is captured as a separate group and morphs independently instead of riding the
  page slide. ⚠️ A named group is lifted OUT of the phone frame (the frame's
  `overflow: hidden` no longer clips it), so on desktop a footer sliding in or out moves
  outside the phone card. The circle transition therefore drops the name
  (`:root[data-vt-dir="circle"] .mobile-footer { view-transition-name: none; }`): there the
  footer stays in the root snapshot, clipped by the frame and revealed by the circle.
- **Fallback:** browsers without view transitions (or forward navigations not routed
  through `slideNavigate`) fall back to `usePageSlide`'s own rAF enter slide (over a
  blank frame). **Back never slides the destination in** — a `POP` navigation (the ←
  arrow's `navigate(-1)`, the browser button, iOS's edge swipe) and the initial page
  load mount static; see the skip-enter latch below.

### The circle transition (an alternative to the slide)

`src/utils/pageTransition.ts` → `CIRCLE_MOTION`, `circleCoverRadius`, `circleClip`,
`ScreenPoint`, `readCirclePoint`; `useSlideNavigate` (`circleFrom`); `usePageSlide` →
`exit(…, circleTo)`; `LeafPage` / `NodePage` `exitCircleTo`; the `data-vt-dir="circle"` rules in `src/index.css`.

A leaf can be opened and closed with a circle instead of the slide: the page is revealed in
a circle growing out of the tapped thing, and Back closes it into a circle shrinking onto
that same point. The motion (520 ms, the same easings) is the flp game break's circle
(FLP_GAME_BREAKS.md, whose `BREAK_AREA_MOTION` reads `CIRCLE_MOTION`), so the two read as
one transition.

- **Enter:** `slideNavigate(to, { circleFrom })`, with `circleFrom` in viewport px. It runs a
  view transition with `data-vt-dir="circle"`, whose CSS holds both snapshots still (new
  over old). Once the transition is `ready` it animates the new snapshot's `clip-path`
  from JS (`pseudoElement: "::view-transition-new(root)"`), because the point is only
  known at the tap. The footer is not its own group here (its `view-transition-name` is
  dropped under `data-vt-dir="circle"`), so a footer arriving with the page is revealed by
  the circle and clipped by the phone frame, rather than sliding up outside it on desktop.
- **Exit:** the page passes the point back as `LeafPage` `exitCircleTo`. `usePageSlide`'s
  exit makes its usual clone over the destination, but clips it to a shrinking circle
  instead of sliding it down. The point is shifted into the phone frame's box, because the
  clone lives in it.
- **The point travels in nav state** (the caller's own key, e.g. `state.circleFrom`), so a
  reload or deep link that loses it falls back to the slide-down.
- **Reduced motion, or no view transitions:** a plain navigation, with no circle.
- **Node pages too.** `NodePage` takes the same `exitCircleTo`, so a node page opened with
  the circle closes the same way (its Back otherwise slides right).
- **Used by:** the Deck Tower's notebook paper stack ↔ the Writing Notebook
  (DECK_TOWER.md § The notebook stack). (The sort platform ↔ Add Cards used it until
  2026-11-09; it now dashes, below.)

### The dash transition (the world pan, between routes)

`src/hooks/pageDash.ts` → `runPageDash`; `src/utils/pageTransition.ts` → `DASH_MOTION`,
`DashLaunch`, `readDashLaunch`; `src/utils/speedLineField.ts` → `speedLineField`;
`useSlideNavigate` (`dash`); `NodePage` `exitDash`; `usePageSlide` → `freezeClone`.

The Deck Tower's camera dash between worlds (DECK_TOWER.md § Worlds → The pan) played from
one route to another, on the pan's own numbers (`DASH_MOTION`: 260 ms out, ease-in → 260 ms
of empty sky → 300 ms in, ease-out) and its own streak field (`speedLineField`, which
`SpeedLines` also draws):

1. **Out.** A frozen clone of the leaving page (the same `freezeClone` the exit slide uses,
   which also copies scroll offsets) whips off the side the camera leaves, over a sky in the
   leaving page's claimed ground (`--surface-ground`, useThemeColor). The speed lines gather.
   The navigation happens at t = 0, so the destination mounts beneath the sky (skip-enter
   latch armed).
2. **Cruise.** Empty sky, lines at full strength, blending into the ground the arriving page
   now claims.
3. **In.** The arriving page — LIVE, not a snapshot: the route element, the phone frame's
   first child — is raised over the sky and slides in, braking; the lines die away.

- **Not a view transition.** Imperative DOM in the phone frame (`.mobile-demo-frame`):
  the sky + clone at z 50, the arriving page at z 51 for the in phase, the lines at z 52 —
  all under the footer pill (z 100), which does not move, as in the pan. The sky blocks taps
  on the hidden destination until it slides in.
- **Enter:** `slideNavigate(to, { dash: { from, lineColor }, state: { dash: { lineColor } } })`
  — `from` is any element inside the current page; the camera travels RIGHT.
- **Exit:** `NodePage` `exitDash` (the `DashLaunch` read back with `readDashLaunch`) runs the
  dash travelling LEFT instead of `usePageSlide`'s exit. Lives in NodePage, not usePageSlide,
  because pageDash imports usePageSlide's latch and `freezeClone`.
- **Streak colour travels in nav state**, because the opened page cannot compute the
  launching page's time-of-day wash. A reload or deep link that loses it falls back to the slide.
- **Reduced motion, no Web Animations, or no phone frame:** a plain navigation.
- **Entrances held until seen.** The destination mounts at t = 0, hidden, so its CSS entrance
  animations (acp's card dock slide-in, its bins and toolbar) would finish unseen. While it is
  hidden the frame carries `page-dash-hold` (rule in `src/index.css`), which pauses every CSS
  animation in the route page — delays included, late-mounting elements too; a paused
  `backwards`-fill animation holds its first frame. Released at the in phase, they play as
  the page slides in. JS-driven motion (td's tower build-up, `useBuildProgress`) is not held
  and still runs partly unseen.
- **Used by:** the Deck Tower's mini sort platform ↔ Add Cards (a node page;
  DECK_TOWER.md § The sort platform).

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
  (`.mobile-demo-frame`, which is `position: relative; overflow: hidden`) so it stays
  clipped to the card and paints above the new route (`src/hooks/usePageSlide.ts`).
  **The clone is frozen** (`freezeClone`): `cloneNode` restarts every CSS
  animation inside it from 0%, which replayed the leaving page's entrance (e.g. acp's
  card dock stagger) during the exit. Each clone animation is jumped to its live
  counterpart's `currentTime` (paired by tree position + `animationName`) and paused;
  one with no live counterpart had already finished and is finished. Each live `<canvas>`
  is also painted onto its copy, which `cloneNode` leaves blank (the Writing Notebook's
  cell-editor ink, the writing-grid game). Only the exit's own slide / circle moves. (An inner `.mobile-demo-frame__viewport` box used to be the target; it was removed
  2026-09-13 and the frame itself became the positioned host — see
  `src/components/overlayHost.ts`.) Overlays that dim are hosted at the frame too, OUTSIDE
  the page surface, so the clone does not carry them: they vanish on navigation rather
  than sliding off (docs/UX_AND_NAVIGATION.md § Dimming the background). (Bubble Match's stage is DOM, not canvas, so the clone copies cleanly.
  Caveat: a page that renders a **canvas** would lose it in the clone — `cloneNode`
  does not copy canvas pixels. No leaf page does today; the Night Market did, until it
  was removed 2026-11-09.)
- **Skip-enter latch:** makes a page mount **static** (in place, no rAF slide) so
  something else owns the motion. It is armed (`armSkipNextEnter`) by (a) `exit`,
  so the destination sits static beneath the departing clone, and (b)
  `slideNavigate`, so the view transition animates the snapshot rather than the
  live page double-animating. The destination reads it on mount; `Layout` clears it
  (`clearSkipNextEnter`) in a pathname effect that runs after the destination's
  render, so a later un-latched navigation still animates normally.
- **No enter on `POP`:** independently of the latch, the hook starts in place when
  `useNavigationType()` is `"POP"`. The arrow already arms the latch through `exit`, but
  the browser button and the iOS edge swipe never call `exit`, and a page the browser
  has just animated back to must not slide in again from the right. On iOS that second
  slide also keeps the page from matching Safari's swipe snapshot, which blocks input for
  seconds (WebKit keeps the swipe's picture up until the live page resembles it) —
  [BACK_NAVIGATION.md](./BACK_NAVIGATION.md).
- `LeafPage` uses `axis: "y"`; `NodePage` uses `axis: "x"`.

The animated surface is `position: absolute; inset: 0` inside `MobileDemoFrame`
(`position: relative; overflow: hidden`), so the slide stays inside the phone card.

## Footer tab overrides

`src/components/footerTabOverride.ts` → `useFooterTabOverride`, `runFooterTabOverride`;
`MobileFooter` (every tab's `onClick` asks first); `NodePage` `backOnFooterTab`.

The footer is rendered once at frame level, outside every page, so a page cannot pass it a
prop. Instead the page on screen may claim ONE tab while it is mounted: a tap on that tab
runs the page's handler and the footer does not navigate. The claim is dropped on unmount.

`NodePage` `backOnFooterTab` is the one packaged use: a tap on that tab plays the page's own
Back (`exit(onBack, exitCircleTo)`, or the dash with `exitDash`), so a page whose Back leads where the tab does leaves the
same way either way. Today only **acp opened from the Deck Tower** sets it (`"deck"`), so
the Flashcards tab dashes back onto the tower rather than jumping
(DECK_TOWER.md § The sort platform). Every other tap, and every other page, navigates as
before.

## Footer (animated independently)

The footer bar is **not** part of any page-slide surface. It is rendered
**once** by `FooterPresenter` (mounted in `MobileDemoFrame`, above the page
surfaces + exit clone at `z-index: 100`) and is **omitted from the page slides**.
Instead it animates on its own vertical axis: it slides up from / down past the
bottom of the phone card when you move between footer-bearing and footerless
routes. So a node page slides horizontally while the footer stays put; entering a
leaf page slides the page up while the footer drops away.

`FooterPresenter` decides which routes show the footer (and which tab is active) from
the `footerTab` field of each row in `src/routes/routeMeta.ts` (`routeFooterTab`) — the
same row that decides the route's shell and page transition. A route with no
`footerTab` is footerless (every leaf page, `/reader/:id`, the games) and the footer
slides away. Parameterized node routes (`/flashcards/card/:id`,
`/discover/sort/:language`, …) are matched with React Router's
`matchPath`, so they need no separate prefix list. (The old hand-synced `FOOTER_ROUTES` /
`FOOTER_ROUTE_PREFIXES` tables in `FooterPresenter.tsx` are gone.) The current
route → tab mapping is tabulated in [NAVIGATION.md](./NAVIGATION.md) § 1: `deck` for `/`
(td) and its drill-ins (the saved-card cdp, Add Cards), `menu` for the pages the
Menu popover opens (there is no `/menu` route since 2026-11-06), `arena` and `dictionary` for their own spaces.

Every other route (all leaf pages, login, etc.) is absent → the footer slides out.
`MobileTabScreen` no longer renders `MobileFooter` itself; it only reserves
`FOOTER_CLEARANCE`. It takes no `activePage` either — `FooterPresenter` derives the
active tab from the route.

### Transient suppression (a modal is open)

The route table above is a *static* fact: it says whether a route has a footer at all.
It cannot express **"not right now"** — a node page that opens a modal surface owning
the whole screen. A page asks for that with `useHideFooter(hidden)`
(`src/hooks/useHideFooter.ts`); `FooterPresenter` ANDs it with the route answer, so both
reasons share the one slide-down animation. Releasing is automatic on unmount, so a page
navigated away from with its modal open can't strand the bar off-screen.

The state is a **hold count**, not a boolean, so two suppressors (or a new one mounting
before the outgoing one's cleanup runs) can't have the first release un-hide the footer
under the second. Provider: `FooterVisibilityProvider`, mounted in `MobileDemoFrame`
wrapping both the pages and `FooterPresenter`.

It was built for modals, because the bar is rendered at frame level, outside every
page's DOM, so no z-index inside a page reaches it. **Modals no longer use it** (since
2026-10-06): a dim hosts at the frame above the bar and dims it in place
(`src/components/overlayHost.ts` § "THE RULE FOR A DIM"). Current caller: the Deck
Tower — `DeckTowerPage` holds it while a study session is up (`useHideFooter(study.active)`),
so the slab leaves while the flp runs in place (DECK_TOWER.md § Studying the tower).

## Current classification

**Source of truth: `src/routes/routeMeta.ts`** (`PAGE_ROUTES` + `GAME_ROUTE_META`).
Every row below mirrors a `chrome:` field there — if the two disagree, the code wins
and this table is stale. Only the `chrome: "node" | "leaf"` routes are listed;
`chrome: "tab"` (footer-tab destinations) and `chrome: "none"` (plain-shell and
own-animation pages) are neither archetype.

| Route | Page | Archetype |
|---|---|---|
| `/discover/sort/:language` | `AddCardsPage` | Node |
| `/dictionary` | `DictionaryPage` | Footer tab; tapping a result raises the **eip sheet** over the results (`EipSheet`) — no navigation (2026-10-10) |
| `/reader` | `ReaderPage` | Node (document list; footer kept, Menu tab) — opening a document routes to `/reader/:id`, a footerless node-style surface, see § below |
| `/reader/:id` | `ReaderDocumentPage` | Node-style (footerless) — the open-document cdp-style page, see § below |
| `/flashcards/card/:id` | `VocabCardDetailPage` | Node (saved-card cdp; slab footer, Flashcards tab lit) |
| `/flashcards/writing/notebook` | `WritingNotebookPage` | Leaf (from td's writing-world paper stack, circle transition) |
| `/friends/requests` | `IncomingRequestsPage` | Node |
| `/friends/sent` | `SentRequestsPage` | Node |
| `/friends/remove` | `RemoveFriendsPage` | Node |
| `/games/bubble-match` | `BubbleMatchPage` | Leaf (footer removed; the info/picker screen no longer shows the footer). The five `/games/*` rows are mounted only while the `standaloneGames` flag is on (off since 2026-11-06) |
| `/games/word-search` | `WordSearchPage` | Leaf |
| `/games/match-speed` | `MatchSpeedPage` | Leaf |
| `/community` | `CommunityPage` | Node (reached from the Menu popover; Menu tab stays lit) |
| `/tester-dashboard` | `TesterDashboardPage` | Leaf |
| `/settings` | `SettingsPage` | Leaf (normally read as AccountSheet's Settings tab; `/settings/account`'s Back lands here) |

> Game rows are not written out in `routeMeta.ts` — `GAME_ROUTE_META` derives one
> `chrome: "leaf"` entry per ROUTED `GAME_REGISTRY` member (`ROUTED_GAMES`), so a new
> routed game is a leaf page automatically. The break-only games (Speed Reading, Memory
> Map, Writing Grid, Superposition) have no route — they are played only as flp game
> breaks inside td. Adding a non-leaf game would need a `chrome` field on `GameDef`.


### Dictionary browse state: none needed

`DictionaryPage` keeps its query and scroll in ordinary component state. A result opens the
eip sheet over the list rather than navigating, so there is no list → card → back round trip
to survive. (The `dictionaryBrowseState` singleton and `Layout.tsx`'s route watcher that reset
it were deleted 2026-11-10 with the read-only dictionary cdp.)

## Card detail (cdp): one surface

There is one card-detail page, the **saved-card cdp** (`/flashcards/card/:id`,
`src/features/flashcards/VocabCardDetailPage.tsx`), a **Node** page. A dictionary word that
is not a saved card is shown only in the eip sheet; the read-only dictionary cdp
(`/dictionary/card/:word`) was deleted 2026-11-10.

- Scrolling page: **hero flashcard** (editable icon layout) + mastery window. Loads a vet
  row by id; editable (icon-editor toolbar + delete). Delete is one tap, no confirmation, and
  non-destructive: `handleDelete` calls `removeFromLibrary`, demoting the card to
  `'provisional'` (history kept; PROVISIONAL_CARDS.md), then goes Back (`navigate(-1)`,
  or `/` when deep-linked with no history entry). Reached from td's cards page, so
  the **Flashcards** tab stays active; it wears the slab footer, the Tier 2 ground
  (`useTier2Look`) and prints its hero card on the tower card stock (`cardStockVars`,
  `src/features/flashcards/card/cardStock.ts`).
- The word's extra info is **the eip itself**, raised from the shared `SheetPill` "More Info"
  capsule (`src/components/SheetPill.tsx`): `EipSheet` → `InfoCardSection` (`SheetPanel` +
  `InfoCardPanelBody`), the same sheet acp and the Dictionary page raise, with its own
  `useEipTabs` word trail. Props: `showSynonymsRelated`, `showLearning`, `learningSkipsRoot`;
  no `showWordTools` — the word-tools rail (`WordToolsRail`) sits above the hero card, and its
  Compare raises `CompareSheet` (`useCompareSheet`). See EIP_SHEET_GESTURES.md § Mount sites.
- **Drill-ins push a crumb.** Breakdown rows (`BreakdownRow`), single-char **Used In** rows and
  example-sentence segments open the tapped word as a new crumb on the trail in the same sheet
  — the flp's behaviour (EIP_SHEET_GESTURES.md § The trail is a breadcrumb stack). The cdp
  never navigates to another card page.

### The Learning control

The app's one Learning control is the eip's raised **Add ⇄ Added!** key in the trail row
(`EipAddKey`; EIP_SHEET_GESTURES.md § Add key), shown when the `EipSheet` host passes
`showLearning` — the Dictionary page and the saved-card cdp. On the saved-card cdp
`learningSkipsRoot` hides it while the root (the saved card itself) is showing; it appears on
every word drilled into from it. Discoverable entries and signed-in users only. It tracks
whichever word is showing on the trail.

- **Not in Learning** → `+ Add`. Tap → `addToLibrary`.
- **In Learning** (bucket `'library'`) → `✓ Added!`. Tap → `removeFromLibrary`, **no
  confirmation**: removal demotes the row to `'provisional'` rather than deleting it, so marks
  survive and a re-add promotes it back in place (PROVISIONAL_CARDS.md).
- Membership comes from `GET /api/vocabEntries/libraryStatus` (a `'provisional'` row
  or no row = not in). Until it arrives nothing renders, so an added word never flashes
  "+". It is stored with its `entryKey`, so moving to another word refetches. A
  failed status fetch falls back to "+" (adding is idempotent).
- **Optimistic** (2026-10-30): a tap flips the control at once and the request is sent
  only after that frame paints (`afterNextPaint`); there is no in-flight / disabled /
  spinner state. Taps during a request are serialized per word — one request at a time,
  always ending on the learner's last tap. A failed request snaps the control back to
  the server's last accepted state.
- Success is silent — the key is the feedback. Only a failure raises `EipSheet`'s snackbar.
- The flp and acp offer no add control: the flp's older add-only "+" (`onAddToLibrary`) was
  removed 2026-10-29.

*Code:* `src/hooks/useLearningToggle.ts` (state + rules),
`src/features/flashcards/FlashcardsLearnPage/EipAddKey.tsx` (the key),
`src/features/flashcards/FlashcardsLearnPage/EipSheet.tsx` (`showLearning`,
`learningSkipsRoot`); `src/utils/vocabApi.ts` (`getLibraryStatus`,
`removeFromLibrary`, `addToLibrary`); `server/services/VocabEntryService.ts`
(`getLibraryStatus`, `removeFromLibrary`); `server/dal/implementations/VocabEntryDAL.ts`
(`findBucketRowByUserAndKey`, `demoteLibraryRowToProvisional`).

- **Dictionary page eip** (`/dictionary`, `DictionaryPage` → `EipSheet`) — not a cdp, but
  where a dictionary result lands (2026-10-10): `handleEntryClick` looks the word up
  (`lookupVocabEntry`), seeds `useEipTabs.openForRoot` (on the hit's `matchedSense` when
  there is one) and raises the shared `EipSheet`. Every link inside — breakdown / used-in
  rows, example and long-definition segments, Compare — opens as an eip crumb in the word
  trail, never a page. Props: `showSynonymsRelated`, `showWordTools` (`Write it` · `Compare`
  under the synonyms, Compare opening the eip's own Compare tab) and `showLearning`.

### Narration on entry: none (removed 2026-08-19)

**The cdp does not narrate on landing.** A card detail page is a reference surface a
learner opens to *read*, frequently several in a row through the breakdown / "Used In"
/ example-sentence drill-ins — playback on arrival was unbidden noise, and on a
drill-in chain it queued overlapping words. Narration on the cdp is now entirely
manual: the hero card's speaker button, and each example sentence's own button.

The shared `useAutoSpeakEntry(tts, entry)` hook that implemented the old behavior has
been **deleted** from `src/hooks/useTTS.ts` — the two cdps were its only callers, so
nothing else changed. `useTTS`'s manual `speak`/`prefetch` path is untouched, and
`prefetch` still warms the audio so the first press of the speaker button is instant.

Autoplay elsewhere is unaffected: the flp, Bubble Match, Hydra Bubbles, Match Speed
and the acp all narrate on their own gestures/toggles and keep doing so.

## Reader: node list + node-style document page (cdp-style)

The Reader is TWO routed pages, following the same fetch-by-id cdp pattern as
`VocabCardDetailPage` (`/flashcards/card/:id`):

- **Document list** (`/reader`, `ReaderPage.tsx`) — a NODE page reached from the
  Menu popover (`NodePage`, LEFT arrow → `navigateBackOr(navigate, "/")`, footer kept, Menu tab lit —
  same shape as `CommunityPage`). Registered by its `src/routes/routeMeta.ts` row
  (`chrome: "node"`, `footerTab: "menu"`).
  Fixed non-scrolling shell (`scrollable={false}`) — `TextSidebar` owns its own
  internal scroll region for the document list, matching the fixed-layout
  `NodePage` pattern used by `AddCardsPage`; `MobileTabScreen`'s scroll area
  reserves `FOOTER_CLEARANCE` regardless of `scrollable`, so no manual
  footer spacer is needed. `TextSidebar`'s `onTextSelect` calls
  `useSlideNavigate()` to `/reader/${text.id}`, and its New Document button
  slides to `/reader/new` (`NEW_DOCUMENT_PATH`, `readerPaths.ts`), a blank draft
  the document page opens in edit mode
  ([USER_DOCUMENT_FEATURE_SUMMARY.md](./USER_DOCUMENT_FEATURE_SUMMARY.md) § Creating a document).
- **Open document** (`/reader/:id`, `ReaderDocumentPage.tsx`) — fetches its own
  `Text` by id (`GET /api/texts/:id`), so it is deep-linkable and survives a hard
  refresh, and supports the browser back button like every other routed page.
  Rendered inside `src/features/reader/ReaderDocumentSurface.tsx`, a **footerless
  node-style drill-in**: LEFT arrow, horizontal slide, but no footer. Its header
  right slot (`docHeaderRightContent`) carries the Edit/Delete icon buttons, so
  `TextHeader.tsx` itself only renders title/meta — no back/edit/delete buttons of
  its own. `ReaderDocumentSurface` is deliberately NOT the shared
  `NodePage`: `MobileTabScreen` would reserve `FOOTER_CLEARANCE` for a
  footer bar `/reader/:id` never shows (it isn't in `FooterPresenter`'s route
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

`src/hooks/useLockBodyScroll.ts`
(the html/body scroll-lock effect) is used only by `ReaderDocumentPage` now — its
fixed `ReaderDocumentSurface` layout sits outside the standard `NodePage`/
`MobileTabScreen` shell, unlike the list page.

## Not yet classified
The generic in-game shell `src/games/runtime/GamePage.tsx` (used by any future
registry game that does not ship its own page) still has a down arrow **and** a
footer, so it fits neither rule cleanly. It is intentionally left on the older
`MobileDemoHeader` + `MobileFooter` composition until classified. Bubble Match
ships its own page (`BubbleMatchPage`) and is a leaf.
