# User Profile Page

The app's only screen for looking at somebody who is **not you**: `/users/:userId`.

Reachable for **any** account — friend, stranger, pending request, or yourself — which
is what makes its Add-friend button meaningful. It is a Node drill-in
(docs/UX_AND_NAVIGATION.md), reached by tapping the person half of a
`FriendPersonRow` on the friends list, the leaderboard, or the sent/incoming request
screens.

⚠️ **NOT from the challenges page** (changed 2026-08-17). That page binds the same tap
target to the challenge action instead — issue or accept — because the whole page is
one action per friend and a large tap area that navigated elsewhere was a trap. The
per-pair challenge block still lives here; reach it via `/friends`. The row prop is
therefore `onPersonPress`, not `onOpenProfile`: the row does not assume the tap means
"profile" any more — and the challenges page uses `onRowPress` instead, which makes the
whole row one button for the challenge action (docs/FRIENDS_FEATURE.md).

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
`request_received` | `none`), so the header's action row draws exactly one FRIEND action
and never has to prioritise competing booleans.

| Relationship | Friend action | Addresses |
|---|---|---|
| `self` | *(none)* | — |
| `none` | **Add friend** (green) | the user |
| `request_sent` | **Requested** → revokes (blue) | `requestId` |
| `request_received` | **Accept** (green) | `requestId` |
| `friends` | **Remove** (red) | the user |

After **any** of them — and after the challenge-block toggle — the page **re-fetches** rather than patching its own state. That
costs one round trip and buys correctness: a friend request can cross with one already
in flight from the other side (the server auto-accepts crossing requests — see
docs/FRIENDS_FEATURE.md), so a client that optimistically drew "Request sent" would be
wrong in exactly the case that matters.

Code: `src/features/profile/UserProfilePage.tsx` → `renderFriendAction`, `renderBlockToggle`, `runAction`.

## Every relationship control lives in the top bar

Add friend / Accept / Revoke / Remove **and** the challenge block are icon buttons in the
page's grey top bar (`NodePage`'s `headerExtraActions` slot — the same slot the card
detail and collection pages put their per-subject actions in), not in the page body.

Two reasons. They are all answers to one question — *what is this person to me* — so
splitting them between a card and a toggle further down reads as a page **setting**
rather than as part of the relationship. And the bar is **pinned**, so the controls stay
reachable however far the designs grid has been scrolled.

The identity card below is therefore identity only: avatar, name, email, and the
"studying / friends since" line.

The block is a **toggle, not a command**, so it renders its own state the way a favourite
star does — filled `DoNotDisturbOn` in red when blocked, outline `Block` in muted grey
when not. The fill change matters: colour alone would not survive a colourblind viewer.
`aria-pressed` carries the same fact to assistive tech, which no icon can, and the
tooltip carries the symmetry wording an icon has no room for.

Code: `src/features/profile/UserProfilePage.tsx` → `renderFriendAction`,
`renderBlockToggle`; `src/features/profile/profileStyles.ts` → `profileHeaderIconSx`.

## The challenge-block toggle

The per-pair Study Challenge opt-out finally has a UI. Before this page it was a fully
built backend with a client API function and **zero callers** — the feature was
unreachable.

* Rendered **only for friends**. The flags live *on* the friendship row, so a non-friend
  has neither a block to show nor anywhere to store one; the server sends
  `challengeBlock: null` and the client draws nothing rather than an unset toggle it
  could not honour.
* The tooltip states the **symmetry** plainly — "in both directions" — because setting it
  stops the viewer's own outgoing challenges too, and a control that silently did that
  would be a trap.
* The copy deliberately does **not** mention that the block is never disclosed to the
  other person. That is a promise made to *them*, not to the viewer.

Code: `PUT /api/studyChallenges/blocks/:friendUserId` →
`StudyChallengeService.setChallengeBlock`; client `src/api/studyChallenges.ts` →
`setChallengeBlock`.

## Stats: one panel per language

The account gets **one progress panel per language it is learning**, each with that
language's velocity, net wallet balance and four utcm band counts.

**Order and membership are decided server-side** and the client renders `stats.languages`
as received, never re-sorting it:

1. The account's **selected** language leads — whatever its balance, including zero.
   The header says they are studying it, so a profile that then showed no panel for it
   would contradict itself on the same screen.

   > **The panels themselves no longer mark which language is selected.** A
   > "Currently studying" chip used to sit beside the panel's language badge, on the
   > argument that position alone cannot distinguish "first" from "current"; it was
   > dropped in the 2026-09-19 panel-heading change. The fact is still on screen —
   > the identity card at the top says "Studying 🇨🇳 CN" — but it is now one
   > cross-reference away rather than stated on the panel. `isSelected` is still sent
   > by the server and still lands on the panel as an `is-selected` class, so a visual
   > treatment can be restored without a contract change; nothing styles it today.
