# Mastery Rework — Typed Marks, Goals & Progress Bars

> STATUS: **IMPLEMENTED** (migration 101, reworked into three bars by migration
> 143). This doc captures the design and the shipped mechanics.
>
> ⚠️ **Read § "Three bars" (Section 4) first.** Migration 101 built a single
> goal-*blended* bar; migration 143 split it into three independently-banded bars.
> Sections written against the old blended model are marked **SUPERSEDED** inline.
> Migrations 142–144 shipped to PPE on 2026-08-11; their deploy runbooks are deleted.
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
> - Mark/undo: `server/services/FlashcardMarkService.ts` → `applyMark` / `undoMark`
>   (typed `type` param; per-type 8-window; the mark's bar and both bands derived in
>   the service). `server/routes/flashcardRoutes.ts` is now HTTP plumbing only, and
>   the vet read/write is `VocabEntryDAL.findMarkState` / `updateMarkHistory`.
> - Goal flags API: `PUT /api/users/goals` (`UserController.updateGoals` →
>   `UserService.updateGoals`); surfaced via `useAuth().updateGoals` and the
>   account page Goals section (`src/pages/AccountPage.tsx`).
> - Client mark sources: flp (`useWorkingLoop.ts`), Word Search
>   (`WordSearchPage.tsx`), Bubble Match (`BubbleMatchPage.tsx`), Practice Writing
>   (`PracticeWritingButton.tsx` → `PracticeWritingPopup.tsx`).
> - Bars UI: `src/components/mastery/MasteryWindow.tsx` (cdp "Mastery" section — the
>   eight-mark `.msb` window for **one** track at a time, defaulting to the surface's
>   lens, with its per-track cooldowns) and `src/components/MiniVocabCard.tsx` (the
>   hairline strip, likewise one bar). `MasteryProgressBar` was deleted 2026-08-24.
>
> **Movement between bands is logged separately** — see
> [VELOCITY.md](./VELOCITY.md) (migration 137): a bar's band is derived and keeps
> no history, so `applyMark` appends a `category_promotions` row — now
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
| **Recognition** | flp **foreign-first** review, **pinyin shown or not** (zh chars-first / es spanish-first → meaning; § 1a); **Bubble Match**; **Match Speed**; **Hydra Bubbles** | correct / incorrect |
| **Production** | flp **English-first** review (meaning → foreign); **Word Search "Pinyin" mode** matches | flp: correct/incorrect. Word Search: **positive-only** (a match = positive Production mark; no negatives), and **hinted words emit nothing at all** — see note below |
| **Reading** | **Bubble Match** with pinyin off (§ 1a); **Word Search "No Pinyin" mode** matches (`WordSearchMode = 'no-pinyin'`, `src/games/word-search/constants.ts`); **Speed Reading** (`docs/SPEED_READING_GAME.md`) | flp: correct / incorrect. Word Search: **positive-only**. Speed Reading: **correct / incorrect** — see below |
| **Writing** | **Practice Writing drill** (`docs/PRACTICE_WRITING.md`), top-1 stroke grading | correct / incorrect |

**Speed Reading emits NEGATIVE reading marks, and that is intended.** It is the
first surface to do so — every other reading source is positive-only. A round is
a forced two-way choice, so a player who taps randomly scores ~50% and earns
negative reading marks at that rate. That is the correct record: the marks reflect
the answers actually given, and a player who guesses genuinely does not know the
reading. There is no accuracy floor and no mark suppression. The one exempt path
is **Skip**, because a skip is not an answer — it fires nothing, exactly as a
hinted Word Search word does.

> ⚠️ **That argument is now known to be wrong, and § 8.1 is the rework.** It holds for
> the *ratio* of a guesser's marks but not for the *window*: `positive(reading)` is a
> COUNT and the bands are cut on the count, so a pure guesser settles around 4/8 =
> **Target** on the reading bar. Nothing below has changed yet.

**Word Search hints suppress the mark.** A word that received any hint on the
board emits no mark when found (`hintedWordsRef` / `markWordFound` in
`src/games/word-search/WordSearchPage.tsx`) — part of the answer was shown, so
neither a positive nor a negative reading is warranted. See
[WORD_SEARCH_GAME.md §5a](./WORD_SEARCH_GAME.md).

The two Word Search modes already exist and are chosen at launch from the hub
(fixed per run) — the mode slug cleanly disambiguates Production vs Reading.

### 1a. Pinyin off → the reading track (Bubble Match only; NOT the flp)

> STATUS: **CHANGED 2026-09-25 — the flp no longer takes part.** Code: `foreignPromptTrack`
> + `ForeignPromptTrack` (`server/contracts/wire.ts`; the type was `FlpForeignTrack`),
> read by `src/games/bubble-match/BubbleMatchPage.tsx`. The flp side of this section —
> `flpMarkTypes`, `parseFlpForeignTrack`, the `?foreignTrack=` wire parameter on
> `GET /api/onDeck/distributedWorkingLoop`, `GET /api/onDeck/flpReadyCounts` and
> `POST /api/flashcards/mark`, and `OnDeckVocabService.DEFAULT_FOREIGN_TRACK` — was
> **deleted** with the know merge (§ 6).

A zh prompt shown foreign-first **with pinyin** can be answered off the phonetic aid, so
it tests recognition of the meaning. Without pinyin the learner must get to the meaning
**from the characters alone**, which is what the Reading track means — the call Word
Search's No-Pinyin mode makes.

