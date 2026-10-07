# Practice Writing (Character Writing-Practice Drill)

Reference for the **"Practice Writing Me"** feature: a drill where the user draws a
Chinese character by finger/mouse across four assistance levels, the strokes are
recognized, and each level cleared earns a star. This doc covers the **UX, state,
and interaction logic** of the practice surface. The **recognition path** itself
(canonical `Ink` stroke format, the Google/HanziLookup backends, the
`POST /api/handwriting/recognize` proxy, the Hanzi Writer guide) lives in
[HANDWRITING_RECOGNITION.md](./HANDWRITING_RECOGNITION.md) — read that for anything
about *how strokes become candidate characters*.

> **Status: IMPLEMENTED.** Chinese (`zh`) only, words of **1–4 characters**.
>
> **Eight levels since 2026-10-04** (built on dev). The level table, the shared
> `useLevelGuide` / `useStrokeClock` machinery, the Writing Grid game, the writing flp and
> the per-character writing marks are in [WRITING_PRACTICE_REWORK.md](./WRITING_PRACTICE_REWORK.md);
> this doc covers the popup's own UX.

---

## Layer / file map

| Layer | Responsibility | File |
|---|---|---|
| Presentation (entry) | `PracticeWritingButton` — opens the popup; owns the per-character completed-level set (stars) | `src/components/handwriting/PracticeWritingButton.tsx` |
| Presentation (surface) | `PracticeWritingPopup` — the modal: level tabs, single panel vs 2×2 grid, lockout, lifecycle, grading | `src/components/handwriting/PracticeWritingPopup.tsx` |
| Presentation (rectangle) | `WritingPanel` — the one bordered rectangle every focused surface draws in (header / canvas / Clear-Undo-assist-Verify footer); `WritingPanelLevelLabel` | `src/components/handwriting/WritingPanel.tsx` |
| Presentation (selector) | `WritingSelectorPanel` — the multi-character word's rectangle: same shell + bands, a 2×2 slot grid as its body, Verify footer | `src/components/handwriting/WritingSelectorPanel.tsx` |
| Presentation (motion) | `useProjectionMorph` — the grow-from-origin / shrink-back projection both rectangles open and close with | `src/components/handwriting/useProjectionMorph.ts` |
| Presentation (styles) | `PANEL_RADIUS`, `WRITING_PANEL_SHELL_SX` / `_HEADER_SX` / `_FOOTER_SX` / `_ACTION_SX` — the rectangles' shared look | `src/components/handwriting/writingPanelStyles.ts` |
| Presentation (panel) | `WritingStage` — one panel = guide + capture canvas + ✓/✗ + spinner + "no writing" badge | `src/components/handwriting/WritingStage.tsx` |
| Presentation (guide) | `HanziGuide` — display-only Hanzi Writer grey outline + stroke-order animation | `src/components/handwriting/HanziGuide.tsx`, `loadCharData.ts` |
| Presentation (capture) | `WritingCanvas` — DIY pointer-events canvas → emits `Ink`; draw-lock + blocked-attempt signal | `src/components/handwriting/WritingCanvas.tsx` |
| Client API | recognition + completion fetch/record | `recognize.ts`, `completions.ts` |
| Client (drafts) | preserve-on-close per-word draft | `writingDraftStore.ts` |
| Server API | recognition proxy + completion routes | `server/server.ts` |
| Server (store) | completion persistence + level allow-list | `server/utils/writingPracticeStore.ts` |
| Server (recognizer) | canonical `Ink` → Google Input Tools | `server/utils/handwritingRecognizer.ts` |
| Persistence | completion state (stars) | `database/migrations/81-create-writing-practice-completions-table.sql` |

---

## Entry points (`PracticeWritingButton`)

The button renders only for **`language === "zh"`** and **1–4 code points**
(`charCount`), else `null` (the recognizer is `zh_CN`; the 2×2 grid has only four
slots). Placements:

There is exactly **one** entry point per page, the `Write it` pill on `WordToolsRail`
(`src/components/WordToolsRail.tsx`, `rail` appearance) — a rail **above** the card and
outside its boundary, because the drill acts on the WORD, not on the card. Hosts:

- **flp** — `src/features/flashcards/FlashcardsLearnPage/FlashcardsLearnPage.tsx`
- **vocab cdp** — `src/features/flashcards/VocabCardDetailPage.tsx`
- **dictionary cdp** — `src/features/dictionary/DictionaryCardDetailPage.tsx` (rail
  rendered without `onCompare`, so only the `Write it` pill shows; the adapted det
  entry has no vet row, so the drill records no Writing mark)

**Removed placements.** The compact `icon` button that stacked above the speaker on the
card face (`ChineseBlock`'s `showWriting` prop) was deleted on 2026-08-28 — a relic of
the pre-rail design that put a word tool inside the card. `ChineseBlock` now renders the
speaker only, and the `icon` appearance + `hideStarBadge` prop are gone with it. The eip's
`InfoCardActionBar` (labelled variant) was deleted earlier, when the panel became
information-only.

The button owns `completedLevels: Set<string>` as the single source of truth: it
fetches on mount (`fetchCompletedLevels`), passes it into the popup, and updates it
when the popup reports a fresh completion. The popup is always rendered (controlled
by `open`).

**Star badge.** A gold `★N` superscript (N = completed levels) shows on the button
via `withStarBadge`, on every surface (it is hidden only at a count of zero).

---

## The eight levels

The levels, their stored `mode`s and their behaviour are in
[WRITING_PRACTICE_REWORK.md § 1](./WRITING_PRACTICE_REWORK.md) (`WRITING_LEVELS` in
`server/contracts/writingLevels.ts`, `LEVEL_BEHAVIOR` in
`src/components/handwriting/levelBehavior.ts`). The popup holds `levelIndex` and runs the
active surface through `useLevelGuide(mode)` (`outlineVisible`, `regionIndex`, `playNonce`,
`drawLocked`, `blocked`, `loading`, `cooldownSec`; `enter` / `leave` / `press` /
`blockedAttempt`). Single-character mode enters the level on a level change; the 2×2 grid
enters it on focusing a slot.

**Display names vs. modes.** The names learners see differ from the `mode` ids this
doc and the code use (renamed 2026-10-04, display only — `WRITING_LEVELS[].name`):

| Level | Shown as | `mode` / name used in this doc |
|---|---|---|
| 1 | Walk-through | `snap` — "Snap" |
| 3 | Step-through | `walkthrough` — "Step Through" |
| 7 | Blank | `test` — "Test" |

**Level stepper.** `LevelStepper` (‹ Level N ›, the name under it, ★ when cleared, eight
dots — gold for cleared levels, ink ring on the current one) replaced the four-tab bar.

**Assist button** (absolutely positioned under the panel, so showing / hiding it never
shifts the panel): the level's `button` label — Replay / Show / Next — with a live `Ns`
cooldown. Level 8 shows **Retry** once the active character's clock has run out (single
character: after the automatic Verify), which wipes every character's ink and clock.

**Level 8 (Timed).** `useStrokeClock` runs one clock per character; the panel shows a
draining bar + seconds (`WritingStage` `clock`). Single character: time-out auto-Verifies.
2–4 characters: the timed-out slot locks and is graded by the next Verify.

### Memorize study-first lock
On entry: `outlineVisible = true`, `drawLocked = true`, **no timer** (study as long
as you want). Cue while locked (`useLevelGuide` → `blocked`, i.e. the `study` guide
with `drawLocked`):

- **"No writing" badge** — a red circle-with-a-slash (`Block` icon, `COLORS.redMain`)
  in the panel's top-left corner (`WritingStage` `blocked` prop).

There is **no unlock button**. The first stroke itself unlocks: a `pointerdown`
while locked fires `WritingCanvas`'s `onBlockedAttempt`, which every host wires to
`useLevelGuide` → `blockedAttempt`. That hides the guide, clears `drawLocked` and
returns `true`; `WritingCanvas.onDown` reads the return value — `true` means
"unlocked, continue" — so the **same pointerdown** falls through and starts the
stroke, instead of being swallowed. No timer/cooldown, no lock spinner (the lock is
open-ended).

