# Handwriting Recognition (Character Writing Practice)

> **Status: IMPLEMENTED (v1).** Recognition backends, the canonical stroke
> format, capture, the practice popup (single-char panel + 2×2 grid for 2–4
> chars), and the eip/cdp entry points are built. See the layer table for file
> paths. Open items: traditional (`zh_TW`) support and words longer than 4
> characters (see Open Questions).

Reference for the **character writing-practice** experience: the user draws a
Chinese character with finger/mouse, the app captures the strokes, and a
recognizer scores what was written. This doc covers both the **recognition path**
(capture → proxy → backend) and the **practice surface** (the "Practice Writing
Me" popup, below) that consumes it.

## Confirmed architecture decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Where the recognizer is called** | **Server proxy** — `POST /api/handwriting/recognize` takes canonical `Ink`, returns ranked candidates | Contains the unofficial-Google dependency to one server file; lets us swap backend (HanziLookupJS / cloud) without a client deploy; keeps the endpoint out of the client bundle; allows throttling/caching. (Browser *could* call Google directly — CORS is `*` — but we choose not to.) |
| **Capture component** | **DIY** `<canvas>` + Pointer Events | Stroke contract is simple; generic drawing libs don't respect the app's `touchAction`/edge-swipe rules or give clean per-stroke + timestamp capture. |
| **When recognition runs** | **On-demand** ("Done" button) | User completes the whole character, then one recognition call. Fewer calls, no mid-character noise. Fits the test/learn drill. |
| **Correctness for "test yourself"** | **Top-1 only** — target must be the recognizer's #1 candidate | A user writing a *different* character must never be marked correct. Stricter than top-N on purpose: we accept occasional false negatives (legible target ranked #2) over any false positive. |
| **Script / locale** | **Simplified only** — always send `language: "zh_CN"` | Scope cut for v1. Traditional (`zh_TW`) is a **later** addition; candidate ranking differs by locale, so a traditional-only writer can miss top-1 until then. See open question below. |

## Confirmed backends

We use **two trajectory-based (online handwriting) recognizers**, both consuming
the same canonical stroke format below:

| Backend | Role | Network | Notes |
|---|---|---|---|
| **Google Input Tools handwriting endpoint** | Primary recognizer | Online (HTTP POST) | Best accuracy. `https://inputtools.google.com/request?ime=handwriting`. **Unofficial / undocumented** Google service — no API key, but may change or rate-limit without notice. Verified working (returns ranked candidates, ~7–20ms server time). |
| **HanziLookupJS** | Offline fallback | None (client-side) | Pure-geometry recognizer, fully self-hosted. No external dependency, so it survives the Google endpoint disappearing. Lower accuracy; **ignores stroke timing** (geometry only). |

Deliberately **excluded** (and why), so future agents don't re-add them:

- **WICG Handwriting Recognition API** — browser-native but Chrome-only with
  limited/uncertain Chinese support; not portable enough to depend on.
- **Hanzi Writer** — not used as a recognizer (it *grades* against a known target,
  not free recognition). It **is** used **display-only** for the grey outline +
  stroke-order guide in the practice popup; see that section.

## Canonical stroke format (the contract)

All capture and all backends are mediated by **one internal type**. Adapters
translate this into each backend's wire format, so backend choice is isolated to
a single adapter module.

```ts
// One stroke = parallel arrays of sampled points, in draw order.
// ts = capture timestamps (ms). Geometry-only backends ignore ts.
interface Stroke {
  xs: number[];
  ys: number[];
  ts: number[];
}
type Ink = Stroke[]; // strokes in the order they were drawn
```

This mirrors Google's wire shape exactly: Google's `ink` is an array of strokes,
each stroke `[ [xs], [ys], [ts] ]`. Coordinate space: `x` right-positive,
`y` **down**-positive (screen convention), bounded by the declared
`writing_area_width` / `writing_area_height`.

### Adapter responsibilities

| Adapter | Transform from `Ink` | Runs |
|---|---|---|
| Google | Wrap as `{ writing_guide, ink: [[xs,ys,ts], …], language }`; POST JSON; parse ranked candidate list. | Server (behind the proxy) |
| HanziLookupJS | **Drop `ts`**; reshape each stroke to `[[x,y], …]`; map into its coord space. | Client fallback (or server) |

The proxy endpoint speaks the canonical `Ink` in and a ranked
`{ candidates: string[] }` out, so the client never sees a backend's wire format.

> Porting "down" to a geometry-only backend (drop `ts`) is trivial; porting "up"
> to a timestamped backend is not (you'd need real capture times). So **always
> capture timestamps** even though the offline fallback discards them.

## Reading in user writing inputs (capture)

> **Status: not yet implemented** — this section is the intended design.

The capture surface is a single drawing canvas that turns pointer events into the
canonical `Ink` above. Design rules:

- **Pointer Events, not mouse/touch.** Use `pointerdown` / `pointermove` /
  `pointerup` (+ `pointercancel`) so finger, stylus, and mouse share one path.
  Call `setPointerCapture` on down so a stroke that leaves the canvas still
  completes.
- **One stroke per press.** `pointerdown` opens a new `Stroke`; each `pointermove`
  appends `(x, y, t)` where `x,y` are canvas-relative (subtract
  `getBoundingClientRect()`), `t = performance.now()`; `pointerup`/`cancel`
  closes the stroke and pushes it onto `Ink`.
- **Sampling.** Append on every move event, optionally throttling to a minimum
  point distance (e.g. ≥2px) to avoid dense duplicate points when the pointer is
  slow. Never resample across strokes — stroke boundaries are semantic.
- **Coordinate normalization.** Keep capture in canvas pixels; let each adapter
  scale into its backend's expected box via the declared writing-area dims. Do
  **not** bake a backend's coordinate space into capture.
- **Touch/scroll.** Per the app's global rules the canvas must be
  `touchAction: "none"` and game/practice pages call `useBlockEdgeSwipe(true)`,
  so drawing never triggers scroll or edge-swipe navigation.
  (See [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md).)
- **Undo / clear.** "Undo last stroke" = pop the last `Stroke`; "clear" = empty
  `Ink`. Both are cheap because strokes are discrete.

The capture component's only output is an `Ink` value; it knows nothing about
recognizers.

## Practice surface: the "Practice Writing Me" popup

> **Status: DESIGN / not yet implemented.**

### Entry points

A **"Practice Writing Me"** button appears on:

- the **eip** (extra info panel), and
- the **word details page (cdp)**.

Tapping it opens a modal **popup** scoped to that single target character/word.

### Popup chrome (floating bars)

The popup chrome is split into **three free-standing, footer-style floating
bars** (rounded pills with a drop shadow over the dialog surface) plus a
stand-alone close button — there is no single bordered header:

| Control | Position | Action |
|---|---|---|
| **✕ (close)** | **Its own floating button** pinned to the **top-right corner** of the popup (overflows the paper edge). | Closes the popup (preserving state — see lifecycle). |
| **Clear** + **Undo** | Grouped in the **left floating pill** of the **toolbar above the writing panel**. | Clear empties the **current tab's** canvas; Undo removes the most recent stroke (LIFO). Both disabled when empty. |
| **Verify** | **Stand-alone button to the right** of the toolbar (same row as the Clear/Undo pill, above the writing panel). | Sends the current tab's on-screen strokes to `POST /api/handwriting/recognize`; **correct iff target == top-1 candidate** (see decisions). Result feedback is a simple **green check (✓)** on pass or **red X (✗)** on fail — no auto-advance, no retry gating; the user stays on the tab and can clear/redraw/re-verify freely. |
| **Level bar** | **Bottom floating pill**, footer-style, spanning the popup width. | The four level tabs (see below). |

Dismissal: the **✕** closes the popup; on desktop, **tapping the backdrop outside
the phone card** (the Dialog's own scrim, via `onClose`) does the same. Both
**preserve** state per the lifecycle rules below.

**Generalized lockout + greyed-background step-back.** While the popup is open the
entire writing surface is a single modal layer: one set of gesture handlers on the
popup root (`rootLockHandlers` in `PracticeWritingPopup.tsx`) absorbs **every**
pointer/touch/mouse/click event, so nothing leaks to the page underneath (notably
the flp flashcard's drag/flip handlers and the eip sheet). Tapping the **greyed
background** — a tap whose target is the root itself (the dark area around the
floating islands), *not* an island — **steps back one level**: a focused grid slot
collapses to the **2×2 grid**, and the grid / single-char view **closes** the popup
(`handleBackgroundTap`). Taps on an island are locked here too but skip the
step-back. This is deliberately ONE blocker (lock + step-back in the same place)
rather than per-island `stopPropagation`, which previously let edge-of-tab taps
both close the writer and reach the card.

### Tabs — progressive assistance

Four levels, decreasing assistance left→right, presented as the **bottom floating
level bar**. Each tab shows a user-facing **label** (`Trace` / `Step Through` /
`Memorize` / `Test`); the internal **`mode`** (`trace` / `walkthrough` / `memorize`
/ `test`) carries the assistance semantics and is the value stored per completion.
Only the assistance behavior differs; the chrome, canvas, and grading are identical
across levels.

| # | Label (`mode`) | Background guide (greyed target char + stroke order) | On tab entry | Bottom button | Draw during guide? |
|---|---|---|---|---|---|
| 1 | **Trace** (`trace`) | **Always shown** (persistent grey background w/ stroke order) | guide visible | — (always on) | Yes |
| 2 | **Step Through** (`walkthrough`) | Default **off** | guide shown **1.5s**, then fades | **"Show"** — re-flashes guide for **1.5s**; **6s cooldown** | **No** — drawing is locked while the guide is visible |
| 3 | **Memorize** (`memorize`) | Shown persistently on entry; **no timer** (study as long as you want) | guide visible, **drawing blocked** | **"Start Writing"** — dismisses the guide + unlocks drawing (no cooldown) | **No** until "Start Writing", then **Yes** |
| 4 | **Test** (`test`) | Never shown; no button | blank | — | n/a |

Notes:
- **Step Through** = the only *timed* guide: it flashes on entry and on each "Show"
  press for **1.5s**, with **drawing disabled** while the guide is on screen.
- **Memorize** = study-then-write. The guide is shown indefinitely with drawing
  **blocked**; the bottom **"Start Writing"** button hides the guide and unlocks
  drawing (and then disappears). No timer, no cooldown — re-entering the level (or,
  multi-char, re-focusing a slot) re-arms the study gate. No lock spinner is shown
  (the lock is open-ended, unlike Step Through's timed flash).
- **"Show" button cooldown (Step Through only): 6s from press.** When pressed, it is
  disabled for 6 seconds **measured from the press** — the cooldown overlaps the
  1.5s guide-visible window, so the button re-enables 6s after press. The automatic
  on-entry guide does **not** start a cooldown (the button is usable immediately on
  tab entry).
- **Cooldown affordance:** while locked, the "Show" button is **greyed out
  (disabled)** and shows a **live countdown** of remaining seconds (6 → 0),
  returning to "Show" when the cooldown ends.
- "Stroke order" background = the greyed target glyph with its stroke-order guide
  (see open question on rendering source below).

### Canvas / state lifecycle

Two distinct "reset" scopes — **soft** (tab switch) vs. **hard** (context change):

| Trigger | Effect |
|---|---|
| **Switch level** (within the popup) | **Clears** the attempt — every character's canvas is emptied and results reset (multi collapses to the grid). Each level is a fresh attempt; only one level's ink exists at a time. |
| **Close popup** (✕, or desktop backdrop tap) | **Preserves** every character's ink, the active level index, **and** the focused grid slot. Reopening returns the user to the same level and view (grid or the same enlarged slot) with their drawing intact. Rationale: a click-off may be accidental — let them resume. |
| **Leave the flp** (`/flashcards/learn`) | **Hard clear** — discard preserved draft. |
| **Mark a card** | **Hard clear** — discard preserved draft. |
| **Leave the word details page (cdp)** | **Hard clear** — discard preserved draft. |

So the preserved draft is `{ activeTabIndex, inks[], focusedIndex }` (`inks` = one
`Ink` per character of the word; `focusedIndex` = the enlarged slot or `null`),
tied to the **current target word**; any context change that moves off that word
(mark card / leave flp / leave cdp) discards it. See `writingDraftStore.ts`.

### Multi-character grid (2–4 characters)

Words of **2–4 characters** use a **2×2 grid** instead of one panel (single
characters keep the one-panel layout above). The grid is the source of truth for
each character's ink; recognition runs per character.

| Chars | Slots used (`0→TL, 1→TR, 2→BL, 3→BR`) |
|---|---|
| 2 | top-left, top-right |
| 3 | + bottom-left |
| 4 | all four |

- **Grid view** shows each character as a small **read-only preview** (the drawn
  ink, scaled down) plus the **Verify** button and the **level bar**. There is no
  Clear/Undo here — those are per-character and live in the focused view.
- **Focus (enlarge).** Tapping a slot enlarges that one character into a full
  drawing panel with the level's guide, a **Back** button, and **Clear/Undo**.
  Clear/Undo act **only on that character** (never the others in the word). There
  is **no Verify or level bar** in the focused view. **Back** captures the strokes
  back into the grid; the user must Back out and tap another slot to write the
  next character (no in-focus character navigation).
- **Coordinate space.** Every panel — focused or preview — captures/seeds ink in
  the same `FOCUS_SIZE` (300px) space; the grid previews are the full-size stage
  rendered then **CSS-scaled** down, so a preview and its enlarged panel share one
  coordinate system and recognition is identical regardless of on-screen size.
- **Grid-preview guide** (per slot): **Trace** and **Step Through** always show the
  grey guide behind any writing; **Memorize** shows the guide **only while the slot
  is empty** (once written, the writing shows alone); **Test** never shows it.
- **Verify (grid only)** recognises **all characters in parallel** (one proxy call
  each, top-1 vs. that character) and overlays **✓/✗ per slot**. An empty slot
  counts as ✗.
- **Star award:** the level's star is granted only when **every** character is ✓
  in a single Verify (see Completion tracking).

### Completion tracking — stars

Each **word** earns up to **4 stars**, one per assistance level completed. A level
is "completed" on the **first successful Verify** of that level — for a single
character that means target === top-1; for a multi-character word it means **every**
character is top-1-correct in one Verify (a partial pass awards nothing).

- **Persistence:** table `writing_practice_completions` (migration 81), Shape A —
  one row per first completion of `(userId, language, entryKey, level)`, bounded at
  ≤4 rows/character/user. Stars = `COUNT(*)` grouped by `entryKey`. State, not
  history. Helper: `server/utils/writingPracticeStore.ts`; routes
  `GET/POST /api/handwriting/completions` (`server/server.ts`).
- **Tab star:** a gold ★ sits **above** a level's label once that level is
  completed for the word. The label stays centered in the tab; the star is
  absolutely positioned above it (out of flow), so it overlays on completion
  without shifting/reflowing the word (`PracticeWritingPopup.tsx`).
- **Button superscript:** the "Practice Writing Me" button shows a gold `★N`
  badge = number of completed levels for the character; the button fetches the set
  on mount and owns it as the single source of truth, passing it to the popup and
  receiving updates when a level is freshly cleared (`PracticeWritingButton.tsx`,
  `completions.ts`). The **flp flashcard** instance passes `hideStarBadge` to omit
  the badge (keeping the card face clean); the eip and cdp instances keep it.
- **Award flow:** on a correct Verify for an un-completed level, the popup POSTs the
  completion (idempotent) and lifts the returned full set up to the button, which
  refreshes both the superscript and the tab stars.

### Stroke-order background rendering — Hanzi Writer (display only)

**Decision: use Hanzi Writer for the grey guide only; never for capture or
grading.** Hanzi Writer renders the greyed character outline + stroke-order
animation off the same `makemeahanzi` data we already use, so it owns the
**background guide** on every tab. Capture stays on our own DIY canvas overlaid
on top (see below).

| Concern | Owner |
|---|---|
| Grey outline + stroke-order guide | **Hanzi Writer** (`showOutline`/`hideOutline`, `loopCharacterAnimation`, `outlineColor`) |
| User writing capture | **Our DIY canvas** (transparent overlay, Pointer Events → `Ink`) |
| Grading | **Our proxy → backend**, top-1 (Hanzi Writer's quiz grading is **not** used) |

**Why not Hanzi Writer's quiz capture:** its only capture path is quiz mode, which
grades each stroke against the *target* and advances stroke-by-stroke — it won't
record a freely-drawn *different* character. That pre-decides correctness before
our API sees anything, defeating the independent top-1 rule. So Hanzi Writer is
display-only.

**Layering:** Hanzi Writer SVG underneath (the guide); our transparent capture
canvas on top, same coordinate box. Tab assistance maps to Hanzi Writer calls:
**Trace** = persistent `showOutline` (+ optional looped stroke-order animation);
**Step Through** = `showOutline`/`hideOutline` driven by the entry timer and the
"Show" button; **Memorize** = persistent `showOutline` cleared by "Start Writing";
**Test** = no Hanzi Writer instance.

**Data source:** feed Hanzi Writer our **local** `makemeahanzi` data via
`charDataLoader` rather than its default CDN, so the guide has no external runtime
dependency (consistent with the offline-fallback stance of the recognition layer).

## Layer placement

| Layer | Component | File |
|---|---|---|
| Presentation (entry) | "Practice Writing Me" button on the **eip**, the **flp main flashcard** (front face, stacked above the audio icon), and **cdp** (zh + **1–4 characters**; icon variant on the eip header + flashcard) | `src/components/handwriting/PracticeWritingButton.tsx`; placed in `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx`, `src/features/flashcards/FlashcardsLearnPage/FlashCardSection.tsx` (ChineseBlock) + `src/features/flashcards/VocabCardDetailPage.tsx` |
| Presentation (surface) | "Practice Writing Me" **popup** — single panel (1 char) or 2×2 grid + focus (2–4 chars); floating bars (corner ✕, Clear/Undo pill, Verify, bottom Trace/Step Through/Memorize/Test bar), cooldowns, lifecycle, ✓/✗ | `src/components/handwriting/PracticeWritingPopup.tsx` |
| Presentation (panel) | One writing panel = guide + capture canvas + ✓/✗ overlay; reused for the single panel, the focused slot, and the scaled grid previews | `src/components/handwriting/WritingStage.tsx` |
| Presentation (guide) | **Hanzi Writer** (display-only) — grey outline + stroke-order guide; local data via `charDataLoader` (CDN fallback) | `src/components/handwriting/HanziGuide.tsx`, `loadCharData.ts` |
| Presentation (capture) | DIY canvas overlay → emits `Ink`; Pointer Events, `touchAction:none`, undo/clear | `src/components/handwriting/WritingCanvas.tsx` |
| Domain (contract) | `Stroke` / `Ink` / `WritingCanvasHandle` types; client recognition adapter | `src/components/handwriting/types.ts`, `recognize.ts` |
| Domain (draft) | Preserve-on-close / hard-clear draft store | `src/components/handwriting/writingDraftStore.ts` |
| Persistence (stars) | `writing_practice_completions` table (Shape A) + completion helper | migration `database/migrations/81-create-writing-practice-completions-table.sql`, `server/utils/writingPracticeStore.ts` |
| API (proxy) | `POST /api/handwriting/recognize` — `Ink` → `{ candidates, top1 }` | `server/server.ts` |
| API (stars) | `GET/POST /api/handwriting/completions` — read/record completed levels | `server/server.ts`; client `src/components/handwriting/completions.ts` |
| Integration (adapter) | Google adapter (server-side; the only file touching the endpoint) | `server/utils/handwritingRecognizer.ts` |
| Integration (fallback) | HanziLookupJS adapter (client fallback) | *not yet built* |

Hard-clear call sites (`clearWritingDraft()`): `FlashcardsLearnPage.tsx` (on
`currentIndex` change = mark-a-card, + unmount), `VocabCardDetailPage.tsx` (unmount).

## Verification notes (reference)

The Google endpoint and the stroke format were validated manually:

- Hand-built simple characters (一, 十) → correct top candidate.
- Real strokes for a complex character (想, 13 strokes), sourced by converting
  **`makemeahanzi` medians** → `ink` (transform: 1024-em square, y-axis flipped,
  so `screen_y = 900 - y`) → **想** returned as the #1 candidate. `makemeahanzi`
  medians are useful as a **test fixture / ground-truth ink generator**; they are
  not part of the runtime capture path.

## Open questions / future work

- **Traditional (`zh_TW`) support.** v1 hardcodes `zh_CN`. A later version should
  pass the locale per target word and/or accept the target's known
  traditional/simplified variant forms as equivalent for top-1 grading. Until
  then, traditional-only writing may miss top-1.
- **Multi-character targets — IMPLEMENTED for 1–4 chars** (see "Multi-character
  grid"). The button renders for zh entries of **1–4 characters**
  (`[...character].length` in `PracticeWritingButton.tsx`); 2–4 use the 2×2 grid
  with per-character focus/recognition (each `hanzi-writer-data` file is per
  character, so the guide is keyed per slot, avoiding the multi-char-key 404).
  **Words longer than 4 characters are still excluded** — the grid has only four
  slots. A scrollable / paged grid could lift the 4-char cap later.
- **HanziLookupJS offline fallback** is specified but not yet built; v1 ships the
  Google adapter only. The proxy contract (`Ink` in, candidates out) already
  isolates it so the fallback can be added server- or client-side later.

## Related

- [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) — touch/scroll rules the capture
  canvas must follow; the popup is a modal over the eip / cdp.