**The flp writes know marks only, whatever the pinyin setting.** From 2026-08-22 to
2026-09-25 a pinyin-off zh flp session wrote `reading` on its foreign-first face. That
was reversed with the know merge (§ 6): the flp's two faces are now always
`production` (English-first) and `recognition` (foreign-first), and "Show pinyin" is a
display setting only. Reading marks come from the **dedicated reading flp** (built
2026-10-02): `/flashcards/learn?bar=reading` (plus `&mode=review|challenge`), launched
from the Reading Center's card hand — the fdp's Challenge / Review / Study Mix hand
(`FlpStudyHand`) on the reading bar. It always opens on the characters with no pinyin and no
narration, the answer face always shows pinyin, every mark is `reading`, and the server
bands, queues and cools that loop on the READING bar (the `bar` parameter,
`server/contracts/studyMode.ts` → `FlpBar`, threaded through `OnDeckVocabService.ts`;
the refill paces on `markedBarCategoryBefore`). See
[READING_WRITING_CENTERS.md](./READING_WRITING_CENTERS.md) § Phase 4.
`markTypeForSideOne` / `sideOneForCard` (`src/utils/flpFaceSteering.ts`, both now taking
the session's `mode`) are the mapping.

**Bubble Match is the rule's one consumer**: a pinyin-off zh board marks `reading`, and
its pool is requested on that track. Two properties, both forced by it being a game —
see
[GAMES_FEATURE.md § "Bubble Match: pinyin picks the track"](./GAMES_FEATURE.md):

* the track is **latched when the board is dealt** and held for the run (including
  Play-Again refills), because a game's whole pool is bucketed and cooled up front;
* so the toggle moved OUT of the game and onto the **Games hub**
  (`BubbleMatchTrackToggle`). Since 2026-10-03 there is no toggle at all: each
  launcher **pins** the track (`state.showPinyin`). The Games hub pins Recognition and
  the Reading Center's games carousel pins Reading
  ([GAMES_FEATURE.md](./GAMES_FEATURE.md) § "Bubble Match: pinyin picks the track").
  A reading run is silent — no autoplay, no narration — since hearing
  the word would supply the reading being tested.

> **Hydra Bubbles is next, and the setting is going per-game** (decided 2026-08-23,
> **not built**). Two changes that must land together:
>
> 1. **Pinyin becomes a per-game setting.** Today Bubble Match, Hydra and Match Speed
>    share the flp's one `showPinyin` boolean, so switching Bubble Match to Reading
>    strips pinyin from the other two — neither of which changes track to match — and
>    a game writing that key also edits the cdp/scp/dictionary display. Each game gets
>    its own persisted preference; the flp keeps `flashcard.learn-settings` and becomes
>    its only writer. Word Search, Memory Map and Speed Reading are already per-game.
>    Full rule: [GAMES_FEATURE.md § "Pinyin is a per-game setting"](./GAMES_FEATURE.md).
> 2. **Hydra converts to the track rule**, latched before the first spawn rather than
>    at deal (it has no deal — every spawn is a refill). Its tier ladder and its two
>    color buffers are keyed on the mastery bands of the track it pools by, so a
>    reading run re-bands the whole board and its bloom side thins out badly. Design +
>    the blocking question: [HYDRA_BUBBLES.md § 6.0](./HYDRA_BUBBLES.md).
>
> **Match Speed gets the per-game toggle but keeps marking `recognition`** — a per-game
> *setting* is not a per-game *track*; the track rule applies only where these docs say
> it does.

**Spanish is deliberately excluded**: es renders as plain text with no phonetic layer
to hide, so the toggle changes nothing on the card and must not swap its track.

**These four are the _only_ emitters.** No other game or feature emits Reading or
Writing marks — Reading comes from pinyin-off Bubble Match, Word Search No-Pinyin,
Speed Reading and Memory Map; Writing solely
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

**Goals** section on the **account page** (`src/pages/AccountPage.tsx`) — a
`SectionHeader` overline plus two shelf-system `Row`s, each carrying a MUI `Switch`
in its `trailing` slot:

| Row | Glyph / hue | Subtitle | State |
|---|---|---|---|
| Learn reading | `menu_book`, `red` | Adds a reading bar to every card | `users.readingGoal` |
| Learn writing | `edit`, `org` | Adds a writing bar to every card | `users.writingGoal` |

**They are switches, not checkboxes, and not the artboard's glyphs.** Artboard 5 of
the shelf redesign draws `toggle_on` / `toggle_off` Material Symbols; a glyph is not
focusable, checkable or announced, so the control stays a real form control painted
the artboard's colours (`COLORS.grnA` when on). The skin is `GOAL_SWITCH_SX` in
`AccountPage.tsx` and belongs in `MuiSwitch.styleOverrides` once the other ten
`Switch` call sites are converted.

**The section-level description paragraph is gone**, replaced by the one-line
subtitle per row above. The paragraph said once, for both goals, what each row now
says for itself. Its former copy is kept below only as the record of what was
dropped:

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
| flp working-loop quotas (which utcm bucket a card counts toward) | `OnDeckVocabService`, Section 6 |
| Level estimate | `StarterPacksService.estimateLevel` |
| Night Market community **Learning** feed (a word drops out when core is Mastered) | `CommunityLayoutDAL.ts`, [COMMUNITY_PAGE.md](./COMMUNITY_PAGE.md) |
| The `category` field on the wire | `VocabEntryBase.category` |

⚠️ **One deliberate exception: the flp's cooldown window.** Bucket *quotas* (which utcm
tier a card counts toward, and therefore Review's Comfortable+Mastered eligibility) are
still `core`. But the per-card, per-track cooldown check within that bucket is **not** —
since the "either category" fix (§ 6), each of recognition/production clears its OWN
per-type window independently, matching what the cdp already displays per track. A card
can sit in the core-Comfortable bucket while its production track is individually off
cooldown under a weaker per-type category, and Review will serve it on that track alone.

The per-bar reads are the exceptions, and each one is a *display* of that bar:
the Mastered collections (`masteredBarClause(bar)`), the per-bar Learn Now collections
(`unmasteredBarClause(bar)`), the sort options, the bars themselves, and velocity.

**Since the Mastery Centers, EVERY SURFACE carries exactly one bar.** A *lens* is a
`MasteryBarId` a page is read through: the fdp, its collections, its decks and search
are `core`; the Reading and Writing Centers are their own skill
(docs/DECKS_FEATURE.md § "Mastery Centers"). The band counts, the collection
membership, the sort keys, the mini-card strip and the cdp's Mastery section all come
from the lens bar.

(There used to be a mini-card *badge* here too — a corner U/T/C/M letter disc — and it
was the notable case, because it was the only place the whole-card answer was *replaced*
rather than joined. It is **gone**; see "Mini cards — the eight-mark window" below.)

⚠️ **A surface never shows a bar it is not about.** `core` is not "no lens", it is the
recognition/production lens, and it draws ONE bar. Drawing a track per *goal* — which
is what the fdp, its collections and the cdp did until 2026-08-19 — put reading and
writing progress onto pages that were asking neither question, which is the whole
reason the Centers exist. The account's goal flags still decide whether a Center's
BUTTON appears (`activeMasteryCenters`) and which sort rows a core surface offers; they
no longer decide how many bars get drawn anywhere.
It is computed on the client from `typedMarkHistory` (`masteryBar(history, lens)`), not
fetched: the wire's `category` field is core by definition (`CORE_CATEGORY_SELECT`), and
every bar is derivable from the history already on the row. `entry.category` therefore
still means core everywhere, exactly as this section says.

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
*Mastered* but not in *Mastered Writing*. That is the intended reading of the
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

`applyMark` writes exactly one key, for the bar the mark belongs to (passed to
`VocabEntryDAL.updateMarkHistory` as a `MasteredAtWrite` descriptor, so the same
statement carries the history and the stamp):

```
barCategoryBefore !== 'Mastered' && barCategoryAfter === 'Mastered'
    → jsonb_set("masteredAt", '{<bar>}', <the mark's own timestamp>)
```

Four rules govern each key:

* **Sticky.** Never cleared on regression. It means "the LAST time this card crossed
  into Mastered", so one bad mark cannot erase the date. A later re-crossing
  overwrites it.
* **Undo retracts its own stamp.** `undoMark` removes **only the undone mark's
  bar's key**, and only when that key holds the exact timestamp of the mark being
  undone (a `{ bar, stamp: null }` write, i.e. `"masteredAt" - $4::text`) — the same rule as the
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

⚠️ **It no longer has a sort consumer.** It used to drive the collection **Sort by →
Date mastered** (one row per active bar, each reading `masteredAtForBar(masteredAt, bar)`
— that bar's OWN stamp, deliberately not the newest across bars). That row was
**removed** from `src/utils/vocabSort.ts`: the column was never backfilled, so for every
card mastered before migration 142 the key is missing, and the ordering sank most of the
library to the bottom in both directions. See
[DECKS_FEATURE.md](./DECKS_FEATURE.md) § "Sort by". `masteredAtForBar` survives and is
still read by the cdp's mastery window. No query orders or filters on `masteredAt`, so
it carries no index.

## 5. The progress bars on screen

### cdp — the eight-mark window (`.msb`), one track at a time

> **Rewritten 2026-08-24** with the shelf redesign's Card Detail entry. The vertical
> thermometer this section used to describe (`MasteryProgressBar`) is **deleted**; the
> component is now `src/components/mastery/MasteryWindow.tsx`. See
> [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) entry 18 and decisions **D6** / **D7**.

`MasteryWindow` renders `masteryBar(entry.typedMarkHistory, track)` for ONE track,
captioned from `BAR_LABELS` (**Know** / **Read** / **Write**).

**Why the shape changed.** pbh is not a percentage. It is a position in an **eight-mark
window** — the last eight marks of a track are what the number is computed from, and the
two cut points (Target at 3, Comfortable at 6) are counts inside that window, not
milestones on a continuum. A vertical bar with two lines across it drew that as a liquid
level, which invites "89% of the way to mastered": the wrong mental model, because one bad
mark does not evaporate a fraction of a tank, it turns one cell off. So the window is
drawn as what it is — **`PBH_FULL` discrete cells, one per mark**, with the cut points
ticked between them. Reading a card's state is counting, not estimating.

- **Cells.** Cell `i` covers the pbh interval `[i, i+1)`, so its fill is
  `clamp(pbh − i, 0, 1)`. The core bar's pbh is FRACTIONAL (the stronger track capped at
  6 plus a third of the weaker), so its last filled cell can be a **partial** — rendered
  as a partial rather than rounded, because rounding makes two genuinely different cards
  read the same. Cell colour is the segment covering the MIDPOINT of the filled part, so
  a partial cell straddling a boundary takes the colour of the half actually painted.
- **Composition.** A skill track is one mark type, so one colour. The core track's filled
  cells are painted in the ratio of its two tracks' positive marks (blue recognition then
  green production) — the same `positive(type) / Σ positive(bar's types)` split the old
  bar used. These are the **saturated** `MARK_TYPE_COLORS`, on purpose (D2b).
- **Ticks.** At `pbh / PBH_FULL` of the row, BETWEEN cells — the band changes when a cell
  turns on, not part-way through one. Captioned `target` / `comfortable`, hanging above.
