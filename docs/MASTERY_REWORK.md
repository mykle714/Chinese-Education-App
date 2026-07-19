# Mastery Rework — Typed Marks, Goals & Progress Bar

> STATUS: **IMPLEMENTED** (migration 101). This doc captures the design and the
> shipped mechanics. Key code:
> - DB: `database/migrations/101-mastery-rework-typed-marks-and-goals.sql`
>   (`typedMarkHistory` jsonb on vet tables; `users.readingGoal`/`writingGoal`;
>   `compute_utcm_category()` + `mastery_positive_count()`; drops the generated
>   `category` column, `markHistory`, and the success-rate columns).
> - Compute: `server/utils/masteryCompute.ts` + `src/utils/masteryCompute.ts`
>   (TS mirrors of the SQL) — pbh, banding, `appendTypedMark`, the cdp bar model.
> - In-query category: `UTCM_USERS_JOIN` / `UTCM_CATEGORY_EXPR` /
>   `UTCM_CATEGORY_SELECT` in `server/dal/shared/vetTable.ts`, spliced into the
>   selection queries in `OnDeckVocabService`, `StarterPacksService`,
>   `CommunityLayoutDAL`.
> - Mark/undo: `server/routes/flashcardRoutes.ts` (typed `type` param; per-type
>   8-window; category derived in-handler).
> - Goal flags API: `PUT /api/users/goals` (`UserController.updateGoals` →
>   `UserService.updateGoals`); surfaced via `useAuth().updateGoals` and the
>   account page Goals section (`src/pages/AccountPage.tsx`).
> - Client mark sources: flp (`useWorkingLoop.ts`), Word Search
>   (`WordSearchPage.tsx`), Bubble Match (`BubbleMatchPage.tsx`), Practice Writing
>   (`PracticeWritingButton.tsx` → `PracticeWritingPopup.tsx`).
> - cdp bar: `src/features/flashcards/MasteryProgressBar.tsx` (rendered in
>   `VocabCardDetailPage.tsx`).

## Goal

Replace the single flat "correct-in-last-8" mastery model with a **four-track,
goal-weighted** model:

- Every card mark is assigned one of four **mark types**: **Recognition**,
  **Production**, **Reading**, **Writing**.
- Each card keeps the **8 most recent marks _per type_** (32 marks total,
  tracked independently), regardless of which goals the account has set.
- An account always pursues **Recognition + Production** (mandatory). It may
  additionally opt into **Reading** and/or **Writing** as goals.
- A card's utcm level (Unfamiliar / Target / Comfortable / Mastered) is derived
  from a new **progress-bar height (pbh)** number that blends the goal tracks.
- The card-detail page (cdp) shows a vertical **stacked progress bar** whose
  height = pbh and whose segments show the ratio of positive marks across all
  four types (independent of goals).

---

## 1. Mark types

Each mark gets a `type ∈ {recognition, production, reading, writing}`.

Confirmed mark sources:

| Type | Produced by | Sign |
|---|---|---|
| **Recognition** | flp **foreign-first** review (zh chars-first / es spanish-first → meaning); **Bubble Match** | correct / incorrect |
| **Production** | flp **English-first** review (meaning → foreign); **Word Search "Pinyin" mode** matches | flp: correct/incorrect. Word Search: **positive-only** (a match = positive Production mark; no negatives) |
| **Reading** | **Word Search "No Pinyin" mode** matches (`WordSearchMode = 'no-pinyin'`, `src/games/word-search/constants.ts`) | **positive-only** (same as Pinyin mode) |
| **Writing** | **Practice Writing drill** (`docs/PRACTICE_WRITING.md`), top-1 stroke grading | correct / incorrect |

The two Word Search modes already exist and are chosen at launch from the hub
(fixed per run) — the mode slug cleanly disambiguates Production vs Reading.

**These four are the _only_ emitters.** No other game or feature emits Reading or
Writing marks — Reading comes solely from Word Search No-Pinyin, Writing solely
from the Practice Writing drill.

**Scope: the mark/goal logic is language-agnostic** (nothing in the type/pbh math
is zh-specific). But the only Reading/Writing emitters (Word Search, Practice
Writing) are **zh-only games**, so an `es` card can never accrue Reading/Writing
marks. Consequently **`es` accounts never get the Reading/Writing goal toggles**
(goalCount is effectively fixed at 2 for Spanish). The code paths stay generic;
the es UI simply hides the toggles and es cards compute pbh over the 2 mandatory
tracks.

## 2. Positive-mark count (per type)

