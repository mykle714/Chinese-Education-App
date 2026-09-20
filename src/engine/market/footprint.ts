/**
 * footprint — the shared multi-cell occupancy + placement system for props.
 *
 * LAYER: pure geometry/data. No assets, no React, no renderer — it takes numbers and
 * returns numbers, so any pure engine layer may depend on it.
 *
 * WHAT A "PROP" IS HERE
 * Anything drawn on the board that covers MORE THAN ONE CELL and must therefore answer
 * three questions the same way every time:
 *
 *   1. **Which cells do I occupy?** (collision, unlock identity, terrain masking)
 *   2. **What happens to my footprint when I am mirrored?** (it TRANSPOSES — see below)
 *   3. **How do I depth-sort against something standing beside me?** (per-screen-column
 *      strips, not one z for the whole sprite)
 *
 * Before this module each of those was answered in a different place: the house carried its
 * own `HOUSE_FOOTPRINT_X/Y` pair plus a hand-written flip rule, `placeholderArea.ts` had its
 * own copy of the rectangle math under placeholder-specific names, and the lumeish furniture
 * pack had no answer at all. They are now one implementation with three callers.
 *
 * ANCHORING CONVENTION (shared with `placeholderArea` and the server's area mirror)
 * A footprint is anchored at its NEAR (min-iso) corner — the cell whose south vertex the art's
 * base-diamond front corner seats on — and extends **+isoX (east, `w`/`col`)** and
 * **+isoY (north, `h`/`row`)**, i.e. up-and-back into the board. It covers
 * `col … col+w-1` × `row … row+h-1` inclusive.
 *
 * WHY A MIRROR TRANSPOSES THE SPAN
 * A horizontal screen flip about the front corner swaps which screen direction each iso axis
 * points along, so the +isoX and +isoY spans exchange places: a 4×5 house mirrors to 5×4, and
 * a 2×1 sofa to 1×2. This is not a special case for buildings — it falls out of the
 * projection, so it belongs here rather than in any one prop's module.
 *
 * Referenced by docs: docs/LUMEISH_ASSET_PIPELINE.md § "Multi-cell occupancy",
 * docs/NIGHT_MARKET_FEATURE.md (house placement).
 */

import { computeSpriteStrips, type StripPlacement } from './isometric';

// ---------------------------------------------------------------------------
// Spans and footprints
// ---------------------------------------------------------------------------

/** A prop's size in cells: `w` along isoX (east), `h` along isoY (north). Unpositioned. */
export interface CellSpan {
  w: number;
  h: number;
}

/**
 * A PLACED span: near (min-iso) corner + size. Structurally identical to
 * {@link ./placeholderArea PlaceholderArea}, deliberately — that type is a
 * server-mirrored contract and stays declared there, but every function here accepts one.
 */
export interface CellFootprint extends CellSpan {
  col: number;
  row: number;
}

/** The mirrored span — `w` and `h` exchange. See "WHY A MIRROR TRANSPOSES" in the module doc. */
export function transposeSpan(span: CellSpan): CellSpan {
  return { w: span.h, h: span.w };
}

/** `span` as it appears when the prop is drawn with (`flip`) or without a horizontal mirror. */
export function spanForFlip(span: CellSpan, flip: boolean): CellSpan {
  return flip ? transposeSpan(span) : { w: span.w, h: span.h };
}

/** Place a span at a near-corner anchor, transposing it if the prop is mirrored. */
export function placeFootprint(
  col: number,
  row: number,
  span: CellSpan,
  flip = false,
): CellFootprint {
  const { w, h } = spanForFlip(span, flip);
  return { col, row, w, h };
}

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

/**
 * The `"col,row"` cell keys a footprint covers.
 *
 * String keys rather than objects because every consumer feeds them straight into a `Set`
 * for membership tests, and object identity would defeat that. This matches the key format
 * produced by {@link ./cellKey}.
 */
export function footprintCells(fp: CellFootprint): string[] {
  const cells: string[] = [];
  for (let dx = 0; dx < fp.w; dx++) {
    for (let dy = 0; dy < fp.h; dy++) cells.push(`${fp.col + dx},${fp.row + dy}`);
  }
  return cells;
}

