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
| `/games` | `GamesPage` | `"games"`           | Hub / navigational menu        |

Each individual game will get its own route under `/games/<slug>` and should
also render `MobileFooter activePage="games"` so the tab stays highlighted
while a user is inside a game.

## Navigation entry point

A "Games" tab has been added to `MobileFooter` between **Discover** and
**Account**. It uses MUI's `SportsEsportsIcon` and follows the same icon +
label + divider pattern as the other tabs. The footer's `activePage` union now
includes `"games"`.

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

### 3. No back button on the hub
`PageHeader` is rendered with `showBack={false}` because the hub is a
top-level destination reached from the footer, not a child page.

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
with it automatically — on mobile it renders full-bleed (no Layout chrome),
on desktop it renders as a centered ~393px-wide rounded card alongside the
Layout sidebar drawer.

**Do not** re-introduce a per-page `IPhoneFrame = styled(Box)…` or local
`desktopFrameSx` block when adding a new game page (or any other mobile-demo
page). Just register the route in `MOBILE_DEMO_PATHS` and render the page's
content directly — header + content area + `MobileFooter`. The frame is
applied for you.

Today's `MOBILE_DEMO_PATHS`: `/flashcards/decks`, `/account`,
`/flashcards/learn`, `/games`, plus any path under `/discover/sort/` or
`/flashcards/card/`.

## Mobile demo header (shared header hierarchy)

Two-layer header model:

- **`PageHeader`** (`src/components/PageHeader.tsx`) — base layout primitive.
  Defines the row: optional back button · title · `rightContent` (a single
  flush-right ReactNode slot). Has **no opinion** about what goes in the
  rightmost slot.
- **`MobileDemoHeader`** (`src/components/MobileDemoHeader.tsx`) — hamburger
  parent. Composes `PageHeader` and pins `MobileNavDrawer` into the rightmost
  slot. Exposes an `extraActions` prop for page-specific buttons (e.g. the
  undo button on Discover) that render **to the left** of the hamburger.

Rules of thumb:

- Footer-tab surfaces (Decks, Discover, Games, Account) → use
  `MobileDemoHeader`. The hamburger is included for free; pages just pass
  `title` and optional `extraActions`. Do **not** wire `MobileNavDrawer`
  into pages by hand.
- Specialty headers (`FlashcardsLearnHeader` with fire icon + seconds counter,
  `VocabCardDetailPage` with just back+title) → compose `PageHeader`
  directly and own their own `rightContent`. They opt out of the hamburger by
  not using `MobileDemoHeader`.

## Games framework

The hub no longer hardcodes its menu — it reads from a registry that also
drives the router and the mobile-demo allowlist. The framework has three
frontend layers and a thin backend.

### Layer 1 — Registry (`src/games/registry.ts`)

```ts
export const GAME_REGISTRY: GameDef[] = [];
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
  `MOBILE_DEMO_PATHS` so every game gets the phone frame + hamburger
  automatically.

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
  activePage="games">`. Most games render `<GamePage game={gameDef}>{stage}</GamePage>`.

- **`useGameActors.ts`** — generalized version of the night market's
  `usePixiPedestrians` handle. Generic over the game's actor type; returns
  `{ tick, getDrawables, getActors, setActors, setSpeedMultiplier }`. Games
  can ignore this and roll their own simulation if they prefer.

### Layer 3 — Data hooks (`src/games/hooks/`)

All reuse `src/utils/apiClient.ts` (cookie-auth axios instance).

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

- `src/components/MobileFooter.tsx` — added Games tab
- `src/components/MobileDemoFrame.tsx` — shared phone-frame container
- `src/components/MobileDemoHeader.tsx` — hamburger-parent header for footer-tab pages
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