- **`.hd4` heading.** Track name, the band as a **pastel** pill (`BAND_COLORS[...].main`
  — it is a surface, the cells beside it are the marks), and the figure as
  `pbh / PBH_FULL`. The core blend prints one decimal ("4.3"); an integer track prints
  bare. The decimal is load-bearing: printing "4" for both 4.0 and 4.3 hides the weaker
  track's contribution, which is the one thing the blend adds.
  - This reverses the old "no band chip" rule, and for a reason: the chip now names the
    band of the TRACK being looked at, where the page's badge row named only the core
    one. That badge row (`VocabCardBadges` on the cdp) is gone as a result.

**Which track is on screen — the learner's choice (D6, amended).** A `Segmented` control
(`Know / Read / Write`, the design's `.trkseg`) sits at the end of the section's rule. It
**defaults to the surface's lens** — `core` from the fdp / a deck / a search result,
`reading` or `writing` for a card reached from that Mastery Center (`?bar=`,
`lensFromSearch`) — so an untouched page still reports exactly one track, the one the
surface that opened it was asking about. Only one track is ever on screen; the learner is
simply allowed to say which.

Two rules inside that:

- **All three tracks are always offered, whatever the goals say.** Reading and writing
  marks accrue whether or not their goal is set (migration 143), so a track hidden behind
  a goal switch would hide marks the learner has actually earned. The GOAL decides what
  gets surfaced, sorted and counted elsewhere; it does not decide whether this card's
  history exists.
- **The switch re-seeds on the LENS, not on the entry.** Paging between cards keeps the
  track the learner chose; re-opening a card from a different Center moves it.

**Cooldown.** Inline in the heading, right after the band pill (`MasteryWindow.tsx` →
`CooldownTimer`): **one countdown for the shown bar** — a clock belongs to a bar since the
know merge (§ 6), so the Know bar's old two rows (Production, Recognition) became one.
Until 2026-09-28 it was a legend-like `.cd3` row centered under the cells (band swatch +
bar name + countdown); the swatch and name only repeated the heading, so the row was
dropped and the bare countdown moved up beside the badge. It reads
`barCooldownRemainingMs`, the same function the mark gate enforces. The timer is a live
**`4m 1w 3d 5h 37m 26s` countdown**
(`formatCooldownRemaining`, `src/utils/formatDuration.ts`). Same unit discipline as the
minute-points formatter: leading zero units dropped, **middle zero units kept**, seconds
always printed. The middle zeros are load-bearing — `m` is both months and minutes, so a
collapsed `6m 26s` would read as six *minutes*. A **ready track reads `0s`**, not a word,
so the timer keeps the same shape. Months are a flat 30 days and weeks a flat 7, so the
180-day Mastered window is exactly `6m 0w 0d 0h 0m 0s`. Mono + `tabular-nums` so the timer
does not jitter as digits change; a resting timer is dimmed, and a ready one adds a small
green **check** (`MASTERY_READY_COLOR`) so the state is scannable without reading digits.
The component ticks on a **1s** interval, one interval for the whole section.

- The window used for the display is the **per-type** category (`computeTypeCategory`) —
  the one every *game* uses. ⚠️ The **flp** widens its window to the card's **core**
  category (§ 6), so on a card whose per-type and core bands differ the flp holds that
  track back slightly longer than the cdp number suggests. The display can only name one
  window; the per-type one is the track's own.
- No swatch or bar name rides with the timer: the heading it sits in already names the
  bar and paints its band, so the old legend's labels only repeated it.

**Placement.** Switch + window, in normal page flow under the hero card. The switch sits
alone, right-aligned on the 22px gutter — the `Mastery` `.sec2` overline + hairline that
used to lead into it was dropped 2026-09-28 (the Know / Read / Write labels name the
section on their own). There is no `SectionCard` wrapper any more, and
what used to be the Definition / Breakdown / Examples boxes beside it have moved into the
page's pull-up sheet (entry 18). The component lives in `src/components/mastery/` rather
than in `VocabCardDetailBody` because the read-only **dictionary** cdp has no marks to
draw and must not import it.

### Mini cards — the eight-mark window, at hairline scale

`src/components/MiniCard.tsx` (`MasteryStrip`, fed the lens bar by `MiniVocabCard`) draws
the **cdp's eight-mark window** along the bottom of the 92×132 thumbnail (`BAR_STRIP`: 3px tall, inset 8px each side, 1.5px cell gap) for
the surface's lens bar, from the `lens` prop (default `core`, forwarded by
`MiniVocabCardGrid`).

It is the **same shape and the same geometry** as `MasteryWindow`: `PBH_FULL` discrete
cells, one per mark, with the trailing cell left **partial** when the core blend gives a
fractional pbh. Both surfaces call `masteryWindowCells` (`src/utils/masteryCompute.ts`),
so they cannot drift on where that partial cell falls. Cells rather than a continuous fill
for the reason `MasteryWindow` gives at length: pbh **is** a count, not a percentage — one
bad mark turns a cell off, it does not drain a fraction of a tank — and a thumbnail should
not invite the estimate the detail page spent a whole component refusing to invite.

**Colour — the same rule as the cdp (Shelf System v2, 2026-09-23).** Every filled cell
takes the lens bar's utcm **band** in the ramp's MARK tier, one hue for the whole window
(`getBandMark(category)` in `src/components/MiniCard.tsx` → `MasteryStrip`). The cdp's
`MasteryWindow` does the same (`getBandMark(category)`), so both surfaces paint identical
hexes: *"mastery bars are colored by
mastery progress, not the mark type"* (user, 2026-09-23), which retired the v1 split where
the cdp coloured cells by mark type and the mini card by band. The band is the question a
thumbnail is actually asked — *"how well do I know this?"* — which is precisely what the
deleted corner letter badge answered.

`masteryWindowCells` still returns the owning mark **type**, not a colour; neither surface
paints by it any more, but it is kept for the strip's `title` breakdown below.

**What this costs.** The per-mark-type split is no longer visible on the thumbnail — an
earlier version drew one pip per mark type, which let a card say *"you recognise this but
cannot produce it"* at a glance. The 8-cell window cannot. The split survives in the
strip's `title` (`"Know 4.3/8 · Comfortable · Recognition 5, Production 2"`), which costs
nothing visually, but it is hover-only and therefore absent on touch. If that read matters
on the grid, it needs a different device than colour or length — both channels are spoken
for.

**Lineage.** Frame 17 of the shelf design draws this strip as one pip per mark type in
Recognition blue / Production green, and its `.mcd .mk` is a two-pip row. Two later
decisions moved off it — colour onto the band, then the row onto the cdp's eight cells —
so only the strip's **placement** (full width, 8px inset, 3px tall, bottom of the card) is
still the frame's. The artboard has not been re-rendered to match.

**Empty cells.** The cdp's empty cell is a 6% fill plus a 12% inset ring; at 3px tall that
ring would be most of the cell, so the mini card uses frame 17's single flat
`rgba(23,22,26,.13)` tint instead.

⚠️ **The band colour is the MARK tier, not `getCategoryColor`.** `CATEGORY_COLORS` are the
band SURFACES — pale fills legible only behind a 1px `COLORS.markOutline` ring, and a 3px
pip cannot carry one. `BAND_MARK` / `getBandMark` (`src/utils/categoryColors.ts`) is the
fluorescent MARK tier at each band's own hue, saturated enough to stand at any size,
falling back to `--greyA` for an absent band so "no band yet" never reads as a fifth band.
**Tier history:** v1 used a dark `*A` ink tier (`BAND_INK` / `getBandInk`). v2
(2026-09-23) moved both bars to MARK, with a mini-strip-only `"small"` variant that swapped
Target's `--yelMk` for a deeper `--yelMkD` because full-strength yellow dissolved into the
cream card face at 3.5px. On 2026-09-28 the user briefly tried MID, then settled on MARK
with **every Mark token darkened 5% oklch L app-wide** (`src/theme/colors.ts`); the new
`--yelMk` (`#E8C800`) is deeper than the old `--yelMkD` (`#EEC900`), so the `"small"`
variant and `yelMkD` were deleted and both bars take the same colour.

**Layering note — REVERSED 2026-08-31.** The cycle this warned about is gone:
`theme/colors.ts` now imports **nothing** (its four `*Main` aliases read hoisted local
constants instead of `CATEGORY_COLORS`), so the theme is the palette's root and
`categoryColors.ts` sits *above* it. `LEARN_NOW_COLORS` / `MASTERY_BAR_COLORS` are
derived from `RAMP` hue keys there, as are `BAND_MID` / `BAND_MARK`.

