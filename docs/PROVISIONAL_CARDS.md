# Provisional Cards — nothing blocks on card count

**Status:** implemented and on prod (migration 140, shipped 2026-08-08).

---

## 1. The philosophy

> **No game and no flashcards learn page may ever refuse to start because the learner
> does not have enough cards.**

This is a hard rule, not a goal. Every surface that used to say *"You need 20 Learn Now
cards to play — you have 3"* now says nothing at all: the server quietly **lends** the
learner the cards they are missing and the round starts.

Five separate minimums used to enforce this the other way. Each was a dead end that
punished exactly the learner who most needed to practise — the new one:

| Surface | Old block | File it lived in |
|---|---|---|
| Bubble Match | 20 (distribution sum) | `src/games/bubble-match/constants.ts` |
| Match Speed | 20 (`ENTRY_GATE_CARDS`) + "no on-mode cards" | `src/games/match-speed/constants.ts` |
| Speed Reading | 20 (`ENTRY_GATE_CARDS`) | `src/games/speed-reading/constants.ts` |
| Word Search | 10 distinct-character words | `src/games/word-search/constants.ts` |
| flp | 20 (`MIN_LIBRARY_CARDS`) | `src/features/flashcards/FlashcardsDecksPage.tsx` |

They are now **baselines** — how many cards the surface *wants*, not a bar the learner
must clear — and they live in exactly one place:
`CARD_BASELINES` in **`server/contracts/wire.ts`**, shared by both sides.

The only entry conditions that remain anywhere are the ones no amount of lending can
fix: **being signed out**, and **Word Search being Chinese-only**.

---

## 2. What a provisional card is

A **provisional card** is a real vet row (`vocabentries_zh` / `vocabentries_es`) in
bucket `'provisional'`, created by the server so a surface could reach its baseline.

It is a real row on purpose. The alternative — an ephemeral in-memory list — cannot
record a mark, and a learner who spends a whole game on a word must not lose that
progress. So:

* it has a real `id`, so `POST /api/flashcards/mark` works against it unchanged;
* it has a real `typedMarkHistory`, so utcm banding and cooldowns work unchanged;
* it is **hidden from every "my cards" surface** until the learner sorts it;
* it **persists** after the round. It is never garbage-collected, because deleting it
  would throw away the marks earned on it.

### The two-bucket rule

Every vet read must decide which bucket it means. Getting this wrong fails *silently*
in both directions, so the two predicates are centralized in
**`server/dal/shared/vetTable.ts`**:

```ts
vetSortedClause(alias?)      // "starterPackBucket" = 'library'
vetPlayableClause(alias?)    // "starterPackBucket" IN ('library','provisional')
vetProvisionalClause(alias?) // "starterPackBucket" = 'provisional'
```

**The rule of thumb (revised 2026-08-20):**

* Does the query **select cards**, for any purpose at all? → **SORTED**. That now
  includes the game pools and the flp working loop, which used to be the whole of
  PLAYABLE. A lent card reaches a round by being **named** (`lentIds` / `fetchRowsByIds`),
  never by satisfying a bucket predicate — see § 4b.
* Is it supply that is **not** card selection? → PLAYABLE. Exactly one read qualifies:
  Speed Reading's distractor *characters*, which decorate a round rather than being
  studied in it, and which a near-empty deck must still be able to produce.

Current classification (all call sites):

