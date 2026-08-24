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
> - Bars UI: `src/components/mastery/MasteryWindow.tsx` (cdp "Mastery" section — the
>   eight-mark `.msb` window for **one** track at a time, defaulting to the surface's
>   lens, with its per-track cooldowns) and `src/components/MiniVocabCard.tsx` (the
>   hairline strip, likewise one bar). `MasteryProgressBar` was deleted 2026-08-24.
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
| **Recognition** | flp **foreign-first** review **with pinyin shown** (zh chars-first / es spanish-first → meaning); **Bubble Match**; **Match Speed** | correct / incorrect |
| **Production** | flp **English-first** review (meaning → foreign); **Word Search "Pinyin" mode** matches | flp: correct/incorrect. Word Search: **positive-only** (a match = positive Production mark; no negatives), and **hinted words emit nothing at all** — see note below |
| **Reading** | flp **foreign-first** review on a **zh** deck with **"Show pinyin" off** (§ 1a); **Word Search "No Pinyin" mode** matches (`WordSearchMode = 'no-pinyin'`, `src/games/word-search/constants.ts`); **Speed Reading** (`docs/SPEED_READING_GAME.md`) | flp: correct / incorrect. Word Search: **positive-only**. Speed Reading: **correct / incorrect** — see below |
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

### 1a. The flp's foreign-first face is per-session

> STATUS: **IMPLEMENTED** (2026-08-22). Code: `foreignPromptTrack` (the rule) /
> `flpMarkTypes` / `FlpForeignTrack` / `parseFlpForeignTrack` (`server/contracts/wire.ts`), `markTypeForSideOne` +
> `sideOneForCard` (`src/features/flashcards/FlashcardsLearnPage/useWorkingLoop.ts`),
> the `foreignTrack` computed in
> `src/features/flashcards/FlashcardsLearnPage/FlashcardsLearnPage.tsx`,
> `OnDeckVocabService.DEFAULT_FOREIGN_TRACK` + the threaded `foreignTrack` parameter,
> `OnDeckVocabController.getDistributedWorkingLoop`, `POST /api/flashcards/mark`
> (`server/routes/flashcardRoutes.ts`).

A zh card shown foreign-first **with pinyin** can be answered off the phonetic aid, so
it tests recognition of the meaning. With the flp's **"Show pinyin"** setting off
(`useFlashcardLearnSettings`), the learner must get to the meaning **from the
characters alone** — which is what the Reading track means, and exactly the call Word
Search's No-Pinyin mode already makes. So:

| Session | Side 1 = English | Side 1 = foreign |
|---|---|---|
| zh, pinyin **on** | `production` | `recognition` |
| zh, pinyin **off** | `production` | **`reading`** |
| es (any setting) | `production` | `recognition` |

**Bubble Match follows the same rule**, through the same helper: a pinyin-off zh board
marks `reading`, and its pool is requested on that track. Two differences, both forced
by it being a game rather than a loop — see
[GAMES_FEATURE.md § "Bubble Match: pinyin picks the track"](./GAMES_FEATURE.md):

* the track is **latched when the board is dealt** and held for the run (including
  Play-Again refills), because a game's whole pool is bucketed and cooled up front;
* so the toggle moved OUT of the game and onto the **Games hub**
  (`BubbleMatchTrackToggle`), which is also now the only place the hub names Bubble
  Match's track. A reading run is silent — no autoplay, no narration — since hearing
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
to hide, so the toggle changes nothing on the card and its foreign-first face would
otherwise swap tracks for a UI change the learner never sees.

**Recognition is not mixed in.** With pinyin off an flp session emits only
`production` + `reading`; the recognition track then accrues from Bubble Match /
Match Speed only. Presenting both would mean overriding the display toggle per card.

**The track is a wire parameter, not a client-side relabel.** It is sent on
`GET /api/onDeck/distributedWorkingLoop?foreignTrack=` and in the `POST
/api/flashcards/mark` body, because the server filters, ranks and stamps
`readyMarkTypes` **on the session's two tracks** (§ 6). A client-only mapping would
show a foreign-first face steered by the recognition cooldown, emit a `reading` mark,
and have it silently dropped by the mark endpoint's cooldown guard whenever the
reading track was cooling. `flpMarkTypes(foreignTrack)` is the single definition both
sides map through.

