# Games Feature

A top-level section of the mobile demo where users access mini-games that
reinforce vocabulary and character learning. The hub page lists all registered
games; each game lives as its own page linked from the hub.

## Status

- Hub page (`/games`) — shipped. Renders `GAME_REGISTRY` through the shared
  `HubMenu`; the empty state is now only a fallback for when every game is gated
  out (public/demo accounts).
- Games — **four shipped**, all registered in `src/games/registry.ts`:
  - **Bubble Match** (`/games/bubble-match`) — see [§ Game: Bubble Match](#game-bubble-match-gamesbubble-match).
  - **Word Search** (`/games/word-search`) — see [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md).
  - **Match Speed** (`/games/match-speed`) — see [MATCH_SPEED_GAME.md](./MATCH_SPEED_GAME.md).
    Fans out on the hub into three difficulty modes (Study Mix / Review / Challenge), which
    restrict the pool to the same mastery buckets the `/decks` study buttons use.
    A tap-to-match recognition speed drill: 2 columns × 6 rows (foreign |
    English), 30-second clock, board refills every 3s, medals by pairs matched.
  - **Speed Reading** (`/games/speed-reading`) — see
    [SPEED_READING_GAME.md](./SPEED_READING_GAME.md). A **reading** drill: pinyin
    + definition + audio at the top, then two word options — the real word and
    one where a single character has been swapped for another real character from
    the player's library. The only **race** format in the set: a fixed 20 rounds
    with a count-**up** clock, medals by finishing TIME (lower is better), and a
    3-second penalty per wrong answer (shown as a red +3s floating from the tap).
    Every round must be answered — it has **no Skip**.

  Bubble Match and Word Search are **DOM + `requestAnimationFrame`** games; Match
  Speed and Speed Reading are **DOM + timers only** (no rAF loop — no physics and no
  per-frame animation, just CSS transitions and intervals). **There is no Pixi game
  runtime any more** — the never-used `GameStage` / `GamePage` / `useGameActors`
  scaffolding was deleted (commit `70dc441`); see
  [§ Layer 2](#layer-2--runtime-srcgamesruntime).

### What Speed Reading introduced

Speed Reading is the first game to need machinery the other three didn't, all of
which is now shared:

- **A language gate on `GameDef`** — `languages?: Language[]`, evaluated in
  `GamesPage` against `user.selectedLanguage`. A game whose languages exclude the
  learner is **hidden** from the hub, not shown-and-blocked (a visible row that
  dead-ends reads as a bug). Speed Reading declares `["zh"]`; the other three omit
  the field and are unaffected.
- **`?markType=` on `GET /api/onDeck/gamePool`** — the endpoint used to hardcode
  `recognition` back when Bubble Match was its only caller. A game's pool must be
  bucketed by, and cooled on, the track it actually MARKS; Speed Reading marks
  **reading**. Bubble Match's call site now passes `markType=recognition`
  explicitly, so no caller relies on the default.
- **`GlyphSvg`** (`src/components/handwriting/`) — a static glyph renderer, the
  second consumer of the `hanzi-writer-data` stroke corpus after the Practice
  Writing guide.

It owns **no tables and no migrations**: a round's wrong option is a real
character read out of the player's own library at game load.

It is also the app's first emitter of **negative reading marks** — deliberately.
A player who taps randomly scores ~50% and earns negatives at that rate; the marks
are an honest record of the answers given. No accuracy floor, no suppression, and
no unmarked path: the game has no Skip, so every round shown produces exactly one
mark.

## Routes

| Path     | Component   | Footer `activePage` | Notes                          |
| -------- | ----------- | ------------------- | ------------------------------ |
| `/games` | `GamesPage` | `"home"`            | Hub / menu; **node page** (left arrow → `/`, keeps footer, slides in-from-right) |

Each individual game gets its own route under `/games/<slug>`.

**Bubble Match is a leaf page (no footer).** `BubbleMatchPage` is wrapped in
`LeafPage` (see [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)): the down-arrow back
button (→ `/games`) is the only way out, there is **no** footer on any of its
screens (loading / blocked / stage — the level is picked on the hub, so there is
no in-game picker screen), and the page slides up on enter / down on exit. The pinyin + autoplay toggles and the fire badge live in
the header's right slot via `BubbleMatchHeaderControls`.

**Word Search is also a leaf page**, wrapped the same way (down arrow → `/games`,
no footer, slides up on enter).

**Match Speed and Speed Reading are leaf pages too** — every shipped game is. Games
are classified `chrome: "leaf"` in bulk by `GAME_ROUTE_META` in
`src/routes/routeMeta.ts`, which derives one row per `GAME_REGISTRY` entry, so a new
game gets leaf chrome without touching the route tables. A game that should keep the
footer would need a `chrome` field on `GameDef` first; none exists.

There is no generic in-game shell to adopt — each game owns its page. (A
`src/games/runtime/GamePage.tsx` used to exist and rendered node-style chrome, which
was wrong for a leaf page; it was deleted unused. See § Layer 2.)

## Launching a game with one collection of cards

Every game is played with **the collection selected in the Games hub header**.

| Collection | Param | Effect |
| --- | --- | --- |
| All Cards *(default)* | *(none)* | Every playable card — the pool games have always drawn from |
| Learn Now | `?collection=learn-now` | Sorted cards that aren't core-mastered |
| Mastered (per bar) | `?collection=mastered[-reading|-writing]` | Pool restricted to that bar's mastered cards |
| A deck | `?deck=<id>` | Pool restricted to that deck, plus any card lent to reach the game's baseline |

### Collection selector (hub header)

`src/games/GamesCollectionSelector.tsx`, rendered into `HubMenu`'s `header` slot
above the TipBox: a full-width pill reading **"Playing with: &lt;collection&gt;"** that
opens a menu of every set the fdp offers — *Cards* (All Cards + Learn Now), *Mastered*
(one row per **active** bar), and the learner's *Decks* (`fetchDecks`).

**The fdp is the source of truth for that list.** The built-in rows come from
`builtinCollectionEntries` (`src/features/flashcards/builtinCollections.ts`), the same
function the fdp renders as tiles, so the two surfaces cannot drift on which
collections exist, their order, their grouping or their colors — including the rule
that *Mastered* is a separate group only when a reading or writing goal is set
(otherwise its single row is listed under *Cards*). This component decides only how a
row LOOKS. Each row carries the same identifying color its fdp tile does; a deck's dot
uses `deckTileColors(id).main`.

The choice lives in **`src/features/flashcards/selectedCollection.ts`** — a module
singleton + `useSyncExternalStore`, the same shape as `minutePointsPause`:

* **Session-scoped, never persisted.** It survives leaving the hub for a game and
  coming back (otherwise every round would silently reset to All Cards mid-session),
  and is gone on reload — a learner returning tomorrow is not still locked to one
  deck they picked once. That rules out both `localStorage` and page-level state.
* **No game page knows it exists.** `GamesPage` wraps every card's `to` in
  `withCollectionParams(route, selected)`, so a game arrives with the same
  `?deck=` / `?collection=` a collection-page launch always sent.
  `WordSearchHubItem` applies the params itself because it builds its own links
  (it navigates imperatively to confirm before clobbering a saved board); its
  **resume** card deliberately carries **no** params — that board was built from
  whatever set was selected when it started.
* **Stale decks self-heal.** After loading the deck list the selector calls
  `clearSelectedDeckIfMissing`, dropping back to All Cards when the selected deck was
  deleted or belongs to the learner's other language (decks are per-language).

> **Removed:** the collection view page's "Study these cards" button used to open a
> sheet listing the flp **and every game**. That put the two choices in the wrong
> order — a learner picks the activity first — so the sheet is gone and the button is
> now a plain one-tap launch into the **flp** with that collection. Games are chosen
> on the Games hub, cards with the selector above.

Each game page reads this back with `useLaunchCollection()` and appends
`collectionQuerySuffix(...)` to **every** pool request — including partial refills
(Bubble Match's "Play Again", Speed Reading's mid-run top-up). A refill that dropped
the param would start serving cards from outside the set mid-game.

Speed Reading's **distractor** endpoint is deliberately NOT restricted: the foils
are meant to come from outside the set, or the deck becomes the answer key.

Full details, including the server-side filter: [DECKS_FEATURE.md](./DECKS_FEATURE.md) § 3.

## Navigation entry point

Games is **not** a footer tab. It is a row in the **Home menu** (`/`, see
[NAVIGATION.md](./NAVIGATION.md)). The footer tabs are Flashcards / Discover /
Home / Account; the Games hub is reached by tapping **Games** in the Home menu.
The hub is a **node page** (`NodePage`, see [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)):
its header shows a **left** back arrow returning to `/`, it keeps the floating
footer, and it slides in from the right (out to the right only when the arrow is
tapped — footer-tab nav does not animate).

## Design decisions

### 1. Hub is a vertical, width-spanning menu
Each game appears as a full-width row rendered by the shared `HubMenu` /
`HubMenuRow` components (also used by the Home and Discover hubs — see
[HUB_MENU_SYSTEM.md](./HUB_MENU_SYSTEM.md)). This makes the hub feel like a clean
directory rather than a tiled launcher and keeps parity with the long-form scroll
surfaces elsewhere in the mobile demo (decks, discover).

Two games fan out into horizontally-scrolling sub-card strips instead of a single
row, both special-cased in `GamesPage.tsx` rather than generalized onto `GameDef`:
Bubble Match uses a generic `HubMenuArrayItem` (one sub-card per difficulty level,
since the in-game level picker was removed), and Word Search owns its whole strip
via `WordSearchHubItem` (Pinyin / No Pinyin + a resume card, which needs
confirm-before-clobber click handling).

### 2. Empty state instead of placeholder cards
When the registry yields no visible rows — every game gated out by `requiresAuth`
or `unlock`, e.g. on a public/demo account — the hub renders a centered empty
state ("No games yet" + subtitle) instead of mocked rows. Originally this covered
the pre-first-game period; it now survives as the gated-out fallback. Rationale:
placeholder rows tend to get shipped by accident.

### 3. Left back arrow on the hub (node page)
The hub is a **node page** (`NodePage`), so it shows a **left** back arrow
returning to `/` — Games is a drill-in from the Home menu, not a footer tab.
It keeps the floating footer (lateral nav stays available) and only slides out
to the right when the arrow is tapped. See [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).

### 4. Reuses the existing iPhone frame layout
`GamesPage` mirrors the `IPhoneFrame` / `ContentArea` / `MobileFooter` layout
from `FlashcardsDecksPage` so the games tab feels like a sibling surface
rather than a separate visual system. Design tokens are duplicated locally
for now; if a third page needs them we should hoist a shared
`MobileSurface` primitive.

## Resolved decisions (were open questions before the first game shipped)

| Question | Resolution |
| --- | --- |
| Row anatomy | Owned by the shared `HubMenu` / `HubMenuRow`, not by this page. See [HUB_MENU_SYSTEM.md](./HUB_MENU_SYSTEM.md). |
| Locking / progression | Two gates on `GameDef`, both evaluated at hub render time: `requiresAuth` (hides the game from public/demo accounts) and `unlock.minVocabEntries` (declared but unused). **No game may block on card count** — see [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md): each game's old minimum is now a BASELINE the server tops the player up to with temporary cards. The only remaining entry conditions are being signed out and Word Search's zh-only restriction. No game is gated behind another game. |
| Score / streak surfacing | Games feed the **existing** systems, not a parallel one. Both game routes are in `MINUTE_POINTS_ELIGIBLE_PAGES` (`src/constants.ts`) and are in the start-on-entry subset (a player reads the board before their first tap), so play time accrues minute points and streak exactly as flp does. Matches emit real review marks via `POST /api/flashcards/mark` — so playing a game moves mastery. Wins are counted separately via `POST /api/users/me/wins` and read back by `useGameWins` for the hub's `HubMenuStatBadge`. |
| Sort order of the menu | Manual curation — `GAME_REGISTRY` array order, top to bottom. Not recency or recommendation-ranked. |

## Mobile demo frame (shared sizing)

All mobile-demo routes (the ones listed in `MOBILE_DEMO_PATHS` in
`src/components/Layout.tsx`) share **one** phone-frame container:
`src/components/MobileDemoFrame.tsx`. `Layout.tsx` wraps the route's children
with it automatically — on mobile it renders full-bleed, on desktop it renders
as a centered ~393px-wide rounded card. There is no sidebar/hamburger chrome
anymore (see [NAVIGATION.md](./NAVIGATION.md)); desktop is phone-frame-only.

**Do not** re-introduce a per-page `IPhoneFrame = styled(Box)…` or local
`desktopFrameSx` block when adding a new game page (or any other mobile-demo
page). Just register the route in `MOBILE_DEMO_PATHS` and render the page's
content directly — header + content area + `MobileFooter`. The frame is
applied for you.

Today's `MOBILE_DEMO_PATHS` (`src/components/Layout.tsx`): `/`,
`/flashcards/decks`, `/flashcards/mastered`, `/account`, `/flashcards/learn`,
`/discover`, `/games`, `/community`, `/night-market`, `/reader`, `/dictionary`,
`/compare`, `/tester-dashboard`, `/settings`, `...GAME_ROUTES`, plus any path
under `/discover/sort/`, `/discover/quick-mark/`, `/discover/skipped/`,
`/flashcards/card/`, `/dictionary/card/`, or `/reader/`.

## Mobile demo header (shared header hierarchy)

Two-layer header model (there is **no** hamburger / nav drawer — global nav is
the footer tabs + the Home menu):

- **`PageHeader`** (`src/components/PageHeader.tsx`) — base layout primitive.
  Defines the row: optional back button (`arrowDirection` "down" | "left") ·
  optional left-icon badge · title · `rightContent` (a single flush-right
  ReactNode slot).
- **`MobileDemoHeader`** (`src/components/MobileDemoHeader.tsx`) — composes
  `PageHeader`, adds the active-tab identity badge in the left slot
  (`activePage`, when no back button), `showBack` for drill-ins, an
  `arrowDirection` pass-through, and an `extraActions` slot rendered flush-right
  (e.g. the settings gear on Account).
- **`LeafPageHeader` / `NodePageHeader`** (`src/components/`) — thin
  specializations preset to `arrowDirection` "down" / "left" + `showBack`. Used
  by the `LeafPage` / `NodePage` wrappers. See
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).

Rules of thumb:

- Footer-tab hubs (Flashcards/Decks, Discover, Home, Account) → use
  `MobileDemoHeader` inside `MobileTabScreen`; pass `title`, `activePage`, and
  optional `headerExtraActions`.
- Back-arrow drill-ins → use the `LeafPage` (down arrow, no footer) or `NodePage`
  (left arrow, keeps footer) wrapper instead of composing the header by hand.
  Games + Mastered Cards are node pages; Sort Cards, Dictionary, and Card Detail
  are leaf pages.
- Specialty in-page headers (`FlashcardsLearnHeader` with fire icon + seconds
  counter) → compose `PageHeader` directly and own their own `rightContent`.

## Games framework

The hub no longer hardcodes its menu — it reads from a registry that also
drives the router and the mobile-demo allowlist. The framework has three
frontend layers and a thin backend.

### Layer 1 — Registry (`src/games/registry.ts`)

```ts
export const GAME_REGISTRY: GameDef[] = [
  { gameId: "bubble-match", title: "Bubble Match", route: "/games/bubble-match",
    requiresAuth: true, Component: lazy(() => import("./bubble-match/BubbleMatchPage")) },
  { gameId: "word-search", title: "Word Search", route: "/games/word-search",
    requiresAuth: true, Component: lazy(() => import("./word-search/WordSearchPage")) },
  { gameId: "match-speed", title: "Match Speed", route: "/games/match-speed",
    Component: lazy(() => import("./match-speed/MatchSpeedPage")) },
];
```

Each `GameDef` (`src/games/types.ts`) carries `gameId`, `title`, `subtitle`,
`iconAsset`, `route`, a lazy-loaded `Component`, and optional gating
(`requiresAuth`, `unlock.minVocabEntries`).

The registry is consumed by:

- `src/games/GamesPage.tsx` — renders one menu row per registered game; falls
  back to the existing empty state when nothing is registered (or everything
  is gated out).
- `src/App.tsx` — iterates `GAME_REGISTRY` to mount one route per game, each
  wrapped in a `Suspense` boundary for the lazy component.
- `src/components/Layout.tsx` — spreads `GAME_ROUTES` into
  `MOBILE_DEMO_PATHS` so every game gets the phone frame automatically.

Net effect: adding a new game = one entry in `GAME_REGISTRY` + one page
component. No edits to `GamesPage`, `App`, or `Layout`.

### Layer 2 — Runtime (`src/games/runtime/`)

Three files, all live. The folder is a **grab-bag of shared game bits**, not a
framework — no game inherits a shell from it.

- **`GameEndPopup.tsx`** — the shared end-of-run popup **shell**: presentational
  layer owning the scrim, the card chrome (× button), the corner puck, and the
  FLIP-style collapse animation between them. The **page** owns the `minimized`
  flag and the card's content (title / message / actions), passed as `children`;
  `classPrefix` keeps each game's BEM classes distinct. Word Search renders it
  directly; Bubble Match wraps it in `BubbleMatchEndPopup` to pin
  `classPrefix="bubble-match"`; Match Speed and Speed Reading wrap it the same way.
- **`gameSounds.ts`** — shared sound effects for game events.
- **`useSidewaysStage.ts`** — the landscape-stage helper behind Speed Reading's
  rotated presentation (see `LeafPage`'s `hideHeader` render-prop form in
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)).

