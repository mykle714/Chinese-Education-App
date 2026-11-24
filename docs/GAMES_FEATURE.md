# Games Feature

Mini-games that reinforce vocabulary and character learning.

> **Where games are played (since 2026-11-06): only as flp game breaks** inside the Deck
> Tower's study session ([FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md); rotation =
> `src/games/flpBreak/index.ts` → `FLP_BREAK_GAMES`: Match Speed, Word Search, Writing Grid,
> Superposition, Speed Reading, Memory Map). The Games hub (`/games`, `GamesPage`) and its
> Menu row were **deleted**, and the two ROUTED games' own pages (Match Speed, Word Search)
> are switched **off** by the `standaloneGames` feature flag
> (`server/contracts/featureFlags.ts`): while it is off `src/games/registry.ts` →
> `ROUTED_GAMES` is empty, so no `/games/*` route is mounted. The page code is kept,
> dormant. The hub's launcher components (`GameCard`, `gameCards`, `RoundPlayButton`,
> Word Search's hub tile / resume tile / launcher) were deleted 2026-11-23. Sections below
> that describe the hub describe deleted code, and say so.
>
> **Archived 2026-11-23: Bubble Match, Hydra Bubbles and Bucket Drop.** Their code and
> design docs live on the `archive/bubble-match-hydra-bucket-drop` branch — see
> [ARCHIVED_FEATURES.md](./ARCHIVED_FEATURES.md). The shared bubble field
> (`src/games/bubbles/`) and `src/games/runtime/GameEndPopup.tsx` went with them.

> **Second host:** games embedded mid-session in the flp as "game breaks" — **phase 1
> built (Match Speed and Word Search)**: [FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md). A break-capable
> game is split into a page + an embeddable Stage (§ "Routes" below; § 6 there).
>
> **Not a game in this registry, but related:** Sentence Tiles, a two-player correspondence
> word-tile game judged by AI, is its own flagged feature (`sentenceTiles`, testers only) with
> pages under `/sentence-tiles` — [SENTENCE_TILES_GAME.md](./SENTENCE_TILES_GAME.md).

## Status

- 🚩 **Every game sits behind its own feature flag (2026-09-19), and all six are ON.**
  `GAME_FLAGS` in `server/contracts/featureFlags.ts`, keyed by the game's own `gameId` —
  see [FEATURE_FLAGS.md](./FEATURE_FLAGS.md) § 3. The client chokepoint is a single filter
  at `GAME_REGISTRY` in `src/games/registry.ts`, so switching a game off removes it from
  the router, from the flp break rotation and from every test that enumerates games with
  no other edit. The record is typed against `KNOWN_GAME_IDS` (`server/constants.ts`), so
  **adding a game is a compile error until it is given a flag**.
- **Study Challenge rounds — live since 2026-08-22.** Two games
  (Match Speed, Word Search-Pinyin) can be drawn as a scored round of a weekly
  head-to-head, so a challenge plays 2 rounds. The contract they must honour is
  [§ Challenge-eligible games](#challenge-eligible-games-the-challengescoring-contract);
  the feature is [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md).
- Hub page (`/games`) — **deleted 2026-11-06** (see the banner above).
- Games — **six shipped**, all registered in `src/games/registry.ts`. Two kinds
  (`GameDef`, `src/games/types.ts`; `isRoutedGame`, `ROUTED_GAMES` in the registry):
  **routed** games have a `route` + `Component` (Word Search, Match Speed); **break-only**
  games have neither and are
  played only as flp game breaks inside the Deck Tower's study session
  ([FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md)) — Speed Reading, Memory Map (the bullet below
  this list), Writing Grid ([WRITING_PRACTICE_REWORK.md](./WRITING_PRACTICE_REWORK.md) § 2)
  and Superposition ([SUPERPOSITION_GAME.md](./SUPERPOSITION_GAME.md)):
  - **Word Search** (`/games/word-search`) — see [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md).
  - **Match Speed** (`/games/match-speed`) — see [MATCH_SPEED_GAME.md](./MATCH_SPEED_GAME.md).
    One hub tile, one mode (Study Mix). A tap-to-match recognition speed drill: 2 columns × 6 rows (foreign |
    English), how fast can you complete 30 pairs, board refills every 3s until they are all dealt, speed + accuracy tiers (§ Run tiers).
  - **Speed Reading** (break-only) — see
    [SPEED_READING_GAME.md](./SPEED_READING_GAME.md). A **reading** drill: pinyin
    + definition + audio at the top, then two word options — the real word and
    one where a single character has been swapped for another real character from
    the player's library. The only **race** format in the set: a fixed 20 rounds
    with a count-**up** clock, a speed tier by finishing TIME (lower is better) and an
    accuracy tier by correct answers (§ Run tiers). A wrong answer costs no time.
    Every round must be answered — it has **no Skip**.
  Every game is plain **DOM** (Match Speed and Speed Reading are DOM + timers only — no
  rAF loop, no physics, just CSS transitions and intervals). **There is no Pixi game
  runtime any more** — the never-used `GameStage` / `GamePage` / `useGameActors`
  scaffolding was deleted (commit `70dc441`); see
  [§ Layer 2](#layer-2--runtime-srcgamesruntime).

- **Listening Practice** (`/games/listening-practice`) — see [LISTENING_PRACTICE_GAME.md](./LISTENING_PRACTICE_GAME.md).
  **DESIGN / DRAFT (2026-10-12), not built.** A zh-only minimal-pair listening drill: hear
  a word, phrase or sentence (60/30/10) and pick which of several real words was said,
  where the options differ along one axis only (tones, c/ch/q · s/sh/x · z/zh/j, -n/-ng,
  u/ü). Moded hub tile. It is the first game that emits **no marks**, but it still accrues minutes.

- **Memory Map** (break-only, zh only) — see [MEMORY_MAP_GAME.md](./MEMORY_MAP_GAME.md).
  **DEPLOYED to PPE (migration 151).** A persistent, pan/zoom **reading** map:
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
  `memory_map_slots_zh` / `memory_map_slots_es` (migration 151 as
  `memory_map_placements_*`, reshaped into a slot tree and renamed by migration 173).
  Split per language to mirror the vet split, which is what buys a real
  `REFERENCES vocabentries_*(id)` (now `ON DELETE SET NULL` — a deleted card empties its
  slot). Word Search's board, by contrast, is localStorage only, because a board is
  disposable and a map is not.
- **A client that derives positions from a shared server module.** No coordinates are
  stored: the client lays the slot tree out with the same pure `layoutMap`
  (`server/services/memoryMapLayout.ts`) the server spawned it with.
- **A shared, track-parameterized queue ranking.** `rankFlpEligible`'s logic moved out
  of `OnDeckVocabService` into `server/services/cardQueueRanking.ts`, a pure module
  parameterized on which mark types count as ready and which utcm category supplies the
  cooldown window. The flp's behaviour is unchanged; Memory Map ranks the same way on
  the **reading** track. Any future game wanting the flp's queue order (recent cards
  longest-waiting first, stale cards easiest first) on its own track should use this
  rather than copy it.
- **A game that lends without a `CARD_BASELINES` entry.** Since 2026-10-06 the map is
  always filled to 50 — rested cards, then cooling ones, then lent ones by name
  (MEMORY_MAP_GAME.md § 2.1). Originally it declared no baseline at all ("a small library
  is a small map"); that was overruled.
- **A game that deliberately skips pause-on-background.** No `useBackgroundPause`, no
  pause at all. That rule exists to stop a CLOCK draining while backgrounded;
  this game has no clock, so the pause would protect nothing. Recorded so it is not
  later "fixed" by an audit against the framework checklist.
- **The app's pan/zoom surface** (the Pixi-based Night Market was the first; it was removed
  2026-11-09), built as plain DOM + a CSS transform. The 49-word cap
  (`MEMORY_MAP_CAPACITY`) is what makes that safe: at that size there is nothing to cull.

### What Speed Reading introduced

Speed Reading is the first game to need machinery the other three didn't, all of
which is now shared:

- **A language gate on `GameDef`** — `languages?: Language[]`, evaluated by
  `isGameAvailable` (`src/games/registry.ts`) against `user.selectedLanguage`. A game
  whose languages exclude the learner is **hidden** (never dealt as an flp break), not
  shown-and-blocked. Speed Reading and Memory Map declare `["zh"]`.
- **`?markType=` on `GET /api/onDeck/gamePool`** — the endpoint used to hardcode
  `recognition` back when the (now archived) Bubble Match was its only caller. A game's
  pool must be bucketed by, and cooled on, the track it actually MARKS; Speed Reading
  marks **reading**.
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
| ~~`/games`~~ | ~~`GamesPage`~~ | — | Deleted 2026-11-06. |

Each ROUTED game has its own route under `/games/<slug>`, mounted only while the
`standaloneGames` flag is on (`ROUTED_GAMES`). It is off, so today none is mounted.

The slug list `KNOWN_GAME_IDS` (`server/constants.ts`) mirrors the client
`GAME_REGISTRY`; its one job is typing `GAME_FLAGS`. (It was also the whitelist for the
generic `/api/games/:gameId/assets|progress` routes, deleted 2026-11-23 with no caller.)

**Word Search and Match Speed are leaf pages** (no footer): wrapped in `LeafPage` (see
[LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)), the down-arrow back button is the only way
out, and the page slides up on enter / down on exit. The fire badge in the header is
rendered by `PageHeader` for every page, not passed by the game; an autoplay chip in a
game header edits the **app-wide** narration autoplay flag, not a game pref
([AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md)).

**Every routed game is a leaf page** (break-only games have no page at all). Games
are classified `chrome: "leaf"` in bulk by `GAME_ROUTE_META` in
`src/routes/routeMeta.ts`, which derives one row per `ROUTED_GAMES` entry, so a new
game gets leaf chrome without touching the route tables. A game that should keep the
footer would need a `chrome` field on `GameDef` first; none exists.

There is no generic in-game shell to adopt — each game owns its page. (A
`src/games/runtime/GamePage.tsx` used to exist and rendered node-style chrome, which
was wrong for a leaf page; it was deleted unused. See § Layer 2.)

**Second host: the flp game break (2026-10-18).** A game that can run between flp cards
is split into its **page** (the route: `GameLeafPage`, `useBlockEdgeSwipe`, launch
`state`) and a **Stage** (the run itself), and the Stage renders inside a host-injected
`Frame` (`GameStageFrameProps`, `GameStageHost` in `src/games/types.ts`). This is NOT a
generic shell: there is no shared stage, each game keeps its own. Match Speed
(`MatchSpeedStage`) and Word Search (`WordSearchStage`) have both hosts (page + break,
switched by `GameStageHost`); Speed Reading, Memory Map, Writing Grid and Superposition
are **break-only** — a Stage with no page and no `host` prop. The flp side — adapters and candidate derivation — is
`src/games/flpBreak/`; the break's opening card is an flp card, not a game surface; see
[FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md).

## Every game plays the whole library

A game's pool is the learner's whole sorted library (plus lent cards,
[PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md)); no game or game launch is scoped to a
subset of cards. The only restriction a pool request can carry besides the game's own
track/band parameters is a Study Challenge's word set (`?challengeId=`,
[STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md)) and, inside an flp break, the focus set
([FOCUS_MODE.md](./FOCUS_MODE.md)). The hub has no collection selector.

