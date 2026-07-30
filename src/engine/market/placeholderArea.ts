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
 * 4×5 → 5×4 (rotated) → 4×10 → 10×4 (rotated) → back to 4×5. `w` is the isoX (col) span, `h`
 * the isoY (row) span; each pair is a base rectangle followed by its 90° rotation (4×5 is no
 * longer square, so rotation now matters). Every size tiles exactly with 4×5 house-footprint
 * occupants (a 4×5 slot fits one house; a 4×10 fits two stacked) — that tiling is
 * {@link placeholderUnitSlots}, and each unit is ONE unlock. The editor's size toggle and the server
 * validator both key on this list, so a definition can never carry an off-menu size.
 */
export const PLACEHOLDER_SIZES: ReadonlyArray<{ w: number; h: number }> = [
  { w: 4, h: 5 },
  { w: 5, h: 4 },
  { w: 4, h: 10 },
  { w: 10, h: 4 },
] as const;

/** Whether `(w,h)` is one of the allowed drop sizes (guards both authoring and the save path). */
export function isValidPlaceholderSize(w: number, h: number): boolean {
  return PLACEHOLDER_SIZES.some((s) => s.w === w && s.h === h);
}

/**
 * The stable anchor id ("col_row", underscore) of a placeholder area — its near (min-iso)
 * corner. Unique within a template because areas can't overlap. This is the id the server
 * keys an occupant on (`nightmarketunlocks.placeholderAreaId`) and returns in a placement's
 * `filledPlaceholderIds`; MIRRORS `server/dal/shared/versionSelection.ts#placeholderAreaId`.
 * Note the underscore separator — distinct from the comma-separated "col,row" CELL keys.
 */
export function placeholderAreaId(area: Pick<PlaceholderArea, 'col' | 'row'>): string {
  return `${area.col}_${area.row}`;
}

/**
 * The two spans of ONE occupant slot unit — the footprint of a single occupant (one house):
 * {@link PLACEHOLDER_UNIT_SHORT} along one axis × {@link PLACEHOLDER_UNIT_LONG} along the other,
 * i.e. 4×5 or its 5×4 transpose. Every entry in {@link PLACEHOLDER_SIZES} is exactly one or two
 * of these, which is what makes {@link placeholderUnitSlots} an exact tiling.
 */
export const PLACEHOLDER_UNIT_SHORT = 4;
/** See {@link PLACEHOLDER_UNIT_SHORT}. Also the axis length the units are tiled along. */
export const PLACEHOLDER_UNIT_LONG = 5;

/**
 * Split an authored placeholder area into its UNIT SLOTS — the individual occupant slots it
 * holds, each one occupant-footprint (4×5 or 5×4) in size:
 *   - **4×5**  → one unit (the area itself)
 *   - **5×4**  → one unit (the area itself)
 *   - **4×10** → two 4×5 units STACKED along isoY (`row`, `row+5`)
 *   - **10×4** → two 5×4 units SIDE-BY-SIDE along isoX (`col`, `col+5`)
 *
 * WHY THIS EXISTS. An UNLOCK OCCUPIES ONE UNIT, not one authored area — a double-sized area is
 * two unlocks that fill one at a time (docs/NIGHT_MARKET_TEMPLATES.md § "Unlock economy"). Before
 * this split a single unlock lit up BOTH houses of a 4×10/10×4 area at once, so one earned minute
 * appeared to fill a whole template. `nightmarketunlocks.placeholderAreaId` therefore stores a
 * UNIT's anchor id, not the parent area's.
 *
 * Note the FIRST unit's anchor — and so its {@link placeholderAreaId} — is the parent area's own
 * anchor, which is why pre-split occupant rows stayed valid (they read as "first unit filled").
 *
 * The units run along whichever axis is a multiple of {@link PLACEHOLDER_UNIT_LONG}: an area whose
 * isoX span is the short side (4) stacks up the isoY (row) axis, otherwise they run along isoX.
 * The floor division is defensive — with `PLACEHOLDER_SIZES` fixed the tiling is always exact.
 */
export function placeholderUnitSlots(area: PlaceholderArea): PlaceholderArea[] {
  const alongRow = area.w === PLACEHOLDER_UNIT_SHORT;
  const w = alongRow ? PLACEHOLDER_UNIT_SHORT : PLACEHOLDER_UNIT_LONG;
  const h = alongRow ? PLACEHOLDER_UNIT_LONG : PLACEHOLDER_UNIT_SHORT;
  const count = Math.max(1, Math.floor((alongRow ? area.h : area.w) / PLACEHOLDER_UNIT_LONG));

  return Array.from({ length: count }, (_, i) =>
    alongRow
      ? { col: area.col, row: area.row + i * PLACEHOLDER_UNIT_LONG, w, h }
      : { col: area.col + i * PLACEHOLDER_UNIT_LONG, row: area.row, w, h },
  );
}

/** Every unit slot of every area, flattened — the full occupant-slot pool of one template. */
export function placeholderUnitSlotsOf(areas: readonly PlaceholderArea[]): PlaceholderArea[] {
  return areas.flatMap(placeholderUnitSlots);
}

/** The unit slot of `areas` covering the cell (col,row), or undefined — the id an unlock keys on. */
export function placeholderUnitSlotAt(
  areas: readonly PlaceholderArea[],
  col: number,
  row: number,
): PlaceholderArea | undefined {
  const area = placeholderAreaAt(areas, col, row);
  if (!area) return undefined;
  return placeholderUnitSlots(area).find((u) => placeholderCoversCell(u, col, row));
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
