# Reading & Writing Centers (redesign)

**STATUS: BUILT ON DEV (2026-10-02), all five phases — not yet deployed to PPE.** Migration
169 ships with a standard `/deploy` (expand-only; apply before the rebuild).
Design source: claude.ai/design project `b8b44c24-…`, file
`Reading & Writing Center - Sheets.html` (+ `shelf-system-v2.css`).

The Centers are the two skill pages opened from the fdp's Centers rail:

| | Reading Center | Writing Center |
|---|---|---|
| Route | `/flashcards/reading` | `/flashcards/writing` |
| Lens | `reading` | `writing` |
| Page ground | `COLORS.grnBg` | `COLORS.purBg` |
| fdp rail tile | `RAMP.grn.surface` | `RAMP.pur.surface` |

They used to be the fdp's decks panel rendered as a page (`DecksPanelBody`, variant
`"page"`). The redesign turns each into a **study page** with the decks panel moved
back behind the same two pill-raised sheets the fdp uses (Cards / Decks), read through
the Center's lens.

Parent doc: [DECKS_FEATURE.md](./DECKS_FEATURE.md) § "Mastery Centers".

---

## Page anatomy (top → bottom)

### Reading Center
1. Header — back arrow + "Reading Center" (NodePage).
2. **Word of the day** card (phase 3) — global daily word.
3. **Card hand** — the fdp's Challenge / Review / Study Mix hand on the reading bar, compact
   variant: the old stack's look, no counts (phase 4).
4. **Word swipe grid** (phase 2) — the learner's card words packed into a 6-column grid.
5. **Reading games carousel** (phase 1) — swipeable, looping, with page dots.
6. Cards / Decks pills → modal sheets (phase 1).

### Writing Center
1. Header — back arrow + "Writing Center".
2. **Word of the day** card (phase 3).
3. **Card hand** — `FlpStudyHand bar="writing" variant="compact"`: Writing Challenge /
   Review / Mix, each opening the writing flp (`?bar=writing`,
   [WRITING_PRACTICE_REWORK.md § 3](./WRITING_PRACTICE_REWORK.md)). zh only.
4. **Word practice grid** (phase 5) — the same 6×6 word grid as the Reading Center's,
   read through the writing bar; tapping a word opens `PracticeWritingPopup` on it.
5. **Writing games belt** (`centers/WritingGamesCarousel.tsx`, on the shared `GamesBelt`) —
   two cards, zh only: the **Writing Grid** game, which launches from here only
   ([WRITING_PRACTICE_REWORK.md § 2](./WRITING_PRACTICE_REWORK.md)), and the **Writing
   Notebook** — not a game, an endless per-word practice sheet
   ([WRITING_NOTEBOOK.md](./WRITING_NOTEBOOK.md)), whose card carries the notebook total.
   Exiting either reopens the Center scrolled all the way down to the belt, parked on that
   card (§ "Returning from a game").
6. Cards / Decks pills → modal sheets (phase 1).

Both Centers end on the shared `ScrollPastSpacer` (`src/components/MobileFooter.tsx`),
mounted once after the bar-specific sections in `MasteryCenterPage`, so the last section
can scroll up past the floating pills rather than stopping dead on them.

---

## Phases

### Phase 1 — page shell, sheets, writing grid, games carousel ✅ (2026-10-02)
- [x] `COLORS.grnBg` / `COLORS.purBg` — the design's `--{hue}Bg` "page ground" tier
      (only the two hues the Centers use; the other four are not added until used).
- [x] **Skill hues, app-wide**: reading `grn`, writing `pur` (`MARK_TYPE_COLORS`,
      `MASTERY_BAR_HUES`); recognition/production get no hue (`greyA`). The fdp rail
      tiles, the Center grounds and the Mastered tiles all follow (`MASTERY_CENTER_HUES`
      is derived from `MASTERY_BAR_HUES`). `TAB_COLORS` (eip tabs) unhooked from the
      skill table and pinned to its old ramp members.
- [x] `DecksSheets` — the two pills + modal `SheetPanel` + `DecksPanelBody` +
      `NewDeckDialog`, extracted from `FlashcardsDecksPage` so the fdp and both Centers
      mount the same thing.
- [x] `MasteryCenterPage` rebuilt as the study page (tinted ground via
      `NodePage.surfaceColor`, sheets via `NodePage.overlay`; Back restores the open sheet).
      The page's bottom edge fade is raised to `CENTER_BOTTOM_FADE_BAND` (110px,
      `NodePage.bottomFadeBand`) so content under the Cards/Decks pills is already faded.
