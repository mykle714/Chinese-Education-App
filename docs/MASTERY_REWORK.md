# Mastery Rework — Typed Marks, Goals & Progress Bars

> STATUS: **IMPLEMENTED** (migration 101, reworked into three bars by migration
> 143). This doc captures the design and the shipped mechanics.
>
> ⚠️ **Read § "Three bars" (Section 4) first.** Migration 101 built a single
> goal-*blended* bar; migration 143 split it into three independently-banded bars.
> Sections written against the old blended model are marked **SUPERSEDED** inline.
> Migrations 142–144 shipped to prod on 2026-08-11; their deploy runbooks are deleted.
>
> Key code:
> - DB: `database/migrations/101-mastery-rework-typed-marks-and-goals.sql`
>   (`typedMarkHistory` jsonb on vet tables; `users.readingGoal`/`writingGoal`;
>   `compute_utcm_category()` + `mastery_positive_count()`; drops the generated
>   `category` column, `markHistory`, and the success-rate columns).
>   `database/migrations/143-three-mastery-bars.sql` (`compute_core_category()`;
>   `masteredAt` → jsonb keyed by bar; `category_promotions.bar`).
> - Contract: `server/contracts/mastery.ts` — the single definition of the bars
>   (`BAR_MARK_TYPES`, `barForMarkType`, `activeBars`, `coreProgressBarHeight`,
>   `barProgressBarHeight`, `barCategory`, `computeCoreCategory`, `masteryBars`,
>   `masteredAtForBar`) plus the band arithmetic `CATEGORY_ORDER` /
>   `categoryRank()` / `bandsClimbed()`. `server/contracts/wire.ts` holds the bar
>   identity shared with the client (`MasteryBarId`, `MASTERY_BARS`,
>   `MASTERED_COLLECTION_IDS`, `parseMasteryBar`, `MasteredAtByBar`).
> - Client re-export + presentation: `src/utils/masteryCompute.ts`
>   (`BAR_LABELS`).
> - In-query category: `coreCategoryExpr` / `CORE_CATEGORY_SELECT` /
>   `typeCategoryExpr` / `barCategoryExpr` / `masteredBarClause` in
>   `server/dal/shared/vetTable.ts`, spliced into the selection queries in
>   `OnDeckVocabService`, `StarterPacksService`, `CommunityLayoutDAL`. **None of
>   them joins `users` any more** — no band depends on account state.
> - Mark/undo: `server/routes/flashcardRoutes.ts` (typed `type` param; per-type
>   8-window; the mark's bar and both bands derived in-handler).
> - Goal flags API: `PUT /api/users/goals` (`UserController.updateGoals` →
>   `UserService.updateGoals`); surfaced via `useAuth().updateGoals` and the
>   account page Goals section (`src/pages/AccountPage.tsx`).
> - Client mark sources: flp (`useWorkingLoop.ts`), Word Search
>   (`WordSearchPage.tsx`), Bubble Match (`BubbleMatchPage.tsx`), Practice Writing
>   (`PracticeWritingButton.tsx` → `PracticeWritingPopup.tsx`).
> - Bars UI: `src/features/flashcards/MasteryProgressBar.tsx` (cdp "Mastery"
>   section — one bar per active bar, each with its band chip and its per-track
>   cooldowns) and `src/components/MiniVocabCard.tsx` (the hairline strip).
>
> **Movement between bands is logged separately** — see
> [VELOCITY.md](./VELOCITY.md) (migration 137): a bar's band is derived and keeps
> no history, so the mark handler appends a `category_promotions` row — now
> carrying `bar` — whenever that bar's band before ≠ after.

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
| **Recognition** | flp **foreign-first** review (zh chars-first / es spanish-first → meaning); **Bubble Match**; **Match Speed** | correct / incorrect |
| **Production** | flp **English-first** review (meaning → foreign); **Word Search "Pinyin" mode** matches | flp: correct/incorrect. Word Search: **positive-only** (a match = positive Production mark; no negatives), and **hinted words emit nothing at all** — see note below |
| **Reading** | **Word Search "No Pinyin" mode** matches (`WordSearchMode = 'no-pinyin'`, `src/games/word-search/constants.ts`); **Speed Reading** (`docs/SPEED_READING_GAME.md`) | Word Search: **positive-only**. Speed Reading: **correct / incorrect** — see below |
| **Writing** | **Practice Writing drill** (`docs/PRACTICE_WRITING.md`), top-1 stroke grading | correct / incorrect |

**Speed Reading emits NEGATIVE reading marks, and that is intended.** It is the
first surface to do so — every other reading source is positive-only. A round is
a forced two-way choice, so a player who taps randomly scores ~50% and earns
negative reading marks at that rate. That is the correct record: the marks reflect
the answers actually given, and a player who guesses genuinely does not know the
reading. There is no accuracy floor and no mark suppression. The one exempt path
is **Skip**, because a skip is not an answer — it fires nothing, exactly as a
hinted Word Search word does.

**Word Search hints suppress the mark.** A word that received any hint on the
board emits no mark when found (`hintedWordsRef` / `markWordFound` in
`src/games/word-search/WordSearchPage.tsx`) — part of the answer was shown, so
neither a positive nor a negative reading is warranted. See
[WORD_SEARCH_GAME.md §5a](./WORD_SEARCH_GAME.md).

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

- **Recognition** and **Production**: always pursued (mandatory, not toggleable).
- **Reading** and **Writing**: per-account opt-in
  (`users.readingGoal` / `users.writingGoal`).

**A goal no longer weights anything.** Since migration 143 the flags decide only
what is *shown*: which bars render, which Mastered collections and sort options
exist, and which bars velocity sums. Reading and writing marks are recorded for
every account either way — the goal surfaces them, it does not start them.

### Account settings UI

**Goals** section on the **account page** (`src/pages/AccountPage.tsx`) with two
checkboxes:

- ☐ *I want to learn reading*
- ☐ *I want to learn writing*

Description copy (the pre-143 demotion warning is **gone** — nothing demotes now):

> *Each goal you turn on adds its own progress bar to every card, so a card can be
> mastered separately for knowing it, reading it and writing it. Your existing
> progress is never affected — and any reading or writing you have already done
> shows up straight away.*

The toggles are **hidden for Spanish accounts** (es never accrues Reading/Writing
marks — see Section 1), so an es card always has exactly one bar.

## 4. Three bars

A card carries up to **three independent progress bars**. Each is banded by the
**same** cut points, so a card can be mastered up to three times.

| Bar | Tracks | Height | Active when |
|---|---|---|---|
| **`core`** | recognition + production | blended, formula below | **always** |
| **`reading`** | reading | raw `positive(reading)`, 0–8 | `users.readingGoal` |
| **`writing`** | writing | raw `positive(writing)`, 0–8 | `users.writingGoal` |

`BAR_MARK_TYPES` (`server/contracts/mastery.ts`) is the one place this mapping
lives; `barForMarkType()` inverts it.

> **"Active when" governs DISPLAY, not computation.** Since migration 143 every bar is
> computed for every learner; the goal flag only decides whether a progress bar is drawn
> for it. A consumer may therefore band and filter on the reading or writing bar
> regardless of the account's goals — `masteredBarClause('reading')` is goal-independent
> and needs no `users` join.
>
> **Memory Map is the first consumer to depend on that.** Its map holds exactly the
> cards that are not reading-mastered, so it drives the reading track for every learner
> — including one with `readingGoal` off, who simply never sees the bar it is filling.
> A learner in that state can play the game, graduate words off their map, and watch the
> map shrink, with no reading bar anywhere in the UI to explain why. That is the
> intended behaviour ([MEMORY_MAP_GAME.md](./MEMORY_MAP_GAME.md) § 2.1), not a gap.
> Do not add a goal check to the membership clause.

### Why split

One number was being asked two questions at once — *"how well do you know this
word?"* and *"which of four skills have you drilled?"*. Under the blended formula,
turning on the reading goal **demoted** a card the learner had genuinely mastered
by sight, because a fresh empty track diluted the average. Splitting lets the
answer to each question stand on its own, and makes goal toggles inert.

### Height

**Core** keeps the original blended formula with the goal count pinned at 2
(`coreProgressBarHeight`):

```
pbh(core) = min( 6, max(positive(recognition), positive(production)) )
          + min( positive(recognition), positive(production) ) / 3
```

- First term capped at **6**, so one maxed track alone can never reach Mastered:
  8 recognition / 0 production = **Comfortable**, not Mastered.
- Second term contributes at most `8/3 ≈ 2.67`. Range: **0 → 8.67**.

**Reading and writing** use their track's raw positive count, which is already on
the 0–8 scale (`barProgressBarHeight`). That shared scale is the whole trick: one
`categoryForPbh` and one set of benchmark lines serve all three bars, and it makes
`barCategory(history, 'reading')` identical to
`computeTypeCategory(history, 'reading')` (Section 7) by construction.

### utcm thresholds (by pbh — identical for every bar)

| Level | Condition |
|---|---|
| Unfamiliar | pbh < 3 |
| Target | 3 ≤ pbh < 6 |
| Comfortable | 6 ≤ pbh < 8 |
| Mastered | pbh ≥ 8 |

A single-track bar therefore reaches Mastered only at a **perfect 8/8** window.

### Which bar does a whole-card question mean? — always `core`

Anywhere the app asks one question of a whole card, the answer comes from the core
bar. These read `compute_core_category()` / `computeCoreCategory()` and take **no
users join**:

| Consumer | Code |
|---|---|
| Deck bucket counts | `OnDeckVocabService.getCategoryCounts` |
| flp working-loop quotas + cooldown window | `OnDeckVocabService`, Section 6 |
| Level estimate | `StarterPacksService.estimateLevel` |
| Night Market community **Learning** feed (a word drops out when core is Mastered) | `CommunityLayoutDAL.ts`, [COMMUNITY_PAGE.md](./COMMUNITY_PAGE.md) |
| The mini-card badge and the `category` field on the wire | `VocabEntryBase.category` |

The per-bar reads are the exceptions, and each one is a *display* of that bar:
the Mastered collections (`masteredBarClause(bar)`), the sort options, the bars
themselves, and velocity.

### Declaring a card already known — core only

The discover/sort flows let a learner say "I already know this word" (the
`already-learned` bucket, `StarterPacksService.addCardToLibrary`). That seeds
`coreMasteredTypedMarkHistory()`: **the core bar's two tracks at 8/8, reading and
writing left empty.**

- **Both core tracks**, because the pbh first term is capped at 6 — seeding
  recognition alone would land on Comfortable, not the Mastered the learner asked for.
- **Nothing on reading or writing**, because the claim is *"I know this word"*, not
  *"I can read and write it"*. Those are separate skills with their own bars now, and
  granting them would hand the learner a finished Read bar for a character they have
  never once read — the exact conflation the three-bar split exists to undo. Turn the
  reading goal on later and the bar starts honestly at 0.

**So "mark as mastered" does NOT fill every bar.** A learner with the writing goal who
sorts a card as known still sees an empty Write bar on it, and the card appears in
*Mastered Cards* but not in *Writing Mastered*. That is the intended reading of the
three bars: only the flp and the games can fill the reading and writing ones.

### One mark moves exactly one bar

Because `BAR_MARK_TYPES` partitions the four types, a single review can promote at
most one bar. That is what keeps the mark handler to one `masteredAt` key write and
one `category_promotions` row per mark, with no fan-out.

### `masteredAt` — when each bar last crossed into Mastered (migrations 142, 143)

Every other mastery fact in this app is **derived**: a band is computed from
`typedMarkHistory` and never stored. "When did this card become Mastered" is the one
that **cannot** be, because `typedMarkHistory` is a rolling window of the last 8
marks per type — the marks that carried the card over the line are usually evicted
long before anyone asks. The transition is only observable at the instant it happens,
exactly like a band promotion (migration 137, [VELOCITY.md](./VELOCITY.md)).

Three bars cross at three different moments, so migration 143 makes
`vocabentries_zh."masteredAt"` / `vocabentries_es."masteredAt"` **jsonb keyed by
bar** (it was a bare `timestamptz` in 142):

```jsonc
{ "core": "2026-08-01T…Z", "reading": "2026-08-09T…Z" }   // writing key absent: never crossed
```

The mark handler writes exactly one key, for the bar the mark belongs to:

```
barCategoryBefore !== 'Mastered' && barCategoryAfter === 'Mastered'
    → jsonb_set("masteredAt", '{<bar>}', <the mark's own timestamp>)
```

Four rules govern each key:

* **Sticky.** Never cleared on regression. It means "the LAST time this card crossed
  into Mastered", so one bad mark cannot erase the date. A later re-crossing
  overwrites it.
* **Undo retracts its own stamp.** `/undoLastMark` removes **only the undone mark's
  bar's key**, and only when that key holds the exact timestamp of the mark being
  undone (`"masteredAt" = "masteredAt" - $6::text`) — the same rule as the
  `category_promotions` delete beside it. The key is dropped rather than rewound to
  the previous crossing, because the previous crossing is unrecoverable. This is safe
  for a bar that was already Mastered before the mark: no transition fired then, so
  the key cannot be pointing at that mark. **The other bars' keys are untouched** —
  undoing a reading mark cannot erase a core mastery date.
* **Not backfilled.** Cards already Mastered when the column shipped have no keys, for
  the same rolling-window reason. The one reader (the "Recently mastered" sort) puts
  missing dates last, so they sit at the bottom until they cross again.
* **Goal toggles do not touch it.** Trivially true since 143 — a toggle re-bands
  nothing. The rule is kept because it is now load-bearing in the other direction:
  turning a goal ON must **not** stamp the bar it reveals, even though that bar may
  already read Mastered from marks accrued while it was hidden. `masteredAt` records
  when the LEARNER carried the bar over the line, and that moment was not observed.
  **Do not "fix" this** by sweeping the vet tables on goal change.

Its only consumer today is the collection **Sort by → Date mastered**
(`src/utils/vocabSort.ts`, [DECKS_FEATURE.md](./DECKS_FEATURE.md) § "Sort by"), which
gets **one row per active bar**, each reading `masteredAtForBar(masteredAt, bar)` —
that bar's OWN stamp. Deliberately not the newest across bars: the three are three
separate achievements, and collapsing them to a max would let a reading crossing
silently reorder the list a learner is reading as their core progress. No query
orders or filters on it, so it carries no index.

## 5. The progress bars on screen

### cdp — one vertical bar per active bar

`src/features/flashcards/MasteryProgressBar.tsx` renders
`masteryBars(entry.typedMarkHistory, goals)` — one `BarTrack` each, captioned from
`BAR_LABELS` (**Know** / **Read** / **Write**). With no goals set the page looks
exactly as it did before the rework: a single bar.

- **Height** = that bar's pbh on a fixed axis where **pbh = 8 fills the bar**
  (Mastered fills; pbh > 8 stays clamped at full).
- **Segments** = the **positive-mark ratio across that bar's OWN tracks**. So the
  core bar is a two-color stack (recognition / production) and the reading and
  writing bars are single-color. A segment's fraction is
  `positive(type) / Σ positive(bar's types)`.
- **No band chip.** The bars carry no utcm label of their own — the benchmark lines
  already show where a bar sits, and the card's band is on the badge row at the top of
  the page. (The single **core**-band chip that used to sit beside the group is gone
  too; core is still the whole-card answer everywhere else — deck counts, mini card.)
- Under each label sit that bar's **cooldown rows** — one per mark type in the bar, so
  the core column shows two — each a live **`4m 1w 3d 5h 37m 26s` countdown**
  (`formatCooldownRemaining`, `src/utils/formatDuration.ts`). Same unit discipline as
  the minute-points formatter beside it: leading zero units dropped, **middle zero
  units kept**, seconds always printed. The middle zeros are load-bearing here — `m`
  is both months and minutes, so a collapsed `6m 26s` would read as six *minutes*. A
  **ready track reads `0s`**, not a word, so every row has the same shape. Months are
  a flat 30 days and weeks a flat 7, so the 180-day Mastered window is exactly
  `6m 0w 0d 0h 0m 0s` (the one string long enough to wrap to a second line). Rendered
  monospace + `tabular-nums` so the row doesn't jitter as digits change; a resting row
  is dimmed, and a ready one adds a small green **check** (12px
  `CheckCircleRounded`) beside the `0s` so the state is scannable without reading
  digits; the row tooltip carries the wording. The component ticks on a **1s** interval so an
  open page runs down to zero without a reload.
  - Row order is **`COOLDOWN_ROW_ORDER`** — production above recognition — which is
    deliberately *not* the bar's segment order (the fill stacks recognition below
    production, per `BAR_TYPE_ORDER`).
  - The window used for the display is the **per-type** category
    (`computeTypeCategory`) — the one every *game* uses. ⚠️ The **flp** widens its
    window to the card's **core** category (§ 6), so on a card whose per-type and core
    bands differ the flp holds that track back slightly longer than the cdp number
    suggests. The display can only name one window; the per-type one is the track's own.
