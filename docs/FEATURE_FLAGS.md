# Feature Flags

One registry file switches whole features, and individual games, on and off:
**`server/contracts/featureFlags.ts`** → `FEATURE_FLAGS`, `isFeatureEnabled`,
`GAME_FLAGS`, `isGameEnabled`.

**Status: BUILT 2026-09-19; `writingNotebook` added 2026-10-06. No migration of its own.** (The `nightMarket` and `immersiveWorld` flags were deleted with their features on 2026-11-09 — [ARCHIVED_FEATURES.md](./ARCHIVED_FEATURES.md).)

| Flag | Gates | State |
|---|---|---|
| `studyChallenge` | Weekly head-to-head between friends ([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md)) | **OFF** |
| `community` | **Sharing** card designs with other learners ([COMMUNITY_PAGE.md](./COMMUNITY_PAGE.md)) | **OFF** (since 2026-10-30) |
| `arena` | Weekly global division leaderboard ([ARENA_FEATURE.md](./ARENA_FEATURE.md)) | ON |
| `writingNotebook` | The Writing Notebook page and its entry, the paper stack on the Deck Tower's writing world ([WRITING_NOTEBOOK.md](./WRITING_NOTEBOOK.md)) | ON |
| `superpositionStoredGroups` | A data path, not a feature: Superposition reads the AI-authored tile groups stored on det instead of computing them ([SUPERPOSITION_GAME.md](./SUPERPOSITION_GAME.md) § Stored groups) | ON (since 2026-11-03) |
| `standaloneGames` | The five routed games' own pages (`/games/bubble-match`, `/word-search`, `/match-speed`, `/hydra-bubbles`, `/bucket-drop`). Client-only; their flp breaks are not gated ([GAMES_FEATURE.md](./GAMES_FEATURE.md)) | **OFF** (since 2026-11-06) |
| `GAME_FLAGS['<gameId>']` | One switch per game, eight of them ([GAMES_FEATURE.md](./GAMES_FEATURE.md)); `writing-grid` also gates the server's `/api/writingGrid/*` router (`server/server.ts`) | all ON |

**`studyChallenge`, `community` and `standaloneGames` are the only things currently switched off.** Every other
flag exists so it *can* be switched off, and documents what would go away if it were.

