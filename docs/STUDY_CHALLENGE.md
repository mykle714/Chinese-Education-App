# Study Challenge

A weekly head-to-head between two friends: agree on a set of words on Monday, study
them all week, then play the same three games against that set and compare scores.

**Status: PART BUILT ON DEV (2026-08-17), nothing on prod.** The schema and the whole
async server stack exist; the games, the client and the maintenance job do not. Build
order and remaining steps: [DEFERRED_WORK.md](./DEFERRED_WORK.md).

| Step | State |
|---|---|
| **Migration 148** — `study_challenges`, `decks."editMode"`, the two `friendships` block booleans, the partial name index | ✅ applied and verified on dev |
| **Contract** — `CHALLENGE_WORD_COUNT`/`ROUND_COUNT`, `MAX_ACTIVE_CHALLENGES`, `ProvisionMode`, `CHALLENGE_GAMES`, the scoring/breakdown types | ✅ `server/contracts/wire.ts` |
| **Server** — DAL, service, controller, routes, DI, the preset-deck guard, the unfriend hook | ✅ smoke-tested end to end on dev |
| **`mastered-first` provisioning** | ✅ `ProvisionalCardDAL.findOwnCardsByBand` + `ProvisionalCardService.getFillerPool` (the full ladder: Mastered → Comfortable → Target → Unfamiliar → lent), and the `ProvisionMode` parameter threaded through `ensureBaseline`/`lendCards`. Band ordering verified against dev data |
| **Games** — the shared scoring runner, the registry↔pool sync test, pause-on-background | ⚠️ **partly built.** Done: `src/games/runtime/challengeScoring.ts` (the declarative spec runner, 15 unit tests against the real specs), `challengeScoringFor` on the registry, `src/games/__tests__/challengePool.test.ts` (5 tests — the thing that keeps eligibility registry-derived), and **pause-on-background wired into Bubble Match, Match Speed and Speed Reading** via `useBackgroundPause` + `GamePausedOverlay`. **Not done: the per-game board integration** — see the row below |
| **The scored round runner** — the one remaining piece | ❌ not started. Needs (a) a challenge-board pool read that returns the ten contested cards plus `mastered-first` filler, extending the existing `/api/onDeck/gamePool` path rather than adding a second pool loader; (b) each of the three eligible games classifying its board cards as contested/filler at generation and emitting `ChallengeEvent`s into the runner; (c) Match Speed's alternation rule (§ 5.3); (d) the between-games scoreboard and the round POST. The server, the contract, the scoring maths and the provisioning ladder for all of this exist and are tested — what is missing is the wiring inside the three game pages |
| **Client** — `src/api/studyChallenges.ts`, `src/features/studyChallenge/*`, the `/friends/challenges` NodePage + its badge, the fifth `/decks` section | ✅ built on dev. The one gap is the **scored round runner**, which belongs to the games step — the detail page lists the drawn rounds but cannot play them yet, and says so on screen |
| **Maintenance job** — `database/cron/expire-study-challenges.sql` and its `ExecStart` step | ✅ written; all four passes exercised on dev with backdated fixtures, and idempotent on re-run. ⚠️ **Inert on prod until `install-timers.sh` re-renders the unit** — a git pull does not roll out a unit-template change, and until it does nothing expires |
| **Runbook** | ✅ [STUDY_CHALLENGE_DEPLOY_RUNBOOK.md](./STUDY_CHALLENGE_DEPLOY_RUNBOOK.md) — migration 148 must precede the restart, and the systemd unit must be **re-rendered** or the whole time-triggered half stays inert |

⚠️ **Migration 148, not 147.** 147 was claimed by the `compute_utcm_category` drop and
had already been applied to dev, so this one moved (CLAUDE.md § Migration number
collisions).

