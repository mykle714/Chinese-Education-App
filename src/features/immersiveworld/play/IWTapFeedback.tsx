import { useCallback } from 'react';
import { ColorMatrixFilter, type Graphics, type Texture } from 'pixi.js';
import { computeLayerZ, isoToScreen, TILE_HEIGHT, TILE_WIDTH } from '../../../engine/market/isometric';
import { lumeishTileset } from '../../../engine/market/lumeishTileset';
import type { FurniturePlacement } from '../../../engine/market/furniture';
import { usePixiTexture } from '../../nightmarket/usePixiTexture';
import { RAISED_DECOR_Z_LIFT } from '../../nightmarket/terrainDraws';
import { IW_SELECT_BLUE, IW_TAP_RIPPLE } from './iwTapColors';
import { tapRippleRings } from './tapHighlight';

/**
 * IWTapFeedback — the Pixi pieces that answer a tap: the ripple where the finger landed, and
 * the blue highlight on whatever the tap selected (§ 14 Q18).
 *
 * LAYER: view, pure given props. WHICH thing is highlighted is `tapHighlight.ts`'s decision;
 * WHEN a tap happened and how far through its fade it is belongs to `IWSceneStage`, which
 * re-renders every frame anyway and passes the current `alpha` / `elapsedMs` down.
 * Components here assume the host has `extend`ed Container, Sprite and Graphics — the stage does.
 *
 * ⚠️ **AN OUTLINE IS A SILHOUETTE DRAWN BEHIND THE SPRITE, NOT A STROKE ON TOP OF IT.** Pixi
 * has no sprite-outline primitive (that lives in the separate `pixi-filters` package, which the
 * app does not ship). So {@link TapSpriteOutline} draws the sprite's own texture four times,
 * nudged one world pixel up/down/left/right, flattens all four to solid blue with a colour
 * matrix, and sits that JUST BEHIND the real sprite in depth. The real sprite then covers the
 * middle and only a one-pixel rim shows. Being behind, it is also correctly hidden by anything
 * standing in front of the object — a table's outline passes behind the customer at it, rather
 * than being painted across them.
 *
 * Referenced by: src/features/immersiveworld/play/IWSceneStage.tsx; docs/IMMERSIVE_WORLD.md § 14 Q18.
 */

/** How far the silhouette copies are nudged — one WORLD pixel, i.e. `zoom` screen pixels. */
const OUTLINE_PX = 1;
const OUTLINE_OFFSETS = [
  [OUTLINE_PX, 0], [-OUTLINE_PX, 0], [0, OUTLINE_PX], [0, -OUTLINE_PX],
] as const;

/**
 * Just under the outlined sprite's own z. Small enough that nothing else on the board can land
 * between the two — the board's depth slots (`terrainDraws`, `RENDER_SLOT_Z`) are all at least
 * 0.05 apart.
 */
const BEHIND_SPRITE_Z = 0.01;

/**
 * The colour-matrix filter that turns any texel into solid {@link IW_SELECT_BLUE}, keeping its
 * alpha. Built lazily and shared: one GPU program for every outline, and none at all until the
 * first tap (constructing it at module load would run before Pixi's runtime shim).
 */
let solidBlueFilter: ColorMatrixFilter | null = null;
function outlineFilter(): ColorMatrixFilter {
  if (!solidBlueFilter) {
    const r = ((IW_SELECT_BLUE >> 16) & 0xff) / 255;
    const g = ((IW_SELECT_BLUE >> 8) & 0xff) / 255;
    const b = (IW_SELECT_BLUE & 0xff) / 255;
    solidBlueFilter = new ColorMatrixFilter();
    // Rows are r, g, b, a; the fifth column is a constant (0–1). Every colour input is zeroed,
    // so each channel IS the constant, and alpha passes straight through.
    solidBlueFilter.matrix = [
      0, 0, 0, 0, r,
      0, 0, 0, 0, g,
      0, 0, 0, 0, b,
      0, 0, 0, 1, 0,
    ];
  }
  return solidBlueFilter;
}

/**
 * A one-pixel blue rim around a sprite, drawn behind it. Takes the sprite's own placement
 * (position, anchor, depth), so the silhouette is pixel-for-pixel the art the learner sees.
 */
export function TapSpriteOutline({ texture, x, y, anchor, spriteZ, alpha }: {
  texture: Texture;
  x: number;
  y: number;
  anchor: { x: number; y: number };
  /** The OUTLINED sprite's zIndex — the outline sits just behind it. */
  spriteZ: number;
  alpha: number;
}) {
  if (alpha <= 0) return null;
  return (
    <pixiContainer
      label="iw-tap-outline"
      zIndex={spriteZ - BEHIND_SPRITE_Z}
      alpha={alpha}
      filters={[outlineFilter()]}
      eventMode="none"
    >
      {OUTLINE_OFFSETS.map(([dx, dy]) => (
        <pixiSprite
          key={`${dx},${dy}`}
          texture={texture}
          x={x + dx}
          y={y + dy}
          anchor={anchor}
          eventMode="none"
        />
      ))}
    </pixiContainer>
  );
}

