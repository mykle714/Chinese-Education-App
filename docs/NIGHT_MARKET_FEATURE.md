# Night Market Feature

## Overview

The Night Market is a visual reward system tied to work points. As users study and accumulate work points (1 point = 1 minute of active study), they unlock items that populate a personal night market scene. Each user's market is unique because unlocks are randomly selected from a pool and persisted for the life of the account.

> **Layout authoring:** the map itself is assembled from prebuilt rectangular
> templates tiled together — see [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md)
> (DESIGN stage).

---

## Coordinate System

When coordinates are given for night market assets, they are always in **isometric
grid units (isoX, isoY)**. See `src/engine/market/isometric.ts` for the full definition.

- **isoX** — distance along the isometric X axis (toward top-right on screen / east)
- **isoY** — distance along the isometric Y axis (toward top-left on screen / north)
- **Origin (0, 0)** — maps to the center of the viewport

The projection is **2:1 dimetric** ("pixel-art isometric"): `TILE_WIDTH = 32`,
`TILE_HEIGHT = TILE_WIDTH / 2 = 16`. This replaced the earlier √3:1 true-iso grid
when the market adopted the free-farm tileset (see *Terrain rendering* below).

All night market assets live at `/home/cow/src/assets/` (NOT `public/assets/` — Vite
imports these directly as modules).

---

## Terrain rendering (free-farm rebuild)

The night market was rebuilt on the **free-farm-assets** 2:1 tileset. The former demo
layout — `floor.png`, hand-authored streets, 8×8 stalls, and walking pedestrians — was
**removed**, along with its three demo-layout tests
(`__tests__/{tileRegistry,graphAssumptions,streetGraph}.test.ts`). The visible ground is
now a raised **dirt** plateau carrying two stacked, contiguous, irregular grass patches: a
**light-grass** patch in the middle and a smaller **dark-grass** patch grown *entirely
inside* the light one, so dark grass always sits over light grass (never over bare dirt).

**Pipeline (layers):**
- `engine/market/freeFarmTileset.ts` (lookup) — resolves sprite URLs. Two autotile ops:
  - `pickLandmassEdge()` maps 4-cardinal in-field occupancy → a `LandmassEdge` variant
    (center / N/E edges / four convex `*Round` corners) for the tallDirt plateau **rim**.
    Only the far N (+isoY) and E (+isoX) faces are authored; near S/W faces are never visible.
  - `pickGrassBorderOverlays(kind, neighbours)` — the **grass-boundary** op: given a dirt
    tile's 8-neighbour grass occupancy, returns the overlay sprite URLs to STACK on it so
    grass from adjacent patch cells spills onto the tile. Scheme = **edge-centric + convex
    dots**: one full-edge overlay per grass cardinal (`nw,n,ne` / `ne,e,se` / `sw,s,se` /
    `nw,w,sw`); two adjacent grass cardinals overlap at their shared vertex, filling a
    concave corner seamlessly; plus a single-corner dot (`ne`/`nw`/`se`/`sw`) for an
    isolated diagonal touch (both flanks dirt). Interior dirt → empty.
- `engine/market/farmTerrain.ts` (data) — `buildFarmField(w, h, seed)` enumerates a w×h dirt
  field and grows the two patches with the shared seeded-mulberry32 frontier grower
  (`growGrassBlob`, gated by an `allowed(x,y)` predicate + notch-close):
  - `buildGrassPatch` — the **light** patch, gated to stay `PATCH_MARGIN` tiles inside the
    rim, ~`GRASS_COVERAGE` fill (0.3), seed `DEFAULT_SEED`. After growth it runs a directional
    dilation (`dilateNorthWest`, `NORTHWEST_DILATION` passes) that fattens only the **north
    (+isoY)** and **west (−isoX)** faces a little, leaving the south/east shape put.
  - `buildDarkGrassPatch` — the **dark** patch, gated to *light-patch membership* (so
    dark ⊆ light), ~`DARK_GRASS_COVERAGE` fill (0.12), distinct seed `DARK_SEED`.
  Per tile it resolves `kind` (light grass/dirt), `darkGrass` (bool), `fieldEdge` (rim),
  and `grassNeighbours` + `darkGrassNeighbours` (8-dir occupancy of each patch). Currently 20×20.