- The legend lists only the types actually on screen.

**Placement.** The bars are their own `SectionCard` ("Mastery") **below the hero
card**, alongside Definition / Breakdown / Examples — see
`src/features/flashcards/VocabCardDetailPage.tsx`. They used to be a strip beside a
cpcd block above the hero; three columns × two cooldown rows needs the full width.
The cpcd block stays where it was, without the bars. The section lives in the page
rather than in the shared `VocabCardDetailBody` because the read-only **dictionary**
cdp has no marks to draw.

### Mini cards — a hairline strip

`src/components/MiniVocabCard.tsx` draws the active bars as up to three 3px-tall,
30px-wide tracks stacked bottom-left with a margin (`BAR_STRIP`), each filled to
`heightFraction`. The English definition is lifted by `barStripHeight(n)` to make
room, so a one-bar card sits where it always did and only a goal-bearing account
pays the vertical space. The **badge stays**, colored by the **core** band.

Each fill carries the **same per-type segment breakdown as the cdp bar** — the core
strip splits between recognition blue and production green in proportion to their
positive counts, so a card strong one way and weak the other reads that way at
thumbnail size too. It runs left-to-right where the cdp runs bottom-up, so the first
type sits at the track's origin in both. Zero-count segments are dropped rather than
rendered at 0 width.

