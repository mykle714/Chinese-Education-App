# Choose Your Own Adventure (cyoa)

> **Status: BACKEND BUILT, LEARNER PAGES BUILT, EDITOR FIRST CUT (2026-11-21).** Shipped: the
> shared box-less reading-area restyle (§ 4.3), migrations 196–199 (§ 6 — **on PPE
> since 2026-11-21**; 200–201, the story-commonality swap, **not yet**:
> [STORY_COMMONALITY_DEPLOY_RUNBOOK.md](./STORY_COMMONALITY_DEPLOY_RUNBOOK.md)), `0e9af62`; michael2 is PPE's one author, holding the two seed stories
> copied up from dev), the `/api/stories/*` backend (§ 6.3), the shared reading engine in
> `src/reading/` (§ 4, 2026-11-21), the learner pages (§ 7.1: list, play page with the
> Reader's reading box + rdb + eip, inspect mode's mini reader, choice stack, end panel, both
> tabs, prefetched picks) and the editor (§ 5.1–5.4). All behind `FEATURE_FLAGS.cyoa`, switched
> **ON** 2026-11-20 ahead of completion (owner's call). Not built: the editor's body as the
> shared `TextArea` with undo/redo. Open questions are in § 10.
> Spanish is paused (CLAUDE.md): cyoa is designed and built for Chinese (`zh`) only.

A branching story the learner reads in the Reader's reading engine. Each **passage**
is read exactly like a Reader document (tap-to-navigate, the rdb keycap, tap-to-hear,
Sentence Explain, the eip) — in the Text display mode only (§ 3.1). At the end of a passage the learner picks one
of **up to four choices**, which leads to the next passage. Stories are written by
**author accounts** in an in-app editor; everyone else can only read them.

---

## 1. Goals and non-goals

**Goals**
- Reuse the Reader's reading engine wholesale — one implementation of word selection,
  segmentation, cpcd view, tap overlay, keycap and eip, shared by both features.
- A reader page with more vertical room than the Reader: no header title, no display
  strip, no search bar.
- Multiple-choice progression with full-width choice buttons (choices may be whole
  sentences).
- An editor for author accounts to write passages and wire up choices.

**Non-goals (removed relative to the Reader)**
| Reader feature | In cyoa | Why |
|---|---|---|
| Search (`ReaderSearchKey`, `ReaderSearchBar`, `useReaderSearch`) | ❌ removed | passages are short |
| Edit / Delete (header icons, `ReaderEditToolbar`, `DeleteDocumentDialog`) | ❌ for non-authors | stories are authored content; authors edit in the cyoa editor (§ 5) |
| Display strip (the row under the keycap) | ❌ no strip | owner's call 2026-11-21: "just the rdb"; its Read aloud, audio chip and Pinyin pill moved to the header instead (§ 3.1) |
| Header title text | ❌ dropped | more space at the top (§ 3.1) |
| rdb keycap, eip, Sentence Explain, tiebreak alternatives, English words | ✅ kept | part of the shared engine |
| Read aloud (`ReaderReadAloudButton`, `useReaderReadAloud`) | ✅ in the header (2026-11-21, reversing 2026-11-20) | reads the passage from its caret (§ 3.1) |
| Tap-to-hear audio chip (`ReaderAudioChip`) | ✅ in the header (2026-11-21) | the SAME setting as the Reader's chip (`useReaderAudioSettings`, per device), so autoplay is configurable from either page (§ 3.1) |
| Pinyin pill (`ReaderDisplayToggle`) + the Pinyin display mode (`ReaderCpcdView`) | ✅ in the header (2026-11-21) | the SAME per-device `reader.displayMode` as the Reader's pill; the passage only (§ 3.1) |

---

## 2. Terminology

| Term | Meaning |
|---|---|
| **story** | one adventure: a title, an icon, a start passage, and its passages |
| **passage** | one page of story text, read in the reading engine |
| **choice** | one option at the bottom of a passage (1–4 per passage); leads to a target passage |
| **ending** | a passage with zero choices |
| **author** | an account allowed to create and edit stories (§ 6.1) |

---

## 3. Learner experience (reading a story)

### 3.1 Page layout (top → bottom)

```
┌─────────────────────────────────────────┐
│ ← [▶Read] [🔊 default] [Pinyin] [Edit] │  header: back arrow, NO title text
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │        rdb (VocabDisplayCard)       │ │  hideable (§ 3.4)
│ └─────────────────────────────────────┘ │
│                                         │
│      从前，有一个小女孩住在山上。        │  shared reading pane — no box,
│      有一天，她听到森林里有声音……        │  words on the page ground with a
│                                         │  wide side margin (§ 4.3)
│                                         │
│ ┌──────────────────────────────┐ ┌──┐  │
│ │ 她走进森林去看看。            │ │🔍│  │  up to 4 FULL-WIDTH choice
│ └──────────────────────────────┘ └──┘  │  buttons, stacked; hideable (§ 3.4).
│ ┌──────────────────────────────┐ ┌──┐  │  Each has an INSPECT key cut out
│ │ 她跑回家告诉妈妈。            │ │🔍│  │  of its right side (§ 3.2)
│ └──────────────────────────────┘ └──┘  │
└─────────────────────────────────────────┘
```

- **Header.** `NodePageHeader` with the back arrow and an empty title (`title=""`). An
  author reading **their own** story also gets an **Edit icon** here, which opens the
  editor (owner's call 2026-11-20). Every reader (author previewing or not) gets the
  Reader's display-strip controls left of it, in the strip's order (owner's call
  2026-11-21 — there is no strip, "just the rdb", so they live in the header):
  - **Read aloud** (`ReaderReadAloudButton` + `src/reading/useReaderReadAloud.ts`) — reads
    the **passage** from its caret, moving the word selection along; any other tap stops it
    (so 🔍 never reads into inspect mode); disabled while a choice is inspected.
    Tap-to-hear stands down while it plays (`useReadingKeycap` `readAloudPlaying`).
  - **Tap-to-hear audio chip** (`ReaderAudioChip`) — the Reader's own chip over the
    Reader's own per-device setting (`src/reading/useReaderAudioSettings.ts`, localStorage
    `reader.audio`): muting it here mutes the Reader and back — one setting, not a copy.
  - **Pinyin pill** (`ReaderDisplayToggle`) — Text ⇄ Pinyin for the **passage**, on the
    Reader's per-device `reader.displayMode` (`src/reading/useReaderDisplayMode.ts`), so
    the mode is shared too. Pinyin mode is the Reader's `ReaderCpcdView` (tiebreak
    alternatives included, `src/reading/useSegmentOverrides.ts`); the tap region scrolls
    the cpcd box. The inspected choice label stays plain text (§ 3.2).
  Code: `StoryPlayPage.tsx` → `.story-play__header-actions`, `showCpcd`, `readAloud`.
- **rdb.** The Reader's dictionary keycap, unchanged — the same `VocabDisplayCard` with the
  same wiring (`src/reading/useReadingKeycap.tsx`): the tap demo while nothing is selected,
  the entry, speaker, Add ⇄ Added!, More Info → the eip (`ReadingEipHost`), the Sentence
  Explain face. Folded by the top tab (§ 3.4).
- **Reading pane.** The Reader's reading box (`src/reading/TextArea.tsx`) with its tap
  region (`ReadingTapRegion`) stretched over the side padding to the screen's edges, filling
  the space between the rdb and the choices; it scrolls internally for a long passage.