⚠️ **One column was added that § 9 does not list: `study_challenges."weekStart"`.**
§ 1 specifies uniqueness as `(challengerId, challengeeId, week)` unordered, but a week
cannot be an index expression — resolving `users.timezone` is not `IMMUTABLE`, so
Postgres refuses it. `weekStart` stores the challenger's Monday 04:00 local as a UTC
instant, and the unique index over `(LEAST, GREATEST, weekStart)` then enforces the
weekly pair rule **and** the § 1 decline cooldown with no separate rate limiter.
Signed off 2026-08-17. It does not contradict Q50: deadlines are still recomputed live
from the player's current timezone, and only the challenge's *week identity* is fixed.

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
| **Same-word** | ONE set of 10, negotiated by both players, used by both | both players play the **same** language |
| **Different-word** | each player gets their **own** 10, chosen by their own flow | may be **cross-language** (§ 8) |

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
 │ Bob            👑            Play test  ▸   │   ← accepted, Friday open
 │ Carol                     Review words  ▸   │   ← she challenged you, pending
 │ Dan            👑              Challenge    │   ← nothing active
 │ Erin                       Waiting on her   │   ← you challenged, pending
 └─────────────────────────────────────────────┘
```

* **One row per friend**, always present, whether or not a challenge is active. The row
  is the challenge's whole lifecycle: *Challenge* → *Waiting on them* / *Review words* →
  *Play test* → *See results*. There is never a second place to look.
* **Reigning champion** (👑) marks whoever won the pair's **most recent resolved**
  challenge. It sits on the row as a standing claim, and the next challenge is framed as
  taking it. A `no_contest` or a draw leaves the previous champion in place — the crown
  changes hands only when someone wins.
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
friend's row itself showing *Review words*. Every one of those counts rides the payload
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
* **"No challenges with this friend"** — a per-friend toggle on the friend row, a
  durable opt-out independent of the weekly cooldown.

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
browsable. Each entry shows the opponent, the week, the word set, both totals with
breakdowns, and the outcome.

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
| Issue window opens | **challenger's** | Monday 04:00 local |
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

Boundaries are computed on demand from a stored UTC anchor plus each user's timezone —
**not** stored as pre-computed local timestamps, which would go stale the moment a
player travels.

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

## 3. Same-word challenge — choosing the 10 words

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

### 3.2 Confirmation flow

Both players run the **same** screen, at different times:

```
challenger:  [see 10 words] → mark any "I already know this" → replaced → confirm → PENDING
challengee:  [see the 10]   → mark any "I already know this" → replaced → accept  → ACCEPTED
```

* Marking a word **already learned** removes it and pulls the next word from the same
  ranked candidate list — the replacement runs through the identical logic, with every
  word already shown (and every word rejected) excluded.
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
* No word may repeat within the set, and the set is exactly 10 (`CHALLENGE_WORD_COUNT`).

**There is no limit on strikes.** A player may reject all 10, and the 10 replacements
after that, indefinitely. No cap, no "you have 3 left" copy, no special state — the
mechanism polices itself, because **every strike writes Mastered onto the striker's own
card**. Reshuffling toward an easier set costs you a permanently inflated mastery record
and removes those words from discover and from every future challenge. The player who
games the picker is the only one harmed by it.

Two things this leaves the implementation responsible for:

* The replacement query re-runs per strike against an ever-growing exclusion list, so it
  must be **cheap and paged**, not a full re-rank of the candidate pool each time.
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

Accepting a challenge **is** the sorting decision. Both players saw all ten words, were
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

It renders the same `DeckTile` as every other set on the page (the page's governing
principle is that a built-in collection, a mastery bar and a user deck are all just "a
set of your cards"). Section header: **"Challenges"**. The section is **omitted
entirely** when the user has no active challenge deck, exactly as the `Mastered` section
is when no reading/writing goal is set.

**Each deck is named after the opponent — `vs Bob`** — because that is what the learner
actually remembers about a set of ten words.

**Duplicate names are allowed for challenge decks (Q30).** Two live challenges against
the same friend in the same language may both be called `vs Bob`; they are distinguished
by the challenge that owns them (§ 9) and, for the user, by the **friend's icon on the
deck tile**. The name is not the identifier.

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

Three games, drawn from the **Recognition** and **Production** tracks only —
reading and writing games are excluded ([MASTERY_REWORK.md](./MASTERY_REWORK.md) § the
mark-type table):

| Game | Track | Eligible |
|---|---|---|
| Bubble Match | recognition | ✅ |
| Match Speed | recognition | ✅ |
| Word Search — **Pinyin** | production | ✅ (zh only) |
| Word Search — No Pinyin | reading | ❌ |
| Speed Reading | reading | ❌ |
| Practice Writing | writing | ❌ |

That is exactly three eligible entries today, so today's "random" draw has one possible
answer — **the randomisation is built for the games that don't exist yet.** More
recognition/production games are planned, and the draw must be genuinely random the day
the fourth one lands, with no code change. It follows that:

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

Round *n+1* unlocks only when round *n* is submitted, and **a submitted round is final** —
no replay, no restarting the test. The player may leave between rounds and come back
(the test is a three-day window, not a sitting), and may pause mid-round (§ 5.8), but
they cannot re-roll a score.

This is what makes the running total in the between-games scoreboard (§ 5.5) mean
something: it is the real, committed score, not a provisional best-so-far. It also keeps
the async test structurally identical to the live one, which matters because live mode
(§ 7) is the same three rounds with a confirmation gate between them — if async allowed
replays, the two modes would be scored on different terms and no result would be
comparable.

The cost is accepted: a player who has one bad round carries it. That is what "a test"
means, and the three-day window plus the pre-study days (§ 4) are the compensating
generosity.

Server-side this is one invariant: a round row is **insert-only**. `POST` of a round that
already exists is rejected, not upserted, and the server refuses a submission for round
*n+1* until *n* is present — which also means a tampered client cannot skip straight to
the last round.

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
The contested 10 are removed from the pool first, so a contested word can never also
appear as filler. A player with a real library never reaches step 5; a brand-new player
(Q47) reaches it immediately, which is exactly the never-block behaviour
[PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) already guarantees.

Descending the bands rather than jumping straight to lending matters because filler
should be **the player's easiest available material**, and the player's own Unfamiliar
card — one they chose to sort — is still more familiar than a word the server lent them
sight-unseen.

`mastered-first` exists so the filler is *not* a source of difficulty: a challenge is
meant to measure the 10 contested words, and padding the board with words the player
has never seen would add noise (and, worse, would reward whoever got luckier filler).
Filler the player already owns is near-free points for both sides — which is why filler
is worth **20 points instead of 100** (§ 5.4).

The mode is a parameter on `ProvisionalCardService.ensureBaseline` / `lendCards` and
travels on the pool request as `?provisionMode=`. Every step degrades silently to the
next, so no caller ever has to check whether a player has mastered cards.

**All 10 contested words must appear in every round.** Filler pads the board out to the
game's natural size; it never displaces a contested word. This is what makes the
contested ceiling of 1000 points real in all three games and what makes the rounds
comparable to each other — a game whose natural board is smaller than 10 must run
longer in challenge mode rather than drop words. The one deliberate exception is Match
Speed, whose rolling buffer expresses this as an alternation rule instead (§ 5.3), and
whose alternation lapses to filler only once **all 10 have been dealt**.

**Vocabulary (settled).** The cards a challenge game pads with are not "provisional" in
the lending sense — they are usually the player's own mastered cards. So:

| Term | Means |
|---|---|
| **contested** | one of the challenge's 10 words — what the challenge is actually measuring |
| **filler** | every other card on the board, whatever its origin |
| **provisional** | reserved for its existing meaning: a card the server *lent* (`starterPackBucket = 'provisional'`) |

Filler is often provisional and often not; the scoring tables below key on
**contested vs filler**, never on the bucket.

### 5.3 Match Speed's alternation rule

Match Speed deals from a rolling buffer rather than a fixed board, so it needs an
explicit challenge mode: **every other pair filled must be a contested (non-filler)
pair.** With 10 contested words and a 30-second run this keeps contested words on the
board continuously without letting the board become 100% contested (which would
exhaust the set in the first few seconds).

**When the contested words run out mid-run, the alternation lapses and the rest of the
run is filler.** Contested words are **not** recycled back into the buffer.

The consequence is deliberate and worth stating: Match Speed's contested scoring has a
hard ceiling of **1000 points** (10 × 100), and a player who clears the set early spends
the rest of the run earning 20s. That makes *clearing the set* the goal of the round
rather than raw taps-per-second — the challenge is a measure of the ten words, so once
the ten words are answered the round has already said what it was built to say.

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
> +500 against +1000 for ten contested matches, surviving is worth roughly a third of the
> round, and losing forfeits it entirely. That is not an imbalance to tune away: Bubble
> Match *is* a survival game, and a challenge score that ignored whether the player
> survived would be scoring a different game than the one they played. The cliff is also
> what makes the last thirty seconds tense, which is the reason to draw this game at all.

**Word Search (Pinyin)**

| Event | Points |
|---|---|
| contested match | **+100** |
| filler match | **+20** |
| time penalty | **−10 per second** after 1:00 elapsed |
| hint used | **−20 each** |

> **Why Word Search gets the contested/filler split too**, despite the original spec
> stating a flat 100: its grid needs ten words with **mutually distinct characters**
> ([WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md) § 2), and an arbitrary set of ten
> contested words will not reliably satisfy that. The generator substitutes, so filler
> *does* reach a challenge grid — and at a flat rate a player whose set forced four
> substitutions is paid full price for four easy words. When all ten place cleanly the
> split is invisible, so it costs nothing and covers the case that will actually occur.

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

In **async** mode this card shows only the player's own numbers. The opponent's score —
per round or total — is not revealed until **both** players have finished all three
rounds (§ 6).

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

**The board looks completely normal, too (Q74).** The ten contested words are **not
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
  with several of the ten words banded up. That is the feature working, not a leak.
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
when they return. This is **not** a challenge-specific rule: it is a **new global
requirement on every game in the app**, and it removes async abandonment as a scoring
question entirely — there is no "abandoned round" to score, because rounds do not run
while nobody is watching.

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

* Async: once **both** players have completed all three games, the results page opens
  for both. **Nothing of the opponent's performance is visible until then** — not the
  total, not a per-round score, not "Alice is winning". Whoever plays second must play
  against the game, never against a number, or the mode quietly rewards playing late.
  The only opponent state a player may see beforehand is **progress**: "Bob hasn't
  played yet" / "Bob has finished", which is needed to know whether the challenge is
  waiting on you.
* The results page declares a **winner** at the top (higher total), then shows both
  players' per-game breakdowns side by side. **That is all it shows (Q64)** — totals and
  per-game scores, with **no per-word comparison**. A word-by-word table would be a nice
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
normalisation** by level or by the set's mean `frequencyScore`: each player's 10 words
are hard *for them*, which is the whole premise. Adding a handicap would re-introduce
exactly the level comparison the mode exists to avoid.

Identical in every respect except word selection, and therefore in language scope.

| | Same-word | Different-word |
|---|---|---|
| Word set | one shared set of 10 | one set of 10 **per player** |
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

* **Q27 — Set size is fixed at 10** (`CHALLENGE_WORD_COUNT`), not a choice. Set size
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
bookkeeping. This is safe because a challenge is **bounded**: exactly 2 players, 10 words
each, 3 rounds each, then it is finished forever. Unbounded collections would still
deserve their own table.

### `study_challenges` — the only new table

The whole feature is **one table**. A challenge is a small, bounded, self-contained
object: two players, ten words each, three rounds each, one outcome. Everything about it
is intrinsic to it, so everything lives on it.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `challengerId` / `challengeeId` | uuid → `users(id)` CASCADE | direction matters permanently here (unlike `friendships`) |
| `variant` | varchar(16) | `'same_word' \| 'different_word'` |
| `challengerLanguage` / `challengeeLanguage` | varchar(8) | equal unless cross-language |
| `status` | varchar(16) | `pending \| accepted \| declined \| expired \| complete \| no_contest`. There is **no** "accepted but unpicked" state — see § 8.2 |
| `gameSequence` | jsonb | the 3 chosen game ids **in order**, drawn once, shared |
| `words` | jsonb | **each player's 10 words**, keyed by user id — see below |
| `rounds` | jsonb | **each player's played rounds**, keyed by user id — see below |
| `presetDeckIds` | jsonb | `{ "<userId>": <deckId>, ... }` — the generated decks to drop on cleanup (§ 4) |
| `issuedAt` | timestamptz | the UTC anchor every local boundary is derived from |
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
| **Which 10 words is this challenge about?** | `study_challenges.words` — always, forever |
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
   never a deck query. This is what guarantees all 10 appear on every board (§ 5.2)
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
   SET rounds = jsonb_set(rounds, ARRAY[$2, $3], $4::jsonb, true)
 WHERE id = $1
   AND rounds #> ARRAY[$2, $3] IS NULL   -- insert-only: no replays (Q40)
RETURNING id;
```

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
| DAL | `server/dal/implementations/StudyChallengeDAL.ts` (+ interface) | the single `study_challenges` table, including the atomic `jsonb_set` round writes (§ 9); **no policy** |
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
([HUB_MENU_SYSTEM.md](./HUB_MENU_SYSTEM.md)), with a badge for "awaiting your
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
| Q27 | Set size | **fixed 10** (`CHALLENGE_WORD_COUNT`) — size changes the points available, so it must be equal anyway |
| Q29 | Who chooses the variant | **the challenger**, stated in the invitation. Cross-language pairs are offered different-word only |

