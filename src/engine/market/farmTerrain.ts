/**
 * farmTerrain — pure data layer describing the free-farm ground field.
 *
 * LAYER: data/model. The field is a raised **dirt** plateau (tallDirt) carrying
 * TWO stacked, contiguous, irregular grass patches:
 *   1. a **light-grass** patch in the middle of the plateau, and
 *   2. a smaller **dark-grass** patch grown ENTIRELY INSIDE the light patch — so
 *      dark grass always sits over light grass, never over bare dirt.
 * This enumerates every tile of a w×h field and, for each, resolves:
 *   - `kind` — 'grass' (inside the LIGHT patch) or 'dirt' (everything else),
 *   - `darkGrass` — whether this tile is inside the dark patch (implies light too),
 *   - `fieldEdge` — the tallDirt autotile variant for the plateau's OUTER rim
 *     (center / *Edge / *Round), from the tile's in-field neighbours,
 *   - `grassNeighbours` — the tile's 8-neighbour LIGHT-grass occupancy, used by the
 *     view to pick the light-grass-boundary overlays for dirt tiles bordering it,
 *   - `darkGrassNeighbours` — the same 8-neighbour occupancy for the DARK patch,
 *     used to spill dark-grass-boundary overlays onto light-grass tiles bordering it.
 *
 * It does NOT render — the view ({@link ../../features/nightmarket/EditorTerrainLayer}) turns these into
 * tallDirt slabs, grass caps, and (for boundary tiles) stacked grass overlays via
 * {@link freeFarmTileset.pickGrassBorderOverlays}. The dark layer is painted just
 * above the light layer so its caps/overlays win on shared tiles.
 *
 * Single elevation: grass sits FLUSH on the dirt surface (no height step), so both
 * the grass↔dirt and light↔dark transitions are drawn purely by boundary overlays,
 * not by a cliff.
 *
 * Referenced by: src/features/nightmarket/TemplateTerrainLayer.tsx and
 * templateEditorApi.ts (EditorMasks), docs/NIGHT_MARKET_FEATURE.md (Terrain
 * rendering section). The older FarmTerrainLayer consumer was deleted when the
 * template renderer superseded it.
 */

import {
  freeFarmTileset,
  PLANK_VARIATIONS,
  type Compass,
  type LandmassEdge,
  type WalkwayDirection,
} from './freeFarmTileset';
import type { PlaceholderArea } from './placeholderArea';
import type { CellWindow } from './isometric';
import { packCell, packCellKey, type CellId } from './cellKey';

/**
 * ⚠️ DEAD CODE — the PROCEDURAL farm generator has no callers left.
 *
 * `FIELD_WIDTH`/`FIELD_HEIGHT`, {@link buildFarmField}, {@link buildGrassPatch},
 * {@link buildDarkGrassPatch}, {@link resolveTileDecorUrl}, `FAMILY_DECOR_PROBABILITY`,
 * `COMMON_DECOR_PROBABILITY` and `DECOR_SEED` together generated the original single-plateau
 * market: a random light-grass patch with a dark patch grown inside it, plus scatter decor. The
 * market is now assembled from AUTHORED TEMPLATES instead ({@link buildEditorField} +
 * `templateStitch`), so nothing calls any of it.
 *
 * Its last two consumers were nmp's `GrassOverlay` and `OverlayLabels` debug overlays, which were
 * removed because they rebuilt THIS field rather than the stitched template terrain — i.e. they
 * drew a plateau unrelated to what was actually on screen.
 *
 * The block is retained for now only because it is a self-contained, reusable piece of terrain
 * generation. **It is safe to delete in full**; nothing outside this file references it except
 * two doc comments (in `freeFarmTileset.ts`). What must NOT be deleted with it: {@link FarmTile}
 * (which {@link EditorTile} extends), {@link resolveTileSurfaceUrls} and
 * {@link resolveTileDarkSurfaceUrls} — those are on the live template render path.
 */
export const FIELD_WIDTH = 20;
export const FIELD_HEIGHT = 20;

export type TileKind = 'grass' | 'dirt';

export interface FarmTile {
  /** Iso grid coordinate (east). */
  isoX: number;
  /** Iso grid coordinate (north). */
  isoY: number;
  /** Whether this tile is inside the LIGHT grass patch or bare dirt. */
  kind: TileKind;
  /**
   * Whether this tile is inside the DARK grass patch. The dark patch is grown
   * entirely inside the light patch, so `darkGrass === true` always implies
   * `kind === 'grass'` (dark grass never sits on bare dirt).
   */
  darkGrass: boolean;
  /** tallDirt autotile variant for the plateau's outer rim (field-bounds). */
  fieldEdge: LandmassEdge;
  /** 8-neighbour LIGHT-grass occupancy — drives the light overlays on dirt tiles. */
  grassNeighbours: Partial<Record<Compass, boolean>>;
  /** 8-neighbour DARK-grass occupancy — drives the dark overlays on non-dark tiles. */
  darkGrassNeighbours: Partial<Record<Compass, boolean>>;
}

/** Fraction of the field the LIGHT grass patch aims to cover. */
const GRASS_COVERAGE = 0.3;
/**
 * Fraction of the field the DARK grass patch aims to cover. Smaller than
 * {@link GRASS_COVERAGE} because the dark patch is confined inside the light
 * patch — it reads as a darker sub-region within the grass rather than a rival
 * blob. Growth may stop short of this target once it exhausts the light patch.
 */
const DARK_GRASS_COVERAGE = 0.12;
/** Keep the patch this many tiles clear of the field rim (stays interior). */
const PATCH_MARGIN = 2;
/**
 * How many one-tile bands to grow the LIGHT patch outward on its NORTH (+isoY) and
 * WEST (−isoX) faces only, AFTER the random blob is grown — a deterministic nudge
 * that fattens just those two edges (the ones facing up-left/down-left on screen)
 * without disturbing the south/east shape. See {@link dilateNorthWest}.
 */
const NORTHWEST_DILATION = 1;
/** Fixed seed so the LIGHT patch shape is stable across reloads. */
const DEFAULT_SEED = 0x9e3779b9;
/** Distinct fixed seed so the DARK patch has its own stable, different shape. */
const DARK_SEED = 0x85ebca6b;

/**
 * Per-tile decor odds for the nmp decor pass — see {@link resolveTileDecorUrl}. The
 * two rolls are mutually exclusive and tried in order: an eligible tile first rolls
 * for its **own-family** decor at {@link FAMILY_DECOR_PROBABILITY}, and only if that
 * misses rolls for the rarer **common** decor at {@link COMMON_DECOR_PROBABILITY}.
 * So ~15% of eligible tiles get family decor and ~5% of the rest (~4%) get common.
 */
export const FAMILY_DECOR_PROBABILITY = 0.15;
export const COMMON_DECOR_PROBABILITY = 0.05;

/** Fixed seed for the decor scatter so it, too, is stable across reloads. */
const DECOR_SEED = 0x7f4a7c15;