- **Choices.** 1–4 full-width buttons stacked at the bottom, each carrying the app's
  1px outline and the rounded edge (CLAUDE.md § Buttons & cards). Text wraps; buttons
  grow to fit. Colours from the Tier 2 look / RAMP (`readerPillButtonSx` family) — no
  new colours. Each button has an **inspect key** cut out of its right side (§ 3.2).
- **Ending.** A passage with no choices shows the end screen instead of buttons (§ 3.6).

### 3.2 Inspecting a choice (the in-button mini reader)

Choice labels are Chinese sentences the learner may not be able to read yet, so each
choice can be read with the engine before it is picked (owner's call 2026-11-20).

**The inspect key.** A square key cut out of the right end of every choice button: the
button's outline steps around it, leaving a notch the key sits in, so the key reads as
part of the button rather than a separate control beside it. Like every tappable key it
carries the 1px outline and the rounded edge (CLAUDE.md § Buttons & cards). Icon:
`search` / magnifier (placeholder).

**Two tap targets per button:**
| Tap on | Not inspecting | Inspecting |
|---|---|---|
| the label area | **picks the choice** → next passage (§ 3.3) | steps through the label's words (mini reader) — does **not** pick |
| the inspect key | enters INSPECT MODE for this button | leaves INSPECT MODE |

**INSPECT MODE.** The button's label becomes a small reading pane over the label text:
the same engine as the passage (gsa words, tap-to-navigate, selection highlight,
tap-to-hear, Sentence Explain) at button scale. Decided 2026-11-20:
- **The main rdb follows the button.** The selected label word shows in the page's one
  keycap at the top; there is no second keycap inside the button. If the rdb was hidden,
  it slides out of its top indicator when inspect mode opens.
- **The other buttons dim and lock.** While one button is inspected, the rest dim and
  ignore taps (label and inspect key alike), so a choice cannot be picked by accident
  mid-inspection. Leave inspect mode first, then pick or inspect another.
- **The inspect key becomes a ✕** (`close`) while its button is inspected; tapping it
  leaves inspect mode.
- **The passage selection is parked and restored.** Entering inspect mode clears the
  passage's highlight; leaving it puts the same word back (not NOTHING-SELECTED MODE).

- **Picking needs inspect mode closed** (owner's call 2026-11-20): tap ✕, then the
  label. There is no pick control inside an inspected button.
- The inspected label is always plain text, even in Pinyin mode (the pill drives the passage only, § 3.1); the label button does not grow.

**As built (2026-11-21):** the inspected label is `src/reading/TextArea.tsx` at
`size="inline"` (as tall as its text, no gutter, set in the label's own type so the words
do not move) under its own `ReadingTapRegion` — the label's back / forward thirds, the
long-press word jump and sentence press. The face becomes a `<div>` while inspected (a
textarea may not sit inside a button). Built by `StoryPlayPage` and handed to
`StoryChoiceStack` as `inspectedLabel`. Entering clears the label to nothing-selected mode
(the rdb shows the tap demo) and takes focus; leaving refocuses the passage on its parked
word. Tap-to-hear does not speak on the switch itself (`useReadingKeycap` `activeKey`).

Engine consequence (§ 4.2): the engine must run over **more than one text on a page** —
the passage plus the inspected label — with the rdb following whichever is active.

### 3.3 Progression
Tapping a choice loads its target passage into the same page (no route change per
passage). The selection resets to NOTHING-SELECTED MODE (`useTextSelection`) for each new
passage, as when a Reader document opens.

**Progress is saved** (owner's call 2026-11-20). Every choice taken is written to the
server, so leaving the page — or the app — and coming back reopens the story on the
passage the learner was on (`story_progress`, § 6.2). Each pick is one small write; the
client updates the page at once and does not wait for it — the response that served the
current passage already holds every choice's target (`next`, § 6.3).

**Choices are final** (owner's call 2026-11-20): there is no stepping back to an earlier
passage. To explore another branch, the learner reaches an ending and replays. So the
resume point is just the current passage, and no path is stored.

### 3.4 Show / hide toggles
The rdb and the choice stack each take vertical space from the passage, so the learner
can fold either away. **Each is toggled by an indicator on the screen edge it slides out
from** (owner's call 2026-11-20):
- **rdb** — an indicator at the **top** of the content area. Folded, it sits just under
  the header; the rdb slides down from under the header to show and back up to hide.
- **choices** — an indicator at the **bottom** of the screen. Folded, it sits on the
  screen's foot; the choice stack slides up from the foot to show and back down to hide.

**The tab rides the panel's leading edge** (owner's call 2026-11-21): the rdb's tab hangs
from the keycap's lower edge, the choices' tab stands on the stack's upper edge, so each
tab travels with its panel as it slides in and out. It stays visible while its panel is
hidden, so there is always a way to bring it back.

Motion: a `Collapse` on the Reader's KEYBOARD LIFT curve (`StoryPlayPage.tsx` →
`FOLD_TIMEOUT`, `FOLD_EASING`). The rdb's fold pins its content to the fold's bottom edge
(`FOLD_SLIDE_DOWN_SX`), so the keycap slides rather than being uncovered in place; the
choices' fold grows upward from the foot, so it slides without help. Decided 2026-11-20:
- **Look: a chevron tab** — a small tab sticking out of the edge, its chevron pointing
  the way the panel will move (▾ / ▴), flipping when the panel opens or closes. Tappable,
  so it carries the 1px outline and the rounded edge.
- **Tap only** — no drag. That keeps it clear of the reading pane's own tap and drag
  gestures (`ReaderTapOverlay`).

### 3.5 Endings found

A story has several endings. The first time a learner reaches an ending, it is recorded
as **found** (`story_endings_found`, § 6.2), and their count for that story goes up:
**found / total**, e.g. **2/7**.
- **total** = the number of ending passages in the published story, counted at read
  time (not stored), so it stays right when an author adds or removes an ending.
- Reaching an ending already found does not change the count.
- If an author deletes an ending passage a learner had found, that row cascades away and
  the count drops with it: 3/7 becomes 2/6, so found never exceeds total (owner's call
  2026-11-20).

### 3.6 End screen

Shown on an ending passage in place of the choice stack (the passage text itself still
reads normally above it). It shows the **ending's name** (§ 6.2b) and the learner's
**endings found** stat for the story — "Endings found **2/7**" — with the count already including the ending just reached. A
newly found ending gets a **"New!" badge** beside its name, and the counter **ticks
up** from the old count to the new one (1/7 → 2/7) (owner's call 2026-11-20). A repeat
ending shows its name and the count, no badge and no tick.

**No "start over"** (owner's call 2026-11-20). The end screen's only action goes back to
the story list. Reaching an ending finishes the run: the learner's `story_progress` row is
deleted, so the next time they open the story it starts from the first passage. Endings
found are permanent, so replaying is how the rest are found.

### 3.6a "To be continued"
A passage whose choices are **all** disabled (none has a target yet — § 6.3) would strand
the learner. It shows its disabled choices plus a **"To be continued"** line and a
back-to-list action (owner's call 2026-11-20). It is **not** an ending: nothing is counted,
and the learner's `story_progress` stays on that passage, so they resume there once the
author writes the branch.

### 3.6b Pages found — BUILT 2026-11-21 (migration 198)
The end card shows **"Pages found x/y"** under "Endings found" (owner's call 2026-11-21):
x = the distinct passages this learner has ever been served in the story, across every
play; y = the story's passages right now (counted at read time, so deleting a passage
lowers both — the FK cascades its seen rows). It does not tick: it moves on every page, so
the end card is not where it changes. Shown only on the end card today (not the list card).

- Every serve records the passage (`StoryService` → `arrive` → `recordPassageSeen`), the
  re-served resume passage included; a revisit is an `ON CONFLICT` no-op.
- The prefetched `next` steps predict their own count (+1 for a target not yet seen), so a
  predicted ending's card matches the confirmed one.
- ⚠️ y counts EVERY passage, including ones no choice reaches (a draft branch, or an
  unreachable passage the publish warning flags), so a learner may be unable to reach y/y.
  Counting only reachable passages would need the whole graph per serve; not done.

Code: `database/migrations/198-create-story-passages-seen.sql`; `server/contracts/stories.ts`
→ `StoryPlayStep.passagesSeen` / `passagesTotal`; `StoryDAL` → `recordPassageSeen`,
`listPassagesSeen`; `StoryService` → `arrive`, `buildStep`;
`src/features/cyoa/StoryEndPanel.tsx` → `EndingSummary`.

### 3.7 Time of day
Same as the Reader: the page calls `useTier2Look()` once and passes `look` down
(docs/SHELF_REDESIGN.md § 7b).

---

## 4. Shared reading engine — BUILT 2026-11-21 (`src/reading/`)

### 4.1 What is shared vs. Reader-only

The reading engine used to live inline in `src/features/reader/ReaderDocumentPage.tsx`.
It now lives in **`src/reading/`** (owner's call 2026-11-20, Q-1), and both
`ReaderDocumentPage` and `StoryPlayPage` compose it. The moved files kept their names
(`Reader…`) to keep the move a pure rename; the new composition pieces are `Reading…`.

| Piece | Where | Used by |
|---|---|---|
| `TextArea` (+ `size="inline"`), `ReaderSearchHighlights`, `ReaderTapOverlay`, `ReaderTapHint` | `src/reading/` | Reader, cyoa |
| `useTextSelection`, `textSelection`, `textSelectionUtils`, `documentSegmentation`, `readerAlternatives`, `readerSentences` | `src/reading/` | Reader, cyoa |
| `ReaderSentenceFace` / `useSentenceExplanation`, `ReaderKeycapPawn`, `ReaderMoreInfoKey` | `src/reading/` | Reader, cyoa |
| `useEnglishTranslations` / `englishTranslation`, `useReaderWordActions`, `useReaderAudioSettings`, `useReaderAudioPreload` | `src/reading/` | Reader, cyoa |
| `readerStyles` (gutter, selection / search colours, muted / message / pill fragments) | `src/reading/` | Reader, cyoa (`cyoaStyles.ts` re-exports three of them) |
| `ReaderCpcdView` + `ReaderDisplayToggle` + `useReaderDisplayMode` (Pinyin mode), `useSegmentOverrides` (tiebreak switches), `ReaderReadAloudButton` + `useReaderReadAloud` + `readAloudClauses` (read aloud) | `src/reading/` | Reader, cyoa (moved 2026-11-21) |
| search, the display strip itself, edit toolbar, delete dialog, icon picker, `/reader/new` | `src/features/reader/` | Reader only |
| choice stack, show/hide tabs, story progression, story editor | `src/features/cyoa/` | cyoa only |

### 4.2 The composition (as built)

All client-side, presentation + client-state layers (docs/FRONTEND_LAYERING.md):

| File (`src/reading/`) | Layer | What it is |
|---|---|---|
| `useReadingText.ts` | client state | ONE text read with the engine: its gsa spans (with optional tiebreak overrides) + its `useTextSelection`. A page calls it once per text |
| `useReadingKeycap.tsx` | client state + glue | the rdb for the ACTIVE text: `cardProps` to spread on `VocabDisplayCard` (tap demo, pawn, Sentence Explain face, entry, speaker, the Add / More Info keys), `wordActions`, tap-to-hear + preloading, the demo's zone flash. Reader-only stand-downs come in as options (`readAloudPlaying`, `editing`, `isQuiet`); `activeKey` keeps a switch of active text from speaking |
| `useReadingVocabSync.ts` | client state | the vocab-update listeners (add / update / remove / bulk add) for every selection on the page |
| `useContentVocabulary.ts` | client state | cyoa's vocabulary loader: one lookup per `content`, no per-document cache, stale responses dropped. (The Reader keeps `useVocabularyProcessing`, whose caching and incremental re-read suit documents.) |
| `ReadingTapRegion.tsx` | presentation | the pointer-inert frame that places `ReaderTapOverlay` over a reading box, widened by `left` / `right` / `bottom` |
| `ReadingEipHost.tsx` | presentation | the `EipSheet` mount behind More Info |

- **Several texts, one keycap.** The play page has two `useReadingText`s — the passage and
  the inspected label — over ONE vocabulary lookup of the passage plus every label, so
  inspecting needs no fetch. The keycap follows whichever is active; the active one holds
  focus (the blur → refocus loop), the other stands down.
- **At button scale.** `TextArea size="inline"` and a `ReadingTapRegion` with no insets.
- ⚠️ **Layering debt carried over:** `useReadingKeycap`, `ReadingEipHost` and
  `useReaderWordActions` reach into `src/features/flashcards/` (EipSheet, EipAddKey,
  useEipTabs, eipAddKeySizes), and `ReaderKeycapPawn` into `src/features/deckTower/iso`.
  Shared code importing features breaks the dependency direction; it was already so in the
  Reader. Tracked in docs/DEFERRED_WORK.md.

### 4.3 Box-less look — SHIPPED 2026-11-20
The reading area is no longer a card: no surface fill, hairline or radius, in reading and
edit mode. The words sit on the page ground inside a wide side margin: the page's content
padding (16 / 24px) plus `READER_TEXT_GUTTER_PX` (24px x, 8px y).
Code: `src/reading/readerStyles.ts` → `READER_TEXT_GUTTER_PX`;
`src/reading/TextArea.tsx` (the textarea's padding and the removed fieldset);
`src/reading/ReaderCpcdView.tsx` (same gutter, so Text and Pinyin modes break
lines identically). `ReaderSearchHighlights` copies the textarea's computed padding, so it
follows on its own.

---

## 5. Author experience (the editor)

Only author accounts (§ 6.1) see it; the server enforces the same check on every write.

**Scope (§ 10 Q-3, answered 2026-11-20; as built: § 5.1):**
- **Edits to a published story go live immediately** (owner's call 2026-11-20): there is
  no draft copy or versioning; each save is what learners read next. Acceptable while
  authors are a few trusted accounts — revisit if that changes.
- Visibility (owner's call 2026-11-20): learners see **published** stories only; an author
  also sees **their own** drafts; authors cannot edit each other's stories.
- A story list (an author's own stories + a "New story" pill), reusing the Reader list's
  grid/rows.
- A story editor: the story's title and icon (`IconPickerDialog`, as documents do), its
  passages, and which passage starts it.
- **A passage LIST, not a node map** (owner's call 2026-11-20): the story editor lists
  its passages; each row shows the passage's label and whether it is the start or an
  ending. Where choices lead is drawn as **link lines** in a gutter beside the list (§ 5.2,
  owner's call 2026-11-21, which also dropped the rows' opening-words and incoming-choice
  lines).
- A passage editor: the box-less editable `TextArea` (the Reader's edit mode, with
  `useReaderContentEditor` undo/redo) plus up to four choice rows — each a label field and
  a target-passage picker (an existing passage, or "not written yet"; passages are created
  with the story editor's **New passage** — the picker has no "create" option, owner's call
  2026-11-21).
- Preview: open the passage in the learner view. **Author play counts like anyone's**
  (owner's call 2026-11-20): there is one play mode, and it always saves progress and
  records endings found, Preview included.
- Publish / unpublish: only published stories reach learners.

### 5.1 Editor as built — 2026-11-20

| File (`src/features/cyoa/`) | Layer | What it is |
|---|---|---|
| `useAbcTypingIsNotActivity.ts` | feature hook | While the abc keyboard is up, interactions on the editor pages are not minute-points activity (§ 8) |
| `useStoryEdit.ts` | client state | `GET /edit` into `edit`; `run(action, apply?)` wraps one author call (busy, server message → `notice`, `{ value }` or null); `reload()`. 403 → "forbidden", 404 → "unavailable" |
| `storyEditorModel.ts` | model (pure, tested) | passage numbers and labels, snippets (the target picker's), warning sentences, the passage editor's `ChoiceDraft`s → the PUT body (`saveBodyFromDraft`) |
| `StoryEditorPage.tsx` | page | `/adventures/:id/edit`: icon tile (`IconPickerDialog`), title field saved on blur, status line, Publish / Unpublish, the live warnings, **New passage** + `StoryPassageList`, Delete story. Header Preview ▶ → the play page with `state.from` = the editor, so the play page's Back returns here |
| `StoryPassageList.tsx` | presentation | the passage rows + the link gutter (§ 5.2); measures each row's box (after layout and on resize) for the gutter, and narrows the rows by the gutter's width. Owns the drag-to-reorder (§ 5.3) |
| `passageReorder.ts` | model (pure, tested) | the drag maths: where the row lands (`dropIndex`), how far passed rows step aside (`rowShift`), `moveItem` |
| `StoryPassageRow.tsx` | presentation | one passage row, one line: the ⠿ drag handle (§ 5.3), then a button holding the label, Start / Ending · name chips, an orange **n unlinked** chip (link_off icon) when any choice has no target yet (replaced the all-targetless "To be continued" chip, 2026-11-21), chevron; then a ⧉ duplicate button (§ 5.4) |
| `passageLinkLayout.ts` | model (pure, tested) | the link gutter's merged trunks (fan-out and fan-in), lanes and anchor slots (§ 5.2), plus its px geometry (`linkGutterWidth`) |
| `StoryPassageLinks.tsx` | presentation | the gutter SVG: one cased, lane-coloured trunk per source passage |
| `PassageEditorPage.tsx` | page | `/adventures/:id/edit/:passageId`: the passage name as the header's editable title (§ 6.2d), Make this the start, the body, 0–4 choice rows + Add choice, the Ending name field (only with no choices), Delete passage (not the start). Save pill in the header; Back saves first when there are changes and stays put if the save fails. The other ways out: the edge-swipe back is blocked while there are changes (`useBlockEdgeSwipe`), a browser/hardware back saves in the background on unmount (`persistDraft`, fire-and-forget), closing the tab asks (`beforeunload`). The plain `<BrowserRouter>` has no `useBlocker`. Writing with a keyboard up: the scrolling column ends at the keyboard's top (a `useKeyboardInset()` bottom margin on `.passage-editor-body`) and `useComfortableCaretScroll` keeps the caret line of whichever field has focus (body, choice label, ending name) at a comfortable height above the keyboard — while writing and when a tap places the caret |
| `StoryChoiceDraftRow.tsx` | presentation | label field (wraps and grows to show the whole label; stays one logical line — Enter inserts nothing, pasted line breaks become spaces) + a native `<select>` target picker: Not written yet / every passage (no "create a passage" option — authors link passages they made with **New passage**) |
| `StoryConfirmDialog.tsx` | presentation | the delete confirmation (the Reader delete dialog's look) |

Entry points: the list's **New story** pill (authors only; creates "Untitled story" and opens
its editor), an author's own **draft** card (opens the editor instead of the play page), and
the play page's header **Edit** icon on the author's own story.

Behaviour as built, where the design left room:
- **Choices link existing passages only.** The target picker once offered "A new passage"
  (created on Save); it was dropped 2026-11-21 (owner's call: authors link passages
  themselves). Passages come from the story editor's **New passage**.
- **Passages are called by their name, else their number** (§ 6.2d): an author-written name
  when set, otherwise "Passage n" by its row in the list — the author-set order (§ 5.3), so
  moving or deleting a passage renumbers the unnamed ones it passes.
  `storyEditorModel.ts` → `passageLabels` is the one map behind every editor surface.
- The **ending name** is sent only while the passage has no choices.
- **Two tabs on one passage** (optimistic concurrency): the draft keeps the `updatedAt` it
  was seeded from and every save sends it as `expectedUpdatedAt`; a passage saved elsewhere
  since → 409 (`ConflictError`, "Save again to replace that version with yours"), and the
  next save omits the version and wins. A re-read that brings a newer version from elsewhere
  never re-seeds over unsaved typing — only this page's own save or a different passage does.
  A background save on leave that hits a 409 is dropped (logged).
- **Writing the body with a keyboard up:** the page column reserves the keyboard's height
  (`useKeyboardInset()`, the beginner keyboard ∪ the OS keyboard) as a bottom margin on its
  slide curve, so the column ends at the keyboard's top edge. Inside it,
  `src/hooks/useComfortableCaretScroll.ts` holds the line being written no lower than 60%
  of the visible column, leaving clear space below it with the text just written in view.
  It is shared with the Reader's edit mode (docs/USER_DOCUMENT_FEATURE_SUMMARY.md §
  Editing → Comfortable caret scroll). The choices and the delete button below the body
  are the run-out it scrolls into when writing at the end.
- **Not built yet:** the body as the shared `TextArea` with undo/redo (it is still a plain
  box-less multiline field; `src/reading/TextArea.tsx` is now importable), and Preview of a
  single passage (Preview opens the story from the learner's saved point, in the learner's
  reading view — the same rdb and reading box as the Reader, § 3.1).

---

### 5.2 The link gutter — BUILT 2026-11-21

The story editor draws the story's graph beside its passage list rather than as a node map
(owner's call 2026-11-21). Code: `src/features/cyoa/passageLinkLayout.ts` →
`layoutPassageLinks` (pure, tested in `__tests__/passageLinkLayout.test.ts`),
`StoryPassageLinks.tsx` (the SVG), `StoryPassageList.tsx` (rows + measuring).

```
fan-out                              fan-in
│ Passage 1   │●──┐                  │ Passage 1   │●──┐
│ The forest  │◀──┤                  │ The forest  │●──┤
│ Passage 3   │◀──┘                  │ Passage 3   │◀──┘
```

- **Merged lines (trunks).** A trunk leaves each of its source passages at a dot, runs
  along a lane and enters each of its target passages with an arrowhead. Lines out of one
  passage merge (owner's call 2026-11-21: "lines coming out of the same passage can be
  merged into one multi targeted line"), and so do lines into one passage (owner's call
  2026-11-21: "we should also support multiple source arrows merged together").
- **Every dot leads to every arrow.** A trunk is always a complete sources × targets block
  of links, so a line never implies a link that doesn't exist (a→x, a→y, b→x is two trunks,
  not one claiming b→y). Each distinct link is on exactly one trunk, chosen greedily:
  largest block first, ties to fewer dots (a passage's own choices stay together), then
  higher up (`passageLinkLayout.ts` → `mergeLinks`). A passage can have dots on more than
  one trunk. Targetless choices draw nothing; a choice back into its own passage puts a dot
  and an arrow on the same row.
- **Lanes:** a trunk spans the rows from its highest end to its lowest; trunks that share a
  row take different lanes. Placed shortest first into the lowest free lane, so short hops
  hug the rows. **At most 10 lanes** (`MAX_LINK_LANES`); a trunk that finds none is not
  drawn, and the list says "n links not shown" under it (so long jumps drop out first).
- **Colour:** one per lane, from the ramp's MARK tier plus greyA, gld and the look's ink2
  (`LINK_COLORS`) — side-by-side trunks always differ. Pastel marks are near-invisible on
  the day ground, so every line is cased in ink (day) / the slate lip (night).
- **Anchors:** each end gets its own slot on its row's right edge, ordered so a row's stubs
  don't cross each other's lanes (`passageLinkLayout.ts` header, "Anchor slots").
- The gutter is as wide as the lanes in use, and absent when nothing is linked. It is
  decoration only (`aria-hidden`, no pointer events); the publish warnings still state
  unreachable passages in words.

### 5.3 Reordering passages — BUILT 2026-11-21 (migration 199)

Authors put passages in their own order by dragging a row's ⠿ handle (`drag_indicator`,
left of the label) — owner's ask 2026-11-21, to organize their passages. Column
`story_passages.position` (approved 2026-11-21): 1-based per story, gaps allowed,
`UNIQUE (storyId, position) DEFERRABLE`; backfilled in creation order; a new passage takes
MAX + 1 (last). Unnamed passages are numbered by this order (§ 6.2d).

- **The drag** (`StoryPassageList.tsx`): pointer capture on the handle (`touch-action:
  none`, so the column does not scroll instead). The row follows the finger as a transform;
  the rows it passes glide aside (`passageReorder.ts`, from the measured row boxes). Near the
  column's top/bottom edge (56 px) it auto-scrolls. The link gutter fades out during the
  drag and is redrawn for the new order. The rest of the row stays a button that opens the
  passage; a press on the handle never opens it.
- **The save:** one `PUT /api/stories/:id/passages/order {passageIds}` per drop, applied
  optimistically (`StoryEditorPage` → `handleReorder`). The server requires exactly the
  story's passage ids (a list from before another tab added or deleted one → 400); on any
  failure the page shows the message and re-reads the graph.
- **Not built:** reordering without a pointer (keyboard / screen reader). The handle is
  labelled "Reorder <passage>" but has no key handling.

Code: `database/migrations/199-add-position-to-story-passages.sql`; `StoryDAL` →
`listPassages` (ORDER BY position), `createPassage`, `reorderPassages`; `StoryService` →
`reorderPassages`; `server/contracts/stories.ts` → `StoryPassageOrderBody`;
`src/api/stories.ts` → `reorderStoryPassages`; `src/features/cyoa/StoryPassageList.tsx`,
`passageReorder.ts`, `StoryPassageRow.tsx`.

### 5.4 Duplicating a passage — BUILT 2026-11-21 (no migration)

Each passage row ends in a ⧉ (`content_copy`) button, split from the open button by a
hairline (owner's ask 2026-11-21: "a button on the passage button to duplicate the
passage"). One tap copies the passage into a new one placed **right below it** — later
passages shift down one — and the list stays where it is; the copy is not opened.

- **What is copied:** body, ending name, and every choice with its label and target. A
  choice back into the original becomes a choice back into the COPY, so the copy behaves
  like the original. Not copied: start status (the copy is never the start), readers'
  progress, seen pages or endings found.
- **The name:** a named passage's copy is "<name> (copy)", the name trimmed so the whole
  fits the 200-character limit; an unnamed passage's copy stays unnamed and takes its own
  "Passage n" from its position (§ 6.2d), which renumbers the unnamed passages below it.
- Counts toward `STORY_MAX_PASSAGES` (400 when full). Nothing links INTO the copy until
  the author points a choice at it.

Code: `StoryDAL` → `duplicatePassage` (in one transaction: shift positions, insert the
copy, copy the choices); `StoryService` → `duplicatePassage`, `copyName`;
`StoryController` → `duplicatePassage`; `src/api/stories.ts` → `duplicateStoryPassage`;
`StoryEditorPage` → `handleDuplicate`; `StoryPassageRow.tsx` (`.story-passage-row__duplicate`).
Tested in `server/__tests__/stories.test.ts`.

## 6. Data model — BUILT (migration 196)

`database/migrations/196-create-stories.sql`. Every table and column below was approved by
the owner on 2026-11-20 (CLAUDE.md requires it). The migration header carries the full
delete-behaviour table; the summary:

| Delete / change | Effect |
|---|---|
| Delete a story | cascades passages, choices, progress, endings found |
| Delete a passage | choices into it → `targetPassageId` NULL ("coming soon"); progress on it → deleted (learner restarts); endings found on it → deleted (count drops) |
| Delete the start passage | **refused by StoryService** — pick another start passage first, so a story never silently loses its entry (`startPassageId`'s `ON DELETE SET NULL` only fires inside a story-delete cascade) |
| Unpublish | nothing deleted |
| Delete an author account | their stories cascade away |

"Same story" — a choice's target, a story's start passage — is not expressible as a plain FK;
`StoryService` checks it on every write.

### 6.1 Author permission — APPROVED 2026-11-20
`users."isAuthor" BOOLEAN NOT NULL DEFAULT FALSE`, the same pattern as `isValidator` /
`isFeatureTester` / `isAdmin` (`server/contracts/wire.ts` → the user wire type). Granted by
hand on PPE; no UI grants it. It is the app's only authoring grant: the older
`users."isTemplateAuthor"` (migration 115, Night Market / Immersive World) was dropped by
migration 185, and the owner chose (2026-11-20) to fold it into `isAuthor` rather than revive
it — on dev its two holders were granted `isAuthor` by hand.

### 6.2 Tables (sketch)

The story is a **free graph** (owner's call 2026-11-20): two choices may lead to the same
passage, and a choice may loop back to an earlier one. The service therefore validates
reachability (every passage reachable from the start) rather than tree shape, and the
editor must show a passage's incoming choices, since it can have several (the link gutter
does, § 5.2).

| Table | Columns (sketch) | Notes |
|---|---|---|
| `stories` ✅ approved | `id`, `language`, `title`, `iconId` (FK `icons8`), `authorUserId` (FK `users`), `startPassageId`, `publishedAt` (TIMESTAMPTZ NULL — NULL = unpublished; set to now() on every publish, replacing the earlier `published` boolean, owner's call 2026-11-20), `commonality` (SMALLINT 1–5, migration 200, § 6.2a; it replaced migration 196's `difficulty`, dropped by 201), `createdAt`, `updatedAt` | zh only for now |
| `story_passages` ✅ approved | `id`, `storyId` (FK, cascade), `content` text, `createdAt`, `updatedAt`; later `name` (197), `position` (199, § 5.3) | an ending = a passage with no choices |
| `story_choices` ✅ approved | `id`, `passageId` (FK, cascade), `position` 1–4, `label` text, `targetPassageId` (FK, nullable while drafting) | `UNIQUE(passageId, position)`, `CHECK (position BETWEEN 1 AND 4)` |
| `story_progress` ✅ approved | `userId`, `storyId`, `currentPassageId` (FK `story_passages`), `updatedAt`; PK (`userId`, `storyId`) | resume point (§ 3.3); no row = start from the first passage; deleted when an ending is reached (§ 3.6). `currentPassageId` is `ON DELETE CASCADE`: if the author deletes that passage, the row goes and the learner restarts from the start, keeping endings found (owner's call 2026-11-20). No `path` column: choices are final, so there is no step-back to support |
| `story_endings_found` ✅ approved | `userId`, `storyId`, `passageId` (FK `story_passages`, cascade), `foundAt`; PK (`userId`, `passageId`) | one row per ending a learner has reached — the numerator of § 3.5's count. `storyId` is denormalised so the count is a single indexed `COUNT(*)` |
| `story_passages_seen` ✅ approved 2026-11-21 (migration 198) | `userId`, `storyId`, `passageId` (FK `story_passages`, cascade), `seenAt`; PK (`userId`, `passageId`) | one row per passage a learner has been served — the numerator of § 3.6b's "Pages found". Same shape as `story_endings_found` |

Data sync: stories are authored on **PPE** (like sort packs), so `stories`,
`story_passages` and `story_choices` should join `/data-ppe-to-dev`'s pull list (not added
yet — tracked in docs/DEFERRED_WORK.md; nothing to pull until the editor exists);
`story_progress`, `story_endings_found` and `story_passages_seen` are per-user and would not.

### 6.2a Story list card fields
**Order** (owner's call 2026-11-20; re-keyed 2026-11-21): by `commonality` descending (most
common = easiest first), then newest `publishedAt` first within a band; never-published
drafts last. In-progress stories are not pinned. Code: `StoryDAL` → `listForViewer`.

The learner list's card shows (owner's call 2026-11-20): **endings found x/y**
(§ 3.5), an **in-progress marker** (a `story_progress` row exists), the story's
**commonality** (the 5-circle `CommonalityMeter`, `src/components/ScoreMeters.tsx`), and
the **author's name**. The author's name is joined from `users` via `authorUserId`. One
list read returns all four per story.

**The commonality is computed, at publish time** (owner's call 2026-11-20), and stored so
the list read stays cheap. It is not author-picked. Column `stories."commonality"` (approved
2026-11-21, migration 200) `SMALLINT` 1–5, NULL until first publish: det `frequencyScore`'s
scale (5 = everyday), drawn with the same meter the eip uses for a word. Computed in
`StoryService` → `computeCommonality` on Publish: segment every passage and choice label
with the server's gsa (`server/dal/shared/segmentString.ts` → `segmentWithDict`, already
used by `TextService` for titles), give each distinct word the HIGHEST `frequencyScore`
among its det rows, and take **the highest commonality that 90% of the distinct words
reach** (`server/contracts/stories.ts` → `computeStoryCommonality`) — so one rare word does
not drag an everyday story down to 1. Distinct words, not occurrences: a word repeated
twenty times counts once. Words with no det row or no `frequencyScore` (names, English,
punctuation runs) are left out of the count. Re-publishing recomputes it; so does
`server/scripts/backfill/cyoa/backfill-story-commonality.ts` (`StoryService` →
`recomputeCommonality`, which leaves `publishedAt` alone). A det word re-scored later does
NOT move a published story until its next publish or backfill (unlike sort packs, which
derive at read time — migration 177).

**History.** Until 2026-11-21 this was an HSK level: `stories."difficulty"` 1–6 from det
`difficulty`, the LOWEST level covering 90% of words, labelled "HSK n". It changed when
word difficulty stopped being shown to learners anywhere (eip, acp). The commonality rule
is the same 90% rule walked from the common end. Migration 205 (renumbered from 201) drops the old column (held
back; [STORY_COMMONALITY_DEPLOY_RUNBOOK.md](./STORY_COMMONALITY_DEPLOY_RUNBOOK.md)).

### 6.2b Named endings
Each ending passage carries an author-written name (owner's call 2026-11-20), shown on the
end screen (§ 3.6). Column `story_passages."endingTitle"` TEXT NULL (approved) —
meaningful only on a passage with no choices; publish warns on an unnamed ending.

### 6.2d Passage names — BUILT 2026-11-20 (migration 197)
Authors name passages to organize them (owner's call 2026-11-20). Column
`story_passages.name` TEXT NULL (approved): NULL = unnamed. An **author-only** label: no
learner wire type carries it.

- **Editing:** the passage editor's header title is an always-on text field (PageHeader's
  `editableTitle`, the Reader's rename field). The name is part of the passage DRAFT: it
  lights the Save pill and goes in the same `PUT` (same 409 check). A blank field shows
  "Passage n" as its placeholder and saves as unnamed.
- **Shown:** the story editor's passage rows, the choice target picker (name · opening words) and the publish warnings,
  all through `storyEditorModel.ts` → `passageLabels` (name, else "Passage n").
- **Rules:** `StoryService` → `normalizePassageName`: control chars stripped, whitespace
  runs collapsed to one space, trimmed, ≤ `STORY_PASSAGE_NAME_MAX_LENGTH` (200, else 400);
  blank → NULL. The PUT replaces the whole passage, so an omitted `name` clears it.

Code: `database/migrations/197-add-name-to-story-passages.sql`; `server/contracts/stories.ts`
→ `StoryPassageEdit.name`, `StoryPassageSaveBody.name`, `STORY_PASSAGE_NAME_MAX_LENGTH`;
`StoryDAL` → `PASSAGE_SELECT`, `savePassage`; `StoryService` → `normalizePassageName`,
`flattenLabel`; `src/features/cyoa/storyEditorModel.ts` → `passageLabels`, `PassageDraft.name`;
`PassageEditorPage.tsx` (header `editableTitle`); `StoryPassageRow.tsx` → `label`.

### 6.2c Language of the text
Adventures are Chinese by design, but **nothing enforces it** (owner's call 2026-11-20):
authors write what they like, English included. The engine already handles English words
in a Chinese text (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "English words"), so no special
case is needed.

### 6.3 Backend (layers — docs/BACKEND_LAYERING.md) — BUILT 2026-11-20
- **Contract** `server/contracts/stories.ts` — every wire type, the input caps
  (`STORY_MAX_CHOICES`, `STORY_PASSAGE_MAX_LENGTH`, …), and two pure rules both halves use:
  `computeStoryCommonality` (§ 6.2a) and `storyPublishWarnings` (the checks below). The client
  imports this file directly — no hand-kept mirror.
- **DAL** `server/dal/interfaces/IStoryDAL.ts` / `server/dal/implementations/StoryDAL.ts` —
  SQL only. The passage + choices read is one query (`PASSAGE_SELECT`, choices folded into a
  jsonb array). `listForViewer` returns all four list-card fields per story in one query.
  `isAuthor` is the ONLY read of users."isAuthor" (not `UserDAL.findById`), which keeps the
  column out of every non-cyoa request.
- **Service** `server/services/StoryService.ts` — visibility, the two write checks, the
  progression rules (`arrive`: an ending records + clears progress; a passage with only
  targetless choices is "To be continued" and keeps progress), choice/target validation,
  start-passage delete refusal, publish (`computeCommonality`). Malformed ids 404 before any
  query (`isUuid`).
- **Controller** `server/controllers/StoryController.ts`; **routes**
  `server/routes/storyRoutes.ts`, mounted in `server/server.ts` behind the flag.
- **Tests** `server/__tests__/stories.test.ts` — the pure rules, plus the service against an
  in-memory DAL.

| Endpoint | Who | Returns |
|---|---|---|
| `GET /api/stories` | anyone | `StoryListResponse` — `isAuthor` + published stories and the caller's own drafts |
| `GET /api/stories/:id/play` | anyone who can see it | `StoryPlayResponse` — the resume passage (or the start), plus `next` |
| `POST /api/stories/:id/choose` `{choiceId}` | same | `StoryPlayResponse` — the target passage; `ending` set when it is one; plus `next` |
| `POST /api/stories` `{title, iconId?}` | author | 201 `StoryEditResponse` — new story + empty start passage |
| `GET /api/stories/:id/edit` | own story | `StoryEditResponse` — whole graph + live `warnings` |
| `PATCH /api/stories/:id` `{title?, iconId?, startPassageId?}` | own story | `StoryEditResponse` |
| `DELETE /api/stories/:id` | own story | 204 |
| `POST /api/stories/:id/passages` | own story | 201 `StoryPassageEdit` (empty) |
| `POST /api/stories/:id/passages/:passageId/duplicate` | own story | `StoryEditResponse` (201) — the passage copied into a new one right after it (`StoryService.duplicatePassage`, § 5.4) |
| `PUT /api/stories/:id/passages/order` `{passageIds}` | own story | `StoryEditResponse` — exactly the story's passage ids in the new order, else 400 (`StoryService.reorderPassages`, § 5.3). Registered before `/:passageId` |
| `PUT /api/stories/:id/passages/:passageId` `{content, name?, endingTitle?, choices[], expectedUpdatedAt?}` | own story | `StoryPassageEdit` — choices REPLACED. 409 when `expectedUpdatedAt` is sent and the passage was saved since (`StoryService.savePassage`) |
| `DELETE /api/stories/:id/passages/:passageId` | own story | 204 (400 for the start passage) |
| `POST /api/stories/:id/publish` | own story | `StoryPublishResponse` — `publishedAt`, `commonality`, `warnings` |
| `POST /api/stories/:id/unpublish` | own story | 204 |

Status codes the client must handle: **404** "This story is no longer available" (unpublished
or deleted — the learner page's "no longer available" state); **400** on `choose` when the
choice is not on the learner's current passage (stale tab — re-read `/play`) or is "coming
soon"; **403** for a non-author or another author's story.

**Policy:**
- **Publish WARNS, it does not block** (owner's call 2026-11-20). The checks — a start
  passage set, every choice has a target, every passage reachable from the start, at least
  one ending, every ending named — come back as a list of warnings the editor shows, and
  the author can publish anyway. A published choice with no target shows to learners
  **disabled** — greyed, with a "coming soon" hint, not tappable (owner's call
  2026-11-20) — a teaser for an unwritten branch rather than a dead button.
- **Unpublish keeps, delete wipes** (owner's call 2026-11-20): unpublishing hides the
  story but keeps learners' `story_progress` and `story_endings_found` rows, so
  republishing restores them; deleting the story cascades every row away. A learner who
  has the page open when it is unpublished gets a 404 "no longer available" on their
  next pick (the service treats an unpublished story exactly like a missing one for
  everyone but its author).
- **Edits go live mid-play.** Choices are replaced on every save (new ids), so a learner
  holding a stale passage gets the 400 "not on your current passage" and the client
  re-reads `/play`.
- Every write is checked twice: `isAuthor`, and that the story's `authorUserId` is the
  caller.
- **Prefetch (`next`).** Every `StoryPlayResponse` carries `next: Record<choiceId,
  StoryPlayStep>` — what each available choice leads to, built by `StoryService.arrive` →
  `buildStep`, the same code `/choose` serves with, so the prediction equals the confirmed
  answer (a prefetched ending predicts its **New!** badge from `IStoryDAL.listEndingsFound`
  and the count it ticks to). One level deep: at most `STORY_MAX_CHOICES` extra passage
  reads per response, and the payload grows by up to four passages. A prediction goes stale
  only when the author edits mid-read; `/choose` then answers with the truth or a 400.
- **Feature flag** `FEATURE_FLAGS.cyoa` (docs/FEATURE_FLAGS.md § 2i) — the router mount, the
  client routes and the Menu row. **ON** since 2026-11-20; needs migration 196.

---

## 7. Routing and entry point

User-facing name: **Adventures** (owner's call 2026-11-20). Entry point: a **Menu
popover** row next to Reader, behind `FEATURE_FLAGS.cyoa`.
- `/adventures` — the story list: a **node** page that keeps the footer with the Menu tab
  lit, exactly like `/reader` (this section said "Leaf" before it was built; node is what
  a Menu destination is everywhere else)
- `/adventures/:id` — the reader: a footerless node-style drill-in, like `/reader/:id`
- `/adventures/:id/edit` — the author's story editor, and `/adventures/:id/edit/:passageId`
  — the passage editor (§ 5.1). Both footerless node drill-ins; open to any signed-in user
  at the route, the server answering 403 to anyone but the story's author

Recorded in docs/ACTIVE_DUTY_PAGES.md § "Routes".

### 7.1 Client files — BUILT 2026-11-21

All in `src/features/cyoa/` unless noted (presentation + client-state layers,
docs/FRONTEND_LAYERING.md). Nothing imports from `src/features/reader/`; the reading engine
comes from `src/reading/` (§ 4).

| File | Layer | What it is |
|---|---|---|
| `src/api/stories.ts` | API | `fetchStories`, `fetchStoryPlay`, `chooseStoryChoice`, via `src/api/http.ts`; wire types from `server/contracts/stories.ts` |
| `adventuresPaths.ts` | constants | `ADVENTURES_LIST_PATH`, `storyPlayPath` |
| `AdventuresPage.tsx` | page | `/adventures`: a 2-column grid of 4:5 cards in the Reader grid's skin, in the server's order. A card shows the icon (green ramp tile), title, the commonality meter + "Endings f/t", and a corner chip: **Draft** (author's unpublished) or **In progress** |
| `useStoryPlay.ts` | client state | load `/play`, `choose()`: shows the prefetched `next[choiceId]` at once and confirms with `/choose` in the background (a pick before the confirmation lands is queued and replayed); on a 400 (stale choice) re-reads `/play` and shows a notice; on 404 → "no longer available"; on a network failure puts the previous passage back. Keeps `endingsFoundBefore` for the end panel's tick. The decisions are pure functions in `storyPlayModel.ts` |
| `storyPlayModel.ts` | model (pure, tested) | `planPick` (queue / predict / wait), `planChooseFailure` (unavailable / re-read / revert), `shouldReplayQueued`, `endingsFoundBeforeFor` — tests in `__tests__/storyPlayModel.test.ts` |
| `StoryPlayPage.tsx` | page | `/adventures/:id`: header with no title (Back → `location.state.from` when the opener set it, else the list), the top tab + rdb, the passage's reading box, the foot (notice, choice stack or end panel, bottom tab), the eip. Composes the engine: `useContentVocabulary` over passage + labels, two `useReadingText`s (passage, inspected label), `useReadingKeycap` on the active one, `useReadingVocabSync` |
| `StoryChoiceStack.tsx` | presentation | the choice keys with the inspect key in a sunken `look.well` socket; inspect mode (✕, others dim and lock, the label becomes the page's `inspectedLabel` reading box and does not pick); unavailable choices faded with "Coming soon" |
| `StoryEdgeTab.tsx` | presentation | the chevron tab (§ 3.4); `edge="top" \| "bottom"` |
| `StoryEndPanel.tsx` | presentation | `kind="ending"` (name or "The End", **New!** badge, endings count ticking from the old value) and `kind="toBeContinued"`; both have one action, Back to Adventures |
| `cyoaStyles.ts` | styles | muted / message / pill fragments (re-exported from `src/reading/readerStyles.ts`), `storyKeyShadow` (rounded edge + straight lip), the editor's card / field / chip fragments |

Wiring outside the feature: `src/routes/routeMeta.ts` (four rows — the two editor routes are § 5.1 — + a `FLAGGED_OFF_PATHS` entry),
`src/routes/registry.ts`, `src/components/menuPopover/menuDestinations.ts` (Adventures row,
`auto_stories`, `grn`, right after Reader), `src/constants.ts` → `MINUTE_POINTS_ELIGIBLE_PAGES`.

Behaviour as built, where the design left room:
- **A pick never waits** (§ 3.3) — the targets are prefetched (`next`, § 6.3). The stack
  dims only when a pick is made before the previous pick's confirmation lands (the
  prediction has no `next` of its own), or when there is no prediction at all.
- **A new passage resets the foot**: inspect mode closes and the choice stack unfolds.
- **Folding the choices also leaves inspect mode**, so the ✕ is never hidden.
- **Choice keys and tabs** are `look.surface` faces on a `look.surfaceEdge` straight lip
  with the rounded edge; the socket is `look.well` with the `look.wellShadow` inner lip.
  Every colour comes from the Tier 2 look or RAMP.

- **A new passage starts like a freshly opened Reader document**: nothing selected (the rdb
  shows the tap demo — its finger animation only the first time on the page), caret at
  the top, both panels showing.
- **The story's language** comes with the play step (`StoryPlayStep.story.language`), so the
  engine reads the text as the story's language, not the learner's selected one.

---

## 8. Minute points, marks and vocab

**Same as the Reader** (owner's call 2026-11-20). The Reader earns minute points
(`/reader` is in `MINUTE_POINTS_ELIGIBLE_PAGES`, `src/constants.ts`; accrual starts on
the first interaction — docs/MINUTE_POINTS_SYSTEM.md) and **never marks cards**; looking
a word up, adding it to Learning from the keycap or the eip, and Sentence Explain are the
only card touches. So `/adventures` joins `MINUTE_POINTS_ELIGIBLE_PAGES`, and nothing else
changes. Finding an ending earns no bonus.

**Writing English in the editors does not count (owner, 2026-11-21).** On the story editor
and the passage editor, interactions while the system **abc** keyboard is up are not
minute-points activity. 写 and ā (pinyin practice) count, and so does the page with no
keyboard up (rereading, reordering, buttons). Every interaction is ignored while abc is up, not
just keystrokes, because on a phone the OS keyboard's taps never reach the document anyway.
This is **suppression, not a pause**: a running clock still drains its 15 s idle window
(docs/MINUTE_POINTS_SYSTEM.md § "Suppressed activity"). Code:
`src/features/cyoa/useAbcTypingIsNotActivity.ts`, called by `StoryEditorPage` and
`PassageEditorPage`; reads `useActiveKeyboardSource()` (docs/BEGINNER_KEYBOARD.md § 6z-15).

## 9. Build order (proposed)

1. ✅ Box-less reading-area restyle (shared, shipped on the Reader).
2. ✅ Shared reading engine extracted to `src/reading/` (2026-11-21, § 4), no behaviour
   change intended on the Reader; the cyoa style copies became re-exports (DEFERRED_WORK
   item 60).
3. ✅ Migration 196 + backend (2026-11-20, done before step 2 since it does not touch the
   Reader). On PPE since 2026-11-21 (migrations 196–199).
4. ✅ Learner page (§ 7.1): list, play page, choices, end panel, both tabs (2026-11-20);
   the reading box, the rdb + eip and inspect's mini reader (2026-11-21). The Pinyin toggle was
   dropped; the header audio chip was added back sharing the Reader's setting (§ 3.1).
5. Editor — **first cut built 2026-11-20** (§ 5.1). Next: the body field becomes the
   shared `TextArea` (+ undo/redo).

---

## 10. Open questions

| # | Question | Status |
|---|---|---|
| Q-1 | Engine home: shared `src/reading/` vs. cyoa nested inside `features/reader/`? | **`src/reading/`** (2026-11-20) |
| Q-2 | Author permission: new column, or reuse `isFeatureTester` / `isAdmin`? | **new `users."isAuthor"`** (2026-11-20) |
| Q-3 | Story graph; editor shape | **free graph; passage-list editor** (2026-11-20) |
| Q-4 | Where the rdb / choices show-hide toggles live | **edge indicators**: top for the rdb, bottom for the choices (2026-11-20). **chevron tab, tap only** |
| Q-5 | Are choice labels read with the engine too? | **yes — via the inspect key's in-button mini reader** (2026-11-20, § 3.2). **no English by design, but not enforced** (§ 6.2c) |
| Q-6 | Is progress saved? | **yes** (2026-11-20, § 3.3). **choices are final**, no step back |
| Q-7 | What does an ending show? | **the endings-found stat, e.g. 2/7** (2026-11-20, § 3.6). **No start over** — back to the list only; reaching an ending clears the resume point (§ 3.6) |
| Q-8 | Name, routes, entry point | **Adventures, `/adventures`, Menu popover row** (2026-11-20) |
| Q-9 | Box-less Reader edit field: keep? | **keep** (2026-11-20) |
| Q-10 | Inspect mode details (§ 3.2) | **main rdb; other buttons dim + lock; key swaps to ✕; passage selection parked and restored** (2026-11-20). **must close inspect mode before picking** |
| Q-11 | Story difficulty rule | **90% coverage of distinct words, stored in `stories."difficulty"`** (2026-11-20, § 6.2a). **Superseded 2026-11-21:** the same rule on commonality, stored in `stories."commonality"` (migration 200) |
| Q-12 | `story_passages."endingTitle"` | **approved** (2026-11-20) |
| Q-12a | `story_passages.name` (author-only passage name, § 6.2d) | **approved** (2026-11-20) — nullable, max 200, shown in rows / target picker / incoming lines, saved with the draft |
| Q-12b | `story_passages_seen` (§ 3.6b, pages found x/y on the end card) | **approved** (2026-11-21) — distinct passages ever served, across plays, out of the story's passage count; chosen over a per-run "pages read" count |
| Q-12c | `story_passages.position` (§ 5.3, drag to reorder) | **approved** (2026-11-21) — integer, backfilled in creation order, unique per story; "Passage n" follows the list position |
| Q-13 | A published choice with no target | **shown disabled, "coming soon"** (2026-11-20, § 6.3) |
