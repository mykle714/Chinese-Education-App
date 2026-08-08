# Per-Language Streaks, Wallets & Penalties

**STATUS: IMPLEMENTED (migration not yet run).** All code, the migration and the
cron are written and type-clean; the 105-test suite passes. Migration 130 has
**not** been executed anywhere — see § 5.

Every unit of study progress — the streak, the minute-point wallet, the
inactivity penalty, and the Night Market it funds — is scoped to a **single
language**. A user studying `zh` and `es` has two fully independent tracks that
never read or write each other's state.

Prior to this change all four were global columns on `users`, and only
`userminutepoints` carried a `language`. That produced a write/read mismatch: the
penalty cron picked a language via `COALESCE(users."selectedLanguage", 'zh')` at
tick time and stamped the debit onto that language's row, while the calendar read
path filtered `WHERE language = <selected>`. A user who switched languages
between two ticks saw penalties land on a language they had not studied, and the
per-language calendar no longer reconciled with the global balance.

---

## 1. Data model

### 1.1 `user_language_points` (new, migration 130)

Replaces the four global columns on `users`. Keyed the same way as
`userminutepoints`, so the whole minute-points domain is uniformly
language-dimensioned.

| Column | Type | Meaning |
|---|---|---|
| `userId` | uuid, FK → `users(id)` ON DELETE CASCADE | |
| `language` | varchar(10) | PK part 2 |
| `totalMinutePoints` | integer NOT NULL DEFAULT 0 | **NET** wallet for this language — penalty-debited, floored at 0. Funds this language's Night Market. |
| `currentStreak` | integer NOT NULL DEFAULT 0 | Consecutive qualifying days **in this language**. |
| `lastStreakDate` | date | Last local day this language crossed the 3-min threshold. Advanced **only** by the increment path; the cron never touches it. |
| `lastPenaltyDate` | date | Cron idempotency guard — at most one penalty per (user, language) per local day. |
| `createdAt` / `updatedAt` | timestamptz | |

PK `(userId, language)`.

A row is created lazily on the language's first earned minute. **A language with
no row, or with `lastStreakDate IS NULL`, is exempt from the penalty cron** —
there is no reference day to escalate from. This is the per-language form of the
old global exemption, and it implements the "only languages ever studied" rule:
a language enters the penalty system the first time it crosses the threshold.

### 1.2 Dropped columns on `users`

`totalMinutePoints`, `currentStreak`, `lastStreakDate`, `lastPenaltyDate` are
**dropped by migration 130** (step 6, after its verification block reads them to
prove the wallet was conserved), along with the two partial indexes over them.
There is no phased retreat: every account is a test account, and leaving the
columns would create a second, silently-stale source of truth.

> ⚠️ Do not reintroduce reads of these columns — they do not exist. `IUserDAL` no
> longer exposes them; use `IUserLanguagePointsDAL`.

### 1.3 Night Market gains a language dimension

Each language grows its **own market**. Both placement tables get `language`:

- `nightmarkettemplatelocations` + `language varchar(10) NOT NULL`; the unique
  corner index becomes `(userId, language, offsetCol, offsetRow)` so the same
  grid corner can host a stall in each language's market.
- `nightmarketunlocks` + `language varchar(10) NOT NULL`.

`unlocksForMinutes()` (`server/dal/shared/unlockSchedule.ts`) is unchanged — it
is a pure curve; it is simply now called with a per-language wallet.

### 1.4 Backfill rule

Each user's **primary language** = the language with the greatest
`SUM(minutesEarned)` in `userminutepoints` (ties broken alphabetically), falling
back to `users.selectedLanguage` for users with no rows at all.

- The primary language inherits the user's **entire** global wallet and streak
  state (`totalMinutePoints`, `currentStreak`, `lastStreakDate`,
  `lastPenaltyDate`) verbatim.
- Every other studied language starts at **0 points, 0 streak,
  `lastStreakDate = NULL`** — hence cron-exempt until first studied under the new
  system. No language is retroactively penalized for history it was never
  independently tracked through.
- All existing Night Market placements and unlocks are attributed to the primary
  language, so each user's current market is preserved intact as their primary
  language's market.
- **Historical penalties are re-attributed** (step 3c). The pre-130 cron stamped
  debits onto `COALESCE(users."selectedLanguage", 'zh')` at tick time, unrelated
  to where the minutes were earned — e.g. michael's 15-minute penalty for
  2026-07-25 sat on `es` though all those minutes were `zh`. Every penalty on a
  non-primary language is summed into the primary language's row for that day and
  zeroed at the source, so the per-language calendars show no phantom penalties.
  `minutesEarned` is untouched: those attributions were always correct, because
  the increment path has always known its language.

---

## 2. Behavior

### 2.1 Threshold — per language

Crossing `STREAK_CONFIG.RETENTION_MINUTES` (3 min) **in language L** advances
L's streak only. Three minutes of Spanish no longer keeps a Chinese streak alive.

The increment path therefore reads `getMinutesForDateAndLanguage` rather than
`getMinutesForDate` (which sums across languages). `getMinutesForDate` survives
only for the leaderboard's "active today" figure, where the cross-language sum is
still the intended number.

### 2.2 Escalating penalty — per language

The tier formula is unchanged, but derived per language:

```
tier = today_local - user_language_points.lastStreakDate - 1
```