Each type has a **fixed sliding window of size 8**. `positive(type)` = number of
`isCorrect` marks in that window. **Empty slots count as negative** — a card with
fewer than 8 marks of a type has its unused window slots treated as negatives, so
a brand-new card starts every track at `positive = 0` and must earn its way up.
Range **0–8**. This is the per-type analogue of today's "correct-in-last-8".

## 3. Goals

- **Recognition** and **Production**: always goals (mandatory, not toggleable).
- **Reading** and **Writing**: per-account opt-in.
- `goalCount ∈ {2, 3, 4}`.

### Account settings UI

New **Goals** section on the **account page** (`src/pages/AccountPage.tsx`) with
two checkboxes:

- ☐ *I want to learn reading*
- ☐ *I want to learn writing*

Plus description copy:

> *Enabling a goal may demote some Mastered cards back to Comfortable — you'll
> need to train reading/writing to promote them back to Mastered.*

The toggles are **hidden for Spanish accounts** (es never accrues Reading/Writing
marks — see Section 1).

## 4. Progress-bar height (pbh) formula

```
pbh = min( 6, max( positive(g) for g in goals ) )
      + ( Σ positive(g) for g in goals except the max one ) / ( (goalCount - 1) * 3 )
```

- First term: the single highest positive count among goal tracks, **capped at
  6** (so one maxed track alone can contribute at most 6, never enough for
  Mastered on its own).
- Second term: the sum of the *remaining* goal tracks, scaled so its max
  contribution is `((goalCount-1)*8) / ((goalCount-1)*3) = 8/3 ≈ 2.67`,
  independent of goalCount.
- Overall pbh range: **0 → 6 + 8/3 ≈ 8.67**.

### utcm thresholds (by pbh)

| Level | Condition |
|---|---|
| Unfamiliar | pbh < 3 |
| Target | 3 ≤ pbh < 6 |
| Comfortable | 6 ≤ pbh < 8 |
| Mastered | pbh ≥ 8 |

### Notable consequences

- **No single track can reach Mastered alone.** With the first term capped at 6,
  the max fractional contribution needed to reach pbh ≥ 8 is ≥ 2, which requires
  the remaining goal tracks to be substantially positive too. Mastered now
  genuinely requires strength across *all* goals, not just one maxed track.
- **Demotion on adding a goal**: increasing `goalCount` raises the denominator
  `(goalCount-1)*3` and adds a 0-count track, shrinking the fractional term. A
  card previously at Mastered can drop below 8 and demote to Comfortable —
  matching the settings warning copy.

## 5. cdp stacked progress bar

- **Vertical** bar on the card-detail page.
- **Height** = pbh on a fixed axis where **pbh = 8 fills the bar** (Mastered
  fills; pbh > 8 stays clamped at full). Confirmed.
- **Segments** = the four types' **positive-mark ratio**, i.e. each segment's
  fraction = `positive(type) / Σ positive(allTypes)`, computed over **all four
  types regardless of goals**.
- **Colors** (app light palette, `src/theme/colors.ts`):
  - Recognition → **Blue** `#779BE7` (`COLORS.blueMain`)
  - Production → **Green** `#05C793` (`COLORS.greenMain`)
  - Reading → **Red** `#EF476F` (`COLORS.redMain`)
  - Writing → **Yellow** `#FF8E47` (`COLORS.yellowMain`)

  Note: these currently double as the utcm category colors (Unfamiliar=red,
  Target=yellow, Comfortable=green, Mastered=blue in `utils/categoryColors.ts`).
  Reusing them for mark types is a **semantic collision** to be aware of. **❓**

---

## 6. Per-type cooldown (flp working-loop selection)

> STATUS: **IMPLEMENTED**. Code: `server/services/OnDeckVocabService.ts`
> (cooldown helpers + both selection paths), `server/routes/flashcardRoutes.ts`
> (refill call site), `src/features/flashcards/FlashcardsLearnPage/useWorkingLoop.ts`
> (`sideOneForCard` face-steering). Types: `readyMarkTypes` on `VocabEntry`
> (`server/types/index.ts`, `src/types.ts`).

After a **correct** mark, a card is put on a **cooldown** so it doesn't
immediately reappear in the flp working loop. The window **duration** is keyed on
the card's overall utcm category (weaker = shorter, so weak cards drill more):

| Category | Window |
|---|---|
| Unfamiliar | 5 minutes |
| Target | 24 hours |
| Comfortable | 7 days |
| Mastered | 30 days |

### The timer is PER MARK TYPE

The cooldown clock is measured from that card's **last correct mark _of a given
type_** (`getLastCorrectMarkTimestampForType`), not the newest correct mark across
all tracks. So Recognition and Production cool down **independently** — getting a
card right foreign-first (Recognition) does not suppress it from coming back for an
English-first (Production) drill.

