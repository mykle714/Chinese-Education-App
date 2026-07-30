import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import { Assets, Texture } from 'pixi.js';
import { isoToScreen, computeLayerZ, TILE_HEIGHT, ORIGIN_ZERO, type CellOrigin } from '../../engine/market/isometric';
import { freeFarmTileset } from '../../engine/market/freeFarmTileset';
import nmpPerf from './nmpPerf';
import {
  resolveTileSurfaceUrls,
  resolveTileDarkSurfaceUrls,
  isDirtDecorUrl,
  type EditorTile,
} from '../../engine/market/farmTerrain';

/**
 * EditorTerrainLayer — renders a mask-driven {@link EditorTile} field for the
 * template editor (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md).
 *
 * LAYER: view. A trimmed sibling of {@link FarmTerrainLayer}: same tallDirt slab +
 * light/dark grass-boundary overlay stack, but (a) it is driven by an explicit
 * `tiles` prop (the painted field) instead of the procedural farm field, and (b) it
 * paints NO scatter decor (authoring surface must show exactly what was painted). The
 * street mask is NOT drawn here — it is a spriteless walkability tint the viewer draws
 * straight from the mask (like communal/placeholder/condition).
 *
 * Sprites are emitted FLAT (direct children of the sortableChildren scene container)
 * for correct global z-sort, exactly as FarmTerrainLayer does. Compositing surfaces
 * (the sandbox) pass an `origin` so a placement's local tiles are positioned AND
 * depth-sorted in the shared global cell space — see {@link CellOrigin}. Never wrap
 * this layer in a per-placement container: that would re-isolate the z-sort.
 */

/**
 * Skip the tallDirt slab on cells where it is provably invisible (see `EditorTile.slabHidden`).
 * Halves the sprite count on ordinary grass. Flip to false to isolate a suspected ground artifact.
 */
const HIDE_OCCLUDED_SLABS = true;

interface TileDraw {
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

function buildDraws(tiles: EditorTile[], origin: CellOrigin): { draws: TileDraw[]; urls: Set<string> } {
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
      // stays ABOVE the surface. Matches FarmTerrainLayer's decor slots.
      decorZ: decorUrl && isDirtDecorUrl(decorUrl) ? z - 0.1 : z + 0.15,
    });
  }

  // Diagnostic: `sprites` is the real Pixi cost (a cell emits 1–4), and the REBUILD COUNT tells us
  // whether the memoisation is actually holding — see ./nmpPerf.
  nmpPerf.count('terrain-tiles', tiles.length);
  nmpPerf.count('terrain-sprites', draws.reduce(
    (n, d) => n + (d.hideSlab ? 0 : 1) + d.surfaceUrls.length + d.darkSurfaceUrls.length + (d.decorUrl ? 1 : 0),
    0,
  ));
  return { draws, urls };
}

function EditorTerrainLayer(
  { tiles, origin = ORIGIN_ZERO }: { tiles: EditorTile[]; origin?: CellOrigin },
) {
  // Keyed on the origin's NUMBERS, not the object — callers build `{col,row}` inline each
  // render (the sandbox's drag preview does), so an identity dep would rebuild every frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { draws, urls } = useMemo(() => buildDraws(tiles, origin), [tiles, origin.col, origin.row]);
  const [textures, setTextures] = useState<Map<string, Texture> | null>(null);

  // `buildDraws` returns a fresh `urls` Set on every rebuild (i.e. every paint), but
  // the tileset URL VOCABULARY is tiny and rarely actually changes. Key the loader on
  // a stable signature of the URL set so it only re-runs when a genuinely new texture
  // is needed — otherwise each painted cell would kick off a redundant Assets.load +
  // full setTextures() render pass. (`urls` content is identical whenever the
  // signature is, so reading it here is safe despite the narrower dep list.)
  const urlSignature = useMemo(() => [...urls].sort().join('|'), [urls]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        [...urls].map(async (u) => {
          const tex = await Assets.load<Texture>(u);
          tex.source.scaleMode = 'nearest';
          return [u, tex] as const;
        }),
      );
      if (!cancelled) setTextures(new Map(entries));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSignature]);

  if (!textures) return null;

  return (
    <>
      {draws.map((d) => {
        const dirt = d.dirtUrl ? textures.get(d.dirtUrl) : null;
        if (!dirt && !d.hideSlab) return null; // slab expected but its texture is not loaded yet
        return (
          <Fragment key={d.key}>
            {dirt && (
              <pixiSprite
                texture={dirt}
                x={d.x}
                y={d.y + TILE_HEIGHT}
                anchor={{ x: 0.5, y: 1 }}
                zIndex={d.dirtZ}
                eventMode="none"
              />
            )}
            {d.surfaceUrls.map((u, i) => {
              const tex = textures.get(u);
              if (!tex) return null;
              return (
                <pixiSprite
                  key={`${d.key}:s:${i}`}
                  texture={tex}
                  x={d.x}
                  y={d.y}
                  anchor={{ x: 0.5, y: 1 }}
                  zIndex={d.surfaceZ}
                  eventMode="none"
                />
              );
            })}
            {d.darkSurfaceUrls.map((u, i) => {
              const tex = textures.get(u);
              if (!tex) return null;
              return (
                <pixiSprite
                  key={`${d.key}:d:${i}`}
                  texture={tex}
                  x={d.x}
                  y={d.y}
                  anchor={{ x: 0.5, y: 1 }}
                  zIndex={d.darkSurfaceZ}
                  eventMode="none"
                />
              );
            })}
            {d.decorUrl && textures.get(d.decorUrl) && (
              <pixiSprite
                texture={textures.get(d.decorUrl)!}
                x={d.x}
                y={d.y}
                anchor={{ x: 0.5, y: 1 }}
                zIndex={d.decorZ}
                eventMode="none"
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * MEMOISED — this is the heaviest element tree in the app (one to four `pixiSprite` elements per
 * ground cell, thousands of cells). nmp's scene re-renders every animation frame to advance the
 * pedestrians, so without this the whole terrain was reconciled at 60fps and the market crawled.
 * Callers MUST pass a stable `tiles` array (memoise the `buildEditorField` call) for this to bite.
 */
export default memo(EditorTerrainLayer);