## Navigation entry point

There is **none**: no footer tab, no Menu popover row, no hub (all removed 2026-11-06).
A game is reached only by the Deck Tower's study session dealing it as a break
([FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md)), or by a tester forcing one
(`src/features/deckTower/ForcedBreakPicker.tsx`). If `standaloneGames` is switched back on,
the two routed pages come back at their URLs, still with no launcher: one would have to be
built (the old `GameCard` family was deleted 2026-11-23; it is in git history).

### Break-only games, and the exit destination

> Code: `src/games/types.ts` → `GameDef`, `RoutedGameDef`; `src/games/registry.ts` →
> `isRoutedGame`, `ROUTED_GAMES`; `src/games/runtime/gameExit.ts` → `GAMES_HUB_EXIT`,
> `readExit`; `src/games/runtime/useGameBack.ts` → `useGameBack`.

The deleted hub listed **routed** games only (`ROUTED_GAMES`). Speed Reading, Memory Map, Writing
Grid and Superposition have no route and no page: they are played only as flp game breaks
inside the Deck Tower's study session ([FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md)), which
also runs the reading-track variants of two routed games (Match Speed with pinyin hidden,
Word Search **No Pinyin**).

Every game but Memory Map keeps a per-mode **personal best**
([WRITING_PRACTICE_REWORK.md](./WRITING_PRACTICE_REWORK.md) § 2a).

**Exits** (dormant while `standaloneGames` is off). A routed game's Back (`useGameBack`)
and its "Back to …" buttons lead to `GAMES_HUB_EXIT`, which now points at the Deck Tower
(`/`, label "Deck Tower") since the hub is gone, or, for a challenge round, back to the
challenge. No game
launch carries `state.exitTo` any more; `readExit` is still read by the Writing Notebook
and acp, whose launches from the Deck Tower carry one
([DECK_TOWER.md](./DECK_TOWER.md)). The "no level / no mode" bounces (a stray URL) go to
`GAMES_HUB_EXIT.path` (`/`); the hub that picked a level or mode no longer exists.

## Design decisions

> **Historical (§ 1–4):** these describe the Games hub, deleted 2026-11-06.

### 1. Hub is a vertical, width-spanning menu
Every game was ONE `GameCard` entity in the shared `Bento` grid, as a half-width `tile`
or a full-row `card` with option slots (levels, a resume tile) and a `RoundPlayButton`.
The whole launcher family (`GameCard`, `gameCards`, `RoundPlayButton`, Word Search's hub
tile, resume tile and launcher) was deleted 2026-11-23; it is in git history. Visibility
gating shared with the flp break picker (`flpBreakCandidates`) is still
`isGameAvailable` (`src/games/registry.ts`).

### 2. Empty state instead of placeholder cards
When the registry yields no visible rows — every game gated out by `unlock` or
`languages` — the hub renders a centered empty
state ("No games yet" + subtitle) instead of mocked rows. Originally this covered
the pre-first-game period; it now survives as the gated-out fallback. Rationale:
placeholder rows tend to get shipped by accident.

### 3. Left back arrow on the hub (node page)
The hub is a **node page** (`NodePage`), so it shows a **left** back arrow
that goes back one history entry (`navigateBackOr`, else `/`) — Games is opened from the Menu popover, not a footer tab.
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
| Locking / progression | One gate on `GameDef`, evaluated at hub render time: `unlock.minVocabEntries` (declared but unused). (`requiresAuth`, which hid a game from public/demo accounts, went with `users.isPublic` on 2026-11-14, [LOGIN_REWORK.md](./LOGIN_REWORK.md) Q7.) **No game may block on card count** — see [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md): each game's old minimum is now a BASELINE the server tops the player up to with temporary cards. The only remaining entry conditions are being signed out and Word Search's zh-only restriction. No game is gated behind another game. |
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
page). Just give the route a `shell: "frame"` row in `src/routes/routeMeta.ts` (which
replaced the old `MOBILE_DEMO_PATHS` array in `Layout.tsx`) and render the page's
content directly — header + content area + `MobileFooter`. The frame is
applied for you.

