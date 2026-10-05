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

We use **one** trajectory-based (online handwriting) recognizer, consuming the
canonical stroke format below. A second was planned and is **not built**:

| Backend | Role | Network | Notes |
|---|---|---|---|
| **Google Input Tools handwriting endpoint** | Primary recognizer | Online (HTTP POST) | Best accuracy. `https://inputtools.google.com/request?ime=handwriting`. **Unofficial / undocumented** Google service — no API key, but may change or rate-limit without notice. Verified working (returns ranked candidates, ~7–20ms server time). |
| ~~**HanziLookupJS**~~ | ⚠️ **NOT IMPLEMENTED** — planned offline fallback | None (client-side) | Pure-geometry recognizer, fully self-hosted; would survive the Google endpoint disappearing. Lower accuracy; ignores stroke timing. **No code exists**: `server/utils/handwritingRecognizer.ts` speaks only to Google, and there is no `hanzilookup` dependency in either package.json. **There is currently no fallback — if Google fails, recognition fails.** (Verified 2026-09-07.) |

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

> **Status: IMPLEMENTED** — `src/components/handwriting/WritingCanvas.tsx`
> (`WritingCanvas`), used by the practice popup and the Beginner Keyboard.

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
- **Velocity-based width (render only).** The line swells with pointer speed —
  fast = thick, slow = thin — around the `strokeWidth` prop (`velocityWidth`, default
  on). Width is recomputed from each stroke's `(xs, ys, ts)` at draw time and **never
  stored**, so the `Ink` contract and recognition are unaffected. Speed is EMA-smoothed,
  then mapped linearly between `slowSpeed`→`slowScale` (thinnest) and `fastSpeed`→`fastScale` (thickest); the
  result is **slew-rate limited per CSS px travelled** (`maxGrowthPerPx` /
  `maxShrinkPerPx`, fractions of base width) so the line can't balloon or pinch on one
  noisy sample. Two tunings: **desktop** (`pointerType === "mouse"`) and **mobile**
  (touch / pen), chosen per stroke on `pointerdown`; strokes not drawn live (restored
  drafts, Snap substitutes) fall back to `(pointer: coarse)`. Each stroke is filled as a
  union of discs + joining quads in one nonzero `fill()`, so translucent draws (the
  rejected-stroke fade) don't darken at overlaps. Committed strokes' outlines are cached
  per stroke.
  Code: `src/components/handwriting/velocityWidth.ts` → `VELOCITY_WIDTH_PROFILES`,
  `computeStrokeWidths`, `buildVariableStrokePath`; `WritingCanvas.tsx` → `redrawAll`.

The capture component's only output is an `Ink` value; it knows nothing about
recognizers.

## Practice surface: the "Practice Writing Me" popup

> **Status: DESIGN / not yet implemented.**

### Entry points

A **"Practice Writing Me"** button appears on:

- the **eip** (extra info panel), and
- the **word details page (cdp)**.

Tapping it opens a modal **popup** scoped to that single target character/word.

The **Writing Center** (`/flashcards/writing`) is a third entry point with no button:
its 6×6 word grid opens the same popup on whichever word tile is tapped
(`WritingPracticeGrid`, docs/READING_WRITING_CENTERS.md). Every tile is one of the
learner's cards (1–4 characters, off the writing cooldown), so every Verify there writes a
Writing mark on that card.

Every host shares one hook, `usePracticeWriting` (`src/components/handwriting/`): the
completed-level (star) fetch, its sync as levels clear, and the Writing mark on Verify.

### Popup chrome

The single-character popup is **one bordered rectangle** (`WritingPanel`): level stepper
header, canvas, Clear / Undo + assist + Verify footer. The multi-character grid view
keeps free-standing pieces (Verify above the grid, the stepper pill below):

