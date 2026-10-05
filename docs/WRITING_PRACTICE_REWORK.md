# Writing Practice Rework (8 levels, Writing Grid game, writing flp, personal bests)

**STATUS: BUILT ON DEV (2026-10-04) — not deployed to PPE.** Migrations **170**
(per-character writing mastery + a one-off reset of every writing mark), **171**
(`game_personal_bests`) and **172** (stars keyed by level number + a wipe of every star)
are applied on dev. All ship with a standard `/deploy`, applied **before** the container
rebuild: every vet read now calls `compute_writing_mastery`, so new code on the old schema
500s every card read. Not yet verified in a browser.

Parent doc: [PRACTICE_WRITING.md](./PRACTICE_WRITING.md) (the drill's UX). Related:
[HANDWRITING_RECOGNITION.md](./HANDWRITING_RECOGNITION.md) (top-1 grading, Hanzi Writer
guide), [READING_WRITING_CENTERS.md](./READING_WRITING_CENTERS.md) (the Writing Center hosts
the writing hand and the Writing Grid), [MASTERY_REWORK.md](./MASTERY_REWORK.md) (the
writing bar), [PROVISIONAL_CARDS.md](./PROVISIONAL_CARDS.md) (hidden character rows).

| § | Piece | Where |
|---|---|---|
| 1 | Eight levels | `src/components/handwriting/` |
| 2 | Writing Grid game | `src/games/writing-grid/`, `server/services/WritingGridService.ts` |
| 2a | Personal bests (every game but Bubble Match / Memory Map) | `game_personal_bests`, `src/games/shared/usePersonalBest.ts` |
| 3 | Writing flp | `?bar=writing`, `FlashcardsLearnPage/useWritingFlashcard.tsx` + `WritingCardFace.tsx` |
| 3a | Writing mastery lives on characters | migration 170, `FlashcardMarkService.applyWritingResult` |

---

## 1. Eight levels

The level list is the shared contract `server/contracts/writingLevels.ts` → `WRITING_LEVELS`
(number, `mode`, name). `mode` is the identifier the client's behaviour table keys on.

**Stars are keyed by level NUMBER** (migration **172**): `writing_practice_completions.level`
is `SMALLINT` with `CHECK (level BETWEEN 1 AND 8)`, so a star belongs to the position the
learner sees and a reshuffle of modes can never strand one. Until 172 it stored the mode
name (`VARCHAR(16)`, migration 81), which had already left rows for long-gone modes
(`flash`, `peek`, `solo`) on dev. 172 **erased every star** rather than translating them,
so everyone restarts on the current list. The stars badge counts up to 8.

**2026-10-04 reshuffle:** `watch` (old Level 2, the stroke order played once + Replay) was
removed, **Trace moved from 1 to 2**, and **Snap** became Level 1.

| Level | `mode` | Guide | Button | Drawing |
|---|---|---|---|---|
| 1 | `snap` | persistent outline; only the **next** stroke animates, on repeat (`--faint`) | — | always — a stroke that matches the next expected stroke **snaps** into the printed stroke shape (in ink); a miss turns red and fades out ([PRACTICE_WRITING.md § Snap](./PRACTICE_WRITING.md)) |
| 2 | `trace` | persistent outline + looped stroke order | — | always |
| 3 | `walkthrough` | outline flashes 1.5s on entry | **Show** — 1.5s flash, 6s cooldown from press | locked while visible — except a stroke during the **entry** flash ends it early and draws |
| 4 | `quarters` | one of **4** regions (田 squares), first shown on entry, stays up | **Next** — next region, no cooldown | always |
| 5 | `memorize` | persistent outline, no timer | — | locked until the first stroke (which unlocks + hides) |
| 6 | `eighths` | one of **8** regions (米 triangles), first shown on entry, stays up (Quarters at a finer split) | **Next** — next region, no cooldown | always |
| 7 | `test` | none | — | always |
| 8 | `timed` | none; **`TIMED_MS_PER_STROKE` (500) × strokes**, one clock per character, started by its first stroke; Clear / Undo do not reset it | **Retry** (popup, after time-out) | until time runs out → canvas locks, what was drawn is graded |

Regions cycle clockwise from the top-left. 500 ms/stroke is a starting value to tune.

### Code
- `server/contracts/writingLevels.ts` — `WRITING_LEVELS`, `isWritingLevelNumber` (the
  completions allow-list, re-exported by `server/utils/writingPracticeStore.ts`),
  `modeOfLevel` / `levelOfMode`, `writingLevelForMastery`, `writingMarkCounts`,
  `TIMED_MS_PER_STROKE`.
- `src/components/handwriting/levelBehavior.ts` → `LEVEL_BEHAVIOR` (what each mode does),
  `regionClipPath` (田 / 米 polygons), `WRITING_FOCUS_SIZE` (the 300px capture space).
- `src/components/handwriting/useLevelGuide.ts` → `useLevelGuide` — the guide / lock /
  assist-button state machine (`enter`, `leave`, `press`, `blockedAttempt`). One
  interpreter shared by the popup, the Writing Grid and the writing flp.
- `src/components/handwriting/useStrokeClock.ts` → `useStrokeClock`, `getStrokeCount`
  (stroke counts from the bundled Hanzi Writer data). Clocks are wall-clock deadlines.
- `HanziGuide` gained `loopStrokeIndex` (Snap's repeating next-stroke cue) and
  `regionClip` (a CSS `clip-path`, Quarters / Eighths); `WritingCanvas` gained
  `onStrokeStart` (level 8's clock starts on pointerdown), `onStrokeEnd` (a per-stroke
  keep / replace / reject verdict) and `hideCommittedInk`; `WritingStage` gained `clock`
  (the draining bar + seconds overlay, `StageClock`) and `snap` (owns the whole Snap
  mechanic). The matcher is `src/components/handwriting/strokeSnap.ts`.
- `LevelStepper.tsx` — ‹ Level N › with the name under it, a gold ★ when cleared and
  eight dots (gold = cleared, ink ring = current); replaced the four-tab bar. `embedded`
  drops its pill chrome for use as a `WritingPanel` header.
- `WritingPanel.tsx` — the one rectangle every focused surface draws in (level header,
  canvas, Clear / Undo + actions footer); its grow-from-cell / shrink-back morph is
  `useProjectionMorph.ts`, shared with `WritingSelectorPanel.tsx` (the popup's
  multi-character selector — same shell, slot grid in place of the canvas)
  ([PRACTICE_WRITING.md § The writing panel](./PRACTICE_WRITING.md#the-writing-panel-writingpanel)).
- `WritingFocusEditor.tsx` — a focused one-character `WritingPanel` (level label, guide,
  canvas, Clear / Undo, assist button, level 8 clock) over a scrim that fills its
  positioned parent; it grows out of the tapped cell (`origin` — in the Writing Grid, the cell's
  drawing area above the pinyin, `WritingGridBoard.tsx` → `cellAreaOf`, so the canvas lands on
  the cell's shadow / ink), and "tap out" shrinks it
  back, then hands the ink back with `{ clockStarted }`. Used by the Writing Grid and the
  writing flp.

---

## 2. Writing Grid game

8 single characters in a grid of 4 rows × 2 columns (3 columns on a vertically tight frame — see Flow step 2); grid **position i is Level i + 1**, and each slot has its level name written beneath it. Writing Center only
(`GameDef.hiddenFromHub`, `languages: ["zh"]`, game flag `writing-grid`).

### Flow (`src/games/writing-grid/WritingGridPage.tsx`)
`loading → (empty) → countdown → arrange → write → ended`
1. **Countdown** — 3·2·1·Go over the readable board (Match Speed's steps); no time billed.
2. **Phase 1, arrange** — the stopwatch runs (accumulated active time; backgrounding
   pauses it, `useBackgroundPause`). The stopwatch is a bare `GameTimer` — no progress
   track under it — with Word Search's **show/hide eye** (`TimerEyeToggle`, via
   `GameTimer`'s `valueShown` / `onToggleValueShown`): hiding keeps the numerals' height
   (`visibility`) and never pauses the clock; the end popup always shows the final time.
   The preference is device-local, under this game's own key (`constants.ts` →
   `SETTINGS_STORAGE_KEY` = `writingGrid.settings`, read by `useLocalGameSettings`). Drag a character to another slot: the 8 cells are one
   list, so it **moves** (`gridOrder.ts` → `moveItem`), everything between shifts. Each
   cell (also on the countdown's board) shows its character as the full, still **shadow**
   outline — every slot, regardless of level, since arranging needs to see them all — with
   tone-coloured pinyin pinned to the cell's bottom centre (`PinyinCell`, `SHADOW_SCALE`). The
   real glyphs return only at **End**. Levels
   belong to slots (named in the band under each slot; there is no per-cell "L1"…"L8"
   badge), so arranging = choosing which character gets which help.
   **Start writing** ends the phase. Its bar is mounted from the countdown's first frame
   (disabled under the scrim) and only *hidden* after Phase 1, never unmounted: the board
   sizes its cells from the space left over (`WritingGridBoard`), so a bar that came and
   went would resize the whole grid mid-game. Cells are square. Only one axis binds the
   fit; the other axis's leftover space widens the gaps on that axis, from `CELL_GAP` up to
   `CELL_GAP_MAX` (`constants.ts`; `WritingGridBoard` → `spreadGap`), so a tall phone spaces
   the rows out and a short/wide frame spaces the two columns apart. The side columns carry
   **Easiest** (green, `grnMk`) beside L1 and **Hardest** (red, `redMk`) beside L8, each
   centred in its column (the free space either side of the centred grid); a minimum
   column is reserved in the cell-size fit (`WritingGridBoard` → `DIFFICULTY_GUTTER`).
   **Compact layout** — a vertically tight frame (short phone, landscape) switches to
   3 columns (3 + 3 + 2 rows) whenever that gives a strictly bigger cell than 4 × 2
   (`WritingGridBoard` → `GRID_LAYOUTS`, `pickLayout`, `cellSizeFor`). It has no side
   columns (16px edge padding only): **Easiest** sits in a band above L1 (`topBand`), and
   **Hardest** in a band above L8 (`lastRowBand`, its own band because the space directly
   above L8 holds L5's level name). Dragging over the empty ninth slot targets L8.
   The two labels show on the countdown, in Phase 1 and at End, but **not in Phase 2**
   (write); their space stays reserved so the grid never resizes between phases.
   Neither phase has a hint line — the two labels carry the direction (Phase 2's "Tap a
   square to write it from memory" was removed 2026-10-04).
3. **Phase 2, write** — glyphs hide (the arrangement is now from memory). What a cell
   shows depends on its slot (`WritingGridBoard`, `constants.ts` → `SHADOW_PREVIEW_MAX_LEVEL`):
   - **L1–L3** (Snap, Trace, Step Through) — the level's **shadow preview**
     (`levelPreview`, the same first-look rule as the writing flp card, but always
     still — Trace's stroke-order loop is dropped on the board), with the learner's ink drawn over it once written, and the pinyin kept at the bottom
     centre exactly as in Phase 1.
   - **L4–L8** — no shadow: the character's **dd** (`SIZE.body`, 4-line clamp,
     `CellDefinition`) sits centred where the shadow would be, and the learner's ink
     replaces it once written. The pinyin is at the bottom centre, as on L1–L3.

   Every cell, in both phases, shares one layout (`PinyinCell`): an upper square of
   `SHADOW_SCALE` × the cell (shadow / ink / dd) and the tone-coloured pinyin pinned to
   the cell's bottom centre.

   Tap a cell → `WritingFocusEditor` at its slot's level;
   tap out → top-1 Verify → ✓ / ✗, and a writing mark on the character's own card
   (`surface: "writing-grid"`). A ✗ cell reopens as a fresh attempt (new ink, new clock).
4. **End** — every cell ✓ stops the stopwatch. Time, medal (`medalForWritingGrid`), personal
   best; a win (`writingGrid` key) is logged per medalled board.

### Dealing (`GET /api/writingGrid/deal`)
`WritingGridController` → `WritingGridService.deal` → `WritingGridDAL`:
- candidates = every distinct Han character in the learner's **sorted** vet words that has a
  det row (`findCandidateCharacters`), each banded by its **own** single-char writing count;
- sampled in Study Mix proportions, off-cooldown first (`sampleWritingGridCharacters`,
  `server/contracts/writingGrid.ts`);
- fewer than 8 → `ProvisionalCardService.acquireLentCards`, then re-read including the lent
  rows;
- each character's pinyin and dd come from its **most frequent det row** (a LATERAL pick in
  `findCandidateCharacters`) and are resolved by the shared twins `resolveDisplayPronunciation` /
  `resolveDisplayDefinition` (`server/utils/definitions.ts`), honouring the `selectedSense`
  on the character's own vet row — so the cell reads what that card reads;
- every dealt character is given a single-char vet row (`ensureCharacterRows`, a hidden
  `provisional` row when new), whose id is the `cardId` a check marks.

Medals (estimates, tune from play data): gold ≤ 2:00, silver ≤ 3:30, bronze ≤ 6:00, none
beyond — `WRITING_GRID_MEDAL_THRESHOLDS_MS`.

Code: `src/games/writing-grid/` (`WritingGridPage`, `WritingGridBoard`, `gridOrder`,
`constants`), `src/api/writingGrid.ts`, `server/contracts/writingGrid.ts`,
`server/{dal/implementations/WritingGridDAL,services/WritingGridService,controllers/WritingGridController,routes/writingGridRoutes}.ts`,
`src/features/flashcards/centers/WritingGridLauncher.tsx` (the Writing Center card).
Tests: `server/__tests__/writingGrid.test.ts`, `src/__tests__/writingGridOrder.test.ts`.

### 2a. Personal bests
One best per **(user, language, game, mode)** in `game_personal_bests` (migration 171).
Direction and unit per game: `server/contracts/personalBests.ts` → `PERSONAL_BEST_GAMES`.

| Game | Value | Mode key |
|---|---|---|
| Word Search | completion ms (lower) | `pinyin` / `no-pinyin` |
| Match Speed | pairs (higher) | `mixed` / `review` / `challenge` (not recorded when `relaxed`) |
| Speed Reading | total ms incl. penalties (lower) | `default`; finished runs only |
| Hydra Bubbles | matches (higher) | `default` |
| Writing Grid | completion ms (lower) | `default` |

Bubble Match (performance floor + ceiling) and Memory Map have none. Study Challenge rounds
are never recorded (they are dealt from the round's set).

- API: `GET /api/users/me/personal-bests?language&game`, `POST … { language, game, mode, value }`
  → `PersonalBestController` → `PersonalBestService.submit` (validation + direction) →
  `PersonalBestDAL.upsertIfBetter` (one atomic conditional upsert).
- Client: `src/api/personalBests.ts`; `src/games/shared/usePersonalBest.ts` (`record` once
  per run, `reset` on Play Again); `src/games/shared/PersonalBestLine.tsx` (end-screen row,
  "New best!" pill, optional `unitLabel`).
- Separate from `wins`, which only gets a row on a win/medal.

---

## 3. Writing flp (`/flashcards/learn?bar=writing`)

Launched from the Writing Center's compact study hand (`FlpStudyHand bar="writing"` —
Writing Challenge / Review / Mix). `FlpBar` includes `writing`
(`server/contracts/studyMode.ts`); the server deals only 1–4-character all-Han words
(`WRITING_FLP_WORD_CLAUSE`) and bands, rests and refills on the writing bar.

The card is the **ordinary flp card** — `FlashCardSection`'s stack, flip, fly-out and the
More Info pill below it, laid out as on the core flp — with only its CONTENT changed:
`FlashCardSection.writingFace` hands both faces of every card to
`useWritingFlashcard.renderFace`, which draws `WritingCardFace` into the face's full-card
`CardFaceSide.fill` slot (no icons, note or card-ops rail). The drag handlers are inert; the
hook flips the card (`setIsFlipped(true)`) and dismisses it (`handleCardDismiss`). The card
flying out keeps its graded back face (`FlashCardSection` holds the outgoing entry; the hook
holds its frozen attempt). The word-tools rail stays hidden (`Write it` is redundant and
`Compare` would show the characters); More Info is gated on the flip like everywhere else,
so it opens only after the submit tap.
- **Level** = `writingLevelForMastery(entry.writingMastery)` = `min(floor(m) + 1, 8)`.
- **Header** (both faces) — a row: on the left, level · pinyin · dd stacked and
  left-aligned, the pinyin **tone-coloured per syllable** (`TonedPronunciation`,
  `src/components/TonedPronunciation.tsx`, shared with Memory Map's prompt); on the right,
  the card's **icon** (`WritingCardFace` → `headerIconId`: the largest-scale icon of a saved
  custom arrangement, else `iconId`; omitted when the card has none).
- **Cell size** — every word, 1–4 characters, gets cells of the **4-character** size:
  `useFourCharCellSize` measures the grid area as if it held the 2×2 layout and hands that
  side to every `CellBox`. Shorter words lay out 2 per row (0→TL, 1→TR, 2→BL) and are
  centred as a block, so cell size never hints at word length.
- **Front** — the header, then the character grid. Each cell PREVIEWS
  what the editor first shows at the level (`levelPreview`, `levelBehavior.ts`): the outline
  (looping on Trace) for Snap / Trace / Step Through, the first region for Quarters / Eighths,
  nothing for Memorize / Blank / Timed (Memorize's outline is the editor's study phase, never
  previewed: `levelPreview`, 2026-10-04) — with the learner's ink on top once written. Tap a cell →
  `WritingFocusEditor` in a phone-sized Dialog. On level 8, a character whose clock started
  is **locked** once its editor closes (reopening would reset the clock). There is **no
  Submit button**: the bottom line reads "Tap the card to submit" followed by a small tap icon on its right
  (`TouchApp`; the back's "Tap the card to continue" carries the same icon), and a tap on the card
  body (`useWritingFlashcard.handleCardClick` via `FlashCardSection.onCardClick`) verifies
  every character and flips the card — but only once **every** cell has ink (a level-8
  locked cell counts as filled, since it can never be reopened). Otherwise the card plays
  the core flp's `cardShake` wiggle (the hook's own `shakeNonce`, passed to
  `FlashCardSection.shakeNonce` in place of `useCardDrag`'s) and every still-empty cell
  pulses its **outline** (not its ground) `COLORS.orgMk` twice (`WritingCardFace.flashNonce` → `CellBox.flash`) to show the
  learner which cells to fill. Orange, not red: red tint already means "graded wrong".
- **Back** — the same, with ✓ / ✗ and the whole outline behind each character's ink. Tapping
  a **cell** inspects it enlarged; tapping **anywhere else** on the card
  (`FlashCardSection.onCardClick`) sends it off — right iff every character was correct.
  The learner never drags.
- The dismissal calls `useWorkingLoop` → `handleCardDismiss(direction, { level, perChar })`,
  which sends `writing` on the mark. Writing marks offer **no undo** (the server refuses it).

### 3b. Used-in hint bubbles (single-character cards)

**Floating on the writing card's top edge, up to 2 bubbles show words that contain the card's character — the learner's own saved words
first, then everyday dictionary words**: each with
its pinyin, its dd, and the word with the character being written drawn as a **mask**: an
outlined circle with a `?` in it (`ForeignText` → `maskChar`, see below). For 你, a saved
你们 shows as `(?)们 · nǐmen · you (plural)`, with the pinyin kept above the mask.

| question | decision (2026-10-04) |
|---|---|
| which cards | **single-character zh only**. Multi-character writing cards show an empty band |
| which words | used-in **pass 1**: the learner's own *sorted* vet words (≤ 4 chars) containing the character (lent/provisional cards don't count), then **pass 2**: dictionary words (2–4 chars) not already in the sorted vet. Both kinds look the same |
| frequency gate | pass 1 **none**: words the learner chose aren't vetted for commonality. Pass 2 **`frequencyScore` 4–5** (added 2026-10-04), stricter than the eip list's 3–5. Ordered saved-first, then `frequencyScore DESC NULLS LAST`, then shortest, then `entryKey` |
| how many | up to **2** in total (cut from 4 on 2026-10-04). Saved words fill first, and dictionary words only take the slots left over |
| tap | **inert**. The eip is gated until submit on the writing flp, so a tap must not open the word |
| look / motion | the bk's hint bubble (§ 6z-4 of `docs/BEGINNER_KEYBOARD.md`) through the shared `HintBubbleSurface`: grows in after `HINT_MOTION.enterDelayMs`, staggered in random order. When the front card changes, the old set pops and the new set grows in |
| placement | every bubble sits on **one level**, its tail touching the card's top edge, at a **random x** drawn uniformly from the spots inside the card's width that don't overlap a bubble already placed. If none is free (a card narrower than ~300 px), it takes whichever end overlaps least. Computed once per bubble when first measured, in card-relative coordinates (`writingBubblePlacement.ts` → `placeBubble`), so a bubble never jumps. Popping bubbles from the previous card don't block spots. (A same-day version stacked colliding bubbles upward into levels. That was dropped 2026-10-04.) |
| width | hugs the content (the wider of the word and its dd), capped at **140 px**, with the dd truncated by an ellipsis |
| geometry | the bubbles live in an overlay (`position: absolute; inset: 0`) over the flp's `ContentArea`, mounted after `FlashCardSection` so they paint above the card stack and below the eip. `ContentArea` centres its children (`alignItems: center`), which collapsed the first in-flow version to 0 px wide. The card's box comes from the `offsetLeft`/`offsetTop` chain, which ignores transforms, so the flip's `rotateY` never narrows the measured card mid-turn |
| room | `WritingUsedInBand`, a fixed **92 px** in-flow spacer (holds the one level) reserved on **every** writing card so the card slot never resizes from one card to the next. |
| faces | shown on both faces. The mask stays after the flip |
| mask by level | levels **1–3** (Snap / Trace / Step Through) show the **real character** in the bubbles: the card front already shows its whole outline, so there's nothing to hide. Levels 4–8 mask it. Derived from `levelBehavior.ts` → `previewShowsWholeCharacter(mode)` for the card's level (`writingLevelForMastery`), so the bubbles and the card's own preview can't disagree |

Data path: the writing bar's loop and refill (`getDistributedWorkingLoop`,
`getNextLibraryCardWithFallback`) pass `bar` into `enrichWithUsedIn`. On `writing` it attaches
`VocabEntry.writingUsedIn` from `VocabEntryDAL.findWritingUsedInForCharacter`, alongside the
regular `usedIn` the eip still uses after submit. Every other bar omits the field.

Code:
- `server/dal/implementations/VocabEntryDAL.ts` → `findWritingUsedInForCharacter`,
  `toUsedInItem` (row mapper shared with `findUsedInForCharacter`)
- `server/services/OnDeckVocabService.ts` → `enrichWithUsedIn`, `enrichMultipleWithUsedIn`
- `server/contracts/wire.ts` → `VocabEntry.writingUsedIn`
- `src/features/flashcards/FlashcardsLearnPage/WritingUsedInBubbles.tsx` → `WritingUsedInBubbles`
  (overlay), `WritingUsedInBand` (spacer), `useCardBox`, `offsetBoxWithin`,
  `MAX_BUBBLES`, `MAX_BUBBLE_WIDTH`; both mounted by `FlashcardsLearnPage` (writing mode only)
- `src/components/ForeignText.tsx` → `maskChar` prop (row layout only) →
  `src/components/CPCDRow.tsx` → `CPCDRowItem.masked`, `MaskedCharMark`. The mask is drawn,
  not a character: Unicode has no circled question mark, and the earlier `⍰` (U+2370) isn't
  in the CJK fonts, so it rendered in a fallback font. The mark is sized in `em`, so it
  scales with every CPCDSize; it takes the glyph colour (`characterColor`, else
  `COLORS.textSecondary`) and copies as `?` under `tapToCopy`
- `src/features/flashcards/FlashcardsLearnPage/writingBubblePlacement.ts` → `placeBubble`
  (tests: `src/__tests__/writingBubblePlacement.test.ts`)
- `src/components/hintBubble/HintBubbleSurface.tsx`, `useHintBubblePresence.ts`,
  `hintMotion.ts`: shared with the beginner keyboard

### 3a. Writing mastery lives on characters (migration 170)

- A word's **writing mastery** is the AVERAGE of its characters' single-character writing
  positive counts (a missing character counts 0); a single character's is its own count.
  Computed on read, never stored: SQL `compute_writing_mastery(userId, entryKey, history)`,
  selected by every full vet read as `"writingMastery"` (`WRITING_MASTERY_SELECT`,
  `server/dal/shared/vetTable.ts`) and banded by `compute_writing_category` (the writing
  branch of `barCategoryExpr`). TS twin: `writingMasteryFromChars`.
- Every bar helper takes it as an optional last argument (`barProgressBarHeight`,
  `barCategory`, `masteryBar(s)`, `barReadyAt`, `barCooldownRemainingMs`,
  `isBarOnCooldown`, `isMarkOnCooldown`, the flp readiness and queue-ranking helpers); call
  sites pass `entry.writingMastery`. A read that omits it shows a multi-character word's
  writing bar as 0, never as its dummy marks.
- **The word's own writing track is a clock.** Each result writes one `clockOnly` mark on
  the word (correct iff every character was); `positiveCount` and SQL
  `mastery_positive_count` skip `clockOnly` marks. The word's cooldown = its last correct
  clock mark + the window of its AVERAGED band. A word on cooldown writes nothing at all.
- **Characters get the marks.** `FlashcardMarkService.applyWritingResult` locks (creating
  hidden `provisional` rows as needed — `VocabEntryDAL.ensureCharacterMarkStates`, in
  `entryKey` order to avoid deadlocks) every character's row and appends one `viaWord`
  mark per distinct character (a repeated character is correct only if every occurrence
  was). `viaWord` marks count as mastery but `lastCorrectMarkTimestamp` skips them, so they
  never restart the character's own clock — and the character's cooldown does not block them.
- **Anti-farming:** a character mark is written only when `level > that character's
  mastery` (`writingMarkCounts`) — on every writing surface (popup, grid, flp). A single-
  character card applies the same gate to its own mark.
- **Every writing mark carries `{ level, perChar }`**; the server rejects a writing mark
  without it, and rejects any writing mark on a word longer than `WRITING_MAX_CHARS` (4,
  `server/contracts/writingLevels.ts`). That constant is the one limit every writing
  surface reads: the popup's eligibility (`usePracticeWriting`), the Writing Center word
  grid's pool (`WritingPracticeGrid`), the writing flp's deal SQL (`WRITING_FLP_WORD_CLAUSE`)
  and `FlashcardMarkService.applyWritingResult`.
- Hidden character rows are ordinary provisional rows: never selected as the learner's own
  card, may be re-lent into a short round, promoted in place (keeping their writing
  progress) when the learner adds the character for real.
- `masteredAt.writing` and velocity follow the word's averaged band at the moment of its
  own result; a word whose average moves because a SHARED character was marked elsewhere
  gets no stamp (known gap — the stamp is only observable at a mark).
- The reset dropped every vet row's `writing` track and `masteredAt.writing`; stars
  (`writing_practice_completions`) and velocity rows were kept.

Tests: `server/__tests__/flashcardMark.test.ts` (writing describe block),
`server/__tests__/writingGrid.test.ts` (level + averaging rules).

Det coverage (dev, 2026-10-04): every component character of a learner's word has a
`dictionaryentries_zh` row (0 missing of 406), but 218 are not discoverable — a hidden row
needs only `word1`, so enrichment is not a prerequisite.

---

## 4. Open flags

- **Writing Grid Phase 2 prompt.** Settled 2026-10-04: L1–L3 show the shadow preview,
  L4–L8 show tone-coloured pinyin + dd (§ 2, Flow step 3).
- **Medals and 500 ms/stroke** are estimates to tune from play data.
- **Read cost.** `compute_writing_mastery` is a per-row subquery per character; ~0.1 ms/row
  on dev (a 475-card library ≈ +50 ms). Fine today; a LATERAL join is the next step if it
  shows up in the perf telemetry.
- `formatClock` (`src/games/speed-reading/constants.ts`) duplicates `formatTimeMs`
  (`src/utils/timeUtils.ts`).