The frame routes are every `routeMeta` row with `shell: "frame"` — the four footer tabs
(`/` (td), `/arena`, `/dictionary`; Menu has no route), their drill-ins, the routed game routes
(generated from `ROUTED_GAMES`), and `/settings`. `src/routes/routeMeta.ts` is the list.

## Mobile demo header (shared header hierarchy)

Two-layer header model (there is **no** hamburger / nav drawer — global nav is
the footer tabs + the Menu popover):

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

- Footer-tab pages (Deck, Menu, Arena, Dictionary) → use
  `MobileDemoHeader` inside `MobileTabScreen`; pass `title` and optional
  `headerExtraActions`. (There is no `activePage` any more — A2b removed the
  header's tab badge, its only reader.)
- Back-arrow drill-ins → use the `LeafPage` (down arrow, no footer) or `NodePage`
  (left arrow, keeps footer) wrapper instead of composing the header by hand.
- Specialty in-page headers (the flp's `TowerStudyHeader`, the game headers) → compose `PageHeader` directly and own their own `rightContent`. Build
  that `rightContent` from `HeaderToggleChip` / `HeaderIconButton` — the three game
  and flp headers each used to carry a byte-identical private `toggleSx` helper, and
  that is exactly what those exports exist to prevent.

### `GameDef.modes` and the shared shake

- **`GameDef.modes`** — a moded game's per-mode primary tracks, declared on the registry
  entry (read off the game's own `MODE_CONFIGS`; Word Search is the one moded game today).
  `src/games/__tests__/challengePool.test.ts` loops `game.modes`, and tests that every game
  declares either `markType` or `modes`.
- **The invalid-operation shake** is app-wide: `src/theme/invalidShake.ts` →
  `INVALID_SHAKE_KEYFRAMES` / `INVALID_SHAKE_ANIMATION` (keyframes `invalidShake`); acp
  shakes a dragged sorted card with it.

## Games framework

The hub no longer hardcodes its menu — it reads from a registry that also
drives the router and the mobile-demo allowlist. The framework has three
frontend layers and a thin backend.

### Layer 1 — Registry (`src/games/registry.ts`)

```ts
const ALL_GAMES: GameDef[] = [
  { gameId: "word-search", title: "Word Search", route: "/games/word-search",
    Component: lazy(() => import("./word-search/WordSearchPage")) },
  { gameId: "match-speed", title: "Match Speed", route: "/games/match-speed",
    Component: lazy(() => import("./match-speed/MatchSpeedPage")) },
];
```

Each `GameDef` (`src/games/types.ts`) carries `gameId`, `title`,
`glyph`, `hue`, `markType`, `route`, a lazy-loaded `Component`, and optional gating
(`unlock.minVocabEntries`, `languages`).

The registry is consumed by:

- `src/games/flpBreak/index.ts` — the flp break rotation (`flpBreakCandidates` over
  `GAME_REGISTRY`, filtered to games with a break adapter).
- `src/routes/registry.ts` / `src/routes/routeMeta.ts` — mount one leaf route per
  `ROUTED_GAMES` entry (empty while `standaloneGames` is off), each in a `Suspense`
  boundary for the lazy component.

Net effect: adding a new game = one entry in `ALL_GAMES` + its Stage (and page, if
routed). No edits to the route tables.

### Layer 2 — Runtime (`src/games/runtime/`)

All live. The folder is a **grab-bag of shared game bits**, not a framework — no game
inherits a shell from it.

- **End-of-run popups** — none. The shared `GameEndPopup` shell and every game's end
  popup are gone (the last caller was archived 2026-11-23); every game runs as an flp
  break, whose results go to the break's card (§ Run tiers,
  [FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md) § 5b). The routed pages, behind the OFF
  `standaloneGames` flag, end on a frozen board ([DEFERRED_WORK.md](./DEFERRED_WORK.md)).
- **Answer-feedback sound** — there is none. Every game marks silently; narration
  (TTS) is the only audio (docs/AUDIO_PLAYBACK.md § 7).
- **`useBackgroundPause.ts`** — the app-wide backgrounding pause, which resumes by
  itself on return (§ Backgrounding pauses the clock).
- **`useActiveRunClock.ts`** — a hidden stopwatch of accumulated active time built on
  `useBackgroundPause`, read once at run end. Memory Map's speed tier (§ Run tiers);
  Superposition and Writing Grid keep inline copies of the same pattern.
- **The Study Challenge round runner** — five files, and the largest thing in here:
  - **`challengeScoring.ts`** — the pure, React-free spec runner (events → score +
    itemised breakdown). Written so the server can adopt it verbatim for live mode.
  - **`useChallengeRound.ts`** — what a game page actually mounts. Owns the round's
    scorer, its ACTIVE-TIME clock, the contested word set, the pool params and every
    round write. Inert for an ordinary launch, which is why no game needed an
    `if (challenge)` branch (§ Challenge-eligible games). Since the claim model
    ([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 5.1a) it also owns the round's
    LIFECYCLE: the first hit/miss claims the round server-side, each later mark pushes
    the cumulative score, and unmount or `pagehide` finalises it — so leaving a game
    mid-round is a scored, spent attempt rather than a free restart.
  - **`useGameBack.ts`** — a game page's Back handler: where it goes (the challenge
    mid-test, else `GAMES_HUB_EXIT`), plus the confirm an armed challenge round puts in
    front of it. Used by both challenge-eligible games (`MatchSpeedStage`,
    `WordSearchStage`).
  - **`ChallengeRoundScoreboard.tsx`** — the between-games board, rendered in place of a
    game's end-of-run surface during a challenge round. It PORTALS itself to
    `nearestOverlayHost` so it blacks out the whole screen including the leaf header —
    a game page writes it as an ordinary sibling of its popup and does nothing else.
  - **`challengeLaunch.ts`** — gameId → route + the nav state that page requires, plus
    the round's query params. The one place that knows Word Search needs a mode.
- **`useSidewaysStage.ts`** — the landscape-stage helper behind Speed Reading's
  rotated presentation (see `LeafPage`'s `hideHeader` render-prop form in
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)).

> **Deleted: the Pixi runtime scaffolding.** `GameStage.tsx` (generic Pixi.js
> host), `GamePage.tsx` (generic page shell), and `useGameActors.ts` (generic actor
> handle) were written ahead of the first game and **no game ever imported them**.
> They were removed in commit `70dc441`. Do not resurrect them speculatively — the
> shipped pattern is plain DOM (Match Speed and Speed Reading are DOM + timers). The app's one Pixi host was the Night Market's, removed 2026-11-09 and
> archived ([ARCHIVED_FEATURES.md](./ARCHIVED_FEATURES.md)) — a game that genuinely needs a WebGL
> scene graph should start from that archived host rather than a fresh unproven abstraction.

### Layer 2b — Shared surface chrome (`src/games/shared/`)

**`GameFrame.tsx`** — the visual frame every game plays inside
([SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A6, classes `.play` / `.hud` / `.timer`).
Presentational only; nothing here holds state.

- **`GameFrame`** (`.play`) — the inset white rounded panel between the leaf header and
  the page edge. It exists so the board's boundary is not the phone's. It is also `position: relative`, so a
  game's own overlays (a countdown, a pause veil) stop at the panel's rounded edge instead
  of covering its margin, and it gives a physics surface **one** element to measure for
  bounds. Under a `GameFrameHostContext` provider (`gameFrameExit.ts`) — only the flp game
  break provides one (docs/FLP_GAME_BREAKS.md § 6) — the game is the whole screen: the frame
  drops its inset, corner and line, `GameTimer` / `GameHud` drop their tint and hairline,
  the content fades in (the break's header row, drawn by the break area, was up through the
  circle grow), and `exitRowTrailing` portals game controls into that row. On a game's own
  route nothing extra shows. (A `tone="tower"` gold-slab
  variant existed unused and was removed 2026-11-04.)
- **`GameHud`** (`.hud`) + **`GameHudLabel`** (`.hud .lab`) — the bordered strip of mono
  facts across the panel's top. `space-between`, so the child count is load-bearing: two
  children pin to the edges, three put one in the middle — and so is the ORDER: only a
  middle child can appear and disappear without moving anything else, which is where a
  toggleable fact belongs. `divider={false}` suppresses the hairline
  for a HUD sitting directly under a `GameTimer`, which already draws one.
- **`GameHudBar`** — the HUD's optional third slot, `flex: 1`. It always restates a number
  a label beside it already gives; that is the point. The count is what you read when you
  look at the strip, the bar is what you see when you do not.
- **`GameHint`** — the one-line instruction at the panel's FOOT ("tap a word, then its
  meaning"). Deliberately a `.lab`: mono, uppercase, faint. A rule you need on your first
  run and never read again should be legible on request and invisible the rest of the
  time — as body text the panel would look like it was explaining itself every round.
- **`GameTimer`** (`.timer` + `.trk`) — tabular numerals over an optional 4px drain track
  (omit `fraction` for a bare stopwatch). **Every game's visible clock is this component** —
  no game draws one today (Writing Grid dropped its clock 2026-11-01) — in the style Word Search's HUD clock had when it was
  standardized (2026-10-06; Word Search itself has shown no clock since 2026-11-01): `DATA_TYPE` (was `FONTS.mono` until 2026-11-13), `SIZE.bodyLg`, normal case/tracking, regular
  weight, on a strip padded like `GameHud` (`12px 15px`). Only **colour** varies per game:
  the strip's hue tint (`useGameSurfaceHue`) and `valueColor`.
  Opt-in show/hide eye via `valueShown` / `onToggleValueShown` (`TimerEyeToggle`), always
  pinned to the strip's **left** edge in both states (since 2026-10-18; it used to sit
  right and jump to centre when hidden — docs/FLP_GAME_BREAKS.md § 7).
  Optional `trailing` slot pinned to the strip's top-**right** corner (absolutely
  positioned, so it never shifts the centred clock or grows the strip). (Was `leading`, top-left, until the eye took the left edge.)
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

