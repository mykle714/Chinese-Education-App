# Friends Feature

The friend graph: sending, answering and revoking friend requests, and the list of
accepted friends. Its home is the **AccountSheet's Friends tab** (`src/pages/AccountSheet.tsx`), raised from the Deck Tower header's avatar (`src/features/deckTower/DeckTowerAvatar.tsx`). That is the **only** entry: there is no Menu popover row for Friends, and no `/friends` page: it was deleted 2026-11-06 (it showed the same `FriendsBody`).

Status: **implemented** and on PPE. Migration **138** is applied (see
[§ Deploying](#deploying)).

---

## 1. Surfaces

One sheet tab (and the Challenges page, § 1b). The tab (`FriendsBody`) shows the
**leaderboard** (§ 1a); three **action tiles** across its top (a toggle group) swap the area below
them for one of three action bodies, in place, with no navigation. There are no
`/friends/sent`, `/friends/requests` or `/friends/remove` routes since 2026-11-13; they
were NodePages before that.

| View | Component | What it is |
|---|---|---|
| *(none selected)* | `src/features/friends/FriendsBody.tsx` | The friends **leaderboard** (§ 1a), read-only. Shows the viewer's own **friend code** (§ "Friend codes") under a centred **"Your friend code"** header, with a bare copy icon hung off its right edge (no pill; the code alone is centred), above the board. A friend's row **expands in place** (§ "Expand in place"). |
| **Send** selected | `src/features/friends/SentRequestsBody.tsx` | Pending **outgoing** requests (name only, no "Sent …" date), each with a blue **Withdraw** pill — `bluM` fill, no icon (`friendStyles.ts` → `withdrawButtonSx`; the server calls this a *revoke*). Above the list, the compose card — an **"Add a friend"** header (`SIZE.subtitle`, bold) over the "Paste friend code here" field — the only place a friendship is created. |
| **Accept** selected | `src/features/friends/IncomingRequestsBody.tsx` | Pending **incoming** requests (name only, no "Received …" timestamp), each with **Accept** / **Decline** pills — `grnM` / `redM` fill, ink text, the button outline, no icon (`friendStyles.ts` → `acceptButtonSx` / `declineButtonSx`, built from the same `filledRowButtonSx` as Remove). |
| **Remove** selected | `src/features/friends/RemoveFriendsBody.tsx` | The plain friend list (name only, no secondary line), each row with a red **Remove** box — `redM` fill, ink text, the button outline, no icon (`friendStyles.ts` → `removeButtonSx`). The board deliberately has no per-row Remove: a destructive control on a ranking row invites a mis-tap while reading scores. |

### The action tiles

`src/features/friends/FriendActionTiles.tsx`, rendered as cells of `FriendsBody`'s 3-column
`Bento`. Code: `FriendActionTiles`, `FriendsBody` → `toggleView`, `friendsView.ts` →
`FriendsView` / `FRIENDS_VIEW_ORDER`.

* **Face** = the `BentoTile` `compact` tiles they always were: Send `blu`, Accept `grn`,
  Remove `red` (ramp MID), ghost glyph, one-word title, resting `SHADOW.rest`, and
  Accept's alert `pin` with the incoming count. `BentoTile` takes `pressed`
  (→ `aria-pressed`) and `sx` for this.
* **Selected** = a 2px `COLORS.onSurface` **outline** inset 2px (`outlineOffset: -2px`), the
  "stronger ink ring" CLAUDE.md § "Buttons & cards" names for selected tiles. An outline,
  not an inset box-shadow, because it paints above the tile's content, so the ghost glyph
  cannot cover it; inset, so selecting never changes the tile's box. The fill never
  changes, so each tile keeps its valence colour in both states.
* **Contract**: at most one tile selected. Tapping the selected tile deselects it (back to
  the leaderboard); tapping another moves the selection across.
* **Slide**: the four views sit on a carousel: leaderboard 0, Send 1, Accept 2, Remove 3.
  The incoming view slides in from the right when it is further along than the outgoing
  one and from the left otherwise, so deselecting a tile always brings the board back from
  the left. Only the incoming view animates (280 ms, remounted by `key={view}` inside an
  `overflow: hidden` viewport); `prefers-reduced-motion` skips it.
* **Refresh**: every body takes `onChanged` (`FriendsActionBodyProps`), called after a
  mutation that changes the friend graph or the incoming count; `FriendsBody` re-reads the
  leaderboard and the Accept pin (`reloadTick`) without flashing "Loading…".
* The **Challenges** tile (flag `studyChallenge`, OFF) is still a navigating `BentoTile` on
  its own full-width row under the tiles (§ 1b).

**Person rows on the three bodies are inert** (no `onPersonPress`): the profile page they
used to open was deleted 2026-11-13. The `actions` slot is unchanged.

### Expand in place

Tapping a friend's leaderboard row opens `src/features/friends/FriendExpandedDetail.tsx`
inside that row (`FriendPersonRow`'s `detail` slot; `expanded` drives `aria-expanded`).
**One row at a time** (`FriendsBody` → `expandedId` / `toggleFriendRow`); tapping the open
row closes it; the viewer's own row stays inert. This replaced the `/users/:userId` profile
page.

**It animates open and closed**: `FriendPersonRow` wraps `detail` in an MUI `Collapse`
(`DETAIL_COLLAPSE_MS` = 280 ms, the same tempo as the view slide; 0 under reduced motion,
`unmountOnExit`). So every expandable row is passed its `detail` whether open or not, and
`expanded` decides; the detail's 12px top spacing is padding inside the collapse (the row
uses `columnGap` only) so a closed row is exactly as tall as an inert one. Opening one row
while another is open animates both at once.

It shows:
1. The old page header's lines: email, and "Studying 🇨🇳 CN · friends since …" (avatar and
   name are already on the row).
2. **One** `LibraryShelfPanel` for the friend's **active language** (the language the
   row is ranked in), unboxed (2026-11-14): the flag-over-name title, banked-minutes
   `FireCount` pinned in the panel's top-right corner, the four utcm spines, and the
   Velocity card directly under them. Every number is in the friend's language.