- **Colors** — one hue per **mark type**, shared by both surfaces and the Games hub
  chip (`MARK_TYPE_COLORS`, `src/utils/masteryCompute.ts`). There is deliberately
  **no per-bar color**: every surface paints a bar by its segments, so a bar has no
  single color of its own to name. From the app light palette
  (`src/theme/colors.ts`):
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
| Comfortable | 14 days |
| Mastered | 6 months (180 days) |

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

### Ordering: a queue, longest-waiting first

Eligible cards are ranked by `rankFlpEligible` (`OnDeckVocabService.ts`), which is the
**single ordering rule for both flp paths** — the initial loop and the refill draw the
same way, so a loop and its replacements cannot diverge.

> **The rule itself now lives in `server/services/cardQueueRanking.ts`** (a pure module:
> `rankCardQueue`, `queueArrivalAt`), over the cooldown primitives in
> **`server/contracts/cooldown.ts`** (`COOLDOWN_MS_BY_CATEGORY`,
> `lastCorrectMarkTimestamp`, `cooldownRemainingMs`, `isTypeOnCooldown`,
> `readyMarkTypes`). The primitives moved into `contracts/` — mirroring what
> `contracts/mastery.ts` did for the pbh formula — when the cdp started **displaying**
> the remaining cooldown (§ 5): the client may not import a server service, and a
> second copy of the table would have drifted. `cardQueueRanking` re-exports them, so
> every existing server import is unchanged; the client reaches them through
> `src/utils/masteryCompute.ts`.
> **A third consumer:** the collection "Sort by" menu's **Cooldown** row
> (`cooldownKey` in `src/utils/vocabSort.ts`) orders cards by the **maximum** remaining
> window across all four types — "how long until this card is fully rested" — using the
> same per-type category the cdp display does. The maximum rather than the soonest-ready
> track because an unmarked track reports 0, which would flatten nearly every card to
> "ready". See [DECKS_FEATURE.md § "Sort by"](./DECKS_FEATURE.md).
> `rankFlpEligible` is a thin wrapper that supplies the flp's two axes — mark types
> `['recognition','production']`, cooldown window keyed on the card's **core** category —
> and stamps `readyMarkTypes` onto the result. The extraction happened when Memory Map
> needed the identical discipline on the **reading** track
> ([MEMORY_MAP_GAME.md](./MEMORY_MAP_GAME.md) § 13.1); a second copy would have drifted.
> Behaviour for the flp is unchanged, and is now covered by
> `server/__tests__/cardQueueRanking.test.ts`.

