# Games Feature

A top-level section of the mobile demo where users access mini-games that
reinforce vocabulary and character learning. The hub page lists all registered
games; each game lives as its own page linked from the hub.

## Status

- **Study Challenge rounds — live since 2026-08-22.** Four of the six games
  (Bubble Match, Match Speed, Hydra Bubbles, Word Search-Pinyin) can be drawn as a
  scored round of a weekly head-to-head. The contract they must honour is
  [§ Challenge-eligible games](#challenge-eligible-games-the-challengescoring-contract);
  the feature is [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md).
- Hub page (`/games`) — shipped. Renders `GAME_REGISTRY` through the shared
  `HubMenu`; the empty state is now only a fallback for when every game is gated
  out (public/demo accounts).
- Games — **six shipped**, all registered in `src/games/registry.ts`:
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
  - **Hydra Bubbles** (`/games/hydra-bubbles`) — see
    [§ Game: Hydra Bubbles](#game-hydra-bubbles-gameshydra-bubbles) and
    [HYDRA_BUBBLES.md](./HYDRA_BUBBLES.md). An **endless, clockless** recognition
    drill on Bubble Match's bubbles, with the opposite pressure model: clearing a
    pair spawns 1 or 3 new bubbles depending on the cleared word's payout **tier**,
    so the board grows on its own and the only way to hold it back is to take on the
    words you know least well. One wrong match ends the run.

  Bubble Match and Word Search are **DOM + `requestAnimationFrame`** games; Match
  Speed and Speed Reading are **DOM + timers only** (no rAF loop — no physics and no
  per-frame animation, just CSS transitions and intervals). **There is no Pixi game
  runtime any more** — the never-used `GameStage` / `GamePage` / `useGameActors`
  scaffolding was deleted (commit `70dc441`); see
  [§ Layer 2](#layer-2--runtime-srcgamesruntime).

- **Memory Map** (`/games/memory-map`) — see [MEMORY_MAP_GAME.md](./MEMORY_MAP_GAME.md).
  **BUILT ON DEV (migration 151), not on prod.** A persistent, pan/zoom **reading** map:
  every card the learner sorted that is **not reading-mastered** owns a permanent spot
  (capped at 100, chosen by the flp offering priority list evaluated on the reading
  track), new words spawn touching an existing island (10% start a new one), and an
  English gloss at the top must be found and tapped within three tries. No winning or
  losing — the outputs are one reading mark per word and a green/orange/red colour.
  It is DOM + a CSS transform like the rest; the 100-word cap is what keeps it there.

### What Memory Map introduced

Memory Map is the first game that is not disposable — its map outlives every run — and
almost everything below follows from that one difference:

- **Durable per-game server state.** The first game with tables of its own:
  `memory_map_placements_zh` / `memory_map_placements_es` (migration 151). Split per
  language to mirror the vet split, which is what buys a real
  `REFERENCES vocabentries_*(id) ON DELETE CASCADE` — so an orphaned placement cannot
  exist and the feature needs no sweep. Word Search's board, by contrast, is
  localStorage only, because a board is disposable and a map is not.
- **Selection on `vetSortedClause()` instead of `vetPlayableClause()`.** Every other
  game pool is PLAYABLE — a lent provisional card is fine for one round. Memory Map's
  selection creates a durable artifact, so a borrowed word must not homestead a
  permanent spot. This is the only game that draws from the sorted deck alone.
- **A shared, track-parameterized queue ranking.** `rankFlpEligible`'s logic moved out
  of `OnDeckVocabService` into `server/services/cardQueueRanking.ts`, a pure module
  parameterized on which mark types count as ready and which utcm category supplies the
  cooldown window. The flp's behaviour is unchanged; Memory Map ranks the same way on
  the **reading** track. Any future game wanting "longest-waiting first, never-marked
  last" on its own track should use this rather than copy it.
- **A game that declares NO card baseline.** No entry in `CARD_BASELINES`, no
  provisional top-up. Nothing blocks on card count because nothing can — a small library
  is simply a small map, and an empty one gets an empty state pointing at Discover.
- **A game that opts out of the collection selector.** The hub HIDES the Memory Map row
  whenever the selected collection is anything but All Cards, rather than showing a row
  that would silently ignore it. Same hide-don't-block principle as the language gate.
- **A game that deliberately skips pause-on-background.** No `useBackgroundPause`, no
  `GamePausedOverlay`. That rule exists to stop a CLOCK draining while backgrounded;
  this game has no clock, so the overlay would protect nothing. Recorded so it is not
  later "fixed" by an audit against the framework checklist.
- **A second pan/zoom surface** after the night market — and the first built as plain
  DOM + a CSS transform rather than Pixi. The 100-word cap
  (`MEMORY_MAP_CAPACITY`) is what makes that safe: at that size there is nothing to cull.

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
  **reading**. Bubble Match's call site passes the track it locked for the run
  (`buildPoolQuery(lockRunTrack())` — recognition, or reading with pinyin off; see
  § "Bubble Match: pinyin picks the track"), so no caller relies on the default.
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

| Path     | Component   | Footer tab | Notes                          |
| -------- | ----------- | ---------- | ------------------------------ |
| `/games` | `GamesPage` | Home       | Hub / menu; **node page** (left arrow → `/`, keeps footer, slides in-from-right). The tab is resolved from the route by `FooterPresenter`; pages no longer declare it. |

Each individual game gets its own route under `/games/<slug>`.

The slug is also a **server-side whitelist**: `KNOWN_GAME_IDS` (`server/constants.ts`)
mirrors the client `GAME_REGISTRY`, and `/api/games/:gameId/progress` 404s on anything
else. `gameprogress` is keyed `(userId, gameId)` and the segment arrives raw, so
without the list a caller mints unbounded save rows on their own account by varying
the slug. Adding a game means adding its slug there — the 404 is the reminder.

**Bubble Match is a leaf page (no footer).** `BubbleMatchPage` is wrapped in
`LeafPage` (see [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)): the down-arrow back
button (→ `/games`) is the only way out, there is **no** footer on any of its
screens (loading / blocked / stage — the level is picked on the hub, so there is
no in-game picker screen), and the page slides up on enter / down on exit. The pinyin + autoplay toggles live in
the header's right slot via `BubbleMatchHeaderControls`; the fire badge sits to their
right and is rendered by `PageHeader` for every page, not passed by the game. The
autoplay chip edits the **app-wide** narration autoplay flag, not a game pref — the
same control appears in every other narrating surface's header
([AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md)).

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
opens a menu of every set the fdp offers — *Collections* (All Cards, Learn Now and
Mastered Cards), *Mastered* (the per-skill bars), and the learner's *Decks*
(`fetchDecks`).

⚠️ **All Cards has a row here but no tile on the fdp**, which now renders those cards
inline instead. The entry stays in the shared list precisely so this selector keeps
offering it; only the fdp filters it out. See
[DECKS_FEATURE.md § "Which collections exist"](./DECKS_FEATURE.md).

**The fdp is the source of truth for that list.** The built-in rows come from
`builtinCollectionEntries` (`src/features/flashcards/builtinCollections.ts`), the same
function the fdp renders as tiles, so the two surfaces cannot drift on which
collections exist, their order, their grouping or their colors — including the rule
that core *Mastered Cards* is always a *Collections* row while the *Mastered* group
holds the per-skill bars alone and appears only when a reading or writing goal is set.
This component decides only how a
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
[BENTO_SYSTEM.md](./BENTO_SYSTEM.md)). This makes the hub feel like a clean
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
| Row anatomy | Owned by the shared `HubMenu` / `HubMenuRow`, not by this page. See [BENTO_SYSTEM.md](./BENTO_SYSTEM.md). |
| Locking / progression | Two gates on `GameDef`, both evaluated at hub render time: `requiresAuth` (hides the game from public/demo accounts) and `unlock.minVocabEntries` (declared but unused). **No game may block on card count** — see [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md): each game's old minimum is now a BASELINE the server tops the player up to with temporary cards. The only remaining entry conditions are being signed out and Word Search's zh-only restriction. No game is gated behind another game. |
| Score / streak surfacing | Games feed the **existing** systems, not a parallel one. Both game routes are in `MINUTE_POINTS_ELIGIBLE_PAGES` (`src/constants.ts`) and are in the start-on-entry subset (a player reads the board before their first tap), so play time accrues minute points and streak exactly as flp does. Matches emit real review marks via `POST /api/flashcards/mark` — so playing a game moves mastery. Wins are counted separately via `POST /api/users/me/wins` and read back by `useGameWins` for the hub's `HubMenuStatBadge`. |
| Sort order of the menu | Manual curation — `GAME_REGISTRY` array order, top to bottom. Not recency or recommendation-ranked. |

## Mobile demo frame (shared sizing)

All mobile-demo routes (the ones listed in `MOBILE_DEMO_PATHS` in
`src/components/Layout.tsx`) share **one** phone-frame container:
`src/components/MobileDemoFrame.tsx`. `Layout.tsx` wraps the route's children
with it automatically — on mobile it renders full-bleed, on desktop it renders
as a centered 402x874 rounded card (44px radius). There is no sidebar/hamburger chrome
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
  Defines the row: optional back chevron grouped with the title (`arrowDirection`
  "down" | "left", which also selects the title `size`) · `rightContent` (a single
  flush-right ReactNode slot). It is **not a bar** — no background, no border, no
  fixed height. It also exports the slot primitives `HeaderMetaLabel` /
  `HeaderIconButton` / `HeaderToggleChip`; see
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) § The `rightContent` slot.
- **`MobileDemoHeader`** (`src/components/MobileDemoHeader.tsx`) — composes
  `PageHeader`, adds `showBack` for drill-ins, an `arrowDirection` pass-through, and
  an `extraActions` slot rendered flush-right (e.g. the settings gear on Account).
  The active-tab identity badge it used to draw in the left slot was removed by the
  shelf redesign's A2b.
- **`LeafPageHeader` / `NodePageHeader`** (`src/components/`) — thin
  specializations preset to `arrowDirection` "down" / "left" + `showBack`. Used
  by the `LeafPage` / `NodePage` wrappers. See
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).

