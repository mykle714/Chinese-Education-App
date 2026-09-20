# Feature Flags

One registry file switches whole features, and individual games, on and off:
**`server/contracts/featureFlags.ts`** → `FEATURE_FLAGS`, `isFeatureEnabled`,
`GAME_FLAGS`, `isGameEnabled`.

**Status: BUILT 2026-09-19; `nightMarket` + `immersiveWorld` added 2026-09-20. No migration.**

| Flag | Gates | State |
|---|---|---|
| `studyChallenge` | Weekly head-to-head between friends ([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md)) | **OFF** |
| `community` | **Sharing** card designs with other learners ([COMMUNITY_PAGE.md](./COMMUNITY_PAGE.md)) | ON |
| `arena` | Weekly global division leaderboard ([ARENA_FEATURE.md](./ARENA_FEATURE.md)) | ON |
| `nightMarket` | The market, its two authoring tools, and visiting someone else's ([NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md)) | ON |
| `immersiveWorld` | Scene list, one running scene, and the scene editor ([IMMERSIVE_WORLD.md](./IMMERSIVE_WORLD.md)) | ON |
| `GAME_FLAGS['<gameId>']` | One switch per game, six of them ([GAMES_FEATURE.md](./GAMES_FEATURE.md)) | all ON |

**`studyChallenge` is the only thing currently switched off.** Every other flag exists so
it *can* be switched off, and documents what would go away if it were.

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
`users.isTemplateAuthor` — and **not** a data rollback.

