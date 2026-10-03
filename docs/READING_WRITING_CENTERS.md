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
3. **Word practice grid** (phase 5) — the same 6×6 word grid as the Reading Center's,
   read through the writing bar; tapping a word opens `PracticeWritingPopup` on it.
4. Cards / Decks pills → modal sheets (phase 1).

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
- [x] Writing Center practice grid + practice popup (popup state extracted to
      `usePracticeWriting`, shared with `PracticeWritingButton`). First built as a grid of
      single characters (`CharacterPracticeGrid`); replaced in phase 5.
- [x] Reading Center **games carousel** (`ReadingGamesCarousel`): Bubble Match (pinned
      pinyin-off via `location.state.showPinyin`), Word Search (No Pinyin + resume of a
      parked No Pinyin board), Speed Reading.
- [x] `COLORS.frost` — names the design's `rgba(255,255,255,0.72)` chip ground (was a
      literal in `Spine` and `Bento`).

### Phase 2 — Reading word swipe grid ✅ (2026-10-02)
- [x] Sample words from the learner's cards by READING band, Study Mix weights
      (`STUDY_MIX_QUOTAS`, `server/contracts/studyMix.ts` — now also the source of the
      flp's `DEFAULT_LOOP_CONFIG` quotas), fresh on every mount. Cards resting on the
      reading bar are excluded (their marks would be dropped at the mark chokepoint).
- [x] Pack words into a 6×6 grid; a word spans `length` adjacent cells of one row.
      Words must be all-Han and ≤ 6 characters. Cells nothing fits stay empty.
- [x] Tap → the tile grows in place (absolute left/top/width/height, not a scale
      transform) to exactly a mini card (92×132, `MINI_CARD_WIDTH/HEIGHT`) and flips; the
      back face IS the card's `MiniVocabCard` (word, pinyin, dd, icon — the Cards sheet's
      thumbnail) with `showMasteryStrip={false}`, mounted only while open. Solid orange
      (`orgMk`) ink-outlined triangles appear either side as the swipe hint.
- [x] Swipe right = correct reading mark, left = incorrect (`markFlashcard`,
      `type: "reading"`, surface `"reading-center"`); commits past 18% of the GRID's width
      (min 48px) or on a flick (≥24px at ≥0.5px/ms) — not the flp's viewport-relative
      threshold, which on desktop exceeded the phone frame and made every swipe snap back
      (fixed 2026-10-03); flp wash colours and fly-out timing. The hole (plus any adjacent empty cells) refills in place.
- [x] Tap elsewhere (a frame-wide transparent catcher) → flips back, no mark.
- [x] Model unit tests: `src/__tests__/wordGridModel.test.ts`.

Code: `centers/ReadingSwipeGrid.tsx` (gesture + animation), `centers/wordGridModel.ts`
(`buildPool`, `drawWord`, `fillSegment`, `initialLayout`, `replaceTile` — shared with the
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
      Center's mark tier, tone-coloured pinyin, dd, parts (component font
      `FONTS.hanziComponents`, radical tag in the hue's mid tier), explanation, TTS button.
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
- [x] **`FlpStudyHand`** — the fdp's hand (figures, Review gate, "resting" toast, launch
      URL) extracted from `FlashcardsDecksPage` and shared: fdp `bar="core"`, Reading
      Center `bar="reading"` (zh only). Replaced the one-button `ReadingFlashcardsStack`
      (deleted).
- [x] The Reading Center's hand is `variant="compact"` (`StudyHand`): identical behaviour
      (three modes, tap/throw to promote, Review gate), drawn as the design's `.rstk` stack
      in a 178px box — ±3° fan, glyph + name + round play button, **no figures or tags**.
      Card names on the reading bar: Reading Challenge / Reading Review / Reading Mix
      (`HAND_LABELS`); glyphs `local_fire_department` / `history` / `menu_book`.
- [x] Verified on dev: a reading loop for a 208-card account dealt 10 cards, all off their
      READING cooldown. Tests: `flpFaceSteering.test.ts` § reading mode.

### Phase 5 — Writing Center word grid ✅ (2026-10-03)
- [x] The Writing Center's grid is the Reading Center's 6×6 word grid, read through the
      WRITING bar: the learner's own cards (vet), multi-character words spanning cells,
      sampled by writing band in the Study Mix proportions, fresh every visit.
      `buildPool(cards, now, random, { bar, maxLength })` — the model and geometry are
      shared (`wordGridModel.ts`, `useWordGridGeometry.ts`).