> **Toggling mid-session is bounded, not free.** The loop fetch is deliberately not
> keyed on `foreignTrack` (re-fetching would throw away the card stack for a display
> toggle), so cards already in the loop keep `readyMarkTypes` stamped for the old
> pair; until the stack turns over, a foreign-first face may be shown whose new track
> is cooling and whose mark is dropped. Every refill after the toggle is steered
> correctly.

**These four are the _only_ emitters.** No other game or feature emits Reading or
Writing marks — Reading comes from the pinyin-off flp session above and Word Search
No-Pinyin, Writing solely
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
| flp working-loop quotas + cooldown window | `OnDeckVocabService`, Section 6 |
| Level estimate | `StarterPacksService.estimateLevel` |
| Night Market community **Learning** feed (a word drops out when core is Mastered) | `CommunityLayoutDAL.ts`, [COMMUNITY_PAGE.md](./COMMUNITY_PAGE.md) |
| The mini-card badge and the `category` field on the wire | `VocabEntryBase.category` |

The per-bar reads are the exceptions, and each one is a *display* of that bar:
the Mastered collections (`masteredBarClause(bar)`), the per-bar Learn Now collections
(`unmasteredBarClause(bar)`), the sort options, the bars themselves, and velocity.

**Since the Mastery Centers, EVERY SURFACE carries exactly one bar.** A *lens* is a
`MasteryBarId` a page is read through: the fdp, its collections, its decks and search
are `core`; the Reading and Writing Centers are their own skill
(docs/DECKS_FEATURE.md § "Mastery Centers"). The band counts, the collection
membership, the sort keys, the mini-card strip, the mini-card badge and the cdp's
Mastery section all come from the lens bar — the badge is the notable one, because it
is the only place the whole-card answer is *replaced* rather than joined.

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

**Cooldowns (`.cd3`).** Under the window, one row per mark type in the shown track — so
the core track shows two — each a live **`4m 1w 3d 5h 37m 26s` countdown**
(`formatCooldownRemaining`, `src/utils/formatDuration.ts`). Same unit discipline as the
minute-points formatter: leading zero units dropped, **middle zero units kept**, seconds
always printed. The middle zeros are load-bearing — `m` is both months and minutes, so a
collapsed `6m 26s` would read as six *minutes*. A **ready track reads `0s`**, not a word,
so every row has the same shape. Months are a flat 30 days and weeks a flat 7, so the
180-day Mastered window is exactly `6m 0w 0d 0h 0m 0s`. Mono + `tabular-nums` so the row
does not jitter as digits change; a resting row is dimmed as a whole, and a ready one adds
a small green **check** (`MASTERY_READY_COLOR`) so the state is scannable without reading
digits. The component ticks on a **1s** interval, one interval for the section rather than
one per row.

- Row order is **`COOLDOWN_ROW_ORDER`** — production above recognition — deliberately
  *not* the window's paint order (the fill paints recognition first, per `BAR_TYPE_ORDER`).
  Kept as an explicit list rather than a `.reverse()`: the two orders answer different
  questions, and a reverse would silently re-order any bar that later grows a third track.
- The window used for the display is the **per-type** category (`computeTypeCategory`) —
  the one every *game* uses. ⚠️ The **flp** widens its window to the card's **core**
  category (§ 6), so on a card whose per-type and core bands differ the flp holds that
  track back slightly longer than the cdp number suggests. The display can only name one
  window; the per-type one is the track's own.
- Each row is labelled with its `MARK_TYPE_LABELS` name beside its swatch, so the legend
  the old component carried separately is gone — it was naming colours that now sit next
  to their own words.

