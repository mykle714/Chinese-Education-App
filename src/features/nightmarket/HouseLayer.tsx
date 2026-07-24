import { useCallback, useEffect, useState } from 'react';
import { Assets, Graphics, Texture } from 'pixi.js';
import { isoToScreen } from '../../engine/market/isometric';
import HouseStripSprites from './HouseStripSprites';
// House.png lives in the pack's `Originals/` bucket, which freeFarmTileset
// deliberately excludes (un-adopted source art), so it is imported directly
// rather than resolved through the tileset registry.
import houseUrl from '../../assets/free-assets/free-farm-assets/Environment/Originals/House.png';

/**
 * HouseLayer — renders a single house prop on the free-farm ground field.
 *
 * LAYER: view. Foot-anchored into the ground plane like a scatter decor (see the decor
 * pass in {@link FarmTerrainLayer}), but emitted through {@link ./HouseStripSprites}: its
 * measured base-diamond FRONT CORNER lands on the foot tile's front vertex, and the sprite
 * is sliced into per-screen-column strips so its 4-cell width does not collapse to a single
 * depth. No whole-plane z-lift — being foot-anchored, tiles BEHIND it draw underneath and
 * tiles IN FRONT draw over it.
 *
 * It sorts in the `entity` slot (a decor uses `background`) — see the slot note on the
 * component below; that is also what lets a pedestrian pass behind it.
 *
 * NOTE: the foot tile is a hard-coded SAMPLE — replace with an authored/
 * data-driven placement once buildings become part of the market layout.
 */

/** Foot tile the house stands on (iso grid units). On the near side of the grass
 * patch, in view at the default zoom (which centers on the iso origin). */
const HOUSE_FOOT: { isoX: number; isoY: number } = { isoX: 5, isoY: 5 };

// The house-specific {@link HOUSE_ANCHOR} (base-diamond front corner, not the frame's
// bottom-center) is shared with the template editor via engine/market/house.ts.

// ── Anchor-point debug marker ────────────────────────────────────────────────
// Magenta crosshair + dot drawn at the sprite's anchor point (its bottom-center /
// foot vertex) so the exact placement point is visible on the field. Floated well
// above the house so it always reads.
const ANCHOR_MARKER_ARM = 4;   // crosshair arm length, pre-zoom screen px
const ANCHOR_MARKER_COLOR = 0xff00ff;
const ANCHOR_MARKER_Z = 10_500; // above the house; just over the origin crosshair (10_000)

export default function HouseLayer() {
  const [texture, setTexture] = useState<Texture | null>(null);

  const { screenX: anchorX, screenY: anchorY } = isoToScreen(HOUSE_FOOT.isoX, HOUSE_FOOT.isoY);
  const drawAnchor = useCallback((g: Graphics) => {
    g.clear();
    // Crosshair.
    g.moveTo(anchorX - ANCHOR_MARKER_ARM, anchorY);
    g.lineTo(anchorX + ANCHOR_MARKER_ARM, anchorY);
    g.moveTo(anchorX, anchorY - ANCHOR_MARKER_ARM);
    g.lineTo(anchorX, anchorY + ANCHOR_MARKER_ARM);
    g.stroke({ color: ANCHOR_MARKER_COLOR, width: 0.75, alpha: 1 });
    // Centre dot on the exact anchor pixel.
    g.circle(anchorX, anchorY, 0.9);
    g.fill({ color: ANCHOR_MARKER_COLOR, alpha: 1 });
  }, [anchorX, anchorY]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tex = await Assets.load<Texture>(houseUrl);
      tex.source.scaleMode = 'nearest'; // crisp pixel-art upscaling
      if (!cancelled) setTexture(tex);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!texture) return null;

  return (
    <>
      <HouseStripSprites
        keyPrefix="sample-house"
        texture={texture}
        screenX={anchorX}
        screenY={anchorY}
        col={HOUSE_FOOT.isoX}
        row={HOUSE_FOOT.isoY}
        // `entity`, NOT `background`: each strip now sorts at the depth of the very cells it
        // covers, so a background-slot house would tie/lose against those cells' own scatter
        // decor (`decorZ = z + 0.1`) and let the ground punch through its wings. The entity
        // slot clears every terrain sub-layer by ≥0.1 at equal depth, and pedestrians (also
        // `entity`) still sort per screen column against it.
        slot="entity"
      />
      {/* Debug: the sprite's anchor / foot point. */}
      <pixiGraphics draw={drawAnchor} zIndex={ANCHOR_MARKER_Z} />
    </>
  );
}