- [x] Writing Center practice grid + practice popup (popup state extracted to
      `usePracticeWriting`, shared with `PracticeWritingButton`). First built as a grid of
      single characters (`CharacterPracticeGrid`); replaced in phase 5.
- [x] Reading Center **games carousel** (`ReadingGamesCarousel`): Bubble Match (pinned
      pinyin-off via `location.state.showPinyin`), Word Search (No Pinyin + resume of a
      parked No Pinyin board), Speed Reading, Bucket Drop (No Pinyin, zh only), Memory Map.
      Word Search, Speed Reading, Bucket Drop and Memory Map launch from
      the card's round corner play button (`GameCardData.play`); Bubble Match launches from
      its per-level option tiles. The card itself is the shared `GameCard`
      (`src/games/shared/GameCard.tsx`), and Bubble Match's card data comes from
      `buildBubbleMatchCard` (`src/games/bubble-match/bubbleMatchCard.ts`) — the Games
      hub renders the identical Bubble Match card ([GAMES_FEATURE.md](./GAMES_FEATURE.md)).
- [x] `COLORS.frost` — names the design's `rgba(255,255,255,0.72)` chip ground (was a
      literal in `Spine` and `Bento`).

### Phase 2 — Reading word swipe grid ✅ (2026-10-02)
- [x] Sample words from the learner's cards by READING band, Study Mix weights
      (`STUDY_MIX_QUOTAS`, `server/contracts/studyMix.ts` — now also the source of the
      flp's `DEFAULT_LOOP_CONFIG` quotas), fresh on every mount. Cards resting on the
      reading bar (their marks would be dropped at the mark chokepoint) are pooled as
      `cooled` fallbacks: `drawWord` places one only when no markable word fits the room,
      so a cell shows a resting word before it shows nothing (2026-10-03). The grid has no
      heading — neither does the Writing grid (both "Your words · tap to … · N ready"
      headings and the `CenterSectionHeading` component were removed 2026-10-03; the grids
      now open on `WORD_GRID_TOP_GAP`). An empty
      board (no eligible words at all) reads "Add more cards to your library!". Code:
      `centers/wordGridModel.ts` → `drawWord`.
- [x] Pack words into a 6×6 grid; a word spans `cellSpan(length)` adjacent cells of one
      row — one cell per character up to two, then compressed (3 chars → 2 cells, 4 → 3,
      5 → 4, 6 → 4; 2026-10-03). Packing works in cells (`span`), glyph sizing in characters.
      Words must be all-Han and ≤ 6 characters. Cells nothing fits stay empty.
- [x] Tap → the tile grows in place (absolute left/top/width/height, not a scale
      transform) to exactly a mini card (92×132, `MINI_CARD_WIDTH/HEIGHT`) and flips; the
      back face IS the card's `MiniVocabCard` (word, pinyin, dd, icon — the Cards sheet's
      thumbnail) with `showMasteryStrip={false}` and `defaultBackground={COLORS.white}` (white
      rather than the cream card face, matching the white tiles; a card's own custom
      `cardColor` still wins), mounted only while open. Rounded-corner, ink-outlined
      triangles appear either side as the swipe hint, coloured by the mark each direction
      writes — left red (`INCORRECT_WASH` = `redMk`), right green (`CORRECT_WASH` = `grnMk`),
      the same constants as the drag wash (`ReadingSwipeGrid.tsx` → `SwipeTriangle`).
- [x] Swipe right = correct reading mark, left = incorrect (`markFlashcard`,
      `type: "reading"`, surface `"reading-center"`); commits past 18% of the GRID's width
      (min 48px) or on a flick (≥24px at ≥0.5px/ms) — not the flp's viewport-relative
      threshold, which on desktop exceeded the phone frame and made every swipe snap back
      (fixed 2026-10-03); flp wash colours and fly-out timing. The hole (plus any adjacent empty cells) refills in place.
