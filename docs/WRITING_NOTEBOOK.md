# Writing Notebook

**Status: BUILT ON DEV (2026-10-06), migration 174 applied on DEV only — not yet on PPE.**
Behind the `writingNotebook` feature flag (ON). zh only.

An endless handwriting practice sheet, one per word. It is a **page, not a game**: no game
framework, no rounds, no score. It is reached from the Writing Center's games belt.

Parent docs: [READING_WRITING_CENTERS.md](./READING_WRITING_CENTERS.md) (the Writing
Center that launches it), [PRACTICE_WRITING.md](./PRACTICE_WRITING.md) (the shared writing
panel and canvas it is built from).

---

## Page anatomy

Route `/flashcards/writing/notebook` — a **leaf** page (footerless, slides up). Back always
returns to the Writing Center, scrolled to the belt and parked on the notebook's card
(`state.returnedFromGame = "writing-notebook"`).

```
┌──────────────────────────────┐
│ ⌄  Writing Notebook   ✎12  ⇄ │  LeafPage header — counter (flame-style) + change-word button
│ ┌───┬───┐                    │  word bar — the writing shadows, 2 per row across the
│ └───┴───┘                    │    sheet's width (2×2 for 3–4 chars); tapping one
│                              │    cycles its stroke aid
│ ┼─┼─┼─┼                      │
│ ┼─┼─┼─┼   …endless…          │  the sheet — 4 touching square cells per row
│        ( ⇊ Next empty )      │  only when the current page is full
└──────────────────────────────┘
```

- **Change-word button.** A bare `HeaderIconButton` in the header's right slot
  (`writing-notebook-page__change-word`): an **add** glyph until a word is chosen, then
  **swap_horiz**. Tapping it opens the word picker. Words are **one to four characters**
  (all-Han; `NOTEBOOK_MAX_WORD_LENGTH`, enforced by the picker and the server).
  - Before any word has ever been chosen the page opens nothing on its own. Later visits
    reopen the most recently opened word, at the top of its sheet.
  - Stays lit but is ignored while a cell is open (a word switch mid-edit would land the
    pending save on the new sheet).