| Q8 | Bucket for materialised contested words | **`library`** — accepting the set *is* the sorting decision; see § 3.3 |
| Q31 | Do challenge rounds write marks / earn minute points | **yes, both** — a challenge round is normal play (§ 5.7). No suppression flag |
| Q32 | Challenges in flight per week | **one per friend pair, unlimited friends** — cap the pair, not the user (§ 1) |
| Q33 | Async mid-round abandonment | **the question is dissolved** — backgrounding the app **pauses** the round, and this is a **global games requirement**, not a challenge rule (§ 5.8) |
| Q34 | Seeing the opponent's score before you play | **hidden until both finish**; progress ("has played") is visible, scores are not (§ 6) |
| Q35 | Entry point / how a challenge is discovered | a **Challenges NodePage reached from the Friends page**; badge rides the friends payload (§ 1) |
| Q36 | Study the challenge deck before Friday | **yes, that is the point** — and this *revised Q9*: the deck drops **when that player finishes the test**, else at their window close (§ 4) |
| Q37 | Score authority | **client reports, server stores** — unverifiable by design, upgradeable to event-based later (§ 5.6) |
| Q44 | Cap on "already learned" strikes | **none** — every strike writes Mastered to the striker's own card, so it is self-policing (§ 3.2) |
| Q45 | Challenge round length / filler ladder | **all 10 contested words appear in every round**; filler descends **Mastered → Comfortable → Target → Unfamiliar → lent** (§ 5.2) |
| Q46 | Withdraw, decline, and challenge spam | **withdraw** (row deleted) + **decline** (blocks the pair until next Monday) + a per-pair **"no challenges" block**: two booleans on `friendships`, either one suppresses challenges both ways (§ 1) |
| Q52 | Shape of the data model | **one table** — words, rounds and deck ids are jsonb on `study_challenges`; nothing about a challenge is stored on `vet` or `decks` (§ 9) |
| Q53 | Race on the shared `rounds` jsonb | **one DAL function, one statement** — `jsonb_set` with an `IS NULL` path guard; no ETag/version column, which would solve a round-trip problem this shape does not have (§ 9) |
| Q54 | Challenge words vs vet as source of truth | **they never overlap** — the challenge owns "which words"; vet owns "is it in the library". Deleting a card mid-challenge loses the *study* deck entry, never the challenge word (§ 9) |
| Q55 | How a contested word is rendered | list from `study_challenges.words`; **values hydrated from vet, falling back to det**. The two players may see different senses — accepted, each plays their own card. Marks with no vet row are always skipped (§ 9) |
| Q56 | Schema sign-off | **approved 2026-08-16** — `study_challenges`, `decks."editMode"`, the two `friendships` booleans, and the partial unique index (§ 9) |
| Q57 | Setting the block mid-challenge | **only blocks new challenges** — the in-flight one plays out. Keeps a one-tap toggle from becoming an escape hatch; unfriending remains the hard exit (§ 1) |
| Q58 | A game is removed while challenges hold its id | **a scheduling rule, not runtime handling** — retire it from the challenge-eligible pool a week before deleting it. Written into [GAMES_FEATURE.md](./GAMES_FEATURE.md) |
| Q59 | Account deletion mid-challenge | **let it cascade** — the challenge row and its history vanish for both sides, matching how `friendships` already treats a deleted account (§ 9) |
| Q27 | Set size | **fixed at 10** (`CHALLENGE_WORD_COUNT`) — a constant, not a choice (§ 8.4) |
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
| Q40 | Round order / replays | **strictly sequential, one attempt each**; round rows are insert-only (§ 5.1a) |
| Q41 | Unfriending mid-challenge | **challenge becomes `no_contest`**, decks dropped, unfriend never blocked; resolved history survives (§ 6) |
| Q42 | Excluding previously contested words | **no exclusion** — the core-band filter is the memory (§ 3.1) |
| Q43 | Post-challenge history surface | challenges page is a **list of friends** with the **reigning-champion crown** on the row and **no lifetime record**; a **History** button opens the paginated log with sort-by-time and friend/game filters (§ 1) |
| Q38 | Which language a same-word challenge uses | the **challenger's active language**; the challenges page is language-scoped, so the challengee must be in that language to see it (§ 1) |
| Q48 | How a challenge is announced | **in-app badge chain only** — no push, no email; a player who never opens the app in the window misses it, and the badge must ignore language scoping (§ 1) |
| Q49 | Word identity of a challenge word | **`(language, word1)` denormalised**, no det FK — det ids are not stable across data deploys (§ 9) |
| Q50 | Player's timezone changes mid-challenge | **live** — always the current `users.timezone`, nothing snapshotted; a window may move, and closing early yields `no_contest`, never a loss (§ 2) |
| Q51 | Reward for winning | **none** — crown only. Rounds already pay normal minute points, and any payout is farmable by colluding friends (§ 6) |
| Q30 | Deck-name collisions | **allow duplicates** — the owning challenge distinguishes them internally, the friend's icon visually. Requires making `decks_user_language_name_uniq` partial (`WHERE "editMode" = 'custom'`) (§ 4) |
| Q39 | Challenge issued into a language the challengee does not study | **do nothing** — accept the silent expiry; blocking or warning needs a friend's-languages payload not worth adding (§ 1) |
| Q18 | How long the inviter waits in the live waiting room | **1 minute**, plus an always-available Cancel; on expiry the inviter returns to the challenge screen and does **not** fall back to async. Retry is free and unlimited ([live doc](./STUDY_CHALLENGE_LIVE.md) § 5) |
| Q19 | Live-mode transport | **WebSocket** at `/api/ws` — nginx already forwards the upgrade, one backend container means in-process rooms ([live doc](./STUDY_CHALLENGE_LIVE.md) § 2) |
| Q20 | Desertion mid-round | **no grace period at all** — the game continues and banks what the absent player had. Makes live the one exception to § 5.8's pause rule ([live doc](./STUDY_CHALLENGE_LIVE.md) § 6) |
| Q74 | Are the 10 contested words visible during play? | **No** — the board is completely normal, no marking and no pre-round list. Keeps filler words played at full effort (they write real marks), costs three game pages nothing, and follows from § 5.7's own premise |
| Q75 | Word Search's per-second penalty under the pause rule | **it pauses with the clock** — and the audit found it **already does**: Word Search is the only game that listens for `visibilitychange` today. Its `pauseTimer`/`resumeTimer` pair is the reference the other three generalise from (§ 5.8) |
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

This document will describe (nothing exists yet):
`database/migrations/147+`,
`server/contracts/wire.ts`,
`server/dal/{interfaces,implementations}/StudyChallengeDAL`,
`server/services/StudyChallengeService.ts`,
`server/services/ProvisionalCardService.ts` (provision mode),
`server/services/DeckService.ts` (temp decks),
`server/controllers/StudyChallengeController.ts`,
`server/routes/studyChallengeRoutes.ts`,
`src/api/studyChallenges.ts`,
`src/features/studyChallenge/*`,
`src/games/types.ts` + `src/games/registry.ts` (`challengeScoring`),
`src/games/{match-speed,bubble-match,word-search}/*` (scoring emission, challenge mode),
`src/features/friends/*` (the Challenges NodePage and its badge).

**The build queue lives in [DEFERRED_WORK.md](./DEFERRED_WORK.md) § 1** — ordered steps,
the two unshipped migrations this one stacks on, and the trigger (Arena landing).

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