> The old cycle was harmless only while neither module needed the other's VALUES at
> module-evaluation time. The moment `categoryColors.ts` did, whichever module loaded
> second saw `undefined` and every importer of it threw at import — which is exactly
> what five test suites did before the back-edge was cut.

**The corner badge is gone.** The card used to carry an 18px U/T/C/M letter disc in its
top-left, colored by the lens bar's band. Two reasons it went:

1. **A letter names the band but hides the shape.** `T` says nothing about whether the
   card is one mark into Target or one mark from leaving it — the eight-cell window shows
   exactly that, by being countable.
2. **It leaked past `showMasteryStrip`.** The badge was never gated by that prop, so the
   provisional lent-card notice and the sort offer — dialogs whose only question is
   *"do you want this word?"* — still stamped a borrowed card with a discouraging `U`.
   Removing the badge makes the suppression complete.

The geometry helper (`barStripHeight`) returns a **single** hairline whenever the strip is
shown, since the eight cells sit in one row. One value (`bar`) drives both the rendering
and the definition's bottom offset, so they cannot disagree about how much room the strip
takes, and the definition sits at the same height on every card of every surface.

**A note on what the fill no longer does.** Before the window, the strip drew ONE track
whose length was split between recognition and production by the *ratio* of their
positives — so 1/8 and 8/8 drew the same half-and-half shape as 4/8 and 4/8. The window
does not have that failure mode: its length is pbh, an absolute position in an eight-mark
window, and its colour is the band.

- **Colors** — one hue per **mark type** (`MARK_TYPE_COLORS`,
  `src/utils/masteryCompute.ts`), for surfaces that name a SKILL: Bubble Match's track
  toggle. (The eip tab strip, `TAB_COLORS`, used to alias these; since 2026-10-02 it names
  its own ramp members, because the tabs were never about skills.)
  ⚠️ **NOT for mastery cells** (since 2026-09-23): both the cdp window and the mini-card
  strip colour every filled cell by the track's utcm **band** (`getBandMark`,
  `src/utils/categoryColors.ts`) — see § "Mini cards — the eight-mark window" above.
  `masteryWindowCells` still returns the owning mark type. Since **2026-10-02** only the
  two learner-facing skills own a hue — the Reading / Writing Centers' colours
  ([READING_WRITING_CENTERS.md](./READING_WRITING_CENTERS.md)):
  - Reading → **Green** `COLORS.grnMk` (`MARK_TYPE_COLORS.reading`)
  - Writing → **Purple** `COLORS.purMk` (`MARK_TYPE_COLORS.writing`)
  - Recognition, Production → **no hue** — neutral `COLORS.greyA`. They are the two
    halves of the "know" bar and are no longer learner-facing concepts.

  The skill's bar uses the same hue key (`MASTERY_BAR_HUES`, `src/utils/categoryColors.ts`
  — reading `grn`, writing `pur`, core `blu`), so a skill's Mastered tile, its Center and
  its dot agree. (Before 2026-10-02: recognition blue, production green, reading red,
  writing orange; v1 used four off-palette literals, `#779BE7` / `#05C793` / `#EF476F` /
  `#FF8E47`.) The
  cooldown-elapsed check icon is `MASTERY_READY_COLOR`, beside them in the same file —
  `COLORS.successInk`, which v2 sets to ink.

  Note: three of these hues are also band hues (Unfamiliar=red, Comfortable=green,
  Mastered=blue in `utils/categoryColors.ts`; Target is yellow since v2). Now that no
  mastery cell is mark-type coloured the collision is confined to the skill-naming
  surfaces above. **❓**

---

## 6. The know cooldown (one clock per bar) + flp-only above pbh 6

> STATUS: **IMPLEMENTED 2026-09-25 ("the know merge")**, replacing the per-type
> cooldown and the weighted face flip. No migration — `typedMarkHistory` still keeps
> recognition and production as separate tracks; only the rules read over them changed.
>
> Code, by layer:
> - **Contracts (shared, pure):** `server/contracts/cooldown.ts` (`lastCorrectOnBar`,
>   `barReadyAt`, `barCooldownRemainingMs`, `isBarOnCooldown`, `isMarkOnCooldown`);
>   `server/contracts/mastery.ts` (`FLP_ONLY_CORE_PBH`, `isFlpOnlyMark`);
>   `server/contracts/wire.ts` (`FLP_MARK_SURFACE`); `server/contracts/flpReadiness.ts`
>   (the fdp ready counts, now just the know clock).
> - **Service:** `server/services/FlashcardMarkService.ts` → `applyMark` (both gates);
>   `server/services/OnDeckVocabService.ts` → `FLP_BAR`, `rankFlpEligible`,
>   `isCardGameEligible`; `server/services/cardQueueRanking.ts` (`rankCardQueue` /
>   `rankCardQueueCooled`, keyed by `bar`).
> - **Client:** `src/utils/flpFaceSteering.ts` (`sideOneForCard`, `markTypeForSideOne`),
>   called from `src/features/flashcards/FlashcardsLearnPage/useWorkingLoop.ts`;
>   `src/components/mastery/MasteryWindow.tsx` → `CooldownLegend`;
>   `src/utils/vocabSort.ts` → `cooldownKey`.
> - **Tests:** `server/__tests__/cardQueueRanking.test.ts`,
>   `server/__tests__/flashcardMark.test.ts` (the flp-only block),
>   `src/__tests__/flpFaceSteering.test.ts`, `src/__tests__/flpReadiness.test.ts`.

After a **correct** mark, a card is put on a **cooldown** so it doesn't immediately
come back. The window **duration** is keyed on a utcm category (weaker = shorter, so
weak cards drill more):

| Category | Window |
|---|---|
| Unfamiliar | 5 minutes |
| Target | 24 hours |
| Comfortable | 14 days |
| Mastered | 6 months (180 days) |

### One clock per BAR — recognition and production share the know clock

A cooldown clock belongs to a **bar**, not a mark type:

| Bar (label) | Tracks that start its clock | Window keyed on |
|---|---|---|
| core (**Know**) | a correct `recognition` **or** `production` mark | the **core** band |
| reading (**Read**) | a correct `reading` mark | the reading band |
| writing (**Write**) | a correct `writing` mark | the writing band |

`lastCorrectOnBar(history, bar)` is the newest correct mark across the bar's tracks
(`BAR_MARK_TYPES`); the card is ready once `lastCorrectOnBar + window(barCategory)` has
passed. Consequences:

- A correct recognition mark rests **production too**, and vice versa. There is no
  longer "the other face is still available".
- A card marked correct on **only one** know track is resting — an unmarked track no
  longer rescues it the way it did under the per-type rule.
- The cdp shows **one** Know countdown (§ 5), the collection "Sort by → Cooldown" key is
  that same number, and the flp queues on it — one function
  (`barCooldownRemainingMs`), so the three can no longer disagree. (Under the per-type
  rule the cdp/sort used per-type windows while the fdp count used the core window;
  that split is gone.)

> **History.** Until 2026-09-05 the flp used one whole-card core-band window for both
> tracks; 2026-09-05 → 2026-09-25 each track cooled on its OWN clock under its own
> per-type band ("either category"). The know merge replaced both: one clock, core band.

### Know marks above the line: flp only (`FLP_ONLY_CORE_PBH` = 6)

Once a card's **core pbh ≥ 6** (Comfortable and up), a `recognition` / `production`
mark is **recorded only when it comes from the flp** (`surface === FLP_MARK_SURFACE`).
Below 6, any surface's know mark counts — and, per the clock above, resets the know
cooldown.

- **Why 6.** It is the Comfortable cut point and the pbh formula's first-term cap: past
  it the stronger track adds nothing, and only the weaker one can still move the bar.
  The flp is the one surface that deliberately deals the weaker track (below), so
  finishing a card is its job.
- **Dropped means not recorded** — neither the positive nor the incorrect mark lands,
  and the know clock does not restart. The game still scores the clear; the endpoint
  returns `suppressed: true`, exactly like a cooldown drop. The `[MarkSuppressed]` log
  line carries `reason=flp-only` (vs `reason=cooldown`).
- **The line is two-way, with no stored state.** `isFlpOnlyMark` reads the history as it
  stands on every mark, so an incorrect flp mark that drops pbh back under 6 reopens the
  card to game marks on the very next mark.
- **Reading and writing are untouched** — they are outside the know bar.
- **`surface` is client-asserted.** Not verified server-side; a forged `'flp'` only buys
  a mark on the learner's own card that the flp could write anyway. A know mark with no
  `surface` fails **closed** above the line.

