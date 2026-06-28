// Thin client for the custom card icon layout endpoints (docs/CARD_ICON_LAYOUT.md).
// All are auth-gated; the caller passes the bearer token from useAuth().

import { API_BASE_URL } from "../../constants";
import type { IconLayoutItem, SnapConfig } from "../../types";

export interface IconSearchItem { id: string; name: string }
interface IconSearchPage { icons: IconSearchItem[]; hasMore: boolean }

function authHeaders(token: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * List the icons we've already downloaded+cached into our DB (the catalog), paged.
 * Used by the icon picker's empty-query state to browse all downloaded icons.
 * Shape matches searchIcons8 (icons + hasMore) so the picker can treat both uniformly.
 */
export async function listIcons8(
  token: string | null,
  offset: number,
  limit: number
): Promise<IconSearchPage> {
  const url = `${API_BASE_URL}/api/icons8?offset=${offset}&limit=${limit}`;
  const res = await fetch(url, { credentials: "include", headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Failed to load icons (${res.status})`);
  return res.json();
}

/** Live icons8 search for the add-icon dialog. Returns ids+names + a hasMore flag. */
export async function searchIcons8(
  token: string | null,
  term: string,
  offset: number,
  limit: number
): Promise<IconSearchPage> {
  const url = `${API_BASE_URL}/api/icons8/search?term=${encodeURIComponent(term)}&offset=${offset}&limit=${limit}`;
  const res = await fetch(url, { credentials: "include", headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Icon search failed (${res.status})`);
  return res.json();
}

/**
 * Download + cache an icon's SVG into our DB so /api/icons8/<id>/image can serve it.
 * Called when a user selects a search result. Idempotent.
 */
export async function ensureIcon8(token: string | null, iconId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/icons8/${encodeURIComponent(iconId)}/ensure`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to add icon (${res.status})`);
}

/**
 * Fetch (and warm on first call) the cached icons8 results for a card's DEFAULT
 * search query — the card's English meaning. Called when the learner enters edit mode
 * so the picker can render results the instant it opens (no live search on open).
 * The server caches the response on the shared det row (migration 87); `term` is the
 * client-computed default query (iconSearchTerm). See docs/CARD_ICON_LAYOUT.md.
 */
export async function fetchDefaultIconResults(
  token: string | null,
  params: { language: string; entryKey: string; pos: string | null; term: string }
): Promise<IconSearchItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/icons8/default-results`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Failed to load default icons (${res.status})`);
  const data: { icons: IconSearchItem[] } = await res.json();
  return data.icons;
}

/**
 * Persist (array) or clear (null) the custom icon layout for a vet row, plus the
 * editor's per-card snap toggles (`snapConfig`). The editor always sends both together
 * (snap persists per card; see docs/CARD_ICON_LAYOUT.md); pass `null` for snapConfig on
 * reset-to-default to clear it.
 */
export async function saveIconLayout(
  token: string | null,
  vetId: number,
  layout: IconLayoutItem[] | null,
  snapConfig: SnapConfig | null
): Promise<{ id: number; iconLayout: IconLayoutItem[] | null; snapConfig: SnapConfig | null }> {
  const res = await fetch(`${API_BASE_URL}/api/vocabEntries/${vetId}/icon-layout`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ iconLayout: layout, snapConfig }),
  });
  if (!res.ok) throw new Error(`Failed to save layout (${res.status})`);
  return res.json();
}