**The status-bar strip follows the ground too — by two different mechanisms.**

- **iOS home-screen app (the one that matters):** the strip is PAGE PIXELS. Since
  `viewport-fit=cover` the accent ground itself runs up behind the clock, and the leaf
  header clears it with `SAFE_TOP`. Nothing game-specific is involved.
- **Safari tabs / Android Chrome:** the browser paints its own chrome from
  `<meta name="theme-color">`, so `GameSurfaceProvider` also calls
  `useThemeColor(RAMP[hue].mid)` (`src/hooks/useThemeColor.ts`) for as long as the game
  is mounted — on the provider rather than in each game, so both colours come from the
  one `hue`. Default (every non-game screen) is `COLORS.background`, declared in
  `index.html`.

The 2026-08-28 `theme-color` work did NOT fix the standalone app: a letterboxed web view's
strip is filled by iOS from the background it captured at launch, and no runtime write
reaches it. See [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) § Safe areas and the iOS
status bar.

**Which hue a game gets is `GameDef.hue` — and since v2 that EQUALS the artboard's.** Each
game's `GAME_HUE` (its own `constants.ts`) drives both the hub row and the ground, so the
two cannot drift. The hues are the artboards' own (SHELF_REDESIGN.md artboards 12–16):
Word Search `pur`, Match Speed `blu`, Speed Reading `yel`; Memory Map, which has no artboard, is `blu` (since 2026-10-06; `org` before — so it
shares Match Speed's hue). Until 2026-09-24 three of
them differed from the artboards (Match Speed green, Speed Reading blue, and a third, now archived) and
this paragraph explained why the hub won; teal then left the palette and the three moved.
Source: `src/games/shared/gameSurface.ts` header ("WHICH HUE A GAME GETS").

**The header flips are CSS descendant selectors, the panel's are not.** The header route
avoids threading an `onAccent` flag through `LeafPage` → `PageHeader` →
`HeaderIconButton`/`HeaderToggleChip`/`MinutePointsFireBadge`, and it is the design's own
mechanism (`#bm .lhd h1{color:#fff}`). `GameHud`/`GameTimer`/`GameFrame` read the context
instead, because a HUD label's colour is overridable per call site (a lives counter turning
red) and a blanket descendant rule would silently clobber it. One detail worth keeping: the
chip outline is an inset `box-shadow`, not a `border` — a border would add 2px per chip, and
the leaf header is already tight enough that a long game title ellipsises.

**What the frame does NOT discharge:** `useBlockEdgeSwipe(true)` and `touchAction: "none"`
stay the page's job. The edge-swipe block is a document-level touch handler with a
lifecycle, and hiding it inside a layout wrapper would make "why can I still swipe out of
this game" invisible to whoever reads the page.

**Every popup stays OUTSIDE the frame** — e.g. `ProvisionalSortOffer`. Each covers the whole content area and must not be
clipped by the panel's radius.

All the games are framed; Word Search and Match Speed use `GameHud` for their strip as
well — see entries 12–16 of [SHELF_REDESIGN.md](./SHELF_REDESIGN.md). Match Speed shows
no clock during play; its finish time appears on the end card.

Speed Reading draws no `GameHud` (removed 2026-11-04, with its round counter and
round-tick strip; SPEED_READING_GAME.md § Screen layout). Its board is still its own
`.speed-reading__board` box: the tap zones are `inset: 0` of their container, so anything
sharing that container is under them and every tap on it would answer the round.

### Layer 3 — Data hooks

**There is no `src/games/hooks/` folder.** It held four hooks, all now deleted:

| Hook | Fate |
| --- | --- |
| `useVocabEntries` (`GET /api/vocabentries`) | deleted 2026-07-28 — exposed a flat `definition?: string \| null` with no sense fields, so a new game written against it would have silently produced sense-blind definitions |
| `useDictionaryEntries` (`GET /api/dictionary/lookup/:term`) | deleted 2026-07-28, same reason |
| `useGameAssets(gameId)` | deleted in `70dc441` — existed only to feed `GameStage`'s texture preload |
| `useGameProgress<TState>(gameId)` | deleted in `70dc441` — unused; Word Search persists its board to `localStorage` (`gameStateStorage.ts`) instead |

Their server halves (the generic `/api/games/:gameId/assets|progress` routes and the
`gameassets` / `gameprogress` tables) were deleted 2026-11-23; migration 206 drops the
tables. `/api/games/speedReading/*` (`server/routes/speedReadingRoutes.ts`) is unrelated
and live.

Games talk to the server through `src/api/http.ts` (the typed cookie-auth `fetch`
wrapper — `apiGet` / `apiPost`), which inherits transparent token-refresh from the
global fetch interceptor (`src/utils/fetchInterceptor.ts`). **Game vocab comes from
the OnDeck endpoints**, never from a generic vocab hook; see the rule below.

#### Game pool request (`src/api/gamePool.ts`)

Every `GET /api/onDeck/gamePool` call goes through **one** function,
`fetchGamePool(req: GamePoolRequest)`, built on `apiGet`, with one exported
`GamePoolResponse` type. The querystring is built by the pure, tested `gamePoolParams`
(`src/api/__tests__/gamePool.test.ts`).

