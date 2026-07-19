import type { TemplateDefinitionPayload } from '../../features/nightmarket/templateEditorApi';
import { placeholderAreaId, type PlaceholderArea } from './placeholderArea';
import type { EditorMasks } from './farmTerrain';
import { freeFarmTileset } from './freeFarmTileset';

/**
 * templateStitch — lift one or more PLACED template definitions (each at its own board
 * offset) into a single GLOBAL cell world keyed "isoX,isoY"
 * (docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md § templateStitch,
 * docs/NIGHT_MARKET_TEMPLATES.md § "Local coordinate system").
 *
 * LAYER: pure engine. No React, no DB, no assets. Consumes the stored
 * {@link TemplateDefinitionPayload} shape (which the client already has in hand from
 * {@link ../../features/nightmarket/templateEditorApi loadTemplate}).
 *
 * The mapping is a straight translation — col→east→+isoX, row→south→+isoY, no flip:
 *   isoX = offsetCol + col,  isoY = offsetRow + row   (TILE_SIZE = 1).
 * Slice 1 stitches a SINGLE hub at offset (0,0) — global keys equal local keys — but the
 * function is written for the multi-template case so slice 3 (real user layout) reuses it
 * unchanged.
 */

/** One row of the user's layout: a template name + its chosen version's cells, at an offset. */
export interface PlacedTemplate {
  name: string;
  activeVersion: number;
  offsetCol: number;
  offsetRow: number;
  /** The loaded version's definition (cells in LOCAL coords). */
  def: TemplateDefinitionPayload;
  /**
   * LOCAL anchor ids ("col_row") of the placeholder slots an occupant currently fills in THIS
   * placement (the server's `filledPlaceholderIds`). Used only to tag each {@link PlacedPlaceholder}
   * with `filled` so the render layer can draw an occupant (houses) in filled slots. Omit/empty ⇒
   * every slot renders empty.
   */
  filledPlaceholderIds?: string[];
}

/** A placeholder occupant slot, its area translated into GLOBAL coords + its owning template. */
export interface PlacedPlaceholder {
  templateName: string;
  area: PlaceholderArea;
  /** Whether an occupant currently fills this slot (drives occupant rendering). */
  filled: boolean;
}

/**
 * The stitched global world — every layer as a global-cell Set/Map keyed "isoX,isoY".
 *
 * `decor` keeps the sprite STEM (not a resolved URL) — resolution to a live asset URL
 * happens at the render seam ({@link stitchedToEditorMasks}), mirroring how the stored
 * definition carries stems so it survives asset re-fingerprinting.
 */
export interface StitchedWorld {
  street: Set<string>;
  communal: Set<string>;
  terrain1: Set<string>;
  terrain2: Set<string>;
  decor: Map<string, string>;
  placeholders: PlacedPlaceholder[];
}

/** Translate a LOCAL "col,row" cell key into a GLOBAL "isoX,isoY" key for this placement. */
export function localToGlobal(p: PlacedTemplate, cellKey: string): string {
  const [col, row] = cellKey.split(',').map(Number);
  return `${p.offsetCol + col},${p.offsetRow + row}`;
}

/** Union every placed template's translated layers into one {@link StitchedWorld}. */
export function stitchWorld(placed: PlacedTemplate[]): StitchedWorld {
  const world: StitchedWorld = {
    street: new Set(),
    communal: new Set(),
    terrain1: new Set(),
    terrain2: new Set(),
    decor: new Map(),
    placeholders: [],
  };

  for (const p of placed) {
    const { def } = p;
    // Boolean-membership cell masks: translate each cell into global coords, union in.
    for (const cell of def.terrain1 ?? []) world.terrain1.add(localToGlobal(p, cell));
    for (const cell of def.terrain2 ?? []) world.terrain2.add(localToGlobal(p, cell));
    for (const cell of def.street ?? []) world.street.add(localToGlobal(p, cell));
    for (const cell of def.communal ?? []) world.communal.add(localToGlobal(p, cell));

    // Decor: translate the cell key, keep the sprite stem (resolved to a URL at render).
    for (const [cell, stem] of Object.entries(def.decor ?? {})) {
      world.decor.set(localToGlobal(p, cell), stem);
    }

    // Placeholder areas: translate the near-corner anchor by the placement offset (w/h
    // are spans, unchanged). Tag each with its owning template name + whether it's filled.
    // `filled` is matched on the LOCAL anchor id (pre-translation), since the server keys
    // occupants by each placement's own local "col_row" ids.
    const filledIds = new Set(p.filledPlaceholderIds ?? []);
    for (const area of def.placeholder ?? []) {
      world.placeholders.push({
        templateName: p.name,
        area: { col: p.offsetCol + area.col, row: p.offsetRow + area.row, w: area.w, h: area.h },
        filled: filledIds.has(placeholderAreaId(area)),
      });
    }
  }

  return world;
}

/**
 * Render seam: adapt a {@link StitchedWorld} into the {@link EditorMasks} shape that
 * {@link ./farmTerrain buildEditorField} already consumes, so the runtime terrain layer
 * reuses the SAME autotiling the editor uses (no duplicated sprite logic — see
 * {@link ../../features/nightmarket/TemplateTerrainLayer}).
 *
 * Only the layers `buildEditorField` actually reads are populated: terrain1/terrain2
 * (surface autotiling) and decor (per-cell sprite, with each STEM resolved to a live asset
 * URL here). The walkability classes (street/communal) and the annotation overlays
 * (placeholder/condition) render no sprite and are passed EMPTY — the graph pipeline
 * (slice 2), not the terrain field, consumes them.
 */
export function stitchedToEditorMasks(world: StitchedWorld): EditorMasks {
  const decor = new Map<string, string>();
  for (const [cell, stem] of world.decor) {
    const url = freeFarmTileset.get(stem);
    if (url) decor.set(cell, url); // drop a stem whose asset no longer exists (defensive)
  }
  return {
    terrain1: world.terrain1,
    terrain2: world.terrain2,
    // Spriteless walkability/annotation layers — not read by buildEditorField.
    street: new Set(),
    communal: new Set(),
    placeholder: [],
    condition: new Set(),
    decor,
  };
}
