# Reader Documents (user documents)

The Reader (`/reader`, reached from the footer's Menu popover) is a list of the learner's own
documents; opening one (`/reader/:id`) shows it as a tappable reading surface with
an inline content editor. This doc covers the document model, the CRUD API, and the
create/edit/delete flows.

> **Word segmentation & tap navigation**: how the Reader splits an open document
> into tappable dictionary words (client-side gsa) and steps the selection
> through them → [READER_SEGMENTATION.md](./READER_SEGMENTATION.md).
> **Page archetypes** (Node list page + footerless document drill-in, header
> actions, edit toolbar) → [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md) § Reader.
> **Choose Your Own Adventure** (cyoa, DESIGN) — a branching-story reader built on this
> page's reading engine, which is to be extracted into a shared pane →
> [CYOA_FEATURE.md](./CYOA_FEATURE.md).

## Data model — `texts`

Code: `database/init/01-init-schema.sql` / `database/deploy/01-schema.sql` (texts);
`server/contracts/wire.ts` → `TextBase` (re-exported as `Text` by `server/types/index.ts`
and `src/types.ts`).

| Column | Notes |
|---|---|
| `id` | uuid, `uuid_generate_v4()` |
| `userId` | owner; `ON DELETE CASCADE` |
| `title` | typed into the header on create, else **derived from the content** (see below); renamable in edit mode (§ Editing) |
| `content` | the document body, sanitized on write (`sanitizeDocumentContent`) |
| `language` | `zh` / `es`; set on create, immutable afterwards |
| `characterCount` | `content.length`, recomputed on every content update |
| `isUserCreated` | `true` for every row the API creates |
| `iconId` | optional FK → `icons8("icons8Id")`, `ON DELETE SET NULL` (**migration 193**); the learner-picked document icon. NULL = default glyph. See § Document icon |
| `kind` | `'document'` (default) / `'journal'`, `CHECK chk_texts_kind` (**migration 194**); the Reader collection. Set on create only. See § Collections |
| `createdAt` | `now()`. Nullable in the schema (no `NOT NULL`), though every API insert sets it |
| `updatedAt` | `now()` default, `NOT NULL` (**migration 194**, backfilled from `createdAt`); stamped by `TextDAL.updateFields` on every update. Drives the "Recently edited" sort |

Removed columns: `description` and the validation-doc linkage
(`validationEntryId` / `validationLanguage` / `validationField`) were dropped by
**migration 183** (2026-11-05), along with the Reader validation-document queue that
used them — see [DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md).

## Backend (layers)

| Layer | File | Role |
|---|---|---|
| Route | `server/routes/textRoutes.ts` | registration only |
| Controller | `server/controllers/TextController.ts` | request parsing, status codes |
| Service | `server/services/TextService.ts` | ownership checks, limits, sanitizing, title derivation |
| DAL | `server/dal/implementations/TextDAL.ts` (`ITextDAL`) | the `texts` table: one statement per method |
| Utility | `server/utils/documentTitle.ts` | pure title rule (`deriveDocumentTitle`) |
| Controller | `server/controllers/SentenceExplanationController.ts` | Sentence Explain: body validation, budget day, 429 mapping (§ Sentence Explain) |
| Service | `server/services/SentenceExplanationService.ts` | Sentence Explain: cache → budget → grounding → Opus call → store (§ Sentence Explain) |
| DAL | `server/dal/implementations/SentenceExplanationDAL.ts` (`ISentenceExplanationDAL`) | the `sentence_explanation_cache` table (migration 195) |

Title derivation reads det through `IDictionaryDAL.findMultipleByWord1`.

### Endpoints

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/texts` | — | the user's documents in their `selectedLanguage`, newest first (`getUserTexts`) |
| GET | `/api/texts/stats` | — | counts / total characters |
| GET | `/api/texts/:id` | — | one document |
| POST | `/api/texts` | `{ content, language?, iconId?, kind?, title? }` | `title` absent/blank → the server derives it; `kind` ∈ `TEXT_KINDS` (default `document`) |
| PUT | `/api/texts/:id` | `{ title?, content?, iconId? }` | owner only; `language` is rejected; `iconId: null` clears the icon, an absent `iconId` leaves it; every update stamps `updatedAt` |
| DELETE | `/api/texts/:id` | — | owner only |
| POST | `/api/texts/explainSentence` | `{ sentence, language, tz }` | the AI explanation of one highlighted sentence, tailored to the caller → `SentenceExplanationResult`; 400 over `EXPLAIN_SENTENCE_MAX_LENGTH`, 429 when the shared daily AI budget is spent (§ Sentence Explain) |

### Title derivation

Code: `server/utils/documentTitle.ts` → `deriveDocumentTitle`, `documentTitleSource`;
`server/services/TextService.ts` → `deriveTitle`; tests
`server/__tests__/documentTitle.test.ts`.

On create, the title is **as many whole words of the first non-empty line as fit in
20 characters** (`DOCUMENT_TITLE_MAX_CHARS`, counted in code points). A "word" is a gsa
segment inside a Chinese run (`splitHanRuns` → `segmentWithDict` against det, looked
up only for the substrings of the first 64 characters) and a whitespace-delimited
token elsewhere, so a title never cuts 图书馆 or "library" in half. If the first word
alone is longer than 20 characters it is hard-cut; an empty body gives `Untitled`.
The title is derived **once**, and only when the draft's header title field was left
blank: later content edits do not retitle the document.

### Limits

Code: `TextService.validateTextData` / `validateUpdateData` / `createText`.
Title ≤ 200 characters (PUT), content ≤ 50 000. Per account, `createText` caps
user-authored documents at `MAX_DOCUMENTS_PER_USER` (500), counting `isUserCreated`
rows — see [API_ABUSE_HARDENING.md](./API_ABUSE_HARDENING.md) § 1c.

## Frontend

Under `src/features/reader/`, except the rows marked **(reading)**: those live in
**`src/reading/`**, the reading engine shared with Adventures (docs/CYOA_FEATURE.md § 4,
moved 2026-11-21 with their names unchanged). A bare file name in a "Code:" line below
means whichever of the two folders holds it.

| File | Role |
|---|---|
| `ReaderPage.tsx` | `/reader` list (Node page); optimistic swipe-delete (`handleDelete`) |
| `TextSidebar.tsx` | the list body (despite the name — not a sidebar): the top tile row (`ReaderCollectionTiles`) + the grid (`ReaderDocumentGrid`) or a `RowList` of `Row`s (§ List views) |
| `ReaderCollectionTiles.tsx` | the top row: the **Documents / Journal** toggle pair (§ Collections) |
| `ReaderListToolbar.tsx` | the row under it: **New document** pill · sort · grid/list (§ List toolbar) |
| `ReaderSortMenu.tsx` | the toolbar's sort icon + menu (§ Sorting) |
| `readerListOrder.ts` | pure list logic: `filterByCollection`, `sortTexts`, `formatJournalDate`, `readerDocumentHue` / `readerDocumentGlyph` |
| `useStoredChoice.ts` | the per-device localStorage choice behind `useReaderListView`, `useReaderCollection` (`reader.collection`), `useReaderListSort` (`reader.listSort`) |
| `ReaderDocumentGrid.tsx` | the default **grid** view: 2-column cards, centred icon, title below, ⋯ → Delete (§ List views) |
| `useReaderListView.ts` | the per-device grid ⇄ list choice (`reader.listView`), switched by the header icon |
| `SwipeToDeleteRow.tsx` | iPhone-style swipe-left row that uncovers **Delete** |
| `ReaderDocumentPage.tsx` | `/reader/:id` document page, including the `/reader/new` draft |
| `readerPaths.ts` | `NEW_DOCUMENT_ID` / `NEW_DOCUMENT_PATH` / `newDocumentPath(kind)` |
| `TextHeader.tsx` | vocab-processing status pills only (the title is the page header's since 2026-11-17) |
| `TextArea.tsx` **(reading)** | reading textarea ⇄ editable textarea; hosts the Pinyin-mode view over the (invisible) reading textarea; `size="inline"` reads a few lines in place (cyoa's inspected choice label) |
| `ReaderCpcdView.tsx` **(reading)** | the **Pinyin** display mode: the document as inline cpcd words + the Reader's own highlight (§ Display modes) |
| `useReaderSettings.ts` | auto word-select (always on) + the per-device `displayMode` (held by `useReaderDisplayMode.ts` **(reading)**, shared with the cyoa story page) |
| `useSegmentOverrides.ts` **(reading)** | the tiebreak switches made in the Pinyin view (docs/READER_SEGMENTATION.md § Tiebreak alternatives) |
| `ReaderDisplayToggle.tsx` **(reading)** | the Pinyin pill (§ Display modes) |
| `englishTranslation.ts` + `useEnglishTranslations.ts` **(reading)** | English word → the Chinese det entry it translates to, for the keycap (§ English words) |
| `ReaderKeycapPawn.tsx` **(reading)** | the keycap's empty face: a small resting pawn (§ Look) |
| `ReaderEditToolbar.tsx` + `useReaderContentEditor.ts` | undo/redo/cancel/save for inline edit |
| `DeleteDocumentDialog.tsx` | delete confirmation for the document header's trash icon |
| `readerStyles.ts` **(reading)** | the shared `sx` fragments of the look below |
| `ReaderReadAloudButton.tsx` + `useReaderReadAloud.ts` + `readAloudClauses.ts` **(reading)** | the display strip's play button: reads the document aloud from the caret (§ Read aloud) |
| `useReaderAudioSettings.ts` **(reading)** + `src/components/AudioModeChip.tsx` → `ReaderAudioChip` | the display strip's audio chip: the Reader's own mute / default / media setting (§ Tap-to-hear) |
| `src/components/VocabDisplayCard.tsx` | the dictionary keycap above the reading box (callers: the Reader and the Adventures play page, both through `useReadingKeycap`) |
| `ReaderSearchKey.tsx` + `ReaderSearchBar.tsx` + `useReaderSearch.ts` + `readerSearch.ts` | find-in-document: the strip's search key, the bar it opens into, its state, and the pure text/pinyin matcher (§ Search) |
| `ReaderSearchHighlights.tsx` **(reading)** | the Text mode's yellow match highlights: a live mirror over the reading textarea (§ Search) |
| `readerSentences.ts` **(reading)** | pure sentence splitter (`splitSentences`, `sentenceRangeAt`) for the sentence highlight (§ Sentence Explain) |
| `ReaderSentenceFace.tsx` + `useSentenceExplanation.ts` **(reading)** + `src/api/sentenceExplanation.ts` | the keycap's face in SENTENCE MODE: the Explain key and its AI answer (§ Sentence Explain) |
| `ReaderMoreInfoKey.tsx` **(reading)** | the keycap's More Info key, and `ReaderKeycapButton`, the generic labelled key it and the Explain key are built from |
| `useTextSelection.ts`, `textSelection.ts`, `textSelectionUtils.ts`, `documentSegmentation.ts`, `readerAlternatives.ts`, `ReaderTapOverlay.tsx`, `ReaderTapHint.tsx`, `useReaderWordActions.ts`, `useReaderAudioPreload.ts` **(reading)** | the selection model, gsa spans, tap-to-navigate and its hint, the keycap's word actions, tap-to-hear preloading |
| `useReadingText.ts` **(reading)** | one text read with the engine: its spans (+ tiebreak overrides) and its `useTextSelection` |
| `useReadingKeycap.tsx` **(reading)** | the dictionary keycap's wiring, lifted from this page: `cardProps` for `VocabDisplayCard` (tap demo, pawn, Sentence Explain face, the Add / More Info keys), `wordActions`, TAP-TO-HEAR + preloading, the demo's zone flash |
| `useReadingVocabSync.ts`, `ReadingTapRegion.tsx`, `ReadingEipHost.tsx` **(reading)** | the vocab-update listeners; the frame placing `ReaderTapOverlay` (this page's TAP REGION); the eip behind More Info |

### Look

Code: `src/components/VocabDisplayCard.tsx`, `src/components/SenseList.tsx`;
`ReaderDocumentPage.tsx` → the surface's `title`, `look`; `ReaderPage.tsx` → `look`;
`readerStyles.ts` → `READER_CARD_RADIUS`, `READER_TEXT_GUTTER_PX`, `readerMenuPaperSx`, `readerMutedTextSx`,
`readerMessageSx`, `readerPillButtonSx`; `src/timeOfDay/useTier2Look.ts`;
`src/components/primitives/Row.tsx` → `tones`; `src/components/NodePageHeader.tsx` →
`titleColor`; every component in the table above.

The Reader wears the Friends panel's **flat** shapes (docs/FRIENDS_FEATURE.md,
`src/features/friends/friendStyles.ts`, since 2026-11-16) on the **Tier 2 time-of-day**
colours (since 2026-11-17 — the Dictionary's look, SHELF_REDESIGN.md § 7b "Time of day"):

- **Time of day** — each page (`ReaderPage`, `ReaderDocumentPage`) calls `useTier2Look()`
  once and passes the `look` down to every piece that paints a surface or text; the
  `readerStyles.ts` fragments all take it. By **day** the ground is the pale sky tint
  (#E0F3FF) with white surfaces and the app's ink; at **night** the ground is #1E2735 with
  #2A3446 surfaces (grid cards, list rows via `Row` `tones`, menus, the
  delete dialog, the edit toolbar's icon button, the neutral Cancel / idle Read pills) and
  light ink — the page title and back arrow included (NodePage `headerTitleColor`,
  `NodePageHeader` `titleColor`). The selection tint is a touch stronger at night
  (`selectionColors`, keyed on `look.dark`, no longer the Settings theme). In the Pinyin
  display mode `ReaderCpcdView` `inkColor` colours the characters and uncoloured pinyin.
  The tap-zone flash lifts (translucent white) at night instead of multiplying grey
  (`ReaderTapOverlay` `night`).
  **Not themed:** pastel fills (Documents / Journal tiles, icon tiles and row avatars, Save,
  New document, playing Read, Delete, status pills — pastels stay pastel on slate), the
  **dictionary keycap** (stays the white day keycap — its contents follow the Settings theme,
  owner's call 2026-11-17), the eip sheet and `IconPickerDialog` (Settings theme), and the
  slab footer (Settings theme, `footerChrome.ts`).
- **Ground** — the time-of-day ground on both pages, and the app's one footer, the slab, on
  `/reader` (`/reader/:id` is footerless).
- **Title** — the open document's title is the page header's title (`ReaderDocumentSurface`
  `title`, ellipsized); "Reader" only while loading / not found. In edit mode it becomes a
  text field (§ Renaming).
- **Dictionary keycap** (`VocabDisplayCard`, 2026-11-17) — the one raised object on the
  page: a static keycap (white face, `COLORS.border` outline, rounded edge, 4px `COLORS.grey`
  lip — the Tier 2 day keycap's colours). Header: the headword as a CPCD row (`ForeignText`
  `md`, tone colours per the flp's `showPinyinColor`). Body: `SenseList`
  (src/components/SenseList.tsx) — the eip's "Other Translations" list itself, same layout,
  font and trailing star, tap a row for its commonality — with no section label. A
  single-sense word lists its glosses. The keycap never takes focus from the reading box
  (`preventDefault` on its mousedown, capture phase): a tap on a row would otherwise trip the blur →
  refocus loop (`useTextSelection` → `handleTextAreaBlur`), whose re-selection can scroll
  the textarea, and `SenseList` closes its popup on any scroll. The face's bottom padding is
  4px, so four one-line senses fit in the fixed 210px height. A highlighted word with **no
  entry** (no det row, no English translation, a grammar word) shows a small resting **pawn**
  centred in the face (`ReaderKeycapPawn.tsx` — the iso kit's `pawnFigure` in ink with a
  hard **centred** floor shadow on the white face — straight under the feet, not slid
  down-right along the light (`IsoShadow` `centred`) — ~40px tall; passed as `VocabDisplayCard` → `emptyFace`,
  a full-face centred layer). It replaced a "No dictionary entry found." line (2026-11-17).
- **Keycap word actions** (2026-11-17) — the eip's speaker (`SpeakerButton`) sits just right
  of the headword. At the header's right edge: a **More Info** keycap
  (`src/reading/ReaderMoreInfoKey.tsx` — the flp's `MoreInfoPill` plate,
  built to the Add key's recipe, shape included (its rounded rectangle, not the flp
  More Info's capsule; no ↑ arrow) — eip palette `face` on an `edge` lip, the 1px outline ring, rounded edge, press and label type, sizes
  shared via `eipAddKeySizes.ts`, and the Add key's fixed width at each size) and the eip's **Add ⇄ Added!**
  key (`EipAddKey`). A word already in Learning shows "Added!"; tapping it removes the word.
  **Side by side** (Add, then More Info at the far right) when the header row has room; **stacked, in both controls' `compact`
  size, More Info on top, spread by three equal flex spacers (6px floor each; lips and the rest lift counted) between the face's top edge and the divider** when a long headword leaves too little
  (the face's 12px sides and a 4px header gap keep a 2-character headword side by side on a
  ~390px phone) (`VocabDisplayCard` → ACTION LAYOUT: a
  ResizeObserver compares the row's room after the headword with the controls' recorded
  side-by-side width, and calls the page's `renderHeaderActions(stacked)`).
  `src/reading/useReaderWordActions.ts` owns the behaviour: `useTTS().speak` on the
  det row adapted by `dictionaryEntryToVocabEntry`; More Info → `lookupVocabEntry` (the full
  row) → `useEipTabs.openForRoot` → the page's `EipSheet`, configured like the Dictionary
  page's (Synonyms + Related, word-tools rail, Learning key); and a `useLearningToggle` SEEDED
  (`seedInLibrary`) from the document's vocab lookup — whose personal entries are exactly the
  learner's Learning cards (`vetSortedClause`) — so the key is drawn the moment a word is
  selected and the status fetch only confirms it; the same toggle drives the eip's Add key while the eip shows that word (`useReaderWordActions` → `sharedLearning` → `EipSheet` `sharedLearning`), so a tap in the eip flips the keycap's key behind the sheet at once; a drilled-into word runs the eip's own toggle. While the
  eip is open the reading box stops re-taking focus (`ReaderDocumentPage` →
  `handleReadingBoxBlur`), and `eipOpen` counts in `anyDialogOpen` so focus returns when it
  closes. `VocabDisplayCard` only places the controls (`onSpeak`, `isSpeaking`,
  `renderHeaderActions`).
- **Nothing-selected mode** (2026-11-17) — a document opens with **no word highlighted**:
  the caret is parked at the top and the keycap's face shows the tap-to-navigate hint,
  which replaced the 5 s `reader-tap-hint` notification (`ReaderTapHint.tsx`). The WHOLE
  face becomes a miniature reading box, split by a dotted line at the real tap divide
  (`ReaderTapOverlay` → `TAP_LEFT_ZONE_FRACTION`, the left third). Three sentences sit in the
  right zone only, clear of the divide: "Tap the left or right side of the screen to move
  the cursor." along the top (`READER_NAVIGATION_HINT`), "Tap and hold on a word to jump to
  it." on the middle row (`READER_JUMP_HINT`) and "Tap and hold even longer to look at the
  whole sentence." along the bottom (`READER_SENTENCE_HINT`, SENTENCE MODE — § Sentence
  Explain). A `touch_app` finger starts at its left-zone tap position, plays 2 rounds of
  glide-right → tap → glide-left → tap on the face's middle row (crossing the middle
  sentence on the right taps), then rests where it started, in the left zone, so the right
  zone stays clear for the sentences (owner's call 2026-11-20). A zone fills `COLORS.grey` the
  instant the finger's centre crosses into it (its real position read per animation frame)
  and `COLORS.greyA` for the tap; `prefers-reduced-motion` shows only the resting diagram.
  **Tapping the demo** flashes the matching real zone (the tap region: the whole screen
  below the display strip — READER_SEGMENTATION.md) twice
  (`ReaderTapOverlay` → `flash`, `COLORS.grey` multiplied so the text stays dark; a
  translucent white at night) — mobile
  only, as the overlay itself is. The request is cleared when the pulse ends (`onFlashEnd` →
  `clearTapZoneFlash`): the overlay unmounts in edit mode, so a request still set would
  replay on Cancel/Save. The learner's first selection that lands on a word ends
  the mode; a gesture that selects nothing (a back-tap at the very top, a click in
  whitespace) keeps it. **A long-press on empty space** (no word under the finger — a gap,
  punctuation, past a line's end, a blank line; mobile, both display modes) **brings it
  back** (owner's call 2026-11-17): the highlight and the keycap's entry are dropped and the
  caret is parked at the pressed character (text mode; the Pinyin mode keeps the old
  selection's start), so the next forward tap steps on from there. The returning hint shows
  its finger **at rest** — the demo plays only the first time on a page
  (`useReadingKeycap` → `tapDemoPlayed` → `ReaderTapHint` `playDemo`). A remount (leaving
  the document and coming back) also restores the mode, demo included.
  Mechanism: `useTextSelection` → `awaitingFirstSelection` / `noteUserInteraction` /
  `clearSelection` — until the learner touches the box (TextArea's `onKeyDown` /
  `onPointerDown`, which also catch ReaderTapOverlay's synthetic arrows), auto word-select
  and the card lookup stand down, so the focus-driven `select` events (initial focus, the
  blur → refocus loop, leaving edit mode) cannot highlight the first word on their own.
  `clearSelection` resets that interaction flag too, so the same guard holds after a return.
  Code: `src/reading/useTextSelection.ts`, `TextArea.tsx` → `onUserInteraction`,
  `ReaderTapHint.tsx` (the demo + its three sentence constants), `VocabDisplayCard` → `idleHint`
  (a ReactNode slot it only centres), `ReaderTapOverlay.tsx` → `engageWordJump`.
- **Cards and rows** — the look's surface (white by day) with its `line` hairline and no shadow:
  `Row`s (16px) for documents, SectionCard's 18px radius for the delete dialog.
  **The reading area is not a card** (since 2026-11-20): the words sit straight on the
  page ground, in reading and edit mode alike, inside a wide side margin — the content
  padding (16 / 24px) plus `READER_TEXT_GUTTER_PX` (24px x, 8px y), which the textarea
  (`TextArea.tsx`) and the Pinyin view (`ReaderCpcdView.tsx`) share so both break lines at
  the same margin. Shared with cyoa (docs/CYOA_FEATURE.md). A user document's row has a blue avatar glyph
  (`description`), a built-in text's a grey one (`menu_book`).
- **Actions** — New document is a blue pill in the list toolbar (§ List toolbar). Buttons are pills with a ramp MID fill and ink text (`readerPillButtonSx`):
  Save blue, Delete red, Cancel the neutral surface pill (`readerPillButtonSx(look)`, no fill). Undo/redo are bare icon buttons.
- **States** — loading, empty, not-found and errors are plain text lines
  (`readerMutedTextSx` / `readerMessageSx`), not spinners or MUI Alerts. A failed
  swipe-delete's line dismisses on tap.
- **Reading box focus** — the reading box is focused the whole time it is open, so it
  shows no focus ring; with no box, neither does the edit-mode field (the drop-down edit
  toolbar and the caret mark edit mode).

### English words

Code: `englishTranslation.ts` → `englishLookupKeys`, `pickBestEnglishMatch`,
`ENGLISH_GRAMMAR_WORDS`, `documentEnglishWords`; `useEnglishTranslations.ts`;
`useTextSelection.ts` → `handleTextSelectionChange` (`translateEnglish`,
`selectedByTranslation`); `useReadingKeycap.tsx` → `selectedInLibrary`;
`src/api/dictionary.ts` → `fetchEnglishDictionaryMatches`;
`POST /api/dictionary/englishMatches` → `DictionaryController.englishMatches` →
`DictionaryService.findEnglishTranslations` → `DictionaryDAL.findCompleteEnglishMatches`.

An English word in a Chinese document is a selectable span like any other (READER_SEGMENTATION.md).
When it has no det row of its own, the keycap shows the **Chinese word it translates to**,
drawn exactly as a highlighted Chinese word (no marker; owner's call 2026-11-17) — headword,
senses, speaker, More Info and Add all act on the Chinese entry. The text itself is unchanged
in both display modes (Pinyin mode draws English as plain text, no pinyin under it).

- **Lookup keys** — each word (lowercased, possessive `'s` dropped) plus naive
  stripped-ending forms: `-ies/-ied → y`, `-es`, `-s` (not `-ss`), `-d`, `-ed`, `-ing`,
  `-ing → e`, `-ily → y`, `-ly`, `-r`, `-er`, `-st`, `-est`, with a doubled final consonant
  undone ("running" → running, runne, runn, run). ALL keys are looked up, because a gloss
  can carry the ending as easily as the stem. Other contractions ("don't") and grammar
  words (articles, prepositions, conjunctions, auxiliaries/modals — `ENGLISH_GRAMMAR_WORDS`;
  pronouns and "not" are kept) get no keys, so the keycap shows its empty face.
- **Server match** — per key, the one det row having a sense that IS the key: the search
  ladder's "complete English" normalization (`DictionaryDAL` → `normalizedSenseSql`: no
  parentheticals, lowercased, trailing `?`/`!`/`.`/`…` dropped (`GLOSS_TRAILING_PUNCT_SQL` —
  CC-CEDICT glosses interrogatives as "where?" / "what?", so without it 哪里 / 什么 never
  matched and "where" fell through to unenriched 焉), a leading `to`/`the`/`a`/`an` dropped,
  senses split on `'; '`; the key side gets the same treatment via `normalizeEnglishTerm`).
  Best row: highest `frequencyScore` (unscored last), then earliest matching sense, then
  lowest `difficulty`, then shortest headword. Partial matches never count. One full pass over
  every sense of the table (~1 s on dev's 115k zh rows, flat in the number of keys — the keys
  are hash-joined against the normalized senses), so it runs **once per document open**: the
  hook keys its effect on the document's key set (never on `token`), and each selection then
  resolves synchronously. Capped at 5,000 keys per request (`ENGLISH_LOOKUP_MAX_TERMS`).