const key = (x: number, y: number) => `${x},${y}`;

/** Small, fast, deterministic PRNG (mulberry32) so the patch is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CARDINALS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Grow one contiguous, wobbly grass blob by a seeded random walk. Growth always
 * adds a cardinal neighbour of an EXISTING blob cell, guaranteeing contiguity;
 * the random walk of which cell/direction to grow gives the irregular rim.
 *
 * A cell may only join the blob if `allowed(x, y)` returns true — that gate is
 * what confines the LIGHT patch to the interior margin and the DARK patch to the
 * inside of the light patch. `start` must itself be allowed (callers guarantee it).
 * The notch-close pass shares the same gate so it never fills a disallowed cell.
 */
function growGrassBlob(
  width: number,
  height: number,
  opts: {
    seed: number;
    coverage: number;
    allowed: (x: number, y: number) => boolean;
    start: readonly [number, number];
  },
): Set<string> {
  const { seed, coverage, allowed, start } = opts;
  const rng = mulberry32(seed);
  const blob = new Set<string>();

  if (!allowed(start[0], start[1])) return blob; // nowhere valid to seed
  blob.add(key(start[0], start[1]));

  // Frontier = blob cells that still have at least one addable cardinal neighbour.
  const frontier: Array<[number, number]> = [[start[0], start[1]]];
  const target = Math.floor(width * height * coverage);

  let guard = width * height * 50; // safety bound against pathological seeds
  while (blob.size < target && frontier.length > 0 && guard-- > 0) {
    const fi = Math.floor(rng() * frontier.length);
    const [fx, fy] = frontier[fi];
    const [dx, dy] = CARDINALS[Math.floor(rng() * 4)];
    const nx = fx + dx, ny = fy + dy;
    if (!allowed(nx, ny) || blob.has(key(nx, ny))) {
      // Retire cells whose neighbours are all taken/disallowed to avoid spinning.
      const stuck = CARDINALS.every(([cx, cy]) => {
        const px = fx + cx, py = fy + cy;
        return !allowed(px, py) || blob.has(key(px, py));
      });
      if (stuck) frontier.splice(fi, 1);
      continue;
    }
    blob.add(key(nx, ny));
    frontier.push([nx, ny]);
  }
  closeGrassNotches(blob, width, height, allowed);
  return blob;
}

/**
 * Grow `blob` one tile outward on its NORTH (+isoY) and WEST (−isoX) faces only,
 * `passes` times. Each pass adds every allowed dirt tile that has grass immediately
 * to its SOUTH (so the tile extends the north rim) or to its EAST (so it extends the
 * west rim); tiles on the other two faces are left untouched. This is a directional
 * morphological dilation — a deterministic, predictable way to fatten exactly those
 * two edges (which face up-left/down-left on the iso screen). The `allowed` gate
 * keeps the growth inside the interior margin, so grass still never reaches the rim.
 * The caller must re-run {@link closeGrassNotches} afterwards to restore the
 * overlay-collision invariant.
 */
function dilateNorthWest(
  blob: Set<string>,
  width: number,
  height: number,
  allowed: (x: number, y: number) => boolean,
  passes: number,
): void {
  for (let p = 0; p < passes; p++) {
    const toAdd: Array<[number, number]> = [];
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (blob.has(key(x, y)) || !allowed(x, y)) continue;
        const grassToSouth = blob.has(key(x, y - 1)); // (x,y) extends the north rim
        const grassToEast = blob.has(key(x + 1, y));  // (x,y) extends the west rim
        if (grassToSouth || grassToEast) toAdd.push([x, y]);
      }
    }
    for (const [x, y] of toAdd) blob.add(key(x, y));
  }
}

/**
 * Build the LIGHT grass patch: a blob kept `PATCH_MARGIN` tiles inside the field
 * so grass never reaches the plateau edge (boundary overlays therefore always
 * have a dirt tile to sit on). Grows from the field centre, then dilates its
 * north/west faces a little ({@link NORTHWEST_DILATION}) so those two edges reach
 * a bit further while the south/east shape stays put.
 */
export function buildGrassPatch(
  width: number,
  height: number,
  seed: number = DEFAULT_SEED,
): Set<string> {
  const minX = PATCH_MARGIN, maxX = width - 1 - PATCH_MARGIN;
  const minY = PATCH_MARGIN, maxY = height - 1 - PATCH_MARGIN;
  if (maxX < minX || maxY < minY) return new Set(); // field too small for a patch

  const allowed = (x: number, y: number) =>
    x >= minX && x <= maxX && y >= minY && y <= maxY;
  const start = [Math.floor(width / 2), Math.floor(height / 2)] as const;
  const blob = growGrassBlob(width, height, { seed, coverage: GRASS_COVERAGE, allowed, start });
  // Fatten just the north/west edges, then re-close notches the dilation may open.
  dilateNorthWest(blob, width, height, allowed, NORTHWEST_DILATION);
  closeGrassNotches(blob, width, height, allowed);
  return blob;
}

/**
 * Build the DARK grass patch, confined to the inside of an already-built LIGHT
 * `patch`. The `allowed` gate is light-patch membership, so every dark cell is
 * also a light cell — dark grass always sits over light grass, never on dirt.
 * Grows from the field centre (always a light-patch member — {@link buildGrassPatch}
 * seeds there); falls back to any light cell if the centre somehow isn't light.
 *
 * Because the light patch is itself notch-closed and the dark gate is a subset of
 * it, the dark notch-close can only fill cells with ≥3 dark (hence ≥3 light)
 * cardinals, which are guaranteed light — so it never escapes the light patch.
 */
export function buildDarkGrassPatch(
  width: number,
  height: number,
  patch: Set<string>,
  seed: number = DARK_SEED,
): Set<string> {
  if (patch.size === 0) return new Set();
  const allowed = (x: number, y: number) => patch.has(key(x, y));

  const centre = [Math.floor(width / 2), Math.floor(height / 2)] as const;
  const start = allowed(centre[0], centre[1])
    ? centre
    : ((): readonly [number, number] => {
        // Centre not in the light patch (unusual): seed at any light cell.
        const first = patch.values().next().value as string;
        const [x, y] = first.split(',').map(Number);
        return [x, y] as const;
      })();

  return growGrassBlob(width, height, { seed, coverage: DARK_GRASS_COVERAGE, allowed, start });
}

/**
 * Morphological "close": fill any DIRT tile that has grass on ≥3 of its 4
 * cardinal sides into grass, repeating until stable. Such a tile is a one-tile
 * dirt notch/hole poking into the blob, and the tileset ships no clean overlay
 * for it — three (or four) full-edge grass spills would collide at the shared
 * vertices. Filling them guarantees the renderer's invariant: **every dirt tile
 * borders grass on at most two cardinals**, so the grass-boundary autotiler
 * ({@link freeFarmTileset.pickGrassBorderOverlays}) only ever needs the
 * straight-edge and single inner-corner pieces, which never overlap.
 *
 * Iterated because filling one notch can expose another (e.g. a two-tile dirt
 * slit). Rim tiles can never reach 3 grass cardinals (grass is kept ≥
 * PATCH_MARGIN inside the field), so this never pushes grass onto the plateau
 * edge — boundary overlays always retain a dirt tile to sit on.
 *
 * `allowed` gates which cells may be filled (mirrors {@link growGrassBlob}'s gate)
 * so the dark patch's close never escapes the light patch; the light patch passes
 * its interior-margin gate. Defaults to allow-all.
 */
