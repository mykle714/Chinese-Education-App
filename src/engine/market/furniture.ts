/**
 * furniture — PLACED furniture props on a board, and the rules for placing them.
 *
 * LAYER: engine (pure data + a lookup into the lumeish asset registry). No React, no
 * renderer. It is the layer between the shared occupancy system ({@link ./footprint}) and
 * the authoring/render surfaces that place and draw furniture.
 *
 * WHAT THIS IS FOR
 * `footprint.ts` knows how a multi-cell prop occupies cells but nothing about WHICH props
 * exist; `lumeishTileset.ts` knows the art but nothing about a board. This module is the
 * join: a {@link FurniturePlacement} is "sprite N stands at (col,row)", and the helpers
 * below answer the three questions any placement UI asks — does it fit, does it collide,
 * and what is under the cursor.
 *
 * WHY THERE IS NO `flip` FIELD
 * The house may be mirrored with a negative scale because its two faces are symmetric art.
 * The lumeish pack is NOT: each mirrored pair is shipped as two INDEPENDENTLY SHADED files
 * (see {@link ./lumeishTileset LumeishSprite.mirrorOf}). Turning a lumeish object around is
 * therefore a change of `id` — `lumeishTileset.facingSibling(id)` — never a render flip, so
 * a placement carries no flip flag at all and cannot express the wrong thing.
 *
 * Referenced by: features/nightmarket/TemplateEditorPage.tsx (the Furniture tool),
 * features/nightmarket/FurnitureSprites.tsx (render), features/nightmarket/
 * templateEditorApi.ts (persistence). Documented in docs/LUMEISH_ASSET_PIPELINE.md
 * § "Placing furniture" and docs/NIGHT_MARKET_TEMPLATES.md.
 */

import {
  footprintAt,
  footprintCells,
  footprintFitsBoard,
  footprintOverlapsAny,
  type CellFootprint,
} from './footprint';
import { lumeishTileset } from './lumeishTileset';

/**
 * One furniture object standing on the board.
 *
 * `col`/`row` are the NEAR (min-iso) foot cell — the same anchoring convention every other
 * footprint in the engine uses (see the anchoring block in {@link ./footprint}) — and the
 * occupied cells extend +isoX/+isoY from there by the sprite's own iso span.
 *
 * `id` is the lumeish manifest id, which is also the normalized file's name (`57` ⇒
 * `57.png`). It is the STABLE key: unlike a bundled URL it survives asset re-fingerprinting,
 * which is why the persisted definition stores it rather than a url (the same reason decor
 * stores sprite stems).
 */
export interface FurniturePlacement {
  col: number;
  row: number;
  id: number;
}

/**
 * The catalogue every furniture palette pages through: EVERY sprite the pack ships, in
 * manifest order, both facings of a mirrored pair included.
 *
 * NOT `lumeishTileset.canonical()` (one per pair). The two facings are separate,
 * independently-shaded art, so choosing which way a chair faces IS choosing a sprite; hiding
 * one facing behind a modifier would mean an author could not see it in the ghost before
 * committing. Frozen at module scope — the pack is static, so this is one array for the app,
 * shared by the night market template editor and the Immersive World scene editor so the two
 * palettes cannot drift into showing different furniture.
 */
export const FURNITURE_CATALOGUE: readonly number[] = lumeishTileset.ids();

/**
 * The catalogue sprite at a paging index (wrapping), or null if the pack ships nothing.
 * Callers hold an INDEX rather than an id so paging is a modulo and never a search.
 */
export function furnitureAtIndex(index: number): number | null {
  if (FURNITURE_CATALOGUE.length === 0) return null;
  const len = FURNITURE_CATALOGUE.length;
  return FURNITURE_CATALOGUE[((index % len) + len) % len];
}

/** Catalogue position of a sprite id, or -1 — used to jump to a piece's opposite facing. */
export function furnitureIndexOf(id: number): number {
  return FURNITURE_CATALOGUE.indexOf(id);
}

/** Whether a value loaded from JSON is a structurally valid placement (ignores the id's existence). */
export function isFurniturePlacement(value: unknown): value is FurniturePlacement {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<FurniturePlacement>;
  return typeof p.col === 'number' && typeof p.row === 'number' && typeof p.id === 'number';
}

