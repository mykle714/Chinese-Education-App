# Custom Card Icon Layout (flp)

> Status: **implemented**. Backed by migration 82 (`iconLayout`) + migration 88
> (`snapConfig`, per-card snap toggles) + migration 89 (`textColors`, per-card Contrast
> text colors) + migration 91 (`textLayout`, per-card **movable text** — see "Movable text"
> below) + migration 94 (`cardColor`, per-card **card background fill** — see "Card
> background fill" below), the icons8 search/ensure and vocabEntries icon-layout endpoints,
> and the flp edit-mode UI.
> The editor has **two modes** — basic (swap the single icon) and advanced (the full
> drag/resize/rotate canvas, plus per-icon tools merged into **one wrapping flex-list menu**:
> delete / duplicate / mirror / undo / redo / lock / shift / **card** / align / snap / order /
> count, flowing onto the next line when a row overflows). The **card** tool (internal key
> `contrast`) opens a per-card appearance menu — a background-fill swatch row plus the two
> text-color rows. In
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
`src/features/flashcards/FlashcardsLearnPage/FlashCardSection.tsx` `CardFaceSide`), so its on-screen
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
canvas), and are **clipped to the card boundary** — icons dragged partially off the
card are cut off, never painted outside the card.

**Where the clip lives (face split).** `CardFaceSide` is split into an **outer** box
(the 3D-flip/backface/`inert` face, `overflow: visible`) and an **inner** box
(`inset: 0`, `overflow: hidden`, rounded corners) that does the actual card-boundary
clipping. The static `CardIconLayer` and `CardContent` live in the **inner** clip box.
The live **edit canvas** lives in the **outer** box (so its selection indicators may
overflow the card edge — see the gesture-canvas section); the canvas clips its **own**
icons internally instead. This split is what lets the selection outline + resize handle
poke past the card boundary into the surrounding card padding while ordinary icons stay
clipped. (`FlashCardSection.tsx` `CardFaceSide`.)

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
advanced arrangements**, using the shared `isAdvancedLayout()` gate (multiple icons,
OR a single icon moved/resized/rotated off its default placement). Plain default-icon
cards keep the icon-free thumbnail. (Note: a single *advanced* icon still renders — an
earlier `iconLayout.length > 1` shortcut here wrongly dropped those.) The layer sits at `zIndex 0`
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
  "scale":    1.25,     // multiplier on the base box; clamped ~[0.25, 5]
  "rotation": 0,        // degrees
  "z":        0,        // paint order; higher = front. Normalized to 0..n-1 on save.
  "flipX":    true,     // OPTIONAL horizontal mirror (the "mirror" action); omitted/false = not mirrored
  "locked":   true      // OPTIONAL lock (the "lock" action); icon ignores translate/resize/rotate gestures. omitted/false = freely editable
}
```

**Default scale is `DEFAULT_ICON_SCALE = 1.25`** (the default icon renders 25% larger
than the base box). 1.25 is picked so the default size lands exactly on the size-snap
grid (`BASE_ICON_FRAC × 1.25 = 0.35 = 7 × the 0.05 SNAP_SIZE_STEP_FRAC`), so toggling
size-snap on never resizes a default icon. It applies to every newly created item: the seeded basic icon, a
basic "change icon" swap, and an icon spawned into advanced mode. Existing saved layouts
keep their own stored `scale`. `flipX` is mirrored at render time via
`scaleX(-1)` in `iconItemStyle` (applied AFTER `rotate`), shared by both renderers
(`CardIconLayer`, `CardIconCanvas`) and the order-list thumbnails.

**Per-card snap toggles — `snapConfig` jsonb** on both vet tables (migration
`database/migrations/88-add-snap-config-to-vocabentries.sql`). Shape
`{ "move": bool, "rotate": bool, "resize": bool }`; `NULL` = all off. Persists the
editor's snap setup per saved word (see the snap tool under "Edit-mode UX"). Written
together with `iconLayout` by the same `PATCH …/icon-layout`. Type `SnapConfig` lives in
`src/types.ts` + `server/types/index.ts` (re-exported from `CardIconCanvas.tsx`).

**Per-card Contrast text colors — `textColors` jsonb** on both vet tables (migration
`database/migrations/89-add-text-colors-to-vocabentries.sql`). Shape
`{ "foreign": "theme"|"dark"|"light", "english": "theme"|"dark"|"light" }`; `NULL` = both
`theme`. Persists the editor's **Contrast** menu per saved word (see the Contrast tool under
"Edit-mode UX"). `foreign` colors the foreign-word **glyphs only** (the Chinese characters /
Spanish word) — the pinyin overlay is **never** affected; `english` colors the English
definition. `theme` follows the device/app theme (the existing default), `dark` forces black
(`#000`), `light` forces white (`#fff`). Written together with `iconLayout` by the same
`PATCH …/icon-layout`. Types `TextColorMode` / `TextColors` live in `src/types.ts` +
`server/types/index.ts`; the resolver `resolveTextColor` lives in
`src/utils/cardTextColor.ts` (returns `undefined` for `theme` so callers keep their
theme-aware default).

**Per-card card background fill — `cardColor` text** on both vet tables (migration
`database/migrations/94-add-card-color-to-vocabentries.sql`). A raw CSS hex string (NOT a
palette key), or `NULL` = the **auto** option = follow the active theme's default face
color. Persists the editor's **card** menu background swatch per saved word (the "card"
tool — internal key `contrast` — see "Edit-mode UX"). The offered chips (laid out in TWO
rows of five) are — row 1 (neutrals): `auto` (`NULL`, shown as the red no-fill glyph), grey
`#D8D8DC`, beige `#F5EBE0`, white `#FFFFFF`, black `#000000`; row 2 (pastel hues): red
`#F2BAC9`, green `#BAF2D8`, blue `#BAD7F2`, yellow `#F2E2BA`, purple `#D8BAF2` (`grey` pins
the light-theme face color; `auto` merely follows the theme). It tints the **whole flashcard
face (both sides)** and the mini card thumbnails (`MiniVocabCard`). The single source of truth
for the palette is `CARD_COLOR_OPTIONS` in `src/utils/cardColor.ts` (explicit fills built from
`COLORS` design tokens —
`card`/`cardBeige`/`redAccent`/`greenAccent`/`blueAccent`/`yellowAccent`/`purpleAccent` — plus
white/black literals); the resolver
`resolveCardColor` there returns the hex for a vetted value or `undefined` (→ theme default).
The server keeps a hand-synced copy of the allowed hex set in `CARD_COLOR_VALUES`
(`server/types/index.ts`) and `VocabEntryService.validateCardColor` normalizes any
off-palette value to `NULL`. Written together with `iconLayout` by the same
`PATCH …/icon-layout` (stored via `"cardColor" = $n::text`, unlike the jsonb columns).

