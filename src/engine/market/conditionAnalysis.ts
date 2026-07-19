import { labelIslands, type CellIsland } from './placeholderIslands';
import {
  placeholderAreaAt,
  placeholderCoveredCells,
  type PlaceholderArea,
} from './placeholderArea';

/**
 * conditionAnalysis — classify a version's condition mask into scored CONDITIONS for the
 * version selector (docs/NIGHT_MARKET_TEMPLATES.md § "Version selection rule",
 * docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md § "Version selection — condition-mask island
 * analysis").
 *
 * LAYER: pure engine. No React, no DB, no assets. Works entirely in a template's LOCAL
 * (col,row) coordinates — the caller (version selector) translates to global coords when it
 * tests border-street islands against neighbors.
 *
 * ── What a "condition" is ───────────────────────────────────────────────────────────────
 * A condition is ONE 4-connected island of condition cells. Two substrates:
 *   • PLACEHOLDER island — sits on placeholder cells; satisfied when its area is FILLED.
 *   • BORDER-STREET island — sits on outer-edge street cells; satisfied when a separate
 *     placed template ABUTS that edge.
 *
 * ── Canonical at load (decision 2026-07-17) ─────────────────────────────────────────────
 * The runtime does NOT trust the persisted mask's border-street cells. Instead it takes the
 * author's MANUAL condition cells (which the editor's condition tool only ever paints onto
 * placeholder cells) and RE-DERIVES the border-street conditions itself from
 * `street ∩ outer-edge`. So border conditions can never go stale if the auto-add rule
 * changes or a template predates it. `conditionCount` here is the canonical denominator
 * (islands.length); the persisted scalar column is an author-facing convenience only.
 *
 * ── Substrate invariant + fallback ──────────────────────────────────────────────────────
 * Authors keep placeholder-condition cells and border-street cells NON-ADJACENT, so every
 * island is purely one kind. A mixed island (touches both) is a malformed authoring state:
 * it is coerced to PLACEHOLDER and an error is logged (docs § Version selection rule).
 *
 * DEPENDS ON: {@link ./placeholderIslands labelIslands}, {@link ./placeholderArea}.
 * Consumed by: the de-stubbed version selector (step 4).
 */

export type ConditionKind = 'placeholder' | 'border-street';

/** One classified condition (a labeled island of the combined condition mask). */
export interface ConditionIsland extends CellIsland {
  kind: ConditionKind;
  /**
   * PLACEHOLDER islands: the anchor id (`"col_row"`) of the authored placeholder area the
   * island sits on — the same id an unlock records as `placeholderAreaId`. `undefined` when
   * the island matches no area (malformed — logged; the condition is then unsatisfiable).
   */
  placeholderAreaId?: string;
  /** True when a mixed-substrate island was coerced to placeholder (fallback path). */
  mixedFallback?: boolean;
}

/** The result of analyzing one version's condition mask. */
export interface ConditionAnalysis {
  islands: ConditionIsland[];
  /** Canonical per-version condition count = number of islands (the scoring denominator). */
  conditionCount: number;
}

export interface ConditionAnalysisInput {
  /** The author's MANUAL condition cells (persisted mask; placeholder-substrate), LOCAL coords. */
  condition: Set<string>;
  /** The authored placeholder areas ({col,row,w,h}) — the shared v0 set. */
  placeholderAreas: readonly PlaceholderArea[];
  /** The version's street-walkable cells, LOCAL coords. */
  street: Set<string>;
  /** Board dimensions (cells) — define the outer edge. */
  width: number;
  height: number;
}

/** An anchor-id (`"col_row"`) for an authored placeholder area — stable + unique (areas can't overlap). */
export function placeholderAreaId(area: PlaceholderArea): string {
  return `${area.col}_${area.row}`;
}

/**
 * The outer-edge street cells of a board — the auto-added border-street condition cells.
 * A cell is on the outer edge when it lies on the first/last column or row.
 */
export function borderStreetCells(
  street: Set<string>,
  width: number,
  height: number,
): Set<string> {
  const out = new Set<string>();
  for (const key of street) {
    const [col, row] = key.split(',').map(Number);
    if (col === 0 || col === width - 1 || row === 0 || row === height - 1) out.add(key);
  }
  return out;
}

/**
 * Classify a version's condition mask into scored conditions.
 *
 * Steps: (1) re-derive border-street cells from `street ∩ outer-edge`; (2) label the union
 * of manual + border-street cells into 4-connected islands; (3) classify each island by the
 * substrate its cells sit on, mapping placeholder islands to their authored area id.
 */
export function analyzeConditions(input: ConditionAnalysisInput): ConditionAnalysis {
  const { condition, placeholderAreas, street, width, height } = input;

  const borderCells = borderStreetCells(street, width, height);
  const placeholderCells = placeholderCoveredCells(placeholderAreas);

  // Combined condition mask = author's manual cells ∪ derived border-street cells.
  const combined = new Set<string>(condition);
  for (const c of borderCells) combined.add(c);

  const islands = labelIslands(combined).map((island): ConditionIsland => {
    let hasPlaceholder = false;
    let hasBorder = false;
    for (const cell of island.cells) {
      if (placeholderCells.has(cell)) hasPlaceholder = true;
      if (borderCells.has(cell)) hasBorder = true;
    }

    // Mixed substrate → malformed authoring state → coerce to placeholder + log.
    if (hasPlaceholder && hasBorder) {
      console.error(
        `[conditionAnalysis] island ${island.id} mixes placeholder + border-street cells ` +
          `(authoring invariant: keep them non-adjacent). Coercing to a placeholder condition.`,
      );
      return { ...island, kind: 'placeholder', placeholderAreaId: areaIdForIsland(island, placeholderAreas), mixedFallback: true };
    }

    if (hasBorder) return { ...island, kind: 'border-street' };

    // Placeholder substrate (or malformed "neither"). A condition cell that sits on neither a
    // placeholder nor a border street is malformed; we coerce it to placeholder (matching the
    // mixed-island default) with no area match, so it is counted but never satisfiable.
    if (!hasPlaceholder) {
      console.error(
        `[conditionAnalysis] island ${island.id} sits on neither placeholder nor border-street ` +
          `cells (malformed). Treating as an unsatisfiable placeholder condition.`,
      );
    }
    return { ...island, kind: 'placeholder', placeholderAreaId: areaIdForIsland(island, placeholderAreas) };
  });

  return { islands, conditionCount: islands.length };
}

/** Find the authored area id covering any of an island's cells (the min cell first). */
function areaIdForIsland(island: CellIsland, areas: readonly PlaceholderArea[]): string | undefined {
  for (const key of island.cells) {
    const [col, row] = key.split(',').map(Number);
    const area = placeholderAreaAt(areas, col, row);
    if (area) return placeholderAreaId(area);
  }
  return undefined;
}
