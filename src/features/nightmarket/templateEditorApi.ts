import { API_BASE_URL } from '../../constants';
import { authHeader } from '../../utils/authHeader';
import type { EditorMasks } from '../../engine/market/farmTerrain';
import { freeFarmTileset } from '../../engine/market/freeFarmTileset';

/**
 * Client API for the Night Market template editor
 * (docs/NIGHT_MARKET_TEMPLATE_EDITOR.md). Validator-gated server-side.
 */

/** The serialized `definition` shape stored on a template row (stems for decor). */
export interface TemplateDefinitionPayload {
  lightGrass: string[];
  darkGrass: string[];
  street: string[];
  /** Communal-walkable cells (parks/plazas) — a walkability class, no sprite. */
  communal: string[];
  /** Placeholder-area cells (occupant slots) — an override overlay, no sprite. Shared across versions (owned by version 0). */
  placeholder: string[];
  /** Condition-mask cells — a per-version override overlay, no sprite. */
  condition: string[];
  /** Placed-house FRONT-corner anchor cells "col,row" (4×5 footprint each). */
  houses: string[];
  decor: Record<string, string>;
}

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
 * Serialize the painted layers into the `definition` payload. The grass/street Sets
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
    lightGrass: [...masks.lightGrass],
    darkGrass: [...masks.darkGrass],
    street: [...masks.street],
    communal: [...masks.communal],
    placeholder: [...masks.placeholder],
    condition: [...masks.condition],
    houses: [...masks.houses],
    decor,
  };
}

/**
 * Rebuild the editor's mask layers from a stored `definition`. The grass/street
 * arrays become Sets; the decor `cell → stem` object becomes a `cell → URL` Map by
 * resolving each stem through the tileset (a stem with no live asset is dropped).
 */
export function definitionToMasks(def: TemplateDefinitionPayload): EditorMasks {
  const decor = new Map<string, string>();
  for (const [cell, stem] of Object.entries(def.decor ?? {})) {
    const url = freeFarmTileset.get(stem);
    if (url) decor.set(cell, url);
  }
  return {
    lightGrass: new Set(def.lightGrass ?? []),
    darkGrass: new Set(def.darkGrass ?? []),
    street: new Set(def.street ?? []),
    communal: new Set(def.communal ?? []),
    placeholder: new Set(def.placeholder ?? []),
    condition: new Set(def.condition ?? []),
    houses: new Set(def.houses ?? []),
    decor,
  };
}

/** List all templates (name-ordered) for the Load dropdown. */
export async function listTemplates(): Promise<TemplateSummary[]> {
  const res = await fetch(`${API_BASE_URL}/api/nightmarket-templates`, {
    headers: { ...authHeader() },
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Failed to list templates');
  return data.templates ?? [];
}

/** Load one template version (full definition + availableVersions) by name+version. */
export async function loadTemplate(name: string, version = 0): Promise<LoadedTemplate> {
  const res = await fetch(
    `${API_BASE_URL}/api/nightmarket-templates/load?name=${encodeURIComponent(name)}&version=${version}`,
    { headers: { ...authHeader() }, credentials: 'include' },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Failed to load template');
  return data.template;
}

/** Whether `name` is free. Backs the Properties-popup rename gate. */
export async function checkTemplateNameAvailable(name: string): Promise<boolean> {
  const res = await fetch(
    `${API_BASE_URL}/api/nightmarket-templates/name-available?name=${encodeURIComponent(name)}`,
    { headers: { ...authHeader() }, credentials: 'include' },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to check template name');
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
  const res = await fetch(`${API_BASE_URL}/api/nightmarket-templates`, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      name: input.name,
      version: input.version,
      width: input.width,
      height: input.height,
      description: input.description,
      definition: masksToDefinition(input.masks),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Failed to submit template');
  return { overwritten: !!data.overwritten, version: data.template?.version ?? input.version };
}

/** Hard-delete a WHOLE template (all versions of the name). Throws with the server message on failure. */
export async function deleteTemplate(name: string): Promise<void> {
  const res = await fetch(
    `${API_BASE_URL}/api/nightmarket-templates?name=${encodeURIComponent(name)}`,
    { method: 'DELETE', headers: { ...authHeader() }, credentials: 'include' },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || 'Failed to delete template');
  }
}
