# Correctness & Performance Review — Feature-Internal Findings

**Status:** **Actioned.** All five findings have been remediated; each section carries a
`**Resolved:**` note describing the shape that replaced the one it describes. The
measurement commands are kept so a future reader can re-check whether a finding has
regressed — that is the point of this document, not the history of the fix.

| Measurement | Before | After | Re-measured 2026-07-28 (post-merge) |
|---|---:|---:|---:|
| Per-user leaderboard queries | 2N sequential | **1 grouped** | 1 grouped |
| DALs using the module singleton | 12 of 15 | **0 of 15** | **0 of 15** |
| Hand-rolled `/api/flashcards/mark` sites | 5 | **0** | **0** (see note) |
| `token` in a dependency array | 17 | **3** (all documented exceptions) | **3** |
| `console.log` in `src/` | 57 | **26** | 25 |
| Raw `fetch` outside `src/api/` | 44 | **33** | **45** ⚠️ |

Server tests grew 68 → 74 (new `__tests__/leaderboard.test.ts`); client 223 → 253. All green.

**The third column matters more than the second.** The Speed Reading game (then
called Mandela) landed after the
fix pass and had independently re-grown BOTH patterns finding 3 and finding 4 describe —
a sixth hand-rolled `/api/flashcards/mark` with a `[token]` dep on its callback. It was
converted to `markFlashcard()`; the counts above are post-conversion. This is direct
evidence that these two findings are not one-time cleanups but **conventions that need a
normative home**, since a new feature author reached for the old shape by default. The
`token`-dep half is already law in CLAUDE.md; the mark-endpoint half is not written down
anywhere yet.

The raw-`fetch` count *rose* (33 → 45) for the same reason — new game/feature code, not a
regression of anything fixed here. That is `ARCHITECTURE_REVIEW.md` finding #5, still open,
and it is getting worse rather than holding steady.

**Date of survey:** 2026-07-28 (branch `main`, working tree at commit `429894b` + 284 uncommitted files)
**Baseline at time of survey:** `npx tsc -p tsconfig.app.json --noEmit` exits 0;
`npm run test:all` passed 202 client + 68 server tests.

> ⚠️ **The tree was being edited concurrently during this survey.** `CharacterMutationDAL.ts`
> and the whole `src/games/match-speed/` feature appeared mid-review. Counts that mention
> 14 DALs or four mark sites reflect the earlier snapshot; the corrected numbers are 15 and
> five. Re-run the measurement commands rather than trusting any absolute count here.

## Relationship to ARCHITECTURE_REVIEW.md

This is the **companion** to [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md), which
audited *structure* — layering, duplication, dead code, dependency direction — and
explicitly scoped out "feature-internal correctness … not audited for logic errors."
This document covers that excluded half, plus runtime performance.

**Do not re-file findings that belong to the sibling doc.** Two of its findings remain
partially open, and the numbers there are stale. Current measurements:

| Sibling finding | That doc claims | Measured 2026-07-28 |
|---|---|---|
| #5 adopt `api/http.ts` app-wide | raw `fetch` fell 96 → 55 | **44** raw `fetch` calls across **30** files; only **8** files import `http.ts` |
| #8 a service does not write SQL | 4 non-conforming services | **7** services issue SQL; `StarterPacksService` (14 sites), `NightMarketTemplateService` (13) |

Its other ten findings verified as genuinely resolved: `server/__tests__/` exists (3 files,
68 tests), server deps are absent from the frontend `package.json`, `@ts-ignore` is down
from 115 to **4**, `src/games/runtime/` is deleted.

```bash
# re-measure the two open sibling findings
grep -rn "fetch(\`\|fetch('\|fetch(\"" src --include=*.ts --include=*.tsx | grep -v "^src/api/" | wc -l
grep -rln "from '.*api/http'" src | wc -l
for f in server/services/*.ts; do n=$(grep -c "\.query(" $f); [ "$n" -gt 0 ] && echo "$n $f"; done | sort -rn
```

---

## Contents