2. Every other language follows by **`netMinutes` descending**. Note this means the top
   panel is **not** necessarily the largest one — an account newly switched to Spanish
   shows Spanish first with a Chinese wallet ten times its size beneath it.
3. Languages with a **zero balance**, other than the selected one, are **dropped
   entirely**. A `user_languages` row is created the moment somebody so much as switches
   languages to look around, so an untouched row is a language they are *not* learning,
   and an empty panel for it would misreport a focused learner as a dabbler.

The **goal badges sit above the panels**, not inside each one: reading/writing goals are
account-wide opt-ins (`users.readingGoal` / `writingGoal`), and repeating them per panel
would imply a learner could pursue writing in one language and not another.
`velocityWindowDays` sits outside the array for the same reason — it is a constant.
`velocityBoundaryCounts`, by contrast, is **inside** each language's entry: it is that
language's `velocity` broken out per band boundary, and it sums to it.

**Card designs stay single-language.** They remain in the selected language alone, because
that list is a keyset-paginated scrolling feed and interleaving languages inside one page
would give the cursor two orderings to satisfy.

### Cost

`getNetPointsForUsers` doubles as the "which languages does this account have" read — a
`user_languages` row *is* the record of having studied one — so the wallet is fetched
**before** the band counts rather than beside them, one extra round trip. The band counts
then run in parallel, one per panel, bounded by the languages the account has actually
touched rather than by the number the app supports.

### The panel heading: flag over name

The panel is titled by a **40px flag emoji, centred, with the language's display name
under it** (`LANGUAGE_NAMES` — "Mandarin", not the "CN" region code). This is
deliberately *not* the inline `🇨🇳 CN` badge the friends leaderboard and this page's
own identity line use: those annotate a line of running text, whereas here a language
labels a whole BLOCK, and at 40px it is legible as the panel's identity from across
the card — which is what lets two stacked panels tell themselves apart at a glance.

The name under the flag is **load-bearing, not decoration**. `LANGUAGE_FLAGS`
(`server/contracts/wire.ts`) warns that Windows does not render regional-indicator
pairs as flags — it shows the bare letters — so a flag must never be the only carrier
of meaning. The flag is therefore `aria-hidden` and the name is the accessible label;
reading both aloud would give "flag of China, Mandarin", a duplicate rather than a
clarification.

