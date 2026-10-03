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

**Code:** `src/components/bento/Bento.tsx` → `Bento`, `BentoTile`, `TILE_VARIANTS`;
`src/components/bento/CardShell.tsx` → `CardShell`, `CARD_SHELL`, `CARD_TITLE_SX`;
`src/components/bento/CollectionChip.tsx` → `CollectionChip`;
`src/components/bento/index.ts` (the barrel — import from here).

| Export | Design class | What it is |
|---|---|---|
| `Bento` | `.bento` | 2-column grid, `gap: 10`, `padding: 14px 16px 0` |
| `BentoTile` | `.bt` | one destination |
| `CardShell` | `.bt` body | the family's shared body — see § "CardShell" |
| `CollectionChip` | `.chipsel` | white outlined "which collection" bar above a grid |

### Tile variants

`TILE_VARIANTS` (in `Bento.tsx`) keys each variant to its geometry. The ghost
glyph's size is **paired** with the tile's — that pairing is what breaks first when
variants are written as branches instead of a table.

| Variant | Min height | Span | Title | Ghost |
|---|---|---|---|---|
| `base` | 112 | 1 | 15.5px | 92px @ `top:-14` |
| `hero` | 150 | full | 23px | 140px @ `top:-26` |
| `low` | 90 | 1 | 15.5px | 92px @ `top:-14` |
| `compact` | 74 | 1 | 14px | **66px** @ `top:-10` |

`compact` was added 2026-08-24 for the 3-column Friends bento. Note the ghost shrinks
*more* than the tile does: at a third of a phone's width the tile is ~117px across, and
`low`'s 92px glyph would fill it corner to corner and stop reading as a wash behind the
label. The pairing is the whole reason this is a table.

### Grid width — `columns`, and `fullWidth`

