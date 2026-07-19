# Night Market Template Runtime — Implementation Plan

> **Working doc.** This is the live build tracker for the **template *runtime*** — the
> code that consumes authored templates (DB catalog) and produces the rendered market +
> graphs. Update the [Status tracker](#status-tracker) as slices land. The *design* it
> implements is [NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md); the *authoring*
> side (editor) is [NIGHT_MARKET_TEMPLATE_EDITOR.md](./NIGHT_MARKET_TEMPLATE_EDITOR.md).
>
> **Status: SLICES 1–4 DONE** (backend). Terrain + graphs + ambient pedestrians render from
> the user's persisted layout; version selection recomputes on read; and the WRITE economy is
> live: earning a minute reconciles the user's unlock entitlement (`unlocks(m)` schedule → fill
> free placeholder slots → spawn a new template via the anchor algorithm when full), and the
> hourly cron decays occupants back down when minutes are debited. Verified end-to-end on dev
> (fill hub → spawn 2nd hub on the south seam → recompute-on-read loads both). Filled slots now
> render a **placeholder occupant marker** — a house, or two adjacent houses for a 4×10/10×4 slot
> ([`PlaceholderHouseLayer`](../src/features/nightmarket/PlaceholderHouseLayer.tsx))
> — until a real stand asset exists. **Remaining (not backend):** the real stand-asset catalog
> (occupants carry a generic assetId, and the house marker stands in for it). See the
> [Status tracker](#status-tracker).

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
  `isoY = offsetRow + row` (col→east→+isoX, **row→north→+isoY** per `isometric.ts`,
  `TILE_SIZE = 1`). Because +isoY is north, local `(0,0)` — the min-iso cell — is the
  **SW (near/front) corner**, and `offsetCol/offsetRow` is that SW corner's position.
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
  terrain1: Set<string>; terrain2: Set<string>;  // generic terrain masks (currently light/dark grass)
  decor: Map<string, string>;         // cell → sprite stem
  placeholders: PlacedPlaceholder[];
}
// Render seam (implemented alongside stitchWorld):
function stitchedToEditorMasks(world: StitchedWorld): EditorMasks;  // → buildEditorField reuse
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
  terrain: StitchedWorld;             // grass/decor for render layers
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

**Slice 3+ (needs the `nightmarkettemplatelocations` table — ⚠️ confirm before migration):**
- `getStarterTemplate(): Promise<LoadedTemplate>` convenience on `NightMarketTemplateService`.
- `NightMarketPlacementService` — `placeUnlock(userId)`, `spawnTemplate(userId)`,
  `isPlacementLegal(a, b)`, anchor-driven algorithm + `template-match-not-found` logging
  ([NIGHT_MARKET_TEMPLATES.md § How a new template attaches]).
- `NightMarketWorldService.getUserLayout(userId): PlacedTemplate[]` — reads placement
  rows, loads each referenced definition, runs `selectVersion`, returns `PlacedTemplate[]`.
- Placement DAL additions on the template-definitions store.
- **Starter-hub seeding — two paths, one canonical.** Every user needs a hub placement
  row at origin. Seed it in **two** places:
  1. **On account creation (canonical).** New accounts get the hub placement row written
     as part of user setup. This is the permanent path.
  2. **On first market load (safety net — ⚠️ TO BE DEPRECATED).** `getUserLayout` seeds
     the hub idempotently (upsert-if-absent) when a user has zero placement rows, covering
     **pre-existing accounts** that predate the account-creation seed. Once every existing
     account has a hub row (a one-time backfill, or organic first-load coverage), this
     branch is **removed** — new accounts never hit it. Mark it clearly in code as
     deprecated-on-arrival so it isn't mistaken for load-bearing runtime logic.

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
Renders `world.terrain` (grass/street autotiles, decor). Generalizes the
existing `EditorTerrainLayer.tsx` (which already autotiles the same mask shape). In
`MarketEngineViewer.tsx`, swap the static `buildFarmField` call
(`MarketEngineViewer.tsx:143`) for `useMarketWorld`.

