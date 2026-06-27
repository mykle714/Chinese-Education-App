# Custom Card Icon Layout (flp)

> Status: **implemented**. Backed by migration 82 (`iconLayout`), the icons8
> search/ensure and vocabEntries icon-layout endpoints, and the flp edit-mode UI.
> The editor has **two modes** — basic (swap the single icon) and advanced (the full
> drag/resize/rotate canvas, plus a per-icon tool row: undo / delete / align / mirror /
> reorder).
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
  "flipX":    true      // OPTIONAL horizontal mirror (the "mirror" action); omitted/false = not mirrored
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
   overlay inside `ContentArea`** (which is `position: relative`), so it does NOT push
   the card down when it appears. It has **two modes**, toggled by the **adv** button
   (`Tune` icon, filled when active); the page tracks this as `advMode`.

   **Two drafts, preserved across the toggle** — the page holds `basicDraft` (the
   single-icon view, 0–1 items) and `advDraft` (the multi-icon arrangement) at once.
   The active draft is `advMode ? advDraft : basicDraft`; the card displays it and Save
   persists it ("show / save whichever mode the user is in"). Toggling `adv` only
   switches which draft is active — **neither is destroyed**, so the user can flip back
   and forth without losing either view.

   **Basic mode**: the card shows a single icon and the gesture canvas is NOT mounted.
   The contextual left button is **change icon** (`Autorenew` cycle icon) — opens the
   picker; on select it **replaces** `basicDraft` with one default-positioned icon (the
   "swap"). Always valid here because basic is always a single icon.

   **Advanced mode**: the gesture canvas is live (drag / resize / rotate / add /
   delete) over `advDraft`. The left button becomes **add icon** (`Add` ＋, disabled once
   12 icons are placed) with the `count/12` readout, and a **second toolbar row of
   per-icon tools** drops in below the first:
   - **undo** (`Undo`) — reverts the last edit action. Disabled with an empty stack.
   - **delete** (`DeleteOutline`) — removes the **selected** icon (no confirmation).
     Disabled when nothing is selected.
   - **align** (`CropSquare`) — opens a dropdown of 4 arrows (up / right / down / left)
     that snap the selected icon's `rotation` to an absolute orientation
     (`ALIGN_ROTATION` = `0 / 90 / 180 / -90`). Disabled when nothing is selected.
   - **mirror** (`Flip`) — toggles `flipX` on the selected icon. Disabled when nothing
     is selected.
   - **order** (`Layers`) — opens a compact popover (`CardIconOrderList`, width fits its
     contents) listing every icon in paint order (**top of the list = rendered on top =
     highest `z`**). Each row is just the icon thumbnail + a trailing triple-dot
     **movement indicator** (no text label); the **whole row is the drag trigger** (press
     anywhere on it, not only the dots). The card restacks **live as you drag** — every
     time the placeholder lands on a new slot the new `z`-order is pushed up via
     `onReorder` (top row = highest `z`), so the arrangement previews in real time rather
     than only on release. A plain tap (no movement) is a no-op (no `z` rewrite, no undo
     entry). Disabled when the card is empty.

     *Gesture wiring (`CardIconOrderList`):* on row `pointerdown` the component sets a
     drag state, then tracks the pointer via **window-level `pointermove`/`pointerup`/
     `pointercancel` listeners** for the gesture's duration. It deliberately does **not**
     bind handlers to the dragged row (it is swapped for a placeholder immediately, so a
     row-bound handler would unmount mid-drag → the old "release freezes" bug) and does
     **not** use `setPointerCapture` (capture can throw / be lost on some touch+Safari
     paths, which silently aborted the whole drag → the old "drag does nothing" bug).
     Window listeners make the drag complete wherever the pointer travels or releases.

   **Undo history** — the page keeps a capped stack (`ADV_HISTORY_MAX = 100`) of prior
   `advDraft` snapshots (`advHistory`). Every discrete action pushes the PRE-change
   snapshot via `pushAdvHistory` *before* mutating: gestures snapshot once at gesture
   start (`onInteractionStart`, fired by `CardIconCanvas` on drag/pinch/handle start),
   add / delete / align / mirror snapshot in their page handlers, and a **reorder drag**
   snapshots once via `onReorderStart` on its first change (the live `onReorder` calls
   during the drag do NOT snapshot, so the whole drag collapses to one undo step).
   `undoAdv` pops and restores, clearing selection. The stack is cleared on enter/exit edit.

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
   - **Selecting** an icon (on `pointerDown`) shows a dashed selection outline + the
     handle and floats it visually (transient high `zIndex`) — but does **not** change
     its stored `z` (paint order is owned by the order dropdown). Selection is controlled
     by the page (`selected`/`onSelect`).
   - **Delete** = drag an icon so its center leaves the card boundary and release, or use
     the advanced toolbar's delete button on the selected icon.
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
  `x`/`y`/`scale`/`rotation`/`z`, and an optional boolean `flipX` (coerced; omitted when
  false) — else `400`. `z` is renumbered 0..n-1 by ascending `z` on save.

**Types** — `IconLayoutItem` (with the optional `flipX`) + `iconLayout?:
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
