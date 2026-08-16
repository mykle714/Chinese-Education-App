# Minute Points & Streak System

> **Per-language since migration 130.** Wallets, streaks and penalties are keyed
> `(userId, language)` in `user_languages`; `users.totalMinutePoints` /
> `.currentStreak` / `.lastStreakDate` / `.lastPenaltyDate` no longer exist. See
> [PER_LANGUAGE_STREAKS.md](./PER_LANGUAGE_STREAKS.md).

The minute-points system tracks active learning time and converts it into a daily
streak. One minute of focused activity = one minute point. The user's streak
counts consecutive days they earned at least `STREAK_CONFIG.RETENTION_MINUTES`
minute points (default `3`).

## Glossary

| Term | Meaning |
|---|---|
| **Minute point** | One unit of active study time, ≈ 60 seconds. Replaces the legacy "work point" terminology. |
| **Streak day** | A 4 AM-bounded day in the user's local timezone. Activity at 03:30 local on the 13th counts toward the 12th's streak day; activity at 04:00 counts toward the 13th. |
| **Streak** | Consecutive streak days where the user reached `RETENTION_MINUTES`. Hidden from non-public users on the leaderboard. |

## Layers

### Database

`users` columns (minute-points related):
- `lastMinutePointIncrement TIMESTAMP` — last successful tick (rate limit). Stays on
  `users`: the limit is one tick per user, not per language.
- `timezone` — the 4 AM local-day boundary, shared by all of a user's languages.

**Balances and streaks are NOT on `users`.** Migration 130 moved the wallet and the streak
to one row per (user, language) and dropped the old global columns in the same transaction
(`totalMinutePoints`, `currentStreak`, `lastStreakDate`, `lastPenaltyDate`). Migration 134 then
added the gross counter to that same row.

`user_languages` (PK = `userId, language`):
- `totalMinutePoints INTEGER` — **NET** balance for this language: earns raise it, penalties
  lower it (floored at the balance's 24-hour **checkpoint**, `floor(total/1440)*1440` — which
  is 0 for anything under 1440; see the NET bullet below).
- `lifetimeMinutesEarned INTEGER` — **GROSS** lifetime earned for this language (migration 134).
  **Monotonic** — nothing ever lowers it.
- `currentStreak INTEGER` — consecutive qualifying days for this language.
- `lastStreakDate DATE` — last day this language **on its own** reached
  `RETENTION_MINUTES`. Advanced only by the earn path; the penalty cron never moves it
  (it derives the escalating tier from `today − lastStreakDate`).
- `lastPenaltyDate DATE` — per-language once-per-local-day idempotency guard for the cron.

Invariant: **`lifetimeMinutesEarned >= totalMinutePoints`** — per row for every write path, but
only per USER immediately after migration 130's backfill, which concentrates a multi-language
account's whole pre-split wallet onto its primary language while gross stays genuinely
per-language. See the invariant note in `134-add-lifetime-minutes-earned.sql`. The two are EQUAL
for a never-penalized language and DIVERGE once a penalty lands.