- [x] Tap elsewhere → flips back, no mark. Dismissal is a document-level capture `pointerdown` listener (`ReadingSwipeGrid` → tap-away effect), NOT a catcher element, so the same tap still performs its own action (tapping another tile opens it; a button fires; a drag scrolls).
- [x] Tap the OPEN tile again (a press that moved ≤ 6px, `TAP_SLOP_PX`) → the eip opens for that card (`eip.openForRoot(tile.entry)` — the library card is a full VocabEntry, so no det lookup). The tile stays flipped under the sheet and tap-away is suspended while the eip is up, so closing it returns to the same card ready to swipe. Hinted by a pointer-transparent ⓘ (`InfoOutlined`, `textSecondary`, top-right of the back face — same icon as scp's card-info button). Rendered by the shared `FlashcardsLearnPage/EipSheet.tsx`.
- [x] Model unit tests: `src/__tests__/wordGridModel.test.ts`.

Code: `centers/ReadingSwipeGrid.tsx` (gesture + animation), `FlashcardsLearnPage/EipSheet.tsx` (the eip host), `centers/wordGridModel.ts`
(`cellSpan`, `buildPool`, `drawWord`, `fillSegment`, `initialLayout`, `replaceTile` — shared with the
writing grid since phase 5), `centers/useWordGridGeometry.ts`.

### Phase 3 — Word of the day (global) ✅ (2026-10-02, migration 169 applied on DEV only)
- [x] Migration **169** `daily_words (day DATE PK, "detId" → dictionaryentries_zh(id) ON
      DELETE CASCADE, content JSONB NULL, "createdAt")`. Expand-only: ships with a standard
      `/deploy` (apply before the container rebuild, as usual — only the new endpoint reads it).
- [x] `DailyWordDAL` (`findByDay`, `pickCandidateDetId`, `pinDay`, `fillContent`) →
      `WordOfTheDayService.getForDay` → `WordOfTheDayController.get` →
      `GET /api/dictionary/word-of-the-day?day=YYYY-MM-DD` (the caller's LOCAL date; must be
      within ±1 day of server UTC, so a client cannot make the server pin arbitrary days).
- [x] Pick: a random discoverable single-character zh row not used in the last 365 days
      (falls back to allowing repeats). PIN FIRST, then write the body — a failed model call
      never moves the word; the next request retries the body (`content IS NULL`).
- [x] Body: ONE model call per day app-wide (`claude-opus-5-5`, effort medium, structured
      output `{parts:[{char,gloss,pinyin,isRadical}], explanation}`, server-side refusal
      fallback `fallbacks: "default"`). Validated by `parseWordOfTheDayContent`
      (`server/contracts/wordOfTheDay.ts`) and, when det `components` is populated, against it.
      Shared client: `server/services/anthropicClient.ts` (`ANTHROPIC_API_KEY`), extracted
      from DictionaryService. Verified once against the real API on dev: 明 → 日 (radical) + 月.
- [x] `WordOfTheDayCard` on both Centers: glyph on the card face over a dashed 米-grid in the
      blue ramp's mark tier (`RAMP.blu.mark`, on every Center), tone-coloured pinyin, dd, parts (component font
      `FONTS.hanziComponents`), explanation, TTS button. The detail column beside the glyph
      is held to the glyph's height (`GLYPH_SIZE`, 104px), its content one block centred against
      the square: pinyin + dd (dd clamped to one line when parts show), then the parts — one per row ("gloss · pinyin") for
      1–2 parts, a two-column gloss-only grid for 3–5 (`partsLayout`). No radical tag — the model still
      returns `isRadical` per part, but the card does not render it (dropped 2026-10-03).
- [x] Tests: `server/__tests__/wordOfTheDay.test.ts`.

### Phase 4 — flp reading bar + Reading Center card hand ✅ (2026-10-02/03, no migration)
- [x] The flp session has two INDEPENDENT axes (`server/contracts/studyMode.ts`):
      MODE (`?mode=review|challenge`, absent = Study Mix) picks the bands; BAR
      (`?bar=reading`, absent = core) picks the bar those bands, the queue and the cooldown
      are read off. (First built as a third mode, `mode=reading`, which could not express
      Reading Review / Reading Challenge — replaced 2026-10-03.)
- [x] Server: every flp selection helper takes the bar (`fetchFlpCandidates`,
      `rankFlpEligible`, eligible / cooled / lend tiers, `getDistributedWorkingLoop`,
      `getNextLibraryCardWithFallback`); `?bar=` parsed by `parseFlpBar` on the working-loop
      endpoint, the mark body (`bar`) and `GET /api/onDeck/flpReadyCounts[?bar=reading]`
      (`flpReadiness.ts` functions all take the bar). A reading refill prefers the READING
      band just left (`ApplyMarkResult.markedBarCategoryBefore`). zh only.
