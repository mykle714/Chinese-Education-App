# Work Points Accumulation System

## Overview

Work points measure active study time. **1 work point = 1 minute of active study.** The system tracks time client-side in localStorage, syncs earned points to the server, and supports daily resets, streaks, and penalties.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    useWorkPoints (hook)                       │
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ Activity      │───▶│ 1-second     │───▶│ localStorage  │  │
│  │ Detection     │    │ Timer        │    │ (every tick)  │  │
│  └──────────────┘    └──────┬───────┘    └───────────────┘  │
│                             │                                 │
│                      (every 60s)                              │
│                             │                                 │
│                      ┌──────▼───────┐                        │
│                      │ Server Sync  │                        │
│                      │ /increment   │                        │
│                      └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### Files

| File | Role |
|------|------|
| `src/hooks/useWorkPoints.ts` | Core hook — timer, state management, orchestration |
| `src/hooks/useActivityDetection.ts` | Detects user interaction (click, keydown, touch) |
| `src/utils/workPointsStorage.ts` | localStorage read/write, daily reset logic |
| `src/utils/workPointsSync.ts` | Server API calls (`/increment`, `/sync`) |
| `src/utils/dailyBoundarySync.ts` | Day-change detection, streak/penalty logic |
| `src/constants.ts` | Configuration values |

---

## How It Works

### 1. Eligible Pages

Time only accumulates on specific pages, defined in `src/constants.ts`:

```typescript
WORK_POINTS_ELIGIBLE_PAGES = ['/flashcards', '/flashcards/learn', '/reader']
```

### 2. Activity Detection

`useActivityDetection` listens for **click**, **keydown**, and **touchstart** events on the document. When any of these fire, the hook calls `recordActivity()`.

Mouse movement is **not** tracked — only deliberate interactions count.

### 3. Active/Inactive State

When `recordActivity()` fires:
- The user is marked **active**
- A 15-second inactivity timeout starts

If 15 seconds pass with no interaction, the user is marked **inactive** and the timer pauses. Any new interaction re-activates immediately.

### 4. The 1-Second Timer

This is the core of the system. A `setInterval` runs every 1 second, but **only when**:
- User is **active** (interacted within last 15 seconds)
- User is on an **eligible page**
- User is **logged in**

Each tick:
1. Adds 1000ms to `todaysWorkPointsMilli`
2. Checks if a new point was earned (crossed a 60-second boundary)
3. If a point was earned → triggers animation + server `/increment` call
4. **Saves to localStorage** (every tick, every second)

### 5. Persistence (localStorage)

Saved every second to `localStorage` under key `workPoints_{userId}`:

```json
{
  "todaysWorkPointsMilli": 185000,
  "totalWorkPoints": 42,
  "lastActivity": "2026-02-17T19:45:00.000Z",
  "currentStreak": 3,
  "longestStreak": 7,
  "lastStreakDate": "2026-02-16"
}
```

**Why every second?** localStorage writes are synchronous and ~200 bytes — negligible cost. This ensures at most 1 second of progress is lost if the user navigates away or closes the tab.

### 6. Server Sync

When a point is earned (every 60 seconds of accumulated time), the client calls:

```
POST /api/users/work-points/increment
Body: { date: "2026-02-17" }
```

The server increments the user's work points by 1 for that date. Server-side rate limiting prevents abuse.

### 7. Daily Reset

On load, the hook checks if `lastActivity` is from a different day than today. If so:

1. **Streak check** — Did the user earn ≥ 3 points yesterday?
   - **Yes:** Streak incremented (or started)
   - **No:** Daily penalty applied (−10 total points), streak broken
2. **Sync** — Yesterday's points are synced to the server via `/sync`
3. **Reset** — `todaysWorkPointsMilli` resets to 0 for the new day

The server's `totalWorkPoints` is fetched on load as the source of truth for accumulated points.

---

## Configuration

All in `src/constants.ts`:

| Config | Default | Description |
|--------|---------|-------------|
| `MILLISECONDS_PER_POINT` | 60000 | 60 seconds = 1 point |
| `ACTIVITY_TIMEOUT_MS` | 15000 | 15s before marked inactive |
| `ANIMATION_DURATION_MS` | 600 | Badge pulse animation length |
| `STREAK_CONFIG.RETENTION_POINTS` | 3 | Points/day needed to keep streak |
| `STREAK_CONFIG.DAILY_PENALTY_POINTS` | 10 | Points lost per missed day |

---

## State Exposed by the Hook

`useWorkPoints()` returns:

| Property | Type | Description |
|----------|------|-------------|
| `currentPoints` | number | Today's earned points (minutes) |
| `accumulativeWorkPoints` | number | Lifetime total work points |
| `totalStudyTimeMinutes` | number | Lifetime + today's partial minutes |
| `todaysWorkPointsMilli` | number | Raw milliseconds accumulated today |
| `liveSeconds` | number | Seconds counter (0-59), ticks in real-time |
| `progressToNextPoint` | number | 0-100% progress toward next point |
| `isActive` | boolean | Whether user is currently active |
| `isAnimating` | boolean | Whether point-earned animation is playing |
| `isEligiblePage` | boolean | Whether current page accumulates points |
| `currentStreak` | number | Consecutive days meeting goal |
| `longestStreak` | number | Personal best streak |
| `streakGoalProgress` | number | 0-1 progress toward daily streak goal |
| `hasMetStreakGoalToday` | boolean | Whether today's goal is met |
| `recordActivity` | function | Manually signal user activity |
| `resetPoints` | function | Clear all data (debug only) |

---

## Save Points Summary

The system saves to localStorage at these moments:

| Trigger | Frequency | Mechanism |
|---------|-----------|-----------|
| **Every timer tick** | Every 1 second while active | Direct `saveWorkPointsData()` in interval |
| **Going inactive** | On 15s inactivity timeout | Save in timeout callback |
| **Leaving eligible page** | On route change | `isEligiblePage` effect |
| **Browser close/refresh** | On `beforeunload` event | Event listener |

Since the timer saves every second, the other save points are safety nets that cover edge cases (tab close, route changes while timer isn't running, etc.).

---

## Data Flow Diagram

```
User clicks/types/touches
        │
        ▼
useActivityDetection fires onActivity
        │
        ▼
recordActivity() → sets isActive=true, resets 15s timeout
        │
        ▼
Timer interval fires (every 1s while active + eligible)
        │
        ├──▶ todaysWorkPointsMilli += 1000
        ├──▶ Save to localStorage
        │
        └──▶ If crossed 60s boundary:
                ├──▶ Trigger animation
                └──▶ POST /api/users/work-points/increment
```

---

## Streak System

- **Goal:** Earn ≥ 3 work points (3 minutes) per day
- **Reward:** Streak counter increments each consecutive day the goal is met
- **Penalty:** Miss a day → lose 10 total work points + streak resets to 0
- Penalty is applied on the next day's first page load (during daily reset check)
- `longestStreak` tracks the personal best and never decreases
