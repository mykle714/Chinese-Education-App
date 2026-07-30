/**
 * Client helper for writing-practice completions (stars).
 *
 * Talks to GET/POST /api/handwriting/completions (server/server.ts). A "star" is a
 * completed assistance level for a character; this fetches/records them.
 * Spec: docs/HANDWRITING_RECOGNITION.md ("Completion tracking / stars").
 */
import { API_BASE_URL } from "../../constants";
import { apiPost } from '../../api/http';

function authHeaders(token: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Completed levels for one character (e.g. ["trace","peek"]). */
export async function fetchCompletedLevels(
  language: string,
  entryKey: string,
  token: string | null,
): Promise<string[]> {
  const params = new URLSearchParams({ language, entryKey });
  const res = await fetch(`${API_BASE_URL}/api/handwriting/completions?${params}`, {
    credentials: "include",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`fetch completions failed: HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.completedLevels) ? data.completedLevels : [];
}

/** Records a completed level (idempotent server-side); returns the new full set. */
export async function recordCompletion(
  language: string,
  entryKey: string,
  level: string,
): Promise<string[]> {
  const data = await apiPost<{ completedLevels?: string[] }>(`/api/handwriting/completions`, { language, entryKey, level });
  return Array.isArray(data?.completedLevels) ? data.completedLevels : [];
}