The sort key is `flpReadyAt` = the card's **arrival time in the queue**, i.e. when it
*first* became reviewable:

```
readyAt(card) = MIN over its ready types of ( lastCorrect(type) + window(overall category) )
                  — skipping tracks with no correct mark

ranked        = [ cards with history, by readyAt ASC ]   // longest-waiting first
             ++ [ never-marked cards ]                   // always last
```

- **MIN, not MAX**, across the ready types — this is what makes it a queue. A card whose
  recognition track has been ready for ten days is ten days overdue even if its
  production track only came off cooldown yesterday.
- Tracks with **no correct mark** are **skipped**, not treated as ready-since-forever.
  Counting them would score `-Infinity` for any *partially* marked card and drop it into
  the never-marked tail, which is wrong — the learner has gotten that card right, just in
  one track.
- A card scores `-Infinity` only when **neither** flp track has a correct mark. That is
  the definition of "never marked", and those cards sort **last** — so brand-new sorts
  and lent provisional cards are reached only once genuinely rested cards run out.

**The never-marked tail needs its own tier, not just a timestamp.** `-Infinity` in an
*ascending* sort would land at the front, which is the opposite of what we want, so the
comparator compares the tier before the timestamp. Equal timestamps return `0` rather
than subtracting (`-Infinity - -Infinity` is `NaN`, which would leave the sort
undefined); ties keep the SQL order, `createdAt DESC`.