The flp can only ever present **two** of the four mark types (a foreign-first
prompt → Recognition, an English-first prompt → Production;
`markTypeForSideOne`). Reading/Writing marks come from other games (Word Search
No-Pinyin / Practice Writing) and are **never** shown in the loop, so flp cooldown
eligibility consults **only** the Recognition + Production tracks
(`FLP_MARK_TYPES`). Consequence: a correct mark earned in **another game** no
longer wrongly suppresses a card from the flp.

### Eligibility + face steering

When a card is selected for the loop (both the **initial** `getDistributedWorkingLoop`
build and the **correct-mark refill** `getNextLibraryCardWithFallback`), the
service computes `flpReadyMarkTypes(card)` = the subset of {recognition,
production} currently off cooldown:

- **≥1 ready** ⇒ the card is eligible; it's stamped with `readyMarkTypes` and the
  client's `sideOneForCard` **steers the shown face** to a ready type (only
  production ready → English-first; only recognition ready → foreign-first; both
  ready → the historical coin flip).
- **both cooling** ⇒ the card is **skipped**.

If the entire allowed pool is cooling down, selection falls back to the
**least-recently-correct** cooled card (`pickLeastRecentlyCorrectFlp` /
`fetchCooledFallbackCards`, stamped with the single closest-to-expiring type) so
the loop **never returns empty** for a user who has cards.

### Notes / caveats

- The window duration is still a whole-card property (derived from utcm category),
  even though the timer is per-type. A per-type strength-based window was
  considered and deferred.

### Games honor the same per-type cooldown

Each pool-selecting game gates its pool on the per-type cooldown of the **single
mark type it emits** (`OnDeckVocabService.isCardGameEligible` / `fetchGameCandidates`,
`server/controllers/OnDeckVocabController.ts`):

| Surface | Mark type | Selection path |
| --- | --- | --- |
| Bubble Match | `recognition` | `getGameVocabPool` |
| Word Search — Pinyin | `production` | `getWordSearchGrid` (mode via `?mode=` query) |
| Word Search — No-Pinyin | `reading` | `getWordSearchGrid` (mode via `?mode=` query) |
| Practice Writing | `writing` | — launched per-card from a flashcard; **no pool to gate** |

A card is **fresh** for a game when its game mark type is off cooldown, **cooled**
otherwise. `fetchGameCandidates` overfetches a per-category shuffled pool and
splits it fresh/cooled. Both games fill in three phases (the confirmed policy —
*prefer fresh; when out of fresh, first borrow fresh from other categories; use
cooled only as a last resort*):

1. Requested-category quotas from **fresh** cards.
2. Top up to `total` with **fresh** cards from the fallback categories
   (Target → Comfortable → Unfamiliar → Mastered).
3. Backfill any remaining shortfall with **cooled** cards (requested categories
   first, then fallback) — so a just-played library still assembles a full board
   and entry is **never blocked more than an un-cooled library would**.

Word Search's substring-dedup replacement (`pullReplacement`) uses the same
fresh-then-cooled preference across `[preferredCategory, …fallback]`.

**Cross-surface note:** Bubble Match and flp both emit `recognition`, so a Bubble
Match win cools that card's recognition face in the flp working loop, and vice
versa — the per-type clocks are shared across every surface that emits the type.

---

## Architecture / layer impact

### Data layer — storage of typed marks — DECIDED: one keyed jsonb

Today: `vocabentries_{zh,es}."markHistory"` = jsonb array (last 16), and
`category` is a GENERATED STORED column from it (migrations 67, 69).

**Decision:** add a new `typedMarkHistory` jsonb column **keyed by type**:
`{ recognition: [...≤8], production: [...≤8], reading: [...≤8], writing: [...≤8] }`.
Each track keeps its own 8 most recent `{timestamp, isCorrect}` entries.

- **Drop the old `markHistory` column entirely — no backfill, no migration of
  existing progress.** There are no real customers yet, so existing mark history
  is discarded; every card simply starts fresh (all tracks at 0). This removes
  any need for a legacy read shim.
- Defensive read rule: any mark object encountered without a `type` field
  **defaults to the `recognition` track** (cheap guard; not load-bearing now that
  old data is dropped).
- **Drop the success-rate columns** (`totalSuccessRate`, `last8SuccessRate`,
  `last16SuccessRate`) — no longer used by the new model. Keep `totalMarkCount` /
  `totalCorrectCount` lifetime aggregates (used by stats / OnDeck cooldowns).
