# Night Market — Baked Terrain Chunks

> **STATUS: IMPLEMENTED, OFF BY DEFAULT.** Ships behind the nmp debug toggle
> `chunkedTerrain` (the grid-of-squares button in the debug column). It has **not
> been visually verified on a real screen** — see [§ What still needs a
> human](#what-still-needs-a-human). Do not turn it on by default until it has.

The throughput half of Tier 2 in
[REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md) (action item 7). Replaces
per-cell ground sprites with cached, pre-rasterised 256×256 chunks so terrain cost
stops scaling with market size.

---

## Why

`EditorTerrainLayer` emits **one to four sprites per ground cell**. At today's
scale — a handful of 16×16 boards — that is a few thousand sprites and
memoisation hides it. At the stated target (~100 templates, a ~240×240 cell
world, ~57,600 cells) it is tens of thousands of draws for content that **does not
move**.

The fix is not a faster renderer. It is to stop redrawing static content: bake it
once, then draw one quad.

---

## The model: chunk by SCREEN SPACE, not by template

The intuitive design — one baked texture per template — does not work. Templates
differ in size, overlap arbitrarily at their seams, and give no control over
texture memory as the market grows.

This is instead the **slippy-map / quadtree** model used by web map tiles:

> A **chunk** is a fixed 256×256 px square of *projected* space at a given zoom
> **level**, and it rasterises whatever cells happen to fall inside it.

Template heterogeneity then stops mattering — a chunk does not know what a
template is. And the payoff that makes the whole thing worth it:

> **Resident texture memory is bounded by the SCREEN, not by the world.**
> ~8 chunks cover a phone viewport, ~16 while two levels are held across a zoom
> transition. `16 × 256 × 256 × 4 B` ≈ **4 MB — at any market size.**

### The level ladder

| Level | px/cell | Whole 240×240 market if fully baked |
|---|---|---|
| L0 | 1 | 480 × 240 px — 0.4 MB |
| L2 | 4 | 1,920 × 960 — 7 MB |
| L4 | 16 | 7,680 × 3,840 — 118 MB |
| L5 | 32 (native) | full res — 472 MB ❌ |

**No level is ever fully baked.** Chunks are baked on demand and LRU-evicted, so
the table is only there to show why on-demand is the only option.

`levelForScale(s)` picks the smallest level whose cells are at least as large as
what the camera displays, so a baked texture is always **minified** (bilinear,
clean) and never **magnified** (visibly soft).

---

## Two constraints that shape everything

### 1. Only GROUND is baked, never decor

Baking flattens many cell depths into one image drawn at **one** z. That is
lossless only for art that could never have sorted in front of an entity.

- **Ground** (dirt slab, light/dark grass caps) is flat → bakes safely.
- **Decor** (trees, scatter) is tall and must keep its per-cell depth so a walker
  can pass *behind* it → stays live.

Hence the `TerrainPart` prop on `EditorTerrainLayer`: the chunk path renders
`part="decor"` alongside the baked ground.

### 2. Baking is INACTIVE at native zoom

Even ground is not perfectly flat. A raised dirt lip on a cell *nearer the camera*
currently draws in front of a walker standing behind it (`dirtZ = −(col+row) −
0.5`, above a pedestrian's `−round(sum) + 0.25` when the cell is one step
nearer). One flattened image cannot reproduce that.

Rather than accept the artifact everywhere, baking engages **only below native
scale**, where the lip is a pixel or two and the walker is a handful of pixels.
Close-up, the exact per-cell path still runs.

This mirrors the zoom-out policy decision in
[REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md#-zoom-out-policy-decided-2026-08-13):
fidelity where it is legible, throughput where it is not.

> ⚠️ **`isChunkBakingActive()` is the single source of truth for that threshold.**
> Both renderers ask it — the chunk layer to decide whether to bake, the live
> layer to decide whether to emit ground or only decor. Two thresholds that
> disagree leave a zoom band drawing **no ground at all**. Note it is *not*
> `zoom < 1`: at 0.9 the level is still native, so baking is off.

---

## The seam problem (the one real risk)

**Isometric art overhangs its own cell.** The free-farm pack ships 32×32 tiles in
which the 32×16 surface diamond is one half; the dirt slab is drawn a further
`TILE_HEIGHT` *below* the anchor. So a cell whose anchor sits just outside a chunk
can still paint **into** it.

If a bake draws only the cells whose anchors fall inside its own rect, every chunk
boundary shows as a strip of clipped tree tops and missing slab edges — **a
visible grid over the world**.

The defence is `FARM_TERRAIN_OVERHANG`: bake from a rect expanded by the art's
overhang and let the excess draw off the edge of the render texture, where the
render target clips it harmlessly.

- Too **large** an overhang is free (a few redundant draws per chunk).
- Too **small** produces seams. **Err upward.**
- The same expansion applies to *invalidation* — a stale neighbour is the same bug
  arriving one edit later.

If the art direction moves to larger non-pixel-art tiles
([open item 6](./REACT_NATIVE_MIGRATION.md#technical)), `FARM_TERRAIN_OVERHANG` is
the one constant that must grow with it.

---

## Why the cell ⇄ screen math is exact

A screen-axis-aligned rectangle is **not** axis-aligned in cell space — the iso
basis is rotated, so the region it covers is a diamond. But it **is** axis-aligned
in the rotated coordinates `diag = col − row` and `sum = col + row`, because
`isoToScreen` is exactly `x = diag·W/2`, `y = −sum·H/2`.

So a screen rect converts to **exact** bounds on (diag, sum) — no approximation,
and none of the ~50% over-iteration a plain bounding box would cause.

That is the same insight [`CellWindow`](../src/engine/market/isometric.ts) already
encodes for viewport culling, which is why `cellWindowForChunk` returns a
`CellWindow` rather than a second rectangle type: **a chunk bake reuses
`buildEditorField`'s existing culling path unchanged**.

> ⚠️ Sign trap: `isoToScreen` negates `(col + row)` on Y, so a rect's **lower**
> edge (`maxY`) bounds the **minimum** sum. Getting this backwards yields a window
> that excludes every cell actually in the rect — i.e. uniformly blank chunks.

---

## Bake, cache, invalidate

| Concern | Behaviour |
|---|---|
| **Bake cost** | ~256 sprite draws into a `RenderTexture`, ~1–2 ms |
| **Frame budget** | `BAKES_PER_FRAME = 2`, drained from a queue in `useTick`, so a pan never hitches |
| **Cache** | `Map<chunkKey, RenderTexture>`, LRU by a monotonic counter, `MAX_RESIDENT_CHUNKS = 24` |
| **When baked** | On **layout change only** — terrain is immutable between edits. Never on camera change |
| **Invalidation** | `chunksForCellBounds(bounds, levels, overhang)` → only chunks overlapping the edited template, at every level. A 16×16 template touches a handful |
| **Global change** | A season / time-of-day swap dirties everything; run it behind the existing transition |
| **Atlas gating** | The layer waits for the **whole** tileset to load before baking. A bake with a half-loaded atlas *bakes the omission in*, and the gap persists until something invalidates the chunk |
| **Teardown** | Render textures are GPU memory and are not GC'd — destroyed on evict, on world change, and on unmount |

---

## Layering

| Layer | File | Contents |
|---|---|---|
| **Engine** (pure, no React/Pixi/DOM) | `src/engine/market/chunkGrid.ts` | Level ladder, chunk keys, chunk ⇄ screen rects, the inverse projection, invalidation sets, `isChunkBakingActive` |
| **View** (shared) | `src/features/nightmarket/terrainDraws.ts` | `buildDraws` — the per-cell sprite decomposition, extracted so live and baked paths cannot diverge |
| **View** (Pixi) | `src/features/nightmarket/TerrainChunkLayer.tsx` | `RenderTexture` bake, LRU, bake queue, resident-chunk sprites |
| **View** (routing) | `src/features/nightmarket/TemplateTerrainLayer.tsx` | Chooses live vs baked; renders `part="decor"` alongside the cache |

The split is deliberate: the regression-prone half is the **coordinate math**, and
putting it in `src/engine/` makes it unit-testable and keeps the engine's
zero-import invariant intact (see
[FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md)). `chunkGrid.test.ts` carries 23
assertions including an explicit seam case and the sign trap above.

---

## What still needs a human

The math is pinned by tests. **The visual result is not, and cannot be** — a seam
renders fine, throws nothing, and is invisible to any automated check.

Turn on the `chunkedTerrain` debug toggle and check, at several zoom levels:

1. **No seams** — no grid of clipped tree tops or missing slab edges along chunk
   boundaries. This is the one the overhang margin exists to prevent.
2. **No popping** at level transitions (~0.5×, 0.25×, …). Cross-fading between
   levels is designed but **not yet implemented** — expect a visible switch, and
   decide whether it is bad enough to need the fade.
3. **Pedestrian occlusion still reads correctly** just below the threshold, where
   baking first engages.
4. **`nmpPerf`** (`localStorage.nmpPerf = '1'`) — `terrain-chunks-resident` should
   settle around 8–16 and never approach the cap of 24 during ordinary panning.

---

## Known gaps

- **Cross-fade between levels is not implemented.** `levelForScale` switches
  discretely while zoom is continuous, so a level change pops. The memory budget
  already assumes ~16 resident chunks (two levels) to allow for it.
- **`chunksForCellBounds` is not yet wired to incremental edits.** The layer
  currently invalidates the *whole* cache when the world changes. That is correct,
  just coarser than necessary; the fine-grained path is written and tested but
  unused until placements can signal their own bounds.
- **Not measured at scale.** There is nothing at scale to measure yet — 8
  pedestrians, 0 stands, a handful of boards. See
  [REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md) action item 4a.

---

## Dependencies (docs ↔ code)

| This doc's section | Code it describes |
|---|---|
| The model / level ladder | `src/engine/market/chunkGrid.ts` (`CHUNK_PX`, `NATIVE_LEVEL`, `cellPxAtLevel`, `scaleForLevel`, `levelForScale`, `chunkNativeSpan`) |
| Two constraints | `src/engine/market/chunkGrid.ts` (`isChunkBakingActive`), `src/features/nightmarket/EditorTerrainLayer.tsx` (`TerrainPart`), `src/features/nightmarket/TerrainChunkLayer.tsx` (header notes 1–2) |
| The seam problem | `src/engine/market/chunkGrid.ts` (`SpriteOverhang`, `FARM_TERRAIN_OVERHANG`, `cellWindowForScreenRect`, `chunksForCellBounds`) |
| Exact cell ⇄ screen math | `src/engine/market/chunkGrid.ts` (`cellWindowForScreenRect`), `src/engine/market/isometric.ts` (`isoToScreen`, `CellWindow`) |
| Bake / cache / invalidate | `src/features/nightmarket/TerrainChunkLayer.tsx` (`bake`, `useTick` drain, LRU), `src/engine/market/farmTerrain.ts` (`buildEditorField`) |
| Layering | `src/features/nightmarket/terrainDraws.ts`, `TemplateTerrainLayer.tsx`, `docs/FRONTEND_LAYERING.md` |
| What still needs a human | `src/features/nightmarket/MarketEngineViewer.tsx` (`DebugFlags.chunkedTerrain`), `NightMarketEnginePage.tsx` (toggle button), `src/features/nightmarket/nmpPerf.ts` |
| Tests | `src/engine/market/__tests__/chunkGrid.test.ts` |

Related: [NIGHT_MARKET_FEATURE.md](./NIGHT_MARKET_FEATURE.md),
[NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md),
[REACT_NATIVE_MIGRATION.md](./REACT_NATIVE_MIGRATION.md) § Terrain chunk baking.