Not shown, by decision: the Reading / Writing goal badges, any relationship control
(unfriend is behind the Remove tile), the Study Challenge block toggle (dropped — see
[DEFERRED_WORK.md](./DEFERRED_WORK.md)) and the community designs grid.

Data: `GET /api/users/:userId/profile` (`src/api/userProfile.ts` → `fetchUserProfile`;
server contract in [USER_PROFILE_PAGE.md](./USER_PROFILE_PAGE.md)), **prefetched for every
friend on the board** the moment the leaderboard resolves —
`src/features/friends/useFriendProfiles.ts` → `useFriendProfiles`, one read per friend in
parallel, each catching its own error. FriendsBody mounts only when the Friends tab is
visited (or about to be swiped into), so this is "as soon as the learner reaches the tab".
Results are kept for the life of the tab; a board reload reads only ids not seen yet. A
failed read is shown as the row's error and re-read when that row is next opened
(`retry`). `FriendExpandedDetail` is presentational — it renders the `profileState` it is
given, and "Loading…" appears only if a row is opened before its read lands.

`FriendPersonRow` supports **two tap models**, and a screen uses exactly one:

| Prop | Tap target | `actions` slot | Used by |
|---|---|---|---|
| `onPersonPress` | the avatar + name half | real buttons, outside the tap target | the leaderboard (→ expand in place) |
| `onRowPress` | the **whole row** | must be **presentational only** | the challenges page (docs/STUDY_CHALLENGE.md § 1) |

Passing both is not an error — `onRowPress` wins — but a row should only ever want one,
and with `onRowPress` a `<button>` inside `actions` would compete with the row for taps
and tab stops.

