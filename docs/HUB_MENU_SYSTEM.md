# Hub Menu System

Shared menu component (`src/components/HubMenu.tsx`) behind the three footer-tab
hubs: `HomePage.tsx` (`/`), `DiscoverPage.tsx` (`/discover`), `GamesPage.tsx`
(`/games`).

## Structure

`HubMenu` is a flex column (`MenuList`, `gap: 28`, `marginTop: 16`) that renders,
in order: an optional `header`, its card children, an optional `footer`. Header
and footer render as direct flex children (not wrapped in their own box), so a
multi-part header/footer gets the same 28px gap between its own parts as between
the cards. The Games hub uses exactly that: its `header` is the collection selector
pill followed by the `TipBox` (see [GAMES_FEATURE.md](./GAMES_FEATURE.md)
§ "Collection selector"). Both are sized to **80% width, centered**, the same
footprint as a `HubMenuRow`, so the header reads as part of the same column.

A menu item is one of:

- **`HubMenuRow`** — a single card: a RouterLink-based rounded rectangle, 80%
  of the phone-frame width, centered, `aspect-ratio: 2/1`, with a persistent
  pastel `bgColor` (hardcoded per item, never randomized at render), title
  top-left, subtitle below it, a large icon tile on the right, an optional
  `cornerBadge` pinned to the top-right corner, and an optional `chip` run
  vertically up the card's right edge (see
  [Edge label slot](#edge-label-slot-cardedgeslot-hubmenutsx)).
- **`HubMenuArrayItem`** — a horizontally-scrolling strip of smaller (70%-wide)
  sub-cards, same visual language as `HubMenuRow`. Desktop gets click-and-drag
  panning via `useDragScroll`; touch/trackpad scroll natively
  (`touchAction: pan-x`). Used when one hub entry fans out into several
  choices — today, Bubble Match's 3 difficulty levels and Word Search's 2 pinyin
  modes. Because the
  sub-cards are anchors (`RouterLink`), `useDragScroll` also cancels the
  container's native `dragstart` — otherwise the browser would drag the
  link's URL on desktop mouse-drag and hijack the pointer (`src/hooks/useDragScroll.ts`).
  Any strip like this **must set `overflowY: hidden` explicitly** next to its
  `overflowX: auto` (`ArrayScroll`, `HubMenu.tsx`; `Strip`,
  `src/games/word-search/WordSearchHubItem.tsx`): CSS computes the unspecified
  axis to `auto` whenever the other is `auto`/`scroll`, which made the strip a
  vertical scroll container and let the sub-cards wobble within the few px of
  slop left by rounding their `aspectRatio: 2/1` height.
  Optionally topped by a **group header** (`headerTitle` + `headerStat`), in
  which case header and strip are wrapped in one `HubMenuGroup` flex column
  (`gap: 8`) so the pair counts as a single item inside `MenuList`'s 28px gap.

### Group header (`HubMenuGroupHeader`, `HubMenu.tsx`)

A header line above a fan-out strip: uppercase group name (`SIZE.body` /
`WEIGHT.bold` / `COLORS.textSecondary`, letter-spaced, ellipsized) on the left, an
optional aggregate stat node on the right. Its `padding: 0 10%` matches
`ArrayScroll`'s inset and `HubMenuRow`'s centered 80% width, so the title aligns
with the first sub-card's left edge and the stat with a full-width row's right edge.

**Rule: a stat that describes the whole group belongs on this header, never on a
sub-card.** A count pinned to a sub-card reads as *that card's* score. Both
`HubMenuArrayItem` (via `headerTitle`/`headerStat`) and feature-owned strips (via
the exported `HubMenuGroup` + `HubMenuGroupHeader`, used by `WordSearchHubItem`)
render the identical header.

### Edge label slot (`CardEdgeSlot`, `HubMenu.tsx`)

An optional node rendered as the card's **last flex child — outboard of the icon
tile, against the right edge**. It is a flex column that stretches to the card's
height and **centers** its label in it (`align-self: stretch`,
`justify-content: center`), so the word reads as balanced against the cell rather
than anchored to one end. It hugs its label's width, costing the text column that
plus `cardBaseSx`'s 12px gap, which is why the label is deliberately narrow.

**The slot carries almost no padding**, by design — every px of it is a px the
longest label can't use, and on a card this small it reads immediately as the label
being crowded:

| | | |
|---|---|---|
| `margin: -CARD_PADDING_PX` (top/bottom) | −20px | Cancels the card's vertical padding so the column spans the cell's **full height** |
| `margin-right: -EDGE_SLOT_RIGHT_PULL` | −10px | Reclaims **half** the card's right padding. Half, not all: flush to the edge collides with the 28px corner radius |
| `padding: EDGE_SLOT_CORNER_CLEARANCE` (top/bottom) | 4px | The only padding left — just enough to keep the last letter off the rounded corner |

**Centering makes the corner badge a live concern.** `CornerBadgeSlot` floats at
top/right 14 and is ~33px tall, while a centered ~89px run on the shortest card
(136px) starts ~24px down — so on a card carrying both (Bubble Match's ⭐ level
sub-cards) the badge can touch the label's first letters. The slot used to reserve a
band for it (`EDGE_SLOT_BADGE_INSET`), but that inset is exactly the padding that
read as too much and was removed. **If the overlap ever needs fixing, move the badge
— do not re-inset the slot.**

Passed as `chip` on `HubMenuRow` and per-sub-card as `chip` on
`HubMenuArraySubItem`. Feature-owned strips that hand-build their cards wrap their
own label in the exported **`HubMenuCardEdgeSlot`**, placed after
`HubMenuRowIconTile` (`WordSearchHubItem.tsx`) — the slot is no longer part of
`HubMenuCardTitle`, which is now title-over-subtitle only. **Per-sub-card, not
per-group**, precisely because a strip's choices can differ in what the label says
— Word Search's two modes feed different mastery tracks.

Its one consumer today is the Games hub's **`MarkTypeChip`**
(`src/components/MarkTypeChip.tsx`) in its `variant="edge"` form: the uppercase
mastery-track name ("RECOGNITION" / "PRODUCTION" / "READING" / "WRITING") from
`MARK_TYPE_LABELS` (`src/utils/masteryCompute.ts`), set in faded grey
(`COLORS.textSecondary` at `opacity: 0.5`, `SIZE.micro`, `TRACKING.caps`) and
turned 90° counter-clockwise so it reads bottom-to-top up the card's right edge —
`writing-mode: vertical-rl` plus `transform: rotate(180deg)`.

**The font size is fixed at `SIZE.micro`** — the same size the pill variants use.
Every track name reads identically on every card; the label never scales itself.

**Fitting the longest name is the SLOT's job, not the font's** — that is what the
negative margins above are for. "RECOGNITION" needs ~89px of run at `SIZE.micro`,
more than a 70%-wide sub-card's 96px *content box* comfortably gives, but a
comfortable fit in the ~128px the full-height slot gives. `CARD_PADDING_PX` is
exported from `hubMenuCardBase.ts` and used by both the card's padding and the
slot's negative margin, so the two cannot drift.

If a longer track name is ever added, **trim `EDGE_SLOT_CORNER_CLEARANCE` before
shrinking the font**; if it still doesn't fit, let it clip (`max-height: 100% /
overflow: hidden` is the backstop).

> **Do not make the font auto-fit.** Deriving the size from the container with CSS
> container units (`container-type: size` on the cards, `font-size` in `cqh`
> divided by the label's character count) was built and reverted twice: it makes
> labels of different lengths render at different sizes, which reads as a bug on a
> strip of sibling cards, and putting `contain: size` on a hub card also makes
> `aspect-ratio: 2/1` authoritative, so long subtitles clip instead of growing the
> card. Uniform type + a taller slot is the design.

This variant is intentionally **quiet** — on the Games hub the track a game feeds is
a footnote, not a second title. The trade-off: `variant="edge"` drops the colored
dot, so it is the one place `MarkTypeChip` does *not* color-match the cdp stacked
progress bar's `MARK_TYPE_COLORS` hue. The other two variants keep the pill+dot form
(`"card"` translucent white for a pastel card, `"surface"` a neutral tint for the
plain page background) for use off the hub cards.

`MarkTypeChip` sits in `components/` rather than `features/flashcards/` because its
callers are under `src/games/**`, which may not reach into another feature folder
(docs/FRONTEND_LAYERING.md).

**Edge label vs. corner badge.** The corner badge is *achievement* state that
changes as you play (⭐ / ×N); the edge label is a *static property* of the card.
The badge holds the top-right corner and the label is bottom-anchored below it, so
a card can carry both without collision.

Both card types accept a `state` prop, forwarded to the underlying
`RouterLink`/`useSlideNavigate` call as React Router navigation state (used to
pass the tapped Bubble Match level without a URL param).

## Per-hub composition

| Hub | Header | Footer |
|---|---|---|
| Home (`/`) | Static welcome text | `TipBox` + `FooterSpacer` |
| Games (`/games`) | `TipBox` | `FooterSpacer` |
| Discover (`/discover`) | `TipBox` | `FooterSpacer` |

Header/footer render inside `ContentInner`, i.e. inside `MobileTabScreen`'s
scroll-away `ScrollArea` — they scroll with the content, they are not sticky.
Bottom clearance above the floating footer pill comes from the shared
**`FooterSpacer`** component (`src/components/MobileFooter.tsx`), rendered as the
last footer element. It is the app-wide spacer used by every footer-bearing
surface (hubs, decks, dictionary, card details, mastered cards), so a single
height edit reflows them all. We use an explicit spacer block rather than
`MobileTabScreen`'s `ScrollArea` `paddingBottom` because that padding is (a)
swallowed when the flex content column overflows its computed height and (b)
covered by the scroll area's bottom edge-fade mask. Its height is
`FLOATING_FOOTER_CLEARANCE`; tune the breathing room via
`FLOATING_FOOTER_EXTRA_GAP` in `MobileFooter.tsx`.

## Tip box (`src/components/TipBox.tsx`)

Draws from a hardcoded pool (`src/data/tips.ts`, a flat `string[]`) — not a
database table. Picks a random tip on mount and is tappable to re-roll,
excluding whatever tip is currently shown so a tap never repeats it. One
component/pool shared by all three hubs.

## Array items (fan-out games)

Two games fan their hub entry out into a `HubMenuArrayItem` (a horizontal strip
of sub-cards) instead of a single row, both special-cased directly in
`GamesPage.tsx` (matched on `game.gameId`) rather than via a generic
`GameDef.levels` field:

- **Bubble Match** — one sub-card per `LEVEL_CONFIGS` entry
  (`src/games/bubble-match/constants.ts`: Chill / Hustle / Torture), passing
  `state: { level }`. Rendered as a plain `HubMenuArrayItem` in `GamesPage.tsx`.
- **Word Search** — one sub-card per `MODE_CONFIGS` entry (Pinyin / No Pinyin).
  **Not** a plain `HubMenuArrayItem`: it renders a dedicated strip component,
  `src/games/word-search/WordSearchHubItem.tsx`, because its buttons need custom
  click handling (both always start a fresh game, confirming first if a save
  exists) and it prepends a **1:1 resume card** when a saved board exists. That
  component reuses the shared card look via the exported primitives (below).
  See [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md) §3.

**Match Speed is deliberately NOT one of them.** It briefly shipped as a third
strip (Study Mix / Review / Challenge sub-cards passing `state: { mode }`) and was
converted back to a single `HubMenuRow`: the hub now offers one Match Speed entry,
so a launch from here carries no nav state and the page resolves
`DEFAULT_MODE_CONFIG` (Study Mix). The mode machinery in
`src/games/match-speed/constants.ts` still exists and still honours a `state.mode`
passed by any other caller — there is just no UI that sets one. That row keeps the
game-wide `×N` win badge as its `cornerBadge` (it has no group header to hang it
on), which makes it the only single row carrying a stat today.

### Shared card primitives (for custom strips)

So a feature strip can look identical to the built-in cards without
re-deriving them, three pieces are exported:

- **`cardBaseSx`** (`src/components/hubMenuCardBase.ts`) — the rounded-card base
  style (radius, padding, 2:1 aspect, hover/active transitions). Kept in its own
  module, not `HubMenu.tsx`, so exporting this non-component value doesn't
  disable React Fast Refresh for the component file.
- **`HubMenuCardTitle`** and **`HubMenuRowIconTile`** (`HubMenu.tsx`) — the
  title/subtitle block and the large rounded icon tile.

`WordSearchHubItem` composes these into its own `RouterLink` mode cards + a
1:1 resume card, and manages its own horizontal scroll (`useDragScroll`).

The rest of this section describes Bubble Match; Word Search's mode buttons
follow the same shape (title + sub-card subtitle, one shared route, choice via
nav state, per-sub-card hardcoded color `WORD_SEARCH_MODE_COLORS` — now living
in `WordSearchHubItem.tsx`). Its mode sub-cards carry no badges; its win count
lives on its group header, which it renders itself from `HubMenuGroup` +
`HubMenuGroupHeader` (`WordSearchHubItem.tsx`, keyed by `GAME_KEY` /
`WIN_LEVEL` in `src/games/word-search/constants.ts`).

- All 3 sub-cards share the game's title ("Bubble Match") with the level name
  as the subtitle, and link to the same route (`/games/bubble-match`); the
  tapped level is passed via nav `state: { level }`.
- Per-level background color is hardcoded in `GamesPage.tsx`
  (`BUBBLE_MATCH_LEVEL_COLORS`): green (Chill) → yellow (Hustle) → red
  (Torture).
- Win stats come from `useGameWins` (`src/hooks/useGameWins.ts`) — the same hook
  `BubbleMatchPage` uses to record wins, both keyed by `GAME_KEY` ("bubbleMatch",
  exported from `constants.ts`). One fetch/record-win implementation, read by
  both surfaces. It exposes two granularities:
  - `clearedLevels` / `lifetimeWins` — **per level**, keyed by level number.
  - `totalWins` — the **game-wide** sum across every level bucket.
- The two are rendered at the granularity they describe:
  - **Group header** (`headerStat`): `<HubMenuStatBadge variant="header" count={totalWins} />`
    — the game-wide `×N`. A player thinks "I've won Bubble Match 12 times", not
    "4 Easy + 5 Medium + 3 Hard".
  - **Each sub-card's `cornerBadge`**: `<HubMenuStatBadge starred={clearedLevels.has(level)} />`
    — the weekly ⭐ only, which *is* genuinely per-level ("you cleared THIS level
    this week"). No per-level count is displayed anywhere today.
- `HubMenuStatBadge` takes a `variant`: `"card"` (default, translucent white —
  reads on a pastel card) or `"header"` (`COLORS.rowHoverBg` tint — reads on the
  plain page background, where translucent white would vanish).

`BubbleMatchPage` no longer has an in-game level picker. Its old `"start"`
phase (description text + level buttons) is gone; the flow is now
`loading → (blocked) → playing → (won | lost) → playing (replay)`. The level
comes from `location.state.level`; a stray navigation with no valid level
(e.g. a manual URL visit) **redirects to `/games`** rather than defaulting, so
a level must be picked from the hub (Word Search does the same for its mode).
The page begins that run as soon as the card pool loads. The hub is now the **only**
place a level is chosen: the end-of-run popup offers a single "Play Again" (same
level, partially refreshed cards — see
[GAMES_FEATURE.md § Bubble Match replay](./GAMES_FEATURE.md)) plus "Back to Games",
and the old in-game "different level" floating menu (`BubbleMatchLevelMenu.tsx`)
has been deleted.
