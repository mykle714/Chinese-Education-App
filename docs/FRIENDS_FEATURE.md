# Friends Feature

The friend graph: sending, answering and revoking friend requests, and the list of
accepted friends. Reached from the **Friends** row on the hp (`/` Home hub).

Status: **implemented**, on dev. Migration **138** is not yet on prod (see
[§ Deploying](#deploying)).

---

## 1. Surfaces

Four pages today (a **fifth is planned** — § 1b), all `chrome: "node"` with
`footerTab: "home"`, so the footer stays visible and the Home tab stays lit. `/friends` is **read-only**; each of the three
mutations (send, answer, unfriend) has its own screen behind a top-row button.

| Route | Component | What it is |
|---|---|---|
| `/friends` | `src/features/friends/FriendsPage.tsx` | The friends **leaderboard** (§ 1a), read-only. Three buttons across the top — **Send** / **Accept** / **Remove** → the three action screens. Shows the viewer's own friend ID with a Copy button. |
| `/friends/sent` | `src/features/friends/SentRequestsPage.tsx` | Reached by **Send**. Pending **outgoing** requests, each with **Revoke**. Also holds the compose field — the only place a friendship is created. |
| `/friends/requests` | `src/features/friends/IncomingRequestsPage.tsx` | Reached by **Accept**. Pending **incoming** requests, each with **Accept** / **Decline**. |
| `/friends/remove` | `src/features/friends/RemoveFriendsPage.tsx` | Reached by **Remove**. The plain friend list ("Friends since …"), each row with **Remove** (unfriend). The board deliberately has no per-row Remove: a destructive control on a ranking row invites a mis-tap while reading scores. |

Back-arrow targets: `/friends` → `/` (Home); all three action pages → `/friends`.
Every action page navigates via `useSlideNavigate` so the drill-in animates.

**Every person row on all four screens opens that person's profile** — tapping the
avatar/name half of a `FriendPersonRow` navigates to `/users/:userId`
([USER_PROFILE_PAGE.md](./USER_PROFILE_PAGE.md)). The `actions` slot stays outside the
tappable area, so tapping Remove or Decline can never be read as a tap on the person.

`FriendPersonRow` supports **two tap models**, and a screen uses exactly one:

| Prop | Tap target | `actions` slot | Used by |
|---|---|---|---|
| `onPersonPress` | the avatar + name half | real buttons, outside the tap target | these four screens (→ the profile) and the leaderboard |
| `onRowPress` | the **whole row** | must be **presentational only** | the challenges page (docs/STUDY_CHALLENGE.md § 1) |

The handler is `onPersonPress`, not the older `onOpenProfile`, because the challenges
page binds the tap to the challenge action instead of a profile. Passing both is not an
error — `onRowPress` wins — but a row should only ever want one, and with `onRowPress`
a `<button>` inside `actions` would compete with the row for taps and tab stops.
The profile is where a friendship is now most naturally removed, where a request is
accepted or revoked, and — for friends — where the per-pair Study Challenge block is
set.

Shared pieces:
* `FriendPersonRow.tsx` — the avatar + name + secondary-line + actions row used by
  all four screens (they differ only in the `actions` slot; the leaderboard also
  uses the `leading` rank-chip slot and the `highlighted` self-row flag).
  It wears the shelf system's `.rw` **skin** — white ground, radius 16, a 36px
  rounded-square avatar carrying `COLORS.markOutline`, 14.5/11.5 type
  ([SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A5) — but is deliberately **not** the
  shared `Row` primitive (`src/components/primitives/Row.tsx`): a `Row` has one tap
  target and this has two nesting models. If the two ever converge, delete this one.
* `friendStyles.ts` — shared `sx` fragments. They live outside the page components
  because this repo lints `react-refresh/only-export-components`.
* `friendLabels.ts` — "Sent …" copy, the leaderboard's `netMinutesLabel` /
  `velocityUnitLabel`, and `friendErrorMessage`.

**Adding a friend is BY USER ID.** `users` has no username column, so the handle is
the account's UUID: `/friends` renders yours with a Copy button (and `userSelect:
"text"`, an explicit exception to the app-wide `user-select: none`), and the other
person pastes it into `/friends/sent`. If a username is ever added, that field
becomes the lookup and this section is what changes.

The **Requests** button carries a red count badge when incoming requests exist —
`FriendsPage` fetches the incoming list alongside the friend list purely for that
count.

### 1b. Challenges (`/friends/challenges`) — BUILT (page 2026-08-17, playable rounds 2026-08-22)

Specified by [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 1, and shipped with that
feature. (This section said "not built" until 2026-08-22; the page had in fact been
live since 2026-08-17 and only the scored rounds were missing.)

A fifth NodePage, reached by a fourth top-row button on `/friends`, listing the viewer's
Study Challenges: awaiting your response, accepted and waiting for Friday, open now, and
recently finished.

⚠️ **One control on this page is not part of the friend model at all:** the
validator-only **"Allow anytime"** switch, which lifts Study Challenge's calendar gates
for testing ([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 2a). It is rendered here
because this is where the weekly rules are felt, but it is gated on `users.isValidator`
and is invisible to everybody else.

**Why it hangs off `/friends` rather than sitting on the Home menu:** a challenge is a
thing you have *with a person*. Every entry point to it is a friend, unfriending ends it,
and the per-pair block that suppresses it lives on `friendships`. Home is a menu of
places; this is a property of a relationship.

#### The badge chain, and the one place language scoping is deliberately violated

A pending challenge is announced **only** by an in-app badge chain the user walks into —
no push, no email ([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 1, Q48):

```
hp Friends row  →  Challenges button  →  the individual friend's row
```

This reuses the existing pattern exactly: the count rides along with the friends payload
`FriendsPage` already fetches, the way the incoming-requests count does today.

⚠️ **The badge must NOT be language-scoped, even though the page is.** Everything else
about vocabulary is scoped to the learner's active language, and the Challenges *page*
follows that rule — a zh challenge is invisible while the user is studying Spanish. The
**badge is the deliberate exception**: it counts challenges in *every* language.

The reason is load-bearing rather than cosmetic. A challenge issued in a language the user
is not currently studying would otherwise be completely invisible until it silently
expired — and a badge that hid it would be hiding the only thread back to it. So the
friends payload must carry the count **even when the user's active language is not the
challenge's**. Anyone "fixing" this inconsistency later re-breaks the case it exists for.

### 1a. The leaderboard (`/friends`)

`/friends` is a **leaderboard ranked by velocity** — utcm band-steps climbed in the
last 7 days ([VELOCITY.md](./VELOCITY.md)) — not a plain list. One row per person:

```
[2] (avatar)  Bob                            12
              20h 40m · 🇪🇸 ES            velocity
```

* **Ranked metric — velocity**: the number and its "velocity" label are one
  centred stack (`VelocityStat`), not two edge-aligned lines — the number's width
  swings from 1 to 3 digits, which a shared edge makes look ragged. The row states
  no window; `windowDays` still ships on the response for any client that wants to
  label it, but this page no longer reads it.
* **Subtitle — the balance as a DURATION** ("3w 2d 4h 10m"): a minute point is a
  minute of study, and a duration sizes up at a glance where "32,650 minutes" does
  not — which is the whole job of a column being compared down a list. Formatted by
  the shared `src/utils/formatDuration.ts` (`weeks: true`; the Night Market badge
  uses the same function without weeks). The figure is
  `user_languages.totalMinutePoints`, the penalty-debited NET wallet
  ([STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md)), **not** the monotonic
  `lifetimeMinutesEarned` — the two diverge for any learner who has ever been
  penalised.
* **Each person is scored in THEIR OWN selected language**, not the viewer's, and
  both numbers on a row share that language. Scoring everyone in the viewer's
  language would render a Spanish-only friend as a permanent 0 on a Chinese
  viewer's board — "does nothing" rather than "studies something else". The row
  therefore carries a **flag + region-code badge** ("🇪🇸 ES") rather than the
  language's name — the row is a compact scoreboard line and the code identifies the
  track in a third of the width. Both halves come from one source: `LANGUAGE_FLAGS`
  holds the flag and `languageRegionCode()` DECODES it (a flag emoji is two Regional
  Indicator Symbols, which map one-to-one onto A–Z), so the letters can never
  disagree with the flag. It also degrades well: **Windows renders no flag glyph**
  and shows the letters instead, so the badge reads "ES ES" at worst, never as
  nothing.
* Velocity counts only the bars **that person** pursues (`activeBars` on their own
  `readingGoal`/`writingGoal`), matching what their own Account page shows.
* **The viewer is in the board**, marked `isCurrentUser`: name suffixed "(you)" and the
  row filled with the **org pastel**, its border kept at 1px transparent so heights stay
  equal. This was a 2px blue ring until the shelf redesign's entry 8; it changed because
  `BoardRow.highlighted` (the arena board) already used the org fill for the same idea,
  and the app was answering "which row is me" two different ways on its two leaderboards.
* Ranks 1–3 get podium-tinted chips (org / blu / red from `RAMP`), everyone else grey.
  Every chip carries the `markOutline` inset ring — mandatory at 28px, and load-bearing
  for rank 1, whose org chip would otherwise dissolve into a rank-1 viewer's org row.
* The three top **tiles** are coloured by their action's valence — Send neutral blue,
  Accept green, Remove red — the same green/red pairing the request rows use for
  Accept/Decline. They are `BentoTile`s (`variant="compact"`, `columns={3}`) since entry
  8; the pending counts are tile `pin`s with `pinTone="alert"`, which replaced the
  friends-only `navButtonSx` / `cornerBadgeSx` fragments (both deleted).
* **Ranking is the server's**: the client never re-sorts, and the board has no
  mutations of its own — unfriending happens on `/friends/remove`, so the ranks on
  screen are always exactly the ranks the server assigned.
* A friendless viewer still gets a **board**, not an empty state: the server always
  includes the viewer's own row, so the leaderboard renders with that single row and
  the "No friends yet" hint sits *beneath* it (pointing at **Send**) rather than
  replacing it. The one-row board is exactly what the screen looks like the moment a
  first friend is added, so nothing about the layout changes underneath the user.

### Optimistic vs. confirmed updates

Deliberately mixed, per the cost of being wrong:
* **Unfriend** (`/friends/remove`) is optimistic (row disappears at once, restored
  on failure) — the action is symmetric and trivially redone. It also carries a
  `busyId` guard, because a double-tap's second call 404s ("you are not friends
  with this user") and would surface an error for something that in fact succeeded.
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

### Planned: two challenge-block booleans

Study Challenge adds two columns to this table (signed off 2026-08-16, ships with the
challenge migration):

```
"requesterChallengesBlocked"  boolean NOT NULL DEFAULT false
"addresseeChallengesBlocked"  boolean NOT NULL DEFAULT false
```

They belong here rather than on `users` because the preference is **about a pair**, which
is exactly what this table represents. Note this does *not* contradict decision 3 above:
it adds no `blocked` value to `status`, so the pending/accepted state machine is untouched
and a block is orthogonal to whether the two are friends. See § 8 for the semantics.

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
| GET | `/api/friends` | `FriendSummary[]` — accepted friends, newest first. Read by `/friends/remove`. |
| GET | `/api/friends/leaderboard` | `FriendLeaderboardResponse` — `{entries, windowDays}`, viewer included, ranked |
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
* **Unfriending is transactional.** `removeFriend` ends the pair's in-flight study
  challenges and deletes the edge inside one transaction, challenges first, so a
  failure leaves the pair still friends and the action retryable rather than
  unfriended with orphaned challenge state (docs/STUDY_CHALLENGE.md § 6, Q41). The
  transaction runner is **injected** (`TransactionRunner` in
  `server/services/FriendsService.ts`), not the `dbManager` singleton — see
  docs/BACKEND_LAYERING.md § 3.
* Errors map through `handleControllerError`: `ValidationError` → 400,
  `NotFoundError` → 404, `DuplicateError` → 409.

---

## 4. Privacy

A friend request exposes the target's `name`, `email` and `avatarIconId` to the
sender once sent — the same fields the leaderboard already shows to every logged-in
user (`server/services/LeaderboardService.ts`), so this adds no new
disclosure. Note that knowing a user ID is currently enough to confirm an account
exists (404 vs 201): acceptable while the ID is a random UUID a user chooses to
share, and worth revisiting if IDs ever become guessable or public.

`users.isPublic` is **not** consulted. It gates the leaderboard streak only; a
non-public user can still send and receive friend requests.

---

## 5. Tests

`server/__tests__/friends.test.ts` — 21 tests over `FriendsService` with
hand-stubbed DALs (no DB). Covers each authorization rule, the auto-accept path, and
the five leaderboard scoping rules (own-language scoring, goal-bar filtering, the
self row, the total tie-break order, and the never-studied friend); these are the
cases that fail *silently* rather than loudly if the policy regresses.

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
`server/dal/interfaces/IUserDAL.ts` (`findScoringProfilesByIds`) + `UserDAL.ts`,
`server/dal/interfaces/ICategoryPromotionDAL.ts` (`getVelocityBuckets`) + `CategoryPromotionDAL.ts`,
`server/dal/interfaces/IUserLanguagesDAL.ts` (`getNetPointsForUsers`) + `UserLanguagesDAL.ts`,
`server/contracts/wire.ts` (`LANGUAGE_FLAGS`),
`server/dal/implementations/FriendshipDAL.ts`,
`server/services/FriendsService.ts`,
`server/controllers/FriendsController.ts`,
`server/routes/friendRoutes.ts`,
`server/dal/setup.ts` (friend wiring),
`server/server.ts` (`app.use(friendRoutes)`),
`src/api/friends.ts`,
`src/features/friends/*`,
`src/utils/formatDuration.ts` (shared with the Night Market badge),
`src/routes/routeMeta.ts` (the four friends entries),
`src/routes/registry.ts` (four `PAGE_COMPONENTS` entries),
`src/pages/HomePage.tsx` (the `friends` hub row).

Planned additions (with Study Challenge): a fifth `src/features/friends/*` page and its
`routeMeta`/`registry` entries (§ 1b), the two `friendships` block columns (§ 2), and a
challenge count on the friends payload that `FriendsService` must assemble **without**
language scoping (§ 1b).

Related docs: [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) (the Challenges page, the badge,
and the block columns — all planned),
[VELOCITY.md](./VELOCITY.md) (the ranked metric),
[PER_LANGUAGE_STREAKS.md](./PER_LANGUAGE_STREAKS.md) (the net wallet),
[BENTO_SYSTEM.md](./BENTO_SYSTEM.md) (the hp row),
[LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) (the NodePage archetype),
[BACKEND_LAYERING.md](./BACKEND_LAYERING.md), [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md).

## 8. Not built

Deliberately out of scope for this pass — no friend-only content
beyond the leaderboard's two numbers (no friend's decks, night market or streak), no notification when
a request arrives (the badge on `/friends` is the only signal), and no
friend-count limit.

**Blocking is arriving in a narrow form**, with Study Challenge: two booleans on
`friendships` — `"requesterChallengesBlocked"` / `"addresseeChallengesBlocked"`, both
`NOT NULL DEFAULT false`. Each player owns their own flag and the **effect is symmetric**:
a challenge goes through only if neither has blocked, so the read is
`NOT (requesterBlocked OR addresseeBlocked)`. It blocks *challenges* between the pair, in
both directions, and nothing else — it is not a general block, does not hide the
leaderboard row, and does not unfriend. Setting it mid-challenge affects only new ones;
the in-flight challenge plays out ([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 1,
Q46/Q57).
