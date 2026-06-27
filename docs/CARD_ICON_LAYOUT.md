# Custom Card Icon Layout (flp)

> Status: **implemented**. Backed by migration 82 (`iconLayout`), the icons8
> search/ensure and vocabEntries icon-layout endpoints, and the flp edit-mode UI.
> The editor has **two modes** — basic (swap the single icon) and advanced (the full
> drag/resize/rotate canvas, plus per-icon tools merged into **one wrapping flex-list menu**:
> undo / redo / delete / duplicate / mirror / lock / align / snap / order / count, flowing onto
> the next line when a row overflows). In
> **advanced** mode the card is pushed (animated) down toward the bottom of the screen so
> the three-row toolbar clears it (basic mode keeps its single static row, card stays
> centered). While editing the **More Info pill stays drawn but greyed + inert**; in
> advanced mode the card slides over and covers it. The toolbar drops in on enter and the
> advanced menu reveal-expands on the adv toggle.
>
> The white text-backdrop affordance (migration 83 `iconTextBackdrop`) has been
> **removed**: migration 84 drops the column and the editor no longer exposes it.

## What it is

By default every flashcard shows one representative icons8 icon (`entry.iconId`,
joined from det) centered on the card. The default icon renders through the **same
`CardIconLayer` geometry** as the editor (`defaultLayoutForIcon(iconId)` in
`cardIconLayout.ts`, fed to `CardIconLayer` from
`src/pages/FlashcardsLearnPage/FlashCardSection.tsx` `CardFaceSide`), so its on-screen
size is identical whether or not the editor is open. (`CardImage` in that file is now
only the empty-state placeholder box for entries with no icon at all.) This feature lets
a learner **compose a custom multi-icon arrangement
per saved word**: enter an edit mode on the flashcards learn page (flp), use the
card itself as a canvas to drag / resize / rotate up to **12** icons, add more from
an icons8 search, and **save** the arrangement to their vocab entry (vet). From then
on the card renders that arrangement instead of the single default icon.

The arrangement is **per user, per word** because it is stored on the vet row
(identity `(userId, entryKey, language)`), not on the shared det icon.

## Where icons render (face-gating rule)

A face renders icons when it shows the English block: **Side 1 only when it is English**
(`showIcon={sideOneLanguage === 'en'}`), and **Side 2 (back) always**. Applies to both
the default single icon and a custom layout.

Separately, the **practice-writing button** exists on the **back face only** — the Side
1 `ChineseBlock` is passed `showWriting={false}` so it never renders there (the audio
button still appears on whichever face shows the Chinese).

Icons are drawn in a layer **behind** the cpcd, English text, buttons, and labels (a
lower `zIndex` than `CardContent` — see the stacking-context note under the gesture
canvas), and are **clipped to the card boundary** (`overflow: hidden` on the face) —
icons dragged partially off the card are cut off, never painted outside the card.

**3D-flip hit-testing:** CSS backface culling does not reliably exclude the rotated
-away face from *hit-testing*, so the away-facing `CardFaceSide` is made `inert`
(`pointerEvents: none`) — Side 1 when `isFlipped`, Side 2 when `!isFlipped`. Without
this, the away face intercepts taps meant for the visible face (e.g. the writing
-practice / audio buttons on the back).

## Where else the layout renders (card-grid thumbnails)

Beyond the flp flashcard, the saved arrangement also renders on the **mini card
thumbnails** (`src/components/MiniVocabCard.tsx`, used by both the `/decks` card
previews and the Mastered Cards page via `MiniVocabCardGrid`). It reuses the same
read-only `CardIconLayer`, which is fully percentage-based and therefore scales to
the 92×132 thumbnail with no extra math.

Gating differs from the flashcard: the thumbnail renders the layer **only for
advanced arrangements** (`iconLayout.length > 1`). Single-icon "basic" layouts and
plain default-icon cards keep the icon-free thumbnail. The layer sits at `zIndex 0`
(behind the text); the word and definition blocks are given `position: relative;
zIndex: 1` so they read on top — the same stacking-context rule the flashcard face
follows.

## Data model

New nullable column **`iconLayout` jsonb** on both vet tables (`vocabentries_zh`,
`vocabentries_es`) — migration `database/migrations/82-add-icon-layout-to-vocabentries.sql`.

- `NULL` ⇒ no custom layout; render the default det icon at the central default spot.
- Non-null ⇒ array (**max 12**) of icon placements:

```jsonc
{
  "iconId":   "16017",  // icons8 natural key (icons8."icons8Id"); rendered via /api/icons8/<id>/image
  "x":        0.5,      // icon CENTER, fraction of card WIDTH  [0..1]
  "y":        0.45,     // icon CENTER, fraction of card HEIGHT [0..1]
  "scale":    1.2,      // multiplier on the base box; clamped ~[0.25, 4.5]
  "rotation": 0,        // degrees
  "z":        0,        // paint order; higher = front. Normalized to 0..n-1 on save.
  "flipX":    true,     // OPTIONAL horizontal mirror (the "mirror" action); omitted/false = not mirrored
  "locked":   true      // OPTIONAL lock (the "lock" action); icon ignores translate/resize/rotate gestures. omitted/false = freely editable
}
```

