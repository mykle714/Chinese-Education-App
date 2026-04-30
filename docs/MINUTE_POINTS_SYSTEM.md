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
- `totalMinutePoints INTEGER` — lifetime accumulator.
- `lastMinutePointIncrement TIMESTAMP` — last successful tick (rate limit).
- `currentStreak INTEGER NOT NULL DEFAULT 0`.
- `lastStreakDate DATE` — last streak day the user satisfied (or the day a penalty was applied to mark a break as resolved).

`userminutepoints` (PK = `userId, streakDate`):
- `minutesEarned INTEGER` — sum across all of the user's devices.
- `penaltyMinutes INTEGER` — minutes deducted by a streak break stamped on the missed day.
- `lastSyncTimestamp`, `updatedAt` — bookkeeping timestamps.

There is **no** device fingerprint and **no** longest-streak field.

### Server

- `server/utils/streakDate.ts` — `streakDateOf(timestamp, tz)`, plus tz validation and date-arithmetic helpers.
- `UserMinutePointsService.incrementMinutePoints` — adds 1 minute, advances the streak when the user crosses `RETENTION_MINUTES` for the current streak day. Rate-limited to ~one call per 59 seconds.
- `UserMinutePointsService.newDayOperation` — idempotent break detector. If `today - lastStreakDate >= 2`, resets `currentStreak = 0`, deducts `DAILY_PENALTY_MINUTES` from `totalMinutePoints`, and stamps `penaltyMinutes` on `lastStreakDate + 1` (the first missed day).
- `UserMinutePointsService.getCalendar` — returns one row per day for the requested month, zero-filled.
- `LeaderboardService` — masks `currentStreak` to `null` for non-public users.

### Client

- `useMinutePoints` (hook) — local accumulating timer + reads server-authoritative streak/total.
- `useCalendarMinutePoints` (hook) — fetches the calendar endpoint, derives `isToday`/`hasData` in browser tz.
- `minutePointsSync.incrementMinutePoint` / `newDayOperation` — POSTs include `{ timestamp, tz }`. The tz is taken from `Intl.DateTimeFormat().resolvedOptions().timeZone` and never persisted.
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
| GET  | `/api/users/:id/total-minute-points`            | —                              | `{ totalMinutePoints, currentStreak }` |
| POST | `/api/users/minute-points/increment`            | `{ timestamp, tz }`            | Adds 1; may advance streak |
| POST | `/api/users/minute-points/new-day`              | `{ timestamp, tz }`            | Idempotent break detection |
| GET  | `/api/users/minute-points/calendar/:yearMonth`  | path: `YYYY-MM`                | Dense per-day list with `minutesEarned` and `penaltyMinutes` |
| GET  | `/api/leaderboard`                              | —                              | `currentStreak` is `null` for non-public users |

## Streak break flow

1. User hits goal on 12/10 → `currentStreak = N`, `lastStreakDate = 2024-12-10`.
2. User skips 12/11 entirely.
3. User opens app on 12/12 → client posts to `/new-day` with `{ now, tz }`.
4. Server computes `today = 2024-12-12`, gap = 2.
5. Server: stamps `penaltyMinutes = DAILY_PENALTY_MINUTES` on **2024-12-11** (the missed day), resets `currentStreak = 0`, deducts 10 from `totalMinutePoints`, sets `lastStreakDate = today` so the penalty is idempotent.

## Configuration

| Env var | Default | Layer |
|---|---|---|
| `STREAK_RETENTION_MINUTES` / `VITE_STREAK_RETENTION_MINUTES` | 3 | Both |
| `DAILY_PENALTY_MINUTES` / `VITE_DAILY_PENALTY_MINUTES` | 10 | Both |

The client and server read the same defaults. There is no longer a separate
`PENALTY_PERCENT` or `RETENTION_POINTS` config.