- `features/nightmarket/FarmTerrainLayer.tsx` (view) — paints each tile as up to several **native**
  (scale 1) sprites, emitted **flat** (no per-tile container) so the scene's
  `sortableChildren` z-sorts every sprite globally by `zIndex`:
  - a **tallDirt slab** (`fieldEdge`) at `screenY + TILE_HEIGHT`, `z = layerZ − 0.5`
  - **light surface** — grass tile → a `lightGrass_center` **cap** at `z = layerZ`; dirt tile
    bordering light grass → the stacked light **grass-boundary overlays** at `z = layerZ`
    (interior dirt draws nothing on the surface — its own dirt top face shows)
  - **dark surface**, stacked just above the light layer at `z = layerZ + 0.05` (dark over
    light) — dark tile → a `darkGrass_center` cap; light/dirt tile bordering the dark patch →
    the stacked dark grass-boundary overlays (`resolveTileDarkSurfaceUrls`)
  - an optional **scatter decor** sprite at `screenY`, chosen by `resolveTileDecorUrl` — see
    *Decor scatter* below. Its z depends on family: **dirt-family decor** (`dirtDecor_*`,
    `isDirtDecorUrl`) sits BELOW the grass surfaces at `z = layerZ − 0.1` (above the dirt slab,
    below the light cap) so a grass-boundary overlay spilling onto the tile reads as grass
    growing over the ground detail; every other family sits at `z = layerZ + 0.1` (still in the
    background slot, below any entity)

**Elevation offset:** the pack's grass surface sits in the lower half of its 32×32 cell
(rows y[16..31]) while the tallDirt top face sits in the upper half (rows y[0..15]) — the
dirt surface is exactly one `TILE_HEIGHT` higher. Drawing the dirt one `TILE_HEIGHT` lower
makes its top face coincide with the surface and drops its 16px wall below to form the
visible slab rim. **Single elevation:** grass sits FLUSH on the dirt surface (no height
step), so the grass↔dirt transition is drawn purely by the flat boundary overlays.

**Pixel-art rendering:** terrain textures use nearest-neighbour filtering; the camera
zoom is clamped to **integers** (`MarketEngineViewer`, default 3), so upscaling stays
crisp with no fractional resampling. The Pixi `<Application>` sets `antialias={false}`.

### Zoom-out floor scales with the world

*Code: `src/engine/market/cameraFit.ts` (whole file); `MarketEngineViewer.tsx`
(`CRISP_FLOOR`/`SUB_FLOOR_ZOOM_FACTOR`, `applyZoomAtPoint`, `handleWheel`,
`SceneProps.onFootprintsChange`); `TemplateSandboxViewer.tsx` (same three, integer ladder). Tests:
`src/__tests__/cameraFit.test.ts`.*