### Snap (Level 1): strokes snap into the printed shape
The most-assisted level. The outline stays up and **only the next stroke to write**
animates on the guide, on repeat, in `--faint` (`HanziGuide` → `loopStrokeIndex`; darker
than the `--line2` outline, lighter than ink). On each pen-up the stroke is judged
against that next expected stroke (`WritingCanvas` → `onStrokeEnd`, wired by
`WritingStage` when `snap` is set):

- **Match** → the learner's stroke is replaced. The stage paints the corpus stroke
  **shape** (the tapered, brush-like path) in ink, fading in over 180 ms
  (`WritingStage` → `SnappedStrokes`), and the ink data becomes the stroke's
  **median** line in canvas px (`strokeSnap.ts` → `medianToStroke`, timestamps spread
  over the learner's own stroke) — so Verify grades the canonical shape and
  Undo / Redo / drafts work unchanged. The canvas stops pen-drawing committed strokes
  (`hideCommittedInk`) so the printed shapes are the only ink visible.
- **Miss** (wrong shape, wrong place, backwards, out of order) → the stroke turns red
  (`COLORS.redMk`), holds 250 ms, fades out over 450 ms, and is **never added to the
  ink**.

Strokes must come in order: only the NEXT stroke is ever matched. The cue moves on as
the ink grows; after the last stroke it stops.

**The matcher** (`src/components/handwriting/strokeSnap.ts` → `strokeMatchesMedian`)
compares in the canvas's px space, **position included** — unlike the beginner
keyboard's matcher (`inkGeometry.ts` → `fingerprint`), which normalizes position away.
Both strokes are resampled by arc length to 16 points; a match needs the drawn/expected
length ratio in 0.4–2.2, start-to-start and end-to-end within 0.2 of the glyph box, and
the mean pointwise distance within 0.12 of the glyph box. All thresholds are starting
values to tune from play. Font → canvas mapping is `guideToCanvas`, built on the same
`guidePadding` HanziGuide hands Hanzi Writer, so the printed shapes land exactly on the
outline. Tests: `src/__tests__/strokeSnap.test.ts`.

**No corpus data** (a glyph missing from `hanzi-writer-data`, or still loading) → Snap
falls back to plain ink: nothing is judged or replaced.

### Step Through: a stroke cuts the entry flash short
Step Through opens with a 1.5s flash of the outline with drawing locked (corner
spinner). A `pointerdown` during that **entry** flash goes through the same
`blockedAttempt` path: the flash timer is cancelled, the outline hides, drawing
unlocks and the same pointerdown starts the stroke. A flash started by the **Show**
button is a deliberate look and is NOT cut short — `blockedAttempt` returns `false`
and the press is swallowed. `useLevelGuide` tells the two apart with
`entryFlashRef`, set only by `enter`.

---

### Guide fade (Step Through + Memorize only)
`HanziGuide` draws Hanzi Writer's outline once its data loads and leaves it drawn;
showing / hiding is the container's opacity, so the outline, Trace's looped strokes and
Snap's next-stroke cue show / hide as one layer. Fades (`GUIDE_FADE_MS`, 220 ms) are
opt-in per direction, decided by `levelBehavior.ts` → `guideFades(mode)` and passed
through `WritingStage` (`guideFadeIn` / `guideFadeOut`) by the editing hosts:

| Level | Fade in | Fade out |
|---|---|---|
| Step Through (`flash`) | Show press | entry flash / Show flash ending, cut short by a stroke |
| Memorize (`study`) | — | first stroke clearing the study guide |
| every other level | — | — |

Everything else is **instant**: a canvas that starts with the guide (mount, a level
change, a new character — even on Step Through, whose entry flash is drawn, not faded
in), the Quarters / Sixths region cycle (a plain `regionClip` swap), the post-Verify
reveal (the popup turns `guideFadeIn` off while `verifyRevealed`), and every read-only
preview (grid slots, writing flp cells, Writing Grid cells pass no fade flags).

A change that needs a new Hanzi Writer instance — another character, another level
(`resetKey`, fed from `WritingStage` → `guideKey`), the loop toggling — applies at once
when its target shows the guide; when its target hides it and the old guide is fading
out, it waits for that fade to finish. `WritingStage` keeps `HanziGuide` mounted from the
first time `showGuide` is true (a level with no guide passes `outlineVisible = false`
instead of unmounting); a stage that never shows a guide never creates a writer.

Code: `src/components/handwriting/HanziGuide.tsx` → `GUIDE_FADE_MS`, `GuideConfig`,
`instantReveal`; `src/components/handwriting/levelBehavior.ts` → `guideFades`;
`src/components/handwriting/WritingStage.tsx` → `guideMounted`.

## Capture & draw-lock (`WritingCanvas`)

- Pointer Events only; `setPointerCapture` on down so a stroke that leaves the canvas
  still completes. Ink is drawn imperatively (the source of truth is `inkRef`, not
  React state) because a stroke can carry hundreds of points.
- `disabled` (= `!drawable || drawLocked`) blocks new strokes. A `pointerdown` while
  disabled calls `onBlockedAttempt`; if it returns `true` (caller unlocked in
  response, e.g. Memorize) the same pointerdown falls through and starts a stroke,
  otherwise it's swallowed (no stroke started).
- Imperative handle (`WritingCanvasHandle`): `clear` / `undo` / `redo` / `canRedo` / `getInk` / `isEmpty`. `redo` / `canRedo` are used only by the Beginner Keyboard (docs/BEGINNER_KEYBOARD.md § 6r); Practice Writing has no redo key.
- `tool` (`"pen"` default | `"eraser"`) + `eraserRadius`: the **partial eraser** — a drag
  cuts the ink it passes through and splits strokes around the cut, so the result is still
  real strokes (`inkErase.ts` → `eraseSweep`). An erase empties the redo stack like a new
  stroke does, and reports `onInkChange` on release. Practice Writing never passes it; only
  the Writing Notebook does ([WRITING_NOTEBOOK.md § Canvas](./WRITING_NOTEBOOK.md)).
- **Touch/selection safety:** `touchAction: none` (no scroll / edge-swipe) plus
  `userSelect/WebkitUserSelect/WebkitTouchCallout: none` so a draw gesture can never
  start a text selection that bleeds into the page underneath. (See also the global
  `@media (pointer: coarse)` cpcd rule in `index.css` — cpcd pinyin is never
  selectable on mobile.)

---

## Single character vs 2–4 characters

`chars = [...character]` (code-point aware). `isMulti = chars.length > 1`. Words longer
than `WRITING_MAX_CHARS` (4, `server/contracts/writingLevels.ts`) never reach the popup —
`usePracticeWriting` marks them ineligible and the mark endpoint refuses them.

- **Single (`singleBody`)** — one `WritingPanel`: the **embedded** `LevelStepper` as its
  header, the canvas, and Clear / Undo + the level's assist button + **Verify** in its
  footer. It grows out of the launcher the learner tapped (the popup's `origin` prop —
  a Writing Center tile, the Practice Writing button) and shrinks back into it on
  close. The canvas is always present, so the guide is entered in the level/open effect.
- **Multi (2–4)** — a **`WritingSelectorPanel`** (`gridBody`): the same rectangle as
  the single panel one zoom level up — the **embedded** `LevelStepper` as its header, a
  **2×2 grid** of read-only previews as its body (chars fill `0→TL, 1→TR, 2→BL, 3→BR`),
  **Verify** right-anchored in its footer. It projects out of the launcher (`origin`)
  exactly like the single panel, with the slot grid as the part that lands on it, and
  shrinks back into it on close. Tapping a slot **projects again** into a focused
  `WritingPanel` (`focusOverlay`) drawn over the still-mounted selector and its own scrim: a `WritingPanelLevelLabel` header (the level
  is fixed while focused), Clear / Undo + assist in the footer, no Verify / stepper.
  There is **no Back button** — tapping the scrim collapses the slot (see below):
  `collapseFocus` writes the ink back into `inks` first (so the slot underneath already
  shows it), shrinks the panel back into the slot, then clears `focusedIndex`.
  Verify (selector only) recognizes **all** characters at once. So a Writing Center
  word tile goes tile → selector → canvas, two projections in one motion language.

**Coordinate space.** Every panel — focused or grid preview — captures/seeds ink in
the same `FOCUS_SIZE` (300px) space; grid previews are the full-size stage CSS-scaled
down (`GRID_SCALE`), so a preview and its enlarged panel share one coordinate system
and recognition is identical regardless of on-screen size.

**Grid-preview guide rule** (per slot, `levelPreview(mode)` in
`src/components/handwriting/levelBehavior.ts`, shared with the writing flp's cells): a
preview shows **what the learner will first see when they expand the slot** — the state
`useLevelGuide.enter()` opens the editor in. Reopening re-enters the level, so this holds
with or without writing in the slot (the ink draws on top):
- **Trace** → the full outline with the stroke order looping.
- **Snap / Step Through** → the full outline (static). Snap's next-stroke
  animation is an editor-only cue; its snapped ink paints as printed shapes
  (`LevelPreview.snap`).
- **Quarters / Sixths** → only the **first region** (top-left), clipped as in the editor.
- **Memorize / Blank / Timed** → no outline. **Memorize is the one exception to "first see"**
  (2026-10-04): its editor opens on the outline, but that's the **study phase**. The learner
  enters it deliberately by opening the slot, and their first stroke ends it. Previewing it
  would give the study away before they chose to study. Until 2026-10-04 Memorize previewed
  the full outline on both this grid and the writing flp card.
- `previewShowsWholeCharacter(mode)` is true exactly for levels 1–3 (Snap / Trace / Step
  Through). The writing flp's used-in bubbles read it.
- **Post-Verify override** → after a Verify the guide is revealed on **every** slot
  regardless of level (see [Grading](#grading-verify)).

---

## The writing panel (`WritingPanel`)

Every focused writing surface — the popup's single-character panel and focused 2×2
slot, `WritingFocusEditor` (Writing Grid game, writing flp card) and the Writing
Notebook's `NotebookCellEditor` — draws in ONE bordered rectangle, `src/components/handwriting/WritingPanel.tsx`. The popup's
multi-character selector (`WritingSelectorPanel`) reuses its shell and bands
(`writingPanelStyles.ts`) with the slot grid in place of the canvas:

| Band | Contents | Notes |
|---|---|---|
| Header (`--header` band) | The level **picker** (`LevelStepper embedded`, popup single-char) or the level **label** (`WritingPanelLevelLabel`: "Level N · Name [· pinyin]") | Picker only where changing level is allowed |
| Canvas | The host's `WritingStage`, exactly `size` × `size` (`WRITING_FOCUS_SIZE`) | The panel adds only its 1px border around it |
| Footer (fixed 52px) | **With `verify`** (popup single-character): Clear · Undo on the left, `assist` + Verify on the right. **Without** (tap-out surfaces — focused slot, `WritingFocusEditor`): Clear · Undo [· `assist`] centred and evenly spaced | With Verify the actions are right-anchored, so an assist button appearing / vanishing never moves Clear/Undo; fixed height either way, so the panel never resizes |

Two optional variations, used only by the Writing Notebook
([WRITING_NOTEBOOK.md § Canvas](./WRITING_NOTEBOOK.md)): omitting `header` drops the
header band entirely, and passing `tools` replaces the whole default footer (Clear / Undo /
assist / Verify) with the caller's row — the notebook's Pen / Eraser toggle.

Action buttons share `WRITING_PANEL_ACTION_SX` (outlined per the buttons rule; disabled
= solid light grey with a live cooldown).

**Grow / shrink morph (the projection).** Implemented once in `useProjectionMorph`
(`src/components/handwriting/useProjectionMorph.ts`), used by both rectangles; each
names its **anchor** — `WritingPanel` its canvas, `WritingSelectorPanel` its slot grid.
A host passes the element the learner tapped as `origin`. On mount (layout effect,
before first paint) the rectangle measures it and animates from a frame where its
**anchor** sits centred on the origin at a uniform fitted scale, everything around it
clipped away (`clip-path: inset(…)`, corner radius read from the origin's computed
`border-radius`) — then to rest. The resting radius (`restRadius`) is one value or four
per-corner `CornerRadii`; a headerless `WritingPanel` (the Writing Notebook) only lightly
rounds its top two corners (`PANEL_SQUARE_TOP_RADIUS`). Because
every preview cell renders the same full-size `WritingStage` scaled down (shared
coordinate space, below), the cell appears to open into the canvas. `collapse()` (via
the forwarded `WritingPanelHandle`) runs the reverse — re-measuring the origin if it is
still in the DOM, else using the open-time rect — disables pointer input, and resolves
when done; hosts read the ink **before** collapsing and unmount / hand it back **after**.
`companions` (the host's scrim, hint) fade with it. No origin → a short fade/scale-in.
`prefers-reduced-motion` skips the morph entirely. Web Animations API on the DOM
nodes, so the morph never re-renders React.

| Surface | `origin` | Host |
|---|---|---|
| Writing Grid game cell | the board cell (`WritingGridBoard` → `onOpenCell(i, el)`) | `WritingGridPage` → `WritingFocusEditor` |
| Writing flp card cell | the card-face cell (`WritingCardFace` → `onOpenCell(i, el)`) | `useWritingFlashcard` → `WritingFocusEditor` (Dialog with `hideBackdrop` + `transitionDuration={0}`, so only the editor's own scrim fades) |
| Popup 2×2 slot | the slot (`focusSlot(i, el)`) | `PracticeWritingPopup` → `focusOverlay` |
| Popup single character | the launcher (`PracticeWritingButton`, `WritingPracticeGrid` tile) | `PracticeWritingPopup` → `singleBody` (`WritingPanel`) |
| Popup 2–4 characters | the launcher (`PracticeWritingButton`, `WritingPracticeGrid` tile) | `PracticeWritingPopup` → `gridBody` (`WritingSelectorPanel`) |

The popup's Dialog runs with `transitionDuration={0}`; its backdrop (`slotProps.backdrop.ref`)
is a **companion** of the outer rectangle, so it dims and clears in lockstep with the
projection instead of on MUI's own Fade timing — the same arrangement as
`WritingFocusEditor`'s scrim.

---

## Generalized lockout + greyed-background step-back

While the popup is open it is a single modal layer. **One** set of gesture handlers
on the popup root (`rootLockHandlers` in `PracticeWritingPopup.tsx`) absorbs **every**
pointer/touch/mouse/click event via `stopPropagation`, so nothing leaks to the page
underneath (notably the flp flashcard's drag/flip handlers and the eip sheet). This
replaces ad-hoc per-island `stopPropagation`.

The **greyed background** — a tap whose `target === currentTarget` (the dark area
around the floating islands, not an island) — **steps back one level** via
`handleBackgroundTap`: a focused grid slot collapses to the **2×2 grid**; the grid /
single-char view **closes** the popup. Taps on an island are locked here too but skip
the step-back. There are **no explicit close/back controls** — the greyed background is
the only step-back/exit affordance (plus, on desktop, the Dialog's own backdrop outside
the 402px phone card, which closes via `onClose`). The Dialog's Paper is sized by
`PHONE_OVERLAY_SX` (`src/components/phoneGeometry.ts`) so it stays pinned to the
real frame — it used to hard-copy the frame's dimensions and drifted when they
changed (SHELF_REDESIGN A2c).

---

## Grading (Verify)

`handleVerify` sends each character's strokes to `recognizeHandwriting`
(→ `POST /api/handwriting/recognize`) **in parallel**. A character is **correct iff
`target === top1`** (the recognizer's #1 candidate) — strictly top-1 so writing a
*different* character is never accepted. Per-slot result overlay is ✓
(`COLORS.greenMain`) / ✗ (`COLORS.redMain`); an empty panel counts as ✗. Redrawing a
panel invalidates that character's prior result back to `idle`.

The level's **star** is awarded only when **every** character is correct in a single
Verify (and the level isn't already completed).

**Writing marks.** Every Verify hands `{ level, perChar }` to `onWritingResult`
(`usePracticeWriting`), which posts ONE writing mark on the word's card carrying that
payload; the server fans it out onto each character's own card behind the anti-farming
gate (WRITING_PRACTICE_REWORK.md § 3a). The dictionary cdp passes no card, so it marks
nothing.

**Post-Verify guide reveal.** A successful or failed Verify flips `verifyRevealed`,
which forces the grey guide visible on **every** panel — single, focused, and all
grid slots — on **every level** (even Blank / Timed, which normally show no guide, and
the region levels, where it shows the WHOLE glyph) so the
user can compare their writing against the correct character. It is reset back to the
level's normal guide rules on the next fresh attempt: redrawing (`handleActiveInkChange`),
entering/leaving a focused slot, or changing level.

---

## Completion tracking (stars)

**Model — `writing_practice_completions`** (migration 81): one row per **first**
successful Verify of `(userId, language, entryKey, level)`. Identity =
`(userId, language, entryKey, level)` (unique index → `ON CONFLICT DO NOTHING`).
Bounded at ≤8 rows per character/user; this is **state, not history**. Stars for a
character = `COUNT(*)` grouped by `entryKey`.

- `level` allow-list: `WRITING_PRACTICE_LEVELS` — the eight modes of
  `server/contracts/writingLevels.ts` (re-exported as `isWritingPracticeLevel` by
  `server/utils/writingPracticeStore.ts`).
- Routes (`server/server.ts`, behind `authenticateToken`):
  `GET /api/handwriting/completions?language&entryKey` → `{ completedLevels }`;
  `POST /api/handwriting/completions {language,entryKey,level}` →
  records (idempotent) and returns the full `{ completedLevels }`.
- Client: `fetchCompletedLevels` / `recordCompletion` (`completions.ts`).
- **Input validation** (`validateCompletionTarget`, `server/routes/handwritingRoutes.ts`):
  `language` is coerced through `resolveWriteLanguage` and `entryKey` is capped at 8
  code points. Neither was checked before, so the table accepted rows for unsupported
  languages and keys of any length. The key is deliberately **not** validated against
  the dictionary — a learner may practise a component character with no headword row
  of its own, and rejecting those would break the feature to close a smaller hole than
  the length cap already closes.

**Award flow:** on an all-correct Verify for an un-completed level, the popup POSTs
the completion and lifts the returned full set up to the button (`onLevelsChange`),
which updates both the `★N` superscript and the stepper's stars in one round-trip.

**Stepper star** — a gold ★ sits left of "Level N" once that level is completed,
absolutely positioned so it never shifts the title; the dots row shows every level's star
at once.

---

## Draft preservation (lifecycle)

Closing the popup (background tap or backdrop) **preserves** the active level index, every
character's ink, and the focused grid slot (`setWritingDraft` →
`writingDraftStore.ts`); reopening the same word restores them so an accidental
click-off doesn't lose work. The draft is **hard-cleared** when the flp advances to
a new card or unmounts, and when the cdp unmounts (`clearWritingDraft`).

---

## Related code references

- Selection/touch safety: `src/index.css` (`@media (pointer: coarse)` cpcd block;
  `.flashcard-container`), `WritingCanvas` style.
- Recognition internals, stroke format, backends, Hanzi Writer guide:
  [HANDWRITING_RECOGNITION.md](./HANDWRITING_RECOGNITION.md).