**Coordinates are normalized** (fractions of the rendered card size), so a saved
layout survives the card being rendered at different pixel sizes across viewports.
The on-screen box for an icon is `BASE_ICON_FRAC × cardWidth × scale`
(`BASE_ICON_FRAC ≈ 0.28`), positioned by its center at `(x·cardWidth, y·cardHeight)`,
then rotated `rotation` degrees. `scale` is clamped to `[0.25, 5]`; at max an icon
is ~1.4× the card width (`0.28 × 5 ≈ 1.4`). These
live in `cardIconLayout.ts` (`BASE_ICON_FRAC`, `SCALE_MIN/MAX`, `DEFAULT_ICON_*`); the
server's `validateIconLayout` mirrors **both** the scale clamp **and the center clamp** —
it re-implements `clampIconCenter`'s 15%-on-card rule (using duplicated `BASE_ICON_FRAC`
/ `CARD_ASPECT` / `MIN_ON_CARD_FRAC` constants) rather than forcing `x`/`y` into `[0,1]`.
This matters because the edit canvas legitimately lets an icon's center sit slightly past
the card edge (only `MIN_ON_CARD_FRAC` of the icon need stay on-card); clamping the center
to `[0,1]` on save would yank a mostly-off-card icon **deeper inward**, disagreeing with
what the editor showed.

