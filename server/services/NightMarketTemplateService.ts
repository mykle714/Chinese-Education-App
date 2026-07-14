import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { DALError, NotFoundError, ValidationError } from '../types/dal.js';
import { dbManager } from '../dal/base/DatabaseManager.js';
import {
  PlaceholderArea,
  PLACEHOLDER_SIZES,
  placeholderAreasOverlap,
} from '../dal/shared/placeholderArea.js';

// Re-export so existing importers of the placeholder type via this service keep working;
// the source of truth for the shape/sizes is server/dal/shared/placeholderArea.ts (mirror of
// the client's src/engine/market/placeholderArea.ts, kept in sync by the guard test
// src/__tests__/placeholderAreaSync.test.ts).
export type { PlaceholderArea };

/**
 * Night Market Template Service — business logic for validator-authored template
 * definitions (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md).
 *
 * LAYER: service layer. Only a validator (users.isValidator) may list, load, check a
 * name, save, or delete a template. Content is stored verbatim in the `definition`
 * JSONB column of `nightmarkettemplatedefinitions`; the scalar name/width/height are
 * lifted out so the name-availability check and listing can query them directly.
 *
 * VERSIONS (migration 108): one template NAME owns several numbered VERSIONS — one
 * row per (name, version). Versions share a board size and a single placeholder
 * layout but differ in terrain / streets / decor / the condition mask. Save is an
 * UPSERT BY (name, version). Version 0 is the base/default and the SINGLE SOURCE OF
 * TRUTH for the shared `placeholder` mask: only version 0 stores placeholder cells;
 * every other version's placeholder is STRIPPED on save and MERGED BACK from version
 * 0 on read. This makes "all versions share one placeholder" impossible to violate.
 * The optional `description` (a scalar column, migration 109) follows the SAME
 * single-sourced-on-v0 rule: stored only on version 0, NULL on higher versions, merged
 * from v0 on read.
 * The `condition` mask is the INVERSE: a per-version overlay allowed only on versions
 * > 0, rejected on version 0 (the base carries no conditional cells).
 *
 * There is no server-side overwrite guard — the client's Properties rename gate is
 * the accidental-overwrite guard (a save can only hit an existing name if that
 * template was deliberately loaded).
 *
 * Distinct from NightMarketService (per-user unlock economy) — this is the static,
 * account-independent CATALOG of template definitions the placement system will
 * later draw from (see docs/NIGHT_MARKET_TEMPLATES.md).
 *
 * Depends on: migrations 107 + 108, IUserDAL.findById (validator gate).
 */

/** Board dimension bounds (template cells). Templates are rectangular, any W×H. */
export const MIN_TEMPLATE_DIM = 2;
export const MAX_TEMPLATE_DIM = 60;
export const MAX_TEMPLATE_NAME_LENGTH = 120;
export const MAX_TEMPLATE_DESCRIPTION_LENGTH = 500;

/** The painted-mask content authored today; grows to the full template later. */
export interface TemplateDefinition {
  /** Terrain-1 mask cells, each "col,row" (currently rendered as light grass). */
  terrain1: string[];
  /** Terrain-2 mask cells, each "col,row" — an independent mask (renders only where it overlaps terrain1; currently dark grass). */
  terrain2: string[];
  /** Street-mask cells (the street-walkable set), each "col,row" — a spriteless walkability tint. */
  street: string[];
  /** Communal-walkable cells (parks/plazas), each "col,row" — disjoint from street. */
  communal: string[];
  /**
   * Placeholder AREAS (occupant slots) — fixed-size dropped rectangles ({col,row,w,h}, near
   * corner + span). Each is a distinct slot (adjacent areas do NOT merge) and may overlap any
   * OTHER layer but not another area. Sizes are restricted to 5×5 / 5×10 / 10×5. SHARED across
   * all versions of a name: authoritative only on version 0; empty on other versions as stored,
   * populated from version 0 on read. (Legacy rows stored a flat string[] cell mask.)
   */
  placeholder: PlaceholderArea[];
  /**
   * Condition-mask cells (per-version conditional cell-class annotation), each
   * "col,row" — an override overlay like placeholder, may overlap any layer. Unlike
   * placeholder it is PER-VERSION (it is the thing that differs between versions) and is
   * the INVERSE of placeholder's version rule: allowed only on versions > 0, rejected on
   * version 0 (the base carries no conditional cells).
   */
  condition: string[];
  /**
   * Placed houses: front-corner anchor cell "col,row" (each a 4×5 footprint) + horizontal
   * FLIP (mirror) orientation. Legacy rows stored bare "col,row" strings → read as flip:false.
   */
  houses: Array<{ cell: string; flip: boolean }>;
  /**
   * Per-cell decor: cell "col,row" → decor sprite STEM. Never under a house (houses
   * overwrite decor); flush surface-family decor MAY coexist with a street, but BLOCKING
   * decor (common/tree) may not (it clears the street walkability class in the editor).
   */
  decor: Record<string, string>;
}