- [x] Words capped at 4 characters (the practice popup's 2×2 limit); cards resting on the
      writing clock excluded.
- [x] Tap → `PracticeWritingPopup` on that word; every Verify marks that card for writing.
      No swipe, no refill — the board is static for the visit.
- [x] `WritingPracticeGrid` replaces `CharacterPracticeGrid` (deleted).

---

## Decisions taken (and open flags)

- **Bubble Match level labels.** The design says Gentle / Brisk / Relentless; the game's
  `LEVEL_CONFIGS` says Chill / Hustle / Torture. The carousel reads `LEVEL_CONFIGS` so the
  two surfaces cannot disagree. ⚠️ Open: rename in `LEVEL_CONFIGS` if the design's words win.
- **Memory Map** also marks reading but is not in the design's carousel; left out.
- **Word Search resume** is offered only when the parked board is a No Pinyin board —
  a parked Pinyin board feeds production, which is not this page's skill.
- **Sheet titles** read "Reading Cards / Reading Decks" and "Writing Cards / Writing
  Decks". The design names the writing sheets bare "Cards / Decks"; treated as an
  oversight for consistency.
- **Writing grid words are cards** (since phase 5), so every Verify marks the tapped card.
- **Speed Reading card hue** reads the game's registry hue (`yel` mid), not the design's
  `--bluM`, so the game is one colour on every surface.
- **Center page scroll is not Back-restored** — only the open sheet is. `NodePage` does
  not expose its scroller; add a ref prop there if it matters.

### Open follow-ups
- ⚠️ **`dictionaryentries_zh.components` is NULL on every row** (dev, refreshed from PPE
  2026-09-28 — so very likely PPE too). The Word of the Day works around it (the model
  supplies the parts), but Word Search's No Pinyin component hints, which read that column,
  have no data. The backfill (`server/scripts/backfill/chinese/`, migration 125) needs
  running on PPE.
- ⚠️ **Word Search confirm-before-clobber dialog is duplicated** in
  `ReadingGamesCarousel` and `WordSearchHubItem`. Extract a shared
  `useWordSearchNewBoard` once the in-flight Word Search edits are committed.
- ⚠️ **The eip ("More Info") is still reachable on a reading card's question face** and
  shows the definition and readings — the same pre-flip leak the know flp already has.
  Decide whether a reading session should lock it until the flip.
- ⚠️ **Recognition / production are still NAMED to learners** even though they no longer
  own a hue: `BubbleMatchTrackToggle` (RECOGNITION ⇄ READING), Word Search's No Pinyin
  subtitle ("Reading & Production"), and the Games hub tile subtitles
  (`tileSubtitle` → "Recognition · …"). Each needs a learner-facing word (e.g. "Know").

---

## Code ↔ doc dependencies

Server: `database/migrations/169-create-daily-words.sql`; `server/contracts/wordOfTheDay.ts`,
`studyMode.ts`, `studyMix.ts`; `server/dal/implementations/DailyWordDAL.ts` (+ interface);
`server/services/WordOfTheDayService.ts`, `anthropicClient.ts`, `OnDeckVocabService.ts`
(`MODE_CONFIGS`, the `bar` parameter), `flpReadiness.ts`, `FlashcardMarkService.ts` (`markedBarCategoryBefore`);
`server/controllers/WordOfTheDayController.ts`; `server/routes/dictionaryRoutes.ts`,
`flashcardRoutes.ts`; `server/dal/setup.ts`.

Client:
- `src/features/flashcards/centers/` — `CenterSectionHeading`, `WritingPracticeGrid`,
  `ReadingGamesCarousel`, `ReadingSwipeGrid`, `wordGridModel` + `useWordGridGeometry`,
  `WordOfTheDayCard`; `src/features/flashcards/FlpStudyHand.tsx` (shared with the fdp).
- `src/api/wordOfTheDay.ts`; `src/components/handwriting/usePracticeWriting.ts`;
  `src/utils/flpFaceSteering.ts`; `FlashcardsLearnPage/` (`FlashcardsLearnPage`,
  `FlashCardSection`, `useWorkingLoop`).

- `src/features/flashcards/MasteryCenterPage.tsx` — the page frame.
- `src/features/flashcards/DecksSheets.tsx` — pills + sheets (shared with the fdp).
- `src/features/flashcards/masteryCenters.ts` — routes, titles, hues, glyphs.
- `src/features/flashcards/centers/` — Center-only sections (characters grid, games carousel).
- `src/theme/colors.ts` → `COLORS.grnBg`, `COLORS.purBg`.
- `src/games/bubble-match/BubbleMatchPage.tsx` — `location.state.showPinyin` override.