- **Word bar** (`NotebookWordBar`) — renders nothing until a word is chosen; the shadow grid
  sits on the page directly, not inside a button frame.
  - **Writing shadows in replica cells, not cpcd.** Each character is drawn as its writing
    shadow inside an exact replica of a sheet cell (`ShadowCell`): same square, 1px outline,
    white ground and teal 米 guide, the cells touching with one shared hairline, and the
    stroke shapes (`GlyphSvg` corpus, `peekGlyph` / `loadGlyph`) placed exactly where the
    practice canvas places its guide (`guideToCanvas`) in the guide's grey (`COLORS.border`).
    That grey is translucent, so an opaque white copy of the strokes is painted underneath:
    the teal guide is hidden behind the shadow rather than showing through it. That white
    copy is also stroked in white a little past the shadow (`GUIDE_CLEARANCE_RATIO`, 1.5% of
    the cell side, floor `GUIDE_CLEARANCE_MIN_PX`), so the dotted guide stops just short of
    the shadow's edge instead of crowding it.
    **The shadow grid spans exactly the sheet's width, two cells per row:** the bar reads the
    same `notebookGeometry` the sheet does (`gridWidth`, `gridLeft`) off the same full page
    width, so its outer edges line up with the practice grid's below. Each shadow is half that
    width (`CELLS_PER_ROW`); one or two characters make one row, three or four a large **2×2**
    (rows `notebook-word-bar__shadow-row`, sharing a hairline), and a lone third cell is
    centred under the pair. The bar grows to hold the rows. Only the width is measured
    (`NotebookWordBar`), so the cells' height never feeds back into their size. A character
    missing from the corpus shows an empty cell.
  - **Stroke aid.** **Cycled per cell: tapping a shadow cell steps that position
    off → numbers → colored → off** (`strokeAid.ts` → `StrokeAid` / `nextStrokeAid`; each
    cell is its own `role="button"`, `notebook-word-bar__shadow-toggle`, whose aria-label
    speaks the current state — a 3-state cycle has no `aria-pressed`). The state is a map
    owned by the page (`WritingNotebookPage` → `strokeAids` / `cycleStrokeAid`), **keyed by
    the character's index in the word, not the character**: the two 谢 of 谢谢 cycle
    independently. Positions mean nothing across words, so the map belongs to the word it
    was set on (`strokeAidState.word`) and choosing another word starts every shadow off.
    **Deliberately not persisted** — every
    visit opens with every shadow bare (no entry = `"off"`).
    - **Colored** fills stroke *i* with `RAMP[hue].mark` for the six Mark-tier hues in
      a **contrasting order** (`STROKE_HUES`: red, grn, blu, org, pur, yel — tea has no Mark
      tier; the softer Mid tier was tried and read too faint on white), wrapping after six (`strokeColor`). Three of the six jumps on the hue wheel are
      complements, grn→blu is the one near-neighbour pair (chosen deliberately), and the
      palest hue (yel) comes last. The cell's 米 guide turns **grey** in this state
      (`MiGridGuide` `color` = `COLORS.border`, the shadow's own grey), still dotted, so its
      teal never competes with the stroke hues. Its number takes the same hue, **no outline**
      (an ink outline was tried and dropped by design choice; the paler hues, yel especially,
      read weakly on white as a result). Number **positions are identical**
      in the numbers and colored states, so a tap never moves a digit.
    - **Numbers** (also drawn in the colored state): each stroke's
    order number is painted somewhere along its stroke, in plain ink (info type, `FONTS.label`) with no outline. Positions
    are resolved by `strokeNumberPlacement.ts` → `placeStrokeNumbers`, greedy in stroke order
    over a grid of candidate spots. Each stroke is known twice: its centre line (corpus
    median) and its own ink, rasterised once per cell size by `rasterizeGlyphMasks` (one
    summed-area table per stroke, cropped to its bounding box, plus one for the whole shadow).
    - **Hard rule:** a number never covers its own stroke.
    - **Cost**, cheapest wins: each other stroke the number touches (`STROKE_WEIGHT`); share
      of its box on shadow (`INK_WEIGHT`); overlap with numbers already placed
      (near-forbidden); distance to its stroke's centre line; a mild pull toward the
      stroke's start (`HEAD_WEIGHT`); a flat penalty when another stroke's centre line is
      nearer than its own (`AMBIGUITY_COST`); and a **clarity** penalty that rises as the
      most confusable other stroke comes within `CLARITY_MARGIN` type sizes of matching its
      own stroke's distance (`CLARITY_WEIGHT`) — a number between two strokes reads as either's.
    - **Tiebreak:** every spot costing within `TIE_COST` (0.25 type sizes) of the cheapest
      is a tie, and the tie goes to the spot **nearest the stroke's start** (then the cheaper)
      — `pickCandidate`. It spans every search step taken so far, and never depends on the
      order the grid is scanned.
    - **Search steps**, each taken only if the last found nothing clear of the other numbers:
      within **reach** (`REACH`, 1.5 type sizes of the centre line); anywhere in the cell;
      then, only if the hard rule can't be met anywhere, own ink allowed at a heavy cost. So
      a number would rather sit on another stroke beside its own than drift away.
    - Spots outside the cell are never taken. With no 2D canvas (tests) numbers avoid only
      each other and stay nearest their own stroke.
- **Counter** — in the header's right slot, left of the change-word button, drawn in the
  minute-points flame's shape (`FireCount`): one big filled `edit_note` glyph
  (`FIRE_GLYPH_SIZE_PX`) beside a mono 11px count, in ink2 (`COLORS.iconColor`) — the
  orange stays the flame's (`WritingNotebookPage` → `NotebookHeaderCount`). Hidden until a
  word is chosen and its count has loaded. See [Counter](#counter).
- A failed cell save rolls the cell back and shows one status line under the bar.

Code: `src/features/flashcards/writingNotebook/` → `WritingNotebookPage`, `NotebookWordBar`.

---

## Word picker

`NotebookWordPickerSheet` — a modal `SheetPanel` hosting `DictionaryWordSearch`
(`src/components/DictionaryWordSearch.tsx`), which is **the same mini dictionary search the
compare sheet uses**: it was extracted from `CompareWorkspace` when the notebook arrived, so
there is one selector, not two. The sheet's title ("Choose a word") is its only label: the
search's own caps heading is dropped (`heading={null}`). Results are filtered to `isNotebookWord` (all-Han, one to
four characters — the server's own rule). Picking a word unmounts the sheet and opens that word's
sheet (`POST /sheets/open`, which also makes it the word the page reopens on).
Focusing its search field grows the sheet to full height as the keyboard rises (shared
by every paneled dictionary — docs/UX_AND_NAVIGATION.md § "Keyboard and popups").

---

## Cells

- 4 per row (`NOTEBOOK_COLUMNS`), **touching, square-cornered** — a copybook grid. Each
  cell draws its full 1px outline and sits one pixel back over its neighbour, so a shared
  edge is one hairline (`notebookLayout.ts` → `NOTEBOOK_CELL_BORDER`, `notebookGeometry`).
  The page keeps a 16px margin left and right (`NOTEBOOK_SIDE_GUTTER`). A classic
  (non-overlay) scrollbar lives **inside the right margin**, never in the grid's width:
  `NotebookGrid` sizes cells from the scroller's border box (`offsetWidth`, scrollbar
  included) and thins the bar (`scrollbarWidth: "thin"`) so it fits the 16px. This also
  keeps the sheet aligned with the word bar's shadow grid, which uses the same geometry.
- Each carries the **米字格** guide: eight dashed rays drawn out from the centre, in
  `RAMP.tea.mid` (`MiGridGuide`). Dash, gap and line width are in the guide's own 0–100
  units, so the guide **scales with the square**: the 260px canvas shows the cell's guide
  proportionally bigger — except its line width, which the canvas draws a little thinner
  (0.75 vs 1; `NotebookCellEditor` → `GUIDE_LINE_WIDTH`, `MiGridGuide lineWidth`) so the
  scaled-up guide does not read heavy behind the ink. The two diagonals skip their centre dash (a one-dash
  `stroke-dashoffset`), so only the vertical and horizontal dashes meet in the middle.
- A filled cell redraws its stored ink as SVG polylines (`NotebookCell`).
- A cell whose page has not been fetched yet draws its **frame only** (no guide), so it never
  claims to be blank before the server has said so, and it cannot be tapped.
- **Cells are free**: any character of the word may be written in any cell.

Code: `NotebookCell`, `MiGridGuide`.

---

## Canvas

`NotebookCellEditor` — a new, stripped-down writing surface built on the shared
`WritingPanel` (so it grows out of the tapped cell and shrinks back into it with the same
projection morph as every writing rectangle):

- **No header**, no guide glyph, no level, no Clear, no Undo. Because the canvas reaches the
  panel's top edge and the cells are sharp squares, the **top two corners are only lightly
  rounded** (`PANEL_SQUARE_TOP_RADIUS`, 4px; the tools footer keeps the full rounded bottom)
  — `WritingPanel` softens them whenever
  `header` is absent, in both the resting shell and the morph's clip-path
  (`useProjectionMorph` → `restRadius` as per-corner `CornerRadii`).
- **260px canvas** (`notebookLayout.ts` → `NOTEBOOK_CANVAS_SIZE`) — the notebook's own size,
  a little under the shared 300px `WRITING_FOCUS_SIZE`, so it fits beneath the word bar on a
  phone. Stored ink is normalised, so the size can change freely. A sheet cell draws ink at
  the canvas's pen-to-edge share (`NOTEBOOK_INK_RATIO`), so a cell matches the canvas.
- Footer: exactly two tools, **Pen** (7px, `NOTEBOOK_PEN_WIDTH`) and **Eraser** (14px radius),
  one size each (`WritingPanel.tools`).
- The **eraser is partial**: rubbing through a stroke cuts that piece out and splits the
  stroke around it, cutting exactly on the eraser's circle (`inkErase.ts` →
  `eraseDiscFromStroke` / `eraseSweep`; `WritingCanvas tool="eraser"`). The ink stays real
  strokes, so it stays recognisable.
