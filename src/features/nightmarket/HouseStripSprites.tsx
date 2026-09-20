import type { Texture } from 'pixi.js';
import type { RenderSlot } from '../../engine/market/nightMarketRegistry';
import { HOUSE_ANCHOR, HOUSE_STRIPS } from '../../engine/market/house';
import PropStripSprites from './PropStripSprites';

/**
 * HouseStripSprites — the ONE house renderer. Draws a single `House.png` at a foot cell,
 * depth-sorted per screen column.
 *
 * LAYER: view. Shared by all three surfaces that paint a house so they cannot drift apart:
 *   - {@link ./HouseLayer}             — the hard-coded sample house on the nmp farm field
 *   - {@link ./PlaceholderHouseLayer}  — the runtime filled-placeholder occupant
 *   - `PlaceholderOccupantHouses` in {@link ./TemplateEditorViewer} — the editor's filled-slot preview
 *
 * It is now a THIN WRAPPER over {@link ./PropStripSprites}, which draws every multi-cell prop
 * on the board (the house and the lumeish furniture pack alike) — this component's only job is
 * to supply the house's own art description. The strip geometry it passes comes from
 * {@link ../../engine/market/house HOUSE_STRIPS}, which is itself derived from the shared
 * `PropArt`/`propStrips` system in {@link ../../engine/market/footprint}; the "why strips at
 * all" derivation lives in `PropStripSprites`.
 */

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
  return (
    <PropStripSprites
      texture={texture}
      strips={flip ? HOUSE_STRIPS.flipped : HOUSE_STRIPS.normal}
      anchorY={HOUSE_ANCHOR.y}
      screenX={screenX}
      screenY={screenY}
      col={col}
      row={row}
      flip={flip}
      slot={slot}
      fadeSlot={fadeSlot}
      zBase={zBase}
      keyPrefix={keyPrefix}
    />
  );
}