- **Best match per word** (client, naive) — across the word's keys: commoner entry, then
  earlier sense, then the less-stripped key ("news" → 新闻 over "new" → 新), then easier
  entry. "running" → 跑 (via "run", score 5) beats the literal "running" → 一连 (score 3).
- **Add key** — seeded like a Chinese word's, so it is drawn with the keycap rather than
  clipping in later. The translation is usually not among the document's loaded cards, so
  the seed comes from the English lookup itself: `DictionaryController.englishMatches` reads
  the matched headwords' Learning status in the same request (`VocabEntryDAL.findByTokens`,
  the document lookup's own read) and returns `inLearning` per match;
  `useEnglishTranslations` → `translationInLearning(word1)` hands it to `useLearningToggle`
  as `seedInLibrary`. The toggle's status fetch still runs and corrects a stale seed.
- **Chinese only** — Spanish is paused; the service returns no matches for another language
  and the hook never fetches (docs/DEFERRED_WORK.md).
- **Known limit** — matches resolve on selection only: an English word highlighted before
  the lookup lands stays empty until the next selection (the same is true of Chinese words
  before the vocab lookup).

### Display modes

Code: `src/reading/useReaderDisplayMode.ts` → `ReaderDisplayMode`, `useReaderDisplayMode` (via `useReaderSettings.ts`);
`ReaderDocumentPage.tsx` → `.reader-document-display-strip`; `ReaderDisplayToggle.tsx`;
`ReaderCpcdView.tsx` (whole file); `TextArea.tsx` → `cpcdView`;
`ReaderCpcdView.tsx` → `buildParagraphs`; `CPCDRow.tsx` → `CPCDRowGroup`;
`ReaderDocumentPage.tsx` → `showCpcd`, `cpcdScrollRef`, `.reader-page-tap-region`;
`ReaderTapOverlay.tsx` → `scrollRef`, `wordSource`, `selectWordAt`, `startFling`;
`textSelectionUtils.ts` → `textareaOffsetAtPoint`; `useTextSelection.ts` →
`selectionRange`, `selectRange`, `selectSpanAtOffset`, `clearSelection`; `documentSegmentation.ts` → `buildReaderPronunciationMap`.

