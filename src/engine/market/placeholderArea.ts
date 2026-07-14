/**
 * Placeholder-area geometry — the shared math for the Night Market template editor's
 * PLACEHOLDER tool (see {@link ../../features/nightmarket/TemplateEditorPage} and
 * docs/NIGHT_MARKET_TEMPLATES.md § "Placeholder areas").
 *
 * LAYER: pure geometry/data. No assets, no React — so pure engine layers like
 * {@link ./farmTerrain} can depend on it for the {@link PlaceholderArea} type without
 * dragging in a view.
 *
 * This is the SOURCE OF TRUTH for the area shape + drop sizes. The server can't import this
 * module (it lives outside the `server/` Docker build context), so `PlaceholderArea` and
 * {@link PLACEHOLDER_SIZES} are mirrored in server/dal/shared/placeholderArea.ts; the guard
 * test src/__tests__/placeholderAreaSync.test.ts fails the build if the two ever drift.
 *
 * A placeholder area is an occupant slot authored by DROPPING one of a fixed set of
 * rectangle sizes ({@link PLACEHOLDER_SIZES}) at a corner, instead of free-painting a
 * per-cell mask. Storing each drop as its own `{col,row,w,h}` record (rather than a flat
 * cell Set) is what lets two *adjacent* areas stay DISTINCT occupant slots — a merged mask
 * could not tell them apart. Like a house, an area is anchored at its near (min-iso) corner
 * and extends +isoX (col) / +isoY (row): it covers cols `[col, col+w-1]` × rows
 * `[row, row+h-1]`.
 */

/** A dropped placeholder area: near-corner anchor (`col,row`) + span (`w` along isoX, `h` along isoY). */
export interface PlaceholderArea {
  col: number;
  row: number;
  w: number;
  h: number;
}

/**
 * The ONLY placeholder sizes the drop tool offers, in Space-cycle order:
 * 5×5 → 5×10 → 10×5 (rotated) → back to 5×5. `w` is the isoX (col) span, `h` the isoY (row)
 * span; the third entry is the second rotated 90°. The editor's size toggle and the server
 * validator both key on this list, so a definition can never carry an off-menu size.
 */
export const PLACEHOLDER_SIZES: ReadonlyArray<{ w: number; h: number }> = [
  { w: 5, h: 5 },
  { w: 5, h: 10 },
  { w: 10, h: 5 },
] as const;

/** Whether `(w,h)` is one of the allowed drop sizes (guards both authoring and the save path). */
export function isValidPlaceholderSize(w: number, h: number): boolean {
  return PLACEHOLDER_SIZES.some((s) => s.w === w && s.h === h);
}

/** The "col,row" cell keys an area covers (its full w×h footprint). */
export function placeholderAreaCells(area: PlaceholderArea): string[] {
  const cells: string[] = [];
  for (let dx = 0; dx < area.w; dx++) {
    for (let dy = 0; dy < area.h; dy++) cells.push(`${area.col + dx},${area.row + dy}`);
  }
  return cells;
}

/** Whether the cell (col,row) falls inside `area`'s footprint. */
export function placeholderCoversCell(area: PlaceholderArea, col: number, row: number): boolean {
  return col >= area.col && col < area.col + area.w && row >= area.row && row < area.row + area.h;
}

/**
 * The union of every area's cells, as a Set — used where the old per-cell placeholder mask
 * was consumed (the condition-mask coupling, the highlight tint). Areas may not overlap, but
 * the Set is agnostic to that.
 */
export function placeholderCoveredCells(areas: readonly PlaceholderArea[]): Set<string> {
  const out = new Set<string>();
  for (const area of areas) for (const c of placeholderAreaCells(area)) out.add(c);
  return out;
}

/** The area whose footprint covers (col,row), or undefined — backs erase-by-click (remove the whole area). */
export function placeholderAreaAt(
  areas: readonly PlaceholderArea[],
  col: number,
  row: number,
): PlaceholderArea | undefined {
  return areas.find((a) => placeholderCoversCell(a, col, row));
}

/** Whether an area's whole footprint is inside a width×height board (no clipping — a drop that overhangs is refused). */
export function placeholderAreaFits(area: PlaceholderArea, width: number, height: number): boolean {
  return area.col >= 0 && area.row >= 0 && area.col + area.w <= width && area.row + area.h <= height;
}

/** Whether two areas share any cell (axis-aligned rectangle overlap). */
export function placeholderAreasOverlap(a: PlaceholderArea, b: PlaceholderArea): boolean {
  return (
    a.col < b.col + b.w && b.col < a.col + a.w &&
    a.row < b.row + b.h && b.row < a.row + a.h
  );
}

/** Whether `area` overlaps any already-placed area (drops onto an occupied slot are refused). */
export function placeholderAreaOverlapsAny(area: PlaceholderArea, areas: readonly PlaceholderArea[]): boolean {
  return areas.some((a) => placeholderAreasOverlap(area, a));
}