The camera's zoom-out limit is **derived from world size**, not fixed. `computeMinZoom(footprints,
viewportW, viewportH, crispFloor)` takes every placement's board rectangle, projects it through
`isoToScreen` to a screen-space bbox (plus a half-tile margin and 96px of headroom for tall decor
— houses/trees/dirt slabs), and returns the zoom at which that bbox fills 90% of the viewport,
clamped to `[ABSOLUTE_MIN_ZOOM = 0.05, crispFloor]`. Because the result never exceeds `crispFloor`
(nmp `0.5`, nms `1`), **small worlds behave exactly as before**; a continent that has tiled out far
enough to no longer fit may keep pulling back.

Zoom stays on the crisp ladder (nmp half-steps, nms integers) at/above `crispFloor`. **Below** it
the value is **continuous** — the ladder has no rungs left there — and the wheel steps
multiplicatively by `0.8` per notch, so passing under the floor is gradual rather than a single
jump to the fitted minimum. Art below the crisp floor is fractionally resampled (blurrier); that is
the deliberate trade for seeing a large market whole.

The floor is recomputed **lazily at gesture time** from the live element size (refs, no resize
listener or state), so window resizes and placement edits are picked up without re-render churn.
nmp fetches its layout inside `NightMarketScene` but owns zoom in the outer component, so the scene
reports its `placements` upward via `onFootprintsChange`; nms already has `items` in the camera
host and needs no plumbing.

**Debug overlays (nmp):** the page's right-edge toggle column (`NightMarketEnginePage.tsx`)
drives per-overlay `DebugFlags` on `MarketEngineViewer`, all rendered inside the scene
container so they pan/zoom with the terrain:
- **origin** — cyan iso-axis crosshair at grid (0,0).
- **grass** — semi-transparent diamond tint over every grass tile (`GrassOverlay`): a light
  green pass over `kind === 'grass'` tiles, then a darker green pass over `darkGrass` tiles on
  top (mirroring the terrain's dark-over-light stacking). Rebuilds the same field via
  `buildFarmField` so the tinted diamonds line up with the grass caps.
- **overlayLabels** — tiny per-cell text naming the SURFACE sprite stem(s) each tile was
  painted with across BOTH layers (`OverlayLabels`), resolved from the shared
  `resolveTileSurfaceUrls` + `resolveTileDarkSurfaceUrls` (farmTerrain.ts) and reverse-mapped
  url→stem via `freeFarmTileset.stemOf`. Light caps show `grass`, dark caps show `dark`;
  boundary overlays show their compass-set (e.g. `n,nw,ne`), dark ones prefixed `d:`; interior
  dirt is unlabeled. `showGrid` (gridlines) is separate page state, not a DebugFlag.
- **templateBounds** — amber iso-diamond outline of every PLACED template's board rectangle
  (`offset..offset+size`, in cells) with `name\nvN` floated over the center (`TemplateBoundsOverlay`).
  Reads the placement bounds surfaced by `useMarketWorld` as `placements: TemplateBounds[]` (a slim
  name/version/offset/size projection of the layout), so it tracks the real stitched render — unlike
  the grass/overlayLabels overlays which still visualize the stale procedural `buildFarmField`.
- **placeholderBounds** — iso-diamond outline of every PLACEHOLDER occupant slot
  (`world.placeholderAreas`, global cells) with a `templateName\ncol_row ●/○` label
  (`PlaceholderBoundsOverlay`). Filled slots outline cyan, empty slots magenta (two stroke passes);
  `●`/`○` and the slot id (`placeholderAreaId`) echo the same `filled` flag the `PlaceholderHouseLayer`
  draws occupants from.

Both bounds overlays share `traceIsoRect` (diamond outline of a cell rectangle) and `isoRectCenter`
(screen center for the label) in `MarketEngineViewer.tsx`.

The surface-sprite selection (grass cap vs. stacked grass-boundary overlays) lives once per
layer in `resolveTileSurfaceUrls` / `resolveTileDarkSurfaceUrls` (farmTerrain.ts), each
consumed by both `FarmTerrainLayer` (paints) and `OverlayLabels` (labels) so they never diverge.

**Decor scatter:** after each tile's surface is resolved, `FarmTerrainLayer.buildDraws`
runs a seeded decor pass (`resolveTileDecorUrl` in farmTerrain.ts, walking the field with a
single `createDecorRng()` so the layout is stable across reloads). Per tile:
- Tiles that carry **grass-boundary overlays** on *either* layer are **skipped** (their diamond
  is already visually busy — a dirt tile bordering light grass, or a light/dirt tile bordering
  the dark patch); tiles with only a flush base cap (light or dark `_center`) stay eligible.
- Each eligible tile makes **two mutually-exclusive rolls, own-family first**: it rolls for
  **own-family** decor at `FAMILY_DECOR_PROBABILITY` (0.15) and, only if that misses, rolls for
  the shared **common** set at `COMMON_DECOR_PROBABILITY` (0.05). At most one decor per tile
  (~15% family, ~4% common).
- Own-family = dark grass → `darkGrassDecor_*` (dark wins on its tiles), light grass →
  `lightGrassDecor_*`, interior dirt → `dirtDecor_*`; common = `decor_*` (Objects/). Families
  are indexed in `freeFarmTileset` (`getDecorUrls(family)`).

Decor is drawn on top of the surface at `z = layerZ + 0.1` (a background-slot floor detail,
below the entity slot at +0.25).

**Walkways (plank paths):** a straight run of wooden **plank** tiles laid on the terrain plane.
- `engine/market/freeFarmTileset.ts` — indexes the `plank_{dir}_{1..3}_{center|eastEdge|northEdge}`
  slabs (32×32, a top-face diamond + a wooden side, same footprint as a tallDirt slab). Resolved
  via the typed `getPlank(direction, variation, cap)`. `direction` ∈ {`ew`,`ns`}; the pack authors
  3 board-pattern variations per direction and an end cap only on each direction's **far** iso face
  (`eastEdge` for `ew`/+isoX, `northEdge` for `ns`/+isoY) — mirroring the landmass far-face rule.
- `engine/market/walkway.ts` (data) — `buildWalkway({origin, direction, variations?})` lays tiles
  from the near-end `origin` toward the far face: `ew` runs along +isoX at constant isoY, `ns` along
  +isoY at constant isoX. Successive tiles take the successive `variations` board patterns (default
  `PLANK_VARIATIONS` = 1,2,3, one of each in order); the **far-end** tile takes the direction's edge
  cap, every other tile the flat `center` plank.
- `features/nightmarket/WalkwayLayer.tsx` (view) — paints each plank flush on the shared terrain
  plane (offset `+TILE_HEIGHT`, exactly like a dirt slab, so its surface lands on the plane). The
  whole walkway is lifted above the terrain layer by `WALKWAY_Z_LIFT = FIELD_WIDTH + FIELD_HEIGHT`
  (the max iso-sum) so the back-most plank still clears the front-most terrain tile's slab, while
  `computeLayerZ` keeps planks ordered among themselves. Currently renders a hard-coded
  `SAMPLE_WALKWAYS` list (one `ew` + one `ns`); replace with an authored/data-driven layout later.

**Dormant modules:** the pedestrian/street-graph engine
(`streetGraph.ts`, `tileGraph.ts`, `pedestrianAgent.ts`, `tileTraversal.ts`,
`hooks/usePixiPedestrians.ts`) remains in the tree but is unused — `tileRegistry.ts`
exposes empty `STREETS`/`TILES`/`DEMO_STALLS`, so both graphs are empty. It is the seam
where a future authored layout re-attaches.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend                                   │
│                                                                   │
│  MarketViewerPage ──▶ useNightMarket() ──▶ GET/POST /api/...    │
│       │                     │                                     │
│       ▼                     ▼                                     │
│  MarketViewer       nightMarketRegistry                          │
│  (canvas render)    (asset definitions)                          │
└──────────────────────────────┬────────────────────────────────────┘
                               │
┌──────────────────────────────▼────────────────────────────────────┐
│                        Backend                                     │
│                                                                   │
│  NightMarketController                                           │
│       │                                                           │
│       ▼                                                           │
│  NightMarketService  ──▶  nightMarketRegistry (asset pool)       │
│       │                                                           │
│       ▼                                                           │
│  NightMarketDAL  ──▶  nightmarketunlocks table                   │
│       │                                                           │
│       ▼                                                           │
│  UserDAL.getTotalWorkPoints()  (threshold verification)          │
└───────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### `nightmarketunlocks` Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique identifier |
| userId | UUID | NOT NULL, FK → users(id) ON DELETE CASCADE | Owner of the unlock |
| assetId | VARCHAR(100) | NOT NULL | Key into the asset registry |
| unlockType | VARCHAR(20) | NOT NULL, DEFAULT 'stall' | Type of unlock (stall, person, etc.) |
| unlockOrder | INTEGER | NOT NULL, DEFAULT 0 | 0 = base set, 1+ = earned unlocks |
| createdAt | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | When the unlock was granted |

**Indexes:**
- `UNIQUE (userId, assetId)` — prevents duplicate unlocks
- `(userId, unlockOrder)` — fast ordered retrieval per user

---

## Asset Registry

All unlockable items are defined in TypeScript config files (not in the database). This keeps asset management in code alongside the image files.

**Asset files live at:** `src/assets/` (imported as Vite modules, not served from `public/`)

**Location:**
- Server: `server/config/nightMarketRegistry.ts`
- Frontend: `src/engine/market/nightMarketRegistry.ts`

**Exports:**
- `NIGHT_MARKET_BASE_SET` — items every user receives automatically (unlockOrder = 0)
- `NIGHT_MARKET_UNLOCK_POOL` — items available for random unlock as users earn points
- `NIGHT_MARKET_CONFIG` — constants (e.g., `POINTS_PER_UNLOCK = 60`)

Each asset definition includes: `assetId`, `unlockType`, `displayName`, `description`, `imagePath`, `x`, `y`, `zIndex`, `scale`.

---

## Unlock Flow

### Threshold Calculation
- 1 unlock per 60 accumulated work points
- Allowed unlocks = `floor(totalWorkPoints / 60)`
- Base set items (unlockOrder = 0) do not count toward the earned unlock limit

### Sequence
1. Frontend detects `accumulativeWorkPoints >= nextThreshold` via `useNightMarket()` hook
2. User triggers unlock (e.g., taps an unlock button)
3. Frontend calls `POST /api/night-market/unlock`
4. Server verifies `totalWorkPoints` against `earnedUnlockCount * POINTS_PER_UNLOCK`
5. Server filters the unlock pool to exclude already-owned assets
6. Server picks a random item from the remaining pool
7. Server persists the selection in `nightmarketunlocks` with `unlockOrder = earnedCount + 1`
8. Server returns the new unlock to the frontend
9. Frontend adds the new item to the scene

### Base Set Seeding
On the first call to `GET /api/night-market/unlocks`, if the user has no unlock records, the service bulk-inserts all `NIGHT_MARKET_BASE_SET` items with `unlockOrder = 0`.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/night-market/unlocks` | Get all unlocked items for the authenticated user. Seeds base set on first call. |
| POST | `/api/night-market/unlock` | Unlock the next random item. Returns 400 if insufficient points or pool exhausted. |