| Read | Clause | Where |
|---|---|---|
| `fetchGameCandidates` (all game pools) | SORTED **+ `lentIds`** | `OnDeckVocabService.ts` |
| `fetchFlpCandidates` (flp loop **and** refill — one shared source) | SORTED **+ `lentIds`** | `OnDeckVocabService.ts` |
| `fetchRowsByIds` (the lend tier's own read) | BY ID | `OnDeckVocabService.ts` |
| `countSorted` (what the baseline is compared against) | SORTED | `ProvisionalCardDAL.ts` |
| `findHeldProvisional` (the re-lend source) | PROVISIONAL | `ProvisionalCardDAL.ts` |
| `getLibraryDistractors` (Speed Reading filler characters) | PLAYABLE | `SpeedReadingDAL.ts` |
| `getLibraryCards` / `getMastered…` / `getNonMastered…` | SORTED | `OnDeckVocabService.ts` |
| `getCategoryCounts` (decks page deck sizes) | SORTED | `OnDeckVocabService.ts` |
| `findByUserIdAndLanguage`, `countByUserIdAndLanguage`, `searchEntries`, `findByDifficultyLevel`, `bulkFindByKeys`, `findByTokens`, `findEntriesCreatedAfter`, `findRelatedBySharedCharacters`, `findUsedInForCharacter` | SORTED | `VocabEntryDAL.ts` |
| community feed | SORTED | `CommunityLayoutDAL.ts` |
| `estimateLevel`, discover supply, quick-mark supply, `_hydrateCards.sorted`, `getProgress` | SORTED | `StarterPacksService.ts` |

Two by-id reads are **deliberately unfiltered** — `findByIdAndLanguage` and
`findByUserAndKey`. Bucket visibility is a property of *list* reads; "give me the row
whose id I already hold" must find a provisional card, or marks and the sort promotion
would break.

---

## 3. Which words get lent

`ProvisionalCardService.ensureBaseline` (policy) over `ProvisionalCardDAL.findCandidates`
(SQL). Selection order:

1. **Nearest level first** — `ABS(difficulty - level) ASC`, so in-level words come first
   and the search widens outward only as far as the data forces.
2. **Then commonality** — `frequencyScore DESC NULLS LAST`, so the most useful everyday
   word at that level is lent first.
3. **Then `id ASC`**, a stable tiebreak so repeat calls are deterministic.

Excluded by construction:

* any word the learner already holds a vet row for, **in either bucket** — so a word is
  never lent twice, and never lent when it is already in their deck;
* words they explicitly **skipped** in discover — unless fresh supply is exhausted, at
  which point a second pass recycles them (a skipped word beats not playing);
* words failing the supply gate (`discoverable = TRUE`, every language) —
  kept in step with the discover supply query so a lent word is always a word the sort
  flow can later offer.

The level comes from `StarterPacksService.estimateLevel` — the same cold-start seed
discover uses — so a lent card sits at the difficulty the learner would have been
offered to sort anyway. A brand-new learner estimates level 1 and is lent the most
common level-1 words (一, 一下, 一点, 三, 上, …), which is the right first experience.

**Supply exhaustion is not an error.** A learner who has sorted or been lent every
discoverable word gets `shortfall > 0` and a smaller round. Never a block screen.

---

### 3b. Re-lend before minting (unconditional since 2026-08-20)

*Code: `ProvisionalCardService.acquireLentCards` (policy),
`ProvisionalCardDAL.findHeldProvisional` (the re-lend query),
`ProvisionalCardDAL.findCandidates` (the mint query),
`OnDeckVocabService.fetchRowsByIds` (turning ids back into rows).*

`findCandidates` refuses any word the learner already holds **in either bucket** —
`'library'` means it is in their deck, `'provisional'` means it is already lent. That
is correct for *minting* a new row, but it made minting the **only** thing lending
ever did, so every unfilled slot grew the provisional holding by one row forever.

Every lend is now two steps, in order:

1. **Re-lend** — hand back provisional rows the learner **already holds**, nearest the
   target difficulty first. Costs nothing, mints nothing, and the row carries whatever
   marks it collected the last time it was out.
2. **Mint** — only what step 1 could not cover, via `findCandidates` as before.

`acquireLentCards` returns `lentIds` (both steps) plus `granted`/`grantedWords` for the
**minted** half alone — the "we lent you these cards" notice is about words the learner
is seeing for the first time; a re-lent row was announced when it was first minted.

**Why it became unconditional.** Until 2026-08-20 re-lending ran only for a
*tier-targeted* draw (Hydra asking for a colour), on the reasoning that every other
caller could already reach its held provisional rows through the ordinary pool query,
which was `vetPlayableClause`. That reasoning died with § 4b: selection is sorted-only
now, so a held row is invisible to every ordinary query, and mint-only lending would
have grown the bucket by a fresh batch on **every** round. Re-lending is what caps the
bucket at the learner's true deficit.

It is also what makes `countSorted` safe as the baseline's measure (§ 4b): a learner
who is 16 cards short is topped up from the 16 they already hold, not with 16 new ones,
however many times they enter.

**Cooldown.** Re-lending is a cheaper way to fill a slot, not a licence to re-serve a
resting card. `findHeldProvisional` does not filter on cooldown — that is per-surface,
since each cools on the mark type it emits — so the filtering happens where the rows
are turned back into cards: `fetchRowsByIds` drops any that are still resting (unless the
caller says the ids are an obligation — see its `ignoreCooldown`, which only a Study
Challenge board passes), exactly
as `fetchGameCandidates` splits fresh from cooled.

**Status: BUILT.** Tier-targeted since 2026-08-18 (with Hydra Bubbles), unconditional
since 2026-08-20. `OnDeckVocabService.fetchRelendable` is gone — its SQL moved to the
DAL as `findHeldProvisional`, which is where a query belongs.

### 3c. A lent card keeps its lend tier while it is lent

A provisional card's **difficulty tier** is what a caller means when it asks to lend
"an easier card" (Hydra's `bloom` tier asks for `L-1`, its `drain` tier for `L`). The tier is *not stored* — there is no new column — it is derived at
read time from the det row's existing `difficulty` (1..6, already joined by
`dictJoin.ts` and already present on `VocabEntry`) relative to the learner's estimated
level `L` (`StarterPacksService.estimateLevel`).

**While a card is lent, its tier is what the caller sees, even after it has marks.**
A card lent as a level-3 "green" stays green for as long as it is provisional, and does
not switch to its real utcm category once mark history accumulates. Payouts and pool
membership stay stable across a run, which is what the caller asked for when it drew
from that tier.

The card's real `typedMarkHistory` is untouched by this and keeps banding normally —
the tier is a *serving* label, not a mastery claim. On promotion (§ 7) the tier stops
applying and the card bands like any library card, off the history it accumulated while
lent.

> Consequence: tiers move when `L` moves. A learner whose estimated level rises
> re-labels their whole holding one step easier. That is accepted — the tier is
> relative to the learner by definition.

---

## 4. Where provisioning happens

Always server-side, implicitly, when a surface fetches its card set. The client never
asks for cards to be lent.

There are **two triggers**, and they answer different questions:

| Entry point | Question | Caller |
|---|---|---|
| `ensureBaseline(userId, language, N)` | "has this learner SORTED at least N cards?" | `OnDeckVocabController`, before assembling any set |
| `acquireLentCards(userId, language, n, mode, { level?, excludeIds? })` | "put n lent cards at this round's disposal" — re-lend first, mint the rest, return their ids | `OnDeckVocabService`, at the BOTTOM of every fill ladder (§ 4b); `getFillerPool`'s last rung |
| `lendCards(userId, language, n, mode, { level? })` | "mint exactly n, whatever they hold" — the minting half, called only by `acquireLentCards` | `ProvisionalCardService`, internal |
| `getFillerPool(userId, language, n, excludeWords)` | "n cards to PAD a board with, easiest first" — the `mastered-first` ladder: Mastered (most recently mastered first) → Comfortable → Target → Unfamiliar → lend. Returns vet ids in ladder order | `OnDeckVocabService.getChallengeGamePool` and `getWordSearchGrid`'s challenge branch, i.e. every Study Challenge board (docs/STUDY_CHALLENGE.md § 5.2) |

⚠️ **`getFillerPool` is the odd one out: it lends LAST but it is not really about
lending.** The other two answer "does this learner have enough cards"; this one answers
"which of their own cards should pad a board that is measuring something ELSE" — a
challenge round measures its twelve contested words, so its filler must not be a source
of difficulty. Lending is merely its final rung, reached by a brand-new player and by
nobody else.

`level` is a **centre, not a filter**. `findCandidates` orders by
`ABS(difficulty - level)`, so an exhausted level widens outward instead of returning
nothing — which is both Hydra's documented "pull from the next level up" fallback
(docs/HYDRA_BUBBLES.md § 6.2) and the reason a nonsense level can never starve a round.

**Callers that think in TIERS pass an offset, not a level**, and resolve it with
`resolveLendLevel(userId, language, offset)` first. The split is deliberate: only the
server knows the learner's estimated level `L` (`StarterPacksService.estimateLevel` is
not exposed to the client and there is no reason to expose it), while the per-color
offsets are the calling game's own design. Hydra sends `?lendLevelOffset=` and the
server resolves it — the alternative was an endpoint whose only job was to ship `L`
out so the client could send a level back that the server already had. The clamp into
1..6 inside `resolveLendLevel` is also what implements Hydra's floor — at `L = 1` both
of its colours land on level 1 — with no special case for a beginner.

