# User Profile (endpoint)

`GET /api/users/:userId/profile` — one account's identity and study stats, as seen by
the signed-in viewer. **There is no profile page any more:** `/users/:userId`
(`UserProfilePage`) was deleted 2026-11-13. The endpoint's one client caller is a friend's
**expanded leaderboard row** on the AccountSheet's Friends tab
(`src/features/friends/FriendExpandedDetail.tsx` — docs/FRIENDS_FEATURE.md § "Expand in
place"), which shows the email + "studying / friends since" line and the active
language's progress panel (spines with the Velocity card under them, unboxed).

⚠️ **The response carries more than that caller reads.** `relationship`, `requestId`,
`challengeBlock`, `identity.readingGoal` / `writingGoal` / `createdAt`,
`stats.activeWorlds` and `stats.languages[].isSelected` drove the deleted page (its friend
action, block toggle, goal badges and "joined" line) and have **no client reader** now.
They are still computed and sent; trimming them is a contract change on both halves
(`server/types/userProfile.ts` ⇄ `src/api/userProfile.ts`).

**It introduces no storage.** There is no `profiles` table and no new column anywhere:
a profile is a *composition* of five features that each already own their data.

| Section | Source of truth | Owning feature |
|---|---|---|
| Identity, goals, joined date | `users` | account |
| Relationship + the friend action | `friendships` | docs/FRIENDS_FEATURE.md |
| Challenge block toggle | `friendships."requesterChallengesBlocked"` / `"addresseeChallengesBlocked"` | docs/STUDY_CHALLENGE.md § 1 |
| Velocity (per language) | `category_promotions` | docs/VELOCITY.md |
| Net minutes + the language set | `user_languages."totalMinutePoints"` | docs/MINUTE_POINTS_SYSTEM.md |
| Band counts | the vet tables | docs/MASTERY_REWORK.md |
| Card designs | vet `iconLayout` | docs/COMMUNITY_PAGE.md, docs/CARD_ICON_LAYOUT.md |

---

## The one invariant

> **Every number on a profile is scoped to the PROFILED person's own selected
> language, never the viewer's.**

This is the same rule the friends leaderboard follows (docs/FRIENDS_FEATURE.md §
Leaderboard), and it exists because the alternative misreports real learners: scoring a
Spanish learner in a Chinese viewer's language renders a dedicated account as four
zeros and an empty design list. Each stats panel is **titled** by its language — a
large centred flag over the language's name — **inside** the panel, so a reader never
has to look elsewhere to learn what the figures describe, which matters more now that
several panels stack.

Code: `server/services/UserProfileService.ts` → `getProfile`, `listDesigns`.

## Visibility

A profile is visible **in full to any signed-in user**, friend or not. That is a
deliberate product decision: the figures are already visible to friends, and designs are
already public through the Community feeds. `UserProfileService` is the single place to
gate it if that ever changes — the controller and the client render whatever it returns.

An unknown user id and a malformed one both raise `NotFoundError`, deliberately the same
answer, so the endpoint cannot be used to enumerate which UUIDs are real accounts.

## Relationship is a server-owned enum

`ProfileRelationship` is one closed enum (`self` | `friends` | `request_sent` |
`request_received` | `none`), so a client draws exactly one FRIEND action and never has to
prioritise competing booleans.

| Relationship | Friend action | Addresses |
|---|---|---|
| `self` | *(none)* | — |
| `none` | **Add friend** (green) | the user |
| `request_sent` | **Requested** → revokes (blue) | `requestId` |
| `request_received` | **Accept** (green) | `requestId` |
| `friends` | **Remove** (red) | the user |

The deleted page **re-fetched** after any of them rather than patching its own state. That
costs one round trip and buys correctness: a friend request can cross with one already
in flight from the other side (the server auto-accepts crossing requests — see
docs/FRIENDS_FEATURE.md), so a client that optimistically drew "Request sent" would be
wrong in exactly the case that matters.

This drove the deleted page's single friend action; nothing on the client reads it now
(see the ⚠️ at the top).

## The challenge-block toggle (no UI)

The per-pair Study Challenge opt-out's only UI was a header toggle on the deleted profile
page. It has **no caller** now: the backend (`PUT /api/studyChallenges/blocks/:friendUserId`
→ `StudyChallengeService.setChallengeBlock`) and the client function
(`src/api/studyChallenges.ts` → `setChallengeBlock`) remain. The `studyChallenge` flag is
OFF; giving the toggle a new home before turning it on is tracked in
docs/DEFERRED_WORK.md.

## Stats: one panel, the active language only

The account gets **exactly one progress panel: its selected (active) language**, with
that language's velocity, net wallet balance and four utcm band counts. The panel is
drawn whatever its balance, including zero: the expanded row says they are studying it,
so leaving the panel out would contradict that line.

> **History.** Until 2026-11-13 the profile stacked one panel per language with a
> non-zero wallet (selected first, the rest by `netMinutes` descending). It was cut to
> the active language alone because a stale panel for a paused language competed with
> the one the learner is working on now. The wire shape was **kept**:
> `stats.languages` is still an array (now always length 1) and `isSelected` is still
> sent (always `true`), so the client's map and the contract did not change. If the
> multi-panel view comes back, only `UserProfileService.getProfile`'s `panelLanguages`
> needs to change.

The friends leaderboard follows the same rule: each row is scored in that person's own
active language ([FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md)).

`velocityWindowDays` sits outside the array because it is a constant.
`velocityBoundaryCounts` is **inside** the language's entry: it is that language's
`velocity` broken out per band boundary, and it sums to it.

**Card designs are in the selected language too** (the designs endpoint below).

### Cost

One band-count read (`OnDeckVocabService.getCategoryCounts`) for the selected language.
`getNetPointsForUsers` is still read for that language's wallet figure; it is issued in
parallel with the friendship and velocity reads.

Code: `server/services/UserProfileService.ts` → `getProfile` (`panelLanguages`).

### How the expanded row presents it

The client side — flag-over-name title (the name is load-bearing: Windows draws flags as
letters), the flat `FireCount` minutes flame pinned top-right, and the shared
`LibraryShelfPanel` (the Account tab's own shelf, spines with the Velocity card under them, unboxed) — lives in
`src/features/friends/FriendExpandedDetail.tsx` and is described in
docs/FRIENDS_FEATURE.md § "Expand in place". `FireCount` (`src/minutePoints/FireCount.tsx`)
exists because `MinutePointsFireBadge` is hard-wired to the signed-in viewer's own live
balance and could not show somebody else's.

### The band counts are a shelf, unboxed

The four band counts are the same `DeckBuckets` shelf the Account tab draws, inside the
same `LibraryShelfPanel`, so a friend's row and your own account present progress
identically. Nothing is boxed (user, 2026-11-14 — the spines followed the Velocity card
out of the old `SectionCard`): the panel root carries the page margin (`PANEL_MARGIN`, or
`m: 0` inside the friend row's padding), so `LibraryShelfPanel` passes `gutter={false}` to
suppress `Shelf`'s own 22px page gutter (which would otherwise indent the spines a second
time, out of the Velocity card's column), and `DeckBuckets`
sizes all four spines against the panel in CSS (`cqw`) so they always fit one line. Without that the
fourth band wraps below the shelf's board. See docs/SHELF_REDESIGN.md § "5 · Account"
for why the gutter is opt-in rather than always-off.

Code: `server/services/UserProfileService.ts` → `getProfile`;
`server/types/userProfile.ts` → `ProfileLanguageStats`, `ProfileStats`;
`src/features/friends/FriendExpandedDetail.tsx`;
`src/components/velocity/LibraryShelfPanel.tsx`;
`src/components/DeckBuckets.tsx` → `fittedSpineWidth`, `BucketsContainer`.

## Card designs

⚠️ **No reachable UI.** The grid (`src/features/profile/ProfileDesignGrid.tsx`) was rendered
only by the deleted profile page (and only with the `community` flag on, which it is not),
so it is dead code pending a decision to delete or re-home it. The endpoint is gated
by the `community` flag in `userRoutes.ts`.

A wrapping grid of the account's **advanced** icon layouts, infinitely scrolled. Tiles
are the same `CommunityDesignCard` the Community page draws, with the same zoom, upvote
and apply-to-my-card controls, so a design behaves identically wherever it is seen.

**"Advanced" is the Community page's definition** (`IS_ADVANCED_LAYOUT`,
`server/dal/shared/advancedLayout.ts`): two or more icons, or one that has been moved,
resized, rotated or mirrored. The default single-icon placement every card gets for free
is excluded — otherwise the list would stop meaning "their artwork".

Three deliberate differences from the Community feeds, all in
`ICommunityLayoutDAL.getDesignsByOwner`:

1. **No self-exclusion.** The feeds skip the viewer's own rows because a feed is a
   discovery surface; a profile that hid its owner's designs *from its owner* would be
   absurd.
2. **No duplicate collapsing.** `dupRank` exists to stop one design appearing as N tiles
   across N owners. Within one owner there are no duplicates to collapse.
3. **Keyset pagination** on `entryKey`, not the feeds' exclude-arrays. The feeds page by
   exclusion because their order is random or vote-ranked and therefore unstable; this
   list has a total, stable order, so one cursor is cheaper and cannot grow without bound
   as a prolific designer's list is scrolled.

`voteCountThisWeek` and `inLibrary` are still resolved against the **viewer**, so the
vote and apply controls behave exactly as they do in a feed.

Code: `src/features/profile/ProfileDesignGrid.tsx`;
`server/dal/implementations/CommunityLayoutDAL.ts` → `getDesignsByOwner`.

---

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/api/users/:userId/profile` | `UserProfileResponse` |
| GET | `/api/users/:userId/designs?after=&limit=` | `CommunityDesign[]` |

A designs page **shorter than `limit`** means the list is exhausted — there is no
`hasMore` flag, deliberately, so there is no second signal that can disagree with the
rows. `limit` is capped server-side (`MAX_DESIGN_PAGE`).

The profile endpoint takes **no `language` parameter**, and cannot: a profile is scoped
to the profiled person's languages, so there is nothing for a client to supply.

## Layering

| Layer | Files |
|---|---|
| Wire types | `server/types/userProfile.ts` ⇄ `src/api/userProfile.ts` (mirrors — keep in step) |
| Controller | `server/controllers/UserProfileController.ts`, routes in `server/routes/userRoutes.ts` |
| Service | `server/services/UserProfileService.ts` — owns no storage; composes six dependencies |
| DAL | `IUserDAL.findPublicProfileById`, `ICommunityLayoutDAL.getDesignsByOwner` |
| Client | `src/features/friends/FriendExpandedDetail.tsx` (the profile endpoint's one caller); `src/features/profile/ProfileDesignGrid.tsx` + `profileStyles.ts` (unreachable — see Card designs) |

`UserProfileService` reads band counts through `OnDeckVocabService.getCategoryCounts`
rather than issuing its own query. That method is already the one definition of "a sorted
card in band X" — it excludes provisional cards and bands on the core bar — and a second
copy is exactly how the decks page and this page would drift apart.

`findPublicProfileById` enumerates its columns instead of `SELECT *` on purpose: the row
leaves the account it belongs to, so adding a private column to `users` must not silently
widen the payload. `password` must never be one query away from a public response.
