import { API_BASE_URL } from '../../constants';
import { authHeader } from '../../utils/authHeader';
import type { TemplateDefinitionPayload } from './templateEditorApi';

/**
 * Client API for the Night Market runtime LAYOUT read
 * (docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md slice 3).
 *
 * LAYER: feature/runtime data access. Fetches the authenticated user's persisted template
 * placements (GET /api/night-market/layout) — the per-user world the engine renders. Distinct
 * from templateEditorApi.ts (the validator-gated authoring catalog): this is a per-user read
 * every player performs. The server seeds the origin hub on first load, so a fresh account
 * still returns a one-template layout.
 */

/** One placed template in the user's layout — mirrors the server's PlacedTemplatePayload. */
export interface PlacedTemplatePayload {
  /** Catalog name of the placed template. */
  name: string;
  /** The version being rendered (persisted on the placement row). */
  activeVersion: number;
  /** SW (min-iso) corner offset of this placement, in template-cell units (col→+isoX, row→+isoY). */
  offsetCol: number;
  offsetRow: number;
  /** Board size of the placed template. */
  width: number;
  height: number;
  /** The loaded version's definition (placeholder + description merged from version 0). */
  def: TemplateDefinitionPayload;
  /** Placeholder-area ids ("col_row") an occupant currently fills in this placement. */
  filledPlaceholderIds: string[];
}

/** GET /api/night-market/layout response. */
export interface UserLayoutResponse {
  layout: PlacedTemplatePayload[];
}

/**
 * Fetch the authenticated user's rendered template layout. The token is read live via
 * {@link authHeader} so a silent refresh doesn't require re-creating the caller (CLAUDE.md
 * token rule) — callers must key their load effect on a stable auth identity, not `token`.
 */
export async function loadUserLayout(): Promise<PlacedTemplatePayload[]> {
  const res = await fetch(`${API_BASE_URL}/api/night-market/layout`, {
    headers: { ...authHeader() },
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || 'Failed to load the night market layout');
  return (data as UserLayoutResponse).layout ?? [];
}

/** Fresh balances returned by the author minute-adjust tool. */
export interface AdjustMinutesResult {
  /** NET balance (users.totalMinutePoints) after the adjust — drives the market + the nmp badge. */
  totalMinutePoints: number;
  /** GLOBAL gross lifetime earned after the adjust. */
  grossMinutesEarned: number;
}

/**
 * TEMPLATE-AUTHOR-ONLY dev tool: emit an artificial ±N minute signal (the nmp buttons) and let the
 * server reconcile the market to the new balance. `delta > 0` earns (net+gross ↑, grant occupants);
 * `delta < 0` penalizes (net ↓ floored, gross unchanged, decay occupants). Returns the fresh
 * balances so the caller can update the badge, then reload the layout to redraw the market. 403 for
 * non-authors (the server gates on users.isTemplateAuthor).
 */
export async function adjustAuthorMinutes(delta: number): Promise<AdjustMinutesResult> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const res = await fetch(`${API_BASE_URL}/api/night-market/dev/adjust-minutes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    credentials: 'include',
    body: JSON.stringify({ delta, timestamp: new Date().toISOString(), tz }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || 'Failed to adjust minutes');
  return data as AdjustMinutesResult;
}