Rules of thumb:

- Footer-tab hubs (Flashcards/Decks, Discover, Home, Account) → use
  `MobileDemoHeader` inside `MobileTabScreen`; pass `title` and optional
  `headerExtraActions`. (There is no `activePage` any more — A2b removed the
  header's tab badge, its only reader.)
- Back-arrow drill-ins → use the `LeafPage` (down arrow, no footer) or `NodePage`
  (left arrow, keeps footer) wrapper instead of composing the header by hand.
  Games + Mastered Cards are node pages; Sort Cards, Dictionary, and Card Detail
  are leaf pages.
- Specialty in-page headers (`FlashcardsLearnHeader` with fire icon + seconds
  counter) → compose `PageHeader` directly and own their own `rightContent`. Build
  that `rightContent` from `HeaderToggleChip` / `HeaderIconButton` — the three game
  and flp headers each used to carry a byte-identical private `toggleSx` helper, and
  that is exactly what those exports exist to prevent.

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

All live. The folder is a **grab-bag of shared game bits**, not a framework — no game
inherits a shell from it.

- **`GameEndPopup.tsx`** — the shared end-of-run popup **shell**: presentational
  layer owning the scrim, the card chrome (× button), the corner puck, and the
  FLIP-style collapse animation between them. The **page** owns the `minimized`
  flag and the card's content (title / message / actions), passed as `children`;
  `classPrefix` keeps each game's BEM classes distinct. Word Search and Speed
  Reading render it directly; Bubble Match wraps it in `BubbleMatchEndPopup` to pin
  `classPrefix="bubble-match"`, and Match Speed wraps it the same way.
  **Minimizing is opt-in**: pass `onMinimize`/`onRestore` and the × button and the
  corner puck appear; omit them (as **Speed Reading** does) and neither is rendered,
  so the popup is modal and its own buttons are the only exits. The rule is
  "minimizable iff the board is still worth uncovering" — Bubble Match, Match Speed
  and Word Search all have a post-run cleanup mode, Speed Reading has none.
- **`gameSounds.ts`** — shared sound effects for game events.
- **`useBackgroundPause.ts` + `GamePausedOverlay.tsx`** — the app-wide
  backgrounding pause and its tap-to-resume overlay (§ Backgrounding pauses the clock).
- **The Study Challenge round runner** — four files, and the largest thing in here:
  - **`challengeScoring.ts`** — the pure, React-free spec runner (events → score +
    itemised breakdown). Written so the server can adopt it verbatim for live mode.
  - **`useChallengeRound.ts`** — what a game page actually mounts. Owns the round's
    scorer, its ACTIVE-TIME clock, the contested word set, the pool params and the
    round POST. Inert for an ordinary launch, which is why no game needed an
    `if (challenge)` branch (§ Challenge-eligible games).
  - **`ChallengeRoundScoreboard.tsx`** — the between-games card, rendered in place of a
    game's own end-of-run popup during a challenge round.
  - **`challengeLaunch.ts`** — gameId → route + the nav state that page requires, plus
    the round's query params. The one place that knows Bubble Match needs a level and
    Word Search needs a mode.
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

### Layer 2b — Shared surface chrome (`src/games/shared/`)

**`GameFrame.tsx`** — the visual frame every game plays inside
([SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A6, classes `.play` / `.hud` / `.timer`).
Presentational only; nothing here holds state.

- **`GameFrame`** (`.play`) — the inset white rounded panel between the leaf header and
  the page edge. It exists so the board's boundary is not the phone's: a bubble drifting
  to the edge used to look like it had left the app. It is also `position: relative`, so a
  game's own overlays (a countdown, a pause veil) stop at the panel's rounded edge instead
  of covering its margin, and it gives a physics surface **one** element to measure for
  bounds.
- **`GameHud`** (`.hud`) + **`GameHudLabel`** (`.hud .lab`) — the bordered strip of mono
  facts across the panel's top. `space-between`, so the child count is load-bearing: two
  children pin to the edges, three put one in the middle — and so is the ORDER: only a
  middle child can appear and disappear without moving anything else, which is where a
  toggleable fact belongs (Word Search's clock). `divider={false}` suppresses the hairline
  for a HUD sitting directly under a `GameTimer`, which already draws one.
- **`GameHudBar`** — the HUD's optional third slot, `flex: 1`. It always restates a number
  a label beside it already gives; that is the point. The count is what you read when you
  look at the strip, the bar is what you see when you do not. Bubble Match points it at
  pairs cleared, Hydra at the field's fill ratio.
- **`GameHint`** — the one-line instruction at the panel's FOOT ("tap a word, then its
  meaning"). Deliberately a `.lab`: mono, uppercase, faint. A rule you need on your first
  run and never read again should be legible on request and invisible the rest of the
  time — as body text the panel would look like it was explaining itself every round.
- **`GameTimer`** (`.timer` + `.trk`) — 28px tabular numerals over a 4px drain track.
  Takes an **already-formatted** `value`; the frame does no clock math. Its `pulse` prop is
  a deliberate departure from the design, which draws no pulse — a colour change plus a
  nearly-drained track is easy to miss in peripheral vision, which is exactly where a clock
  is read mid-game.

- **`GameCentered`** — the centred column a game shows INSTEAD of its board (the queue
  spinner, the "no cards are playable" message and its way out). Extracted from four
  byte-identical `renderCentered` helpers that differed only in their class name. It also
  owns the accent-ground ink rule below, which is why a message inside it must NOT set
  its own `color`.

**`gameSurface.ts` + `GameSurface.tsx`** — the per-game accent surface
([SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A6b, the design's `#bm{background:var(--redA)}`
blocks). A game screen is flooded with ONE saturated hue; the play panel sits on it as a
white island; the header's ink flips to white. 60% accent ground, 30% white panel, 10% the
hue's near-white tint on the HUD strip.

| Export | What it is |
| --- | --- |
| `GAME_HUE` (in each game's own `constants.ts`) | The game's hue. `GAME_REGISTRY` reads it for the hub row and the page passes it to `GameLeafPage`, so the row's colour and the screen's ground cannot drift apart. |
| `GameLeafPage` | `LeafPage` + the ground + the header flips + the context, from one `hue` prop. **Every game page uses this instead of `LeafPage`.** |
| `GameSurfaceProvider` / `useGameSurfaceHue()` | The context. Null when there is no provider, which is what keeps `GameFrame` usable off an accent ground and mountable bare in a test. |
| `gameSurfaceSx(hue)` | The ground colour plus the descendant rules it forces (title, chevron, right-slot icons, `HeaderMetaLabel`, the streak badge, both toggle-chip states). |
| `ON_ACCENT_INK` / `ON_ACCENT_LINE` | White, and a 50% white hairline. Anything drawn straight onto the ground needs the first; `COLORS.rowBorder` is an ink alpha and vanishes on a 52%-lightness ground, hence the second. |

**Which hue a game gets is `GameDef.hue`, NOT the artboard's.** The artboards paint Match
Speed blue, Speed Reading yellow and Hydra green; the shipped hub rows call those three
green, blue and teal. The hub mapping wins — a green hub row must not open a blue screen —
and the artboard's yellow is not in the app's ramp at all. Bubble Match (red) and Word
Search (purple) agree either way.

**The header flips are CSS descendant selectors, the panel's are not.** The header route
avoids threading an `onAccent` flag through `LeafPage` → `PageHeader` →
`HeaderIconButton`/`HeaderToggleChip`/`MinutePointsFireBadge`, and it is the design's own
mechanism (`#bm .lhd h1{color:#fff}`). `GameHud`/`GameTimer`/`GameFrame` read the context
instead, because a HUD label's colour is overridable per call site (a lives counter turning
red) and a blanket descendant rule would silently clobber it. One detail worth keeping: the
chip outline is an inset `box-shadow`, not a `border` — a border would add 2px per chip, and
the leaf header is already tight enough that "Hydra Bubbles" ellipsises.

**What the frame does NOT discharge:** `useBlockEdgeSwipe(true)` and `touchAction: "none"`
stay the page's job. The edge-swipe block is a document-level touch handler with a
lifecycle, and hiding it inside a layout wrapper would make "why can I still swipe out of
this game" invisible to whoever reads the page.

**Every popup stays OUTSIDE the frame** — `GameEndPopup`, `ProvisionalSortOffer`,
`GamePausedOverlay`, `HydraLendNotice`. Each covers the whole content area and must not be
clipped by the panel's radius.

All six games are framed, and four of them (Bubble Match, Word Search, Match Speed, Hydra
Bubbles) now use `GameHud` for their strip as well — see entries 12–16 of
[SHELF_REDESIGN.md](./SHELF_REDESIGN.md). Bubble Match's and Hydra's HUDs used to be
absolutely-positioned overlays INSIDE their stages, at `top: 8`, so bubbles drifted under
the text and each field's measured bounds were larger than the area a bubble could
actually be read in; both stages now return a fragment — HUD row, then measured field.
Match Speed's `MatchSpeedTimerBar` delegates to `GameTimer` and keeps only
`RUN_DURATION_MS`, its 10-second urgency threshold and its colours — whose resting track
is now `RAMP[GAME_HUE].ink`, since the clock sits on a strip tinted with that same hue.

Speed Reading has a `GameHud` as of the A6b pass: a round counter over
`SpeedReadingRoundTicks`. Its HUD is the one that is a COLUMN rather than a row of facts
(`GameHud`'s `sx` escape hatch), and it is a SIBLING of a new `.speed-reading__board` box
rather than a child — the tap zones are `inset: 0` of their container, so anything sharing
that container is under them and every tap on it would answer the round.

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

### No two cards may share a dd in one round

**The rule:** no game may show two different vet entries whose **dd** resolves to
the same string at the same time.

Distinct entries collide on dd routinely — 高兴 and 开心 both read "happy", every
measure word reads "measure word", and a learner's `selectedSense` picks can push two
unrelated words onto the same gloss. On a flashcard that is harmless (one card at a
time). In a game every card is on screen at once, so a prompt naming that gloss has
two answers that look correct and only one that scores. It reads as the game being
broken, not as a hard puzzle.

**Where it is enforced — three server-side chokepoints, not the clients.** Every
game's round is assembled on the server, so the guard lives where the cards are
chosen rather than in each game's rendering code:

| Chokepoint | Covers | Symbol |
| --- | --- | --- |
| Game pool | Bubble Match, Match Speed, Speed Reading, Hydra Bubbles | `OnDeckVocabService.getGameVocabPool` → `takenDds` inside `drain` |
| Word Search grid | Word Search | `OnDeckVocabService.getWordSearchGrid` → `takenDds` inside `drain` |
| Memory Map spawn | Memory Map | `MemoryMapService.spawnInto` → `takenDds` |

The comparison key is `ddCollisionKey` (`server/utils/definitions.ts`), which
resolves the dd exactly as the card will show it (through `resolveDisplayDefinition`,
so the learner's sense pick is honored — see the section above) and then normalizes
case, collapsed whitespace and a trailing period. The normalization is **visual, not
semantic**: "Happy" and "happy" collide because a player sees a duplicate; "happy"
and "glad" do not, because those are two answers a player can tell apart, and merging
near-synonyms would thin the pool for nothing. An **empty key never collides** — a
gloss-less card has nothing to be confused with.

Three consequences worth knowing:

- **A colliding candidate is dropped, never deferred.** A key is held for the whole
  round, so a card that collides now could not become admissible later. The round
  simply comes back one card shorter if the library cannot fill it — the same
  best-effort contract every fill tier already has. This is one more way a
  `strictBuckets` caller (Hydra) can come back short (§ 6.2d of
  [HYDRA_BUBBLES.md](./HYDRA_BUBBLES.md)).
- **Partial refills are seeded from the cards already on screen.** A refilling caller
  already sends `exclude` = every card on the board or in its buffer; the pool looks
  up those cards' dds (`OnDeckVocabService.fetchDdKeys`) and seeds `takenDds` with
  them, so a replacement cannot collide with a bubble the player is looking at. No
  client change was needed for this, and none should be added — `exclude` is the
  wire contract, dd resolution is the server's job.
- **Word Search releases a key on eviction.** Its substring de-dup loop drops words
  back out of the selection, and a dropped word's dd has to become available again or
  the replacement pass would be reserving a gloss nothing is showing.

**Memory Map is the strict case.** A placement is durable, so a collision admitted
once sits on the map for as long as the word does. Its guard seeds from the words
already placed and runs on the graduation refill path too (where `existing` is the
whole map and `slots` is 1). The filter is applied **before** the `slots` cut, so a
collision costs the map nothing — the next non-colliding candidate takes the spot.

**Near-identical glosses** — "a little" vs "a bit" — are NOT covered by this rule; the
key is exact equality. The unbuilt phase-2 design that would extend it (offline NLI
pipeline → one `meaningGroupId` per gloss, swapped in as the key of the same three sets) is
[GLOSS_CONFUSABILITY.md](./GLOSS_CONFUSABILITY.md).

**Adding a new game:** if it draws from `/api/onDeck/gamePool` it is already covered.
If it composes a round from another source (a Study Challenge word set riding a
game's slots, say), it must apply the same key — and a client-side composer needs a
`ddCollisionKey` twin in `src/utils/definitionUtils.ts` that normalizes identically.

### Popups pause the clock

**The rule:** no game's clock — or whatever else in that game advances on its own
and can end a run — may run while a **modal, input-blocking popup** covers the
board. Reading a popup is not playing, so it must not be billed to the player.

Each page derives one boolean, `clockPaused`, from its own popup state and feeds
it to whatever moves on its own:

| Game | `clockPaused` is true while | What freezes | Code |
| --- | --- | --- | --- |
| Match Speed | the provisional notice is open | the 3·2·1 countdown **and** the 30 s run clock | `MatchSpeedPage.tsx` (`clockPaused`, the countdown effect, the run-clock effect) |
| Word Search | the provisional notice or the settings sheet is open | the count-up clock, via the existing `pauseTimer`/`resumeTimer` pair | `WordSearchPage.tsx` (`clockPaused`, `clockPausedRef`, the pause effect) |
| Speed Reading | the provisional notice is open | the count-up clock — `startAtRef` is pushed forward by the paused span on resume | `SpeedReadingPage.tsx` (`clockPaused`, `pausedAtRef`, the clock effect) |
| Bubble Match | the provisional notice is open | the bubble launcher, the descending ceiling and the overfill loss check | `BubbleMatchPage.tsx` (`clockPaused`) → `BubbleStage.tsx` (`paused`, `pausedRef`, `stepFrame`, the launch interval) |

Three consequences worth keeping in mind when adding a popup or a game:

- **Only input-blocking overlays qualify.** `ProvisionalCardsNotice` and Word
  Search's settings sheet take the whole screen, so a frozen clock cannot be used to
  study a live board. Word Search's in-grid gloss popups are deliberately
  **excluded**: they are small anchored tooltips that leave the board playable, so
  pausing on them would hand the player a free stopwatch stop. Match Speed lost its
  settings-sheet pause source on 2026-08-28 when that sheet was deleted — its
  replacements are header chips, which leave the board playable and correctly do
  **not** pause ([AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md)).
- **End-of-run popups are irrelevant.** The end popup and `ProvisionalSortOffer`
  only ever open once the run is scored and the clock has already stopped.
- **Resume must not pay the pause back.** A count-down clock re-arms from the time
  *remaining* (Match Speed keeps `remainingMs` in a ref for exactly this); a
  count-up clock moves its origin forward (Speed Reading) or uses an explicit
  pause/resume pair (Word Search); the rAF field re-bases its frame clock every
  paused frame so the whole span doesn't arrive as one giant `dt` (Bubble Match).

Also note Word Search's pause has **two** sources — the popup gate and the
backgrounding (`visibilitychange`) pause described in the next section. Returning
to the foreground checks `clockPausedRef` before resuming, so a tab switch cannot
restart a clock a popup is still holding. **Two sources composing into one
`clockPaused` boolean is the pattern**; the next section generalises it.

### Backgrounding pauses the clock — everywhere, unconditionally

**The rule:** the same things that freeze behind a popup must freeze when the app
is **backgrounded** — tab hidden, app switched away, screen locked. Leaving is not
playing, so it must not be billed to the player either. A player who comes back
must find the round exactly as they left it.

This is the same mechanism as the section above with a **second source** feeding
the same `clockPaused` boolean. It is not new machinery.

**The rule protects a CLOCK, so a genuinely clockless game is exempt.** Hydra Bubbles
opts out (docs/HYDRA_BUBBLES.md § 7.1c): it has no timer, its bubbles do not drift,
and nothing on its board advances except in response to a match, so a returning player
finds the run exactly as they left it without any pause machinery — and a
tap-to-resume overlay would be friction over a board that never moved. A game
qualifies for this exemption only if **nothing** advances unattended; if any part of
it is timed (Hydra's own challenge variant is scored on time to clear) the rule applies
in full to that part.

**Status of the four shipped games — ✅ ALL FOUR PAUSE (completed 2026-08-17):**

| Game | How |
| --- | --- |
| Word Search | its own earlier implementation — `WordSearchPage.tsx` listens for `visibilitychange`, calls `persistSnapshot()` then `pauseTimer()`, and resumes only if `clockPausedRef.current` is false. **This is what the rule was generalised from**, and it is deliberately left as-is (its localStorage snapshot is entangled with its pause path) |
| Bubble Match | `useBackgroundPause(phase === "playing")` → the existing `clockPaused` → `BubbleStage`'s `paused` prop |
| Match Speed | `useBackgroundPause(countdown \|\| playing)` → the existing `clockPaused` (countdown + 30 s run clock) |
| Speed Reading | `useBackgroundPause(phase === "playing")` → the existing `clockPaused` (`pausedAtRef`, the clock effect) |
| Hydra Bubbles | **challenge rounds only** (2026-08-22): `useBackgroundPause(playing && isChallengeLaunch)` → `framePaused` → the stage, plus `GamePausedOverlay`. Free play stays exempt — see the clockless-exemption paragraph above, and note that this is exactly the case it named |

The three that needed it got a **signal wired to a gate they already had**, not a new
pause implementation — which is what the 2026-08-16 audit predicted. Hydra's later,
partial adoption is the exemption working as written rather than an exception to it: the
same game is exempt free-play and covered in its timed variant.

**The two shared pieces** (`src/games/runtime/`):

* **`useBackgroundPause(active)`** — latches on `visibilitychange` *and* `pagehide`
  (neither is sufficient alone: `pagehide` is the one iOS Safari fires on swipe-away and
  screen lock). It **stays paused after the player returns**; only `resume()` clears it.
  That is the § 5.8 requirement — dropping somebody back into a live timer they have not
  looked at yet is the same as not pausing for that first second. `active` should be the
  game's playing condition, so returning to a finished board shows no prompt.
* **`<GamePausedOverlay>`** — the tap-to-resume affordance. It **covers** the board
  rather than dimming it, so the pause cannot be used as a free look at the arrangement;
  that is what lets the rule stay absolute with no per-mode exception. Rendered as a
  SIBLING of the board (like `GameEndPopup`) at **z-index 150 — below** MinimizablePopup's
  200, so a notice that also pauses the clock stacks above it.

⚠️ **The pause is only real if elapsed time is ACCUMULATED ACTIVE TIME.** A game that
computes elapsed as `now − startedAt` will honour the hook visually and still bill the
player for the time they were away — worse than no pause, because it looks correct.

Two requirements that are easy to miss:

- **Elapsed time must be accumulated active time, never `now − startedAt`.** A
  game that derives elapsed from a start timestamp has a *cosmetic* pause: the
  display freezes and the score does not. Word Search's `pauseTimer`/`resumeTimer`
  pair and Speed Reading's "push `startAtRef` forward by the paused span" are both
  correct forms of this; copy one.
- **Snapshot before pausing if the game has a save.** `visibilitychange` may be the
  last event a backgrounded tab ever fires, so Word Search persists *first* and
  pauses second. A pause that is never resumed must still leave recoverable state.

**There is no exception to this rule — not even live Study Challenge.** An earlier
draft of the challenge design carved live mode out, on the grounds that pausing
would let one player freeze the other's game. It does not: live mode runs an
**unpausable AFK forfeit timer** alongside the paused game (next section), so
pausing never benefits the player who does it. Keeping the rule absolute means no
game needs a live-mode branch in its timer code.

### Challenge-eligible games: the `challengeScoring` contract

✅ **LIVE since 2026-08-22** — Study Challenge phase 1 is built, so this is a rule in
force, not a rule in waiting. It lives here because it is a **registry contract**, not a
feature detail.

A Study Challenge round is an ordinary run of an ordinary game over a board that
mixes **contested** words (the challenge's nine) with **filler** (everything else
the board needed). The two score differently. A game that wants to be
challenge-eligible must declare how.

**A game is challenge-eligible iff both hold:**

1. its `markType` is `recognition` or `production` — or, for a moded game, *that
   mode's* `markType` is; and
2. it declares a `challengeScoring` spec.

> ✅ **BUILT 2026-08-17, with one deviation worth knowing about.** The specs physically
> live in **`server/contracts/wire.ts` as `CHALLENGE_GAMES`**, not in this registry,
> because the SERVER draws each challenge's game sequence (at issue time) and cannot load
> `src/games/registry.ts` — it imports lazy React components — and because live mode must
> score the same events server-side with no game page mounted.
>
> Eligibility is still **derived from the registry**, and the thing that guarantees it is
> `src/games/__tests__/challengePool.test.ts`: adding a recognition/production game
> without a `CHALLENGE_GAMES` entry is a RED TEST rather than a game that is quietly
> never drawn. `GameDef.challengeScoring` remains the per-game declaration point and is
> populated by `challengeScoringFor(gameId, mode)`.
>
> The runner that applies a spec to events is **`src/games/runtime/challengeScoring.ts`**
> — pure, React-free, 15 unit tests against the real specs, and written so the server can
> adopt it verbatim for live mode.

Eligibility is **derived from the registry, never hand-listed**, so a new
recognition/production game joins the rotation the day it ships. That is why the
spec is mandatory for those tracks rather than opt-in.

> **A moded game is eligible per-mode, not per-game.** Word Search qualifies as
> *Pinyin* (production) and not as *No Pinyin* (reading), so a challenge's stored
> game sequence must identify a `(gameId, mode)` pair for such games — a bare
> `gameId` is ambiguous and would let a challenge draw the ineligible mode.

**The spec is declarative data, not a callback.** Each game declares point values
and the shared runner applies them to the events the game emits:

- contested hit / miss, filler hit / miss, and whatever per-game bonuses exist
  (Bubble Match's ±500 survival bonus, Word Search's per-second penalty);
- the game emits *events*; the spec turns events into a score.

Why data and not a function: **live mode must be able to score the same events
server-side, with no game page mounted.** A callback is code the server cannot
reuse; a spec is a table of numbers it can. This is the single constraint that
decides the shape, and it is easy to violate accidentally by "just" exporting a
scoring function.

Three rules the spec must respect:

- **Contested/filler is fixed when the board is generated** and never re-read
  afterwards. Mastery bands move *during* a round (a challenge round writes real
  marks), so scoring that consulted a band would be non-deterministic. Nothing in
  the spec may depend on mastery.
- **The board must not reveal which words are contested.** No highlight, no accent,
  no pre-round list — the split is invisible until the results screen. A player who
  knows which taps pay has been told which taps to be careless about, and those
  careless taps still write real marks.
- **A run can end without completing.** Live mode ends a round by forfeit (next
  section), so a game that only computes its score in an end-of-run branch has
  nothing to report for a forfeited player. Keep a running score.

#### What an eligible game actually has to DO (built 2026-08-22)

Four things, and no more — everything else is shared. The hook
`src/games/runtime/useChallengeRound.ts` is inert for an ordinary launch (every method a
no-op, `isContested` always false), so **a game needs no `if (challenge)` branch around
its own logic**:

```ts
const challengeRound = useChallengeRound({
    gameId: "<gameId>", mode: null,       // mode only for a moded game
    paused: clockPaused,                  // the SAME boolean that freezes your clock
    running: phase === "playing",
});
```

1. **Append `challengeRound.poolParams`** to your existing pool request. That turns the
   ordinary pool into the round's board — the nine contested words plus
   `mastered-first` filler, assembled and SHUFFLED server-side. You do not select them.
2. **Emit where you already mark.** `challengeRound.emit({ kind: "hit" | "miss", word:
   entry.entryKey, contested: challengeRound.isContested(entry.entryKey) })`. Classify at
   BOARD-GENERATION time against the word set, never against mastery — a challenge round
   writes real marks, so a word can band up mid-round.
3. **Call `challengeRound.finish(won)`** where your run ends. `won` decides an
   all-or-nothing survival bonus if your spec has one (Bubble Match's does).
4. **Render `<ChallengeRoundScoreboard round={challengeRound} classPrefix="…" />`** in
   place of your own end-of-run popup while `challengeRound.active`.

Plus three guards that are easy to forget and silent when wrong:

* **Wait for the context.** Gate your first board on
  `if (challengeRound.active && !challengeRound.ready) return;`. A board dealt before the
  challenge payload lands classifies as 100% filler — a round scored at 20 points a card,
  with nothing afterwards to reveal that it went wrong.
* **No restart, no Play Again.** Rounds are one attempt each; hide both controls while a
  challenge round is active.
* **Back goes to the challenge**, not to `/games`, when `challengeRound.challengeId` is set.

The hook owns the scorer AND the active-time clock, which is what keeps four games from
drifting into four readings of one spec. See
[STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 5.2a for the server half.

### The live idle signal

Live challenge rounds need one thing from a game page that solo play does not: a
signal that **the player has done nothing for N seconds**.

The challenge layer owns the consequence (after the timeout the player forfeits
the round and the shared session advances — see
[STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md) § 6). The game owns only the
observation, because the game owns the input surface.

- It measures **wall-clock time since the last player input**, and it is
  **unpausable** — deliberately the one clock backgrounding does *not* freeze.
  That is the whole point: the game pauses so you are not billed for time you were
  not playing, and the idle timer runs so you cannot hold another person's session
  hostage while you are away.
- It is **live-mode only**. There is nobody to inconvenience in a solo run, so a
  solo game never mounts it.
- Reading a definition popup pauses the *game* but is not idleness in the sense
  that matters; the timeout (60 s) is set to comfortably cover it.

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
   `markFlashcard({ type })` call, and your `GameDef.markType` — which is what puts the
   track in your hub tile's SUBTITLE (`tileSubtitle()` in `GamesPage.tsx` renders
   "Recognition · <your blurb>"), so keep `GameDef.subtitle` a blurb and never write a
   track name into it. If your game's mark type varies by mode, omit `GameDef.markType`
   and put the type on each mode config instead, the way Word Search does — then render
   `MARK_TYPE_LABELS[cfg.markType]` as each sub-tile's subtitle (see
   `WordSearchHubItem`). See the backend notes under
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
6. Reuse `GameEndPopup` for the won/lost card. Pass `onMinimize`/`onRestore` only
   if the game has a post-run cleanup mode worth uncovering the board for;
   otherwise omit them and the popup is modal (Speed Reading).
7. **Derive one `clockPaused` boolean from every pause source** — input-blocking
   popups *and* backgrounding — and feed it to everything that advances on its own.
   Express elapsed time as accumulated active time, never `now − startedAt`. See
   [§ Popups pause the clock](#popups-pause-the-clock) and
   [§ Backgrounding pauses the clock](#backgrounding-pauses-the-clock--everywhere-unconditionally);
   copy Word Search, which already composes both sources.
8. **If the game trains `recognition` or `production`, declare a `challengeScoring`
   spec AND wire the round runner** — both are mandatory for those tracks, because the
   challenge pool is derived from the registry and your game joins the rotation the day
   it ships. A game in the rotation with no runner is a round a player cannot play. It is
   four small edits (`useChallengeRound` → pool params, `emit`, `finish`, scoreboard) plus
   an entry in `src/games/runtime/challengeLaunch.ts` so the challenge page knows the
   route and the nav state your page requires. Also emit the live **idle signal**. See
   [§ Challenge-eligible games](#challenge-eligible-games-the-challengescoring-contract).
9. Append the `GameDef` to `GAME_REGISTRY` in `src/games/registry.ts`:

   ```ts
   {
     gameId: "<gameId>",
     title: "...",
     route: "/games/<gameId>",
     requiresAuth: true,
     Component: React.lazy(() => import("./<gameId>/<GameId>Page")),
   }
   ```

Steps 1–8 are the game. Step 9 is all the wiring: the hub, router, and
mobile-demo frame configure themselves from the registry, so `GamesPage`, `App`,
and `Layout` need no edits.

### Removing a game — retire it from challenges FIRST

✅ **In force since 2026-08-22**, when the challenge round runner shipped
([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md)). It lives here because the constraint
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
2. **Then remove the game** — delete the `GameDef`, the route, the page, and its
   `challengeLaunch.ts` entry.

The client already fails SOFTLY at phase 2's boundary: `challengeLaunchFor` returns null
for a gameId it does not know, and the challenge page renders that round as
**Unavailable** rather than crashing on it. That is a safety net for the last stragglers,
not a licence to skip phase 1 — an Unavailable round is still a round the player cannot
play, and both sides are still stuck.

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
- `src/games/shared/GameFrame.tsx` — `GameFrame` / `GameHud` / `GameHudLabel` / `GameHudBar` / `GameHint` / `GameTimer`; the `.play` panel every game plays inside (§ Layer 2b)
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

Second game (built). Find 12 of your own vocab words — shown as English glosses —
hidden as snaking (orthogonal) paths in a 9×6 grid of colored-pinyin (cpcd)
characters. Drag or tap to trace; any valid multi-char selection pops a
dictionary info-card + audio. Count-up timer → medal on completion. Reuses
Bubble Match's pool + fallback distribution, adds a substring de-dup pass and a
server-side snaking grid generator (`GET /api/onDeck/wordSearchGrid`). Full
spec + file map: → [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md).

## Game: Bubble Match (`/games/bubble-match`)

The first shipped game. A DOM + `requestAnimationFrame` game (absolutely-positioned
bubbles moved via `transform`) — chosen over Pixi for direct reuse of the
colored-pinyin `CPCDRow` (cpcd) and cheap circle-circle physics at ~50 bubbles. (The
physics body stayed a circle; the RENDERED bubble is the design's `.bub` squircle —
`border-radius: 40%` on `.bubble__inner` and on both held-cue overlays. See
docs/SHELF_REDESIGN.md § 12 for why the ~8% corner overshoot is harmless.) That
choice is why the speculative Pixi runtime was never adopted and has since been
deleted (§ Layer 2). It owns its page shell (`LeafPage` + its own flp-style header,
**no footer** — see Routes above).

### Pinyin is a per-game setting

> STATUS: **DESIGN — decided 2026-08-23, NOT BUILT.** Today Bubble Match, Hydra
> Bubbles and Match Speed all read *and write* the ONE shared `showPinyin` boolean in
> `useFlashcardLearnSettings` (`src/hooks/useFlashcardLearnSettings.ts`, stored as
> `flashcard.learn-settings`), which is the **flp's** setting. Code to change:
> `BubbleMatchPage` / `BubbleMatchTrackToggle` / `BubbleMatchHeader`,
> `HydraBubblesPage`, `MatchSpeedPage` / `MatchSpeedSettingsDialog`.

**Every game owns its own pinyin preference.** "Show pinyin" is not one app-wide
display taste: on a zh board it decides *what skill the board tests*
([MASTERY_REWORK.md § 1a](./MASTERY_REWORK.md)), so it belongs to the surface doing
the testing, not to a global blob.

Sharing it leaks in two directions, and both are real today:

* **Between games.** Switching Bubble Match to Reading — which is done *by* hiding
  pinyin — also strips pinyin from Hydra Bubbles and Match Speed, neither of which the
  learner touched, and neither of which changes track to match.
* **Between a drill and its reference material.** The flp owns
  `flashcard.learn-settings`, and the cdp, the scp and the dictionary cdp read it as a
  *reading* preference. A game that writes that key is editing the learner's flashcard
  display from inside a game.

The rule, and how much of it already holds:

| Surface | Where its pinyin preference lives |
|---|---|
| flp (+ cdp, scp, dictionary cdp) | `useFlashcardLearnSettings` — **unchanged**; the flp keeps this key and becomes its only writer |
| **Word Search** | ✅ already per-game — a property of the MODE (`MODE_CONFIGS`, `src/games/word-search/constants.ts`). The precedent. |
| **Memory Map** | ✅ already per-game — hardcoded `showPinyin={false}`; it is a reading map |
| **Speed Reading** | ✅ already per-game — hardcoded false; the prompt would spoil itself |
| **Bubble Match** | ✳ its own persisted setting (the per-run latch is unchanged) |
| **Hydra Bubbles** | ✳ its own persisted setting — **and its own track conversion**, see [HYDRA_BUBBLES.md § 6.0](./HYDRA_BUBBLES.md) |
| **Match Speed** | ✳ its own persisted setting (display only — Match Speed stays `recognition`) |

Follow the existing per-surface pattern — `useWordSearchSettings`
(`src/games/word-search/useWordSearchSettings.ts`) and `useDiscoverSettings`
(`src/hooks/useDiscoverSettings.ts`): one hook per game over its own localStorage key,
defaults merged on read so adding a knob later needs no migration. Four of the seven
surfaces are already there; this finishes the job rather than inventing a mechanism.

**Defaults stay `true`** (pinyin shown) everywhere, so nobody's track changes silently
on deploy day: a learner who had hidden pinyin globally is put back on `recognition` in
Bubble Match until they hide it *in Bubble Match*. That reset is intended — the old
global value was never a statement about any particular game.

**Language gating is unchanged.** Every pinyin control stays hidden for Latin-script
languages (`isLatinScriptLang`), and `es` never switches track at all
([MASTERY_REWORK.md § 1a](./MASTERY_REWORK.md)).

⚠️ **A per-game setting must not become a per-game *track* by accident.** Match Speed
gets its own toggle for display only and keeps marking `recognition`; the track rule
applies to a game only where this doc says so (Bubble Match today, Hydra next). A game
whose pool is bucketed and cooled on one track must never write marks on another —
they are dropped by the § "next markable at" guard
([HYDRA_BUBBLES.md § 8](./HYDRA_BUBBLES.md)).

### Bubble Match: pinyin picks the track

> Code: `src/games/bubble-match/BubbleMatchTrackToggle.tsx` (the hub control),
> `BubbleMatchPage`'s `runTrack` / `lockRunTrack` / `boardShowPinyin`,
> `foreignPromptTrack` (`server/contracts/wire.ts`),
> `BentoStripProps.control` (`src/components/bento/Bento.tsx`).
> Full rationale: [MASTERY_REWORK.md § 1a](./MASTERY_REWORK.md).

Bubble Match is a foreign → meaning drill, so it follows the same rule as the flp's
Chinese-side-one face: **pinyin shown ⇒ it marks `recognition`; pinyin hidden on a zh
board ⇒ it marks `reading`**, because the player then reaches the meaning from the
characters alone. Spanish is unaffected (nothing to hide; always recognition).

Three consequences worth knowing before touching this game:

1. **The choice is made on the HUB, not in the game.** The pinyin chip is gone from
   the game header; the Games hub's Bubble Match strip carries
   `BubbleMatchTrackToggle` in its `control` slot, which names both tracks
   (`RECOGNITION ⇄ READING`) and writes the `showPinyin` setting — today the
   **shared** one, and per the section above it should be **Bubble Match's own**.
2. **The run latches the track at deal time** (`lockRunTrack`, called from the first
   pool fetch and reused by every Play-Again refill). The pool is bucketed AND cooled
   on that track when it is requested, so a board dealt on one track and marked on
   another would write marks the server silently drops
   ([HYDRA_BUBBLES.md § 8.1](./HYDRA_BUBBLES.md)). The board's own pinyin display is
   derived from the latched track (`boardShowPinyin`), so display and mark cannot
   drift apart mid-run either.
3. **A reading run is SILENT.** No autoplay toggle in the header, no `onSpeak` on the
   stage, and no TTS prefetch — narrating the word would hand the player the
   pronunciation the run is asking them to read.

Known wrinkle (being fixed): `showPinyin` is one shared setting, so turning it off
here also hides pinyin in **Hydra Bubbles** and **Match Speed**, neither of which
changes track to match. Both halves are addressed above — the setting becomes
per-game (§ "Pinyin is a per-game setting"), and Hydra converts to the reading track
with it ([HYDRA_BUBBLES.md § 6.0](./HYDRA_BUBBLES.md)). Neither has shipped.

### Gameplay

- A game uses the **full pool**: the `GAME_DISTRIBUTION` mix (`constants.ts`)
  of 2 Unfamiliar + 10 Target + 6 Comfortable + 2 Mastered library cards =
  **20 pairs (`TOTAL_PAIRS`) → 40 bubbles**. That mix is *preferred*, not strict —
  when a bucket can't fill its quota the server first **lends** the shortfall
  (provisional cards, always `Unfamiliar`) and only then tops up from the fallback
  buckets; see [PROVISIONAL_CARDS.md § 4b](./PROVISIONAL_CARDS.md). Each pair = one **word** bubble (cpcd) and one
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
- **A held bubble may be dragged clean off the field** — left, right and bottom
  alike, by `HELD_OVERDRAG_RADII` of its own radius measured from the STAGE edge.
  `clampHeldCenter` (`physics.ts`) is the single source for how far. What differs
  between the three edges is not the distance but the MEANING on release: the
  bottom's last 96 px are the cancel strip, real on-screen space carved out of the
  play area, and releasing there *abandons the match*; the sides have no strip, so
  the bubble is simply clipped and releasing there means nothing — the boundary has
  give, it is not a second escape hatch. The **top is excluded**: in Bubble Match it
  is the descending ceiling, and shoving bubbles through a mechanic is not the same
  as tugging at a boundary. On release, `stepPhysics` **glides** the body back at
  `MAX_PUSH_SPEED` rather than snapping it — over a whole bubble's width, teleporting
  reads as a glitch where the same distance travelled reads as a spring. Both stages
  call the one helper; they used to write the clamp out twice, identically.
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
  Cleanup also **retracts the ceiling**: `stepFrame` runs the descent in reverse
  (same `shrinkSpeedPxPerSec`, `bounds.top` walked back to 0) while `cleanupMode`
  is on. A loss to the ceiling leaves the play area crushed and over-packed, where
  the separation solver can never satisfy every overlap and the field jitters
  continuously; handing the room back lets it spread out and settle so the review
  board is calm to read and drag on. The lid element follows `bounds.top` as it
  already did, so the wall visibly rises back up.
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
  in from the top, compressing the field. That instant is also reported upward as
  **`onCeilingDrop`** (fires at most once per run): it is when a Study Challenge round's
  +500 survival bonus becomes live and starts decaying, and the page cannot derive it —
  it depends on the launcher draining, which only the stage knows about
  ([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 5.4). Win = clear all pairs. Lose = the field
  over-packs under the ceiling (area ≥ `LOSE_FILL_RATIO`, currently a deliberately
  lenient **0.94**, or residual pairwise overlap that stays above
  `OVERFILL_RESIDUAL_PX` for `OVERFILL_SUSTAIN_MS`) — an intense pulsing red
  vignette warns from `DANGER_FILL_RATIO` (0.72) onward, so the field can be
  squeezed a long way while the alarm is up before the run actually ends. Tunables live
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
  `{ cards, requested, available, total, needed, sufficient }`.

  ⚠️ **`?challengeId=&gameId=&mode=` short-circuits the whole band ladder** and serves a
  Study Challenge round's board instead — the nine contested words plus
  `mastered-first` filler, shuffled, in the same response shape
  (`OnDeckVocabService.getChallengeGamePool`; `&contested=exclude` for a mid-run refill).
  `/api/onDeck/wordSearchGrid` takes the same three params. The request is authorized by
  `StudyChallengeService.getRoundContext`, which decides the round and the game rather
  than trusting the caller — see [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 5.2a. This
  is deliberately NOT a second pool endpoint: a challenge round is an ordinary board with
  a different composition, and two loaders would drift.
 `OnDeckVocabService.getGameVocabPool`
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

  **Five fill tiers** (`getGameVocabPool`), drained in order until `need` is met.
  (This table said *three* until 2026-08-18, when lending was inserted at tier 2 with
  provisional cards. On **2026-08-20 lending moved to tier 5** — the bottom — and the
  cooled tier moved up ahead of it.)

  | Tier | Contents | Drained |
  |---|---|---|
  | 1. fresh (requested) | game mark type off cooldown | the requested buckets only |
  | 2. fresh (fallback) | game mark type off cooldown | Target → Comfortable → Unfamiliar → Mastered |
  | 3. cooled | on the per-type cooldown | requested buckets, then fallback order |
  | 4. avoided | ids passed as `avoid` (just cleared) | requested buckets, then fallback order |
  | 5. **lend** | **re-lent** — or newly minted — provisional cards | whatever is still missing |

  ⚠️ **A strict-bucket request collapses tiers 2–4 to the requested buckets.** A caller
  that sends **`?strictBuckets=1`** is not expressing a difficulty mix — it is asking a
  question whose answer is the bucket. Substituting another bucket returns a card the
  caller then misreports to the player. So the fresh-fallback tier is skipped entirely
  and tiers 3–4 drop the fallback order; the request would rather come back short than
  come back wrong. Hydra Bubbles is the only such caller today: it rolls a color,
  requests the two bands that color is made of, and pays the player by that color
  ([HYDRA_BUBBLES.md](./HYDRA_BUBBLES.md) § 6.2d). Mix callers — every other game — are
  unaffected.

  ⚠️ **It became a flag on 2026-08-21; it used to be inferred** from
  `Object.keys(distribution).length === 1`. That inference held only while Hydra asked
  for one band per color; its two-color rework asks for two, which the old rule would
  have read as "a mix, substitute freely". The length-1 inference is kept as a backstop
  for a future single-bucket caller. **Note:** Match Speed's Review and Challenge modes
  also request a two-band subset and do *not* set the flag, so a "Review" board can be
  topped up with `Unfamiliar` cards — pre-existing, and the flag is how to fix it if
  those mode names are meant as promises.

  ⚠️ **Lending is the LAST resort, below cooling cards** (2026-08-20). A learner whose
  cards are merely *resting* is not short of cards, so the board re-serves those instead
  of minting words the learner never chose. Lending exists for a learner who has not
  sorted enough cards, and for nothing else.

  Without this ordering, a game whose mark track is sparsely populated lent on **every
  single load, forever**: Speed Reading buckets by READING, on which a typical learner
  is ~100% `Unfamiliar`, so 18 of its 20 quota slots are unfillable at any library size
  — and a minted row is itself `Unfamiliar`, so lending could never close them. Dev
  accounts reached 450 and 184 lent rows against 20 and 185 real ones. The 2026-08-19
  patch (lend only what the fresh-fallback tier cannot cover) treated the symptom; the
  ordering is the fix. See [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) § 4b.

  Because selection queries are now **sorted-only**, a lent card reaches a round only by
  being named: tier 5 gets ids back from `ProvisionalCardService.acquireLentCards` and
  reads the rows with `fetchRowsByIds`, and the controller's baseline top-up threads its
  own `lentIds` into the pool call.

  Tier 5 is **skipped for a collection-restricted round** (a deck round made of
  non-deck words is not that deck) and, historically, for any **partial refill**.
  That second exemption is now per-game: a surface in `ROLLING_SUPPLY_SURFACES`
  (`server/contracts/wire.ts`) may lend on a refill, because its whole supply model
  IS the refill. Hydra Bubbles is the only one today. Such a surface may also send
  `?lendLevelOffset=` to lend at a difficulty **tier** relative to the learner's
  estimated level. Every lend, targeted or not, first **re-lends** provisional cards the
  learner already holds near that difficulty and off cooldown, and mints only the
  shortfall. See [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) §§ 3b, 4b.

  ⚠️ **Tier 3 hands out cards the learner cannot be marked on.** Since the cooldown
  became a hard "next markable at" (2026-08-18), `POST /api/flashcards/mark`
  silently declines a mark on a still-cooling track. The cooled tier exists precisely to
  serve cooling cards, so a learner playing two rounds back to back can clear a board
  and see no history move — and since 2026-08-20 that tier fires *ahead of* lending, so
  it happens more often, by design. This is **known, accepted and instrumented** — every
  dropped mark is logged as `[MarkSuppressed]`. Telling the learner is the open piece.
  See [HYDRA_BUBBLES.md § 8.1](./HYDRA_BUBBLES.md) and
  [DEFERRED_WORK.md](./DEFERRED_WORK.md).

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

---

## Game: Hydra Bubbles (`/games/hydra-bubbles`)

**Built 2026-08-18. Not yet validated by play** — the spawn numbers are a first
tuning. Full spec: [HYDRA_BUBBLES.md](./HYDRA_BUBBLES.md). This section is the
summary and the cross-references; that doc owns the design.

Named for the myth: cut off one head and more grow back.

### Gameplay

An **endless, clockless** recognition drill on Bubble Match's bubbles, built to be
the opposite of it. Bubble Match's tension is a shrinking play area against a fixed
pool of 20 pairs; Hydra's is a board that **grows on its own**.

- The run opens with **3 bubbles** — one live pair plus one English stray.
- Drag a bubble onto its partner to match. A match clears both and scores **+2**.
- **The cleared Chinese bubble's color decides what you pay for it.** Two tiers, one
  step either side of the two bubbles a match removes: **`drain` (dark blue) spawns 1
  (net −1), `bloom` (light blue) spawns 3 (net +1)**. Drain is the only move that shrinks the
  board, and drain is by construction the words the learner knows least well.
  *(Reworked 2026-08-21 from a four-color ladder — red 1 / yellow 2 / green 3 / blue 4 —
  because yellow was break-even and green a weaker blue; the player now reads one bit
  off a bubble instead of a four-rung table.)*
- **One wrong match ends the run**, immediately and without confirmation.
- The other loss is **overflow**: the same fill-ratio measure Bubble Match uses
  (`LOSE_FILL_RATIO` 0.94, danger vignette from 0.72), but with **no descending
  ceiling** — the field only ever fills from spawns the player caused.
- Score is bubbles cleared, **session-only**: nothing is persisted, and there is no
  `wins` row, so no weekly badge and no level strip on the hub.

### What Hydra introduced

- **A deliberately non-self-stabilizing economy.** The spawn table keeps expected
  payout above the break-even 2 everywhere below 0.75 fill, so a board left alone
  always creeps up. At 0.75 it **steps** to drain-only — nothing but the hardest words,
  each paying 1 against the 2 removed — which is the squeeze the player has to fight
  out of. Under two colors that invariant reduces to one line: growth is
  `2·bloomShare − 1`, so **bloom must be over half of every roll**, which is why the
  steady state is bloom 55 / drain 45 and not the old 65%-hard mix. This is the one thing
  in the game pinned by tests rather than left to tuning
  (`src/__tests__/hydraSpawnTable.test.ts`).
- **The spawn table is keyed on FILL RATIO, not bubble count**, so the system that
  decides payouts and the system that decides loss read the same number and cannot
  disagree about how full a board is on a phone versus a tablet.
- **Color and mastery are allowed to disagree** — and since 2026-08-21 a color is not
  even a band. Each Hydra tier is a **union of two utcm bands** (bloom = Mastered +
  Comfortable, drain = Unfamiliar + Target), and a **lent** card is colored by its
  difficulty tier instead of by mastery at all. Coloring lent cards by mastery would
  make every one of them drain (a fresh row has no history), putting the whole board on
  the shrinking side for exactly the learners most likely to be playing on lent cards.
  Because a tier is a union and a lent card ignores it entirely, Hydra stopped wearing
  the mastery hues **and then stopped wearing hues the ramp could be mistaken for**: an
  ember/ocean pair was replaced the same day by **charcoal / gold**, because a
  red-vs-blue bubble still decodes as hard-vs-known to a learner the rest of the app has
  trained that way. A third pass followed within the hour: the field carries **three**
  kinds of bubble (two payout tiers plus inert grey English), and the first charcoal was
  one value step off that grey. A three-channel fix (value, temperature and ring weight)
  shipped and held — and was then dropped whole on 2026-08-22, when the two bubble games
  were unified on ONE style with Bubble Match as the source of truth. **Colour is now the
  only thing a game varies, and Hydra's ladder is TWO SHADES OF ONE BLUE** (`#79B3EE` =
  harder, `COLORS.blu` `#D2EBFF` = easier): hue encodes nothing, value is the whole
  message, and both rungs take black text — a rung whose glyphs invert reads as a
  different object rather than a darker one, which is why the darker, better-separating
  `COLORS.bluA` was given up. Two costs are recorded, not hidden: blue is the hue the app
  trains as "mastered", and a mid-value blue is the worst ground there is for tone-3
  pinyin. Both exit the same way, via a purple ladder; docs/HYDRA_BUBBLES.md § 2.2 has the
  numbers. The identifiers moved with it — `HydraColor` is
  `"drain" | "bloom"`, named for the board effect, so the next palette pass renames
  nothing.
- **Two client-side color buffers** (`useColorBuffers`), one per tier, popped at
  spawn and topped up asynchronously. This is what makes the color system tractable:
  the game never asks "what color is this card?", because the card came out of that
  color's buffer. No table, no server state.
- **The first rolling-supply surface.** Every spawn is a partial refill, which is the
  one call shape that historically never lent. See the fill-tier table above.
- **The first game with no card baseline of any kind** — alongside Memory Map, which
  also declares none. A run may lend from the very first bubble, and there is no
  library size at which the hub row is gated.
- **Grey is reserved for English**, so Hydra could not reuse Bubble Match's grey
  held/hovered wash. Its pickup cue is an **outline ring** instead — which is why the
  shared `Bubble` takes a `heldCue` prop.

### Files

- `src/games/bubbles/` — the **shared** substrate, extracted from Bubble Match ahead
  of this game: `types.ts`, `constants.ts`, `physics.ts`, `bodyFactory.ts`,
  `Bubble.tsx`. Bubble Match was converted to import from it with no behavior change.
- `src/games/hydra-bubbles/` — `HydraBubblesPage.tsx` (loading → playing → over →
  playing), `HydraStage.tsx` (rAF loop, drag/hover/match, payout, HUD, danger glow),
  `spawnTable.ts`, `spawnPlanner.ts`, `useColorBuffers.ts`, `HydraLendNotice.tsx`,
  `constants.ts`, `types.ts`.
- Reuses Bubble Match's `BubbleMatchHeader` and `BubbleMatchEndPopup` unchanged.

### Backend

**No new tables, no new columns, no migration.** Reuses the OnDeck vocab stack:

- `GET /api/onDeck/gamePool` with `?surface=hydra-bubbles` (opting into refill
  lending) and `?lendLevelOffset=` (the rolled color's difficulty tier, resolved
  against the learner's estimated level server-side — the client never sees `L`).
- `POST /api/flashcards/mark` as every other game, with `?type=recognition`.

### Study Challenge

Challenge-eligible as a recognition game, but scored on a different axis from free
play, because an endless run has no comparable length: **time to clear the ten
challenge words**, which always ride the yellow slot. A wrong match still ends the
run, banking what was matched and scoring zero for the rest. The
`ChallengeScoringSpec` deliberately carries **no survival bonus** — Bubble Match's
makes sense because its run has a fixed length; Hydra's does not.
⚠️ How a partial run's time compares to a complete one is still open
([HYDRA_BUBBLES.md § 11 O2](./HYDRA_BUBBLES.md)).