**Multi-template field (done).** The terrain field is no longer the origin-only box: it now
spans the **union of all placement footprints** across the continent bbox — including templates
spawned at NEGATIVE offsets (south/west of the origin hub). `useMarketWorld` computes the bbox
min-corner + a footprint membership Set and hands `buildEditorField` a {@link TerrainField}
(`farmTerrain.ts`) `{ originCol, originRow, contains }`. `buildEditorField` iterates the global
window `[origin, origin+span)` and emits a ground tile only for in-field cells, so the plateau rim
(`fieldEdge`) hugs the real (possibly L/T-shaped) silhouette instead of a rectangle. Templates that
authored no `terrain1` (every non-hub template today) render as bare **dirt** — the default surface —
which is why a freshly spawned stall shows dirt+decor rather than blank canvas. Editor callers pass
no field ⇒ the unchanged single-board `[0,width)×[0,height)` default.

---

## Slice ordering

| Slice | Delivers | New modules |
|---|---|---|
| **1** | one authored hub template → rendered pan/zoom **terrain** (no graph, no peds) | `templateStitch` (stitch → terrain), `versionSelector`, `useMarketWorld` (terrain), `TemplateTerrainLayer` |
| **2** | graph + pedestrians (street recovery → tile/street graphs → peds walk) | `streetRecovery`, `placeholderIslands`, `marketWorld` (graph assembler), `useMarketWorld` extended, ped wiring (`pedestrianAgent.ts` already consumes `StreetGraph`) |
| **3** | placement + persistence (needs `nightmarkettemplatelocations` table ⚠️) | `NightMarketPlacementService`, `NightMarketWorldService`, placement DAL |
| **4** | unlock economy (minutes→unlocks schedule, grant flow, decay cron branch) | schedule constant; `expire-stale-streaks.sql` unlock-removal branch |

Slice 1 needs **no new tables** — reads `nightmarkettemplatedefinitions` DB-direct — and
builds **no graphs**: `useMarketWorld` calls `stitchWorld` and hands the `StitchedWorld`
terrain straight to `TemplateTerrainLayer`. `streetRecovery` + `marketWorld` graph
assembly arrive in slice 2.

---

## Sample user flow (end state, all slices live)

1. **New user, 0 minutes.** Server has one placement row: the **hub at origin**
   (identified by the `NIGHT_MARKET_HUB_TEMPLATE_NAME` name + `offset (0,0)`).
   `getUserLayout` loads its definition, `randomVersionSelector` picks
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

