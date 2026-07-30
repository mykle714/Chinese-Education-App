import { useMemo } from 'react';
import { Rectangle, Texture } from 'pixi.js';
import type { RenderSlot } from '../../engine/market/nightMarketRegistry';
import { computeLayerZ } from '../../engine/market/isometric';
import { HOUSE_ANCHOR, HOUSE_STRIPS } from '../../engine/market/house';
import { alphaForSlot } from '../../engine/market/layerTranslucency';
import { useCameraZoom } from './CameraZoomContext';

/**
 * HouseStripSprites — the ONE house renderer. Draws a single `House.png` at a foot cell as a row
 * of full-height vertical STRIPS, each z-sorted at its own implied foot anchor.
 *
 * LAYER: view. Shared by all three surfaces that paint a house so they cannot drift apart:
 *   - {@link ./HouseLayer}             — the hard-coded sample house on the nmp farm field
 *   - {@link ./PlaceholderHouseLayer}  — the runtime filled-placeholder occupant
 *   - `PlaceholderOccupantHouses` in {@link ./TemplateEditorViewer} — the editor's filled-slot preview
 *
 * WHY STRIPS. A house spans 4–5 cells, so one sprite with one foot anchor gives its whole width a
 * single depth: a pedestrian beside the near-LEFT wing and one beside the near-RIGHT wing sorted
 * against the same z, and one of them was always wrong (walker swallowed by the wall, or floating
 * over the roof). Slicing per screen column gives each column the depth of the block's nearest
 * surface point there. Geometry + the strip tables live in {@link ../../engine/market/house}; the
 * slicing math is `computeSpriteStrips` in {@link ../../engine/market/isometric}.
 *
 * Sprites are emitted FLAT (direct children of the caller's `sortableChildren` container) so the
 * strips interleave with terrain, decor and pedestrians rather than sorting only among themselves.
 *
 * ZOOM-PEEL. Every strip carries the alpha its layer's slot has at the current camera zoom
 * ({@link ../../engine/market/layerTranslucency alphaForSlot}), so the building's shell ghosts out
 * as the camera closes in. Alpha is applied PER STRIP rather than to a wrapping container on
 * purpose — a container would need its own `alpha` AND would re-parent the strips out of the
 * caller's global sort, breaking the interleaving described above. Since the strips are
 * anchor-aligned edge-to-edge (no overlapping pixels), per-strip alpha composites identically to
 * whole-sprite alpha with no double-blended seams.
 */

/**
 * Sub-texture cache: the strip frames are identical for every house, so the 10 (+10 flipped, which
 * reuse the same frames — the mirror is a negative scale, not a different crop) sub-textures are
 * built once per source texture instead of once per house.
 */
const stripTextureCache = new WeakMap<Texture, Texture[]>();

function stripTexturesFor(texture: Texture): Texture[] {
  const cached = stripTextureCache.get(texture);
  if (cached) return cached;
  const built = HOUSE_STRIPS.normal.map((s) => new Texture({
    source: texture.source,
    frame: new Rectangle(s.frame.x, s.frame.y, s.frame.w, s.frame.h),
  }));
  stripTextureCache.set(texture, built);
  return built;
}

interface HouseStripSpritesProps {
  /** The loaded (full-frame) House.png texture. */
  texture: Texture;
  /** Screen position of the house's front-corner foot cell (from `isoToScreen`). */
  screenX: number;
  screenY: number;
  /** Foot cell in GLOBAL iso cells — the depth basis each strip's implied foot is added to. */
  col: number;
  row: number;
  /** Horizontally mirrored house (footprint transposes to 5×4). */
  flip?: boolean;
  /** Render slot for every strip — drives DEPTH (`computeLayerZ`). */
  slot: RenderSlot;
  /**
   * Slot the zoom-peel fade is looked up under, when it must differ from the depth `slot`.
   *
   * These are the same axis for a properly LAYERED asset — a real building declares each
   * sub-image's slot once and both depth and fade follow from it. `House.png` is a TEST asset with
   * no layers: it is a single flat image that has to sort in the `entity` slot (so pedestrians
   * interleave with its wings correctly), yet what it depicts is a roof-and-walls shell, i.e.
   * `foreground` material. Hence the default below — it lets the peel be seen on the placeholder
   * art today without lying about the sprite's depth. When the layered assets land, each layer
   * passes a single honest `slot` and this override falls away.
   */
  fadeSlot?: RenderSlot;
  /** Flat z added to every strip (surface-specific lifts; keeps relative strip order intact). */
  zBase?: number;
  /** Disambiguates strip keys when several houses render in one parent. */
  keyPrefix: string;
}

export default function HouseStripSprites(
  {
    texture, screenX, screenY, col, row, flip = false, slot,
    fadeSlot = 'foreground', zBase = 0, keyPrefix,
  }: HouseStripSpritesProps,
) {
  const textures = useMemo(() => stripTexturesFor(texture), [texture]);
  const strips = flip ? HOUSE_STRIPS.flipped : HOUSE_STRIPS.normal;
  // Zoom-peel: one alpha for the whole house, recomputed only when the camera's zoom changes
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
          anchor={{ x: flip ? 1 : 0, y: HOUSE_ANCHOR.y }}
          scale={{ x: flip ? -1 : 1, y: 1 }}
          alpha={alpha}
          zIndex={zBase + computeLayerZ(col + s.footIsoX, row + s.footIsoY, slot)}
          eventMode="none"
        />
      ))}
    </>
  );
}
