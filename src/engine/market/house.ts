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
 * FOOTPRINT. A house occupies a rectangle of {@link HOUSE_FOOTPRINT_X} cells along
 * isoX (E–W) × {@link HOUSE_FOOTPRINT_Y} along isoY (N–S), anchored at its FRONT
 * (near, min-iso) corner — the cell whose south vertex the house's base-diamond
 * front corner seats on. The block extends +isoX (east) and +isoY (north), i.e.
 * up-and-back into the board from that corner.
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

/** Footprint span in cells: 4 along isoX (E–W). */
export const HOUSE_FOOTPRINT_X = 4;
/** Footprint span in cells: 5 along isoY (N–S). */
export const HOUSE_FOOTPRINT_Y = 5;

/** The cells a house anchored at front corner (col,row) occupies, as "col,row" keys. */
export function houseFootprintCells(col: number, row: number): string[] {
  const cells: string[] = [];
  for (let dx = 0; dx < HOUSE_FOOTPRINT_X; dx++) {
    for (let dy = 0; dy < HOUSE_FOOTPRINT_Y; dy++) {
      cells.push(`${col + dx},${row + dy}`);
    }
  }
  return cells;
}

/** Whether the whole footprint anchored at (col,row) fits inside a width×height board. */
export function houseFits(col: number, row: number, width: number, height: number): boolean {
  return col >= 0 && row >= 0
    && col + HOUSE_FOOTPRINT_X <= width
    && row + HOUSE_FOOTPRINT_Y <= height;
}

/** Union of every cell covered by the given house anchors. */
export function houseOccupiedCells(anchors: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const a of anchors) {
    const [col, row] = a.split(',').map(Number);
    for (const c of houseFootprintCells(col, row)) out.add(c);
  }
  return out;
}

/** The anchor of the house whose footprint covers (col,row), or null if none does. */
export function houseAnchorCovering(
  anchors: Iterable<string>,
  col: number,
  row: number,
): string | null {
  for (const a of anchors) {
    const [ac, ar] = a.split(',').map(Number);
    if (col >= ac && col < ac + HOUSE_FOOTPRINT_X && row >= ar && row < ar + HOUSE_FOOTPRINT_Y) {
      return a;
    }
  }
  return null;
}
