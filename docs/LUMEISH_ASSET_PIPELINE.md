# Lumeish Asset Pipeline

**Status: BUILT 2026-09-09 — evaluation/test pack, not wired into any scene yet.**
No migration, no server involvement. Everything here is client-side + build tooling.

The `lumeish` pack is a 151-sprite isometric **interior furniture** set (sofas, beds,
wardrobes, desks, lamps, plus one room shell). It is a *second* art pack alongside
`free-assets/free-farm-assets`, and it did not arrive in a shape the engine could draw.
This doc describes the layer that converts it.

---

## 1. Why a conversion layer was needed

The engine positions every sprite the same way — Pixi anchor `(0.5, 1)` at the tile's
SW corner (`src/engine/market/isometric.ts`) — and that only works because
`free-farm-assets` authors every sprite inside a fixed **32×32 source cell**.

Lumeish is **tightly cropped**: 151 sprites across ~60 distinct pixel sizes, from 7×8 to
98×84, with no padding, no anchor convention, and numeric filenames (`1.png` … `151.png`)
that carry no semantics.

### What already matched (measured, not assumed)

| Property | free-farm-assets | lumeish | |
|---|---|---|---|
| Projection | 2:1 dimetric | edges advance exactly 2 px across per 1 px down | ✅ |
| Tile pitch | 32×16 diamond (`TILE_WIDTH`/`TILE_HEIGHT`) | room floor `151.png` = 96×48 = exactly 3×3 tiles; floorboards on an 8×4 sub-pitch | ✅ |
| Pixel density | 1:1, integer zoom | 1:1, no anti-aliasing | ✅ |
| Source cell | fixed 32×32 | **none — tight crop** | ❌ fixed by this pipeline |

### What still does not match, by design