function closeGrassNotches(
  blob: Set<string>,
  width: number,
  height: number,
  allowed: (x: number, y: number) => boolean = () => true,
): void {
  const isGrass = (x: number, y: number) => blob.has(key(x, y));
  let changed = true;
  while (changed) {
    changed = false;
    const toFill: Array<[number, number]> = [];
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (isGrass(x, y) || !allowed(x, y)) continue;
        const grassCardinals =
          (isGrass(x, y + 1) ? 1 : 0) + // n
          (isGrass(x + 1, y) ? 1 : 0) + // e
          (isGrass(x, y - 1) ? 1 : 0) + // s
          (isGrass(x - 1, y) ? 1 : 0);  // w
        if (grassCardinals >= 3) toFill.push([x, y]);
      }
    }
    for (const [x, y] of toFill) {
      blob.add(key(x, y));
      changed = true;
    }
  }
}

/**
 * Resolve the LIGHT-layer SURFACE sprite URLs painted on a tile:
 *   - light-grass tile → a single light-grass cap in the tile's OWN `fieldEdge`
 *     variant, so a grass tile sitting on a rim/rounded tallDirt slab is clipped
 *     to the same silhouette instead of a full `_center` diamond overhanging it
 *     (the grass pack ships the identical LandmassEdge set as tallDirt),
 *   - dirt tile bordering grass → the stacked light-grass-boundary overlays chosen
 *     from its 8 grass neighbours,
 *   - interior dirt → none (its own dirt top face shows).
 *
 * Shared by the {@link ../../features/nightmarket/EditorTerrainLayer} view (which paints these) and the nmp
 * overlay-tile debug overlay (which labels them via {@link freeFarmTileset.stemOf}),
 * so both name/paint the exact same sprites. Does NOT include the tallDirt slab —
 * that is the plateau body, not a surface sprite — nor the dark layer (see
 * {@link resolveTileDarkSurfaceUrls}), which the view stacks on top separately.
 */
export function resolveTileSurfaceUrls(tile: FarmTile): string[] {
  if (tile.kind === 'grass') {
    const grassUrl = freeFarmTileset.getGrassBase('light', tile.fieldEdge);
    return grassUrl ? [grassUrl] : [];
  }
  return freeFarmTileset.pickGrassBorderOverlays('light', tile.grassNeighbours);
}

/**
 * Resolve the DARK-layer SURFACE sprite URLs painted on a tile, stacked ABOVE the
 * light layer so dark caps/overlays win on shared tiles:
 *   - dark-grass tile → a single dark-grass cap in the tile's own `fieldEdge`
 *     variant (over its light cap), matching the rim/rounded slab underneath,
 *   - non-dark tile bordering dark grass → the stacked dark-grass-boundary overlays
 *     chosen from its 8 dark neighbours (these spill onto light-grass tiles, since
 *     the dark patch lives inside the light one),
 *   - a tile with no dark grass nearby → none.
 *
 * Mirrors {@link resolveTileSurfaceUrls} but for the dark palette + occupancy.
 */
export function resolveTileDarkSurfaceUrls(tile: FarmTile): string[] {
  if (tile.darkGrass) {
    const grassUrl = freeFarmTileset.getGrassBase('dark', tile.fieldEdge);
    return grassUrl ? [grassUrl] : [];
  }
  return freeFarmTileset.pickGrassBorderOverlays('dark', tile.darkGrassNeighbours);
}

/**
 * A deterministic PRNG seeded for the decor scatter pass. The view walks the field
 * in {@link buildFarmField} order, calling {@link resolveTileDecorUrl} with this
 * single rng, so the whole decor layer is reproducible across reloads (same seed →
 * same scatter) yet independent of the grass-patch rng.
 */
export function createDecorRng(seed: number = DECOR_SEED): () => number {
  return mulberry32(seed);
}

/**
 * Decor scatter pass: decide the single decoration sprite drawn on top of a
 * finished tile, or `null` for none. Called AFTER the terrain/overlays are
 * resolved.
 *
 * Rules:
 *  - A tile that already carries **overlay tiles** on either layer (a dirt tile
 *    bordering light grass, or a light/dirt tile bordering dark grass — its diamond
 *    is busy with spilled boundary overlays) is skipped. Flush base caps (a light or
 *    dark `_center`) are not busy, so grass tiles stay eligible.
 *  - Two **mutually exclusive** rolls, own-family first: an eligible tile rolls for
 *    **own-family** decor (dark-grass → the dark-grass set; light-grass → the
 *    light-grass set; interior dirt → the dirt set) at {@link FAMILY_DECOR_PROBABILITY},
 *    and only if that misses rolls for the shared **common** set at
 *    {@link COMMON_DECOR_PROBABILITY}. At most one decor sprite per tile.
 *
 * `rng` is consumed deterministically for every eligible tile (family gate, then a
 * pick or the common gate, then a pick), so the scatter is stable as long as the
 * field and seed are.
 */
export function resolveTileDecorUrl(tile: FarmTile, rng: () => number): string | null {
  // Skip tiles that render boundary overlays on either layer (visually busy).
  const lightBusy = tile.kind === 'dirt' && resolveTileSurfaceUrls(tile).length > 0;
  const darkBusy = !tile.darkGrass && resolveTileDarkSurfaceUrls(tile).length > 0;
  if (lightBusy || darkBusy) return null;

  // Own-family decor roll first (dark patch on top → dark family wins on its tiles).
  const familyDecor = tile.darkGrass
    ? freeFarmTileset.getDecorUrls('darkGrass')
    : tile.kind === 'grass'
      ? freeFarmTileset.getDecorUrls('lightGrass')
      : freeFarmTileset.getDecorUrls('dirt');
  if (familyDecor.length > 0 && rng() < FAMILY_DECOR_PROBABILITY) {
    return familyDecor[Math.floor(rng() * familyDecor.length)];
  }

  // Otherwise a rarer common-decor roll.
  const commonDecor = freeFarmTileset.getDecorUrls('common');
  if (commonDecor.length > 0 && rng() < COMMON_DECOR_PROBABILITY) {
    return commonDecor[Math.floor(rng() * commonDecor.length)];
  }

  return null;
}

// ── Editor field (mask-driven) ───────────────────────────────────────────────
// The template editor (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md) drives terrain from
// PAINTED masks instead of the procedural blob growth above. buildEditorField takes
// explicit terrain-1 / terrain-2 cell sets and a rectangular W×H board, and produces
// tiles the editor view renders. It reuses the exact same per-tile neighbour →
// overlay-cap resolution as buildFarmField (via the shared resolveTile* helpers), so
// "recompute the overlay caps on each paint" is just a rebuild: repaint a mask, rebuild
// the field, re-derive every tile's neighbours. The street/communal walkability masks
// render as spriteless tints (drawn straight from the mask by the viewer), so they do
// NOT flow through the field.