### flp selection: the know clock decides WHETHER, the history decides WHICH face

When a card is selected for the loop (the initial `getDistributedWorkingLoop` build and
the correct-mark refill `getNextLibraryCardWithFallback`), the service offers it only if
its **know clock** has run out (`rankFlpEligible` → `rankCardQueue(…, { bar: 'core' })`).
The server no longer stamps anything on the card (`readyMarkTypes` was deleted): with one
shared clock, both faces are always equally markable.

The client then picks the face from the card's own `typedMarkHistory`
(`sideOneForCard`):

| Positives in the rolling ≤8 window | Side 1 | Mark written |
|---|---|---|
| production **<** recognition | English | `production` |
| recognition **<** production | foreign | `recognition` |
| **tie** (incl. a never-marked card) | foreign | `recognition` |

- **Positives only** — incorrect marks and attempt counts do not break a tie.
- **Pinyin does not matter.** The foreign-first face writes `recognition` with pinyin on
  or off (§ 1a).
- **Deterministic, deliberately.** This reverses the 2026-08-29 weighted flip
  (`englishFirstProbability`, `FACE_BIAS_PER_MARK` / `FACE_BIAS_MAX`, deleted), which
  stayed a *bias* so a session would not be predictable. The trade was made knowingly:
  the weaker track is now always the one drilled.
- **The session-opener override is gone.** The first card of a session used to be forced
  English-first (`preferEnglishFirst`) to dodge an **iOS autoplay edge case on
  Chinese-side-one auto-narration**. It would break the rule, so it was removed.
  ⚠️ If that iOS issue resurfaces (first card foreign-first → narration fails to
  autoplay), the fix belongs in the narration layer, not in face choice.
- **Faces are chosen from the history the client holds.** A card answered incorrectly
  stays in the loop with its fetched history, so when it comes round again it opens on
  the same face — the learner retries the same prompt.
- **Cooled-tier cards** (served when nothing rested is left) follow the same rule; their
  marks are dropped by the cooldown gate as before.

### Ordering: a queue, longest-waiting first

Eligible cards are ranked by `rankFlpEligible` (`OnDeckVocabService.ts`), which is the
**single ordering rule for both flp paths** — the initial loop and the refill draw the
same way, so a loop and its replacements cannot diverge.

> **The rule itself lives in `server/services/cardQueueRanking.ts`** (a pure module:
> `rankCardQueue`, `rankCardQueueCooled`, `queueArrivalAt`), over the cooldown
> primitives in **`server/contracts/cooldown.ts`** (`COOLDOWN_MS_BY_CATEGORY`,
> `lastCorrectOnBar`, `barReadyAt`, `barCooldownRemainingMs`). The primitives live in
> `contracts/` — mirroring what `contracts/mastery.ts` did for the pbh formula —
> because the cdp **displays** the remaining cooldown (§ 5) and the client may not
> import a server service. `cardQueueRanking` re-exports them; the client reaches them
> through `src/utils/masteryCompute.ts`.
> The one axis a caller picks is the **bar** (`{ bar: 'core' }` for the flp,
> `{ bar: 'reading' }` for Memory Map — [MEMORY_MAP_GAME.md](./MEMORY_MAP_GAME.md)
> § 13.1); clock and window follow from it, so no caller can choose a window that
> disagrees with the mark gate. A third consumer is the collection "Sort by →
> Cooldown" key (`cooldownKey`, `src/utils/vocabSort.ts`), which is the shown bar's
> `barCooldownRemainingMs` — see [DECKS_FEATURE.md § "Sort by"](./DECKS_FEATURE.md).

The sort key is the card's **arrival time in the queue**, i.e. when its clock released
it:

```
readyAt(card) = lastCorrectOnBar(core) + window(core band)     // queueArrivalAt
                — -Infinity when neither know track has a correct mark

ranked        = [ cards with history, by readyAt ASC ]   // longest-waiting first
             ++ [ never-marked cards ]                   // always last
```

- A card right on only **one** know track has history and queues by it — it does not
  sink into the never-marked tail.
- A card scores `-Infinity` only when **neither** know track has a correct mark. That is
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

### When a quota runs short: borrow, then cool, then lend

> Corrected 2026-09-25: this section used to say "there is no cooled-card last resort",
> which stopped being true on 2026-08-20. The ladder below is the shipped one
> (`getDistributedWorkingLoop`, `getNextLibraryCardWithFallback`).

A quota its own category could not fill is covered, in order, by:

1. **fresh** cards borrowed from the session's other allowed categories;
2. **cooling** cards, nearest-to-ready first (`rankCardQueueCooled`) — the learner's own
   words, shown again early. They earn nothing: the mark is dropped by the cooldown gate;
3. **lent** provisional cards — only in an unrestricted session (`canLendProvisional`:
   `Unfamiliar` is servable **and** no collection restriction).

| Session | After tiers 1–2 are spent ⇒ |
|---|---|
| Mix, Challenge (unrestricted) | **lend provisional cards** (`lendIntoLoop` → `ProvisionalCardService.acquireLentCards`) |
| Review, `?collection=mastered`, `?deck=` | return **short or empty**; the client shows a "resting" empty state |

`POST /api/flashcards/mark` returns **200 with `newCard: null`** when there is nothing to
refill with, for every session type. See docs/PROVISIONAL_CARDS.md § 4b and § 6.

### Notes / caveats

- **flp, games, cdp and sort all read one clock per bar** (`barCooldownRemainingMs`).
  The duration is the BAR's band — core for know, per-type for reading/writing (which
  are single-track, so bar band = track band). Bucketing is a different question and
  stays per-type for games (§ 7).
- **The know clock is shared across surfaces.** A correct Bubble Match recognition mark
  rests the card for the flp (both faces) and for Word Search Pinyin; a correct flp
  production mark rests it for Bubble Match. Below pbh 6 only, since above it game marks
  are not recorded at all.

### Games honor the same clock (and the flp-only line)

Each pool-selecting game gates its pool on the **single mark type it emits**
(`OnDeckVocabService.isCardGameEligible` / `fetchGameCandidates`,
`server/controllers/OnDeckVocabController.ts`). A card is **fresh** only when a mark of
that type would actually be recorded — the same two tests the mark gate applies:

1. the clock of the bar that type lands in has run out (the **know** clock for a
   recognition/production game);
2. the mark is not flp-only — for a recognition/production game, a card at **core pbh
   ≥ 6** is filed as **cooled**, so it is served only as backfill and earns nothing.

> **Board-mix consequence (accepted 2026-09-25).** A recognition/production game's
> Comfortable/Mastered quotas are banded per-type, and a card whose recognition (or
> production) track is 6+ has core pbh ≥ 6 by construction. So those quotas are now
> filled from the fallback order (fresh Target/Unfamiliar cards) before any
> Comfortable/Mastered card is re-served as cooled backfill. Hydra Bubbles' `bloom` tier
> (the single-bucket caller whose fill "deliberately allowed to break the cooldown")
> still plays those cards; their marks are dropped.

| Surface | Mark type | Selection path |
| --- | --- | --- |
| Bubble Match | `recognition`, or `reading` with pinyin off (§ 1a) | `getGameVocabPool` (via `?markType=` — the track the run locked at deal time) |
| Hydra Bubbles | `recognition` — becomes the run's locked track under [HYDRA_BUBBLES.md § 6.0](./HYDRA_BUBBLES.md) (**not built**) | `getGameVocabPool` (via `?markType=`), refetched every spawn |
| Match Speed | `recognition` | `getGameVocabPool` (via `?markType=recognition`) |
| Speed Reading | `reading` | `getGameVocabPool` (via `?markType=reading`) |
| Word Search — Pinyin | `production` | `getWordSearchGrid` (mode via `?mode=` query) |
| Word Search — No-Pinyin | `reading` **(primary)** + `production` | `getWordSearchGrid` (mode via `?mode=` query) |
| Practice Writing | `writing` | — launched per-card from a flashcard; **no pool to gate** |

**A game may emit MORE than one track — but it is pooled on exactly one.**
No-Pinyin Word Search is the first: one find writes a `reading` mark and a `production`
mark, because the prompt is an English gloss (recall) while the grid is bare characters
(reading). See [WORD_SEARCH_GAME.md § "What a find marks"](./WORD_SEARCH_GAME.md). The
extra track is declared as `WordSearchModeConfig.extraMarkTypes` and read through
`modeMarkTypes()`; the **primary** `markType` keeps its three jobs untouched — it is
what `getWordSearchGrid` buckets and cooldown-gates the board on (a pool query has one
mark history to band by, not two), what challenge eligibility reads, and what leads the
hub label. Three rules follow:

- The client posts **one mark per track** rather than a list of types.
  `/api/flashcards/mark` types exactly one mark per call because it computes a
  before/after band for the single bar that mark moves; a list would push a multi-bar
  response shape onto every caller to serve one surface.
- A **secondary mark is best-effort**: it is judged on its own track's cooldown, which
  the board was not selected against, so it may be silently dropped (`[MarkSuppressed]`).
- A secondary `recognition`/`production` track **must not** confer challenge
  eligibility — `src/games/__tests__/challengePool.test.ts` pins this.

**One constant per game, three consumers.** Each game's mark type is declared once
in its own `constants.ts` (`MARK_TYPE` in `src/games/bubble-match/constants.ts`,
`src/games/match-speed/constants.ts`, `src/games/speed-reading/constants.ts`) and
read from there by all three places that need it: the `?markType=` pool query, the
`markFlashcard({ type })` call, and the Games hub's label (via `GameDef.markType` in
`src/games/registry.ts`). Two exceptions, both because one constant cannot answer for
them: **Word Search**'s type is per MODE, so it lives on
`WordSearchModeConfig.markType` (`src/games/word-search/constants.ts`), read by
`WordSearchPage`'s mark call; and
**Bubble Match**'s is per RUN (§ 1a), latched from `foreignPromptTrack` when the board
is dealt and read from there by its pool query and its mark call alike, while its
`MARK_TYPE` constant stays the game's declared/default track for the registry.
Nothing repeats the string literal, so the label a player sees cannot drift from the
mark that is actually written.

**The hub no longer names the track (2026-10-03).** Games hub tiles are name-only —
`GameDef.subtitle` and `tileSubtitle()` were deleted, so no tile or sub-tile carries a
subtitle. History: the track was first a `MarkTypeChip variant="edge"` on the hub card
(deleted 2026-08-22, when the bento tile left no edge slot), then rode the tile
subtitle as `"<track> · <blurb>"` from `GameDef.markType` + `MARK_TYPE_LABELS`. A
player now has to open a game to learn which track it trains. `GameDef.markType`
itself stays: it is the registry's copy of the game's `MARK_TYPE` and is what
challenge eligibility derives from (`src/games/__tests__/challengePool.test.ts`).
See [BENTO_SYSTEM.md § Known gaps](./BENTO_SYSTEM.md).

> **`getGamePool` is parameterized, not recognition-with-an-exception.** It used
> to hardcode `'recognition'` when Bubble Match was its only caller. Speed Reading
> emits
> **reading** marks, so pooling through it unchanged would have gated on the wrong
> cooldown track and bucketed by the wrong per-type category — a card just read
> correctly would come straight back, while a card weak in reading would be
> treated as strong because recognition of it is good. The endpoint now takes
> `?markType=` and **every caller passes it explicitly**; the internal default is
> a safety net for a malformed request, not a calling convention.

A card is **fresh** for a game when a mark of its game mark type would be recorded
(the two tests above), **cooled** otherwise. `fetchGameCandidates` overfetches a per-category shuffled pool and
splits it fresh/cooled. Both games fill in five phases (the confirmed policy since
2026-08-20 — *prefer fresh; borrow before you re-serve a resting card; re-serve a
resting card before you lend*):

1. Requested-category quotas from **fresh** cards.
2. Top up to `total` with **fresh** cards from the fallback categories
   (Target → Comfortable → Unfamiliar → Mastered).
3. Backfill with **cooled** cards (requested categories first, then fallback) — so a
   just-played library still assembles a full board and entry is **never blocked more
   than an un-cooled library would**. These cards earn nothing: the mark is dropped by
   the hard "next markable at" guard, which is exactly what the cooldown means.
4. Soft-`avoid`ed cards (just cleared by the caller).
5. **Lend** (`lendGameCandidates` → `ProvisionalCardService.acquireLentCards`) — the
   bottom of the ladder, reached only by a learner who has not sorted enough cards.
   Skipped for a collection-restricted pool and for a partial refill (`need`); see
   docs/PROVISIONAL_CARDS.md § 4b.

⚠️ This page's own subject is why lending had to move to the bottom. A game bucketed by
a sparsely marked TRACK (Speed Reading / Word Search No-Pinyin on `reading`) has nearly
every card banding `Unfamiliar`, so its `Target`/`Comfortable`/`Mastered` quotas
underfill **on a library of any size** — and minting, which yields `Unfamiliar`, can
never close them. While lending sat at phase 2 (2026-08-17, capped 2026-08-19) those
games lent on every load, effectively forever.

Word Search's substring-dedup replacement (`pullReplacement`) uses the same
fresh-then-cooled preference across `[preferredCategory, …fallback]`.

**Cross-surface note:** every surface that emits `recognition` or `production` shares
the one know clock, so a Bubble Match win rests the card for the flp (both faces) and
for Word Search Pinyin, and vice versa — below core pbh 6. Above it only the flp's
marks land.

---

## 7. Games select by their own mark type

