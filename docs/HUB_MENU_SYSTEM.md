# Hub Menu System

Shared menu component (`src/components/HubMenu.tsx`) behind the three footer-tab
hubs: `HomePage.tsx` (`/`), `DiscoverPage.tsx` (`/discover`), `GamesPage.tsx`
(`/games`).

## Structure

`HubMenu` is a flex column (`MenuList`, `gap: 28`, `marginTop: 16`) that renders,
in order: an optional `header`, its card children, an optional `footer`. Header
and footer render as direct flex children (not wrapped in their own box), so a
multi-part header/footer — e.g. a `TipBox` immediately followed by a
`HubMenuSpacer` — gets the same 28px gap between its own parts as between the
cards.

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
  choices — today, only Bubble Match's 3 difficulty levels.

Both card types accept a `state` prop, forwarded to the underlying
`RouterLink`/`useSlideNavigate` call as React Router navigation state (used to
pass the tapped Bubble Match level without a URL param).

## Per-hub composition

| Hub | Header | Footer |
|---|---|---|
| Home (`/`) | Static welcome text | `TipBox` + `HubMenuSpacer` |
| Games (`/games`) | `TipBox` + `HubMenuSpacer` | `HubMenuSpacer` |
| Discover (`/discover`) | `TipBox` + `HubMenuSpacer` | `HubMenuSpacer` |

Header/footer render inside `ContentInner`, i.e. inside `MobileTabScreen`'s
scroll-away `ScrollArea` — they scroll with the content, they are not sticky.
`HubMenuSpacer` (a fixed 28px block) is additive on top of the
`FLOATING_FOOTER_CLEARANCE` bottom padding `MobileTabScreen`'s `ScrollArea`
already reserves for the floating footer pill — it isn't a replacement for
that clearance, just extra breathing room around the last visible element.

## Tip box (`src/components/TipBox.tsx`)

Draws from a hardcoded pool (`src/data/tips.ts`, a flat `string[]`) — not a
database table. Picks a random tip on mount and is tappable to re-roll,
excluding whatever tip is currently shown so a tap never repeats it. One
component/pool shared by all three hubs.

## Bubble Match as an array item

Bubble Match's hub entry is a `HubMenuArrayItem` with one sub-card per
`LEVEL_CONFIGS` entry (`src/games/bubble-match/constants.ts`: Chill / Hustle /
Torture). This is special-cased directly in `GamesPage.tsx` (matched on
`game.gameId === "bubble-match"`), not a generic `GameDef.levels` field — it's
the only game that fans out today.

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
comes from `location.state.level` (falling back to `LEVEL_CONFIGS[0]` for any
stray navigation with no state, e.g. a manual URL visit) and the page begins
that run as soon as the card pool loads. The in-game "different level" floating
menu (`BubbleMatchLevelMenu.tsx`, shown after a run ends) is unchanged — it
remains a secondary fast-replay shortcut once already in a run.