- **Palette.** The two packs share **zero** exact colours. farm: 132 colours, mean
  saturation 0.62 / value 0.88. lumeish: 67 colours (Lospec *ARCHIMEDES 64*, per the
  pack's `COLOR PALETTE - CREDITS.txt`), mean saturation 0.27 / value 0.46. Mixed in one
  scene they read as two different games. Accepted for a test pack; re-evaluate before
  either ships to a user-facing surface.
- **Domain.** farm is exterior terrain/trees/characters; lumeish is interior furniture
  with no terrain, no autotile edge set, and no character. Its natural home is an
  interior scene (Immersive World), not the nmp ground plane.
- **Licensing.** The pack was purchased, so use is covered; the bundled credits file
  documents only the *palette* (Lospec ARCHIMEDES 64 by PYTHAGORAS_314). These remain **test
  assets** — the app will not ship to customers in this state, so this is not a blocker.

---

## 2. Pipeline shape

```
src/assets/test-assets/lumeish/            raw pack (tight crops + all_furniture.png sheet)
  ↓  scripts/normalize-lumeish.mjs         build-time, run by hand, output committed
src/assets/test-assets/lumeish-normalized/ 001.png … 151.png (32-aligned) + manifest.json
  ↓  import.meta.glob (pngs) + static import (manifest)
src/engine/market/lumeishTileset.ts        runtime registry (asset/lookup layer only)
  ↓  PropArt
src/engine/market/footprint.ts             shared occupancy + depth system (also the house)
```

Both asset references cross the `src/engine/` boundary, which
`src/engine/__tests__/enginePurity.test.ts` permits under its narrow `src/assets/`
carve-out — data files only, extension-gated. That carve-out was added for this pipeline
and, in the same pass, closed a blind spot: `import.meta.glob` path literals were not
scanned at all, so `freeFarmTileset`'s sprite pack had always been silently exempt. See
[FRONTEND_LAYERING.md](./FRONTEND_LAYERING.md) § "`src/engine/` imports nothing outside itself".

Run with:

```bash
npm run gen:lumeish-assets      # → node scripts/normalize-lumeish.mjs
```

It is deterministic — an unchanged input produces byte-identical output — and it **wipes
the output directory first**, so a deleted or renamed source sprite cannot leave a stale
PNG behind for the runtime glob to pick up.

**Build-time, not runtime**, deliberately: the padded result is committed and therefore
inspectable and diffable, and the app pays no per-load canvas cost. The trade is that the
script must be re-run when the raw pack changes; the registry warns to the console if the
manifest lists a file the glob did not find.

### Code
- `scripts/normalize-lumeish.mjs` — the normalizer. Depends on `pngjs` (devDependency,
  pure JS, no native build).
- `src/engine/market/lumeishTileset.ts` — the runtime registry.
- `src/engine/market/__tests__/lumeishTileset.test.ts` — pipeline-contract tests.
- `src/assets/test-assets/lumeish-normalized/manifest.json` — generated; see §5.
- `src/engine/market/footprint.ts` — the shared occupancy/placement system (§4).
- `src/engine/market/__tests__/footprint.test.ts` — its tests, including the house migration.
- `tsconfig.app.json` — `resolveJsonModule: true` was added so `tsc` can type the
  manifest import (Vite already bundles JSON natively).

---

## 3. Normalization rule

For each sprite:

1. `cells = [ceil(w / 32), ceil(h / 32)]` — the smallest whole-cell box that fits it
2. `canvas = cells * 32`
3. the sprite is **centered** in that canvas on both axes (`Math.floor` on an odd
   remainder, so the spare pixel falls *below* the object)

Resulting footprint distribution:

| Footprint | Sprites | Typical content |
|---|---|---|
| 1×1 (32×32) | 105 | chairs, stools, small props, lamps |
| 1×2 (32×64) | 28 | wardrobes, bookshelves, tall cabinets |
| 2×1 (64×32) | 9 | sofas, beds, long tables |
| 2×2 (64×64) | 8 | large corner furniture |
| 4×3 (128×96) | 1 | `151.png`, the room shell |

### Padding is loose; placement is not

Centering decides only where the art sits **inside its own canvas**. It does *not* decide
where the prop sits **on the board** — the normalizer also measures each sprite's base
front corner (`anchorTex`) and the renderer seats that on the foot cell's south vertex,
exactly as `House.png` is placed via its measured `HOUSE_BASE_CORNER`. So the loose padding
costs nothing in placement accuracy, and the earlier "everything floats half a cell" caveat
no longer applies.

`placeSprite()` in the normalizer remains the single place the padding rule lives, if you
ever want the art bottom-aligned in its canvas for other reasons.

## 3a. Multi-cell occupancy

**The padded pixel box is not the iso footprint.** A 2×1 padded canvas is 64×32 px, but in a
2:1 projection that width is spanned by a 1×1 diamond plus overhang just as easily as by a
2×1 one. The two are separate fields in the manifest (`cells` vs `isoSpan`) and they
routinely disagree.

The iso span is derived from the base diamond's geometry. An object covering
`spanX × spanY` cells has a base diamond of screen width `(spanX + spanY) · TILE_WIDTH/2`,
so pixel width alone gives only the **sum**. The split comes from where the foot sits inside
that width — the south vertex is `spanY · TILE_WIDTH/2` from the west vertex and
`spanX · TILE_WIDTH/2` from the east one, so the left/right reach from the foot is in exactly
the ratio `spanY : spanX`:

```
spanY = round(leftReach  / (TILE_WIDTH/2))
spanX = round(rightReach / (TILE_WIDTH/2))
```

Resulting occupancy across the pack:

| Iso footprint | Sprites |
|---|---|
| 1×1 | 137 |
| 1×2 | 7 |
| 2×1 | 6 |
| 3×3 | 1 (the room shell) |

**Two independent checks say this measures the real thing**, rather than producing a
plausible number:

1. The room shell `151.png` comes out **3×3**, and its floor is independently measurable as
   96×48 px — exactly 3 tiles each way.
2. **Every one of the 65 mirrored facing pairs comes out as the transpose of its partner**
   (a 2×1 sofa pairs with a 1×2 one). That is what a horizontal flip must do to a footprint,
   the two sprites are measured independently, and the measurement is told nothing about
   pairing. The normalizer asserts it and reports loudly if it ever breaks; the runtime test
   suite asserts it too.

The raw `[leftReach, rightReach]` px measurement is kept in the manifest as `reachPx`, so a
surprising span can be audited — and hand-corrected — without re-deriving it from pixels.

## 4. Facing pairs — do **not** flip at runtime

The pack authors most objects twice, as an east-facing and a west-facing copy (there is no
north/south variant). **65 of the 151 sprites pair up.**

The two copies share an exactly mirrored **silhouette** but are **independently shaded**:
the light source stays put when the object turns, so the lit and shadowed faces swap rather
than mirror. `3.png` / `4.png`, for example, have identical flipped alpha masks but differ
on 376 pixels of colour.

Consequences, both enforced in code:

- Pair detection compares **alpha only** (`isSilhouetteMirror`). A full RGBA comparison
  finds almost none of the pairs.
- Turning an object around must **swap to the sibling file** —
  `lumeishTileset.facingSibling(id)` — never `scale.x = -1`, which mirrors the lighting and
  makes the object read as lit from the wrong side.

The lower id of a pair is canonical; the higher one records `mirrorOf`.
`lumeishTileset.canonical()` returns one entry per object (canonical facings + unpaired
sprites) and is what a placement palette should list — `all()` shows each sofa twice.

---

## 5. Manifest format

`src/assets/test-assets/lumeish-normalized/manifest.json` — **generated, do not hand-edit.**

```jsonc
{
  "generatedBy": "scripts/normalize-lumeish.mjs",
  "sourcePack": "src/assets/test-assets/lumeish",
  "normalizedDir": "src/assets/test-assets/lumeish-normalized",
  "cellPx": 32,            // asserted === TILE_WIDTH at module load
  "placement": "center",   // how the art is PADDED; placement on the board uses anchorTex
  "spriteCount": 151,
  "sprites": [
    {
      "id": 4,             // from the source filename `4.png`; stable across re-runs
      "file": "004.png",   // zero-padded so the folder sorts numerically
      "cells": [2, 1],        // padded PIXEL box in 32px cells — NOT the occupancy
      "src": [42, 31],        // original tight-crop size, provenance only
      "offset": [11, 0],      // where the crop's top-left landed in the padded canvas
      "isoSpan": [2, 1],      // ISO footprint: cells occupied, w along isoX x h along isoY (§3a)
      "anchorTex": [17.5, 31],// base diamond's south vertex, PADDED coords — the seat point
      "reachPx": [6.5, 34.5], // raw [left, right] reach isoSpan was rounded from (audit)
      "mirrorOf": 3           // canonical (lower-id) opposite facing, or null
    }
  ]
}
```

`all_furniture.png` — the 576×800 sheet every sprite was sliced from — is excluded as
reference art, not a placeable asset.

---

## 6. Runtime registry API

`src/engine/market/lumeishTileset.ts` exports the singleton `lumeishTileset`. It is a
**pure asset/lookup layer**, the same layer as `freeFarmTileset` — it resolves *which URL*
and *how many tiles*, and never renders, animates, or applies the isometric transform.

| Method | Returns |
|---|---|
| `get(id)` | normalized sprite URL, or `undefined` |
| `sprite(id)` | full `LumeishSprite` record |
| `all()` / `ids()` | every sprite / every id, in manifest order |
| `canonical()` | one sprite per object (see §4) — the palette list |
| `facingSibling(id)` | the opposite facing's sprite, or `undefined` |
| `paddedCells(id)` | padded PIXEL box in cells, defaulting to `[1, 1]` |
| `pixelSize(id)` | padded canvas size in px |
| `span(id)` | **iso** footprint span (occupancy), defaulting to `{w:1,h:1}` |
| `art(id)` | the sprite as a generic `PropArt` — the shared descriptor (§6a) |
| `footprintAt(id, col, row, flip?)` | the cells it occupies when placed there |
| `anchorFraction(id)` | Pixi anchor fraction seating `anchorTex` |
| `strips(id, flip?)` | per-screen-column depth strips, memoised |
| `idOf(url)` | reverse lookup for debug labels / hit-testing |

### 6a. One placement system, shared with the house

`src/engine/market/footprint.ts` is where multi-cell props live now. It answers the three
questions any prop bigger than a cell must answer identically:

1. **which cells do I occupy** — `footprintCells`, `footprintCoversCell`, `footprintsOverlap`,
   `footprintOverlapsAny`, `footprintFitsBoard`, `footprintAt`, `footprintUnionCells`
2. **what happens when I am mirrored** — `transposeSpan` / `spanForFlip` / `placeFootprint`.
   A horizontal flip about the front corner exchanges the +isoX and +isoY spans, so a 4×5
   house mirrors to 5×4 and a 2×1 sofa to 1×2. This falls out of the projection, so it lives
   here rather than in any one prop's module.
3. **how do I depth-sort** — `PropArt` + `propStrips` + `propAnchorFraction`, wrapping
   `isometric.ts`'s strip slicer. A single sprite carries a single z, which is wrong for
   anything wider than a tile: a pedestrian beside the near-left wing would sort against the
   same depth as one beside the near-right wing.

**Before this, each of those lived somewhere different.** The house carried its own
`HOUSE_FOOTPRINT_X`/`_Y` constants and a hand-written flip rule; `placeholderArea.ts` had its
own copy of the rectangle math under placeholder-specific names; lumeish had no answer at all.
All three now run on one implementation:

| Caller | How it plugs in |
|---|---|
| `house.ts` | exports `HOUSE_ART: PropArt` (4×5, anchored on the measured `HOUSE_BASE_CORNER`); `HOUSE_STRIPS`, `HOUSE_ANCHOR`, `HOUSE_FOOTPRINT_X/Y` and the new `houseFootprint()` all derive from it |
| `placeholderArea.ts` | the `placeholder*` helpers are now thin wrappers that delegate; the domain names are kept because they read better at ~30 call sites, and `placeholderUnitSlots` genuinely is placeholder-specific. `PlaceholderArea` stays declared there because it is a **server-mirrored contract** (`server/dal/shared/placeholderArea.ts`, guarded by `src/__tests__/placeholderAreaSync.test.ts`) |
| `lumeishTileset.ts` | `art(id)` builds a `PropArt` per sprite from the manifest |

**Why a separate class from `FreeFarmTileset`:** the two packs agree on geometry and on
nothing else. farm is name-addressed (`plank_ew_2_center`), exterior, with a documented
skirt convention; lumeish is id-addressed, interior, with a centered-pad convention.
Folding them together would mean one class carrying two naming schemes and two anchor
rules.

`LUMEISH_CELL_PX` is asserted equal to `TILE_WIDTH` at module load and **throws** on
mismatch — if the tile pitch ever changes, every footprint in the manifest is silently
wrong, so this fails loudly rather than shipping misaligned furniture.

---

## 6b. Placing furniture

Furniture is placed by a single **Furniture** tool covering the whole pack, in **both** board
editors:

| Editor | Hotkey | Stored in | Tool doc |
|---|---|---|---|
| Night market template editor (nme) | `A` | the definition's `furniture` array | [NIGHT_MARKET_TEMPLATE_EDITOR.md](./NIGHT_MARKET_TEMPLATE_EDITOR.md) § *Furniture placement* |
| Immersive World scene editor | `C` | `iw_scenes.layout.furniture` | [IMMERSIVE_WORLD.md](./IMMERSIVE_WORLD.md) § *The Furniture tool* |

(The keys differ only because the home row is already full in each, differently: `A` is the iw
dirt-floor button, and `C` is the nme's copy tool.) Everything else is shared on purpose — one
catalogue (`FURNITURE_CATALOGUE`), one paging hook (`src/hooks/useArrowPagedIndex.ts`, ← / →
with press-and-hold repeat), one ghost + footprint preview, one placement rule set, one
renderer. Two palettes offering different furniture, or answering to different gestures, is the
failure this sharing exists to prevent.

What matters at THIS layer:

| Concern | Where it lives |
|---|---|
| What a placement IS | `src/engine/market/furniture.ts` — `FurniturePlacement = {col, row, id}` |
| Fits / collides / pick-by-cell | same module, delegating to `footprint.ts` |
| Art + occupancy for an id | `lumeishTileset.art / span / strips / anchorFraction` |
| Persistence | `EditorMasks.furniture` → the nme definition's `furniture` array / the iw scene's `layout.furniture` |
| Render | `FurnitureSprites.tsx` → `PropStripSprites.tsx` (shared with the house) |

**The id is the durable key.** A placement stores the manifest id (= the normalized file's
name), never a bundled URL — URLs are fingerprinted per build. A placement whose id the pack no
longer ships is **dropped at load**, so re-running the normalizer with a changed id assignment
loses placements rather than silently moving them. If ids ever need to be reassigned, that is a
migration of every stored `furniture` array, not a re-run.

**No `flip` field, by construction.** The pack ships each facing as separate,
independently-shaded art (§4), so a placement cannot express "this one, mirrored" — turning a
piece around is choosing the sibling id (`facingSibling`). This is the §4 rule made
unrepresentable rather than merely documented.

**Furniture is REFUSED only by furniture.** It may stand on any terrain, either walkability
class, any placeholder area, and any flush decor — none of those are solid objects.

**But it DISPLACES props and trees, and they displace it.** A common prop or a standing tree
(`farmTerrain.isBlockingDecorUrl`) is the one other solid thing on a board, and a cell cannot
hold two solid objects. So the second one placed REPLACES the first, in both directions:

| Action | Effect |
|---|---|
| Drop furniture over a prop/tree | the decor is cleared from **every cell of the footprint** (not just the clicked one — a 2-cell sofa over two trees clears both) |
| Drop a prop/tree on a piece of furniture | the **whole piece** is removed, from whichever of its cells was clicked |
| Drop **flush** decor (surface tufts, wood panels) | nothing is displaced either way — furniture stands on the ground, and the ground may be planked or grassy |

Replace rather than refuse, because an author dropping a tree onto a sofa means "a tree here
now"; a silent no-op would read as a broken tool. The shared half of the rule is
`furnitureBuriedDecorCells` (which cells a drop must clear) and `furnitureAt` (which piece a
prop displaces); the two `paintCell` implementations apply them, because "what does a click
mean" is tool policy rather than geometry.

Whether a piece should BLOCK MOVEMENT is a separate question, unanswered (below).

---

## 7. Open items

- [x] ~~Nothing renders these yet.~~ Placed furniture renders on every authoring surface
      (editor, Load gallery, Sandbox) via `FurnitureSprites` → `PropStripSprites`.
- [x] ~~Placement/collision UI.~~ The nme Furniture tool (§6b).
- [ ] **The RUNTIME NIGHT MARKET does not draw furniture.** (The played iw scene DOES —
      `play/IWSceneStage.tsx`.) nmp placements survive save/load but `stitchedToEditorMasks`
      does not carry them into world cells — a placement is anchored in its own template's local
      cells and needs translating by the placement origin, which means `StitchedWorld` growing a
      furniture list first.
- [x] **Walkability — HALF ANSWERED (2026-09-19), and only for iw.** In an **iw scene** a
      placed piece now blocks: dropping one stamps the scene's `unwalkable` mask over its
      **whole footprint** (the question "whole footprint or part of it?" was answered whole),
      and erasing it clears the stamp. That became possible because walkability in a scene is
      no longer derived from the sprites at all — it is an authored mask, so furniture needed
      no place in a derivation it could never have fitted (IMMERSIVE_WORLD.md § 3a).
      ⚠️ **The NIGHT MARKET half is still open**: pedestrians still walk through a sofa there,
      because the market derives movement from its street graph and nothing stamps that.
- [ ] **Style.** The two packs share zero colours (§1). Fine for test assets; a decision before
      anything ships.

**Closed:** semantic naming (not wanted — authors place sprites freely, so numeric ids are
enough); multi-cell occupancy (§3a, §6a); licensing (pack was purchased, and these are test
assets that will not ship to customers as-is).
