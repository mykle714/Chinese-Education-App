import { tileKey } from './tileGraph';

/**
 * placeholderIslands — 4-connected component ("island") labeling of a cell mask
 * (docs/NIGHT_MARKET_TEMPLATES.md § "Placeholder areas" + § "Version selection rule",
 * docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md § placeholderIslands, version-selection engine).
 *
 * LAYER: pure engine. No React, no DB, no assets. A pure function of a cell-key set;
 * nothing here is persisted — labeling re-runs on every load.
 *
 * ── What this is for ────────────────────────────────────────────────────────────────────
 * The reusable core is {@link labelIslands}: split any `Set<"col,row">` mask into its
 * 4-connected components. Two consumers in the version-selection engine:
 *   1. Condition-mask island analysis (a separate module) labels the per-version condition
 *      mask into islands — each island is ONE "condition" (docs § Version selection rule).
 *   2. Mapping a placeholder-substrate condition island → the authored placeholder AREA it
 *      sits on (to test whether that area is filled).
 *
 * ⚠️ NOTE — placeholder AREAS are NOT derived here in the runtime. They are authored
 * explicitly as `{col,row,w,h}` records (single-sourced on version 0) and surface via
 * `stitchWorld` as `terrain.placeholders` (docs § Storage → "Placeholder areas ... read
 * directly from the stored records; no derivation step"). {@link computePlaceholderAreas}
 * below flood-fills a raw placeholder MASK back into areas — a convenience for validation
 * or for callers that only hold a mask; it is NOT the primary source of areas. Prefer the
 * authored rects wherever they are available.
 *
 * DEPENDS ON: {@link ./tileGraph tileKey} (cell-key format "col,row").
 */

/** An axis-aligned inclusive bounding box in cell (col,row) units. */
export interface CellRect {
  minCol: number;
  minRow: number;
  maxCol: number;
  maxRow: number;
}

/** One 4-connected component of a cell mask. */
export interface CellIsland {
  /**
   * Deterministic id derived from the island's min cell (min col, then min row), so it is
   * stable across versions/loads regardless of mask iteration order. Format `"col_row"`.
   */
  id: string;
  cells: Set<string>;
  bbox: CellRect;
}

/** Semantic alias: a placeholder area recovered from a raw mask is just a labeled island. */
export type PlaceholderArea = CellIsland;

/** Parse a "col,row" cell key into a numeric coordinate pair. */
function parseCell(key: string): [number, number] {
  const [col, row] = key.split(',').map(Number);
  return [col, row];
}

/**
 * Split a cell mask into its 4-connected components (islands).
 *
 * Seeds are visited in a deterministic (sorted col→row) order, and the returned islands are
 * sorted by id, so the output is stable across loads. Each island's `id` comes from its min
 * cell, which is invariant to how the input set was built. Uses an explicit stack (no
 * recursion) so a large mask can't blow the call stack.
 */
export function labelIslands(cells: Set<string>): CellIsland[] {
  const visited = new Set<string>();
  const islands: CellIsland[] = [];

  // Deterministic seed order (col then row) → stable labeling.
  const seeds = [...cells].sort((a, b) => {
    const [ac, ar] = parseCell(a);
    const [bc, br] = parseCell(b);
    return ac - bc || ar - br;
  });

  for (const seed of seeds) {
    if (visited.has(seed)) continue;

    // Flood-fill this component with an explicit stack (4-connectivity).
    const component = new Set<string>();
    let minCol = Infinity;
    let minRow = Infinity;
    let maxCol = -Infinity;
    let maxRow = -Infinity;
    const stack = [seed];
    visited.add(seed);

    while (stack.length > 0) {
      const key = stack.pop()!;
      const [col, row] = parseCell(key);
      component.add(key);
      if (col < minCol) minCol = col;
      if (row < minRow) minRow = row;
      if (col > maxCol) maxCol = col;
      if (row > maxRow) maxRow = row;

      // 4-connected neighbors: E, W, S, N.
      const neighbors = [
        tileKey(col + 1, row),
        tileKey(col - 1, row),
        tileKey(col, row + 1),
        tileKey(col, row - 1),
      ];
      for (const n of neighbors) {
        if (cells.has(n) && !visited.has(n)) {
          visited.add(n);
          stack.push(n);
        }
      }
    }

    islands.push({
      id: `${minCol}_${minRow}`,
      cells: component,
      bbox: { minCol, minRow, maxCol, maxRow },
    });
  }

  // Sort by id (col then row) for a stable, deterministic return order.
  islands.sort((a, b) => {
    const [ac, ar] = parseCell(a.id.replace('_', ','));
    const [bc, br] = parseCell(b.id.replace('_', ','));
    return ac - bc || ar - br;
  });

  return islands;
}

/**
 * Recover placeholder AREAS from a raw placeholder cell mask by 4-connected labeling.
 *
 * ⚠️ Convenience only — see the module header. The authored `{col,row,w,h}` records are the
 * primary source of placeholder areas; use this only when a caller holds a bare mask (e.g.
 * validation, tests, or a legacy path). A thin semantic wrapper over {@link labelIslands}.
 */
export function computePlaceholderAreas(placeholder: Set<string>): PlaceholderArea[] {
  return labelIslands(placeholder);
}
