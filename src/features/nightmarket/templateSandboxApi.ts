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
/**
 * What a placement draws in its placeholder AREAS — the tri-state the header's Houses button
 * cycles: `all` (a house in every placeholder area — the finished look) → `placeholder` (no
 * houses; the areas are TINTED so the slots are visible) → `none`. In the sandbox this fully
 * replaces the editor's condition-driven house preview.
 */
export type SandboxHouseMode = 'all' | 'placeholder' | 'none';

/** The cycle order the Houses button (and its `H` hotkey) walks. */
export const SANDBOX_HOUSE_MODES: readonly SandboxHouseMode[] = ['all', 'placeholder', 'none'];

export interface SandboxSettings {
  /** Placeholder-area render mode; absent = `'all'`. (Replaced the old boolean `showHouses`.) */
  houseMode?: SandboxHouseMode;
}

/** Defaults applied when a key is absent from a placement's stored `settings`. */
export const SANDBOX_SETTING_DEFAULTS = { houseMode: 'all' } as const;

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
 * `{ houseMode: 'none' }`). Other keys are left untouched. Returns the updated row.
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

/**
 * ITERATE — run the LIVE runtime growth algorithm (the same planner that grows a player's night
 * market) one step over the sandbox layout and place what it chose. Returns the new placement, or
 * `null` when nothing legal fits at any exposed anchor (a normal answer, not an error). An empty
 * sandbox seeds the starter hub at the origin, mirroring a fresh account.
 */
export async function iterateSandboxPlacement(): Promise<SandboxPlacement | null> {
  const res = await fetch(`${API_BASE_URL}/api/nightmarket-sandbox/iterate`, {
    method: 'POST',
    headers: { ...authHeader() },
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Failed to iterate the sandbox');
  return data.placement ?? null;
}

/** Clear the whole sandbox (the "Clear" action). Returns how many placements were removed. */
export async function clearSandboxPlacements(): Promise<number> {
  const res = await fetch(`${API_BASE_URL}/api/nightmarket-sandbox`, {
    method: 'DELETE',
    headers: { ...authHeader() },
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Failed to clear sandbox');
  return data.deleted ?? 0;
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