/**
 * Outline a placed FURNITURE piece — the whole piece, whichever of its cells was tapped.
 *
 * The piece is drawn as depth strips (`PropStripSprites`); the outline draws the UNSLICED art
 * instead, with its left edge at the leftmost strip's `offsetX` so it lines up exactly, and
 * sits behind the piece's NEAREST-to-back strip so no strip of the piece is under its own rim.
 */
export function FurnitureTapOutline({ placement, alpha }: { placement: FurniturePlacement; alpha: number }) {
  // Same cached texture `FurnitureSprites` already loaded — `Assets` caches by url.
  const texture = usePixiTexture(lumeishTileset.sprite(placement.id)?.url);
  const strips = lumeishTileset.strips(placement.id);
  if (!texture || strips.length === 0) return null;

  const { screenX, screenY } = isoToScreen(placement.col, placement.row);
  const left = Math.min(...strips.map(s => s.offsetX));
  const backmostZ = Math.min(...strips.map(s =>
    computeLayerZ(placement.col + s.footIsoX, placement.row + s.footIsoY, 'entity')));
  return (
    <TapSpriteOutline
      texture={texture}
      x={screenX + left}
      y={screenY}
      anchor={{ x: 0, y: lumeishTileset.anchorFraction(placement.id).y }}
      spriteZ={backmostZ}
      alpha={alpha}
    />
  );
}

/**
 * Outline a blocking DECOR sprite (a prop, a tree). Placed and depth-sorted exactly as
 * `EditorTerrainLayer` draws it: foot-anchored on the cell, at the cell's background z plus
 * {@link RAISED_DECOR_Z_LIFT}.
 */
export function DecorTapOutline({ col, row, url, alpha }: {
  col: number; row: number; url: string; alpha: number;
}) {
  const texture = usePixiTexture(url);
  if (!texture) return null;
  const { screenX, screenY } = isoToScreen(col, row);
  return (
    <TapSpriteOutline
      texture={texture}
      x={screenX}
      y={screenY}
      anchor={{ x: 0.5, y: 1 }}
      spriteZ={computeLayerZ(col, row, 'background') + RAISED_DECOR_Z_LIFT}
      alpha={alpha}
    />
  );
}

/**
 * Highlight an EMPTY tile's diamond. Filled as well as stroked — a bare square has no art of
 * its own to carry the colour, unlike an outlined object.
 *
 * zIndex 2.5: above the mouse-hover diamond (2), below every body, so a person walking across
 * the square passes over its highlight rather than under it.
 */
export function CellTapHighlight({ col, row, alpha }: { col: number; row: number; alpha: number }) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    g.moveTo(0, 0);                              // bottom vertex — the foot point itself
    g.lineTo(TILE_WIDTH / 2, -TILE_HEIGHT / 2);  // right
    g.lineTo(0, -TILE_HEIGHT);                   // top
    g.lineTo(-TILE_WIDTH / 2, -TILE_HEIGHT / 2); // left
    g.closePath();
    g.fill({ color: IW_SELECT_BLUE, alpha: 0.35 });
    g.stroke({ color: IW_SELECT_BLUE, width: 1, alpha: 1 });
  }, []);
  if (alpha <= 0) return null;
  const { screenX, screenY } = isoToScreen(col, row);
  return (
    <pixiGraphics
      label="iw-tap-cell-highlight"
      draw={draw}
      x={screenX}
      y={screenY}
      alpha={alpha}
      zIndex={2.5}
      eventMode="none"
    />
  );
}

/**
 * The ripple, in SCREEN space (the caller places it outside the zoomed world container), so
 * it is finger-sized at every zoom. `elapsedMs` drives it; see `tapRippleRings`.
 */
export function TapRipple({ x, y, elapsedMs }: { x: number; y: number; elapsedMs: number }) {
  const rings = tapRippleRings(elapsedMs);
  // Rebuilt every frame on purpose: the rings ARE the animation, and `draw` re-runs only when
  // its identity changes. A handful of arcs per frame for 600ms is nothing.
  const draw = (g: Graphics) => {
    g.clear();
    for (const ring of rings) {
      g.circle(0, 0, ring.radius);
      g.stroke({ color: IW_TAP_RIPPLE, width: ring.width, alpha: ring.alpha });
    }
  };
  if (rings.length === 0) return null;
  return <pixiGraphics label="iw-tap-ripple" draw={draw} x={x} y={y} eventMode="none" />;
}
