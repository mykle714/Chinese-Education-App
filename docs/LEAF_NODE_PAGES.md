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

`PageHeader` takes a `size` of `"hub" | "node" | "leaf"`, but **you almost never pass
it**: it defaults from the props you are already passing.

| `size` | Title | Padding | Defaulted when | Design class |
| --- | --- | --- | --- | --- |
| `hub` | 24px / 600 / -0.025em | `23px 22px 0` | `showBack` is false | `.hd` |
| `node` | 21px / 600 / -0.02em | `23px 22px 0` | `arrowDirection="left"` | `.hd` + back |
| `dense` | 18px / 600 / -0.018em | `23px 22px 0` | **never — ask for it** | `.hd` (Card Detail, Learn) |
| `leaf` | 17px / 600 / -0.015em | `21px 18px 0` | `arrowDirection="down"` | `.lhd` |

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
| `HeaderIconButton` | `.hd .btn` | an icon action. `variant="bare"` (default) for drill-in/game headers carrying 2–4 actions; `variant="outlined"` for a hub header's single lone action, which needs the 32×32 box to separate it from bare paper |
| `HeaderToggleChip` | `.lhd .tg` | a mono toggle chip. On = solid ink ground + white text — an inversion, not a tint change |

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
  not fire one.) Used by `HubMenuRow` (all hub drill-ins), the Decks→Mastered link,
  and the Decks/Mastered → Card Detail card taps.
- **CSS (`src/index.css`):** `::view-transition-new(root)` runs `vt-slide-in-up` /
  `vt-slide-in-right` per `data-vt-dir`; `::view-transition-old(root)` has
  `animation: none` so the old page is **held static** beneath (z-index below the
  new). The footer bar carries its own `view-transition-name: app-footer`, so it
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

The footer bar is **not** part of any page-slide surface. It is rendered
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

This exists because the bar **cannot be layered under** a page's modal: it is rendered
at frame level, outside every page's DOM, so no z-index inside a page reaches it. Sliding
it away is the only correct answer. Current caller: scp, while the eip sheet is open
([SORT_CARDS_REQUIREMENTS.md §4.7](./SORT_CARDS_REQUIREMENTS.md)).

## Current classification

**Source of truth: `src/routes/routeMeta.ts`** (`PAGE_ROUTES` + `GAME_ROUTE_META`).
Every row below mirrors a `chrome:` field there — if the two disagree, the code wins
and this table is stale. Only the `chrome: "node" | "leaf"` routes are listed;
`chrome: "tab"` (footer-tab destinations) and `chrome: "none"` (plain-shell and
own-animation pages) are neither archetype.

| Route | Page | Archetype |
|---|---|---|
| `/discover/sort/:language` | `SortCardsPage` | Node |
| `/discover/quick-mark/:language` | `QuickMarkPage` | Node |
| `/discover/skipped/:language` | `SkippedCardsPage` | Node |
| `/dictionary` | `DictionaryPage` | Node (footer added; tapping a result opens the dictionary cdp) |
| `/dictionary/card/:word` | `DictionaryCardDetailPage` | Node (read-only cdp; det-keyed by word) |
| `/reader` | `ReaderPage` | Node (document list; footer kept, Home tab) — opening a document routes to `/reader/:id`, a footerless node-style surface, see § below |
| `/reader/:id` | `ReaderDocumentPage` | Node-style (footerless) — the open-document cdp-style page, see § below |
| `/flashcards/card/:id` | `VocabCardDetailPage` | Node (saved-card cdp; footer added) |
| `/flashcards/collection/:builtin` | `CollectionViewPage` | Node (Learn Now / Mastered / mastered-reading / mastered-writing — see [DECKS_FEATURE.md](./DECKS_FEATURE.md)) |
| `/flashcards/deck/:id` | `CollectionViewPage` | Node (a user-authored deck, addressed by numeric id) |
| `/flashcards/mastered` | `MasteredRedirect` | Node (legacy path; `<Navigate replace>` to `/flashcards/collection/mastered`) |
| `/friends` | `FriendsPage` | Node (Home tab stays lit) |
| `/friends/requests` | `IncomingRequestsPage` | Node |
| `/friends/sent` | `SentRequestsPage` | Node |
| `/friends/remove` | `RemoveFriendsPage` | Node |
| `/games` | `GamesPage` | Node |
| `/games/bubble-match` | `BubbleMatchPage` | Leaf (footer removed; the info/picker screen no longer shows the footer) |
| `/games/word-search` | `WordSearchPage` | Leaf |
| `/games/match-speed` | `MatchSpeedPage` | Leaf |
| `/games/speed-reading` | `SpeedReadingPage` | Leaf |
| `/community` | `CommunityPage` | Node (reached from the Home hub; Home tab stays lit) |
| `/tester-dashboard` | `TesterDashboardPage` | Leaf |
| `/night-market` | `NightMarketEnginePage` | Leaf |
| `/settings` | `SettingsPage` | Leaf (slide-up sheet from the Account header gear) |