**Placement.** Section rule + switch + window, in normal page flow under the hero card.
There is no `SectionCard` wrapper any more: `MasteryWindow` owns its own `.sec2` rule, and
what used to be the Definition / Breakdown / Examples boxes beside it have moved into the
page's pull-up sheet (entry 18). The component lives in `src/components/mastery/` rather
than in `VocabCardDetailBody` because the read-only **dictionary** cdp has no marks to
draw and must not import it.

### Mini cards — a hairline strip

`src/components/MiniVocabCard.tsx` draws **one** 3px-tall, 30px-wide track bottom-left
with a margin (`BAR_STRIP`), filled to `heightFraction`: the surface's lens bar, from
the `lens` prop (default `core`, forwarded by `MiniVocabCardGrid`). The **badge** is
colored by that same bar's band — under `core` that is `entry.category` by definition,
and inside a Center it is the skill's band, computed on the client from
`typedMarkHistory`. A grid of cards badged by their recognition progress, on a page
whose every other figure is about reading, would answer a question the learner had just
navigated away from; the mirror of that — reading and writing tracks on a card sitting
in a recognition/production deck — is why the strip is no longer per-goal.

The geometry is still written for `n` tracks (`barStripHeight(n)`, a `.map`), which is
also how the strip disappears entirely when `showMasteryStrip` is false: one array
drives both the rendering and the definition's bottom offset, so they cannot disagree
about how much room the strip takes. The definition therefore now sits at the same
height on every card of every surface.

The fill carries the **same per-type segment breakdown as the cdp bar** — the core
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
  - Recognition → **Blue** `#779BE7` (`MARK_TYPE_COLORS.recognition`)
  - Production → **Green** `#05C793` (`MARK_TYPE_COLORS.production`)
  - Reading → **Red** `#EF476F` (`MARK_TYPE_COLORS.reading`)
  - Writing → **Orange** `#FF8E47` (`MARK_TYPE_COLORS.writing`)

  These are `MARK_TYPE_COLORS` (`src/utils/masteryCompute.ts`) and are **literal on
  purpose** — do not swap them for `COLORS.blueMain` / `greenMain` / `redMain` /
  `yellowMain`, which since the shelf redesign hold the *pastel fill* tier of the same
  four hues (docs/SHELF_REDESIGN.md, D2b). A mark cell is read directly against the
  paper ground with nothing on top of it, so it takes the saturated hue; a band chip or
  spine is a fill with text printed on it, so it takes the pastel plus
  `COLORS.markOutline`. The cooldown-elapsed check icon is `MASTERY_READY_COLOR`
  (`#05C793`), beside them in the same file.

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

The flp can only ever present **two** of the four mark types in one session: an
English-first prompt → Production, and a foreign-first prompt → the session's
**`foreignTrack`** (Recognition, or Reading when pinyin is off — § 1a;
`markTypeForSideOne`). Writing marks come from another surface (Practice Writing) and
are **never** shown in the loop, so flp cooldown eligibility consults **only** the
session's pair, `flpMarkTypes(foreignTrack)` (`server/contracts/wire.ts`), threaded
through every `OnDeckVocabService` selection path. Consequence: a correct mark earned
in **another game** no longer wrongly suppresses a card from the flp — and a
pinyin-off session is cooled on the reading track it actually writes to.

### Eligibility + face steering

When a card is selected for the loop (both the **initial** `getDistributedWorkingLoop`
build and the **correct-mark refill** `getNextLibraryCardWithFallback`), the
service computes the subset of the session's two tracks (`flpMarkTypes(foreignTrack)`
= {recognition **or** reading, production}) currently off cooldown:

- **≥1 ready** ⇒ the card is eligible; it's stamped with `readyMarkTypes` and the
  client's `sideOneForCard` **steers the shown face** to a ready type (only
  production ready → English-first; only the foreign track ready → foreign-first;
  both ready → the historical coin flip). The client maps its faces through the same
  `foreignTrack` it sent, so the stamp and the mark can never name different tracks.
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
`WordSearchPage`'s mark call and by `WordSearchHubItem`'s sub-tile subtitles; and
**Bubble Match**'s is per RUN (§ 1a), latched from `foreignPromptTrack` when the board
is dealt and read from there by its pool query and its mark call alike, while its
`MARK_TYPE` constant stays the game's declared/default track for the registry.
Nothing repeats the string literal, so the label a player sees cannot drift from the
mark that is actually written.

