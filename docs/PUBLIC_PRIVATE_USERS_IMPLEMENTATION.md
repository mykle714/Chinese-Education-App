# Public/Private Users — REMOVED

> **Tombstone.** `users."isPublic"` was removed as a concept on 2026-11-13/14 and the column
> dropped by migration 189 ([LOGIN_REWORK.md](./LOGIN_REWORK.md) Q7). Every account is public.

What it used to do, for anyone reading old code or migrations 07 / 12:
- Server: hid a non-public user's `currentStreak` on the leaderboard (`LeaderboardService`).
  That was its only live effect.
- Client: a second, contradictory reading as a "demo account" — `ProtectedRoute`
  `requireFullAccount`, the `'account'` route access level, and games' `requiresAuth`. No
  route or game used it, and it treated a *visible* account as a *restricted* one.

There was never a UI or API to change the flag.

Other users now see an account's `username` (migration 188), never its email or phone.