**The ranking picks WHICH cards, not the play order.** It runs *inside* each utcm quota:
the 1/2/2/5 Mix distribution still decides how many cards come from each mastery bucket,
and this decides which cards fill them. The assembled loop is then shuffled
(`shuffleInPlace`, Fisher–Yates) so a session doesn't march predictably from most- to
least-overdue.

Because ranking needs `typedMarkHistory`, it is computed in app code and the candidate
query (`fetchFlpCandidates`) is deliberately **unlimited** — a partial scan would rank a
random subset and return the wrong card.

### When everything is cooling: honor it

There is **no cooled-card last resort**. A resting card is never re-served. Instead:

Since 2026-08-17 lending is not only the all-cooling escape hatch: it runs whenever a
**quota** underfills, ahead of any cross-category borrow (docs/PROVISIONAL_CARDS.md § 4b).
The gate below is the same one.

| Session | A quota short / all cards cooling ⇒ |
|---|---|
| Mix, Challenge (unrestricted) | **lend provisional cards** to fill the shortfall (`lendIntoLoop` → `ProvisionalCardService.lendCards`) |
| Review, `?collection=mastered`, `?deck=` | return **short or empty**; the client shows a "resting" empty state |

The split is one rule, `canLendProvisional`: lend only when `Unfamiliar` is a servable
category **and** the round is unrestricted. A lent card is Unfamiliar, so anywhere else it
would either be filtered straight back out or misrepresent a named set. This is also why
`POST /api/flashcards/mark` now returns **200 with `newCard: null`** for *every* session
type instead of 404-ing Study — an unrestricted round can legitimately run dry when the
dictionary has no more words to lend. See docs/PROVISIONAL_CARDS.md § 6.

### Notes / caveats

- **flp only:** the window duration is a whole-card property (derived from the
  overall utcm category), even though the timer is per-type. Games no longer share
  this — they key the duration on the per-type category of the track they play
  (Section 7).

### Games honor the same per-type cooldown

Each pool-selecting game gates its pool on the per-type cooldown of the **single
mark type it emits** (`OnDeckVocabService.isCardGameEligible` / `fetchGameCandidates`,
`server/controllers/OnDeckVocabController.ts`):

| Surface | Mark type | Selection path |
| --- | --- | --- |
| Bubble Match | `recognition` | `getGameVocabPool` (via `?markType=recognition`) |
| Match Speed | `recognition` | `getGameVocabPool` (via `?markType=recognition`) |
| Speed Reading | `reading` | `getGameVocabPool` (via `?markType=reading`) |
| Word Search — Pinyin | `production` | `getWordSearchGrid` (mode via `?mode=` query) |
| Word Search — No-Pinyin | `reading` | `getWordSearchGrid` (mode via `?mode=` query) |
| Practice Writing | `writing` | — launched per-card from a flashcard; **no pool to gate** |

**One constant per game, three consumers.** Each game's mark type is declared once
in its own `constants.ts` (`MARK_TYPE` in `src/games/bubble-match/constants.ts`,
`src/games/match-speed/constants.ts`, `src/games/speed-reading/constants.ts`) and
read from there by all three places that need it: the `?markType=` pool query, the
`markFlashcard({ type })` call, and the Games hub's mark-type chip (via
`GameDef.markType` in `src/games/registry.ts`, rendered by
`src/components/MarkTypeChip.tsx`). Word Search is the exception — its mark type is
**per mode**, so it lives on `WordSearchModeConfig.markType`
(`src/games/word-search/constants.ts`) and is read by `WordSearchPage`'s mark call
and by `WordSearchHubItem`'s per-sub-card chip. Nothing repeats the string literal,
so the label a player sees cannot drift from the mark that is actually written.

**The hub names the track.** Every Games-hub card carries a `MarkTypeChip
variant="edge"` — the uppercase track name in faded grey, turned 90° and run up
the card's right edge — so a player can see which of the four tracks a game feeds
*before* opening it. The label is the shared `MARK_TYPE_LABELS`
(`src/utils/masteryCompute.ts`). Note the edge variant deliberately drops the
colored dot, so **the hub is the one surface where a track is not shown in its
`MARK_TYPE_COLORS` hue**; everywhere else (cdp stacked progress bar, the pill
variants of this chip) one track is one hue. See
[HUB_MENU_SYSTEM.md § Edge label slot](./HUB_MENU_SYSTEM.md).