/**
 * The painted layers, cells keyed "col,row" (= isoX,isoY). The terrain + walkability
 * layers (terrain1/terrain2/street/communal/…) are boolean membership Sets; `decor` is
 * a per-cell CHOICE (cell → decor sprite URL) because a cell carries at most one
 * decoration picked from a rotation.
 */
export interface EditorMasks {
  /**
   * Terrain-1 mask cells, each "col,row". Currently rendered with the LIGHT-grass
   * tileset, but named generically ("terrain 1") so the surface art can be hot-swapped
   * later without renaming the mask. The tileset mapping lives at the render seam
   * (`editorDecorRotation` + {@link buildEditorField} → {@link resolveTileSurfaceUrls}).
   */
  terrain1: Set<string>;
  /**
   * Terrain-2 mask cells, each "col,row" — a fully INDEPENDENT mask currently rendered
   * with the DARK-grass tileset. Terrain 2 is unconstrained by terrain 1: a terrain-2
   * cell renders whether or not terrain 1 is underneath it. Its only relationship to
   * terrain 1 is z-order — terrain 2 always renders ON TOP of terrain 1 (the view stacks
   * the dark surface above the light one in {@link ../../features/nightmarket/EditorTerrainLayer}).
   */
  terrain2: Set<string>;
  /**
   * Street-walkable annotation cells (the street-walkable class — see the walkability
   * classes in docs/NIGHT_MARKET_TEMPLATES.md). Like {@link communal} this is a
   * WALKABILITY class rendered as a spriteless HIGHLIGHT TINT only (the editor draws no
   * sprite for it), so it never feeds the surface/decor rendering and is intentionally
   * absent from {@link EditorTile}/{@link buildEditorField}. Mutually exclusive with
   * {@link communal} (a cell is street-walkable OR communal-walkable, not both) AND with
   * BLOCKING common/tree {@link decor} (see {@link isBlockingDecorUrl}): those overwrite it
   * when painted, and it is refused where one already sits. Grass terrain and flush
   * surface-family decor may coexist with it.
   */
  street: Set<string>;
  /**
   * Communal-walkable annotation cells (parks / plazas — see the walkability
   * classes in docs/NIGHT_MARKET_TEMPLATES.md). This is a WALKABILITY class only:
   * it renders NO sprite of its own — the editor merely highlights these cells —
   * and never feeds the surface/decor rendering, so it is intentionally
   * absent from {@link EditorTile}/{@link buildEditorField}. Mutually exclusive
   * with {@link street} (a cell is street-walkable OR communal-walkable, not both)
   * AND with BLOCKING common/tree {@link decor} (see {@link isBlockingDecorUrl}): those
   * overwrite it when painted, and it is refused where one already sits. Flush
   * surface-family decor may coexist with it.
   */
  communal: Set<string>;
  /**
   * Placeholder areas (see the placeholder areas in docs/NIGHT_MARKET_TEMPLATES.md) —
   * occupant slots a future unlock asset can later fill. Each is a fixed-size rectangle
   * DROPPED by the placeholder tool (4×5 / 5×4 / 4×10 / 10×4 — see {@link PlaceholderArea} /
   * {@link ./placeholderArea}), stored as its own `{col,row,w,h}` record so two *adjacent*
   * slots stay DISTINCT (a flat cell mask could not tell them apart). Like {@link communal}
   * these are ANNOTATIONS: they render no sprite (the editor highlights them), do not feed
   * surface/plank/decor rendering, and are absent from {@link EditorTile}/{@link buildEditorField}.
   * Unlike the walkability classes they are an OVERRIDE overlay, so an area may overlap any
   * surface (grass / street / communal) freely — but areas may not overlap EACH OTHER.
   */
  placeholder: PlaceholderArea[];
  /**
   * Condition-mask cells — a PER-VERSION annotation (the conditional cell-class rules
   * that differ between template versions; see docs/NIGHT_MARKET_TEMPLATE_EDITOR.md).
   * Like {@link placeholder} it renders no sprite (the editor highlights it in its own
   * colour), does not feed surface/plank/decor rendering, and is absent from
   * {@link EditorTile}/{@link buildEditorField}. It is an OVERRIDE overlay, so it may
   * overlap any surface freely — no mutual exclusion.
   */
  condition: Set<string>;
  /** cell "col,row" → the chosen decor sprite URL for that cell. */
  decor: Map<string, string>;
  /**
   * The board-wide default FLOOR — what a cell shows when no terrain mask covers it.
   * NOT a cell mask: it is one setting for the whole board, carried here so it reaches
   * {@link buildEditorField} through the same object every painted layer travels in
   * (and therefore needs no new prop on the shared viewer).
   *
   * OMITTED ⇒ {@link DIRT_FLOOR} — bare dirt, the night market's only floor and the
   * behavior every pre-existing board keeps. The iw scene editor is the one surface that
   * sets it today (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
   */
  floor?: BoardFloor;
}

/**
 * The board-wide default floor: what an UNPAINTED cell (no terrain 1, no terrain 2)
 * renders as.
 *
 *   `dirt` — the bare tallDirt plateau top face shows, as it always has.
 *   `wood` — a wooden plank deck covers every bare cell instead (see
 *            {@link woodFloorPlankUrl}). The dirt slab is still drawn beneath it: the
 *            plank pack ships a flat 3px-thick board with no cliff body, so the slab
 *            remains the thing that gives the plateau its height.
 *
 * `seed` FREEZES the random grain. Every wood cell picks its board-pattern variation
 * from a hash of (seed, col, row), so the deck is stable across reloads, camera moves
 * and board resizes — and re-rolling the seed is what "shuffle the planks" means. It is
 * meaningless when `kind` is `dirt` and is kept only so a toggle back to wood restores
 * the same deck.
 */
export interface BoardFloor {
  kind: 'dirt' | 'wood';
  /** 32-bit seed frozen when the author chose this floor. */
  seed: number;
}

/** The default floor of every board that does not say otherwise. */
export const DIRT_FLOOR: BoardFloor = { kind: 'dirt', seed: 0 };

/** A fresh 32-bit floor seed — a new random plank grain. */
export function rollFloorSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/**
 * Mix a seed with a cell into a 32-bit hash. A plain multiplicative mix (xorshift +
 * `Math.imul` rounds, the mulberry32 family) rather than a PRNG SEQUENCE, because the
 * render walks cells in whatever order the window culls to — a sequence would give the
 * same cell a different plank depending on where the camera started.
 */
