import { apiGet, apiPost, apiDelete, withFallback } from '../../api/http';
import type { EditorMasks } from '../../engine/market/farmTerrain';
import { freeFarmTileset } from '../../engine/market/freeFarmTileset';
import { isValidPlaceholderSize, type PlaceholderArea } from '../../engine/market/placeholderArea';
import type { TemplateDefinitionPayload } from '../../engine/market/templateDefinition';

// The definition payload is the ENGINE's input contract, so it is declared there
// (see engine/market/templateDefinition.ts). Re-exported here because this module is
// where every feature-side caller already imports it from.
export type { TemplateDefinitionPayload };

/**
 * Client API for the Night Market template editor
 * (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md). Validator-gated server-side.
 */

/**
 * The name of the STARTER hub template — the block every user's market renders at origin
 * before any unlocks (docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md § "Slice-1 build
 * decisions"). Identified by this exact name rather than an `isHub` column; the template
 * must be authored in the editor under this name (it exists: 28×28). The runtime
 * (`useMarketWorld`) loads it by name.
 */
export const NIGHT_MARKET_HUB_TEMPLATE_NAME = 'night-market-hub';

/** A Load-dropdown summary row — one entry PER NAME (no heavy definition). */
export interface TemplateSummary {
  name: string;
  width: number;
  height: number;
  /** Number of versions this name has (dropdown subtitle). */
  versionCount: number;
  /** The version-0 author's display name, or null if the user is gone. */
  author: string | null;
  /** The shared per-name description (from version 0), or null if none. */
  description: string | null;
}

/**
 * One entry for the visual Load GALLERY — a Load-dropdown summary PLUS the full definition
 * of the version chosen for its thumbnail: the version with the MOST condition cells (the
 * richest layout), tie-broken by the highest version number (a single-version template
 * previews version 0, which has no conditions). The shared placeholder + description are
 * merged from version 0 server-side, so the thumbnail matches every other view.
 */
export interface TemplateGalleryEntry extends TemplateSummary {
  /** The version rendered in the thumbnail (the one with the most condition cells). */
  chosenVersion: number;
  /** Condition-cell count of the chosen version (the selection metric; shown in the caption). */
  conditionCount: number;
  /** The chosen version's full painted definition (placeholder merged from v0). */
  definition: TemplateDefinitionPayload;
}

/** A full template version, as returned when loading one by (name, version). */
export interface LoadedTemplate {
  name: string;
  version: number;
  width: number;
  height: number;
  definition: TemplateDefinitionPayload;
  /** The shared per-name description (from version 0), or null if none. */
  description: string | null;
  /** Every existing version number for this name, ascending (drives the version dropdown). */
  availableVersions: number[];
}

/**
 * Serialize the painted layers into the `definition` payload. The terrain/street Sets
 * become sorted cell arrays; the decor map becomes a `cell → sprite STEM` object
 * (fingerprinted URLs are resolved back to their stable filename stem via the
 * tileset, so a definition survives asset re-fingerprinting across builds).
 */
export function masksToDefinition(masks: EditorMasks): TemplateDefinitionPayload {
  const decor: Record<string, string> = {};
  for (const [cell, url] of [...masks.decor].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const stem = freeFarmTileset.stemOf(url);
    if (stem) decor[cell] = stem; // skip any unresolved url defensively
  }
  return {
    terrain1: [...masks.terrain1],
    terrain2: [...masks.terrain2],
    street: [...masks.street],
    communal: [...masks.communal],
    // Placeholder areas → sorted {col,row,w,h} records (sorted by anchor for stable diffs).
    placeholder: [...masks.placeholder].sort((a, b) => a.col - b.col || a.row - b.row),
    condition: [...masks.condition],
    decor,
  };
}

/**
 * Rebuild the editor's mask layers from a stored `definition`. The terrain/street
 * arrays become Sets; the decor `cell → stem` object becomes a `cell → URL` Map by
 * resolving each stem through the tileset (a stem with no live asset is dropped). Note:
 * the legacy `lightGrass`/`darkGrass` keys are NOT read — templates saved before the
 * terrain1/terrain2 rename load with empty terrain (they must be re-saved).
 */
export function definitionToMasks(def: TemplateDefinitionPayload): EditorMasks {
  const decor = new Map<string, string>();
  for (const [cell, stem] of Object.entries(def.decor ?? {})) {
    const url = freeFarmTileset.get(stem);
    if (url) decor.set(cell, url);
  }
  return {
    terrain1: new Set(def.terrain1 ?? []),
    terrain2: new Set(def.terrain2 ?? []),
    street: new Set(def.street ?? []),
    communal: new Set(def.communal ?? []),
    // Placeholder areas. Back-compat: a legacy flat cell mask (string[]) has no area shape to
    // recover, so it is DROPPED (the author re-drops) — same "must re-save" stance as terrain.
    placeholder: (Array.isArray(def.placeholder) ? def.placeholder : []).filter(
      (a): a is PlaceholderArea =>
        !!a && typeof a === 'object' && typeof (a as PlaceholderArea).col === 'number' &&
        typeof (a as PlaceholderArea).row === 'number' &&
        isValidPlaceholderSize((a as PlaceholderArea).w, (a as PlaceholderArea).h),
    ),
    condition: new Set(def.condition ?? []),
    decor,
  };
}