> Game rows are not written out in `routeMeta.ts` — `GAME_ROUTE_META` derives one
> `chrome: "leaf"` entry per `GAME_REGISTRY` member, so a new game is a leaf page
> automatically. Adding a non-leaf game would need a `chrome` field on `GameDef`.


### Dictionary browse-state persistence

`DictionaryPage`'s query, pagination page, and scroll position are held in an
in-memory singleton, `dictionaryBrowseState` (`src/features/dictionary/dictionaryBrowseState.ts`),
so the list ⇄ card-detail (cdp) drill-in restores where the user was. The state is
seeded into `useDictionarySearch` via its `initial` argument and kept in sync by
effects in `DictionaryPage.tsx`.

It is meant to survive **only** moves inside the Dictionary space (`/dictionary`
and `/dictionary/card/*`). The route watcher in `Layout.tsx` calls
`resetDictionaryBrowseState()` on the first transition from an in-space pathname to
an out-of-space one, so every exit — the back arrow to Home, a footer-tab tap, and
browser back — clears the query; `isDictionarySpacePath()` defines the space. A full
page reload also starts fresh (the singleton is not persisted to storage).

## Card detail (cdp): two surfaces, two bodies

There are two card-detail pages, both **Node** pages. They agree on everything above
the fold (hero card + badges) and on every leaf renderer, but since 2026-08-24 they
show the word's extra info through **different containers**:

| Surface | Extra-info container |
|---|---|
| Saved-card cdp (`VocabCardDetailPage`) | **the eip itself** — `InfoCardSection` (`SheetPanel` + `InfoCardPanelBody`), the exact component the flp and scp raise, opened from the shared `SheetPill` "More Info" capsule (`src/components/SheetPill.tsx`) |
| Read-only dictionary cdp (`DictionaryCardDetailPage`) | `VocabCardSections` (`src/features/flashcards/VocabCardDetailBody.tsx`) — stacked `SectionCard`s down the page |

Underneath, both render the same leaves — `DefinitionFacts`, `BreakdownRow`,
`UsedInPaginatedList`, `ExampleSentenceList`, `SynonymsRelatedSection` — so a change to
any one of them lands on both.

- **Saved-card cdp** (`/flashcards/card/:id`, `VocabCardDetailPage`) — loads a vet
  row by id; editable (icon-editor toolbar + delete). Reached from Decks/Mastered, so
  the **Flashcards** tab stays active. Raises the eip from the "More Info" `SheetPill`; passes
  `onWordOpen` through the panel's drill-in callbacks (see § "Breakdown drill-in
  targets" below), so breakdown rows / used-in rows / example segments are tappable.
- **Read-only dictionary cdp** (`/dictionary/card/:word`, `DictionaryCardDetailPage`)
  — fetches the det row via `/api/dictionary/lookup/:word` and adapts it
  (`dictEntryAdapter`, which now carries `iconId`). **No edits**: no toolbar/delete,
  and the hero always renders the det's representative icon in **basic** layout
  (`iconLayout`/`textLayout` null, advanced off). Reached from the Dictionary node, so
  the **Home** tab stays active. Passes `onWordOpen`, so breakdown/used-in rows and
  example-sentence segments drill into the cdp of the tapped word (the same drill-in
  the eip offers, except it navigates to a cdp instead of opening a nested eip tab).
  Every linked page is itself this read-only cdp, so read-only propagates recursively.