**Two display quantities (GROSS vs NET),** both now per language:
- **NET** — the prominent "Current Balance" number on the tester dashboard + the nmp
  minutes badge. Drops on penalty/loss, but **only within its 24-hour checkpoint band**:
  an inactivity penalty can never carry it across a multiple of 1440 minute points
  (`STREAK_CONFIG.CHECKPOINT_MINUTES`), so 1560 bottoms out at 1440 and 3300 at 2880.
  Below 1440 it is unprotected and can still reach 0. Checkpoints are **absorbing** — a
  balance resting exactly on one is permanently out of the penalty system. Full rules:
  [STREAK_EXPIRATION_CRON.md § Checkpoints](./STREAK_EXPIRATION_CRON.md#checkpoints--the-penalty-floor).
  The one debit path that ignores checkpoints is the template-author `−N` dev tool.
- **GROSS** — the secondary "N total minutes earned" caption. Only grows.

### Why per language

Two independent reasons, one per column family:
- **Counters.** The per-language study total was the last figure still computed as a SUM
  over the whole `userminutepoints` history (`getTotalMinutesForLanguage`), so its cost
  grew with account age. As a counter it is O(1). (Migration 133 had already done this for
  the global gross; 134 finished the job by making every counter per-language.)
- **Streak/penalty.** A learner studying two languages keeps and loses each language's
  streak on its own merits. Neglecting Spanish penalizes Spanish only.

### ⚠️ Semantic change: the threshold is per language

The daily `RETENTION_MINUTES` threshold used to be evaluated on the day's total summed
**across** languages — any 3 minutes kept the single global streak alive. It is now
evaluated **per language**: 3 minutes of zh advance the zh streak and nothing else. A user
splitting 2 minutes zh + 2 minutes es previously advanced their streak and now advances
neither.

### Counters are maintained, never aggregated

Which counter a write moves is decided by **which DAL method the caller reaches for**:

| Event | Method | NET | GROSS |
|---|---|---|---|
| Study tick +1 (`UserMinutePointsService.ts`) | `UserLanguagesDAL.incrementPoints` | ↑ | ↑ |
| Author adjust `+delta` | `UserLanguagesDAL.incrementPoints` | ↑ | ↑ |
| Author adjust `−delta` | `UserLanguagesDAL.adjustPoints` | ↓ floored | — |
| Hourly penalty cron | `expire-stale-streaks.sql` | ↓ floored | — |

`incrementPoints` bumps both columns in a **single UPSERT**, so there is no window
where one moved and the other did not; it rejects negative input, which is what makes it
safe to bind gross to it. `adjustPoints` deliberately touches net only — a penalty
must never lower gross.

### Global rollups (the two consumers that are still global)

- The **night-market unlock entitlement** reads Σ net across languages
  (`UserMinutePointsService.getGlobalNet`). The market has no language dimension yet —
  `nightmarketunlocks` and `nightmarkettemplatelocations` are keyed on `userId` alone — so
  per-language entitlement is **Phase 2**.
- The **leaderboard** (test-only) rolls up in SQL inside
  `IUserLanguagesDAL.getTotalsForAllUsers`: `SUM(totalMinutePoints)` and
  `MAX(currentStreak)` (the user's best language streak).

Both aggregate over one row per language — bounded by language count, never by account age.

`userminutepoints` (PK = `userId, streakDate, language`):
- `language VARCHAR(10) NOT NULL DEFAULT 'zh'` — the language the minute was earned studying (migration 62). One row per `(streakDate, language)`.
- `minutesEarned INTEGER` — sum across all of the user's devices, for that language.
- `penaltyMinutes INTEGER` — minutes deducted by the escalating inactivity penalty, stamped on the missed day (`today − 1`), attributed to **the language actually penalized** (migration 130; it used to be a guess at the user's `selectedLanguage`). Written by the cron and by the author dev tool's −N path. The cron stamps the **derived** amount (`total − new_total`, what actually left the wallet), never the nominal tier value, so a penalty partly absorbed by the 24-hour checkpoint records the real, smaller number. A **fully** absorbed penalty (0 removed) writes no row — this table has no missed-day flag, so an all-zero row would be indistinguishable from an absent one. Consequence for audits: an absent row means "nothing was taken", which covers both "the cron never examined this day" and "a checkpoint absorbed it"; the cron's NOTICE log is the only place those two are distinguished.
- `lastSyncTimestamp`, `updatedAt` — bookkeeping timestamps.

There is **no** device fingerprint and **no** longest-streak field.

**Why the per-day ledger stays.** With every counter now maintained per language, the
obvious next thought is to drop `userminutepoints` entirely. Don't — it is the sole
backing for four things a counter cannot reproduce:

| Consumer | Needs from the ledger |
|---|---|
| Per-language threshold crossing (`UserMinutePointsService.ts`) | this language's minutes on the current day |
| Study calendar, tdp (`getCalendar`) | per-day `minutesEarned` + `penaltyMinutes` for any past month |
| Per-language fire badge (`getTodayMinutes`) | today's minutes for one language |
| Calendar `hasData` bound (`getFirstActivityDate`) | first activity date for the language |

Every one is bounded to a single day or a single month and hits the PK's leading `userId`
column, so none grows with account age the way the retired lifetime `SUM` did. Row growth
is ~365 per user per language per year, which is not a scaling concern at this size.

Note the ledger and the counters are **independent writes**, not derived from one another
— the reconstruction `Σ minutesEarned − Σ penaltyMinutes` is NOT guaranteed to equal
`totalMinutePoints`. Treat `user_languages` as authoritative for balances and the ledger as
authoritative for per-day history.

**Language scoping (migrations 62 → 134).** Migration 62 partitioned the day ledger by
language while the streak and balance stayed global. Migration 134 finished the job:
balances, streaks, and penalties are all per language now, and nothing about minute points
is global except the two rollups listed above.

### Server

- `server/utils/streakDate.ts` — `streakDateOf(timestamp, tz)`, plus tz validation and date-arithmetic helpers.
- `UserMinutePointsService.incrementMinutePoints` — adds 1 minute to the row for the **client-supplied `language`** (the language the client actually accrued for; falls back to `selectedLanguage` then `'zh'` when an old client omits it), then advances **that language's** streak when **that language's** day total crosses `RETENTION_MINUTES` (per-language since migration 130 — it used to be the cross-language sum advancing one global streak). Rate-limited to ~one call per 59 seconds. Attributing from the payload rather than re-reading `selectedLanguage` avoids crediting the wrong language when `selectedLanguage` has raced ahead of an in-flight increment.
- `UserMinutePointsService.getCalendar(userId, language, yearMonth)` — returns one row per day for the requested month and language, zero-filled.
- `UserMinutePointsService.getLanguageSummary(userId, language, timestamp, tz)` — returns `{ totalMinutePoints (this language's net), lifetimeMinutesEarned (this language's gross), todayMinutes (fire badge), currentStreak (this language's streak) }`. Backs `GET /api/users/minutePoints/summary`. **Every field is language-scoped** since migration 130; the field NAMES are unchanged because they are the client contract, only their scope moved. A language the user has never studied has no row and correctly returns all zeros.
- `UserMinutePointsService.adjustMinutesForAuthor(userId, delta, timestamp, tz)` — **template-author-only** dev tool (`POST /api/nightMarket/dev/adjustMinutes`, gated on `isTemplateAuthor`, 403 otherwise, NOT rate-limited). `delta > 0` adds to today's `minutesEarned` + credits **both** counters; `delta < 0` adds `|delta|` to today's `penaltyMinutes` (gross intact) + debits net only (floored); then reconciles the night market (`NightMarketPlacementService.reconcileUnlocks` — grant on +, decay on −; decay also prunes empty dangling templates). Backs the nmp ±1/±5/±30 + Submit buttons. See docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md.
- DAL split: the day ledger (`IUserMinutePointsDAL`) serves per-day/per-month reads; the wallet/streak/gross row (`IUserLanguagesDAL`) serves balances and streaks. `getMinutesForDate` still sums a day across all languages but is now used only by the test-only leaderboard — the streak threshold reads the single-language day total returned by `addMinutesForDate`.
- `database/cron/expire-stale-streaks.sql` — hourly Postgres cron, the **sole authority for streak breaks and point penalties**. For each user below the threshold (`today − lastStreakDate ≥ 2`, in the user's stored tz, 4 AM-bounded), it debits an **escalating** penalty by consecutive missed day (`3, 15, 30, 60, 90, 120`, then the remainder on day 7+) from `totalMinutePoints` — **floored at the balance's 24-hour checkpoint**, so no debit crosses a multiple of 1440 — resets `currentStreak = 0`, and stamps the amount actually debited as `penaltyMinutes` on the missed day (`today − 1`) unless that amount is 0. Once per user per local day (`lastPenaltyDate` guard). See `docs/STREAK_EXPIRATION_CRON.md`.
- `UserController.onLogin` — post-login hook (`POST /api/auth/onLogin`). Today: refreshes `users.timezone` from the client so the cron has an up-to-date tz for every active user.
- `LeaderboardService` — masks `currentStreak` to `null` for non-public users.

### Client

- `useMinutePoints` (hook) — local accumulating timer + reads the per-language server summary (`fetchLanguageSummary`). Scoped to `user.selectedLanguage`; re-seeds today/total/streak when the language changes. localStorage is keyed by `(userId, language)`. The timer runs only while `isActive`, which `useActivityDetection` sets on the first `click`/`keydown`/`touchstart`/`pointerdown` and holds for `ACTIVITY_TIMEOUT_MS` (15s) after the last interaction. **Auto-active on game entry:** for pages matching `MINUTE_POINTS_AUTO_ACTIVE_PAGES` (`/games/*`, see `src/constants.ts`) the hook calls `recordActivity()` on mount so accrual starts immediately, without waiting for the first tap; other eligible pages (flashcards, reader) still require an interaction.
- `useCalendarMinutePoints` (hook) — fetches the calendar endpoint with `?language=`, derives `isToday`/`hasData` in browser tz.
- `minutePointsSync.incrementMinutePoint(language, token)` — POSTs `{ timestamp, tz, language }`; `language` is the hook's accrual language (`languageRef.current`), matching the badge/localStorage it just incremented optimistically. `fetchLanguageSummary` GETs `/summary?language&tz&timestamp`. The tz is taken from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- `authSync.notifyLogin` — fired from `AuthContext` after login and session restore; POSTs `{ tz }` to `/api/auth/onLogin` so `users.timezone` stays fresh even for users who don't earn points.
- `MonthlyCalendar` / `StreakCounter` / `LeaderboardPlaceholder` — UI surfaces.
- `MinutePointsBadge` — fire-icon badge on `/flashcards`, `/flashcards/learn`, `/reader`.

## Day boundary

A streak day starts at **04:00 in the user's local timezone**. Implementation:

```
streakDateOf(t, tz) =
  let (y,m,d,hour) = t projected into tz
  if hour < 4: subtract 1 day
  return YYYY-MM-DD
```

The server resolves the streak day on every request from `(timestamp, tz)`.
There is no persisted `users.timezone` column — the client supplies its tz
on each call.

## API

| Method | Endpoint | Body / params | Notes |
|---|---|---|---|
| GET  | `/api/users/:id/totalMinutePoints`            | —                              | `{ totalMinutePoints, currentStreak }` — cross-language rollup (Σ net, MAX streak) computed in `UserService`; no longer called by the client hook |
| GET  | `/api/users/minutePoints/summary`              | query: `language`, `tz`, `timestamp` | `{ totalMinutePoints (NET), lifetimeMinutesEarned (GROSS), todayMinutes, currentStreak }` — **all four scoped to `language`** |
| POST | `/api/nightMarket/dev/adjustMinutes`          | body: `{ delta, timestamp, tz }` | **template-author only (403)** — artificial ±N minute signal; returns `{ totalMinutePoints, lifetimeMinutesEarned }`; reconciles the market |
| POST | `/api/users/minutePoints/increment`            | `{ timestamp, tz, language? }` | Adds 1 to the payload `language` (falls back to `selectedLanguage`); may advance THAT language's streak |
| GET  | `/api/users/minutePoints/calendar/:yearMonth`  | path: `YYYY-MM`; query: `language` | Dense per-day list (one language) with `minutesEarned` and `penaltyMinutes` |
| POST | `/api/auth/onLogin`                            | `{ tz }`                       | Post-login bookkeeping (currently: refresh `users.timezone`) |
| GET  | `/api/leaderboard`                              | —                              | `currentStreak` is `null` for non-public users |

## Streak break flow

1. User hits goal on 12/10 → `currentStreak = N`, `lastStreakDate = 2024-12-10`.
2. User skips 12/11 entirely.
3. At the next `HH:01` after the user's local 4 AM on 12/12, the hourly Postgres cron (`expire-stale-streaks.sql`) sweeps every user with `totalMinutePoints > 0` and `today_local - lastStreakDate >= 2`.
4. For each match it computes `tier = today_local - lastStreakDate - 1` (here `1`, the first missed day) and debits the tier penalty (`3` min): stamps `penaltyMinutes` on **2024-12-11** (the missed day = `today − 1`), resets `currentStreak = 0` (a missed day always breaks the streak, even if the checkpoint floor leaves the balance untouched), debits from `totalMinutePoints` (floored at the balance's 24-hour checkpoint), and stamps `lastPenaltyDate = today_local` for idempotency. `lastStreakDate` is **left unchanged**, so 12/13 escalates to tier 2 (`15` min), 12/14 to tier 3 (`30`), etc., resetting only when the user hits the threshold again.
5. The cron reads `users.timezone` directly; the client keeps that column fresh via `/api/auth/onLogin` and `/api/users/minutePoints/increment`.

## Related documents

- [PUBLIC_PRIVATE_USERS_IMPLEMENTATION.md](./PUBLIC_PRIVATE_USERS_IMPLEMENTATION.md) —
  the `users.isPublic` flag that gates what the leaderboard reveals. The leaderboard
  aggregate itself lives in `server/services/LeaderboardService.ts`; `isPublic` masks
  `currentStreak` only, never the minute totals.
- **Superseded history** — the two documents below describe the system under its former
  "work points" name (renamed to minute points in migration 48). They are kept for the
  reasoning behind the sync design, NOT as a description of current behaviour; where
  they disagree with this file, this file wins.
  - [WORK_POINTS_SYNC_IMPLEMENTATION.md](./WORK_POINTS_SYNC_IMPLEMENTATION.md) — the
    daily-boundary client↔server sync.
  - [WORK_POINTS_DISPLAY_UPDATE_IMPLEMENTATION.md](./WORK_POINTS_DISPLAY_UPDATE_IMPLEMENTATION.md)
    — making the counter update without a refresh.

## Configuration

| Config | Default | Layer |
|---|---|---|
| `STREAK_RETENTION_MINUTES` / `VITE_STREAK_RETENTION_MINUTES` | 3 | Both |
| `STREAK_CONFIG.PENALTY_SCHEDULE_MINUTES` | `[3, 15, 30, 60, 90, 120]` | Both (constant) |
| `STREAK_CONFIG.CHECKPOINT_MINUTES` | `1440` (24 h) | Both (constant) |

`RETENTION_MINUTES` is env-overridable. The escalating penalty schedule and the
checkpoint interval are hard-coded constants in `server/constants.ts`, mirrored in
`src/constants.ts`, and hard-coded again in
`database/cron/expire-stale-streaks.sql` — all three must stay in sync, and the SQL
is the only copy any code actually executes. The 7th+ consecutive missed day takes
the whole remaining balance **down to its checkpoint** (no schedule entry). There is no longer a flat `DAILY_PENALTY_MINUTES`, `PENALTY_PERCENT`,
or `RETENTION_POINTS` config.
