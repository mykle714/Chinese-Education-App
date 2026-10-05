/**
 * Client helper for writing-practice completions (stars).
 *
 * Talks to GET/POST /api/handwriting/completions (server/server.ts). A "star" is a
 * completed assistance level for a character; this fetches/records them. Levels are
 * level NUMBERS 1..8 (migration 172), not mode names.
 * Spec: docs/HANDWRITING_RECOGNITION.md ("Completion tracking / stars").
 */
import { API_BASE_URL } from "../../constants";
import { apiPost } from '../../api/http';

function authHeaders(token: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Completed level numbers for one character (e.g. [1, 2]). */
export async function fetchCompletedLevels(
  language: string,
  entryKey: string,
  token: string | null,
): Promise<number[]> {
  const params = new URLSearchParams({ language, entryKey });
  const res = await fetch(`${API_BASE_URL}/api/handwriting/completions?${params}`, {
    credentials: "include",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`fetch completions failed: HTTP ${res.status}`);
  const data = await res.json();
  return toLevelNumbers(data?.completedLevels);
}

/** Records a completed level (idempotent server-side); returns the new full set. */
export async function recordCompletion(
  language: string,
  entryKey: string,
  level: number,
): Promise<number[]> {
  const data = await apiPost<{ completedLevels?: unknown }>(`/api/handwriting/completions`, { language, entryKey, level });
  return toLevelNumbers(data?.completedLevels);
}

/** The response's level list, kept to finite numbers (the wire is untyped). */
function toLevelNumbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === "number" && Number.isFinite(v)) : [];
}
