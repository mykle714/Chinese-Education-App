import { useMemo } from 'react';
import { Rectangle, Texture } from 'pixi.js';
import type { RenderSlot } from '../../engine/market/nightMarketRegistry';
import { computeLayerZ } from '../../engine/market/isometric';
import type { StripPlacement } from '../../engine/market/isometric';
import { alphaForSlot } from '../../engine/market/layerTranslucency';
import { useCameraZoom } from './CameraZoomContext';

/**
 * PropStripSprites — draw ONE multi-cell prop as a row of full-height vertical STRIPS, each
 * z-sorted at its own implied foot anchor.
 *
 * LAYER: view. This is the render half of the shared prop system: the geometry (footprint,
 * mirror rule, strip slicing) lives in {@link ../../engine/market/footprint}, and every
 * multi-cell sprite on the board draws through this one component:
 *   - {@link ./HouseStripSprites}  — `House.png`, the placeholder occupant (a thin wrapper)
 *   - {@link ./FurnitureSprites}   — the lumeish furniture pack
 *
 * WHY STRIPS. A prop spanning several cells has, as one sprite, a single depth: a pedestrian
 * beside its near-LEFT edge and one beside its near-RIGHT edge sort against the same z, and
 * one of them is always wrong (walker swallowed by the wall, or floating over the roof).
 * Slicing per screen column gives each column the depth of the block's nearest surface point
 * there. The slicing math is `computeSpriteStrips` in {@link ../../engine/market/isometric};
 * `propStrips` in `footprint.ts` is the per-art entry point that produces the `strips` prop.
 *
 * Sprites are emitted FLAT (direct children of the caller's `sortableChildren` container) so
 * the strips interleave with terrain, decor and pedestrians rather than sorting only among
 * themselves.
 *
 * ZOOM-PEEL. Every strip carries the alpha its {@link fadeSlot} has at the current camera zoom
 * ({@link ../../engine/market/layerTranslucency alphaForSlot}). Alpha is applied PER STRIP
 * rather than to a wrapping container on purpose — a container would need its own `alpha` AND
 * would re-parent the strips out of the caller's global sort, breaking the interleaving above.
 * Since the strips are anchor-aligned edge-to-edge (no overlapping pixels), per-strip alpha
 * composites identically to whole-sprite alpha with no double-blended seams.
 */

/**
 * Sub-texture cache. The frames are a pure function of the source texture's art, so they are
 * built once per texture rather than once per placed prop — ten sofas of the same sprite share
 * one set of frames, and the house's ten frames are built once for every house on the board.
 *
 * Keyed by texture alone (not by texture+flip): a mirror is a negative scale, not a different
 * crop, so both facings of a flippable prop read the same frames.
 */
const stripTextureCache = new WeakMap<Texture, Texture[]>();

function stripTexturesFor(texture: Texture, strips: readonly StripPlacement[]): Texture[] {
  const cached = stripTextureCache.get(texture);
  if (cached) return cached;
  const built = strips.map((s) => new Texture({
    source: texture.source,
    frame: new Rectangle(s.frame.x, s.frame.y, s.frame.w, s.frame.h),
  }));
  stripTextureCache.set(texture, built);
  return built;
}

export interface PropStripSpritesProps {
  /** The loaded (full-frame) source texture. */
  texture: Texture;
  /**
   * The prop's per-screen-column strips for the facing being drawn, from
   * {@link ../../engine/market/footprint propStrips} (or a tileset's memoised wrapper).
   * Computed ONCE per art at module/registry scope — never per frame.
   */
  strips: readonly StripPlacement[];
  /**
   * Vertical anchor fraction — the `y` of
   * {@link ../../engine/market/footprint propAnchorFraction}, which puts the art's base-diamond
   * front corner on the foot cell's south vertex. (Each strip supplies its own `x`, so only
   * `y` is needed here.)
   */
  anchorY: number;
  /** Screen position of the prop's foot cell (from `isoToScreen`). */
  screenX: number;
  screenY: number;
  /** Foot cell in GLOBAL iso cells — the depth basis each strip's implied foot is added to. */
  col: number;
  row: number;
  /**
   * Draw horizontally mirrored (the footprint transposes — see `transposeSpan`). Valid only
   * for art whose two facings are symmetric; a pack that ships INDEPENDENTLY SHADED facings
   * (lumeish) must swap sprite instead. Callers pass the matching flipped `strips`.
   */
  flip?: boolean;
  /** Render slot for every strip — drives DEPTH (`computeLayerZ`). */
  slot: RenderSlot;
  /** Slot the zoom-peel fade is looked up under, when it must differ from the depth `slot`. */
  fadeSlot?: RenderSlot;
  /** Flat z added to every strip (surface-specific lifts; keeps relative strip order intact). */
  zBase?: number;
  /** Disambiguates strip keys when several props render in one parent. */
  keyPrefix: string;
}

export default function PropStripSprites(
  {
    texture, strips, anchorY, screenX, screenY, col, row, flip = false, slot,
    fadeSlot = slot, zBase = 0, keyPrefix,
  }: PropStripSpritesProps,
) {
  const textures = useMemo(() => stripTexturesFor(texture, strips), [texture, strips]);
  // Zoom-peel: one alpha for the whole prop, recomputed only when the camera's zoom changes
  // (the ladder is stepped, so this is a handful of re-renders per gesture, not per frame).
  const alpha = alphaForSlot(fadeSlot, useCameraZoom());

  return (
    <>
      {strips.map((s, i) => (
        <pixiSprite
          key={`${keyPrefix}:strip${s.stripIndex}`}
          texture={textures[i]}
          // `offsetX` is the strip's LEFT screen edge relative to the base-corner anchor; pairing
          // anchor.x = 1 with scale.x = -1 makes the mirrored strip also draw rightward from it, so
          // the strips retile the exact pixel columns of the unsliced sprite (no seams, no stretch).
          x={screenX + s.offsetX}
          y={screenY}
          anchor={{ x: flip ? 1 : 0, y: anchorY }}
          scale={{ x: flip ? -1 : 1, y: 1 }}
          alpha={alpha}
          zIndex={zBase + computeLayerZ(col + s.footIsoX, row + s.footIsoY, slot)}
          eventMode="none"
        />
      ))}
    </>
  );
}