Shared pieces:
* `FriendPersonRow.tsx` — the avatar + name + secondary-line + actions row used by
  the leaderboard and the three bodies (they differ only in the `actions` slot; the
  leaderboard also uses the `leading` / `leadingFill` rank section and the `detail` / `expanded` expand slot).
  It wears the shelf system's `.rw` **skin** — white ground, radius 16, a 36px
  rounded-square avatar carrying `COLORS.markOutline`, 14.5/11.5 type
  ([SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A5) — but is deliberately **not** the
  shared `Row` primitive (`src/components/primitives/Row.tsx`): a `Row` has one tap
  target and this has two nesting models. If the two ever converge, delete this one.
* `friendStyles.ts` — shared `sx` fragments, and `friendsView.ts` — the view enum, its
  carousel order and the bodies' props type. Both live outside the components because
  this repo lints `react-refresh/only-export-components`.
* `friendLabels.ts` — the leaderboard's `netMinutesLabel` /
  `velocityUnitLabel`, and `friendErrorMessage`.

### Friend codes (migration 187)

**Adding a friend is BY FRIEND CODE OR USERNAME.** One handle is `users."friendCode"`, 8
symbols shown as `XXXX-XXXX` (e.g. `K7QM-3XRA`), short enough to read aloud; it replaced the
account's 36-character UUID on 2026-11-13. The other, since migration 188 (2026-11-14), is
the account's `users.username` ([LOGIN_REWORK.md](./LOGIN_REWORK.md) Q20). The add field
takes either: `FriendsService` → `resolveTarget` tries a UUID, then an explicit `@username`,
then a friend code (only when one has that shape AND exists), then a username. An 8-letter
username can look like a code, so the code wins and the username is the fallback. Input
that fits neither shape is a 400 before any query. Other users' rows carry `username`, never
`email` (Q20).

* **Alphabet:** `23456789ABCDEFGHJKMNPQRSTVWXYZ` (30 symbols — no 0/O, 1/I/L, U), so
  30⁸ ≈ 6.6 × 10¹¹ codes. Defined twice and kept in step: `server/contracts/wire.ts` →
  `FRIEND_CODE_ALPHABET`, and `database/migrations/187-users-friend-code.sql` →
  `generate_friend_code()` + its CHECK.
* **Storage:** uppercase, no hyphen, `UNIQUE NOT NULL`, filled for new rows by the column
  DEFAULT `generate_friend_code()` (re-rolls on a clash). The hyphen is display-only —
  `wire.ts` → `formatFriendCode`.
* **Shown:** the Friends tab renders yours at body size (`SIZE.body`, semibold, lightly tracked) with a bare copy icon (`IconButton`, `friends-page__copy-id-button`; no pill)
  hung off the code's right edge out of flow, so the code alone is centred under the header,
  that copies the hyphenated form (`userSelect: "text"`, an explicit exception to the
  app-wide `user-select: none`). Served to the account itself on `/api/auth/me`
  (`UserDAL.findById`) and login/register (`SELECT *` / `RETURNING *`). Never in any
  other user's payload.
* **Typed:** the Send body's field posts `{ friendCode }` as typed; the server normalises
  case, spaces and hyphens (`wire.ts` → `normalizeFriendCode`) and rejects any symbol
  outside the alphabet before querying (`FriendsService` → `resolveTarget`, then
  `UserDAL.findByFriendCode`). A full UUID is still accepted, as `friendCode` or the
  legacy `{ userId }` body — see docs/DEFERRED_WORK.md (friend-code cleanup).
* **No rotation** today: a code is permanent. A "regenerate my code" control would be a
  single UPDATE with `generate_friend_code()`.

The **Accept** tile carries a red count pin when incoming requests exist —
`FriendsBody` fetches the incoming list alongside the friend list purely for that
count.

### 1b. Challenges (`/friends/challenges`) — BUILT (page 2026-08-17, playable rounds 2026-08-22)

Specified by [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 1, and shipped with that
feature. (This section said "not built" until 2026-08-22; the page had in fact been
live since 2026-08-17 and only the scored rounds were missing.)

A NodePage, reached by a fourth top-row button on the Friends tab, listing the viewer's
Study Challenges: awaiting your response, accepted and waiting for Friday, open now, and
recently finished.

⚠️ **One control on this page is not part of the friend model at all:** the
feature-tester-only **"Allow anytime"** switch, which lifts Study Challenge's calendar gates
for testing ([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 2a). It is rendered here
because this is where the weekly rules are felt, but it is gated on `users.isFeatureTester`
(migration 178) and is invisible to everybody else.

**Why it hangs off the Friends tab rather than sitting in the Menu:** a challenge is a
thing you have *with a person*. Every entry point to it is a friend, unfriending ends it,
and the per-pair block that suppresses it lives on `friendships`. Menu is a menu of
places; this is a property of a relationship.

#### The badge chain, and the one place language scoping is deliberately violated

A pending challenge is announced **only** by an in-app badge chain the user walks into —
no push, no email ([STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) § 1, Q48):

```
Menu Friends tile  →  Challenges button  →  the individual friend's row
```

This reuses the existing pattern exactly: the count rides along with the friends payload
`FriendsBody` already fetches, the way the incoming-requests count does today.

⚠️ **The badge must NOT be language-scoped, even though the page is.** Everything else
about vocabulary is scoped to the learner's active language, and the Challenges *page*
follows that rule — a zh challenge is invisible while the user is studying Spanish. The
**badge is the deliberate exception**: it counts challenges in *every* language.

The reason is load-bearing rather than cosmetic. A challenge issued in a language the user
is not currently studying would otherwise be completely invisible until it silently
expired — and a badge that hid it would be hiding the only thread back to it. So the
friends payload must carry the count **even when the user's active language is not the
challenge's**. Anyone "fixing" this inconsistency later re-breaks the case it exists for.

### 1a. The leaderboard (AccountSheet → Friends tab)

The Friends tab is a **leaderboard ranked by velocity** — utcm band-steps climbed in the
last 7 days ([VELOCITY.md](./VELOCITY.md)) — not a plain list. The board has no section
heading: it starts directly under the friend code card (`src/features/friends/FriendsBody.tsx`
→ `FriendsBody`). One row per person:

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
  the shared `src/utils/formatDuration.ts` (`weeks: true`). The figure is
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
* Velocity counts only the bars **that person** pursues (`activeWorlds` on their own
  `readingGoal`/`writingGoal`), matching what their own Account page shows.
* **The viewer is in the board**, marked `isCurrentUser`: the name is suffixed "(you)",
  and that is the **only** marker. The row is the same white `.rw` as every other row
  (the org-pastel fill it used to wear, and `FriendPersonRow`'s `highlighted` prop, were
  removed 2026-11-13). ⚠️ The arena board (`BoardRow.highlighted`) still fills the
  viewer's row, so the two leaderboards answer "which row is me" differently again.
* **The viewer's own row is not tappable.** `FriendsBody` omits `onPersonPress` when
  `isCurrentUser`, so `FriendPersonRow` renders the avatar/name half inert (no pointer
  cursor, no expand). Every friend row expands in place (§ 1 "Expand in place").
* **The rank is the row's whole left section**, not a chip: `FriendPersonRow`'s `leading`
  slot renders a full-height column (min 40px wide) divided from the rest of the row by one
  `COLORS.rowBorder` hairline. It runs the row's full height, so an expanded friend's
  detail sits to the RIGHT of it (indented by the section). The numeral (`RankNumeral`,
  17px `DATA_TYPE` bold ink) stays level with the main line rather than re-centring as the
  detail opens. (A 28px chip left of the avatar until 2026-11-13.)
* Ranks 1–4 tint the whole section (`leadingFill`, `FriendsBody.tsx` → `rankFill`) in the utcm band colours, best band for the best rank — 1 Mastered (blu), 2 Comfortable (grn), 3 Target (yel), 4 Unfamiliar (red) — read from `BAND_HUES` (`src/utils/categoryColors.ts`) at the MID tier; rank 5 and below take the ramp's achromatic `grey` at the same MID tier (`NON_PODIUM_HUE`, user 2026-11-14; white until then). (A gold/silver/bronze top three in org / blu / red until 2026-11-13.)
  No `markOutline` ring: it was mandatory on the small unoccupied chip, but the section is
  already bounded by the row outline and the divider.
* The three top **tiles** are coloured by their action's valence — Send neutral blue,
  Accept green, Remove red — the same green/red pairing the request rows use for
  Accept/Decline. They are `BentoTile`s (`variant="compact"`, `columns={3}`) since entry
  8, a toggle group since 2026-11-13 (§ 1 "The action tiles"); the pending count is
  a tile `pin` with `pinTone="alert"`, which replaced the friends-only `navButtonSx` /
  `cornerBadgeSx` fragments (both deleted).
* **Ranking is the server's**: the client never re-sorts, and the board has no
  mutations of its own — unfriending happens behind the Remove tile, so the ranks on
  screen are always exactly the ranks the server assigned.
* A friendless viewer still gets a **board**, not an empty state: the server always
  includes the viewer's own row, so the leaderboard renders with that single row and
  the "No friends yet. It's okay, I'll be your friend :)" line sits *beneath* it rather than
  replacing it. The one-row board is exactly what the screen looks like the moment a
  first friend is added, so nothing about the layout changes underneath the user.

### Optimistic vs. confirmed updates

Deliberately mixed, per the cost of being wrong:
* **Unfriend** (Remove body) is optimistic (row disappears at once, restored
  on failure) — the action is symmetric and trivially redone. It also carries a
  `busyId` guard, because a double-tap's second call 404s ("you are not friends
  with this user") and would surface an error for something that in fact succeeded.
* **Accept / Decline / Withdraw** wait for the server. A failed accept that had
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
| GET | `/api/friends` | `FriendSummary[]` — accepted friends, newest first. Read by `RemoveFriendsBody`. |
| GET | `/api/friends/leaderboard` | `FriendLeaderboardResponse` — `{entries, windowDays}`, viewer included, ranked |
| DELETE | `/api/friends/:friendUserId` | 204 — unfriend (either side) |
| GET | `/api/friends/requests/incoming` | `FriendRequestSummary[]` |
| GET | `/api/friends/requests/outgoing` | `FriendRequestSummary[]` |
| POST | `/api/friends/requests` `{friendCode}` (legacy `{userId}`) | 201 `SendFriendRequestResponse` |
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
disclosure. Knowing a friend code is enough to confirm an account exists (404 vs 201).
That is acceptable while codes are random over 6.6 × 10¹¹ values and shared by choice —
but codes are far more enumerable than UUIDs were, so the request endpoint should get a
per-user rate limit before the user base grows (docs/DEFERRED_WORK.md, friend-code cleanup).

There are no private accounts: `users.isPublic` was dropped by migration 189
([LOGIN_REWORK.md](./LOGIN_REWORK.md) Q7).

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

Ordinary `/deploy` — additive migrations (`138`; `187` friend codes, which backfills
every existing user inside the migration), no ordering constraint (old clients send
`userId`, still accepted), no cron change. `migrate.sh` picks them up. No runbook needed.

Verify on PPE after deploy:

```sql
SELECT to_regclass('friendships');            -- expect: friendships
SELECT indexname FROM pg_indexes WHERE tablename = 'friendships';
-- expect friendships_pkey, friendships_pair_uniq,
--        friendships_requester_idx, friendships_addressee_idx
SELECT count(*) FILTER (WHERE "friendCode" IS NULL) AS missing,
       count(*) - count(DISTINCT "friendCode")      AS dupes FROM users;
-- expect: 0 | 0
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
`src/utils/formatDuration.ts`,
`src/routes/routeMeta.ts` (the four friends entries),
`src/routes/registry.ts` (four `PAGE_COMPONENTS` entries),
`src/components/menuPopover/menuDestinations.ts` → `useMenuDestinations` (the `friends` row).

Planned additions (with Study Challenge): a fifth `src/features/friends/*` page and its
`routeMeta`/`registry` entries (§ 1b), the two `friendships` block columns (§ 2), and a
challenge count on the friends payload that `FriendsService` must assemble **without**
language scoping (§ 1b).

Related docs: [STUDY_CHALLENGE.md](./STUDY_CHALLENGE.md) (the Challenges page, the badge,
and the block columns — all planned),
[VELOCITY.md](./VELOCITY.md) (the ranked metric),
[PER_LANGUAGE_STREAKS.md](./PER_LANGUAGE_STREAKS.md) (the net wallet),
[BENTO_SYSTEM.md](./BENTO_SYSTEM.md) (the Menu tile),
[LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) (the NodePage archetype),
[BACKEND_LAYERING.md](./BACKEND_LAYERING.md), [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md).

## 8. Not built

Deliberately out of scope for this pass — no friend-only content
beyond the leaderboard's two numbers (no friend's decks or streak), no notification when
a request arrives (the badge on the Friends tab is the only signal), and no
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