Referenced by: `server/contracts/featureFlags.ts` (the file's own header points back here).

---

## 2. Feature flags

### 2a. `studyChallenge` — OFF

| Layer | Site |
|---|---|
| Server mount | `server/server.ts` → `app.use(studyChallengeRoutes)` — gates all of `/api/studyChallenges/*` |
| **Leak** | `server/controllers/OnDeckVocabController.ts` → `resolveChallengeRound` returns `null` early. One guard covers **both** callers (`gamePool` and `wordSearchGrid`), since the challenge board is the only thing either does differently. Deliberately a silent fall-through to an ordinary pool rather than the 400/404 an unplayable challenge gets — a bookmarked `?challengeId=` URL should still yield a casual board |
| Routes | `src/routes/routeMeta.ts` → `FLAGGED_OFF_PATHS` removes the three `/friends/challenges*` paths |
| Entry points | `src/features/friends/FriendsPage.tsx` — the Challenges `BentoTile` **and** its `fetchChallengeBadge` call (skipped, not caught: the endpoint is unmounted, so the request would 404 to learn `0`) |
| | `src/features/flashcards/useDecksPanel.ts` → `challengeDecks` resolves to `[]`, which is the whole gate for the `/decks` Challenges shelf — `DecksPanelBody` already omits that section when the list is empty |
| | `src/features/profile/UserProfilePage.tsx` → `renderBlockToggle` returns `null` |

**NOT gated:** the hourly `database/cron/expire-study-challenges.sql` pass keeps running, so
a challenge that was already live still resolves or expires on schedule instead of hanging
mid-week. No `study_challenges` row or generated preset deck is touched.

### 2b. `community` — ON

Gates **sharing**, not **authoring**.

| Layer | Site |
|---|---|
| Server mount | `server/server.ts` → `app.use(communityRoutes)` — the 7 `/api/community/*` endpoints (feeds, vote, unvote, `applyDesign`) |
| **Leak** | `server/routes/userRoutes.ts` → `GET /api/users/:userId/designs` is registered inside an `isFeatureEnabled('community')` block. It serves the same designs from **outside** `communityRoutes.ts`, so not mounting that router would otherwise leave it live |
| Routes | `src/routes/routeMeta.ts` → `FLAGGED_OFF_PATHS` removes `/community` |
| Entry points | `src/pages/HomePage.tsx` — the Community tile, the **only** navigational entry |
| | `src/features/profile/UserProfilePage.tsx` → `ProfileDesignGrid` (another account's designs, with its own vote flow) |
| | `src/data/tips.ts` — the Community tip, which would otherwise point at a 404 |

**NOT gated:** designing your own cards. The card icon editor, `CardIconLayer`,
`cardIconLayout.ts`, `VocabEntryService.updateIconLayout` and the `author` column
([CARD_ICON_LAYOUT.md](./CARD_ICON_LAYOUT.md)) all stay live.

### 2c. `arena` — ON

| Layer | Site |
|---|---|
| Server mount | `server/server.ts` → `app.use(arenaRoutes)`. **Arena has no leaked endpoint** — all six `/api/arena*` paths live in `arenaRoutes.ts`, so this single mount is the whole server gate |
| Routes | `src/routes/routeMeta.ts` → `FLAGGED_OFF_PATHS` removes `/arena` |
| Entry point | `src/pages/HomePage.tsx` — the Arena tile, the only navigational entry (nothing in the footer, no row on `/friends`) |

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


### 2d. `nightMarket` — ON

The widest flag: the feature owns **three** server namespaces and **four** routes.

| Layer | Site |
|---|---|
| Server mounts | `server/server.ts` — **three** of them: `nightMarketRoutes` (`/api/nightMarket/*`), `nightMarketTemplateRoutes` (`/api/nightMarketTemplates/*`) and `nightMarketSandboxRoutes` (`/api/nightMarketSandbox/*`). The two authoring namespaces exist only to produce content for the market, so they are one flag, not three |
| **No leak** | Every night-market endpoint lives in those three files. In particular the read-only visit to another user's market is `GET /api/nightMarket/layout?userId=`, *not* a `/api/users/:userId/...` path — so unlike community it needs nothing in `userRoutes.ts` |
| Routes | `src/routes/routeMeta.ts` → `FLAGGED_OFF_PATHS` removes `/night-market`, `/night-market/user/:userId`, `/night-market/template-editor`, `/night-market/template-sandbox` |
| Entry points | `src/pages/HomePage.tsx` — the hero tile, **and** the two `isTemplateAuthor` tiles below the hairline |
| | `src/features/profile/UserProfilePage.tsx` — the "Visit their night market" button, the only way to reach `/night-market/user/:userId` |

**Authoring grant vs flag.** The Template Editor and Template Sandbox are already gated by
`users.isTemplateAuthor`, and that is *not* a substitute: the grant answers "may you
author?", the flag answers "does the feature exist?". Each tool tests both.

**The hero tile.** Night Market is the hub's only `variant: "hero"` tile. With the flag off
the mosaic simply opens on Games at base weight — no stand-in is promoted, because choosing
one would re-weight a page whose order is load-bearing ([BENTO_SYSTEM.md](./BENTO_SYSTEM.md))
for what is meant to be a temporary state.

**NOT gated — and this one writes rows:**

- **Unlock accrual keeps running.** `UserMinutePointsService` calls
  `NightMarketPlacementService.grantUnlocks` / `reconcileUnlocks` on every minute-points
  credit (the no-gating-DI rule in § 5). Deliberate: a learner who studies while the flag is
  off should come back to a market matching their balance, not an empty lot. This is the one
  place a flagged-off feature still mutates data — arena's injected service, by contrast,
  finds nothing to do.
- **Origin-hub seeding on registration** (`UserController.seedNightMarketHub`) — same reason.

### 2e. `immersiveWorld` — ON

| Layer | Site |
|---|---|
| Server mount | `server/server.ts` → `app.use(immersiveWorldRoutes)`. **One mount covers both halves** — the phase-1 authoring endpoints and the phase-2 learner runtime share the router (they share a URL prefix but not a service). No endpoint lives outside it |
| Routes | `src/routes/routeMeta.ts` → `FLAGGED_OFF_PATHS` removes `/immersive-world`, `/immersive-world/:sceneId`, `/immersive-world/scene-editor` |
| Entry points | `src/pages/HomePage.tsx` — the Immersive World tile, and the `isTemplateAuthor` Scene Editor tile |

**NOT gated:** the TTS voice plumbing. `useTTS`'s per-call `voice` argument exists for iw
alone (§ 6.4a of [IMMERSIVE_WORLD.md](./IMMERSIVE_WORLD.md)) but is an ordinary optional
parameter every other caller already omits, so there is nothing to switch off. Likewise the
`/immersive-world` entries in `src/minutePoints/eligibility.ts` and
`src/features/beginnerKeyboard/eligibility.ts` are path lists that simply stop matching.

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
| Client | `src/games/registry.ts` → `GAME_REGISTRY = ALL_GAMES.filter((g) => isGameEnabled(g.gameId))`. **One chokepoint.** The hub (`GamesPage`), `GAME_ROUTE_META` in `routeMeta.ts`, `GAME_COMPONENTS` in `routes/registry.ts`, `GAME_ROUTES`, `originLabelFor` and the route tests all derive from this array |
| Server | `server/controllers/GamesController.ts` → `isGameEnabled` on all three handlers (`getAssets`, `getProgress`, `saveProgress`) |

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
   Two of the five feature flags have one; assume yours does too until you have checked.
4. Add its paths to `FLAGGED_OFF_PATHS` in `src/routes/routeMeta.ts`.
5. Guard every client entry point (tiles, shelves, buttons, badge fetches, tips).

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
generated preset decks, game save state, `iw_scenes`, the night-market placement tables) is
left exactly as it was — with one deliberate exception, night-market unlock accrual (§ 2d),
which keeps writing so that re-enabling is not a cliff. Turning it back on restores the
feature as it stood.