> **Deleted: the Pixi runtime scaffolding.** `GameStage.tsx` (generic Pixi.js
> host), `GamePage.tsx` (generic page shell), and `useGameActors.ts` (generic actor
> handle) were written ahead of the first game and **no game ever imported them**.
> They were removed in commit `70dc441`. Do not resurrect them speculatively — the
> shipped pattern is DOM + rAF (Bubble Match, Word Search) or DOM + timers (Match
> Speed, Speed Reading), and a game that genuinely needs a WebGL scene graph should
> borrow from the night market's Pixi host (`src/features/nightmarket/pixiRuntime.ts`,
> `useMarketWorld.ts`) rather than from a fresh unproven abstraction.

### Layer 3 — Data hooks

**There is no `src/games/hooks/` folder.** It held four hooks, all now deleted:

| Hook | Fate |
| --- | --- |
| `useVocabEntries` (`GET /api/vocabentries`) | deleted 2026-07-28 — exposed a flat `definition?: string \| null` with no sense fields, so a new game written against it would have silently produced sense-blind definitions |
| `useDictionaryEntries` (`GET /api/dictionary/lookup/:term`) | deleted 2026-07-28, same reason |
| `useGameAssets(gameId)` (`GET /api/games/:gameId/assets`) | deleted in `70dc441` — existed only to feed `GameStage`'s texture preload |
| `useGameProgress<TState>(gameId)` (`GET`/`POST /api/games/:gameId/progress`) | deleted in `70dc441` — unused; Word Search persists its board to `localStorage` (`gameStateStorage.ts`) instead |