**The cooldown-exhaustion case no longer lends** (2026-08-20). A learner with 400 sorted
cards is far past the 20-card flp baseline, so `ensureBaseline` no-ops — and if every one
of those cards is resting, the loop now **re-serves the cooling ones** rather than asking
for the difference in lent cards. See § 4b; this was the single largest source of
unexpected lending.

Consequence worth knowing: **lending is a cold-start event again**, not a routine one.
There is still no hard cap on outstanding lent cards, but the two mechanisms in § 3b and
§ 4b bound it in practice — re-lending covers a repeat deficit from rows the learner
already holds, and a learner with cards of their own never reaches the lend tier at all.
The end-of-session "sort these cards" CTA remains the pressure valve.

`OnDeckVocabController` calls `ensureBaseline` **before** assembling any set:

| Endpoint | Surface | Notes |
|---|---|---|
| `GET /api/onDeck/gamePool?surface=…` | Bubble Match, Match Speed, Speed Reading | Skipped when `need` is set (a partial refill — see below) |
| `GET /api/onDeck/wordSearchGrid?surface=word-search` | Word Search | Escalating retry, see §6 |
| `GET /api/onDeck/distributedWorkingLoop` | flp | Always `'flp'` |

**Partial refills provision only if the game opts in.** Bubble Match's *Play Again*
sends `need=N` to swap out only the pairs the player matched; lending on every tap
would quietly grow their deck, so it does not provision, and a refill that comes back
below `MIN_REPLAY_PAIRS` falls back to a **full** pool fetch, which does.

That exemption used to be a blanket rule on `need` being set. It is now **per game**,
because a game whose whole supply model is the partial refill — Hydra Bubbles, which
fetches every spawn that way (docs/HYDRA_BUBBLES.md § 6) — would otherwise be unable
to lend at all, at any point in a run. Games that roll their board once keep the
exemption; games with a rolling supply declare out of it.

A game declares out by naming itself in **`ROLLING_SUPPLY_SURFACES`**
(`server/contracts/wire.ts`) and sending `?surface=<its id>`; the controller turns that
into `lendOnRefill` on the pool call, and `getGameVocabPool` widens its fill-tier-2
guard from `need === undefined` to `need === undefined || lendOnRefill`. Hydra Bubbles
is the only such surface today (built 2026-08-18). This is
deliberately a **separate list from `CardBaselineSurface`**: "how many cards do you need
up front" and "may you lend mid-run" are orthogonal, and Hydra answers the first with
"none". The collection/deck restriction has **no** opt-out — a restricted round plays
the set the learner chose, rolling supply or not.

An unrecognized or missing `surface` param (an older client) falls back to the requested
distribution's own total, so it still never blocks.

### 4b. Lend LAST — where lending sits in the selection order

*Code: `OnDeckVocabService` → `getDistributedWorkingLoop`, `getNextLibraryCardWithFallback`,
`getGameVocabPool`, `getWordSearchGrid`, `lendGameCandidates`, `lendIntoLoop`,
`fetchRowsByIds`; `ProvisionalCardService` → `ensureBaseline`, `acquireLentCards`.*

**The rule (2026-08-20).** Lending exists for a learner who **has not sorted enough
cards**, and for nothing else. A learner with a real deck whose cards are merely
*resting* is not short of cards: the surfaces **re-serve their cooling cards** instead.

So lending is the **bottom** of every fill ladder:

| Tier | flp working loop | Game pool / Word Search grid |
|---|---|---|
| 1 | each quota, from its own category (longest-waiting first) | each requested bucket, FRESH cards only |
| 2 | borrow across categories in the mode's `fillOrder` | borrow FRESH cards in `GAME_FALLBACK_ORDER` |
| 3 | **COOLED cards**, nearest-to-ready first (`rankCardQueueCooled`) | COOLED cards (requested buckets → fallback) |
| 4 | — | soft-`avoid`ed cards (just cleared) |
| **5** | **lend** (re-lend, then mint — § 3b) | **lend** (re-lend, then mint — § 3b) |

Two things moved on 2026-08-20:

* **lending fell from tier 2 to tier 5**, replacing the 2026-08-17 "lend before you
  borrow" rule and its 2026-08-19 narrowing (which capped the games' tier-2 lend by
  what the borrow pass still held — a patch on the ordering rather than a fix to it);
* **the flp gained a cooled tier**, which it never had. A loop that could not be filled
  from rested cards previously either minted new words or came back short.

#### Why lend-first was wrong

A quota underfills far more often than "its category is spent". It underfills whenever
the learner's deck is **shaped** differently from the quota:

* the flp Mix loop asks for 1 `Mastered` + 2 `Comfortable`, which a young deck simply
  does not have — so every load minted cards, and every correct mark minted another
  (`getNextLibraryCardWithFallback` lent one card per refill: 14 lends in a single dev
  session);
* a game buckets by the track it **emits** (§ *Games select by their own mark type*,
  [MASTERY_REWORK.md](./MASTERY_REWORK.md)). Speed Reading emits READING marks, and a
  typical learner has almost no reading history, so *every* card bands `Unfamiliar` on
  that track and 18 of its 20 quota slots are unfillable **on a library of any size**.
  A minted row is itself `Unfamiliar`, so lending could never close them: every load lent
  ~18 more, permanently. A dev account with a 20-card library accumulated **450**
  provisional rows; another, holding 185 real cards, had been lent **184**.

The replacement is not a cap or a subtraction — it is the ordering. A cooling card of
the learner's own is a better answer to "I have nothing fresh to show" than a word they
have never chosen, and it is always available to a learner who has cards at all.

#### What the cooled tier costs

A mark fired at a still-cooling track is **dropped** at `POST /api/flashcards/mark`
(the hard "next markable at" guard — [HYDRA_BUBBLES.md](./HYDRA_BUBBLES.md) § 8). So
tier-3 cards **play but earn nothing**, and on the flp a suppressed mark returns
`newCard: null`, which winds the loop down rather than refilling it.

That is the intended shape: the cooldown exists precisely so that re-answering a card
inside its window earns nothing, and a learner who has reviewed their whole deck today
should reach the end of the session rather than be handed an endless supply of borrowed
words. It is tracked, not silent — the `[MarkSuppressed]` log carries the serving
surface so tier-3 suppression can be told apart from the deck/collection suppression
that is intended.

#### Provisional rows are not ordinary candidates

The ordering alone would not have been enough. Lent rows are **never on cooldown** and
**always band `Unfamiliar`**, so once a few had accumulated they out-competed the
learner's own cards in every round, forever — which is why the dev accounts above were
playing almost entirely on borrowed words even on loads that lent nothing new.

So every selection query is now **sorted-only** (`vetSortedClause`), and a lent card
enters a round only by being **named**:

```
ensureBaseline / acquireLentCards  →  lentIds: number[]
                                   ↓
  candidate queries admit them:  (vetSortedClause() OR ve.id = ANY($n))
  or address them directly:      fetchRowsByIds(ids)
```

`lentIds` threads from the controller's baseline top-up into `getGameVocabPool`,
`getWordSearchGrid` and `getDistributedWorkingLoop`; the tier-5 lend inside those
methods gets its own ids back from `acquireLentCards`. **A surface that forgets to pass
them will not see the cards it was just lent.**

#### The baseline counts SORTED cards

`ProvisionalCardService.ensureBaseline` compares the baseline against
`countSorted` — the learner's `'library'` rows alone. It used to count outstanding
provisional rows too, which made the baseline unfalsifiable: the account with 4 sorted
and 184 lent rows read as "well past baseline", so it was never topped up and every
round was played on borrowed words.

Counting sorted cards only is safe **because of § 3b**: the lend path re-lends rows the
learner already holds before it mints anything, so the deficit is covered from the
existing bucket rather than by a fresh batch each time. Measured on a 4-sorted-card
account, four consecutive Speed Reading entries minted **16 rows once** and re-lent the
same 16 on every subsequent entry.

#### Who still reaches tier 5

* a genuinely **under-supplied** learner whose baseline top-up could not cover the board
  (dictionary supply exhausted);