---

## Interaction (V1)

- **Tap to see info**: Tapping an item shows its `displayName` and `description` in a dialog
- **Tap to trigger event**: Reserved for future expansion (animations, sounds, etc.)

---

## Unlock Types

| Type | V1 | Description |
|------|-----|-------------|
| stall | Yes | Market stalls/stands |
| person | Yes | Characters/people |
| animal | Future | Animals |
| plant | Future | Plants/trees |
| road | Future | Road/path segments |
| item | Future | Decorative items |

---

## Files

| File | Role |
|------|------|
| `server/types/nightMarket.ts` | TypeScript interfaces for unlocks and API responses |
| `server/config/nightMarketRegistry.ts` | Server-side asset registry (base set + unlock pool) |
| `src/engine/market/nightMarketRegistry.ts` | Frontend asset registry (same data) |
| `database/migrations/47-create-night-market-unlocks.sql` | Table creation migration |
| `server/dal/interfaces/INightMarketDAL.ts` | DAL interface |
| `server/dal/implementations/NightMarketDAL.ts` | DAL implementation |
| `server/services/NightMarketService.ts` | Business logic (unlock verification, random selection, base set seeding) |
| `server/controllers/NightMarketController.ts` | HTTP request/response handling |
| `src/features/nightmarket/useNightMarket.ts` | Frontend hook for fetching unlocks and triggering new unlocks |
| `src/features/nightmarket/NightMarketEnginePage.tsx` | Page component — builds layers from unlocks + registry, hosts debug toggles |
| `src/features/nightmarket/MarketEngineViewer.tsx` | Pixi (`@pixi/react`) canvas renderer with pan/zoom and tap interaction |

