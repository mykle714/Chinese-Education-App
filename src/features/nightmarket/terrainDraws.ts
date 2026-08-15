import { isoToScreen, computeLayerZ, type CellOrigin } from '../../engine/market/isometric';
import { freeFarmTileset } from '../../engine/market/freeFarmTileset';
import nmpPerf from './nmpPerf';
import {
  resolveTileSurfaceUrls,
  resolveTileDarkSurfaceUrls,
  isDirtDecorUrl,
  type EditorTile,
} from '../../engine/market/farmTerrain';

/**
 * Terrain draw-list construction — shared by the two renderers that consume it.
 *
 * LAYER: view (feature-shared). Extracted from `./EditorTerrainLayer` when
 * `./TerrainChunkLayer` needed the identical per-cell sprite decomposition to
 * rasterise into a baked chunk. Two copies of this would diverge silently and
 * show up as the baked terrain looking subtly unlike the live terrain — the
 * hardest class of bug to notice in this subsystem.
 *
 * It is NOT in `src/engine/` because it depends on `./nmpPerf`, a view-layer
 * diagnostic. The geometry it uses (`isoToScreen`, `computeLayerZ`) is the
 * engine's; the art-URL resolution is `farmTerrain`'s.
 *
 * Consumers: `./EditorTerrainLayer` (live sprites), `./TerrainChunkLayer` (bake).
 * Referenced by docs/NIGHT_MARKET_TERRAIN_CHUNKING.md.
 */

/**
 * Skip the tallDirt slab on cells where it is provably invisible (see `EditorTile.slabHidden`).
 * Halves the sprite count on ordinary grass. Flip to false to isolate a suspected ground artifact.
 */
export const HIDE_OCCLUDED_SLABS = true;

export interface TileDraw {
  key: string;
  x: number;
  y: number;
  /** null when the slab is fully occluded and was skipped. */
  dirtUrl: string | null;
  dirtZ: number;
  /** Light/dark grass surface sprites. */
  surfaceUrls: string[];
  darkSurfaceUrls: string[];
  surfaceZ: number;
  darkSurfaceZ: number;
  /** True when the slab was skipped as occluded. */
  hideSlab: boolean;
  /** Painted decor sprite (null for none), drawn on top of the finished tile. */
  decorUrl: string | null;
  decorZ: number;
}

/**
 * Decompose a tile field into positioned, depth-sorted sprite draws.
 *
 * `countPerf` is opt-out because the chunk baker calls this many times per frame
 * while filling its queue; letting those bakes overwrite the live census would
 * make the `terrain-sprites` diagnostic meaningless.
 */
export function buildDraws(
  tiles: EditorTile[],
  origin: CellOrigin,
  countPerf = true,
): { draws: TileDraw[]; urls: Set<string> } {
  const urls = new Set<string>();
  const draws: TileDraw[] = [];
  for (const t of tiles) {
    // A fully-occluded slab is skipped outright (see EditorTile.slabHidden) — on ordinary grass that
    // is half of all sprites. Set HIDE_OCCLUDED_SLABS to false to rule this out as a visual suspect.
    const hideSlab = HIDE_OCCLUDED_SLABS && t.slabHidden;
    const dirtUrl = hideSlab ? null : (freeFarmTileset.getTallDirt(t.fieldEdge) ?? null);
    if (!hideSlab && !dirtUrl) continue; // no slab art for this rim variant — skip the cell entirely
    if (dirtUrl) urls.add(dirtUrl);

    const surfaceUrls = resolveTileSurfaceUrls(t);
    const darkSurfaceUrls = resolveTileDarkSurfaceUrls(t);
    for (const u of surfaceUrls) urls.add(u);
    for (const u of darkSurfaceUrls) urls.add(u);

    const decorUrl = t.decorUrl;
    if (decorUrl) urls.add(decorUrl);

    // Local tile → global cell, so position and depth are both in the shared space.
    const gx = t.isoX + origin.col;
    const gy = t.isoY + origin.row;
    const { screenX, screenY } = isoToScreen(gx, gy);
    const z = computeLayerZ(gx, gy, 'background');
    draws.push({
      key: `${t.isoX},${t.isoY}`,
      x: screenX,
      y: screenY,
      dirtUrl,
      hideSlab,
      dirtZ: z - 0.5,
      surfaceUrls,
      darkSurfaceUrls,
      surfaceZ: z,
      darkSurfaceZ: z + 0.05,
      decorUrl,
      // Dirt-family decor sits BELOW the grass surfaces (above the dirt slab at z − 0.5, below
      // the light cap at z) so grass painted over the cell covers it; every other decor family
      // stays ABOVE the surface.
      decorZ: decorUrl && isDirtDecorUrl(decorUrl) ? z - 0.1 : z + 0.15,
    });
  }

  if (countPerf) {
    // Diagnostic: `sprites` is the real Pixi cost (a cell emits 1–4), and the REBUILD COUNT tells us
    // whether the memoisation is actually holding — see ./nmpPerf.
    nmpPerf.count('terrain-tiles', tiles.length);
    nmpPerf.count('terrain-sprites', draws.reduce(
      (n, d) => n + (d.hideSlab ? 0 : 1) + d.surfaceUrls.length + d.darkSurfaceUrls.length + (d.decorUrl ? 1 : 0),
      0,
    ));
  }
  return { draws, urls };
}
