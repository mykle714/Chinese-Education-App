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

---

## Layer / file map

| Layer | Responsibility | File |
|---|---|---|
| Presentation (entry) | `PracticeWritingButton` — opens the popup; owns the per-character completed-level set (stars) | `src/components/handwriting/PracticeWritingButton.tsx` |
| Presentation (surface) | `PracticeWritingPopup` — the modal: level tabs, single panel vs 2×2 grid, lockout, lifecycle, grading | `src/components/handwriting/PracticeWritingPopup.tsx` |
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

- **eip** header (icon variant) — `src/pages/FlashcardsLearnPage/InfoCardPanelBody.tsx`
- **flp main flashcard** front face, stacked above the audio icon (icon variant) —
  `src/pages/FlashcardsLearnPage/FlashCardSection.tsx` (`ChineseBlock`)
- **cdp** (word details) — `src/pages/VocabCardDetailPage.tsx`

The button owns `completedLevels: Set<string>` as the single source of truth: it
fetches on mount (`fetchCompletedLevels`), passes it into the popup, and updates it
when the popup reports a fresh completion. The popup is always rendered (controlled
by `open`).

**Star badge.** A gold `★N` superscript (N = completed levels) shows on the button
via `withStarBadge`. The **flp flashcard** instance passes `hideStarBadge` to omit
it (clean card face); eip and cdp keep it.

---

## The four levels

Each tab has a user-facing **label** and an internal **`mode`**. The `mode` carries
the assistance semantics AND is the value stored per completion (the DB `level`).
Defined in `TABS` (`PracticeWritingPopup.tsx`).

| # | Label | `mode` | Guide on entry | Bottom button | Drawing |
|---|---|---|---|---|---|
| 1 | **Trace** | `trace` | persistent grey guide + looped stroke-order animation | — | always allowed |
| 2 | **Step Through** | `walkthrough` | guide flashes **1.5s** then fades | **"Show"** — re-flash 1.5s, **6s cooldown** | **locked while guide visible** |
| 3 | **Memorize** | `memorize` | guide shown **persistently, no timer** | **"Start Writing"** — dismiss guide + unlock | **locked until "Start Writing"** |
| 4 | **Test** | `test` | none | — | always allowed |

State driving this (per active level + focus):
`outlineVisible` (guide shown), `drawLocked` (canvas locked), `cooldown` (Show
button countdown). `applyGuideForEntry()` sets the on-entry behavior; `flashGuide()`
runs the timed Step-Through reveal; `startWriting()` performs the Memorize unlock.

### Step Through cooldown
"Show" calls `flashGuide(1500, lock=true, cooldown=true)`: re-flashes the guide for
1.5s with drawing locked, and disables the button for **6s measured from press**
(`startCooldownTimer`), showing a live `Ns` countdown. The on-entry auto-flash does
**not** start a cooldown. A small corner spinner (`loading`) shows during this timed
lock (Step Through only).

### Memorize study-first lock
On entry: `outlineVisible = true`, `drawLocked = true`, **no timer** (study as long
as you want). Cues while locked (`memorizeBlocked = mode === "memorize" && drawLocked`):

- **"No writing" badge** — a red circle-with-a-slash (`Block` icon, `COLORS.redMain`)
  in the panel's top-left corner (`WritingStage` `blocked` prop).
- **Blocked-attempt nudge** — if the user presses to draw while locked,
  `WritingCanvas` fires `onBlockedAttempt`; the popup bumps `startPulseNonce`, which
  is the React `key` on the **"Start Writing"** button, replaying a glow-ring pulse
  (`@keyframes practiceStartPulse` in `src/index.css`).

Tapping **"Start Writing"** (`startWriting`) hides the guide, unlocks drawing, and
the button disappears (it only renders while `outlineVisible`). The bottom button
sits in an **absolutely-positioned slot** (`practice-writing__assist-slot`) anchored
below the panel (the drawing-area is `position: relative`), so its appearance/removal
never reflows or shifts the panel. No timer/cooldown.
No lock spinner (the lock is open-ended). `startPulseNonce` is reset to 0 on every
level entry (`applyGuideForEntry`) so re-entering never auto-pulses.

---

## Capture & draw-lock (`WritingCanvas`)

- Pointer Events only; `setPointerCapture` on down so a stroke that leaves the canvas
  still completes. Ink is drawn imperatively (the source of truth is `inkRef`, not
  React state) because a stroke can carry hundreds of points.