- Drop the generated `category` column (moves to service-layer compute).
- Per-type positive counts are computed on the fly from the jsonb at read time.

### The `category` GENERATED-column problem (**major**) — DECIDED: service-layer

**Decision: (A) drop the generated column; compute pbh + utcm in the service
layer** on read, where the user's goal flags are in scope.

`category` can no longer be a pure generated column: pbh depends on `goalCount`,
a **per-account setting**, not a per-row value, and a Postgres generated column
may only reference its own row.

Implications to work through:

- Remove the `category` generated column + `compute_flashcard_category()` (a new
  migration; supersedes 67/69). Replace with a service-layer `computeUtcm(marks,
  goals)`.
- **flp selection uses a computed pbh in-query** (decided). The working-loop /
  selection queries (`OnDeckVocabService`, `StarterPacksService`) must compute
  pbh from the typed-marks jsonb + the user's `readingGoal`/`writingGoal` flags
  (passed as query params) and derive the utcm band inline, replacing the old
  `WHERE category = X` filters. This is the biggest build cost of the rework — a
  SQL helper (or generated-per-query expression) that mirrors the service-layer
  `computeUtcm` is needed so in-query filtering and read-path display agree.
- `flashcardRoutes.ts` mark/undo endpoints currently `RETURNING category`; they
  must instead compute it in the handler after the mark write.
- `FlashcardCategory` typing stays; only its derivation moves.

### Account settings — goal flags storage — DECIDED: new users columns

**Decision:** add `users.readingGoal boolean` and `users.writingGoal boolean`
(default false). Directly joinable in the flp selection queries that need
`goalCount`. Recognition + Production are implicit/mandatory (not stored).
❓Confirm column names + defaults before the migration.

---

## Decisions log

- ✅ **Recognition** = foreign-first flp + Bubble Match; **Production** =
  English-first flp + Word Search **Pinyin** mode (positive-only); **Reading** =
  Word Search **No Pinyin** mode (positive-only); **Writing** = Practice Writing
  drill (correct/incorrect). These are the **only** emitters. (Section 1.)
- ✅ **Scope**: mark/goal logic is **language-agnostic**, but Reading/Writing
  emitters are zh-only ⇒ **es never gets Reading/Writing goals** (toggles hidden;
  es pbh over the 2 mandatory tracks).
- ✅ **Sliding window**: fixed size 8 per type; **empty slots count as negative**.
- ✅ **Formula**: first term **capped at 6** (`min(6, max(positive over goals))`);
  no single track can reach Mastered alone. pbh range 0 → ~8.67.
- ✅ **category computation**: **service-layer** compute (drop generated column);
  flp selection computes **pbh in-query** from goal params.
- ✅ **Bar scale**: pbh = 8 fills the cdp bar.
- ✅ **Mark storage**: new `typedMarkHistory` keyed jsonb
  (`{recognition,production,reading,writing}`), 8 each. **Drop the old
  `markHistory` column; no backfill — existing progress is discarded** (no real
  customers yet). Typeless marks default to recognition (defensive read guard).
- ✅ **Drop success-rate columns** (`totalSuccessRate`, `last8/16SuccessRate`);
  keep `totalMarkCount`/`totalCorrectCount`.
- ✅ **Goal-flag storage**: new `users.readingGoal` / `users.writingGoal` booleans.
- ✅ **Settings host**: `src/pages/AccountPage.tsx`, labels "I want to learn
  reading" / "I want to learn writing".
- ✅ **Color collision**: ignore for now; colors to be rectified later.

## Open questions (remaining — none block the doc; resolve before build)

_All major decisions are settled._ Minor build-time confirmations:

1. `users.readingGoal` / `writingGoal` defaults — assumed `false`.
2. Whether `totalMarkCount` / `totalCorrectCount` should become per-type or stay
   all-type aggregates (kept all-type for now).

---

## References (code touched by this feature)

- `server/routes/flashcardRoutes.ts` — mark/undo endpoints (mark write path).
- `database/migrations/67-*.sql`, `69-*.sql` — `compute_flashcard_category()`.
- `server/types/index.ts` — `ReviewMark`, `FlashcardCategory`, `VocabEntry`.
- `server/services/OnDeckVocabService.ts`, `StarterPacksService.ts` — category-
  driven flp selection pipeline.
- `src/features/flashcards/VocabCardDetailBody.tsx` — cdp (progress bar host).
- `src/utils/categoryColors.ts`, `src/theme/colors.ts` — colors.
- `src/pages/AccountPage.tsx` / `SettingsPage.tsx` — Goals settings section.
