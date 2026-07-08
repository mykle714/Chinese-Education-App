# Hub Menu System

Shared menu component (`src/components/HubMenu.tsx`) behind the three footer-tab
hubs: `HomePage.tsx` (`/`), `DiscoverPage.tsx` (`/discover`), `GamesPage.tsx`
(`/games`).

## Structure

`HubMenu` is a flex column (`MenuList`, `gap: 28`, `marginTop: 16`) that renders,
in order: an optional `header`, its card children, an optional `footer`. Header
and footer render as direct flex children (not wrapped in their own box), so a
multi-part header/footer gets the same 28px gap between its own parts as between
the cards.

A menu item is one of:

- **`HubMenuRow`** — a single card: a RouterLink-based rounded rectangle, 80%
  of the phone-frame width, centered, `aspect-ratio: 2/1`, with a persistent
  pastel `bgColor` (hardcoded per item, never randomized at render), title
  top-left, subtitle below it, a large icon tile on the right, and an optional
  `cornerBadge` pinned to the top-right corner.
- **`HubMenuArrayItem`** — a horizontally-scrolling strip of smaller (70%-wide)
  sub-cards, same visual language as `HubMenuRow`. Desktop gets click-and-drag
  panning via `useDragScroll`; touch/trackpad scroll natively
  (`touchAction: pan-x`). Used when one hub entry fans out into several
  choices — today, only Bubble Match's 3 difficulty levels. Because the
  sub-cards are anchors (`RouterLink`), `useDragScroll` also cancels the
  container's native `dragstart` — otherwise the browser would drag the
  link's URL on desktop mouse-drag and hijack the pointer (`src/hooks/useDragScroll.ts`).

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
in `WordSearchHubItem.tsx`) but have no stat badges.

- All 3 sub-cards share the game's title ("Bubble Match") with the level name
  as the subtitle, and link to the same route (`/games/bubble-match`); the
  tapped level is passed via nav `state: { level }`.
- Per-level background color is hardcoded in `GamesPage.tsx`
  (`BUBBLE_MATCH_LEVEL_COLORS`): green (Chill) → yellow (Hustle) → red
  (Torture).
- Each sub-card's `cornerBadge` is a `HubMenuStatBadge` showing the weekly ⭐
  (cleared this week) and the lifetime win count (`×N`), sourced from
  `useGameWins` (`src/hooks/useGameWins.ts`) — the same hook `BubbleMatchPage`
  uses for its own in-run badges, both keyed by `GAME_KEY` ("bubbleMatch",
  exported from `constants.ts`). One fetch/record-win implementation, read by
  both surfaces.

`BubbleMatchPage` no longer has an in-game level picker. Its old `"start"`
phase (description text + level buttons) is gone; the flow is now
`loading → (blocked) → playing → (won | lost) → playing (replay)`. The level
comes from `location.state.level`; a stray navigation with no valid level
(e.g. a manual URL visit) **redirects to `/games`** rather than defaulting, so
a level must be picked from the hub (Word Search does the same for its mode).
The page begins that run as soon as the card pool loads. The in-game "different level" floating
menu (`BubbleMatchLevelMenu.tsx`, shown after a run ends) is unchanged — it
remains a secondary fast-replay shortcut once already in a run.
