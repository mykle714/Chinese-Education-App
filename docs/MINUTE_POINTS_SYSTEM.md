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
- `lastStreakDate DATE` — last streak day the user satisfied (or the day a penalty was applied to mark a break as resolved).

`userminutepoints` (PK = `userId, streakDate, language`):
- `language VARCHAR(10) NOT NULL DEFAULT 'zh'` — the language the minute was earned studying (migration 62). One row per `(streakDate, language)`.
- `minutesEarned INTEGER` — sum across all of the user's devices, for that language.
- `penaltyMinutes INTEGER` — minutes deducted by a streak/inactivity penalty stamped on the missed day, attributed to the user's `selectedLanguage` at penalty time.
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
- `UserMinutePointsService.incrementMinutePoints` — adds 1 minute to the row for the user's `selectedLanguage` (read server-side; no client language payload), then advances the **global** streak when the day's cross-language total crosses `RETENTION_MINUTES`. Rate-limited to ~one call per 59 seconds.
- `UserMinutePointsService.getCalendar(userId, language, yearMonth)` — returns one row per day for the requested month and language, zero-filled.
- `UserMinutePointsService.getLanguageSummary(userId, language, timestamp, tz)` — per-language lifetime total + today's minutes, plus the global current streak. Backs `GET /api/users/minute-points/summary`.
- DAL split: `getMinutesForDate` sums across **all** languages (global streak + leaderboard); `getMinutesForDateAndLanguage` / `getTotalMinutesForLanguage` are the per-language reads.
- `database/cron/expire-stale-streaks.sql` — hourly Postgres cron, the **sole authority for streak breaks**. If `today - lastStreakDate >= 2` (in the user's stored tz, 4 AM-bounded), resets `currentStreak = 0`, deducts `DAILY_PENALTY_MINUTES` from `totalMinutePoints`, and stamps `penaltyMinutes` on `lastStreakDate + 1`. See `docs/STREAK_EXPIRATION_CRON.md`.
- `UserController.onLogin` — post-login hook (`POST /api/auth/on-login`). Today: refreshes `users.timezone` from the client so the cron has an up-to-date tz for every active user.
- `LeaderboardService` — masks `currentStreak` to `null` for non-public users.

### Client

- `useMinutePoints` (hook) — local accumulating timer + reads the per-language server summary (`fetchLanguageSummary`). Scoped to `user.selectedLanguage`; re-seeds today/total/streak when the language changes. localStorage is keyed by `(userId, language)`.
- `useCalendarMinutePoints` (hook) — fetches the calendar endpoint with `?language=`, derives `isToday`/`hasData` in browser tz.
- `minutePointsSync.incrementMinutePoint` — POSTs include `{ timestamp, tz }` (no language; server uses `selectedLanguage`). `fetchLanguageSummary` GETs `/summary?language&tz&timestamp`. The tz is taken from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
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
| POST | `/api/users/minute-points/increment`            | `{ timestamp, tz }`            | Adds 1 to `selectedLanguage`; may advance the global streak |
| GET  | `/api/users/minute-points/calendar/:yearMonth`  | path: `YYYY-MM`; query: `language` | Dense per-day list (one language) with `minutesEarned` and `penaltyMinutes` |
| POST | `/api/auth/on-login`                            | `{ tz }`                       | Post-login bookkeeping (currently: refresh `users.timezone`) |
| GET  | `/api/leaderboard`                              | —                              | `currentStreak` is `null` for non-public users |

## Streak break flow

1. User hits goal on 12/10 → `currentStreak = N`, `lastStreakDate = 2024-12-10`.
2. User skips 12/11 entirely.
3. At the next `HH:01` after the user's local 4 AM on 12/12, the hourly Postgres cron (`expire-stale-streaks.sql`) sweeps every user where `currentStreak > 0` and `today_local - lastStreakDate >= 2`.
4. For each match: stamps `penaltyMinutes = DAILY_PENALTY_MINUTES` on **2024-12-11** (the missed day) in `userminutepoints`, resets `currentStreak = 0`, deducts 10 from `totalMinutePoints`, and rolls `lastStreakDate` forward to `today_local` so the penalty is idempotent.
5. The cron reads `users.timezone` directly; the client keeps that column fresh via `/api/auth/on-login` and `/api/users/minute-points/increment`.

## Configuration

| Env var | Default | Layer |
|---|---|---|
| `STREAK_RETENTION_MINUTES` / `VITE_STREAK_RETENTION_MINUTES` | 3 | Both |
| `DAILY_PENALTY_MINUTES` / `VITE_DAILY_PENALTY_MINUTES` | 10 | Both |

The client and server read the same defaults. There is no longer a separate
`PENALTY_PERCENT` or `RETENTION_POINTS` config.
