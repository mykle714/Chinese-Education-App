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
 * It does NOT render — the view ({@link FarmTerrainLayer}) turns these into
 * tallDirt slabs, grass caps, and (for boundary tiles) stacked grass overlays via
 * {@link freeFarmTileset.pickGrassBorderOverlays}. The dark layer is painted just
 * above the light layer so its caps/overlays win on shared tiles.
 *
 * Single elevation: grass sits FLUSH on the dirt surface (no height step), so both
 * the grass↔dirt and light↔dark transitions are drawn purely by boundary overlays,
 * not by a cliff.
 *
 * Referenced by: src/features/nightmarket/FarmTerrainLayer.tsx (consumer),
 * docs/NIGHT_MARKET_FEATURE.md (Terrain rendering section).
 */

import {
  freeFarmTileset,
  type Compass,
  type LandmassEdge,
} from './freeFarmTileset';
import { houseOccupiedCells } from './house';

/**
 * Field dimensions in tiles. Shared by the terrain view ({@link FarmTerrainLayer})
 * and any overlay that needs to rebuild the same field (e.g. the nmp grass debug
 * overlay in MarketEngineViewer) — both must pass these to {@link buildFarmField}
 * so their tiles line up.
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
 *   - light-grass tile → a single `lightGrass_center` cap,
 *   - dirt tile bordering grass → the stacked light-grass-boundary overlays chosen
 *     from its 8 grass neighbours,
 *   - interior dirt → none (its own dirt top face shows).
 *
 * Shared by the {@link FarmTerrainLayer} view (which paints these) and the nmp
 * overlay-tile debug overlay (which labels them via {@link freeFarmTileset.stemOf}),
 * so both name/paint the exact same sprites. Does NOT include the tallDirt slab —
 * that is the plateau body, not a surface sprite — nor the dark layer (see
 * {@link resolveTileDarkSurfaceUrls}), which the view stacks on top separately.
 */
export function resolveTileSurfaceUrls(tile: FarmTile): string[] {
  if (tile.kind === 'grass') {
    const grassUrl = freeFarmTileset.getGrassBase('light', 'center');
    return grassUrl ? [grassUrl] : [];
  }
  return freeFarmTileset.pickGrassBorderOverlays('light', tile.grassNeighbours);
}

/**
 * Resolve the DARK-layer SURFACE sprite URLs painted on a tile, stacked ABOVE the
 * light layer so dark caps/overlays win on shared tiles:
 *   - dark-grass tile → a single `darkGrass_center` cap (over its light cap),
 *   - non-dark tile bordering dark grass → the stacked dark-grass-boundary overlays
 *     chosen from its 8 dark neighbours (these spill onto light-grass tiles, since
 *     the dark patch lives inside the light one),
 *   - a tile with no dark grass nearby → none.
 *
 * Mirrors {@link resolveTileSurfaceUrls} but for the dark palette + occupancy.
 */