- `disabled` (= `!drawable || drawLocked`) blocks new strokes. A `pointerdown` while
  disabled calls `onBlockedAttempt` and returns (no stroke started).
- Imperative handle (`WritingCanvasHandle`): `clear` / `undo` / `getInk` / `isEmpty`.
- **Touch/selection safety:** `touchAction: none` (no scroll / edge-swipe) plus
  `userSelect/WebkitUserSelect/WebkitTouchCallout: none` so a draw gesture can never
  start a text selection that bleeds into the page underneath. (See also the global
  `@media (pointer: coarse)` cpcd rule in `index.css` — cpcd pinyin is never
  selectable on mobile.)

---

## Single character vs 2–4 characters

`chars = [...character]` (code-point aware). `isMulti = chars.length > 1`.

- **Single (`singleBody`)** — one large panel + toolbar (Clear/Undo/Verify) + level
  bar. The canvas is always present, so `applyGuideForEntry` runs in the
  tab-change/open effect.
- **Multi (2–4)** — a **2×2 grid** of read-only previews (`gridBody`): chars fill
  `0→TL, 1→TR, 2→BL, 3→BR`. Tapping a slot **enlarges** it into a focused drawing
  panel (`focusBody`) with the guide and Clear/Undo (no Verify / level bar). There is
  **no Back button** — tapping the greyed background collapses the slot (see below).
  Entering a focused slot runs `applyGuideForEntry`; collapsing (`collapseFocus`)
  captures that slot's ink back into `inks` and returns to the grid.
  Verify (grid only) recognizes **all** characters at once.

**Coordinate space.** Every panel — focused or grid preview — captures/seeds ink in
the same `FOCUS_SIZE` (300px) space; grid previews are the full-size stage CSS-scaled
down (`GRID_SCALE`), so a preview and its enlarged panel share one coordinate system
and recognition is identical regardless of on-screen size.

**Grid-preview guide rules** (per slot, computed as `slotGuide` in `gridBody`):
- **Trace** → always show the grey guide behind any writing.
- **Step Through / Memorize** → show the guide **only while the slot is empty**;
  once the slot has strokes, show the writing alone.
- **Test** → never.
- **Post-Verify override** → after a Verify the guide is revealed on **every** slot
  regardless of level (see [Grading](#grading-verify)).

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
the 393px phone card, which closes via `onClose`).

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

**Post-Verify guide reveal.** A successful or failed Verify flips `verifyRevealed`,
which forces the grey guide visible on **every** panel — single, focused, and all
grid slots — on **all four levels** (even Test, which normally shows no guide) so the
user can compare their writing against the correct character. It is reset back to the
level's normal guide rules on the next fresh attempt: redrawing (`handleActiveInkChange`),
entering/leaving a focused slot, or changing level.

---

## Completion tracking (stars)

**Model — `writing_practice_completions`** (migration 81): one row per **first**
successful Verify of `(userId, language, entryKey, level)`. Identity =
`(userId, language, entryKey, level)` (unique index → `ON CONFLICT DO NOTHING`).
Bounded at ≤4 rows per character/user; this is **state, not history**. Stars for a
character = `COUNT(*)` grouped by `entryKey`.

- `level` allow-list: `WRITING_PRACTICE_LEVELS = ['trace','walkthrough','memorize','test']`
  (`server/utils/writingPracticeStore.ts`, `isWritingPracticeLevel`).
- Routes (`server/server.ts`, behind `authenticateToken`):
  `GET /api/handwriting/completions?language&entryKey` → `{ completedLevels }`;
  `POST /api/handwriting/completions {language,entryKey,level}` →
  records (idempotent) and returns the full `{ completedLevels }`.
- Client: `fetchCompletedLevels` / `recordCompletion` (`completions.ts`).

**Award flow:** on an all-correct Verify for an un-completed level, the popup POSTs
the completion and lifts the returned full set up to the button (`onLevelsChange`),
which updates both the `★N` superscript and the per-tab stars in one round-trip.

**Tab star** — a gold ★ sits **above** the level's label once completed. The label
stays centered in the tab; the star is **absolutely positioned** above it (out of
flow), so it overlays on completion without shifting/reflowing the word. Multi-word
labels ("Step Through") wrap.

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
- Pulse animation: `@keyframes practiceStartPulse` (`src/index.css`).
- Recognition internals, stroke format, backends, Hanzi Writer guide:
  [HANDWRITING_RECOGNITION.md](./HANDWRITING_RECOGNITION.md).
