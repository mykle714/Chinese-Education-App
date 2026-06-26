# Custom Card Icon Layout (flp)

> Status: **implemented**. Backed by migrations 82 (`iconLayout`) + 83
> (`iconTextBackdrop`), the icons8 search/ensure and vocabEntries icon-layout
> endpoints, and the flp edit-mode UI.

## What it is

By default every flashcard shows one representative icons8 icon (`entry.iconId`,
joined from det) centered on the card — rendered by `CardImage` in
`src/pages/FlashcardsLearnPage/FlashCardSection.tsx` (the `CardImage` component,
~line 192). This feature lets a learner **compose a custom multi-icon arrangement
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
  "scale":    1.0,      // multiplier on the base box; clamped ~[0.25, 3]
  "rotation": 0,        // degrees
  "z":        0         // paint order; higher = front. Normalized to 0..n-1 on save.
}
```

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
upper third (`top: 33.33%`, ≈2/3 up from the bottom), the word text in the lower third
(`top: 66.67%`, ≈1/3 up from the bottom). The seeded edit-mode default icon matches
(`DEFAULT_ICON_Y = 0.3333`).

**White text backdrop** (`iconTextBackdrop` boolean, migration 83) — an optional per
-card setting that draws a small white rounded backdrop behind each word block so the
text stays legible over the icons. It is rendered as **two separate backdrops** (one
hugging the Chinese cpcd inner wrapper, one hugging the English definition), not a
single box. Toggled in edit mode by the toolbar's frame icon; only applied on faces
that show icons; forced off when the layout is cleared (reset).

No foreign key is placed on the ids inside the jsonb. If an icons8 row is ever
deleted, that icon's image endpoint simply 404s and renders nothing — the same risk
class as `users."avatarIconId"` (migration 77), which uses `ON DELETE SET NULL`.

The column flows into reads automatically: vocab reads select `ve.*`
(`server/dal/implementations/VocabEntryDAL.ts`) and the zh source wrapper in
`server/dal/shared/vetTable.ts` (`vetReadFrom`) uses `SELECT *`, so no select-list
changes are needed. `DICT_COLS`/`dictJoin.ts` are for det columns and stay untouched.

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
   the card down when it appears. Actions:
   - **＋ Add** — opens the icon search dialog (disabled once 12 icons are placed).
   - **Frame icon** (`CropDin`) — icon-only toggle for the white text backdrop
     (filled when active).
   - **Reset to default** — see below (confirmation-gated).
   - **Save** — persists the layout + backdrop flag and exits edit mode.
   - **Cancel** — discards unsaved changes and exits edit mode.

   While editing, minute-points accumulation is **paused** (decorating a card isn't
   study time): the page sets a global flag (`utils/minutePointsPause.ts`) that
   `useMinutePoints` reads to skip its per-second tick, and `MinutePointsFireBadge`
   greys the flame and overlays a red no-entry symbol.

3. **Gesture canvas** (`CardIconCanvas.tsx`) — overlays the back face while editing,
   built on `@use-gesture/react` (`useGesture`, bound per-icon via `bind(index)`):
   - drag moves an icon (updates `x`,`y`); pinch resizes + rotates (two-finger:
     distance → `scale`, angle → `rotation`).
   - Desktop: drag plus a corner handle on the selected icon for resize/rotate (the
     handle computes scale from the pointer's distance to the icon center, rotation
     from its angle).
   - **Selecting** an icon (on `pointerDown`) brings it to the front (`z = max+1`) and
     shows a dashed selection outline + the handle.
   - **Delete** = drag an icon so its center leaves the card boundary and release.
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

4. **Seeding** — entering edit mode seeds the draft from `currentEntry.iconLayout`
   if present, otherwise a single default icon
   `{ iconId: currentEntry.iconId, x: .5, y: .45, scale: 1, rotation: 0, z: 0 }`
   (empty if the entry has no det icon).

5. **Icon search dialog** (`src/components/IconSearchDialog.tsx`, new) — modeled on
   `src/components/AvatarPickerDialog.tsx` (paged grid + infinite scroll) **plus a
   search bar**. It queries the icons8 search proxy; tiles preview directly from the
   icons8 CDN (`https://img.icons8.com/?id=<id>&format=png&size=96`, public, no
   token). On select the icon is **downloaded + cached** into our `icons8` table
   (so it can be served by our own endpoint) and appended to the canvas at center.

6. **Reset to default** — shows a confirmation dialog first; on confirm it nulls the
   layout (`PATCH …/icon-layout { iconLayout: null }`), drops the custom arrangement,
   restores the default centered det icon, and exits edit mode.

## API (server)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/icons8/search?term=&offset=&limit=` | yes | Proxy the live icons8 v7 search; returns `{ icons: [{ id, name }], hasMore }`. |
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
  validating: `null` OR an array of ≤ 12 items with a string `iconId` and numeric
  `x`/`y`/`scale`/`rotation`/`z` (else `400`).

**Types** — `IconLayoutItem` + `iconLayout?: IconLayoutItem[] | null` added to the
`VocabEntry` interface in both `server/types/index.ts` and client `src/types.ts`.

## Dependencies / cross-references

- Default-icon rendering + the white-background fix: `FlashCardSection.tsx` `CardImage`.
- Icon image serving + storage: [Icons8Controller.ts](../server/controllers/Icons8Controller.ts),
  `icons8` table (migration 71), representative-icon backfill
  `server/scripts/backfill/backfill-icons.js`.
- Avatar picker (grid/infinite-scroll precedent): `src/components/AvatarPickerDialog.tsx`,
  `users."avatarIconId"` (migration 77).
- vet read plumbing: `server/dal/shared/vetTable.ts`, `server/dal/shared/dictJoin.ts`,
  `server/dal/implementations/VocabEntryDAL.ts`.
- Greyed-lockout edit pattern: [PRACTICE_WRITING.md](./PRACTICE_WRITING.md).
- Multi-language vet scoping: [MULTI_LANGUAGE_IMPLEMENTATION.md](./MULTI_LANGUAGE_IMPLEMENTATION.md).
