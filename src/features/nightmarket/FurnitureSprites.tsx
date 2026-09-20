import { isoToScreen, ORIGIN_ZERO, type CellOrigin } from '../../engine/market/isometric';
import { lumeishTileset } from '../../engine/market/lumeishTileset';
import type { FurniturePlacement } from '../../engine/market/furniture';
import PropStripSprites from './PropStripSprites';
import { usePixiTexture } from './usePixiTexture';

/**
 * FurnitureSprites — draws a board's placed FURNITURE (the lumeish pack).
 *
 * LAYER: view. Reads {@link ../../engine/market/farmTerrain EditorMasks.furniture} and draws
 * each `{col,row,id}` record through the same {@link ./PropStripSprites} the house uses, so
 * furniture and buildings depth-sort against each other and against pedestrians by one rule.
 * All the geometry — where the art seats on its foot cell, how many cells it covers, where the
 * strips cut — comes from the sprite's generated manifest entry via
 * {@link ../../engine/market/lumeishTileset}; nothing here measures art.
 *
 * NO FLIPPING. Furniture is never drawn mirrored: the pack ships each facing as its own
 * independently-shaded file, so turning an object around swaps the sprite ID (see
 * {@link ../../engine/market/furniture}). `flip` is therefore absent from both the placement
 * record and this layer.
 *
 * Referenced by: docs/LUMEISH_ASSET_PIPELINE.md § "Placing furniture".
 */

export interface FurnitureSpritesProps {
  placements: readonly FurniturePlacement[];
  /**
   * Board origin in global cells, for a COMPOSITING surface (the sandbox stitches many boards
   * into one world). Position and depth shift together, so a piece sorts against other
   * placements' sprites rather than only its own board's.
   */
  origin?: CellOrigin;
  /** Flat z added to every strip — used by the editor to lift furniture above its mask tints. */
  zBase?: number;
}

export default function FurnitureSprites(
  { placements, origin = ORIGIN_ZERO, zBase = 0 }: FurnitureSpritesProps,
) {
  return (
    <>
      {placements.map((placement) => (
        <FurniturePiece
          key={`furniture:${placement.col},${placement.row}:${placement.id}`}
          placement={placement}
          origin={origin}
          zBase={zBase}
        />
      ))}
    </>
  );
}

/**
 * One placed piece. Each loads its own texture rather than the parent pre-loading them all:
 * `Assets` caches by url, so ten of the same chair still decode once, and a board renders
 * progressively instead of waiting on its slowest sprite.
 */
function FurniturePiece(
  { placement, origin, zBase }:
  { placement: FurniturePlacement; origin: CellOrigin; zBase: number },
) {
  const sprite = lumeishTileset.sprite(placement.id);
  // Hook order must not depend on whether the sprite resolved — pass undefined instead of
  // returning early (the hook yields null for a missing url).
  const texture = usePixiTexture(sprite?.url);
  if (!sprite || !texture) return null;

  const col = placement.col + origin.col;
  const row = placement.row + origin.row;
  const { screenX, screenY } = isoToScreen(col, row);
  return (
    <PropStripSprites
      texture={texture}
      strips={lumeishTileset.strips(placement.id)}
      anchorY={lumeishTileset.anchorFraction(placement.id).y}
      screenX={screenX}
      screenY={screenY}
      col={col}
      row={row}
      // Furniture is a solid object standing on the ground, so it sorts (and fades) in the
      // same slot a pedestrian does — a walker passes in front of a table's near edge and
      // behind its far edge, which is exactly what per-strip `entity` depth gives.
      slot="entity"
      zBase={zBase}
      keyPrefix={`furniture:${col},${row}:${placement.id}`}
    />
  );
}