> **`getGamePool` is parameterized, not recognition-with-an-exception.** It used
> to hardcode `'recognition'` when Bubble Match was its only caller. Speed Reading
> emits
> **reading** marks, so pooling through it unchanged would have gated on the wrong
> cooldown track and bucketed by the wrong per-type category — a card just read
> correctly would come straight back, while a card weak in reading would be
> treated as strong because recognition of it is good. The endpoint now takes
> `?markType=` and **every caller passes it explicitly**; the internal default is
> a safety net for a malformed request, not a calling convention.

A card is **fresh** for a game when its game mark type is off cooldown, **cooled**
otherwise. `fetchGameCandidates` overfetches a per-category shuffled pool and
splits it fresh/cooled. Both games fill in four phases (the confirmed policy —
*prefer fresh; lend before borrowing from another category; use cooled only as a
last resort*):

1. Requested-category quotas from **fresh** cards.
2. **Lend** the shortfall (`lendGameCandidates` → `ProvisionalCardService.lendCards`),
   2026-08-17. A lent row has no marks, so it is always `Unfamiliar` and always fresh
   — a short board therefore skews `Unfamiliar` rather than skewing toward whichever
   bucket had surplus. Skipped for a collection-restricted pool and for a partial
   refill (`need`); see docs/PROVISIONAL_CARDS.md § 4b.
3. Top up to `total` with **fresh** cards from the fallback categories
   (Target → Comfortable → Unfamiliar → Mastered).
4. Backfill any remaining shortfall with **cooled** cards (requested categories
   first, then fallback) — so a just-played library still assembles a full board
   and entry is **never blocked more than an un-cooled library would**.

Word Search's substring-dedup replacement (`pullReplacement`) uses the same
fresh-then-cooled preference across `[preferredCategory, …fallback]`.

**Cross-surface note:** Bubble Match and flp both emit `recognition`, so a Bubble
Match win cools that card's recognition face in the flp working loop, and vice
versa — the per-type clocks are shared across every surface that emits the type.

---

## 7. Games select by their own mark type

> STATUS: **IMPLEMENTED** (migration 128). Code:
> `database/migrations/128-add-compute-type-category.sql` (`compute_type_category`),
> `server/dal/shared/vetTable.ts` (`typeCategoryExpr`),
> `server/utils/masteryCompute.ts` (`computeTypeCategory`),
> `server/services/OnDeckVocabService.ts` (`fetchGameCandidates`,
> `isCardGameEligible`, `isTypeOnCooldown`, `getGameVocabPool`,
> `getWordSearchGrid`), `server/controllers/OnDeckVocabController.ts`.

A pool-selecting game buckets its candidate words by the **recent mark history of
the single mark type that game emits** — not by the card's overall, goal-blended
utcm category.

### Why

The core band answers *"how far along is this card overall?"* by blending
recognition and production through the pbh formula. That is right for the flp (which
presents two mark types on one card) and the decks page, but wrong for a game that exercises
exactly one track. A card with a maxed Recognition window and an empty Reading
window reads as **Comfortable** overall, so Word Search No-Pinyin used to serve it
as a Comfortable word even though the learner has never once read it. The game's
distribution (its Unfamiliar/Target/Comfortable/Mastered quotas) is a statement
about how hard the board should be *for the skill being trained*, so it must read
the track being trained.

### Per-type bands

`compute_type_category(typedMarkHistory, markType)` bands that one track's raw
positive count — the same 0–8 window and same "empty slots are negative" rule as
`mastery_positive_count` — at the **same cut points as the pbh bands**:

| positive(type) | Band |
|---|---|
| 0–2 | Unfamiliar |
| 3–5 | Target |
| 6–7 | Comfortable |
| 8 | Mastered |

Mastered therefore requires a **perfect 8/8** window for that type. The TS mirror
`computeTypeCategory` reuses `categoryForPbh` directly, since the cut points are
shared by construction.

Since migration 143 the reading and writing **bars** are this same computation —
`barCategoryExpr('reading')` delegates to `typeCategoryExpr('reading')`. A game's
per-type bucket and the bar the learner watches are therefore the same number, which
is the intended coherence, not a coincidence to be refactored apart.

The mark type is passed as a bind parameter, never interpolated. Post-143 **no**
category expression joins `users` — bands are goal-independent across the board.

### Which type each surface uses

| Surface | Buckets by | Cooldown window keyed on |
| --- | --- | --- |
| Bubble Match | `recognition` per-type category | `recognition` per-type category |
| Match Speed | `recognition` per-type category | `recognition` per-type category |
| Word Search — Pinyin | `production` per-type category | `production` per-type category |
| Word Search — No-Pinyin | `reading` per-type category | `reading` per-type category |
| Speed Reading | `reading` per-type category | `reading` per-type category |
| flp working loop | **core** band (unchanged) | **core** band (unchanged) |
| decks page counts | **core** band (unchanged) | — |

The flp keeps the whole-card band because it presents **two** mark types on one
card — and those two are exactly the core bar's tracks, so "the flp's band" and "the
core bar" are the same thing by construction.