**Default placement (no custom layout)** — the default single icon sits ≈1/3 down from the
top at a **grid-aligned** spot (`DEFAULT_ICON_X = 0.5`, `DEFAULT_ICON_Y = 10 × 0.05 × 295/426
≈ 0.34624`), and the two text blocks at their grid-aligned `DEFAULT_TEXT_CENTER` (see "Movable
text"). Both x/y and the default scale (1.25) lie exactly on the move/size snap grids, so
toggling snap in the editor never nudges a default icon or default text. (Legacy basic saves
wrote `y = 0.3333`; `DEFAULT_PLACEMENT_YS` still accepts it so they keep reading as basic — see
the basic-vs-advanced inference.) The default icon is rendered by
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

All in `src/features/flashcards/FlashcardsLearnPage/`.

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
   screen to clear as much of the toolbar as possible: `DraggableCardContainer` takes a
   `pushDown` prop that **redistributes** its symmetric `48px 40px` padding downward to
   `72px 40px 24px`, **transitioned** so the card glides down/up. Basic mode keeps the single
   static row, so the card stays centered.

   **The push-down is gated on ACTUAL overlap** — it fires only when
   `editMode && advMode && toolbarOverlaps`, not merely whenever advanced mode is on. On roomy
   viewports the card is small enough that the toolbar clears it with space to spare, so no
   shift is needed and the card stays centered (the greyed More Info pill simply remains
   visible below it). `toolbarOverlaps` is computed by **`useToolbarOverlap`**
   (`useToolbarOverlap.ts`): it compares the toolbar's measured bottom edge against where the
   card's TOP would sit in its **centered (non-pushed)** layout. That centered top is derived
   from the `ContentArea` box + the card's height and the exported slot-padding constants
   (`CARD_SLOT_TOP_PAD` / `CARD_SLOT_VPAD_SUM` in `styled.ts`). Crucially the card's on-screen
   height is **invariant to the push** (the size guarantee below), so the decision is computed
   from a value the push never changes — pushing the card can't feed back and un-trigger
   itself (no oscillation). The same `pushDown` gates the card slot's zIndex lift over the pill
   (`FlashCardSection.tsx`): a centered card doesn't reach the pill, so it must not steal the
   pill's stacking. The hook re-measures on ContentArea/toolbar/card resize, on window resize,
   and once after the `CARD_EDIT_ANIM_MS` entry animation settles (the toolbar's `<Slide>`
   transform isn't caught by `ResizeObserver`).

   **The push-down must NOT resize the card** — the fie shows the card at its exact flp
   size. `DraggableCardContainer` is the `@container` sizing target (`containerType:"size"`)
   and `CardAspectWrapper` fills its padded content box, so a height-bound card's size is
   `containerHeight − (topPad + botPad)`. The push-down therefore keeps the **vertical
   padding SUM constant at 96px** and only shifts the distribution downward (48/48 → 72/24),
   keeping the identical size on every viewport. (Growing the sum — the old `148/28` = 176px
   — shrank any height-bound card by 80px, the "canvas shrinks on certain screen sizes" bug;
   width-bound narrow viewports were unaffected because vertical padding isn't their size
   constraint.) On tight (height-bound) viewports a full-size card can't fully clear the
   3-row toolbar, so the toolbar simply overlays the top of the card — size preservation
   wins over clearance.

   **The pushed card is BOTTOM-ANCHORED** (`alignItems: flex-end` when `pushDown`), so its
   bottom margin is a constant 24px (= `botPad`) on **every** viewport — matching the More
   Info pill's own `bottom: 24` (of `ContentArea`). The card's bottom edge thus lands exactly
   at the pill's bottom edge, sliding down **just far enough to cover the greyed pill and no
   further**. Centering alone was not enough: on a width-bound viewport with vertical slack a
   centered card floats with a large bottom margin and never reaches the pill. `flex-end` only
   repositions the card (never resizes it), so the flp-size guarantee above still holds. Basic
   mode keeps `center` + the symmetric 48/48 padding.

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
   icon** (`Add` ＋, disabled once 12 icons are placed) — a newly picked icon spawns at the
   **basic-mode default icon spot** (`DEFAULT_ICON_X`/`DEFAULT_ICON_Y`, the centered upper-third)
   at `DEFAULT_ICON_SCALE`, on top of the stack (`handlePickIcon`), so it lands exactly where the
   single default icon sits. And **one merged tool menu** drops
   in below — a single container (`card-edit-toolbar__adv-menu`) laid out as a **wrapping
   flex list** (`display: flex; flexWrap: wrap`): each tool hugs its own content (`smallBtnSx`)
   and items flow left-to-right, collecting onto the next line when a row overflows (no fixed
   columns / table widths). The align/order dropdowns are children of the list but portal /
   return null, so they take no slot. The tools, in order:

   - **undo** (`Undo`) — reverts the last edit action (between **mirror** and **lock** in the
     menu). Disabled with an empty undo stack.
   - **redo** (`Redo`) — replays the most recently undone action. Disabled with an empty redo
     stack; the redo stack is cleared whenever a fresh tracked action occurs (see "Undo/redo
     history" below).
   - **delete** (`DeleteOutline`) — removes the **selected** icon (no confirmation).
     Disabled when nothing is selected.
   - **duplicate** (`ContentCopy`) — clones the **selected** icon's appearance
     (`iconId` / `scale` / `rotation` / `flipX`) but drops the copy at **card center**
     (`x:0.5, y:0.5`) on top of the stack, then selects the copy
     (`handleDuplicateSelected`). Disabled when nothing is selected **or** at the 12-icon max.
     (Note: unlike **add icon** — which spawns at the basic default spot — duplicate still drops
     at card center, so the copy visibly offsets from an original sitting at the default spot.)
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
   - **shift** / **contrast** / **align** / **snap** / **order** — the five dropdown tools
     (see below).
   - the **`count/12` readout** (`Typography`) — the last item in the list, vertically
     centered (`alignSelf: center`); moved here off the basic row.

   *Rapid-tap responsiveness (touch).* Spam-tapping any toolbar control (undo/redo, snap rows,
   contrast modes, shift-pad nudges) used to drop every **second** rapid tap on touch (mouse was
   fine). The cause was **not** the toolbar — it was the app-root zoom blocker `useBlockZoom`
   (`src/hooks/useBlockZoom.ts`): its `touchend` handler called `preventDefault()` on the second
   of two taps within 300ms to kill double-tap zoom, but `preventDefault()` on `touchend` **also
   cancels the synthetic `click`**, so the second rapid tap never fired its `onClick`. The fix:
   that handler now skips `preventDefault()` when the tap lands on an interactive target
   (`isInteractiveTarget` — native controls/roles/`[tabindex]`, plus a `cursor: pointer` fallback
   that catches the `<Box onClick>` menu rows), so control clicks survive while double-tap zoom is
   still blocked on non-interactive content.

   *The shift + contrast + align + snap + order dropdowns are **non-modal**.* They render with
   `hideBackdrop` + `slotProps.root.sx.pointerEvents: "none"` / `slotProps.paper: "auto"`, so a
   press anywhere outside the open dropdown is **not** swallowed by a modal backdrop — it falls
   straight through to the canvas/toolbar. Because that removes MUI's own backdrop-click
   `onClose`, the toolbar closes them itself: a capture-phase `document` `pointerdown`
   (effect keyed on the five anchors) closes whichever is open whenever the press lands
   outside it (`closest('.card-edit-toolbar__align-menu, .card-edit-toolbar__order-popover,
   .card-edit-toolbar__snap-menu, .card-edit-toolbar__shift-menu, .card-edit-toolbar__contrast-menu')`
   guards inside presses). Net effect: trying any action while a transient dropdown is open (drag
   an icon, hit another tool) **both dismisses the dropdown and performs the action** in the one
   press, instead of the first press being eaten just to close the menu. The snap, **shift**, and
   **contrast** menus are the exceptions that *stay* open on an inside press (their cells are
   inside the respective `…__snap-menu` / `…__shift-menu` / `…__contrast-menu`), so several
   toggles / nudges / settings can be made in one open. (The **align** menu is a one-shot: picking
   a direction performs the align *and* closes the menu.)

   *The **order** popover is **STICKY** — it is the exception to all of the above.* A learner
   selects an icon in the order list and then operates the per-icon tools on it (delete / mirror /
   lock / align / shift / …), so tapping **any** toolbar item or **any** other dropdown does **not**
   close the order popover. It dismisses **only** on a press fully **outside the editor UI** (the
   card canvas, the page chrome, etc.) — the `pointerdown` handler computes `insideEditorUi`
   (`closest('.card-edit-toolbar, …__align-menu, …__order-popover, …__snap-menu, …__shift-menu,
   …__contrast-menu')`, the menus being portaled to `<body>` rather than nested in
   `.card-edit-toolbar`) and clears the order anchor only when a press lands outside all of it.
   `toggleDropdown` reflects this: opening a transient dropdown leaves the order anchor untouched,
   and only the **order** button itself toggles order (which also closes the four transients).

   *Guard against accidental deselect when tapping a dropdown.* The page's outside-tap deselect
   (the `ContentArea` `onPointerDown` in `FlashcardsLearnPage.tsx` — clears the selected icon when
   a press lands outside the canvas/toolbar) must also exempt presses inside an open dropdown.
   The catch: those dropdowns are MUI `Menu`/`Popover` **portaled to `<body>`**, so a menu cell is
   NOT a DOM-descendant of `.card-edit-toolbar` — yet React **synthetic events bubble through the
   React tree, not the DOM tree**, so a press on a cell still fires `ContentArea`'s handler, and a
   `closest('.card-edit-toolbar')` test misses it. Left unhandled, the deselect runs *before* the
   cell's `onClick`, so `handleAlign` / `handleNudgeMove` see `selectedIcon === null` and no-op.
   The handler therefore also skips when `el.closest(TOOLBAR_DROPDOWN_SELECTOR)` matches — the
   shared selector exported from `CardEditToolbar.tsx` covering the five portaled dropdown root
   classes (`…__align-menu` / `…__order-popover` / `…__snap-menu` / `…__shift-menu` /
   `…__contrast-menu`).

   *Each trigger button toggles its own dropdown.* Tapping a dropdown's toolbar button (snap /
   order / shift / align / contrast) opens it, or **closes it if it's already open**. The four
   **transient** dropdowns are mutually exclusive — opening one closes the other three; the
   **order** popover is independent (sticky) and is toggled only by the order button. This is
   driven by `toggleDropdown(which, e)` in `CardEditToolbar.tsx`, which sets the target anchor
   with a functional toggle (`a ? null : anchor`) and nulls the other transients. For the toggle
   to read the true open state, the capture-phase `pointerdown` handler **exempts the transient
   trigger buttons** (`closest('.card-edit-toolbar__align, .card-edit-toolbar__snap,
   .card-edit-toolbar__shift, .card-edit-toolbar__contrast')`) — otherwise it would clear the
   anchor before the button's `onClick` fired and the menu would re-open instead of closing. (The
   order button needs no such exemption: its press lands inside `insideEditorUi`, so the sticky
   rule already leaves order open for its own `onClick` to toggle.)

   - **shift** (`ControlCamera`) — opens a **3×3 step-nudge pad** that fine-tunes the selected
     icon one step per tap. Layout (row-major): the four **corners** are CCW rotate / CW rotate
     (top) and − size / ＋ size (bottom); the four **cardinals** translate (up/left/right/down);
     the **center** shows the two-line "snap is on" hint while any snap toggle is active
     (otherwise empty). Each step honors the matching snap toggle: with the snap ON it steps by
     exactly one snap unit (and re-lands on the snap grid) — grid = 5%-of-width, rotate = 22.5°,
     size = 5%-of-width; with the snap OFF it makes a fine nudge of **1 design px** (move/size)
     or **1°** (rotate). Cells whose snap group is on are **highlighted** (move → the four
     cardinals, rotate → the two rotate corners, resize → the two size corners), each tinted
     with that operation's **accent color** — move/grid = light green (`COLORS.greenAccent`),
     rotate = light blue (`COLORS.blueAccent`), resize/size = light orange (`COLORS.yellowAccent`)
     — the **same colors the snap dropdown's active rows use** (`SNAP_GROUP_COLOR` in
     `CardEditToolbar.tsx`), so the two surfaces read as the same setting. Magnitudes +
     helpers (`nudgeCenter` / `nudgeRotationStep` / `nudgeScaleStep`, and the `CARD_DESIGN_WIDTH`
     / `CARD_DESIGN_HEIGHT` / `NUDGE_*` constants) live in `cardIconLayout.ts`; the page handlers
     (`handleNudgeMove` / `handleRotateStep` / `handleResizeStep`) each snapshot undo history, so
     a nudge is a discrete undoable action. Disabled when nothing is selected.
   - **card** (`Style`; labeled "card", internal key/class/anchor stay `contrast`) — opens a
     per-card **appearance** dropdown grouping the card background fill AND the text colors.
     It styles the **card**, not icons, so it is **independent of icon selection** (disabled
     only while saving). Live-previews on the card while editing (the page merges the live
     values onto `editingCurrentEntry`) and also applies on the **mini card thumbnails**
     (`MiniVocabCard`). Everything here saves/cancels with the layout (Save folds it in);
     reset-to-default clears it. The dropdown has:
     - a **background** swatch grid — the chips from `CARD_COLOR_OPTIONS`
       (`src/utils/cardColor.ts`), laid out in **two rows** (a 5-column grid): **auto**
       (`value: null`) first — drawn as the **red circle-with-slash `Block` glyph** (not a
       color) to signal "no override / use the theme color". Row 1 is the neutrals (auto /
       grey / beige / white / black); row 2 the pastel hues (red / green / blue / yellow /
       purple). Tapping a chip tints the **whole
       card face (both sides)** via `vet.cardColor` (migration 94); the active chip shows an
       accent ring. `auto`/`null` = follow the theme, so an auto card stores `NULL`; the
       explicit `grey` chip pins the light-theme face color regardless of theme. The fill is
       applied in `FlashCardSection.tsx` `CardFaceSide`
       (`resolveCardColor(cardColor) ?? fc.flashCard`).
     - two **text-color rows** — the **foreign word** (label = the card's characters) and the
       **English** (label = the card's definition) — each a 3-way **theme / dark / light**
       segmented control. `theme` follows the device/app theme (default), `dark` forces black,
       `light` forces white. `foreign` colors the foreign-word **glyphs only** (the pinyin
       overlay is never affected — the character color is threaded through `ForeignText` →
       `CPCDRow`'s `characterColor` prop, and the plain-text path for Spanish; pinyin keeps its
       own tone color); `english` colors the definition Typography. Persists per card in
       `vet.textColors` (migration 89); `null` when both sides are `theme`.
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
     one open). An **active row is tinted with its operation's accent color** (move = light
     green, rotate = light blue, resize = light orange — `SNAP_GROUP_COLOR`), the same colors
     the Shift pad uses to highlight that operation's cells. The increments (helpers in
     `cardIconLayout.ts`):
     - **move** (labeled **grid**) → icon CENTER snaps to a grid whose spacing is **5% of the card width** in
       both physical axes (`snapCenterToGrid`; the y-step is `0.05 × CARD_ASPECT` in height
       fractions since the grid is square in pixels — `CARD_ASPECT = 295/426`, the fixed card
       aspect, so the math needs no pixel rect).
     - **rotate** → rotation snaps to the nearest **22.5°** (`snapRotation`; 16 steps/turn).
     - **resize** (labeled **size**) → the rendered icon SIZE (`BASE_ICON_FRAC × scale` of card width) snaps to
       the nearest **5% of the card width** (`snapScaleToStep`, clamped to the scale range).

     **Two-layer behavior.** (1) *Turning a toggle ON snaps every icon immediately* — the page
     handlers (`handleToggleSnapMove/Rotate/Resize` → shared `toggleSnap`) snapshot history
     once, then map the snap over `advDraft`, so existing off-grid placements jump onto the
     grid in one undo step. (2) *Future gestures stay quantized* — the toggles are passed to
     `CardIconCanvas` as a `snap: { move, rotate, resize }` `SnapConfig`, and its drag /
     pinch / corner-handle handlers apply `snapCenterToGrid` / `snapScaleToStep` /
     `snapRotation` live while the matching flag is on. Turning a toggle OFF only flips the
     flag (icons keep their snapped values). The align action's fixed rotations (multiples of
     45°) are already on the 22.5° grid, so rotate-snap never fights it.

     **Snap toggles are undoable (both directions).** `toggleSnap` snapshots history on
     **every** toggle — ON *and* OFF — and the snapshot includes the three toggle states (see
     "Undo/redo history"), so undo restores the toggle flag itself, not just any geometry it
     snapped. So undoing a "snap move ON" both un-snaps the icons and flips the toggle back off,
     and undoing a "snap OFF" turns it back on (the OFF case pushes history but changes no
     geometry).

     **Snap state PERSISTS per card** (migration 88, `vet.snapConfig` jsonb `{move,rotate,resize}`;
     NULL = all off). On `enterEdit` the three toggles are **seeded** from the card's
     `snapConfig` (entering does NOT re-snap existing placements — they were already saved
     snapped). The config is written **with the layout on Save** (`saveIconLayout` sends
     `{ iconLayout, snapConfig }` in one PATCH; `snapConfig` is `null` when all toggles are off),
     so **Cancel discards snap changes too** — consistent with the draft/Save/Cancel model.
     **Reset-to-default** clears `snapConfig` to NULL alongside the layout. The live toggles are
     still cleared on `exitEdit`, but the next session re-seeds them from the saved card. A
     same-session re-edit seeds from `snapConfigOverrides` (the snap analogue of
     `iconLayoutOverrides`). See the Data model + API sections.
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

   **Undo/redo history** — the undo/redo buttons sit between **mirror** and **lock**; the
   **Shift** nudges + every other action push history too. The page keeps two capped stacks
   (`ADV_HISTORY_MAX = 100`) of prior **editor snapshots**: `advHistory` (undo) and `advFuture`
   (redo). A snapshot (`AdvSnapshot`) captures **both** the `advDraft` layout **and** the three
   snap toggle states (`{ layout, move, rotate, resize }`), so undo/redo restores the snap setup
   the same way it restores the icons — **toggling a snap on OR off is undoable** (see the snap
   tool). **Order changes** ride along inside `layout` (a reorder only permutes each icon's `z`),
   so they are undone with no special handling. `snapshotDraft` reads the layout + snap toggles
   from synchronous refs (`advDraftRef`, `snapMoveRef`/`snapRotateRef`/`snapResizeRef`); `undoAdv`/
   `redoAdv` restore a snapshot through the shared `applySnapshot` (writes both refs and state for
   layout + all three toggles). Every discrete action pushes the PRE-change snapshot onto
   `advHistory` via `pushAdvHistory` *before*
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
   study time): the page sets a global flag (`minutePoints/minutePointsPause.ts`) that
   `useMinutePoints` reads to skip its per-second tick, and `MinutePointsFireBadge`
   greys the flame and overlays a red no-entry symbol.