- **Tap outside to finish** (no on-screen label says so). The ink is read, the panel shrinks, and the page saves the cell.
  An unchanged cell is not re-saved. Erasing a cell back to nothing deletes it.
- **Dims only the sheet** — the page header and the full word bar (one row or 2×2) stay lit
  and tappable above the canvas, as the reference (decided 2026-10-06). This is a deliberate
  exception to the app-wide rule that a dim covers the whole screen
  (`src/components/overlayHost.ts`): the editor renders inside the sheet's positioned box
  (`WritingNotebookPage` → `writing-notebook-page__sheet`), not at the frame. Edge-swipe is
  blocked while it is open. The dim is the heavier `COLORS.focusScrim` (62% ink, vs the 45%
  `modalScrim` other writing surfaces use), so the busy sheet of inked cells beneath recedes
  behind the canvas.
- **Compact fallback — short screens only.** When a 3–4 character word's 2×2 leaves the
  sheet shorter than the editor needs (`notebookLayout.ts` → `NOTEBOOK_EDITOR_MIN_HEIGHT`:
  canvas + footer + margin, measured against the sheet's box when the cell opens),
  the editor instead renders one box up (`writing-notebook-page__body`, word bar + sheet)
  and draws the bar **compact** across the top of its overlay (`NotebookWordBar compact`,
  passed as `NotebookCellEditor.topBar`): every character on a single small row, the bar held
  at one full-size cell's height (a cell of the two-per-row layout — the 1–2 character
  size). A 1–2 character word never compacts (`wordBarCompacts`). The compact bar is lit and
  opaque over the 2×2 it replaces.
  - **Tap a small cell to expand it** to full size in place of the row. The bar is already
    that tall, so expanding never resizes it. While expanded, tapping the cell **cycles its
    stroke aid** (the small row's taps expand instead of cycling). The panel ✕
    (`SheetCloseX`) sits in the bar's top-right corner and returns to the row; so does a tap
    anywhere else in the bar (off the full-size cell). Each open of the canvas starts on the
    row.
  - **The switch animates both ways**: the tapped cell FLIPs between its row slot and the
    centred full-size slot (rendered at its true size and animated from the old rect, so it
    is never a scaled blur at rest), while the other characters fade out / back in and the ✕
    fades in. Same duration and easing as the canvas morph (`useProjectionMorph` →
    `PROJECTION_MORPH_MS`, `MORPH_EASING`); skipped under `prefers-reduced-motion`
    (`NotebookWordBar` → `useExpandMorph`).
  - **An empty tap on the small row is tap-out** — tapping the bar's empty space (not a
    cell) closes the canvas exactly like tapping the scrim. The bar stops propagation of
    every tap it acts on (cell taps, expanded-state taps, the ✕); an unclaimed tap bubbles
    to the editor's top-bar slot, which finishes.
  - The compact bar fades in / out with the canvas morph (a `companions` entry), and nothing
    beneath it reflows, so the tapped cell stays exactly where the panel grows out of and
    shrinks back into.