function hashCell(seed: number, col: number, row: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (col * 0x85ebca6b), 0xcc9e2d51) >>> 0;
  h = Math.imul(h ^ (row * 0xc2b2ae35), 0x1b873593) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * The single iso direction every plank on a wood floor runs in, derived from the seed.
 *
 * ONE DIRECTION PER BOARD, deliberately: a deck whose boards alternate `ns`/`ew` cell by
 * cell reads as debris rather than as floor, and it would also fire the far-end edge cap
 * on almost every cell (a `ns` neighbour does not continue an `ew` run — see
 * {@link plankRenderUrl}). Only the board PATTERN varies per cell.
 */
export function woodFloorDirection(seed: number): WalkwayDirection {
  return hashCell(seed, 0, 0) & 1 ? 'ns' : 'ew';
}

/**
 * The plank CENTER a wood-floor cell draws, before the far-end cap autotile. Returns
 * undefined only if the pack is missing that stem, in which case the caller falls back
 * to the bare dirt top face.
 */
function woodFloorCenterUrl(seed: number, col: number, row: number): string | undefined {
  const dir = woodFloorDirection(seed);
  const variation = PLANK_VARIATIONS[hashCell(seed, col, row) % PLANK_VARIATIONS.length];
  return freeFarmTileset.getPlank(dir, variation, 'center');
}

/**
 * The plank sprite a wood-floor cell renders: its seeded center, swapped for the far-end
 * EDGE cap wherever the deck stops ({@link plankRenderUrl}). `isWoodAt` reports whether a
 * neighbouring cell is also wood floor, so a deck caps against grass, against another
 * surface and against the board edge alike. Null ⇒ no plank art; show dirt.
 *
 * ⚠️ The pack ships NO rim-clipped plank variants (planks have one silhouette, unlike the
 * grass caps' full `LandmassEdge` set), so a plank on a board-EDGE cell keeps its full
 * diamond over a rounded slab rim. A few pixels of board overhang the rim there. Fixing it
 * needs art, not code.
 */
export function woodFloorPlankUrl(
  seed: number,
  col: number,
  row: number,
  isWoodAt: (x: number, y: number) => boolean,
): string | null {
  const center = woodFloorCenterUrl(seed, col, row);
  if (!center) return null;
  return plankRenderUrl(center, isWoodAt, col, row);
}

/**
 * {@link EditorMasks} reduced to just the layers {@link buildEditorField} reads, re-keyed by
 * PACKED cell id ({@link ../cellKey packCell}) instead of `"col,row"` strings.
 *
 * WHY A SEPARATE TYPE. `EditorMasks` is the AUTHORING and WIRE shape: the editor paints into it
 * and {@link ./templateDefinition} persists it as string-keyed JSON. Both are string-keyed for
 * good reason and neither is hot. The RENDER path is hot — `buildEditorField` probes these masks
 * ~20–25 times per visible cell — so it consumes this compiled form instead, and the conversion
 * happens once per mask change rather than once per probe.
 *
 * The walkability/annotation layers (street/communal/placeholder/condition) are deliberately
 * absent: they render no sprite and `buildEditorField` never reads them, so compiling them would
 * be pure waste.
 *
 * ⚠️ CALLERS MUST MEMOISE. {@link compileMasks} is O(painted cells); fold it into whatever memo
 * already guards the masks (every call site does — see the callers of `buildEditorField`).
 * Compiling per render would trade a per-cell cost for a per-frame one.
 */
export interface CompiledMasks {
  terrain1: Set<CellId>;
  terrain2: Set<CellId>;
  decor: Map<CellId, string>;
  /** Copied through verbatim — a board-wide setting has nothing to re-key. */
  floor: BoardFloor;
}

/**
 * Compile the string-keyed authoring masks into the packed form the render loop consumes.
 * One pass over the painted cells; see {@link CompiledMasks} for why this is a separate step.
 */
export function compileMasks(masks: EditorMasks): CompiledMasks {
  const terrain1 = new Set<CellId>();
  const terrain2 = new Set<CellId>();
  const decor = new Map<CellId, string>();
  for (const cell of masks.terrain1) terrain1.add(packCellKey(cell));
  for (const cell of masks.terrain2) terrain2.add(packCellKey(cell));
  for (const [cell, url] of masks.decor) decor.set(packCellKey(cell), url);
  return { terrain1, terrain2, decor, floor: masks.floor ?? DIRT_FLOOR };
}

/**
 * The paintable surface a cell resolves to, which selects its family-decor rotation.
 * `terrain1`/`terrain2` are the generic (hot-swappable) names for what currently render
 * as light/dark grass; `dirt` is the bare board.
 */
export type EditorSurface = 'dirt' | 'terrain1' | 'terrain2';

/**
 * The four decor tools, each its own rotation (see {@link editorDecorRotation}):
 *   - `family` — the cell's SURFACE-SPECIFIC set (lightGrass/darkGrass/dirt decor),
 *   - `common` — the surface-agnostic `decor_*` scatter set,
 *   - `tree`   — the standing trees (`tree_*`, `largeTree_*`),
 *   - `plank`  — the wooden-slab "wood panel" tiles (see {@link editorPlankCenters}).
 * Each is a separate palette button so authors pick a category deliberately rather
 * than cycling blindly through one merged list. The active tool's variant is chosen
 * with SPACE in the editor (cycles the rotation) and previewed as a ghost sprite.
 */
export type DecorCategory = 'family' | 'common' | 'tree' | 'plank';

/**
 * The plank ("wood panel") variant cycle: the flat CENTER tile in each iso
 * orientation (`ns`/`ew`) × board-pattern variation ({@link PLANK_VARIATIONS}). These
 * are what SPACE cycles through and what a placed plank stores; the render layer then
 * swaps a center for its far-end EDGE cap wherever that face abuts a non-plank cell
 * (see {@link plankRenderUrl}), so authors only ever pick the flat tile. Missing pack
 * stems are skipped. Surface-agnostic (a plank looks the same on any terrain).
 */
export function editorPlankCenters(): string[] {
  const urls: string[] = [];
  for (const dir of ['ns', 'ew'] as WalkwayDirection[]) {
    for (const variation of PLANK_VARIATIONS) {
      const url = freeFarmTileset.getPlank(dir, variation, 'center');
      if (url) urls.push(url);
    }
  }
  return urls;
}

/** Whether a resolved decor url is a plank tile (`plank_{dir}_{var}_{cap}` stem). */
export function isPlankUrl(url: string): boolean {
  const stem = freeFarmTileset.stemOf(url);
  return !!stem && stem.startsWith('plank_');
}

/** Parse a plank stem into its iso direction + board-pattern variation (null if not a plank). */
function parsePlankStem(stem: string | undefined): { dir: WalkwayDirection; variation: number } | null {
  if (!stem) return null;
  const m = /^plank_(ew|ns)_(\d+)_/.exec(stem);
  return m ? { dir: m[1] as WalkwayDirection, variation: Number(m[2]) } : null;
}

