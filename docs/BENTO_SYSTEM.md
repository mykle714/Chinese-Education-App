# Bento System

Shared menu primitive (`src/components/bento/`) behind the three footer-tab hubs:
`HomePage.tsx` (`/`), `DiscoverPage.tsx` (`/discover`), `GamesPage.tsx` (`/games`).

Introduced by the shelf redesign (see [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A4
and entries 1/3/4). It **replaced `HubMenu`**, a 439-line vertical list of
equal-weight rounded rows, which was deleted on 2026-08-21 along with
`hubMenuCardBase.ts`. This file was `HUB_MENU_SYSTEM.md`; nothing of that component
survives.

## The choice rule

The app has exactly two collection/menu primitives, and picking between them is not
a style choice:

> **Bento** is for **menus of destinations**. **Shelf** is for **collections the user
> owns**.
>
> If a tile **navigates**, it is a Bento tile. If it represents a thing **with a
> count**, it is a spine.

A destination has no size, so a Bento tile has no height encoding — every tile in a
grid is the same height, and the only weighting is `hero` and `low`. That is the
opposite of `Spine`, whose height *is* its count. See
[SHELF_REDESIGN.md](./SHELF_REDESIGN.md) § A3 for the Shelf side.

## Structure

**Code:** `src/components/bento/Bento.tsx` → `Bento`, `BentoTile`, `BentoStrip`,
`BentoSubTile`; `src/components/bento/CollectionChip.tsx` → `CollectionChip`;
`src/components/bento/index.ts` (the barrel — import from here).

| Export | Design class | What it is |
|---|---|---|
| `Bento` | `.bento` | 2-column grid, `gap: 10`, `padding: 14px 16px 0` |
| `BentoTile` | `.bt` | one destination |
| `BentoStrip` | `.strip` | full-width cell: a captioned row of sub-tiles |
| `BentoSubTile` | `.st` | one sub-tile inside a strip |
| `CollectionChip` | `.chipsel` | white outlined "which collection" bar above a grid |

### Tile variants

`TILE_VARIANTS` (in `Bento.tsx`) keys each variant to its geometry. The ghost
glyph's size is **paired** with the tile's — that pairing is what breaks first when
variants are written as branches instead of a table.

| Variant | Min height | Span | Title | Ghost |
|---|---|---|---|---|
| `base` | 112 | 1 | 15.5px | 92px @ `top:-14` |
| `hero` | 150 | 2 | 23px | 140px @ `top:-26` |
| `low` | 90 | 1 | 15.5px | 92px @ `top:-14` |

### Colour: tiles take a hue KEY, not a colour

`BentoTile`/`BentoSubTile` take `hue: RampHue` (`RAMP`, `src/theme/colors.ts`), not
a hex. A tile needs **two tiers of one hue at once** — the pastel `fill` for its body
and the matching `ink` for its ghost glyph. Passing them separately is the palette
mistake that typechecks, looks deliberate, and is invisible in review. `GameDef.hue`
follows the same rule.

Title is `COLORS.onSurface`, subtitle is `COLORS.textSecondary`, on every hue.
**Never white** — white on a 93% pastel is ~1.1:1.

### The ghost glyph

`.bg` — an oversized Material Symbol bleeding off the top-right, drawn in the tile's
**own ink** at 15% (not neutral ink; neutral makes a tile read as two colours). It is
**decoration, not information**: clipped, behind the text, barely a tone. Do not rely
on it to distinguish two tiles — the title does that.

### `markOutline` does not apply here

Every other pastel fill in the app carries the 12% inset ring, because a pastel is
~1.15:1 against paper. A Bento tile is the exception, and the design draws the
distinction itself: `.msb .cells i` (15px, no content) gets the ring; `.bt` (112px,
carrying a title and subtitle) gets a soft `0 1px 2px` drop shadow. **The rule is: a
pastel needs an outline unless it is large and occupied.** `TipBox` (`.tip`) is the
other large-and-occupied case.

### Tiles are real anchors

`to` / `state` render the tile as a `RouterLink` — middle-click, new-tab, and
keyboard focus come free. `onClick` receives the **event**, so a tile can intercept
its own activation (`preventDefault()` + navigate imperatively) while leaving
modified clicks to the anchor. Word Search's mode tiles need exactly this, to confirm
before clobbering a saved board.

### `BentoStrip` vs `ShelfHeader`

Both are captioned headers; they end differently, and that is the distinction:

* `BentoStrip`'s `meta` slot ends with a **fact about the set** — `×14 wins`,
  `2 modes` — as a mono `.lab`.
* `ShelfHeader`'s `action` ends with a **chevron**: "there is more of this".

`BentoStrip` also accepts `action` for the rare header that wants the chevron.

**And a third slot, `control`** — an interactive element rendered immediately after
the caption, on the same line. It is neither a fact (`meta`, right end) nor a
destination (`action`): it is a **setting that changes what the sub-tiles launch**.
The one caller today is Games' Bubble Match strip, whose `BubbleMatchTrackToggle`
picks between the Recognition and Reading mastery tracks by turning pinyin on or off
(the game latches it when the board is dealt — [MASTERY_REWORK.md § 1a](./MASTERY_REWORK.md)).
A control belongs beside the label because it is part of what the group *is*; keep the
right end for status. Code: `BentoStripProps.control` (`src/components/bento/Bento.tsx`),
`src/games/bubble-match/BubbleMatchTrackToggle.tsx`, `src/games/GamesPage.tsx`.

## Callers

| Page | Shape |
|---|---|
| **Home** (`src/pages/HomePage.tsx`) | Night Market `hero`; Games / Arena / Reader / Dictionary `base`; Community / Friends / Compare Words `low`. Role-gated tiles (`isValidator`, `isTemplateAuthor`) **append** as further `low` tiles — the mosaic must never assume a fixed tile count. An odd count leaves the last row half-empty on purpose; stretching the orphan would give a dev tool Night Market's weight. |
| **Discover** (`src/features/discover/DiscoverPage.tsx`) | Sort Cards `hero`; Quick Mark and Skipped Cards `base`. |
| **Games** (`src/games/GamesPage.tsx`) | `CollectionChip` above the grid; Bubble Match and Word Search as strips; Match Speed / Speed Reading / Hydra Bubbles / Memory Map as tiles. |

Games' two strips are **special-cased in the page**, not driven by a generic
`GameDef.levels` field, because they are the only two fan-out games. Word Search's
strip is owned by `src/games/word-search/WordSearchHubItem.tsx` rather than the page,
because it holds word-search-specific state (the saved board, the confirm dialog).

## Registry fields the hub reads

`GameDef` (`src/games/types.ts`):

* `hue: RampHue` — the tile's ramp hue. *(Was `bgColor: string`.)*
* `glyph: string` — the ghost glyph's Material Symbols name. *(Was `iconAsset`, an
  optional image URL that no game ever set.)*