Code: `NotebookCellEditor` (`topBar`), `NotebookWordBar` (`compact`); `src/components/handwriting/WritingCanvas.tsx` (`tool`,
`eraserRadius`), `WritingPanel.tsx` (optional `header`, `tools`), `inkErase.ts`.

---

## Validation (silent)

Every save is validated **on the server** (`WritingNotebookService.saveCell`): the stored
ink is decoded and sent to the handwriting recogniser (`recognizeChinese`, the same Google
proxy the practice popup uses), and the cell is credited to a character of the word **iff
that character is the top-1 candidate** — the app-wide strict rule
([PRACTICE_WRITING.md § Grading](./PRACTICE_WRITING.md)). The verdict (`matchedChar`) is
**never sent to the client**; the only visible effect is the counter.

- Re-editing a cell **re-validates** it and replaces its verdict, so a counter can fall.
- The recogniser runs on the **decoded** (stored) ink, never the raw strokes, so a later
  re-validation judges exactly what is stored.
- Notebook practice posts **no writing marks** — it does not touch mastery or cooldowns. It
  does earn minute points (`MINUTE_POINTS_ELIGIBLE_PAGES`).

---

## Counter

- **Sheet counter** = the minimum, over the word's **distinct** characters, of the cells
  credited to that character (`sheetCount`). 明天 with five 明 and two 天 reads 2; with no
  天 it reads 0. 谢谢 needs only 谢.
