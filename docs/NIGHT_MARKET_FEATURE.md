# Night Market Feature

> **One market per language since migration 130.** `nightmarkettemplatelocations`
> and `nightmarketunlocks` both carry a `language`; corner-uniqueness is
> `(userId, language, offsetCol, offsetRow)`. Each language's continent is funded by
> that language's own wallet, and every placement/layout call is scoped to a
> `(userId, language)` pair. See [PER_LANGUAGE_STREAKS.md](./PER_LANGUAGE_STREAKS.md).

## Overview

The Night Market is a visual reward system tied to **minute points** (`users.totalMinutePoints`
— 1 minute point ≈ 60s of active study; see [MINUTE_POINTS_SYSTEM.md](./MINUTE_POINTS_SYSTEM.md)).
As users study and accumulate minute points they unlock **occupants** that populate a personal
night market scene. Each user's market is unique because the map grows by tiling templates onto
their own continent as they earn.

> **Terminology:** this feature is driven by *minute points* throughout. Older docs
> (`WORK_POINTS_*.md`) call the same accumulator "work points" — that name is retired.

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

### Depth sorting: sprite-strip slicing for multi-cell sprites

*Code: `src/engine/market/isometric.ts` (`computeSpriteStrips`, `computeStripPlacements`,
`computeLayerZ`), `src/engine/market/house.ts` (`HOUSE_STRIPS`),
`src/features/nightmarket/HouseStripSprites.tsx`. Tests: `src/__tests__/houseStrips.test.ts`.*

Everything sorts by the painter's rule `z = -(footIsoX + footIsoY) + slot`, where the foot
anchor is the sprite's FRONT (min-iso) corner. A sprite one tile wide can carry a single foot.
Anything **wider than a tile cannot** — one sprite = one quad = one z for its whole width, so a
pedestrian beside the near-LEFT wing and one beside the near-RIGHT wing are sorted against the
same depth and one of them is always wrong (walker swallowed by the wall, or floating over the
roof).

The fix is to draw such a sprite as a row of **full-height vertical strips**, each with its own
foot anchor:

- **Placement is pixel-faithful.** A strip is just a vertical crop of the source, drawn in the
  exact screen column it occupied unsliced — no stretch, no seam.
- **Depth comes from the strip's screen-X.** The offset from the anchor maps back to iso units
  along the footprint's two FRONT edges (16 screen px per iso unit): strips left of the anchor
  walk **+isoY** (the SW edge), strips right of it walk **+isoX** (the SE edge).
- **Flip is handled after the mirror.** `flip: true` negates the screen offsets before the depth
  mapping, so a mirrored house automatically gets the transposed 5×4 footprint's feet. Render a
  strip at `anchorScreenX + offsetX` with `anchor.x = flip ? 1 : 0` and `scale.x = flip ? -1 : 1`
  — both combinations draw rightward from that x.

#### ⚠️ The two rules that keep the ground from punching through

A strip must never sort **deeper than a footprint cell whose screen column it covers** — that
cell's own terrain (grass cap at `z`, dark cap `z + 0.05`, scatter decor `z + 0.1`/`+0.15`) would
then draw *over* the building. Before slicing this was free: the whole sprite sat at the
front-corner depth, above every cell of its own footprint. Slicing gives that up, and it is
recovered by:

1. **Nearest edge, not centre.** A strip's implied foot is the near end of its span — the
   shallowest point of the block in that column. Using the centre pushes it half a strip deeper
   than the cell it covers and terrain wins.
2. **Cuts aligned to the anchor.** Boundaries step outward from the (texel-rounded) anchor in
   `TILE_WIDTH / 2` increments, so each strip covers exactly ONE screen column. Cutting from
   texture x = 0 instead leaves every strip straddling two columns (House.png's base corner is at
   x = 90.5, 5.5px off the grid) and inheriting the deeper one. The two end strips are partials —
   the art's overhang past the footprint (the roof eave), which lands on the footprint's far
   corner.

Together these guarantee the sprite always wins on its own footprint while still yielding to
anything genuinely in front of it. `src/__tests__/houseStrips.test.ts` asserts this directly over
every (footprint cell × covering strip) pair; getting either rule wrong produced 14 violations,
all on the two front-edge cell rows — i.e. the wings.

Consequently a strip-sliced building must render in the **`entity`** slot, not `background`: at
equal depth the entity fraction (+0.25) clears every terrain sub-layer, whereas a background-slot
house ties its own cells' decor.

`computeStripPlacements(swX, swY, F, …)` is the **stand** flavour — a bottom-centre-anchored
square footprint cut into exactly `2F` strips. It is now a thin wrapper over the general
`computeSpriteStrips`, which additionally takes `anchorTexX` (art whose base corner is not the
frame centre — `House.png`), an explicit `stripTexW`, and `flip`.

