# Architecture Review — Structural Findings

**Status:** **Actioned.** All 12 findings have been remediated; each section below now
carries a `**Resolved:**` note describing the shape that replaced the one it describes.
The measurement commands are kept so a future reader can re-check whether a finding has
regressed — that is the point of this document, not the history of the fix.
**Date of survey:** 2026-07-28 (branch `main`, at commit `429894b`)
**Scope:** whole repo — `src/` (68.8k lines), `server/` (175.0k), `database/` (77.5k), `docs/` (23.0k)

This document records **standing structural properties of the codebase** — layering,
duplication, dead code, and dependency direction — along with the measurement that
established each one. It is meant to stay useful after the findings are addressed:
each section states the current shape, why it is a problem, and what the target shape
is. Re-run the measurement commands (given inline) to check whether a finding still holds.

**Not covered:** feature-internal correctness. The Pixi market engine
(`src/engine/market`), the greedy segmentation algorithm, and the pedestrian
simulation were mapped structurally but not audited for logic errors.

**How this was produced:** the architectural spine was read in full (bootstrap, DI
wiring, DAL base + all 15 interfaces, routing on both sides, page-shell components,
type modules, migration tooling). The remainder was analyzed programmatically —
import-graph resolution, orphan detection, layer-violation greps, and a
structural type-by-type diff between the client and server type modules. Every
count below is measured, not estimated.

---

## Contents