**The hub names the track — in the SUBTITLE.** A player can see which of the four
tracks a game feeds *before* opening it. This used to be a `MarkTypeChip
variant="edge"` run up the card's right edge; the bento tile that replaced the hub
card has no edge slot, so the track moved into the tile's subtitle instead:
`tileSubtitle()` (`src/games/GamesPage.tsx`) composes
`"<track> · <the game's blurb>"` — e.g. *Recognition · 30-second clock*, *Reading ·
20 rounds* — from `GameDef.markType` and the shared `MARK_TYPE_LABELS`
(`src/utils/masteryCompute.ts`). Word Search's mode sub-tiles use the track name as
their whole subtitle (`WordSearchHubItem`), since their blurb IS the mode name on the
title line. **Bubble Match names its tracks on its strip HEADER** instead — its
sub-tile subtitles are the level labels, and its track is a per-run choice rather than
a fact, so the header's `control` slot carries `BubbleMatchTrackToggle`, which draws
both `RECOGNITION` and `READING` with the live one inked (§ 1a). The `MarkTypeChip`
component was deleted once that closed the last gap.

Because the label is read from the same constant the game marks with, a hub card
cannot advertise a track its game does not write — never hand-write a track name into
`GameDef.subtitle`. Note the hub shows the track as **plain secondary text**, so
**the hub is the one surface where a track is not shown in its `MARK_TYPE_COLORS`
hue**; everywhere else (cdp stacked progress bar, the pill variants of the chip) one
track is one hue. See [BENTO_SYSTEM.md § Known gaps](./BENTO_SYSTEM.md).

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
| Bubble Match | the run's locked track (§ 1a) per-type category | same track's per-type category |
| Hydra Bubbles | `recognition` per-type category (the run's locked track under § 6.0) | same track's per-type category |
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
(5 min / 24 h / 14 d / 180 d — `COOLDOWN_MS_BY_CATEGORY`, `server/contracts/cooldown.ts`;
this line read "7 d / 30 d" until 2026-08-23 and was never right) is unchanged, but
games look it up under the **per-type**
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
  means, and its one reader (the "Date mastered" sort) depends on the current meaning.
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
5. **May `masteredAt` become the hysteresis latch**, given it is sticky today and read
   by the "Date mastered" sort? ❓
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
  `MASTERED_COLLECTION_IDS`, `parseMasteryBar`, `MasteredAtByBar`, and the flp
  foreign-first track (§ 1a): `FlpForeignTrack`, `FLP_FOREIGN_TRACKS`,
  `flpMarkTypes`, `parseFlpForeignTrack`.
- `src/games/bubble-match/BubbleMatchTrackToggle.tsx` (the hub control),
  `src/games/bubble-match/BubbleMatchPage.tsx` (`lockRunTrack` / `runTrack` /
  `boardShowPinyin`), `src/games/bubble-match/BubbleMatchHeader.tsx` (its toggles are
  now optional), `src/components/bento/Bento.tsx` (`BentoStripProps.control`).
- `src/features/flashcards/FlashcardsLearnPage/FlashcardsLearnPage.tsx` (computes the
  session `foreignTrack` from `useFlashcardLearnSettings().showPinyin` + the account
  language) and `useWorkingLoop.ts` (`markTypeForSideOne`, `sideOneForCard`, the
  `?foreignTrack=` fetch param and the mark body field);
  `src/api/flashcards.ts` — `MarkFlashcardRequest.foreignTrack`.
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
- `src/components/mastery/MasteryWindow.tsx` (cdp window + track switch + per-track
  cooldowns; replaced `src/features/flashcards/MasteryProgressBar.tsx`),
  `src/components/primitives/Segmented.tsx` (the `.trkseg` track switch),
- `src/utils/vocabSort.ts` (`cooldownKey` — the Cooldown sort row),
  `src/components/MiniVocabCard.tsx` (hairline strip),
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
