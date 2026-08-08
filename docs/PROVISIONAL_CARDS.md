# Provisional Cards — nothing blocks on card count

**Status:** implemented (migration 140). Not yet on prod — see
[SORT_CARDS_REQUIREMENTS / deploy runbook](./PROVISIONAL_CARDS_DEPLOY_RUNBOOK.md).

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

**The rule of thumb:**

* Does the query answer *"what is in MY deck?"* → **SORTED**.
  Deck lists, search, counts shown as deck size, reader-token ownership, related-words,
  the community feed, the discover level estimate.
* Does it answer *"what can I put in front of the player right now?"* → **PLAYABLE**.
  Game pools and the flp working loop, and nothing else.

Current classification (all call sites):

| Read | Clause | Where |
|---|---|---|
| `fetchGameCandidates` (all game pools) | PLAYABLE | `OnDeckVocabService.ts:281` |
| `fetchLibraryCandidatesByCategory` (flp refill) | PLAYABLE | `OnDeckVocabService.ts:489` |
| `fetchEligibleCategoryCards` (flp loop) | PLAYABLE | `OnDeckVocabService.ts:595` |
| `getLibraryDistractors` (Speed Reading filler) | PLAYABLE | `SpeedReadingDAL.ts:55` |
| `getLibraryCards` / `getMastered…` / `getNonMastered…` | SORTED | `OnDeckVocabService.ts:400,426,453` |
| `getCategoryCounts` (decks page deck sizes) | SORTED | `OnDeckVocabService.ts:809` |
| `findByUserIdAndLanguage`, `countByUserIdAndLanguage`, `searchEntries`, `findByDifficultyLevel`, `bulkFindByKeys`, `findByTokens`, `findEntriesCreatedAfter`, `findRelatedBySharedCharacters`, `findUsedInForCharacter` | SORTED | `VocabEntryDAL.ts` |
| community feed | SORTED | `CommunityLayoutDAL.ts:128` |
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
* words failing the language's supply gate (`sortable` for zh, `discoverable` otherwise) —
  kept in step with the discover supply query so a lent word is always a word the sort
  flow can later offer.

The level comes from `StarterPacksService.estimateLevel` — the same cold-start seed
discover uses — so a lent card sits at the difficulty the learner would have been
offered to sort anyway. A brand-new learner estimates level 1 and is lent the most
common level-1 words (一, 一下, 一点, 三, 上, …), which is the right first experience.

**Supply exhaustion is not an error.** A learner who has sorted or been lent every
discoverable word gets `shortfall > 0` and a smaller round. Never a block screen.

---

## 4. Where provisioning happens

Always server-side, implicitly, when a surface fetches its card set. The client never
asks for cards to be lent.

`OnDeckVocabController` calls `ensureBaseline` **before** assembling any set:

| Endpoint | Surface | Notes |
|---|---|---|
| `GET /api/onDeck/gamePool?surface=…` | Bubble Match, Match Speed, Speed Reading | Skipped when `need` is set (a partial refill — see below) |
| `GET /api/onDeck/wordSearchGrid?surface=word-search` | Word Search | Escalating retry, see §6 |
| `GET /api/onDeck/distributedWorkingLoop` | flp | Always `'flp'` |

**Partial refills never provision.** Bubble Match's *Play Again* sends `need=N` to swap
out only the pairs the player matched; lending cards on every tap would quietly grow
their deck. If such a refill comes back below `MIN_REPLAY_PAIRS`, the client falls back
to a **full** pool fetch, which does provision.

An unrecognized or missing `surface` param (an older client) falls back to the requested
distribution's own total, so it still never blocks.

---

## 5. What the learner sees

### Before the round — `src/components/ProvisionalCardsNotice.tsx`

Any round that uses lent cards says so first. Not saying it would be worse than the
block: the learner would meet words they never sorted and assume the app was confused.

Whether the notice can **name** the words is a per-surface property, shared as
`CARD_BASELINE_ITEMIZED` in `server/contracts/wire.ts`:

| Surface | Itemized? | Why |
|---|---|---|
| Bubble Match, Speed Reading, Word Search | **yes** — lists the exact words | fixed, known set |
| Match Speed | no — generic message | deals from a rolling buffer |
| flp | no — generic message | working loop refills as you go |