* `subtitle?: string` — **keep it to three or four words.** It renders at 11.5px in a
  half-width 112px tile; anything past ~six words wraps to a third line and overflows.

Bubble Match's `hue` is only a fallback: its three levels take their own hues from
`BUBBLE_MATCH_LEVEL_HUES` in `GamesPage.tsx` (a difficulty ramp, green → red).

## Known gaps

* **The mark-type CHIP is gone from the Games hub — the mark-type LABEL is not.**
  A bento tile has no edge slot, so the track moved into the SUBTITLE instead:
  `tileSubtitle()` in `GamesPage.tsx` composes `"Recognition · 30-second clock"` from
  `GameDef.markType` (through the shared `MARK_TYPE_LABELS`) plus the game's blurb, so
  the label is derived from the same field the game marks with and cannot drift.
  Word Search's mode sub-tiles already did this (their subtitle IS the track name).
  `src/components/MarkTypeChip.tsx` was **deleted** (2026-08-22) once the last gap
  closed — the open "does the chip come back?" question is answered *no*.
  The last gap was **Bubble Match**, whose per-level sub-tile subtitles are the level
  labels: it now names both of its tracks on the **strip header**, via the `control`
  slot below.
* **Discover's tile pins and its "Waiting to be sorted" shelf are not built.**
  Artboard 3 draws `184 waiting` / `31` pins and a four-spine shelf beneath the grid.
  There is no client-side count of unsorted or skipped cards — `useCategoryCounts`
  counts the user's library by band, a different number. Both want one endpoint
  returning the unsorted queue counted by band.
* **`CollectionChip` shows no card count.** The artboard's `1,284` has no source in
  the current data flow.

## Related

* [SHELF_REDESIGN.md](./SHELF_REDESIGN.md) — the plan, the token ramp, and the Shelf
  primitive this one pairs with.
* [UX_AND_NAVIGATION.md](./UX_AND_NAVIGATION.md) — footer tabs, Leaf/Node archetypes,
  the `MobileTabScreen` layout these hubs sit inside.
* [GAMES_FEATURE.md](./GAMES_FEATURE.md) — the Games hub's gating and collection
  selector.