- [x] Client flp: `?bar=reading` → `sideOneForCard(card, bar)` always `zh`,
      `markTypeForSideOne(_, bar)` always `reading`; `FlashCardSection.readingMode` drops
      pinyin + speaker from the question face and forces pinyin on the answer face; flp
      autoplay narration is suppressed for the session.
- [x] The flp's back arrow returns to the Center that launched the bar:
      `?bar=reading` → `/flashcards/reading`, `?bar=writing` → `/flashcards/writing`, core →
      `/flashcards/decks` (`FlashcardsLearnPage` → `leaveSession`).
- [x] **`FlpStudyHand`** — the fdp's hand (figures, Review gate, "resting" toast, launch
      URL) extracted from `FlashcardsDecksPage` and shared: fdp `bar="core"`, Reading
      Center `bar="reading"` (zh only). Replaced the one-button `ReadingFlashcardsStack`
      (deleted).
- [x] The Reading Center's hand is `variant="compact"` (`StudyHand`): identical behaviour
      (three modes, tap/throw to promote, Review gate), drawn as the design's `.rstk` stack
      in a 178px box — ±3° fan, glyph + name + round play button, **no figures or tags**.
      Card names on the reading bar: Reading Challenge / Reading Review / Reading Mix
      (`HAND_LABELS`); glyphs `local_fire_department` / `history` / `menu_book`.
- [x] The compact hand's throw is **locked to left/right** (`useHandSwipe(…, "horizontal")`,
      chosen by `StudyHand` from `variant="compact"`), matching the swipe-grid tiles: the
      front card is `touchAction: "pan-y"`, a drag whose first 8px is mostly vertical is
      released to the page scroll, and a claimed drag is pinned to y = 0. The fdp's full
      hand keeps the omnidirectional throw.
- [x] Verified on dev: a reading loop for a 208-card account dealt 10 cards, all off their
      READING cooldown. Tests: `flpFaceSteering.test.ts` § reading mode.

### Phase 5 — Writing Center word grid ✅ (2026-10-03)
- [x] The Writing Center's grid is the Reading Center's 6×6 word grid, read through the
      WRITING bar: the learner's own cards (vet), multi-character words spanning cells,
      sampled by writing band in the Study Mix proportions, fresh every visit.
      `buildPool(cards, now, random, { bar, maxLength })` — the model and geometry are
      shared (`wordGridModel.ts`, `useWordGridGeometry.ts`).
