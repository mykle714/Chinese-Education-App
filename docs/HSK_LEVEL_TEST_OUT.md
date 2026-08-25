# Level Test-Out (test out of an entire HSK level)

> STATUS: **DESIGN / DRAFT — nothing built, no migration, no tables confirmed.**
> Every table, column and constant named below is a *proposal* and is listed in the
> question log (§ 11). Do not implement until those are answered.
>
> Abbreviation proposed for this feature: **lto** = level test-out.

## 1. Goal

A learner who already knows an HSK level should not have to sort and drill several
hundred cards to prove it. **lto** is a single, timed-ish assessment over one level's
vocabulary; passing it **marks that level's cards Mastered in one action**, so the
learner lands in the app at their true position instead of at zero.

The feature answers a real cold-start problem: the app currently estimates level only
through the discover sort flow (`StarterPacksService.estimateLevel`,
[SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md) § 6), which moves ±1 level per
SortPack and never grants mastery. An intermediate learner spends days climbing.

### 1a. Scale of the grant — this is the whole design problem

Discoverable zh words per level, on dev today:

| Level | Discoverable words | Cumulative |
|---|---|---|
| HSK 1 | 218 | 218 |
| HSK 2 | 245 | 463 |
| HSK 3 | 337 | 800 |
| HSK 4 | 691 | 1,491 |
| HSK 5 | 1,172 | 2,663 |
| HSK 6 | 1,561 | 4,224 |

So a single passed test can create and master **up to ~1,500 vet rows** in one request.
That single fact drives §§ 4, 5 and 6: the sample must be defensible, the write must be
one transaction, and the action must be reversible.

## 2. Where it lives (navigation)

Proposed: a **Bento tile on the discover hub (dp)** — "Test out of a level" — leading to
a Node page `/discover/test-out` that lists the six levels with per-level state
(*available* / *passed on <date>* / *locked until <date>*), each opening the Leaf test
runner at `/discover/test-out/:language/:level`.

Rationale: dp is where the app already asks "where are you?" (scp lives there, and the
level estimate is computed for that flow). Games hub is wrong — this is not a game, it
does not lend provisional cards, and it must not be replayable for fun.

Depends on: [BENTO_SYSTEM.md](./BENTO_SYSTEM.md) (tile weights, ramp hues),
[UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) (Leaf/Node archetypes),
[DISCOVER_FLOW.md](./DISCOVER_FLOW.md).

## 3. Language scope

The level integer is `dictionaryentries_*.difficulty`, 1–6, and it **is** the HSK level
for zh only; for es it is a plain acquisition score with no external syllabus behind it
(`StarterPacksService._levelConfig`, `server/contracts/wire.ts`). The mechanic is
language-agnostic, but the *claim* "you know HSK 4" is not.

**Proposal: ship zh-only, keep the code language-parameterised.** The es copy would be
"Level 4" with no HSK badge; enabling it is a copy decision, not an engineering one.

## 4. Test construction

### 4.1 Sampling

- Draw **N items** from `dictionaryentries_zh WHERE difficulty = L AND discoverable`.
- **Stratify by commonality** so the test is not all tail words: proposed thirds by
  `frequencyScore` — common / mid / rare — sampled evenly. A test made only of the 30
  most common words of the level is trivially passable and worthless as evidence.
- **Exclude nothing for already-known-ness.** If the user has already mastered some of
  the level, those words stay eligible — the test measures the level, not the remainder.
- Items are drawn **server-side and stored**, not generated client-side; the client
  never sees the answer key (§ 7).

### 4.2 Distractors and the gloss-confusability guard

Every multiple-choice item's distractors MUST pass the phase-1 exact-dd guard
(`ddCollisionKey`, [GLOSS_CONFUSABILITY.md](./GLOSS_CONFUSABILITY.md)) against the
correct answer and each other. A test that shows "a little" and "a bit" as two options
is unanswerable, and unlike a game an unanswerable item costs the user a real grant.

This is the **fourth round-assembly chokepoint** and should reuse the same helper as the
other three rather than re-implementing the set check.

### 4.3 Item format

Proposed: **recognition items only** (foreign → meaning, 4 choices, no pinyin shown so
the character is doing the work). Reasons:

- It is the only track that can be assessed at ~40 items in a few minutes.
- Production and Writing cannot be machine-graded here at acceptable cost (Writing has a
  stroke-grading path, but 40 handwritten characters is not a test, it's a chore).

This deliberately creates an asymmetry with § 6: the test measures recognition/reading,
so the grant must not claim more than that.

### 4.4 Size and pass threshold

Proposed starting point, all constants in one place
(`server/contracts/levelTestOut.ts`):

| Constant | Proposed | Why |
|---|---|---|
| `ITEM_COUNT` | 40 | ~3–5 min; enough that luck is not decisive |
| `PASS_RATIO` | 0.90 (36/40) | see below |
| `CHOICES_PER_ITEM` | 4 | random-guess baseline 25% |
| `PER_ITEM_SECONDS` | 10 | blocks lookup in another tab; no total clock |

At 4 choices and 40 items, a pure guesser passes 36/40 with probability ~1e-17. The
threshold is set high not for statistics but for **inference**: 90% of a stratified
sample is the evidence used to claim the other ~1,460 words.

## 5. Anti-abuse and retry policy

The reward is the largest single state change a user can cause, so:

- **Cooldown on failure** — proposed 7 days per (user, language, level). Without it the
  test is a resample-until-lucky machine.
- **Items are re-drawn every attempt**, and a failed attempt's items are excluded from
  the next draw where supply allows (levels 1–3 are small enough that this must
  degrade gracefully rather than error).
- **One pass per level, ever** (a pass is idempotent — re-running grants nothing new).
- **Server-side timing.** The per-item clock is enforced on the submit path against the
  server's issue timestamp, not trusted from the client.
- **Rate limit** the start endpoint (`server/middleware/rateLimits.ts`).
- **Lower levels are implied, not granted.** Passing HSK 4 does *not* auto-grant 1–3
  (§ 11 Q6) — see the question log; this is a real open decision.

## 6. The grant — what "mastered" actually means

This is the part that needs the most care, because since migration 143 a card carries
**three independent bars** (core / reading / writing), each banded from
`typedMarkHistory` by `server/contracts/mastery.ts`. There is no `category` column to
set — the band is *derived* everywhere, including in-query
(`coreCategoryExpr` / `barCategoryExpr` in `server/dal/shared/vetTable.ts`).

### 6.1 Which cards

For each discoverable det row at level L:
- no vet row → **INSERT** with `starterPackBucket = 'library'` (not `'provisional'` —
  these are the user's cards now; see [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md)).
- existing `'provisional'` row → **promote to `'library'`** in place, exactly as sorting
  one does.
- existing `'library'` row → leave the bucket, apply § 6.2.

### 6.2 Which bars, and how the state is written

**Proposal: master the CORE bar only.** Reading and Writing are separate claims the test
does not assess (§ 4.3), and Writing especially would be a lie. A learner who tests out
of HSK 4 sees full core bars and empty reading/writing bars — which is an accurate
picture and leaves them something to do.

Two implementation options for *how* a bar is forced to Mastered:

| | **A — synthesise marks** | **B — an override column** |
|---|---|---|
| Mechanism | write 8 `isCorrect` marks into `typedMarkHistory.recognition` and `.production`, set `masteredAt.core` | new `vet."testedOutAt"`; every band expression returns 'Mastered' when set |
| Schema | none | 1 column + edits to `compute_core_category()` and every in-query band expr |
| Readers | all existing readers (SQL + TS) work untouched | must find and patch ~every mastery read; a missed one is a silent inconsistency |
| Honesty | fabricates a review history the user never performed | keeps history truthful, distinguishes "tested out" from "drilled" |
| Decay | the next wrong mark evicts a synthetic mark and the bar falls — desirable | needs an explicit "override ends when…" rule |
| Velocity | would emit ~1,500 `category_promotions` rows ([VELOCITY.md](./VELOCITY.md)) unless suppressed | one row per card at most |

**Recommendation: A, with provenance.** The eviction behaviour is the deciding argument
— a tested-out card that the learner then gets wrong in a game *should* fall out of
Mastered, and option A gets that for free because the 8-window is FIFO. Provenance is
kept by tagging the synthetic marks (proposed `source: 'lto'` on the `ReviewMark`), so
"did they earn this or test out of it?" stays answerable, and `category_promotions`
writes are **suppressed** for this path (a test-out is one event, not 1,500 promotions).

⚠️ Tagging `ReviewMark` is a wire-contract change and needs confirming (§ 11 Q4).

### 6.3 Transactionality

One transaction, one client, released in all branches. 1,500 rows is a bulk
`INSERT ... ON CONFLICT DO UPDATE` over the per-language vet table, not a loop of
`addToLibrary` calls. Partial application is the worst outcome — the user paid the test
and half their level is missing.

### 6.4 Reversibility

Proposed: keep the attempt row (§ 8) and make the grant undoable by it — the same set of
(userId, entryKey) with the synthetic-mark tag can be stripped. Needed because this is
the one action that can wreck a real learner's deck if the test is mis-tuned, and
because the deck cap / community reads all react to it.

## 7. Layering

| Layer | Component |
|---|---|
| Client (Leaf page) | `src/features/discover/LevelTestOutPage.tsx` — runner, one item at a time, no answer key in the payload |
| Client (Node page) | `src/features/discover/LevelTestOutMenu.tsx` — six levels + state |
| Client API | `src/features/discover/levelTestOutApi.ts` (via `src/api/http.ts`, no `token` param — [FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md)) |
| Controller | `LevelTestOutController` — `POST /api/levelTestOut/start`, `POST /api/levelTestOut/submit`, `GET /api/levelTestOut/status` (camelCase paths) |
| Service | `LevelTestOutService` — sampling, grading, the grant; **writes no SQL** ([BACKEND_LAYERING.md](./BACKEND_LAYERING.md)), except the grant transaction, which is the documented transaction exception |
| DAL | `ILevelTestOutDAL` / `LevelTestOutDAL` — attempt rows, the level sample query, the bulk grant |
| Contract | `server/contracts/levelTestOut.ts` — item count, pass ratio, timing; shared with the client |

**The answer key never leaves the server.** `start` returns items with shuffled choices
and no correct index; `submit` sends chosen indices and the server grades. Anything else
makes the grant free to anyone with devtools.

## 8. Persistence (PROPOSED — needs confirmation, § 11 Q1)

One new table, `level_test_attempts`:

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | uuid FK users | |
| `language` | varchar | scoped like every det/vet read |
| `level` | smallint | 1–6 |
| `items` | jsonb | the drawn item list + correct answers + issue timestamps (the key) |
| `responses` | jsonb | chosen indices + client timings, written on submit |
| `score` | smallint | correct count |
| `passed` | boolean | |
| `startedAt` / `submittedAt` | timestamptz | server clock; drives the per-item limit |
| `grantedCardCount` | integer | how many vet rows the pass created/mastered — audit trail for § 6.4 |

Unique partial index on (`userId`, `language`, `level`) `WHERE passed` — one pass per
level, enforced by the DB rather than by the service.

## 9. Interactions with existing systems

- **Minute points / streaks** — a test-out grants **no** minute points
  ([MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md)); points are earned per minute
  studied, and 1,500 free masteries must not become a points exploit. Confirm (§ 11 Q5).
- **Arena** — likewise, no arena minutes ([ARENA_FEATURE.md](./ARENA_FEATURE.md)).
- **Provisional cards** — after a pass the user's playable deck is large, so lending
  mostly stops for that language. Nothing to change.
- **Level estimate** — `estimateLevel` reads *sorted* cards, so the grant moves the
  cold-start estimate by itself. Verify it doesn't overshoot to 6 after one pass.
- **Decks / collections** — the Mastered collections
  (`MASTERED_COLLECTION_IDS`) fill immediately; a 1,500-card Mastered collection is a
  paging question, not a correctness one.
- **flp supply** — `OnDeckVocabService` deprioritises mastered cards, so a passed level
  correctly stops being served for review.

## 10. Referenced code (keep in sync)

`server/contracts/mastery.ts` (`BAR_MARK_TYPES`, `barForMarkType`, `computeCoreCategory`,
`PBH_BAND`) · `server/contracts/wire.ts` (`MASTERY_BARS`, `MasteredAtByBar`,
`StarterPackBucket`, `CARD_BASELINES`) · `server/dal/shared/vetTable.ts`
(`vetTableForLanguage`, `coreCategoryExpr`, `vetSortedClause`) ·
`server/services/VocabEntryService.ts` (`addToLibrary` — the single-card analogue of
§ 6.1) · `server/services/StarterPacksService.ts` (`estimateLevel`, `_levelConfig`) ·
`server/routes/flashcardRoutes.ts` (the mark handler this path deliberately bypasses) ·
`ddCollisionKey` (gloss guard).

Docs that will need a section if this ships:
[MASTERY_REWORK.md](./MASTERY_REWORK.md) (a non-mark path to Mastered),
[DISCOVER_FLOW.md](./DISCOVER_FLOW.md) (the new dp tile),
[VELOCITY.md](./VELOCITY.md) (promotion suppression),
[GLOSS_CONFUSABILITY.md](./GLOSS_CONFUSABILITY.md) (fourth chokepoint),
CLAUDE.md (feature link + the `lto` abbreviation — **ask before editing**).

## 11. Question log (all OPEN)

1. **New table `level_test_attempts` with the columns in § 8 — approved?** Or should
   attempts be ephemeral (Redis/in-memory) with only the pass recorded on
   `user_languages`?
2. **Which bars does a pass master** — core only (recommended), or core + reading?
3. **Does a pass create vet rows for the whole level, or only master rows that already
   exist?** § 6.1 assumes the whole level; "mark all the cards of the level to mastered"
   reads that way, but it is a ~1,500-row deck gift.
4. **May synthetic marks carry `source: 'lto'` on `ReviewMark`** (wire-contract change),
   or should provenance live only on the attempt row?
5. **Confirm: no minute points, no arena minutes for a test-out.**
6. **Does passing level L imply levels 1..L−1?** Recommended yes for the *grant* (you
   cannot know HSK 4 and not HSK 1) — but that turns one HSK 6 pass into ~4,200 cards.
7. **Retry cooldown length** — 7 days proposed. And is there a cap on total attempts?
8. **es**: ship zh-only first (recommended), or both with "Level N" copy?
9. **Item format** — recognition-only 4-choice (recommended), or mix in a pinyin-typing
   production item type for stronger evidence at the cost of build time?
10. **Failure feedback** — does a failed test show which items were missed? It is good
    pedagogy but it also hands the user a study guide for the retry.