| Tier | Penalty (min) | Cumulative |
|---|---|---|
| 1 | 3 | 3 |
| 2 | 15 | 18 |
| 3 | 30 | 48 |
| 4 | 60 | 108 |
| 5 | 90 | 198 |
| 6 | 120 | 318 |
| 7+ | all remaining → 0 | — |

Schedule stays in sync with `STREAK_CONFIG.PENALTY_SCHEDULE_MINUTES`
(`server/constants.ts`) and its client mirror (`src/constants.ts`).

Each tick, per (user, language) with points to lose and a non-null
`lastStreakDate`:

- debit the tier penalty from **that language's** `totalMinutePoints`, floored at 0;
- stamp the actual amount removed onto `userminutepoints` for
  `(userId, missed_date, language)` — the language is now **known**, not guessed;
- reset that language's `currentStreak` to 0;
- set that language's `lastPenaltyDate = today_local`.

**A lapse in two languages debits both on the same tick.** This is intended:
independent tracks decay independently. Because the wallets are separate, the two
debits do not compound against a shared balance.

### 2.3 Night Market decay — per language

The decay branch runs in the same transaction and trims each penalized
**(user, language)** pair's occupants to `unlocksForMinutes(new_total_for_that_language)`,
deleting surplus `nightmarketunlocks` rows **partitioned by (userId, language)**.
Placements remain append-only and are never deleted; an emptied template renders
its unoccupied version on the next layout read.

### 2.4 Leaderboard — global, Σ of wallets

Deliberately **not** language-scoped. The board ranks on the **sum** of a user's
per-language wallets, preserving today's single-board behavior and board size.
The streak column shows the user's **maximum** current streak across languages.

Rationale: the wallet split is about making progress and decay honest per
language; the leaderboard is a social surface where splitting it would fragment
an already-small user base (only 2 of 13 users have non-`zh` history).

---

## 3. Code map

| Layer | File | Change |
|---|---|---|
| **Migration** | `database/migrations/130-per-language-streaks.sql` | New table, night-market `language` columns, backfill |
| **Cron** | `database/cron/expire-stale-streaks.sql` | Per-(user, language) candidates; decay partitioned by language |
| **DAL (new)** | `server/dal/implementations/UserLanguagePointsDAL.ts` | Wallet + streak state CRUD, keyed `(userId, language)` |
| **DAL** | `server/dal/implementations/UserDAL.ts` | Remove points/streak methods (was lines 174-431) |
| **DAL** | `server/dal/implementations/UserMinutePointsDAL.ts` | `getMinutesForDate` retained for leaderboard only |
| **DAL** | `server/dal/implementations/NightMarketPlacementDAL.ts` | All placement/unlock queries take `language` |
| **Shared** | `server/dal/shared/unlockSchedule.ts` | Unchanged (pure curve) |
| **Service** | `server/services/UserMinutePointsService.ts` | Threshold + streak advance per language |
| **Service** | `server/services/NightMarketPlacementService.ts` | `grantUnlocks`/`reconcileUnlocks` take `language` |
| **Service** | `server/services/LeaderboardService.ts` | Rank on Σ wallets, streak = max |
| **Client** | `src/minutePoints/useMinutePoints.ts` + sync/storage | Wallet & streak are per selected language |
| **Client** | `src/components/StreakCounter.tsx`, `TimeDisplay.tsx` | Show selected language's streak/balance |
| **Client** | `src/features/nightmarket/nightMarketLayoutApi.ts`, `useMarketWorld.ts` | Layout read carries `language`; the load effect keys on `isAuthenticated` + `language` (never `token`) |
| **Controller util (new)** | `server/utils/languageParam.ts` | `resolveLanguage` / `resolveWriteLanguage`, extracted from `UserMinutePointsController` when a second controller needed them |

### Removed API

`GET /api/users/:id/total-minute-points` is **gone** — there is no single total to
return. Clients use `GET /api/users/minute-points/summary?language=…`, whose
existing response shape is unchanged but whose every figure is now scoped to the
requested language.

### Dependency note

This document is referenced by:
- [MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md) — the minute-points domain
- [STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md) — the cron's contract
- [NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md) — market is now per-language

---

## 4. Behavior changes a tester should look for

- Studying Spanish no longer keeps a Chinese streak alive, and vice versa.
- Switching languages swaps the whole home-screen snapshot: balance, gross earned,
  today's minutes, streak — and the Night Market renders a different continent.
- A language you have never studied to 3 minutes is never penalized (it has no
  `lastStreakDate`), so a second language cannot start bleeding points on its own.
- Neglecting two languages at once debits both on the same hourly tick, from their
  separate wallets.
- The leaderboard looks unchanged: same single board, ranked on Σ wallets, with
  "best streak" now meaning the max across a user's languages.

## 5. Deployment

Migration 130 has **not been run**. It was authored on the prod machine but
deliberately not executed there; build and verify on dev first, then ship via
`/deploy`.

Order matters — the cron SQL and the prune script both read
`user_language_points`, so they break until the migration lands:

1. Run migration 130 (its `DO` block aborts the transaction on a bad backfill).
2. Deploy the app.
3. Reinstall the maintenance schedule via
   `database/cron/install-maintenance-timer.sh` — the on-disk SQL is already
   rewritten and will fail against a pre-130 schema.