### Breakdown drill-in targets

Both surfaces make the Character Breakdown rows (`BreakdownRow`, which replaced the
square `InfoCardBlockButton` grid on 2026-08-24), the
single-char **Used In** rows and the example-sentence segments tappable — the dictionary
cdp by passing `onWordOpen` to `VocabCardSections`, the saved-card cdp by wiring the
eip's `onBreakdownItemClick` / `onUsedInItemClick` / `onExampleSegmentClick` to the same
handler. **This is the one place the saved cdp deliberately behaves unlike the flp:** the
flp pushes a nested eip entry tab, the cdp NAVIGATES to the tapped word's own card detail
(which is what a detail page is for, and why the cdp mounts the panel without a
`tabStrip`). They differ only in where a tap LANDS:

| Surface | Handler | Target |
|---|---|---|
| Read-only dictionary cdp | `DictionaryCardDetailPage.handleWordOpen` (`src/features/dictionary/DictionaryCardDetailPage.tsx`) | always `/dictionary/card/:word` — browsing the dictionary never jumps into the editable deck surface |
| Saved-card cdp | `useOpenWordCard` (`src/hooks/useOpenWordCard.ts`), wired in `VocabCardDetailPage.tsx` | the learner's own `/flashcards/card/:id` when a vet row exists for that word, else `/dictionary/card/:word` |

`useOpenWordCard` resolves word → saved-card id through
`fetchVocabEntriesByTokens` (`src/utils/vocabApi.ts`), whose per-token client cache
makes repeat taps network-free; the hook also **prewarms** that cache on mount with
every linkable word on the page (breakdown characters + used-in keys) so the first
tap navigates without a round trip. A failed lookup falls back to the dictionary
cdp, and an in-flight lookup swallows further taps so one gesture never produces two
navigations. Both routes are node-page prefixes in `pageTransition.ts`, so either
target slides in from the right.

### Narration on entry: none (removed 2026-08-19)

**Neither cdp narrates on landing.** A card detail page is a reference surface a
learner opens to *read*, frequently several in a row through the breakdown / "Used In"
/ example-sentence drill-ins — playback on arrival was unbidden noise, and on a
drill-in chain it queued overlapping words. Narration on both cdps is now entirely
manual: the hero card's speaker button, and each example sentence's own button.

The shared `useAutoSpeakEntry(tts, entry)` hook that implemented the old behavior has
been **deleted** from `src/hooks/useTTS.ts` — the two cdps were its only callers, so
nothing else changed. `useTTS`'s manual `speak`/`prefetch` path is untouched, and
`prefetch` still warms the audio so the first press of the speaker button is instant.

Autoplay elsewhere is unaffected: the flp, Bubble Match, Hydra Bubbles, Match Speed
and the scp all narrate on their own gestures/toggles and keep doing so.

## Reader: node list + node-style document page (cdp-style)

The Reader is TWO routed pages, following the same fetch-by-id cdp pattern as
`VocabCardDetailPage` (`/flashcards/card/:id`):

- **Document list** (`/reader`, `ReaderPage.tsx`) — a NODE page reached from the
  Home menu (`NodePage`, LEFT arrow → Home, footer kept —
  same shape as `GamesPage`/`DictionaryPage`). Registered in `NODE_ROUTES`
  (`src/utils/pageTransition.ts`) and `FOOTER_ROUTES` (`FooterPresenter.tsx`).
  Fixed non-scrolling shell (`scrollable={false}`) — `TextSidebar` owns its own
  internal scroll region for the document list, matching the fixed-layout
  `NodePage` pattern used by `SortCardsPage`; `MobileTabScreen`'s scroll area
  reserves `FOOTER_CLEARANCE` regardless of `scrollable`, so no manual
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
