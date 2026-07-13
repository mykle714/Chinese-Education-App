import { useEffect, useMemo, useState } from 'react';
import { Assets, Texture } from 'pixi.js';
import { isoToScreen, computeLayerZ, TILE_HEIGHT } from '../../engine/market/isometric';
import { buildWalkway, type WalkwaySpec } from '../../engine/market/walkway';
import { FIELD_WIDTH, FIELD_HEIGHT } from '../../engine/market/farmTerrain';

/**
 * Z lift applied to every plank so the whole walkway sorts ABOVE the entire
 * terrain layer (all grass + dirt), not just its own tile. The terrain is one
 * flat plane painted back-to-front in the `background` slot; a plank's painter z
 * (`-(isoX+isoY)`) alone would let the dirt slabs of tiles in FRONT of it (which
 * have a higher z) paint over it. Lifting by the field's maximum iso-sum
 * (`FIELD_WIDTH + FIELD_HEIGHT`) guarantees even the back-most plank clears the
 * front-most terrain tile, while `computeLayerZ` still orders the planks among
 * themselves (front planks' south walls correctly overlap the plank behind).
 */
const WALKWAY_Z_LIFT = FIELD_WIDTH + FIELD_HEIGHT;

/**
 * WalkwayLayer — renders sample plank walkways on the free-farm ground field.
 *
 * LAYER: view. Consumes the pure {@link buildWalkway} model (a straight run of
 * plank tiles, one per board variation, capped with the far-end edge sprite) and
 * paints each tile as a single raised plank slab.
 *
 * Single-plane rendering, mirroring {@link FarmTerrainLayer}'s tallDirt slab: a
 * 32×32 plank is drawn one TILE_HEIGHT below its tile so its 32×16 top face lands
 * on the SAME shared surface plane as the grass/dirt tops, with the ~16px wooden
 * thickness hanging below as the walkway's side. Sprites are emitted FLAT (direct
 * children of the scene container) so they z-sort globally via `sortableChildren`;
 * every plank is lifted above the whole terrain layer by {@link WALKWAY_Z_LIFT}
 * so the grass/dirt never paints over it.
 *
 * Pixel-art rendering: nearest-neighbour filtering, drawn at native scale 1 — the
 * camera does integer zoom for crisp upscaling.
 *
 * NOTE: the two specs below are a hard-coded SAMPLE (one EW + one NS run) to show
 * off the plank variations and edge caps. Replace with authored/data-driven specs
 * when walkways become part of the market layout.
 */

/** Sample walkways: one EW run and one NS run near the field centre. Each lays
 * variations 1→2→3 in order, with the far-end tile using the direction's edge cap. */
const SAMPLE_WALKWAYS: WalkwaySpec[] = [
  { origin: [2, 3], direction: 'ew' }, // runs east: (2,3)→(3,3)→(4,3 eastEdge)
  { origin: [3, 4], direction: 'ns' }, // runs north: (3,4)→(3,5)→(3,6 northEdge)
];

interface PlankDraw {
  key: string;
  x: number;
  y: number;
  url: string;
  z: number;
}

function buildDraws(): { draws: PlankDraw[]; urls: Set<string> } {
  const urls = new Set<string>();
  const draws: PlankDraw[] = [];
  for (const spec of SAMPLE_WALKWAYS) {
    for (const t of buildWalkway(spec)) {
      urls.add(t.url);
      const { screenX, screenY } = isoToScreen(t.isoX, t.isoY);
      draws.push({
        key: `${t.isoX},${t.isoY}`,
        x: screenX,
        y: screenY,
        url: t.url,
        // Above the whole terrain plane, ordered among planks — see WALKWAY_Z_LIFT.
        z: computeLayerZ(t.isoX, t.isoY, 'background') + WALKWAY_Z_LIFT,
      });
    }
  }
  return { draws, urls };
}

export default function WalkwayLayer() {
  const { draws, urls } = useMemo(buildDraws, []);
  const [textures, setTextures] = useState<Map<string, Texture> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        [...urls].map(async (u) => {
          const tex = await Assets.load<Texture>(u);
          tex.source.scaleMode = 'nearest'; // crisp pixel-art upscaling
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
        const tex = textures.get(d.url);
        if (!tex) return null;
        return (
          <pixiSprite
            key={d.key}
            texture={tex}
            x={d.x}
            y={d.y + TILE_HEIGHT}
            anchor={{ x: 0.5, y: 1 }}
            zIndex={d.z}
            eventMode="none"
          />
        );
      })}
    </>
  );
}
