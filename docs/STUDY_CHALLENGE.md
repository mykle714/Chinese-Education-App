# Study Challenge

A weekly head-to-head between two friends: agree on a set of words on Monday, study
them all week, then play the same three games against that set and compare scores.

**Status: DESIGN / DRAFT.** Nothing here is built. No migration has been written and
no table exists yet — every table and column below is a **proposal awaiting
confirmation** (§ 11 collects the open questions). This document is the spec the
implementation will be written from, not a record of what shipped.

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

A temp deck is a `decks` row with a new flag, proposed as **`decks.origin`**
(`'user' | 'challenge'`, default `'user'`) plus a nullable
**`decks."challengeId"`** back-reference:

| Property | User deck | Temp (challenge) deck |
|---|---|---|
| Created by | user | `StudyChallengeService` on accept |
| Renamable / deletable by user | yes | **no** |
| Card add/remove by user | yes | **no** |
| Counts against `MAX_DECKS_PER_LANGUAGE` (100) | yes | **no** |
| Lifetime | until deleted | until the **Monday 04:00 after the challenge resolves** |

**Lifetime:** the deck survives the results week and is then dropped by the same sweep
that expires challenges. Nothing meaningful is lost — deleting a deck never deletes a
card or a mark ([DECKS_FEATURE.md](./DECKS_FEATURE.md) § 1), the words stay on the
account, and the set itself is stored permanently in `study_challenge_words`, so
challenge history renders from the history table and never depends on the deck existing.
If a "study this old set again" action is ever wanted, it rebuilds a deck from history
rather than requiring one to have been kept.

**"Their own pool of deck slots" means exactly one thing: they do not detract from the
100.** There is no user-visible slot capacity to build — the count query behind
`MAX_DECKS_PER_LANGUAGE` simply filters to `origin = 'user'`. A learner in three
challenges still has all 100 of their own deck slots available.

Enforcement is one guard in `DeckService`: every mutation (`rename`, `delete`,
`setMemberships`, and the membership PUT) rejects a deck whose `origin <> 'user'` with
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
actually remembers about a set of ten words. (The name is generated, so the usual
per-(user, language) unique-name index needs a collision answer: two challenges against
the same friend in the same language can't both be `vs Bob`. See Q30.)

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
| `mastered-first` | the player's **Mastered** cards first (most recently mastered first — `masteredAt`, migration 142), then fall back to `default` | study challenge |

`mastered-first` exists so the filler is *not* a source of difficulty: a challenge is
meant to measure the 10 contested words, and padding the board with words the player
has never seen would add noise (and, worse, would reward whoever got luckier filler).
Filler the player already owns is near-free points for both sides — which is why filler
is worth **20 points instead of 100** (§ 5.4).

The mode is a parameter on `ProvisionalCardService.ensureBaseline` / `lendCards` and
travels on the pool request as `?provisionMode=`. When a player has no mastered cards,
`mastered-first` degrades silently to `default`.

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
scoring function. This is a registry-level contract, not a per-game afterthought:

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

---

## 6. Results, winner, and no contest

* Async: once **both** players have completed all three games, the results page opens
  for both. Neither can see the other's breakdown before finishing their own — a
  known target score would change how the last game is played.
* The results page declares a **winner** at the top (higher total), then shows both
  players' per-game breakdowns side by side. Ties → **draw** (Q16: tiebreak or plain
  draw? draft: plain draw).
* **No contest**: if the test window closes with either player incomplete, the
  challenge ends `no_contest`. Not a forfeit — a player who finished still sees their
  own score, but no winner is declared. (Q17: is an unaccepted challenge also
  `no_contest`, or a distinct `expired`? Draft: distinct — `expired` never had a word
  set both players agreed to.)
* **Every challenge is recorded permanently**, including the words and the outcome, so
  a pair's history is browsable. That is what makes the word set worth storing on the
  challenge row rather than only in the temp decks (which may be cleaned up — Q9).

---

## 7. Live (synchronous) mode

Either player may, during the test window, press **Play live**. That player enters a
waiting room and the other receives an invitation to join. Once both are in, the three
games are administered **synchronously**.

Between games both players see both breakdowns and **both must confirm** to advance.

Rules for the messy parts:

| Situation | Behaviour |
|---|---|
| A player confirms, then **leaves the app** | their confirmation is **revoked** — the room must not advance into a game one player is not present for |
| A player leaves **after a game has started** | the game runs without them; they score whatever they had and risk losing |
| A game with **no natural time limit** | must gain one for live mode, after which it terminates and banks the points earned so far |
| The invitee never joins | the inviter falls back to async (Q18: after how long?) |
| The window closes mid-session | `no_contest`, same as async |

⚠️ **This is the largest unbuilt dependency in the feature.** The repo has **no
realtime transport today** — no WebSocket server, no SSE endpoint, no push
notifications. Live mode needs, at minimum:

1. a **transport** (WebSocket vs. SSE + POST vs. short polling — Q19);
2. a **room/session model** on the server (who is in, who has confirmed, which round);
3. **presence/liveness** — "left the app" must be *detected*, which means heartbeats
   plus a `visibilitychange` signal, and a grace period so a 3-second reconnect is not
   a desertion (Q20);
