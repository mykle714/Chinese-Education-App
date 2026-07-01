# Games Feature

A new top-level section of the mobile demo where users access mini-games that
reinforce vocabulary and character learning. The first surface is a hub page
listing all available games; individual games will live as their own pages
linked from the hub.

## Status

- Hub page (`/games`) — scaffolded, empty menu + empty-state copy.
- Games — none yet. Menu list is intentionally empty until the first game ships.

## Routes

| Path     | Component   | Footer `activePage` | Notes                          |
| -------- | ----------- | ------------------- | ------------------------------ |
| `/games` | `GamesPage` | `"home"`            | Hub / menu; **node page** (left arrow → `/`, keeps footer, slides in-from-right) |

Each individual game gets its own route under `/games/<slug>`.

**Bubble Match is a leaf page (no footer).** `BubbleMatchPage` is wrapped in
`LeafPage` (see [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)): the down-arrow back
button (→ `/games`) is the only way out, there is **no** footer on any of its
screens (info / picker / loading / blocked / stage), and the page slides up on
enter / down on exit. The pinyin + autoplay toggles and the fire badge live in
the header's right slot via `BubbleMatchHeaderControls`.

The **generic** in-game shell `src/games/runtime/GamePage.tsx` (for future
registry games that don't ship their own page) still renders
`MobileFooter activePage="home"` on its info/loading screens and hides it during
the live stage (`!showStage`); it has not been migrated to a leaf page yet.

## Navigation entry point

Games is **not** a footer tab. It is a row in the **Home menu** (`/`, see
[NAVIGATION.md](./NAVIGATION.md)). The footer tabs are Flashcards / Discover /
Home / Account; the Games hub is reached by tapping **Games** in the Home menu.
The hub is a **node page** (`NodePage`, see [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md)):
its header shows a **left** back arrow returning to `/`, it keeps the floating
footer, and it slides in from the right (out to the right only when the arrow is
tapped — footer-tab nav does not animate).

## Design decisions

### 1. Hub is a vertical, width-spanning menu
Each game appears as a single full-width row in `games-page__menu`. This makes
the hub feel like a clean directory rather than a tiled launcher and keeps
parity with the long-form scroll surfaces elsewhere in the mobile demo (decks,
discover). Rows will be tall enough to hold an icon, a title, and a short
subtitle/blurb — exact row anatomy will be decided when the first game is
designed.

### 2. Empty state instead of placeholder cards
While there are no games, the hub renders a centered empty state ("No games
yet" + subtitle) instead of mocked rows. Rationale: placeholder rows tend to
get shipped by accident, and a real empty state forces a clear "first game"
design moment.

### 3. Left back arrow on the hub (node page)
The hub is a **node page** (`NodePage`), so it shows a **left** back arrow
returning to `/` — Games is a drill-in from the Home menu, not a footer tab.
It keeps the floating footer (lateral nav stays available) and only slides out
to the right when the arrow is tapped. See [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).

### 4. Reuses the existing iPhone frame layout
`GamesPage` mirrors the `IPhoneFrame` / `ContentArea` / `MobileFooter` layout
from `FlashcardsDecksPage` so the games tab feels like a sibling surface
rather than a separate visual system. Design tokens are duplicated locally
for now; if a third page needs them we should hoist a shared
`MobileSurface` primitive.

## Open questions (to resolve when adding the first game)

- Row anatomy: icon size, title/subtitle hierarchy, trailing chevron vs. none.
- Locking / progression: can any game be played at any time, or are some
  gated behind deck progress / vocab counts?
- Score / streak surfacing: do games contribute to the existing
  minute-points / streak system, or do they have their own progression?
- Sort order of the menu: manual curation, recency, or recommended-first?

## Mobile demo frame (shared sizing)

All mobile-demo routes (the ones listed in `MOBILE_DEMO_PATHS` in
`src/components/Layout.tsx`) share **one** phone-frame container:
`src/components/MobileDemoFrame.tsx`. `Layout.tsx` wraps the route's children
with it automatically — on mobile it renders full-bleed, on desktop it renders
as a centered ~393px-wide rounded card. There is no sidebar/hamburger chrome
anymore (see [NAVIGATION.md](./NAVIGATION.md)); desktop is phone-frame-only.

**Do not** re-introduce a per-page `IPhoneFrame = styled(Box)…` or local
`desktopFrameSx` block when adding a new game page (or any other mobile-demo
page). Just register the route in `MOBILE_DEMO_PATHS` and render the page's
content directly — header + content area + `MobileFooter`. The frame is
applied for you.

Today's `MOBILE_DEMO_PATHS`: `/`, `/flashcards/decks`, `/flashcards/mastered`,
`/account`, `/flashcards/learn`, `/discover`, `/games`, plus any path under
`/discover/sort/` or `/flashcards/card/`.

## Mobile demo header (shared header hierarchy)

Two-layer header model (there is **no** hamburger / nav drawer — global nav is
the footer tabs + the Home menu):

- **`PageHeader`** (`src/components/PageHeader.tsx`) — base layout primitive.
  Defines the row: optional back button (`arrowDirection` "down" | "left") ·
  optional left-icon badge · title · `rightContent` (a single flush-right
  ReactNode slot).
- **`MobileDemoHeader`** (`src/components/MobileDemoHeader.tsx`) — composes
  `PageHeader`, adds the active-tab identity badge in the left slot
  (`activePage`, when no back button), `showBack` for drill-ins, an
  `arrowDirection` pass-through, and an `extraActions` slot rendered flush-right
  (e.g. the settings gear on Account).
- **`LeafPageHeader` / `NodePageHeader`** (`src/components/`) — thin
  specializations preset to `arrowDirection` "down" / "left" + `showBack`. Used
  by the `LeafPage` / `NodePage` wrappers. See
  [LEAF_NODE_PAGES.md](./LEAF_NODE_PAGES.md).

Rules of thumb:

- Footer-tab hubs (Flashcards/Decks, Discover, Home, Account) → use
  `MobileDemoHeader` inside `MobileTabScreen`; pass `title`, `activePage`, and
  optional `headerExtraActions`.
- Back-arrow drill-ins → use the `LeafPage` (down arrow, no footer) or `NodePage`
  (left arrow, keeps footer) wrapper instead of composing the header by hand.
  Games + Mastered Cards are node pages; Sort Cards, Dictionary, and Card Detail
  are leaf pages.
- Specialty in-page headers (`FlashcardsLearnHeader` with fire icon + seconds
  counter) → compose `PageHeader` directly and own their own `rightContent`.

## Games framework

The hub no longer hardcodes its menu — it reads from a registry that also
drives the router and the mobile-demo allowlist. The framework has three
frontend layers and a thin backend.

### Layer 1 — Registry (`src/games/registry.ts`)

```ts
export const GAME_REGISTRY: GameDef[] = [
  { gameId: "bubble-match", title: "Bubble Match", route: "/games/bubble-match",
    requiresAuth: true, Component: lazy(() => import("./bubble-match/BubbleMatchPage")) },
];
```

Each `GameDef` (`src/games/types.ts`) carries `gameId`, `title`, `subtitle`,
`iconAsset`, `route`, a lazy-loaded `Component`, and optional gating
(`requiresAuth`, `unlock.minVocabEntries`).

The registry is consumed by:

- `src/pages/GamesPage.tsx` — renders one menu row per registered game; falls
  back to the existing empty state when nothing is registered (or everything
  is gated out).
- `src/App.tsx` — iterates `GAME_REGISTRY` to mount one route per game, each
  wrapped in a `Suspense` boundary for the lazy component.
- `src/components/Layout.tsx` — spreads `GAME_ROUTES` into
  `MOBILE_DEMO_PATHS` so every game gets the phone frame automatically.

Net effect: adding a new game = one entry in `GAME_REGISTRY` + one page
component. No edits to `GamesPage`, `App`, or `Layout`.

### Layer 2 — Runtime (`src/games/runtime/`)

- **`GameStage.tsx`** — generic Pixi.js host. Props:

  ```ts
  interface GameStageProps {
    assets: GameAsset[];                          // preloaded as textures
    onReady?: (ctx: GameStageContext) => void;    // app + textures + viewport
    onTick?: (dtMs: number, tMs: number) => void; // per-frame hook
    children?: ReactNode;                         // pixi JSX scene
    background?: string;
  }
  ```

  Texture preload is keyed by `assetId`; the URL is resolved from the
  backend's `imagePath` (`/games/<gameId>/...`) via `API_BASE_URL`. Games own
  the scene tree by rendering pixi JSX through `children`.

- **`GamePage.tsx`** — page-level shell. Renders `<MobileDemoHeader>` (with
  back-nav to `/games`) + a flex `ContentArea` + `<MobileFooter
  activePage="home">`. Most games render `<GamePage game={gameDef}>{stage}</GamePage>`.

- **`useGameActors.ts`** — generalized version of the night market's
  `usePixiPedestrians` handle. Generic over the game's actor type; returns
  `{ tick, getDrawables, getActors, setActors, setSpeedMultiplier }`. Games
  can ignore this and roll their own simulation if they prefer.

### Layer 3 — Data hooks (`src/games/hooks/`)

All reuse `src/api/http.ts` (the typed cookie-auth `fetch` wrapper — `apiGet` /
`apiPost`). It inherits transparent token-refresh from the global fetch
interceptor (`src/utils/fetchInterceptor.ts`).

| Hook | Endpoint | Notes |
| --- | --- | --- |
| `useVocabEntries({ category?, language? })` | `GET /api/vocabentries` | User's saved vocab (vet). Same data FlashcardsLearnPage uses. |
| `useDictionaryEntries({ terms })` | `GET /api/dictionary/lookup/:term` (×N in parallel) | Detail lookup against det. Missing terms swallowed individually. |
| `useGameAssets(gameId)` | `GET /api/games/:gameId/assets` | Drives `GameStage` texture preload. |
| `useGameProgress<TState>(gameId)` | `GET` / `POST /api/games/:gameId/progress` | No-ops for public / unauthenticated accounts. |

### Layer 4 — Backend (`server/`)

Two new tables (migration `database/migrations/52-create-game-tables.sql`):

- **`gameassets`** — `(gameId, assetId)` unique; per-game asset registry.
  Binaries live under `server/public/games/<gameId>/` and are served as
  static files; the DB stores the relative path.
- **`gameprogress`** — `(userId, gameId)` unique; one save blob per
  user/game. `state` is JSONB whose shape each game defines client-side.

Follows the existing DAL + Service + Controller pattern:

- `server/dal/implementations/GameAssetDAL.ts`,
  `server/dal/implementations/GameProgressDAL.ts`
- `server/services/GameAssetService.ts`, `server/services/GameProgressService.ts`
- `server/controllers/GamesController.ts`
- Wired in `server/dal/setup.ts`; routes registered inline in
  `server/server.ts`:
  - `GET  /api/games/:gameId/assets`
  - `GET  /api/games/:gameId/progress`
  - `POST /api/games/:gameId/progress`

`server/scripts/seedGameAssets.js <gameId>` walks
`server/public/games/<gameId>/` and upserts one `gameassets` row per file —
safe to re-run.

### Adding a new game — checklist

1. Drop image files into `server/public/games/<gameId>/`.
2. Run `node server/scripts/seedGameAssets.js <gameId>`.
3. Create `src/games/<gameId>/<GameId>Page.tsx`:

   ```tsx
   const MyGamePage: React.FC = () => {
     const game = GAME_REGISTRY.find(g => g.gameId === "<gameId>")!;
     const { assets } = useGameAssets(game.gameId);
     return (
       <GamePage game={game}>
         <GameStage assets={assets} onTick={...}>
           {/* pixi JSX */}
         </GameStage>
       </GamePage>
     );
   };
   export default MyGamePage;
   ```

4. Append the `GameDef` to `GAME_REGISTRY` in `src/games/registry.ts`:

   ```ts
   {
     gameId: "<gameId>",
     title: "...",
     route: "/games/<gameId>",
     Component: React.lazy(() => import("./<gameId>/<GameId>Page")),
   }
   ```

No other edits needed — the hub, router, and mobile-demo frame all wire
themselves automatically from the registry.

## Files

- `src/components/MobileFooter.tsx` — footer tabs (Flashcards / Discover / Home / Account)
- `src/components/MobileDemoFrame.tsx` — shared phone-frame container
- `src/components/MobileDemoHeader.tsx` — shared header (back / title / active badge / extraActions); no hamburger
- `src/components/PageHeader.tsx` — base header (renamed `rightItems` → `rightContent`)
- `src/components/Layout.tsx` — wires `MobileDemoFrame` into demo routes; spreads `GAME_ROUTES` into `MOBILE_DEMO_PATHS`
- `src/pages/GamesPage.tsx` — hub page; renders `GAME_REGISTRY`
- `src/App.tsx` — `/games` route + per-game routes from registry
- `src/games/registry.ts` — central `GAME_REGISTRY` + `GAME_ROUTES`
- `src/games/types.ts` — `GameDef`, `GameAsset`, `GameProgress`
- `src/games/runtime/GameStage.tsx` — generic Pixi host
- `src/games/runtime/GamePage.tsx` — page shell every game uses
- `src/games/runtime/useGameActors.ts` — generic actor handle (tick + drawables)
- `src/games/hooks/useVocabEntries.ts`, `useDictionaryEntries.ts`, `useGameAssets.ts`, `useGameProgress.ts`
- `server/dal/implementations/GameAssetDAL.ts`, `GameProgressDAL.ts`
- `server/services/GameAssetService.ts`, `GameProgressService.ts`
- `server/controllers/GamesController.ts`
- `server/dal/setup.ts` — DI wiring
- `server/server.ts` — route registration
- `server/scripts/seedGameAssets.js` — asset seed helper
- `database/migrations/52-create-game-tables.sql` — `gameassets` + `gameprogress`

## Game: Word Search (`/games/word-search`)

Second game (built). Find 20 of your own vocab words — shown as English glosses —
hidden as snaking (orthogonal) paths in a 12×16 grid of colored-pinyin (cpcd)
characters. Drag or tap to trace; any valid multi-char selection pops a
dictionary info-card + audio. Count-up timer → medal on completion. Reuses
Bubble Match's pool + fallback distribution, adds a substring de-dup pass and a
server-side snaking grid generator (`GET /api/onDeck/word-search-grid`). Full
spec + file map: → [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md).

## Game: Bubble Match (`/games/bubble-match`)

The first shipped game. **Does not use the Pixi `GameStage`/`useGameActors`
runtime** — it is a DOM + `requestAnimationFrame` game (absolutely-positioned
bubbles moved via `transform`), chosen for direct reuse of the colored-pinyin
`CPCDRow` (cpcd) and cheap circle-circle physics at ~50 bubbles. It still renders
through the standard page shell (its own flp-style header + `MobileFooter
activePage="home"`), not `GamePage`.

### Gameplay

- A game uses the **full pool**: 15 Target + 10 Comfortable library cards =
  **25 pairs → 50 bubbles**. Each pair = one **word** bubble (cpcd) and one
  **definition** bubble (the flashcard's `stripParentheses(definition)`).
- Bubbles **launch** on a per-level cadence and **float** with momentum-preserving
  elastic collisions (`physics.ts`). Drag a bubble onto its partner to match
  (bidirectional). Correct → green pop + removal; wrong → red shake + release.
  Picking up / dropping **onto** a Chinese word triggers autoplay TTS.
- **Restart (header):** during active play the header's right slot shows a
  restart icon (`BubbleMatchHeaderControls.onRestart`, wired only while
  `phase === "playing"`) that re-runs the **same level with the same words**
  (reshuffled launch order) via `startLevel(level)`.
- **Levels do not chain** — a level picker selects difficulty (launch cadence +
  ceiling-shrink speed); all use the full pool. **There is no clock.** Once the
  whole pool has launched, on the next launch-tick a **descending ceiling**
  (`boundsRef.top`, rising at the level's `shrinkSpeedPxPerSec`) starts closing
  in from the top, compressing the field. Win = clear all pairs. Lose = the field
  over-packs under the ceiling (area ≥ `LOSE_FILL_RATIO`, or sustained residual
  overlap) — the border glows red at ≥85% fill as a warning first. Tunables live
  in `constants.ts` (`LEVEL_CONFIGS`, `GAME_DISTRIBUTION`, `MIN_PLAY_HEIGHT`,
  sizes, physics).
- Minute-points: `/games/bubble-match` is in `MINUTE_POINTS_ELIGIBLE_PAGES`
  (`src/constants.ts`); the header's `MinutePointsFireBadge` works as on flp.

### Files

- `src/games/bubble-match/` — `BubbleMatchPage.tsx` (flow: loading → blocked |
  picker → playing → won | lost), `BubbleStage.tsx` (rAF loop, launcher,
  descending ceiling, drag/hover/match, HUD, red glow), `Bubble.tsx` (one bubble; outer
  node carries the loop's transform, inner node carries CSS pop/shake),
  `physics.ts`, `BubbleMatchHeader.tsx` (right-slot controls: restart button +
  pinyin/autoplay toggles + fire badge), `BubbleMatchEndPopup.tsx` (won/lost card
  + minimize-to-corner puck), `BubbleMatchLevelMenu.tsx` (the floating
  "Different Level / Same Cards" level picker layered over the end popup — lists
  all levels, marks the current one, replays the loaded pool at the picked
  level), `constants.ts`, `types.ts`.
- `src/games/registry.ts` — registers the game (`requiresAuth: true`).

### Backend

Reuses the OnDeck vocab stack (no new tables). New endpoints in `server.ts`:

- `GET /api/onDeck/game-pool?Target=15&Comfortable=10` →
  `{ cards, requested, available, sufficient }`. `OnDeckVocabService.getGameVocabPool`
  pulls library cards per category (same RANDOM ordering + `definition` source as
  the working loop), enriches + pre-warms TTS, and reports availability so the
  client can block entry when the user lacks enough words.
- `GET /api/onDeck/category-counts` → `{ Unfamiliar, Target, Comfortable, Mastered }`,
  also surfaced under each bucket label on the decks page.