/**
 * Autotile a placed plank CENTER into its rendered sprite: a plank shows its far-end
 * EDGE cap (`eastEdge` for `ew` / +isoX, `northEdge` for `ns` / +isoY — the only two
 * faces the pack caps — see the `PlankCap` docs in {@link ./freeFarmTileset}) whenever
 * that far neighbour is
 * NOT itself a plank; otherwise it stays the flat `center`. `isPlankAt` reports whether
 * a given cell currently holds any plank decor. Non-plank urls pass through unchanged.
 */
export function plankRenderUrl(
  centerUrl: string,
  isPlankAt: (x: number, y: number) => boolean,
  x: number,
  y: number,
): string {
  const parsed = parsePlankStem(freeFarmTileset.stemOf(centerUrl));
  if (!parsed) return centerUrl;
  const { dir, variation } = parsed;
  // The capped face: east neighbour for ew (+isoX), north neighbour for ns (+isoY).
  const [fx, fy] = dir === 'ew' ? [x + 1, y] : [x, y + 1];
  if (isPlankAt(fx, fy)) return centerUrl; // abuts another plank → flat mid-run tile
  const cap = dir === 'ew' ? 'eastEdge' : 'northEdge';
  return freeFarmTileset.getPlank(dir, variation, cap) ?? centerUrl;
}

/**
 * The surface a cell resolves to from the painted masks: `terrain2` if in the terrain-2
 * mask (it renders on top, so it wins the surface identity), else `terrain1` if in the
 * terrain-1 mask, else `dirt`. The two terrain masks are INDEPENDENT — terrain 2 does not
 * require terrain 1 beneath it. Takes just the two terrain masks it reads, so callers
 * needn't build a full {@link EditorMasks} to query a cell's surface.
 */
export function editorSurfaceAt(
  masks: Pick<EditorMasks, 'terrain1' | 'terrain2'>,
  col: number,
  row: number,
): EditorSurface {
  const k = key(col, row);
  if (masks.terrain2.has(k)) return 'terrain2';
  if (masks.terrain1.has(k)) return 'terrain1';
  return 'dirt';
}

/**
 * The ordered decor URLs one decor tool cycles through. Each of the three tools has
 * its OWN rotation: `family` → the cell surface's own decor set (so it depends on
 * `surface`); `common` → the shared `decor_*` set; `tree` → the standing trees.
 * Repeated placement with the same tool on a cell advances through its list
 * (wrapping); see the decor tools in TemplateEditorPage.
 */
export function editorDecorRotation(category: DecorCategory, surface: EditorSurface): string[] {
  switch (category) {
    // Map the generic terrain surface → its current tileset decor bucket. This is the
    // render seam: a future terrain art hot-swap changes only this mapping, not the mask.
    case 'family': {
      const bucket = surface === 'terrain1' ? 'lightGrass'
        : surface === 'terrain2' ? 'darkGrass'
        : 'dirt';
      return freeFarmTileset.getDecorUrls(bucket);
    }
    case 'common': return freeFarmTileset.getDecorUrls('common');
    case 'tree': return freeFarmTileset.getTreeUrls();
    case 'plank': return editorPlankCenters();
  }
}

/**
 * Whether a decor sprite URL is a BLOCKING object — `common` decor (`decor_*`) or a
 * standing `tree` (`tree_*`/`largeTree_*`) — as opposed to a flush surface-`family`
 * decor. Blocking objects are mutually exclusive with the communal-walkable class in
 * the template editor: a park/plaza tile may carry flush surface flora but not a tree
 * or prop. Delegates to the
 * tileset's own URL buckets so it stays single-sourced with the decor indexing (the
 * `family` sets — lightGrass/darkGrass/dirt — and the `plank` wood panels are
 * intentionally NOT blocking: they lie flush and stay walkable).
 */
export function isBlockingDecorUrl(url: string): boolean {
  return freeFarmTileset.getDecorUrls('common').includes(url)
    || freeFarmTileset.getTreeUrls().includes(url);
}

/**
 * Whether a decor sprite URL is a **dirt-family** decoration (`dirtDecor_*`) — the flush
 * ground details that belong on bare dirt. These render BELOW the grass surface sprites (a
 * lower z than the light/dark grass caps + boundary overlays) so that grass painted over — or
 * spilling onto — the cell covers them, reading as a ground detail the grass grows over. Every
 * other decor family (lightGrass/darkGrass family, common, tree) stays ABOVE the surface.
 * Single-sourced against the tileset's own `dirt` bucket, mirroring {@link isBlockingDecorUrl}.
 * Consumed by the view layers ({@link ../../features/nightmarket/EditorTerrainLayer},
 * {@link ../../features/nightmarket/EditorTerrainLayer}) to pick the decor z-slot.
 */
export function isDirtDecorUrl(url: string): boolean {
  return freeFarmTileset.getDecorUrls('dirt').includes(url);
}

/**
 * Classify a decor sprite URL into the {@link DecorCategory} of the tool that PLACES it,
 * so the editor's per-tool eraser (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md) removes a cell's
 * single decor sprite only when it belongs to the currently-selected decor tool: `common`
 * (`decor_*`) or `tree` (`tree_*`/`largeTree_*`) fall to their own tools, and everything
 * else — the surface-specific `lightGrass`/`darkGrass`/`dirt` decor — is `family`
 * (matching the Surface-decor tool, whose rotation is surface-dependent). Single-sourced
 * with {@link isBlockingDecorUrl} against the tileset's own buckets.
 */
export function editorDecorCategory(url: string): DecorCategory {
  if (isPlankUrl(url)) return 'plank';
  if (freeFarmTileset.getDecorUrls('common').includes(url)) return 'common';
  if (freeFarmTileset.getTreeUrls().includes(url)) return 'tree';
  return 'family';
}

/** A {@link FarmTile} plus the editor's per-cell painted decor choice. */
export interface EditorTile extends FarmTile {
  /**
   * The chosen decor sprite URL for this cell, or null for none. The street mask is a
   * spriteless tint and does not suppress decor (family decor coexists with a street).
   */
  decorUrl: string | null;
  /**
   * The wooden-deck plank this cell draws INSTEAD of the bare dirt top face, or null for the
   * ordinary dirt floor. Only ever set on cells no terrain mask covers, and only when the
   * board's {@link BoardFloor} is `wood` — see {@link woodFloorPlankUrl}.
   *
   * It REPLACES this cell's ground, it does not stack on it — `terrainDraws.buildDraws` skips
   * both the tallDirt slab and the surface sprites on a decked cell. (No grass-boundary overlay
   * either: grass spilling onto a plank deck reads as a mistake, and the deck's own far-end edge
   * cap is what should meet the grass.) At the board RIM that means a 3px board edge where a
   * dirt cell would show a 16px wall — the pack has no wooden cliff body.
   */
  floorUrl: string | null;
  /**
   * True when this cell's tallDirt slab is FULLY HIDDEN and can be skipped — halving the sprite
   * count over a field of ordinary grass.
   *
   * The slab covers its own diamond plus a `TILE_HEIGHT` cliff band below it. Both are occluded when:
   *   (a) the cell has a cap of its own that covers the diamond — a grass cap (`kind === 'grass'`)
   *       or a wood-floor plank ({@link floorUrl}; every plank sprite, cap variants included,
   *       has exactly the grass cap's silhouette plus 3px of board thickness above it) — AND
   *   (b) its S, W and SW neighbours are in-field, whose tiles between them cover the band and all
   *       sort ABOVE this slab (`z = −(col + row)`, so a nearer cell always wins).
   *
   * A dirt cell must keep its slab — the slab's top face IS its visible surface.
   */
  slabHidden: boolean;
}