**Houses** are the live consumer: `HOUSE_STRIPS.normal` / `.flipped` precompute the 11 strips of
`House.png` relative to a front corner at (0, 0), and `HouseStripSprites` is the single component
all three house surfaces render through — `HouseLayer` (nmp sample house), `PlaceholderHouseLayer`
(runtime filled-slot occupant) and the template editor's `PlaceholderOccupantHouses` (lifted above
the mask tints in flat mode). All three use the `entity` slot.
Strips are emitted FLAT into the caller's `sortableChildren` container — never wrapped in a
per-house container, which would collapse them back to one depth.

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

**Pixel-art rendering:** terrain textures use nearest-neighbour filtering, and the camera comes to
rest on its **zoom ladder** (see "Camera (pan / zoom)" below) so upscaling stays crisp with no
fractional resampling. The Pixi `<Application>` sets `antialias={false}`.

### Camera (pan / zoom)

*Code: `src/engine/market/cameraZoom.ts` (whole file — the pure math);
`src/hooks/useCameraControls.ts` (whole file — the React host: state, listeners, settle tween);
`MarketEngineViewer.tsx` (`CRISP_FLOOR`/`MAX_ZOOM`/`ZOOM_STEP` + the `useCameraControls({…})` call);
`TemplateSandboxViewer.tsx` and `TemplateEditorViewer.tsx` (same constants + call). Tests:
`src/__tests__/cameraZoom.test.ts`.*

**All three camera surfaces share one host hook.** nmp, nms and nme previously carried three
near-identical copies of `applyZoomAtPoint` + `handleWheel` + the `ready` mount latch, differing
only in floor / step / cap. They now differ only in the options object they pass:

| Surface | `crispFloor` | `ladderStep` | `maxZoom` | `initialZoom` | Pinch | Fit-derived sub-floor |
|---|---|---|---|---|---|---|
| nmp (`MarketEngineViewer`) | 0.5 | 0.5 | 8 | 1 | ✅ | ✅ (`computeMinZoom` over `placements`) |
| nms (`TemplateSandboxViewer`) | 1 | 1 | 10 | 3 | — | ✅ (`computeMinZoom` over `items`) |
| nme (`TemplateEditorViewer`) | 1 | 1 | 10 | 3 | — | — (fixed authored board) |

**Smooth during the gesture, crisp at rest.** Every input event moves the zoom **continuously** —
any float in `[minZoom, maxZoom]`, no rung quantisation. When the gesture goes quiet (finger lift,
or `WHEEL_IDLE_MS` = 160ms of wheel silence) the camera **settles**: a `ZOOM_SETTLE_MS` = 140ms
ease-out tween onto the nearest ladder rung, about the same focal point the gesture used. Crispness
is therefore paid for once, at rest, instead of on every frame.

> This replaced a per-event snap, which discarded a pinch's intermediate finger travel entirely and
> promoted each of a trackpad's ~50 events/sec to a whole ladder step.

**Zoom moves geometrically, never additively.** Zoom is a scale factor, so equal *ratios* read as
equal motion. `zoomForWheel` multiplies by `WHEEL_ZOOM_PER_NOTCH` (1.5) per 100px of delta —
`wheelDeltaPixels` first normalises Firefox's line-mode and page-mode deltas — and the settle tween
interpolates in log space (`lerpZoom`). The old additive ladder made 0.5→1 a +100% lurch and 7.5→8
a +6.7% nudge from identical input. This also removed the separate sub-floor wheel constants
(`SUB_FLOOR_ZOOM_FACTOR` / `SUB_UNIT_ZOOM_FACTOR`): one geometric formula now covers both regimes.

**Focal-point pinning** lives in `panAfterZoom` — the pan correction that keeps the world point
under the cursor (or the pinch midpoint) fixed across a zoom change. The hook routes gesture moves
*and* settle-tween frames through the single `applyZoomAtPoint` write path, so the two can never
disagree. The pinch midpoint is captured **once** at gesture start, not re-derived per move — a
moving midpoint would turn a two-finger slide into a pan and fight the scene's own drag-to-pan.

**Drag-to-pan is deliberately NOT in the hook.** Each surface reads pointer drags inside its own
Pixi scene, where it already arbitrates against tile painting / template dragging / placement mode.
Those scenes push their result back in through `setPan`.

### Zoom-out floor scales with the world

*Code: `src/engine/market/cameraFit.ts` (whole file); `src/hooks/useCameraControls.ts`
(`resolveMinZoom`, the `minZoomFor` option); `MarketEngineViewer.tsx` (`CRISP_FLOOR`, the
`minZoomFor` closure, `SceneProps.onFootprintsChange`); `TemplateSandboxViewer.tsx` (same, integer
ladder). Tests: `src/__tests__/cameraFit.test.ts`.*

