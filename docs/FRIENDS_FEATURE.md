# Friends Feature

The friend graph: sending, answering and revoking friend requests, and the list of
accepted friends. Reached from the **Friends** row on the hp (`/` Home hub).

Status: **implemented**, on dev. Migration **138** is not yet on prod (see
[§ Deploying](#deploying)).

---

## 1. Surfaces

Three pages, all `chrome: "node"` with `footerTab: "home"`
(`src/routes/routeMeta.ts:114-119`), so the footer stays visible and the Home tab
stays lit.

| Route | Component | What it is |
|---|---|---|
| `/friends` | `src/features/friends/FriendsPage.tsx` | The friend list. Two buttons across the top → the two request screens. Shows the viewer's own friend ID with a Copy button. Each row has **Remove** (unfriend). |
| `/friends/sent` | `src/features/friends/SentRequestsPage.tsx` | Pending **outgoing** requests, each with **Revoke**. Also holds the compose field — the only place a friendship is created. |
| `/friends/requests` | `src/features/friends/IncomingRequestsPage.tsx` | Pending **incoming** requests, each with **Accept** / **Decline**. |

Back-arrow targets: `/friends` → `/` (Home); the two request pages → `/friends`.
Both request pages navigate via `useSlideNavigate` so the drill-in animates.

Shared pieces:
* `FriendPersonRow.tsx` — the avatar + name + secondary-line + actions row used by
  all three screens (the only difference between them is the `actions` slot).
* `friendStyles.ts` — shared `sx` fragments. They live outside the page components
  because this repo lints `react-refresh/only-export-components`.
* `friendLabels.ts` — "Friends since …" / "Sent …" copy and `friendErrorMessage`.

**Adding a friend is BY USER ID.** `users` has no username column, so the handle is
the account's UUID: `/friends` renders yours with a Copy button (and `userSelect:
"text"`, an explicit exception to the app-wide `user-select: none`), and the other
person pastes it into `/friends/sent`. If a username is ever added, that field
becomes the lookup and this section is what changes.

The **Requests** button carries a red count badge when incoming requests exist —
`FriendsPage` fetches the incoming list alongside the friend list purely for that
count.

### Optimistic vs. confirmed updates

Deliberately mixed, per the cost of being wrong:
* **Unfriend** is optimistic (row disappears at once, restored on failure) — the
  action is symmetric and trivially redone.
* **Accept / Decline / Revoke** wait for the server. A failed accept that had
  already vanished from the list would leave the user believing they have a friend
  they do not. A `busyId` guard blocks the double-tap in the meantime.

---

## 2. Data model — `friendships` (migration 138)

`database/migrations/138-create-friendships.sql`

```
id           uuid PK
"requesterId" uuid → users(id) ON DELETE CASCADE
"addresseeId" uuid → users(id) ON DELETE CASCADE
status       varchar(16)  CHECK (status IN ('pending','accepted'))
"createdAt"   timestamptz
"respondedAt" timestamptz   -- stamped on accept; doubles as "friends since"
CHECK ("requesterId" <> "addresseeId")
UNIQUE (LEAST(requester,addressee), GREATEST(requester,addressee))  -- friendships_pair_uniq
```

Three decisions worth knowing:

1. **One table, not two.** A friendship *is* an accepted request — the same row is
   flipped from `pending` to `accepted`. A separate `friend_requests` table would
   mean copying rows on accept and keeping two answers to "are these two friends".
2. **Direction is stored, but only means something while pending.** Only the
   addressee may accept; only the requester may revoke. Once accepted the edge is
   symmetric, and every read matches `"requesterId" = $1 OR "addresseeId" = $1`,
   selecting the other column as "the friend" with a `CASE`.
3. **No `declined` state.** Declining DELETEs the row, so the requester is never
   told they were declined and the pair may try again. Adding `declined` or
   `blocked` later is a CHECK change plus a new migration, not a reshape.

The pair-unique index is direction-blind, which is what makes the "one row per
pair" rule enforceable rather than merely intended.

---

## 3. Layers

| Layer | File | Responsibility |
|---|---|---|
| Route | `server/routes/friendRoutes.ts` | Registration only. ⚠️ Every `/api/friends/requests*` route is declared **above** `/api/friends/:friendUserId`, which would otherwise swallow them. |
| Controller | `server/controllers/FriendsController.ts` | `requireUserId` → service → `handleControllerError`. No policy. |
| Service | `server/services/FriendsService.ts` | All policy: ID validation, existence check, who may accept/revoke, crossing-request auto-accept. |
| DAL interface | `server/dal/interfaces/IFriendshipDAL.ts` | Viewer-relative reads; optional `PoolClient` on every method. |
| DAL impl | `server/dal/implementations/FriendshipDAL.ts` | SQL; translates SQLSTATE 23505 on the pair index into `DuplicateError`. |
| Wiring | `server/dal/setup.ts` | `friendshipDAL` → `friendsService` → `friendsController`, all exported. |
| Mount | `server/server.ts` | `app.use(friendRoutes)` |
| Client API | `src/api/friends.ts` | Typed calls via `src/api/http.ts`; takes no `token` (FRONTEND_LAYERING §3.2). |

### Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/friends` | `FriendSummary[]` — accepted friends, newest first |
| DELETE | `/api/friends/:friendUserId` | 204 — unfriend (either side) |
| GET | `/api/friends/requests/incoming` | `FriendRequestSummary[]` |
| GET | `/api/friends/requests/outgoing` | `FriendRequestSummary[]` |
| POST | `/api/friends/requests` `{userId}` | 201 `SendFriendRequestResponse` |
| POST | `/api/friends/requests/:id/accept` | `FriendSummary` (the new friend) |
| DELETE | `/api/friends/requests/:id` | 204 — decline (addressee) or revoke (requester) |

All require `authenticateToken`. Wire types: `server/types/friends.ts`, mirrored in
`src/api/friends.ts`.

### Policy rules (FriendsService)

* **Crossing requests auto-accept.** If B already has a pending request to A and A
  "sends" one to B, the result is a friendship, not an error — the pair index
  forbids a second row and a 409 would strand the user with no way forward. The
  response says `status: 'auto-accepted'` and the UI reports "You are now friends
  with …".
* **Ownership is checked against the stored row**, never the caller's claim.
  Guessing another user's request id yields 404, not someone else's friendship.
* **An accepted row is not a request.** `deleteRequest` refuses it, so "decline"
  can never act as a hidden unfriend; `removeFriend` conversely refuses a pending
  row.
* Errors map through `handleControllerError`: `ValidationError` → 400,
  `NotFoundError` → 404, `DuplicateError` → 409.

---

## 4. Privacy

A friend request exposes the target's `name`, `email` and `avatarIconId` to the
sender once sent — the same fields the leaderboard already shows to every logged-in
user (`server/services/LeaderboardService.ts:82-105`), so this adds no new
disclosure. Note that knowing a user ID is currently enough to confirm an account
exists (404 vs 201): acceptable while the ID is a random UUID a user chooses to
share, and worth revisiting if IDs ever become guessable or public.

`users.isPublic` is **not** consulted. It gates the leaderboard streak only; a
non-public user can still send and receive friend requests.

---

## 5. Tests

`server/__tests__/friends.test.ts` — 18 tests over `FriendsService` with
hand-stubbed DALs (no DB). Covers each authorization rule and the auto-accept path;
these are the cases that fail *silently* rather than loudly if the policy regresses.

Run: `npm run test:server`.

---

## 6. Deploying

Ordinary `/deploy` — one additive migration (`138`), no backfill, no ordering
constraint, no cron change. `migrate.sh` picks it up. No runbook needed.

Verify on prod after deploy:

```sql
SELECT to_regclass('friendships');            -- expect: friendships
SELECT indexname FROM pg_indexes WHERE tablename = 'friendships';
-- expect friendships_pkey, friendships_pair_uniq,
--        friendships_requester_idx, friendships_addressee_idx
```

---

## 7. Code ↔ doc dependencies

This document describes:
`database/migrations/138-create-friendships.sql`,
`server/types/friends.ts`,
`server/dal/interfaces/IFriendshipDAL.ts`,
`server/dal/implementations/FriendshipDAL.ts`,
`server/services/FriendsService.ts`,
`server/controllers/FriendsController.ts`,
`server/routes/friendRoutes.ts`,
`server/dal/setup.ts` (friend wiring),
`server/server.ts` (`app.use(friendRoutes)`),
`src/api/friends.ts`,
`src/features/friends/*`,
`src/routes/routeMeta.ts:114-119`,
`src/routes/registry.ts` (three `PAGE_COMPONENTS` entries),
`src/pages/HomePage.tsx` (the `friends` hub row).

Related docs: [HUB_MENU_SYSTEM.md](./HUB_MENU_SYSTEM.md) (the hp row),
[LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) (the NodePage archetype),
[BACKEND_LAYERING.md](./BACKEND_LAYERING.md), [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md).

## 8. Not built

Deliberately out of scope for this pass — no blocking, no friend-only content
(comparing streaks, seeing a friend's decks or night market), no notification when
a request arrives (the badge on `/friends` is the only signal), and no
friend-count limit.