> ⚠️ **The backend halves of the last two are still live and now have no client.**
> `GET /api/games/:gameId/assets`, `GET`/`POST /api/games/:gameId/progress`
> (`server/routes/gamesRoutes.ts` → `GamesController` → `GameAssetService` /
> `GameProgressService` → the `gameassets` / `gameprogress` tables, migration 52)
> are all still wired and unreferenced from the client. Either a future game adopts
> them or they should be retired together with their two tables — flagged rather
> than silently deleted because the seed script `server/scripts/seedGameAssets.js`
> and migration 52 belong to the same decision.

Games talk to the server through `src/api/http.ts` (the typed cookie-auth `fetch`
wrapper — `apiGet` / `apiPost`), which inherits transparent token-refresh from the
global fetch interceptor (`src/utils/fetchInterceptor.ts`). **Game vocab comes from
the OnDeck endpoints**, never from a generic vocab hook; see the rule below.

### Layer 4 — Backend (`server/`)

Two new tables (migration `database/migrations/52-create-game-tables.sql`):

- **`gameassets`** — `(gameId, assetId)` unique; per-game asset registry.
  Binaries live under `server/public/games/<gameId>/` and are served as
  static files; the DB stores the relative path.
- **`gameprogress`** — `(userId, gameId)` unique; one save blob per
  user/game. `state` is JSONB whose shape each game defines client-side.