The camera's zoom-out limit is **derived from world size**, not fixed. `computeMinZoom(footprints,
viewportW, viewportH, crispFloor)` takes every placement's board rectangle, projects it through
`isoToScreen` to a screen-space bbox (plus a half-tile margin and 96px of headroom for tall decor
— houses/trees/dirt slabs), and returns the zoom at which that bbox fills 90% of the viewport,
clamped to `[ABSOLUTE_MIN_ZOOM = 0.05, crispFloor]`. Because the result never exceeds `crispFloor`
(nmp `0.5`, nms `1`), **small worlds behave exactly as before**; a continent that has tiled out far
enough to no longer fit may keep pulling back.

The camera settles onto the crisp ladder (nmp half-steps, nms integers) at/above `crispFloor`.
**Below** it there is nothing to settle onto — the ladder has no rungs left there — so
`useCameraControls.startSettle` returns early and the value simply stays wherever the gesture left
it. Art below the crisp floor is fractionally resampled (blurrier); that is the deliberate trade for
seeing a large market whole.

The floor is recomputed **lazily at gesture time** from the live element size (the `minZoomFor`
closure, read through a ref — no resize listener or state), so window resizes and placement edits
are picked up without re-render churn.
nmp fetches its layout inside `NightMarketScene` but owns zoom in the outer component, so the scene
reports its `placements` upward via `onFootprintsChange`; nms already has `items` in the camera
host and needs no plumbing. nmp additionally runs a `ResizeObserver` — not for the floor, which stays
lazy, but to re-run the pan clamp, whose inputs move without the pan moving (see below).

### Pan clamp (nmp only)

*Code: `src/engine/market/cameraFit.ts` (`clampPan`);
`src/hooks/useCameraControls.ts` (the `clampPan` option, `setPan`, `reclampPan`, the
zoom-before-pan commit order in `applyZoomAtPoint`); `MarketEngineViewer.tsx` (the `clampPan`
closure, `refreshCameraLimits`, the `ResizeObserver` effect). Tests:
`src/__tests__/cameraFit.test.ts` § `clampPan`.*

The market cannot be dragged off screen. The rule is **"the screen centre stays inside the placement
bbox"** — nothing about where the world's far edges land. `clampPan(pan, footprints, zoom)` inverts
the camera transform (`container.x = viewportW/2 + pan.x`, `scale = zoom`) at the screen centre:

```
centreX = −pan.x / zoom          →   pan.x ∈ [−maxX·zoom, −minX·zoom]
centreY = −pan.y / zoom          →   pan.y ∈ [−maxY·zoom, −minY·zoom]
```

**The viewport cancels out**, so the clamp takes no viewport at all — one `Math.min`/`Math.max` per
axis. And since `minX ≤ maxX` by construction the interval can never cross, so there is no degenerate
case: the bbox is simply the set of points the camera may look at. The clamp is **non-elastic** — no
rubber-band tween.

> Superseded the original "bbox must keep covering the viewport, with 12% overshoot" rule, which
> needed the viewport, a `PAN_SLACK` constant, and a snap-to-centre fallback for the crossed interval
> that arose whenever the world was smaller than the viewport (the usual case at the zoom floor).
> ⚠️ The trade: at the zoom floor the centre may now roam the bbox, so the market can sit off-centre
> while fully visible. Shrink the bbox inside `clampPan` if it should stay nearer the middle.

The clamp lives on the **one pan write path** (`useCameraControls.setPan`), so scene drag handlers,
the focal-point zoom correction, and the settle tween all get it without knowing about it. Two
consequences worth remembering:

- `applyZoomAtPoint` commits the **zoom before the pan**, because the limits are zoom-dependent;
  clamping against the outgoing scale would fight the focal-point correction on that frame.
- Nothing notices when the clamp's *inputs* move but the pan does not, so `reclampPan()` is called
  explicitly on world load and on resize (`refreshCameraLimits`).

**nms/nme are deliberately unclamped** (they pass no `clampPan`): authoring requires dragging into
empty space to place a template at a distant offset.

### Default ground apron

*Code: `src/features/nightmarket/GroundBackdropLayer.tsx` (whole file);
`src/engine/market/farmTerrain.ts` (`padTerrainField` + its `boundless` flag, `TerrainField.apron`,
`buildEditorField`'s `isLightGrass` + `window` culling); `src/engine/market/cameraFit.ts`
(`visibleCellWindow`, `WINDOW_MARGIN_CELLS`, `WINDOW_QUANTUM_CELLS`);
`src/engine/market/isometric.ts` (`CellWindow`); `TemplateTerrainLayer.tsx` (`apronPad`/`cullWindow`
props); `MarketEngineViewer.tsx` (`APRON_RING_CELLS`, the `<GroundBackdropLayer>` mount, the
`cullWindow` memo). Tests: `src/engine/market/__tests__/terrainApron.test.ts`.*

nmp renders **default ground — tallDirt slab + lightGrass cap — across the whole viewable area**, so
the camera never sees bare background past the market's edge. The ground is at the market's own
elevation and shares its light-grass membership, so `fieldEdge` autotiles flat across the boundary:
**the market is no longer a floating island**, and no plateau rim is drawn anywhere on screen. An
interior hole in an L-shaped layout becomes ordinary ground for the same reason.

It is built from **two pieces**:

| Piece | Extent | Cost |
|---|---|---|
| Real autotiled tiles (`TemplateTerrainLayer`) | market + `APRON_RING_CELLS` (4) ring | one to four sprites per cell |
| `GroundBackdropLayer` | the entire viewport, at any zoom | **one** `TilingSprite` |

`padTerrainField(field, w, h, pad, boundless)` grows the field outward and marks the ring `apron` —
in-field ground that no template painted. `buildEditorField` reads `apron` into both `kind` and
`grassNeighbours`, which removes the seam where template grass meets the surrounding ground.
`boundless` then makes `contains` true *everywhere* while the returned span still bounds what is
drawn, so the ring's own outer cells also autotile as interior `center` tiles — no cliff at the
ring's edge either.

**Why the backdrop is pixel-exact.** Every interior ground cell resolves to the same two sprites
(`center` slab + `center` cap), so the rendered ground is exactly periodic. The iso screen lattice is
generated by `(W/2, −H/2)` and `(−W/2, −H/2)`, which contains `(W, 0)` and `(0, H)` — so a
`TILE_WIDTH × TILE_HEIGHT` window of the infinite uniform ground is a valid repeating unit.
`generateMotif` composites a 9×9 patch of the real tileset art and keeps one period from its middle
(anchored at a known cell corner); `tilePosition` re-phases it against the camera each frame so the
backdrop's diamonds line up cell-for-cell with the real tiles.

**The art is 32×32, not 32×16.** `FARM_TILE_PX` is 32 while `TILE_HEIGHT` is 16: each source tile is
a 32×32 cell holding a 32×16 diamond plus 16px of vertical body. The two families put the diamond in
*opposite* halves — `lightGrass_center` is transparent in rows 0–15 with its diamond in rows 16–31,
`tallDirt_center` has its diamond top at rows 0–15 and its cliff body below. Bottom-centre anchoring
at `y` therefore lands the grass diamond in `[y − TILE_HEIGHT, y]`, and drawing the slab at
`y + TILE_HEIGHT` lands *its* diamond top in the same band, which is why the cap covers the slab top
exactly and the slab's remaining cliff band shows below. **That band is the motif crop.** Anything
that assumes the art is 32×16 will crop the transparent half and bake an invisible backdrop.

**Painter's order inside the bake.** The patch is composited **far → near** (`col + row` descending),
mirroring the scene's `z = −(col + row)`. Iterating `col`/`row` naively paints far cells over near
ones, letting a slab's cliff band cover the cap in front of it.

**Canvas2D, not `renderer.generateTexture`.** The bake used to go through the Pixi renderer, which
made static art depend on WebGL state, `Application` init ordering, `renderer.resolution` (2 on
HiDPI resamples pixel art) and `Matrix.shared`. Every one of those failure modes yields a *blank*
texture, and a blank backdrop is pixel-identical to a missing one — the bug cannot be seen. The bake
now composites on a 2D canvas: synchronous, resolution-exact, independent of the renderer lifecycle,
and readable back with `getImageData` so `generateMotif` **fails loudly** when the result is not
fully opaque (fully transparent → `console.error` + no layer; partly → `console.error` naming the
hole count, since a hole in the bottom-most layer repeats as a see-through dot grid).

> ⚠️ The motif duplicates `EditorTerrainLayer`'s sprite stack (slab at `y + TILE_HEIGHT`, cap at `y`,
> both bottom-centre anchored). That layer is the source of truth — change its anchors and the motif
> drifts, showing a seam at the ring boundary.

> ⚠️ **One-way derivation.** The bbox behind `computeMinZoom` and `clampPan` is built from **template
> placements only** — never from the surrounding ground. Feeding it back in would enlarge the
> pannable area, which would demand more ground, which would enlarge it again, without bound. nmp
> keeps `footprintsRef` placements-only for exactly this reason.

**Rejected: sizing the ring to the camera's reach.** The first cut had no backdrop and instead
computed a worst-case pad (`apronCells`, since deleted) covering the zoom-out floor at a clamp limit
— correct, and unusable: ~94 cells per side for a portrait phone, ~200×200 cells, 40k+ sprites. The
backdrop replaces that entire calculation with one quad. See "Terrain performance" below.

**Culling** still bounds iteration for markets that outgrow the viewport on their own.
`visibleCellWindow(pan, zoom, w, h)` inverts the camera transform at the viewport's four **corners**
(the iso basis is rotated, so the cell extremes are the corners, not the edges), pads by
`WINDOW_MARGIN_CELLS`, and snaps outward to `WINDOW_QUANTUM_CELLS` — so the window changes every few
cells of travel rather than every dragged pixel, and `TemplateTerrainLayer` can memoise on its four
numbers. Culling limits **iteration only**: `inField`/`apron` are still consulted at full extent, so
a tile at the window's edge autotiles against its real neighbours and no phantom rim appears at the
cut (the test asserts a windowed tile is identical to its uncelled counterpart).

### Terrain performance (why the scene is split and memoised)

*Code: `MarketEngineViewer.tsx` (`PedestrianTicker`); `EditorTerrainLayer.tsx`,
`TemplateTerrainLayer.tsx`, `PlaceholderHouseLayer.tsx` (the `memo()` exports).*

The terrain is by far the app's largest React element tree — one to four `pixiSprite` elements per
ground cell. Two rules keep it off the frame budget, and **both** are required:

1. **The frame counter lives in a leaf.** `PedestrianTicker` owns the `useTick` + `setFrame` that
   drives the pedestrian FSM, so a frame re-renders ~a dozen ped sprites. It used to live in
   `NightMarketScene`, which meant React reconciled the whole terrain **60 times a second**.
2. **The terrain layers are `memo()`-ised.** A scene re-render for any *other* reason — a pan, a
   zoom — would otherwise still rebuild the terrain tree. This depends on stable props: `tiles` is
   memoised inside `TemplateTerrainLayer`, and `cullWindow` is quantised so its identity rarely
   changes.

⚠️ Do not hoist the ticker back into the scene, and do not drop the memos: either one alone leaves
the other's cost in place.

**Measuring it (`nmpPerf.ts`).** nmp's cost is not readable from the source — how many cells the
*loaded* market spans, whether a layer is rebuilding per frame, and the real frame time on the target
device are all runtime facts. `nmpPerf` reports them to the console every 2s and is **on by default
in dev** (`import.meta.env.DEV`); `localStorage.setItem('nmpPerf','1')` forces it on in a production
build, `'0'` forces it off anywhere. What to read:

| Line | Question it answers |
|---|---|
| `frame: … mean (…fps), worst …ms` | Is it actually slow, and is it a steady cost or a spike? |
| `world-cells` | Is the authored market genuinely enormous? |
| `window-cells` | How much of it the camera can see — i.e. what the terrain actually builds |
| `terrain-tiles` / `terrain-sprites` | Cells built vs. Pixi children emitted (a cell emits 1–4) |
| `… (rebuilt N× in the last 2s)` | **The key diagnostic.** N ≈ 120 means memoisation is broken; N ≈ 1 means the count itself is the cost |
| `backdrop: motif W×H, holes N` | Whether the ground motif baked at all, and whether it is opaque |

### Layer translucency (zoom-peel)

*Code: `src/engine/market/layerTranslucency.ts` (whole file);
`src/features/nightmarket/CameraZoomContext.tsx` (whole file);
`HouseStripSprites.tsx` (`fadeSlot` prop, the `alpha` const, `alpha=` on each strip);
`MarketEngineViewer.tsx` + `TemplateSandboxViewer.tsx` (the `<CameraZoomProvider>` wrapping each
scene container's children). Tests: `src/engine/market/__tests__/layerTranslucency.test.ts`.*

**On nmp and nms, zooming IN ghosts a building's outer layers**, peeling the shell open so the
player can see what is inside. Zoomed out a building should read as a solid silhouette; zoomed in,
an opaque roof or sign is exactly what is in the way.

> Since the cameras went continuous (see "Camera (pan / zoom)"), the smoothstep ramp in
> `alphaForSlot` runs **per frame** during a pinch rather than across a handful of ladder notches —
> the shell now dissolves smoothly instead of popping at each rung.

**The layer vocabulary is the existing `RenderSlot`** (`background | entity | foreground | overlay`,
`nightMarketRegistry.ts`) — deliberately NOT a parallel enum. A layered asset declares each
sub-image's slot once in `StandLayer.slot`, and that one declaration drives **both** its depth
ordering (`RENDER_SLOT_Z`) and its fade behaviour (`SLOT_FADE`). Slot order is back-to-front, so
"outermost peels first" is just "later slots get lower thresholds":

| Slot | Contents | Fades at zoom | Settles at |
|---|---|---|---|
| `overlay` | tall signs, floating effects | **3** (over a 1-zoom window) | `GHOST_ALPHA` = 0.25 |
| `foreground` | counters, **roofs** | **4** (over a 1-zoom window) | `GHOST_ALPHA` = 0.25 |
| `entity` | humans, merchants | **never** | — |
| `background` | shadows, floor details, back walls | **never** | — |

`entity`/`background` never fade — they are what peeling the shell is meant to reveal. The residual
0.25 (rather than 0) keeps the isometric silhouette legible: a fully transparent wall reads as a
*missing* wall. `alphaForSlot(slot, zoom)` eases between the two ends with a smoothstep so the
handful of intermediate ladder notches land on a curve rather than a kinked line.

> ⚠️ **Thresholds are ABSOLUTE zoom values, not multiples of a surface's default framing.** The two
> cameras have different ladders — nmp runs 0.5–8 defaulting to 1×, nms runs 1–10 defaulting to 3×
> — so one table behaves differently on each: on nmp the shell is solid at the default view and
> peels as you push in, while nms's default 3× view already sits at the `overlay` threshold. That is
> an accepted trade for having a single table with no per-surface bias constants to keep in sync. To
> change it, retune `SLOT_FADE` rather than adding a per-surface offset.

**Zoom plumbing.** Zoom previously never left the camera hosts (local state, spent only as `scale`
on the root container), but the fade is needed at the sprite *leaves*, 2–4 components down and
behind components shared by all three house surfaces. `CameraZoomProvider` publishes it; any leaf
opts in via `useCameraZoom()`. The provider emits **no display object**, so the layers it wraps stay
direct children of the scene container and keep taking part in its single global z-sort.

**Publishers are the two player-facing cameras only** — `MarketEngineViewer` (nmp) and
`TemplateSandboxViewer` (nms). The authoring surfaces (`TemplateEditorViewer`/nme, the Load gallery
thumbnails) publish nothing, so `useCameraZoom()` falls back to its neutral `1` and their art stays
fully opaque — an author placing a slot needs to see the occupant solidly. The peel is therefore
opt-in per surface rather than something each authoring tool must suppress. Note the editor's
`PlaceholderOccupantHouses` is reached from nms too (nms renders `TemplateMaskOverlays` inside its
provider), so the same component correctly peels on nms and stays solid in nme.

**Current state — test assets.** `House.png` is unlayered: one flat image. It must sort in the
`entity` slot (so pedestrians interleave with its near-left/near-right wings correctly, see the
sprite-strip section above), but what it *depicts* is a roof-and-walls shell. `HouseStripSprites`
therefore takes a `fadeSlot` prop defaulting to `'foreground'`, decoupling "what depth am I" from
"what layer am I" so the peel is visible on the placeholder art today without lying about the
sprite's depth. **When the real layered assets land, each layer passes one honest `slot` and the
`fadeSlot` override falls away.** Alpha is applied per strip rather than to a wrapping container —
a container would re-parent the strips out of the global sort — and since the strips are
anchor-aligned edge-to-edge with no overlapping pixels, that composites identically to whole-sprite
alpha with no double-blended seams.

**Not yet wired:** `StandLayer[]` is declared in the registry but has no renderer. When one is
written it should call `alphaForSlot(layer.slot, useCameraZoom())` and gets the peel for free.

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

The scene is **read** by the layout endpoint; unlocks are **written** by the minute-points
tick — the client never asks for an unlock.

```
┌───────────────────────────────────────────────────────────────────┐
│                        Frontend                                    │
│                                                                    │
│  NightMarketEnginePage ──▶ GET /api/nightMarket/layout            │
│       │                                                            │
│       ▼                                                            │
│  MarketEngineViewer  (Pixi render of placements + occupants)      │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│                        Backend — READ path                          │
│                                                                    │
│  NightMarketWorldController ──▶ NightMarketWorldService            │
│       (seeds the origin hub; recompute-on-read version selection)  │
│                               │                                    │
├───────────────────────────────┼────────────────────────────────────┤
│                        Backend — WRITE path (unlocks)               │
│                                                                    │
│  UserMinutePointsService.incrementMinutePoints                     │
│       │  (best-effort, every earned minute)                        │
│       ▼                                                            │
│  NightMarketPlacementService.grantUnlocks / reconcileUnlocks       │
│       │        ▲                                                   │
│       │        └── unlocksForMinutes()  (dal/shared/unlockSchedule) │
│       ▼                                                            │
│  ensureFreeSlot ─── none free ──▶ spawnTemplate (loop, free)      │
│       │  (lazy: growth ONLY when an arriving unlock  │             │
│       ▼   finds no free UNIT slot)                   │             │
│  insert occupant into that slot (one per unit)    │                 │
│       │                                          │                 │
│       ▼                                          ▼                 │
│  INightMarketPlacementDAL ──▶ nightmarketunlocks (occupants)       │
│                            └─▶ nightmarkettemplatelocations        │
└────────────────────────────────────────────────────────────────────┘
```

> The legacy `NightMarketController → NightMarketService → NightMarketDAL` chain still
> exists but is a retired stub (see *Unlock Flow*).

---

## Database Schema

### `nightmarketunlocks` Table

One row = **one occupant placed into one placeholder slot** of a placed template
(migrations 47 → 112/113/114; 113 repurposed the table and wiped it).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique identifier |
| userId | UUID | NOT NULL, FK → users(id) ON DELETE CASCADE | Owner of the occupant |
| placedTemplateId | UUID | NOT NULL, FK → nightmarkettemplatelocations(id) ON DELETE CASCADE | The placement this occupant sits in |
| placeholderAreaId | VARCHAR(40) | NOT NULL | The slot within that placement — SW-corner anchor id `"col_row"` |
| assetId | VARCHAR(100) | NOT NULL | Currently always the generic `occupant-generic`; the real stand catalog is a later visual slice |
| unlockType | VARCHAR(20) | NOT NULL, DEFAULT 'stall' | ⚠️ **vestigial** — legacy asset-economy column, no longer read |
| unlockOrder | INTEGER | NOT NULL, DEFAULT 0 | ⚠️ **vestigial** — legacy asset-economy column, no longer read |
| createdAt | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | When the occupant was granted (decay trims the NEWEST first) |

**Indexes:**
- `UNIQUE (placedTemplateId, placeholderAreaId)` — one occupant per slot
- `(placedTemplateId)` — fast "which slots of this placement are filled"
- The legacy `UNIQUE (userId, assetId)` and `(userId, unlockOrder)` indexes were **dropped
  by migration 114** — under the generic-asset model every occupant shares one `assetId`,
  so the unique index would have capped each user at a single occupant.

---

## Asset Registry (legacy)

⚠️ The registry belongs to the **retired** asset-unlock economy and no longer drives what a
user owns. Occupants are all tagged `occupant-generic` today; the real stand-asset catalog
and occupant→stand rendering are a later visual slice
([NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md](./NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md)).

**Asset files live at:** `src/assets/` (imported as Vite modules, not served from `public/`)

**Location:**
- Server: `server/config/nightMarketRegistry.ts`
- Frontend: `src/engine/market/nightMarketRegistry.ts`

**Exports:**
- `NIGHT_MARKET_BASE_SET` — legacy: items every user used to receive automatically
- `NIGHT_MARKET_UNLOCK_POOL` — legacy: the random-pull pool
- `NIGHT_MARKET_CONFIG` — legacy constants (e.g., `POINTS_PER_UNLOCK = 60`). **Not** the
  live curve — that is `unlocksForMinutes` in `server/dal/shared/unlockSchedule.ts`.

Each asset definition includes: `assetId`, `unlockType`, `displayName`, `description`, `imagePath`, `x`, `y`, `zIndex`, `scale`.

---

## Unlock Flow (current — occupant model)

**Canonical spec:** [NIGHT_MARKET_TEMPLATES.md § Unlock economy](./NIGHT_MARKET_TEMPLATES.md#unlock-economy-minutes--unlocks).
Summarised here:

### ⚠️ One market PER (user, language) — migration 130

A user studying two languages has **two completely independent markets**. Each has its own
placements, its own occupants, its own starter hub at `(0,0)`, and its own coordinate space;
studying Spanish grows the Spanish market and never touches the Chinese one.

- `nightmarkettemplatelocations.language` and `nightmarketunlocks.language` (both backfilled
  to `'zh'`, since the market predates multi-language) carry the dimension.
- **Every** placement DAL method is `(userId, language)`-scoped. A query filtering on `userId`
  alone mixes two markets' geometry into one coordinate space and renders templates on top of
  each other — this is the single easiest way to break the market, so do not add one.
- The SW-corner uniqueness guard is `UNIQUE (userId, language, offsetCol, offsetRow)`.
  Migration 112's user-wide version had to be widened: two markets legitimately both have a
  hub at `(0,0)`, and the old index made seeding the second language's hub a hard 23505.
- The layout read takes the language: `GET /api/nightMarket/layout?language=<lang>`. The
  client (`useMarketWorld`) keys its load effect on the selected language so switching
  language re-fetches the other market.
- A language's market is seeded lazily: `NightMarketWorldService.getUserLayout` plants that
  language's hub the first time it is opened. Only the account's *initial* language gets a
  hub at signup.

### Entitlement is a pure function of THAT LANGUAGE's minute points
- `unlocksForMinutes(netMinutePoints)` in `server/dal/shared/unlockSchedule.ts` is the
  **source of truth**: an explicit breakpoint table below 60 minutes (1/2/3 min → 1/2/3
  unlocks, tapering to 4- then 5-minute gaps, reaching 17 unlocks at 60 minutes), then a
  steady state of `17 + floor((m − 60) / 60)` — **+1 unlock per hour** beyond minute 60.
- It is an **entitlement**, not a ledger: losing minute points takes unlocks back.
- The hourly decay cron (`database/cron/expire-stale-streaks.sql`) hard-codes the same
  breakpoints in SQL — **change one, change the other**.

### Sequence (push-based; no user-facing unlock button)
1. `UserMinutePointsService.incrementMinutePoints` earns a minute and calls
   `NightMarketPlacementService.grantUnlocks` best-effort.
2. `grantUnlocks` computes `target = unlocksForMinutes(m)` and compares to the user's
   current occupant count.
3. While under target it takes the **first free UNIT slot** across existing placements
   (`ensureFreeSlot` → `findFreeSlot`) and occupies it. One unlock = one occupant footprint,
   so a 4×10/10×4 area fills in two steps — see
   [§ One unlock = one unit slot](./NIGHT_MARKET_TEMPLATES.md#one-unlock--one-unit-slot-not-one-authored-area).
4. **Lazy spawn.** Only when no free slot remains does it grow: **spawn templates until one
   exposes a free placeholder** (`spawnTemplate` + the anchor algorithm), capped at
   `MAX_CONSECUTIVE_SPAWNS_PER_GRANT` (8) consecutive slot-less spawns per pass — see
   [§ Spawning until a free placeholder exists](./NIGHT_MARKET_TEMPLATES.md#spawning-until-a-free-placeholder-exists).
   Spawning is **free** — it never consumes an unlock — and the unlock that triggered it then
   fills the new template's first slot. Nothing is placed ahead of demand; see
   [§ Lazy spawn](./NIGHT_MARKET_TEMPLATES.md#lazy-spawn-templates-are-placed-only-when-an-unlock-needs-one).
5. Occupants are inserted into `nightmarketunlocks` with `placedTemplateId` +
   `placeholderAreaId` (a **unit** anchor id), tagged with the generic `occupant-generic` asset id.

The pass is **idempotent** — safe on every tick, and a capped/blocked pass simply resumes
on the next one.

### Decay
`reconcileUnlocks(userId, language, net)` handles a *dropped* balance **for one market**:
delete that market's newest surplus occupants, then `pruneDanglingTemplates(userId, language)`
removes placements left empty **and** weakly attached (never the hub, never an opposing-side
corridor). The hourly cron does the same in SQL, partitioned by `(userId, language)` — decaying
a neglected Spanish market must never delete a Chinese occupant.

### Seeding
Each language's origin hub is planted at `(0,0)` by
`NightMarketWorldService.seedHubPlacement(userId, language)` — at signup for the account's
initial language, and lazily on first layout load for any language opened later. There is no
base-set asset seeding.

### ⚠️ Retired: the legacy asset-unlock economy
The old flow — a base set of assets plus `floor(totalPoints / 60)` random pulls from
`NIGHT_MARKET_UNLOCK_POOL`, driven by a user-tapped `POST /api/nightMarket/unlock` — was
**retired 2026-07-17**. Migrations 112/113 repurposed `nightmarketunlocks` for the occupant
model (113 wiped the table). `NightMarketService` is a stub: `getUnlocks` returns an empty
shape and `unlockNext` throws. Delete it once the client stops calling those endpoints.

---

## API Endpoints

Registered in `server/routes/nightMarketRoutes.ts`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/nightMarket/layout` | **Live.** The user's rendered template layout (placements + occupants). Seeds the origin hub on first load. |
| POST | `/api/nightMarket/dev/adjustMinutes` | **Live, dev tool.** Emit an artificial ±N minute signal and reconcile the market. Template-authors only (403 otherwise). |
| GET | `/api/nightMarket/unlocks` | ⚠️ Retired — returns a stable empty shape so the old client doesn't error. |
| POST | `/api/nightMarket/unlock` | ⚠️ Retired — always rejects (`ValidationError`). |

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
| `server/dal/shared/unlockSchedule.ts` | **Source of truth** for the minutes→unlocks curve (`UNLOCK_BREAKPOINTS`, `unlocksForMinutes`) |
| `server/services/NightMarketPlacementService.ts` | Grant/decay of occupants: `grantUnlocks` (fill one UNIT slot per unlock, growing lazily only when none is free), `ensureFreeSlot`/`findFreeSlot`/`placeUnlock`, `reconcileUnlocks`, `pruneDanglingTemplates` |
| `server/dal/implementations/NightMarketPlacementDAL.ts` | Occupant + placement persistence |
| `server/services/UserMinutePointsService.ts` | Calls `grantUnlocks` best-effort after each earned minute |
| `database/cron/expire-stale-streaks.sql` | Hourly decay; **hard-copies the unlock breakpoints in SQL** — keep in sync |
| `server/types/nightMarket.ts` | TypeScript interfaces for occupants/placements and API responses |
| `database/migrations/47-create-night-market-unlocks.sql` | Original table creation (asset-unlock era) |
| `database/migrations/112…114` | Placements table; repurpose unlocks → occupants (destructive); drop legacy indexes |
| `server/config/nightMarketRegistry.ts` | ⚠️ Legacy server-side asset registry (base set + unlock pool) |
| `src/engine/market/nightMarketRegistry.ts` | ⚠️ Legacy frontend asset registry (same data) |
| `server/dal/interfaces/INightMarketDAL.ts` | ⚠️ Legacy DAL interface |
| `server/dal/implementations/NightMarketDAL.ts` | ⚠️ Legacy DAL implementation |
| `server/services/NightMarketService.ts` | ⚠️ Retired stub — empty `getUnlocks`, throwing `unlockNext` |
| `server/controllers/NightMarketController.ts` | HTTP handling for the two retired endpoints |
| `src/features/nightmarket/useNightMarket.ts` | ⚠️ Legacy hook still calling the retired endpoints |
| `src/features/nightmarket/NightMarketEnginePage.tsx` | Page component — builds layers from unlocks + registry, hosts debug toggles |
| `src/features/nightmarket/MarketEngineViewer.tsx` | Pixi (`@pixi/react`) canvas renderer with pan/zoom and tap interaction |
| `src/engine/market/cameraZoom.ts` | Pure camera-zoom math — geometric wheel mapping, ladder snap, focal-point pan, settle easing (see "Camera (pan / zoom)") |
| `src/hooks/useCameraControls.ts` | The one pan/zoom host hook shared by nmp / nms / nme — state, gesture listeners, settle tween, the pan clamp |
| `src/engine/market/cameraFit.ts` | Pure camera-limit math from world size — zoom-out floor, pan clamp, visible-cell window (see "Zoom-out floor", "Pan clamp", "Default ground apron") |
| `src/features/nightmarket/GroundBackdropLayer.tsx` | The infinite default ground — one tiling quad of the generated tallDirt+lightGrass motif (see "Default ground apron") |
| `src/engine/market/layerTranslucency.ts` | Pure fade table + `alphaForSlot(slot, zoom)` — the zoom-peel policy (see "Layer translucency") |
| `src/features/nightmarket/CameraZoomContext.tsx` | Publishes the camera's live zoom to sprite leaves; `useCameraZoom()` |

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

