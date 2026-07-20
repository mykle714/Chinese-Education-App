import { API_BASE_URL } from '../../constants';
import { authHeader } from '../../utils/authHeader';

/**
 * Client API for the desktop-only Template Sandbox tool
 * (docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md). Template-author-gated server-side.
 *
 * A sandbox placement is one instance of a catalog template dropped into the author's freeform
 * scratch layout: a `templateName` + a per-instance `activeVersion` + a SW-corner offset in
 * template-cell units (`offsetCol`/`offsetRow`). Overlaps are allowed. Backed by
 * `nightmarkettemplatesandbox` (migration 116).
 */

/**
 * Per-placement RENDER/VIEW preference bag (`settings` jsonb, migration 119). A generic bag so a
 * new author-facing switch needs no migration — but the server whitelists the keys, so add one
 * here AND in NightMarketSandboxService.SETTINGS_SCHEMA together.
 */
export interface SandboxSettings {
  /**
   * Render an occupant house in EVERY placeholder area of this placement. Absent = true (the
   * default filled look); false = no houses at all. In the sandbox this fully replaces the
   * editor's condition-driven house preview.
   */
  showHouses?: boolean;
}

/** Defaults applied when a key is absent from a placement's stored `settings`. */
export const SANDBOX_SETTING_DEFAULTS = { showHouses: true } as const;

/** One placed template instance in the author's sandbox (a `nightmarkettemplatesandbox` row). */
export interface SandboxPlacement {
  id: string;
  templateName: string;
  /** This instance's rendered version (independently switchable from the header). */
  activeVersion: number;
  /** SW (min-iso / near) corner offset, in template-cell units (col → +isoX, row → +isoY). */
  offsetCol: number;
  offsetRow: number;
  /** When true, this tile cannot be dragged/moved (a move-guard only — select/version/delete still work). */
  locked: boolean;
  /** Render/view preferences for this tile (see {@link SandboxSettings}); `{}` = all defaults. */
  settings: SandboxSettings;
  createdAt: string;
}

/** List the author's sandbox placements (chronological order). */
export async function listSandboxPlacements(): Promise<SandboxPlacement[]> {
  const res = await fetch(`${API_BASE_URL}/api/nightmarket-sandbox`, {
    headers: { ...authHeader() },
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Failed to list sandbox placements');
  return data.placements ?? [];
}

/** Drop one template into the sandbox at a SW-corner offset. Returns the created row. */
export async function addSandboxPlacement(input: {
  templateName: string;
  activeVersion: number;
  offsetCol: number;
  offsetRow: number;
}): Promise<SandboxPlacement> {
  const res = await fetch(`${API_BASE_URL}/api/nightmarket-sandbox`, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Failed to add sandbox placement');
  return data.placement;
}

/** Move one placement to a new SW-corner offset (drag). Returns the updated row. */
export async function moveSandboxPlacement(
  id: string,
  offsetCol: number,
  offsetRow: number,
): Promise<SandboxPlacement> {
  const res = await fetch(`${API_BASE_URL}/api/nightmarket-sandbox/${encodeURIComponent(id)}/position`, {
    method: 'PATCH',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ offsetCol, offsetRow }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Failed to move sandbox placement');
  return data.placement;
}

/** Set one placement's rendered version (the per-instance version switcher). Returns the row. */
export async function setSandboxPlacementVersion(id: string, activeVersion: number): Promise<SandboxPlacement> {
  const res = await fetch(`${API_BASE_URL}/api/nightmarket-sandbox/${encodeURIComponent(id)}/version`, {
    method: 'PATCH',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ activeVersion }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Failed to set sandbox placement version');
  return data.placement;
}

/** Lock / unlock one placement (the move-guard toggle). Returns the updated row. */
export async function setSandboxPlacementLock(id: string, locked: boolean): Promise<SandboxPlacement> {
  const res = await fetch(`${API_BASE_URL}/api/nightmarket-sandbox/${encodeURIComponent(id)}/lock`, {
    method: 'PATCH',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ locked }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Failed to set sandbox placement lock');
  return data.placement;
}

/**
 * MERGE a render/view settings patch into one placement's `settings` bag (e.g.
 * `{ showHouses: false }`). Other keys are left untouched. Returns the updated row.
 */
export async function setSandboxPlacementSettings(id: string, settings: SandboxSettings): Promise<SandboxPlacement> {
  const res = await fetch(`${API_BASE_URL}/api/nightmarket-sandbox/${encodeURIComponent(id)}/settings`, {
    method: 'PATCH',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ settings }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Failed to set sandbox placement settings');
  return data.placement;
}

/** Delete one placement (the "Delete selected" action). */
export async function removeSandboxPlacement(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/nightmarket-sandbox/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...authHeader() },
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || 'Failed to delete sandbox placement');
  }
}