**Default scale is `DEFAULT_ICON_SCALE = 1.2`** (the default icon renders 20% larger
than the base box). It applies to every newly created item: the seeded basic icon, a
basic "change icon" swap, and an icon spawned into advanced mode. Existing saved layouts
keep their own stored `scale`. `flipX` is mirrored at render time via
`scaleX(-1)` in `iconItemStyle` (applied AFTER `rotate`), shared by both renderers
(`CardIconLayer`, `CardIconCanvas`) and the order-list thumbnails.

**Coordinates are normalized** (fractions of the rendered card size), so a saved
layout survives the card being rendered at different pixel sizes across viewports.
The on-screen box for an icon is `BASE_ICON_FRAC × cardWidth × scale`
(`BASE_ICON_FRAC ≈ 0.28`), positioned by its center at `(x·cardWidth, y·cardHeight)`,
then rotated `rotation` degrees. `scale` is clamped to `[0.25, 4.5]`; at max an icon
is ~1.26× the card width (`0.28 × 4.5 ≈ 1.26`). These
live in `cardIconLayout.ts` (`BASE_ICON_FRAC`, `SCALE_MIN/MAX`, `DEFAULT_ICON_*`); the
server's `validateIconLayout` mirrors the scale clamp.

**Default placement (no custom layout)** — the card lays its content in vertical
thirds (`FlashCardSection.tsx` `CardFaceSide`): the default single icon sits in the
upper third (`DEFAULT_ICON_Y = 0.3333`, ≈2/3 up from the bottom), the word text in the
lower third (`top: 66.67%`, ≈1/3 up from the bottom). The default icon is rendered by
the **same `CardIconLayer` + `defaultLayoutForIcon` path the editor seeds with**
(`{ x: DEFAULT_ICON_X, y: DEFAULT_ICON_Y, scale: DEFAULT_ICON_SCALE }`), so its size
(`BASE_ICON_FRAC × DEFAULT_ICON_SCALE` of card width) matches the edit-mode display
exactly — there is no separate fixed-pixel render to drift out of sync.

No foreign key is placed on the ids inside the jsonb. If an icons8 row is ever
deleted, that icon's image endpoint simply 404s and renders nothing — the same risk
class as `users."avatarIconId"` (migration 77), which uses `ON DELETE SET NULL`.

The column flows into reads automatically: vocab reads select `ve.*`
(`server/dal/implementations/VocabEntryDAL.ts`) and the zh source wrapper in
`server/dal/shared/vetTable.ts` (`vetReadFrom`) uses `SELECT *`, so no select-list
changes are needed. `DICT_COLS`/`dictJoin.ts` are for det columns and stay untouched.

## Default-query result cache (det) + picker prefetch

When the picker opens it pre-fills its search box with the card's English meaning (the
**default query**) so relevant icons surface immediately. Two pieces make that instant:

1. **The query is computed by one shared function** — `iconSearchTerm(definition)` in
   `src/utils/definitionUtils.ts`. It applies `stripParentheses` (so the term matches the
   card's `EnglishBlock` display) then an **ordered list of leading-phrase strips**
   (`ICON_SEARCH_LEADING_STRIPS`: `to be ` then `to `, so "to understand" → "understand",
   "to be hungry" → "hungry"). Add new strip rules to that list only — every caller
   (picker `initialTerm`, the prefetch term) goes through this one function. Previously the
   `initialTerm` sent the **raw first definition** (`definitions[0]`, parentheses and all);
   it now sends the parsed term.

2. **The response is cached on det** — nullable `jsonb` column **`defaultIconResults`** on
   both det tables (`dictionaryentries_zh`, `dictionaryentries_es`), migration
   `database/migrations/87-add-default-icon-results-to-dictionaryentries.sql`. It stores the
   **first page** of the default query's icons8 search response as `[{ id, name }, …]`
   (ids+names only — tiles preview from the icons8 CDN by id). `NULL` = never warmed; `[]` =
   warmed but the term matched nothing. The cache lives on the **shared det row** (not vet)
   because the default query is a pure function of the entry's definition, so it's
   word-global: the first learner to open the picker for a word warms it for everyone. We
   store the **response, not the query** — the query is cheap to recompute; the icons8
   round-trip is the slow part. It is **deliberately NOT in `DICT_COLS`** (it would bloat
   every flashcard read with ~48 rows); it's fetched on demand instead.

**Flow:** entering edit mode (`enterEdit` in `FlashcardsLearnPage.tsx`) fires
`fetchDefaultIconResults` (fire-and-forget) → `POST /api/icons8/default-results`. The server
(`Icons8DAL.getOrWarmDefaultIconResults`) resolves the det row (es prefers the saved-pos row,
mirroring `DICT_JOIN`), returns `defaultIconResults` on a hit, or on a miss runs **one** live
icons8 search with the client-supplied `term`, writes it back to det, and returns it. The page
holds the result tagged with the card id; `IconPickerDialog`'s `prefetched` prop renders that
first page with **no network hit** when the box's term matches. Typing a different term — or
paging past page 0 — falls back to the live `/api/icons8/search` as before.

## Edit-mode UX (presentation layer)

All in `src/pages/FlashcardsLearnPage/`.

1. **Header** (`FlashcardsLearnHeader.tsx`)
   - The `autoplay` quick-toggle is **removed** from the header (it remains in the
     Settings sheet, `SettingsPanelBody.tsx`).
   - An **edit** button is added. It is **enabled only when the card is flipped to
     the back** (`disabled={!isFlipped || editMode}`) and greyed out on the front,
     because the arrangement lives on the back face.

2. **Floating edit toolbar** (`CardEditToolbar.tsx`) — rendered as an **absolute
   overlay inside `ContentArea`** (which is `position: relative`), so the toolbar itself
   does NOT change the card-slot's flow height. Instead, in **advanced** mode (when the
   toolbar grows to three rows) the **card is pushed down** toward the bottom of the
   screen so the toolbar clears it with a healthy gap: `DraggableCardContainer` takes a
   `pushDown` prop (`editMode && advMode`) that swaps its symmetric `48px 40px` padding
   for a large top inset (`148px 40px 28px`), **transitioned** so the card glides
   down/up. Basic mode keeps the single static row, so the card stays centered.

   **Animations (all share one timing — both directions).** The toolbar drop, the
   advanced-rows reveal, and the card push-down all run at `CARD_EDIT_ANIM_MS = 300` with
   easing `CARD_EDIT_ANIM_EASING = cubic-bezier(0.22, 1, 0.36, 1)` (exported from
   `CardEditToolbar.tsx`), so they move in lockstep on **open AND close**:
   - **Toolbar** — wrapped in MUI **`<Slide direction="down">`** in
     `FlashcardsLearnPage.tsx` (`in={editMode}`, `mountOnEnter`/`unmountOnExit`): drops in
     from behind the header on enter, slides back up on exit.
   - **Advanced menu** — the merged wrapping flex-list menu is wrapped in MUI **`<Collapse>`**
     (`in={advMode}`, `unmountOnExit`): height-expands on adv-on, collapses up on adv-off.
     (The align/order dropdowns are portaled, so Collapse's height clipping doesn't affect
     them.)
   - **Card** — the `DraggableCardContainer` `padding` `transition` animates both ways.

   Using `Slide`/`Collapse` (react-transition-group) instead of mount-only `@keyframes` is
   what makes the **closing** motion match the opening one.

   **More Info pill** — stays **drawn but greyed + inert** while editing
   (`isDisabled={editMode}` on `MoreInfoPill`, `FlashcardsLearnPage.tsx`), NOT removed.
   In advanced mode the card slides down **over** it: the card slot is raised
   (`zIndex: 3` when `editMode && advMode` in `FlashCardSection.tsx`) above the pill's
   `zIndex: 2`, so the card paints over the pill rather than the pill floating on top.

   The toolbar has **two modes**, toggled by the **adv** button (`Tune` icon,
   filled when active); the page tracks this as `advMode`.

   **Two drafts, preserved across the toggle** — the page holds `basicDraft` (the
   single-icon view, 0–1 items) and `advDraft` (the multi-icon arrangement) at once.
   The active draft is `advMode ? advDraft : basicDraft`; the card displays it and Save
   persists it ("show / save whichever mode the user is in"). Toggling `adv` only
   switches which draft is active — **neither is destroyed**, so the user can flip back
   and forth without losing either view.

   **Basic mode**: the card shows a single icon and the gesture canvas is NOT mounted.
   The contextual left button is **change icon** (`Autorenew` cycle icon) — opens the
   picker; on select it **replaces** `basicDraft` with one default-positioned icon (the
   "swap"). Always valid here because basic is always a single icon. The **basic row is
   now static** — the only thing that changes between modes is this left button's
   add-icon / swap-icon label + action (the `count/12` readout has moved to the advanced
   menu; see below).

   **Advanced mode**: the gesture canvas is live (drag / resize / rotate / add /
   delete) over `advDraft`. The left button (on the static basic row) becomes **add
   icon** (`Add` ＋, disabled once 12 icons are placed), and **one merged tool menu** drops
   in below — a single container (`card-edit-toolbar__adv-menu`) laid out as a **wrapping
   flex list** (`display: flex; flexWrap: wrap`): each tool hugs its own content (`smallBtnSx`)
   and items flow left-to-right, collecting onto the next line when a row overflows (no fixed
   columns / table widths). The align/order dropdowns are children of the list but portal /
   return null, so they take no slot. The tools, in order:

   - **undo** (`Undo`) — reverts the last edit action. Disabled with an empty undo stack.
   - **redo** (`Redo`) — replays the most recently undone action. Disabled with an empty
     redo stack; the redo stack is cleared whenever a fresh tracked action occurs (see
     "Undo/redo history" below).
   - **delete** (`DeleteOutline`) — removes the **selected** icon (no confirmation).
     Disabled when nothing is selected.
   - **duplicate** (`ContentCopy`) — clones the **selected** icon's appearance
     (`iconId` / `scale` / `rotation` / `flipX`) but drops the copy at the **default
     new-icon spawn spot** (card center `x:0.5, y:0.5`) on top of the stack, then selects
     the copy (`handleDuplicateSelected`). Disabled when nothing is selected **or** at the
     12-icon max.
   - **mirror** (`Flip`) — toggles `flipX` on the selected icon. Disabled when nothing
     is selected.
   - **lock** (`LockOpen` → `Lock`) — toggles `locked` on the selected icon
     (`handleToggleLock`). A locked icon stays **selectable** but ignores the canvas
     translate / resize / rotate gestures; its corner indicator turns into a **golden lock
     symbol** (see the gesture-canvas section). The button **label is always "lock"** in
     both states; the locked state is signalled only by the **golden** filled lock icon +
     filled-golden button styling (`selectedLocked` drives it), vs. the open-lock icon when
     unlocked. Disabled when nothing is selected. Lock is **not** an undoable action — see
     "Undo/redo history" below.
   - **align** / **snap** / **order** — the three dropdown tools (see below).
   - the **`count/12` readout** (`Typography`) — the last item in the list, vertically
     centered (`alignSelf: center`); moved here off the basic row.

   *The align + snap + order dropdowns are **non-modal**.* They render with `hideBackdrop` +
   `slotProps.root.sx.pointerEvents: "none"` / `slotProps.paper: "auto"`, so a press
   anywhere outside the open dropdown is **not** swallowed by a modal backdrop — it falls
   straight through to the canvas/toolbar. Because that removes MUI's own backdrop-click
   `onClose`, the toolbar closes them itself: a capture-phase `document` `pointerdown`
   (effect keyed on the three anchors) closes whichever is open whenever the press lands
   outside it (`closest('.card-edit-toolbar__align-menu, .card-edit-toolbar__order-popover,
   .card-edit-toolbar__snap-menu')` guards inside presses). Net effect: trying any action while
   a dropdown is open (drag an icon, hit another tool) **both dismisses the dropdown and performs
   the action** in the one press, instead of the first press being eaten just to close the menu.
   The snap menu is the exception that *stays* open on an inside press (its rows are inside
   `.card-edit-toolbar__snap-menu`), so several toggles can be flipped in one open.

   - **align** (`CropSquare`) — opens a dropdown laid out as a **3×3 grid of direction
     cells with the center cell empty** (8 directions: the 4 cardinals + the 4 **45°
     diagonals**). Each cell shows an upward arrow spun toward its direction; clicking it
     snaps the selected icon's `rotation` to that absolute orientation. The grid +
     rotations come from `ALIGN_ROTATION` in `cardIconLayout.ts`
     (`up:0, up-right:45, right:90, down-right:135, down:180, down-left:225, left:-90,
     up-left:-45`) — the same angle each cell rotates its arrow by, so arrow ⇔ result
     always match. `AlignDirection` (8-member union) lives there too and is re-exported
     from `CardEditToolbar.tsx`. Disabled when nothing is selected.
   - **snap** (`GridOn`) — opens a dropdown of **three independent toggle rows** (move /
     rotate / resize), each quantizing its operation to a discrete increment. The button is
     **filled when ANY toggle is on** (`anySnapOn`) and is disabled when the card is empty
     (`count === 0`). Each row shows an icon + label + a trailing check that fades in when
     active; pressing a row toggles it **without closing the menu** (so several can be set in
     one open). The increments (helpers in `cardIconLayout.ts`):
     - **move** → icon CENTER snaps to a grid whose spacing is **5% of the card width** in
       both physical axes (`snapCenterToGrid`; the y-step is `0.05 × CARD_ASPECT` in height
       fractions since the grid is square in pixels — `CARD_ASPECT = 295/426`, the fixed card
       aspect, so the math needs no pixel rect).
     - **rotate** → rotation snaps to the nearest **22.5°** (`snapRotation`; 16 steps/turn).
     - **resize** → the rendered icon SIZE (`BASE_ICON_FRAC × scale` of card width) snaps to
       the nearest **5% of the card width** (`snapScaleToStep`, clamped to the scale range).

     **Two-layer behavior.** (1) *Turning a toggle ON snaps every icon immediately* — the page
     handlers (`handleToggleSnapMove/Rotate/Resize` → shared `applySnapAll`) snapshot history
     once, then map the snap over `advDraft`, so existing off-grid placements jump onto the
     grid in one undo step. (2) *Future gestures stay quantized* — the toggles are passed to
     `CardIconCanvas` as a `snap: { move, rotate, resize }` `SnapConfig`, and its drag /
     pinch / corner-handle handlers apply `snapCenterToGrid` / `snapScaleToStep` /
     `snapRotation` live while the matching flag is on. Turning a toggle OFF only flips the
     flag (icons keep their snapped values). Snap state is **editor-only** (not persisted) and
     is cleared on `exitEdit`. The align action's fixed rotations (multiples of 45°) are
     already on the 22.5° grid, so rotate-snap never fights it.
   - **order** (`Layers`) — opens a compact popover (`CardIconOrderList`, width fits its
     contents) listing every icon in paint order (**top of the list = rendered on top =
     highest `z`**). Each row is just the icon thumbnail + a trailing triple-dot
     **movement indicator** (no text label); the **whole row is the drag trigger** (press
     anywhere on it, not only the dots). The card restacks **live as you drag** — every
     time the placeholder lands on a new slot the new `z`-order is pushed up via
     `onReorder` (top row = highest `z`), so the arrangement previews in real time rather
     than only on release. A plain tap (no movement) is a no-op for `z` (no rewrite, no
     undo entry). **Pressing any row also selects that icon** (`onSelectIcon`) — whether or
     not a reorder drag follows — so the canvas highlights it and the per-icon tools target
     it. Disabled when the card is empty.

     *Gesture wiring (`CardIconOrderList`):* on row `pointerdown` the component selects the
     row's icon, sets a drag state, then tracks the pointer via **window-level
     `pointermove`/`pointerup`/
     `pointercancel` listeners** for the gesture's duration. It deliberately does **not**
     bind handlers to the dragged row (it is swapped for a placeholder immediately, so a
     row-bound handler would unmount mid-drag → the old "release freezes" bug) and does
     **not** use `setPointerCapture` (capture can throw / be lost on some touch+Safari
     paths, which silently aborted the whole drag → the old "drag does nothing" bug).
     Window listeners make the drag complete wherever the pointer travels or releases.

   **Undo/redo history** — the page keeps two capped stacks (`ADV_HISTORY_MAX = 100`) of
   prior `advDraft` snapshots: `advHistory` (undo) and `advFuture` (redo). Every discrete
   action pushes the PRE-change snapshot onto `advHistory` via `pushAdvHistory` *before*
   mutating: gestures snapshot once on the **first real movement** (`onInteractionStart`,
   fired by `CardIconCanvas` from the `onDrag`/`onPinch` memo factory, and from the corner
   handle's `first` frame) — deliberately **NOT** on `onDragStart`/`onPinchStart`, because a
   **tap-to-select also fires those start events** (tap-vs-drag isn't decided until release),
   so snapshotting there pushed a no-op entry on every selection tap and made undo/redo
   appear to "do nothing" for a press or two. add / delete / duplicate / align / mirror
   snapshot in their page handlers, and a **reorder drag** snapshots once via
   `onReorderStart` on its first change (the live `onReorder` calls during the drag do NOT
   snapshot, so the whole drag collapses to one undo step). `pushAdvHistory` also **clears
   `advFuture`** — a fresh action discards any abandoned redo branch (the standard editor
   rule). `undoAdv` pops `advHistory`, pushes the current draft onto `advFuture`, and
   restores. `redoAdv` does the mirror: pops `advFuture`, pushes the current draft back onto
   `advHistory`, and re-applies. Both clear selection. The shared cap-aware push is
   `pushHistorySnapshot`. Both stacks are cleared on enter/exit edit.

   **Lock is orthogonal to history** — toggling **lock** (`handleToggleLock`) pushes **no**
   undo entry, and undo/redo never change any icon's lock state. When `undoAdv`/`redoAdv`
   restore a snapshot they run it through `withLiveLocks`, which keeps the snapshot's
   geometry but re-applies the **currently-live** `locked` flags (matched by icon index
   against the live draft). Result: you can lock an icon and still undo/redo its
   position/scale/rotation, and an undo never silently re-locks or unlocks anything. (Icons
   resurrected by undoing a delete come back unlocked, since they have no live counterpart.)

   **Render order is no longer last-touched.** Selecting an icon does NOT change its `z`
   (the old `z = max+1`-on-select was removed). The selected icon only *visually* floats
   to the front (a transient high `zIndex`) **while it is actively being dragged / pinched /
   resized** — driven by `CardIconCanvas`'s `interacting` flag, set on gesture start and
   cleared on gesture end. It must NOT float merely because it is selected: that pinned the
   icon on top for the whole selection and **masked the order list's reordering of that
   icon** (you'd reorder in the dropdown but see no change until you deselected). Paint
   order is owned solely by the order dropdown, which reassigns `z` (the array order is
   left untouched so the page's selection index stays valid).

   **Selection is lifted to the page** (`selectedIcon`, an index into `advDraft`) and fed
   to `CardIconCanvas` as a controlled `selected`/`onSelect` pair so the per-icon toolbar
   tools can act on it. It is cleared on deselect, delete, undo, and whenever advanced
   mode is toggled off (the basic view has no selectable icons).

   **reset to default** is a standalone button in the right cluster, available in **both
   modes** (clears the saved arrangement back to the default icon; confirmation-gated —
   see below). Both modes also always show the **adv** toggle, **Save** (persists the
   active draft, exits), and **Cancel** (discards, exits). **Save shows a spinner**
   (`CircularProgress` replacing the label) while the PATCH is in flight (`saving`).

   While editing, minute-points accumulation is **paused** (decorating a card isn't
   study time): the page sets a global flag (`utils/minutePointsPause.ts`) that
   `useMinutePoints` reads to skip its per-second tick, and `MinutePointsFireBadge`
   greys the flame and overlays a red no-entry symbol.

3. **Gesture canvas** (`CardIconCanvas.tsx`) — overlays the back face in **advanced
   mode only** (`editMode && advMode`); basic mode renders the draft through the static
   icon-layer path instead (the page feeds `draftLayout` onto the active entry's
   `iconLayout` via `editingCurrentEntry`, so the basic-mode card is WYSIWYG without a
   live canvas). The canvas is built on `@use-gesture/react` (`useGesture`, bound
   per-icon via `bind(index)`):
   - drag moves an icon (updates `x`,`y`); pinch resizes + rotates (two-finger:
     distance → `scale`, angle → `rotation`).
   - Desktop: drag plus a corner handle on the selected icon for resize/rotate (the
     handle computes scale from the pointer's distance to the icon center, rotation
     from its angle).
   - **Locked icons** (`item.locked`, set via the toolbar's lock button): drag / pinch /
     handle-resize all early-return for a locked icon, so it ignores translate / resize /
     rotate. It is still **tap-selectable** (the `onDrag` tap branch is not gated), so it
     can be unlocked or deleted — but a tap on overlapping icons **prefers the unlocked one
     beneath it** (`pickTapTarget`): it hit-tests every icon box under the tap and selects
     the topmost UNLOCKED icon, only landing on a locked icon when there is no unlocked icon
     at that point. So a locked icon sitting on top never blocks selection of an editable
     icon under it. The selected icon's corner indicator swaps from the
     `OpenWith` resize glyph to a **golden** (`#E0A82E`) `Lock` glyph and becomes inert,
     and the icon box drops its grab cursor. `locked` persists in the saved jsonb but is
     **ignored by the read-only renderer** (`CardIconLayer`) — it's an editor-only concept.
   - **Selecting / selection switching** — a **tap** selects an icon under it (the
     `onDrag` tap branch, via `filterTaps`), preferring the topmost unlocked icon at that
     point (`pickTapTarget`, see "Locked icons" above). A **drag/pinch** does not blindly grab the
     icon it lands on: `resolveTarget` decides whether it acts on the **already-selected**
     icon or **auto-switches** to the one pressed:
       - The selected icon (when **unlocked**) owns a **protected zone** = its box expanded
         outward by `PROTECT_MARGIN_FRAC` (15% of the card width) on every side. A gesture
         STARTING inside the zone keeps acting on the
         selected icon, so an overlapping neighbour can't steal a fine manipulation; a
         gesture starting OUTSIDE the zone switches selection to the icon it landed on and
         acts there. The zone test (`withinSelectedZone`) is an axis-aligned box check in
         normalized canvas space (rotation ignored — a good-enough heuristic).
       - A **locked** selected icon has **no** protected zone (it can't be manipulated
         anyway), so a gesture in ANY location passes straight through: it switches
         selection to the pressed icon and acts there.
       - **Actions only ever apply to the resolved target** (which is also the icon selection
         switches to). The target is committed **synchronously** to `gestureTargetRef` at
         gesture start (and pinned in `memo`), so a gesture that starts outside the zone both
         switches selection AND moves/resizes the new icon in the SAME stroke — it does NOT
         re-derive the target from the async `selected` state (which lags a render, so the
         old code dropped the motion and "only selected"). A locked TARGET still becomes
         selected but is frozen (no move/resize/rotate).
     Selection shows a dashed outline + the corner handle and floats the icon visually
     (transient high `zIndex`) — but does **not** change its stored `z` (paint order is
     owned by the order dropdown). Selection is controlled by the page (`selected`/`onSelect`).
   - **Off-card drag** = on release, an icon dragged too far off-card is snapped back via
     `clampIconCenter` so at least 15% of the **icon's own size** (`MIN_ON_CARD_FRAC`, in
     `cardIconLayout.ts`) stays on-card in both axes — it is NOT deleted. The threshold is
     icon-relative (same fraction on each axis); since the icon is square in px but `x`/`y`
     are normalized to card width/height, the clamp expresses the icon's half-size in each
     axis's own units via the canvas aspect ratio.
   - **Delete** = use the advanced toolbar's delete button on the selected icon (the only
     way to remove an icon now that off-card drag snaps back).
   - The canvas sits BEHIND the card content (icons are always behind the text), and
     the content is kept fully visible but `pointerEvents: none` while editing, so the
     edit is WYSIWYG and pointers fall through the text to the icons below.
   - The card is **locked** while editing: `FlashCardSection` does not attach the
     drag/flip handlers (`editMode` gate), so it can't be swiped away or flipped.

   Three non-obvious gotchas the implementation handles (don't regress them):
   - **Stacking context**: both `CardIconLayer` and `CardIconCanvas` roots set an
     explicit `zIndex: 0`, which establishes a stacking context that CONFINES the
     per-icon zIndex values. Without it, an icon with `z >= 1` competes directly with
     the content (`zIndex: 1`) and paints OVER the text (the "text beneath the icons"
     bug, visible once 3+ icons exist).
   - **Handler composition**: each icon spreads `{...bind(i)}` (which includes
     @use-gesture's `onPointerDown` that *starts* the gesture). Our own
     `onPointerDown` (stopPropagation + select) must be declared after the spread and
     **call the bound `onPointerDown`**, or it silently overrides it and dragging
     never starts. Selection lives on `pointerDown` (not `onDragStart`) because
     `filterTaps` suppresses the drag gesture entirely for a pure tap.
   - **3D-flip hit-testing**: CSS backface culling does **not** reliably exclude the
     rotated-away front face from hit-testing, so while editing the front
     `CardFaceSide` is made `inert` (`pointerEvents: none`) — otherwise it intercepts
     the back canvas's pointer events through the flip. See the `inert` prop in
     `FlashCardSection.tsx`.
   - **Inner-img inline gap (entering/exiting must not jump)**: the static
     `CardIconLayer` positions each icon by styling the `<img>` *itself* as the box
     (`iconItemStyle`), but the canvas wraps the `<img>` in a positioned `<div>`
     (so it can carry the selection outline + handle). A default `display: inline`
     `<img>` adds a baseline descender gap (~4px) that inflates the wrapper past its
     `aspect-ratio: 1/1` height; because the box is centered via
     `translate(-50%, -50%)`, that shifted the icon ~2px UP versus the saved render —
     a visible jump when entering/exiting the editor. The canvas's inner `<img>` is
     therefore `display: block` so both renderers share identical geometry.

4. **Seeding** — entering edit mode seeds both drafts from `currentEntry.iconLayout`,
   and chooses the starting mode by its size:
   - **advanced layout** (`isAdvancedLayout` — multiple icons, OR a single icon that's
     been moved / resized / rotated, i.e. not at the canonical default placement) →
     `advDraft` = the saved layout, **auto-open advanced** (`advMode = true`);
     `basicDraft` falls back to the default single icon (`defaultLayoutForEntry`:
     `{ iconId, x: DEFAULT_ICON_X, y: DEFAULT_ICON_Y, scale: DEFAULT_ICON_SCALE,
     rotation: 0, z: 0 }`), so toggling adv off shows that while the arrangement is kept.
   - **1 default-placed icon** → both drafts seed from it, basic mode (advanced can
     build on it).
   - **none** → default single icon in both drafts, basic mode.

   The basic-vs-advanced split is inferred from geometry (no stored mode flag): the
   basic "change icon" swap always writes exactly the default placement, so anything
   else reads back as advanced. `isAdvancedLayout` / `isDefaultPlacement` live in
   `cardIconLayout.ts`. `isDefaultPlacement` accepts the current default scale (1.2)
   **or** the legacy 1.0 (basic saves before the 20%-larger bump), so pre-existing
   basic-saved cards still open in basic mode rather than auto-opening advanced.

5. **Icon picker dialog** (`src/components/IconPickerDialog.tsx`) — the shared icon
   search + browser used by both this editor and the avatar picker (Account page). One
   search box (default empty): an **empty query browses all downloaded icons** (paged
   `GET /api/icons8`, rendered via our cached `/image` endpoint, like the old avatar
   picker), while a **typed query runs the icons8 search proxy** with tiles previewing
   from the icons8 CDN (`https://img.icons8.com/?id=<id>&format=png&size=96`, public,
   no token). On select the icon is **downloaded + cached** into our `icons8` table
   (idempotent — a no-op for already-downloaded icons) and handed to `onPick`
   (`handlePickIcon`). What `onPick` does depends on the mode: **advanced** appends the
   icon to the canvas at center; **basic** replaces the whole draft with that one icon
   at the default spot (the "change icon" swap). Avatar-only extras (`currentIconId`
   highlight, `onRemove` button) are optional props. 3-column grid. There is **no
   Cancel button** — tapping the backdrop closes the dialog (`onClose`); the actions bar
   renders only when `onRemove` is supplied (the avatar "Remove" action).

   The optional **`prefetched`** prop (`{ term, icons }`) lets the editor hand the dialog
   the warmed default-query first page: when the box's term equals `prefetched.term`, page 0
   renders from it with no network fetch (see "Default-query result cache" above). The avatar
   picker omits the prop and is unaffected.

6. **Reset to default** — shows a confirmation dialog first; on confirm it nulls the
   layout (`PATCH …/icon-layout { iconLayout: null }`), drops the custom arrangement,
   restores the default centered det icon, and exits edit mode.

   **Greyed out when there's nothing to reset** (`canReset` on the page → the toolbar's
   `disabled`). The rule keys off `isPlainDefaultLayout(draft, entry.iconId)` (a single
   default-placed icon that IS the det default):
   - **Advanced**: enabled when the active `advDraft` isn't the plain default **OR** the
     undo stack is non-empty (`advHistory.length > 0`). So a saved advanced design opens
     enabled, and a fresh default card becomes resettable once any tracked action occurs
     (even if it nets back to default).
   - **Basic**: enabled when `basicDraft` differs from the plain default — a saved
     changed icon opens enabled; an untouched default stays greyed until a "swap icon".

## API (server)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/icons8?offset=&limit=` | yes (existing) | List downloaded/cached icons (the browse-all state when the search box is empty); returns `{ icons: [{ id, name }], total, hasMore }`. |
| `GET /api/icons8/search?term=&offset=&limit=` | yes | Proxy the live icons8 v7 search; returns `{ icons: [{ id, name }], hasMore }`. |
| `POST /api/icons8/default-results` | yes | Body `{ language, entryKey, pos?, term }`. Return (and cache on first call, on det `defaultIconResults`) the first page of the card's default-query results: `{ icons: [{ id, name }] }`. Warms the picker so it renders instantly on open. |
| `POST /api/icons8/:iconId/ensure` | yes | Download + cache the icon's SVG into the `icons8` table if missing (so `/api/icons8/<id>/image` can serve it). Idempotent. |
| `PATCH /api/vocabEntries/:id/icon-layout` | yes | Body `{ iconLayout: Item[] \| null }`. Persist or clear the layout for the caller's vet row. |
| `GET /api/icons8/:iconId/image` | no (existing) | Serves cached icon bytes. Unchanged ([Icons8Controller.ts](../server/controllers/Icons8Controller.ts)). |

**Search filters** mirror the representative-icon backfill exactly:
`isAnimated=false, style=color, language=en, isOuch=true, replaceNameWithSynonyms=true`,
with the token from `process.env.ICONS8_API_KEY`. The icons8 search response carries
**ids + metadata only (no image URL)** — hence the CDN-by-id preview for tiles and
the separate download-on-select step.

**Code organization**
- `server/services/Icons8FetchService.ts` (new) — `searchIcons(term, opts)` and
  `getIconById(id)`, extracted from the duplicated logic in
  `server/scripts/backfill/backfill-icons.js` (which is refactored to import them).
- `server/dal/implementations/Icons8DAL.ts` — `ensureCached(iconId)` inserts/updates
  the row via the same column set as the backfill's `insertIcons8Row`.
- `server/controllers/Icons8Controller.ts` — `searchIcons`, `ensureIcon` handlers;
  routes registered in `server/server.ts` (near the existing icons8 routes).
- `server/controllers/VocabEntryController.ts` + `VocabEntryDAL.ts`
  (`IVocabEntryDAL`) — `updateIconLayout(userId, id, layout)`, scoped by `userId`,
  validating: `null` OR an array of ≤ 12 items with a string `iconId`, numeric
  `x`/`y`/`scale`/`rotation`/`z`, and optional booleans `flipX` and `locked` (both
  coerced; omitted when false) — else `400`. `z` is renumbered 0..n-1 by ascending `z`
  on save.

**Types** — `IconLayoutItem` (with the optional `flipX` and `locked`) + `iconLayout?:
IconLayoutItem[] | null` on the `VocabEntry` interface, in both `server/types/index.ts`
and client `src/types.ts`.

## Dependencies / cross-references

- Default-icon rendering: `FlashCardSection.tsx` `CardFaceSide` →
  `CardIconLayer` + `defaultLayoutForIcon` (`cardIconLayout.ts`). `CardImage` in that
  file is now just the no-icon placeholder box.
- Icon image serving + storage: [Icons8Controller.ts](../server/controllers/Icons8Controller.ts),
  `icons8` table (migration 71), representative-icon backfill
  `server/scripts/backfill/backfill-icons.js`.
- Avatar picker (shares `IconPickerDialog`; consumed in `src/pages/AccountPage.tsx`):
  `users."avatarIconId"` (migration 77).
- vet read plumbing: `server/dal/shared/vetTable.ts`, `server/dal/shared/dictJoin.ts`,
  `server/dal/implementations/VocabEntryDAL.ts`.
- Greyed-lockout edit pattern: [PRACTICE_WRITING.md](./PRACTICE_WRITING.md).
- Multi-language vet scoping: [MULTI_LANGUAGE_IMPLEMENTATION.md](./MULTI_LANGUAGE_IMPLEMENTATION.md).
- **Community sharing** — advanced layouts (`isAdvancedLayout`, multi-icon or a moved single
  icon) are surfaced to other learners on the Community page, where they can be upvoted and
  copied onto a card via the same `updateIconLayout` path: [COMMUNITY_PAGE.md](./COMMUNITY_PAGE.md).
  The advanced-vs-basic geometry test (`isAdvancedLayout`/`isDefaultPlacement` in
  `cardIconLayout.ts`) is mirrored server-side in `server/dal/shared/advancedLayout.ts`.
