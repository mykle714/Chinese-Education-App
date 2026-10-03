# User Usage Dashboard

An **admin-only** section at the bottom of the tester dashboard (`/tester-dashboard`)
that shows app-wide usage across **all** accounts: active learners, minutes studied,
sessions, signups, per-feature usage, and a **by-name list of the individual learners**
who used the app, over a switchable window.

Parent: [NAVIGATION.md § Tester Dashboard](./NAVIGATION.md#tester-dashboard).

## 1. The gate — `users."isAdmin"` (migration 168)

| Grant | Migration | Means |
|---|---|---|
| `isValidator` | 104 | curate dictionary data; reaches the tester dashboard |
| `isTemplateAuthor` | 115 | author Night Market / Immersive World content |
| **`isAdmin`** | **168** | see cross-user operator views (this dashboard) |

`isAdmin` is its own flag because neither older grant should imply "may see other
people's usage". Migration 168 grants it to exactly one account **by email**
(`michaelren1928@gmail.com`), so it is a no-op on dev boxes where that account does
not exist. The same statement also sets `isValidator` on that account, for the
validator-only tools (Reader Validate, lazy enrichment, the Study Challenge anytime
hatch) — not for page access, which `isAdmin` already gives. Grant / revoke later with a direct `UPDATE users SET "isAdmin" = …` — no
code change.

The gate has two halves, and unlike the rest of the tester dashboard the server half
is a **real security boundary** (every figure is about other accounts):

- **Server:** `server/services/UsageDashboardService.ts` → `getDashboard` loads the
  caller via `UserDAL.findById` and throws `ForbiddenError` (403, `ERR_FORBIDDEN`,
  `server/types/dal.ts`) unless `isAdmin`. The JWT carries only `{ userId, email }`,
  so the role is read from the row, never from `req.user`.
- **Client (UX):** `src/pages/TesterDashboardPage.tsx` renders `UsageDashboardSection`
  only when `user.isAdmin`, and `useUsageDashboard` never fires the request for a
  non-admin. An admin who is not a validator can still reach the page (the Home tile
  and the page's bounce both accept `isValidator || isAdmin`).

Code: `database/migrations/168-add-users-is-admin.sql`,
`server/dal/implementations/UserDAL.ts` → `findById` (selects `"isAdmin"`),
`server/contracts/wire.ts` → `UserProfile.isAdmin`.

## 2. Layers

| Layer | File | Role |
|---|---|---|
| Contract | `server/contracts/usage.ts` | `UsageDashboard` + `USAGE_WINDOWS` / `DEFAULT_USAGE_WINDOW`; imported by both halves |
| Route | `server/routes/adminRoutes.ts` | `GET /api/admin/usage?days=7\|30\|90\|0`; mounted in `server/server.ts` |
| Controller | `server/controllers/UsageDashboardController.ts` → `getUsage` | parses `?days=` (default 30) |
| Service | `server/services/UsageDashboardService.ts` → `getDashboard`, `parseWindow` | isAdmin gate, window → dates, seven parallel reads, sums additive totals, feature labels |
| DAL | `server/dal/implementations/UsageStatsDAL.ts` (`IUsageStatsDAL`) | cross-user aggregate SQL; **no gate of its own** |
| DI | `server/dal/setup.ts` | `usageStatsDAL` → `usageDashboardService` → `usageDashboardController` |
| Client API | `src/api/usage.ts` → `fetchUsageDashboard` | via `src/api/http.ts` (no token arg) |
| Hook | `src/features/usageDashboard/useUsageDashboard.ts` | keyed on `user.id` + `isAdmin` + window, never `token` |
| UI | `src/features/usageDashboard/UsageDashboardSection.tsx`, `UsageDailyChart.tsx`, `UsageRecentUsers.tsx` | the section + inline-SVG day chart + the per-learner list |

`/api/admin/*` is the namespace for any future cross-user operator read; every handler
there must gate on `isAdmin` inside its service.

## 3. Windows

`USAGE_WINDOWS = [7, 30, 90, 0]`, where `0` = **all time** (from the first account's
`createdAt`). Any other `days` value is a 400. The window is inclusive and ends
**today in UTC** (the database runs in UTC). The headline DAU / WAU / MAU are
**always** today-anchored 1 / 7 / 30-day counts, independent of the window switch.

## 4. Metrics and their sources

| Metric | Source | Definition |
|---|---|---|
| Studied / active users, minutes | `userminutepoints` | `minutesEarned > 0`, bucketed by `"streakDate"` (the learner's 04:00-local day) |
| App opens (distinct users) | `refresh_tokens` | any token minted that UTC day — tokens rotate every ~15 min of use, so this ≈ "had a live session" |
| Sign-ins | `refresh_tokens` | a row that no other row's `"replacedByHash"` points at (the head of a rotation chain) |
| New accounts | `users."createdAt"` | |
| Cards added | `vocabentries_zh` ∪ `vocabentries_es` | `vetSortedClause()` (`'library'`) rows by `createdAt`; lent provisional cards excluded |
| Game wins (+ per game) | `wins` | by `"wonAt"` |
| Writing practice | `writing_practice_completions` | by `"completedAt"` |
| Immersive World runs | `iw_scene_runs` | by `"startedAt"` (started, not necessarily completed) |
| AI dictionary lookups | `dictionary_ai_usage` | `SUM(count)` by `"usageDate"` |
| Recent learners | `users` ⋈ `refresh_tokens` ⋈ `userminutepoints` | one row per learner with a session **or** > 0 minutes in the window — see § 4a |

Every feature row carries `events` and distinct `users`. Window distinct-user counts
(`totals.activeUsers`, `totals.appOpenUsers`) come from their own query because users
repeat across days; the additive totals are summed from the zero-filled day series.

**Known skew:** minutes use the learner's local streak day and everything else uses
the UTC day, so a day's figures can disagree by a few hours at the edges. Acceptable for
an operator overview; do not use these numbers for streak logic.

`refresh_tokens` is never purged (`RefreshTokenDAL` only revokes), so session history
goes back to the table's creation. Scripted / agent logins on test accounts count as
sign-ins too.

## 4a. Recent learners (per-user rows)

The only part of the payload that is **not an aggregate**: `UsageDashboard.recentUsers`
is one `UsageUserRow` per learner, carrying their `name`. It is the most identifying
read on the dashboard, which is why the server-side `isAdmin` gate (§ 1) is the real
boundary. `email` is deliberately **not** returned — it is private to the account
(`UserDAL.findById`) and a name is enough to recognise a tester.

- **Who is listed:** anyone with a `refresh_tokens` row or > 0 `minutesEarned` inside
  the selected window — the same two signals as `totals.appOpenUsers` and
  `totals.activeUsers`, so the list is exactly the people behind those two counts.
- **Order:** `lastSeenAt` descending (latest token mint in the window), then minutes.
- **Cap:** `USAGE_RECENT_USERS_LIMIT` (100). Being ordered by recency, the cap drops
  the least recent learners; the card's counter reads "latest 100" when it bites.
- **Per row:** `lastSeenAt`, `minutes`, `daysStudied` (streak days with > 0 minutes),
  `daysOpened` (UTC days with a session), `languages` studied, plus:
  - `signIns` — fresh sign-ins (rotation-chain heads), the per-learner split of
    `totals.signIns`.
  - `cardsSorted` — vet rows in **any sorted bucket** (`'library'` or `'skip'`) by
    `createdAt`. Wider than the Feature usage "Cards added" row, which is `'library'`
    only. A lent card promoted in place keeps its lend-time `createdAt`, so it counts
    on the day it was lent, not the day it was sorted (there is no sort timestamp).
  - `velocity` — `SUM("bandsClimbed")` from `category_promotions` on the learner's goal
    bars (core, plus reading / writing while that goal is on), the same read-time
    filter as [VELOCITY.md § 2a](./VELOCITY.md). ⚠️ Measured over the **selected
    window** (UTC days), not the learner-facing card's sliding 7 days — on 30D / 90D /
    ALL it is a larger number than the learner sees.
  - `iwRuns` — Immersive World runs **started** (`iw_scene_runs."startedAt"`). A true
    play count: the row is written when a run begins.
  - `gameWins` — `[{ game, wins }]` from `wins`, most-won first. ⚠️ **Wins, not
    plays.** No table records a game round being started or lost: `wins` is written
    only on a win (`src/hooks/useGameWins.ts` → `recordWin`), Match Speed writes one
    only for a gold run, and Hydra Bubbles and Memory Map write nothing. A per-game
    play count needs a play log that does not exist yet.
- `lastSeenAt` is `null` for a learner with minutes but no token row in the window
  (only possible at the UTC / streak-day edge); the UI shows "no session".
- "Last seen" is rendered relative to the payload's `generatedAt`, not the device clock.

Code: `server/contracts/usage.ts` → `UsageUserRow`, `USAGE_RECENT_USERS_LIMIT`;
`server/dal/implementations/UsageStatsDAL.ts` → `getRecentUsers`;
`server/dal/shared/vetTable.ts` → `vetProvisionalClause`;
`server/services/UsageDashboardService.ts` → `getDashboard`;
`src/features/usageDashboard/UsageRecentUsers.tsx`,
`src/features/usageDashboard/usageFormat.ts` → `gameLabel`.

## 5. UI

A `SectionRule` ("User usage") ending in a `Segmented` window switch (7D / 30D / 90D /
ALL), then six `SectionCard`s:

1. **Headline** — Accounts · Today · 7 days · 30 days.
2. **Daily** — `UsageDailyChart`, one metric at a time via a lens `Segmented`
   (Min = blu, Studied = grn, Opens = pur, Signups = org). One bar per day, a readout
   line naming the scrubbed (or latest) day, and a `peak` label instead of a y-axis.
   `touchAction: "pan-y"` so the page still scrolls over the chart.
3. **In this window** — minutes, studied, opened the app, sign-ins, new accounts.
4. **Recent learners** — `UsageRecentUsers`: name + relative "last seen", a muted detail line
   (days studied / opened, languages), then a four-cell figure strip: sign-ins · min
   studied · cards sorted · velocity, and a play line (Immersive World runs + wins per
   game). Game keys are humanised by `usageFormat.ts` → `gameLabel` (also used by the
   Feature usage card).
5. **By language** — minutes per language with a meter against the top language.
6. **Feature usage** — the five features, with game wins broken out per game.

Switching windows keeps the previous data on screen dimmed while the next loads.