- **Belt total** = the sum of every sheet's counter (`GET /summary` → `totalCount`), shown on
  the notebook's belt card.
- Counters are **derived on every read**, never stored, so reopening and closing a cell
  unchanged can never count twice.

Code: `server/contracts/writingNotebook.ts` → `sheetCount`, `distinctChars`;
`WritingNotebookService.getSummary` / `countFor`.

---

## Scrolling, pages and the jump

The sheet is **virtualised**: every row has the same pitch, so the scroller holds one tall
spacer and only the rows near the viewport mount (`notebookLayout.ts` → `mountedRows`). The
spacer always reaches a page past the deepest row seen (`rowCountFor`), so it never ends.

- A **page** is a load chunk of 10 rows / 40 cells (`NOTEBOOK_PAGE_ROWS`,
  `NOTEBOOK_PAGE_SIZE`). Pages are fetched as their rows come into view (`ensurePages`).
- **On load** the sheet opens at the top.
- **"Next empty"** appears when the *current page* (the one under the viewport's middle) is
  fetched and every cell of it is filled. It asks the server for the lowest empty cell at or
  after that page's first cell (`GET /nextEmpty` — a gap search on the primary key), so it
  works however out of order the learner has filled the sheet, and holes left further up stay
  put. It then **animates a real scroll** to that index (`jumpScrollTop`), landing with two
  rows of filled cells above the target's row. Because the scroll is real, the index landed on
  IS the cell whose stored ink is shown.
- Fetching pauses during the flight, so the pages flown past are never requested; the landing
  pages are requested at take-off. **Scrolling back up** into skipped rows fetches their pages
  then. A touch, wheel or key during the flight hands the scroll back to the learner.

Code: `NotebookGrid`, `notebookLayout.ts`, `useNotebookSheet`.

---

## Storage

Migration **174** (schema approved 2026-10-06):

| Table | Key | Columns |
|---|---|---|
| `notebook_sheets` | (`userId`, `language`, `word`) | `lastOpenedAt`, `createdAt` |
| `notebook_cells` | (`userId`, `language`, `word`, `cellIndex`) → FK `notebook_sheets` ON DELETE CASCADE | `ink` TEXT, `matchedChar` TEXT NULL, `updatedAt` |

- A row in `notebook_cells` **is** a filled cell; erasing to blank deletes it.
- Sheets are keyed by the word **text**, not a det id, so they survive det data deploys.
- Account deletion cascades through `users`.

**Ink encoding (v1)** — ink is kept for the lifetime of the account, so it is stored compactly
(`encodeNotebookInk` / `decodeNotebookInk`): coordinates normalised to the cell and quantised
to a 0..1000 integer grid, each stroke simplified (Ramer–Douglas–Peucker, ε = 2 grid units ≈
0.6px on the canvas), timestamps dropped, then `v1:` + strokes joined by `;`, each a comma list
of signed base-36 integers (first point absolute, then deltas). Typically **~0.4–1 KB per
character** against ~15–25 KB for the raw canvas ink as jsonb, which also keeps a 40-cell page
read at ~20–40 KB. The decoder doubles as the server's input validator (format, caps
`NOTEBOOK_MAX_STROKES` / `NOTEBOOK_MAX_POINTS_PER_STROKE`, coordinates inside the cell). The
`v1:` tag leaves room for a future format.