| Field | Wire param | Meaning |
|---|---|---|
| `markType` | `markType` | Track the game marks — buckets and cooldown follow it |
| `surface` | `surface` | Names the `CARD_BASELINES` entry a full board lends up to |
| `distribution` | `Unfamiliar`/`Target`/`Comfortable`/`Mastered` | Band quotas |
| `need` | `need` | Present = partial refill (no baseline top-up) |
| `exclude` / `avoid` | `exclude` / `avoid` | Hard exclude / soft demote, comma-joined; omitted when empty |
| `seedIds` | `seedIds` | Put these on the board FIRST if the game's mark on them counts and they are under pbh 6 on the game's bar (`isBreakSeedPlayable`); the rest are never dealt. An flp game break's working loop — docs/FLP_GAME_BREAKS.md § 4. Capped at 40 server-side |
| `flpBreak` | `flpBreak=1` | This board is an flp game break — in a focused world the server draws from outside today's set (FOCUS_MODE.md § 4a). Sent on the opening board and every top-up |
| `challengeParams` | `challengeId`/`gameId`/`mode`/`anytime` | `useChallengeRound().poolParams`, passed verbatim |
| `excludeContested` | `contested=exclude` | Sent only when `challengeParams` is set |

**There is no client "lend" flag.** Lending is decided server-side
(`OnDeckVocabController.getGamePool`): a full board (no `need`) runs `ensureBaseline`
against `CARD_BASELINES[surface]` (or the distribution's sum when `surface` is absent);
a refill (`need`) never lends. So a caller always sends its real `surface`.

Callers: Match Speed (`MatchSpeedStage` → `fetchPool`), Speed Reading
(`useSpeedReadingQueue` → `fetchPool`, built by `speedReadingPoolRequest`). **Not** through it: Word Search
(`GET /api/onDeck/wordSearchGrid`), Memory Map (`src/api/memoryMap.ts`), Writing Grid
(`src/api/writingGrid.ts`) — each has its own endpoint.

⚠️ One caller sends no `need` where a reader might expect one, so the server runs the
baseline check on each call: **Match Speed's mid-run buffer top-ups** (every refill
tick). It predates the shared module and was preserved as-is.

### Layer 4 — Backend (`server/`)

There is no generic games backend. The `gameassets` / `gameprogress` tables and their
`/api/games/:gameId/assets|progress` routes (`GamesController`, `GameAssetService`,
`GameProgressService` and their DALs) were deleted 2026-11-23; migration
`database/migrations/206-drop-game-framework-and-archived-game-rows.sql` drops the tables.
Games use the OnDeck endpoints for cards (`server/routes/onDeckRoutes.ts`), plus
per-game routers where a game needs its own data: `/api/games/speedReading/*`
(`server/routes/speedReadingRoutes.ts`), Memory Map (`server/routes/memoryMapRoutes.ts`),
Writing Grid (`server/routes/writingGridRoutes.ts`).

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

- **Match Speed / Speed Reading** resolve on the client. `gamePool` selects
  `ve.*, ${DICT_COLS}` (`OnDeckVocabService.fetchGameCandidates`), so `selectedSense`
  (from `ve.*`) and `definitionClusters` (`server/dal/shared/dictJoin.ts`) both reach the
  browser, where the card calls `resolveDisplayDefinition(entry)`.
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
  the same as discover cards and the Dictionary page's eip.

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
| Game pool | Match Speed, Speed Reading | `OnDeckVocabService.getGameVocabPool` → `takenDds` inside `drain` |
| Word Search grid | Word Search | `OnDeckVocabService.getWordSearchGrid` → `takenDds` inside `drain` |
| Memory Map fill | Memory Map | `MemoryMapService.selectOccupants` → `takenDds` |

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
  best-effort contract every fill tier already has.
- **Partial refills are seeded from the cards already on screen.** A refilling caller
  already sends `exclude` = every card on the board or in its buffer; the pool looks
  up those cards' dds (`OnDeckVocabService.fetchDdKeys`) and seeds `takenDds` with
  them, so a replacement cannot collide with a card the player is looking at. No
  client change was needed for this, and none should be added — `exclude` is the
  wire contract, dd resolution is the server's job.
- **Word Search releases a key on eviction.** Its substring de-dup loop drops words
  back out of the selection, and a dropped word's dd has to become available again or
  the replacement pass would be reserving a gloss nothing is showing.

**Memory Map is the strict case.** A slot is durable, so a collision admitted once
sits on the map for as long as the word does. Its guard seeds from the words already on
the map and runs on the graduation refill path too (where the whole map is seeded and
one occupant is wanted). A collision costs the map nothing — the next non-colliding
candidate takes the slot, lending again if the colliding word was lent.

**Near-identical glosses** — "a little" vs "a bit" — are NOT covered by this rule; the
key is exact equality. The unbuilt phase-2 design that would extend it (offline NLI
pipeline → one `meaningGroupId` per gloss, swapped in as the key of the same three sets) is
[GLOSS_CONFUSABILITY.md](./GLOSS_CONFUSABILITY.md).

