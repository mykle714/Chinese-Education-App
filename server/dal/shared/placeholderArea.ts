/**
 * Placeholder-area primitives — the SERVER mirror of the client's pure geometry module
 * `src/engine/market/placeholderArea.ts`. The server can't import the client module (it
 * lives outside the `server/` Docker build context — see the Dockerfile `COPY . .`), so the
 * type and the allowed drop sizes are duplicated here.
 *
 * The two copies are kept in sync BY the guard test `src/__tests__/placeholderAreaSync.test.ts`,
 * which fails the build if `PLACEHOLDER_SIZES` (or the area shape) drift — turning a silent
 * client/server disagreement into a loud test failure. If you change a size or the shape here,
 * change it in the client module too (or the guard will fail).
 *
 * LAYER: dep-free shared data/geometry (same family as the other `server/dal/shared/*`
 * mirror modules). No DB, no imports — so it stays cheap to import from a test.
 */

/**
 * A dropped placeholder area: near-corner anchor (`col,row`) + span (`w` along isoX,
 * `h` along isoY). Storing each drop as its own record (not a flat cell mask) is what keeps
 * two *adjacent* occupant slots distinct. Mirror of `PlaceholderArea` in the client module.
 */
export interface PlaceholderArea {
  col: number;
  row: number;
  w: number;
  h: number;
}

/**
 * The ONLY placeholder drop sizes: 4×5, the rotated 5×4, 4×10, and the rotated 10×4. The save
 * validator rejects any off-menu size so a definition can never carry one. Mirror of
 * `PLACEHOLDER_SIZES` in the client module — order matters (it drives the client's size
 * toggle) and the guard test asserts value+order equality.
 */
export const PLACEHOLDER_SIZES: ReadonlyArray<{ w: number; h: number }> = [
  { w: 4, h: 5 },
  { w: 5, h: 4 },
  { w: 4, h: 10 },
  { w: 10, h: 4 },
] as const;

/** Whether two placeholder areas share any cell (axis-aligned rectangle overlap). */
export function placeholderAreasOverlap(a: PlaceholderArea, b: PlaceholderArea): boolean {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

/** The "col,row" cell keys an area covers (its full w×h footprint). Mirror of the client fn. */
export function placeholderAreaCells(area: PlaceholderArea): string[] {
  const cells: string[] = [];
  for (let dx = 0; dx < area.w; dx++) {
    for (let dy = 0; dy < area.h; dy++) cells.push(`${area.col + dx},${area.row + dy}`);
  }
  return cells;
}

/** Whether the cell (col,row) falls inside `area`'s footprint. Mirror of the client fn. */
export function placeholderCoversCell(area: PlaceholderArea, col: number, row: number): boolean {
  return col >= area.col && col < area.col + area.w && row >= area.row && row < area.row + area.h;
}

/** The union of every area's cells, as a Set. Mirror of the client fn. */
export function placeholderCoveredCells(areas: readonly PlaceholderArea[]): Set<string> {
  const out = new Set<string>();
  for (const area of areas) for (const c of placeholderAreaCells(area)) out.add(c);
  return out;
}

/** The area whose footprint covers (col,row), or undefined. Mirror of the client fn. */
export function placeholderAreaAt(
  areas: readonly PlaceholderArea[],
  col: number,
  row: number,
): PlaceholderArea | undefined {
  return areas.find((a) => placeholderCoversCell(a, col, row));
}