- ⚠️ **Slice 2 table `nightmarkettemplatelocations`** (+ `placedTemplateId`/`placeholderAreaId` on
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
| Author `night-market-hub` template in the editor | 1 | ✅ | 28×28, v0 only, 159 street / 165 communal / 4 placeholder |
| `NIGHT_MARKET_HUB_TEMPLATE_NAME` constant | 1 | ✅ | `'night-market-hub'` — in `templateEditorApi.ts` |
| `templateStitch.ts` (stitch → terrain) | 1 | ✅ | `stitchWorld` + `stitchedToEditorMasks` render seam |
| `versionSelector.ts` (random stub) | 1 | ✅ | seam only; `selectVersion`/`randomVersionSelector` |
| `useMarketWorld.ts` (terrain) | 1 | ✅ | keyed on `isAuthenticated`, not token |
| `TemplateTerrainLayer.tsx` + `MarketEngineViewer` swap | 1 | ✅ | thin adapter delegating to `EditorTerrainLayer` (no dup sprite logic) |
| `streetRecovery.ts` | 2 | ✅ | greedy maximal-rectangle cover; per-orientation dedup; width ∈ [1,8] assert. Tested (`__tests__/streetRecovery.test.ts`) |
| `placeholderIslands.ts` | 2 | ✅ | 4-conn flood fill. `labelIslands` (generic CC-labeling primitive; deterministic id from min cell) + `computePlaceholderAreas` thin wrapper. ⚠️ authored `{col,row,w,h}` rects remain the primary area source — mask-recovery here is convenience/validation only. Tested (`__tests__/placeholderIslands.test.ts`, 8). |
| **Version selection — editor live condition count (Phase B)** | VS (B) | ✅ | Author-facing display only — **no `conditionCount` column** (decision 2026-07-17: no DB reader). `TemplateEditorPage` computes the count live via `analyzeConditions` and shows the breakdown ("N conditions — P placeholder, B border-street") in the Save toast + condition-tool tooltip. `withBorderStreetConditions` (already existed) now reuses the runtime's `borderStreetCells` so preview/scoring agree. Nothing persisted; load re-derives. |
| **Version selection — condition-mask island analysis** | VS (A) | ✅ | `conditionAnalysis.ts` — `analyzeConditions`: re-derives border-street cells from `street ∩ outer-edge`, unions with manual condition cells, `labelIslands`, classifies substrate (placeholder→`placeholderAreaId` / border-street), mixed-island fallback (coerce to placeholder + `console.error`), orphan-cell guard. Tested (8). |
| **Version selection — seam adjacency** | VS (A) | ✅ | `seamAdjacency.ts` — pure geometry: `outerEdgesOf`, `globalOccupied`, shared `cellAbutsOthers` (reusable by `spawnTemplate`), `abuttingBorderIslandIds` (directional: a neighbor satisfies only the edge it abuts). No dependency on active versions (no fixpoint). Tested (9). |
| **Version selection — de-stub `selectVersion` + expand `VersionSelectContext`** | VS (A) | ✅ | `versionSelector.ts` — `conditionScoreSelector` + `scoreVersion`: primary = highest absolute `satisfied`; tiebreak `satisfied / conditionCount` ratio → lowest version #; v0 floor (satisfied 0, 0/0=0). (Primary/tiebreak reversed 2026-07-18.) Context gains `filledPlaceholderIds` + per-version `byVersion` state; random stub + seam untouched (back-compat). **Scored selector only — soft decay bias; hard guarantee deferred.** Real inputs wire in at slice 3. Tested (11). |
| `marketWorld.ts` (graph assembler) | 2 | ✅ | `buildMarketWorld`: stitch → TileDef[] (street stamped w/ `intersectingStreets`, communal walkable) → `recoverStreets` → `buildTileGraph`+`buildStreetGraph`. Tested (recovery + sim tests) |
| `useMarketWorld` extended → full `MarketWorld` | 2 | ✅ | now returns `world: MarketWorld` (terrain + graphs); still keyed on `isAuthenticated`, not token |
| Pedestrian wiring on recovered graph | 2 | ✅ | `usePixiPedestrians` reparametrized to take the runtime graphs (re-seeds on graph-identity change); new `PedestrianLayer.tsx` (pure view, preloads ped frames); scene drives `tick`+frame-bump. Headless sim test (`__tests__/pedestrianSim.test.ts`) proves walkers move + stay on-graph. **Sprites**: the free-farm player pack — two variants (`male`/`female`, `PEDESTRIAN_SPRITES` in `tileRegistry.ts`), each a 4-frame walk cycle × 4 cardinal facings from `freeFarmTileset.getWalkFrames`. Engine iso-heading → pack facing is identity (north→`n` away, east→`e`, south→`s` toward camera, west→`w`); `makeAmbientPedestrian` picks a variant at random. |
| `nightmarkettemplatelocations` table (confirm → migration) | 3 | ✅ | **migration 112** (applied on dev). Cols: `userId`, `templateName` (name, not FK), `activeVersion`, `offsetCol`/`offsetRow` (SW/min-iso corner), `createdAt`. Indexes: (userId, createdAt) + UNIQUE (userId, offsetCol, offsetRow). No `placeOrder`. |
| `nightmarketunlocks` placement link (`placedTemplateId`/`placeholderAreaId`) | 3 | ✅ | **migration 113** (applied on dev). Both NOT NULL — existing rows CLEARED (confirmed 2026-07-17). FK placedTemplateId→locations ON DELETE CASCADE; UNIQUE (placedTemplateId, placeholderAreaId) = one occupant per slot. |
| `NightMarketPlacementService` | 3 | ✅ | WRITE/spawn path. `placeUnlock` (fill first free placeholder slot across placements), `spawnTemplate` (full anchor algorithm via `templatePlacement.ts`), `grantUnlocks` (idempotent reconcile to `unlocks(m)`, fill-then-spawn loop). Occupants tagged with a generic assetId (real stand-asset catalog + occupant→stand render is a later visual slice). Verified end-to-end on dev (fill 4 hub slots → spawn 2nd hub on the south seam → fill). |
| `templatePlacement.ts` (pure anchor/spawn engine) | 3 | ✅ | `server/dal/shared/` (spawn is server-only + persisted, never recomputed client-side). `deriveAnchors`, `exposedAnchors`, `buildAnchorIndex`, `isPlacementLegal` (cell-level seam), `matchedStreetRuns`, `maximinSpread`, `planSpawn` (closest-anchor → complement/equal-width candidates → legal → maximize runs → maximin spread → random). ⚠️ candidate walkability matched on **v0** street (recompute-on-read settles final version); compass labels follow the runtime (`outerEdgesOf`), NOT the doc's "Edge signatures" bit-order table — see the doc inconsistency note there. Verified via `tsx` geometry checks (29 asserts). |
| `NightMarketPlacementDAL` (placement DAL) | 3 | ✅ | `findPlacementsByUser` / `countPlacementsByUser` / `insertPlacement` / `findOccupantsByUser` / `updateActiveVersion`. Reads `nightmarkettemplatelocations` + occupants (unlocks joined by placement). |
| `NightMarketWorldService.getUserLayout` + `getStarterTemplate()` | 3 | ✅ | Server layout read: seed-if-absent → read placements + occupants → **recompute each placement's `activeVersion` from live conditions** (see recompute-on-read row) → persist on change → load the selected def (self-heals a deleted version → v0) → attach per-placement `filledPlaceholderIds`. Returns `PlacedTemplatePayload[]`. `getStarterTemplate` on the template service loads the hub. `GET /api/night-market/layout` (`NightMarketWorldController`). Client: `nightMarketLayoutApi.loadUserLayout` + `useMarketWorld` rewired off the single-hub fetch. |
| **Version selection — recompute on read** (server mirror + wiring) | 3/C | ✅ | Decision 2026-07-17 (supersedes write-time). `server/dal/shared/versionSelection.ts` mirrors the four client engine modules (`placeholderIslands`/`conditionAnalysis`/`seamAdjacency`/`versionSelector`), hand-synced (server can't import `src/`). `NightMarketTemplateService.getVersionScoringInputs(name)` pulls every version's `street`+`condition` masks (+shared placeholderAreas/dims) in one query. `getUserLayout` scores every version per placement (filled slots + neighbor-footprint abutment via `globalOccupied`), picks via `conditionScoreSelector`, and persists via `updateActiveVersion` only on change. Single pass — no fixpoint (conditions key on neighbor footprints, not versions). **Both condition-changing moments are now correct**: an unlock (occupant insert) and hourly decay (occupant delete) each reconcile on the NEXT read; the decay cron stays pure SQL. |
| Starter-hub seed on account creation (canonical) | 3 | ✅ | `UserController.seedNightMarketHub` (best-effort) after `createUser` in both `register` and admin `createUser`; first-load safety net (`seedHubIfAbsent`) still covers pre-existing accounts (deprecated-on-arrival). |
| Legacy asset-unlock economy retired | 3 | ✅ | Migration 113's NOT NULL columns broke the old `nightmarketunlocks` writers; `NightMarketService.getUnlocks` now returns a stable empty shape (no seed/read), `unlockNext` rejects, and the old-shape write methods were removed from `NightMarketDAL`/interface. The occupant model is the sole writer; Slice 4 rebuilds the economy. |
| Unlock schedule constant + grant flow | 4 | ✅ | `server/dal/shared/unlockSchedule.ts` (`unlocksForMinutes` + `UNLOCK_BREAKPOINTS`, source of truth). Grant flow = `NightMarketPlacementService.grantUnlocks`, hooked best-effort into `UserMinutePointsService.incrementMinutePoints` after the total is bumped (idempotent, swallows errors so it never breaks the study loop). No client mirror yet (nothing on the client computes unlocks). |
| Decay cron unlock-removal branch | 4 | ✅ | `expire-stale-streaks.sql` — second branch: data-modifying CTEs (`decay_targets`/`decay_ranked`/`decay_delete`) trim each penalized user's occupants to `unlocks(new_total)` in the SAME transaction as the minute debit. Deletes OCCUPANTS only; pure SQL (no version compute — recompute-on-read settles versions next read). `unlocks(m)` CASE mirrors `unlockSchedule.ts`. Validated (parse+run, rolled back). Template pruning is a **separate** companion job (next row). |
| Dangling-template prune on decay | 4 | ✅ | **Reverses the append-only rule.** On any decay, empty (0-occupant) + weakly-attached placements are pruned to a fixpoint: removable ⟺ not-hub AND `!(hasEast&&hasWest) && !(hasHigh&&hasLow)` ({0,1,2-**adjacent**} sides; never a 2-**opposite** bridge). Pure core `server/dal/shared/templatePrune.ts#prunableDanglingPlacements` (6 scenarios verified); wrapper `NightMarketPlacementService.pruneDanglingTemplates` + `INightMarketPlacementDAL.deletePlacements` (occupants cascade). Triggers: author −N via `reconcileUnlocks` (decay branch); cron via compiled companion `dist/scripts/night-market/prune-dangling-templates.js` (`:02`, targets `lastPenaltyDate=today`), wired into `install-cron.sh`. Known edge: an empty L-connector (2 adjacent) to an occupied piece is removable → orphans it (accepted vs full connectivity guard). End-to-end run on dev user (6 placements, 0 removed = correct). |
| Drop legacy asset-unlock indexes | 4 | ✅ | **migration 114** (applied on dev). Dropped `idx_nightmarketunlocks_user_asset` (UNIQUE (userId,assetId) — broke the grant flow: many occupants share the generic assetId) + `idx_nightmarketunlocks_user_order` (dead `unlockOrder`). Occupant uniqueness stays `(placedTemplateId, placeholderAreaId)`. Completes the 112/113 cutover. |
| Occupant rendering (placeholder marker) | 4 | ✅ | Filled slots render a **house** (or two adjacent houses for a 4×10/10×4 slot) as a temporary occupant marker until the real stand-asset catalog exists. `filledPlaceholderIds` threaded through `PlacedTemplate` → `stitchWorld` tags each `PlacedPlaceholder` with `filled` (matched on LOCAL anchor id via `placeholderArea.ts#placeholderAreaId`) → [`PlaceholderHouseLayer`](../src/features/nightmarket/PlaceholderHouseLayer.tsx) tiles each filled area with 4×5 `House.png` footprints (`housesForArea`: 1 house for 4×5/5×4, 2 for 4×10/10×4; flip for the 5-wide orientation), foot-anchored at each house's front corner, `entity`-slot z. Cosmetic only — houses are NOT stands, so the nav graphs / `buildMarketWorld` are unchanged. Mounted in `MarketEngineViewer`. |
| Template-editor flag split (`isTemplateAuthor`) | 4 | ✅ | **migration 115** (applied on dev). The template editor (route/menu/page bounce + the 6 server authoring gates → `assertTemplateAuthor`) moved off `isValidator` onto `users.isTemplateAuthor`; `isValidator` keeps only dictionary data-approval. Plumbed through server `User`, client `User`/`AuthContext`, `UserDAL.findById` SELECT, both schema files. |
| Two-way reconcile (grant **+ decay**) | 4 | ✅ | `NightMarketPlacementService.reconcileUnlocks(userId, net)` — the single "make the world match the balance" entry point: grants (fill/spawn) when under target, DECAYS (`NightMarketPlacementDAL.deleteSurplusOccupants`, newest-first) when over. `grantUnlocks` stays the grant-only half for the study tick. |
| Author minute-adjust tool (nmp ±N buttons) | 4 | ✅ | `UserMinutePointsService.adjustMinutesForAuthor` + `POST /api/night-market/dev/adjust-minutes` (author-gated, 403). +N → `minutesEarned`+net; −N → `penaltyMinutes` (gross intact) + net debit floored; then `reconcileUnlocks`. Client: nmp `−30/−5/−1 · pending · +1/+5/+30 · Submit` (gated on `isTemplateAuthor`), accumulates a signed delta, Submit posts once → updates the badge (net) + bumps a `reloadToken` that re-fetches the layout (`useMarketWorld(reloadToken)` → `MarketEngineViewer`) so occupants redraw. Verified end-to-end on dev (403 gate; +30 grant→17 occ; −50 penalty→9 occ, gross intact; +12→12 occ). |
| GROSS/NET display split | 4 | ✅ | `getLanguageSummary` now returns global NET (`users.totalMinutePoints`) + global GROSS (`getGrossMinutesEarned`, on-read aggregate). `useMinutePoints` exposes both; tester `TimeDisplay` shows big = NET ("Current Balance", drops on penalty) / small = GROSS ("total earned"); nmp badge + unlock check use NET (also fixed a latent client/server unlock-driver mismatch). See docs/MINUTE_POINTS_SYSTEM.md. |
| Real stand-asset catalog + occupant→stand render | — | ⏳ | NOT built. Occupants carry a generic assetId; the house marker stands in. A real catalog maps occupant→specific stall art (and would enter the tile graph as a stand with a footprint/access tile). |

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