| Control | Position | Action |
|---|---|---|
| **Close** | No button: tapping the greyed background (or Escape) steps back — a focused slot shrinks into the grid, otherwise the popup closes (the single-character panel shrinks back into its launcher first). | Closes the popup (preserving state — see lifecycle). |
| **Clear** + **Undo** | Left of the **footer band** of the one `WritingPanel` rectangle (header = level stepper, then canvas, then footer — [PRACTICE_WRITING.md § The writing panel](./PRACTICE_WRITING.md#the-writing-panel-writingpanel)). | Clear empties the **current character's** canvas; Undo removes the most recent stroke (LIFO). Both disabled when empty. |
| **Verify** | Right end of the same footer (after the level's assist button) in the single-character panel; a stand-alone button above the 2×2 grid for multi-character words. | Sends the current tab's on-screen strokes to `POST /api/handwriting/recognize`; **correct iff target == top-1 candidate** (see decisions). Result feedback is a simple **green check (✓)** on pass or **red X (✗)** on fail — no auto-advance, no retry gating; the user stays on the tab and can clear/redraw/re-verify freely. |
| **Level stepper** | Header of the single-character `WritingPanel`; a floating pill under the 2×2 grid for multi-character words. | ‹ Level N › over the eight levels (`LevelStepper`; [PRACTICE_WRITING.md](./PRACTICE_WRITING.md)). |

Dismissal: tapping the greyed background closes the popup; on desktop, **tapping the
backdrop outside the phone card** (the Dialog's own scrim, via `onClose`) does the same. Both
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

### Levels — progressive assistance

**Eight levels** since 2026-10-04 (was four tabs: Trace / Step Through / Memorize /
Test). The level table, the stored `mode`s and each level's guide / lock / button
behaviour live in [WRITING_PRACTICE_REWORK.md § 1](./WRITING_PRACTICE_REWORK.md); the
popup's stepper and per-level UX in [PRACTICE_WRITING.md](./PRACTICE_WRITING.md). Only the
assistance differs between levels; the canvas and top-1 grading are identical.

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
- **Focus (enlarge).** Tapping a slot grows that one character out of the slot into
  a full `WritingPanel` (level label, the level's guide, **Clear/Undo**) over a scrim.
  Clear/Undo act **only on that character** (never the others in the word). There
  is **no Verify or level bar** in the focused view, and no Back button: tapping the
  scrim captures the strokes back into the grid and shrinks the panel into its slot;
  the user taps another slot to write the next character (no in-focus character
  navigation).
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

Each **word** earns up to **8 stars**, one per assistance level completed. A level
is "completed" on the **first successful Verify** of that level — for a single
character that means target === top-1; for a multi-character word it means **every**
character is top-1-correct in one Verify (a partial pass awards nothing).

- **Persistence:** table `writing_practice_completions` (migration 81), Shape A —
  one row per first completion of `(userId, language, entryKey, level)`, bounded at
  ≤8 rows/character/user. `level` is the level **number** 1..8 (`SMALLINT`, migration
  172 — it was the mode name until then; 172 erased every star). Stars = `COUNT(*)`
  grouped by `entryKey`. State, not
  history. Helper: `server/utils/writingPracticeStore.ts`; routes
  `GET/POST /api/handwriting/completions` (`server/routes/handwritingRoutes.ts`).
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

> **Second consumer of this stroke data (BUILT):** the **Speed Reading** game
> renders its two word options from the same `hanzi-writer-data` glyph corpus,
> through its own static `GlyphSvg` component
> (`src/components/handwriting/GlyphSvg.tsx`) rather than a Hanzi Writer instance
> — the options need no animation and there are up to 8 glyphs on screen at once.
> See [SPEED_READING_GAME.md](./SPEED_READING_GAME.md).
>
> - **Anything that changes the pinned `hanzi-writer-data` version affects both.**
>   `GlyphSvg` pins `@2.0.1` on its CDN fallback rather than tracking `@latest`.
> - **The CDN fallback in `loadCharData.ts` is the PRODUCTION path**, not a
>   rare-miss path. `import('hanzi-writer-data/<char>.json')` is a bare specifier
>   with a dynamic segment, which Rollup cannot statically analyze — it survives
>   the build as a runtime bare-specifier `import()` that no browser can resolve,
>   so the local branch always throws in production builds and the CDN always carries the
>   glyph. (Confirmed in `dist/`: no per-character chunks are emitted.) Deleting
>   that fallback as "dead code" would break the grey guide in PPE while
>   leaving it working in `vite dev`. `GlyphSvg` carries the same fallback for the
>   same reason.
> - **A third consumer once existed** — the Mandela game's offline pipeline, which
>   corrupted this corpus to author deliberately-wrong glyphs and shipped a
>   median-based stroke classifier (`strokeTaxonomy.ts`) to do it. It was removed
>   in full. The **Snap** level (`strokeSnap.ts`) now reads the corpus `medians` to
>   judge whether a drawn stroke matches the next expected one (position, length,
>   direction — not stroke *type*); if the writing drill ever wants per-stroke
>   feedback ("your 竖 should have a hook"), the old classifier is in the git history.

**Decision: use Hanzi Writer for the grey guide only; never for capture or
grading.** (One deliberate exception, Level 1 **Snap**: each stroke is judged against
the corpus median of the next expected stroke and snapped into place. It still does
not use Hanzi Writer's quiz — our canvas stays the only capture path, `strokeSnap.ts`
reads the corpus itself — and the final Verify is still independent top-1. See
[PRACTICE_WRITING.md § Snap](./PRACTICE_WRITING.md).) Hanzi Writer renders the greyed character outline + stroke-order
animation off the same `makemeahanzi` data we already use, so it owns the
**background guide** on every tab. Capture stays on our own DIY canvas overlaid
on top (see below).

| Concern | Owner |
|---|---|
| Grey outline + stroke-order guide | **Hanzi Writer** (`showOutline`, `loopCharacterAnimation`, `outlineColor`); show/hide is `HanziGuide`'s container opacity |
| User writing capture | **Our DIY canvas** (transparent overlay, Pointer Events → `Ink`) |
| Grading | **Our proxy → backend**, top-1 (Hanzi Writer's quiz grading is **not** used) |

**Why not Hanzi Writer's quiz capture:** its only capture path is quiz mode, which
grades each stroke against the *target* and advances stroke-by-stroke — it won't
record a freely-drawn *different* character. That pre-decides correctness before
our API sees anything, defeating the independent top-1 rule. So Hanzi Writer is
display-only.

**Layering:** Hanzi Writer SVG underneath (the guide); our transparent capture
canvas on top, same coordinate box. Tab assistance maps to Hanzi Writer calls:
**Snap** = persistent `showOutline` + `animateStroke(next)` on repeat;
**Trace** = persistent `showOutline` (+ optional looped stroke-order animation);
**Step Through** = outline shown by the entry timer (drawn at once, faded out) and the
"Show" button (faded in and out); **Memorize** = persistent outline faded out by the
first stroke; **Blank** = no guide (no instance is created on a stage that never showed
one). The outline itself is drawn once (`showOutline`) and left on; on/off is the
container's opacity — see [PRACTICE_WRITING.md](./PRACTICE_WRITING.md) § "Guide fade".

**Data source:** feed Hanzi Writer our **local** `makemeahanzi` data via
`charDataLoader` rather than its default CDN, so the guide has no external runtime
dependency (consistent with the offline-fallback stance of the recognition layer).

## Layer placement

| Layer | Component | File |
|---|---|---|
| Presentation (entry) | One component, two `appearance`s (zh + **1–4 characters** on both): `rail` — the **`Write it` pill on `WordToolsRail`**, above the card on the flp and both cdps, and the only entry point since 2026-08-28; `labeled` — the plain "Practice Writing Me" button, for any future action row. The on-card `icon` appearance was **removed** on 2026-08-28 (a pre-rail relic), and the eip's own action bar (`InfoCardActionBar`) is **deleted** — the panel is information-only now, and practising is a word tool | `src/components/handwriting/PracticeWritingButton.tsx`; placed by `src/components/WordToolsRail.tsx` only |
| Presentation (surface) | "Practice Writing Me" **popup** — single panel (1 char) or 2×2 grid + focus (2–4 chars); floating bars (corner ✕, Clear/Undo pill, Verify, bottom Trace/Step Through/Memorize/Test bar), cooldowns, lifecycle, ✓/✗ | `src/components/handwriting/PracticeWritingPopup.tsx` |
| Presentation (panel) | One writing panel = guide + capture canvas + ✓/✗ overlay; reused for the single panel, the focused slot, and the scaled grid previews | `src/components/handwriting/WritingStage.tsx` |
| Presentation (guide) | **Hanzi Writer** (display-only) — grey outline + stroke-order guide; local data via `charDataLoader` (CDN fallback) | `src/components/handwriting/HanziGuide.tsx`, `loadCharData.ts` |
| Presentation (capture) | DIY canvas overlay → emits `Ink`; Pointer Events, `touchAction:none`, undo/redo/clear | `src/components/handwriting/WritingCanvas.tsx` |
| Domain (contract) | `Stroke` / `Ink` / `WritingCanvasHandle` types; client recognition adapter | `src/components/handwriting/types.ts`, `recognize.ts` |
| Domain (draft) | Preserve-on-close / hard-clear draft store | `src/components/handwriting/writingDraftStore.ts` |
| Persistence (stars) | `writing_practice_completions` table (Shape A) + completion helper | migration `database/migrations/81-create-writing-practice-completions-table.sql`, `server/utils/writingPracticeStore.ts` |
| API (proxy) | `POST /api/handwriting/recognize` — `Ink` → `{ candidates, top1 }` | `server/routes/handwritingRoutes.ts` |
| API (stars) | `GET/POST /api/handwriting/completions` — read/record completed levels | `server/routes/handwritingRoutes.ts`; client `src/components/handwriting/completions.ts` |
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