Follows the existing DAL + Service + Controller pattern:

- `server/dal/implementations/GameAssetDAL.ts`,
  `server/dal/implementations/GameProgressDAL.ts`
- `server/services/GameAssetService.ts`, `server/services/GameProgressService.ts`
- `server/controllers/GamesController.ts`
- Wired in `server/dal/setup.ts`; routes registered in
  `server/routes/gamesRoutes.ts` (split out of `server.ts`; paths unchanged):
  - `GET  /api/games/:gameId/assets`
  - `GET  /api/games/:gameId/progress`
  - `POST /api/games/:gameId/progress`

`server/scripts/seedGameAssets.js <gameId>` walks
`server/public/games/<gameId>/` and upserts one `gameassets` row per file —
safe to re-run.

### Sense correctness — every game must honor the learner's selected sense

A word in the learner's library has a **chosen sense**: `vet.selectedSense`
(migration 99) stores a `definitionClusters` **label**, and the flashcard face
shows that cluster's gloss, not `definitions[0]`. A game showing a different
English gloss than the flashcard the player learned it from is a bug — the player
reads it as the game not knowing their word. See
[DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md) and
[DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) form #3 (dd).

**The rule:** never render `entry.definition` / `definitions->>0` raw for a card
the player owns. Resolve through one of the two twin resolvers:

| Where the clusters live | Resolver | File |
| --- | --- | --- |
| Payload carries `definitionClusters` + `selectedSense` → resolve on the **client** | `resolveDisplayDefinition(entry)` | `src/utils/definitionUtils.ts` |
| Payload flattens dd and drops the clusters → resolve on the **server**, before serializing | `resolveDisplayDefinition(entry)` | `server/utils/definitions.ts` |

Both apply the identical rule: keep clusters with a non-empty `ddt`, bail to the
flat `definition` when fewer than 2 remain (no real choice), sort by
`frequencyScore` desc, match `selectedSense` by label, else index 0. They are
**hand-maintained twins** (separate builds, no shared module, no test asserting
they agree) — change one, change the other.

How the shipped games satisfy this:

