import { useEffect, useMemo, useState } from 'react';
import { Assets, Texture } from 'pixi.js';
import { isoToScreen, computeLayerZ } from '../../engine/market/isometric';
import { HOUSE_ANCHOR, occupantHousesForArea } from '../../engine/market/house';
// House.png lives in the pack's `Originals/` bucket, which freeFarmTileset deliberately
// excludes (un-adopted source art), so it is imported directly rather than resolved through
// the tileset registry — same rationale as HouseLayer / EditorTerrainLayer.
import houseUrl from '../../assets/free-assets/free-farm-assets/Environment/Originals/House.png';
import type { PlacedPlaceholder } from '../../engine/market/templateStitch';

/**
 * PlaceholderHouseLayer — the PLACEHOLDER OCCUPANT renderer
 * (docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md § "Occupant rendering", Slice 4).
 *
 * LAYER: view. Draws a HOUSE (or two adjacent houses) across every FILLED placeholder area, as a
 * temporary stand-in for a real stall occupant until the stand-asset catalog is authored (all
 * occupants currently carry the generic `occupant-generic` assetId, so there is no per-occupant
 * art to render yet). Empty slots draw nothing. Purely cosmetic — houses are NOT stands and never
 * enter the navigation graphs (`buildMarketWorld` still receives no stands), so pedestrians walk
 * past them and version selection is unaffected. (Replaces the earlier StumpLayer stand-in.)
 *
 * WHY HOUSES TILE THE AREA EXACTLY. A `House.png` footprint is 4×5 (or its transpose 5×4 when
 * h-flipped) and the placeholder drop sizes (`PLACEHOLDER_SIZES`) are exactly 4×5 / 5×4 / 4×10 /
 * 10×4, i.e. one or two house footprints — see {@link occupantHousesForArea} (the shared geometry,
 * also used by the editor's filled-slot preview).
 *
 * A slot's `filled` flag is set upstream by {@link ../../engine/market/templateStitch stitchWorld}
 * from the server's `filledPlaceholderIds`; this layer just reads `world.placeholderAreas`.
 *
 * Sprites are emitted FLAT (direct children of the sortableChildren scene container) so they
 * z-sort globally with the terrain + pedestrians — same convention as the other market layers.
 */

interface HouseDraw {
  key: string;
  x: number;
  y: number;
  z: number;
  /** Horizontally mirror the sprite (negated scale.x about the base-corner anchor). */
  flip: boolean;
}

function buildDraws(placeholders: PlacedPlaceholder[]): HouseDraw[] {
  const draws: HouseDraw[] = [];
  for (const ph of placeholders) {
    if (!ph.filled) continue; // empty slot → no occupant art
    for (const h of occupantHousesForArea(ph.area)) {
      const { screenX, screenY } = isoToScreen(h.col, h.row);
      draws.push({
        key: `${h.col},${h.row}`,
        x: screenX,
        y: screenY,
        // `entity` slot (like pedestrians + the old stump stand-in): foot-anchored at the front
        // corner so nearer terrain/walkers z-sort correctly around it. Two stacked houses sort by
        // their own foot cell, so the back one draws behind the front one.
        z: computeLayerZ(h.col, h.row, 'entity'),
        flip: h.flip,
      });
    }
  }
  return draws;
}

export default function PlaceholderHouseLayer({ placeholders }: { placeholders: PlacedPlaceholder[] }) {
  const draws = useMemo(() => buildDraws(placeholders), [placeholders]);

  // Single House.png texture → preload once (nearest scaling to stay crisp under the integer
  // camera zoom, matching the terrain/pedestrian layers).
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tex = await Assets.load<Texture>(houseUrl);
      tex.source.scaleMode = 'nearest';
      if (!cancelled) setTexture(tex);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!texture) return null;

  return (
    <>
      {draws.map((d) => (
        <pixiSprite
          key={d.key}
          texture={texture}
          x={d.x}
          y={d.y}
          // Base-diamond front corner (HOUSE_ANCHOR), seated on the front-corner foot cell —
          // matching the live nmp HouseLayer + the editor's house render.
          anchor={HOUSE_ANCHOR}
          // Mirror by negating scale.x; Pixi flips about the anchor (the base-diamond front corner).
          scale={{ x: d.flip ? -1 : 1, y: 1 }}
          zIndex={d.z}
          eventMode="none"
        />
      ))}
    </>
  );
}
