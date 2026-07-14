/**
 * House prop geometry — the shared placement math for the free-farm `House.png`
 * building, used by BOTH the live nmp house
 * ({@link ../../features/nightmarket/HouseLayer}) and the template editor's house
 * tool ({@link ../../features/nightmarket/TemplateEditorPage}).
 *
 * LAYER: pure geometry/data. Dimensions + anchor fractions + footprint-cell helpers
 * only — it imports NO asset (the PNG is pulled in by the view components), so pure
 * layers like {@link ./farmTerrain} can depend on it without dragging in an image.
 *
 * FOOTPRINT. A house occupies a rectangle anchored at its FRONT (near, min-iso) corner —
 * the cell whose south vertex the house's base-diamond front corner seats on — extending
 * +isoX (east) and +isoY (north), i.e. up-and-back into the board from that corner. By
 * default the block is {@link HOUSE_FOOTPRINT_X} cells along isoX × {@link HOUSE_FOOTPRINT_Y}
 * along isoY (4×5).
 *
 * MIRROR. A house's sprite can be h-flipped (mirrored about its front corner). In iso screen
 * space a horizontal mirror about that corner SWAPS the +isoX and +isoY directions, so a
 * mirrored house's ground block is the TRANSPOSE of the default — 5 along isoX × 4 along isoY.
 * Every footprint/occupancy helper therefore takes the house's `flip` so the reserved cells
 * track what the (mirrored) sprite actually covers. See {@link houseFootprintSpans}.
 */

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
 * The footprint spans for a house's mirror orientation. Flipping the sprite mirrors it
 * horizontally about its front corner, which swaps the +isoX/+isoY screen directions, so a
 * mirrored house's ground block is the TRANSPOSE of the default (5 along isoX × 4 along isoY).
 */
export function houseFootprintSpans(flip: boolean): { spanX: number; spanY: number } {
  return flip
    ? { spanX: HOUSE_FOOTPRINT_Y, spanY: HOUSE_FOOTPRINT_X }
    : { spanX: HOUSE_FOOTPRINT_X, spanY: HOUSE_FOOTPRINT_Y };
}

/** The cells a house anchored at front corner (col,row) with the given `flip` occupies, as
 *  "col,row" keys. `flip` transposes the spans (see {@link houseFootprintSpans}). */
export function houseFootprintCells(col: number, row: number, flip = false): string[] {
  const { spanX, spanY } = houseFootprintSpans(flip);
  const cells: string[] = [];
  for (let dx = 0; dx < spanX; dx++) {
    for (let dy = 0; dy < spanY; dy++) {
      cells.push(`${col + dx},${row + dy}`);
    }
  }
  return cells;
}

/** Whether the whole (flip-aware) footprint anchored at (col,row) fits inside a width×height board. */
export function houseFits(col: number, row: number, width: number, height: number, flip = false): boolean {
  const { spanX, spanY } = houseFootprintSpans(flip);
  return col >= 0 && row >= 0
    && col + spanX <= width
    && row + spanY <= height;
}

/** Union of every cell covered by the given houses (anchor → flip entries, e.g. a Map). */
export function houseOccupiedCells(houses: Iterable<[string, boolean]>): Set<string> {
  const out = new Set<string>();
  for (const [anchor, flip] of houses) {
    const [col, row] = anchor.split(',').map(Number);
    for (const c of houseFootprintCells(col, row, flip)) out.add(c);
  }
  return out;
}

/** The anchor of the house (from anchor → flip entries) whose flip-aware footprint covers
 *  (col,row), or null if none does. */
export function houseAnchorCovering(
  houses: Iterable<[string, boolean]>,
  col: number,
  row: number,
): string | null {
  for (const [anchor, flip] of houses) {
    const [ac, ar] = anchor.split(',').map(Number);
    const { spanX, spanY } = houseFootprintSpans(flip);
    if (col >= ac && col < ac + spanX && row >= ar && row < ar + spanY) {
      return anchor;
    }
  }
  return null;
}