- **Bubble Match** resolves on the client. `gamePool` selects `ve.*, ${DICT_COLS}`
  (`OnDeckVocabService.fetchGameCandidates`), so `selectedSense` (from `ve.*`) and
  `definitionClusters` (`server/dal/shared/dictJoin.ts`) both reach the browser;
  `Bubble.tsx` calls `resolveDisplayDefinition(entry)` for the text and
  `BubbleStage.tsx` calls it again for bubble sizing — deliberately the same
  resolver, so a bubble is always sized for the string it actually shows.
- **Word Search** resolves on the server, because the grid payload intentionally
  does not carry clusters: `OnDeckVocabService.getWordSearchGrid` sets
  `definition: resolveDisplayDefinition(w)` when building `WordSearchInput`.

Two deliberate exceptions, both correct:

- **Word Search single-character tap popups** are *context*-resolved, which is
  stronger than sense-resolved: the gloss is `resolveSenseGloss(charClusters, sense)`
  keyed by the parent word's stored `breakdown[char].sense`, so tapping 明 in 明白
  shows its meaning **in that word**, not its generic standalone gloss.
- **Word Search bonus words** (a real det headword the player traced that isn't a
  target) use raw `definitions->>0`. There is no `vet` row for them — they aren't
  the player's cards — so they follow the standard det-fallback rule (index 0),
  the same as discover cards and the read-only dictionary cdp.

### Popups pause the clock

**The rule:** no game's clock — or whatever else in that game advances on its own
and can end a run — may run while a **modal, input-blocking popup** covers the
board. Reading a popup is not playing, so it must not be billed to the player.

Each page derives one boolean, `clockPaused`, from its own popup state and feeds
it to whatever moves on its own:

| Game | `clockPaused` is true while | What freezes | Code |
| --- | --- | --- | --- |
| Match Speed | the provisional notice or the settings sheet is open | the 3·2·1 countdown **and** the 30 s run clock | `MatchSpeedPage.tsx` (`clockPaused`, the countdown effect, the run-clock effect) |
| Word Search | the provisional notice or the settings sheet is open | the count-up clock, via the existing `pauseTimer`/`resumeTimer` pair | `WordSearchPage.tsx` (`clockPaused`, `clockPausedRef`, the pause effect) |
| Speed Reading | the provisional notice is open | the count-up clock — `startAtRef` is pushed forward by the paused span on resume | `SpeedReadingPage.tsx` (`clockPaused`, `pausedAtRef`, the clock effect) |
| Bubble Match | the provisional notice is open | the bubble launcher, the descending ceiling and the overfill loss check | `BubbleMatchPage.tsx` (`clockPaused`) → `BubbleStage.tsx` (`paused`, `pausedRef`, `stepFrame`, the launch interval) |

Three consequences worth keeping in mind when adding a popup or a game:

- **Only input-blocking overlays qualify.** `ProvisionalCardsNotice` and the
  settings sheets take the whole screen, so a frozen clock cannot be used to study
  a live board. Word Search's in-grid gloss popups are deliberately **excluded**:
  they are small anchored tooltips that leave the board playable, so pausing on
  them would hand the player a free stopwatch stop.
- **End-of-run popups are irrelevant.** The end popup and `ProvisionalSortOffer`
  only ever open once the run is scored and the clock has already stopped.
- **Resume must not pay the pause back.** A count-down clock re-arms from the time
  *remaining* (Match Speed keeps `remainingMs` in a ref for exactly this); a
  count-up clock moves its origin forward (Speed Reading) or uses an explicit
  pause/resume pair (Word Search); the rAF field re-bases its frame clock every
  paused frame so the whole span doesn't arrive as one giant `dt` (Bubble Match).

Also note Word Search's pause has **two** sources — the popup gate and the
existing backgrounding (`visibilitychange`) pause. Returning to the foreground
checks `clockPausedRef` before resuming, so a tab switch cannot restart a clock a
popup is still holding.

### Adding a new game — checklist

Reflects what the four shipped games actually do. There is no generic runtime to
inherit from (§ Layer 2) — copy the closest shipped game: Bubble Match / Word Search
for a rAF loop, Match Speed / Speed Reading for a timer-driven board.

1. Create `src/games/<gameId>/<GameId>Page.tsx`. Wrap it in `LeafPage`
   (down arrow → `/games`, no footer) — all four shipped games are leaf pages, and
   `GAME_ROUTE_META` classifies every registry entry as `chrome: "leaf"`, so a game
   that wants the footer needs a `chrome` field on `GameDef` first. **Do not** add a
   per-page `IPhoneFrame` — the frame comes from `MobileDemoFrame` via `Layout.tsx`.
