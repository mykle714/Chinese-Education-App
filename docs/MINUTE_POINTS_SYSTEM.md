# Minute Points & Streak System

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

`users` columns:
- `totalMinutePoints INTEGER` — lifetime accumulator. Also drives the Night Market
  unlock count (DESIGN stage — see
  [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md#unlock-economy-minutes--unlocks)):
  a threshold schedule maps this value to how many unlocks the user has, and the
  inactivity cron's debits remove unlocks when it drops.
- `lastMinutePointIncrement TIMESTAMP` — last successful tick (rate limit).
- `currentStreak INTEGER NOT NULL DEFAULT 0`.
- `lastStreakDate DATE` — last streak day the user satisfied the threshold. Advanced **only** by the increment path; the penalty cron never moves it (the escalating penalty derives its tier from `today − lastStreakDate`).

`userminutepoints` (PK = `userId, streakDate, language`):
- `language VARCHAR(10) NOT NULL DEFAULT 'zh'` — the language the minute was earned studying (migration 62). One row per `(streakDate, language)`.
- `minutesEarned INTEGER` — sum across all of the user's devices, for that language.
- `penaltyMinutes INTEGER` — minutes deducted by the escalating inactivity penalty, stamped on the missed day (`today − 1`), attributed to the user's `selectedLanguage` at penalty time. Written **only** by the cron.
- `lastSyncTimestamp`, `updatedAt` — bookkeeping timestamps.

There is **no** device fingerprint and **no** longest-streak field.

**Language scoping (migration 62).** Minutes are partitioned by language so the
home screen and the fire badge show the count for the user's *selected* language.
The **streak stays global**: `users.currentStreak` / `lastStreakDate` /
`totalMinutePoints` are not language-scoped, studying *any* language keeps the
streak alive, and the daily threshold is evaluated on the day's total **summed
across all languages**. Only the *displayed* per-language counts come from
`userminutepoints` filtered by language.

### Server

- `server/utils/streakDate.ts` — `streakDateOf(timestamp, tz)`, plus tz validation and date-arithmetic helpers.
- `UserMinutePointsService.incrementMinutePoints` — adds 1 minute to the row for the **client-supplied `language`** (the language the client actually accrued for; falls back to `selectedLanguage` then `'zh'` when an old client omits it), then advances the **global** streak when the day's cross-language total crosses `RETENTION_MINUTES`. Rate-limited to ~one call per 59 seconds. Attributing from the payload rather than re-reading `selectedLanguage` avoids crediting the wrong language when `selectedLanguage` has raced ahead of an in-flight increment.
- `UserMinutePointsService.getCalendar(userId, language, yearMonth)` — returns one row per day for the requested month and language, zero-filled.
- `UserMinutePointsService.getLanguageSummary(userId, language, timestamp, tz)` — per-language lifetime total + today's minutes, plus the global current streak. Backs `GET /api/users/minute-points/summary`.
- DAL split: `getMinutesForDate` sums across **all** languages (global streak + leaderboard); `getMinutesForDateAndLanguage` / `getTotalMinutesForLanguage` are the per-language reads.
- `database/cron/expire-stale-streaks.sql` — hourly Postgres cron, the **sole authority for streak breaks and point penalties**. For each user below the threshold (`today − lastStreakDate ≥ 2`, in the user's stored tz, 4 AM-bounded), it debits an **escalating** penalty by consecutive missed day (`3, 15, 30, 60, 90, 120`, then wipe the remainder on day 7+) from `totalMinutePoints`, resets `currentStreak = 0`, and stamps the debited amount as `penaltyMinutes` on the missed day (`today − 1`). Once per user per local day (`lastPenaltyDate` guard). See `docs/STREAK_EXPIRATION_CRON.md`.
- `UserController.onLogin` — post-login hook (`POST /api/auth/on-login`). Today: refreshes `users.timezone` from the client so the cron has an up-to-date tz for every active user.
- `LeaderboardService` — masks `currentStreak` to `null` for non-public users.

### Client

- `useMinutePoints` (hook) — local accumulating timer + reads the per-language server summary (`fetchLanguageSummary`). Scoped to `user.selectedLanguage`; re-seeds today/total/streak when the language changes. localStorage is keyed by `(userId, language)`. The timer runs only while `isActive`, which `useActivityDetection` sets on the first `click`/`keydown`/`touchstart`/`pointerdown` and holds for `ACTIVITY_TIMEOUT_MS` (15s) after the last interaction. **Auto-active on game entry:** for pages matching `MINUTE_POINTS_AUTO_ACTIVE_PAGES` (`/games/*`, see `src/constants.ts`) the hook calls `recordActivity()` on mount so accrual starts immediately, without waiting for the first tap; other eligible pages (flashcards, reader) still require an interaction.
- `useCalendarMinutePoints` (hook) — fetches the calendar endpoint with `?language=`, derives `isToday`/`hasData` in browser tz.
- `minutePointsSync.incrementMinutePoint(language, token)` — POSTs `{ timestamp, tz, language }`; `language` is the hook's accrual language (`languageRef.current`), matching the badge/localStorage it just incremented optimistically. `fetchLanguageSummary` GETs `/summary?language&tz&timestamp`. The tz is taken from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- `authSync.notifyLogin` — fired from `AuthContext` after login and session restore; POSTs `{ tz }` to `/api/auth/on-login` so `users.timezone` stays fresh even for users who don't earn points.
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
| GET  | `/api/users/:id/total-minute-points`            | —                              | `{ totalMinutePoints, currentStreak }` — **global** accumulator (leaderboard); no longer called by the client hook |
| GET  | `/api/users/minute-points/summary`              | query: `language`, `tz`, `timestamp` | `{ totalMinutePoints, todayMinutes, currentStreak }` — per-language total + today, global streak |
| POST | `/api/users/minute-points/increment`            | `{ timestamp, tz, language? }` | Adds 1 to the payload `language` (falls back to `selectedLanguage`); may advance the global streak |
| GET  | `/api/users/minute-points/calendar/:yearMonth`  | path: `YYYY-MM`; query: `language` | Dense per-day list (one language) with `minutesEarned` and `penaltyMinutes` |
| POST | `/api/auth/on-login`                            | `{ tz }`                       | Post-login bookkeeping (currently: refresh `users.timezone`) |
| GET  | `/api/leaderboard`                              | —                              | `currentStreak` is `null` for non-public users |

## Streak break flow

1. User hits goal on 12/10 → `currentStreak = N`, `lastStreakDate = 2024-12-10`.
2. User skips 12/11 entirely.
3. At the next `HH:01` after the user's local 4 AM on 12/12, the hourly Postgres cron (`expire-stale-streaks.sql`) sweeps every user with `totalMinutePoints > 0` and `today_local - lastStreakDate >= 2`.
4. For each match it computes `tier = today_local - lastStreakDate - 1` (here `1`, the first missed day) and debits the tier penalty (`3` min): stamps `penaltyMinutes` on **2024-12-11** (the missed day = `today − 1`), resets `currentStreak = 0`, debits from `totalMinutePoints` (floored at 0), and stamps `lastPenaltyDate = today_local` for idempotency. `lastStreakDate` is **left unchanged**, so 12/13 escalates to tier 2 (`15` min), 12/14 to tier 3 (`30`), etc., resetting only when the user hits the threshold again.
5. The cron reads `users.timezone` directly; the client keeps that column fresh via `/api/auth/on-login` and `/api/users/minute-points/increment`.

## Configuration

| Config | Default | Layer |
|---|---|---|
| `STREAK_RETENTION_MINUTES` / `VITE_STREAK_RETENTION_MINUTES` | 3 | Both |
| `STREAK_CONFIG.PENALTY_SCHEDULE_MINUTES` | `[3, 15, 30, 60, 90, 120]` | Both (constant) |

`RETENTION_MINUTES` is env-overridable. The escalating penalty schedule is a
hard-coded constant in `server/constants.ts`, mirrored in `src/constants.ts`, and
hard-coded again in `database/cron/expire-stale-streaks.sql` — all three must stay
in sync. The 7th+ consecutive missed day wipes the remaining balance to 0 (no
schedule entry). There is no longer a flat `DAILY_PENALTY_MINUTES`, `PENALTY_PERCENT`,
or `RETENTION_POINTS` config.
