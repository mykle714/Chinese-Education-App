# Night Market Template Runtime — Implementation Plan

> **Working doc.** This is the live build tracker for the **template *runtime*** — the
> code that consumes authored templates (DB catalog) and produces the rendered market +
> graphs. Update the [Status tracker](#status-tracker) as slices land. The *design* it
> implements is [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md); the *authoring*
> side (editor) is [NIGHT_MARKET_TEMPLATE_EDITOR.md](./NIGHT_MARKET_TEMPLATE_EDITOR.md).
>
> **Status: NOT STARTED** (design locked, no runtime code written yet).

## What we are building

A **pre-stage** that turns the user's persisted template layout into `Street[]` +
`TileDef[]`, then feeds the **existing, unchanged** graph builders. The authoring side
already exists (validators paint templates → `nightmarkettemplatedefinitions`,
migrations 107–109). The runtime is what reads that catalog at load and renders it.

### The load-bearing insight

`buildStreetGraph(streets: Street[], tiles: TileDef[])`
(`src/engine/market/streetGraph.ts:452`) and
`buildTileGraph(tiles, stands)` (`src/engine/market/tileGraph.ts:65`) **already exist
and do not change.**

**The template cells *are* the tiles.** Each street/communal cell in a stitched template
becomes a `TileDef` directly — we do **not** expand streets into tiles (the legacy
`buildTilesFromStreets` authoring path is *not* used and stays private/unused). Street
recovery goes the **other** direction: it reads the template's street tiles and derives
the `Street[]` rectangles that `buildStreetGraph` needs for its node/edge structure,
**stamping `intersectingStreets` onto those same tiles** as it goes (a cell covered by
rectangles of two orientations is an intersection).

So the runtime is: **stitch placements → tiles = template cells; recover `Street[]` from
the street tiles (stamping ownership) → feed the existing graph builders → render.**

### Locked design decisions (see NIGHT_MARKET_TEMPLATES.md status block)

1. **Catalog is read DB-direct** — no promote-to-code registry. Edge signatures /
   `anchorIndex` / placeholder areas derived **at load**.
2. **Versions are full walkability snapshots** — runtime picks one active version per
   placed template via a pluggable `selectVersion` seam (**random stub** now; real rule
   keyed on placement + filled placeholders is future work).
3. **Placeholder areas = connected-component islands of the placeholder mask** (v0-shared,
   so occupant slots are fixed per template name).

### Slice-1 build decisions (confirmed)

- **Hub template is identified by a code name-constant** —
  `NIGHT_MARKET_HUB_TEMPLATE_NAME = 'night-market-hub'` (no `isHub` column). The template
  with this exact name **must be authored in the editor** (it does not exist yet); slice 1
  loads it by name. A hub `isHub` flag can come later if needed.
- **Coordinate mapping is a straight translation, no flip:** `isoX = offsetCol + col`,
  `isoY = offsetRow + row` (col→east→+isoX, row→south→+isoY, `TILE_SIZE = 1`).
- **Communal cells go into the tile graph.** The tile graph is *all* walkable tiles —
  street tiles **and** communal tiles both become walkable `TileDef`s.
- **Slice 1 is terrain-only.** No street recovery, no graphs, no pedestrians in slice 1 —
  those move to the pedestrian slice (see [Slice ordering](#slice-ordering)).

---

## New modules & functions, by layer

### 🟦 Engine layer — `src/engine/market/` (pure; no React, no DB)

#### `templateStitch.ts` — placement → one global cell world
```ts
interface PlacedTemplate {            // one row of the user's layout
  name: string;
  activeVersion: number;
  offsetCol: number; offsetRow: number;
  def: TemplateDefinitionPayload;     // the loaded version's cells (from templateEditorApi type)
}
interface PlacedPlaceholder { templateName: string; area: PlaceholderArea; }  // island in GLOBAL coords
interface StitchedWorld {             // global cell sets, keyed "isoX,isoY"
  street: Set<string>;
  communal: Set<string>;
  lightGrass: Set<string>; darkGrass: Set<string>;
  houses: Set<string>;
  decor: Map<string, string>;         // cell → sprite stem
  placeholders: PlacedPlaceholder[];
}
function localToGlobal(p: PlacedTemplate, cellKey: string): string;  // pure translation, col→isoX row→isoY
function stitchWorld(placed: PlacedTemplate[]): StitchedWorld;
```
Depends on: `TemplateDefinitionPayload` (`src/features/nightmarket/templateEditorApi.ts:12`).
Coordinate mapping mirrors [NIGHT_MARKET_TEMPLATES.md § Local coordinate system].

#### `streetRecovery.ts` — greedy maximal-rectangle cover (⏭ slice 2)
```ts
interface RecoveredStreets {
  streets: Street[];
  ownership: Map<string, Street[]>;   // tileKey → recovered streets covering it (≥2 ⇒ intersection)
}
function recoverStreets(streetCells: Set<string>): RecoveredStreets;   // tiles → rectangles + ownership
// internal: growMaximalRect(seed, uncovered) → {isNorthSouth,start,end,offset,width}
//           asserts width ∈ [1,8] (NIGHT_MARKET_GRAPH_ASSUMPTIONS S3); throws loudly otherwise
```
Implements [NIGHT_MARKET_TEMPLATES.md § Street recovery]. `Street`
(`nightMarketRegistry.ts:122`). The caller (`marketWorld.ts`) turns **each template
street cell into a `TileDef`** and stamps its `intersectingStreets` from `ownership`;
**communal cells** become extra walkable `TileDef`s with no `street`/`intersectingStreets`.
No streets→tiles expansion happens.

#### `placeholderIslands.ts` — connected-component labeling (⏭ slice 2)
```ts
interface CellRect { minCol: number; minRow: number; maxCol: number; maxRow: number; }
interface PlaceholderArea { id: string; cells: Set<string>; bbox: CellRect; }
function computePlaceholderAreas(placeholder: Set<string>): PlaceholderArea[];  // 4-connectivity flood fill
```
`id` is derived deterministically from the island's cells (e.g. its min cell) so it is
stable across versions/loads. Implements [NIGHT_MARKET_TEMPLATES.md § Placeholder areas].

#### `versionSelector.ts` — pluggable version seam
```ts
interface VersionSelectContext { name: string; offsetCol: number; offsetRow: number; /* future: neighbors, filledPlaceholderIds */ }
type VersionSelector = (availableVersions: number[], ctx: VersionSelectContext) => number;
const randomVersionSelector: VersionSelector;   // slice-1 stub; stable per placement (persisted), not per render
function selectVersion(availableVersions: number[], ctx: VersionSelectContext, sel?: VersionSelector): number;
```
Implements [NIGHT_MARKET_TEMPLATES.md § Template versions]. The **real** selector
(future) replaces only `randomVersionSelector`'s body; must satisfy the decay-safety
constraint (never drop a street a live neighbor leans on).

#### `marketWorld.ts` — the graph assembler (⏭ slice 2; replaces the static `tileRegistry` graphs)
```ts
interface MarketWorld {
  streets: Street[]; tiles: TileDef[];
  tileGraph: TileGraph;               // from existing buildTileGraph
  streetGraph: StreetGraph;           // from existing buildStreetGraph
  terrain: StitchedWorld;             // grass/decor/houses for render layers
  placeholderAreas: PlacedPlaceholder[];
}
function buildMarketWorld(placed: PlacedTemplate[], stands: NightMarketAssetDef[]): MarketWorld;
```
Pipeline inside: `stitchWorld` → build `TileDef[]` directly from the stitched
street+communal cells → `recoverStreets` on the street cells → stamp each street tile's
`intersectingStreets` from `ownership` → `buildTileGraph` + `buildStreetGraph`. Feeds
[NIGHT_MARKET_TEMPLATES.md § Feeding TILE_GRAPH / STREET_GRAPH]. The legacy
`buildTilesFromStreets` (`tileRegistry.ts:60`) is **not** used.

### 🟩 Backend layer — `server/`

**Slice 1: no new backend code.** The client fetches the hub directly via the existing
`loadTemplate(NIGHT_MARKET_HUB_TEMPLATE_NAME, version)` endpoint
(`templateEditorApi.ts:112`), which already returns the full definition +
`availableVersions`.

**Slice 3+ (needs the `nightmarkettemplates` table — ⚠️ confirm before migration):**
- `getStarterTemplate(): Promise<LoadedTemplate>` convenience on `NightMarketTemplateService`.
- `NightMarketPlacementService` — `placeUnlock(userId)`, `spawnTemplate(userId)`,
  `isPlacementLegal(a, b)`, anchor-driven algorithm + `template-match-not-found` logging
  ([NIGHT_MARKET_TEMPLATES.md § How a new template attaches]).
- `NightMarketWorldService.getUserLayout(userId): PlacedTemplate[]` — reads placement
  rows, loads each referenced definition, runs `selectVersion`, returns `PlacedTemplate[]`.
- Placement DAL additions on the template-definitions store.

### 🟨 Feature / render layer — `src/features/nightmarket/`

#### `useMarketWorld.ts` — hook
```ts
// slice 1 — terrain only:
function useMarketWorld(): { terrain: StitchedWorld | null; loading: boolean };
//   fetch the hub template (NIGHT_MARKET_HUB_TEMPLATE_NAME) at offset (0,0),
//   pick a version via selectVersion, stitchWorld → StitchedWorld
// slice 2+ — extended to return the full MarketWorld (adds tile/street graphs)
//   and, later, the user's real multi-template layout
```
⚠️ **Memoize on layout identity, NOT on `token`** (per CLAUDE.md token-refresh rule);
build fetch headers with `authHeader()`.

#### `TemplateTerrainLayer.tsx` — runtime terrain render
Renders `world.terrain` (grass/street autotiles, decor, houses). Generalizes the
existing `EditorTerrainLayer.tsx` (which already autotiles the same mask shape). In
`MarketEngineViewer.tsx`, swap the static `buildFarmField` call
(`MarketEngineViewer.tsx:143`) for `useMarketWorld`.

---

## Slice ordering

| Slice | Delivers | New modules |
|---|---|---|
| **1** | one authored hub template → rendered pan/zoom **terrain** (no graph, no peds) | `templateStitch` (stitch → terrain), `versionSelector`, `useMarketWorld` (terrain), `TemplateTerrainLayer` |
| **2** | graph + pedestrians (street recovery → tile/street graphs → peds walk) | `streetRecovery`, `placeholderIslands`, `marketWorld` (graph assembler), `useMarketWorld` extended, ped wiring (`pedestrianAgent.ts` already consumes `StreetGraph`) |
| **3** | placement + persistence (needs `nightmarkettemplates` table ⚠️) | `NightMarketPlacementService`, `NightMarketWorldService`, placement DAL |
| **4** | unlock economy (minutes→unlocks schedule, grant flow, decay cron branch) | schedule constant; `expire-stale-streaks.sql` unlock-removal branch |

Slice 1 needs **no new tables** — reads `nightmarkettemplatedefinitions` DB-direct — and
builds **no graphs**: `useMarketWorld` calls `stitchWorld` and hands the `StitchedWorld`
terrain straight to `TemplateTerrainLayer`. `streetRecovery` + `marketWorld` graph
assembly arrive in slice 2.

---

## Sample user flow (end state, all slices live)

1. **New user, 0 minutes.** Server has one placement row: the **hub at origin**
   (`placeOrder 0`). `getUserLayout` loads its definition, `randomVersionSelector` picks
   a version → one `PlacedTemplate`.
2. **Render.** `useMarketWorld` → `buildMarketWorld([hub])`: `stitchWorld` lifts cells to
   global coords → `recoverStreets` → tiles + graphs → `TemplateTerrainLayer` paints; peds
   wander. User sees a small plaza with empty stand slots (unoccupied placeholder islands).
3. **Study 1 min → 1 unlock.** `placeUnlock` finds a free island in the hub, drops a stand
   occupant (recorded on `nightmarketunlocks` with `placedTemplateId` + `placeholderAreaId`).
   The hub may re-select `activeVersion` (an access street opens). Next render recomputes the
   graph; peds route to the new stand.
4. **Hub fills up → spawn.** With no free island, the next unlock triggers `spawnTemplate`:
   enumerate exposed street anchors, pick closest to origin, look up matching-width catalog
   templates via load-time `anchorIndex`, score by street-runs joined, maximin-spread + random
   tiebreak, persist the new placement. The market grows a new block, streets continuous
   across the seam.
5. **Inactivity → decay.** Hourly cron debits minutes, deletes random `nightmarketunlocks`
   down to `target = unlocks(m)`. Freed islands return to the pool. **Templates never
   disappear** — an emptied block renders its unoccupied version. The version selector must
   not sever a street a live neighbor leans on.

---

## Open decisions / gates

- ⚠️ **Slice 2 table `nightmarkettemplates`** (+ `placedTemplateId`/`placeholderAreaId` on
  `nightmarketunlocks`) — proposed in [NIGHT_MARKET_TEMPLATES.md § Storage]; **must be
  confirmed before any migration.**
- **Version-selection rule** — random stub for now; real rule is the #1 open question in
  [NIGHT_MARKET_TEMPLATES.md § Open questions] (with the decay-safety constraint).
- **Tileset scheme** for cross-seam autotiling — open question #2 there.

---

## Status tracker

Update this table as work lands (✅ done / 🚧 in progress / ⬜ not started).

| Item | Slice | Status | Notes |
|---|---|---|---|
| Author `night-market-hub` template in the editor | 1 | ⬜ | ⚠️ user action — slice 1 has nothing to render without it |
| `NIGHT_MARKET_HUB_TEMPLATE_NAME` constant | 1 | ⬜ | `'night-market-hub'` |
| `templateStitch.ts` (stitch → terrain) | 1 | ⬜ | |
| `versionSelector.ts` (random stub) | 1 | ⬜ | seam only |
| `useMarketWorld.ts` (terrain) | 1 | ⬜ | memoize on layout, not token |
| `TemplateTerrainLayer.tsx` + `MarketEngineViewer` swap | 1 | ⬜ | generalize `EditorTerrainLayer` |
| `streetRecovery.ts` | 2 | ⬜ | tiles→streets + ownership; width ∈ [1,8] assertion |
| `placeholderIslands.ts` | 2 | ⬜ | 4-connectivity flood fill |
| `marketWorld.ts` (graph assembler) | 2 | ⬜ | tile graph = street + communal tiles |
| `useMarketWorld` extended → full `MarketWorld` | 2 | ⬜ | adds graphs |
| Pedestrian wiring on recovered graph | 2 | ⬜ | wiring only |
| `nightmarkettemplates` table (confirm → migration) | 3 | ⬜ | ⚠️ gate |
| `NightMarketPlacementService` | 3 | ⬜ | anchor algorithm |
| `NightMarketWorldService.getUserLayout` + `getStarterTemplate()` | 3 | ⬜ | server-side layout read |
| Unlock schedule constant + grant flow | 4 | ⬜ | |
| Decay cron unlock-removal branch | 4 | ⬜ | `expire-stale-streaks.sql` |

---

## Dependency references

Code this plan drives / depends on:
- `src/engine/market/streetGraph.ts` (`buildStreetGraph`) — unchanged; consumes recovered `Street[]`.
- `src/engine/market/tileGraph.ts` (`buildTileGraph`, `standFootprintTiles`) — unchanged.
- `src/engine/market/tileRegistry.ts` — legacy authoring path; `buildTilesFromStreets` **not** used by the runtime.
- `src/engine/market/nightMarketRegistry.ts` — `Street`, `TileDef`, `TileCoord`, `NightMarketAssetDef` types.
- `src/engine/market/isometric.ts` — `(col,row)`→screen mapping at render.
- `src/features/nightmarket/templateEditorApi.ts` — `TemplateDefinitionPayload`, `LoadedTemplate`, load endpoints.
- `src/features/nightmarket/MarketEngineViewer.tsx` — render host; swaps static `buildFarmField` for `useMarketWorld`.
- `src/features/nightmarket/EditorTerrainLayer.tsx` — basis to generalize into `TemplateTerrainLayer`.
- `server/services/NightMarketTemplateService.ts` — catalog reads (`getTemplate`, new `getStarterTemplate`).

Related docs: [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md) (design),
[NIGHT_MARKET_TEMPLATE_EDITOR.md](./NIGHT_MARKET_TEMPLATE_EDITOR.md) (authoring),
[NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md) (invariants),
[NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md),
[PEDESTRIAN_WALKING_ALGORITHM.md](./PEDESTRIAN_WALKING_ALGORITHM.md).