Code: `src/features/profile/ProfileStatsCard.tsx` → `LanguagePanel`;
`src/features/profile/UserProfilePage.tsx` → `languageDisplay` (the one lookup behind
both the panel title and the identity line's inline badge, so the two cannot drift).

### The three figures, and where each sits

A panel now reads top to bottom as **identity → state → rate**, with the wallet parked
out of that flow:

| Figure | Treatment | Position |
|---|---|---|
| Language | 40px flag over its name (above) | centred, top |
| Banked minutes | `FireCount` — the app's flame readout | **absolutely** pinned top-right |
| Band counts | `DeckBuckets` shelf | middle |
| Velocity | `VelocityStatCard` — the Account page's own card, boundary breakdown included | below the shelf |

**Velocity is below the shelf** because that is the Account page's order, and the order
carries an argument: the library is the *state* and velocity is its *rate of change*, so
the reader meets the thing before the thing's derivative. Both pages now render the
literal same component (`src/components/VelocityStatCard.tsx`), ⓘ included — velocity is
uninterpretable without the definition of a level-up, and two pages each writing that
sentence out is two sentences that will drift. That includes the band-boundary breakdown
sharing the figure's line as `9 = 4 U→T + 3 T→C + 2 C→M`
([VELOCITY.md § 2b](./VELOCITY.md)): each panel gets its OWN language's split, carried
per language as `velocityBoundaryCounts`.

**The minutes flame is absolutely positioned, and that is not decoration.** The title
block is centred; a figure sharing its row would push the flag off-centre by half the
figure's width, and by a *different* amount per panel, since "2w 3d" and "41m" are not
the same length. Out of flow, every panel's flag lands on the same axis whatever the
balance reads.

**It is a flat flame, with no fill level.** `FireCount` draws the seconds gauge only when
given a `fillPct`; this caller passes none. A part-full gauge here would invite the
reader to watch a level that belongs to somebody else and cannot move on this screen —
the same argument that gives the header badge its off-study mode.

> ⚠️ **`MinutePointsFireBadge` could not be reused directly.** It calls
> `useMinutePoints()` internally, so it is hard-wired to the signed-in *viewer* and
> their *selected* language — dropping it on a profile would have shown the viewer's own
> live count under somebody else's name, in the wrong language. The visual was therefore
> extracted into `src/minutePoints/FireCount.tsx` (presentational, takes the number as a
> prop) and the badge rebuilt on top of it, keeping its hooks, eligibility branch, tick
> and pulse.

Code: `src/features/profile/ProfileStatsCard.tsx` → `LanguagePanel`;
`src/components/VelocityStatCard.tsx`; `src/minutePoints/FireCount.tsx`;
`src/minutePoints/MinutePointsFireBadge.tsx`.

### The band counts are a shelf, inside a card

The four band counts are the same `DeckBuckets` shelf the Account page draws, so a
profile and your own account present progress identically. The panel is a **padded
card**, though, and the Account page is a page with no padding of its own — so this
host passes `gutter={false}` to suppress `Shelf`'s own 22px page gutter (which would
otherwise indent the spines past the panel's "Progress" heading), and `DeckBuckets`
measures the panel and narrows all four spines to fit one line. Without that the
fourth band wraps below the shelf's board. See docs/SHELF_REDESIGN.md § "5 · Account"
for why the gutter is opt-in rather than always-off.

Code: `server/services/UserProfileService.ts` → `getProfile`;
`server/types/userProfile.ts` → `ProfileLanguageStats`, `ProfileStats`;
`src/features/profile/ProfileStatsCard.tsx` → `LanguagePanel`;
`src/components/DeckBuckets.tsx` → `useFittedSpineWidth`, `BucketsContainer`.

## Card designs

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

## Night market visit

`/night-market/user/:userId` renders another account's continent, read-only.

🚩 **Gated by the `nightMarket` flag** ([FEATURE_FLAGS.md](./FEATURE_FLAGS.md) § 2d). The
"Visit their night market" button on this page is the only way in, so with the flag off the
button is not rendered and the route is not registered.

**The read is read-only on the server too, and that took a deliberate change.**
`NightMarketWorldService.getUserLayout` *seeds an origin hub* when a market has no
placements — a WRITE. A stranger's page view must never materialise a hub in someone
else's account, so the visit branch passes `{ seedIfEmpty: false }` and an unbuilt market
comes back empty; the client says "They haven't built a night market yet."

The visited account's **own** language decides which continent renders (each language
grows its own — migration 130). It is resolved from their account server-side, never from
the query string, so a visitor cannot ask for a language the profile header never showed.

⚠️ **One write survives a visit, knowingly**: `getUserLayout` recomputes and persists each
placement's `activeVersion` (a stability cache, not a source of truth). The recompute is
deterministic from the owner's own data, so a visitor writes exactly the value the
owner's next read would have written. Suppressing it would make a visited market render
differently from the owner's view, which is worse. If that trade ever stops being
acceptable, the fix is to compute-without-persisting on the visit path.

`NightMarketVisitPage` is a **separate page** from `NightMarketEnginePage`, not a mode of
it. The owner's page also owns the minute-point badge, the occupant counter, the
template-author minute-adjust tool (a write against the *signed-in* account) and the
debug-overlay column — all of which would be wrong or dangerous pointed at someone else's
market. Hiding them behind an `isVisit` prop would leave those write paths mounted and one
conditional away from firing. The two share everything genuinely common: `useMarketWorld`
and `MarketEngineViewer`.

Code: `src/features/nightmarket/NightMarketVisitPage.tsx`;
`server/controllers/NightMarketWorldController.ts` → `getLayout`;
`server/services/NightMarketWorldService.ts` → `getUserLayout`.

---

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/api/users/:userId/profile` | `UserProfileResponse` |
| GET | `/api/users/:userId/designs?after=&limit=` | `CommunityDesign[]` |
| GET | `/api/nightMarket/layout?userId=` | `UserLayoutResponse` (visit mode) |

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
| Pages | `src/features/profile/` — `UserProfilePage`, `ProfileStatsCard`, `ProfileDesignGrid`, `profileStyles` |

`UserProfileService` reads band counts through `OnDeckVocabService.getCategoryCounts`
rather than issuing its own query. That method is already the one definition of "a sorted
card in band X" — it excludes provisional cards and bands on the core bar — and a second
copy is exactly how the decks page and this page would drift apart.

`findPublicProfileById` enumerates its columns instead of `SELECT *` on purpose: the row
leaves the account it belongs to, so adding a private column to `users` must not silently
widen the payload. `password` must never be one query away from a public response.