Code: `database/migrations/174-create-writing-notebook.sql`;
`server/dal/{interfaces/IWritingNotebookDAL,implementations/WritingNotebookDAL}.ts`.

---

## API

All behind `authenticateToken`; mounted only when `writingNotebook` is on.

| Method + path | Body / query | Returns |
|---|---|---|
| `GET /api/writingNotebook/summary` | `language` | `{ lastWord, totalCount }` |
| `POST /api/writingNotebook/sheets/open` | `{ language, word }` | `{ word, count }` |
| `GET /api/writingNotebook/cells` | `language, word, from, to` (≤ 160 cells) | `{ cells: [{ cellIndex, ink }] }` |
| `GET /api/writingNotebook/nextEmpty` | `language, word, after` | `{ cellIndex }` |
| `PUT /api/writingNotebook/cells/:cellIndex` | `{ language, word, ink }` | `{ word, count }` |

The PUT calls the third-party recogniser, so it carries `proxyLimiter` like
`POST /api/handwriting/recognize`.

Code: `server/routes/writingNotebookRoutes.ts`, `server/controllers/WritingNotebookController.ts`,
`server/services/WritingNotebookService.ts`, `src/api/writingNotebook.ts`.

---

## Entry point

The notebook's card sits on the Writing Center's **games belt** (`WritingGamesCarousel`,
which replaced the single-card `WritingGridLauncher`), beside the Writing Grid. It is built
by `buildNotebookCard` (`notebookBelt.ts`) as a play-only blue (`RAMP.blu`) `GameCard` whose header pill
is the belt total (`GameCardData.tally` → `CountPill`, the generalised win pill). The notebook
is not in `GAME_REGISTRY` and has no `GAME_FLAG`. This is its only entry point.

---

## Client data flow

`useNotebookSheet(language, word)` holds the fetched cells (index → encoded ink), the
fetched pages and the counter. A save is **optimistic** (the ink shows at once), the PUT
reply carries the new counter, and a failed PUT rolls the cell back. Every response is checked
against the word it was asked for, so switching words mid-request cannot cross sheets.

---

## Open flags

- ⚠️ **Recogniser outages undercount silently.** If the recogniser fails, the ink is still
  saved but uncredited (`matchedChar` NULL), and nothing re-validates it until the learner
  edits that cell. There is no "unvalidated" vs "did not match" distinction in the schema. A
  `validatedAt` column (or a retry sweep) would fix it.
- ⚠️ **Teal contrast.** `RAMP.tea.mid` (`#70FAFA`) is the darkest teal the framework defines,
  and it is faint as a dotted line on white.
- The jump's flight shows the rows flown past as empty frames (their pages are deliberately
  not fetched).
- Back while a cell is open leaves the page without saving that cell's ink.

---

## Tests

`server/__tests__/writingNotebook.test.ts` (codec, `sheetCount`, `isNotebookWord`, service
verdict/counter rules with a fake DAL and recogniser); `src/__tests__/notebookLayout.test.ts`
(virtualisation, pages, jump target); `src/__tests__/inkErase.test.ts` (partial eraser); `src/__tests__/strokeNumberPlacement.test.ts`
(never on its own stroke, fewest other strokes, clarity against a
parallel stroke, avoid each other, stay within reach, stay in the cell).
