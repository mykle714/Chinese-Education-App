/**
 * House prop geometry — the shared placement math for the free-farm `House.png`
 * building, used by the live nmp house ({@link ../../features/nightmarket/HouseLayer})
 * and the placeholder-occupant renderers (the runtime
 * {@link ../../features/nightmarket/PlaceholderHouseLayer} and the template editor's
 * filled-slot preview) via {@link occupantHousesForArea}.
 *
 * LAYER: pure geometry/data. Dimensions + anchor fractions + the occupant-tiling helper
 * only — it imports NO asset (the PNG is pulled in by the view components), so pure
 * layers can depend on it without dragging in an image.
 *
 * DEPTH. A house is 4–5 cells wide, so it is NOT drawn as one sprite — {@link HOUSE_STRIPS} cuts
 * it into per-screen-column strips, each with its own foot anchor, so pedestrians and terrain sort
 * correctly against its near-left and near-right wings independently.
 *
 * FOOTPRINT. A house occupies a rectangle anchored at its FRONT (near, min-iso) corner —
 * the cell whose south vertex the house's base-diamond front corner seats on — extending
 * +isoX (east) and +isoY (north), i.e. up-and-back into the board from that corner. By
 * default the block is {@link HOUSE_FOOTPRINT_X} cells along isoX × {@link HOUSE_FOOTPRINT_Y}
 * along isoY (4×5); an h-flipped house is the TRANSPOSE (5 along isoX × 4 along isoY) because a
 * horizontal mirror about the front corner swaps the +isoX/+isoY screen directions.
 */

import { computeSpriteStrips } from './isometric';
import { placeholderUnitSlots } from './placeholderArea';

/** Native `House.png` frame size (square). */
export const HOUSE_TEX_SIZE = 160;

/**
 * The house's base-diamond FRONT corner in texture pixels (measured from the art).
 * The sprite anchors here — NOT the frame's bottom-centre — so the base corner
 * seats on the foot tile's front vertex.
 */
export const HOUSE_BASE_CORNER = { x: 90.5, y: 155 } as const;

/** Pixi anchor fraction placing {@link HOUSE_BASE_CORNER} at the sprite's position. */
export const HOUSE_ANCHOR = {
  x: HOUSE_BASE_CORNER.x / HOUSE_TEX_SIZE,
  y: HOUSE_BASE_CORNER.y / HOUSE_TEX_SIZE,
} as const;

/** Default footprint span in cells: 4 along isoX (E–W). */
export const HOUSE_FOOTPRINT_X = 4;
/** Default footprint span in cells: 5 along isoY (N–S). */
export const HOUSE_FOOTPRINT_Y = 5;

/**
 * Per-screen-column depth slices of `House.png`, relative to a house whose front corner sits at
 * cell (0, 0) — add the house's `col`/`row` to each strip's `footIsoX`/`footIsoY` to get its real
 * foot anchor. See the "Sprite-strip slicing" block in {@link ./isometric} for why a building this
 * wide cannot be depth-sorted as one sprite.
 *
 * Two tables because a mirrored house is not just a mirrored image — the flip transposes the
 * footprint (5 along isoX × 4 along isoY), and the depth mapping is derived from the post-flip
 * screen position, so `computeSpriteStrips` produces the transposed feet automatically.
 *
 * At the default strip width (TILE_WIDTH/2 = 16 tex px) the 160px frame cuts into 9 anchor-aligned
 * columns plus the two overhang partials (11 strips), and the outermost feet land at ~3.97 / ~5.03
 * iso units from the front corner — i.e. the art's base diamond really does span the authored 4×5
 * footprint, with a few px of roof eave past each far edge.
 */
export const HOUSE_STRIPS = {
  normal: computeSpriteStrips({
    footIsoX: 0, footIsoY: 0,
    texW: HOUSE_TEX_SIZE, texH: HOUSE_TEX_SIZE,
    anchorTexX: HOUSE_BASE_CORNER.x,
  }),
  flipped: computeSpriteStrips({
    footIsoX: 0, footIsoY: 0,
    texW: HOUSE_TEX_SIZE, texH: HOUSE_TEX_SIZE,
    anchorTexX: HOUSE_BASE_CORNER.x,
    flip: true,
  }),
} as const;

/**
 * Tile a placeholder area (a `{col,row,w,h}` rectangle) with 4×5 house footprints, returning each
 * occupant house's front-corner anchor + flip. Used to render the placeholder OCCUPANT as one or
 * two houses — by the runtime {@link ../../features/nightmarket/PlaceholderHouseLayer} and the
 * template editor's filled-slot preview.
 *
 * The placeholder drop sizes (`PLACEHOLDER_SIZES`) are exactly one or two house footprints:
 *   - **4×5**  → ONE house (no flip), footprint 4×5.
 *   - **5×4**  → ONE flipped house (the 5×4 transpose).
 *   - **4×10** → TWO no-flip houses STACKED along isoY (row, row+5).
 *   - **10×4** → TWO flipped houses SIDE-BY-SIDE along isoX (col, col+5).
 *
 * The TILING ITSELF is not computed here — it is {@link ./placeholderArea placeholderUnitSlots},
 * the same split the unlock economy uses to decide slot identity (one unit = one unlock), so the
 * art can never disagree with what the server considers occupied. This function only adds the
 * `flip`: a house's long side is {@link HOUSE_FOOTPRINT_Y} (5), so an area whose isoX span is
 * {@link HOUSE_FOOTPRINT_X} (4) holds no-flip houses running up the isoY axis, and otherwise
 * (`w` is 5 or 10) flipped houses running along the isoX axis.
 *
 * NOTE this returns a house for EVERY unit of the area regardless of occupancy — callers that
 * render live occupants pass an already-per-unit slot (so they get exactly one house); the
 * editor's preview passes whole authored areas to show a fully occupied slot.
 */
export function occupantHousesForArea(
  area: { col: number; row: number; w: number; h: number },
): Array<{ col: number; row: number; flip: boolean }> {
  const flip = area.w !== HOUSE_FOOTPRINT_X;
  return placeholderUnitSlots(area).map((unit) => ({ col: unit.col, row: unit.row, flip }));
}