There is no way to decline. Declining would mean not playing, which is the outcome this
whole rework removed.

The client derives the notice from the served cards themselves
(`card.starterPackBucket === 'provisional'`, via `src/utils/provisionalCards.ts`), so
nothing extra rides on the wire. Word Search is the one exception: its grid payload
carries `PlacedWord`s rather than vet rows, so the server reports a flat
`provisionalWords: string[]` instead of threading a flag through the grid generator.

### After the round — `src/components/SortProvisionalCta.tsx`

The completion screen offers *"Keep these N cards"*. This is the best possible moment to
ask: the learner just spent a whole round with those words.

Ignoring it costs nothing — the cards stay, the marks stay, and the offer returns after
the next round. The non-itemized surfaces accumulate the lent words **as they are dealt**
(`provisionalSeenRef` in `MatchSpeedPage` / `useWorkingLoop`), so by the end of the run
they can name them even though the opening notice could not.

---

## 6. Word Search is the awkward one

Word Search needs ten words with **mutually distinct characters**. A row count cannot
express that, so meeting the baseline does *not* guarantee a buildable grid.

`OnDeckVocabController.getWordSearchGrid` therefore escalates: build the grid, and while
it comes back insufficient, provision at `1×`, `2×`, `3×` the baseline
(`PROVISION_RETRY_FACTOR`) and retry. It stops early when the reason is `'language'`
(zh-only, unfixable) or when a top-up grants nothing (dictionary exhausted).

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

flp's study modes split identically (`MODE_CONFIGS`, `OnDeckVocabService.ts:38-50`):
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

Two differences: the queue is **never replenished**, and the page **closes itself**
(`navigate(-1)`) once the last card of the set is sorted.

`words` narrows the set to one round's cards; omitting it offers every outstanding
provisional card. The server **intersects** whatever is asked for with what the learner
genuinely still holds (`ProvisionalCardService.getSortSet`), so a stale client list can
only ever return fewer cards, never smuggle in extra ones.

### Promotion preserves progress

`StarterPacksService.sortCard` **promotes in place**: if the row already exists and is
`'provisional'`, it flips the bucket to `'library'` and **touches nothing else**. Every
mark earned while the card was temporary survives.

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

## 8. Layering map

| Layer | File | Responsibility |
|---|---|---|
| Contract | `server/contracts/wire.ts` | `CARD_BASELINES`, `CARD_BASELINE_ITEMIZED`, `PROVISION_RETRY_FACTOR`, `StarterPackBucket` |
| DAL (shared SQL) | `server/dal/shared/vetTable.ts` | `vetSortedClause` / `vetPlayableClause` / `vetProvisionalClause` |
| DAL | `server/dal/implementations/ProvisionalCardDAL.ts` (+ `interfaces/IProvisionalCardDAL.ts`) | candidate query, bulk insert, playable count, key list |
| Service | `server/services/ProvisionalCardService.ts` | how many to lend, when, the two-pass skip recycle, the sort set |
| Service | `server/services/StarterPacksService.ts` | `getCardsForWords`, in-place promotion, undo demotion |
| Controller | `server/controllers/OnDeckVocabController.ts` | `ensureBaseline` before every set; Word Search retry ladder |
| Controller | `server/controllers/StarterPacksController.ts` | `GET /api/starterPacks/:language/provisionalSet` |
| Client (shared) | `src/api/provisional.ts`, `src/utils/provisionalCards.ts` | typed call; derive lent cards from a served set |
| Client (shared) | `src/components/ProvisionalCardsNotice.tsx`, `src/components/SortProvisionalCta.tsx` | the notice; the end-of-round offer |

---

## 9. Related docs

* [GAMES_FEATURE.md](./GAMES_FEATURE.md) — the games hub and per-game docs
* [DISCOVER_FLOW.md](./DISCOVER_FLOW.md) — the sort flow this hands off to
* [MASTERY_REWORK.md](./MASTERY_REWORK.md) — typed marks, per-type cooldowns, utcm banding
* [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md) — `frequencyScore`, the commonality ordering key