**Adding a new game:** if it draws from `/api/onDeck/gamePool` it is already covered.
If it composes a round from another source (a Study Challenge word set riding a
game's slots, say), it must apply the same key — and a client-side composer needs a
`ddCollisionKey` twin in `src/utils/definitionUtils.ts` that normalizes identically.

### The countdown

Every flp break game opens on a **3 · 2 · 1** over its readable opening board: Match Speed,
Word Search, Writing Grid, Superposition, Speed Reading and Memory Map. The opening board gets a beat to be read, and the
run's clock starts on the release, so no reading time is billed. There is **no "Go!" card**.
The release is the dim lifting, with its own beep (owner, 2026-11-10; until then Match
Speed and Writing Grid showed 3·2·1·Go, four steps).

- **The dim covers the whole screen.** It is portaled to the phone frame
  (`useScreenOverlayHost`, z 150), so Leave's row and the status band dim with the board.
  Until 2026-11-10 it dimmed only the game panel and left Leave's row lit.
- **Leave stays usable.** The dim is pointer-transparent. A second layer, the **input
  shield**, is rendered in place inside the game's `GameFrame` at z 5, under the exit row
  (z 6), and swallows taps aimed at the board. So during the count the Leave arrow and the
  audio chip work and the board does not. `<GameCountdown>` must be a direct child of the
  `GameFrame`.
- **Sound.** A tick per digit and a different release beep, which honour the audio chip
  ([AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md) § 7a).
- **Timing.** `COUNTDOWN_STEPS` × `COUNTDOWN_STEP_MS` (3 × 700 ms). `paused`
  (backgrounding) freezes the count; the step that was up gets its full time again on
  resume, and its tick is not replayed.
- **The lent-cards notice comes first.** `ProvisionalCardsNotice` lives inside the break
  area's stacking context, under the frame-level dim, so a Stage with a notice keeps the
  countdown inactive until the notice is dismissed (`active: … && !noticeOpen`). It does
  not pause the count behind the notice.
- **How each Stage holds its run:**

| Game | Starts when | Held during the count |
|---|---|---|
| Match Speed | the pool is dealt (`phase: "countdown"`) | the board is `frozen`; the stopwatch starts at `"playing"` |
| Writing Grid | the deal lands (`phase: "countdown"`) | read-only Phase 1; `startStopwatch` on release |
| Word Search | `startBoard` / `restoreBoard` (`counting`) | the clock is started then paused; `counting` feeds `clockPaused` and the challenge round's `paused` |
| Superposition | the board (grid + tray) has measured itself (`handleMeasured`) | `running` is false: no stopwatch, no hint |
| Speed Reading | the first round is built (`counting`) | `counting` feeds `clockPaused` (the origin shift un-bills it); no pick, no narration of round 1 |
| Memory Map | the first `playing` render, once per break | `useActiveRunClock` waits; the first prompt's word waits |

A Leave during the count takes each game's existing Leave path. Match Speed, Word Search,
Superposition and Speed Reading end the run, so the results card shows an empty run. Writing
Grid and Memory Map (with nothing found yet) close the break with no run, because their
Leave treats a not-yet-started run as "nothing to report". Each Stage gates `active` on its
live phase, so the dim goes down with the run either way.

*Code:* `src/games/shared/useGameCountdown.ts` → `useGameCountdown`, `COUNTDOWN_STEPS`,
`COUNTDOWN_STEP_MS`; `src/games/shared/GameCountdown.tsx` → `GameCountdown`;
`src/services/sfx/countdownSounds.ts` → `playCountdownSound`.

### Popups pause the clock

**The rule:** no game's clock — or whatever else in that game advances on its own
and can end a run — may run while a **modal, input-blocking popup** covers the
board. Reading a popup is not playing, so it must not be billed to the player.

Each page derives one boolean, `clockPaused`, from its own popup state and feeds
it to whatever moves on its own:

| Game | `clockPaused` is true while | What freezes | Code |
| --- | --- | --- | --- |
| Match Speed | the provisional notice is open | the run clock (the 3·2·1 countdown does not start until the notice is dismissed — § The countdown) | `MatchSpeedStage.tsx` (`clockPaused`, `useGameCountdown`, the run-clock effect) |
| Word Search | the provisional notice is open, or the countdown is up (`counting`) | the count-up clock, via the existing `pauseTimer`/`resumeTimer` pair | `WordSearchStage.tsx` (`clockPaused`, `clockPausedRef`, the pause effect) |
| Speed Reading | the provisional notice is open, or the countdown is up (`counting`) | the count-up clock — `startAtRef` is pushed forward by the paused span on resume | `SpeedReadingStage.tsx` (`clockPaused`, `pausedAtRef`, the pause effect) |

Three consequences worth keeping in mind when adding a popup or a game:

- **Only input-blocking overlays qualify.** `ProvisionalCardsNotice` takes the whole
  screen, so a frozen clock cannot be used to study a live board. (Word Search's
  settings sheet was a second such overlay until it was deleted on 2026-09-30.) Word Search's in-grid gloss popups are deliberately
  **excluded**: they are small anchored tooltips that leave the board playable, so
  pausing on them would hand the player a free stopwatch stop. Match Speed lost its
  settings-sheet pause source on 2026-08-28 when that sheet was deleted — its
  replacements are header chips, which leave the board playable and correctly do
  **not** pause ([AUDIO_PLAYBACK.md](./AUDIO_PLAYBACK.md)).
- **End-of-run surfaces are irrelevant.** The break's results card and
  `ProvisionalSortOffer` only ever open once the run is scored and the clock
  has already stopped.
- **Resume must not pay the pause back.** A count-up clock moves its origin forward
  (Speed Reading), banks each stretch of play (Match Speed's hidden stopwatch) or uses an explicit
  pause/resume pair (Word Search).

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

**The rule protects a CLOCK, so a genuinely clockless game is exempt** (Memory Map —
§ What Memory Map introduced). A game qualifies for this exemption only if **nothing**
advances unattended; if any part of it is timed the rule applies in full to that part.

**Status — ✅ every timed game pauses (first four completed 2026-08-17):**

| Game | How |
| --- | --- |
| Word Search | its own earlier implementation — `WordSearchStage.tsx` listens for `visibilitychange`, calls `persistSnapshot()` then `pauseTimer()`, and resumes only if `clockPausedRef.current` is false. **This is what the rule was generalised from**, and it is deliberately left as-is (its localStorage snapshot is entangled with its pause path) |
| Match Speed | `useBackgroundPause(countdown \|\| playing)` → the existing `clockPaused` (countdown + run clock) |
| Speed Reading | `useBackgroundPause(phase === "ready" \|\| phase === "feedback")` → the existing `clockPaused` (`pausedAtRef`, the clock effect) |
| Writing Grid | `useBackgroundPause(arrange \|\| write)` → holds the accumulated-active-time stopwatch |
| Superposition | `useBackgroundPause(running)` → holds the stopwatch and the hint countdown |

The three that needed it got a **signal wired to a gate they already had**, not a new
pause implementation — which is what the 2026-08-16 audit predicted.

**The shared piece** (`src/games/runtime/useBackgroundPause.ts`):

* **`useBackgroundPause(active)`** → `{ paused }` — true while the app is hidden
  (`visibilitychange` *and* `pagehide`; neither is sufficient alone: `pagehide` is the one
  iOS Safari fires on swipe-away and screen lock), and it **clears by itself** when the
  player returns (`visibilitychange` → visible, or `pageshow`). `active` should be the
  game's playing condition; leaving it clears the pause.
* **No resume screen (2026-11-02).** The old `GamePausedOverlay` — an opaque
  "Paused / Resume" scrim the player had to tap through, latched by the hook — was
  deleted app-wide, challenge rounds and flp breaks included, as friction. Every game now
  behaves the way Word Search always did. Accepted trade-off: the board is not hidden on
  return, but it is only visible while the clock is running again, so it buys no free
  study time.

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

### Run tiers

A finished run is graded on two axes, **speed** and **accuracy**, each with **seven
numbered tiers**. They replaced the gold / silver / bronze medals on 2026-11-10. Tiers are
bare numbers for now ("Speed 3"); names and art are to come.

- **Tier 1 is the best, tier 7 the lowest.** Every *finished* run lands on a tier on each
  axis it has: tier 7 catches everything past tier 6's cutoff, so there is no untiered
  finish (unlike the old no-medal outcome).
- **An unfinished run gets no tiers.** Left early (an flp break's Leave) or ran out of cards: the results card says "Run ended" / "Out of cards" with no
  chips. That is the caller's decision; the engine only grades.
- **Ladders are per game.** A ladder is six cutoffs, best-first. Speed cutoffs are finish
  times in ms (lower is better); accuracy cutoffs are the right-answer share 0–1 (higher is
  better). Each game owns its `SPEED_TIERS` and, where it counts errors, its
  `ACCURACY_TIERS`, in its `constants.ts`. **Every cutoff is a placeholder** until tuned
  from play data.
- **Wins are not gated on a tier.** Any finished run logs its win
  (`POST /api/users/me/wins`) in the games that keep wins.
- **Display:** two large outlined panels under the results card's heading, **speed stacked
  above accuracy** (`RunTierPanels`), and nothing else on a finished run's card. Each panel
  is a big tier numeral beside its axis label and figure: **speed** shows the run's time and
  the personal best; **accuracy** shows "correct/attempts · percent". A game with no accuracy
  tier shows only the speed panel. The time shown is always the real one, even where the
  grade uses a scaled time (Word Search, Memory Map).

| Game | Speed graded on | Accuracy graded on |
|---|---|---|
| Match Speed | time to 30 pairs | pairs / match attempts |
| Word Search | time to find every word, scaled to the 9-word board | — (misses not counted) |
| Speed Reading | raw time for 20 rounds (the +3s wrong-answer penalty was removed) | correct / 20 |
| Writing Grid | total active time | — |
| Superposition | time to build the 4 characters | — |
| Memory Map | hidden active-time clock, scaled to a full `BREAK_PROMPTS` quota | "knew it" (green) / words found |

Code: `src/games/shared/runTiers.ts` → `RunTier`, `RunTiers`, `SpeedResult`,
`AccuracyResult`, `gradeSpeed`, `gradeAccuracy`, `formatAccuracy` (on `speedTierFor` /
`accuracyTierFor`); `src/games/shared/RunTierPanels.tsx`; `src/games/shared/PersonalBestLine.tsx`
(`align`); each game's `constants.ts` → `SPEED_TIERS`, `ACCURACY_TIERS`, `runResultTiers`
(Writing Grid and Superposition call `gradeSpeed` from their Stage); `src/games/runtime/useActiveRunClock.ts` (Memory Map's
clock); `src/games/flpBreak/types.ts` → `FlpBreakResults.tiers`.
Docs that depend on it: [FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md) § 5b, and each game's doc.

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
  (Word Search's per-second `elapsedPenalty`, a `perUse` cost);
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

Five things, and no more — everything else is shared. The hook
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
3. **Call `challengeRound.finish(won)`** where your run ends.
4. **Render `<ChallengeRoundScoreboard round={challengeRound} classPrefix="…" />`** in
   place of your own end-of-run popup while `challengeRound.active`. Put it wherever the
   popup went; it portals out to a full-screen host itself, so it does not matter which
   of your boxes it is written inside.
5. **Take your Back handler from `useGameBack(challengeRound)`.** It routes to the
   challenge mid-test and to `/games` otherwise, and — once the round is armed — it
   confirms before leaving, because leaving ENDS the round (below).

Plus three guards that are easy to forget and silent when wrong:

* **Wait for the context.** Gate your first board on
  `if (challengeRound.active && !challengeRound.ready) return;`. A board dealt before the
  challenge payload lands classifies as 100% filler — a round scored at 20 points a card,
  with nothing afterwards to reveal that it went wrong.
* **No restart, no Play Again.** Rounds are one attempt each; hide both controls while a
  challenge round is active.
* **Back comes from `useGameBack`**, never an inline `navigate` — otherwise the exit
  confirm is missing on exactly the page where the exit costs something.

**⚠️ The first mark SPENDS the round.** `emit`ing the first `hit`/`miss` claims the round
on the server, and from then on leaving the page — Back, a footer tab, a route change, a
tab close — finalises it at the score that stands, scored as a loss. Backgrounding still
merely pauses (§ Backgrounding pauses the clock); only actually leaving ends the round.
Two consequences for a game page: `challengeRound.armed` is what the Back confirm reads,
and a game must not navigate away from itself mid-run for its own reasons. The whole rule
is [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 5.1a.

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

There is no generic runtime to inherit from (§ Layer 2) — copy the closest shipped game
(Match Speed / Speed Reading for a timer-driven board, Word Search for a moded one). New
games are played as flp breaks, so most need only a Stage plus a break adapter in
`src/games/flpBreak/` ([FLP_GAME_BREAKS.md](./FLP_GAME_BREAKS.md) § 6); the steps below
that mention a page apply only to a routed game.

1. Create `src/games/<gameId>/<GameId>Page.tsx` (routed games only). Wrap it in
   `GameLeafPage` (down arrow, no footer) — every routed game is a leaf page, and
   `GAME_ROUTE_META` classifies every registry entry as `chrome: "leaf"`, so a game
   that wants the footer needs a `chrome` field on `GameDef` first. **Do not** add a
   per-page `IPhoneFrame` — the frame comes from `MobileDemoFrame` via `Layout.tsx`.
2. Fetch vocab from the OnDeck stack, not from a generic vocab endpoint:
   `GET /api/onDeck/gamePool?<Category>=<n>...` returns library cards bucketed by
   the mark type the game emits. Call it through `fetchGamePool` (`src/api/gamePool.ts`,
   § "Game pool request") — never a hand-built querystring. Declare that mark type ONCE as `MARK_TYPE` in your
   game's `constants.ts` and read it from there for the `?markType=` query, the
   `markFlashcard({ type })` call, and your `GameDef.markType` (which challenge
   eligibility is derived from — `src/games/__tests__/challengePool.test.ts`; a MODED game
   declares `GameDef.modes` instead, as Word Search does). Hub tiles
   are **name-only** (2026-10-03): `GameDef` has no `subtitle`, and the hub does not
   label a tile with its track. If your game's mark type varies by mode, omit
   `GameDef.markType` and put the type on each mode config instead, the way Word Search
   does. See the backend notes under
   [§ Game pool backend](#game-pool-backend-apiondeckgamepool) and
   [MASTERY_REWORK.md § "Games select by their own mark type"](./MASTERY_REWORK.md). Also pass `surface=<your-game>` so the server
   tops the player up to your baseline (`CARD_BASELINES` in `server/contracts/wire.ts`).
   **Do NOT block entry on `sufficient === false`** — after provisioning it can only be
   false when the dictionary itself is exhausted, and a short round still plays. Show
   `ProvisionalCardsNotice` before the round and `ProvisionalSortOffer` after it
   (drive the latter with `useProvisionalSortOffer(roundIsOver, lentWords)` and render
   it as a SIBLING of your end-of-run surface, so it stacks over the result). See
   [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md).
3. **Render definitions through `resolveDisplayDefinition`** — see
   [§ Sense correctness](#sense-correctness--every-game-must-honor-the-learners-selected-sense).
   This is the single easiest thing to get wrong in a new game.
4. Emit review marks with `POST /api/flashcards/mark` (`type` = the one track the
   game trains: `recognition` / `production` / `reading` / `writing`), and wins
   with `POST /api/users/me/wins` if the hub should show a win badge.
5. Add the route to `MINUTE_POINTS_ELIGIBLE_PAGES` (and the start-on-entry subset)
   in `src/constants.ts` so play time accrues points and streak.
6. Report the run through the break's `onRunEnded` with a `tiers` value: give the game a
   `SPEED_TIERS` ladder (and `ACCURACY_TIERS` if it counts errors) in its `constants.ts`
   (§ Run tiers). Games run as flp breaks, so there is no end popup to build.
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
9. Append the `GameDef` to `ALL_GAMES` in `src/games/registry.ts`, and add its slug to
   `KNOWN_GAME_IDS` (`server/constants.ts`) and `GAME_FLAGS`
   (`server/contracts/featureFlags.ts`) — the build fails until it has a flag:

   ```ts
   {
     gameId: "<gameId>",
     title: "...",
     route: "/games/<gameId>",
     Component: React.lazy(() => import("./<gameId>/<GameId>Page")),
   }
   ```

Steps 1–8 are the game. Step 9 is all the wiring: the router, the phone frame and the
break rotation configure themselves from the registry.

### Removing a game — retire it from challenges FIRST

✅ **In force since 2026-08-22**, when the challenge round runner shipped
([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md)). It lives here because the constraint
belongs with the games registry, not with the feature that discovered it.

A Study Challenge draws its game ids **at issue time on Monday** and stores them in
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

- `src/components/MobileFooter.tsx` — footer tabs (Deck / Menu / Arena / Dictionary)
- `src/components/MobileDemoFrame.tsx` — shared phone-frame container
- `src/components/MobileDemoHeader.tsx` — shared header (back / title / active badge / extraActions); no hamburger
- `src/components/PageHeader.tsx` — base header (renamed `rightItems` → `rightContent`)
- `src/components/Layout.tsx` — wires `MobileDemoFrame` into `shell: "frame"` routes (from `src/routes/routeMeta.ts`)
- `src/games/registry.ts` — central `GAME_REGISTRY`, `ROUTED_GAMES`, `isRoutedGame`, `GAME_ROUTES`
- `src/games/types.ts` — `GameDef` (routed vs break-only), `RoutedGameDef`
- `src/games/runtime/useSidewaysStage.ts` — landscape-stage helper (Speed Reading)
- `src/games/shared/GameFrame.tsx` — `GameFrame` / `GameHud` / `GameHudLabel` / `GameHudBar` / `GameHint` / `GameTimer`; the `.play` panel every game plays inside (§ Layer 2b)
- `src/routes/routeMeta.ts` — `GAME_ROUTE_META` derives one `chrome: "leaf"` row per registry entry
- *(deleted — do not look for these: `runtime/GameStage.tsx`, `runtime/GamePage.tsx`, `runtime/useGameActors.ts`, and the whole `src/games/hooks/` folder; see § Layer 2 / § Layer 3)*
- `src/utils/definitionUtils.ts` / `server/utils/definitions.ts` — the dd resolvers every game's definition text must go through
- `server/routes/onDeckRoutes.ts` — `gamePool` / `wordSearchGrid` route registration (camelCase paths — project convention, see [BACKEND_LAYERING.md](./BACKEND_LAYERING.md))

## Game: Word Search (`/games/word-search`)

Second game (built). Find 12 of your own vocab words — shown as English glosses —
hidden as snaking (orthogonal) paths in a 9×6 grid of colored-pinyin (cpcd)
characters. Drag or tap to trace; any valid multi-char selection pops a
dictionary info-card + audio. Count-up timer → speed tier on completion (§ Run tiers). Reuses
the game pool's category + fallback distribution, adds a substring de-dup pass and a
server-side snaking grid generator (`GET /api/onDeck/wordSearchGrid`). Full
spec + file map: → [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md).

## Pinyin is a per-game setting

> STATUS: **DESIGN — decided 2026-08-23, NOT BUILT.** Today Match Speed reads *and
> writes* the ONE shared `showPinyin` boolean in `useFlashcardLearnSettings`
> (`src/hooks/useFlashcardLearnSettings.ts`, stored as `flashcard.learn-settings`), which
> is the **flp's** setting. Code to change: `MatchSpeedPage`, `MatchSpeedStage`.

**Every game owns its own pinyin preference.** "Show pinyin" is not one app-wide
display taste: on a zh board it decides *what skill the board tests*
([MASTERY_REWORK.md § 1a](./MASTERY_REWORK.md)), so it belongs to the surface doing
the testing, not to a global blob.

Sharing it leaks:

* **Between a drill and its reference material.** The flp owns
  `flashcard.learn-settings`, and td's card view (`showPinyinColor` only — it always shows pinyin), the acp and the Dictionary page's eip read it as a
  *reading* preference. A game that writes that key is editing the learner's flashcard
  display from inside a game.

The rule, and how much of it already holds:

| Surface | Where its pinyin preference lives |
|---|---|
| flp (+ td's card view, acp, Dictionary eip) | `useFlashcardLearnSettings` — **unchanged**; the flp keeps this key and becomes its only writer |
| **Word Search** | ✅ already per-game — a property of the MODE (`MODE_CONFIGS`, `src/games/word-search/constants.ts`). The precedent. |
| **Memory Map** | ✅ already per-game — never draws pinyin at all (since 2026-10-06 it renders bare measured characters, not `ForeignText`); it is a reading map |
| **Speed Reading** | ✅ already per-game — hardcoded false; the prompt would spoil itself |
| **Match Speed** | ✳ its own persisted setting (display only — Match Speed stays `recognition`) |

Follow the existing per-surface pattern — `useLocalGameSettings`
(`src/games/shared/useLocalGameSettings.ts`) and `useDiscoverSettings`
(`src/hooks/useDiscoverSettings.ts`): one hook per game over its own localStorage key,
defaults merged on read so adding a knob later needs no migration. Four of the five
surfaces are already there; this finishes the job rather than inventing a mechanism.

**Defaults stay `true`** (pinyin shown) everywhere. A learner who had hidden pinyin
globally sees it again in Match Speed until they hide it there; that reset is intended —
the old global value was never a statement about any particular game.

**Language gating is unchanged.** Every pinyin control stays hidden for Latin-script
languages (`isLatinScriptLang`), and `es` never switches track at all
([MASTERY_REWORK.md § 1a](./MASTERY_REWORK.md)).

⚠️ **A per-game setting must not become a per-game *track* by accident.** Match Speed
gets its own toggle for display only and keeps marking `recognition` on its own page
(as an flp break, the reading flp's hidden pinyin switches it to `reading` —
`GameDef.noPinyinMarkType`). A game whose pool is bucketed and cooled on one track must
never write marks on another — they are dropped by the "next markable at" guard
([FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md § "Cooldown is a hard next-markable-at"](./FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md)).

## Game pool backend (`/api/onDeck/gamePool`)

Reuses the OnDeck vocab stack### Backend

The OnDeck vocab stack (no tables of its own). Endpoints registered in
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
  emits (Match Speed `recognition`; Speed Reading `reading`) and
  candidates are bucketed by that track's own recent mark history
  (`compute_type_category`), not by the whole-card **core** mastery bar the flp
  and the Deck Tower use — so each game's difficulty distribution reflects the skill it
  actually trains. That same per-type category also selects the card's cooldown
  window. See [MASTERY_REWORK.md § "Games select by their own mark type"](./MASTERY_REWORK.md).
  **Each returned card carries `gameCategory`** — the bucket it was actually drawn
  from (`fetchGameCandidates` stamps it as it partitions rows). It is NOT the same
  field as the card's `category`, which is the **core** mastery bar's band; both
  ride on the entry and mean different things, hence the explicit name. The stamp
  reports the queue *drained*, so it stays truthful when a short bucket is topped up
  from the fallback order. Match Speed sorts its per-category client-side card
  buffer by it (see [MATCH_SPEED_GAME.md](./MATCH_SPEED_GAME.md) § Backend change);
  other callers ignore it, so the field is purely additive.
  **Partial refill** (`&need=N&exclude=12,34&avoid=56,78`): returns only `N` cards. The per-bucket quotas are scaled by
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
  | 3. cooled | on its bar's cooldown clock, or know-track at core pbh ≥ 6 (flp-only, MASTERY_REWORK.md § 6) | requested buckets, then fallback order |
  | 4. avoided | ids passed as `avoid` (just cleared) | requested buckets, then fallback order |
  | 5. **lend** | **re-lent** — or newly minted — provisional cards | whatever is still missing |

  **A request always borrows across buckets before it lends**, however many buckets it
  names (`OnDeckVocabService.getGameVocabPool` → `substituting`). (A single-bucket request
  used to be treated as strict — no cross-bucket substitution — which lent cards to a
  learner with ~700 sorted cards when Match Speed's buffer top-up asked for one bucket;
  that inference was removed 2026-09-13.)

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

  Tier 5 is **skipped for a focus-scoped round** (`opts.collection`, the
  `CollectionFilter` slot, which only focus mode fills — a focused round padded with words
  outside the day's set is not that set; [FOCUS_MODE.md](./FOCUS_MODE.md) § 4) and
  for any **partial refill**. Every lend first **re-lends** provisional cards the
  learner already holds near that difficulty and off cooldown, and mints only the
  shortfall. See [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) §§ 3b, 4b.

  ⚠️ **Tier 3 hands out cards the learner cannot be marked on.** Since the cooldown
  became a hard "next markable at" (2026-08-18), `POST /api/flashcards/mark`
  silently declines a mark on a still-cooling track. The cooled tier exists precisely to
  serve cooling cards, so a learner playing two rounds back to back can clear a board
  and see no history move — and since 2026-08-20 that tier fires *ahead of* lending, so
  it happens more often, by design. This is **known, accepted and instrumented** — every
  dropped mark is logged as `[MarkSuppressed]`. Telling the learner is the open piece.
  See [FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md § "Known consequence: cooled-tier marks stop counting"](./FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md)
  and [DEFERRED_WORK.md](./DEFERRED_WORK.md).

  `exclude` is enforced in SQL (`fetchGameCandidates`'s `excludeIds`) and is
  absolute; `avoid` is a *tier demotion*, so a library too small to fill the board
  any other way still assembles one rather than starving.
  ⚠️ The avoided tier must be its own tier, **not** the tail of the matching
  category's cooled queue: every fill loop walks category-by-category, so a demoted
  Unfamiliar card parked in the Unfamiliar cooled queue is still drawn ahead of
  every Mastered cooled card — which is exactly how the first cut of this feature
  handed back the cards the player had just cleared.
- `GET /api/onDeck/categoryCounts` → `{ Unfamiliar, Target, Comfortable, Mastered }`,
  read by the Deck Tower's cards page (`useCardLibrary`) and the Account page.
