import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import { Assets, Texture } from 'pixi.js';
import { TILE_HEIGHT, ORIGIN_ZERO, type CellOrigin } from '../../engine/market/isometric';
import { buildDraws } from './terrainDraws';
import type { EditorTile } from '../../engine/market/farmTerrain';

/**
 * EditorTerrainLayer — renders a mask-driven {@link EditorTile} field for the
 * template editor (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md).
 *
 * LAYER: view. The ONE terrain renderer for every night-market surface (nmp runtime via
 * {@link ./TemplateTerrainLayer}, plus the editor and sandbox): tallDirt slab +
 * light/dark grass-boundary overlay stack, but (a) it is driven by an explicit
 * `tiles` prop (the painted field) instead of the procedural farm field, and (b) it
 * paints NO scatter decor (authoring surface must show exactly what was painted). The
 * street mask is NOT drawn here — it is a spriteless walkability tint the viewer draws
 * straight from the mask (like communal/placeholder/condition).
 *
 * Sprites are emitted FLAT (direct children of the sortableChildren scene container)
 * for correct global z-sort. Compositing surfaces
 * (the sandbox) pass an `origin` so a placement's local tiles are positioned AND
 * depth-sorted in the shared global cell space — see {@link CellOrigin}. Never wrap
 * this layer in a per-placement container: that would re-isolate the z-sort.
 *
 * The draw-list construction lives in {@link ./terrainDraws} so that
 * {@link ./TerrainChunkLayer} rasterises the byte-identical decomposition.
 */

/**
 * Which half of the terrain to emit.
 *
 *   'all'    — everything (the default, and the only mode before chunk baking).
 *   'ground' — dirt slab + light/dark grass caps. FLAT: never occludes an entity.
 *   'decor'  — the painted decor sprite only. TALL: must keep its per-cell depth so
 *              a walker can pass behind it.
 *
 * The split exists because {@link ./TerrainChunkLayer} flattens ground into one
 * baked image at a single depth, which is lossless only for art that could never
 * have sorted in front of a pedestrian. Decor could, so it stays live.
 */
export type TerrainPart = 'all' | 'ground' | 'decor';

function EditorTerrainLayer(
  { tiles, origin = ORIGIN_ZERO, part = 'all' }:
    { tiles: EditorTile[]; origin?: CellOrigin; part?: TerrainPart },
) {
  const wantGround = part !== 'decor';
  const wantDecor = part !== 'ground';
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
        // Slab expected but its texture is not loaded yet — hold the whole cell back so a
        // half-drawn tile never flashes. In 'decor' mode there is no slab to wait for, and
        // bailing here would silently drop every decor sprite.
        if (wantGround && !dirt && !d.hideSlab) return null;
        return (
          <Fragment key={d.key}>
            {wantGround && dirt && (
              <pixiSprite
                texture={dirt}
                x={d.x}
                y={d.y + TILE_HEIGHT}
                anchor={{ x: 0.5, y: 1 }}
                zIndex={d.dirtZ}
                eventMode="none"
              />
            )}
            {wantGround && d.surfaceUrls.map((u, i) => {
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
            {wantGround && d.darkSurfaceUrls.map((u, i) => {
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
            {wantDecor && d.decorUrl && textures.get(d.decorUrl) && (
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
 * ground cell, thousands of cells).
 *
 * The per-frame pedestrian re-render is confined to `PedestrianTicker` (see MarketEngineViewer), so
 * nmp's scene no longer re-renders every frame on its own. This memo still matters for the renders
 * that DO happen: every pan commits new camera state, and a pedestrian camera lock commits one per
 * frame — without it, each of those would reconcile the whole terrain.
 *
 * Callers MUST pass a stable `tiles` array (memoise the `buildEditorField` call) for this to bite.
 */
export default memo(EditorTerrainLayer);
