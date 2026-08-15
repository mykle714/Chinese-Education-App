/**
 * cellKey — packing a cell coordinate pair into a single number.
 *
 * LAYER: pure engine. No React, no Pixi, no DB.
 *
 * WHY. The night market addresses cells by `(col, row)` and, historically, keyed every in-memory
 * Set/Map by the string `` `${col},${row}` ``. That is fine for the PERSISTED form (a template's
 * stored `terrain1`/`decor` layers are string-keyed JSON, and stay that way — see
 * {@link ./templateDefinition}), but it is expensive in the render hot loop:
 * {@link ./farmTerrain buildEditorField} consults the masks ~20–25 times PER VISIBLE CELL
 * (8-neighbour occupancy for light grass, again for dark, plus kind/slab/decor/plank tests), so a
 * few thousand windowed cells meant ~100k short-lived string allocations per rebuild — and a
 * rebuild happens every `WINDOW_QUANTUM_CELLS` of camera travel.
 *
 * A packed number is allocation-free, hashes without a character walk, and compares by value.
 *
 * ⚠️ SMI RANGE. The bias/span below are chosen so every packed id stays under 2^31, which keeps it
 * a V8 "small integer" — unboxed, and the whole point of the exercise. Widening {@link CELL_BIAS}
 * past 2^15 would push ids into heap-allocated doubles and quietly undo the optimisation. The
 * usable coordinate range is ±16384 cells, which is orders of magnitude beyond any real continent
 * (a large market is tens of cells across).
 *
 * Consumed by: {@link ./farmTerrain} (compiled masks + field membership),
 * {@link ../../features/nightmarket/useMarketWorld} (footprint-union membership).
 * Documented in docs/NIGHT_MARKET_FEATURE.md § "Terrain performance".
 */

/** A cell coordinate pair packed into one SMI-safe integer. */
export type CellId = number;

/** Added to each coordinate so negatives pack cleanly (templates may sit at negative offsets). */
export const CELL_BIAS = 1 << 14; // 16384

/** Stride of the packed row axis. Must exceed `CELL_BIAS * 2` so the two axes never collide. */
const CELL_SPAN = 1 << 15; // 32768

/** Inclusive coordinate bounds that {@link packCell} can represent losslessly. */
export const CELL_COORD_MIN = -CELL_BIAS;
export const CELL_COORD_MAX = CELL_BIAS - 1;

/**
 * Hoisted out of {@link packCell} deliberately. That function runs ~20–25× per visible cell, and
 * reading `import.meta.env?.DEV` inline would be a property lookup on every one of them — the
 * optional-chaining form is not guaranteed to be constant-folded by the bundler the way a bare
 * `import.meta.env.DEV` is. Resolved once here, the guard below is a constant-false branch in a
 * production build and costs nothing.
 */
const DEV = !!import.meta.env?.DEV;

/**
 * Pack `(col, row)` into a single integer.
 *
 * Out-of-range coordinates would alias onto a DIFFERENT cell (silent corruption: two distinct
 * cells sharing an id), so they throw in dev rather than producing a subtly wrong map. The check
 * is stripped in production builds, where the range is unreachable in practice.
 */
export function packCell(col: number, row: number): CellId {
  if (DEV) {
    if (
      col < CELL_COORD_MIN || col > CELL_COORD_MAX ||
      row < CELL_COORD_MIN || row > CELL_COORD_MAX
    ) {
      throw new RangeError(
        `[cellKey] cell (${col}, ${row}) is outside the packable range ` +
        `[${CELL_COORD_MIN}, ${CELL_COORD_MAX}] — it would alias onto another cell.`,
      );
    }
    if (!Number.isInteger(col) || !Number.isInteger(row)) {
      throw new RangeError(`[cellKey] cell (${col}, ${row}) is not integral — cells are discrete.`);
    }
  }
  return (col + CELL_BIAS) * CELL_SPAN + (row + CELL_BIAS);
}

/** Inverse of {@link packCell}. */
export function unpackCell(id: CellId): [col: number, row: number] {
  return [Math.floor(id / CELL_SPAN) - CELL_BIAS, (id % CELL_SPAN) - CELL_BIAS];
}

/**
 * Parse a PERSISTED `"col,row"` cell key straight into a packed id, without materialising the
 * intermediate coordinate pair. This is the one bridge between the stored string form and the
 * in-memory packed form; everything downstream of it should stay packed.
 */
export function packCellKey(cellKey: string): CellId {
  const comma = cellKey.indexOf(',');
  const col = Number(cellKey.slice(0, comma));
  const row = Number(cellKey.slice(comma + 1));
  return packCell(col, row);
}