/**
 * House footprint span in cells (mirrors src/engine/market/house.ts, kept in sync by
 * hand since the server can't import the client asset module): 4 along isoX (E–W) ×
 * 5 along isoY (N–S), anchored at the front (min-iso) corner and extending +isoX/+isoY.
 */
export const HOUSE_FOOTPRINT_X = 4;
export const HOUSE_FOOTPRINT_Y = 5;

/**
 * Placeholder-area primitives (`PlaceholderArea`, `PLACEHOLDER_SIZES`, `placeholderAreasOverlap`)
 * are the SERVER mirror of the client's pure geometry module and live in
 * server/dal/shared/placeholderArea.ts — imported above. See that file for the sync contract.
 */

/**
 * Whether a decor STEM is a BLOCKING object — `common` decor (`decor_N`) or a standing
 * `tree` (`tree_N` / `largeTree_N`) — as opposed to flush surface-family decor
 * (`{lightGrass|darkGrass|dirt}Decor_N`). Blocking objects are mutually exclusive with
 * the communal-walkable class (a park/plaza tile may hold flush surface flora but not a
 * tree/prop/house). Mirrors the stem naming the client tileset indexes by
 * (src/engine/market/freeFarmTileset.ts `indexDecor`/`indexTree` +
 * `farmTerrain.isBlockingDecorUrl`) — kept in sync BY HAND, since the server can't
 * import that Vite asset module (same reason the house footprint dims are duplicated).
 */
function isBlockingDecorStem(stem: string): boolean {
  return /^decor_\d+$/.test(stem) || /^(tree|largeTree)_\d+$/.test(stem);
}

/**
 * Footprint spans for a house's mirror orientation. Mirrors the client geometry
 * (src/engine/market/house.ts `houseFootprintSpans`) — a flipped house's ground block is
 * the TRANSPOSE of the default (5 along isoX × 4 along isoY), because the horizontal sprite
 * mirror swaps the +isoX/+isoY screen directions. Kept in sync BY HAND (the server can't
 * import the client Vite module — same reason the footprint dims are duplicated here).
 */
function houseFootprintSpans(flip: boolean): { spanX: number; spanY: number } {
  return flip
    ? { spanX: HOUSE_FOOTPRINT_Y, spanY: HOUSE_FOOTPRINT_X }
    : { spanX: HOUSE_FOOTPRINT_X, spanY: HOUSE_FOOTPRINT_Y };
}

/** The cells a house anchored at (col,row) with the given `flip` covers, as "col,row" keys. */
function houseFootprintCells(col: number, row: number, flip: boolean): string[] {
  const { spanX, spanY } = houseFootprintSpans(flip);
  const cells: string[] = [];
  for (let dx = 0; dx < spanX; dx++) {
    for (let dy = 0; dy < spanY; dy++) {
      cells.push(`${col + dx},${row + dy}`);
    }
  }
  return cells;
}

export interface TemplateDefinitionRow {
  id: string;
  name: string;
  version: number;
  width: number;
  height: number;
  definition: TemplateDefinition;
  /** Optional author-written description. Shared per name (authored on version 0). */
  description: string | null;
  createdBy: string;
  createdAt: string;
}

/** A loaded template row plus the full set of version numbers for its name. */
export interface LoadedTemplateRow extends TemplateDefinitionRow {
  /** Every existing version number for this name, ascending (drives the version dropdown). */
  availableVersions: number[];
}

/** Lightweight row for the editor's Load dropdown — one entry PER NAME (not per version). */
export interface TemplateSummary {
  name: string;
  width: number;
  height: number;
  /** How many versions this name has (for the dropdown subtitle). */
  versionCount: number;
  /** The version-0 author's display name (users.name), or null if the user is gone. */
  author: string | null;
  /** The shared per-name description (from version 0), or null if none. */
  description: string | null;
}