| # | Finding | Severity |
|---|---|---|
| [1](#1-getleaderboard-is-a-serialized-n1) | `getLeaderboard` is a serialized N+1 | 🔴 |
| [2](#2-only-3-of-15-dals-take-an-injected-dbmanager) | Only 3 of 15 DALs take an injected `dbManager` | 🟠 |
| [3](#3-apiflashcardsmark-is-hand-rolled-at-four-call-sites) | `/api/flashcards/mark` hand-rolled at five call sites | 🟠 |
| [4](#4-token-appears-in-17-dependency-arrays) | `token` in 17 dependency arrays, against the CLAUDE.md rule | 🟠 |
| [5](#5-smaller-items) | Smaller items (logging, theme tokens, orphan docs, repo clutter) | 🟡 |

[What is in good shape](#what-is-in-good-shape) · [Suggested order](#suggested-order) · [Unlanded work](#unlanded-work)

---

## 1. `getLeaderboard` is a serialized N+1

> **Resolved.** `IUserMinutePointsDAL` gained `getMinutesForDatesByUser(userIds, dates)`
> — one grouped `GROUP BY "userId", "streakDate"` scan returning a nested Map — and
> `getLeaderboard` now filters to ranked users FIRST, then issues that query in
> `Promise.all` alongside the weekly counts. 2N sequential round trips → 1. Zero-point
> users are no longer fetched at all, and an empty ranked set skips the query entirely.
>
> Two things were fixed that this section did not originally call out:
> - **A latent off-by-one in the date labels.** `setHours(0,0,0,0)` + `toISOString()`
>   snapped to LOCAL midnight then re-read that instant in UTC, which lands on the
>   previous day for any server at a positive UTC offset. Now `Intl.DateTimeFormat('en-CA')`
>   (which formats as YYYY-MM-DD in local time) plus `addDaysToDateString` for the step.
>   Not `streakDateOf` — that applies the 4 AM streak shift, deliberately not wanted here.
> - **`streakDate` is a DATE column**, so pg returns a `Date`, not the string the caller
>   passed. The DAL normalizes it back with the same local formatter; using
>   `toISOString()` there would have reintroduced the same off-by-one and silently
>   missed every lookup.
>
> Covered by `server/__tests__/leaderboard.test.ts` (6 tests). The call-count assertions
> are the point: a rewrite that reintroduces per-user lookups still returns correct
> numbers, so only a spy catches the regression.

**Location:** `server/services/LeaderboardService.ts`

```ts
for (const user of usersWithPoints) {
  const todaysMinutes     = await this.userMinutePointsDAL.getMinutesForDate(user.userId, todayStr);
  const yesterdaysMinutes = await this.userMinutePointsDAL.getMinutesForDate(user.userId, yesterdayStr);
  ...
}
```

`getMinutesForDate` (`server/dal/implementations/UserMinutePointsDAL.ts`) is one
`SUM("minutesEarned")` over `userminutepoints` scoped to a single user and a single
`streakDate`. Three problems compound:

1. **2N round trips.** Two queries per user, where a single grouped query answers all of them.
2. **Serialized.** The `await`s are inside the `for` body, so they do not overlap — latency
   is `2N × RTT`, not `RTT`. Not even `Promise.all`-parallel.
3. **Work is discarded.** Line 68 filters to `accumulativeMinutePoints > 0` *after* the
   loop, so minutes are fetched for every zero-point user and then thrown away.

`getLeaderboardRoster` (`server/dal/implementations/UserDAL.ts`, formerly
`getPublicUsersWithTotalPoints` before migration 130 moved the points off `users`) returns
**all** users, not only public ones — the `isPublic` flag is used later only to mask
`currentStreak`. So N is the full user table.

### Why this is worth fixing beyond the latency

The batching pattern already exists in this very function. Line 43:

```ts
// Weekly-achievement counts for every user in a single grouped query
// (avoids an N+1 lookup inside the per-user loop below).
const weeklyAchievementCounts = await this.winsDAL.getWeeklyCountsByUser();
```

Half the N+1 was recognised and fixed; the minutes half was left in place directly
underneath the comment describing the problem. A reader of this function will reasonably
conclude the loop is already batched.

### Target shape

One grouped query on the DAL, mirroring `getWeeklyCountsByUser()`:

```sql
SELECT "userId", "streakDate", SUM("minutesEarned") AS minutes
FROM userminutepoints
WHERE "streakDate" IN ($1, $2) AND "userId" = ANY($3)
GROUP BY "userId", "streakDate"
```

returning `Map<userId, { today: number; yesterday: number }>`. Filter `usersWithPoints`
to `totalMinutePoints > 0` **before** passing ids in, so the query does not cover users
about to be dropped. 2N queries → 1.

Blocked on finding 2 for test coverage: `getMinutesForDate` currently cannot be mocked.

```bash
# verify: should print nothing once fixed
grep -n -A3 "for (const user of usersWithPoints)" server/services/LeaderboardService.ts | grep "await"
```

---

## 2. Only 3 of 15 DALs take an injected `dbManager`

> **Resolved.** All 15 DALs now take `dbManager` as a constructor parameter defaulting to
> the process-wide singleton, so `new XDAL()` at the composition root is unchanged while
> every DAL becomes substitutable in a test. The 12 singleton DALs gained
> `constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}`; the
> three that already held the field were widened to accept an override. 63 bare
> `dbManager.executeQuery` call sites became `this.dbManager.executeQuery`.
>
> This directly unblocked finding 1's test — mocking `getMinutesForDatesByUser` is only
> possible because the DAL no longer reaches for a module singleton.
>
> **Still open:** the rule has no normative home yet. Add it to
> [BACKEND_LAYERING.md](./BACKEND_LAYERING.md) — otherwise the next DAL copies whatever
> its neighbour does, which is exactly how the split arose.

The DAL layer has **two connection-acquisition conventions**, split cleanly by file. Three
DALs use the constructor-injected `this.dbManager`; the other twelve import the module-level
`dbManager` singleton directly, bypassing the composition root (`server/dal/setup.ts`).

| Convention | DALs | Query sites |
|---|---|---:|
| `this.dbManager` — injected ✅ | `DictionaryDAL` (19), `UserDAL` (16), `VocabEntryDAL` (16) | **51** |
| `dbManager` — module singleton ❌ | `NightMarketSandboxDAL` (10), `NightMarketPlacementDAL` (9), `UserMinutePointsDAL` (9), `CommunityLayoutDAL` (8), `Icons8DAL` (6), `CharacterMutationDAL` (6), `RefreshTokenDAL` (4), `WinsDAL` (4), `GameAssetDAL` (2), `GameProgressDAL` (2), `SortPacksDAL` (2), `NightMarketDAL` (1) | **63** |

No file mixes the two — each DAL is wholly one or the other. The injected three are exactly
the core entity DALs; **everything added since has gone the singleton route**, including
`CharacterMutationDAL.ts`, which was created *during* this survey (untracked, 20:39) and
adopted the singleton pattern. (That DAL has since been deleted along with the Mandela
mutation pipeline — see [SPEED_READING_GAME.md](./SPEED_READING_GAME.md); its successor,
`SpeedReadingDAL`, injects `dbManager` per finding 2. The counts above are left at their
survey-time values, since this document is a point-in-time snapshot.) That is the strongest evidence the convention is drifting by
default rather than by decision: new DALs copy the majority shape, so the gap widens on its
own until the rule is stated somewhere a new file's author will see it —
[BACKEND_LAYERING.md](./BACKEND_LAYERING.md) is the place.

[ARCHITECTURE_REVIEW.md #8](./ARCHITECTURE_REVIEW.md#8-the-layer-model-is-applied-inconsistently)
identified this same "two competing DI patterns" problem at the **controller** layer
(`LeaderboardController`, `TTSController`) and called it "a direct blocker to finding 7"
(no server test suite). It concluded "DI is single-pattern: everything is constructed in
`server/dal/setup.ts` and injected downward." That is true of controllers and services, but
**not** of the DAL layer itself, where the majority of query sites are unmockable. The
sibling review's measurement (`grep "new XDAL()"`) could not see this, because these DALs
*are* constructed in `setup.ts` — they just ignore what is handed to them.

### Practical consequence

`UserMinutePointsDAL` (9/9 singleton) is the DAL finding 1's rewrite depends on. Its
`getMinutesForDate` cannot be substituted, so there is currently no way to unit-test the
leaderboard batching without a live database.

### Target shape

Pick one. Injecting everywhere is the smaller diff from the stated architecture and makes
the whole layer testable; the change is mechanical per file (add the constructor param,
prefix the call sites). Doing it for `UserMinutePointsDAL` alone is enough to unblock
finding 1 — the other ten can follow incrementally.

```bash
# verify: offender count, 12 files / 63 sites at time of survey
grep -rc "await dbManager\.\|[^.]dbManager\.executeQuery" server/dal/implementations/*.ts | grep -v ":0$"
```

---

## 3. `/api/flashcards/mark` is hand-rolled at four call sites

> **Resolved — and it was FIVE sites, not four.** `src/games/match-speed/` was added to
> the tree while this review was being written and had already copied the pattern; that
> is the finding demonstrating itself. New module `src/api/flashcards.ts` exports
> `markFlashcard()` and `undoFlashcardMark()`, both taking no `token`. All five mark
> sites and the one undo site now call it.
>
> Fallout worth knowing:
> - **`x-user-timezone` was dead.** Three of the five sites sent it, two did not, and a
>   grep proved NO server code reads it. Dropped rather than standardized, so it stops
>   looking load-bearing.
> - **Three game pages stopped needing `token` entirely** — the `useAuth()` destructure
>   was removed from Word Search, Bubble Match, and Match Speed.
> - The `token !== "null" && token !== "undefined"` guard is gone from the game files.
> - Bubble Match's two per-mark `console.log`s went with it (see 5a).

| File | Line |
|---|---|
| `src/features/flashcards/FlashcardsLearnPage/useWorkingLoop.ts` | 225 |
| `src/components/handwriting/PracticeWritingButton.tsx` | 92 |
| `src/games/bubble-match/BubbleMatchPage.tsx` | 289 |
| `src/games/word-search/WordSearchPage.tsx` | 448 |

Each independently rebuilds the same request: `API_BASE_URL` interpolation, a manual
`Authorization` header, `credentials: 'include'`, and the
`{ cardId, isCorrect, type, excludeIds }` body. Two of them also re-implement this guard:

```ts
if (token && token !== "null" && token !== "undefined") { ... }
```

which [ARCHITECTURE_REVIEW.md #5](./ARCHITECTURE_REVIEW.md#5-srcapihttpts-has-two-live-consumers)
flagged as copy-pasted five times inside `AuthContext.tsx`. It has since escaped into the
games — **6 sites total** app-wide.

### Why this is the right first slice of the open `api/http.ts` migration

The mark endpoint is the app's most consequential write: it appends to `typedMarkHistory`,
which drives the whole utcm mastery computation ([MASTERY_REWORK.md](./MASTERY_REWORK.md)).
Four independent implementations means four independent chances for the `type` values
(`recognition` / `production` / `reading` / `writing`) or the body shape to drift from the
server contract. The other 40 raw-`fetch` sites are mostly reads, where drift degrades a
view; drift here corrupts stored progress.

### Target shape

One `markFlashcard({ cardId, isCorrect, type, excludeIds })` in `src/api/`, built on
`apiPost`. Takes **no `token`** (per [FRONTEND_LAYERING.md §3.2](./FRONTEND_LAYERING.md)).
Collapses four sites and deletes the guard from the two game files.

```bash
# 5 files at time of survey (the 4 above + a doc comment in word-search/types.ts);
# should fall to 2 once fixed — the api module and that comment
grep -rln "api/flashcards/mark" src --include=*.ts --include=*.tsx
```

---

## 4. `token` appears in 17 dependency arrays

> **Resolved — 17 → 3**, and the 3 survivors are the documented-correct ones
> (`AuthContext` is the refresh layer; `useMinutePoints` is a deliberate ref-sync;
> `useWorkingLoop` keys on the stable `Boolean(token)`).
>
> **One of these was a live user-visible bug, not just a latent risk.**
> `DictionaryCardDetailPage`'s load effect was keyed `[word, token]`, and its body calls
> `setSelectedSenseIndex(0)`. So every ~15-minute silent refresh refetched the entry AND
> silently reset the reader's chosen sense back to the default — the exact failure mode
> the CLAUDE.md rule names, still live.
>
> Signature changes made along the way:
> - `useVocabularyProcessing(token)` → `useVocabularyProcessing()`; it now reads
>   `isAuthenticated` internally. The token was only ever an auth-presence guard —
>   the underlying lookup already supplied its own header.
> - `useEipTabs({ apiBaseUrl, token, stripRef })` → `useEipTabs({ stripRef })`.
> - `addToLibrary()` extracted to `src/utils/vocabApi.ts` (2 sites had hand-rolled it).

CLAUDE.md's ⛔ rule — *"Never reload/reset a page on a silent token refresh"* — states that
a callback which drives a load effect must build its header with `authHeader()`
(`src/utils/authHeader.ts`) and drop `token` from its deps. The access token rotates every
~15 minutes, so anything listing `token` changes identity on that cadence.

The pattern is known and applied correctly in one place —
`useWorkingLoop.ts` uses `[Boolean(token), selectedCategory, mode]`, which is stable
across a refresh. It simply was not applied everywhere.

| File | Line | Dep array |
|---|---|---|
| `src/hooks/useVocabularyProcessing.ts` | 244 | `[token, processedDocuments, loadedPersonalCards.length, loadedDictionaryCards.length]` |
| `src/hooks/useVocabularyProcessing.ts` | 364 | `[token, loadedPersonalCards, loadedDictionaryCards]` |
| `src/features/reader/ReaderDocumentPage.tsx` | 295 | `[text, token, contentEditor, vocabularyProcessing]` |
| `src/features/reader/ReaderDocumentPage.tsx` | 331 | `[text, token, navigate, notifyValidation]` |
| `src/games/word-search/WordSearchPage.tsx` | 465 | `[token, mode]` |
| `src/games/bubble-match/BubbleMatchPage.tsx` | 301 | `[token]` |
| `src/features/flashcards/FlashcardsLearnPage/FlashcardsLearnPage.tsx` | 333 | `[token]` |
| `src/features/flashcards/FlashcardsLearnPage/useWorkingLoop.ts` | 259, 407 | `[token, mode]`, `[…, token, cardDragRef]` |
| `src/features/flashcards/FlashcardsLearnPage/useEipTabs.ts` | 235 | `[apiBaseUrl, token, tabs, stripRef]` |
| `src/features/dictionary/DictionaryCardDetailPage.tsx` | 93, 123 | `[word, token]`, `[entry, token, userLanguage]` |
| `src/components/handwriting/PracticeWritingButton.tsx` | 102 | `[vocabEntryId, token]` |
| `src/hooks/useGameWins.ts` | 61 | `[token, gameKey]` |

**Two exclusions, both correct as-is:** `src/AuthContext.tsx` *is* the refresh layer
(documented exception in FRONTEND_LAYERING §3.2), and
`src/minutePoints/useMinutePoints.ts` is a deliberate `tokenRef.current = token` sync
effect, which is the intended way to read a live token without a dep.

### Severity note

These are `useCallback`s, **not** load effects, so none is currently the same bug as the
2026-07-02 mid-game Word Search reset the CLAUDE.md rule cites. The risk is second-order:
a callback whose identity changes every 15 minutes will re-fire any effect or `memo` that
depends on it, and nothing prevents a future edit from turning one of these into a load
effect. `WordSearchPage.tsx` is worth converting first on the strength of that file's
history alone. `useVocabularyProcessing.ts` (its two `token`-dependent callbacks) is the largest genuine
risk — both sit
on document-processing paths with heavy sibling deps.

### Target shape

Convert the fetch bodies to `authHeader()` (already adopted at 43 sites) and drop `token`
from the deps. Finding 3 removes four of these entries for free.

```bash
grep -rn "}, \[.*\btoken\b" src --include=*.ts --include=*.tsx | wc -l   # 17 at time of survey
```

---

## 5. Smaller items

> **5a/5c/5d resolved; 5b partially — see each.**

### 5a. Per-mark `console.log` on a production path

> **Resolved.** New `src/utils/vocabDebug.ts` — a gated namespaced logger modelled on the
> existing `authDebug.ts`, OFF by default (`localStorage.vocabDebug = 'on'` to enable).
> The 34 vocab-pipeline logs, which ran on every Reader document open and printed whole
> token arrays, now route through it; `console.error` calls were left as real errors.
> Bubble Match's two per-mark logs were deleted with finding 3. 57 → 26.

`src/games/bubble-match/BubbleMatchPage.tsx` logged every single mark and its
HTTP status, in two places. One console write per bubble matched, shipped. App-wide there are **59**
`console.log` calls in `src/`.

```bash
grep -rn "console.log" src --include=*.ts --include=*.tsx | wc -l
```

### 5b. Theme tokens ~2/3 adopted

> **Partially resolved — and the headline number was misleading.** Of 222 hex literals
> outside `src/theme/`, only **24** even equal a defined token value, and on inspection
> most of those 24 are **coincidental collisions between three independent palettes**,
> not missed token adoption:
> - `TONE_COLORS` (pinyin tones 1–4) happens to share values with the utcm category colors.
> - `MARK_TYPE_COLORS` does too — and `masteryCompute.ts` already says so:
>   *"NOTE: these currently collide with the utcm category colors; to be rectified later."*
>
> Mechanically swapping those to `CATEGORY_COLORS` would have been WRONG: it would cement
> a collision the author intends to break, and a future category recolor would silently
> restyle pinyin tone marks. Only the 8 genuinely-semantic restatements were changed —
> `ThemeContext.tsx` was duplicating `COLORS.onSurface` / `.header` / `.background` /
> `.card` / `.hskChip` verbatim while building the MUI theme.
>
> **The remaining ~200 need a design decision, not a refactor:** they have no token
> equivalent, so adopting them means *creating* and *naming* new tokens and deciding
> whether the three palettes should stay independent. That is a call for the owner.

**170** hardcoded hex literals outside `src/theme/`, against an existing
`FONTS` / `SIZE` / `WEIGHT` / `COLORS` token system ([designGuidelines.md](./designGuidelines.md)).

```bash
grep -rnE "#[0-9a-fA-F]{6}\b" src --include=*.tsx --include=*.ts | grep -v "src/theme/" | wc -l
```

### 5c. Seven orphan docs

> **Resolved without deleting anything.** Each is now linked from its natural parent, as a
> grandchild of CLAUDE.md (which was not edited — see [Landing this doc](#landing-this-doc)):
> `DEV_MACHINE_SETUP` → DOCKER_GUIDE; `newDictionaryEntriesBackfillInstructions` →
> VOCAB_ENRICHMENT_IMPLEMENTATION; `PUBLIC_PRIVATE_USERS_IMPLEMENTATION` and both
> `WORK_POINTS_*` → MINUTE_POINTS_SYSTEM (the latter two under an explicit
> "superseded history" heading); `MULTI_LANGUAGE_STATUS` → MULTI_LANGUAGE_IMPLEMENTATION
> as historical. `CHANGELOG.md` is a live to-do backlog and was left alone.

Not linked from `CLAUDE.md` or any other doc, so unreachable under the project's
grandchild-linking convention:

`CHANGELOG.md` · `DEV_MACHINE_SETUP.md` · `MULTI_LANGUAGE_STATUS.md` ·
`PUBLIC_PRIVATE_USERS_IMPLEMENTATION.md` · `WORK_POINTS_DISPLAY_UPDATE_IMPLEMENTATION.md` ·
`WORK_POINTS_SYNC_IMPLEMENTATION.md` · `newDictionaryEntriesBackfillInstructions.md`

The two `WORK_POINTS_*` documents appear superseded by
[MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md) — confirm before deleting.

Note this document is itself currently an orphan — see [Landing this doc](#landing-this-doc).
It must be excluded from the check, since it names all seven filenames above and would
otherwise mask them:

```bash
OTHER=$(ls docs/*.md | grep -v CORRECTNESS_AND_PERFORMANCE_REVIEW)
for f in $OTHER; do b=$(basename $f); grep -qr "$b" CLAUDE.md $OTHER || echo "ORPHAN: $b"; done
```

### 5d. Repo clutter tracked in git

> **Resolved, conservatively.** Removed and gitignored: the three root `screenshot*.png`
> and `cloudflared-linux-amd64.deb` (referenced by nothing; recoverable from git history).
>
> **Kept deliberately:** `det_dump.dump` and `duplicates-to-review.tsv` are referenced by
> DEV_MACHINE_SETUP.md as setup inputs.
>
> **The duplicate `cedict_ts.u8` turned out to be a real bug, not just clutter.**
> docker-compose mounts `./server` at `/app`, so the import reads
> `/app/cedict_ts.u8` = `server/cedict_ts.u8` — but
> `server/scripts/import-all-dictionaries.sh` was existence-checking the **repo-root**
> copy, a different file (9,771,863 bytes from Oct 2025 vs 9,647,832 from Mar 2026). The
> check could therefore pass while the import failed, or vice versa. Both the verify step
> and the skip guard now test the file that is actually read. The stale root copy is now
> provably unreferenced and can be deleted (`git rm cedict_ts.u8`) — left in place because
> deleting 9.7 MB of source data is the owner's call.

`screenshot.png`, `screenshot-after-scroll-up.png`, `screenshot-after-scroll-down.png`,
`cloudflared-linux-amd64.deb`, `det_dump.dump`, `duplicates-to-review.tsv`,
`LONGDEF_SPOTCHECK_REVIEW.md`.

`cedict_ts.u8` is tracked **twice** and the copies differ — root is 9,771,863 bytes
(Oct 2025), `server/cedict_ts.u8` is 9,647,832 bytes (Mar 2026). ~19 MB of near-duplicate
binary in git history, and it is not obvious which copy the import scripts read.

---

## What is in good shape

Recorded so a future reader does not re-audit these.

- **Security posture.** `helmet()` (`server/server.ts`), configured CORS (same file, the `app.use(cors({...}))` block), and
  four purpose-built limiters in `server/middleware/rateLimits.ts` (auth, refresh,
  diagnostics, proxy) attached to the matching route files.
- **No SQL injection.** All 98 template-literal interpolation sites in `server/dal` and
  `server/services` resolve through `dictTableForLanguage` / `vetTableForLanguage`
  (`server/dal/shared/dictTable.ts`, `vetTable.ts`), which are genuine two-value
  whitelists returning hard-coded table names. Both carry the safety argument inline. This
  is done correctly and should not be "fixed."
- **Migration hygiene.** 127 migrations, zero duplicate numbers
  (`ls database/migrations | sed 's/-.*//' | sort -n | uniq -d` prints nothing).
- **Connection handling.** One `pool.connect()` against 55 `.release()` calls — the
  pooling is routed through `dbManager.executeQuery`, so the classic
  leaked-client-on-error-branch failure mode does not apply here.
- **`server/dal/shared/`** is the best-factored cluster in the repo. `dictJoin.ts`,
  `vetTable.ts`, and `versionSelection.ts` document *why*, including why earlier
  shortcuts (the zh wrapping subquery) were removed.

---

## Suggested order

| Step | Finding | Rationale |
|---|---|---|
| 1 | [2](#2-only-3-of-15-dals-take-an-injected-dbmanager) | Mechanical; `UserMinutePointsDAL` alone unblocks testing step 2 |
| 2 | [1](#1-getleaderboard-is-a-serialized-n1) | Only user-visible latency win; self-contained |
| 3 | [3](#3-apiflashcardsmark-is-hand-rolled-at-four-call-sites) | Highest-value slice of the open sibling finding #5 |
| 4 | [4](#4-token-appears-in-17-dependency-arrays) | Four entries fall out of step 3 for free |
| 5 | [5](#5-smaller-items) | Independent; any order |

---

## Unlanded work

Not a code finding, but it conditions everything above. At time of survey the working
tree holds **284 changed files, +6,393 / −17,125**, of which **28 are untracked** —
including the entire ARCHITECTURE_REVIEW remediation, the new `server/contracts/` module,
`server/__tests__/`, four new route files, `src/engine/market/layerTranslucency.ts`, and
**migrations 130 and 132**.

The migrations being uncommitted alongside the code that reads their columns is the
specific risk: a partial commit can ship code expecting a column that no environment has.
Typecheck and both test suites are green right now, which is the moment to land it —
ideally split (contracts + tests / route split / doc set / migrations), not as one commit.

```bash
git status --short | wc -l && git diff --shortstat
```

---

## Landing this doc

Per CLAUDE.md, `CLAUDE.md` is not edited without the owner's say-so, and new docs should
hang off it as **grandchildren** rather than as new top-level entries. The natural parent
here is [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md), which this document is the
companion to — a "See also" line there makes both reachable without growing CLAUDE.md.

Until that link exists, this file is an orphan by the same test as [5c](#5c-seven-orphan-docs).
