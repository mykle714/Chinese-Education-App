import { apiGet, apiPost } from '../../api/http';
import type { TemplateDefinitionPayload } from './templateEditorApi';

/**
 * Client API for the Night Market runtime LAYOUT read
 * (docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md slice 3).
 *
 * LAYER: feature/runtime data access. Fetches the authenticated user's persisted template
 * placements (GET /api/nightMarket/layout) — the per-user world the engine renders. Distinct
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

/** GET /api/nightMarket/layout response. */
export interface UserLayoutResponse {
  layout: PlacedTemplatePayload[];
}

/**
 * Fetch the authenticated user's rendered template layout FOR ONE LANGUAGE. Each
 * (user, language) is an independent market with its own placements and starter hub, funded by
 * that language's own wallet (migration 130, docs/PER_LANGUAGE_STREAKS.md), so the language
 * selects which market is returned — callers must re-fetch when the selected language changes
 * or the previous market keeps rendering.
 *
 * The token is read live inside src/api/http.ts so a silent refresh doesn't require
 * re-creating the caller (CLAUDE.md token rule) — callers must key their load effect on a
 * stable auth identity plus the language, never on `token`.
 */
export async function loadUserLayout(language: string): Promise<PlacedTemplatePayload[]> {
  const data = await apiGet<UserLayoutResponse>(
    `/api/nightMarket/layout?language=${encodeURIComponent(language)}`,
  );
  return data.layout ?? [];
}

/** Fresh balances returned by the author minute-adjust tool. */
export interface AdjustMinutesResult {
  /** NET balance for the author's SELECTED language after the adjust — drives that language's market + the nmp badge. */
  totalMinutePoints: number;
  /** GLOBAL gross lifetime earned after the adjust. */
  lifetimeMinutesEarned: number;
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
  return apiPost<AdjustMinutesResult>('/api/nightMarket/dev/adjustMinutes', {
    delta,
    timestamp: new Date().toISOString(),
    tz,
  });
}