/** Whether the cell (col,row) falls inside `fp`. */
export function footprintCoversCell(fp: CellFootprint, col: number, row: number): boolean {
  return col >= fp.col && col < fp.col + fp.w && row >= fp.row && row < fp.row + fp.h;
}

/** Whether two footprints share any cell (axis-aligned rectangle overlap). */
export function footprintsOverlap(a: CellFootprint, b: CellFootprint): boolean {
  return (
    a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h
  );
}

/** Whether `fp` overlaps any already-placed footprint — the standard "can I drop here?" test. */
export function footprintOverlapsAny(
  fp: CellFootprint,
  placed: readonly CellFootprint[],
): boolean {
  return placed.some((other) => footprintsOverlap(fp, other));
}

/**
 * Whether a footprint lies wholly inside a `width`×`height` board.
 * Overhang is REFUSED rather than clipped — a half-placed prop has no valid occupancy set.
 */
export function footprintFitsBoard(fp: CellFootprint, width: number, height: number): boolean {
  return fp.col >= 0 && fp.row >= 0 && fp.col + fp.w <= width && fp.row + fp.h <= height;
}

/** The first placed footprint covering (col,row), or undefined — backs pick/erase-by-click. */
export function footprintAt<T extends CellFootprint>(
  placed: readonly T[],
  col: number,
  row: number,
): T | undefined {
  return placed.find((fp) => footprintCoversCell(fp, col, row));
}

/** The union of every footprint's cells. Agnostic to whether the inputs overlap. */
export function footprintUnionCells(placed: readonly CellFootprint[]): Set<string> {
  const out = new Set<string>();
  for (const fp of placed) for (const key of footprintCells(fp)) out.add(key);
  return out;
}

// ---------------------------------------------------------------------------
// Prop art — the bridge from a footprint to a drawable, depth-sorted sprite
// ---------------------------------------------------------------------------

/**
 * Everything the renderer needs to seat one multi-cell sprite on the board, independent of
 * WHICH pack the art came from. `house.ts` builds one of these from measured `House.png`
 * constants; `lumeishTileset` builds one per furniture sprite from its generated manifest
 * entry. Anything else multi-cell should do the same rather than re-deriving anchors.
 */
export interface PropArt {
  /** Source texture size in px. */
  texW: number;
  texH: number;
  /**
   * The art's base-diamond FRONT corner in texture px — the pixel that seats on the foot
   * cell's south vertex. NOT the frame's bottom-centre: art is rarely centred on its own
   * base, and using the frame centre is what makes a prop float or sink.
   */
  anchorTex: { x: number; y: number };
  /** Footprint span in cells, un-mirrored. */
  span: CellSpan;
}

/**
 * Pixi anchor fraction that places {@link PropArt.anchorTex} at the sprite's position.
 * Callers that draw the prop as ONE sprite use both components; strip renderers use only
 * `y` (each strip supplies its own x via {@link StripPlacement.offsetX}).
 */
export function propAnchorFraction(art: PropArt): { x: number; y: number } {
  return { x: art.anchorTex.x / art.texW, y: art.anchorTex.y / art.texH };
}

/**
 * Per-screen-column depth slices for a prop whose foot cell is the origin — add the placed
 * `col`/`row` to each strip's `footIsoX`/`footIsoY` for real anchors.
 *
 * Any prop wider than one cell needs this: a single sprite carries a single z, so a pedestrian
 * beside its near-left wing would sort against the same depth as one beside its near-right
 * wing. See the "Sprite-strip slicing" block in {@link ./isometric} for the derivation.
 *
 * Results are pure functions of `art` + `flip`, so callers should compute them ONCE at module
 * scope (as {@link ./house HOUSE_STRIPS} does) rather than per frame.
 */
export function propStrips(art: PropArt, flip = false): StripPlacement[] {
  return computeSpriteStrips({
    footIsoX: 0,
    footIsoY: 0,
    texW: art.texW,
    texH: art.texH,
    anchorTexX: art.anchorTex.x,
    flip,
  });
}

/** The cells this prop occupies when placed at (col,row) with an optional mirror. */
export function propFootprint(
  art: PropArt,
  col: number,
  row: number,
  flip = false,
): CellFootprint {
  return placeFootprint(col, row, art.span, flip);
}