2. Fetch vocab from the OnDeck stack, not from a generic vocab endpoint:
   `GET /api/onDeck/gamePool?<Category>=<n>...` returns library cards bucketed by
   the mark type the game emits. Declare that mark type ONCE as `MARK_TYPE` in your
   game's `constants.ts` and read it from there for the `?markType=` query, the
   `markFlashcard({ type })` call, and your `GameDef.markType` (which makes the hub
   render its right-edge mark-type label). If your game's mark type varies by mode,
   omit `GameDef.markType` and put the type on each mode config instead, the way Word
   Search does — then pass a `<MarkTypeChip variant="edge" />` per sub-card, wrapped
   in `HubMenuCardEdgeSlot` if you hand-build the cards. See the backend notes under
   [§ Game: Bubble Match](#backend) and
   [MASTERY_REWORK.md § "Games select by their own mark type"](./MASTERY_REWORK.md). Also pass `surface=<your-game>` so the server
   tops the player up to your baseline (`CARD_BASELINES` in `server/contracts/wire.ts`).
   **Do NOT block entry on `sufficient === false`** — after provisioning it can only be
   false when the dictionary itself is exhausted, and a short round still plays. Show
   `ProvisionalCardsNotice` before the round and `ProvisionalSortOffer` after it
   (drive the latter with `useProvisionalSortOffer(roundIsOver, lentWords)` and render
   it as a SIBLING of your `GameEndPopup`, so it stacks over the result). See
   [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md).
3. **Render definitions through `resolveDisplayDefinition`** — see
   [§ Sense correctness](#sense-correctness--every-game-must-honor-the-learners-selected-sense).
   This is the single easiest thing to get wrong in a new game.
4. Emit review marks with `POST /api/flashcards/mark` (`type` = the one track the
   game trains: `recognition` / `production` / `reading` / `writing`), and wins
   with `POST /api/users/me/wins` if the hub should show a win badge.
5. Add the route to `MINUTE_POINTS_ELIGIBLE_PAGES` (and the start-on-entry subset)
   in `src/constants.ts` so play time accrues points and streak.
6. Reuse `GameEndPopup` for the won/lost card so the minimize-to-puck behavior
   matches the other games.
7. Append the `GameDef` to `GAME_REGISTRY` in `src/games/registry.ts`:

   ```ts
   {
     gameId: "<gameId>",
     title: "...",
     route: "/games/<gameId>",
     requiresAuth: true,
     Component: React.lazy(() => import("./<gameId>/<GameId>Page")),
   }
   ```

Steps 1–6 are the game. Step 7 is all the wiring: the hub, router, and
mobile-demo frame configure themselves from the registry, so `GamesPage`, `App`,
and `Layout` need no edits.

### Removing a game — retire it from challenges FIRST

⚠️ Applies once the Study Challenge feature ships
([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md)); written here now because the constraint
belongs with the games registry, not with the feature that discovered it.

A Study Challenge draws three game ids **at issue time on Monday** and stores them in
`study_challenges.gameSequence`. The pair does not play them until **Friday**. So a game
deleted from `GAME_REGISTRY` mid-week leaves live challenges holding an id that no longer
resolves, and both players are stuck at a round that cannot start.

Deprecating a game is therefore a **two-phase retirement, at least one full week apart**:

1. **Disable it for challenges** — remove it from the challenge-eligible pool so no new
   `gameSequence` can contain it, while the game itself keeps working normally. Wait
   until every challenge issued before the change has closed (the test window shuts the
   following **Monday 04:00 local**, so one week plus a timezone margin is enough).
2. **Then remove the game** — delete the `GameDef`, the route and the page.

Doing these in one deploy breaks every in-flight challenge that drew the game. There is
deliberately **no runtime substitution** and no auto-voiding: silently swapping a round's
game after the players have prepared for a known sequence is worse than a scheduling
rule, and voiding would make an ordinary deploy a user-visible event that destroys
challenges people were mid-way through.

The same applies to a game becoming *ineligible* for challenges for any other reason
(losing its contested/filler scoring implementation, becoming single-player-only): phase
it out of the eligible pool first, let the week drain, then change it.

Renaming a `gameId` counts as removing one game and adding another. Don't.

## Files

- `src/components/MobileFooter.tsx` — footer tabs (Flashcards / Discover / Home / Account)
- `src/components/MobileDemoFrame.tsx` — shared phone-frame container
- `src/components/MobileDemoHeader.tsx` — shared header (back / title / active badge / extraActions); no hamburger
- `src/components/PageHeader.tsx` — base header (renamed `rightItems` → `rightContent`)
- `src/components/Layout.tsx` — wires `MobileDemoFrame` into demo routes; spreads `GAME_ROUTES` into `MOBILE_DEMO_PATHS`
- `src/games/GamesPage.tsx` — hub page; renders `GAME_REGISTRY`, wraps every link in `withCollectionParams`
- `src/games/GamesCollectionSelector.tsx` — hub-header "Playing with …" collection pill + menu
- `src/features/flashcards/selectedCollection.ts` — the session-only store behind that pill
- `src/App.tsx` — `/games` route + per-game routes from registry
- `src/games/registry.ts` — central `GAME_REGISTRY` + `GAME_ROUTES`
- `src/games/types.ts` — `GameDef`, `GameAsset`, `GameProgress`
- `src/games/runtime/GameEndPopup.tsx` — shared end-of-run popup shell (all four games)
- `src/games/runtime/gameSounds.ts` — shared game sound effects
- `src/games/runtime/useSidewaysStage.ts` — landscape-stage helper (Speed Reading)
- `src/routes/routeMeta.ts` — `GAME_ROUTE_META` derives one `chrome: "leaf"` row per registry entry
- *(deleted — do not look for these: `runtime/GameStage.tsx`, `runtime/GamePage.tsx`, `runtime/useGameActors.ts`, and the whole `src/games/hooks/` folder; see § Layer 2 / § Layer 3)*
- `src/utils/definitionUtils.ts` / `server/utils/definitions.ts` — the dd resolvers every game's definition text must go through
- `server/dal/implementations/GameAssetDAL.ts`, `GameProgressDAL.ts`
- `server/services/GameAssetService.ts`, `GameProgressService.ts`
- `server/controllers/GamesController.ts`
- `server/dal/setup.ts` — DI wiring
- `server/routes/gamesRoutes.ts` — route registration (games + night market + community + leaderboard)
- `server/routes/onDeckRoutes.ts` — `gamePool` / `wordSearchGrid` route registration (camelCase paths — project convention, see [BACKEND_LAYERING.md](./BACKEND_LAYERING.md))
- `server/scripts/seedGameAssets.js` — asset seed helper
- `database/migrations/52-create-game-tables.sql` — `gameassets` + `gameprogress`

## Game: Word Search (`/games/word-search`)

Second game (built). Find 20 of your own vocab words — shown as English glosses —
hidden as snaking (orthogonal) paths in a 12×16 grid of colored-pinyin (cpcd)
characters. Drag or tap to trace; any valid multi-char selection pops a
dictionary info-card + audio. Count-up timer → medal on completion. Reuses
Bubble Match's pool + fallback distribution, adds a substring de-dup pass and a
server-side snaking grid generator (`GET /api/onDeck/wordSearchGrid`). Full
spec + file map: → [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md).

## Game: Bubble Match (`/games/bubble-match`)

The first shipped game. A DOM + `requestAnimationFrame` game (absolutely-positioned
bubbles moved via `transform`) — chosen over Pixi for direct reuse of the
colored-pinyin `CPCDRow` (cpcd) and cheap circle-circle physics at ~50 bubbles. That
choice is why the speculative Pixi runtime was never adopted and has since been
deleted (§ Layer 2). It owns its page shell (`LeafPage` + its own flp-style header,
**no footer** — see Routes above).

### Gameplay

- A game uses the **full pool**: the `GAME_DISTRIBUTION` mix (`constants.ts`)
  of 2 Unfamiliar + 10 Target + 6 Comfortable + 2 Mastered library cards =
  **20 pairs (`TOTAL_PAIRS`) → 40 bubbles**. That mix is *preferred*, not strict —
  the server tops the pool up to 20 from the fallback buckets when one can't fill
  its quota. Each pair = one **word** bubble (cpcd) and one
  **definition** bubble (the flashcard's dd, via `resolveDisplayDefinition` — so a bubble
  shows the learner's chosen sense, matching the card face; see
  [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) form #3).
- Bubbles **spawn in place** on a per-level cadence — `planSpawn` (`physics.ts`)
  picks a spot by the "20% rule" and the bubble inflates there from a seed radius
  as an infinite-mass body, shoving the neighbors it overlaps aside. Once grown,
  a bubble **drifts**: a small random wander (`WANDER_ACCEL`) nudges it, its speed
  eases back toward `IDLE_SPEED`, and it reflects off the walls and off its
  neighbors with a mass-weighted elastic impulse (`RESTITUTION`). Every drift
  *magnitude* is scaled by the single `DRIFT_SCALE` knob in `constants.ts`,
  currently **0.3** — i.e. 30% of the original tuning, so the field reads as a slow
  shimmer rather than a lava lamp. Set it to `1` for the original float, or `0` for
  a fully static field. Growing and held bubbles do not drift (each owns its own
  position); a dropped bubble simply resumes the velocity it had when picked up —
  there is no throw-on-release. Drag a bubble onto its partner to match
  (bidirectional). Correct → green pop + removal; wrong → red shake + release.
  Picking up / dropping **onto** a Chinese word triggers autoplay TTS.
- **Post-loss cleanup** (`cleanupMode`, `BubbleStage.tsx`): after a loss, when the
  player minimizes the game-over popup to its corner puck (`phase === "lost" &&
  popupMinimized` in `BubbleMatchPage.tsx`), the packed field becomes a no-stakes
  playground. Bubbles stay **draggable and matchable** so the player can clear the
  board for satisfaction, but matches emit **no review marks** (`onMark` is
  suppressed while `cleanupMode` is on). While a bubble is held, its correct
  partner (if still on screen) lights up **light green** as a drop hint (the
  `revealed` status; replaces the old tap-to-reveal study interaction). If the
  grabbed bubble has **no** partner on the field (it was still queued when the run
  was lost, so it can never be cleared), the bubble itself is tinted **light red**
  (the `nomatch` status) for as long as it's held, instead of the usual grey held
  dim — a grab-time "no match" cue, not a persistent marker. Colors:
  `CORRECT_BUBBLE_BG` (light green) and `NOMATCH_BUBBLE_BG` (light red) in
  `constants.ts`; the vivid `WRONG_BUBBLE_BG` red stays reserved for the wrong-drop
  shake. The rAF loop, which
  self-stops on settle behind the full end popup, is **kept alive throughout
  cleanup** so bubbles keep separating/settling as they're dragged and cleared.
  Clearing the whole field triggers no win (the run is already decided). Autoplay
  TTS still fires on pickup / drop-onto a Chinese word.
- **Restart (header):** during active play the header's right slot shows a
  restart icon (`BubbleMatchHeaderControls.onRestart`, wired only while
  `phase === "playing"`) that re-runs the **same level with the same words**
  (reshuffled launch order) via `startLevel(level)`.
- **Replay (end popup) — one "Play Again", partial card refresh:** the won/lost
  card shows a single primary **Play Again** over a secondary **Back to Games**
  (`replayActions` in `BubbleMatchPage.tsx`). Play Again replays the **same level**
  on a **partially refreshed board**: every pair the player *matched during the
  run* is retired and replaced with a fresh card, while every pair they *failed to
  match* stays in the set, so a word keeps coming back until it's cleared. The page
  records cleared cards in `matchedIdsRef` from `markBubbleMatch(entry, true)` —
  post-loss cleanup drags don't count (`BubbleStage` suppresses `onMark` in
  `cleanupMode`) — and `beginRun` resets that set each run. A second ref,
  `clearedThisSessionRef`, accumulates every card cleared across ALL rounds while
  the page stays mounted (capped to the newest `MAX_AVOID_IDS` = 200) and acts as a
  client-side cooldown, so round 3 doesn't hand back what round 1 cleared. The
  refill hits `gamePool?...&need=N&exclude=<kept ids>&avoid=<cleared ids>`:
  **kept ids are a hard exclude** (returning one would duplicate a live bubble),
  **cleared ids are a soft avoid** (last-resort tier). Nothing matched
  (`need === 0`) replays with no round trip. If the
  library shrank mid-session the refill may come up short — a smaller board still
  plays (the stage sizes itself off the pool), below `MIN_REPLAY_PAIRS` (4) the page
  blocks instead.
  **Consequence:** leaving to the Games hub and re-entering always draws a wholly
  new random pool (the page remounts and refetches); staying in the popup is what
  preserves the unmatched words.
- **Levels do not chain** — the level is picked **on the Games hub** (one
  `HubMenuArrayItem` sub-card per `LEVEL_CONFIGS` entry) and arrives via
  `location.state.level`; there is no in-game picker any more, and a direct visit
  with no valid level redirects back to the hub rather than defaulting. The level
  sets difficulty only (launch cadence + ceiling-shrink speed); all levels use the
  full pool. **There is no clock** — `LevelConfig` carries no duration. Once the
  whole pool has launched, on the next launch-tick a **descending ceiling**
  (`boundsRef.top`, rising at the level's `shrinkSpeedPxPerSec`) starts closing
  in from the top, compressing the field. Win = clear all pairs. Lose = the field
  over-packs under the ceiling (area ≥ `LOSE_FILL_RATIO`, or sustained residual
  overlap) — the border glows red at ≥85% fill as a warning first. Tunables live
  in `constants.ts` (`LEVEL_CONFIGS`, `GAME_DISTRIBUTION`, `MIN_PLAY_HEIGHT`,
  sizes, physics).
- Minute-points: `/games/bubble-match` is in `MINUTE_POINTS_ELIGIBLE_PAGES`
  (`src/constants.ts`, alongside `/games/word-search`) and in the
  start-on-entry subset, so time accrues from mount rather than from the first
  tap; the header's `MinutePointsFireBadge` works as on flp.

### Files

- `src/games/bubble-match/` — `BubbleMatchPage.tsx` (flow: loading → (blocked) →
  playing → (won | lost) → playing (replay)), `BubbleStage.tsx` (restartable rAF loop, launcher,
  descending ceiling, drag/hover/match, post-loss cleanup mode, HUD, red glow),
  `Bubble.tsx` (one bubble; outer
  node carries the loop's transform, inner node carries CSS pop/shake),
  `physics.ts`, `BubbleMatchHeader.tsx` (right-slot controls: restart button +
  pinyin/autoplay toggles + fire badge), `BubbleMatchEndPopup.tsx` (won/lost card
  + minimize-to-corner puck), `constants.ts`, `types.ts`.
- `src/games/registry.ts` — registers the game (`requiresAuth: true`).

### Backend

Reuses the OnDeck vocab stack (no new tables). Endpoints registered in
`server/routes/onDeckRoutes.ts`:

- `GET /api/onDeck/gamePool?Target=15&Comfortable=10` →
  `{ cards, requested, available, total, needed, sufficient }`. `OnDeckVocabService.getGameVocabPool`
  pulls library cards per category (same RANDOM ordering + `definition` source as
  the working loop), enriches + pre-warms TTS, and reports availability so the
  client can block entry when the user lacks enough words.
  **Category buckets are per mark type**: each game passes the single mark type it
  emits (Bubble Match `recognition`; Word Search `reading`/`production` by mode) and
  candidates are bucketed by that track's own recent mark history
  (`compute_type_category`), not by the whole-card **core** mastery bar the flp
  and decks page use — so each game's difficulty distribution reflects the skill it
  actually trains. That same per-type category also selects the card's cooldown
  window. See [MASTERY_REWORK.md § "Games select by their own mark type"](./MASTERY_REWORK.md).
  **Each returned card carries `gameCategory`** — the bucket it was actually drawn
  from (`fetchGameCandidates` stamps it as it partitions rows). It is NOT the same
  field as the card's `category`, which is the **core** mastery bar's band; both
  ride on the entry and mean different things, hence the explicit name. The stamp
  reports the queue *drained*, so it stays truthful when a short bucket is topped up
  from the fallback order. Match Speed sorts its per-category client-side card
  buffer by it (see [MATCH_SPEED_GAME.md](./MATCH_SPEED_GAME.md) § Backend change);
  Bubble Match and Word Search ignore it, so the field is purely additive.
  **Partial refill** (`&need=N&exclude=12,34&avoid=56,78`, added for Bubble Match's
  single "Play Again"): returns only `N` cards. The per-bucket quotas are scaled by
  `need / total` so a partial board keeps the same difficulty mix as a full one
  (need=10 of a 2/10/6/2 board → 1/5/3/1), `requested` echoes the scaled quotas,
  `total` stays the full board size, and `needed` / `sufficient` are both relative
  to `need`. All three params are optional; omitting them is the original
  full-board behavior.

  **Three fill tiers** (`getGameVocabPool`), drained in order until `need` is met:

  | Tier | Contents | Drained |
  |---|---|---|
  | 1. fresh | game mark type off cooldown | requested buckets, then fallback order |
  | 2. cooled | on the per-type cooldown | requested buckets, then fallback order |
  | 3. avoided | ids passed as `avoid` (just cleared) | requested buckets, then fallback order |

  `exclude` is enforced in SQL (`fetchGameCandidates`'s `excludeIds`) and is
  absolute; `avoid` is a *tier demotion*, so a library too small to fill the board
  any other way still assembles one rather than starving.
  ⚠️ The avoided tier must be its own tier, **not** the tail of the matching
  category's cooled queue: every fill loop walks category-by-category, so a demoted
  Unfamiliar card parked in the Unfamiliar cooled queue is still drawn ahead of
  every Mastered cooled card — which is exactly how the first cut of this feature
  handed back the cards the player had just cleared.
- `GET /api/onDeck/categoryCounts` → `{ Unfamiliar, Target, Comfortable, Mastered }`,
  also surfaced under each bucket label on the decks page.