/**
 * Every call below goes through src/api/http.ts (base URL, Authorization read fresh at
 * call time, `credentials: 'include'`, throw-on-non-2xx). A non-2xx raises an ApiError
 * whose `message` is already the server's `error` field; `withFallback` only supplies a
 * message for the rare error body that carries none, preserving the wording callers used
 * to get from the hand-rolled `data?.error || '...'` chain.
 * See docs/ARCHITECTURE_REVIEW.md finding 5.
 *
 * Paths are camelCase (`/api/nightMarketTemplates/...`) and must stay in step with
 * server/routes/nightMarketTemplateRoutes.ts.
 */
/** List all templates (name-ordered) for the Load dropdown. */
export async function listTemplates(): Promise<TemplateSummary[]> {
  const data = await withFallback(
    apiGet<{ templates?: TemplateSummary[] }>('/api/nightMarketTemplates'),
    'Failed to list templates',
  );
  return data.templates ?? [];
}

/**
 * List all templates for the visual Load gallery — one entry per name, each with the full
 * definition of its most-conditions version (for the thumbnail). Heavier than
 * {@link listTemplates} (it carries definitions), so it backs the gallery, not the dropdown.
 */
export async function listTemplateGallery(): Promise<TemplateGalleryEntry[]> {
  const data = await withFallback(
    apiGet<{ templates?: TemplateGalleryEntry[] }>('/api/nightMarketTemplates/gallery'),
    'Failed to list template gallery',
  );
  return data.templates ?? [];
}

/** Load one template version (full definition + availableVersions) by name+version. */
export async function loadTemplate(name: string, version = 0): Promise<LoadedTemplate> {
  const data = await withFallback(
    apiGet<{ template: LoadedTemplate }>('/api/nightMarketTemplates/load', {
      params: { name, version },
    }),
    'Failed to load template',
  );
  return data.template;
}

/**
 * Ask the server for a free default name ("template{index}", index = first free positive
 * integer) to pre-fill a fresh template in the Properties popup. Validator-gated server-side.
 */
export async function suggestTemplateName(): Promise<string> {
  const data = await withFallback(
    apiGet<{ name: string }>('/api/nightMarketTemplates/suggestName'),
    'Failed to suggest template name',
  );
  return data.name;
}

/** Whether `name` is free. Backs the Properties-popup rename gate. */
export async function checkTemplateNameAvailable(name: string): Promise<boolean> {
  const data = await withFallback(
    apiGet<{ available?: boolean }>('/api/nightMarketTemplates/nameAvailable', {
      params: { name },
    }),
    'Failed to check template name',
  );
  return !!data.available;
}

/**
 * Save one template VERSION — upsert by (name, version) (creates, or OVERWRITES the
 * same (name, version) row). The accidental-overwrite guard is the Properties rename
 * gate on the client, so this can only overwrite a template the author deliberately
 * loaded. Version 0 owns the shared placeholder; higher versions inherit it (the
 * server strips placeholder from their stored payload). Resolves to whether an
 * existing row was overwritten (for the Save confirmation message).
 */
export async function submitTemplate(input: {
  name: string;
  version: number;
  width: number;
  height: number;
  /** Shared per-name description — only version 0's is stored (see the service). */
  description: string | null;
  masks: EditorMasks;
}): Promise<{ overwritten: boolean; version: number }> {
  const data = await withFallback(
    apiPost<{ overwritten?: boolean; template?: { version?: number } }>(
      '/api/nightMarketTemplates',
      {
        name: input.name,
        version: input.version,
        width: input.width,
        height: input.height,
        description: input.description,
        definition: masksToDefinition(input.masks),
      },
    ),
    'Failed to submit template',
  );
  return { overwritten: !!data.overwritten, version: data.template?.version ?? input.version };
}

/** Hard-delete a WHOLE template (all versions of the name). Throws with the server message on failure. */
export async function deleteTemplate(name: string): Promise<void> {
  await withFallback(
    apiDelete<unknown>('/api/nightMarketTemplates', undefined, { params: { name } }),
    'Failed to delete template',
  );
}

/**
 * Hard-delete a SINGLE version of a template. The server rejects version 0 (it is the
 * base — delete the whole template instead). Throws with the server message on failure.
 */
export async function deleteTemplateVersion(name: string, version: number): Promise<void> {
  await withFallback(
    apiDelete<unknown>('/api/nightMarketTemplates/version', undefined, {
      params: { name, version },
    }),
    'Failed to delete template version',
  );
}
