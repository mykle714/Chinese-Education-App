// Thin client for the custom card icon layout endpoints (docs/CARD_ICON_LAYOUT.md).
//
// All are auth-gated, but NONE of these functions takes a `token`: every call goes through
// src/api/http.ts, which reads the bearer token fresh at call time (authHeader()). Threading
// the token through the signature was what pulled it into caller dependency arrays, where a
// silent ~15-min refresh re-ran effects — see CLAUDE.md "Never reload/reset a page on a
// silent token refresh" and docs/ARCHITECTURE_REVIEW.md finding 5.

import type { IconLayoutItem, SnapConfig, TextColors, TextLayout } from "../types";
import { apiGet, apiPost, apiPatch } from '../api/http';

export interface IconSearchItem { id: string; name: string }
interface IconSearchPage { icons: IconSearchItem[]; hasMore: boolean }

/**
 * List the icons we've already downloaded+cached into our DB (the catalog), paged.
 * Used by the icon picker's empty-query state to browse all downloaded icons.
 * Shape matches searchIcons8 (icons + hasMore) so the picker can treat both uniformly.
 */
export function listIcons8(offset: number, limit: number): Promise<IconSearchPage> {
  return apiGet<IconSearchPage>("/api/icons8", { params: { offset, limit } });
}

/** Live icons8 search for the add-icon dialog. Returns ids+names + a hasMore flag. */
export function searchIcons8(term: string, offset: number, limit: number): Promise<IconSearchPage> {
  return apiGet<IconSearchPage>("/api/icons8/search", { params: { term, offset, limit } });
}

/**
 * Download + cache an icon's SVG into our DB so /api/icons8/<id>/image can serve it.
 * Called when a user selects a search result. Idempotent.
 */
export async function ensureIcon8(iconId: string): Promise<void> {
  await apiPost<unknown>(`/api/icons8/${encodeURIComponent(iconId)}/ensure`);
}

/**
 * Fetch (and warm on first call) the cached icons8 results for a card's DEFAULT
 * search query — the card's English meaning. Called when the learner enters edit mode
 * so the picker can render results the instant it opens (no live search on open).
 * The server caches the response on the shared det row (migration 87); `term` is the
 * client-computed default query (iconSearchTerm). See docs/CARD_ICON_LAYOUT.md.
 */
export async function fetchDefaultIconResults(
  params: { language: string; entryKey: string; term: string }
): Promise<IconSearchItem[]> {
  const data = await apiPost<{ icons: IconSearchItem[] }>(`/api/icons8/defaultResults`, params);
  return data.icons;
}

/**
 * Persist (array) or clear (null) the custom icon layout for a vet row, plus the editor's
 * per-card snap toggles (`snapConfig`), Contrast text colors (`textColors`), movable-text
 * placement (`textLayout`), and card background fill (`cardColor`). The editor always sends
 * all five together (they persist per card; see docs/CARD_ICON_LAYOUT.md); pass `null` for
 * any of them on reset-to-default to clear it.
 */
export function saveIconLayout(
  vetId: number,
  layout: IconLayoutItem[] | null,
  snapConfig: SnapConfig | null,
  textColors: TextColors | null,
  textLayout: TextLayout | null,
  cardColor: string | null
): Promise<{ id: number; iconLayout: IconLayoutItem[] | null; snapConfig: SnapConfig | null; textColors: TextColors | null; textLayout: TextLayout | null; cardColor: string | null }> {
  return apiPatch(`/api/vocabEntries/${vetId}/iconLayout`, {
    iconLayout: layout, snapConfig, textColors, textLayout, cardColor,
  });
}