export function resolveTileDarkSurfaceUrls(tile: FarmTile): string[] {
  if (tile.darkGrass) {
    const grassUrl = freeFarmTileset.getGrassBase('dark', 'center');
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
// explicit light-grass / dark-grass / street cell sets and a rectangular W×H board,
// and produces tiles the editor view renders WITHOUT decor. It reuses the exact same
// per-tile neighbour → overlay-cap resolution as buildFarmField (via the shared
// resolveTile* helpers), so "recompute the overlay caps on each paint" is just a
// rebuild: repaint a mask, rebuild the field, re-derive every tile's neighbours.

/**
 * The painted layers, cells keyed "col,row" (= isoX,isoY). The three grass/street
 * layers are boolean membership Sets; `decor` is a per-cell CHOICE (cell → decor
 * sprite URL) because a cell carries at most one decoration picked from a rotation.
 */
export interface EditorMasks {
  lightGrass: Set<string>;
  darkGrass: Set<string>;
  street: Set<string>;
  /**
   * Communal-walkable annotation cells (parks / plazas — see the walkability
   * classes in docs/NIGHT_MARKET_TEMPLATES.md). This is a WALKABILITY class only:
   * it renders NO sprite of its own — the editor merely highlights these cells —
   * and never feeds the surface/plank/decor rendering, so it is intentionally
   * absent from {@link EditorTile}/{@link buildEditorField}. Mutually exclusive
   * with {@link street} (a cell is street-walkable OR communal-walkable, not both)
   * AND with BLOCKING objects — a house ({@link houses}) or common/tree {@link decor}
   * (see {@link isBlockingDecorUrl}): those overwrite it when painted, and it is
   * refused where one already sits. Flush surface-family decor may coexist with it.
   */
  communal: Set<string>;
  /**
   * Placeholder-area cells (see the placeholder areas in
   * docs/NIGHT_MARKET_TEMPLATES.md) — regions an unlocked occupant asset can later
   * fill. Like {@link communal} this is an ANNOTATION: it renders no sprite (the
   * editor highlights it), does not feed surface/plank/decor rendering, and is
   * absent from {@link EditorTile}/{@link buildEditorField}. Unlike the walkability
   * classes it is an OVERRIDE overlay, so it may overlap any surface (grass /
   * street / communal) freely — no mutual exclusion. (This per-cell mask is the
   * first-slice shape; the rectangle-with-id `placeholderAreas` structure is a
   * later evolution — see the doc.)
   */
  placeholder: Set<string>;
  /**
   * Condition-mask cells — a PER-VERSION annotation (the conditional cell-class rules
   * that differ between template versions; see docs/NIGHT_MARKET_TEMPLATE_EDITOR.md).
   * Like {@link placeholder} it renders no sprite (the editor highlights it in its own
   * colour), does not feed surface/plank/decor rendering, and is absent from
   * {@link EditorTile}/{@link buildEditorField}. It is an OVERRIDE overlay, so it may
   * overlap any surface freely — no mutual exclusion.
   */
  condition: Set<string>;
  /**
   * Placed houses, each keyed by its FRONT (near) corner cell "col,row" (min
   * isoX/isoY). A house occupies a 4×5 footprint extending +isoX/+isoY from that
   * corner (see {@link ./house}). It renders as a single sprite (in
   * {@link ../../features/nightmarket/EditorTerrainLayer}), and its footprint blocks
   * the street + decor tools (house placement overwrites decor but never a street;
   * once placed, street/decor cannot overwrite the house).
   */
  houses: Set<string>;
  /** cell "col,row" → the chosen decor sprite URL for that cell. */
  decor: Map<string, string>;
}

/** The paintable surface a cell resolves to, which selects its family-decor rotation. */
export type EditorSurface = 'dirt' | 'lightGrass' | 'darkGrass';

/**
 * The three decor tools, each its own rotation (see {@link editorDecorRotation}):
 *   - `family` — the cell's SURFACE-SPECIFIC set (lightGrass/darkGrass/dirt decor),
 *   - `common` — the surface-agnostic `decor_*` scatter set,
 *   - `tree`   — the standing trees (`tree_*`, `largeTree_*`).
 * Each is a separate palette button so authors pick a category deliberately rather
 * than cycling blindly through one merged list.
 */
export type DecorCategory = 'family' | 'common' | 'tree';

/**
 * The surface a cell resolves to from the painted masks: dark-grass if in both dark
 * and light, light-grass if only light, else dirt (dark renders only over light).
 * Takes just the two grass masks it reads, so callers needn't build a full
 * {@link EditorMasks} to query a cell's surface.
 */
export function editorSurfaceAt(
  masks: Pick<EditorMasks, 'lightGrass' | 'darkGrass'>,
  col: number,
  row: number,
): EditorSurface {
  const k = key(col, row);
  if (!masks.lightGrass.has(k)) return 'dirt';
  return masks.darkGrass.has(k) ? 'darkGrass' : 'lightGrass';
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
    case 'family': return freeFarmTileset.getDecorUrls(surface);
    case 'common': return freeFarmTileset.getDecorUrls('common');
    case 'tree': return freeFarmTileset.getTreeUrls();
  }
}

/**
 * Whether a decor sprite URL is a BLOCKING object — `common` decor (`decor_*`) or a
 * standing `tree` (`tree_*`/`largeTree_*`) — as opposed to a flush surface-`family`
 * decor. Blocking objects are mutually exclusive with the communal-walkable class in
 * the template editor: a park/plaza tile may carry flush surface flora but not a tree,
 * prop, or house (houses are handled separately via their footprint). Delegates to the
 * tileset's own URL buckets so it stays single-sourced with the decor indexing (the
 * `family` sets — lightGrass/darkGrass/dirt — are intentionally NOT blocking).
 */
export function isBlockingDecorUrl(url: string): boolean {
  return freeFarmTileset.getDecorUrls('common').includes(url)
    || freeFarmTileset.getTreeUrls().includes(url);
}

/** 4-cardinal street occupancy (n=+isoY, e=+isoX) — drives plank orientation/caps. */
export type StreetNeighbours = Record<'n' | 'e' | 's' | 'w', boolean>;

/** A {@link FarmTile} plus the editor's street-mask membership + neighbours. */
export interface EditorTile extends FarmTile {
  /** Whether this cell is in the street mask (rendered as a plank, not grass). */
  street: boolean;
  streetNeighbours: StreetNeighbours;
  /**
   * The chosen decor sprite URL for this cell, or null for none. Suppressed on
   * street cells (streets overwrite decor), so a street cell is always null here.
   */
  decorUrl: string | null;
}

/**
 * Build a rectangular `width`×`height` editor field from painted masks. The dark
 * mask is intersected with the light mask (dark grass never sits on bare dirt — the
 * same invariant buildFarmField enforces structurally). `fieldEdge` uses the
 * rectangular in-bounds occupancy so the plateau rim autotiles cleanly.
 */
export function buildEditorField(
  width: number,
  height: number,
  masks: EditorMasks,
): EditorTile[] {
  const isLight = (x: number, y: number) => masks.lightGrass.has(key(x, y));
  // Light and dark are INDEPENDENT painted masks; the "dark renders only over light"
  // rule is applied HERE, at render time, by intersecting dark with light — so a dark
  // cell painted outside the light patch is kept as data but simply doesn't render.
  const isDark = (x: number, y: number) => masks.darkGrass.has(key(x, y)) && isLight(x, y);
  const isStreet = (x: number, y: number) => masks.street.has(key(x, y));
  const inField = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height;
  // Cells covered by a placed house — decor never shows under a house (house
  // placement overwrites decor), same as under a street plank.
  const houseOccupied = houseOccupiedCells(masks.houses);
  // Street cells (and house-covered cells) overwrite decor, so decor never shows
  // under a plank or a house.
  const decorAt = (x: number, y: number) =>
    isStreet(x, y) || houseOccupied.has(key(x, y)) ? null : masks.decor.get(key(x, y)) ?? null;

  const tiles: EditorTile[] = [];
  for (let isoX = 0; isoX < width; isoX++) {
    for (let isoY = 0; isoY < height; isoY++) {
      const fieldEdge = freeFarmTileset.pickLandmassEdge({
        n: inField(isoX, isoY + 1),
        e: inField(isoX + 1, isoY),
        s: inField(isoX, isoY - 1),
        w: inField(isoX - 1, isoY),
      });
      tiles.push({
        isoX,
        isoY,
        kind: isLight(isoX, isoY) ? 'grass' : 'dirt',
        darkGrass: isDark(isoX, isoY),
        fieldEdge,
        grassNeighbours: neighbourOccupancy(isoX, isoY, isLight),
        darkGrassNeighbours: neighbourOccupancy(isoX, isoY, isDark),
        street: isStreet(isoX, isoY),
        streetNeighbours: {
          n: isStreet(isoX, isoY + 1),
          e: isStreet(isoX + 1, isoY),
          s: isStreet(isoX, isoY - 1),
          w: isStreet(isoX - 1, isoY),
        },
        decorUrl: decorAt(isoX, isoY),
      });
    }
  }
  return tiles;
}

/**
 * Resolve the plank sprite for a street cell, or `null` for a non-street tile. A
 * simple street autotiler over the pack's plank vocabulary (only the far N/E faces
 * carry an end-cap, mirroring the landmass scheme):
 *   - orientation: N–S if the cell only connects north/south, else E–W (the default
 *     for isolated cells and 4-way crossings — the full crossing tileset is a
 *     deferred concern, see the tileset open question in NIGHT_MARKET_TEMPLATES.md),
 *   - cap: the run's far end (no street to the +isoY north → `northEdge` for N–S; no
 *     street to the +isoX east → `eastEdge` for E–W), else the flat `center`.
 * Variation is fixed at 1 in the editor.
 */
export function resolveTileStreetPlankUrl(tile: EditorTile): string | null {
  if (!tile.street) return null;
  const { n, e, s, w } = tile.streetNeighbours;
  const verticalOnly = (n || s) && !(e || w);
  if (verticalOnly) {
    const cap = n ? 'center' : 'northEdge';
    return freeFarmTileset.getPlank('ns', 1, cap) ?? null;
  }
  const cap = e ? 'center' : 'eastEdge';
  return freeFarmTileset.getPlank('ew', 1, cap) ?? null;
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