**The bucket is visible on the wire.** `fetchGameCandidates` stamps each returned
row with `gameCategory` — the per-type bucket it was actually drawn from — which is
deliberately distinct from the row's `category` (the **core** band that
`CORE_CATEGORY_SELECT` fills in). Both ride on the same entry and mean different
things, so the names must stay explicit. Match Speed keys its client-side card
buffer off `gameCategory` (docs/MATCH_SPEED_GAME.md § Backend change); Bubble Match
and Word Search ignore it. It reports the queue actually drained, so it stays
truthful when a short bucket is topped up from `GAME_FALLBACK_ORDER`.

Because the service signature is now a single `gameMarkType: MarkType` (it was a
`readonly MarkType[]`), per-type bucketing is unambiguous — a game that emitted two
types would have no single track to band on. Every current game emits exactly one.

### Cooldown windows follow the same track

`isTypeOnCooldown` now takes an explicit `windowCategory`. The **duration** table
(5 min / 24 h / 7 d / 30 d) is unchanged, but games look it up under the **per-type**
category rather than the overall one, so a card that is Mastered overall yet weak in
Reading rests only 5 minutes before Word Search No-Pinyin may serve it again. The
flp passes `card.category` and behaves exactly as before.

### Known divergence: `available` counts

The `available` map both game endpoints return still comes from
`getCategoryCounts`, which uses the **core** band (it is shared with the
decks page). So the client's "you have N Comfortable cards" hint can disagree with
the pool the same request assembled. This is a deliberate trade (one shared count
source); if the hints ever need to match, add a per-type count variant for the game
callers rather than switching `getCategoryCounts` itself.

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
  `last16SuccessRate`) — no longer used by the new model. The `totalMarkCount` /
  `totalCorrectCount` lifetime aggregates were kept at the time (this doc claimed
  they were "used by stats / OnDeck cooldowns" — they were not; nothing read them),
  and **migration 149 dropped them** once that was confirmed.
- Drop the generated `category` column (moves to service-layer compute).
- Per-type positive counts are computed on the fly from the jsonb at read time.

### The `category` GENERATED-column problem (**major**) — DECIDED: service-layer

> ⚠️ **Historical.** The reasoning below was true of migration 101's goal-blended
> band. Migration 143 removed the dependency on account state entirely — every band
> is now a pure function of one row's `typedMarkHistory`, which is why
> `compute_core_category()` is `IMMUTABLE` and takes no goal arguments, and why the
> `users` join is gone from every selection query. The column was **not** restored to
> GENERATED (a service-layer compute is now load-bearing for the per-bar reads too),
> but it could be — that option reopened.

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
(`NOT NULL DEFAULT false`). Directly joinable in the flp selection queries that need
`goalCount`. Recognition + Production are implicit/mandatory (not stored).
✅ Column names and defaults confirmed 2026-08-17 against the live columns.

---

## Decisions log

- ✅ **Recognition** = foreign-first flp + Bubble Match; **Production** =
  English-first flp + Word Search **Pinyin** mode (positive-only); **Reading** =
  Word Search **No Pinyin** mode (positive-only) + **Speed Reading** (correct/incorrect);
  **Writing** = Practice Writing
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

### Migration 143 — the split into three bars

