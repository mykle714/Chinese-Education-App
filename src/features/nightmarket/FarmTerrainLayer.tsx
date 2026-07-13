import { Fragment, useEffect, useMemo, useState } from 'react';
import { Assets, Texture } from 'pixi.js';
import { isoToScreen, computeLayerZ, TILE_HEIGHT } from '../../engine/market/isometric';
import { freeFarmTileset } from '../../engine/market/freeFarmTileset';
import {
  buildFarmField,
  resolveTileSurfaceUrls,
  resolveTileDarkSurfaceUrls,
  resolveTileDecorUrl,
  createDecorRng,
  FIELD_WIDTH,
  FIELD_HEIGHT,
} from '../../engine/market/farmTerrain';

/**
 * FarmTerrainLayer — renders the free-farm ground field for the night market.
 *
 * LAYER: view. Consumes the pure {@link buildFarmField} model (a raised dirt
 * plateau with a light grass patch and a dark grass patch nested inside it) and
 * paints, per tile, up to several native-resolution sprites:
 *   1. a **tallDirt slab** (`fieldEdge` variant) — the plateau body, drawn one
 *      TILE_HEIGHT lower so its top face lands on the surface and its 16px wall
 *      forms the visible rim below.
 *   2. the **light surface** — a `lightGrass_center` cap for a grass tile, or the
 *      stacked light-grass-boundary overlays for a dirt tile bordering grass
 *      ({@link resolveTileSurfaceUrls}; interior dirt gets none).
 *   3. the **dark surface**, stacked just ABOVE the light surface so it wins on
 *      shared tiles — a `darkGrass_center` cap for a dark tile, or the stacked
 *      dark-grass-boundary overlays spilled onto a light tile bordering the dark
 *      patch ({@link resolveTileDarkSurfaceUrls}).
 *   4. an optional **scatter decor** sprite on top of the finished tile, chosen by
 *      {@link resolveTileDecorUrl} (a seeded pass; skips overlay-carrying tiles;
 *      each tile rolls own-family decor at 0.15, else the common set at 0.05).
 *
 * Sprites are emitted FLAT (no per-tile wrapper container) so they become direct
 * children of the scene container and z-sort globally by `zIndex` via its
 * `sortableChildren`. Wrapping each tile in its own container would break the
 * cross-tile painter's order (children of a non-sortable container fall back to
 * insertion order), burying each row's surface under the next row's dirt.
 *
 * Single elevation: grass sits flush on the dirt surface, so the transition is a
 * flat overlay, not a cliff.
 *
 * Pixel-art rendering: textures use nearest-neighbour filtering and are drawn at
 * scale 1 (native). The camera does integer zoom, so upscaling stays crisp.
 */

interface TileDraw {
  key: string;
  x: number;
  y: number;
  /** tallDirt slab sprite url + z (drawn below the surface). */
  dirtUrl: string;
  dirtZ: number;
  /** Light-layer surface sprites (grass cap OR boundary overlays), at surface z. */
  surfaceUrls: string[];
  surfaceZ: number;
  /** Dark-layer surface sprites, drawn just above the light layer. */
  darkSurfaceUrls: string[];
  darkSurfaceZ: number;
  /** Scatter-decor sprite drawn on top of the finished tile, if any. */
  decorUrl: string | null;
  decorZ: number;
}

function buildDraws(): { draws: TileDraw[]; urls: Set<string> } {
  const urls = new Set<string>();
  const draws: TileDraw[] = [];
  // One rng shared across the decor pass so the scatter is deterministic (same
  // seed → same layout). Walked in buildFarmField order, matching the loop below.
  const decorRng = createDecorRng();
  for (const t of buildFarmField(FIELD_WIDTH, FIELD_HEIGHT)) {
    const dirtUrl = freeFarmTileset.getTallDirt(t.fieldEdge);
    if (!dirtUrl) continue; // pack should ship all 8 dirt variants
    urls.add(dirtUrl);

    // Light surface sprites (grass cap or spilled grass-boundary overlays) — shared
    // with the nmp overlay-tile debug overlay via resolveTileSurfaceUrls.
    const surfaceUrls = resolveTileSurfaceUrls(t);
    for (const u of surfaceUrls) urls.add(u);

    // Dark surface sprites, stacked above the light layer (dark over light).
    const darkSurfaceUrls = resolveTileDarkSurfaceUrls(t);
    for (const u of darkSurfaceUrls) urls.add(u);

    // Decor pass — after the surface is resolved, scatter a decoration on top:
    // own-family decor at 0.15, else common at 0.05 (skips overlay-carrying dirt tiles).
    const decorUrl = resolveTileDecorUrl(t, decorRng);
    if (decorUrl) urls.add(decorUrl);

    const { screenX, screenY } = isoToScreen(t.isoX, t.isoY);
    const z = computeLayerZ(t.isoX, t.isoY, 'background');
    draws.push({
      key: `${t.isoX},${t.isoY}`,
      x: screenX,
      y: screenY,
      dirtUrl,
      dirtZ: z - 0.5, // just behind this tile's own surface
      surfaceUrls,
      surfaceZ: z,
      darkSurfaceUrls,
      // Just above the light surface (dark over light), below decor at z + 0.1.
      darkSurfaceZ: z + 0.05,
      decorUrl,
      // Just above this tile's surface sprites, still within the background slot
      // (< entity's +0.25), so decor reads as a floor detail below any entity.
      decorZ: z + 0.1,
    });
  }
  return { draws, urls };
}

export default function FarmTerrainLayer() {
  const { draws, urls } = useMemo(buildDraws, []);
  const [textures, setTextures] = useState<Map<string, Texture> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        [...urls].map(async (u) => {
          const tex = await Assets.load<Texture>(u);
          // Crisp pixel-art upscaling — no bilinear smoothing at integer zoom.
          tex.source.scaleMode = 'nearest';
          return [u, tex] as const;
        }),
      );
      if (!cancelled) setTextures(new Map(entries));
    })();
    return () => { cancelled = true; };
  }, [urls]);

  if (!textures) return null;

  return (
    <>
      {draws.map((d) => {
        const dirt = textures.get(d.dirtUrl);
        if (!dirt) return null;
        // Flat emission — every sprite is a direct child of the scene container,
        // sorted globally by zIndex.
        return (
          <Fragment key={d.key}>
            <pixiSprite
              texture={dirt}
              x={d.x}
              y={d.y + TILE_HEIGHT}
              anchor={{ x: 0.5, y: 1 }}
              zIndex={d.dirtZ}
              eventMode="none"
            />
            {d.surfaceUrls.map((u, i) => {
              const tex = textures.get(u);
              if (!tex) return null;
              return (
                <pixiSprite
                  key={`${d.key}:${i}`}
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
                  key={`${d.key}:dark:${i}`}
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
