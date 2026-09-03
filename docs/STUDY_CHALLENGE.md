# Study Challenge

A weekly head-to-head between two friends: agree on a set of words on Monday, study
them all week, then play the same three games against that set and compare scores.

**Status: PHASE 1 (ASYNC) IS BUILT, 2026-08-22. THE SHELF-SYSTEM REDESIGN LANDED
2026-09-01.** The schema, the server stack, the client surfaces, the maintenance job and
the scored round runner in all four eligible games are done. Migrations 148 and 150 are
on prod; **migration 156 (taunts) is NOT yet on prod.** What remains is phase 2 (live
mode, § 7), a separate design: [STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md).

⚠️ **The 2026-09-01 redesign changed behaviour, not only appearance.** Four things a
reader of an older revision of this doc will find contradicted:

| Change | Where |
|---|---|
| The opponent's rounds are revealed **as each is submitted**, not withheld until both finish. Reverses the old anti-anchoring rule | § 6 |
| Issuing / waiting / incoming became a **sheet over the list**, not routed pages. `ChallengeReviewPage` and its two routes are deleted | § 3.2 |
| View Challenge swipes **the test card only** between two pages (yours, then theirs) under a fixed, re-inking masthead; both collapse to one on resolution | § 5.4b |
| **Taunts** — one canned line per player on the results screen, cycled by tapping | § 6a |

Plus, visual only: the seven-state pill lexicon was relabelled and recoloured (§ 1),
striking a word became two taps on the card itself (§ 3.2), and the round scoreboard
became a full-bleed dark board (§ 5.5).