/** Whether the pack actually ships this placement's sprite (a stale id after a pack re-run). */
export function furnitureSpriteExists(placement: FurniturePlacement): boolean {
  return lumeishTileset.sprite(placement.id) !== undefined;
}

/**
 * The cells a placement occupies. An unknown id falls back to a single cell (the tileset's
 * own default), so a stale placement is still selectable/erasable rather than untouchable.
 */
export function furnitureFootprint(placement: FurniturePlacement): CellFootprint {
  return lumeishTileset.footprintAt(placement.id, placement.col, placement.row);
}

/**
 * The `"col,row"` keys a placement covers — the cells a per-cell layer must be cleared from
 * when a piece is dropped (see the blocking-decor displacement in both editors' `paintCell`).
 */
export function furnitureCells(placement: FurniturePlacement): string[] {
  return footprintCells(furnitureFootprint(placement));
}

/**
 * The cells under a piece that hold a SOLID decor sprite — what dropping it must clear.
 *
 * Two solid objects cannot share a cell, so a prop or a tree under a new piece of furniture is
 * DISPLACED rather than refusing the drop (and, symmetrically, a prop dropped on a piece
 * removes it — that direction is just {@link furnitureAt}). Flush decor is untouched: furniture
 * stands on the ground, and the ground may be a wood panel or have grass tufts on it.
 *
 * `isSolidDecor` is passed in rather than imported (`farmTerrain.isBlockingDecorUrl` is the one
 * caller ever passes) so this module stays free of the terrain layer, which imports the
 * placement type from here.
 *
 * Both editors' `paintCell` call this. The pair of rules is TOOL POLICY — what a click means —
 * rather than a geometric fact, but it must be the SAME policy in both editors, so the part
 * that can be shared is.
 */
export function furnitureBuriedDecorCells(
  placement: FurniturePlacement,
  decor: ReadonlyMap<string, string>,
  isSolidDecor: (url: string) => boolean,
): string[] {
  return furnitureCells(placement).filter((cell) => {
    const url = decor.get(cell);
    return !!url && isSolidDecor(url);
  });
}

/** Whether the whole footprint lies inside a `width`×`height` board. */
export function furnitureFitsBoard(
  placement: FurniturePlacement,
  width: number,
  height: number,
): boolean {
  return footprintFitsBoard(furnitureFootprint(placement), width, height);
}

/**
 * Whether a placement's footprint touches any already-placed piece.
 *
 * This is the only thing that REFUSES a placement. Terrain, the walkability masks, placeholder
 * areas and the flush decor families are flat ground or spriteless annotations, so a piece
 * simply stands on them.
 *
 * BLOCKING decor (a common prop or a tree — `farmTerrain.isBlockingDecorUrl`) is the one other
 * solid thing on a board, and it is handled by DISPLACEMENT rather than refusal: dropping
 * furniture clears it from every cell of the footprint ({@link furnitureCells}), and dropping a
 * prop/tree on a piece removes that piece. Both editors' `paintCell` implement that pair —
 * it is a tool policy ("what does a click mean") rather than a geometric fact, which is why it
 * lives there and not here.
 */
export function furnitureOverlapsAny(
  placement: FurniturePlacement,
  placed: readonly FurniturePlacement[],
): boolean {
  return footprintOverlapsAny(
    furnitureFootprint(placement),
    placed.map(furnitureFootprint),
  );
}

/**
 * The placed piece whose footprint covers (col,row), or undefined. This is what a click
 * selects/erases — an author points at any cell of a sofa, not only at its foot cell.
 * Overlapping footprints are impossible through the placement guard
 * ({@link furnitureOverlapsAny}); should hand-edited data contain some, the FIRST match
 * wins, mirroring {@link ./footprint footprintAt}.
 */
export function furnitureAt(
  placed: readonly FurniturePlacement[],
  col: number,
  row: number,
): FurniturePlacement | undefined {
  const hitFootprint = footprintAt(
    placed.map((p) => ({ ...furnitureFootprint(p), placement: p })),
    col,
    row,
  );
  return hitFootprint?.placement;
}