- [x] Words capped at 4 characters (the practice popup's 2×2 limit); cards resting on the
      writing clock are cooled fallbacks, same rule and empty message as Phase 2.
- [x] Tap → `PracticeWritingPopup` on that word, projected out of the tile
      (`useProjectionMorph`): one character straight into the canvas `WritingPanel`; 2–4
      into the `WritingSelectorPanel`, whose slots project again into the canvas
      (docs/PRACTICE_WRITING.md § "The writing panel"). Every Verify posts a writing result for
      that card (fanned out per character since migration 170).
      No swipe, no refill — the board is static for the visit.
- [x] `WritingPracticeGrid` replaces `CharacterPracticeGrid` (deleted).

---

## Prefetch from the fdp

A Center is first reached from the fdp, so its two loads are started there and shared
through one in-memory module, `src/features/flashcards/centerPrefetch.ts`:

| Load | Started by | Read by | Kept |
|---|---|---|---|
| Word of the Day (`loadWordOfTheDay`) | `FlashcardsDecksPage` → `prefetchWordOfTheDay`, on landing, only when the account has a Center button and is zh | `WordOfTheDayCard` (`peekWordOfTheDay` seeds the first frame, `loadWordOfTheDay` joins an in-flight request) | per local date; a failure or a `content: null` answer is NOT kept, so the next reader retries |
| Card library — the `all` collection (`loadCardLibrary`) | `useDecksPanel` on every surface (the fdp's core panel already loaded it) | `useDecksPanel` in the Center: joins the request if still in flight, else seeds from `peekCardLibrary` | keyed `userId:language`; a seed must be under `LIBRARY_SEED_MAX_AGE_MS` (60 min) old |

A seeded panel still refreshes, silently, the same way a Back-restored one does — the
cache removes the duplicate request and the loading gap, it does not make the library
sticky. The word grids build once from the first library they see, so their sampling can
be up to the seed's age stale.

Code: `centerPrefetch.ts` (`loadWordOfTheDay`, `peekWordOfTheDay`, `prefetchWordOfTheDay`,
`loadCardLibrary`, `peekCardLibrary`, `libraryKey`); `useDecksPanel.ts` (the card
library effect); `FlashcardsDecksPage.tsx` (the warm-up effect); `WordOfTheDayCard.tsx`.

### Returning to a Center

Every page one tap BACK into a Center paints the Center's grid (and Word of the Day) from
cache on arrival rather than a spinner:

| Page | Exit into | How the Center's data is ready |
|---|---|---|
| fdp Centers rail | rc / wc | the fdp's panel landed the library (above) |
| Card / deck / collection page opened from a Center's sheet → Back | rc / wc | the Back snapshot carries the cards (`backRestore.ts`) |
| rflp / wflp (`?bar=reading` / `?bar=writing`) → back arrow | rc / wc | the launching Center's panel landed the library; `FlashcardsLearnPage` also calls `warmMasteryCenter` on mount for a reload / deep link |
| Bubble Match, Word Search, Speed Reading, Bucket Drop, Memory Map (rc carousel) / Writing Grid (wc) → Back, "Back to …" | rc / wc | the launching Center's panel landed the library |

What makes the round trip work is the seed age: `LIBRARY_SEED_MAX_AGE_MS` is **60 minutes**
(was 2), so the library the Center landed before launching the session is still a valid seed
when the learner comes back. **Accepted staleness (decided 2026-10-04):** every one of these
pages marks cards, and the returning grid samples from the library as it was BEFORE the
session — a word marked in the session can be drawn as markable and its swipe/verify then
dropped at the cooldown chokepoint. The seeded panel still refreshes silently, so the next
visit is current.

Not covered: a reload / deep link straight into a GAME launched from a Center. The games
cannot call `warmMasteryCenter` (src/games has no back-edge into src/features,
`games/runtime/gameExit.ts`), so that one path still returns to a cold Center.

Code: `centerPrefetch.ts` (`LIBRARY_SEED_MAX_AGE_MS`, `warmMasteryCenter`);
`FlashcardsLearnPage/FlashcardsLearnPage.tsx` (the warm-up effect beside `leaveSession`).

---

## Decisions taken (and open flags)

- **Bubble Match level labels.** The design says Gentle / Brisk / Relentless; the game's
  `LEVEL_CONFIGS` says Chill / Hustle / Torture. Moot on the card since 2026-10-03: the
  level tiles show only "Level N" (`buildBubbleMatchCard`); the names survive in-game
  only (HUD + win screen). ⚠️ Open: rename in `LEVEL_CONFIGS` if the design's words win.
- **Memory Map** is on the belt (added 2026-10-06, after the design) as a play-only card
  (`buildPlayCard`, no win pill — the game logs no wins), launched with `exitTo` so
  `MemoryMapPage`'s Back and end-popup Exit return here (`useGameExit`). Unlike the hub it
  is not hidden by a collection selection — the belt has no selector.
- **Bucket Drop** is on the belt (added 2026-10-06) as a play-only card launching its
  **No Pinyin** mode (`state.mode: "no-pinyin"`, reading track); the Games hub tile is its
  Pinyin mode. The card is gated to `selectedLanguage === "zh"` HERE rather than by the
  registry's `languages`, because the hub's Pinyin mode is playable in Spanish — and an es
  "no pinyin" run would mark recognition (`foreignPromptTrack`). Code:
  `ReadingGamesCarousel` → the `bucketDrop` card; [BUCKET_DROP_GAME.md](./BUCKET_DROP_GAME.md).
- **Card titles grow when the card has room.** `GameCard` (`src/games/shared/GameCard.tsx`
  → `GameCard`) draws a `card` whose options row is EMPTY (Speed Reading, Writing Grid,
  Word Search with no parked board) with its title at the hero tile's size
  (`TILE_VARIANTS.hero.title`, 23px); a card carrying option tiles (Bubble Match's levels,
  Word Search's Resume box) keeps `CARD_TITLE_SX`'s 15.5px. So Word Search drops back to
  the small title the moment a board is parked. The rule is the card's own, so the Games
  hub's cards follow it too; half-width `tile`s keep their Bento tier's title.
- **These games launch from here only** (since 2026-10-03). The Games hub dropped
  Speed Reading (`GameDef.hiddenFromHub`), Word Search's No Pinyin mode and Bubble
  Match's Recognition ⇄ Reading toggle (the hub now pins Recognition). Every carousel
  launch carries `state.exitTo` (`READING_CENTER_EXIT`), so the game's Back and "Back
  to …" buttons return to the Reading Center (`src/games/runtime/gameExit.ts` →
  `useGameExit`; [GAMES_FEATURE.md](./GAMES_FEATURE.md) § "Second entry point").
- **Returning from a game.** A carousel launch's exit carries
  `state.returnedFromGame = <gameId>` (`ReadingGamesCarousel` → `readingCenterExit`,
  through `GameExit.state` in `src/games/runtime/gameExit.ts`). `MasteryCenterPage`
  reads it (`readReturnedGame`) and does two things:
  - It reopens scrolled all the way down (`src/hooks/usePinScrollBottom.ts`). The pin
    re-applies on every resize of the page body, because the word of the day, the card
    hand and the swipe grid load after mount and would push the foot back out of view.
    It lets go on the learner's first wheel, touch, pointer or key, or after 5 s.
  - The carousel opens parked on that game's card (`focusGameId`, read once on mount,
    applied in the same layout effect that parks the loop on its middle copy).
  An ordinary visit carries no such state and opens at the top.
- **The Writing Center returns the same way.** The Writing Grid's launch
  (`centers/WritingGamesCarousel.tsx` → `WRITING_CENTER_EXIT`) carries
  `state.returnedFromGame = "writing-grid"`, and the Writing Notebook's Back carries
  `"writing-notebook"` (`WritingNotebookPage` → `leave`), so either exit reopens the
  Writing Center pinned to the bottom (the belt is the last section) with the belt parked
  on that card (`focusGameId`). Since 2026-10-06 both Centers' belts are the same
  `GamesBelt` (`centers/GamesBelt.tsx`, extracted from `ReadingGamesCarousel`).
- **Word Search No Pinyin has its own save slot**, separate from the hub's Pinyin board
  (`gameStateStorage` keys by mode — [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md) §5b).
  The carousel can neither resume nor clobber the hub's board — but it CAN clobber its
  own No Pinyin board, so its play button confirms first (below).
- **Word Search card is all purple** (`RAMP.pur.mid`, no option tiles) with a round ink
  **play button** in its bottom-right corner (`GameCardData.play`, rendered by `GameCard`
  as the shared `RoundPlayButton` — `src/components/RoundPlayButton.tsx`, `size="card"`;
  StudyHand's `study-hand__go--round` is the same component at `size="hand"`). **A card with a play button is
  tappable as a whole**: a tap anywhere on it that no inner control claims (header,
  ghost glyph, the empty stretch of the options row) acts as the play button
  (`GameCard` root `onClick`; the option slot wrappers and the play
  button stop propagation so a tap is never handled twice). This covers Word Search on
  both surfaces and Speed Reading; Bubble Match has no play button, so only its level
  tiles launch. The card is not itself a button — the play button stays the keyboard
  control — and a desktop drag on the belt cannot fire it (`useDragScroll` swallows
  the drag's click). Its data comes from
  `buildWordSearchCard` (`src/games/word-search/wordSearchCard.tsx`), reached through
  `useWordSearchLauncher` — the same launcher the Games hub's Word Search card uses, so
  the two cards (and their save-slot behaviour) are identical. A parked No
  Pinyin board adds the shared resume card, `WordSearchResumeTile` (a `kind: "resume"` option),
  one Bubble Match level slot wide — same timer (hidden when the HUD eye hid it), X/N
  (no mode label — the carousel only ever parks No Pinyin), and ✕ → "Delete?" confirm that clears the No Pinyin slot. It is the ONLY way
  back into a parked board. **Play always deals a new board**; with a board
  parked it first opens the "Start a new game?" confirm (`NewGameConfirmDialog`, shared
  with the Games hub's `WordSearchHubItem`), and only on confirm is the No Pinyin slot
  cleared and the fresh game started (`useWordSearchLauncher` → `confirmNewGame`).
- **Games carousel has no momentum — one game per swipe.** However big the swipe, the
  belt moves to the neighbouring game and stops. Touch: every card sets
  `scroll-snap-stop: always` (`ReadingGamesCarousel` passes it to each `GameCard` via `sx`), so a native fling
  cannot coast past a snap point. Mouse: see the next bullet.
- **Games carousel drags on desktop.** Mouse click-and-drag pans the belt through
  `useDragScroll(scrollRef, { paged: true, pageWidth: step })` (`src/hooks/useDragScroll.ts`;
  `pageWidth` = card width + gap). A paged drag is clamped to ±1 page while the button is
  down and commits at most one step on release, so a long drag still lands on the next card. The loop's re-centre (`ReadingGamesCarousel` → `handleScroll`)
  defers while the hook has `scroll-snap-type` parked at "none", so it never jumps
  `scrollLeft` under an in-flight drag.
- **Sheet titles** read "Reading Cards / Reading Decks" and "Writing Cards / Writing
  Decks". The design names the writing sheets bare "Cards / Decks"; treated as an
  oversight for consistency.
- **Writing grid words are cards** (since phase 5), so every Verify posts a writing result
  on the tapped card, which the server fans out onto its characters' own cards behind the
  anti-farming gate ([WRITING_PRACTICE_REWORK.md § 3a](./WRITING_PRACTICE_REWORK.md)).
- **Speed Reading card hue** reads the game's registry hue (`yel` mid), not the design's
  `--bluM`, so the game is one colour on every surface.
- **Center page scroll is not Back-restored** — only the open sheet is. (Returning
  from a carousel game is the exception: it pins to the bottom, see "Returning from a
  game".) `NodePage` does
  not expose its scroller; add a ref prop there if it matters.

### Open follow-ups
- ⚠️ **`dictionaryentries_zh.components` is NULL on every row** (dev, refreshed from PPE
  2026-09-28 — so very likely PPE too). The Word of the Day works around it (the model
  supplies the parts), but Word Search's No Pinyin component hints, which read that column,
  have no data. The backfill (`server/scripts/backfill/chinese/`, migration 125) needs
  running on PPE.
- ⚠️ **The eip ("More Info") is still reachable on a reading card's question face** and
  shows the definition and readings — the same pre-flip leak the know flp already has.
  Decide whether a reading session should lock it until the flip.
- ~~Recognition / production are still NAMED to learners~~ — resolved for the Games hub
  2026-10-03: its tiles are name-only (no subtitle), so neither the Word Search card
  nor any game tile names a track any more.

---

## Code ↔ doc dependencies

Server: `database/migrations/169-create-daily-words.sql`; `server/contracts/wordOfTheDay.ts`,
`studyMode.ts`, `studyMix.ts`; `server/dal/implementations/DailyWordDAL.ts` (+ interface);
`server/services/WordOfTheDayService.ts`, `anthropicClient.ts`, `OnDeckVocabService.ts`
(`MODE_CONFIGS`, the `bar` parameter), `flpReadiness.ts`, `FlashcardMarkService.ts` (`markedBarCategoryBefore`);
`server/controllers/WordOfTheDayController.ts`; `server/routes/dictionaryRoutes.ts`,
`flashcardRoutes.ts`; `server/dal/setup.ts`.

Client:
- `src/features/flashcards/centers/` — `WritingPracticeGrid`,
  `GamesBelt` (both Centers' belt), `ReadingGamesCarousel`, `WritingGamesCarousel`
  (+ the notebook card from `writingNotebook/notebookBelt.ts`), `ReadingSwipeGrid`, `wordGridModel` + `useWordGridGeometry`,
  `WordOfTheDayCard`; `src/games/shared/GameCard.tsx` + `src/games/bubble-match/bubbleMatchCard.ts`
  (the carousel's card, shared with the Games hub); `src/features/flashcards/FlpStudyHand.tsx` (shared with the fdp);
  `src/features/flashcards/centerPrefetch.ts` (fdp → Center prefetch).
- `src/api/wordOfTheDay.ts`; `src/components/handwriting/usePracticeWriting.ts`;
  `src/utils/flpFaceSteering.ts`; `FlashcardsLearnPage/` (`FlashcardsLearnPage`,
  `FlashCardSection`, `useWorkingLoop`).

- `src/features/flashcards/MasteryCenterPage.tsx` — the page frame.
- `src/features/flashcards/DecksSheets.tsx` — pills + sheets (shared with the fdp).
- `src/features/flashcards/masteryCenters.ts` — routes, titles, hues, glyphs.
- `src/features/flashcards/centers/` — Center-only sections (characters grid, games carousel).
- `src/theme/colors.ts` → `COLORS.grnBg`, `COLORS.purBg`.
- `src/games/bubble-match/BubbleMatchPage.tsx` — `location.state.showPinyin` override.