- ✅ **Three bars**: `core` (recognition + production, always active), `reading`,
  `writing` (each its track's raw 0–8 count, goal-gated **display only**). Same cut
  points for all three, so a card can be mastered up to three times.
- ✅ **Non-goal tracks keep accruing.** The goal hides the bar, it does not stop the
  marks — so turning a goal on reveals progress already earned.
- ✅ **Goal toggles demote nothing.** The account-page warning copy is replaced.
- ✅ **Whole-card questions are CORE ONLY**: deck counts, level estimate, the
  community Learning feed drop-out, the mini-card badge, flp quotas.
- ✅ **Three Mastered collections** on the fdp, goal-gated rows; counts from
  `GET /api/onDeck/masteredCounts`.
- ✅ **Sort options are per bar**, and a bar's rows appear only when its goal is set.
  The menu is BUNDLED — one row per dimension, both directions as toggles — so every
  ordering is readable in reverse without doubling the menu.
- ✅ **`masteredAt` is jsonb keyed by bar**; "Date mastered" gets one row per active
  bar, each reading that bar's OWN stamp. *(Revised from "latest across the active
  bars": three bars are three achievements, and a max let one reorder another's list.)*
- ✅ **Velocity sums band-steps across bars, but only the GOAL bars.** Every bar's
  promotion is logged (`category_promotions.bar`); the filter is applied at read, so
  switching a goal on retroactively enriches the number instead of restarting it.
- ✅ **"Mark as mastered" (discover/sort) fills the CORE bar only** — 8/8 on
  recognition + production, reading and writing left at 0. *(Revised: the first pass
  seeded all four tracks. Declaring you know a word is not a claim about reading or
  writing it, and a seeded Read bar would be a lie the learner never told.)*
- ✅ **Games and the flp are unchanged.**
- ✅ **Mark storage**: new `typedMarkHistory` keyed jsonb
  (`{recognition,production,reading,writing}`), 8 each. **Drop the old
  `markHistory` column; no backfill — existing progress is discarded** (no real
  customers yet). Typeless marks default to recognition (defensive read guard).
- ✅ **Drop success-rate columns** (`totalSuccessRate`, `last8/16SuccessRate`);
  `totalMarkCount`/`totalCorrectCount` were kept here but dropped later by
  migration 149 — see the References section.
- ✅ **Goal-flag storage**: new `users.readingGoal` / `users.writingGoal` booleans.
- ✅ **Settings host**: `src/pages/AccountPage.tsx`, labels "I want to learn
  reading" / "I want to learn writing".
- ✅ **Color collision**: ignore for now; colors to be rectified later.

## Open questions (remaining — none block the doc; resolve before build)

_All major decisions are settled._ One minor build-time confirmation remains:

1. Whether `totalMarkCount` / `totalCorrectCount` should become per-type or stay
   all-type aggregates (kept all-type for now). Tracked as item 1 of
   [DEFERRED_WORK.md](./DEFERRED_WORK.md).

Settled since:

- ✅ **`users.readingGoal` / `writingGoal` defaults** — `boolean NOT NULL DEFAULT false`
  (confirmed 2026-08-17). Neither goal is pursued until an account opts in on
  `src/pages/AccountPage.tsx`, so no existing account's bars change height on deploy day.

---

## References (code touched by this feature)

- `server/routes/flashcardRoutes.ts` — mark/undo endpoints (mark write path; also
  writes/deletes the `category_promotions` velocity log — see [VELOCITY.md](./VELOCITY.md)).
- `database/migrations/67-*.sql`, `69-*.sql` — `compute_flashcard_category()`.
- `database/migrations/142-add-mastered-at-to-vocabentries.sql` — `masteredAt`, plus
  its stamp/retract sites in `server/routes/flashcardRoutes.ts` and its one reader,
  `src/utils/vocabSort.ts`.
- `database/migrations/143-three-mastery-bars.sql` — `compute_core_category()`,
  `masteredAt` → jsonb, `category_promotions.bar`. On prod since 2026-08-11; it
  intentionally left `compute_utcm_category()` in place for the deploy window.
- `database/migrations/147-drop-compute-utcm-category.sql` — the contract half of the
  above: drops the now-dead `compute_utcm_category()`. Applied on dev 2026-08-17,
  **not yet on prod** — it rides along with the next `/deploy` and needs no runbook; see
  [DEFERRED_WORK.md](./DEFERRED_WORK.md) § Recently closed for the verification SQL.
- `database/migrations/149-drop-lifetime-mark-counters.sql` — drops vet's
  `totalMarkCount` / `totalCorrectCount`. Migration 101 kept them when it dropped the
  success-rate columns they fed; nothing ever read them again, so they were write-only
  from 101 until 149. ⚠️ **Contract migration** — the code that stopped writing them
  (`flashcardRoutes` mark + undo, `VocabEntryDAL.updateTypedMarkHistory`) must be live
  first, which the standard `/deploy` order already guarantees. Applied on dev
  2026-08-17, **not yet on prod**.
- `server/contracts/mastery.ts` — **the definition of the bars**; mirrored by
  `server/__tests__/mastery.test.ts`, which pins the TS/SQL agreement.
- `server/contracts/wire.ts` — `MasteryBarId`, `MASTERY_BARS`,
  `MASTERED_COLLECTION_IDS`, `parseMasteryBar`, `MasteredAtByBar`.
- `server/dal/shared/vetTable.ts` — `coreCategoryExpr`, `barCategoryExpr`,
  `masteredBarClause`, `typeCategoryExpr`.
- `server/types/index.ts` — `ReviewMark`, `FlashcardCategory`, `VocabEntry`.
- `server/services/OnDeckVocabService.ts` (`getCategoryCounts` = core only;
  `getMasteredCountsByBar`; `getBuiltinCollectionCards`),
  `StarterPacksService.ts` (`estimateLevel` = core only).
- `server/controllers/OnDeckVocabController.ts` + `server/routes/onDeckRoutes.ts` —
  `GET /api/onDeck/masteredCounts`, `GET /api/onDeck/collectionCards?collection=`.
- `server/contracts/cooldown.ts` — `COOLDOWN_MS_BY_CATEGORY`,
  `lastCorrectMarkTimestamp`, `cooldownRemainingMs`, `isTypeOnCooldown`,
  `readyMarkTypes`. Re-exported by `server/services/cardQueueRanking.ts` (server) and
  `src/utils/masteryCompute.ts` (client).
- `src/features/flashcards/MasteryProgressBar.tsx` (cdp bars + per-track cooldowns),
- `src/utils/vocabSort.ts` (`cooldownKey` — the Cooldown sort row),
  `src/components/MiniVocabCard.tsx` (hairline strip),
  `src/features/flashcards/VocabCardDetailPage.tsx` — the "Mastery" `SectionCard`
  that hosts the bars,
  `src/features/flashcards/VocabCardDetailBody.tsx` — `SectionCard`/`SectionLabel`.
- `src/utils/formatDuration.ts` → `formatCooldownRemaining` (tested by
  `src/__tests__/formatDuration.test.ts`).
- `src/features/flashcards/collectionRef.ts`, `FlashcardsDecksPage.tsx`,
  `CollectionViewPage.tsx`, `src/hooks/useMasteredCounts.ts` — the three Mastered
  collections. See [DECKS_FEATURE.md](./DECKS_FEATURE.md).
- `src/utils/vocabSort.ts` — the per-bar sort keys.
- `src/utils/categoryColors.ts`, `src/theme/colors.ts` — colors.
- `src/pages/AccountPage.tsx` / `SettingsPage.tsx` — Goals settings section.
