// Thin client for the custom card icon layout endpoints (docs/CARD_ICON_LAYOUT.md).
// All are auth-gated; the caller passes the bearer token from useAuth().

import { API_BASE_URL } from "../../constants";
import type { IconLayoutItem } from "../../types";

interface IconSearchItem { id: string; name: string }
interface IconSearchPage { icons: IconSearchItem[]; hasMore: boolean }

function authHeaders(token: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
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
 * Persist (array) or clear (null) the custom layout for a vet row, plus the white
 * text-backdrop flag (forced off by the server when the layout is cleared).
 */
export async function saveIconLayout(
  token: string | null,
  vetId: number,
  layout: IconLayoutItem[] | null,
  textBackdrop: boolean
): Promise<{ id: number; iconLayout: IconLayoutItem[] | null; iconTextBackdrop: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/vocabEntries/${vetId}/icon-layout`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ iconLayout: layout, textBackdrop }),
  });
  if (!res.ok) throw new Error(`Failed to save layout (${res.status})`);
  return res.json();
}