> STATUS: **IMPLEMENTED** (migration 128). Code:
> `database/migrations/128-add-compute-type-category.sql` (`compute_type_category`),
> `server/dal/shared/vetTable.ts` (`typeCategoryExpr`),
> `server/utils/masteryCompute.ts` (`computeTypeCategory`),
> `server/services/OnDeckVocabService.ts` (`fetchGameCandidates`,
> `isCardGameEligible`, `getGameVocabPool`,
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
| Bubble Match | the run's locked track (§ 1a) per-type category | **core** band (know clock) for `recognition`; reading band for `reading` |
| Hydra Bubbles | `recognition` per-type category (the run's locked track under § 6.0) | **core** band (know clock) |
| Match Speed | `recognition` per-type category | **core** band (know clock) |
| Word Search — Pinyin | `production` per-type category | **core** band (know clock) |
| Word Search — No-Pinyin | `reading` per-type category | reading band |
| Speed Reading | `reading` per-type category | reading band |
| flp working loop | **core** band (bucket/quota only) | **core** band (know clock, § 6) |
| decks page counts | **core** band (unchanged) | — |

The flp buckets on the whole-card core band — it presents **two** mark types on one
card, and those two are exactly the core bar's tracks, so "which utcm quota a card
counts toward" and "the core bar" are the same thing by construction. Since the know
merge (§ 6) its cooldown window is the core band too.

**Bucketing and resting now answer to different bars for know games** (decided
2026-09-25): a recognition game still BUCKETS by the recognition track's own band (the
board's difficulty is about the skill being drilled), but RESTS on the know clock,
windowed by the core band (one clock per bar, § 6).

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

### Cooldown windows follow the bar

The **duration** table (5 min / 24 h / 14 d / 180 d — `COOLDOWN_MS_BY_CATEGORY`,
`server/contracts/cooldown.ts`) is looked up under the band of the **bar** the mark
lands in (`barReadyAt`). For reading/writing that is the track's own band, so a card
that is Mastered overall yet weak in Reading rests only 5 minutes before Word Search
No-Pinyin may serve it again. For recognition/production it is the core band (§ 6).

### Known divergence: `available` counts

The `available` map both game endpoints return still comes from
`getCategoryCounts`, which uses the **core** band (it is shared with the
decks page). So the client's "you have N Comfortable cards" hint can disagree with
the pool the same request assembled. This is a deliberate trade (one shared count
source); if the hints ever need to match, add a per-type count variant for the game
callers rather than switching `getCategoryCounts` itself.

---

## 8. Planned rework — choice-aware marks and a Mastered buffer zone

> STATUS: **DESIGN / NOT BUILT.** Opened 2026-08-23. Two changes, bundled because they
> land on the same three chokepoints and each alone would cost a full TS↔SQL lockstep
> pass: `ReviewMark` (`server/contracts/wire.ts`), `positiveCount` / `categoryForPbh`
> (`server/contracts/mastery.ts`), and their SQL mirrors `mastery_positive_count()` /
> `compute_core_category()` (migration 143) / `compute_type_category()` (migration
> 128) — kept honest by `server/__tests__/mastery.test.ts`.
> Tracked as item 7 of [DEFERRED_WORK.md](./DEFERRED_WORK.md).

### 8.1 Problem A — a guessed answer and a recalled one weigh the same

`positiveCount` counts `isCorrect`, full stop. But the surfaces feeding the four tracks
differ in guess odds by more than an order of magnitude:

| Surface | Answer format | Odds of a correct GUESS | Track |
|---|---|---|---|
| flp | self-graded ("I knew it") | n/a — self-report, a different problem (§ 8.1a) | recognition / production / reading |
| **Speed Reading** | forced two-way choice | **1 in 2** | reading |
| **Match Speed** | 5 English slots on the board (`ROWS = 5`) | **1 in 5**, rising as rows clear | recognition |
| **Bubble Match** | 20 pairs on the board (`TOTAL_PAIRS`) | **1 in 20 → 1 in 1** as the board empties | recognition / reading |
| **Hydra Bubbles** | whatever is on the field | varies per spawn; forced at the end of a colour | recognition |
| Word Search | find it in the grid | not a choice — positive-only | production / reading |
| Practice Writing | top-1 stroke grading | not a choice | writing |

Two concrete consequences:

1. **§ 1 of this doc already concedes the first, and the concession does not hold.**
   It argues Speed Reading's negatives are honest because "a player who taps randomly
   scores ~50% and earns negative reading marks at that rate". That is true of the
   *ratio* and false of the *window*: `positive(reading)` is a **count**, not a ratio,
   and the bands are cut on the count. A pure guesser lands ~4/8 = **Target** on the
   reading bar, and a lucky one reaches Comfortable, having demonstrated nothing.
2. **The last match on a board is free.** With one pair left in Bubble Match the only
   remaining move is correct by construction, and it writes a full-weight positive
   recognition mark. Same for the last card of a Match Speed column and the last bubble
   of a Hydra colour. Not a tuning issue — a guaranteed positive for zero knowledge,
   once per board, every board.

#### Sketch of the options

* **(A) Credit-weighted marks.** Store the choice count on the mark
  (`ReviewMark.choices?: number`) and credit `1 − 1/N` rather than 1: Speed Reading
  0.5, Match Speed 0.8, a forced last match 0. `categoryForPbh` already takes a float,
  so the band cut points need no change. Costs a jsonb shape change (no migration — it
  *is* jsonb) plus both SQL mirrors.
* **(B) Asymmetric weighting.** A wrong answer under N choices is strictly more
  informative than a right one, so keep negatives at full weight and discount only
  positives. Falls out of (A) for free.
* **(C) Suppress the forced move.** Emit no mark when the choice set has one element —
  the same call Word Search already makes for a hinted word
  ([WORD_SEARCH_GAME.md § 5a](./WORD_SEARCH_GAME.md)), and the cheapest fix for
  consequence 2 on its own.
* **(D) Leave the scoring alone and fix it at the source** with deeper boards / harder
  distractors. Rejected on sight for Speed Reading: two options *is* the game.

**(C) is separable and far cheaper than the rest** — no schema change, no SQL touch,
three game pages. Worth landing first regardless of where (A)/(B) end up.

#### 8.1a Not in scope: the flp's self-report

The flp is not multiple choice — the learner grades themselves. That has its own
credibility problem (nothing stops "I knew it" on every card) and its own fix space
(typed recall, a delay before the reveal). Do not fold it into this work: `choices` is
**undefined** for a self-graded mark and must credit 1.

### 8.2 Problem B — reading and writing have no buffer, and core does

Core's Mastered condition reduces to **`min(rec, pro) ≥ 6`** — two slots of slack in
each of two tracks. Reading and writing are their track's raw count, so Mastered means
a **perfect 8/8** and there is no slack at all:

| Bar | Marks to reach Mastered from one band below | Marks to fall back out |
|---|---|---|
| core (from 6/6) | 2 per track, best case | 1–3 |
| **reading / writing (from 7/8)** | **1** | **1** |

One bad tap in a two-way Speed Reading round — which § 8.1 says a guesser produces half
the time — un-masters a card. The learner watches a finished bar empty and refill on
alternate sessions, and because every crossing writes a `masteredAt` stamp and a
`category_promotions` row, **velocity is inflated by the same flapping**.

What is wanted: **a buffer zone** — enter Mastered at the top, leave it lower down, so
the bar has hysteresis instead of a knife edge.

#### Sketch of the options

* **(E) True hysteresis.** Enter at 8/8, stay Mastered until the count falls to ≤5.
  ⚠️ **Breaks the system's central invariant**: a band is a pure function of one row's
  `typedMarkHistory`, which is why `compute_core_category()` is `IMMUTABLE`, why no
  category expression joins another table, and why every selection query can band
  in-query. Hysteresis is *state* and needs somewhere to live. `masteredAt` is the
  obvious candidate — already per-bar, already stored — but it is deliberately
  **sticky** (never cleared on regression), so using it as the latch changes what it
  means. *(The "Date mastered" sort, which used to be the reader this argument leaned
  on, has since been removed — so the objection is now weaker: what remains is the cdp's
  mastery window and the meaning of the column itself.)*
* **(F) Asymmetric thresholds, no state.** Mastered at ≥7/8, drop out below 6 — a
  one-slot buffer that stays a pure function of the row. Cheaper and safer than (E),
  but it is a *wider band*, not true hysteresis: it still flips on whichever line it
  sits nearest.
* **(G) Widen the window for single-track bars.** Keep "Mastered = at most one wrong"
  but measure over 10 or 12 slots instead of 8. Purely derived, no new state, and it
  makes single-track mastery harder to *reach* as well as harder to lose — arguably the
  honest reading of a sparse track. Costs a per-track window size (`MARK_WINDOW_SIZE`
  is one shared constant today, `server/contracts/wire.ts`).
* **(H) Give the single-track bars a second axis** so they blend like core. There is no
  natural second reading track; Word Search No-Pinyin's dual reading+production
  emission hints at one, but inventing a sub-track to make the formula symmetric is the
  tail wagging the dog.

### 8.3 Blast radius — a band is never only a band

⚠️ Neither change is confined to the bar the learner looks at. `computeTypeCategory` is
the SAME function games bucket and cool on (§ 7), so a threshold change is also a change
to game difficulty and to review scheduling:

| Consumer | What a reading-band change does to it |
|---|---|
| **Memory Map** membership | The map holds exactly the cards that are **not** reading-mastered (`vetSortedClause() AND NOT masteredBarClause('reading')`, [MEMORY_MAP_GAME.md](./MEMORY_MAP_GAME.md) § 2.1). A buffer changes what is on the map **retroactively** — and placements there are durable, the same reason Memory Map opted out of gloss-confusability phase 2 ([GLOSS_CONFUSABILITY.md](./GLOSS_CONFUSABILITY.md)) |
| **Cooldown duration** | Reaching Mastered on a track jumps its window from 14 days to **180 days** (`COOLDOWN_MS_BY_CATEGORY`). An easier Mastered parks cards for six months; a harder one drills them more |
| Speed Reading / Word Search No-Pinyin / Hydra pools | Quotas are per-type bands, and the reading distribution is already nearly all Unfamiliar (§ 6; [HYDRA_BUBBLES.md § 6.0](./HYDRA_BUBBLES.md) O5) |
| Mastered collections + counts | `masteredBarClause(bar)`, `GET /api/onDeck/masteredCounts` |
| Velocity | `category_promotions` is written per crossing; fewer crossings = a smaller number, applied retroactively at read ([VELOCITY.md](./VELOCITY.md)) |
| `masteredAt` | Not backfilled and not swept on rule changes — cards already stamped keep their stamp under the new rule |

**§ 8.2 leaves core alone; § 8.1 does not.** Recognition marks come from Bubble Match,
Match Speed and Hydra — all multiple choice — so choice weighting reaches the core bar
even though the buffer work does not.

### 8.4 Open questions

1. **Credit curve** — is `1 − 1/N` right, or should a two-way choice be worth 0 rather
   than 0.5? ❓
2. **Does a weighted count stay presentable?** The cdp segments and the mini-card strip
   are drawn from `positive(type)`. A fractional count is fine arithmetically, but the
   "x of 8" a learner infers from the segments stops being true. ❓
3. **Buffer via state (E), or via thresholds (F)/(G)?** (E) is the only true hysteresis
   and the only one that breaks the pure-function invariant. ❓
4. **Does the buffer apply to core too?** Core already has slack, so probably not — but
   then the three bars stop sharing one `categoryForPbh`, which is exactly what lets one
   set of benchmark lines serve all three (§ 4). ❓
5. **May `masteredAt` become the hysteresis latch**, given it is sticky today? ❓
   *(The "Date mastered" sort that used to read it is gone, so the only cost left is
   changing what the column means.)*
6. **Retroactivity.** Both changes re-band every existing card on deploy with no
   migration, because bands are derived. Acceptable, given Memory Map membership and
   180-day cooldowns move with them? ❓

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
- The mark/undo endpoints used to `RETURNING category`; they now compute it in app
  code after the write (`FlashcardMarkService.applyMark` → `computeCoreCategory`).
- `FlashcardCategory` typing stays; only its derivation moves.

### Account settings — goal flags storage — DECIDED: new users columns

**Decision:** add `users.readingGoal boolean` and `users.writingGoal boolean`
(`NOT NULL DEFAULT false`). Directly joinable in the flp selection queries that need
`goalCount`. Recognition + Production are implicit/mandatory (not stored).
✅ Column names and defaults confirmed 2026-08-17 against the live columns.

---

## Decisions log

- ✅ **Recognition** = foreign-first flp **with pinyin shown** (pinyin off → Reading,
  § 1a) + Bubble Match; **Production** =
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
- ✅ **`masteredAt` is jsonb keyed by bar.** It briefly drove a "Date mastered" sort row
  per active bar, each reading that bar's OWN stamp *(revised from "latest across the
  active bars": three bars are three achievements, and a max let one reorder another's
  list)*. **That row has since been removed** — the column was never backfilled, so the
  key was missing for most of the library. The per-bar shape stands on its own merits.
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
- ✅ **Settings host**: `src/pages/AccountPage.tsx`. Labels were "I want to learn
  reading" / "I want to learn writing"; the shelf-redesign conversion shortened them
  to "Learn reading" / "Learn writing" and moved the explanation into a per-row
  subtitle (see *Account settings UI*).
- ✅ **Color collision**: ignore for now; colors to be rectified later.

## Open questions (remaining — none block the doc; resolve before build)

_All decisions for the SHIPPED model are settled._ The open design work is the
choice-aware / buffer-zone rework — **six questions in § 8.4**, none of which affect
what is running today. One minor build-time confirmation also remains:

1. Whether `totalMarkCount` / `totalCorrectCount` should become per-type or stay
   all-type aggregates (kept all-type for now). Tracked as item 1 of
   [DEFERRED_WORK.md](./DEFERRED_WORK.md).

Settled since:

- ✅ **`users.readingGoal` / `writingGoal` defaults** — `boolean NOT NULL DEFAULT false`
  (confirmed 2026-08-17). Neither goal is pursued until an account opts in on
  `src/pages/AccountPage.tsx`, so no existing account's bars change height on deploy day.

---

## References (code touched by this feature)

- `server/services/FlashcardMarkService.ts` — `applyMark` / `undoMark`: the mark write
  path, the cooldown gate, the `masteredAt` stamp, and the `category_promotions`
  velocity log it writes and deletes (see [VELOCITY.md](./VELOCITY.md)).
- `server/routes/flashcardRoutes.ts` — the mark/undo endpoints' HTTP layer, plus the
  flp replacement-card composition that still rides on `POST /api/flashcards/mark`.
- `server/dal/implementations/VocabEntryDAL.ts` — `findMarkState` (the both-tables
  probe, with the `FOR UPDATE` row lock) and `updateMarkHistory`.
- `database/migrations/67-*.sql`, `69-*.sql` — `compute_flashcard_category()`.
- `database/migrations/142-add-mastered-at-to-vocabentries.sql` — `masteredAt`, plus
  its stamp/retract sites in `server/services/FlashcardMarkService.ts` and its one
  reader, `src/utils/vocabSort.ts`.
- `database/migrations/143-three-mastery-bars.sql` — `compute_core_category()`,
  `masteredAt` → jsonb, `category_promotions.bar`. On PPE since 2026-08-11; it
  intentionally left `compute_utcm_category()` in place for the deploy window.
- `database/migrations/147-drop-compute-utcm-category.sql` — the contract half of the
  above: drops the now-dead `compute_utcm_category()`. **On PPE since 2026-08-17.**
- `database/migrations/149-drop-lifetime-mark-counters.sql` — drops vet's
  `totalMarkCount` / `totalCorrectCount`. Migration 101 kept them when it dropped the
  success-rate columns they fed; nothing ever read them again, so they were write-only
  from 101 until 149. ⚠️ **Contract migration** — the code that stopped writing them
  (the mark + undo path, now `FlashcardMarkService`, and
  `VocabEntryDAL.updateTypedMarkHistory`) had to be live first, so it was applied
  AFTER the container rebuild. **On PPE since 2026-08-17.**
- `server/contracts/mastery.ts` — **the definition of the bars**, plus
  `FLP_ONLY_CORE_PBH` / `isFlpOnlyMark` (§ 6); mirrored by
  `server/__tests__/mastery.test.ts`, which pins the TS/SQL agreement.
- `server/contracts/wire.ts` — `MasteryBarId`, `MASTERY_BARS`,
  `MASTERED_COLLECTION_IDS`, `parseMasteryBar`, `MasteredAtByBar`, the pinyin-off
  track rule (§ 1a): `ForeignPromptTrack`, `foreignPromptTrack`, and
  `FLP_MARK_SURFACE` (§ 6).
- `src/games/GamesPage.tsx` / `ReadingGamesCarousel.tsx` (the launchers that pin the
  track), `src/games/bubble-match/BubbleMatchPage.tsx` (`lockRunTrack` / `runTrack` /
  `boardShowPinyin`), `src/games/bubble-match/BubbleMatchHeader.tsx` (its toggles are
  now optional), `src/components/bento/Bento.tsx` (`BentoStripProps.control`).
- `src/utils/flpFaceSteering.ts` (`markTypeForSideOne`, `sideOneForCard`) and
  `src/features/flashcards/FlashcardsLearnPage/useWorkingLoop.ts` (sends
  `surface: FLP_MARK_SURFACE` on every mark); `src/api/flashcards.ts` — `MarkSurface`.
- `server/dal/shared/vetTable.ts` — `coreCategoryExpr`, `barCategoryExpr`,
  `masteredBarClause`, `typeCategoryExpr`.
- `server/types/index.ts` — `ReviewMark`, `FlashcardCategory`, `VocabEntry`.
- `server/services/OnDeckVocabService.ts` (`getCategoryCounts` = core only;
  `getMasteredCountsByBar`; `getBuiltinCollectionCards`),
  `StarterPacksService.ts` (`estimateLevel` = core only).
- `server/controllers/OnDeckVocabController.ts` + `server/routes/onDeckRoutes.ts` —
  `GET /api/onDeck/masteredCounts`, `GET /api/onDeck/collectionCards?collection=`.
- `server/contracts/cooldown.ts` — `COOLDOWN_MS_BY_CATEGORY`,
  `lastCorrectMarkTimestamp`, `lastCorrectOnBar`, `barReadyAt`,
  `barCooldownRemainingMs`, `isBarOnCooldown`, `isMarkOnCooldown`. Re-exported by `server/services/cardQueueRanking.ts` (server) and
  `src/utils/masteryCompute.ts` (client).
- `src/components/mastery/MasteryWindow.tsx` (cdp window + track switch + the per-bar
  inline cooldown timer; replaced `src/features/flashcards/MasteryProgressBar.tsx`),
  `src/components/primitives/Segmented.tsx` (the `.trkseg` track switch),
- `src/utils/vocabSort.ts` (`cooldownKey` — the Cooldown sort row),
  `src/components/MiniCard.tsx` (hairline strip; `MiniVocabCard.tsx` computes its bar),
  `src/features/flashcards/VocabCardDetailPage.tsx` — hosts the window,
  `src/features/flashcards/VocabCardDetailBody.tsx` — `SectionCard`/`SectionLabel`.
- `src/utils/formatDuration.ts` → `formatCooldownRemaining` (tested by
  `src/__tests__/formatDuration.test.ts`).
- `src/features/flashcards/collectionRef.ts`, `FlashcardsDecksPage.tsx`,
  `CollectionViewPage.tsx`, `src/hooks/useMasteredCounts.ts` — the three Mastered
  collections. See [DECKS_FEATURE.md](./DECKS_FEATURE.md).
- `src/utils/vocabSort.ts` — the per-bar sort keys.
- `src/utils/categoryColors.ts`, `src/theme/colors.ts` — colors.
- `src/pages/AccountPage.tsx` / `SettingsPage.tsx` — Goals settings section.