A **display strip** sits under the dictionary keycap (inside the keyboard-lift fold): a row
whose right edge holds `ReaderDisplayToggle`: a single **Pinyin** pill with two style
states — off = Text mode (the neutral `readerPillButtonSx` pill faded to `OFF_OPACITY`
0.45), on = Pinyin mode (the same pill at full opacity); no hue for "on" (owner's call
2026-11-18; it replaced a "Text ◯━ Pinyin" MUI switch). Its left edge holds the audio controls: the read-aloud button (§ Read aloud), then the
tap-to-hear audio chip (§ Tap-to-hear). While editing, all three are `visibility: hidden`
(the strip keeps its height, so the text box does not jump) — edit mode is always the plain
field. The pill commits **deferred** (`ReaderDisplayToggle` → `pendingMode`): a tap restyles the
pill at once and hands the mode to the page one frame later (double `requestAnimationFrame`),
because mounting `ReaderCpcdView` blocks the main thread and would otherwise hold the pill's
old style until it finished. The choice is stored **per device** (`localStorage` `reader.displayMode`, default
`text`; owner's call 2026-11-17).

- **Text** — the read-only textarea, highlight = the browser's `::selection`.
- **Pinyin** — **one cpcd row per newline-delimited paragraph** at `sm` (owner's call
  2026-11-17; it used to be one row per gsa word). Built by `ReaderCpcdView` →
  `buildParagraphs` and rendered through `ForeignText` `items` + `groups` (tone colours per
  the device's `showPinyinColor`). Characters sit evenly spaced straight through word
  boundaries, and the pinyin collision solver (docs/CPCD_PINYIN_SHIFT.md) runs across
  words and punctuation. Each gsa word is a `CPCDRowGroup`, an unbreakable inline-block
  that also carries the highlight, `data-span-index` and the click, so lines still wrap
  **only between words**. Punctuation and spaces are glued to a neighbour word in an outer
  group (closers and spaces to the word before, opening quotes and brackets to the word
  after), so a line never starts with "，". Punctuation and Latin words are pinyin-less,
  text-width cells (`autoWidth`) that keep the pinyin band (`reservePinyinBand`), so every
  line is one cpcd line tall (`cpcdNaturalSize('sm')`), blank lines included. 一/不 sandhi
  runs once over each whole paragraph (`applyYiBuSandhi`), so it now applies across word
  boundaries. Pinyin per word comes from
  `buildReaderPronunciationMap` — the same first-match rule as the keycap's
  `findDictionaryMatch`, so the pinyin under a word agrees with the entry it opens.
  **Tiebreak alternatives:** while the selected word won a frequencyScore tiebreak
  against an overlapping word of the same length, the losing word shows in the
  search-match yellow, and tapping it switches the selection
  (docs/READER_SEGMENTATION.md § "Tiebreak alternatives"; Pinyin mode only).

**Navigation is identical in both modes — by construction.** A cpcd paragraph cannot be a
textarea, so the Pinyin mode does NOT have its own navigation: the reading textarea stays
mounted, focused and navigable underneath with its text at `opacity: 0`, and remains the one
selection model. `ReaderTapOverlay`'s zone taps, the arrow keys, auto word-select, the
nothing-selected mode and the keycap lookup all run unchanged. `ReaderCpcdView` is only a
**highlight renderer**: it reads `useTextSelection` → `selectionRange` (the state twin of
`lastSelectionRef`), highlights the span that starts AND ends exactly there (the text
mode's selection tint, as a background + box-shadow bleed, so no reflow), and scrolls it
into view with one line of margin (measured against its own scroll box, not
`scrollIntoView`, which would also scroll the overflow-hidden page). Switching modes keeps
the reader's place.

**The tap overlay (mobile) in both modes.** `ReaderTapOverlay` covers the reading box with
`touch-action: none` and owns every gesture: a tap is a zone step, a vertical drag scrolls,
a long-press or horizontal drag is a WORD JUMP. The modes differ only in what it scrolls and
hit-tests (`scrollRef`, `wordSource`).
- **Scrolling + MOMENTUM.** The overlay moves the scroll target's `scrollTop` by hand (the
  textarea, or the cpcd view's box via `scrollRef`) — the browser cannot, since the overlay
  is a sibling, not an ancestor — so it also supplies the fling the browser would have:
  the release velocity (averaged over the last `VELOCITY_WINDOW_MS`, 100 ms) coasts on with
  exponential decay (`DECAY_TAU_MS` 325, iOS-like) until slow or at the end of the range
  (`startFling`). A touch during a fling stops it and is not also a tap.
- **WORD JUMP** — "Tap and hold on a word to jump to it" (`READER_JUMP_HINT`). A still
  finger held `LONG_PRESS_MS` (400 ms) selects the word under it, then keeps re-selecting
  under the finger until release (`selectWordAt`). Text mode resolves the point to a
  character with a mirror of the textarea laid over it (`textareaOffsetAtPoint`: the
  browser's caret hit test inside the mirror, then a check that the character's box really
  contains the point) and selects its gsa word (`selectSpanAtOffset`). The Pinyin mode
  hit-tests through the overlay with `elementsFromPoint` for a `[data-span-index]` cpcd word
  and clicks it — the same `onClick` → `selectRange` path as a desktop click. A press over
  **empty space** returns to Nothing-selected mode (§ Look); gaps crossed while sliding keep
  the last word. (It used to hand text mode's long-press to the browser's native selection
  by dispatching a synthetic `pointerdown`, which never worked: browsers do not start a
  selection from an untrusted event.)
- **SENTENCE PRESS** (the long-press's second tier) — a still WORD JUMP that landed on a
  word arms a second timer; if the finger stays down and within `MOVE_THRESHOLD_PX` of the
  press for `SENTENCE_PRESS_EXTRA_MS` (600 ms more, ≈ 1 s in all), the word widens to its
  sentence (`onSelectSentence` → `selectSentenceAtSelection`). Moving off the spot disarms it
  (the finger is choosing a word); once it fires, further moves are ignored until release so
  jitter cannot snap back to one word. See § Sentence Explain.
- The overlay suppresses the browser's own long-press `contextmenu` (the "right click"
  menu), since it owns that gesture. On desktop (no
overlay) clicking a word selects it (`selectRange`), mirroring a click placing the caret;
the view's `mousedown` `preventDefault` keeps the textarea's focus so the blur → refocus loop
cannot restore the old range over the click.

In SENTENCE MODE the Pinyin view paints the sentence itself (`selectedSentence` → the
paragraph's `sentence` prop): every cell in range gets the selection colour as a CPCDRow item
`highlight`, joined into one box — below a search match or alternative in precedence. A desktop
**double-click** on a word selects its sentence (`handleDoubleClick` → `onSelectSentenceAtOffset`).

Known limits: the account-level `showSegmentSpaces` setting is not read (words sit at
the natural column spacing, with no gap between words).

### Sentence Explain

Highlight a whole sentence, then ask the AI to explain it. Built 2026-11-20 (migration 195).

**Selecting a sentence (SENTENCE MODE).** Mobile: the tap overlay's second-tier long-press
(SENTENCE PRESS, § Display modes). Desktop: a double-click on a word — the Text mode via
`TextArea` `onDoubleClick` → `onSelectSentenceAtOffset`, the Pinyin mode via
`ReaderCpcdView` → `handleDoubleClick`. Both land in `useTextSelection` →
`selectSentenceAtOffset`, which records the sentence (`selectedSentence`, a ref + state) BEFORE
selecting its range, so the selection's own `recordSelection` keeps the mode.
- Sentence boundaries: `readerSentences.ts` → `splitSentences` — `。！？!?．｡`, an ASCII `.`
  before whitespace / a closer / the end, and every newline. Closing quotes and stacked marks
  stay with their sentence (他说：“真的吗？！”). Commas, colons, semicolons, `、`, `……` and `——`
  do not break — the sentence subset of the read-aloud clause rules (`readAloudClauses.ts`).
  Tests: `src/__tests__/readerSentences.test.ts`.
- The highlight: the Text mode's own textarea selection covers the sentence; the Pinyin mode
  paints it (§ Display modes).
- **Leaving:** any other selection ends the mode (`recordSelection` drops a sentence whose
  range no longer matches). A **forward** tap lands on the sentence's FIRST word (`TextArea`
  parks the caret at the sentence start before `selectRelativeSpan`); a **back** tap on the
  word before the sentence. A long-press on empty space (`clearSelection`) also clears it.

**The keycap in SENTENCE MODE.** `VocabDisplayCard` `customFace` → `ReaderSentenceFace`: only
the **Explain** key, top right — `ReaderKeycapButton` (the More Info key's recipe) with the
orange AI sparkle (`AutoAwesome`, `COLORS.aiGenerated`) before its label. Nothing else shows
before the tap (sentence content for this face is deferred — DEFERRED_WORK.md). Tapping it
(`useSentenceExplanation` → `explain` → `src/api/sentenceExplanation.ts`) shows "Explaining…",
then the answer as `LongDefinitionDisplay` — the longdef style, embedded Chinese as inline cpcd
with tap popups driven by the model's citations. The key is disabled while the request is in
flight and removed (with its header row) once the answer shows. The key is withheld for a selection over
`EXPLAIN_SENTENCE_MAX_LENGTH` (300) and for non-zh documents, with a one-line notice instead.
A new sentence resets the face and aborts an in-flight request; answers already received this
visit are remembered client-side (`sessionAnswers`).

**Server** (`SentenceExplanationService.explainSentence`):
1. **Cache first** — `sentence_explanation_cache` (migration 195), keyed by
   (`userId`, `sentence`, `language`, `promptVersion`). **Per user**: the explanation is
   tailored to the learner, so it is never shared. **No expiry** (owner's call 2026-11-20),
   even though the learner's mastery moves on. Bumping `SENTENCE_EXPLAIN_PROMPT_VERSION`
   regenerates on the next ask; old rows are kept.
2. **Budget** — a miss spends one call of the shared per-user daily AI budget
   (`dictionary_ai_usage`, `DICTIONARY_AI_DAILY_LIMIT`, the same as the dictionary AI fallback
   and Compare) through the `DICT_AI_API_KEY` client (`services/anthropicClient.ts` →
   `getDictAiClient`). Over budget → 429 with a user-facing message the face shows.
3. **Grounding** — the sentence is gsa-segmented against det (`segmentWithDict`), and each
   distinct Han word goes to the model with its pinyin, first 4 definitions and the learner's
   **core utcm band** (`computeCoreCategory` over the card's `typedMarkHistory`, read with
   `IVocabEntryDAL.bulkFindByKeys`; "not in their cards" otherwise), plus the learner's level
   (`StarterPacksService.estimateLevel`, 1–6).
4. **Prompt** — explain what the dictionary entries cannot (grammar patterns, constructions,
   particles, idioms, unusual senses, implied meaning); when there is little of that, walk
   through how the sentence fits together (the learner may be new to reading); explain
   grammar words the learner has not mastered, or all of them at level 1–2. 60–180 words,
   plain text, ≤ 2 paragraphs.
5. **Call** — Claude Opus 5.5, `effort: medium`, structured output `{ paragraph, citations }`
   (the Compare envelope, parsed by `DictionaryService.parseComparisonResponse`). A refusal
   or truncated answer is counted against the budget but not cached. The longdef parts are
   computed per serve (`enrichLongDefinitionMetadataBatch`), never stored.

zh only — an `es` request returns the empty result (Spanish is paused).

### Read aloud

Code: `ReaderReadAloudButton.tsx`; `useReaderReadAloud.ts` → `useReaderReadAloud`,
`learnedMsPerUnit`, `CLIP_LEAD_MS` / `CLIP_TAIL_MS`, `PREFETCH_AHEAD`;
`readAloudClauses.ts` → `buildReadAloudClauses`, `MAX_CLAUSE_CHARS`, `classifySpanVoices`,
`splitVoiceRuns`, `GLUED_LETTERS_MAX`; `useReaderReadAloud.ts` → `documentTTSLang`;
`ReaderDocumentPage.tsx` → `readAloud`, `.reader-read-aloud-stop-shield`;
`useReaderWordActions.ts` → `suspendLearningStatus`; `useTTS.ts` → `speakSentence`
(`options.onStart`, `options.lang`), `prefetchSentence` (`lang`). Tests: `src/__tests__/readAloudClauses.test.ts`.

The **Read** pill (read-aloud) at the display strip's left edge reads the document aloud **from the
caret**, starting at the word the caret is on. If nothing is selected yet, it reads from the
top, and a caret after the last word also reads from the top. It works in both display modes
and is hidden while editing. While it plays, the pill turns `bluM` and reads **Stop**.

- **One clip per clause.** `buildReadAloudClauses` cuts the text at 。！？，：；!?; and
  newlines, and at ASCII `.` `,` `:` only when followed by whitespace, so 3.5, 1,000 and 10:30
  stay whole. A run of break marks and closing quotes stays with the clause before it. **、,
  —— and … do not split** (owner's call 2026-11-17): a list reads as one phrase. A clause
  with no word is skipped. A clause longer than `MAX_CLAUSE_CHARS` (120; the server caps TTS
  text at 200) is cut at a word boundary. Each clause carries the pinyin hint built from the
  Pinyin mode's map (zh only; dropped if any Han word lacks one). The next
  `PREFETCH_AHEAD` (2) clauses are synthesized ahead, so there is no gap between clips.
- **The document's language, and English words in English.** Clips are read in the
  document's language (`documentTTSLang`: zh → `zh-CN`), not the study language. Other
  languages still fall back to the study language (Spanish is paused). In a **zh document**
  a clause is cut further into **voice runs**, each its own clip
  (`ReadAloudClause.voice`), so English words get the English voice (`en-US`) instead of
  the Chinese one with its accent: "我昨天买了 iPhone 15，" → 我昨天买了 · iPhone 15，.
  `classifySpanVoices` rules: a Latin-letter word is English, except one of at most
  `GLUED_LETTERS_MAX` (2) letters touching a Han character (T恤, A股, 卡拉OK); a bare number
  is English only straight after an English word (iPhone 15), so 3个 and 2024年 stay Chinese.
  Punctuation between runs stays with the run before. Where two runs meet with NO
  punctuation between them (a **seam**, `ReadAloudClause.joinsPrevious` / `joinsNext`), the
  synthesized edge silence on that side of both clips is trimmed (`TTSRequest.trimSilence`,
  docs/AUDIO_PLAYBACK.md § 3c), so the switch is not heard as a ~350 ms pause; a run boundary
  with a comma keeps its pause. The highlight's lead/tail margin shrinks to
  `TRIMMED_EDGE_MS` on a trimmed edge. An English run has no pinyin hint and
  does not feed `learnedMsPerUnit`. The male/female Narration voice applies to both
  languages (server `TTSService` → `voiceForLang`). A voice switch is heard as a second
  speaker, and the sentence's intonation restarts at it.
- **The highlight follows the audio.** It moves word by word, and the word in the selection
  is the current word, not a separate highlight (owner's call 2026-11-17). Each word is
  selected through `useTextSelection.selectRange`, as a tap would select it, so the keycap
  shows the word being heard and the Pinyin view paints and scrolls to it. The text mode
  scrolls the textarea with `scrollSelectionIntoView`. Which **clause** is playing is
  exact: one clause is one clip, and the next clip starts only when the last one ends, so
  the page never drifts out of sync. The **word** inside a clause is estimated: when the
  clip starts, the provider reports its real length (`TTSRequest.onStart`,
  docs/AUDIO_PLAYBACK.md § 3c). Each word starts at its share of that length, weighted by
  syllables (Han character 1, digit 1, Latin letter ⅓, punctuation ½ as a pause), inside
  the clip minus `CLIP_LEAD_MS` / `CLIP_TAIL_MS` of edge silence. Those constants were
  tuned by ear. An estimate error stays inside one clause.
  When the browser-voice fallback plays (no duration), the clause is paced on
  `learnedMsPerUnit`, the session's running average of cloud-clip speaking speed (default
  250 ms per syllable).
- **Any tap stops it AND still does its job; scrolling does not stop it** (owner's call
  2026-11-17, replacing the old swallow-the-tap stop shield). While playing,
  window capture-phase listeners (`useReaderReadAloud` → ANY INPUT STOPS IT) stop the
  reading on a touch tap's pointerup (moved ≤ `TAP_SLOP_PX`), on a mouse pointerdown (so a
  desktop click on the textarea is not overwritten by the run), or on any key press, and
  swallow nothing: the input then reaches its target. A tap on the text steps from the word
  being read (ReaderTapOverlay), the keycap's speaker speaks, More Info opens the eip, the
  chip and the switch switch. The **Read/Stop pill** is exempt (`READ_ALOUD_CONTROL_ATTR`
  on `ReaderReadAloudButton`) and stops through its own onClick: stopping first would turn
  it back into "Read" before its click lands, and the click would restart the reading.
  A touch drag (past 10 px, scrolled by ReaderTapOverlay) or a mouse wheel keeps reading;
  the view then stops following the read word until `FOLLOW_RESUME_MS` (3 s) after the last
  scroll (`useReaderReadAloud` → `noteManualScroll` / `isFollowPaused`, also honoured by
  `ReaderCpcdView`'s keep-in-view effect). An arrow key likewise stops it and moves on
  from the word that was being read. The caret stays on the **estimated current word** (owner's call 2026-11-17). A clip that never
  starts (no `onStart`) ends the run instead of racing through the document in silence.
  Unmounting the page or changing the content also stops it, and so does **backgrounding
  the app** — switching apps, locking the screen, hiding the tab (`useBackgroundPause`,
  `src/games/runtime/useBackgroundPause.ts`: `visibilitychange` + iOS `pagehide`). Stopping is
  the pause: the caret stays on the word being read, so Read resumes from there.
- **Mute does not silence it.** Pressing play is a manual press (`speakSentence`), so it
  speaks on Mute like every speaker button (docs/AUDIO_PLAYBACK.md § 4). The route
  (default or media) comes from the strip's audio chip (§ Tap-to-hear), the Voice from the
  narration settings.
- **The keycap's Add key stands down while reading** (`suspendLearningStatus`). Its
  per-word status fetch would otherwise fire about 4 times a second. The key reappears on
  the word where reading stopped.

### Tap-to-hear

Code: `useReaderAudioSettings.ts` → `useReaderAudioSettings`; `src/components/AudioModeChip.tsx`
→ `ReaderAudioChip`; `useReadingKeycap.tsx` → `tapToHearRef` (the TAP-TO-HEAR effect);
`ReaderDocumentPage.tsx` → `searchFieldFocused`, `.reader-document-display-strip__audio`; `useReaderWordActions.ts` → `autoSpeakSelected`;
`src/hooks/useTTS.ts` → `surfaceAutoSpeak`; `src/services/tts/CloudTTSProvider.ts` →
`setRouteOverride`, `effectiveRoute`.

The display strip's audio chip, next to the Read pill, is the app-wide audio chip's skin
(same glyphs, labels and cycle order: **mute → default → media**) bound to a **separate
setting** (owner's call 2026-11-17), because "speak each word I move to" is a different
behaviour from the flp's card-flip narration. Its ink is the look's primary `look.ink`, the
Read pill's text ink (`readerStyles.ts` → `readerPillButtonSx`), rather than the secondary
`ink2` the app's other audio chips use, so the two neighbours letter alike (2026-11-18).

- **default / media** — moving the selection to a new word speaks it, as if the keycap's
  speaker were pressed. An English word speaks its Chinese translation, the keycap's word.
  A word with no entry speaks nothing.
- **mute** — tapping plays nothing. The keycap speaker and Read still speak.
- Stored **per device** (`localStorage` `reader.audio`, `{ autoplay, route }` like
  `tts.settings`, so mute → on restores the route). Default: **default** (autoplay on,
  passthrough). **Shared with the cyoa story page**, whose header shows the same chip over
  the same hook (docs/CYOA_FEATURE.md § 3.1): muting either mutes both.
- **The route is the page's.** While the document page is mounted, the chip's route
  outranks the app-wide one for every clip the page plays (tap-to-hear, the keycap speaker,
  Read) through `CloudTTSProvider.setRouteOverride`, released on unmount (docs/AUDIO_PLAYBACK.md
  § 5). The app-wide autoplay flag does not gate tap-to-hear (`useTTS` trigger `'surface'`);
  the media-mode fallback rule still applies.
- Fires on a change of the selection **range** only. Re-renders, the blur → refocus loop and
  closing the eip restore the same range and stay silent. A document opens with nothing
  selected, so the first sound is the learner's first tap. Silent while Read is stepping the
  selection and in edit mode. Tapping the chip never makes a sound; muting cuts off a word
  mid-clip.

**Preloading** (`useReaderAudioPreload.ts` → `useReaderAudioPreload`; `src/api/tts.ts` →
`prewarmTtsClips`; `server/controllers/TTSController.ts` → `prewarm`;
`server/services/CardAudioService.ts` → `prewarmClips`). An unheard word otherwise costs a
round trip to our server plus, the first time anyone plays it, a Google synthesis. Two
layers, both only while the chip is not on mute and not editing, both standing down while
Read plays:

- **Server pre-warm on open.** Every distinct keycap word of the document (each gsa span
  resolved like the keycap: det row, else English translation) goes once, in document order,
  to `POST /api/tts/prewarm`. It answers 202 at once and synthesizes the misses to the disk
  cache in the background, 4 at a time (`PREWARM_CLIP_CONCURRENCY`; max 600 clips of ≤ 20
  chars per call). Words resolved later (the English lookup) go as a follow-up batch; a ref
  stops anything going twice. Default voice only.
- **Neighbour prefetch per move.** Landing on a word fetches the next 3 and the previous 1
  word into the browser (`useTTS().prefetch`), so tapping forward or back plays at once.

Both send the pinyin `useTTS().speak` would (`resolveDisplayPronunciation` on the adapted
entry), so the warmed clip is the one played. `TTSService.synthesize` joins a request to an
in-flight synthesis of the same clip (`inFlightSyntheses`), so a pre-warm racing a tap pays
Google once.

### Search

Code: `ReaderSearchKey.tsx`, `ReaderSearchBar.tsx`, `useReaderSearch.ts`,
`readerSearch.ts` (`findReaderMatches`, `findTextMatches`, `findPinyinMatches`,
`buildDocumentSyllables`), `ReaderSearchHighlights.tsx`; `ReaderCpcdView.tsx` → "Search
highlights"; `src/components/CPCDRow.tsx` → `CPCDRowItem.highlight`;
`src/utils/textareaMirror.ts` → `copyTextareaTypography`; `useTextSelection.ts` →
`selectRange` (`focus: false`), `recordSelection`, `getRecordedSelection`; `readerStyles.ts` → `readerSearchColors`;
`ReaderDocumentPage.tsx` → the SEARCH comment, `searchColors`,
`.reader-document-display-strip` `onMouseDown`.
Tests: `__tests__/readerSearch.test.ts`.

Find-in-document, like a browser's find.

- **Entry.** A round search key on the display strip, between Read and the audio chip.
  It opens into a bar that covers the whole strip: `[🔍 field  2/7] [˄] [˅] [✕]`. The
  bar grows out of the key with a clip-path animation. The strip's other controls stay
  laid out but hidden underneath, so the row keeps its height. Pressing Edit closes the
  bar.
- **Matching** (`readerSearch.ts`). Every match is a range of content offsets.
  - *Text*: the query is matched literally (case-insensitive for Latin letters) and
    without overlaps.
  - *Pinyin* (Pinyin display mode of a Chinese document only; placeholder "Find text or
    pinyin"): the query is also matched against the reading **drawn** under each
    character. That reading includes 一/不 sandhi, built by `buildDocumentSyllables` the
    same way `ReaderCpcdView → buildParagraphs` builds it. Tones are optional: `hao`
    matches any tone, while a tone mark (`hǎo`) or a digit (`hao3`; `5` = neutral) fixes
    that syllable's tone. Spaces and apostrophes are ignored; `ü`, `v` and `u:` count as
    one letter. A match must start at the start of a syllable, but it can end inside
    one, so typing `h` → `ha` → `hao` keeps finding results. A match never crosses a
    non-Chinese character. Text and pinyin matches are merged in position order, and
    where two overlap the earlier one wins.
- **Current match = the selection** (owner's call 2026-11-18). Typing jumps to the first
  match at or after the caret (wrapping round to the first match if none). ˄/˅ (or
  Enter / Shift+Enter) move through the matches and wrap at both ends. Each move
  **selects** the match with `selectRange(…, { focus: false })`, so the keycap shows that
  text (a match can be part of a word, e.g. 好 inside 你好) and Read starts from it,
  while focus stays in the search field and its keyboard stays up. While the reading box
  is unfocused, an unfocused `selectRange` only **records** the range
  (`useTextSelection` → `recordSelection`). It never calls the textarea's
  `setSelectionRange`, because iOS WebKit focuses a textarea on that call, which would
  pull focus out of the field and unfold the rdb on every step. Readers of the range
  use `selectionRange` / `getRecordedSelection` (the search anchor) or pass it in
  (`scrollSelectionIntoView(textarea, range)`). Closing the bar (✕ or Escape) refocuses
  the reading box, and `focusTextArea(true)` applies the recorded match. It then widens
  the selection to the gsa word containing the match's start
  (`ReaderDocumentPage` → `handleCloseSearch` → `selectSpanAtOffset`), because a match can
  be part of a word or run across several, and only an exact span highlights in the Pinyin
  view. A match that starts on punctuation keeps its own range. Tap-to-hear stays silent while
  the field has focus, because otherwise every keystroke would speak.
- **Highlights** (`readerSearchColors`). Translucent washes of `COLORS.yelMk`, built like
  the blue word selection (`selectionColors` → `readerSelectionColor`: primary blue at ~19% by day, the brighter `COLORS.bluMk` mark tier at 40% at night)
  so the two read as one family. A match is ~28–30% and the current match ~55–60%,
  because yellow is much lighter than the blue. The text keeps its own ink underneath.
  - *Text mode*: a `<textarea>` cannot style ranges, so `ReaderSearchHighlights` lays a
    mirror div over it. The mirror copies the textarea's typography and client box, and
    a `ResizeObserver` plus a scroll listener keep it in sync. All its text is
    transparent, and each match is a `<mark>` whose wash lies over the textarea's own
    glyphs. It can't go behind them, because the textarea paints an opaque surface. It
    ignores pointer events. The current match scrolls into view
    with `scrollSelectionIntoView`.
  - *Pinyin mode*: highlights are painted per **cell** (`CPCDRowItem.highlight`: the glyph
    plus its pinyin band) rather than per word group, because a match can cover part of a
    word or run across several. Each paragraph item records the content range it draws
    (`ReaderParagraph.offsets`). The wash is a `::before` behind the glyph. When the
    neighbouring cell is in the same match (`joinLeft` / `joinRight`), that side is
    squared off and meets the neighbour's fill at the middle of the cells' overlap. A
    match over several cells or words (`ni hao`) therefore reads as one box, with no
    double-painted strip. The current match's first cell is kept in view.
- **Keyboard.** The field uses the app's default keyboard (the beginner keyboard for zh;
  its ABC key switches to the OS keyboard). While the search keyboard is up, the lead
  (title block and keycap/rdb) folds away and the text box ends at the keyboard
  (§ Keyboard lift). The display strip stays, because it holds the bar. A tap on the
  reading area while the field has focus first gives focus back to the reading box
  (`handleTapRegionPointerDown`), so the tap moves on from the current match and the
  keycap follows. The bar and its highlights stay open. A press anywhere else on the strip
  (between the bar's keys, or on its padding) keeps focus where it is, through the
  strip's `onMouseDown` preventDefault (as with the edit toolbar). The keyboard therefore
  stays up and the rdb doesn't drop back down. The beginner keyboard has a second way to
  close: it dismisses itself on **any pointerdown** outside its allow-list
  (`BeginnerKeyboardProvider` → `onPointerDown`). So `.reader-search-bar` is a
  `data-beginner-keyboard="keep"` region, and its keys, gaps and field never close it.
  A tap on the strip's bottom padding, outside the bar, still does.

### List views

Code: `useReaderListView.ts` → `useReaderListView`, `ReaderListView`; `ReaderPage.tsx` →
`pendingDelete`, `handleConfirmedDelete`; `ReaderListToolbar.tsx` → `.reader-page__view-toggle`;
`TextSidebar.tsx` → `view`; `ReaderDocumentGrid.tsx`.

`/reader` draws its documents one of two ways, under the same selector and toolbar.
The toolbar's right-most icon (§ List toolbar) switches between them. Its glyph
names the view a tap switches *to*: `view_list` in the grid, `grid_view` in the list. The
choice is saved **per device** (localStorage `reader.listView`, like `reader.displayMode`).
An unset or unknown value means the grid.

- **Grid (default)** — `ReaderDocumentGrid`: a 2-column CSS grid with the Bento's gutters
  (16px sides, 10px gap), so its two columns line up with the Documents / Journal tiles. Each card is a
  **4:5 portrait** cell (`aspectRatio: 4 / 5`; 2:3 and A4 read too tall), with the icon and title centred vertically. Each card has
  the `Row`'s flat skin (white, `rowBorder` hairline, 16px radius, no rounded edge because
  it isn't raised). The document's icon sits centred in a 64px pastel tile (`RAMP[hue].mid` +
  `markOutline` ring; yellow for a journal entry, blue for your own documents, grey for
  built-ins — `readerDocumentHue`). A card without `iconId` shows the fallback glyph
  (`readerDocumentGlyph`: `auto_stories` / `description` / `menu_book`). A journal entry's
  card adds its `createdAt` date (`formatJournalDate`, e.g. "Tue, Nov 17, 2026") under the
  title; in the list view the same date is the row's subtitle. The title sits below the tile, centred, and wraps
  to two lines before an ellipsis. Your own documents carry a **⋯** button in the top-right
  corner (a sibling of the card's button, not nested inside it). It opens a one-item menu,
  **Delete**, which opens `DeleteDocumentDialog` (§ Deleting a document). Built-in texts
  have no ⋯.
- **List** — the `RowList` of `Row`s with swipe-to-delete, described in § Look and
  § Deleting a document.

Neither view renames; renaming happens in the open document's edit mode (§ Editing).

### Collections (Documents / Journal)

Code: `ReaderCollectionTiles.tsx`; `src/components/bento/toggleTileSx.ts` → `toggleTileSx`;
`readerListOrder.ts` → `ReaderCollection`, `READER_COLLECTION_ORDER`, `filterByCollection`;
`useReaderCollection.ts`; `ReaderPage.tsx` → `handleSelectCollection`, `visibleTexts`,
`handleCreateNew`; `TextSidebar.tsx` → `collection`, `slideFrom`, `EMPTY_MESSAGE`;
`readerPaths.ts` → `newDocumentPath`; `ReaderDocumentPage.tsx` → `draftKind`, `blankDraft`;
server: `TextController.createText` / `TextService.createText` (`kind`, validated against
`TEXT_KINDS` in `server/contracts/wire.ts`); migration 194.

The top of `/reader` is a 2-up row of `compact` Bento tiles (the default 2-column `Bento`,
the Friends tab's action-tile shape):

| Tile | Hue | Role |
|---|---|---|
| **Documents** | `pur` | press to show only `kind = 'document'` (built-in texts included) |
| **Journal** | `yel` | press to show only `kind = 'journal'` |

Documents and Journal are plain **switch buttons**: pressing one shows that collection
(**Documents by default**; pressing the current one does nothing). Neither tile shows a
selected state — both always rest at their MID fill (owner, 2026-11-17: no Friends-style
two-state look). They borrow only the shared press feel (`toggleTileSx` with
`dimmed = false`: a press sinks the tile to `scale(0.76)` and it springs back). There is no
"everything" view (a stored `all` from the first build reads as Documents). Changing the selection slides the list body in from the
side of the new position (Documents 0 · Journal 1), as Friends' views
do; reduced motion skips the slide. The selection persists per device
(`reader.collection`).

A **journal entry** is an ordinary document in every other respect (same editor, reading
view, icon, delete). It is created by tapping the toolbar's pill while Journal is selected (it then reads **New
entry** and opens `/reader/new?kind=journal`); the draft's
`?kind=journal` is sent as `kind` on the first Save and is fixed afterwards (there is no
"move to journal" yet). Its date is its `createdAt`.

### List toolbar

Code: `ReaderListToolbar.tsx` (`TOOLBAR_CONTROL_PX`); `ReaderSortMenu.tsx`; `ReaderPage.tsx`.

One row under the selector, on the 16px gutters: **New document** on the left — a blue
filled pill (`readerPillButtonSx(COLORS.bluM)`, text only; "New entry" while
Journal is selected) — and on the right the **sort** menu then the **grid ⇄ list** toggle,
both the `outlined` `HeaderIconButton` skin (36px box with the --line2 ring; off the header
a button needs its own edge). Every control is 36px tall. The page header carries no
actions. (Until 2026-11-17 sort and view were header icons and New document a Bento tile.)

### Sorting

Code: `ReaderSortMenu.tsx`; `readerListOrder.ts` → `READER_SORT_OPTIONS`, `sortTexts`;
`useReaderListSort.ts`; `ReaderPage.tsx` → `visibleTexts`; `TextDAL.updateFields` (stamps
`updatedAt`).

A `sort` icon sits in the list toolbar left of the grid/list toggle and opens a flat menu
(`readerMenuPaperSx`); the current order wears a check. Sorting is client-side over the
already-fetched list, after the collection filter:

| Option | Order |
|---|---|
| Newest first (default) | `createdAt` desc — the server's own order |
| Oldest first | `createdAt` asc |
| Title A–Z | `localeCompare` in the document's language (zh: pinyin collation) |
| Recently edited | `updatedAt` desc (any save, including an icon change, counts) |
| Longest first | `characterCount` desc |

Every key breaks ties newest-first. The choice persists per device (`reader.listSort`).

### Creating a document

Code: `ReaderListToolbar.tsx` (New document pill) → `ReaderPage.tsx` → `handleCreateNew`;
`ReaderDocumentPage.tsx` → `blankDraft`, `saveNewDraft`, `handleCancelEdit`.

There is no create dialog. **New document** navigates to `/reader/new`, which
`ReaderDocumentPage` opens as an in-memory blank draft, **already in edit mode**
(the editable textarea focuses itself, raising the keyboard). Nothing exists
server-side yet:

- **Save** is disabled while the draft is blank. The first Save `POST`s
  `{ content, language, iconId, kind }` (`kind` from `?kind=`, § Collections), processes the new document's vocabulary, leaves edit
  mode and `replace`-navigates to `/reader/<new id>`, so Back returns to the list
  rather than to an empty draft. `justCreatedIdRef` stops the fetch effect from
  reloading the document it already holds after the URL change.
- **Cancel** (or the back arrow) on a draft just returns to `/reader`. No server
  record exists, so there is nothing to clean up and no empty documents pile up.

### Editing

Editing happens only inside the open document: the header's Edit toggles the inline
editor. List rows have no Edit.

#### Renaming (the editable header title)

Code: `src/components/PageHeader.tsx` → `editableTitle` / `PageHeaderEditableTitle`,
`EditableTitleRow`, `.page-header__title-input`; `NodePageHeader.tsx` and
`ReaderDocumentSurface.tsx` → the `editableTitle` passthrough; `ReaderDocumentPage.tsx` →
`draftTitle`, `titleToSave`; server: `TextService` → `normalizeTitle`;
`server/contracts/wire.ts` → `DOCUMENT_TITLE_MAX_LENGTH`.

- While the editor is open, the header title is a **text field** in the title's own type
  style, with a `look.outline` hairline under it. Tapping anywhere in the title band places
  the caret; the back arrow stays a separate button (in reading mode the arrow and title
  are one back-button group, so the field is split out of it). Enter closes the keyboard.
- The title is part of the edit **draft**, like the icon: seeded from the saved title on
  Edit (with `""` on a new draft), sent with Save, dropped by Cancel, not on undo/redo.
- **Blank field**: the placeholder shows the saved title (a new draft's "New Document"),
  and Save sends no title — a saved document keeps its title, a new draft's is derived
  from the content (§ Title derivation). An unchanged title is not sent either.
- The server normalizes a typed title (create or rename): control characters stripped,
  whitespace runs (newlines included) collapsed to one space, trimmed; blank or longer
  than `DOCUMENT_TITLE_MAX_LENGTH` (200) is a 400.

Neither the list nor the open document shows the character count or the creation
date (removed 2026-11-05); `characterCount` and `createdAt` are still on the wire.

#### Document icon

Code: `ReaderEditToolbar.tsx` → the `iconId` / `onPickIcon` props and
`.reader-edit-toolbar__icon-button`; `ReaderDocumentPage.tsx` → the DOCUMENT ICON comment,
`draftIconId`, `iconPickerOpen`, the `IconPickerDialog` mount; `src/components/IconPickerDialog.tsx`;
`TextSidebar.tsx` → `iconSrc` on the row; `ReaderDocumentGrid.tsx` → `.reader-document-grid__icon-image`; `src/components/primitives/Row.tsx` → `iconSrc`;
server: `TextService` → `validateIconId`, `TextDAL.insertUserText` / `updateFields`.

- **Picking.** In edit mode the toolbar shows a 32px outlined square after undo/redo. It
  holds a 22px preview of the draft icon, or a muted `add_photo_alternate` glyph when
  there is none. Tapping it opens the shared `IconPickerDialog` (the avatar picker's
  browser: an empty search lists cached icons, typing searches icons8). The dialog
  caches the icon (`ensureIcon8`) before it hands the id over, so the id always satisfies
  the FK. **Remove icon** clears it.
- **Draft semantics.** The icon is part of the edit draft, like the content. It is seeded
  from `text.iconId` on Edit (null for a new draft), sent with Save (`POST` for a new
  draft, `PUT` otherwise, always with `iconId`, so `null` clears it), and dropped by Cancel.
  It is **not** on the undo/redo stack: that history is the text's typing bursts.
- **Display.** The `/reader` grid card's 64px tile and the list row's 36px avatar show the icon (`Row`'s `iconSrc`)
  on the document's blue fill, in place of the `description` glyph. Documents without an
  icon keep the glyph. The document page itself does not show it outside edit mode.
- **Validation.** `TextService.validateIconId` checks shape only (a string of 1–64
  characters, or null). Existence is the FK's job, so a bogus id fails the write with
  a 500 rather than a 400.

### Deleting a document

Code: `SwipeToDeleteRow.tsx`; `TextSidebar.tsx` → `openRowId`; `ReaderPage.tsx` →
`handleDelete`, `handleConfirmedDelete`; `ReaderDocumentGrid.tsx` → the ⋯ menu;
`DeleteDocumentDialog.tsx`.

- **List view (`/reader`)** — iPhone style. Drag a row left to slide it aside and uncover
  a **Delete** button (80px, `DELETE_BUTTON_WIDTH_PX`) behind its right edge. Releasing
  past half that width leaves the row open; otherwise it springs shut. Only one row is
  open at a time, and tapping an open row closes it rather than opening the document.
  The row uses `touchAction: pan-y` and locks to an axis after 8px, so vertical drags
  still scroll the list. Tapping **Delete** deletes immediately, with no confirmation:
  the row leaves the list at once, and if `DELETE /api/texts/:id` fails it is put back
  and an error line shows above the list. Only `isUserCreated` rows can be swiped.
- **Grid (`/reader`)** — a card's ⋯ menu → **Delete** opens `DeleteDocumentDialog`
  (a confirmation, unlike the swipe). The dialog sends the `DELETE` itself and shows any
  failure inline. On success `ReaderPage.handleConfirmedDelete` drops the card.
- **Open document** — the header's trash icon opens `DeleteDocumentDialog`
  (a confirmation), then returns to the list.

#### Keyboard lift

Code: `ReaderDocumentPage.tsx` → the KEYBOARD LIFT comment, `liftKeyboardInset`,
`keyboardLifted`, `.reader-document-lead`, `.reader-document-strip-fold`; `src/features/beginnerKeyboard` → `useKeyboardInset`,
`transitionForInset`, `BEGINNER_KEYBOARD_SLIDE_MS`, `BEGINNER_KEYBOARD_EASING`.

While editing with a keyboard up (the handwriting keyboard or the OS keyboard,
whichever `useKeyboardInset` reports), the title block and the vocab card fold away
(a `Collapse`), so the text box rises to sit directly under the edit toolbar, and the
content area adds the keyboard's height to its bottom padding, so the box ends at the
keyboard's top edge. Both use the keyboard's own slide durations and curves: the box
goes up as the keyboard rises and comes back down as it leaves. Reduced motion snaps both.

The search field's keyboard (§ Search) lifts the page too (`liftKeyboardInset`). Here the
lead follows the keyboard, folding when it rises and unfolding when it leaves. The display
strip has its own `Collapse` (`.reader-document-strip-fold`, closed only in edit mode), so
the search bar stays above the text box.

In edit mode the fold is held shut for the whole session, keyboard up or not: the lead
(title block + vocab card / rdb) and the display strip (every control in it is hidden
while editing) stay folded until Save/Cancel, so dismissing the keyboard mid-edit only
releases the bottom keyboard clearance — the text box grows down, the rdb does not come
back. Only search (the strip stays; the lead folds) is keyed purely on the inset.

#### Comfortable caret scroll

Code: `src/hooks/useComfortableCaretScroll.ts` → `useComfortableCaretScroll`,
`settleCaretComfortably`, `CARET_COMFORT_LINE`; `TextArea.tsx` → `EDIT_TAIL_SPACE`;
`src/utils/textareaMirror.ts` → `measureTextareaRange`.

While writing in edit mode, the line being written is held no lower than
`CARET_COMFORT_LINE` (60%) of the text box, so there is always clear space below it and
the text just written stays readable above. The browser's own reveal would leave the
caret on the last visible line, pressed against the keyboard. The rule runs after each
change to the draft (typing, paste, the beginner keyboard's inserts) and when the box
resizes, so the line rides up with the keyboard as the lift shrinks the box, and whenever
the caret is placed (a tap into the text or within it, arrow keys — `focusin` /
`selectionchange`, one settle per frame), so a tap on a low line with the keyboard
already up still lifts that line clear of it (owner's ask 2026-11-21). Writing is settled
twice — at once and again on the next frame — and the focused field's own size is observed,
because on a phone layout can still move after React's commit (owner's report 2026-11-21:
the passage body "doesnt scroll until i exit the text box and re-edit"). While writing (the
value just changed, or an IME is composing) a selection counts as the caret, measured at
its end, since a phone keyboard's composing text can show as one. A caret
already in the upper band is not touched, so re-reading or editing earlier text does not
jitter. The hook never reads the keyboard itself: the keyboard lift above already ends the
box at the keyboard's top edge. To reach the comfort line at the END of a document, the
edit-mode textarea has `EDIT_TAIL_SPACE` (40vh) of bottom padding as run-out below the last
line. The same hook drives the cyoa passage editor (docs/CYOA_FEATURE.md § 5.1), where it
serves every text field in the scrolling column rather than one textarea.

The edit toolbar never takes focus (`ReaderEditToolbar.tsx` → the root's `onMouseDown`
`preventDefault`, the beginner keyboard's `keepFocus` guard). Without it, a tap on the
toolbar (a button or the empty strip) blurred the field and the keyboard dropped.
The edit-mode hold above is the backstop: touch taps can still blur the field on some
devices, and the lead stays folded regardless.