/**
 * Build a rectangular `width`×`height` editor field from painted masks. Terrain 1 and
 * terrain 2 are FULLY INDEPENDENT masks: each renders from its own painted cells, and
 * terrain 2 does not require terrain 1 beneath it — their only relationship is z-order
 * (the view stacks the terrain-2/dark surface above the terrain-1/light one). This differs
 * from buildFarmField, whose procedural dark patch is grown inside the light patch.
 * `fieldEdge` uses the field-membership occupancy so the plateau rim autotiles cleanly —
 * for a single board that is the rectangle; for a multi-template continent (see
 * {@link TerrainField}) it is the union of placement footprints, so the rim hugs the real
 * silhouette. The street/communal masks are spriteless tints and do not flow through here.
 */

/**
 * A GLOBAL iteration window + field-membership test for {@link buildEditorField}. The RUNTIME
 * uses this to paint a MULTI-template continent whose silhouette is the union of placement
 * footprints (non-rectangular when templates tile into an L/T) and whose cells live at global —
 * possibly negative — coordinates. `contains` drives BOTH which cells get a ground tile (only
 * in-field cells) and the `fieldEdge` plateau rim (a cell's 4-neighbour in-field occupancy).
 *
 * OMITTED ⇒ the editor's single-board default: origin (0,0) and the full [0,width)×[0,height)
 * rectangle is in-field, matching the pre-multi-template behavior exactly.
 */
export interface TerrainField {
  /** Global min-corner the iteration starts from (inclusive). */
  originCol: number;
  originRow: number;
  /** Whether a GLOBAL cell belongs to the field (runtime: union of placement footprints). */
  contains: (col: number, row: number) => boolean;
  /**
   * Whether a GLOBAL cell is APRON — in-field ground that no template painted, i.e. the default
   * surface nmp pads around the market so the viewport is never bare (see {@link padTerrainField}).
   * Apron cells render as the default tallDirt + lightGrass and take part in the light-grass
   * autotiling, so template grass meets them seamlessly. Omitted ⇒ no apron (editor/sandbox).
   */
  apron?: (col: number, row: number) => boolean;
}

/**
 * Grow `field` outward by `pad` cells on every side, making the padded ring APRON: default ground
 * that carries no painted masks. The returned span/origin replace the caller's, so
 * {@link buildEditorField} paints the enlarged field.
 *
 * Every cell in the padded rectangle becomes in-field — including holes INSIDE the original
 * silhouette (the empty corner of an L-shaped layout). That is intentional: with a default ground
 * apron the market is no longer a floating island, so an interior gap should read as ordinary
 * ground rather than as a hole punched through to the background.
 *
 * `boundless` decouples MEMBERSHIP from what is DRAWN: `contains` becomes true everywhere, while
 * the returned span still bounds iteration to the padded ring. That is what lets nmp draw a thin
 * ring of real autotiled tiles and leave the rest of the viewport to the flat
 * {@link ../../features/nightmarket/GroundBackdropLayer} — the ring's outermost cells still see
 * ground on all sides, so they autotile as interior `center` tiles and match the backdrop exactly
 * instead of drawing a plateau cliff at the ring's edge. Without it, `pad` would have to cover the
 * camera's entire zoomed-out reach (tens of thousands of cells).
 *
 * `pad = 0` returns the field unchanged (no apron predicate), preserving the pre-apron behavior.
 */
export function padTerrainField(
  field: TerrainField,
  width: number,
  height: number,
  pad: number,
  boundless = false,
): { field: TerrainField; width: number; height: number } {
  if (pad <= 0) return { field, width, height };

  const originCol = field.originCol - pad;
  const originRow = field.originRow - pad;
  const paddedWidth = width + pad * 2;
  const paddedHeight = height + pad * 2;
  const inPaddedRect = (col: number, row: number) =>
    col >= originCol && col < originCol + paddedWidth &&
    row >= originRow && row < originRow + paddedHeight;

  return {
    width: paddedWidth,
    height: paddedHeight,
    field: {
      originCol,
      originRow,
      contains: boundless ? () => true : inPaddedRect,
      // Apron = in-field but outside the original silhouette. Composes with an already-padded field
      // so re-padding never loses the earlier apron.
      apron: (col, row) =>
        (boundless || inPaddedRect(col, row)) && (!field.contains(col, row) || !!field.apron?.(col, row)),
    },
  };
}