## Known Bugs

### Pan/tap dead after StrictMode + async Pixi init (FIXED)

**Where:** `src/features/nightmarket/MarketEngineViewer.tsx` `NightMarketScene`, the stage-pointer `useEffect`.

**Symptom:** Drag-to-pan and tap-to-select produced *no response* — the canvas rendered fine but the live `app.stage` stayed at default `eventMode: 'passive'` with no `hitArea` and zero pointer listeners, so every pointer event died before dispatch.

**Cause:** `useApplication()` returns a **stable `app` object**, but Pixi v8's `app.init()` (which creates `app.renderer`) is **async**. The pointer effect guards on `!app.renderer` and bailed on the first pass; keyed only on `[app]`, it never re-ran once init completed (the `app` identity never changes), so the stage was left inert.

**Fix:** Depend on `isInitialised` from `useApplication()` — `useEffect(..., [app, isInitialised])` — so the effect re-runs and attaches the handlers once the renderer exists. Any future effect that touches `app.renderer`/`app.stage` must gate on `isInitialised`, not just `app`.

### Ped z-sort against stands at extreme zoom-out (zoom-aware fallback)

**Where:** `src/features/nightmarket/MarketEngineViewer.tsx` strip-emission path, `src/engine/market/isometric.ts` `computeStripPlacements`.

**Symptom:** When the camera is zoomed far enough that each sprite strip would be under ~8 screen px wide, the renderer falls back to emitting a stand as a single unsliced sprite (instead of 2F strips) to keep the per-frame sprite count bounded. In that mode, the painter's-algorithm foot anchor is the stand's SW corner, so a pedestrian whose `isoX + isoY` exceeds the stand's SW sum renders in front of the entire roof — even when the ped is geometrically *beside* the stand rather than in front of it. Slicing fixes this at normal zoom; the fallback re-exposes the pre-fix behavior.

**Future fix:** Switch the unsliced fallback's foot anchor from the SW corner to the stand's geometric center (`swX + F/2, swY + F/2`). Cheaper than re-enabling slicing and resolves most "ped pops in front of roof" cases by halving the worst-case z-error.