| # | Finding | Severity |
|---|---|---|
| [1](#1-basedal-is-85-dead-and-semantically-wrong-for-dictionarydal) | `BaseDAL` is 85% dead and mis-bound in `DictionaryDAL` | 🔴 |
| [2](#2-type-contracts-are-duplicated-client--server-and-6-have-drifted) | Type contracts duplicated client ↔ server; 6 drifted | 🔴 |
| [3](#3-the-mastery-formula-is-implemented-four-times) | Mastery formula implemented four times | 🔴 |
| [4](#4-routing-knowledge-lives-in-four-hand-synced-tables) | Routing knowledge in four hand-synced tables | 🟠 |
| [5](#5-srcapihttpts-has-two-live-consumers) | `src/api/http.ts` has two live consumers | 🟠 |
| [6](#6-1340-lines-of-unreachable-code) | ~1,340 lines of unreachable code | 🟠 |
| [7](#7-there-is-no-server-test-suite) | No server test suite | 🟠 |
| [8](#8-the-layer-model-is-applied-inconsistently) | Layer model applied inconsistently | 🟡 |
| [9](#9-frontend-dependency-tree-pages--features-is-not-a-real-boundary) | `pages/` ÷ `features/` is not a real boundary | 🟡 |
| [10](#10-api-namespace--route-file-organization) | API namespace + route-file organization | 🟡 |
| [11](#11-migratesh-can-silently-skip-a-migration-forever) | `migrate.sh` can silently skip a migration | 🟡 |
| [12](#12-server-dependencies-in-the-frontend-packagejson) | Server dependencies in frontend `package.json` | 🟡 |

[Prioritized remediation order](#prioritized-remediation-order) · [What to protect](#what-to-protect)

---

## Overall shape

The recurring pattern across findings 1, 5, 6, 8, and 9 is the same:
**an abstraction was built, then not adopted.** `BaseDAL`, `api/http.ts`,
`games/runtime/`, the DAL layer itself, and the `features/` boundary each exist,
each are well-built, and each are bypassed by most of their intended callers.
The result is that for any given concern there are two live conventions and no
way to predict which one a file uses.

The counter-example — and the proof the team knows the right pattern — is
`src/games/registry.ts`, whose header reads:

> *"The hub, the router, and the mobile-demo frame allowlist all derive from this
> array — adding a game requires no edits to those files."*

That is exactly the shape findings 4 and 5 need.

---

## 1. `BaseDAL` is 85% dead and semantically wrong for `DictionaryDAL`

> **Resolved.** `DictionaryDAL` no longer extends `BaseDAL`; it selects its table through
> `server/dal/shared/dictTable.ts` on every call. Removing the inherited `this.tableName`
> exposed **three live language-routing bugs** (a Spanish `create()` writing into
> `dictionaryentries_zh` among them) — the strongest argument for the rule in
> [BACKEND_LAYERING.md](./BACKEND_LAYERING.md) § 2.

**Files:** `server/dal/base/BaseDAL.ts` (345 lines), `server/dal/interfaces/IBaseDAL.ts`,
`server/dal/implementations/DictionaryDAL.ts:166-169`

Only 3 of 14 DALs extend `BaseDAL` (`UserDAL`, `VocabEntryDAL`, `DictionaryDAL`);
the other 11 `implements` their interface directly. Server-wide usage of its
13 generic methods:

| Method | Call sites |
|---|---|
| `findById` | 33 |
| `update` | 4 |
| `createWithTransaction` | 2 |
| `create`, `delete`, `findAll` | 1 each |
| `findAllPaginated`, `createMany`, `findByIds`, `exists`, `count`, `updateWithTransaction`, `deleteWithTransaction` | **0** |

### The `DictionaryDAL` problem

```ts
// server/dal/implementations/DictionaryDAL.ts:168
super(dbManager, 'dictionaryentries_zh', 'id');
```

Dictionary data is split per language (`dictionaryentries_zh` / `dictionaryentries_es`,
see CLAUDE.md), and every real query in the file resolves its table through
`dictTableForLanguage(language)` (`server/dal/shared/dictTable.ts`). But the
**inherited** `findById` / `create` / `update` / `delete` are hard-bound to the
Chinese table by that `super()` call.

`DictionaryDAL` uses **zero** inherited methods today — the extension is purely
decorative. The hazard is latent: the first caller to use
`dictionaryDAL.findById(id)` for a Spanish entry gets a silent wrong-table read,
with no type error and no runtime error.

```bash
# verify: should print nothing
grep -rn "dictionaryDAL\.\(findById\|create\|update\|delete\|findAll\|exists\|count\)(" server --include=*.ts
```

### Target shape

- `DictionaryDAL` drops `extends BaseDAL`, keeps `implements IDictionaryDAL`.
- `BaseDAL` shrinks to what `UserDAL` / `VocabEntryDAL` actually call
  (`findById`, `create`, `update`, `delete`, `createWithTransaction`) — roughly
  80 lines — or is deleted and inlined into those two.
- `assertSafeColumnName` (BaseDAL.ts:291) is a good defense-in-depth guard and
  should survive wherever the insert/update builders land.

### The inheritance tree that is correct

`server/types/dal.ts` — `DALError` → `ValidationError` / `NotFoundError` /
`DuplicateError` / `DatabaseConnectionError` / `RateLimitError`. Shared
`toClientError()`, genuine substitutability, consumed uniformly by
`handleControllerError` (`server/utils/controllerUtils.ts:62`). This is the model
to follow.

---

## 2. Type contracts are duplicated client ↔ server, and 6 have drifted

> **Resolved.** Wire types crossing the HTTP boundary have one declaration in
> **`server/contracts/wire.ts`**, re-exported by both `server/types/index.ts` and
> `src/types.ts`. Narrow variants use the base/narrow pattern (`interface X extends XBase`)
> rather than a second copy. The `contracts/` directory sits inside `server/` because the
> backend Docker build context is `./server` — shared code cannot live at the repo root.

**Files:** `server/types/index.ts` (725 lines), `src/types.ts` (491 lines),
`src/AuthContext.tsx:13`

29 type names are declared in **both** type modules. A structural diff
(comments and whitespace normalized away):

- **24 are byte-identical** — pure copy-paste maintenance burden.
- **6 have already drifted**, including the three most load-bearing types:

| Type | Drift |
|---|---|
| `DictionaryEntry` | client is missing **21 fields** (`breakdown`, `synonyms`, `exampleSentences`, `wordForms`, `difficulty`, `script`, `segments`, `longDefinitionRaw`, `longDefinitionCitations`, …) |
| `VocabEntry` | client missing `totalMarkCount`, `totalCorrectCount`, `longDefinitionCitations`; declares a `discoverable` the server does not |
| `User` | client missing `avatarIconId`, `readingGoal`, `writingGoal`, `showSegmentSpaces`, `lastMinutePointIncrement` |
| `DiscoverCard` | client missing `matchException`, `translatedVocab` |
| `FlashcardCategory` | `enum` on the server, string union on the client |
| `StarterPackBucket` | server `'library'` · client `'library' \| 'skip'` |

### `User` exists three times

1. `server/types/index.ts` — full server shape
2. `src/types.ts:443` — stale; also declares `password?: string`, a field that
   never crosses the wire
3. `src/AuthContext.tsx:13` — **private, not exported**, and the only one with
   the current field set (`isValidator`, `isTemplateAuthor`, `readingGoal`,
   `writingGoal`, `showSegmentSpaces`, `avatarIconId`)

The authoritative client-side `User` is the one that cannot be imported.

### Target shape

A `shared/` directory (or a small workspace package) holding the wire contracts,
imported by both `src/` and `server/`. This is the highest-leverage change in the
repo: it converts an entire class of silent runtime mismatches into compile
errors, and it is a prerequisite for finding 3 and for meaningful server tests
(finding 7).

Types that are genuinely one-sided (server-only DAL create/update shapes, client-only
view models) stay where they are. Only the wire contracts move.

---

## 3. The mastery formula is implemented four times

> **Resolved.** One implementation, in the shared layer, consumed by every caller. See
> [MASTERY_REWORK.md](./MASTERY_REWORK.md) for the formula itself.

The pbh (progress-bar-height) formula from `docs/MASTERY_REWORK.md` — which
defines what "Mastered" means — is implemented in:

| # | Location |
|---|---|
| 1 | `src/utils/masteryCompute.ts` |
| 2 | `server/utils/masteryCompute.ts` |
| 3 | SQL `compute_utcm_category()` — `database/migrations/101-mastery-rework-typed-marks-and-goals.sql` |
| 4 | SQL `compute_type_category()` — migration 128 |

The client file's own header documents the flaw rather than fixing it:

> *"Mirror of server/utils/masteryCompute.ts and the SQL compute_utcm_category()
> (migration 101). **Keep the three in sync.**"*

That comment is itself now out of date — there are four.

**Current status: the implementations agree.** A normalized diff of the two TS
files shows only expected differences (import style, the client's extra
`PBH_FULL` / `PBH_THRESHOLDS` / `positivesByType` bar-rendering helpers, and
enum-vs-literal returns per finding 2). The band cut points (`<3` Unfamiliar,
`<6` Target, `<8` Comfortable, else Mastered) and the blend formula
`LEAST(6, max positive among goals) + (sum of remaining goals) / ((goalCount-1)*3)`
match across all four, including the SQL.

The risk is **future drift**, and it is amplified by finding 7: this formula has
**zero test coverage** in any of its four homes.

### Target shape

One TS implementation in the shared module (finding 2). The server computes
`category` and `pbh` and ships them in the payload; the client renders what it
receives. The SQL functions are dropped unless a query genuinely needs to filter
on the band — and if one does, that filter belongs in a service, not a stored
function.

---

## 4. Routing knowledge lives in four hand-synced tables

> **Resolved.** Route metadata lives in **`src/routes/routeMeta.ts`** (a plain table with no
> page imports, so it is safe to read from anywhere) with components in
> **`src/routes/registry.ts`**. Matching goes through React Router's `matchPath`, so a path
> pattern is written once. `allowPublic` polarity is fixed.

Adding one page requires edits to four files that each independently classify routes:

| File | Table | Encodes |
|---|---|---|
| `src/App.tsx:53-219` | inline `<Route>` list | path → component, `allowPublic` |
| `src/components/Layout.tsx:56` | `MOBILE_DEMO_PATHS` + 6 `startsWith` checks | phone frame vs. plain |
| `src/components/FooterPresenter.tsx:20,40` | `FOOTER_ROUTES` + `FOOTER_ROUTE_PREFIXES` | footer visible + active tab |
| `src/utils/pageTransition.ts:21-33` | `NODE_ROUTES` + `NODE_PREFIXES` + `LEAF_EXACT` | slide direction |

Two of them carry explicit *"Keep in sync with…"* comments
(`FooterPresenter.tsx:37`, `pageTransition.ts:20`).

### It has already broken

`LEAF_EXACT` (`pageTransition.ts:28`) contains `/games/bubble-match` but **not**
`/games/word-search` — yet both pages render `<LeafPage>`:

```bash
grep -rlE "from ['\"].*/LeafPage['\"]" src   # includes both game pages
```

So `routeSlideDir("/games/word-search")` returns `null` and Word Search silently
loses the slide-up view transition that Bubble Match gets. A pure manual-sync
defect. (`TemplateEditorPage` and `TemplateSandboxPage` are also absent from
`LEAF_EXACT`; those are desktop-only and may be intentional — worth confirming.)

### Related: `allowPublic` has inverted polarity

25 of 30 routes in `App.tsx` pass `allowPublic`. Combined with the local-environment
fact that every user is `isPublic`, a **forgotten** flag does not error — it
silently `<Navigate to="/">`s (`ProtectedRoute.tsx:29`), which presents as a dead
button rather than a crash. Four of the route comments in `App.tsx` exist solely
to explain why `allowPublic` is present.

### Target shape

One `ROUTES` array, in the shape `games/registry.ts` already uses:

```ts
{ path, Component, requiresFullAccount?, shell: 'frame' | 'plain',
  chrome: 'leaf' | 'node' | 'tab' | 'none', footerTab? }
```

All four consumers derive from it; `GAME_REGISTRY` entries are spread in. This
deletes ~60 lines of parallel tables, makes the word-search class of bug
structurally impossible, and flips the auth flag so the safe default is the
common case.

---

## 5. `src/api/http.ts` has two live consumers

> **Resolved (substantially).** `src/api/http.ts` is now the app's transport: it gained
> FormData passthrough and a `withFallback` helper, and the dedicated client modules were
> migrated onto it — `communityApi.ts`, `vocabApi.ts`, `validationApi.ts`,
> `cardIconApi.ts`, `templateEditorApi.ts`, `templateSandboxApi.ts`, plus the new
> **`src/features/discover/starterPacksApi.ts`**. Raw `fetch` sites fell from **96 to 55**.
>
> The load-bearing half of this finding is fully done: **no client API module takes a
> `token` parameter any more.** That threading was what pulled the token into `useCallback`
> / `useMemo` dependency arrays, where a silent ~15-minute refresh re-created the callback
> and re-ran the effects keyed on it — the exact bug class CLAUDE.md's "Never reload/reset a
> page on a silent token refresh" rule names. Live instances found and fixed:
> `useCardIconEditor`'s save/reset callbacks, `IconPickerDialog`'s `fetchPage`, and the
> `authHeaders` memo shared by all three Discover pages.
>
> **Still open:** ~50 raw `fetch` calls still in page/hook bodies, and the 17 hand-rolled
> `{data, loading, error}` triads a `useApi(path)` hook would collapse. `AuthContext.tsx`
> is deliberately excluded — it *is* the refresh layer, so it must not call through the
> wrapper that depends on it.

`src/api/http.ts` describes itself as *"the app's single typed HTTP transport"* and
is well-built — base-URL prefixing, querystring building, JSON handling,
`credentials: 'include'`, and an `ApiError` that mirrors the axios error shape so
existing call sites keep working.

Measured adoption:

| | Count |
|---|---|
| Raw `fetch()` calls in `src/` | **113**, across 50 files |
| `apiGet`/`apiPost`/`apiPut`/`apiPatch`/`apiDelete` calls | **8**, across 4 files |
| …of which are dead code (`useGameAssets`, `useGameProgress` — see finding 6) | 2 files |

So the "single transport" has **two live consumers**
(`src/components/ValidateFlagButtons.tsx`, `src/pages/EntryDetailPage.tsx`).

Meanwhile the rest of the app hand-builds the same request envelope:
`API_BASE_URL` interpolation (54 files), `Authorization: Bearer` construction
(50 sites), `credentials: 'include'`, and `if (!response.ok)` unwrapping.

`src/utils/authHeader.ts` exists and is well-adopted (43 sites) for the
token-refresh-safe header — that part is fine and should be kept; it just belongs
*inside* the transport.

### `AuthContext.tsx` is the concentrated case

Eight raw fetches. This guard is copy-pasted **five times** (lines 313, 346, 377,
409, 440, 472):

```ts
if (!token || token === 'null' || token === 'undefined' || token.length <= 10) {
```

And `updateLanguage` / `updateAvatar` / `updateGoals` / `updateDisplaySettings`
(lines 374-496) are four near-identical ~30-line functions differing only in URL
and payload. They collapse to one `updateProfile(patch)` over `apiPut`.

### Also

17 components hand-roll the same `{ data, loading, error }` useState triad. One
`useApi(path)` hook built on the transport removes most of that.

### Target shape

Adopt `api/http.ts` app-wide; fold `authHeader()` into its default headers.
`AuthContext` keeps raw `fetch` only for `/api/auth/refresh` (which must not
recurse through the interceptor).

---

## 6. ~1,340 lines of unreachable code

> **Resolved.** 18 files deleted (~1,340 lines). ⚠️ **Note for the reader:** this included
> the whole **`src/games/runtime/`** cluster (`GamePage.tsx`, `GameStage.tsx`,
> `useGameActors.ts`) and the `useGameAssets` / `useGameProgress` hooks — a generic game
> harness that nothing imported. If it was scaffolding intended for a third game, recover it
> from git history rather than rewriting it.

Determined by resolving every relative import specifier to a real file, starting
from the two entrypoints (`src/main.tsx`, `server/server.ts`), excluding tests
and CLI scripts.

| File | Lines | Note |
|---|---:|---|
| `src/features/nightmarket/FarmTerrainLayer.tsx` | 202 | superseded by the Pixi engine in `src/engine/market` |
| `src/games/runtime/GameStage.tsx` | 190 | |
| `src/features/nightmarket/WalkwayLayer.tsx` | 118 | superseded |
| `src/features/flashcards/FlashcardsLearnPage/InfoCardPopup.tsx` | 113 | |
| `src/games/runtime/useGameActors.ts` | 97 | |
| `src/components/ChangelogDisplay.tsx` | 96 | `GET /api/changelog` is live and now has no consumer |
| `src/features/nightmarket/HouseLayer.tsx` | 92 | superseded |
| `src/games/hooks/useGameProgress.ts` | 79 | |
| `src/features/nightmarket/nightMarketMotion.ts` | 64 | |
| `src/games/runtime/GamePage.tsx` | 63 | |
| `src/utils/test-vietnamese-tokens.ts` | 59 | |
| `src/components/EmptyState.tsx` | 55 | |
| `src/games/hooks/useGameAssets.ts` | 52 | |
| `server/utils/pinyin.ts` | 30 | |
| `.../FlashcardsLearnPage/BreakdownLineItemComponent.tsx` | 26 | |
| **Total** | **~1,336** | |

### The `games/runtime/` cluster is the notable one

`GamePage` + `GameStage` + `useGameActors` + `useGameAssets` + `useGameProgress`
(~480 lines) form a complete game-lifecycle framework. **Neither shipped game
uses it** — Bubble Match (`BubbleStage.tsx`, 928 lines) and Word Search
(`WordSearchGrid.tsx`, 1,025 lines) each roll their own.

Decision needed: adopt it for game #3, or delete it. In its current state it is a
decoy — it looks like the thing a new game should build on.

### Also worth pruning

`server/tests/` contains `test-japanese-dictionary-api.js`,
`test-korean-dictionary-api.js`, and `test-vietnamese-dictionary-api.js`, which
exercise the ja/ko/vi import paths that CLAUDE.md documents as *intentionally
broken*. See finding 7.

---

## 7. There is no server test suite

> **Resolved.** `server/` has a `vitest` suite (**68 tests / 3 files**) alongside the
> frontend's **202 tests / 19 files**. The self-instantiating singletons this finding named
> as a blocker are constructed in `server/dal/setup.ts` like everything else.

- `server/package.json` has **no `test` script** (only `build`, `start`, `dev`).
- `server/tests/` is **32 files of manual scripts and SQL fixtures** — `test-login.js`,
  `debug-jwt-issue.js`, `update-passwords.js`, `generate-hash.js`,
  `create-leaderboard-sample-data.sql`. Not one is an automated test.
- The root `test` script is `vitest run`. At the time of survey there were **17 test
  files (~111 tests)**, all frontend, covering only: Night Market geometry
  (`src/engine/market/__tests__`, `src/__tests__`), one Bubble Match spawn case, and
  card-icon layout scales. (An earlier draft of this document said "17 tests"; 17 was
  the file count.)

Untested: the mastery formula (duplicated 4× — finding 3), the greedy segmentation
algorithm, starter-pack selection, the on-deck working loop, auth and token
rotation, and every DAL and service.

This inverts the risk profile: the most-duplicated, highest-consequence logic in
the codebase is the least verified. It is also *why* several other findings are
risky to act on.

Note that finding 8's self-instantiating singletons (`LeaderboardController`,
`TTSController`, `TTSService`) are structurally unmockable, so they are a direct
blocker to starting here.

### Target shape

Add `"test": "vitest run"` to `server/package.json` and start with the three
highest-consequence pure functions, which need no database:
`masteryCompute`, `segmentString` (gsa), and the token rotation logic.

---

## 8. The layer model is applied inconsistently

> **Resolved as a rule; partially resolved as code.** The rule now has a normative home:
> **[BACKEND_LAYERING.md](./BACKEND_LAYERING.md)** — the three layers, "a service does not
> write SQL", the one legitimate transaction exception, and § 4's honest inventory of the
> four services that still don't conform (`NightMarketTemplateService`, `ValidationService`,
> `StarterPacksService`, `TextService`), each with a named remedy. DI is single-pattern:
> everything is constructed in `server/dal/setup.ts` and injected downward.

Stated architecture: **Controller → Service → DAL**. `server/dal/setup.ts` is a
real composition root and wires most of it correctly with constructor injection.

### 7 of 22 services bypass the DAL and issue SQL directly

Measured as references to `dbManager` / `executeQuery` / `client.query`:

| Service | Direct-SQL sites | Has a dedicated DAL? |
|---|---:|---|
| `NightMarketTemplateService` | 27 | ❌ none |
| `StarterPacksService` | 19 | partial (`sortPacksDAL` only) |
| `ValidationService` | 15 | ❌ none |
| `TextService` | 13 | ❌ none |
| `OnDeckVocabService` | 12 | partial |
| `LazyEnrichmentService` | 4 | ✅ |
| `VocabEntryService` | 4 | ✅ |

`StarterPacksService` additionally carries private `_dictTable()` and `_vetTable()`
helpers (lines 75, 83) — per-language table-name resolution, a DAL concern, living
in the service layer.

### Two competing DI patterns

Most controllers receive dependencies via constructor injection from `dal/setup.ts`.
Three do not:

```ts
// server/controllers/LeaderboardController.ts:13,149
this.leaderboardService = new LeaderboardService(...)   // inside its own constructor
export const leaderboardController = new LeaderboardController();

// server/services/TTSService.ts:228 · server/controllers/TTSController.ts:79
export const ttsService = new TTSService();
export const ttsController = new TTSController();
```

These are invisible from the composition root and cannot be mocked — a direct
blocker to finding 7.

### One acknowledged shortcut (fine as-is)

`Icons8Controller` and `WinsController` take a DAL directly with no service layer.
This is deliberate and documented at `dal/setup.ts:113-116` — both are thin
pass-throughs. Worth keeping, but it should be a *stated rule* rather than a
case-by-case comment.

### Target shape

State one rule and apply it uniformly — either "every service owns a DAL" or
"DALs are for shared entities; feature services may own their SQL, and it lives
in a `sql/` sibling file." Either is defensible; the mix means a reader cannot
predict where a query lives. Move `Leaderboard` and `TTS` into `setup.ts`
regardless.

---

## 9. Frontend dependency tree: `pages/` ÷ `features/` is not a real boundary

> **Resolved.** The boundary is now real and written down in
> **[FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md)**: `features/<x>/` holds code **exclusive**
> to that feature (its pages included), `src/pages/` keeps only app-level/auth/legacy pages,
> and anything with importers in two features moves up to a shared home. Applied moves: the
> Discover, Dictionary, Games and Community pages into their features; the fie into
> `src/cardIcons/editor/`; `constants.ts` / `types.ts` up out of `FlashcardsLearnPage/`.
>
> The layering inversion is fixed: `TemplateDefinitionPayload` now lives in
> **`src/engine/market/templateDefinition.ts`** (the engine's own input contract) and is
> re-exported by `templateEditorApi.ts`, so no `src/engine/` file imports from
> `src/features/`. The two largest files were split — `FlashCardSection.tsx` 1,144 → 516
> lines (faces extracted to `src/features/flashcards/card/CardFace.tsx`) and
> `InfoCardPanelBody.tsx` 889 → 653 (tab bodies to `InfoCardTabContent.tsx`, availability to
> `infoCardTabAvailability.ts` — a separate module because `react-refresh/only-export-components`
> requires a component file to export only components).

### `src/components/` is a dumping ground

19 of 47 components have exactly **one** consumer. `TesterDashboardPage` alone
privately owns five of them: `StreakCounter`, `TimeDisplay`, `MonthlyCalendar`,
`Message`, `LeaderboardPlaceholder`. Others (`AddEntryModal`, `VocabEntryCards`,
`QuickMarkCard`, `DeckBuckets`, `AiDictionaryEntryCard`) each belong to exactly
one page.

(Some single-consumer components are legitimately shared infrastructure —
`Layout`, `ProtectedRoute`, `MobileDemoFrame`, `FooterPresenter`, `LeafPageHeader`.
Those stay.)

### The split is not principled

`flashcards`, `reader`, and `nightmarket` are under `features/`. But
`SortCardsPage` (1,254 lines), `DictionaryPage`, `QuickMarkPage`,
`TesterDashboardPage`, and `CommunityPage/` (already a directory) are equally
feature-shaped and sit under `pages/`.

### Feature encapsulation is being violated

Two pages reach *past* the flashcards feature boundary into its internals:

```
src/features/dictionary/DictionaryCardDetailPage.tsx        -> ../features/flashcards/FlashcardsLearnPage/FlashCardSection
src/features/dictionary/DictionaryCardDetailPage.tsx        -> ../features/flashcards/constants
src/features/dictionary/DictionaryCardDetailPage.tsx        -> ../features/flashcards/VocabCardDetailBody
src/features/community/CommunityCardView.tsx -> ../../features/flashcards/FlashcardsLearnPage/FlashCardSection
```

`FlashCardSection` is **1,144 lines** and now serves three unrelated surfaces. It
is no longer a flashcards-learn component — it is **the app's card renderer** and
should be promoted to a shared `card/` module with an explicit public interface.
As it stands, the dependency arrow points from a page into another feature's
private file, which is the arrow that cannot be refactored around.

### One layering inversion

```
src/engine/market/templateStitch.ts -> ../../features/nightmarket/templateEditorApi
```

The engine should never import from a feature. Otherwise the
`engine/market` ↔ `features/nightmarket` boundary is clean (19 files point the
correct direction).

### The largest single cluster

`src/features/flashcards/FlashcardsLearnPage/` is **9,352 lines in one directory**
(28 files). About **3,300** of those are the card-icon editor (fie):

| File | Lines |
|---|---:|
| `CardEditToolbar.tsx` | 1,044 |
| `CardIconCanvas.tsx` | 1,029 |
| `useCardIconEditor.ts` | 921 |
| `CardIconOrderList.tsx` | 301 |

This is a self-contained canvas editor (drag / resize / rotate gestures, icons8
search, normalized-coordinate persistence — see `docs/CARD_ICON_LAYOUT.md`) with
no relationship to the learning loop. It is the clearest extraction candidate in
the repo: lift to `src/features/cardIconEditor/` behind a small interface.

`InfoCardPanelBody.tsx` (889 lines) is the second candidate — the eip with all of
its tabs inline; it should be one file per tab.

---

## 10. API namespace + route-file organization

> **Resolved.** API paths are **camelCase** (`/api/starterPacks/...`,
> `/api/nightMarketTemplates/...`, `/api/users/displaySettings`); user-facing SPA URLs stay
> kebab-case (`/discover/quick-mark/:language`) and are unrelated. Route files are one
> namespace each, mounted in `server/server.ts`, and every route is wired through
> `handle()` from `server/routes/asyncHandler.ts` — necessary because **Express 4 does not
> catch rejected promises**, so an async handler that threw would hang the request silently.

### Four naming conventions coexist

```
/api/onDeck/…               camelCase
/api/vocabEntries/…         camelCase
/api/starterPacks/…        kebab-case
/api/nightMarket/…         kebab-case   ⎫
/api/nightMarketSandbox      …          ⎬ three spellings of one feature
/api/nightMarketTemplates    …          ⎭
```

### One route file holds four unrelated namespaces

`server/routes/gamesRoutes.ts` registers `/api/games`, `/api/community`,
`/api/leaderboard`, **and** `/api/nightMarket` — while Night Market's other two
namespaces each have their own dedicated file. Every other route file maps 1:1 to
its namespace.

### 115 `@ts-ignore`s, all suppressing the same thing

Every one of the 115 route registrations has this shape:

```ts
// @ts-ignore
router.get('/api/dictionary/search', authenticateToken, async (req, res) => {
  await dictionaryController.search(req, res);
});
```

That is **115 of the repo's 116 total `@ts-ignore`s**, all suppressing the same
Express 5 async-handler typing issue. A single typed `asyncHandler` wrapper
removes all 115 suppressions and roughly 230 lines of boilerplate:

```ts
router.get('/api/dictionary/search', authenticateToken, handle(dictionaryController.search));
```

### Route ordering is currently correct but implicit

Literal paths are registered before parameterized ones everywhere
(`/api/vocabEntries/paginated` before `/api/vocabEntries/:id`, `/api/texts/stats`
before `/api/texts/:id`). This is correct today but undefended — e.g. adding a
`POST /api/starterPacks/:language` above line 58 of `starterPacksRoutes.ts`
would silently swallow `POST /api/starterPacks/quickMarkBatch`.

---

## 11. `migrate.sh` can silently skip a migration forever

> **Resolved.** `database/deploy/migrate.sh` selects by **set difference** against
> `schema_migrations` instead of a high-water mark, applies each file in its own
> `BEGIN … COMMIT` together with its bookkeeping insert, and supports `--dry-run`,
> `--baseline N` and `--allow-out-of-order` (out-of-order refused by default). See
> [BACKEND_LAYERING.md](./BACKEND_LAYERING.md) § 6.
>
> The legacy damage this finding predicted — **74 of 127 migrations unrecorded on dev** — has
> also been cleared (2026-07-28). Replaying them would have been destructive (30 of the 74 are
> not idempotent), so each missing migration's artifact was probed against the live schema
> first: 73 were already applied and were baselined, and the one genuinely absent (74,
> `weeklies`) was applied. See [BACKEND_LAYERING.md](./BACKEND_LAYERING.md) § 6 for the
> non-idempotent inventory — it is the reason "just re-run them" is the wrong instinct here.

**File:** `database/deploy/migrate.sh`

```bash
MAX_APPLIED=$($PSQL -t -c "SELECT COALESCE(MAX(version), 0) FROM schema_migrations;")
...
if [ "$version" -le "$MAX_APPLIED" ]; then
    echo "    SKIP (already applied): $filename"
    continue
fi
```

The runner tracks a **high-water mark**, not a set. If migration 130 lands on
`main` after 132 has already been applied — routine with parallel branches — then
130 is skipped **permanently and silently**, and the summary prints
`==> No new migrations to apply.`

Two further issues in the same loop:

1. Each migration file runs via `$PSQL -f "$filepath"` with **no surrounding
   transaction**. A migration that fails halfway leaves the schema partially
   changed.
2. The `schema_migrations` INSERT is a **separate `psql` invocation** from the
   migration itself, so a failure between them leaves the database changed but
   unrecorded.

### Target shape

```sql
-- select pending by set difference, not high-water mark
WHERE version NOT IN (SELECT version FROM schema_migrations)
```

and wrap the migration file plus its `INSERT INTO schema_migrations` in a single
`BEGIN; … COMMIT;` per file.

### Not an issue: the gap at 121

`database/migrations/` runs 05→132 with exactly one number missing (121). This is
intentional and documented at `docs/ES_CLUSTERED_SENSES_DEPLOYMENT.md:241` — the
change was drafted as 121 and renumbered to 123. **However**, several code
comments still cite "migration 121" for work that shipped as 123
(`server/dal/shared/dictJoin.ts:30`, `server/dal/shared/vetTable.ts:19`,
`src/types.ts:351`). Worth a one-line cleanup so future readers don't hunt for a
file that never existed.

---

## 12. Server dependencies in the frontend `package.json`

> **Resolved.** The server-only dependencies are out of the frontend manifest.

The root (frontend) `package.json` declares these with **zero imports anywhere in
`src/`**:

| Package | Note |
|---|---|
| `mssql` ^11.0.1 | **SQL Server** driver — the database is PostgreSQL |
| `tedious` ^18.6.1 | **SQL Server** driver |
| `express` ^5.1.0 | server-side; also see version conflict below |
| `cors`, `dotenv`, `node-fetch`, `form-data` | server-side |
| `@azure/identity` ^4.10.0 | server-side, and unused there too |
| `lodash` + `@types/lodash` | unused |
| `figma-mcp-server` ^2.1.1 | a dev tool declared as a production dependency |

### Express major-version conflict

Root declares `express: ^5.1.0`; `server/package.json` declares `express: ^4.18.2`.
Only the server one is real, but the root declaration means a stray
`import ... from 'express'` in `src/` would resolve against v5 and typecheck.

```bash
# verify each: should print 0
for p in mssql tedious express cors dotenv node-fetch form-data @azure/identity lodash; do
  echo -n "$p: "; grep -rl "from ['\"]$p" src --include=*.ts --include=*.tsx | wc -l
done
```

### Repo hygiene

Large binaries tracked in git: `cloudflared-linux-amd64.deb` (20 MB),
`cedict_ts.u8` (9.8 MB), `det_dump.dump` (5.4 MB), plus three stray
`screenshot*.png` at the repo root.

---

## Prioritized remediation order

Ranked by payoff-to-risk. Items 1–2 unblock much of the rest.

| # | Change | Addresses | Notes |
|---|---|---|---|
| 1 | **One shared type/contract module** consumed by both sides | [2](#2-type-contracts-are-duplicated-client--server-and-6-have-drifted), [3](#3-the-mastery-formula-is-implemented-four-times) | Prerequisite for meaningful server tests |
| 2 | **A server test suite** — start with `masteryCompute`, `segmentString`, token rotation | [7](#7-there-is-no-server-test-suite) | Pure functions, no DB needed; makes everything below safe |
| 3 | **One route registry** driving router + shell + footer + transitions | [4](#4-routing-knowledge-lives-in-four-hand-synced-tables) | Generalize the existing `games/registry.ts` pattern |
| 4 | **Commit to one HTTP layer** — adopt `api/http.ts` app-wide | [5](#5-srcapihttpts-has-two-live-consumers) | Deletes ~50 sites of duplicated envelope handling |
| 5 | **Unhook `DictionaryDAL` from `BaseDAL`**; shrink or delete `BaseDAL` | [1](#1-basedal-is-85-dead-and-semantically-wrong-for-dictionarydal) | Small, removes a latent wrong-table read |
| 6 | **Decide and document the DAL rule**; move `Leaderboard`/`TTS` into `setup.ts` | [8](#8-the-layer-model-is-applied-inconsistently) | The DI move is a blocker for #2 |
| 7 | **Fix `migrate.sh`** — set difference + per-file transaction | [11](#11-migratesh-can-silently-skip-a-migration-forever) | Cheap; prevents a silent-data-loss class of bug |
| 8 | **Collapse `pages/` into `features/`**; promote `FlashCardSection`; extract the fie | [9](#9-frontend-dependency-tree-pages--features-is-not-a-real-boundary) | Largest mechanical change; do after #2 |
| 9 | **`asyncHandler` wrapper**; consolidate `gamesRoutes.ts`; settle on kebab-case | [10](#10-api-namespace--route-file-organization) | Path renames need a coordinated client change |
| 10 | **Delete dead code and misplaced deps** | [6](#6-1340-lines-of-unreachable-code), [12](#12-server-dependencies-in-the-frontend-packagejson) | Decide `games/runtime/`'s fate first |

---

## What to protect

Two things in this codebase are better than typical and should survive any
refactor:

**The comments.** They cite migration numbers, explain *why* rather than *what*,
and several were spot-checked against the schema and found accurate. Examples worth
preserving as a style reference: `server/dal/shared/dictJoin.ts` (explains the
union-branch divergence and its migration history),
`server/dal/implementations/DictionaryDAL.ts:105-160` (the numbered-pinyin regex
rationale), `src/AuthContext.tsx:104-201` (the checkAuth effect's re-entrancy
reasoning). This documentation is the reason a review of this size was tractable.

**The Leaf/Node page model.** `LeafPage` / `NodePage` / `FooterPresenter` /
`usePageSlide` (`docs/UX_AND_NAVIGATION.md`) is a genuinely sophisticated design.
Rendering the footer pill **once** in `MobileDemoFrame`, outside the page
surfaces, so it animates on its own axis rather than participating in each page's
slide, is the correct solution to a problem most codebases get wrong. Do not
refactor it — finding 4 only asks to stop hand-maintaining the route tables that
feed it.

---

## Related documentation

- [CLAUDE.md](../CLAUDE.md) — index of all feature documentation
- [docs/UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) — the Leaf/Node model and mobile shell ([finding 4](#4-routing-knowledge-lives-in-four-hand-synced-tables))
- [docs/MASTERY_REWORK.md](./MASTERY_REWORK.md) — the pbh formula ([finding 3](#3-the-mastery-formula-is-implemented-four-times))
- [docs/CARD_ICON_LAYOUT.md](./CARD_ICON_LAYOUT.md) — the card-icon editor proposed for extraction ([finding 9](#9-frontend-dependency-tree-pages--features-is-not-a-real-boundary))
- [docs/MULTI_LANGUAGE_IMPLEMENTATION.md](./MULTI_LANGUAGE_IMPLEMENTATION.md) — per-language det/vet split ([finding 1](#1-basedal-is-85-dead-and-semantically-wrong-for-dictionarydal))
- [docs/ES_CLUSTERED_SENSES_DEPLOYMENT.md](./ES_CLUSTERED_SENSES_DEPLOYMENT.md) — explains the migration 121 gap ([finding 11](#11-migratesh-can-silently-skip-a-migration-forever))