| Step | State |
|---|---|
| **Migration 148** — `study_challenges`, `decks."editMode"`, the two `friendships` block booleans, the partial name index | ✅ applied and verified on dev |
| **Migration 150** — `weekStart` timestamptz → `weekIndex` integer, pair-week unique index rebuilt on it | ✅ applied and verified on dev (2026-08-17). Must ship in the SAME pass as 148 — the code reads only the new name |
| **Contract** — `CHALLENGE_WORD_COUNT`/`ROUND_COUNT`, `MAX_ACTIVE_CHALLENGES`, `ProvisionMode`, `CHALLENGE_GAMES`, the scoring/breakdown types | ✅ `server/contracts/wire.ts` |
| **Server** — DAL, service, controller, routes, DI, the preset-deck guard, the unfriend hook | ✅ smoke-tested end to end on dev |
| **`mastered-first` provisioning** | ✅ `ProvisionalCardDAL.findOwnCardsByBand` + `ProvisionalCardService.getFillerPool` (the full ladder: Mastered → Comfortable → Target → Unfamiliar → lent), and the `ProvisionMode` parameter threaded through `ensureBaseline`/`lendCards`. Band ordering verified against dev data |
| **Games** — the shared scoring runner, the registry↔pool sync test, pause-on-background | ✅ `src/games/runtime/challengeScoring.ts` (the declarative spec runner, 15 unit tests against the real specs), `challengeScoringFor` on the registry, `src/games/__tests__/challengePool.test.ts` (the test that keeps eligibility registry-derived), and pause-on-background in every game that needs it — Hydra included as of 2026-08-22, since a challenge round is the one timed variant it has |
| **The scored round runner** | ✅ **built 2026-08-22.** (a) the challenge-board pool read — `?challengeId=` on the EXISTING `/api/onDeck/gamePool` and `/api/onDeck/wordSearchGrid`, authorized by `StudyChallengeService.getRoundContext` and assembled by `OnDeckVocabService.getChallengeGamePool`; (b) all four eligible games classify contested/filler at board generation and emit `ChallengeEvent`s through one shared hook, `src/games/runtime/useChallengeRound.ts`; (c) Match Speed's alternation rule as a pure, tested module (`src/games/match-speed/challengeDeal.ts`); (d) the between-games scoreboard (`src/games/runtime/ChallengeRoundScoreboard.tsx`) and the round POST. The whole path is § 5.2a |
| **Tester hatch — "allow anytime"** | ✅ **built 2026-08-22.** A validator-only switch on `/friends/challenges` that lifts the four calendar gates (accept deadline, test window, one-per-pair-per-week, the 6-challenge cap) and nothing else. Per-device `localStorage` + `?anytime=1`, honoured by the server only for `isValidator`. See § 2a |
| **Client** — `src/api/studyChallenges.ts`, `src/features/studyChallenge/*` (incl. `challengeLabels.ts` → `acceptLapsed`,
`challengeAnytime.ts` + `ChallengeAnytimeNotice.tsx` → the tester hatch and its
on-screen consequences, and `ChallengeDetailPage`'s per-round Play buttons), the `/friends/challenges` NodePage + its badge, the fifth `/decks` section | ✅ built. The detail page's round list is the test's entry point: one **Play** button per unplayed round, strictly sequential (§ 5.1a), launched through `src/games/runtime/challengeLaunch.ts` |
| **Maintenance job** — `database/cron/expire-study-challenges.sql` and its `ExecStart` step | ✅ written; all four passes exercised on dev with backdated fixtures, and idempotent on re-run. ⚠️ **Inert on prod until `install-timers.sh` re-renders the unit** — a git pull does not roll out a unit-template change, and until it does nothing expires |
| **Runbook** | ✅ Retired 2026-08-17 — **shipped to prod**. Migration 148 was applied before the container rebuild (the deck read selects `decks."editMode"`), and the systemd unit was **re-rendered** by `database/cron/install-timers.sh`, without which the whole time-triggered half stays inert |
| **Week-counter follow-up (150)** | ✅ On prod since 2026-08-17. `"weekStart"` → `"weekIndex"`; the rename was applied before the container rebuild (its temporary runbook has been deleted) |
| **Migration 156** — `study_challenges.taunts jsonb NOT NULL DEFAULT '{}'` | ⚠️ **written, not yet applied anywhere.** Additive and defaulted, so old code tolerates it — but the shipped `toSummary` selects `taunts` by name, so **it must be applied BEFORE the container rebuild** or every challenge read 500s. See § 6a |
| **Shelf-system redesign** | ✅ built 2026-09-01 — `ChallengeSheet` + `ChallengePanel` (§ 3.2), the two-page View Challenge with `ChallengeTestCard` (§ 5.4b), `ChallengeResults` (§ 6/6a), `ChallengeHelpPopup` (§ 5.4c), the dark round scoreboard (§ 5.5), the relabelled pill lexicon (§ 1) and the tinted history log (§ 1) |

⚠️ **Migration 148, not 147.** 147 was claimed by the `compute_utcm_category` drop and
had already been applied to dev, so this one moved (CLAUDE.md § Migration number
collisions).

⚠️ **One column was added that § 9 does not list: `study_challenges."weekIndex"`.**
§ 1 specifies uniqueness as `(challengerId, challengeeId, week)` unordered, but a week
cannot be an index expression — resolving `users.timezone` is not `IMMUTABLE`, so
Postgres refuses it. `weekIndex` stores **whole weeks since Monday 2026-01-05 00:00
UTC**, and the unique index over `(LEAST, GREATEST, weekIndex)` then enforces the
weekly pair rule **and** the § 1 decline cooldown with no separate rate limiter.
Signed off 2026-08-17. It does not contradict Q50: deadlines are still recomputed live
from the player's current timezone, and only the challenge's *week identity* is fixed.

⚠️ **It shipped first as `weekStart timestamptz` and that was a bug (fixed by migration
150, 2026-08-17).** `weekStart` held the CHALLENGER's Monday 04:00 local as an instant,
which is a **different value in every timezone for the same calendar week** — measured
on 2026-08-19: `Asia/Shanghai` → `2026-08-16T20:00Z`, `America/New_York` →
`2026-08-17T08:00Z`, `Europe/London` → `2026-08-17T03:00Z`. The unique index therefore
never fired for a pair in two zones, and two friends challenging each other at the same
moment both succeeded: one pair, one week, **two** live challenges, two generated decks,
two cap slots, and a crown that could change hands twice. A global counter forces the
collision — every instant maps to exactly one index, so the second insert always hits
the index and gets a 409. See Q77.

The **data model (§ 9) was signed off** on 2026-08-16. §§ 1–6 and 8 remain the spec the
rest of the build is written from; § 7 (live mode) is phase 2.

---

## 1. The shape of a challenge

```
 Mon (local)          Mon–Tue midnight        Tue–Thu              Fri–Sun            end of window
 ─────────────────────────────────────────────────────────────────────────────────────────────────
 challenger picks     challengee reviews      temp decks live      test window        results / expiry
 friend + type        the word set and        on both accounts     3 games, same      winner declared,
 + word set           accepts (or lets                             order, same set    or NO CONTEST
                      it expire)
```

Two variants, chosen by the challenger right after picking the friend:

| Variant | Word set | Language |
|---|---|---|
| **Same-word** | ONE set of 12, negotiated by both players, used by both | both players play the **same** language |
| **Different-word** | each player gets their **own** 12, chosen by their own flow | may be **cross-language** (§ 8) |

Everything else — the timeline, the temp decks, the three games, the scoring, live
mode, expiry — is shared between the two variants.

### How many at once

**One challenge per friend pair per week, and at most six active at a time.** Alice may
challenge Bob, Carol and Dan on the same Monday and may simultaneously be challenged by
Erin — but she may not be in more than **six live challenges** at once
(`MAX_ACTIVE_CHALLENGES = 6`). Two limits doing two different jobs: the pair rule stops
one friendship generating noise, the count stops the week itself becoming unmanageable
(six challenges is six decks and up to eighteen rounds to play in one weekend — well past
the point where any of them gets real preparation).

Three rules make the cap behave (Q65):

* **It counts challenges you are *committed* to** — ones you issued that are still
  pending, plus ones you accepted — in either role.
* **Incoming invitations do not count until you accept.** This matters: if pending
  invitations consumed slots, a single friend could fill your quota with invitations you
  never asked for and lock you out of challenging anyone. Instead the cap is checked
  **twice** — when you issue, and again when you accept — so it is only ever spent by
  your own decisions.
* **It is per (user, language)**, like decks, minute points (migration 130) and the vet
  layer. A learner studying Chinese and Spanish may have six of each; their Chinese week
  and their Spanish week are separate weeks in every other respect. A single account-wide
  budget was rejected because it would be the **only** place in the app where two
  languages compete for a resource — starting a Spanish challenge could be blocked by
  Chinese ones, which no other feature does.

At the cap, the friend row's **Challenge** control is disabled with a stated reason
("you're in 6 challenges this week"), not silently absent — this is the one unavailable
state that is genuinely the user's own doing, so unlike Q39 and the block it should
explain itself.

Consequences the design must carry:

* A player can hold **several challenge decks at once**, so the `/decks` "Challenges"
  section (§ 4) is a list, not a single tile, and must stay tidy at its worst case of
  **six** entries — which is exactly why the cap is six rather than open-ended.
* The results surface is a **list of this week's challenges**, not one page.
* The uniqueness rule is `(challengerId, challengeeId, week)` **unordered** — Bob
  cannot counter-challenge Alice in a week she already challenged him. Enforce with a
  normalised pair key (`least(a,b), greatest(a,b)`), the same trick `friendships`
  already uses for its one-row-per-pair model.
* Q30 (deck-name collisions) is **not** eliminated by this rule — it only pushes the
  collision across weeks, where a `vs Bob` deck from last week may still be alive.

### Where it lives in the app

A new **Challenges page reached from the Friends page** — a NodePage under the friends
drill-in ([UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md)), sibling to `/friends/sent`
and `/friends/requests`, e.g. `/friends/challenges`. It is the single surface for the
whole lifecycle: invitations to answer, accepted challenges awaiting Friday, the test
entry point, and finished results. No new home-hub row and no push infrastructure — the
badge count rides along with the friends payload the hp Friends row already fetches,
which is what makes "you have a challenge" discoverable at all given there are no
notifications ([FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md)).

**The page is a list of friends, not a list of challenges.** The friend is the unit;
each row carries everything about your standing with that person:

```
 ┌─────────────────────────────────────────────┐
 │ [History ▸]                                 │   ← full log, top of page
 ├─────────────────────────────────────────────┤
 │ Bob            👑             Take Test  ▸  │   ← accepted, Friday open
 │ Carol               Incoming Challenge  ▸   │   ← she challenged you, pending
 │ Dan            👑              Challenge    │   ← nothing active
 │ Erin                           Withdraw     │   ← you challenged, pending
 └─────────────────────────────────────────────┘
```

* **One row per friend**, always present, whether or not a challenge is active. The row
  is the challenge's whole lifecycle: *Challenge* → *Withdraw* / *Incoming Challenge* →
  *See Cards* → *Take Test* → *See results*. There is never a second place to look.

### The pill lexicon — seven states, one control

`challengeAction` (`src/features/studyChallenge/challengeLabels.ts`) maps a challenge to
exactly ONE of these, so no two screens can disagree about where a pair is:

| state | pill | fill | what the tap does |
|---|---|---|---|
| `issue` | **Challenge** | purple | opens the issue sheet |
| `incoming` | **Incoming Challenge** | green | opens the invitation sheet (accept *and* decline live inside it) |
| `waiting` | **Withdraw** | red | opens the sent-challenge sheet |
| `study` | **See Cards** | orange | opens View Challenge |
| `test` | **Take Test** | blue | opens View Challenge |
| `results` | **See results** | blue | opens View Challenge |
| `none` | **—** | grey | nothing — the row has no handler at all |

**`results` OUTLIVES THE CHALLENGE'S LIVE WINDOW, by a week.** A challenge stops being
live (`pending`/`accepted`) the moment it resolves, but the friend row keeps showing
*See results* **until the next challenge period opens** — i.e. until the viewer's own
`weekIndex` ticks over at 04:00 local on Monday. `getChallengesPage`
(`server/services/StudyChallengeService.ts`) therefore fetches TWO sets and merges them
by opponent: `listLiveForUser` plus `listResolvedForUserInWeek(userId, weekIndex)`
(`complete` and `no_contest` only — `declined`/`expired` had nothing played, so there is
no result to open). A live row wins the merge over a resolved one, which can only happen
under the tester hatch (§ 2a) where a new challenge is parked in a future week while
this week's is already finished; there the live row is the real next step.

Without this the row dropped straight back to **Challenge** the instant a challenge
resolved, and that button was refused anyway — a resolved row still occupies the pair's
week, so `challengeability` would have answered `declined-this-week`. The week's own
result was then reachable only through History. Note this is why `challengeability`'s
early "not a blocked state" return takes `currentRow` (live **or** resolved-this-week)
rather than a live row: it is what suppresses that misleading `declined-this-week`
reason in favour of the results pill.

**THE CHALLENGES PAGE OFFERS THIS WEEK'S RESULT ONLY; HISTORY OFFERS EVERY RESULT.**
That asymmetry is the design, not a gap. The challenges page is about *this* week (it is
why the History log lives behind its own screen at all), so once the period rolls over
the pill goes back to **Challenge** and the finished challenge leaves the page. The
results screen itself is NOT time-limited — `/friends/challenges/:challengeId` serves any
challenge the viewer is a party to, forever, and the History log is the way back to it
(§ "Challenge history"). So there are exactly two doors to an old result, one of which
closes: the row closes at the period boundary, the log never does.

**Every label names the TAP, not the situation.** `waiting` reads *Withdraw* rather than
*Waiting on them* because the row is a button and the status line above it has already
said what is being waited on; a button captioned with a situation invites a reader to tap
it expecting a report. Same rule turned *Review words* into *Incoming Challenge* and
*Study deck* into *See Cards* (the tap does not start a study session — it opens the
word set).

**The colour names the KIND of tap, not whose turn it is.** An earlier rule painted
everything green when the ball was in the viewer's court, which gave *Take Test* and
*Incoming Challenge* the same fill despite being a routine step and a decision. Now:
green is a decision that arrives unasked (`incoming` only), red is the page's one
destructive control (`waiting`), orange is the state whose job is the deck rather than
the challenge (`study`, matching the Challenges shelf spines on `/decks`), **purple is
the one control that STARTS something** (`issue`), blue is the routine taps on a
challenge that already exists (`test`, `results`), grey is inert.

`issue` was blue alongside those routine taps until 2026-09-01. Two reasons it moved:
it is the page's **main verb** — on a list of friends you have no live challenge with,
it is the only control most rows carry — and sharing a fill with *See results* made the
row that offers a new challenge look like the row that reports an old one. Purple
(`COLORS.pur`) is the ramp hue this lexicon had not already spent, so the split costs no
new colour. ⚠️ Note it is also Learn Now's fill on `/decks`; the two never appear on the
same surface, but a third purple would break that, so check here before spending it.

**Accept and decline are not competing pills in a list.** One *Incoming Challenge* pill
opens the sheet that holds both, next to the words they are about.
* **Reigning champion** (👑) marks whoever won the pair's **most recent resolved**
  challenge. It sits on the row as a standing claim, and the next challenge is framed as
  taking it. A `no_contest` or a draw leaves the previous champion in place — the crown
  changes hands only when someone wins.
* **THE WHOLE ROW IS THE BUTTON, and it never opens a profile** (2026-08-17). The
  entire row — avatar, name, status line, pill and the padding between them — is ONE
  tap target that runs the row's lifecycle step: issue, accept, or open the challenge.
  It does not navigate to `/users/:userId` the way a `FriendPersonRow` does everywhere
  else in the app.

  This page exists to do one thing per friend, so its largest region must BE that thing.
  The row was previously a composition — a tappable person half that opened the profile,
  plus a small button that did the actual work — which put the trap where the target
  should have been and split one action across two controls.

  Consequences, each deliberate:
  * **The pill is presentational.** `challengeActionPillSx` renders a `Box`, not a
    `Button`, with `pointerEvents: none`. A real control nested inside a clickable row
    steals taps near its own edges, adds a second tab stop for the same action, and lets
    the two drift apart. The pill's job is to NAME what the row does.
  * **An unavailable row is inert** (blocked, at the cap, or `action === 'none'`): no
    handler, no pointer cursor, no focus stop. A tap that does nothing is honest; a tap
    that quietly goes somewhere else is not.
  * **The row is keyboard-operable** — `role="button"`, `tabIndex={0}`, Enter/Space —
    because it replaced a real `<button>` and must not lose what that gave for free.
  * Profiles stay reachable from `/friends`, which is also where the per-pair challenge
    block lives.

  The shared row therefore takes `onRowPress` (whole row, presentational actions) or
  `onPersonPress` (person half only, real action buttons) — one or the other, never
  both (docs/FRIENDS_FEATURE.md, docs/USER_PROFILE_PAGE.md).
* **No lifetime W–L anywhere.** Deliberate: a running record makes a losing streak a
  reason to stop playing, and the crown already supplies the rivalry. The data is stored
  regardless, so a record can be added later if it is ever wanted.
* Issuing starts from the friend's row (**Challenge**), so the friend is chosen before
  the variant, matching the flow in § 3.

Because rows are per friend and the page is language-scoped (below), the row set is
"friends who study this language" — a friend who studies only Spanish does not appear on
the Chinese challenges page. See Q39.

### How a challenge is announced: in-app badges only (Q48)

There is **no notification of any kind** — no push, no email, no native badge. A pending
challenge is announced by a **badge chain the user has to walk into**: a dot on the hp
**Friends** row → a dot on the **Challenges** row inside the friends drill-in → the
friend's row itself showing *Incoming Challenge*. Every one of those counts rides the payload
the surface already fetches; no new endpoint and no delivery infrastructure.

The accepted cost, stated plainly rather than designed around: **a player who does not
open the app between Monday and their Wednesday 04:00 never learns the challenge
existed.** It expires (`expired`, § 6) in silence. This is the same failure mode as Q39
and it has the same shape — the app can only speak to a user who is already looking at
it. Two mitigations that do *not* require new infrastructure:

* the badge must survive across sessions until the challenge is resolved, so a single
  app open at any point in the two-day window is enough;
* the friends payload must carry the count even when the user's active language is not
  the challenge's, or the language scoping (Q38) hides the badge as well as the row.
  ⚠️ This is the one place where language scoping must be **deliberately violated** —
  the badge is a "look over here" signal, not a challenge listing.

Building push notifications is the obvious upgrade and is deliberately **not** a
prerequisite: it is an independent project that would block this feature on it, and the
weekly rhythm (§ 2) is slow enough that a single app open per week is a reasonable
assumption for an engaged learner.

### Switching language mid-challenge (Q66)

A player who accepts a Chinese challenge on Monday and spends the week in Spanish
**cannot see it** — the challenges page is language-scoped (Q38), so their zh challenge,
its deck and its test entry point are all invisible until they switch back. Nothing is
lost; the challenge is untouched and one switch reveals it.

This is deliberate consistency rather than a special case: the deck is already invisible
in Spanish, the words are zh vet rows, and the minute points it earns are zh points.
Making the *challenge* the one cross-language surface would be the anomaly.

Two rejected alternatives and why: **auto-switching the language when the player taps
the test** would let a game silently change a global account setting; **showing
challenges in every language** would contradict the partitioning every other feature
uses.

⚠️ The accepted risk: a player who switches away for the week and forgets simply misses
their window, and the challenge ends `no_contest`. The badge (Q48) is the mitigation —
it deliberately ignores language scoping, so it still lights up. That is the one thread
back to a challenge you cannot otherwise see, which makes the badge's scoping exception
load-bearing rather than cosmetic.

### Empty state (Q67)

A user with no friends sees a **bare empty state** — "No challenges yet." — not a
feature explainer and not a hidden row. Consistent with every other empty surface in the
app; teaching the feature is not this page's job, and a row that vanishes until you have
a friend would make the feature undiscoverable for exactly the people who have not found
friends yet.

### Withdrawing, declining, and not wanting to be challenged

* **Withdraw** — the challenger may cancel a `pending` challenge at any time before it
  is accepted, from the same friend row that issued it. The row is deleted outright (no
  `withdrawn` status, no history entry): nothing was agreed, no decks exist, so there is
  nothing to record. This is also the only repair for a challenge issued into the wrong
  language (Q39) or to the wrong friend.
* **Decline** — the challengee may end a `pending` challenge explicitly rather than
  letting it expire. Declining **blocks a new challenge to that pair until the next
  Monday**, so the weekly rhythm doubles as the cooldown and no separate rate limiter is
  needed. (Any Mastered writes made while reviewing the set persist — Q25.)
* **"No challenges with this friend"** — a per-friend toggle, a durable opt-out
  independent of the weekly cooldown. **It lives on the profile page**
  ([USER_PROFILE_PAGE.md](./USER_PROFILE_PAGE.md)), shown only for friends because the
  flags live on the friendship row. (It was designed as a control on the friend row; it
  shipped without one and was unreachable until the profile page gave it a home.)

  **Each player owns their own flag; the effect is symmetric.** Either player may set a
  block independently, and **a challenge goes through only if neither has blocked**.
  Setting a block therefore stops your own outgoing challenges to that person as well as
  their incoming ones — it means *"I do not want to play challenges with this person"*,
  not *"don't let them challenge me"*. That is the honest reading: a challenge is a
  mutual commitment to three games, so opting out of them with someone is a statement
  about the pair.

  This separates **ownership** from **effect**, which is what makes the flag safe:
  each side can only ever clear its own, so a blocked person cannot unblock themselves,
  and someone who blocks is never silently unblocked by the other party changing their
  mind.

  Storage: **two booleans on `friendships`**, one per endpoint —
  `"requesterChallengesBlocked"` / `"addresseeChallengesBlocked"`, both
  `NOT NULL DEFAULT false`, matching the table's existing `requesterId`/`addresseeId`
  endpoints (`database/migrations/138-create-friendships.sql`). Two columns rather than
  one because they are two independent facts held by two people; the *reading* is
  `NOT (requesterBlocked OR addresseeBlocked)`, and that OR is where the symmetry lives.
  They belong on `friendships` because a block is a property of the relationship, not of
  either user. ✅ Signed off.

  ⚠️ The block is **not disclosed to the blocked friend** — their row shows no Challenge
  control and no reason. That is intentional (a visible "Bob blocked you" is worse than a
  quiet absence) but it does mean a user can be confused about why a friend is
  unchallengeable, which is the same ambiguity Q39 creates. Both point at the same UI
  need: a neutral "not available" line rather than a bare missing button.

### Challenge history

A **History** button at the top of the challenges page opens the full, **paginated** log
of every challenge the user has played — the durable record § 6 promises, made
browsable. Each entry shows the opponent, the date, the word set, both totals, and the
outcome — which tints the whole card, not just its label. The **per-round breakdown is
deliberately not here**: it lives on the challenge's own results screen, and printing it
in the log made every row several times taller for detail nobody scans a log for.

**Tapping an entry opens that challenge** (`/friends/challenges/:challengeId`,
`ChallengeDetailPage`). Every logged challenge is resolved, so that page renders its
results screen. The whole card is the target — a log row is scanned as one object, so a
chevron-sized target reads as "not tappable" — and the navigation carries
`state.from = "/friends/challenges/history"` so Back returns to the log rather than to
the challenges list. `ChallengeDetailPage` falls back to `/friends/challenges` when that
state is absent (a refresh or a shared link).

Controls:

| Control | Behaviour |
|---|---|
| Sort | by time (default: most recent first) |
| Filter: friend | one opponent |
| Filter: game | challenges that included a given game |

The game filter is why each entry in `study_challenges.rounds` stores `gameId` rather than
only the sequence on the challenge row — filtering "challenges where I played Word
Search" is a join on the rounds table, and the sequence column alone would force a jsonb
scan. Pagination is keyset on `completedAt`, not offset, since the log only grows.

The history is **not** language-scoped: it is a record of what you did, and hiding half
of it behind the active language would make a page whose whole purpose is completeness
lie about it.

### One language per challenge — the challenger's active language

A challenge is **scoped to a single language**, and that language is simply the
challenger's **currently active** one. No language picker in the invite flow.

The challenges page is likewise **language-scoped**: the challengee sees an invitation
only while that language is active. A Chinese challenge is invisible to a friend
sitting in Spanish; switching to Chinese reveals it. This is the same per-language
partitioning that decks, minute points (migration 130) and the whole vet layer already
use, so it is consistent rather than special-cased. The **page** is scoped; the
**badge** deliberately is not (§ 1, Q48), because a badge that hid cross-language
challenges would be the very thing that makes them undiscoverable.

**Consequence (Q39, settled): the silent expiry is accepted.** A challenger may issue
into a language the challengee does not study; the challengee never sees it and it
expires (`expired`) with no feedback to either side. Nothing warns and nothing blocks.
Rationale: both alternatives need a *friend's studied-languages* list that no endpoint
exposes today, and adding one to prevent an uncommon, harmless dead end is not worth the
payload. The damage is bounded — an expired challenge costs nothing, creates no deck,
and the pair is free to try again the following Monday.

Because of Q48, the challengee's badge *does* light up even in the wrong language, so
the practical outcome is softer than "invisible": a curious user who taps through and
finds an empty challenges page has at least been given a thread to pull. Revisit only if
this is actually reported.

Cross-language pairing is the exception, and only for **different-word** challenges
(§ 8), where each side plays their own language by construction.

---

## 2. Timeline and time zones

Every boundary is **local to the user it applies to**, derived from
`users.timezone` (migration 50) the same way the streak cron and the community week
already derive theirs.

**The day boundary is 04:00 local, not midnight** — the same boundary the streak cron,
the AI usage counter (migration 100) and the community vote week (migration 86) already
use. "Monday" here therefore means Monday 04:00 → Tuesday 04:00 in that user's zone.

| Boundary | Whose clock | Exact instant |
|---|---|---|
| Issue window opens | **the challenger's own** | Monday **04:00 local** (see "When a week opens" below) |
| Accept deadline | **challengee's** | **Wednesday 04:00 local** (i.e. the end of their Tuesday) |
| Test window opens | **each player's own** | Friday 04:00 local |
| Test window closes | **each player's own** | Monday 04:00 local — the instant the next issue window opens |

The UI must state these as the user experiences them ("until 4 AM Wednesday"), never as
"midnight", or the copy will be four hours wrong.

Because the two players can be in different zones, the windows do **not** coincide.
Consequences that the design must accept rather than paper over:

* A challenge issued on the challenger's Monday can arrive on the challengee's Sunday
  or Tuesday. The **accept deadline is the challengee's**, so they always get at least
  their own Tuesday.
* Player A may enter the test window hours before player B. In **async** mode that is
  harmless. In **live** mode a player can only invite someone whose window is also
  open (§ 7).
* Expiry (§ 6) fires on the **later** of the two players' window closes, so nobody is
  timed out by someone else's clock.

Boundaries are computed on demand from the stored **week index** plus each user's
timezone — **not** stored as pre-computed local timestamps, which would go stale the
moment a player travels.

### When a week opens (2026-08-23)

**A player's challenge week opens at 04:00 on their own Monday**, like every other
boundary in the app, and a challenge they issue is stamped with the week that is
current *for them* — `localChallengeWeekIndex(challengerTz, now)`
(`server/shared/challengeWeek.ts`), not the UTC counter's roll.

Naming the week in UTC (below) and *starting* it in UTC are different decisions, and
for a while the code did both. Stamping from the counter was not merely early or late:

| Challenger's zone | What the UTC stamp did | Effect |
|---|---|---|
| **East of UTC** (e.g. Shanghai, whose Monday 04:00 is Sun 20:00 UTC) | issued into the **outgoing** week for the 4h before the roll | the challenge was born **past its Wednesday accept deadline** — nobody could accept it, and it occupied the pair's *previous* week |
| **West of UTC** (e.g. Los Angeles, whose Monday 04:00 is 11h after the roll) | issued into the **incoming** week from Sunday evening | harmless, just early |

⚠️ **The two players' weeks therefore roll at different instants**, and in the hours
between them a pair disagrees about which week it is. Two different week indices never
collide on `study_challenges_pair_week_uniq`, so the unique index no longer contains a
crossing pair on its own — the **live-pair guard** does:

> **A pair may hold at most one unfinished challenge, whatever week it is named after.**
> `StudyChallengeService.issueChallenge` gate 1a.

"Unfinished" is **derived**, never the stored status — `latestTestWindowClose` against
the row's week — for the same reason every other read here derives its state: the hourly
job runs late on prod and not at all on dev, and reading `status` would hold Monday's
challenge hostage to a row the job has not rewritten. The guard is also the invariant
`getChallengesPage` already assumes when it keys live challenges by opponent, so it is
now enforced rather than hoped for. It is **not** lifted by `anytime` (§ 2a): it is a
data invariant, not a calendar.

**One rule did soften, deliberately.** The § 1 decline cooldown ("no second challenge to
this pair this week") is the pair-week row, and during the disagreement window the two
players name that week differently — so a friend who declines can, in principle, be
re-challenged by an opponent whose week has already rolled. The outcome is one extra
invitation they can decline again or shut off with the per-pair block; the *state* stays
correct, because the live-pair guard above is what protects the data.
Pinned by `server/__tests__/challengeWeek.test.ts` and
`server/__tests__/studyChallengeIssueWeek.test.ts`.

### The week is a global counter (Q77)

`study_challenges."weekIndex"` is an integer: **whole weeks since Monday 2026-01-05
00:00 UTC**. The epoch is a Monday, which is what lines the counter's weeks up with the
app's Monday→Monday week.

**It has no timezone parameter, and that is the point.** The week is the challenge's
IDENTITY — the third column of `study_challenges_pair_week_uniq`, which is simultaneously
the one-per-pair-per-week rule and the § 1 decline cooldown. An identity that varies by
who is asking cannot be a unique key, which is exactly how the first implementation
failed: it stored the challenger's local Monday 04:00 as an instant, so a pair in two
zones wrote two different values for one week and BOTH crossing challenges were created
(migration 150 fixed this; see the banner at the top of this document).

Two consequences, stated plainly:

* **The counter NAMES the week; it does not start it.** Which name a new challenge
  carries is decided on the challenger's own clock (see "When a week opens" above) —
  the counter's job is only that both players, and the unique index, agree on what to
  call the week once it is chosen. This was not always so: until 2026-08-23 the issue
  window itself rolled at Monday 00:00 UTC, which produced dead-on-arrival challenges
  east of UTC.
* **Every deadline stays per-player local.** They are derived from the index's Monday
  DATE plus each player's own zone: `weekBoundary` in `server/shared/challengeWeek.ts`,
`server/dal/implementations/UserDAL.ts` → `findById` (must select `timezone` — § 2),
  and the identical `DATE '2026-01-05' + 7 * "weekIndex" + N` at 04:00 in
  `database/cron/expire-study-challenges.sql`. The two are cross-checked instant-for-
  instant in `server/__tests__/challengeWeek.test.ts` — if they ever drift, a player is
  shown a deadline the maintenance job has already acted on.

⚠️ **The epoch is duplicated in three places** — `CHALLENGE_WEEK_EPOCH_UTC`
(`server/shared/challengeWeek.ts`), migration 150, and the cron SQL. Changing one alone
renumbers every stored week and silently moves every deadline.

### `users.timezone` must be fresh, or the deadline renders at the wrong hour

Deadlines are computed server-side from `users.timezone` and serialized to the client as
**absolute instants** (`ChallengeDeadlines.testOpensAt` / `testClosesAt` /
`acceptDeadline`, `StudyChallengeService.toSummary`). The client then formats them with
`toLocaleTimeString(undefined, …)` — i.e. **in the browser's zone**
(`challengeLabels.deadlineLabel`). Two different zones, and nothing on screen names
either of them.

So when the stored column disagrees with the browser, the copy is simply wrong by the
offset, and looks like a bug in the week arithmetic. **Observed 2026-08-28:** an account
that had never been through the login hook still held the column default (`NOT NULL
DEFAULT 'UTC'`); the server correctly produced Friday **04:00 UTC**, and a UTC−7 browser
rendered it as **"9 PM Thursday"**.

The fix was to close the gaps in how the column is kept fresh, not to change the
boundary math — which was correct throughout. There are now four triggers (creation,
login/restore, every ~15-minute token rotation, and a foregrounded tab whose zone
changed); the full contract lives in
[STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md) under "Refresh path for
`users.timezone`", and the client half is documented in `src/utils/authSync.ts`.

#### ⚠️ …and the column being fresh is not enough — the DAL has to SELECT it (fixed 2026-09-01)

The same "9 PM Thursday" symptom came back on 2026-09-01 with a **correct** column: the
account's `users.timezone` read `America/Los_Angeles`, and the server still computed
every boundary at 04:00 **UTC**.

The cause was one column missing from one SELECT list. `StudyChallengeService.timezoneOf`
resolves the zone through `UserDAL.findById`, whose query enumerates its columns by
name — and `timezone` was not among them. `resolveTimezone(undefined)` **falls back to
`'UTC'` rather than throwing**, by design (the column is client-set and must never be
able to 500 a request), so the omission produced no error anywhere: it silently moved
every accept deadline and test window seven hours, and `isTestWindowOpen` agreed with the
wrong answer, so the window really did open early rather than merely being labelled early.

Two things kept it hidden:

* **Only Study Challenge was affected.** The arena, the streak cron and the minute-point
  week all read `users.timezone` in SQL (`server/dal/shared/weekBoundary.ts`,
  `ArenaService`), so they were correct on the same accounts at the same moment — which
  made the challenge look like it had its own week arithmetic wrong.
* **The 2026-08-28 investigation above found a real, different bug** (accounts stuck on
  the `'UTC'` default) with the identical symptom, and fixing it made the symptom go away
  for the accounts it applied to.

`UserDAL.findById` now selects `timezone`, and both it and the server-side `User` type
carry a note saying why the column is not decoration. **Rule: any DAL read that feeds a
04:00-local boundary computed in TypeScript must select `timezone`** — the fallback means
a missing column is a wrong answer, never a failure.

Code: `server/dal/implementations/UserDAL.ts` → `findById`; `server/types/index.ts` →
`User.timezone`; `server/services/StudyChallengeService.ts` → `timezoneOf`;
`server/shared/zonedTime.ts` → `resolveTimezone`.

⚠️ **Any account created outside the app** — a seed script, `POST /api/users`, a
fixture — starts on `'UTC'` and stays there until its owner logs in. On a dev box that
reads as a Study Challenge feature that opens its window seven hours early.

**Not adopted (yet): labelling the zone.** Arena already ships
`ArenaBoundaries.timezone` + `timezoneDiffersFromViewer` (`src/api/arena.ts`) so its
countdown can say which clock it means. `ChallengeDeadlines` does not, so a stale column
is silent rather than self-explaining. Worth mirroring if this recurs — see
[DEFERRED_WORK.md](./DEFERRED_WORK.md).

### If a player's timezone changes mid-challenge (Q50)

**Always use the current `users.timezone`.** Deadlines are recomputed from it on every
read; nothing about a player's zone is snapshotted onto the challenge row. This is the
same rule the streak cron already follows, it needs no new columns, and it means a
player who fixes a wrong timezone setting immediately sees correct deadlines instead of
being stuck with a wrong one for a week.

Consequences accepted rather than engineered away:

* **A window can move under a player's feet.** Travelling east shortens the remaining
  window; travelling far enough west can make an already-open window *retroactively
  closed*, so the player is told the test is over without having played. Rare, and the
  outcome is `no_contest` (§ 6) rather than a loss, so nobody is scored down for it.
* The two players' windows shift independently. Expiry still fires on the **later** of
  the two, so a traveller cannot time their opponent out.
* Because boundaries are recomputed rather than stored, **no backfill or repair job is
  needed** when a timezone changes — the next read is simply correct.

---

### 2a. "Allow anytime" — the tester escape hatch (built 2026-08-22)

Everything above makes this feature almost impossible to exercise. A change to the
round runner can only be played on a **Friday**, against a friend you have not already
challenged **this week**, after an invitation accepted before **Wednesday 04:00**. So
there is one switch that lifts the calendar, and only a tester may spend it.

**Where it is.** A `Switch` at the top of `/friends/challenges`, rendered **only for a
validator account** (`users.isValidator`, migration 104 — the same flag the data
validation system uses). Not hidden behind a menu: a tester needs to SEE whether the
week is being bypassed, because a silent flag that rewrites every deadline is exactly
the kind of state that gets left on and then misread as a bug.

**What it lifts — and only this:**

| Lifted | Still enforced |
|---|---|
| the accept deadline (Wed 04:00 local) | you must be **friends** |
| the test window (Fri 04:00 → Mon 04:00 local), including the rule that hides `gameSequence` until it opens (Q63) | the **per-pair block** — a person's decision about another person is not a clock |
| **one challenge per pair per week** — the gate that actually blocks repeat testing | rounds are **strictly sequential, one attempt each** — claimed at the first mark, immutable once final (§ 5.1a) |
| `MAX_ACTIVE_CHALLENGES` (6) | scoring, storage, deck creation and winner resolution are **identical** to a real week |

The second column is the point: a hatch that also relaxed the block or the round rules
would be testing a game nobody plays.

**It is a REQUEST, not a state.** The switch lives in that browser's `localStorage`
(`cow.challengeAnytime`); every call carries `?anytime=1`, and the **server** decides
whether to honour it by checking `isValidator`
(`StudyChallengeService.resolveAnytime` — the one place that check exists). Two
consequences, both deliberate:

**The client is gated on `isValidator` too**, and fails closed. `challengeAnytime.ts`
holds a module latch (`allowed`, fed by `useChallengeAnytime()` from the auth user);
until a mounted hook says the account is a validator, `challengeAnytime()`,
`anytimeParams()` and `anytimeQuerySuffix()` all read false regardless of what is in
`localStorage`. The hook also **clears a stored request** when the current account is
not a validator, so a flag left behind by a revoked account (or by a different user on
a shared browser) cannot linger. Without this the server would correctly ignore the
flag while the client still drew anytime-flavoured labels and lifted deadlines — the
worst of the two states.

* **There is no column, on purpose.** A stored account flag would eventually be left
  switched on and would silently turn a real week into a free-for-all for that
  account. A per-device request cannot outlive the browser it was set in.
* **A non-validator sending the flag is ignored SILENTLY** — no error, no hint. A 403
  would be a probe for who holds the flag, and they get the ordinary weekly rules
  either way.
* **It covers the holder's own calls only.** It is resolved per REQUEST and is not
  attached to the challenge, so one player having it on does nothing for the other:
  their accept, and their own three rounds, are judged against the real calendar unless
  they are also a validator with the switch on in their own browser. A two-sided test
  therefore needs two validator accounts and two switches. The UI says so.

**An anytime challenge is parked in the pair's next free week.** The pair-week rule is
not only an app check — it is the unique index `study_challenges_pair_week_uniq` — so
skipping the check alone would just turn a clear refusal into a constraint violation.
`issueChallenge` therefore walks forward from the current week counter to the first one
this pair has no row in (`nextFreeWeekForPair`). Its deadlines then sit in the future,
which is precisely the state `anytime` ignores.

> ⚠️ **The accepted cost, stated so it is not a surprise:** a parked challenge
> OCCUPIES that future week for that pair, so a *genuine* challenge in it is refused
> until the parked row is deleted. On a box where testers challenge each other
> repeatedly this walks a few weeks into the future. Deleting the rows is the repair.

**The consequences are listed on screen while it is on**
(`ChallengeAnytimeNotice`, under the switch). That component is this section's copy at
the point of use, and every line in it is a statement about shipped behaviour that a
tester would otherwise meet as a bug report against themselves:

| What surprises a tester | Why it happens |
|---|---|
| a library that grew 12 cards they never sorted, and a deck they did not make | accepting materialises the contested set as `library` rows on BOTH accounts and creates the `vs <name>` deck (§ 3.3). The deck is dropped when that player finishes; an abandoned challenge leaves it on `/decks` |
| mastery moving during a test run | a challenge round is normal play — real typed marks, real minute points, real streak (§ 5.7) |
| a challenge dated weeks out | a repeat challenge is parked in the pair's next free week (above) |
| a friend who cannot accept, or cannot play | the hatch is spent PER REQUEST and is not attached to the challenge, so it covers the holder's own calls only. The other player's accept and their own rounds are judged against the real calendar unless they too are a validator with the switch on in their own browser — a two-sided test needs two validator accounts and two switches |
| Play buttons vanishing | switching it off puts a parked challenge's test window back in the future, so the server withholds `gameSequence` again. Submitted rounds are kept |
| "you're in 6 challenges" in a normal session | parked challenges still count toward the cap when the hatch is off |
| a challenge quietly becoming `no_contest` | on prod the hourly job resolves it once the parked week actually passes. Not installed on dev |

The **detail page carries no anytime banner** (removed 2026-09-01). It is only ever
reached from `/friends/challenges`, where the switch and the full notice above it are
the last thing the tester saw, so a second line restating "anytime is on" was noise on
the page that has the least room for it. The detail page still *behaves* differently
under the hatch — it re-fetches when the switch flips, because the flag changes what the
SERVER sends (`gameSequence` outside the window), which is what turns the round rows into
playable Play buttons. It no longer *renders* anything from `anytime`: the masthead's
status line, the page's only other reader of the flag, is gone (see § 5.4).

**Which calls carry it.** `src/api/studyChallenges.ts` appends it to every request in
one place, so no page has to remember. The one exception is the game-pool read, which
builds its own URL — `useChallengeRound` adds `anytimeQuerySuffix()` to `poolParams`,
without which a tester could open a round from the challenge page and then be refused
its board. That hook also mounts `useChallengeAnytime()` purely to keep the validator
latch current, so a game reached by direct URL still carries the flag.

⚠️ **A game must append `poolParams`, never re-spell `challengeId`/`gameId` itself.**
`poolParams` is the whole round identity *plus* the hatch, and a page that rebuilds the
first two by hand silently drops the third. Hydra Bubbles did exactly that in its
contested-word fetch (`HydraBubblesPage` → `fetchChallengeCards`) and 400'd
(`ValidationError: Your test window is not open`) on every out-of-window tester launch,
while the round itself resolved fine — fixed 2026-09-02 by adopting the same
`challengeParamsRef` pattern Bubble Match, Match Speed and Word Search use.

**The client mirrors the same rule in its labels.** `challengeAction`,
`challengeStatusLine` and `acceptLapsed` all take an `anytime` argument, so a row reads
*Take Test* rather than *See Cards* on a Tuesday. Both the list and the detail
page **re-fetch when the switch flips**, because it changes what the server sends —
which rows are expired, whether `gameSequence` is present at all — and not merely how
the client labels it.

---

## 3. Same-word challenge — choosing the 9 words

### 3.1 Candidate pool (server)

Given challenger `A` and challengee `B`, both in language `L`:

1. **Level band** — every discoverable word whose `difficulty` lies between
   `estimateLevel(A)` and `estimateLevel(B)` **inclusive** (order-independent: the band
   is `[min, max]`). Level comes from `StarterPacksService.estimateLevel`, the same
   estimate discover and provisional lending use.
2. **Exclude anything either player already knows.** Drop any word for which *either*
   user holds a vet row banded `Target`, `Comfortable` or `Mastered` **on the core
   bar**. Only `Unfamiliar` (or held-by-neither) survives.

   > **This whole feature is core-only.** The band that decides eligibility is the
   > core (recognition + production) utcm band from
   > [MASTERY_REWORK.md](./MASTERY_REWORK.md) — the reading and writing bars are
   > ignored everywhere in Study Challenge, which is consistent with the test being
   > made exclusively of recognition/production games (§ 5.1). A word a player has
   > mastered for *reading* is still a legitimate challenge word.
   >
   > Post-rework the band is a **service-layer compute**, not the old generated
   > `category` column, so the exclusion runs in the service over fetched rows (or via
   > the `compute_utcm_category`-equivalent SQL retained for the deploy window).

3. **Rank and take 10:**
   * **prefer** words that are in **both** players' libraries (`starterPackBucket =
     'library'`) and banded `Unfamiliar` for both — a word each of them independently
     sorted is a word each of them independently *chose* to learn, which is the
     strongest possible signal that the set is fair;
   * then by **commonality** (`frequencyScore DESC NULLS LAST`), the same ordering key
     provisional lending uses;
   * then `id ASC` as a stable tiebreak, so the same pair asking twice gets the same
     set.

   Note there is deliberately **no half-credit tier** for a word in only one player's
   library: that would tilt the set toward whichever player had sorted more, which is
   the opposite of what the preference is for.

**Supply exhaustion → widen the band, never refuse.** Two players at the same low level
with a lot of shared progress may not yield 10 candidates. The band then **widens
outward from the original `[min, max]`** — one difficulty level at a time in both
directions — until 10 candidates exist or the discoverable supply is exhausted. Same
philosophy as [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md): a challenge is never
blocked on a count. Widening is symmetric so it does not quietly become one player's
challenge; if the supply runs out entirely the challenge is issued with the short set
(and, being short, is worth fewer points to both sides equally).

**New players are never gated.** There is no minimum sorted-card count to issue or
receive a challenge. A player whose `estimateLevel` is still a cold-start guess simply
gets a band anchored at that guess; the "in both libraries" preference (step 3) finds
nothing and falls straight through to commonality, which is the right answer anyway — the
most common words are the correct challenge set for a beginner. Their filler comes from
step 5 of the ladder (§ 5.2), i.e. lent cards, which is precisely what lending is for.

This follows [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md)'s rule that nothing blocks on
card count, and it keeps the friend row's **Challenge** control from being mysteriously
absent — the ambiguity Q39 and the per-friend opt-out already threaten to create. The
accepted cost is that a beginner challenging a veteran in **same-word** mode will
probably lose badly; the honest fix for that is different-word mode, which exists for
exactly this mismatch (§ 8), not a gate.

**Past challenges are not excluded.** There is no "words we already contested" filter —
the candidate query never looks at past challenge word sets. It does not need to: a word
that stuck was banded up by the marks the test itself wrote (§ 5.7) and is excluded by
step 2 already, and a word that *didn't* stick is exactly the word that should come back.
The band filter is the memory. This keeps the candidate query dependent on one thing —
current mastery — rather than on challenge history, and avoids accelerating the
band-widening (above) for pairs who play every week.

The visible consequence is that a rematch can legitimately re-offer a word from last
week if neither player learned it. That reads as the system noticing, not repeating
itself.

### 3.2 Confirmation flow — a SHEET, not a page (changed 2026-09-01)

Both players run the **same** surface, at different times:

```
challenger:  [see 9 words] → mark any "I already know this" → replaced → Send    → PENDING
challengee:  [see their 9] → mark any "I already know this" → replaced → Accept  → ACCEPTED
```

**These states are not pages.** Issuing, waiting and answering are all decisions *about
a row* on the challenges list, so all three open the app's sheet over that list rather
than navigating away — `ChallengeSheet` + `ChallengePanel`, in three modes:

| mode | header | action bar |
|---|---|---|
| `issue` | Create Challenge · `not sent` | **Send challenge** |
| `waiting` | Waiting for Response · `waiting` | **Withdraw challenge** |
| `incoming` | Incoming Challenge · `incoming` | **Accept** / **Decline** |

Three things follow, none of which survived the routed page this replaced
(`ChallengeReviewPage`, and the routes `/friends/challenges/new/:friendUserId` and
`/friends/challenges/review/:challengeId` — all three deleted):

* **The list stays visible behind the scrim**, so the decision keeps its context.
* **Dismissing costs one tap with nothing to come back from.** The routed page needed a
  history `replace` on every terminal action to stop Back returning to a *Send* button
  for a challenge that was already sent; a sheet that unmounts has no such problem.
* **The header is persistent** — the pair's name, the state line and the state chip stay
  pinned while the words scroll, so a scrolled sheet never stops saying whose nine these
  are. The action is at the BOTTOM so the words can sit last, as the reference they are.

**`waiting` draws the identical grid with no strike affordance** — the set has been sent
and the other player may already be looking at it. That is the only difference in the
body, and it is expressed as "pass no `onStrike`", not as a second layout.

**Dismissing an invitation is not declining it.** Closing leaves it exactly `pending`
until its deadline; only the Decline button ends it (and keeps the pair's week, so the
next challenge is Monday). Withdraw, by contrast, deletes the row and frees the week
immediately.

**The sheet portals out of the page it is written in.** `ChallengeSheet` is rendered
inside `ChallengesPage`, which is inside `MobileTabScreen`'s scroll area — and that area
carries the edge-fade **mask**, which clips fixed-position descendants. Its bottom band
is transparent for the footer's height, so the sheet's pinned action bar was masked away
entirely: the sheet looked right and had no **Send** button (fixed 2026-09-01). It now
portals to `nearestOverlayHost` and holds `useHideFooter` while open, since the footer
bar paints above that host and covers the same strip. The same applies to
`ChallengeHelpPopup` (§ 5.4c).
Full rule: docs/MOBILE_TAB_SCREEN_LAYOUT.md § "Edge fade".

Code: `src/features/studyChallenge/ChallengeSheet.tsx` (the frame — local to this
feature; promote to `src/components/` if a second surface needs it),
`ChallengePanel.tsx` (the three modes), hosted by `ChallengesPage` → `panelTarget`;
`src/components/overlayHost.ts` → `nearestOverlayHost`.

* Marking a word **already learned** removes it and pulls the next word from the same
  ranked candidate list — the replacement runs through the identical logic, with every
  word already shown (and every word rejected) excluded.

  **One strike = one round trip = one swapped tile, on BOTH sides.** `POST
  /api/studyChallenges/strike` does the Mastered write and *then* draws the
  replacement (that order matters — drawing first would rank the struck word straight
  back in), and answers `{ replacement }`. The client splices that single word into
  the struck slot; it never re-fetches the list, so the untouched nine tiles do not
  re-render or reorder under the reviewer's thumb. The request carries the draw's
  context: `friendUserId` + `variant` when issuing, `challengeId` when reviewing, plus
  `exclude` — every word on screen plus every word struck this session. A `null`
  replacement means the supply is exhausted; the slot is dropped and the set ships
  short (§ 3.1), never refused.

  **The struck card fades out before the replacement lands** (added 2026-09-01). The
  fade starts on the confirming tap — not on the response — and the swap waits on BOTH
  the fade and the round trip (`CHALLENGE_STRIKE_FADE_MS`, started before the request
  and awaited after it), so a slow server adds nothing to the animation and a fast one
  never cuts it short. Without it the tile changed identity in a single frame, which
  read as a glitch rather than as one word being exchanged for another. The replacement
  carries a new `word1`, so it mounts as a fresh card and takes the grid's ordinary
  pop-in. A failed strike clears the fade and the original card returns.
  Code: `StudyChallengeService.strikeWord` → `drawReplacement`;
  `src/api/studyChallenges.ts` → `strikeChallengeWord`;
  `src/features/studyChallenge/ChallengePanel.tsx` → `handleStrike` (owns `fadingWord`);
  `ChallengeWordCard.tsx` → the `fading` prop; `challengeStyles.ts` →
  `CHALLENGE_STRIKE_FADE_MS`.
* **The words are drawn as the app's mini preview cards, not as text rows.** Both the
  confirmation sheet and the detail page's word set render each word through
  `ChallengeWordCard` inside the shared `MiniVocabCardGrid` — literally the same tile
  `MiniVocabCard` (decks) and `QuickMarkCard` (Quick Mark) draw, since all three take
  their face from `miniCardFaceSx` (`src/components/miniCardFace.ts`, extracted
  2026-09-01 after the three copies drifted apart), carrying the word +
  pinyin (always via `ForeignText`), the **English lead gloss**, the
  conversation-frequency badge and the icons8 icon. The English is not decoration: "do
  I already know this word" cannot be answered from the characters alone, because a
  learner may know a different sense of a word they recognise.

  **Striking is TWO TAPS on the card itself** (changed 2026-09-01). The first tap only
  SELECTS: the card fills with the mastered blue — the same ink the app uses for a
  mastered card everywhere else, which is exactly the claim about to be made — and
  raises one *Mark as known* pill over its bottom edge. The second tap, on that pill,
  commits. A strike writes Mastered immediately and permanently, so it must not be
  reachable by a single mis-aimed tap on a 92px thumbnail; two taps gives that
  protection without the permanently-visible *I know it* button this replaced, which
  printed the strike affordance nine times on a screen whose subject is the words and
  made every grid row reserve 32px it needed only while the set was editable. The pill
  is absolutely positioned and costs no layout. On the detail page the card takes
  neither handler and is inert — after accept the set is settled (§ 3.3).

  **The sheet carries no footnote about what a strike costs** (changed 2026-09-01). The
  small print under the grid — *"Marking a word known makes it Mastered on your own
  cards, permanently…"* — was removed: it sat below nine cards, so it was read after
  the decision it was warning about, if at all. What remains is the banner above the
  grid (*Tap a card to mark it as known*) and the two-tap gesture itself.
  ⚠️ **This is the one place the permanence was stated in words.** § 8.1 leans on the
  Mastered write being understood, and the honor-system argument assumes a player knows
  the cost of a false strike. If mastery data starts looking inflated, restating the
  consequence — on the confirm pill or in the banner, where it is read *before* the
  tap — is the first thing to try, ahead of a cap.
  Code: `src/features/studyChallenge/ChallengeWordCard.tsx`;
  `reviewWord.ts` (`ChallengeReviewWord`, the one shape a candidate and a stored word
  both collapse into); geometry in `challengeStyles.ts` → `challengeWordCardHeight` /
  `CHALLENGE_WORD_PILL_GUTTER`.

* **A rejection writes to that user's own card.** "I already know this" is a real
  statement about the learner's knowledge, so it does not stay inside the challenge: the
  word is promoted out of `Unfamiliar` on that user's account, which means it stops
  being offered — here, in discover, and in every future challenge — until their marks
  say otherwise.

  **It reuses the existing "already known" path rather than inventing one.** Discover
  already has this exact gesture: sorting a card into the Already-Learned bucket calls
  `coreMasteredTypedMarkHistory` (`StarterPacksService.sortCard`), which fills the
  **core** bar's two tracks 8/8 and leaves reading and writing at **0** — the learner
  is declaring they know the word, not that they can read or write it. A challenge
  rejection must do the same thing, through the same helper, for the same reason:
  two ways to say "I know this word" that produce two different card states would be a
  bug waiting to be discovered months later. It also means the write is idempotent and
  already understood by velocity, banding and the flp.

  Consequence worth stating plainly: a rejected word lands on **Mastered**, not
  `Target` — a strong claim from one tap, but it is the claim the app already lets
  learners make in discover, and the honor system (§ 8) is the accepted basis for it.
  If the user creates a vet row this way that did not exist before, it is created in
  the `library` bucket, exactly as an Already-Learned sort would.
* The challengee sees the set the challenger confirmed, and their own rejections
  reshape it. The **final** set is the one the challengee accepts; the challenger does
  not get a second veto. (Q7 — alternative is a round trip, which costs a day out of a
  one-week window and is probably not worth it.)

  **The accepted set is the set that was on screen.** The accept body carries
  `replacementWords` alongside `struckWords`, and the service honours the echo instead
  of re-drawing inside the transaction — re-drawing would swap words out from under a
  decision the challengee just made. It is a *verified* echo, not a trusted word list:
  every word is re-resolved against the det (`findEntryIdByWord`, language-scoped) and
  anything unresolvable, duplicated, or missing is topped up by a fresh
  `buildCandidateSet` draw, which is also what an older client sending no replacements
  falls back to. The issue path needs no echo: the candidate ranking is deterministic
  (both-chose, then `frequencyScore`, then `id`), so "the top ten excluding what I
  struck" rebuilds the shown list exactly. Code:
  `StudyChallengeService.acceptChallenge`; `AcceptChallengeBody`
  (`server/types/studyChallenge.ts`).
* No word may repeat within the set, and the set is exactly 9 (`CHALLENGE_WORD_COUNT`).

**There is no limit on strikes.** A player may reject all 12, and the 12 replacements
after that, indefinitely. No cap, no "you have 3 left" copy, no special state — the
mechanism polices itself, because **every strike writes Mastered onto the striker's own
card**. Reshuffling toward an easier set costs you a permanently inflated mastery record
and removes those words from discover and from every future challenge. The player who
games the picker is the only one harmed by it.

Two things this leaves the implementation responsible for:

* The replacement query re-runs per strike against an ever-growing exclusion list, so it
  must be **cheap and paged**, not a full re-rank of the candidate pool each time. It
  draws with `limit = 1` — one strike asks for one word, not for ten.
* The supply can genuinely run out for a determined striker; when it does, the
  band-widening rule (§ 3.1) applies exactly as it does at first build, and if even that
  is exhausted the set is short — the same graceful degradation, never a refusal.

⚠️ Worth watching after launch: the strike is one tap and its consequence (permanent
Mastered) is invisible at the moment of tapping. If mastery data starts looking inflated,
the fix is **clearer copy on the strike gesture**, not a cap.

### 3.3 On accept

Atomically, in one transaction:

1. flip the challenge row to `accepted`;
2. **materialise** the word set into **both** players' vet tables — any contested word a
   player does not already hold becomes a real vet row (`vocabentries_zh` / `_es`), in
   bucket **`'library'`**, so it can carry marks and be pointed at by `deck_cards`;
3. create the **temp deck** on each account (§ 4).

### Why `library` and not `provisional`

Accepting a challenge **is** the sorting decision. Both players saw all nine words, were
invited to strike any they already knew, and confirmed the rest — that is a stronger,
more deliberate act of choosing than a discover swipe, so there is nothing left for a
later "keep these cards?" prompt to ask. Handing them over as `provisional` would mean
asking the learner to re-approve words they had just explicitly approved.

It is also the cheap option: `'library'` rows are visible to **every** existing read, so
the challenge deck, All Cards, search, the flp and every game pool work with no clause
changes at all. A `'provisional'` choice would have forced bucket-blind challenge-deck
reads, and a third bucket value would have forced a decision at every call site of
`vetSortedClause` / `vetPlayableClause`.

Three consequences to hold in mind:

* **The words outlive the challenge.** The temp deck is dropped after the results week
  (§ 4) but the cards stay in the learner's library forever. That is the intended
  lasting value of a challenge — the deck was the container, the words are the point.
* **They leave the discover supply.** A sorted row is excluded from
  `StarterPacksService._fetchSupplyRows`, so a contested word is never also offered as a
  fresh sort card. Good: no double-offering.
* ⚠️ **Level feedback loop.** `estimateLevel` reads SORTED rows, so ten new library
  cards nudge a player's estimated level, which is the input to the *next* challenge's
  band (§ 3.1). Ten cards against a real library is small, but a brand-new learner doing
  weekly challenges is being levelled partly by their challenges. Worth watching; not
  worth pre-solving.

---

## 4. Temp decks

A challenge's word set is delivered to each player as a **deck** so every existing
surface — the flp, the games' collection selector, the collection view page — works
against it with no new plumbing ([DECKS_FEATURE.md](./DECKS_FEATURE.md) § 3).

A temp deck is a `decks` row carrying exactly **one** new column:
**`decks."editMode"`** (`'custom' | 'preset'`, default `'custom'`).

There is **no `challengeId` on `decks`.** The link runs the other way — the challenge
row holds its two generated deck ids (§ 9) — because a deck does not need to know why it
exists, and a column naming a foreign feature is not intrinsic to a deck. `editMode` is:
it describes what the user may do to this deck, which is a property of the deck itself.
It also generalises past this feature — any future generated set (a curated pack, a
weakness drill) is `preset` without a second flag.

| Property | User deck | Temp (challenge) deck |
|---|---|---|
| Created by | user | `StudyChallengeService` on accept |
| Renamable / deletable by user | yes | **no** |
| Card add/remove by user | yes | **no** |
| Counts against `MAX_DECKS_PER_LANGUAGE` (100) | yes | **no** |
| Lifetime | until deleted | **per player**: dropped the moment that player finishes the test, else at their window close (Monday 04:00 local) |

**Lifetime:** the deck exists for the *preparation*, not for the record. It appears on
accept, carries the player through the Tuesday–Thursday study days and into the test,
and is dropped **as soon as that player completes their third round** — its job is done
and leaving it on the decks list is clutter. A player who never takes the test loses the
deck when their window closes.

The drop is therefore **per player, not per challenge**: Alice's deck can disappear
Friday evening while Bob's is still live on Sunday. This falls out of the rule and is
correct — the deck is a personal study aid, not shared state.

Nothing meaningful is lost — deleting a deck never deletes a
card or a mark ([DECKS_FEATURE.md](./DECKS_FEATURE.md) § 1), the words stay on the
account, and the set itself is stored permanently in `study_challenges.words`, so
challenge history renders from the history table and never depends on the deck existing.
If a "study this old set again" action is ever wanted, it rebuilds a deck from history
rather than requiring one to have been kept.

**Pre-study is the point.** Between accept and Friday the deck is fully playable — flp,
any game, any drill. Both players get the same three days, so it is symmetric, and it
converts the competition into a reason to study. The test therefore measures
**preparation plus performance**, deliberately, not raw ability. No gating of games on
the deck before Friday: a player could study the same words from their library anyway,
so a block would frustrate without protecting anything.

**"Their own pool of deck slots" means exactly one thing: they do not detract from the
100.** There is no user-visible slot capacity to build — the count query behind
`MAX_DECKS_PER_LANGUAGE` simply filters to `editMode = 'custom'`. A learner in three
challenges still has all 100 of their own deck slots available.

Enforcement is one guard in `DeckService`: every mutation (`rename`, `delete`,
`setMemberships`, and the membership PUT) rejects a deck whose `editMode <> 'custom'` with
a `ValidationError`. Reads are unchanged, so a temp deck feeds the collection selector
and the collection view page exactly like any other deck.

### Where they render on `/decks`

`/decks` is four sections today ([DECKS_FEATURE.md](./DECKS_FEATURE.md) § 3.11:
study modes · Cards · Mastered · Decks). Challenge decks become a **fifth section,
placed immediately BEFORE the user's own `Decks` section** — generated sets above
authored ones, so the user's own decks keep a stable position at the bottom of the page
and a new challenge never shuffles them.

It renders the same `Spine` (`src/components/shelf/`) as every other set on the page
(the page's governing principle is that a built-in collection, a mastery bar and a user
deck are all just "a set of your cards"). Section header: **"Challenges"**. The section is **omitted
entirely** when the user has no active challenge deck, exactly as the `Mastered` section
is when no reading/writing goal is set.

**Each deck is named after the opponent — `vs Bob`** — because that is what the learner
actually remembers about a set of nine words.

**Duplicate names are allowed for challenge decks (Q30).** Two live challenges against
the same friend in the same language may both be called `vs Bob`; they are distinguished
by the challenge that owns them (§ 9) and, for the user, by the **friend's icon on the
deck spine**. The name is not the identifier.

> The glyph slot on a spine is its **foot row**, right-aligned opposite the count
> (`glyph`, a Material Symbols name — see [DECKS_FEATURE.md](./DECKS_FEATURE.md)
> § "Slots, and the glyph on the foot"). A challenge spine passes the deck's generic
> glyph today; wiring the OPPONENT's glyph there is the remaining work, and the
> `deckId → opponent` map below is what feeds it.

Rendering that icon needs a `deckId → opponent` map. Because `decks` carries no
back-pointer, the `/decks` payload builds it from the other side: it already loads the
user's active challenges to render the Challenges section, so it reads their
`presetDeckIds` and inverts them in memory. Active challenges are few (at most one per
friend), so this is cheap and needs no jsonb query.

⚠️ **This requires relaxing an existing index.**
`decks_user_language_name_uniq` (`database/migrations/141-create-decks.sql`) is a
plain unique index on `("userId", language, lower(btrim(name)))`. It must become a
**partial** index — `WHERE "editMode" = 'custom'` — so authored decks keep their uniqueness
guarantee (its stated reason still holds: two decks called "Food" are indistinguishable
in the add-to-deck checkbox menu) while generated challenge decks are exempt. Challenge
decks are safe to exempt precisely because they never appear in that menu: they cannot
be added to, so there is nothing to mistakenly tick. Dropping and recreating the index is
part of the same migration that adds `decks."editMode"`.

**There is no lock badge.** The restriction is expressed by the *absence* of controls:
no `+` on the section, no rename or delete on the deck's collection view, no add-to-deck
entry pointing at it. A lock icon would invite a tap that does nothing and would need
its own explanatory copy; a control that isn't there needs neither.

---

## 5. The test

### 5.1 Which games

Three games per test, drawn from the **Recognition** and **Production** tracks only —
reading and writing games are excluded ([MASTERY_REWORK.md](./MASTERY_REWORK.md) § the
mark-type table):

| Game | Track | Eligible |
|---|---|---|
| Bubble Match | recognition | ✅ |
| Match Speed | recognition | ✅ |
| **Hydra Bubbles** | recognition | ✅ (**since 2026-08-18**) |
| Word Search — **Pinyin** | production | ✅ (zh only) |
| Word Search — No Pinyin | reading | ❌ |
| Speed Reading | reading | ❌ |
| Memory Map | reading | ❌ |
| Practice Writing | writing | ❌ |

**The fourth game has landed, and the draw is now genuinely random.** When this section
was written there were exactly three eligible entries, so the draw had one possible
answer as a SET and the randomisation existed for games that did not yet exist. Hydra
Bubbles shipped on 2026-08-18 and entered the rotation with **no change to this
section's machinery** — which is the property the derivation was built for. A zh test
now draws 3 of 4; an es test draws 3 of 3 (Word Search is zh-only). It follows that:

* the eligible pool is **derived from the registry**, never listed by hand — a game
  qualifies iff its `markType` (or, for a moded game, the mode's `markType`) is
  `recognition` or `production` **and** it declares a `challengeScoring` spec (§ 5.4);
* the draw is **without repetition**, so no game is played twice in one test;
* if fewer than three qualify for a given challenge (see the language constraint
  below), the test is simply that many rounds — the format bends, it does not block.

Each new recognition/production game therefore enters the challenge rotation the moment
it ships, which is why § 5.4 makes `challengeScoring` a **mandatory** part of the
`GameDef` contract for those tracks rather than an opt-in.

The selection and the **order** are drawn once per challenge and stored on the challenge
row — **identical for both players**, same games, same sequence, because a score
comparison across different games is not a comparison.

Word Search being zh-only means an es-vs-es challenge has **two** eligible games today.
Same constraint, sharper, in cross-language challenges — § 8.

### 5.1b The game sequence is hidden until Friday (Q63)

`gameSequence` is drawn at **issue** time (§ 9) but is **not shown to either player until
their test window opens**. The invitation states the words and the format; it does not
state the games. Neither does the accepted-and-waiting state.

Why draw early but reveal late: drawing at issue keeps one draw shared by both players
and lets the pair be scheduled as a unit, while hiding it keeps the accept decision about
*the person and the words* rather than about game preferences. A visible sequence invites
declining because you dislike one game, which would quietly turn the draw into a veto.

⚠️ **This must be enforced on the server, not in the UI.** `gameSequence` must be
**omitted from the API payload** for any challenge whose window has not opened for the
requesting player — a client that simply declines to render it still ships the answer to
anyone who opens the network tab. This is the only field in the feature with a
time-gated visibility rule, so it needs an explicit note in the serializer.

Note this does **not** weaken pre-study (Q36): the deck is the preparation, and it is
fully playable in any game the learner likes all week. What is hidden is only which three
count.

### 5.1a Rounds are strictly sequential, one attempt each

Round *n+1* unlocks only when round *n* is finished, and **a finished round is final** —
no replay, no restarting the test. The player may leave between rounds and come back
(the test is a three-day window, not a sitting), and may pause mid-round (§ 5.8), but
they cannot re-roll a score — and since the claim model below, **they cannot re-roll one
by walking out of it either**.

This is what makes the running total in the between-games scoreboard (§ 5.5) mean
something: it is the real, committed score, not a provisional best-so-far. It also keeps
the async test structurally identical to the live one, which matters because live mode
(§ 7) is the same three rounds with a confirmation gate between them — if async allowed
replays, the two modes would be scored on different terms and no result would be
comparable.

The cost is accepted: a player who has one bad round carries it. That is what "a test"
means, and the three-day window plus the pre-study days (§ 4) are the compensating
generosity.

#### The attempt is spent at the FIRST MARK (claim model, 2026-09-02)

An unplayed round used to exist nowhere: it was written only when the run ended, so
**leaving a game mid-round left no trace and the round could simply be played again**.
Backing out of a bad start, or reloading the tab, was a free re-roll of a round that is
supposed to be one attempt.

It is now claimed the moment the player answers:

| Slot state | Meaning | Board issued? | Writable? |
|---|---|---|---|
| absent | not started | ✅ yes | — |
| present, `completedAt: null` | **CLAIMED** — spent, still being played | ❌ never again | ✅ score may still move |
| present, `completedAt` set | **FINAL** | ❌ | ❌ rejected (Q40) |

* **What arms it:** the first `hit` or `miss` — i.e. the first real flashcard mark the
  game writes. Word Search's hint (`use`) and the elapsed-time clock do not, on their
  own: opening a board, looking at it and backing out is not an attempt.
* **What it writes:** a full round row with `completedAt: null`. Every later mark posts
  the **cumulative** snapshot to the same slot, so the banked score tracks the run even
  if the app is killed without warning. Writes are coalesced (one in flight, ≥1.2 s
  apart) — lossless precisely because each is cumulative, and necessary because a round
  already writes one mark per answer against the global `writeLimiter`.
* **What ends it:** the run ending as usual, *or* the player leaving the game — Back, a
  footer tab, any route change, a tab close. Leaving finalises the round where it
  stands, scored as a loss (so an all-or-nothing survival bonus is forfeited, § 5.4).
* **Backgrounding is still just a pause** (§ 5.8). The round ends when the player walks
  out of it, not when the phone rings: the client listens for `pagehide` with
  `persisted === false`, never `visibilitychange`.
* **The Back arrow confirms first.** An irreversible scored exit on one silent tap is a
  trap, so an armed round asks ("Leaving now ends this round and banks the score you
  have"). The confirm is a courtesy on the deliberate exit, **not a lock** — a footer
  tab or a tab close cannot be intercepted and still finalise correctly.

Because the claim is a database row, none of this depends on the client behaving: the
server walks *presence*, not completion, when deciding which board to hand out.

Code: `src/games/runtime/useChallengeRound.ts` (arming, coalesced writes, exit
finalisation), `src/games/runtime/useGameBack.ts` (the confirm), `StudyChallengeService`
→ `submitRound` / `nextRoundIndex` / `hasFinished` / `completedRounds`,
`StudyChallengeDAL.recordRound`, `ChallengeRound` in `server/contracts/wire.ts`.

#### Server-side invariants

1. A round slot is writable only while it is **absent or claimed**. A `POST` naming a
   round that is already final is rejected, not upserted — one statement, one path
   guard (`StudyChallengeDAL.recordRound`).
2. Round *n+1* is refused until *n* is **present** — claimed or final. That stops a
   tampered client skipping to the last round. It deliberately does **not** require *n*
   to be finished: a round whose app was killed mid-run stays claimed forever (its board
   can never be re-issued, so nothing can finalise it), and demanding completion would
   lock a player out of the rest of their test because of a crash. Presence is also the
   test `nextRoundIndex` and the round list on the challenge card use, so all three
   agree on which round is next.
3. `startedAt` is preserved across writes by the DAL, so a later write cannot backdate a
   claim.
4. A claimed round does **not** finish the test (`hasFinished` requires `completedAt`),
   or the challenge would resolve out from under a live game. It **does** count toward
   the player's total, so abandoning is never cheaper than finishing.
5. A claimed round is **withheld from the opponent** (`completedRounds`), or the reveal-
   per-round rule (§ 6) would let one player watch the other's score climb mark by mark.
6. **The window-close cron is deliberately looser.** `expire-study-challenges.sql`
   pass 2 counts round KEYS and sums every stored score, so an abandoned claim counts as
   a played round and its points count. That asymmetry is the point: mid-test a live
   round must not resolve the challenge, but once the window has closed nothing is live
   and every spent attempt should be scored. The cron needed no change for this feature.

No migration: `rounds` is jsonb, and every row written before this shape has a non-null
`completedAt`, so they all read as final.

### 5.2 Provisional mode: `mastered-first`

Games already lend cards when the pool is short
([PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md)). A challenge round plays against a
10-card temp deck, so **every game will be short** and will lend heavily. Today's
lending picks by nearest level then commonality (the **`default`** algorithm).

Challenges need a second algorithm, so provisioning becomes a **mode** passed down from
the surface:

| Mode | Fill order | Used by |
|---|---|---|
| `default` | nearest level → commonality → id | everything today |
| `mastered-first` | descend the player's own utcm bands — **Mastered → Comfortable → Target → Unfamiliar** — and only then fall back to `default` lending | study challenge |

**The full ladder.** `mastered-first` is not "mastered, else lend"; it is *exhaust the
player's own cards, hardest-known first, before borrowing*:

1. **Mastered** — most recently mastered first (`masteredAt`, migration 142)
2. **Comfortable**
3. **Target**
4. **Unfamiliar** (still the player's own sorted cards)
5. **`default` lending** — provisional rows, only when the player's whole library is
   exhausted

Within each band the order is the same as `default`'s tiebreak (commonality, then id).
The contested 12 are removed from the pool first, so a contested word can never also
appear as filler. A player with a real library never reaches step 5; a brand-new player
(Q47) reaches it immediately, which is exactly the never-block behaviour
[PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) already guarantees.

Descending the bands rather than jumping straight to lending matters because filler
should be **the player's easiest available material**, and the player's own Unfamiliar
card — one they chose to sort — is still more familiar than a word the server lent them
sight-unseen.

`mastered-first` exists so the filler is *not* a source of difficulty: a challenge is
meant to measure the 12 contested words, and padding the board with words the player
has never seen would add noise (and, worse, would reward whoever got luckier filler).
Filler the player already owns is near-free points for both sides — which is why filler
is worth **20 points instead of 100** (§ 5.4). **Hydra Bubbles is the exception at both
ends**: its filler is not `mastered-first` (§ 5.2's own exception, below) and pays **0**
rather than 20, because there it was farmable rather than near-free.

The mode is a parameter on `ProvisionalCardService.ensureBaseline` / `lendCards` and
travels on the pool request as `?provisionMode=`. Every step degrades silently to the
next, so no caller ever has to check whether a player has mastered cards.

**All 9 contested words must appear in every round.** Filler pads the board out to the
game's natural size; it never displaces a contested word.

> ✅ **WORD SEARCH'S CHALLENGE BOARD IS NOW THE ORDINARY BOARD (2026-08-28).** History:
> the challenge board was built on 2026-08-22 at **8×8** while `TOTAL_WORDS`
> (`src/games/word-search/constants.ts`) summed to 10 on a 9×6 grid, because twelve
> words at the 4-character cap is up to 48 characters and random placement would
> almost never fit that densely; `TOTAL_WORDS` then rose to 12 on 2026-08-23, matching
> the count but not the size. On **2026-08-28** both counts dropped to **9** and the
> ordinary board shrank to **7×6**, which removed the pressure the split existed to
> relieve: 9 words × 4 cells = 36 of 42 cells (86%) on either board. So
> `WORD_SEARCH_CHALLENGE_ROWS/COLS` were **deleted** — one size, one density, one
> tuning, and a challenge board is now template-eligible like any other (see
> docs/WORD_SEARCH_GAME.md § 1c). A challenge round still takes its target LIST from
> `CHALLENGE_WORD_COUNT` (the specific contested ids), not from `TOTAL_WORDS`; the two
> 9s are separately declared and neither derives from the other. Bubble Match (20) and
> Match Speed (rolling buffer) are unaffected. This is what makes the
contested ceiling of 900 points real in all four games and what makes the rounds
comparable to each other — a game whose natural board is smaller than 9 must run
longer in challenge mode rather than drop words. The one deliberate exception is Match
Speed, whose rolling buffer expresses this as an alternation rule instead (§ 5.3), and
whose alternation lapses to filler only once **all 12 have been dealt**.

**Vocabulary (settled).** The cards a challenge game pads with are not "provisional" in
the lending sense — they are usually the player's own mastered cards. So:

| Term | Means |
|---|---|
| **contested** | one of the challenge's 9 words — what the challenge is actually measuring |
| **filler** | every other card on the board, whatever its origin |
| **provisional** | reserved for its existing meaning: a card the server *lent* (`starterPackBucket = 'provisional'`) |

Filler is often provisional and often not; the scoring tables below key on
**contested vs filler**, never on the bucket.

### 5.2a How a round is actually served (BUILT 2026-08-22)

The whole test — four games, three rounds, one score — runs through **one gate and one
assembler**, with no challenge-specific endpoint anywhere.

```
 ChallengeDetailPage  ── Play ──▶  /games/<game>?challengeId=&round=&gameId=&mode=
        │                                        │
        │                              useChallengeRound (client)
        │                                        │  poolParams
        ▼                                        ▼
  challengeLaunch.ts                GET /api/onDeck/gamePool?challengeId=…
  (route + nav state)                            │
                                    StudyChallengeService.getRoundContext   ← THE GATE
                                                 │  (round, game, words, vet ids)
                                                 ▼
                                    OnDeckVocabService.getChallengeGamePool ← THE BOARD
                                                 │  contested + mastered-first filler,
                                                 ▼  SHUFFLED
                                            the game's normal board
```

**The gate — `StudyChallengeService.getRoundContext`.** Three facts a client cannot be
trusted with, all resolved server-side:

| Fact | Rule |
|---|---|
| WHICH round | **Derived**, never taken from the caller: the first unplayed one. `?round=` in the URL is display only. A tampered client therefore cannot replay a good round or skip to the last one |
| WHICH game | The caller STATES its `(gameId, mode)` and it must equal the drawn sequence entry. Without this a player could play whichever game they are best at, three times |
| WHEN | The player's own test window must be open. This is what stops the board read leaking the sequence the payload withholds until Friday (Q63) — a board IS the sequence, one round at a time |

It also **re-materialises** the contested words on every board read (`ensureLibraryEntry`,
idempotent), because `vocabEntryId` is a convenience pointer that may dangle: a player
who deleted a contested card during the study week still plays it (Q54).

**The board — `OnDeckVocabService.getChallengeGamePool`.** The contested rows are
addressed by id **with the cooldown ignored** (all nine appear in every round — an
obligation, not a preference), then `ProvisionalCardService.getFillerPool` tops the board
up to *the game's own size* down the `mastered-first` ladder. The board size is the sum
of the game's requested distribution, or its `need` on a refill — the nine are **added
to** the board's normal composition, never a cap on it.

⚠️ **The result is SHUFFLED, and that is a correctness requirement (Q74).** Returning the
nine first would let anyone read the split straight off the payload or off the deal
order. Games classify by WORD, against the set they already hold, never by position.

**The client — `src/games/runtime/useChallengeRound.ts`.** Every eligible game mounts it
unconditionally and is otherwise unchanged; for an ordinary launch every method is a
no-op and `isContested` always answers false, so no game grew an `if (challenge)` branch
around its own logic. A game does exactly four things:

1. appends `poolParams` to its existing pool request;
2. calls `emit()` where it already calls its mark function, tagging the event with
   `isContested(entryKey)`;
3. calls `finish(won)` where its run ends;
4. renders `<ChallengeRoundScoreboard>` in place of its own end-of-run popup.

The hook owns the accumulator and the active-time clock. That is what makes § 5.6's
one-accumulator rule structurally true rather than a convention, and it is why four
games cannot drift into four readings of the same spec.

**Per-game notes.**

| Game | What its board integration needed |
|---|---|
| **Bubble Match** | Nothing but the pool params and the events — plus one new stage signal, `onCeilingDrop`, because the survival bonus starts the instant the ceiling begins descending and only the stage knows when the launcher drained |
| **Match Speed** | The alternation rule (§ 5.3), extracted as the pure `challengeDeal.ts`. Mid-run buffer top-ups send `&contested=exclude` — the nine are dealt once and never recycled |
| **Word Search** | **The same board as a casual run** since 2026-08-28 — 7×6, 9 words, template mode when it applies (the separate 8×8 challenge grid was deleted; see § 5.2). Its target list is still `CHALLENGE_WORD_COUNT`, not `TOTAL_WORDS`, because the actual set is the specific contested word ids, not a band distribution. Filler is queued at **twice** the board so the substring de-dup pass has something to substitute WITH — otherwise a set that shares characters fails as `insufficient-distinct`, i.e. a round the player cannot play at all. Challenge boards are never saved to the resume slot |
| **Hydra Bubbles** | Contested words ride the **bloom** slot, drawn ahead of that buffer's stock; the run ends on the last contested clear (`shouldEndRun` → outcome `challengeComplete`), which is also the `won` that decides its clear bonus. It arms that bonus with a `survivalStart` event at t=0 rather than on a board signal. **Its filler is deliberately NOT `mastered-first`, and pays 0** — see below |

⚠️ **Hydra is the one exception to § 5.2's filler rule, on purpose.** Its filler comes
from its own colour buffers, whose bands ARE the payout ladder
([HYDRA_BUBBLES.md](./HYDRA_BUBBLES.md) § 5): a board padded entirely from the player's
mastered cards would be a board of nothing but bloom, which is not the game. So a Hydra
round draws only the contested set from the challenge and leaves the economy untouched.
Its difficulty comes from the challenge SHAPE (clear all nine, a wrong match ends the
run) rather than from filler selection.

**Background pause came back with it.** Hydra deliberately had none — nothing in a
free-play run advances on its own — but a challenge round is scored on time to clear, so
that variant is genuinely timed and falls under the app-wide rule
([GAMES_FEATURE.md](./GAMES_FEATURE.md) § Backgrounding pauses the clock). It is armed
for challenge rounds only.

### 5.3 Match Speed's alternation rule

Match Speed deals from a rolling buffer rather than a fixed board, so it needs an
explicit challenge mode: **every other pair filled must be a contested (non-filler)
pair.** With 12 contested words and a 30-second run this keeps contested words on the
board continuously without letting the board become 100% contested (which would
exhaust the set in the first few seconds).

**When the contested words run out mid-run, the alternation lapses and the rest of the
run is filler.** Contested words are **not** recycled back into the buffer.

**Built as `src/games/match-speed/challengeDeal.ts`** — a pure module beside
`cardBuffer.ts`, with the rule's four awkward cases pinned by
`src/games/__tests__/challengeDeal.test.ts`: parity is counted over pairs dealt in the
RUN (not per refill call, or every refill's first slot would be contested and the set
would be gone in seconds); either source may run dry and each slot falls through to the
other rather than leaving a hole; a drained set never comes back; and a run whose
buffer is starved deals contested pairs rather than nothing.

The consequence is deliberate and worth stating: Match Speed's contested scoring has a
hard ceiling of **900 points** (9 × 100), and a player who clears the set early spends
the rest of the run earning 20s. That makes *clearing the set* the goal of the round
rather than raw taps-per-second — the challenge is a measure of the nine words, so once
those nine are answered the round has already said what it was built to say.

It also means the two players' Match Speed scores converge near the top of the range,
which is the intended shape: past a certain point the round stops separating them and
the other two games decide the match.

### 5.4 Scoring

Every recognition/production game is henceforth **required** to expose a study-challenge
scoring spec. This is a registry-level contract, not a per-game afterthought:

> **⚠️ Where the specs physically live, decided at build time (2026-08-17).** The numbers
> are in **`server/contracts/wire.ts` as `CHALLENGE_GAMES`**, not in
> `src/games/registry.ts`, because **the server draws the game sequence** (at issue,
> § 5.1b) and the registry imports lazy React components the Node build cannot load —
> and live mode must score the same events server-side with no game page mounted (Q76).
> `GameDef.challengeScoring` remains the per-game declaration point and is populated by
> lookup, and a registry test must fail when a recognition/production game has no
> `CHALLENGE_GAMES` entry. That test is what preserves "derived from the registry, never
> hand-listed" — it is **owed by the games step and not written yet**.

```ts
// src/games/types.ts (proposed)
interface GameDef {
  …
  challengeScoring?: ChallengeScoringSpec;   // required for recognition/production games
}
```

Per-game rules as specified:

**Match Speed**

| Event | Points |
|---|---|
| contested match | **+100** |
| contested mistake | **−100**, charged **at most once per foreign word** |
| filler match | **+20** |
| filler mistake | **−20**, same once-per-word rule |

**Bubble Match**

| Event | Points |
|---|---|
| contested match / mistake | **+100 / −100** (once per foreign word) |
| filler match / mistake | **+20 / −20** |
| survival bonus | **+500** the moment the ceiling starts dropping, decaying **−100 every 2 s** (floor 0) |
| bonus if the run is **lost** | **0** |

> **The bonus is deliberately large and deliberately all-or-nothing (Q68).** At up to
> +500 against +900 for nine contested matches, surviving is worth more than a third of the
> round, and losing forfeits it entirely. That is not an imbalance to tune away: Bubble
> Match *is* a survival game, and a challenge score that ignored whether the player
> survived would be scoring a different game than the one they played. The cliff is also
> what makes the last thirty seconds tense, which is the reason to draw this game at all.

**Hydra Bubbles**

| Event | Points |
|---|---|
| contested match | **+100** |
| contested mistake | **−100** (ends the run, so at most one is ever charged) |
| filler match | **0** — the one game where filler pays nothing |
| filler mistake | **−20** (also ends the run) |
| **clear bonus** | **+300** for clearing all nine, held flat for the first **1:00** of active time, then decaying **−25 every 15 s** to a floor of 0 at **4:00** |
| clear bonus if the set is **not** cleared | **0** — forfeited entirely |
| survival bonus | **none** — an endless run's survival time is unbounded and would swamp every other term |

> **Why the clear bonus is gated on completion (O2, resolved 2026-09-02).** § 7.5 has
> always said a Hydra round is scored on *time to clear*, and until now nothing scored
> time at all. It could not be done naively: a run ends either because the player
> finished or because they erred, so a per-second penalty charged to every run pays
> players to **fail fast** — a wrong match at 0:30 posts a better clock than a clean
> 9-of-9 at 4:00, and finishing takes longer than quitting *by definition*, so no choice
> of rate fixes the sign. Gating the term on completion means it only ever compares runs
> that are actually comparable: everyone holding it cleared the same nine words. It also
> cannot invert the word ranking — a complete run is `900 + bonus ≥ 900` and the best
> possible partial is `800 − 100 = 700` — so the pot's size is purely a statement about
> how much speed should separate two finishers. 300 against 900 puts it in the same
> register as Bubble Match's 500.
>
> **The numbers are a first guess and the grace is why that is safe.** Nothing stores a
> round's duration (only `completedAt`), so there is no telemetry on real clear times. A
> flat first minute means a decay rate guessed too aggressively cannot *punish* a fast
> run, only fail to separate it. Revisit once real rounds exist.

> **Why filler is zero here and 20 everywhere else (changed 2026-09-02).** Filler is
> meant to be near-free points that cannot decide the match. In Hydra it could: the run
> ends on the LAST contested clear and nothing charges for time, so a player who cleared
> eight of nine and then farmed filler bubbles outscored one who finished cleanly and
> fast — and overflow forfeits nothing, so the farm risked only a wrong match. The
> mistake value deliberately stays negative, because a filler clear is not optional
> (draining is how the board is kept off the ceiling): filler is now pure risk rather
> than inert. The consequence is that a Hydra round total **is** its contested ledger —
> always a multiple of 100 minus any miss — and that two clean 9-of-9 runs now tie at
> exactly 900, which is O2 (`docs/HYDRA_BUBBLES.md` § 11) with nothing left to hide it.

**Word Search (Pinyin)**

| Event | Points |
|---|---|
| contested match | **+100** |
| filler match | **+20** |
| time penalty | **−10 per second** after 1:00 elapsed |
| hint used | **−20 each** |

> **Why Word Search gets the contested/filler split too**, despite the original spec
> stating a flat 100: its grid needs words with **mutually distinct characters**
> ([WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md) § 2), and an arbitrary contested set
> will not reliably satisfy that. The generator substitutes, so filler *does* reach a
> challenge grid — and at a flat rate a player whose set forced four substitutions is
> paid full price for four easy words. When the whole set places cleanly the split is
> invisible, so it costs nothing and covers the case that will actually occur.

Notes and open items:

* Can a game's score go **negative**? **Yes** — per-game scores are not clamped and the
  running total may go negative. Clamping would make mistakes free for whoever is
  already at the floor, which is precisely the player most likely to keep making them.
* Word Search's penalty is **time-based**, so it must honour the existing
  popups-pause-the-clock rule ([GAMES_FEATURE.md](./GAMES_FEATURE.md)) — otherwise
  reading a pre-round notice costs the player points.
* "Only deduct 100 once per Chinese word mismatched" means a per-run set of
  already-penalised words, keyed by the foreign word (not the card id, so es and zh
  behave identically).
* The bonus decay is **wall-clock from the moment the ceiling starts dropping**, and
  must respect the existing "popups pause the clock" rule
  ([GAMES_FEATURE.md](./GAMES_FEATURE.md) § Popups pause the clock) — otherwise reading
  a provisional notice costs you 100 points.

### 5.4b View Challenge is TWO pages — once there are two sides to read (built 2026-09-01)

A challenge has two players, so `/friends/challenges/:id` makes **the test** two
horizontally-swipeable pages, with dots under them saying which you are on:

| page | whose | ink |
|---|---|---|
| 1 | yours — the test card with Play buttons and per-round scores | blue |
| 2 | theirs — the same card, read-only (a banked round's score, else `not done`) | red |

⚠️ **Only the per-side blocks are inside the pager** (narrowed 2026-09-01, narrowed
again 2026-09-02). The pager now holds `yourTest` / `theirTest` — **`ChallengeTestCard`
alone**. (Two other blocks sat here and no longer do: `ChallengeTotalCard`, deleted
2026-09-02 — see the removal note below — and the masthead, hoisted above the pager
2026-09-02, next paragraph.) `sharedFooter` — the **"How to study this deck" button and
the nine word cards** — is identical on both sides, so it renders ONCE, below the dots,
outside the scroller. Swiping used to move two identical columns of word cards past the
reader, which made the gesture read as though it had done nothing. The rule to keep:
**a block goes in the pager only if it differs by side** — and, since 2026-09-02, only if
it differs by side *enough to be worth animating*; anything shared belongs above the
masthead line or under the dots.

⚠️ **The masthead does NOT swipe, and no longer says whose side you are on**
(2026-09-02). One `ChallengeDetailHeader` sits above the pager as `masthead` in
`ChallengeDetailPage`. Both copies said "vs <name>" and differed only in the eyebrow's
rule and kicker, so sliding one out and a near-identical one in read as a stutter, not a
page turn — it was first hoisted out of the pager and re-inked in place from `page`, then
the eyebrow was **removed outright**. `ChallengeDetailHeader` takes no `side` prop any
more: the component is the title alone, identical on every state of the page (the two
pager pages, the one-page study state and the resolved results screen), and the ownership
ink now lives only where it is attached to content — the test card and the pager dots.

* **Same layout on both pages**, which is what lets a reader compare them without translating
  between two designs. **The colour is the whole ownership mark** — red here is NOT a
  warning and must never acquire warning semantics on this page.
* **Page 2 fills in round by round** — see the § 6 reveal rule. Their unplayed rounds are
  simply *not done*; a round in progress is never visible.
* ⚠️ **During the STUDY days it is ONE page, with no pager and no dots** (2026-09-01).
  Before a window opens neither player has a `gameSequence`, let alone a submitted round,
  so page 2 would hold a header, an empty test card and nothing else — and the dots would
  advertise it. The gate is `showOpponentPage` in `ChallengeDetailPage`:
  `!studying || Object.keys(opponentRounds).length > 0`. It asks whether **their side has
  anything on it**, not what day it is, because the two players' windows are their own
  (§ 2) — an opponent far enough east can be submitting rounds while this viewer is still
  studying, and their page appears for that viewer the moment one lands.
* **Once the challenge resolves the two pages collapse into one.** `complete` and
  `no_contest` render the results screen (§ 6) as a single scroll: verdict on top, then
  both players' cards. Keeping the swipe would ask the reader to page back and forth to
  make a comparison the verdict has already made.
* ⚠️ **The dots are BUTTONS** (2026-09-01). A native scroll-snap container is pannable
  by finger and by trackpad and by nothing else — a mouse drag does not scroll an
  overflow container in any browser — so a pager whose only control is the gesture is
  unreachable with a mouse, and page 2 simply does not exist for that reader. Tapping a
  dot calls `goToPage`, which scrolls the pager; the dots still do not OWN the position
  (see below), so a tap and a swipe cannot disagree. They remain the keyboard and
  assistive path, which a gesture can never be.
* ⚠️ **Mouse drag on the pager is wired up by hand** (2026-09-02). Reported as "card
  swiping doesn't work on desktop": the dots worked, but grabbing a test card and pulling
  it sideways — the thing the page's whole shape invites — did nothing. `ChallengeDetailPage`
  now calls the shared `useDragScroll(pagerRef, { paged: true })` (`src/hooks/useDragScroll.ts`),
  which adds mouse panning to a scroller. Two things are specific to a PAGER and are what
  the `paged` option buys: mandatory scroll-snap has to be **parked** (inline
  `scrollSnapType: none`) for the length of the drag, or the browser re-snaps mid-gesture
  and the card never follows the cursor; and with snap off nothing settles the release, so
  the drag commits itself — past `PAGE_COMMIT_RATIO` (25%) of a page it turns, otherwise it
  springs back — then re-arms snap after the smooth scroll has landed (`SNAP_RESTORE_MS`).
  The hook's capture-phase click swallow keeps a drag that ends over a Play button from
  also launching a round. Position is still read only by `handlePagerScroll`.
* The pager is a native `scroll-snap` container and the dots **follow** it (reading
  `scrollLeft` on scroll) rather than driving it — the platform already owns the physics,
  and a `currentPage` state would have to be kept honest against a gesture in flight.
  `touchAction: "pan-x pan-y"` is the required opt-in (CLAUDE.md "Touch & Scroll") —
  ⚠️ **and it is not sufficient on its own**. `touch-action` is intersected down the
  ancestor chain, so `MobileTabScreen`'s `pan-y` overruled the pager's `pan-x` and the
  swipe did nothing at all (found 2026-09-01, in the test state where the second page
  first has content). The page therefore also passes `horizontalPan` to `NodePage`,
  which widens the scroll area. See MOBILE_TAB_SCREEN_LAYOUT.md.
* ⚠️ **The dots sit BETWEEN the pager and the shared blocks** (2026-09-01). They are
  directly under the thing they page and directly above the first block that does NOT
  move, so their position states where the swipe's reach ends — as the masthead above
  the pager now states where it begins. This only works because
  the pager is now the test alone: an earlier version had the study button and the nine
  word cards inside page 1 — ~1100px — and dots placed after it were permanently below
  the fold, the only affordance for a page nothing else hints at, itself hidden. (They
  were briefly moved *above* the pager for that reason; narrowing the pager fixed the
  cause instead.) The active dot also **stretches** as well as changing ink, because at
  7px a colour change alone is easy to miss.

⚠️ **The word grid has no heading** (2026-09-01). Every state ends with the nine words
as the confirmation sheet's mini cards, minus the strike — but the "The 9 words" caption
above them is gone. The cards ARE the caption: nine word cards under a challenge cannot
be anything else, and the label spent a line of the first screen restating them while
counting a number the reader cannot act on. The grid keeps its class names
(`challenge-detail-page__words`, `__word-grid`), so the section is still addressable.

**The page masthead** (`ChallengeDetailHeader`, 2026-09-01; hoisted out of the pager
and stripped to the title 2026-09-02). `NodePage`'s own header
names the SCREEN ("View Challenge") and has no subtitle slot, so the challenge names
itself in the body: "vs <name>" at `SIZE.heading`, and nothing else. It replaced a
body-sized line that read as a caption for the card beneath it. It used to carry a
coloured rule + mono kicker (YOUR CHALLENGE / THEIR SIDE) above the name; that side
indicator was removed because the test card directly beneath it already carries the same
blue/red ownership ink and names the player, and the pager dots already say which page
you are on.

⚠️ **The masthead is a NAME, with no subtitle at all** (2026-09-01). `ChallengeDetailHeader`
has no `statusLine` prop any more — and, since 2026-09-02, no `side` prop either:
"vs <name>" is the whole component.
It printed two lines, and each restated the test card immediately beneath it:

| side | the line that was there | what already says it |
|---|---|---|
| yours | `challengeStatusLine` — "Round 2 of 3 · closes 4 AM Sunday" (or "· anytime") | the numerals down the card's left edge draw the round count; the card's head carries the close date |
| theirs | "<name> is still playing — their rounds appear as they submit them" | every unplayed round on their card already reads **not done** |

`challengeStatusLine` itself is **not** deleted: the challenges LIST row still calls it,
and there it is the row's only description. This is the second removal in the same
direction — the study-days line went first, for the same reason — so take it as the page's
rule: **the masthead names the side, the card states the state.**

**The two cards these pages are built from**, both reused by the results screen:

* `ChallengeTestCard` — one component, two inks. The **absence of `gameSequence` is the
  gate** (§ 5.1b), so it renders nothing playable before Friday with no date check of its
  own; do not add one. Round badges are **Roman** numerals because every other number on
  the card is a score. A banked round's score **replaces** its Play button, which is what
  makes "submitted is final" legible without a word of copy.
  ⚠️ **No "on deck" tag** (removed 2026-09-01). The row's mono sub-line carries the game
  MODE and, for a banked round, `submitted` — nothing else. The playable round used to add
  "· on deck", but it is already the only fully-lit, shadowed row on the card AND the only
  one carrying a Play button, so the words were a third telling of a state that cannot be
  missed. `submitted` stays: a banked round has lost its button, so its filled numeral
  would otherwise be the only signal.
  The heading is a fixed label — **"Test"** on your side, "Their Test" on theirs
  (2026-09-01). It used to swing "Test Time" → "Test Done", and before the window
  opened it read "Test Time" over a body saying the test opens Friday. The state is
  already told by the page chip, the numerals filling in down the left edge, and each
  row's own Play / score / lock; a fourth telling could only add a way to disagree.
  **Before the window opens it shows exactly one date and no count** (2026-09-01): the
  body reads "Your test opens 4 AM Friday." and the head's "closes …" is withheld until
  there is a sequence. It used to add "· 3 games, the same ones for both of you", which
  invited the one question the card exists to withhold (*which* three) and put a second,
  later date on a card its reader cannot act on — and the later of two dates is the one
  that reads as the deadline.
  ⚠️ **Both sides print a round's score** (2026-09-02). Their side used to read
  `submitted` / `not done` in the slot yours puts a score in, because their figures were
  itemised on the total card below. With that card gone the slot carries the subtotal on
  both sides — which is also what makes the two pages comparable at a glance, since the
  banked figure sits in the same place on each. `not done` still stands in for a round
  they have not played.

#### ⛔ `ChallengeTotalCard` is DELETED (2026-09-02)

The charcoal card that sat under the test card — a grand total over every round with each
scoring RULE itemised beneath it — **no longer exists**, on View Challenge or anywhere
else. Do not re-add it. The reasoning, so it is not rediscovered as a gap:

* **The rule-by-rule breakdown belongs to the moment it was earned.** It is still
  rendered, once, by `ChallengeScoreTable` on the game-finish screen (§ 5.5), where the
  reader has just played the round the lines describe. Re-showing it days later on a page
  whose job is "where does this challenge stand" is a level of detail nobody re-reads.
* **What a returning player wants is the per-round subtotal**, and `ChallengeTestCard`
  already had a slot for it on every row.
* **The grand total was never the page's only copy** — the results crest (§ 6) states both
  totals and draws the ratio bars.

The stored `breakdown` jsonb is UNCHANGED and still shipped on every round (§ 5.6); only
the second surface reading it went away. `roundsTotal` / `signedPoints` in
`challengeLabels.ts` both remain in use (the crest and `ChallengeScoreTable`).

### 5.4c The two stepped explainers (F20/F21)

Two overlays, ONE component (`ChallengeHelpPopup`), so they read as one system:

* **"How to study this deck"** — the orange button during the study days. It does NOT
  launch play; it teaches a **filter**. Every surface it names already exists and the
  learner has used them — what they do not know is how to point one at exactly these nine
  cards. Hence an overlay, not a page.
* **"How the test works"** — behind the test card's info button. These three rules used
  to sit as fine print under the round list; they moved because they are read once and
  then never again, while the round list is read every time.

Neither remembers being read: no "seen" flag, no auto-open. Both are behind an explicit
control, so a learner who wants them twice gets them twice.

Each step pairs a screenshot with its instruction — the image is part of the
instruction, since a sentence naming a surface the reader has never opened teaches
nothing. Steps and their shot filenames live in `challengeHelpSteps.ts`; the files go in
`src/assets/challengeHelp/` (see the README there) and are picked up by
`import.meta.glob`, so adding a step is a data change plus a dropped file. **A step whose
file does not exist yet renders a labelled placeholder frame**, which is why the
explainers are usable before the screenshots are captured.

### 5.5 The between-games scoreboard

After **every** game in the test, the player sees a breakdown card:

```
   ROUND 2 · BUBBLE MATCH
   contested matches      7 × 100     +700
   contested mistakes     2 × −100    −200
   filler matches         5 ×  20     +100
   survival bonus                     +300
   ───────────────────────────────────────
   this round                          900
   previous rounds                   1 240
   ═══════════════════════════════════════
   TOTAL                             2 140
```

Every line item is derived from the same `ChallengeScoringSpec` the game scored with, so
the breakdown can never disagree with the number. In **live** mode this card also shows
the opponent's breakdown side by side and both players must confirm to advance (§ 7).

In **async** mode this card shows only the player's own numbers — still true after the
§ 6 reveal change, and now a deliberate choice rather than a consequence: the opponent's
submitted rounds ARE available, but the moment a round is banked, mid-test, is the wrong
moment to hand someone a comparison they cannot act on. Their figures live on page 2 of
View Challenge (§ 5.4b).

**Built as `src/games/runtime/ChallengeRoundScoreboard.tsx`** (2026-08-22), rendered by
each game in place of its own end-of-run popup.

**It is a FULL-BLEED DARK BOARD, not a popup card** (changed 2026-09-01). It used to
render through `GameEndPopup`, which put a light card over a still-visible board. That
was wrong twice: the board behind it belongs to a round that is now scored and final, so
showing it invites a player to look for something to do with it; and a card sized for a
two-line "you won" cannot give a six-line itemisation room to read as a scoreboard.
Being its own surface is also what lets the TOTAL be the largest thing on screen, which
is the one number the round was played for. Negative lines are **not** painted red here
(unlike the same lines on the paper ground) — red on near-black reads as an error state,
and a round that scored fewer points is not an error. The two figures that are not
breakdown lines take the dark-ground highlights: `COLORS.hlYellow` for *this round*,
`COLORS.hlBlue` for *total*.

**It covers the WHOLE screen, the game's header included** (changed 2026-09-01). It is
written inside the game's content box, next to the game's own end-of-run popup, but
**portaled to `nearestOverlayHost`** (`src/components/overlayHost.ts`) — the leaf page
`Surface`, or the phone frame — and painted `position: absolute; inset: 0` there at
`zIndex: 1200`. Pinned to the game's content box instead, it stopped short of the leaf
header, leaving the round's title bar and its game controls lit above the blackout,
which reads as "the board up there is still playable". `absolute`-on-the-host rather
than `fixed` for the same reason `GamePausedOverlay` avoids `fixed`: inside the desktop
phone frame, `fixed` covers the browser window rather than the phone card. No
`useHideFooter` is needed — a leaf page has no footer.

It is deliberately **not minimizable**: there is nothing to uncover and the only exits
are forward — *Next round · <game>*, or back to the challenge. The Next button stays disabled until the POST lands, because the
server refuses round n+1's board until n is stored (§ 5.1a), and a submit failure is
stated on the card rather than retried silently — a round cannot be replayed, so the
player needs to know.

### 5.6 Score authority: the client reports, the server stores

The game already tracks its own score as it plays; at round end the client POSTs the
**total and the breakdown** and the server records them verbatim into
`study_challenges.rounds`. The server does not recompute.

This matches how games report today and keeps the scoring spec in one place (the game),
rather than duplicating it into a server-side evaluator that must be kept in step. The
trade-off is accepted knowingly: **the score is unverifiable** — a modified client can
post any number. That is tolerable because a challenge is between two people who chose
each other as friends, and the mode is already on the honor system for "I already know
this word" (§ 8).

Two things this decision makes the *client* responsible for, which must not be
overlooked when the games are built:

* The breakdown must be **derived from the same accumulator as the total**, never
  recomputed for display, or the two can disagree on screen with nothing to arbitrate.
* Elapsed-time penalties must use **accumulated active time** (§ 5.8), since the server
  has no independent clock on the round to fall back on.

If verification is ever wanted, the upgrade path is to post the round's *events* and
score them on the server — the per-round row shape does not have to change for that.

### 5.7 A challenge round is normal play

Challenge games write **normal typed marks** and earn **normal minute points**. There is
no scoring-only mode and no suppression flag: a match in round 2 of a challenge moves the
same recognition track that a match in a casual Bubble Match run would. The competition
is a study session that happens to be scored twice — once for mastery, once for the
challenge.

**The board looks completely normal, too (Q74).** The nine contested words are **not
marked, highlighted, or distinguished in any way** during play — no glow, no accent, no
pre-round "these are the ones that count" list. The contested/filler split is invisible
until the results screen.

Three reasons, in order of weight:

1. **It keeps filler words honest.** A player who can see which taps are worth points has
   been told which taps to be careless about — and those careless taps still write real
   typed marks (below). Hiding the split means the whole board is played at full effort,
   which is the study outcome the feature exists for.
2. **It costs every game page nothing.** Marking words would mean a per-word decoration
   hook in Bubble Match, Word Search and Match Speed, each rendering words in a different
   structure. Not marking them is zero work in three places, forever.
3. **It follows from this section's own premise.** A challenge round is normal play; a
   board that advertises a scoring layer is not a normal board.

Design consequences, stated so nobody is surprised by them later:

* **Contested words gain mastery during the test.** A player can walk out of a challenge
  with several of the nine words banded up. That is the feature working, not a leak.
* **A word can cross into Mastered mid-test.** Banding is a service-layer compute over
  `typedMarkHistory`, so round 3 may see a word that was Unfamiliar in round 1. Nothing
  in the scoring reads the band — contested/filler is fixed when the round's board is
  generated (§ 5.4) — so the score is unaffected. Do **not** later make scoring
  band-dependent without revisiting this.
* **The `mastered-first` filler pool shifts between rounds** for the same reason. Each
  round provisions its board independently at start, so this is consistent, just not
  stable across the test.
* **Challenges feed the streak.** Playing your Friday test counts toward the day's
  3-minute threshold like any other session. No double-crediting exists to guard
  against — minute points are earned by the games, and the challenge adds none of its
  own.

### 5.8 Leaving the app pauses the game — everywhere

A player who backgrounds the app mid-round must find the round exactly as they left it
when they return. This is **not** a challenge-specific rule: it is a **global
requirement on every game in the app**.

> ⚠️ **This is BACKGROUNDING only, and the distinction now has teeth.** It used to
> dissolve the abandonment question entirely ("there is no abandoned round to score").
> Since the claim model (§ 5.1a) it does not: leaving the game — Back, a route change,
> a tab close — finalises the round at whatever score stands. Only *backgrounding* is
> free. The client draws the line with the event it listens to: `pagehide` with
> `persisted === false` is a teardown and scores the round; `visibilitychange` and a
> bfcache freeze (`persisted === true`) are a pause and score nothing.

What it requires:

* A shared visibility hook (`visibilitychange` / `pagehide`) that every game mounts,
  which freezes the round: timers stop accumulating, ceilings stop dropping, per-second
  penalties stop counting. Games must express elapsed time as **accumulated active
  time**, not `now − startedAt`, or the pause is cosmetic.
* A resume affordance on return rather than an instant unfreeze, so the player is not
  dropped back into a live timer they cannot see yet.
* **No exceptions — live mode included.** An earlier draft carved live mode out on the
  grounds that pausing would let one player freeze the other's game. It would not: in live
  mode an **unpausable AFK timer** runs alongside the paused game and forfeits a player who
  stays away (§ 7, and the live doc § 6). Pausing therefore never helps you, so the rule
  can stay absolute and no suppression flag is needed anywhere.

Because it is global, this belongs in the games framework, not here:
→ **[docs/GAMES_FEATURE.md](./GAMES_FEATURE.md) needs a section on pause-on-background**
before this feature is built, and every existing game must be audited against it.

**The audit has been done (2026-08-16), and it inverts what this section used to say.**
An earlier draft claimed Word Search's per-second penalty was the loudest offender because
it ran on wall-clock. The opposite is true:

| Game | Pauses on backgrounding today? |
|---|---|
| **Word Search** | ✅ **yes** — `WordSearchPage.tsx` already listens for `visibilitychange`, snapshots to localStorage and calls `pauseTimer()` |
| Bubble Match | ❌ no |
| Match Speed | ❌ no |
| Speed Reading | ❌ no |

So Word Search is the **only game that already implements the rule**, and its
`pauseTimer`/`resumeTimer` pair is the reference implementation the other three should be
generalised from — not the problem case. Its −10/s penalty rides that same paused clock,
so it is already correct (Q75).

The existing **"Popups pause the clock"** section in `GAMES_FEATURE.md` is the other half
of the answer: all four games already derive a `clockPaused` boolean and already freeze
"whatever moves on its own" behind it. Backgrounding is a **second source** for that same
boolean, which is precisely how Word Search wires it. The global rule is therefore a
**generalisation of a pattern that already exists in four places**, not new machinery —
which is a much smaller job than this section originally implied.

---

## 6. Results, winner, and no contest

### ⚠️ A round is revealed as soon as it is complete (changed 2026-09-01)

**This reverses the rule this section used to state.** The opponent's SUBMITTED rounds
are now serialized as they land — `opponentRounds` is always present and simply grows —
rather than being withheld until both players finish.

* **What changed and why.** View Challenge became two swipeable pages (§ 5.4b): page 1
  is yours, page 2 is theirs. Under the old rule page 2 was blank for four days, and a
  page that stays blank is not a page — it is a promise. Revealing per round makes both
  sides fill in at the same cadence and keeps the two readable against each other.
* **The cost, stated plainly.** Whoever plays second can see the total they are chasing.
  The old rule existed to prevent exactly that ("play against the game, not against a
  number"), and dropping it is a deliberate trade, not an oversight.
* **What is still protected.** A round IN PROGRESS is invisible on both sides. Since
  the claim model (§ 5.1a) this is no longer free: `rounds` DOES hold unfinished rounds,
  so the serializer filters the opponent's side to completed ones
  (`StudyChallengeService` → `completedRounds`). Without that filter a player could
  watch their opponent's score climb mark by mark. The between-round scoreboard (§ 5.5) also
  still shows only your own figures: the moment a round is banked, mid-test, is the
  wrong moment to hand someone a comparison they cannot act on.
* **The narrow fix, if anchoring turns out to matter.** Gate each round on the VIEWER
  having submitted the same index — not a return to the all-or-nothing gate, which is
  what made the page empty.

Implemented in `StudyChallengeService` → `toSummary`; `opponentRounds` changed from
optional to required on both `ChallengeSummary` types (server and the
`src/api/studyChallenges.ts` mirror).

* The only opponent state available before their first round is **progress**
  (`opponentFinished`), which the challenges-list row reads to say which side the app is
  waiting on. The detail page's masthead used to read it too and no longer does (§ 5.4).
* The results page declares a **winner** at the top (higher total, plus the two ratio
  bars), then shows both players' cards. **Each card IS a read-only `ChallengeTestCard`**
  (2026-09-02) — same rows, same Roman numerals, same score slot as the mid-test page,
  with the player's NAME as the heading, no "closes …" stamp, no rules button and no Play
  buttons. That reuse is what keeps results and the mid-test page one screen rather than
  two kept in step by hand; a round the player never sat still draws, carrying `not done`
  / a lock, because a player who never played has a real record of not having played
  (design F18). It shows **no rule-by-rule breakdown** — that lives only on the
  game-finish screen (§ 5.5) — and **no per-word comparison (Q64)**. A word-by-word table would be a nice
  study artifact, but it requires per-word outcomes in every game's stored breakdown
  (§ 5.6), which means every game must emit them and keep emitting them forever — a
  large permanent tax on the `challengeScoring` contract for a screen nobody has asked
  for. It stays addable later: the breakdown is jsonb, so a game may enrich it without a
  migration. Ties → **draw** (Q16: tiebreak or plain
  draw? draft: plain draw).
* **No contest**: if the test window closes with either player incomplete, the
  challenge ends `no_contest`. Not a forfeit — a player who finished still sees their
  own score, but no winner is declared. (Q17: is an unaccepted challenge also
  `no_contest`, or a distinct `expired`? Draft: distinct — `expired` never had a word
  set both players agreed to.)
* **Every challenge is recorded permanently**, including the words and the outcome, so
  a pair's history is browsable. That is what makes the word set worth storing on the
  challenge row rather than only in the temp decks (which are cleaned up — Q9/Q36).

### 6a. Taunts — one canned line per player (built 2026-09-01, migration 156)

Once a challenge resolves, each player owns **one taunt slot** aimed at the other. It
renders in a hand-written serif italic over the top edge of the target's card on the
results screen (design F17/F17b).

* **A CLOSED LIST, NOT FREE TEXT.** The lines live in `CHALLENGE_TAUNTS`
  (`server/contracts/wire.ts`) and only the **key** is stored. A free-text message box
  between two named accounts is a harassment surface that needs moderation, a report path
  and a review queue — for one joke after a game. A fixed list gets the rivalry with none
  of that, and the wording can be revised in a deploy with no data migration. An id that a
  newer build no longer knows degrades to *no taunt*, never to a blank bubble — which is
  why an id is permanent even though its text is not.
* **The button IS the picker; every tap cycles (changed 2026-09-02).** The
  `ChallengeTauntPicker` sheet that used to present all eight lines was **deleted**: a
  second screen for a one-bit decision, when the lines are app-authored and
  interchangeable. In its place the first tap lands on a uniformly random line and each
  further tap steps to the **next** line in `CHALLENGE_TAUNTS`, wrapping — so a sender who
  dislikes their roll keeps tapping until they like one, and the whole list is reachable
  without a sheet. The safety property that actually matters — never user-authored text —
  is unchanged, because the list is still closed. The roll happens on the CLIENT
  (`ChallengeResults` → `handleTaunt`); the server accepts any known `tauntId`, so moving
  it server-side later needs no wire change.
* **Tap cadence is not network cadence.** The line on the card changes synchronously on
  every tap (a throttled UI would read as a broken button) while the POST is throttled to
  `TAUNT_SEND_INTERVAL_MS` (2 s, `ChallengeResults.tsx`): leading edge immediate, then one
  **trailing** send carrying the latest rolled id. The trailing send is what makes the
  throttle safe — without it the final tap of a burst never reaches the server and the
  opponent reads a line the sender did not settle on. Unmounting mid-window fires the
  pending send fire-and-forget rather than dropping it. The throttle is a **courtesy, not
  a defence**: a hand-rolled client ignores it, and the real bound is the global per-user
  `writeLimiter` (600 writes / 5 min, `server/middleware/rateLimits.ts`) that already
  covers every write route.
* **The viewer's own line renders from LOCAL state, not from the server's copy**
  (`rolledId` in `ChallengeResults`). Taps outrun the throttled round-trips, so painting
  the server's answer would make the line stutter backwards between taps.
* **Stored by SENDER, rendered on the TARGET's card.** `study_challenges.taunts` is
  `{ "<userId>": { tauntId, sentAt } }` — the same keyed-by-user shape as `words`,
  `rounds` and `presetDeckIds`, so the results screen reads either side with no
  `isChallenger` branch. Keying by sender (rather than by target, which would match the
  rendering more directly) makes "one per player, ever" a property of the object's shape.
* **NOT write-once (rule dropped 2026-09-02).** `StudyChallengeDAL.setTaunt` used to
  carry a `NOT (taunts ? $2)` guard so a sender's slot could never be rewritten; cycling
  makes that guard the thing standing in the way, so it is gone and the UPDATE now
  overwrites the sender's slot. `sentAt` accordingly means **last changed at**. The one
  rule still held in SQL rather than in the service is the resolved status, so it cannot
  be lost to a read-then-write race; no match means "not resolved yet", not an error.
  ⚠️ The consequence to keep in mind: a taunt the opponent has already read can change
  under them. That is accepted — both lines are from the same closed list, so nothing a
  sender can swap to is worse than what they could have sent first.
* The button sits on the **opponent's** card, which is where the taunt it sends will
  appear. **Its label is always *Taunt*, in every state** — nobody has taunted, they got
  there first, or a line of yours is already on the card. The button does the same thing
  on every tap, so it says the same thing; the two cards are what show the state. It is
  never disabled. (Earlier drafts varied it — *Taunt back*, *Taunt sent*, *Reroll* — and
  the variants only ever restated what the cards already showed.)

`POST /api/studyChallenges/:id/taunt` → the refreshed challenge. The screen keeps
rendering its own `rolledId` for the sender's line regardless (see above); the response
matters for the rest of the payload and for the opponent's side.

### Winning pays nothing (Q51)

**The crown on the friend's row is the entire prize.** No bonus minute points, no Night
Market payout, no leaderboard entry, no tdp strip. Three reasons, in order of weight:

1. **Minute points are the economy.** They drive the streak, the inactivity penalty
   cron, and Night Market occupancy. Any challenge-conditional payout is farmable by two
   colluding friends trading wins every week, and the fix for that (throttles, anti-abuse
   heuristics) costs far more than the incentive is worth.
2. **The round already pays.** Challenge rounds are normal play (§ 5.7) — normal typed
   marks, normal minute points. So playing a challenge is never worse than playing solo,
   and no compensation is owed.
3. **A loss must not cost anything.** With no payout attached, losing is free, which is
   what makes issuing a challenge to a stronger friend a reasonable thing to do.

Nothing about the challenge appears outside the challenges page and its history log
(§ 1) — the results page is reached from the friend's row, not from the hp, the tdp, or
the leaderboard. That also keeps the read paths to one.

### Unfriending ends the challenge

If either player unfriends the other while a challenge is in flight — at any stage,
pending or accepted or mid-test — the challenge immediately becomes **`no_contest`**,
both challenge decks are dropped, and no winner is declared. Unfriending withdraws you
from everything shared with that person; a challenge is not an exception carved out of
that.

* The unfriend action is **never blocked** by an active challenge. It is a social-safety
  action and must always succeed on the first tap.
* Implementation: `FriendService`'s delete path calls into `StudyChallengeService` to
  resolve in-flight challenges for the pair, in the **same transaction** as the
  friendship delete, so there is no window in which a challenge outlives its friendship.
* Marks and words already earned **stay** — the cards are the player's, in the `library`
  bucket, and are not challenge state (§ 3.3). Only the challenge, its decks and its
  pending result go away.
* ⚠️ Accepted knowingly: this is a **rage-quit button**. A player who is losing can
  unfriend to erase the result. It resolves to `no_contest`, not a forfeit win for the
  other player, so the escape works. The mitigation is social, not technical — you had
  to be friends to be challenged, and re-friending is a visible request the other person
  must accept.
* A resolved challenge is **untouched** by unfriending: the history entry and the crown
  survive, because the record is of something that actually happened.

---

## 7. Live (synchronous) mode

→ **Designed in full in [STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md)** (2026-08-16).
That document settles Q18–Q21 and supersedes this section wherever the two differ. What
follows is the summary; go there for the transport, the room model, and the collapse
rules.

Either player may, during the test window, press **Play live**. That player enters a
waiting room and the other receives an invitation to join. Once both are in, the three
games are administered **synchronously**.

⚠️ **Live may be entered only while *both* players have zero recorded rounds.** Rounds are
strictly sequential with one attempt each (§ 5.1a), so a challenge cannot be half-live.
Starting async therefore permanently forecloses live for that challenge.

Between games both players see both breakdowns and **both must confirm** to advance.

Rules for the messy parts:

| Situation | Behaviour |
|---|---|
| A player confirms, then **leaves the app** | their confirmation is **revoked** — the room must not advance into a game one player is not present for |
| A player leaves **after a game has started** | the game runs without them; they score whatever they had banked and risk losing. **No grace period** (Q20) |
| A player never confirms on the scoreboard | the room waits **indefinitely**; the other player leaves via an **Exit live challenge** control when they choose (Q69) |
| A player stops playing mid-round | the game **pauses** (as everywhere), but an **unpausable AFK timer forfeits** them after ~60s: the round ends where it stands and the room advances. No game needs a live-only time cap (Q20 revised, Q71/Q72 retired) |
| Nobody joins the waiting room | it expires after **1 minute** and returns the player to the challenge screen — it does **not** fall back to async (Q18) |
| The window closes mid-session | `no_contest`, same as async |
| The session collapses **after** a round is banked | the challenge **reverts to async for both players**; banked rounds stand |

The repo has **no realtime transport today**. The live doc resolves each of the four
prerequisites this section used to list as open:

1. **transport** — a WebSocket at `/api/ws`; nginx already forwards the upgrade and there
   is one backend container, so rooms live in process memory (Q19);
2. **room/session model** — in-memory only, **no new table** (Q19b);
3. **presence** — no grace period at all; the game never waits for anyone (Q20);
4. **invite delivery** — mostly dissolved: the mechanism is a **permanent waiting-room
   entrance** on the challenge screen, so no notification is required to play. A ping
   (banner on web, push under Capacitor — logged in
   [REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md)) widens discovery only, capped
   at one per day per (sender, target) (Q21, Q70).

**Live mode is phase 2 and has its own document**
([STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md)). Everything in §§ 1–6 is buildable
on the existing request/response stack; nothing in § 7 is. This section stays here as the
statement of intent so the async build does not accidentally foreclose it — concretely,
phase 1 must:

* store per-round scores as they complete (§ 9 `study_challenges.rounds`), not only a
  final total, so a synchronous round-by-round comparison has something to read;
* keep every game's scoring in a declarative `ChallengeScoringSpec` rather than inside
  the page, so a live round can score the same events server-side;
* not build scoring that only computes in an end-of-run branch — a live round can end by
  **forfeit**, and a forfeited run still has to report a score;
* leave room for a per-game **idle signal** ("no input for N seconds"), which is the only
  hook live mode needs from a game page. **Pause-on-background is unconditional** (§ 5.8)
  and needs no live-mode exception.

**Live mode may be cross-language** (§ 8) — both players play the same game
simultaneously in their own language.

---

## 8. Different-word challenge

**Purpose: let two players at wildly different levels compete.** A same-word challenge
needs a level band both players can meet in; a level-3 learner and a level-30 learner
have no such band. Different-word mode drops the shared set so each plays at their own
edge — the contest is "who studied harder this week", not "who is further along".

That purpose settles the fairness question. **Scores are compared raw, with no
normalisation** by level or by the set's mean `frequencyScore`: each player's 9 words
are hard *for them*, which is the whole premise. Adding a handicap would re-introduce
exactly the level comparison the mode exists to avoid.

Identical in every respect except word selection, and therefore in language scope.

| | Same-word | Different-word |
|---|---|---|
| Word set | one shared set of 12 | one set of 12 **per player** |
| Who picks | challenger proposes, challengee revises, both accept the result | **each player picks their own**, from their own pool |
| Candidate pool | level band spanning both players; excludes words *either* knows | **the same algorithm**, run per player: their own level, excluding words *that player* knows |
| Language | must match | **may differ** (zh vs es), live mode included |
| Game selection | any recognition/production game in that language | only games playable in **both** languages |
| Accept step | accepting the word set **is** accepting the challenge | same — the challenge is not `accepted` until the challengee's set is picked |
| Temp decks | same 10 on both accounts | each player's own 10 |
| Comparability | strong — same words, same games | same games and rules, different content, both at each player's own edge |

### 8.1 The set is still built by the server

The per-player set comes from the **same candidate algorithm as § 3.1**, with the band
collapsed to that one player's level and the exclusion consulting only that one player.
So the words are still server-chosen, still ranked by commonality, and still filtered to
words that player's card data says are `Unfamiliar` on the core bar. A player cannot
hand-pick an easy set — they can only *remove* words, and every removal is replaced from
the same ranked list.

**The remaining gap is honor system, deliberately.** A player could mark words
"already learned" that they do not know, thinning their set toward whatever the
replacement logic serves next. Nothing detects this and nothing is built to. The
counterweight is real: every such rejection **writes Mastered onto that player's own
card** (§ 3.2), so gaming the set permanently inflates their own mastery numbers,
removes the word from their study rotation, and shows up on the friends leaderboard's
velocity. The cheat costs more than it wins. No opponent veto is added.

### 8.2 Pick-then-accept (no limbo state)

The challengee **picks their words before the challenge is accepted**, in both variants.
The backend never holds a challenge that is `accepted` but has no word set — that
in-between state would need its own status, its own expiry, its own UI, and its own
answer to "what happens if they never pick".

The **UI may present it the other way round** — an *Accept* button that opens the word
picker — because "accept, then confirm your words" is the friendlier reading. The
transition to `accepted` happens on the **final confirm at the end of the picker**, not
on the first tap. Abandoning the picker leaves the challenge exactly `pending`, and the
challengee can come back to it until their Wednesday 04:00 deadline.

Consequences: **no temp deck exists before `accepted`** (§ 3.3 creates both decks in the
accept transaction), and a declined or expired challenge leaves nothing behind on either
account except the history row and any Mastered writes the players made while reviewing.

**Issue and accept are serialised per pair.** Two of the issue-time gates cannot be
expressed as constraints — "at most one UNFINISHED challenge per pair, whatever week
it is named after" is derived from both players' timezones, and the
`MAX_ACTIVE_CHALLENGES` cap is a COUNT — so both were read-then-write and both were
reachable concurrently. A crossing pair in two timezones can compute *different* week
indices, which means `study_challenges_pair_week_uniq` does not collide and the pair
ends up with two live challenges, two decks and two cap slots: the migration-150
defect, re-opened by a race. All four gates and the insert now run inside one
transaction holding `pg_advisory_xact_lock` on **both** players (sorted, so crossing
requests cannot deadlock), and the accept path's cap check moved *inside* its existing
transaction and under the same lock. The candidate draw stays outside the lock — it
depends on none of the gates. See `IStudyChallengeDAL.lockUsersForChallenge` and
[API_ABUSE_HARDENING.md](./API_ABUSE_HARDENING.md) § 1a.

**The review screen is single-use, and history says so.** Send / Accept / Decline all
leave the screen with `slideNavigate("/friends/challenges", { replace: true })`, so the
review page's history entry is *replaced* by the friend list rather than pushed over.
Back from the friend list therefore goes out to `/friends`, and there is no way to
return to a confirmed word set and tap its Send button against a challenge that already
exists. (`replace` is an option on `useSlideNavigate`,
`src/hooks/useSlideNavigate.ts`; the calls are `handleConfirm` / `handleDecline` in
`src/features/studyChallenge/ChallengePanel.tsx`.) Abandoning the sheet *without*
confirming still uses the ordinary back arrow, which leaves the challenge `pending` as
described above.

### 8.3 Cross-language game eligibility

Word Search is Chinese-only ([WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md)), so a
zh-vs-es challenge can draw only from **Bubble Match** and **Match Speed** — two games,
not three. Per § 5.1 the test is then simply **two rounds**; the format bends rather than
blocking, and the count is stated up front so neither player is surprised.

This is a data problem, not a design problem, and it shrinks on its own: **most games
should be language-agnostic**, and every future recognition/production game that is
widens the cross-language pool. Word Search is the outlier because its grid is built from
characters.

### 8.4 Settled here

* **Q27 — Set size is fixed at 9** (`CHALLENGE_WORD_COUNT`: 10 → 12 on 2026-08-17, 12 → 9 on 2026-08-28), not a choice. Set size
  determines how many points are available, so both players must use the same number
  anyway — making it selectable would add a negotiation to buy nothing. It is a constant,
  so it can be changed globally later without a schema or protocol change.
* **Q29 — The challenger chooses the variant**, stated in the invitation, so the
  challengee accepts a known format and there is no negotiation round trip. Cross-language
  pairs are offered **different-word only**, because same-word is impossible for them.
  This is the one thing the invitation *does* disclose about the format — the games do
  not (§ 5.1b).

---

## 9. Proposed data model

✅ **The schema below is signed off** (2026-08-16) — the tables, the columns and the
index change are approved; only the migration number is still floating. Migration
numbers start at **147**. 145 is the `user_languages` rename and **146 is taken** — `database/migrations/146-create-arenas.sql` exists on disk ([ARENA_FEATURE.md](./ARENA_FEATURE.md)), so Arena won that race. Re-check `ls database/migrations | sort -V | tail` at build time rather than trusting this line.

**Guiding rule (Q52):** a table gets a column only when that column is a property of the
object the table represents. Everything that is a property of *the challenge* lives on
the challenge — including the word sets, the round scores and the generated deck ids, as
jsonb — rather than being scattered across the vet and deck tables as foreign
bookkeeping. This is safe because a challenge is **bounded**: exactly 2 players, 9 words
each, 3 rounds each, then it is finished forever. Unbounded collections would still
deserve their own table.

### `study_challenges` — the only new table

The whole feature is **one table**. A challenge is a small, bounded, self-contained
object: two players, nine words each, three rounds each, one outcome. Everything about it
is intrinsic to it, so everything lives on it.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `challengerId` / `challengeeId` | uuid → `users(id)` CASCADE | direction matters permanently here (unlike `friendships`) |
| `variant` | varchar(16) | `'same_word' \| 'different_word'` |
| `challengerLanguage` / `challengeeLanguage` | varchar(8) | equal unless cross-language |
| `status` | varchar(16) | `pending \| accepted \| declined \| expired \| complete \| no_contest`. There is **no** "accepted but unpicked" state — see § 8.2 |
| `gameSequence` | jsonb | the 3 chosen game ids **in order**, drawn once, shared |
| `words` | jsonb | **each player's 9 words**, keyed by user id — see below |
| `rounds` | jsonb | **each player's played rounds**, keyed by user id — see below |
| `presetDeckIds` | jsonb | `{ "<userId>": <deckId>, ... }` — the generated decks to drop on cleanup (§ 4) |
| `issuedAt` | timestamptz | when it was sent; a log field, not a boundary anchor |
| `weekIndex` | integer | **the week identity** — whole weeks since Monday 2026-01-05 00:00 UTC, and what every local boundary is derived from. Third column of `study_challenges_pair_week_uniq`. See § 2 "The week is a global counter" and Q77 (migration 150; shipped in 148 as a per-challenger `weekStart` timestamptz, which did not collide across timezones) |
| `acceptedAt`, `completedAt` | timestamptz null | |
| `winnerUserId` | uuid null | null for draw / no contest |

**`words`** — keyed by user id so one shape serves both variants and the results page
never branches. Same-word challenges simply write the same ten entries under both keys.

```jsonc
{
  "<userId>": [
    { "position": 1, "word1": "开始", "language": "zh", "vocabEntryId": 90210 },
    // ... 10 total
  ]
}
```

`word1` + `language` is the identity, denormalised, so history survives a det data
deploy (det ids are not stable across re-imports). `vocabEntryId` is filled in when the
set is materialised on accept (§ 3.3) and is null before then.

#### The challenge and the vet row never compete for source of truth (Q54)

This is the rule that keeps the two records from drifting, and it is worth stating
sharply because it is the one place they could:

| Question | Source of truth |
|---|---|
| **Which 9 words is this challenge about?** | `study_challenges.words` — always, forever |
| **Is this word in the user's library?** | the **vet row** — always |

`vocabEntryId` is a **convenience pointer, never an identity and never a claim of
membership.** It may dangle. The challenge does not care whether the card still exists.

The consequence is deliberate and good: **if a player deletes a contested word from their
library mid-challenge, the challenge is unaffected.** The word is still one of the ten,
still appears on the test, still scores as contested. What the player loses is the
ability to *study* it — it drops out of their challenge deck (a deck is a set of vet
cards), so they go into Friday having practised nine. They chose that; nothing is broken
and nothing needs repairing.

#### Rendering a contested word: which list, which values (Q55)

**The list comes from the challenge; the values come from the player.** These are two
separate lookups and they resolve in a fixed order:

1. **Which words** — `study_challenges.words`, and only ever that. Never a vet query,
   never a deck query. This is what guarantees all 12 appear on every board (§ 5.2)
   regardless of the state of anyone's library.
2. **What each word looks like** — hydrate from the player's own **vet row** first,
   falling back to the **det row** when there is no vet row.

Hydrating from vet first is the point: the vet row carries the learner's own choices
about that word — `selectedSense` (migration 99), the display definition derived from it,
`iconLayout` (migration 82), text colors (migration 89). Reading the word straight from
det would show the dictionary's default sense and throw all of that away, so a player
would see their own card rendered as somebody else's.

**The two players may therefore see the same word differently, and that is accepted.**
Alice's 上 may be captioned with a different sense than Bob's. Fairness is not harmed:
the contested set, the scoring and the boards are identical, and each player is being
tested on the word *as they learned it* — which is more faithful than forcing both onto
a canonical gloss neither of them chose. Same word, each player's own card.

Det is the fallback, not the default. It is reached only when the player has no vet row —
never studied the word, or deleted it mid-challenge — and it supplies enough (`word1`,
pinyin, a default definition) to draw a complete tile. So a missing vet row degrades the
rendering to the dictionary default; it never blanks a tile or crashes a round.

**Marks against a word with no vet row are always skipped.** There is nowhere to write a
typed mark, so the play produces none and the round scores normally. This is a **skip,
not an error**, and it must **not** re-create the card: silently resurrecting a word the
user deliberately deleted would be worse than an unmarked play. The same skip covers the
det-fallback case generally, so there is one rule, not a special case per cause.

Scoring is untouched by any of this, because contested-vs-filler is fixed at board
generation (§ 5.7) and never re-derived from library state.

**`rounds`** — keyed by user id, then by round index.

```jsonc
{
  "<userId>": {
    "1": { "gameId": "bubble-match", "score": 820,
           "breakdown": { /* the itemised lines § 5.5 renders */ },
           "completedAt": "2026-08-14T18:03:11Z" }
  }
}
```

`gameId` is stored per round even though it is derivable from `gameSequence` — the
history page filters by game (§ 1), and reading it from the round entry keeps that filter
from having to correlate two arrays.

**Concurrency: solved by encapsulation, not by versioning (Q53).** Both players write
`rounds` on the same row, possibly at the same instant. The fix is that **exactly one
function may ever touch the column** — `StudyChallengeDAL.recordRound(challengeId,
userId, roundIndex, payload)` — and it is a single statement:

```sql
UPDATE study_challenges
   SET rounds = rounds || jsonb_build_object(
         $2::text,
         COALESCE(rounds -> $2, '{}'::jsonb) || jsonb_build_object(
           $3::text,
           -- the stored startedAt wins, so a later write cannot backdate the claim
           $4::jsonb || jsonb_strip_nulls(jsonb_build_object(
             'startedAt', rounds #> ARRAY[$2, $3, 'startedAt']
           ))
         )
       )
 WHERE id = $1
   AND (
     rounds #> ARRAY[$2, $3] IS NULL                      -- the claim
     OR rounds #> ARRAY[$2, $3, 'completedAt'] = 'null'::jsonb  -- still in progress
   )                                                      -- a FINAL round: no replays (Q40)
RETURNING id;
```

The guard used to be a bare `rounds #> ARRAY[$2,$3] IS NULL` — insert-only. It widened
to "absent **or** still in progress" when the claim model (§ 5.1a) made the first mark
write the row: the round now exists for the whole run and has to stay writable until it
is finalised. A malformed slot with no `completedAt` key at all makes the comparison
SQL-NULL, so it fails **closed** — refused rather than overwritten.

> ⚠️ **IT WAS `jsonb_set(rounds, ARRAY[$2,$3], …, true)` AND THAT SILENTLY ATE EVERY
> FIRST ROUND** (found and fixed 2026-08-22, the first time a round was submitted end
> to end). `create_missing` creates only the **last** key of a path. Before a player's
> first round they have no entry at all — `rounds` is `{}` from the accept transaction
> — so the intermediate `{userId}` was missing, `jsonb_set` returned its input
> **unchanged**, and the UPDATE still matched: `rowCount` was 1, `recordRound`
> reported success, the client got a 200, and the score was gone. The `||` form above
> builds the player's object when it is absent and merges into it when it is not, so
> the first round and the third take the same path.
>
> The general lesson, worth carrying to any other jsonb write: **a no-op `jsonb_set`
> is indistinguishable from a successful one by row count.** If a path's parent may
> not exist, do not use `jsonb_set` to create it.

One statement takes the row lock, reads, modifies and writes inside that lock, so
concurrent submissions serialise and neither can be lost. The `IS NULL` guard makes it
idempotent and enforces the one-attempt rule in the same breath — zero rows returned
means "already submitted", which the service turns into a rejection.

**An ETag / version column would be strictly worse here.** Optimistic concurrency
(`WHERE version = $expected`, bump on write, retry on conflict) exists to protect a
*read-modify-write across a round trip* — the client reads state, thinks, writes back.
That is not this shape: the client sends a score for one specific slot and never needs
the rest of the blob. Adding a version would buy an extra column, a retry loop, and a
new failure mode (a client that must re-fetch and resubmit) to solve a problem the
single statement already does not have.

So the danger is not concurrency itself, it is **someone later writing a convenient
read-modify-write helper in the service**. The guard is structural: `rounds` is written
by `recordRound` alone, and that is the rule to state at the top of the DAL. If that
discipline ever feels unreliable, the fallback is the child table (`study_challenge_rounds`),
where the same guarantee comes from a unique constraint instead — but the single
statement above is simpler than either alternative, so there is no reason to reach for
it now.

### Why the words are not a column on the vet tables

The tempting alternative — mark a vet row as "this week's challenge word" and keep the
value for history — does not work, for two reasons that are not about style:

1. **A word can be contested in more than one challenge at once.** A player may have a
   live challenge with every friend (Q32), and the same word can legitimately appear in
   several of those sets. A vet row is unique per (user, word, language), so a scalar
   column cannot represent it; it would have to become an unbounded, ever-growing array
   of challenge ids on the **hottest table in the app** — the one read by every game
   load, every deck query and every search.
2. **A pending challenge has no vet rows yet.** The challenger's proposed set exists from
   the moment the invitation is issued, but words are only materialised as vet rows **on
   accept** (§ 3.3). A vet column has nowhere to store a set that has not been accepted —
   and reviewing that set is the whole confirmation flow (§ 3.2).

There is also a layering reason: a challenge is not a property of a vocabulary card. The
card outlives the challenge, is shared with every other feature, and should not carry
another feature's bookkeeping. The challenge owns its words; the vet row is merely
pointed at (`vocabEntryId`).

### Changes to existing tables

Kept to the minimum, and only where the column is genuinely a property of the object it
sits on.

* `decks."editMode" varchar(16) NOT NULL DEFAULT 'custom'` (`'custom' | 'preset'`) — § 4.
  Describes what the user may do to this deck, so it is intrinsic to the deck. **No
  `challengeId` on `decks`**: the pointer lives on the challenge (`presetDeckIds`), so
  `decks` learns nothing about challenges.
  ⚠️ Trade-off accepted: an id inside jsonb cannot carry a foreign key, so there is no
  `ON DELETE CASCADE` and a stale deck id is possible in principle. Tolerable because the
  **only** code path that deletes a challenge deck is the challenge's own cleanup — users
  cannot delete them (§ 4) — and a stale id resolving to nothing is a no-op on cleanup.
* `friendships."requesterChallengesBlocked"` / `friendships."addresseeChallengesBlocked"`,
  both `boolean NOT NULL DEFAULT false` — the per-pair challenge opt-out (§ 1). Each
  player owns their own flag; a challenge may be issued only when **neither** is set, so
  the effect is symmetric while ownership is not. A property of the relationship rather
  than of either user, which is why it sits on `friendships`.
* `decks_user_language_name_uniq` becomes **partial** — `WHERE "editMode" = 'custom'` —
  so generated decks may share a name (Q30, § 4).
* `vocabentries_*` — **no change**; challenge words are ordinary vet rows.

### The read path never waits for the job (2026-08-22)

**The maintenance job writes a lapse down; it does not create one.** Every read
derives the effective status live, so the feature behaves identically on a machine
where the timer has never been installed (dev, and prod until `install-timers.sh`
re-renders the unit).

The one rule, in the one place a row becomes a payload
(`StudyChallengeService.toSummary`):

> a `pending` row whose **challengee's** Wednesday 04:00 has passed is serialized as
> `status: 'expired'`, whoever is asking.

This was a live defect before 2026-08-22: the stored status was shipped verbatim, so
after the deadline the challengee's friend row still offered a green **Incoming Challenge**
control whose only possible outcome was `acceptChallenge` throwing "The time to accept
this challenge has passed", and the challenger's row still offered *Withdraw*.
`countBadge` had always applied `isAcceptWindowOpen`, so the badge and the row it
pointed at disagreed — the badge was right.

`challengeLabels.acceptLapsed` (client) mirrors the same check against the same
serialized `deadlines.acceptDeadline` instant, purely so a page left open across the
boundary does not go stale; it cannot disagree with the server, because it is reading
the server's own number.

Not derived this way, deliberately: **`countActiveForUser`**. A lapsed-but-unwritten
`pending` row still consumes one of the issuer's six slots until pass 1 flips it,
because that count is a SQL aggregate and the deadline needs each challengee's
timezone. On prod the hourly job closes the gap within the hour; on dev the slot stays
spent until the SQL is run by hand. Tracked in [DEFERRED_WORK.md](./DEFERRED_WORK.md).

### The maintenance job (Q60)

Several transitions are **time-triggered rather than user-triggered** — nobody taps a
button when a window closes — so the feature needs a periodic job. It becomes a **third
step in the existing `cow-maintenance` systemd unit**
(`database/cron/cow-maintenance.service.template`), not a new schedule: that unit already
runs **hourly**, which is the granularity every 04:00-local boundary needs (one timezone
crosses the boundary each hour), and it is already a `Type=oneshot` singleton, so runs
cannot overlap. See [STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md).

New file: `database/cron/expire-study-challenges.sql`, appended as
`ExecStart` step 3, logging to `logs/study-challenges.log`. **Prod only**, like the rest
of the unit; dev runs it by hand with `psql -f`.

**Testing (Q61):** prod has no users yet and is effectively a pre-production
environment, so this feature is tested **on prod** rather than behind a dev-only clock
offset or admin trigger endpoints. Nothing simulated is built. When prod becomes a real
production environment, this decision has to be revisited — at that point a week-long,
cron-driven feature has no safe way to be exercised, and the trigger endpoints deferred
here become necessary.

Its four passes, in order — the order matters, because each later pass consumes what an
earlier one leaves behind:

1. **Expire unaccepted invitations.** `status = 'pending'` past the *challengee's*
   Wednesday 04:00 → `expired`. No decks exist yet (§ 3.3), so nothing else to do.
2. **Close finished windows.** `status = 'accepted'` past the *later* of the two
   players' Monday 04:00 → `complete` if both played all three rounds (stamping
   `winnerUserId`), else `no_contest` (§ 6).
3. **Drop preset decks whose window has closed.** Per player, per that player's own
   clock — Alice's deck can go while Bob's window is still open (§ 4). The
   completion-triggered drop is *not* here: that one happens synchronously in
   `StudyChallengeService` when the third round is submitted, because it should be
   immediate rather than up to an hour late.
4. **Sweep orphaned preset decks.** `decks` where `"editMode" = 'preset'` and no
   surviving `study_challenges` row lists that id in `presetDeckIds`.

**Why pass 4 exists.** Deleting an account CASCADEs the challenge row away (Q59), which
destroys the only record of which decks belonged to it — while the *surviving* player's
challenge deck lives on, and they **cannot delete it themselves** (preset decks expose no
delete control, § 4). Without the sweep it sits on their `/decks` page forever. The same
pass also cleans up after any future path that drops a challenge without its decks, so it
is a genuine backstop rather than a fix for one bug.

⚠️ Pass 4 is the one that could **delete a deck it should not**, since it is defined
negatively ("no challenge claims this"). Two safeguards, both mandatory:

* it must match on `"editMode" = 'preset'` **first**, so a user's own deck can never be
  a candidate no matter what the challenge table says;
* it must ignore decks younger than a grace period (say 1 hour), so a deck created in the
  window between the deck insert and the `presetDeckIds` write is never swept. Better
  still, write both in one transaction — then the grace period is belt-and-braces.

Every pass must be **idempotent**, since `Persistent=true` re-runs a tick missed to a
reboot. Passes 1–3 are naturally so (they filter on the status they are leaving); pass 4
is idempotent because a deleted deck simply stops matching.

### Live mode (phase 2) — no tables, no columns

This section previously deferred a `study_challenge_sessions` table (participants, current
round, per-player confirmation, heartbeats). **That table is retracted**
([STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md) § 9, Q19b): every one of those fields
is worthless the moment the session ends, room state lives in the backend process, and the
only durable thing a live round produces is a `rounds` entry written through the same
`recordRound` path async uses.

**Live mode adds nothing to the database, and nothing to `GameDef` either.** Its only
client-side requirement is that challenge-eligible game pages can emit an idle signal.

---

## 10. Layering map (proposed)

| Layer | File | Responsibility |
|---|---|---|
| Contract | `server/contracts/wire.ts` | `CHALLENGE_WORD_COUNT`, `CHALLENGE_ROUND_COUNT`, eligible-game list, `ProvisionMode` |
| DAL | `server/dal/implementations/StudyChallengeDAL.ts` (+ interface) | the single `study_challenges` table, including the atomic single-statement round write (§ 9 — and read its `jsonb_set` warning before touching it); **no policy** |
| DAL | `ProvisionalCardDAL` | new `mastered-first` candidate query |
| Service | `server/services/StudyChallengeService.ts` | windows/time zones, candidate selection, replacement, accept transaction, scoring persistence, winner resolution |
| Service | `server/services/ProvisionalCardService.ts` | `mode` parameter |
| Service | `server/services/DeckService.ts` | temp-deck creation + the `editMode <> 'custom'` mutation guard |
| Controller | `server/controllers/StudyChallengeController.ts` | HTTP edge only |
| Routes | `server/routes/studyChallengeRoutes.ts` | ⚠️ static segments above `/:id`, as in `friendRoutes` |
| Client API | `src/api/studyChallenges.ts` | typed calls, **no `token` param** |
| Client | `src/features/studyChallenge/*` | issue flow, review flow, test runner, results |
| Client | `src/games/types.ts`, `src/games/registry.ts` | `challengeScoring` on `GameDef` |
| Client | each game page | emit scoring events; honour challenge mode |

Entry point: a **Study Challenge** row on the hp, beside Friends
([BENTO_SYSTEM.md](./BENTO_SYSTEM.md)), with a badge for "awaiting your
response" and "your test is open" — the same badge pattern `/friends` uses for
incoming requests.

---

## 11. Question log

### Settled

| # | Question | Decision |
|---|---|---|
| Q1 | Day boundary | **04:00 local**, app-wide convention; accept deadline is **Wednesday 04:00** |
| Q3 | Which mastery bar gates eligibility | **core only** — the whole feature is core |
| Q4 | Library preference: either library or both | **both**, no half-credit tier |
| Q5 | Fewer than 10 candidates | **widen the band** symmetrically; never refuse |
| Q6 | Does "already learned" write to the card | **yes** — reuses discover's `coreMasteredTypedMarkHistory` (core 8/8, reading/writing 0) |
| Q11 | "Deck slots" | only means **excluded from the 100-deck cap**; no new capacity concept |
| Q12 | Random draw with only 3 eligible games | **future-proofing** — registry-derived pool, drawn without repetition; more games are coming |
| Q19 | Realtime transport / live mode | **phase 2, its own doc** |
| Q22 | Cross-language with 2 eligible games | **play 2 rounds**; most future games are language-agnostic |
| Q23 | Different-word fairness / opponent veto | **no veto** — same server algorithm per player, honor system, self-penalising |
| Q24 | Accept-then-pick vs pick-then-accept | **pick then accept** on the backend; the UI may show Accept → picker |
| Q26 | Normalise scores by level | **no** — playing at different levels is the point of the mode |
| Q28 | Live mode across languages | **allowed** |
| Q2 | Test window close | **Monday 04:00 local**, each player's own clock — the instant the next issue window opens |
| Q7 | Challenger re-approves the challengee's edits | **no** — but is shown the final set. Safe because the challengee can only *remove*, never choose |
| Q9 | Temp deck lifetime | **dropped at the Monday 04:00 after the challenge resolves**; history is the durable record |
| Q10 | Deck naming / lock | **`vs Bob`**, no lock badge — restriction shown by absent controls |
| Q13 | Match Speed when contested words run out | **alternation lapses to filler**; contested scoring ceiling is 1000 |
| Q14 | Word Search contested/filler split | **apply the split** — substitution means filler really does enter its grid |
| Q15 | May a total go negative | **yes**, unclamped |
| Q16 | Tie | **draw**, no hidden tiebreak |
| Q17 | `expired` vs `no_contest` | **distinct** — expired never had an agreed set or decks |
| Q25 | Challenger's set on decline | **discarded**; no deck before `accepted`. Mastered writes made while reviewing persist |
| Q27 | Set size | **fixed 9** (`CHALLENGE_WORD_COUNT`; 10 until 2026-08-17, 12 until 2026-08-28) — size changes the points available, so it must be equal anyway |
| Q29 | Who chooses the variant | **the challenger**, stated in the invitation. Cross-language pairs are offered different-word only |

| Q8 | Bucket for materialised contested words | **`library`** — accepting the set *is* the sorting decision; see § 3.3 |
| Q31 | Do challenge rounds write marks / earn minute points | **yes, both** — a challenge round is normal play (§ 5.7). No suppression flag |
| Q32 | Challenges in flight per week | **one per friend pair, unlimited friends** — cap the pair, not the user (§ 1) |
| Q33 | Async mid-round abandonment | **revised 2026-09-02.** Backgrounding still **pauses** (a global games requirement, § 5.8), but WALKING OUT of the game is now a scored, spent attempt: the round is claimed at the first mark and finalised on exit (§ 5.1a). The earlier "there is no abandoned round to score" is no longer true |
| Q34 | Seeing the opponent's score before you play | **hidden until both finish**; progress ("has played") is visible, scores are not (§ 6) |
| Q35 | Entry point / how a challenge is discovered | a **Challenges NodePage reached from the Friends page**; badge rides the friends payload (§ 1) |
| Q36 | Study the challenge deck before Friday | **yes, that is the point** — and this *revised Q9*: the deck drops **when that player finishes the test**, else at their window close (§ 4) |
| Q37 | Score authority | **client reports, server stores** — unverifiable by design, upgradeable to event-based later (§ 5.6) |
| Q44 | Cap on "already learned" strikes | **none** — every strike writes Mastered to the striker's own card, so it is self-policing (§ 3.2) |
| Q45 | Challenge round length / filler ladder | **all 12 contested words appear in every round**; filler descends **Mastered → Comfortable → Target → Unfamiliar → lent** (§ 5.2) |
| Q46 | Withdraw, decline, and challenge spam | **withdraw** (row deleted) + **decline** (blocks the pair until next Monday) + a per-pair **"no challenges" block**: two booleans on `friendships`, either one suppresses challenges both ways (§ 1) |
| Q52 | Shape of the data model | **one table** — words, rounds and deck ids are jsonb on `study_challenges`; nothing about a challenge is stored on `vet` or `decks` (§ 9) |
| Q53 | Race on the shared `rounds` jsonb | **one DAL function, one statement** — a `\|\|` merge with an `IS NULL` path guard; no ETag/version column, which would solve a round-trip problem this shape does not have (§ 9). It was `jsonb_set` until 2026-08-22, which silently discarded every player's first round — see the warning in § 9 |
| Q54 | Challenge words vs vet as source of truth | **they never overlap** — the challenge owns "which words"; vet owns "is it in the library". Deleting a card mid-challenge loses the *study* deck entry, never the challenge word (§ 9) |
| Q55 | How a contested word is rendered | list from `study_challenges.words`; **values hydrated from vet, falling back to det**. The two players may see different senses — accepted, each plays their own card. Marks with no vet row are always skipped (§ 9) |
| Q56 | Schema sign-off | **approved 2026-08-16** — `study_challenges`, `decks."editMode"`, the two `friendships` booleans, and the partial unique index (§ 9) |
| Q57 | Setting the block mid-challenge | **only blocks new challenges** — the in-flight one plays out. Keeps a one-tap toggle from becoming an escape hatch; unfriending remains the hard exit (§ 1) |
| Q58 | A game is removed while challenges hold its id | **a scheduling rule, not runtime handling** — retire it from the challenge-eligible pool a week before deleting it. Written into [GAMES_FEATURE.md](./GAMES_FEATURE.md) |
| Q59 | Account deletion mid-challenge | **let it cascade** — the challenge row and its history vanish for both sides, matching how `friendships` already treats a deleted account (§ 9) |
| Q27 | Set size | **fixed at 9** (`CHALLENGE_WORD_COUNT`; 10 until 2026-08-17, 12 until 2026-08-28) — a constant, not a choice (§ 8.4). Changing it is one edit plus copy, but it moves the per-round contested ceiling (9 × 100 = 900) and obliges Word Search's board to hold that many (§ 5.2) |
| Q60 | Where the time-triggered work runs | **a third step in the hourly `cow-maintenance` unit**, not a new schedule; four passes, including a sweep for preset decks orphaned by Q59's cascade (§ 9) |
| Q61 | Testing a week-long, cron-driven feature | **test on prod** — it has no users yet and is effectively a PPE. No dev-only clock offset and no trigger endpoints (§ 9) |
| Q62 | Who chooses the variant | **the challenger**, stated in the invitation; cross-language pairs get different-word only (§ 8.4) |
| Q63 | Is the game sequence visible before Friday | **no** — drawn at issue, revealed at window open, and **omitted from the payload** until then so the rule is server-enforced (§ 5.1b) |
| Q65 | Per-user challenge cap | **6 active at once** (`MAX_ACTIVE_CHALLENGES`), **per (user, language)**, spent only by your own issue/accept — pending invitations never consume a slot (§ 1) |
| Q66 | Switching active language mid-challenge | **the challenge is invisible until they switch back**; nothing is lost. The language-blind badge (Q48) is the only thread back to it (§ 1) |
| Q67 | Challenges page with no friends | **bare empty state**, consistent with the app's other empty surfaces (§ 1) |
| Q68 | Bubble Match's ±500 survival bonus dominating a round | **kept as specified** — Bubble Match is a survival game and the all-or-nothing cliff is the format (§ 5.4) |
| Q64 | Results-page detail | **totals and per-game scores only**; no per-word comparison — it would tax every game's scoring contract permanently (§ 6) |
| Q47 | Cold-start players | **no gate** — never block on card count; different-word mode is the answer to a level mismatch (§ 3.1) |
| Q40 | Round order / replays | **strictly sequential, one attempt each**; a round row is written at the first mark and is immutable once final (§ 5.1a). No longer literally insert-only — the claim is written before the score is known — but a completed round is still never rewritten |
| Q41 | Unfriending mid-challenge | **challenge becomes `no_contest`**, decks dropped, unfriend never blocked; resolved history survives (§ 6) |
| Q42 | Excluding previously contested words | **no exclusion** — the core-band filter is the memory (§ 3.1) |
| Q43 | Post-challenge history surface | challenges page is a **list of friends** with the **reigning-champion crown** on the row and **no lifetime record**; a **History** button opens the paginated log with sort-by-time and friend/game filters (§ 1) |
| Q38 | Which language a same-word challenge uses | the **challenger's active language**; the challenges page is language-scoped, so the challengee must be in that language to see it (§ 1) |
| Q48 | How a challenge is announced | **in-app badge chain only** — no push, no email; a player who never opens the app in the window misses it, and the badge must ignore language scoping (§ 1) |
| Q49 | Word identity of a challenge word | **`(language, word1)` denormalised**, no det FK — det ids are not stable across data deploys (§ 9) |
| Q49a | How a stored challenge word gets the fields it DRAWS with | **Resolved late, on the read path.** `StudyChallengeService.toSummary` calls `IStudyChallengeDAL.findDisplayFieldsByWords` once per challenge and attaches `pronunciation`, `definition` (the lead gloss), `frequencyScore`, `iconId` and `dictionaryEntryId` to each `ChallengeWord` in the payload. They are read-path fields only — never written to the `words` jsonb, which stays identity-only per Q49 — and all are absent for a word whose det row has gone away, which draws as a bare word rather than failing the read. Without them the challengee's review screen shows characters with no pinyin and no English while the challenger's identical screen (built from candidates) shows both, and "do I already know this word" is not answerable from the characters alone. (Was `findPronunciationsByWords`, pinyin only, until the review screen moved to mini preview cards.) |
| Q50 | Player's timezone changes mid-challenge | **live** — always the current `users.timezone`, nothing snapshotted; a window may move, and closing early yields `no_contest`, never a loss (§ 2) |
| Q51 | Reward for winning | **none** — crown only. Rounds already pay normal minute points, and any payout is farmable by colluding friends (§ 6) |
| Q30 | Deck-name collisions | **allow duplicates** — the owning challenge distinguishes them internally, the friend's icon visually. Requires making `decks_user_language_name_uniq` partial (`WHERE "editMode" = 'custom'`) (§ 4) |
| Q39 | Challenge issued into a language the challengee does not study | **do nothing** — accept the silent expiry; blocking or warning needs a friend's-languages payload not worth adding (§ 1) |
| Q18 | How long the inviter waits in the live waiting room | **1 minute**, plus an always-available Cancel; on expiry the inviter returns to the challenge screen and does **not** fall back to async. Retry is free and unlimited ([live doc](./STUDY_CHALLENGE_LIVE.md) § 5) |
| Q19 | Live-mode transport | **WebSocket** at `/api/ws` — nginx already forwards the upgrade, one backend container means in-process rooms ([live doc](./STUDY_CHALLENGE_LIVE.md) § 2) |
| Q20 | Desertion mid-round | **no grace period at all** — the game continues and banks what the absent player had. Makes live the one exception to § 5.8's pause rule ([live doc](./STUDY_CHALLENGE_LIVE.md) § 6) |
| Q74 | Are the 12 contested words visible during play? | **No** — the board is completely normal, no marking and no pre-round list. Keeps filler words played at full effort (they write real marks), costs three game pages nothing, and follows from § 5.7's own premise |
| Q75 | Word Search's per-second penalty under the pause rule | **it pauses with the clock** — and the audit found it **already does**: Word Search is the only game that listens for `visibilitychange` today. Its `pauseTimer`/`resumeTimer` pair is the reference the other three generalise from (§ 5.8) |
| Q77 | What identifies a challenge's WEEK | **an integer counter — whole weeks since Monday 2026-01-05 00:00 UTC** (`study_challenges."weekIndex"`, migration 150), not a per-challenger instant. Decided 2026-08-17 after the timestamptz version let a crossing cross-timezone pair create two challenges in one week. The counter has no timezone parameter ON PURPOSE: a week identity that varies by who is asking cannot be a unique index. **Amended 2026-08-23:** the counter still NAMES the week, but it no longer STARTS it — a challenge is stamped with the challenger's own week (`localChallengeWeekIndex`), so a week opens at Monday 04:00 local like every other boundary. The original "accepted cost" (the issue window rolling at Monday 00:00 UTC) turned out to be a bug east of UTC, not a cost: a Shanghai challenger issuing in the 4h before the roll got the outgoing week and a challenge already past its accept deadline. The cross-timezone crossing case the counter was introduced to fix is now held by the live-pair guard (§ 2 "When a week opens") instead of by the unique index alone. Deadlines are untouched and stay per-player local — they are derived from the index's Monday DATE plus each player's own zone (`weekBoundary`, `server/shared/challengeWeek.ts`; the same arithmetic as `DATE '2026-01-05' + 7 * "weekIndex" + N` in the cron SQL). The epoch is duplicated in three files and is called out in all three. Pinned by `server/__tests__/challengeWeek.test.ts` and `server/__tests__/studyChallengeIssueWeek.test.ts`. |
| Q76 | Where contested/filler scoring rules live | **a declarative `ChallengeScoringSpec` on `GameDef`** applied by a shared runner, not a per-game callback or a self-reported total. Only a declarative form lets live mode score the same events server-side without the game page existing (§ 5.4) |
| Q21 | Live invite delivery with no push infrastructure | **not needed** — a permanent waiting-room entrance is the mechanism; the ping (banner, or push under Capacitor) only widens discovery and is capped at one per day per (sender, target) ([live doc](./STUDY_CHALLENGE_LIVE.md) § 4) |

### Still open

**Nothing in this document is open.** Q1–Q68 are all settled above; Q18–Q21 were settled
on 2026-08-16 in [STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md), which continues the
numbering from Q69. **Q69–Q73 are all settled there too, as of 2026-08-16 — there is no
open design question left in either document.** What remains before a build is the
prerequisite doc work listed in § 12, not a decision.

---

## 12. Code ↔ doc dependencies

This document describes (phase 1 is fully built — see the status table at the top;
§ 7 live mode is not):
`database/migrations/148` + `150` + `156` (taunts, § 6a),
`database/cron/expire-study-challenges.sql`,
`server/shared/challengeWeek.ts`,
`server/__tests__/challengeWeek.test.ts`,
`server/__tests__/studyChallengeStatus.test.ts` (the lapsed-accept derivation),
`server/__tests__/studyChallengeIssueWeek.test.ts` (the local week open + the live-pair guard — § 2),
`server/__tests__/studyChallengeRound.test.ts` (the round gate — § 5.2a),
`server/contracts/wire.ts`,
`server/dal/{interfaces,implementations}/StudyChallengeDAL`,
`server/services/StudyChallengeService.ts`,
`server/services/ProvisionalCardService.ts` (provision mode),
`server/services/DeckService.ts` (temp decks),
`server/controllers/StudyChallengeController.ts`,
`server/routes/studyChallengeRoutes.ts`,
`src/api/studyChallenges.ts`,
`src/features/studyChallenge/*` — specifically
  `challengeLabels.ts` (the seven-state lexicon — § 1),
  `ChallengeSheet.tsx` + `ChallengePanel.tsx` (issue / waiting / incoming — § 3.2),
  `ChallengeWordCard.tsx` (the two-tap strike — § 3.2),
  `ChallengeDetailPage.tsx` + `ChallengeDetailHeader.tsx` + `ChallengeTestCard.tsx` (the two pages — § 5.4b),
  `ChallengeHelpPopup.tsx` + `challengeHelpSteps.ts` + `src/assets/challengeHelp/` (the explainers — § 5.4c),
  `ChallengeResults.tsx` (results and taunts — § 6/§ 6a),
  `ChallengeHistoryPage.tsx` (the tinted log — § 1),
`src/games/types.ts` + `src/games/registry.ts` (`challengeScoring`, and `glyph`, which
`challengeLaunch.ts` reads so the round row shows the same mark the Games hub does),
`src/theme/colors.ts` → `hlRed`/`hlYellow`/`hlGreen`/`hlBlue` (the dark-ground
highlights, used ONLY by the round scoreboard),
`src/games/runtime/{challengeScoring,useChallengeRound,challengeLaunch}.ts` +
`ChallengeRoundScoreboard.tsx` (the round runner — § 5.2a),
`src/games/match-speed/challengeDeal.ts` (the alternation rule — § 5.3),
`src/games/{match-speed,bubble-match,word-search,hydra-bubbles}/*` (scoring emission, challenge mode),
`src/games/__tests__/{challengePool,challengeScoring,challengeDeal}.test.ts`,
`server/services/OnDeckVocabService.ts` → `getChallengeGamePool` + `getWordSearchGrid(challenge)`,
`server/controllers/OnDeckVocabController.ts` → `resolveChallengeRound`,
`server/services/StudyChallengeService.ts` → `getRoundContext`, `resolveAnytime`,
`nextFreeWeekForPair`,
`src/features/friends/*` (the Challenges NodePage and its badge).

**The build queue is CLOSED** (2026-08-22) — its DEFERRED_WORK.md § 1 entry has moved
to that file's "Recently closed" section. Phase 2 (live mode) is a separate design and
is not queued.

**Owed to other docs before this is built** — ✅ **all done 2026-08-16**, while Arena was
being built. Each entry names what landed, so a reader can tell whether the target doc has
drifted since:
* ✅ [GAMES_FEATURE.md](./GAMES_FEATURE.md) — **"Backgrounding pauses the clock"**, written
  unconditionally (live mode is *not* an exception; it bounds absence with an AFK forfeit
  instead), with the four-game audit table: **Word Search already implements it**, the
  other three need the signal wired into a `clockPaused` gate they already have.
* ✅ [GAMES_FEATURE.md](./GAMES_FEATURE.md) — **"Challenge-eligible games: the
  `challengeScoring` contract"** (§ 5.4), including why it must be declarative data rather
  than a callback, and the finding that a moded game is eligible **per mode**, so a stored
  game sequence needs a `(gameId, mode)` pair for Word Search rather than a bare id.
* ✅ [GAMES_FEATURE.md](./GAMES_FEATURE.md) — **"The live idle signal"**, plus two new
  steps in the add-a-game checklist.
* [GAMES_FEATURE.md](./GAMES_FEATURE.md) — ✅ **done**: the two-phase game-retirement rule
  (disable for challenges, wait a week, then remove), under "Removing a game" (Q58).
* ✅ [FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md) — § 1b (the Challenges NodePage, and the
  badge chain with its deliberate language-scoping exception), the two block booleans in
  § 2, and § 8 rewritten (blocking is no longer "not built").
* ✅ [DECKS_FEATURE.md](./DECKS_FEATURE.md) — `decks."editMode"` and the partial-index
  change in § 1, the preset mutation guard in § 2, and the fifth `/decks` section
  (Challenges) in § 4.
* ✅ [STREAK_EXPIRATION_CRON.md](./STREAK_EXPIRATION_CRON.md) — the planned third
  `ExecStart` step with its four passes and pass-4 safeguards, the `Description=` update,
  and a new warning that a **unit-template** change (unlike a SQL change) is not rolled out
  by a git pull alone.

Related docs:
[STUDY_CHALLENGE_LIVE.md](./STUDY_CHALLENGE_LIVE.md) (**phase 2** — the live/synchronous
half of this design: transport, room, invite, collapse),
[FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md) (the friend graph this is built on),
[PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) (lending, and the new mode),
[DECKS_FEATURE.md](./DECKS_FEATURE.md) (temp decks, collection launch),
[GAMES_FEATURE.md](./GAMES_FEATURE.md) (the registry and the pause rule),
[MASTERY_REWORK.md](./MASTERY_REWORK.md) (mark types, utcm bands),
[MATCH_SPEED_GAME.md](./MATCH_SPEED_GAME.md), [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md),
[MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md) (local-day derivation precedent).