* **Hydra Bubbles**, whose every spawn is a refill and whose colour ladder is built on
  lending ([HYDRA_BUBBLES.md](./HYDRA_BUBBLES.md) § 6.2). It now pulls cooling cards
  before it lends, like everything else — but a colour whose buckets the learner has
  *no* cards in at all (a beginner's `bloom` tier = `Mastered` + `Comfortable`) still lends,
  which is the ladder working as designed;
* **Word Search**, via the controller's `PROVISION_RETRY_FACTOR` escalation — the one
  surface where meeting the baseline does not guarantee a playable round (§ 6).

Two sessions never reach it:

* **collection-restricted rounds** (`?deck=`, `?collection=`) — a deck round made of
  non-deck words is not that deck. They *do* reach tier 3 now, so a deck whose cards are
  all resting replays them instead of showing an empty round;
* **partial game refills** (`need` is set) for games that keep the exemption — Bubble
  Match's *Play Again*. A rolling-supply surface (Hydra Bubbles) opts out and may lend
  on a refill.

Since § 3b a lent card is **not** always `Unfamiliar`: a re-lent card carries whatever
history it earned the last time it was out. Any code that assumes "lent ⇒ Unfamiliar"
(the `canLendProvisional` rationale in `OnDeckVocabService`) holds only for the minting
half.

---

## 5. What the learner sees

### Before the round — `src/components/ProvisionalCardsNotice.tsx`

Any round that uses lent cards says so first. Not saying it would be worse than the
block: the learner would meet words they never sorted and assume the app was confused.

Whether the notice can **name** the words is a per-surface property, shared as
`CARD_BASELINE_ITEMIZED` in `server/contracts/wire.ts`:

| Surface | Itemized? | Why |
|---|---|---|
| Bubble Match, Speed Reading, Word Search | **yes** — tabulates the exact cards | fixed, known set |
| Match Speed | no — generic message | deals from a rolling buffer |
| flp | no — generic message | working loop refills as you go |

An itemized notice shows a **grid of the app's real mini vocab cards, two per row**,
one per lent card (`src/components/ProvisionalCardGrid.tsx`). The cards are
`MiniVocabCard` itself — the same 92×132 thumbnail the decks page, the collection view,
Quick Mark and the flashcard back render — not a preview-only card design. A bare word
list was the first version and was not enough: a learner handed words they never sorted
cannot judge them without the meaning, and cannot recognise them later if the preview
looks nothing like the card they end up with. Because the card resolves everything from
the entry it is given (sense-aware dd + pinyin, icon or icon layout, per-card color and
text-color overrides, the utcm badge), the preview agrees with the card face the learner
is about to meet by construction rather than by re-implementing it.

The **mastery strip is suppressed** here (`showMasteryStrip={false}`, a prop added to
`MiniVocabCard` for this): a borrowed card's bars are empty before the round and a
partial round's marks after it, and the dialog is asking whether the learner wants the
word, not how well they know it. Suppressing it also drops the strip's reserved height,
so the definition sits lower on the card.

Layout history, all of it driven by the same ~276–340px-wide popup: a three-column
`word1 · pinyin · dd` table → one full-width pill per card → the 2-column
`MiniVocabCard` grid (all three on 2026-08-18). The table spent two nowrap columns before
the definition got any width, so long dds clipped. The pills fixed the clipping but were
still a bespoke shape describing a card rather than showing one. Two per row is
arithmetic, not taste: the card's width is fixed at 92px, so a row is 2 × 92 + 16 = 200px
— three per row (what `MiniVocabCardGrid` does at 364px) does not fit the popup, two does
comfortably, and it halves the vertical run so a typical lent set (4–8 cards) is fully
visible inside the popup's `maxHeight` instead of scrolling. The grid is deliberately
NOT `MiniVocabCardGrid`: that component owns a 3-per-row track plus paced incremental
reveal for decks of hundreds, where a lent set is a handful of cards in a dialog. There
is deliberately **no container box** behind the cards — the beige panel the original
table sat in read as a mis-drawn frame on the notice's equally-beige card.

The preview is READ-ONLY: no `onClick` is passed, so the card renders with a default
cursor and no hover lift. Tapping a lent card does nothing; the dialog's own buttons are
the decision.

**Known gap.** A card previewed from the fetched path (below) is adapted from a
`DiscoverCard` by `discoverCardToProvisionalEntry`, which cannot supply `category` — so
those previews carry no utcm badge where the surfaces holding real vet rows (Bubble
Match, Speed Reading) do. Closing it means serving vet rows from `GET /provisionalSet`.
The matching `typedMarkHistory` gap no longer shows, since the strip is off on both
paths.

There is no way to decline. Declining would mean not playing, which is the outcome this
whole rework removed.

Because the notice opens the moment a round is primed, **every game freezes while it is
up** — its clock, and in Bubble Match's case its launcher and descending ceiling. Reading
which cards were lent to you is not playing, so it isn't charged to the run. See
[GAMES_FEATURE.md](./GAMES_FEATURE.md) § Popups pause the clock for the per-game table.

The client derives the notice from the served cards themselves
(`card.starterPackBucket === 'provisional'`, via `provisionalEntries` in
`src/utils/provisionalCards.ts`), so nothing extra rides on the wire. Word Search is the
one exception: its grid payload carries `PlacedWord`s rather than vet rows, so the server
reports a flat `provisionalWords: string[]` instead of threading a flag through the grid
generator — and the notice turns those words into cards by fetching them
(`useProvisionalEntries`, `src/hooks/useProvisionalEntries.ts`).

### After the round — `src/components/ProvisionalSortOffer.tsx`

The same table comes back as a **popup** asking *"Keep these N cards?"*, with
**Sort these cards** / **Not now**. This is the best possible moment to ask: the learner
just spent a whole round with those words. Accepting opens the sort flow in set mode
(§ 7) on exactly those words, which ends on its own completion popup (§ 7).

**On a game** the offer stacks over the run's own result and opens **immediately** when
the round ends — there is no delay (there used to be a 1.4 s `SORT_OFFER_DELAY_MS` beat;
it was removed). `useProvisionalSortOffer` (`src/hooks/useProvisionalSortOffer.ts`) owns
the open/minimized/dismissed state and resets the whole thing on a replay so a second run
is judged on its own.

Both popups are on screen together, so they must never read as one thing:

| | Collapses to | Puck color |
|---|---|---|
| End-of-run popup (`GameEndPopup`) | top-**right** | neutral card color |
| Sort offer (`ProvisionalSortOffer`) | top-**left** | blue accent (`COLORS.blueMain`), white icon |

Minimizing the offer is the "not right now, but don't take it away" answer — it lives on
as the corner puck for the rest of the round; **Not now** dismisses it for good. The
collapse/restore mechanics are shared by both popups and live in
`src/components/MinimizablePopup.tsx`; `GameEndPopup` is now a thin wrapper that pins the
end-of-run corner and color.

**On flp** there is no scoreboard to attach the offer to — a study session ends when the
learner LEAVES — so the offer **gates the back arrow**. The first tap raises it listing
every card the working loop dealt across the whole session; **Sort these cards** goes to
the sort flow, **Leave anyway** completes the exit. It is a one-shot (`exitOfferShown`):
tapping back after declining leaves immediately rather than asking twice. It is also not
minimizable — the learner is on their way out, so a corner puck would have nothing to sit
over. The loop-empty state shows nothing extra.

Ignoring the offer costs nothing — the cards stay, the marks stay, and it returns after
the next round. The non-itemized surfaces accumulate the lent words **as they are dealt**
(`provisionalSeenRef` in `MatchSpeedPage` / `useWorkingLoop`), so by the end of the run
they can name them even though the opening notice could not.

The offer's table is fetched through the sort-set endpoint (§ 7), which intersects the
asked-for words with what the learner genuinely still holds. Two consequences worth
knowing: a card sorted in another tab drops out of the table by itself, and an offer with
nothing left to give **does not appear at all**.

---

## 6. Word Search is the awkward one

Word Search needs ten words with **mutually distinct characters**. A row count cannot
express that, so meeting the baseline does *not* guarantee a buildable grid.

`OnDeckVocabController.getWordSearchGrid` therefore escalates: build the grid, and while
it comes back insufficient, provision at `1×`, `2×`, `3×` the baseline
(`PROVISION_RETRY_FACTOR`) and retry, accumulating the `lentIds` across attempts (§ 4b —
an id dropped from that list is a card the grid can no longer see). It stops early when
the reason is `'language'` (zh-only, unfixable).

An escalation that yields no new ids **continues to the next multiplier** rather than
breaking out. This matters since the baseline started counting SORTED cards: a learner
already past the flat baseline gets nothing at `1×`, and it is the escalation that
unblocks them — breaking early left them with an empty grid. The loop still ends after
`PROVISION_RETRY_FACTOR` attempts, and a top-up that yields nothing at the highest
multiplier means the dictionary is exhausted.

Reaching the end of that ladder is a genuine dead end, so the copy says so plainly
("there aren't enough words with distinct characters left — try another game") rather
than the old, now-false "study more cards to unlock it".

Match Speed has a related wrinkle. Its restricted modes are
**Review = Comfortable + Mastered** and **Challenge = Unfamiliar + Target**
(`MODE_CONFIGS` in `src/games/match-speed/constants.ts`).

A lent card starts with an **empty mark history**, so it is Unfamiliar. Provisioning
therefore fills **Challenge's** buckets for free — but it can never fill **Review's**:
Comfortable and Mastered are *earned*, not granted, so a learner with no real progress
has nothing on-mode however many cards we lend them.

Rather than block Review for everyone who hasn't got a card comfortable yet, a run with
nothing on-mode **widens its fallback order** to all four buckets for that run only
(`relaxed` in `MatchSpeedPage.tsx`). The mode's weights are untouched, so once real
on-mode cards exist it plays exactly as designed.

### The same asymmetry on flp

flp's study modes split identically (`MODE_CONFIGS`, `OnDeckVocabService.ts`):
**Review = Comfortable + Mastered**, **Challenge = Unfamiliar + Target**.

`FlashcardsDecksPage` therefore treats them differently:

* **Challenge has no eligibility check at all.** Its buckets are exactly what provisioning
  fills, so the server can always build a Challenge loop. The old check read `categoryCounts`,
  which is SORTED-only and therefore `0` for a brand-new learner — gating on it would
  have quietly re-introduced a card-count block on a flp entry point.
* **Review keeps its check.** Comfortable and Mastered are *earned* bands that no amount
  of lending can populate, so greying Review is an honest statement about the learner's
  progress rather than a card-count wall — the same category of restriction as Word
  Search being zh-only.

**Settled:** flp Review does **not** degrade. `MODE_CONFIGS.review.allowed` stays exactly
`['Comfortable','Mastered']` and `MODE_CONFIGS.challenge.allowed` exactly
`['Unfamiliar','Target']` — the `allowed` list is a hard filter on both the initial loop
and every refill, so a Review loop can never serve an Unfamiliar card no matter how empty
the buckets are. Do not "fix" a thin Review loop by widening `fillOrder`: a Review session
padded with cards the learner has never seen is not a review session.

The consequence is deliberate — Match Speed Review degrades (widened fallback) where flp
Review greys out. Match Speed can degrade because its board only needs *pairs*, and a pair
of unfamiliar cards is still a playable board; flp Review's whole purpose is "show me cards
I mostly know", which has no meaningful degraded form.

### Which flp sessions may be topped up with lent cards

The same asymmetry decides who gets a mid-loop top-up when every card is cooling. One rule,
`canLendProvisional` (`OnDeckVocabService.ts`), governs both the initial loop and the refill:

> Lend only when **`Unfamiliar` is a servable category** for this round **and** the round is
> **unrestricted** (no `?deck=`, no `?collection=mastered`).

This same predicate now gates the **tier-2 lend** described in § 4b, not just the
all-cards-cooling case below — the two are the same call site.

| Session | All cards cooling ⇒ |
|---|---|
| Study (Mix) | lend to fill the 10-card loop |
| Challenge | lend — `Unfamiliar` is one of its buckets |
| Review | **empty**; `Comfortable`/`Mastered` are earned, and a lent card is neither |
| `?collection=mastered` | **empty**; the collection filter would drop the lent card anyway |
| `?deck=<id>` | **empty**; a lent card *would* pass `vetDeckOrProvisionalClause`, but a round named after a deck must not be made of non-deck words |

Written as one predicate rather than a mode/collection switch, so a future mode or
collection gets the right answer by construction.

The restricted rows come back **short or empty on purpose** — there is no cooled-card last
resort any more (`fetchCooledFallbackCards` and `pickLeastRecentlyCorrectFlp` are deleted).
The client shows a "resting" empty state (`emptyMessage` in `FlashcardsLearnPage.tsx`), and
`POST /api/flashcards/mark` returns **200 with `newCard: null`** rather than a 404 so
`useWorkingLoop` winds the loop down cleanly. Note the *baseline* `ensureBaseline('flp')`
call still runs for restricted sessions — that is the pre-existing cold-start guard and is
unchanged; only the mid-loop top-up is gated by `canLendProvisional`.

---

## 7. Sorting what you played

Provisional cards stay **unsorted** as far as discover is concerned. The supply query
(`StarterPacksService._fetchSupplyRows`) excludes only rows with a *sorted* bucket, so
lent words keep appearing in the normal sort flow — that is how a temporary card gets
promoted into the real deck.

### Set mode

`/discover/sort/:language?set=provisional&words=a,b,c` hands `SortCardsPage` a **fixed
set** instead of the open-ended level-based supply. Each card becomes its own pack-of-1,
so all the existing pack machinery (drag, undo, resolved markers) works unchanged.

Two differences: the queue is **never replenished**, and the page **ends itself** as
soon as the queue empties. The ending is an effect on `queue.length` (SortCardsPage's
set-mode exit effect), not a call inside the sorting handler, so *every* way of
emptying the set is covered: the last card sorted, the last card skipped, a failed sort
POST, or a set that came back already empty because the cards were sorted in another tab.
Without this the empty queue renders as a permanent spinner — the empty-state branch only
shows a message when `exhausted`, and a fixed set never is.

### Ending the set — the completion popup

How it ends depends on whether the learner resolved anything (`resolvedCount`, summed off
`done`):

| Case | Behaviour |
|---|---|
| At least one card sorted/skipped | The page holds still on **`ProvisionalSortDonePopup`** (`src/components/ProvisionalSortDonePopup.tsx`) — a non-minimizable popup over an otherwise empty board offering two exits: **Back to \<origin\>** and **Go to Home** (`/`). |
| Nothing resolved (the set was already empty) | Silent exit, exactly as before — there is nothing to confirm. |

The popup exists because the old unconditional `navigate(-1)` fired on the same beat as
the last card leaving the board: the learner's final sort read as the card vanishing under
an instant route change, with no acknowledgement that anything landed.

**Back** runs `exitToOrigin`: `navigate(-1)` normally, falling back to the recorded origin
and then `/discover` when this page is the first history entry (deep-link or reload). The
same callback backs the NodePage back arrow in this state, so there is one exit path.

**Naming the origin.** `ProvisionalSortOffer` appends `&from=<pathname>` when it opens the
flow, and `originLabelFor` (`src/utils/originLabel.ts`) turns that into a label — game
titles read out of `GAME_REGISTRY` (so a renamed game renames the button), plus a small map
for the non-game origins (flp, decks, discover, games hub). An unrecognised or missing
origin degrades to a plain **Go back**.

`words` narrows the set to one round's cards; omitting it offers every outstanding
provisional card. The server **intersects** whatever is asked for with what the learner
genuinely still holds (`ProvisionalCardService.getSortSet`), so a stale client list can
only ever return fewer cards, never smuggle in extra ones.

### Promotion preserves progress

`StarterPacksService.sortCard` **promotes in place**: if the row already exists and is
`'provisional'`, it flips the bucket to `'library'` and **touches nothing else**. Every
mark earned while the card was temporary survives — including marks earned on it during a
run where it was serving under a difficulty tier (§ 3c). The tier was only ever a serving
label; promotion drops it and the card bands off its real history from then on.

An already-`'library'` row is left completely alone (re-sorting must not reset anything).

### Undo demotes rather than deletes

`undoSort` used to `DELETE` the row unconditionally, which would silently destroy marks
earned in a game. It now branches, atomically, in one CTE:

* the row **has marks** → set the bucket back to `'provisional'`. The card leaves the
  deck, keeps its history, and discover keeps offering it, so it can be re-sorted later
  with the progress intact. The response carries `demoted: true`.
* the row **has no marks** → delete it, as before, so a mis-tap leaves no trace and the
  word returns to the normal fresh supply.

"Has marks" is *any* `typedMarkHistory` track being non-empty.

---

## 7b. Playing a deck that is too small

A game or flp launched from a user-authored deck (`?deck=<id>`,
[DECKS_FEATURE.md](./DECKS_FEATURE.md)) uses this same top-up. Two rules keep the
two features honest about each other:

* **Lent cards ARE servable in a deck-restricted round.** The selection clause is
  `vetDeckOrProvisionalClause` — "in the deck, OR lent for this session" — so a
  four-card deck still yields a full board rather than a degraded one.
* **Lent cards are NEVER written into the deck.** Playing an under-sized deck does
  not silently grow it. The learner still sees the ordinary provisional notice
  naming the borrowed words, and sorting one still promotes it in place.

The strict `vetDeckClause` (no provisional branch) is used by every read that means
"the deck itself" — the deck's card list, its count — so those never show a lent card.

## 7c. Memory Map declares NO baseline — deliberately

[MEMORY_MAP_GAME.md](./MEMORY_MAP_GAME.md) has **no entry in `CARD_BASELINES`** and is
never topped up. It is the only game like this, and the omission is a decision rather
than an oversight, so do not "complete" the table by adding it.

Two reasons, and the second is the important one:

* **Nothing to block.** The map has no minimum viable size — a learner with four cards
  gets a four-word map and a perfectly playable run. There is no round to fail to build,
  which is what a baseline exists to prevent.
* **A lent card must not homestead a permanent map.** Every other surface's selection is
  transient: a provisional card appears for one round and is gone. Memory Map's
  selection writes a DURABLE placement row — the word takes a permanent spot on a map
  meant to portray the learner's own library. A borrowed word does not belong there.

That second point made Memory Map the **first** game to select on `vetSortedClause()`.
Since 2026-08-20 every game does (§ 4b), so Memory Map is no longer the exception — but
it remains the strictest case: the others admit lent rows by id when a round genuinely
has to borrow, and Memory Map admits none at all, because its selection creates
something that outlives the session. A future surface whose selection writes a durable
artifact should do the same.

## 8. Layering map

| Layer | File | Responsibility |
|---|---|---|
| Contract | `server/contracts/wire.ts` | `CARD_BASELINES`, `CARD_BASELINE_ITEMIZED`, `PROVISION_RETRY_FACTOR`, `StarterPackBucket` |
| DAL (shared SQL) | `server/dal/shared/vetTable.ts` | `vetSortedClause` / `vetProvisionalClause` (`vetPlayableClause` survives for Speed Reading's distractor characters only — § 2) |
| DAL | `server/dal/implementations/ProvisionalCardDAL.ts` (+ `interfaces/IProvisionalCardDAL.ts`) | mint candidate query, bulk insert, `countSorted`, `findHeldProvisional` (re-lend source), key list |
| Service | `server/services/ProvisionalCardService.ts` | how many to lend, when, re-lend-then-mint (`acquireLentCards`), the two-pass skip recycle, the sort set |
| Service | `server/services/OnDeckVocabService.ts` | the fill ladders (§ 4b), `fetchRowsByIds` — the only read that surfaces a lent row into a round — and `getChallengeGamePool` (docs/STUDY_CHALLENGE.md § 5.2a) |
| Service (pure) | `server/services/cardQueueRanking.ts` | `rankCardQueue` (rested, longest-waiting first) and `rankCardQueueCooled` (resting, nearest-to-ready first — the flp's tier 3) |
| Service | `server/services/StarterPacksService.ts` | `getCardsForWords`, in-place promotion, undo demotion |
| Controller | `server/controllers/OnDeckVocabController.ts` | `ensureBaseline` before every set; Word Search retry ladder |
| Controller | `server/controllers/StarterPacksController.ts` | `GET /api/starterPacks/:language/provisionalSet` |
| Client (shared) | `src/api/provisional.ts`, `src/utils/provisionalCards.ts` | typed call; derive lent cards (`provisionalWords` / `provisionalEntries`) from a served set, and adapt a `DiscoverCard` into the mini card's `VocabEntry` |
| Client (shared) | `src/hooks/useProvisionalEntries.ts` | the lent cards as `VocabEntry` rows — local when the caller holds them, fetched when it holds only words |
| Client (shared) | `src/hooks/useProvisionalSortOffer.ts` | a game's offer timing + open/minimized/dismissed state |
| Client (shared) | `src/components/MinimizablePopup.tsx` | the scrim / card / corner-puck collapse shell (also backs `GameEndPopup`) |
| Client (shared) | `src/components/ProvisionalCardGrid.tsx` | the lent cards as `MiniVocabCard` thumbnails, 2 per row |
| Client (shared) | `src/components/ProvisionalCardsNotice.tsx`, `src/components/ProvisionalSortOffer.tsx` | the pre-round notice; the end-of-round offer popup (which records `?from=` for the exit) |
| Client (shared) | `src/components/ProvisionalSortDonePopup.tsx`, `src/utils/originLabel.ts` | the set-mode completion popup (Back to \<origin\> / Go to Home) and its origin label |

---

## 9. Related docs

* [GAMES_FEATURE.md](./GAMES_FEATURE.md) — the games hub and per-game docs
* [DISCOVER_FLOW.md](./DISCOVER_FLOW.md) — the sort flow this hands off to
* [MASTERY_REWORK.md](./MASTERY_REWORK.md) — typed marks, per-type cooldowns, utcm banding
* [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md) — `frequencyScore`, the commonality ordering key
* [HYDRA_BUBBLES.md](./HYDRA_BUBBLES.md) — the first surface to lend **by tier** (§ 3c) and
  the reason partial refills became per-game (§ 4)