Before this, the app had no flag mechanism at all — CLAUDE.md records the previous house
practice plainly ("Half B has **no feature flag** — it went live the moment the containers
rebuilt"). Rollback was a deploy or a `TRUNCATE`. This file does not replace that for data;
it covers the narrower case of a feature that is **built but should not be reachable**.

---

## 1. Where it lives, and why

`server/contracts/` is already the home for things both halves of the app must agree on.
`src/types.ts` documents the one-directional reach in full: the backend Docker build
context is `./server`, so a shared module cannot live at the repo root without changing the
deployment, while the frontend image copies the whole repo — so `src/** → server/contracts/**`
works and the reverse does not. A flag is read by the server (which routers to mount) and by
the client (which routes and entry points to render), so it is exactly that shape of
agreement.

It is a **separate file from `wire.ts`** deliberately: `wire.ts` is ~105 KB of
cross-the-wire type contract, and "which features are on" should not have to be found
inside it.

**Flags are build-time constants, not runtime config.** Flipping one is a code change and
needs a redeploy of *both* containers — the client inlines its copy at bundle time. That is
deliberate: this repo has no config service, and a pair of env vars (`X` + `VITE_X`) would
read as live-flippable when the client half still requires a rebuild.

A flag is **not** a permission check — per-user gating is `users.isValidator` /
`users.isFeatureTester` / `users.isAdmin` — and **not** a data rollback.
Client tester surfaces additionally require a per-device switch on top of `isFeatureTester`:
see [FEATURE_TESTING.md](./FEATURE_TESTING.md).

Referenced by: `server/contracts/featureFlags.ts` (the file's own header points back here).

---

## 2. Feature flags

### 2a. `studyChallenge` — OFF

| Layer | Site |
|---|---|
| Server mount | `server/server.ts` → `app.use(studyChallengeRoutes)` — gates all of `/api/studyChallenges/*` |
| **Leak** | `server/controllers/OnDeckVocabController.ts` → `resolveChallengeRound` returns `null` early. One guard covers **both** callers (`gamePool` and `wordSearchGrid`), since the challenge board is the only thing either does differently. Deliberately a silent fall-through to an ordinary pool rather than the 400/404 an unplayable challenge gets — a bookmarked `?challengeId=` URL should still yield a casual board |
| Routes | `src/routes/routeMeta.ts` → `FLAGGED_OFF_PATHS` removes the three `/friends/challenges*` paths |
| Entry points | `src/features/friends/FriendsBody.tsx` — the Challenges `BentoTile` **and** its `fetchChallengeBadge` call (skipped, not caught: the endpoint is unmounted, so the request would 404 to learn `0`) |
| | `src/features/profile/UserProfilePage.tsx` → `renderBlockToggle` returns `null` |

**NOT gated:** the hourly `database/cron/expire-study-challenges.sql` pass keeps running, so
a challenge that was already live still resolves or expires on schedule instead of hanging
mid-week. No `study_challenges` row is touched.

### 2b. `community` — OFF

Gates **sharing**, not **authoring**.

| Layer | Site |
|---|---|
| Server mount | `server/server.ts` → `app.use(communityRoutes)` — the 7 `/api/community/*` endpoints (feeds, vote, unvote, `applyDesign`) |
| **Leak** | `server/routes/userRoutes.ts` → `GET /api/users/:userId/designs` is registered inside an `isFeatureEnabled('community')` block. It serves the same designs from **outside** `communityRoutes.ts`, so not mounting that router would otherwise leave it live |
| Routes | `src/routes/routeMeta.ts` → `FLAGGED_OFF_PATHS` removes `/community` |
| Entry points | `src/components/menuPopover/menuDestinations.ts` → `useMenuDestinations` — the Community row of the footer's Menu popover, the **only** navigational entry |
| | `src/features/profile/UserProfilePage.tsx` → `ProfileDesignGrid` (another account's designs, with its own vote flow) |
| | `src/data/tips.ts` — the Community tip (`feature: "community"`), which would otherwise point at a 404 |

**NOT gated:** designing your own cards. The card icon editor, `CardIconLayer`,
`cardIconLayout.ts`, `VocabEntryService.updateIconLayout` and the `author` column
([CARD_ICON_LAYOUT.md](./CARD_ICON_LAYOUT.md)) all stay live.

### 2c. `arena` — ON

| Layer | Site |
|---|---|
| Server mount | `server/server.ts` → `app.use(arenaRoutes)`. **Arena has no leaked endpoint** — all six `/api/arena*` paths live in `arenaRoutes.ts`, so this single mount is the whole server gate |
| Routes | `src/routes/routeMeta.ts` → `FLAGGED_OFF_PATHS` removes `/arena` |
| Entry point | `src/components/menuPopover/menuDestinations.ts` → `useMenuDestinations` — the Menu popover's Arena row, the only navigational entry (no footer tab since 2026-11-10, no row on `/friends`) |

**NOT gated, and worth knowing:**

- **`users."arenaMessage"` still ships on `GET /api/users/:id`.** It is in the explicit
  column list of `UserDAL.findById`. This is arena's analogue of a "leak", but it is a
  **column, not a route**, and gating it would mean building the DAL's select list
  conditionally — conditional SQL to hide a nullable string that no client code reads off
  that endpoint, and that nobody can set while `POST /api/arena/message` is unmounted.
  Left flowing on purpose; revisit only if a real disclosure concern appears.
- **The `cow-arena` hourly timer keeps running**, on the same reasoning as the challenge
  expiry pass: an arena week already in flight should finish its cycle rather than freeze.
- **`UserMinutePointsService`'s optional `arenaService`** is still injected. Per the
  no-gating-DI rule below, and harmless: `creditMinutes` finds no live membership when
  nobody can opt in, and the call is already best-effort inside a swallowed try/catch.
- No `arenas` / `arena_members` row, `user_languages.division`, `arenaOptInWeek` or
  `users."geoCell"` value is read or written differently because of the flag.


### 2d–2e. *(retired)*

`nightMarket` (2d) and `immersiveWorld` (2e) were deleted with their features on
2026-11-09 — [ARCHIVED_FEATURES.md](./ARCHIVED_FEATURES.md). The letters are kept so
existing § 2f+ citations stay valid.

### 2f. `writingNotebook` — ON

| Layer | Site |
|---|---|
| Server mount | `server/server.ts` → `app.use(writingNotebookRoutes)` — all five `/api/writingNotebook/*` endpoints. **No leaked endpoint**: the recogniser it calls is `recognizeChinese` in-process, not another route |
| Routes | `src/routes/routeMeta.ts` → `FLAGGED_OFF_PATHS` removes `/flashcards/writing/notebook` |
| Entry point | `src/features/flashcards/writingNotebook/notebookEntry.ts` → `useNotebookTotal` returns `undefined` with the flag off (skipping its summary fetch), and `DeckTowerPage` draws the writing world's paper stack — the only entry — only once that total is defined |

The notebook is a page, not a game, so it has a FEATURE flag rather than a `GAME_FLAGS`
entry. The `/flashcards/writing/notebook` row in `MINUTE_POINTS_ELIGIBLE_PAGES` is a path
list that simply stops matching.

### 2g. `superpositionStoredGroups` — ON

A data-path flag: no router, route or entry point. It decides where Superposition's tile groups
come from. On, they come from `dictionaryentries_zh."superpositionGroups"` (migration 180),
AI-authored by the `chinese/backfill-superposition-groups` pipeline step. Off, every device
computes them.

| Layer | Site |
|---|---|
| Service | `server/services/SuperpositionService.ts` → `deal` reads the column (`WritingGridDAL.findSuperpositionGroups`) and attaches `strokeGroups` only when on. Off, the column is never selected |
| Client | None needed: `board.ts` → `characterGroups` uses `strokeGroups` when the deal sends them, and computes for a character whose column is still NULL |

The writer is not gated. It is an ordinary pipeline step, and with the flag off its output is
simply unread.

### 2h. `standaloneGames` — OFF

A client-only route gate over the ROUTED games' pages. It exists because the Games hub that
launched them was deleted (2026-11-06): games are now played only as flp breaks inside the
Deck Tower, and their standalone pages would otherwise sit at reachable URLs with no way in.

| Layer | Site |
|---|---|
| Client | `src/games/registry.ts` → `ROUTED_GAMES` is `[]` while off. Through it: `GAME_ROUTE_META` (`routeMeta.ts`), `GAME_COMPONENTS` (`routes/registry.ts`), `GAME_ROUTES`, `originLabelFor`, and the route tests. The registry rows keep their `route` + `Component`, so `isRoutedGame` still tells routed from break-only |
| Server | **Not gated.** `/api/games/*` and the pool endpoints are shared with the flp breaks |
| Entry points | None to hide: the hub and its Menu row are deleted. Study Challenge's `src/games/runtime/challengeLaunch.ts` still names the five routes; it is reachable only while `studyChallenge` is on, so turning that on needs this on too |

**Why not five `GAME_FLAGS` entries:** a game flag filters `GAME_REGISTRY`, which also feeds
the flp break candidates, so it would remove Match Speed's and Word Search's breaks too.
**Side effect while off:** Bubble Match, Hydra Bubbles and Bucket Drop have no break in the
rotation, so they are unreachable (code kept). Switching it on needs no edit beyond the
boolean, but the pages come back with no launcher.

---

## 3. Per-game flags

`GAME_FLAGS` holds one boolean per game, keyed by the game's real slug — the same
`GameDef.gameId` / `gameassets.gameId` value the app already uses. A `gameBubbleMatch`-style
key would be a second spelling of an existing id, and the two could drift.

It is typed `Record<GameFlagId, boolean>` against `KNOWN_GAME_IDS` (via a **type-only**
import, erased at build, so no server code reaches the client bundle). **Adding a game is a
compile error until it is given a flag** — the alternative would let a new game silently
inherit a default and vanish from the hub.

| Layer | Site |
|---|---|
| Client | `src/games/registry.ts` → `GAME_REGISTRY = ALL_GAMES.filter((g) => isGameEnabled(g.gameId))`. **One chokepoint.** `ROUTED_GAMES` (the games with a `route`, further gated by `standaloneGames` — § 2h), and through it `GAME_ROUTE_META` in `routeMeta.ts`, `GAME_COMPONENTS` in `routes/registry.ts`, `GAME_ROUTES`, `originLabelFor` and the route tests, all derive from this array; so do the flp game-break candidates, which is the ONLY surface a break-only game (Speed Reading, Memory Map, Writing Grid, Superposition) has |
| Server | `server/controllers/GamesController.ts` → `isGameEnabled` on all three handlers (`getAssets`, `getProgress`, `saveProgress`) |
| Tips | `src/data/tips.ts` — a tip naming a game carries `game: "<slug>"` (Bubble Match, Word Search) and is filtered by `isGameEnabled`. Not derived from `GAME_REGISTRY`, so it is a second client site to remember |

A disabled game's route therefore **stops existing** rather than 404-ing from a live row.
Because `GAME_COMPONENTS` derives from the same filtered array, the registry's boot-time
"row with no component" check cannot fire, and its dev-only orphan warning has nothing to
report — so games need no `FLAGGED_OFF_PATHS` entry.

The server half matters independently: a hidden hub tile does not stop a bookmarked game
page from POSTing save state. All three handlers answer **404**, not 403 — to a client a
disabled game should be indistinguishable from one that does not exist, and "this exists but
is turned off" discloses unshipped work. `saveProgress` keeps its separate `isKnownGameId`
whitelist, which guards a different problem (unbounded save rows for invented slugs).

---

## 4. How the client route gate works

`ROUTE_META` filters `FLAGGED_OFF_PATHS` out of the route table. A path with no row **is not
a route**, so it falls through to `"*"` → `NotFoundPage`, and every consumer that derives
from that table (Layout's shell, the footer, the page transitions) stops knowing about it
for free.

**The component bindings in `src/routes/registry.ts` deliberately stay.** `APP_ROUTES` only
throws when a *row* lacks a component, never the reverse; the opposite direction is a
dev-only orphan `console.warn`, which now exempts `FLAGGED_OFF_PATHS`. Keeping the binding
is what makes flipping a flag back on a one-boolean change rather than a hunt for deleted
entries. The cost is only an unreferenced `lazy()` arrow — the page's chunk is built but
never fetched, because no route can match it.

`src/__tests__/routeRegistry.test.ts` derives its `/community` assertions from the flag for
the same reason, and its game assertions from `GAME_REGISTRY`, which is already filtered.

---

## 5. Adding a flag

1. Add one boolean to `FEATURE_FLAGS` with a comment saying what it gates.
2. Guard the feature's `app.use(...)` in `server/server.ts`.
3. **Find the leaks** — any endpoint, or column, serving the same feature from elsewhere.
   Two of the six feature flags have one; assume yours does too until you have checked.
4. Add its paths to `FLAGGED_OFF_PATHS` in `src/routes/routeMeta.ts`.
5. Guard every client entry point (tiles, shelves, buttons, badge fetches, tips).
   For tips, tag the entry in `src/data/tips.ts` with `feature:` (or `game:` for a game) —
   `TIPS` filters on it, so a tip about a switched-off feature never shows.

**DI wiring in `server/dal/setup.ts` is deliberately NOT gated.** Services are injected into
other services — `StudyChallengeService` into `FriendsService` as the unfriend resolver,
`CommunityLayoutDAL` into `UserProfileService`, `ArenaService` into
`UserMinutePointsService` — so skipping construction would mean teaching those call sites to
tolerate an absent dependency. That is a far larger change than declining to answer HTTP
requests, and it would have to be undone to turn the flag back on.

---

## 6. Deploying a flag flip

A flip is an ordinary `/deploy`: no migration, no runbook, no held-back step. Both
containers must rebuild — the server reads the constant at boot, the client inlines it at
bundle time, so rebuilding only one leaves a UI that offers pages the API refuses (or hides
pages the API still serves).

Turning a flag **off** is non-destructive: no rows are read, written or deleted, and every
table (`study_challenges`, `community_layout_votes`, `arenas`, the `author` column,
game save state) is left exactly as it was. Turning it back on restores the feature as it
stood.