export class NightMarketTemplateService {
  constructor(private readonly userDAL: IUserDAL) {}

  /** Throw unless the user exists and is a validator (403). */
  private async assertValidator(userId: string): Promise<void> {
    const user = await this.userDAL.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    if (!user.isValidator) {
      throw new DALError(
        'Only validators can author Night Market templates',
        'ERR_FORBIDDEN',
        403,
      );
    }
  }

  /** Normalize + validate a submitted name; throws ValidationError if unusable. */
  private cleanName(name: unknown): string {
    if (typeof name !== 'string') throw new ValidationError('Template name is required');
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new ValidationError('Template name is required');
    if (trimmed.length > MAX_TEMPLATE_NAME_LENGTH) {
      throw new ValidationError(`Template name must be ≤ ${MAX_TEMPLATE_NAME_LENGTH} characters`);
    }
    return trimmed;
  }

  /**
   * Normalize an optional description: null/blank → null, else a trimmed string within
   * the length cap. Only meaningful on version 0 (the shared source of truth); the
   * caller stores NULL on higher versions.
   */
  private cleanDescription(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value !== 'string') throw new ValidationError('Template description must be text');
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > MAX_TEMPLATE_DESCRIPTION_LENGTH) {
      throw new ValidationError(`Template description must be ≤ ${MAX_TEMPLATE_DESCRIPTION_LENGTH} characters`);
    }
    return trimmed;
  }

  /** Validate a submitted version is a non-negative integer. */
  private cleanVersion(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new ValidationError('Template version must be a non-negative integer');
    }
    return value;
  }

  /**
   * Whether `name` is free (validator-gated) — free means NO version of that name
   * exists. Backs the editor's Properties-popup name check; the UNIQUE(name,version)
   * index is still the authoritative race guard at Save.
   */
  async isNameAvailable(userId: string, name: string): Promise<boolean> {
    await this.assertValidator(userId);
    const clean = this.cleanName(name);
    const res = await dbManager.executeQuery<{ id: string }>(async (client) =>
      client.query(
        'SELECT id FROM nightmarkettemplatedefinitions WHERE name = $1 LIMIT 1',
        [clean],
      ),
    );
    return res.recordset.length === 0;
  }

  /**
   * Suggest a free default template name of the form `template{index}` (validator-gated),
   * where `index` is the smallest POSITIVE integer (starting at 1) for which no template
   * of that exact name exists. Backs the editor's Properties popup, which pre-fills the
   * name field for a fresh (unnamed) template. Only canonical `template<n>` names (no
   * leading zeros) participate in the gap search — any other name is ignored, and the
   * returned name is still subject to the UNIQUE(name,version) index at Save (a
   * concurrent create between suggest and save would surface there).
   */
  async suggestDefaultName(userId: string): Promise<string> {
    await this.assertValidator(userId);
    const res = await dbManager.executeQuery<{ name: string }>(async (client) =>
      client.query(
        // Canonical decimal only: `template1`, `template2`, … (rejects `template01`).
        `SELECT DISTINCT name FROM nightmarkettemplatedefinitions WHERE name ~ '^template[1-9][0-9]*$'`,
      ),
    );
    const used = new Set<number>();
    for (const r of res.recordset) {
      const n = Number(r.name.slice('template'.length));
      if (Number.isInteger(n)) used.add(n);
    }
    let idx = 1;
    while (used.has(idx)) idx++;
    return `template${idx}`;
  }

  /**
   * List every template (validator-gated) as ONE entry per name, name-ordered, for
   * the Load dropdown. Board dims come from version 0 (all versions share a size).
   */
  async listTemplates(userId: string): Promise<TemplateSummary[]> {
    await this.assertValidator(userId);
    const res = await dbManager.executeQuery<TemplateSummary>(async (client) =>
      client.query(
        // One row per name from the base (min-version = version 0) row: its dims,
        // shared description, and author (users.name of whoever created v0), plus a
        // version count. LEFT JOIN so a deleted author doesn't drop the template.
        `SELECT DISTINCT ON (d1.name)
                d1.name,
                d1.width,
                d1.height,
                d1.description,
                u.name AS author,
                (SELECT COUNT(*)::int FROM nightmarkettemplatedefinitions d2 WHERE d2.name = d1.name) AS "versionCount"
         FROM nightmarkettemplatedefinitions d1
         LEFT JOIN users u ON u.id = d1."createdBy"
         ORDER BY d1.name ASC, d1.version ASC`,
      ),
    );
    return res.recordset;
  }

  /**
   * Fetch one template version by (name, version), validator-gated; 404 if it does
   * not exist. Returns the row plus `availableVersions` (all version numbers for the
   * name). For version > 0 the shared placeholder mask is merged in from version 0
   * (other versions store an empty placeholder — see the class doc).
   */
  async getTemplate(userId: string, name: string, version: number): Promise<LoadedTemplateRow> {
    await this.assertValidator(userId);
    const clean = this.cleanName(name);
    const ver = this.cleanVersion(version);

    const res = await dbManager.executeQuery<TemplateDefinitionRow>(async (client) =>
      client.query(
        `SELECT id, name, version, width, height, definition, description, "createdBy", "createdAt"
         FROM nightmarkettemplatedefinitions WHERE name = $1 AND version = $2`,
        [clean, ver],
      ),
    );
    if (res.recordset.length === 0) throw new NotFoundError('Template version not found');
    const row = res.recordset[0];

    // All versions of this name (for the dropdown) + version 0's placeholder AND
    // description (both shared, single-sourced on v0) in one pass.
    const meta = await dbManager.executeQuery<{ version: number; placeholder: PlaceholderArea[] | null; description: string | null }>(
      async (client) =>
        client.query(
          `SELECT version, definition->'placeholder' AS placeholder, description
           FROM nightmarkettemplatedefinitions WHERE name = $1 ORDER BY version ASC`,
          [clean],
        ),
    );
    const availableVersions = meta.recordset.map((r) => r.version);
    if (ver !== 0) {
      const base = meta.recordset.find((r) => r.version === 0);
      row.definition.placeholder = Array.isArray(base?.placeholder) ? base!.placeholder : [];
      // Description is shared per name — always show version 0's on higher versions.
      row.description = base?.description ?? null;
    }

    return { ...row, availableVersions };
  }

  /**
   * Hard-delete an ENTIRE template (all versions of `name`), validator-gated; 404 if
   * the name has no rows. Deleting is name-level (not version-level) so version 0 —
   * the placeholder source of truth — can never be orphaned beneath higher versions.
   */
  async deleteTemplate(userId: string, name: string): Promise<void> {
    await this.assertValidator(userId);
    const clean = this.cleanName(name);
    const res = await dbManager.executeQuery<{ id: string }>(async (client) =>
      client.query('DELETE FROM nightmarkettemplatedefinitions WHERE name = $1 RETURNING id', [clean]),
    );
    if (res.recordset.length === 0) throw new NotFoundError('Template not found');
  }

  /**
   * Save a template version (validator-gated) — an **upsert by (name, version)**:
   * creates a new row, or OVERWRITES the existing (name, version) row (its dims +
   * definition; original `createdBy`/`createdAt` preserved, `updatedAt` bumped).
   *
   * Version rules:
   *   - version > 0 requires an existing version 0 (the base), and must match its
   *     board size (all versions of a name share one W×H).
   *   - the shared `placeholder` mask is stored ONLY on version 0; on version > 0 it
   *     is stripped before storing and merged back from version 0 in the response.
   *
   * `overwritten` tells the caller which path ran (for the Save confirmation message).
   */
  async saveTemplate(
    userId: string,
    input: { name: string; version: number; width: number; height: number; description?: unknown; definition: TemplateDefinition },
  ): Promise<{ template: TemplateDefinitionRow; overwritten: boolean }> {
    await this.assertValidator(userId);
    const name = this.cleanName(input.name);
    const version = this.cleanVersion(input.version);
    const width = this.cleanDim(input.width, 'width');
    const height = this.cleanDim(input.height, 'height');
    const description = this.cleanDescription(input.description);
    const definition = this.cleanDefinition(input.definition, width, height);

    // The condition mask is a PER-VERSION overlay and is the inverse of placeholder:
    // placeholder lives only on version 0 (shared), condition only on versions > 0.
    // Version 0 is the base/default and carries no conditional cells, so reject a save
    // that tries to store any (the editor also disables the tool on v0 — this is the
    // server-side backstop, surfaced to the user).
    if (version === 0 && definition.condition.length > 0) {
      throw new ValidationError(
        'The condition mask is not allowed on version 0 — it is a per-version overlay. Remove it, or add it on a higher version.',
      );
    }

    // Non-base versions inherit the base's placeholder + size + description; they may
    // not diverge. Description (like placeholder) is single-sourced on version 0.
    let sharedPlaceholder: PlaceholderArea[] | null = null;
    let sharedDescription: string | null = null;
    if (version > 0) {
      const base = await dbManager.executeQuery<{ width: number; height: number; placeholder: PlaceholderArea[] | null; description: string | null }>(
        async (client) =>
          client.query(
            `SELECT width, height, definition->'placeholder' AS placeholder, description
             FROM nightmarkettemplatedefinitions WHERE name = $1 AND version = 0`,
            [name],
          ),
      );
      if (base.recordset.length === 0) {
        throw new ValidationError('Save version 0 before creating other versions');
      }
      const b = base.recordset[0];
      if (b.width !== width || b.height !== height) {
        throw new ValidationError('All versions of a template must share the same board size');
      }
      // Placeholder is owned by version 0 — don't persist it on higher versions.
      sharedPlaceholder = Array.isArray(b.placeholder) ? b.placeholder : [];
      definition.placeholder = [];
      sharedDescription = b.description ?? null;
    }

    // Description is stored ONLY on version 0 (shared source of truth); higher versions
    // store NULL and inherit v0's value on read — mirroring the placeholder rule.
    const storedDescription = version === 0 ? description : null;

    const res = await dbManager.executeQuery<TemplateDefinitionRow & { overwritten: boolean }>(
      async (client) =>
        client.query(
          `INSERT INTO nightmarkettemplatedefinitions (name, version, width, height, definition, description, "createdBy")
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
           ON CONFLICT (name, version) DO UPDATE SET
             width = EXCLUDED.width,
             height = EXCLUDED.height,
             definition = EXCLUDED.definition,
             description = EXCLUDED.description,
             "updatedAt" = now()
           RETURNING id, name, version, width, height, definition, description, "createdBy", "createdAt",
                     (xmax <> 0) AS overwritten`,
          [name, version, width, height, JSON.stringify(definition), storedDescription, userId],
        ),
    );
    const { overwritten, ...template } = res.recordset[0];
    // Reflect the shared placeholder + description back to the client for higher versions.
    if (sharedPlaceholder) template.definition.placeholder = sharedPlaceholder;
    if (version > 0) template.description = sharedDescription;
    return { template, overwritten };
  }

  /** Validate a single dimension is an integer within bounds. */
  private cleanDim(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new ValidationError(`Template ${label} must be an integer`);
    }
    if (value < MIN_TEMPLATE_DIM || value > MAX_TEMPLATE_DIM) {
      throw new ValidationError(`Template ${label} must be between ${MIN_TEMPLATE_DIM} and ${MAX_TEMPLATE_DIM}`);
    }
    return value;
  }

  /**
   * Validate the painted masks: every cell is an in-bounds "col,row"; street and
   * communal are mutually exclusive (a cell is street-walkable OR communal-walkable);
   * BOTH walkability classes are ALSO mutually exclusive with blocking objects (a house
   * or common/tree decor — see {@link isBlockingDecorStem}); houses fit / don't overlap
   * streets or each other; decor never hides under a house (flush family decor MAY sit on
   * a street). Terrain 1 / terrain 2 are INDEPENDENT masks (terrain 2 renders only over
   * terrain 1 at render time — see farmTerrain), and placeholder + condition are override
   * overlays that may overlap anything. These coincidence rules mirror the editor's
   * paint-time guards and are re-checked here so a client bug can't persist an illegal
   * overlap. Returns a de-duplicated, canonicalized copy.
   */
  private cleanDefinition(def: unknown, width: number, height: number): TemplateDefinition {
    const d = (def ?? {}) as Partial<TemplateDefinition>;
    const inBounds = new Set<string>();
    for (let col = 0; col < width; col++) {
      for (let row = 0; row < height; row++) inBounds.add(`${col},${row}`);
    }
    const clean = (cells: unknown, label: string): string[] => {
      if (!Array.isArray(cells)) return [];
      const out = new Set<string>();
      for (const c of cells) {
        if (typeof c !== 'string' || !inBounds.has(c)) {
          throw new ValidationError(`Template ${label} contains an out-of-bounds cell: ${String(c)}`);
        }
        out.add(c);
      }
      return [...out];
    };
    const terrain1 = clean(d.terrain1, 'terrain1');
    const terrain2 = clean(d.terrain2, 'terrain2');
    const street = clean(d.street, 'street');
    const communal = clean(d.communal, 'communal');
    // Placeholder AREAS: fixed-size dropped rectangles ({col,row,w,h}), an override overlay so
    // they may overlap any OTHER layer — but each is a distinct occupant slot, so areas may not
    // overlap EACH OTHER, their whole footprint must be in-bounds, and their size must be one of
    // the allowed drops (5×5 / 5×10 / 10×5). Mirrors the editor's drop guards.
    const placeholder = this.cleanPlaceholderAreas(d.placeholder, width, height);
    // Condition is a per-cell override overlay (no mutual-exclusion), like the old placeholder.
    const condition = clean(d.condition, 'condition');
    // Street and communal are mutually-exclusive walkability classes (exactly one
    // per cell — see docs/NIGHT_MARKET_TEMPLATES.md); the editor enforces this, and
    // we mirror it so a malformed payload can't mark a cell as both.
    const streetSet = new Set(street);
    for (const c of communal) {
      if (streetSet.has(c)) {
        throw new ValidationError(`Cell ${c} cannot be both street and communal-walkable`);
      }
    }
    // Houses: each anchor's full footprint must be in-bounds, houses may not overlap each
    // other, and no footprint cell may be a street (house placement overwrites decor but
    // never a street — mirrors the editor's placement rule). The footprint is flip-aware
    // (4×5 default, transposed to 5×4 when mirrored), matching the client geometry.
    const houses = this.cleanHouses(d.houses, inBounds);
    const houseOccupied = new Set<string>();
    for (const { cell: anchor, flip } of houses) {
      const [col, row] = anchor.split(',').map(Number);
      const { spanX, spanY } = houseFootprintSpans(flip);
      if (col + spanX > width || row + spanY > height) {
        throw new ValidationError(`House at ${anchor} extends outside the ${width}×${height} board`);
      }
      for (const c of houseFootprintCells(col, row, flip)) {
        if (houseOccupied.has(c)) throw new ValidationError(`Houses overlap at cell ${c}`);
        houseOccupied.add(c);
        if (streetSet.has(c)) throw new ValidationError(`House cell ${c} overlaps a street`);
      }
    }
    // Decor may not sit under a house (houses overwrite decor). Flush surface-family
    // decor MAY now coexist with a street (street is a spriteless tint, no longer a
    // plank), so street is not a blanket decor exclusion here — blocking decor over a
    // street is caught by the street-blocking loop below.
    const decor = this.cleanDecor(d.decor, inBounds, houseOccupied);
    // Street and communal are both walkability classes, mutually exclusive with BLOCKING
    // objects — a house or common/tree decor overwrite them in the editor, so a payload
    // with a walkability cell also under one is malformed (a bug slipped past the editor's
    // guards). Flush surface-family decor may coexist, so it is NOT checked. This is the
    // "check the coincidence rules at save" backstop. (Street⊥house is also caught in the
    // house loop above; re-checking here keeps the two walkability classes symmetric.)
    for (const [c, label] of [
      ...communal.map((c) => [c, 'communal-walkable'] as const),
      ...street.map((c) => [c, 'street-walkable'] as const),
    ]) {
      if (houseOccupied.has(c)) {
        throw new ValidationError(`Cell ${c} is ${label} but sits under a house`);
      }
      const stem = decor[c];
      if (stem && isBlockingDecorStem(stem)) {
        throw new ValidationError(`Cell ${c} is ${label} but carries blocking decor (${stem})`);
      }
    }
    return { terrain1, terrain2, street, communal, placeholder, condition, houses, decor };
  }

  /**
   * Normalize the houses payload to `{cell, flip}[]`. Accepts either legacy bare "col,row"
   * strings (→ flip:false, from before mirror support) or `{cell, flip}` objects. Each anchor
   * must be an in-bounds cell; duplicate anchors collapse to one. The footprint / overlap /
   * street coincidence checks live in the caller (they need width/height + the street set).
   */
  private cleanHouses(raw: unknown, inBounds: Set<string>): Array<{ cell: string; flip: boolean }> {
    if (raw == null) return [];
    if (!Array.isArray(raw)) {
      throw new ValidationError('Template houses must be an array');
    }
    const seen = new Set<string>();
    const out: Array<{ cell: string; flip: boolean }> = [];
    for (const h of raw) {
      const cell = typeof h === 'string'
        ? h
        : (h && typeof h === 'object' ? (h as { cell?: unknown }).cell : undefined);
      const flip = typeof h === 'object' && h != null ? !!(h as { flip?: unknown }).flip : false;
      if (typeof cell !== 'string' || !inBounds.has(cell)) {
        throw new ValidationError(`Template houses contains an out-of-bounds or malformed anchor: ${JSON.stringify(h)}`);
      }
      if (seen.has(cell)) continue; // de-dupe by anchor
      seen.add(cell);
      out.push({ cell, flip });
    }
    return out;
  }

  /**
   * Validate + normalize the placeholder AREAS payload to `{col,row,w,h}[]`. Each must be a
   * fixed-size drop (5×5 / 5×10 / 10×5 — {@link PLACEHOLDER_SIZES}), have its whole footprint
   * in-bounds, and NOT overlap another area (each is a distinct occupant slot). Mirrors the
   * editor's drop guards so a malformed/overlapping payload can't be persisted. A legacy flat
   * `string[]` cell mask has no area shape to recover, so it is rejected (the author must
   * re-drop after loading — matching the client's back-compat stance).
   */
  private cleanPlaceholderAreas(raw: unknown, width: number, height: number): PlaceholderArea[] {
    if (raw == null) return [];
    if (!Array.isArray(raw)) throw new ValidationError('Template placeholder must be an array of areas');
    const out: PlaceholderArea[] = [];
    for (const a of raw) {
      if (!a || typeof a !== 'object') {
        throw new ValidationError(`Template placeholder area is malformed: ${JSON.stringify(a)}`);
      }
      const { col, row, w, h } = a as Record<string, unknown>;
      if (![col, row, w, h].every((n) => typeof n === 'number' && Number.isInteger(n))) {
        throw new ValidationError(`Template placeholder area needs integer col,row,w,h: ${JSON.stringify(a)}`);
      }
      const area: PlaceholderArea = { col: col as number, row: row as number, w: w as number, h: h as number };
      if (!PLACEHOLDER_SIZES.some((s) => s.w === area.w && s.h === area.h)) {
        throw new ValidationError(`Template placeholder area has an unsupported size ${area.w}×${area.h} (allowed: 5×5, 5×10, 10×5)`);
      }
      if (area.col < 0 || area.row < 0 || area.col + area.w > width || area.row + area.h > height) {
        throw new ValidationError(`Placeholder area at (${area.col},${area.row}) size ${area.w}×${area.h} extends outside the ${width}×${height} board`);
      }
      if (out.some((existing) => placeholderAreasOverlap(existing, area))) {
        throw new ValidationError(`Placeholder areas overlap at (${area.col},${area.row})`);
      }
      out.push(area);
    }
    return out;
  }

  /**
   * Validate the decor map: a `cell → sprite-stem` object whose keys are in-bounds
   * cells and whose values are non-empty stems. A decor cell may NOT sit under a house
   * (houses overwrite ALL decor — the editor enforces this, and we mirror it here). A
   * street cell is allowed to carry FLUSH surface-family decor (street is now a spriteless
   * tint); BLOCKING decor over a street is rejected separately by the caller's
   * street-blocking check. Stems are accepted as opaque strings — the server has no
   * tileset to validate them against.
   */
  private cleanDecor(
    raw: unknown,
    inBounds: Set<string>,
    houseOccupied: Set<string>,
  ): Record<string, string> {
    if (raw == null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ValidationError('Template decor must be an object of cell → sprite');
    }
    const out: Record<string, string> = {};
    for (const [cell, stem] of Object.entries(raw as Record<string, unknown>)) {
      if (!inBounds.has(cell)) {
        throw new ValidationError(`Template decor contains an out-of-bounds cell: ${cell}`);
      }
      if (typeof stem !== 'string' || stem.trim().length === 0) {
        throw new ValidationError(`Template decor cell ${cell} has an invalid sprite`);
      }
      if (houseOccupied.has(cell)) {
        throw new ValidationError(`Template decor cell ${cell} is under a house (houses overwrite decor)`);
      }
      out[cell] = stem;
    }
    return out;
  }
}
