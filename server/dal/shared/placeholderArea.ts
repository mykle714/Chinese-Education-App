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
 * The ONLY placeholder drop sizes: 5×5, 5×10, and the rotated 10×5. The save validator
 * rejects any off-menu size so a definition can never carry one. Mirror of
 * `PLACEHOLDER_SIZES` in the client module — order matters (it drives the client's size
 * toggle) and the guard test asserts value+order equality.
 */
export const PLACEHOLDER_SIZES: ReadonlyArray<{ w: number; h: number }> = [
  { w: 5, h: 5 },
  { w: 5, h: 10 },
  { w: 10, h: 5 },
] as const;

/** Whether two placeholder areas share any cell (axis-aligned rectangle overlap). */
export function placeholderAreasOverlap(a: PlaceholderArea, b: PlaceholderArea): boolean {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}