export function buildEditorField(
  width: number,
  height: number,
  masks: CompiledMasks,
  field?: TerrainField,
  window?: CellWindow,
): EditorTile[] {
  const originCol = field?.originCol ?? 0;
  const originRow = field?.originRow ?? 0;
  // Packed-id probes: this is the hot path (~20–25 mask lookups per visible cell), so every
  // membership test below is an integer hash rather than a `${x},${y}` allocation. See
  // {@link CompiledMasks}.
  const isTerrain1 = (x: number, y: number) => masks.terrain1.has(packCell(x, y));
  const isTerrain2 = (x: number, y: number) => masks.terrain2.has(packCell(x, y));
  // Field membership: the editor's single board is the whole rectangle; the runtime passes a
  // footprint-union test so ground paints only inside the real continent shape (and rims it).
  const inField =
    field?.contains ?? ((x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height);
  // Apron cells carry no painted masks, so they take the DEFAULT surface: tallDirt slab + light
  // grass cap. Folding them into the light-grass membership (not just `kind`) is what makes a
  // template's painted grass autotile continuously into the surrounding ground instead of
  // stopping at a hard boundary.
  const isApron = field?.apron ?? (() => false);
  const isLightGrass = (x: number, y: number) => isTerrain1(x, y) || isApron(x, y);
  // The stored decor url for a cell, before plank autotiling. The street mask does not
  // suppress decor (it is a spriteless tint; family decor coexists with a street).
  const rawDecorAt = (x: number, y: number) => masks.decor.get(packCell(x, y)) ?? null;
  // Whether a cell currently holds any plank — drives the plank far-face cap resolution.
  const isPlankAt = (x: number, y: number) => {
    const u = rawDecorAt(x, y);
    return !!u && isPlankUrl(u);
  };
  // A cell's rendered decor: planks resolve their stored CENTER to the far-end edge cap
  // where that face abuts a non-plank cell ({@link plankRenderUrl}); other decor is verbatim.
  const decorAt = (x: number, y: number) => {
    const u = rawDecorAt(x, y);
    if (u && isPlankUrl(u)) return plankRenderUrl(u, isPlankAt, x, y);
    return u;
  };

  // ── Wood floor ────────────────────────────────────────────────────────────────────
  // The board-wide floor (see BoardFloor). A cell decks over only when it is BARE — no
  // terrain 1 AND no terrain 2 — since a plank under a grass cap is invisible work, and
  // grass is the thing the deck is meant to contrast with. Apron counts as light grass,
  // so a runtime apron never decks. `isWoodCell` doubles as the far-neighbour test that
  // decides where a run caps, which is why it consults `inField` too: the deck must cap
  // at the board edge exactly as it caps against grass.
  const woodSeed = masks.floor.kind === 'wood' ? masks.floor.seed : null;
  const isWoodCell = (x: number, y: number) =>
    woodSeed !== null && inField(x, y) && !isLightGrass(x, y) && !isTerrain2(x, y);
  const floorUrlAt = (x: number, y: number) =>
    (woodSeed !== null && isWoodCell(x, y)
      ? woodFloorPlankUrl(woodSeed, x, y, isWoodCell)
      : null);

  const tiles: EditorTile[] = [];
  // Iterate the GLOBAL window [origin, origin+span); skip cells outside the field silhouette so a
  // non-rectangular continent (or the empty corner of an L-shaped layout) gets no phantom ground.
  // CULLING: `window` (when given) intersects that range down to what the camera can actually see,
  // which is what keeps an apron-padded field affordable — cost tracks the viewport, not the world.
  // Note the culling is on ITERATION only: `inField` is still consulted at full extent, so a tile
  // at the window's edge autotiles against its real neighbours and no phantom rim appears there.
  const startCol = Math.max(originCol, window?.minCol ?? -Infinity);
  const endCol = Math.min(originCol + width - 1, window?.maxCol ?? Infinity);
  const startRow = Math.max(originRow, window?.minRow ?? -Infinity);
  const endRow = Math.min(originRow + height - 1, window?.maxRow ?? Infinity);
  for (let isoX = startCol; isoX <= endCol; isoX++) {
    // DIAMOND SPAN. The window's col/row box is the BOUNDING BOX of what is on screen, and in an
    // iso projection that box is about twice the visible area — iterating it whole builds roughly
    // half its tiles off-screen. The viewport actually bounds the two diagonals, so solving them
    // for `row` at this `col` gives the exact visible span:
    //     minDiag ≤ isoX − isoY ≤ maxDiag   ⇒   isoX − maxDiag ≤ isoY ≤ isoX − minDiag
    //     minSum  ≤ isoX + isoY ≤ maxSum    ⇒   minSum − isoX  ≤ isoY ≤ maxSum − isoX
    // Intersected with the box, an empty span just skips the column. Without a window (the editor
    // and sandbox, which draw a whole small board) the bounds are ±Infinity and this is a no-op.
    const rowLo = Math.max(
      startRow,
      isoX - (window?.maxDiag ?? Infinity),
      (window?.minSum ?? -Infinity) - isoX,
    );
    const rowHi = Math.min(
      endRow,
      isoX - (window?.minDiag ?? -Infinity),
      (window?.maxSum ?? Infinity) - isoX,
    );
    for (let isoY = rowLo; isoY <= rowHi; isoY++) {
      if (!inField(isoX, isoY)) continue;
      // Resolved once: it is both the tile's sprite and (when non-null) the proof that this
      // cell's slab top face is covered, which `slabHidden` below relies on.
      const floorUrl = floorUrlAt(isoX, isoY);
      const fieldEdge = freeFarmTileset.pickLandmassEdge({
        n: inField(isoX, isoY + 1),
        e: inField(isoX + 1, isoY),
        s: inField(isoX, isoY - 1),
        w: inField(isoX - 1, isoY),
      });
      tiles.push({
        isoX,
        isoY,
        kind: isLightGrass(isoX, isoY) ? 'grass' : 'dirt',
        darkGrass: isTerrain2(isoX, isoY),
        fieldEdge,
        grassNeighbours: neighbourOccupancy(isoX, isoY, isLightGrass),
        darkGrassNeighbours: neighbourOccupancy(isoX, isoY, isTerrain2),
        decorUrl: decorAt(isoX, isoY),
        floorUrl,
        // See EditorTile.slabHidden. S = isoY−1, W = isoX−1, SW = both. A wood-floor plank
        // covers the diamond just as a grass cap does, so a decked cell hides its slab too.
        slabHidden:
          (isLightGrass(isoX, isoY) || floorUrl !== null) &&
          inField(isoX, isoY - 1) &&
          inField(isoX - 1, isoY) &&
          inField(isoX - 1, isoY - 1),
      });
    }
  }
  return tiles;
}

/** 8-neighbour occupancy of `(isoX, isoY)` against a blob (n=+isoY, e=+isoX). */
function neighbourOccupancy(
  isoX: number,
  isoY: number,
  member: (x: number, y: number) => boolean,
): Partial<Record<Compass, boolean>> {
  return {
    n: member(isoX, isoY + 1),
    e: member(isoX + 1, isoY),
    s: member(isoX, isoY - 1),
    w: member(isoX - 1, isoY),
    ne: member(isoX + 1, isoY + 1),
    nw: member(isoX - 1, isoY + 1),
    se: member(isoX + 1, isoY - 1),
    sw: member(isoX - 1, isoY - 1),
  };
}

/**
 * Build a `width`×`height` dirt field with a LIGHT grass patch and a DARK grass
 * patch nested inside it. `fieldEdge` uses the 4-cardinal in-field occupancy
 * (drives the plateau rim slab); `grassNeighbours`/`darkGrassNeighbours` use the
 * light/dark patch membership respectively.
 */
export function buildFarmField(
  width: number,
  height: number,
  seed: number = DEFAULT_SEED,
): FarmTile[] {
  const patch = buildGrassPatch(width, height, seed);
  // Dark patch is confined to the inside of the light patch (dark over light).
  const darkPatch = buildDarkGrassPatch(width, height, patch);
  const isGrass = (x: number, y: number) => patch.has(key(x, y));
  const isDark = (x: number, y: number) => darkPatch.has(key(x, y));
  const inField = (x: number, y: number) =>
    x >= 0 && x < width && y >= 0 && y < height;

  const tiles: FarmTile[] = [];
  for (let isoX = 0; isoX < width; isoX++) {
    for (let isoY = 0; isoY < height; isoY++) {
      const fieldEdge = freeFarmTileset.pickLandmassEdge({
        n: inField(isoX, isoY + 1), // +isoY = north
        e: inField(isoX + 1, isoY), // +isoX = east
        s: inField(isoX, isoY - 1),
        w: inField(isoX - 1, isoY),
      });
      tiles.push({
        isoX,
        isoY,
        kind: isGrass(isoX, isoY) ? 'grass' : 'dirt',
        darkGrass: isDark(isoX, isoY),
        fieldEdge,
        grassNeighbours: neighbourOccupancy(isoX, isoY, isGrass),
        darkGrassNeighbours: neighbourOccupancy(isoX, isoY, isDark),
      });
    }
  }
  return tiles;
}