3. **Gesture canvas** (`CardIconCanvas.tsx`) — overlays the back face in **advanced
   mode only** (`editMode && advMode`); basic mode renders the draft through the static
   icon-layer path instead (the page feeds `draftLayout` onto the active entry's
   `iconLayout` via `editingCurrentEntry`, so the basic-mode card is WYSIWYG without a
   live canvas). The canvas is built on `@use-gesture/react` (`useGesture`, bound
   per-icon via `bind(index)`):
   - drag translates an icon (updates `x`,`y`); pinch resizes + rotates (two-finger:
     distance → `scale`, angle → `rotation`).
   - **All three transforms (translate / resize / rotate) work from ANYWHERE on the canvas
     and act on the SELECTED icon.** They differ only in whether the gesture can switch the
     selection:
     - **Drag (translate)** targets the topmost **unlocked** icon under the pointer when there
       is one — grabbing **and selecting** it ("a drag over an unselected unlocked icon
       translates that icon instead") — and otherwise the **selected** icon, so a drag over
       empty space, over a **locked** icon, or over the selection itself translates the
       selection from anywhere. The choice is made once at gesture start by `resolveDragTarget`
       (= `topmostUnlockedIconAt(px,py) ?? selected`).
     - **Pinch (resize + rotate)** and the **corner handle** **never switch selection**: they
       deliberately ignore which icon the fingers are over and resize/rotate the current
       selection via the shared `beginPinch`/`runPinch` handlers — so you can zoom/rotate in
       empty space or over a different icon **without selecting it**. Pinch falls back to the
       icon under the fingers only when nothing is selected (a pinch directly on an icon still
       grabs it).
   - **Implementation.** Gestures that **start on an icon** route through the per-icon
     `bindIcon` (drag + pinch); gestures that **start on empty space** route through a second
     `useGesture` bound to the canvas root (`bindCanvas`, also drag + pinch). Both bindings
     call the **same shared handlers** (`beginDragMotion`/`runDrag`, `beginPinch`/`runPinch`),
     so behaviour is identical wherever the fingers land — `bindCanvas`'s drag is what lets a
     translate of the selected icon **start on empty space**. Icon presses `stopPropagation`
     in their own `onPointerDown`, so they never also reach `bindCanvas` (no double-handling).
     A two-finger pinch's **first finger also drives the drag recognizer**, so **both** drag
     handlers short-circuit on **`touches >= 2`** — without this, the resize/rotate's stray
     finger would translate and/or grab+select whatever icon it landed on, defeating
     "off-icon resize/rotation must not select a new icon". Because `bindCanvas` also owns the
     empty-canvas behaviour, the **tap-to-deselect lives on `bindCanvas`'s drag `tap`** (not
     the root's raw `onPointerDown`) — otherwise the first finger of an empty-space pinch would
     wipe the selection before the pinch could read it (`filterTaps` means a pinch is never
     reported as a tap).
     - **Pinch-tail latch (resize must not reposition on release).** The `touches >= 2`
       short-circuit only holds *while both fingers are down*. As the fingers lift, `touches`
       drops below 2 for the drag's final frame(s) — and since no drag `memo` was ever created
       during the pinch, `beginDragMotion` would start a fresh drag there and apply the first
       finger's **entire accumulated pinch movement** (plus the `last`-frame `clampIconCenter`),
       jumping the icon to a new spot on release. To prevent this, a shared `pinchLatchRef`
       latches `true` the instant any drag frame sees `touches >= 2` and stays latched until the
       gesture fully ends; while latched, all three drag handlers (`bindIcon` / `bindCanvas` /
       `bindText`) refuse to translate. It resets on each drag `first` frame (so a brand-new pure
       drag starts unlatched) and clears on the final frame.
     - **Pickup baseline (no first-frame jump on a slow drag).** `filterTaps` + `threshold: 1`
       hold back the first few px so the gesture can disambiguate tap-vs-drag, so `movement`
       (`[mx, my]`) is already **non-zero** on the first real drag frame. `beginDragMotion` /
       `beginTextDrag` therefore snapshot that movement as `mx0`/`my0` in the memo, and
       `runDrag` / `runTextDrag` measure displacement as `(mx - mx0)` / `(my - my0)` — so the
       icon/text tracks from exactly where it was picked up instead of jerking forward by the
       held-back distance. The jump is most visible on a **slow, careful adjustment on a real
       touch device** (iOS Chrome/Safari coalesce pointer events, so more distance accumulates
       before recognition than a desktop mouse or devtools touch-emulation, which recognize at
       ~1px and hide it).
   - Desktop: drag plus a corner handle on the selected icon for resize/rotate (the
     handle computes scale from the pointer's distance to the icon center, rotation
     from its angle). The handle's `onDrag` **short-circuits on `touches >= 2`** for the
     same reason the icon/canvas drags do: the handle sits at the selected icon's corner
     and `stopPropagation`s, so a two-finger pinch whose first finger lands on the handle
     would otherwise be read as a lone-finger drag and write the **absolute-angle** rotation
     every frame — the icon could then only rotate (never resize/translate) until all fingers
     lift ("locked into a rotate command"). To keep the handle from being a pinch **dead
     zone** in that case, `bindHandle` also has an `onPinch` that routes through the shared
     `beginPinch`/`runPinch` handlers (acting on the selected icon), exactly like `bindIcon`.
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
     - **Denied-action shake** — when a translate / pinch / handle-resize gesture is
       attempted on a locked icon, the icon plays a brief horizontal **shake** to signal the
       action can't be performed (mirroring the front-card "can't do that" shake in
       `FlashCardSection.tsx`). Driven by a `{ i, nonce }` state in `CardIconCanvas`: the
       blocked-gesture early-returns each call `triggerShake(i)` (once per gesture — at
       `beginPinch`, the drag's first-real-frame `beginDragMotion`, and the handle's `first` frame),
       which bumps `nonce`. The icon box's `@keyframes` animation NAME embeds the nonce, so a
       repeat trigger is a fresh animation that restarts cleanly **without remounting** the
       box (a remount would abort the in-flight pointer gesture). Each keyframe PREPENDS a
       screen-space x-offset to the icon's base `translate(-50%,-50%) rotate(...)` transform,
       so it composes with the icon's placement and settles back exactly at rest;
       `onAnimationEnd` clears the state.
   - **Selecting / selection switching** — a **tap** selects an icon under it (the
     `onDrag` tap branch, via `filterTaps`), preferring the topmost unlocked icon at that
     point (`pickTapTarget`, see "Locked icons" above). A **drag (translate)** does not blindly
     grab the icon it lands on either: `resolveDragTarget` decides whether it acts on the
     icon under the pointer or on the **already-selected** icon:
       - It targets (and **auto-switches selection to**) the **topmost UNLOCKED icon** under the
         pointer when there is one — so a drag over any unselected unlocked icon translates that
         icon. `topmostUnlockedIconAt` is an axis-aligned box hit-test in normalized canvas
         space (rotation ignored — a good-enough heuristic), preferring the highest `z`.
       - Otherwise (empty space, only **locked** icons under the pointer, or the selection
         itself) it falls back to the **selected** icon — translating the selection from
         anywhere. A locked fallback target is frozen (shake feedback, no move).
       - **A pinch (resize/rotate) NEVER switches selection** — it always acts on the selection
         (`beginPinch`, ignoring which icon the fingers are over). Its first finger also drives
         the drag recognizer, so both drag handlers bail on `touches >= 2` to avoid grabbing or
         selecting an icon mid-pinch. (When nothing is selected, a pinch still falls back to the
         icon under the fingers so it can grab one to start.)
       - **Drag actions only ever apply to the resolved target** (which is also the icon
         selection switches to). The target is committed **synchronously** to `gestureTargetRef`
         at gesture start (and pinned in `memo`), so a drag that grabs a new icon both switches
         selection AND moves it in the SAME stroke — it does NOT re-derive the target from the
         async `selected` state (which lags a render, so the old code dropped the motion and
         "only selected").
     Selection shows a dashed outline + the corner handle and floats the icon visually
     (transient high `zIndex`) — but does **not** change its stored `z` (paint order is
     owned by the order dropdown). Selection is controlled by the page (`selected`/`onSelect`).
   - **Selection indicators render on top of all icons, and may overflow the card edge.**
     The dashed outline + corner handle are NOT drawn on the selected icon's box; they are
     drawn in a separate **selection-overlay layer** that the canvas renders ABOVE the icon
     clip layer. The canvas root is split into two children:
     - a **clip layer** (`card-icon-canvas__clip`, `overflow: hidden`, `zIndex 0`) holding
       every icon — the only thing clipped to the card boundary. Its explicit `zIndex` +
       position establishes a stacking context that confines each icon's `z` (including the
       transient float-to-front `9999`) **below** the overlay.
     - a **selection overlay** (`card-icon-canvas__overlay`, `overflow: visible`, `zIndex 1`,
       `pointerEvents: none`) holding the outline + handle for the selected icon. Because it
       is unclipped and above the clip layer, the indicators always paint **on top of every
       icon** and can poke **past the card edge** (the card face is `overflow: visible` —
       see the face-split note above — and the surrounding card padding lets them show before
       the card slot clips). The overlay box mirrors the selected icon's exact geometry
       (`iconItemStyle(sel, false)`) so the outline frames the icon, is pointer-transparent
       so a drag through it still reaches the icon below, and **re-enables `pointerEvents` on
       the handle only**. It also shakes in lockstep with the icon when a denied gesture
       targets the selected (locked) icon, so the outline never drifts away from the shaking
       icon. The canvas root itself is `overflow: visible` (clipping moved to the clip layer).
   - **Off-card drag** = on release, an icon dragged too far off-card is snapped back via
     `clampIconCenter` so at least 15% of the **icon's own size** (`MIN_ON_CARD_FRAC`, in
     `cardIconLayout.ts`) stays on-card in both axes — it is NOT deleted. The threshold is
     icon-relative (same fraction on each axis); since the icon is square in px but `x`/`y`
     are normalized to card width/height, the clamp expresses the icon's half-size in each
     axis's own units via the canvas aspect ratio.
   - **Delete** = use the advanced toolbar's delete button on the selected icon (the only
     way to remove an icon now that off-card drag snaps back).
   - The canvas sits BEHIND the card content (icons are always behind the text). While
     editing, the back face's **static** content is not rendered at all — the icon layer and
     the movable-text layer are both suppressed (`!editing` / `editing ? null` gates), and the
     live canvas in the outer face box renders the icons + text instead — so the edit is WYSIWYG.
     Presses reach the canvas because the **inner clip box** is made `pointerEvents: none` while
     editing (it is painted above the canvas in DOM order, so without this it would intercept
     every press). Because the static text is entirely absent during an edit, the old
     cpcd-inline-`pointer-events: auto` problem (a tap on pinyin registering on the span instead
     of falling through) no longer arises — there is no static content to force inert. See
     `CardFaceSide`'s inner clip box `sx` in `FlashCardSection.tsx`.
   - The card is **locked** while editing: `FlashCardSection` does not attach the
     drag/flip handlers (`editMode` gate), so it can't be swiped away or flipped.

   Three non-obvious gotchas the implementation handles (don't regress them):
   - **Stacking context**: both `CardIconLayer` and the `CardIconCanvas` root (and its
     inner **clip layer**) set an explicit `zIndex: 0`, which establishes a stacking
     context that CONFINES the per-icon zIndex values. Without it, an icon with `z >= 1`
     competes directly with the content (`zIndex: 1`) and paints OVER the text (the "text
     beneath the icons" bug, visible once 3+ icons exist). The canvas's clip-layer context
     also confines the icons' `z` (incl. the float-to-front `9999`) below the
     selection-overlay layer (`zIndex 1`), so the indicators always sit on top of all icons.
   - **Canvas clips its own icons (face is now unclipped)**: the card face's
     `overflow: hidden` moved off the outer face box onto an inner clip box, and the edit
     canvas sits in the outer (`overflow: visible`) box so its selection overlay can escape
     the card edge. The canvas therefore clips its OWN icons via the inner `…__clip` layer —
     don't remove that or partially-off-card icons stop being cut off at the boundary.
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
     (so the mirror transform can be isolated on the `<img>` while the wrapper stays the
     gesture target; the selection outline + handle now live in the overlay layer, not on
     this wrapper). A default `display: inline`
     `<img>` adds a baseline descender gap (~4px) that inflates the wrapper past its
     `aspect-ratio: 1/1` height; because the box is centered via
     `translate(-50%, -50%)`, that shifted the icon ~2px UP versus the saved render —
     a visible jump when entering/exiting the editor. The canvas's inner `<img>` is
     therefore `display: block` so both renderers share identical geometry.

   **Crash-safety guards (`CardIconCanvas.tsx` + `cardIconLayout.ts`).** The canvas
   gesture handlers index `layout[selected]` / `layout[m.t]` / `layout[t]`, where
   `selected` is page-owned state and `layout` (advDraft) is a separate prop. A
   transient desync or a target deleted mid-gesture would dereference `undefined`
   (`.scale`/`.locked`/`.rotation`) and throw — and with the app's top-level
   `AppErrorBoundary` (added alongside this) that throw would white-screen the
   whole app. So **every `layout[i]` access is bounds-guarded** (`resolveTarget`,
   `withinSelectedZone`, `beginPinch`, `runPinch`, the `onDrag` memo factory, and
   `bindHandle` all bail when the indexed item is missing). Separately,
   `clampScale` / `sanitizeRotation` (`cardIconLayout.ts`) **reject non-finite
   values** (NaN/±Infinity): `Math.min`/`Math.max` pass NaN through, so a degenerate
   pinch frame (`da` distance 0/undefined) could otherwise write `scale: NaN` into
   the layout — the icon renders at width `"NaN%"` (vanishes) and the broken value
   could even be **saved**, permanently breaking the card. A NaN scale now falls
   back to `DEFAULT_ICON_SCALE`, a NaN rotation to `0`. Front-end crashes are
   captured by the client error sink (docs/CLIENT_PERF_DIAGNOSTICS.md).

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
   `cardIconLayout.ts`. `isDefaultPlacement` accepts the current default scale (1.25)
   **or** the legacy 1.2 / 1.0 (basic saves before the size-snap-aligned and 20%-larger
   bumps), so pre-existing basic-saved cards still open in basic mode rather than
   auto-opening advanced.

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

## Movable text (migration 91)

In **advanced** mode the two back-face text blocks — the **foreign word** (the
Chinese/Spanish characters + pinyin) and the **English definition** — are independently
**movable / resizable / rotatable**, just like icons. The placement is stored per card in a
new nullable **`textLayout` jsonb** column on both vet tables
(`database/migrations/91-add-text-layout-to-vocabentries.sql`).

**Scope / decisions:**
- **Two independent blocks.** Each block is its own draggable object with its own
  center / scale / rotation. There is no `iconId`, **no `flipX`** (mirror is disabled for
  text — mirrored text is unreadable), and **no `z`**: text **always paints ABOVE the icon
  layer**, and the two blocks keep a fixed order (english over foreign on overlap).
- **Back face only.** Side 1 always uses the default centered layout; only Side 2 (the face
  the editor decorates) honors `textLayout`.
- **Fully on-card.** Unlike icons (which keep only 15% on-card), text is clamped so the
  **whole** rendered box stays on the card — the editor measures the block's rendered
  (scaled + rotated) bounding box and clamps the center so no part can leave (`clampTextCenterFully`).
- **Resize floor.** Font scale is clamped to `[TEXT_SCALE_MIN=0.5, TEXT_SCALE_MAX=3]` so text
  can't shrink to unreadable.
- **flp only.** The **mini card thumbnails** (`MiniVocabCard`) and **community** copies do
  **not** honor `textLayout` (the column is simply ignored there; the community copy path
  leaves it untouched).

**Data model** — `textLayout` shape (NULL ⇒ both blocks at their default grid-aligned centers;
each block optional, an absent block renders at its default spot):

```jsonc
{
  "foreign": { "x": 0.5, "y": 0.623, "scale": 1, "rotation": 0, "locked": false },
  "english": { "x": 0.5, "y": 0.762, "scale": 1, "rotation": 0 }
}
```

`x`/`y` = block CENTER (fractions of card w/h); `scale` multiplies the block's base font
size; `rotation` in degrees. Types `TextBlock` / `TextLayoutItem` / `TextLayout` live in
`src/types.ts` + `server/types/index.ts`; the geometry/helpers live in
**`src/cardIcons/cardTextLayout.ts`** (`DEFAULT_TEXT_CENTER`, `resolveTextLayout`,
`clampTextScale`, `clampTextCenterFully`, `snapTextScale`, `nudgeTextScale`,
`textItemTransform`, `isDefaultTextItem`, `textLayoutForSave`, `hasCustomTextLayout`).

**Grid-aligned defaults.** `DEFAULT_TEXT_CENTER` is built FROM the move-grid constants
(`SNAP_MOVE_STEP_FRAC` for x, `SNAP_MOVE_STEP_FRAC·CARD_ASPECT` for y): `x = 10` steps `= 0.5`
(card center); foreign `y = 18` steps (≈0.623), english `y = 22` steps (≈0.762). So the
default text sits **exactly on the move-snap grid** (`snapCenterToGrid` is a verified no-op on
both) — toggling snap-move never nudges default text (`scale:1`/`rotation:0` are likewise on
the size/rotate grids). The same default is used by the **flp display AND the fie seed**, so
they match 1:1. The wide separation is deliberate: these centers are FIXED (unlike the old
flex column they can't grow), so the gap clears a multi-line English definition.

**Rendering split (the same edit-vs-saved pattern as icons):**
- **Static / saved** (`FlashCardSection.tsx` `CardFaceSide`): the back face receives its two
  blocks SEPARATELY via `textBlocks={{ foreign, english }}` and renders them in a **full-card
  text layer** (`mobile-demo-flashcard-text-layer`, `position: absolute; inset: 0`, no padding),
  positioning **each block absolutely** at its center. **Critical:** this layer is full-card —
  NOT nested inside the padded `CardContent` (`padding: clamp(16px,7%,72px) 30px`) as it once
  was. The canvas positions text relative to the full card face, so nesting the static text in
  the padded box made the same normalized `x`/`y` resolve against a smaller box and land in a
  DIFFERENT spot than the fie. Both now share the full-card coordinate system, so the default
  (and any saved) placement matches the fie **1:1**. `resolveTextLayout(textLayout)` fills a
  null/absent block with the grid-aligned `DEFAULT_TEXT_CENTER`. (The old lower-third flex column
  was removed for the back face; the front face / Side 1 still uses a padded `CardContent` flex
  column via `children`.) While the edit canvas is mounted (advanced) the back-face text is
  **suppressed** — the canvas renders it live.
- **Live canvas** (`CardIconCanvas.tsx`): a `__text-layer` (zIndex 1, between the icon clip
  layer and the selection overlay; **`pointerEvents: none`** so empty-area presses fall
  through to icons) renders the two real text nodes inside draggable wrappers. The foreign
  block renders the **same speaker + writing-practice buttons** the flp back face shows
  (so the learner previews WHERE those buttons land relative to the moved text); they are
  inert here (the text-content wrapper is `pointerEvents: none`). The foreign block's buttons
  are laid out **in-flow** (`ChineseBlock inlineActions`) instead of absolutely off the text's
  right edge, so they're **part of the block's measured box** — the selection outline frames
  them and the on-card clamp keeps them on-card. The static back-face render uses
  `inlineActions` too (default and custom), so it matches the fie 1:1; only the **front face /
  Side 1** keeps the absolute-button flex column (its text stays centered). A **separate,
  simpler gesture path** (`bindText` / `bindTextHandle`, with `beginText*`/`runText*`
  handlers) drives them — tap selects, drag translates, pinch + a corner handle resize/rotate,
  lock freezes + shakes. It's separate from the icon path (only two fixed blocks: no
  add/delete/duplicate, no selection-switching heuristics) but reuses the shared snap helpers.
  The text handle uses **relative** resize/rotate (text boxes aren't square, so the icon
  handle's absolute distance→scale doesn't map cleanly).

**Selection** is unified but stored as two mutually-exclusive page pieces: `selectedIcon`
(index) and `selectedText` (`'foreign'|'english'`). The canvas reports changes through one
`onSelectTarget(CanvasTarget | null)` (`{kind:'icon',index} | {kind:'text',block}`), and the
hook's `selectTarget` enforces that at most one is set. The toolbar gates the icon-only tools
(**delete / duplicate / mirror**) on `selectionKind === 'icon'`, while **move / resize /
rotate (shift pad) / align / snap / lock** apply to a selected text block too. **Contrast**
is unchanged (it already recolors text). The **snap** tool is now available even on a card
with no icons (the two text blocks are always present in advanced mode).

**State** (`useCardIconEditor.ts`): a `textDraft` (both blocks, seeded via
`resolveTextLayout(entry.textLayout)` on enter — a card with custom text auto-opens
advanced), folded into the **undo/redo snapshot** (`AdvSnapshot.text`, so text edits are
undoable; text lock IS part of the snapshot, unlike the orthogonal icon lock), a
`textLayoutOverrides` session map, and Save/Reset. Save persists `textLayoutForSave(textDraft)`
(null when both blocks are default) via the same PATCH; Reset clears it to null. Turning a
**snap** toggle on also snaps the two text blocks (one undo step covers icons + text).

## API (server)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/icons8?offset=&limit=` | yes (existing) | List downloaded/cached icons (the browse-all state when the search box is empty); returns `{ icons: [{ id, name }], total, hasMore }`. |
| `GET /api/icons8/search?term=&offset=&limit=` | yes | Proxy the live icons8 v7 search; returns `{ icons: [{ id, name }], hasMore }`. |
| `POST /api/icons8/default-results` | yes | Body `{ language, entryKey, pos?, term }`. Return (and cache on first call, on det `defaultIconResults`) the first page of the card's default-query results: `{ icons: [{ id, name }] }`. Warms the picker so it renders instantly on open. |
| `POST /api/icons8/:iconId/ensure` | yes | Download + cache the icon's SVG into the `icons8` table if missing (so `/api/icons8/<id>/image` can serve it). Idempotent. |
| `PATCH /api/vocabEntries/:id/icon-layout` | yes | Body `{ iconLayout: Item[] \| null, snapConfig?: {move,rotate,resize} \| null, textColors?: {foreign,english} \| null, textLayout?: {foreign?,english?} \| null }`. Persist or clear the layout **and** the per-card snap toggles, Contrast text colors, **and movable-text placement** for the caller's vet row. `snapConfig` / `textColors` / `textLayout` omitted = leave that column untouched (community copy path); `null` = clear; object = set. Echoes back `{ id, iconLayout, snapConfig, textColors, textLayout }`. |
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
  routes registered in `server/routes/mediaRoutes.ts` (with the other icons8 routes).
- `server/controllers/VocabEntryController.ts` + `VocabEntryDAL.ts`
  (`IVocabEntryDAL`) — `updateIconLayout(userId, id, layout, snapConfig?, textColors?)`,
  scoped by `userId`. Layout validation: `null` OR an array of ≤ 12 items with a string
  `iconId`, numeric `x`/`y`/`scale`/`rotation`/`z`, and optional booleans `flipX` and `locked`
  (both coerced; omitted when false) — else `400`. `scale` is clamped to `[0.25, 5]` and
  the `x`/`y` **center** is clamped by the same 15%-on-card rule the edit canvas uses
  (`clampIconCenter`), NOT to `[0,1]` — so a mostly-off-card icon is not pulled inward on
  save (see the Data model note above). `z` is renumbered 0..n-1 by ascending `z` on save.
  `snapConfig` validation (`validateSnapConfig`): `undefined` leaves the column untouched
  (community copy path), `null` clears it, an object is coerced to `{move,rotate,resize}`
  booleans — else `400`. `textColors` validation (`validateTextColors`): same tri-state —
  `undefined` leaves the column untouched, `null` clears it (both `theme`), an object is
  coerced to `{foreign,english}` where each side is `theme`/`dark`/`light` (any unknown side
  falls back to `theme`) — else `400`. `textLayout` validation (`validateTextLayout`,
  migration 91): same tri-state — `undefined` leaves the column untouched, `null` clears it,
  an object is coerced to `{foreign?,english?}` where each present block has finite numeric
  `x`/`y`/`scale`/`rotation` (+ optional `locked`); `scale` clamps to `[0.5,3]` and the center
  to `[0,1]` (a safe outer bound — the client already clamps the whole box on-card); a block
  that normalizes to nothing collapses to `null` — else `400`. Layout + snap + colors + text
  placement are written in **one UPDATE** (the DAL builds the SET list conditionally).

**Types** — `IconLayoutItem` (with the optional `flipX` and `locked`) + `iconLayout?:
IconLayoutItem[] | null`, `SnapConfig` (`{move,rotate,resize}`) + `snapConfig?:
SnapConfig | null`, and `TextColors` (`{foreign,english}` of `TextColorMode =
'theme'|'dark'|'light'`) + `textColors?: TextColors | null`, and `cardColor?: string | null`
(the card background fill, migration 94) on the `VocabEntry` interface, in both
`server/types/index.ts` and client `src/types.ts`. `SnapConfig` is re-exported from
`CardIconCanvas.tsx`. The Contrast color resolver `resolveTextColor` lives in
`src/utils/cardTextColor.ts`; the card-fill palette + resolver (`CARD_COLOR_OPTIONS` /
`resolveCardColor`) live in `src/utils/cardColor.ts`, with the server's allow-list
`CARD_COLOR_VALUES` in `server/types/index.ts` (kept in sync by hand).

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
- Contrast text-color path (migration 89): resolver `src/utils/cardTextColor.ts`
  (`resolveTextColor`) → `characterColor` prop on `src/components/ForeignText.tsx` +
  `src/components/CPCDRow.tsx` (glyph-only color; pinyin untouched) and the English
  Typography in `FlashCardSection.tsx` `EnglishBlock` + the `MiniVocabCard.tsx` thumbnail.
- Greyed-lockout edit pattern: [PRACTICE_WRITING.md](./PRACTICE_WRITING.md).
- Multi-language vet scoping: [MULTI_LANGUAGE_IMPLEMENTATION.md](./MULTI_LANGUAGE_IMPLEMENTATION.md).
- **Community sharing** — advanced layouts (`isAdvancedLayout`, multi-icon or a moved single
  icon) are surfaced to other learners on the Community page, where they can be upvoted and
  copied onto a card via the same `updateIconLayout` path: [COMMUNITY_PAGE.md](./COMMUNITY_PAGE.md).
  The advanced-vs-basic geometry test (`isAdvancedLayout`/`isDefaultPlacement` in
  `cardIconLayout.ts`) is mirrored server-side in `server/dal/shared/advancedLayout.ts`.
