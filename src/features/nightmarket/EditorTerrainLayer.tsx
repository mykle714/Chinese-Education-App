import { Fragment, useEffect, useMemo, useState } from 'react';
import { Assets, Texture } from 'pixi.js';
import { isoToScreen, computeLayerZ, TILE_HEIGHT } from '../../engine/market/isometric';
import { freeFarmTileset } from '../../engine/market/freeFarmTileset';
import {
  resolveTileSurfaceUrls,
  resolveTileDarkSurfaceUrls,
  isDirtDecorUrl,
  type EditorTile,
} from '../../engine/market/farmTerrain';
import { HOUSE_ANCHOR } from '../../engine/market/house';
// House.png lives in the pack's excluded `Originals/` bucket, so it is imported
// directly (see HouseLayer for the same rationale).
import houseUrl from '../../assets/free-assets/free-farm-assets/Environment/Originals/House.png';

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
 * for correct global z-sort, exactly as FarmTerrainLayer does.
 */

interface TileDraw {
  key: string;
  x: number;
  y: number;
  dirtUrl: string;
  dirtZ: number;
  /** Light/dark grass surface sprites. */
  surfaceUrls: string[];
  darkSurfaceUrls: string[];
  surfaceZ: number;
  darkSurfaceZ: number;
  /** Painted decor sprite (null for none), drawn on top of the finished tile. */
  decorUrl: string | null;
  decorZ: number;
}

/** A placed house sprite, positioned/z-sorted by its front-corner foot cell. */
interface HouseDraw {
  key: string;
  x: number;
  y: number;
  z: number;
  /** Horizontally mirror the sprite (negated scale.x around the base-corner anchor). */
  flip: boolean;
}

function buildDraws(
  tiles: EditorTile[],
  houses: Array<{ cell: string; flip: boolean }>,
): { draws: TileDraw[]; houseDraws: HouseDraw[]; urls: Set<string> } {
  const urls = new Set<string>();
  const draws: TileDraw[] = [];
  for (const t of tiles) {
    const dirtUrl = freeFarmTileset.getTallDirt(t.fieldEdge);
    if (!dirtUrl) continue;
    urls.add(dirtUrl);

    const surfaceUrls = resolveTileSurfaceUrls(t);
    const darkSurfaceUrls = resolveTileDarkSurfaceUrls(t);
    for (const u of surfaceUrls) urls.add(u);
    for (const u of darkSurfaceUrls) urls.add(u);

    // Painted decor (suppressed only under a placed house — see buildEditorField.decorAt).
    const decorUrl = t.decorUrl;
    if (decorUrl) urls.add(decorUrl);

    const { screenX, screenY } = isoToScreen(t.isoX, t.isoY);
    const z = computeLayerZ(t.isoX, t.isoY, 'background');
    draws.push({
      key: `${t.isoX},${t.isoY}`,
      x: screenX,
      y: screenY,
      dirtUrl,
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

  // Placed houses — one sprite each, positioned/z-sorted by the front-corner foot
  // cell (like a large decor). Above the cell's decor slot but still in the
  // background band, so terrain in FRONT (lower iso → higher z) still occludes it.
  const houseDraws: HouseDraw[] = [];
  for (const { cell: anchor, flip } of houses) {
    const [col, row] = anchor.split(',').map(Number);
    const { screenX, screenY } = isoToScreen(col, row);
    houseDraws.push({
      key: anchor,
      x: screenX,
      y: screenY,
      z: computeLayerZ(col, row, 'background') + 0.2,
      flip,
    });
  }
  if (houseDraws.length > 0) urls.add(houseUrl);

  return { draws, houseDraws, urls };
}

export default function EditorTerrainLayer({
  tiles,
  houses = [],
}: {
  tiles: EditorTile[];
  /** Placed houses: front-corner anchor "col,row" (4×5 footprint) + h-flip orientation. */
  houses?: Array<{ cell: string; flip: boolean }>;
}) {
  const { draws, houseDraws, urls } = useMemo(
    () => buildDraws(tiles, houses),
    [tiles, houses],
  );
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
        const dirt = textures.get(d.dirtUrl);
        if (!dirt) return null;
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
      {/* Placed houses — anchored on the base-diamond front corner (HOUSE_ANCHOR),
          seated on the front-corner foot cell, matching the live nmp HouseLayer. */}
      {textures.get(houseUrl) && houseDraws.map((h) => (
        <pixiSprite
          key={`house:${h.key}`}
          texture={textures.get(houseUrl)!}
          x={h.x}
          y={h.y}
          anchor={HOUSE_ANCHOR}
          // Mirror by negating scale.x; Pixi flips around the anchor (the base-diamond front
          // corner), so the house stays seated on the same foot cell, just facing the other way.
          scale={{ x: h.flip ? -1 : 1, y: 1 }}
          zIndex={h.z}
          eventMode="none"
        />
      ))}
    </>
  );
}