4. an **invite notification** to a player who is not currently on the challenge screen
   — with no push infrastructure, this can only reach a player who has the app open
   (Q21).

**Settled: live mode is phase 2 and gets its own document** (`docs/STUDY_CHALLENGE_LIVE.md`
when it is designed). Everything in §§ 1–6 is buildable on the existing
request/response stack; nothing in § 7 is. This section stays here as the statement of
intent so the async build does not accidentally foreclose it — concretely, phase 1 must:

* store per-round scores as they complete (§ 9 `study_challenge_rounds`), not only a
  final total, so a synchronous round-by-round comparison has something to read;
* keep every game's scoring in a declarative `ChallengeScoringSpec` rather than inside
  the page, so a live round can score the same events server-side;
* give every game a **run length** the server knows about, since live mode's
  "the game runs without them" rule needs a deterministic end.

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

### 8.4 Still open here

* **Q27 — Set size.** Still 10 each, or may a player choose fewer/more?
* **Q29 — Who chooses the variant?** Draft: purely the challenger's, stated in the
  invitation, so the challengee accepts a known format.

---

## 9. Proposed data model

⚠️ **All of the following is proposed and unconfirmed.** Migration numbers start at
**145** (144 is the highest existing file).

### `study_challenges`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `challengerId` / `challengeeId` | uuid → `users(id)` CASCADE | direction matters permanently here (unlike `friendships`) |
| `variant` | varchar(16) | `'same_word' \| 'different_word'` |
| `challengerLanguage` / `challengeeLanguage` | varchar(8) | equal unless cross-language |
| `status` | varchar(16) | `pending \| accepted \| declined \| expired \| complete \| no_contest`. There is **no** "accepted but unpicked" state — see § 8.2 |
| `gameSequence` | jsonb | the 3 chosen game ids **in order**, drawn once, shared |
| `issuedAt` | timestamptz | the UTC anchor every local boundary is derived from |
| `acceptedAt`, `completedAt` | timestamptz null | |
| `winnerUserId` | uuid null | null for draw / no contest |

### `study_challenge_words`

One row per (challenge, player, word) — 10 rows per player. Same-word challenges write
the same 10 words twice (once per player) so that **one shape serves both variants** and
the results page never branches.

| Column | Notes |
|---|---|
| `challengeId` → `study_challenges` CASCADE | |
| `userId` | which player's set |
| `language`, `word1` | the word, denormalised so history survives a det change |
| `vocabEntryId` | the player's vet row, once materialised |
| `position` | 1–10 |

### `study_challenge_rounds`

One row per (challenge, player, round) — the score record the results page reads.

| Column | Notes |
|---|---|
| `challengeId`, `userId`, `roundIndex` (1–3) | |
| `gameId` | must match `gameSequence[roundIndex]` |
| `score` | int, may be negative (Q15) |
| `breakdown` | jsonb — the itemised lines § 5.5 renders |
| `completedAt` | |

### Changes to existing tables

* `decks.origin varchar(16) NOT NULL DEFAULT 'user'` + `decks."challengeId" uuid NULL`
  — § 4.
* `vocabentries_*` — **no change**; challenge words are ordinary vet rows.

### Live mode (phase 2)

`study_challenge_sessions` (room state: participants, current round, per-player
confirmation, heartbeat timestamps). Deliberately deferred with § 7.

---

## 10. Layering map (proposed)

| Layer | File | Responsibility |
|---|---|---|
| Contract | `server/contracts/wire.ts` | `CHALLENGE_WORD_COUNT`, `CHALLENGE_ROUND_COUNT`, eligible-game list, `ProvisionMode` |
| DAL | `server/dal/implementations/StudyChallengeDAL.ts` (+ interface) | the three tables; **no policy** |
| DAL | `ProvisionalCardDAL` | new `mastered-first` candidate query |
| Service | `server/services/StudyChallengeService.ts` | windows/time zones, candidate selection, replacement, accept transaction, scoring persistence, winner resolution |
| Service | `server/services/ProvisionalCardService.ts` | `mode` parameter |
| Service | `server/services/DeckService.ts` | temp-deck creation + the `origin <> 'user'` mutation guard |
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

### Still open

| # | Question | Draft answer |
|---|---|---|
| Q18, Q20, Q21 | Live-mode timings, presence, invite delivery | deferred to the live-mode doc |
| Q30 | Deck-name collisions: two challenges against the same friend in the same language both want `vs Bob` | suffix the week (`vs Bob · Aug 14`) only on collision |

---

## 12. Code ↔ doc dependencies

This document will describe (nothing exists yet):
`database/migrations/145+`,
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
`src/games/{match-speed,bubble-match,word-search}/*` (scoring emission, challenge mode).

Related docs:
[FRIENDS_FEATURE.md](./FRIENDS_FEATURE.md) (the friend graph this is built on),
[PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) (lending, and the new mode),
[DECKS_FEATURE.md](./DECKS_FEATURE.md) (temp decks, collection launch),
[GAMES_FEATURE.md](./GAMES_FEATURE.md) (the registry and the pause rule),
[MASTERY_REWORK.md](./MASTERY_REWORK.md) (mark types, utcm bands),
[MATCH_SPEED_GAME.md](./MATCH_SPEED_GAME.md), [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md),
[MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md) (local-day derivation precedent).