`Bento` takes `columns={2 | 3}`. **Two is the default and the norm**: it is what every hub
uses, and it is what makes a tile wide enough to carry a title *and* a subtitle. Three
exists for the one shape the artboards also draw (Friends, artboard 8) — a row of SIBLING
ACTIONS named in one word each. At three columns there is no room for a subtitle, so pair
it with `variant="compact"` and let the ghost glyph carry what the one-word label
compresses. Do not reach for it to fit more destinations on a hub; group a SET of launch
options inside one full-width card instead (the Games hub's `GameCard`).

A tile spans the full grid via `gridColumn: "1 / -1"`, **not** `span 2` — a hero is "the
full width of whatever grid it is in", and spelling it as a span silently means *two
thirds* in a 3-column bento. A full-row `GameCard` uses the same.

`hero` already implies full width. `fullWidth` is the other combination: a SHORT tile that
still owns its row (Friends' Challenges bar). Width and height are separate decisions, and
folding them into one enum would mean a variant per pairing.

### Pins — `pin` and `pinTone`

`pin` is the mono pill in a tile's top-right. `pinTone` says what it MEANS, which is the
only thing that decides its colour:

| Tone | Looks like | For |
|---|---|---|
| `"default"` | translucent white on the tile's own pastel | a fact about the destination — "14 decks", "2 modes" |
| `"alert"` | `COLORS.dangerInk` on white, min-width 20 | a count of things **waiting for the user** — friend requests, pending challenges |

Keep the distinction. If every pin were alert-coloured the hub would shout; if none were,
the Friends hub's challenge count — which is the *entire* discovery mechanism for
challenges, since the app sends no notifications of any kind — would be indistinguishable
from a deck count. An alert pin also needs the explicit `minWidth`: a one-digit count in a
pill sized only by its padding renders as an oval, not the circle a badge is read as.

**`pinBare`** — the pin node brings its own chrome and the slot only positions it (no
mono font, padding or background; `pinTone` is ignored). It exists for the games' win
badge: the Games hub's Match Speed tile passes `WinCountPill`
(`src/games/shared/GameCard.tsx` → `WinCountPill`) with `pinBare`, so its win count is
the same trophy pill the `GameCard`s (Bubble Match, Word Search, the Reading Center
carousel) wear rather than a `×N` mono pin. It also passes **`pinSide="left"`** (default
`"right"`), putting the pill in the tile's top-LEFT corner, clear of the ghost glyph that
bleeds off the top-right. Code: `src/components/bento/Bento.tsx` →
`BentoTile`; `src/games/GamesPage.tsx`.

### Colour: tiles take a hue KEY, not a colour

`BentoTile` takes `hue: RampHue` (`RAMP`, `src/theme/colors.ts`), not
a hex. A tile needs **two tiers of one hue at once** — the pastel `fill` for its body
and the matching `ink` for its ghost glyph. Passing them separately is the palette
mistake that typechecks, looks deliberate, and is invisible in review. `GameDef.hue`
follows the same rule.

Title is `COLORS.onSurface`, subtitle is `COLORS.textSecondary`, on every hue.
**Never white** — white on a 93% pastel is ~1.1:1.

### The ghost glyph

`.bg` — an oversized Material Symbol bleeding off the top-right, drawn in ink
(`COLORS.onSurface`, v2 has no per-hue ink tier) at 15% (`CARD_SHELL.ghostOpacity`). It is
**decoration, not information**: clipped, behind the text, barely a tone. Do not rely
on it to distinguish two tiles — the title does that.

### `markOutline` does not apply here

Every other pastel fill in the app carries the 12% inset ring, because a pastel is
~1.15:1 against paper. A Bento tile is the exception, and the design draws the
distinction itself: `.msb .cells i` (15px, no content) gets the ring; `.bt` (112px,
carrying a title and subtitle) gets a soft `0 1px 2px` drop shadow. **The rule is: a
pastel needs an outline unless it is large and occupied.**

Bento tiles are also an exception to the app-wide button/card outline
(`1px solid COLORS.border`, CLAUDE.md § "Buttons & cards"): `CardShellProps.outlined`
defaults to `false` and `BentoTile` never sets it. `GameCard`'s `card` variant DOES set it
(game cards are outlined), except Word Search's (`GameCardData.outlined: false`). `TipBox`
used to share the tile exception but now wears the outline
(`src/components/TipBox.tsx` → `TipCard`).

Code: `src/components/bento/CardShell.tsx` → `CardShell` (`outlined`);
`src/games/shared/GameCard.tsx` → `GameCard`.

### Tiles are real anchors

`to` / `state` render the tile as a `RouterLink` — middle-click, new-tab, and
keyboard focus come free. `onClick` receives the **event**, so a tile can intercept
its own activation (`preventDefault()` + navigate imperatively) while leaving
modified clicks to the anchor.

### CardShell — one body for the whole family

`CardShell` is the body every Bento-family card renders through: the 19px radius, the
optional outline (above), the `SHADOW.rest` drop shadow, the 14px padding, the ghost glyph
(ink, 15%, bleeding off the top-right) and the corner pin slot (`pin` / `pinTone` /
`pinBare` / `pinSide`, all described above). It owns NO inner layout.

Two entities render through it, so a change to any shell number moves both:

| Entity | Inner layout |
|---|---|
| `BentoTile` | foot-aligned title + subtitle, geometry from `TILE_VARIANTS` |
| `GameCard` `variant="card"` (`src/games/shared/GameCard.tsx`) | header (name + `WinCountPill`) over a row of launch-option slots + a `RoundPlayButton`; uses `TILE_VARIANTS.base`'s ghost and `CARD_TITLE_SX`, so a game card's name reads exactly like a base tile's |

`GameCard`'s other variant, `tile`, IS a `BentoTile` (see
[GAMES_FEATURE.md](./GAMES_FEATURE.md) § "Games hub").

*(Removed 2026-10-03: `BentoStrip` / `BentoSubTile`, a captioned row of sub-tiles, and
`BentoStripProps.control`. Their last callers were the Games hub's Bubble Match / Word
Search strips, which became `GameCard`s. `SectionHeader`'s `meta` slot,
`src/components/primitives/Label.tsx`, still carries the "fact about the set, never a
control" meaning the strip header had.)*

## Callers

| Page | Shape |
|---|---|
| **Home** (`src/pages/HomePage.tsx`) | Night Market `hero`; Games / Arena / **Immersive World** (`blu`) / Reader / Dictionary `base`; Community / Friends `low`. Role-gated tiles do **not** append to the mosaic: they render in a **second `Bento` below a hairline** (`.home-page__gated-divider`, `COLORS.rowBorder`), so the main grid keeps the artboard's shape for every account. `isValidator` adds Tester Dashboard; `isTemplateAuthor` adds Template Editor, Template Sandbox (`pur`) and **Scene Editor** (`blu`, Immersive World's hue, `/immersive-world/scene-editor`), one grant covering all three, the odd hue marking the one that authors a different feature. All are `low`. The divider and the second grid are rendered together or not at all — an account with no grants never sees a rule with nothing under it. An odd count in the gated grid leaves its last row half-empty on purpose; stretching the orphan would give a dev tool Night Market's weight. |
| **Discover** (`src/features/discover/DiscoverPage.tsx`) | Sort Cards `hero`; Quick Mark and Skipped Cards `base`. |
| **Games** (`src/games/GamesPage.tsx`) | `CollectionChip` above the grid; EVERY game is a `GameCard` (`src/games/shared/GameCard.tsx`): Bubble Match and Word Search as full-row `variant="card"` (the Reading Center carousel's card, drawn on `CardShell`), Match Speed / Hydra Bubbles / Memory Map as half-width `variant="tile"` (a `BentoTile`). Speed Reading is hub-hidden. |
| **Friends** (`src/features/friends/FriendsPage.tsx`) | The one `columns={3}` caller, and the one that is a MENU OF ACTIONS rather than of destinations: Send / Accept / Remove as `compact` tiles (blu / grn / red — valence, not decoration), then Challenges as `low` + `fullWidth` with a subtitle. Both counted tiles use `pinTone="alert"`. Its tiles pass `to` **and** an `onClick` that intercepts the plain-click to run the drill-in slide, so they keep real link behaviour for modified clicks. |

Bubble Match's and Word Search's cards are **special-cased in the page**, not
driven by generic `GameDef` fields. Word Search's card is owned by
`src/games/word-search/WordSearchHubItem.tsx` rather than the page, because it holds
word-search-specific state (the saved board, the confirm dialog).

## Registry fields the hub reads

`GameDef` (`src/games/types.ts`):

* `hue: RampHue` — the tile's ramp hue. *(Was `bgColor: string`.)*
* `glyph: string` — the ghost glyph's Material Symbols name. *(Was `iconAsset`, an
  optional image URL that no game ever set.)*
* *(no `subtitle`)* — Games hub tiles are **name-only** since 2026-10-03: `GameDef.subtitle`
  was deleted, and no `GameCard` carries a subtitle (Bubble Match's level options read
  just "Level N"). `BentoTile`'s own
  `subtitle` prop still exists for other hubs.

Bubble Match's `hue` is only a fallback: its card is white and its level options take
their own hues from `LEVEL_HUES` (`src/games/bubble-match/constants.ts`, a difficulty
ramp), via `buildBubbleMatchCard`.

## Known gaps

* **The Games hub names no mastery track.** The track used to ride the tile subtitle
  (`tileSubtitle()` → `"Recognition · 30-second clock"`, after `MarkTypeChip` was
  deleted 2026-08-22); since 2026-10-03 the hub tiles are name-only, so a player cannot
  see which track a game trains without opening it. `GameDef.markType` still drives
  the mark call and challenge eligibility.
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
