/**
 * authStorage — the single owner of the auth-related localStorage keys.
 *
 * The access token (`token`) and the post-logout banner flag (`sessionExpired`)
 * were previously read/written as raw `localStorage` calls scattered across six
 * modules (AuthContext, apiClient, fetchInterceptor, tokenRefresh,
 * CloudTTSProvider, LoginPage). Centralizing them here:
 *   - removes the stringly-typed key duplication (a typo'd 'token' silently
 *     breaks auth), and
 *   - folds in the sentinel-string guard that previously lived only in
 *     apiClient — a token of the literal string "null"/"undefined" (which can
 *     land in storage when `JSON.stringify(null)`-style values are written) is
 *     treated as absent.
 *
 * Keys are intentionally NOT renamed — they are an implicit contract with any
 * already-persisted browser state, so the on-disk names stay 'token' /
 * 'sessionExpired'.
 */

const TOKEN_KEY = 'token';
const SESSION_EXPIRED_KEY = 'sessionExpired';

/** The stored access token, or null if absent/blank/sentinel ("null"/"undefined"). */
export function getToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token || token === 'null' || token === 'undefined') return null;
  return token;
}

/** Persist the access token. */
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** Remove the access token (logout / expiry). */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Flag that the session expired so the next LoginPage render can show the
 * "your session expired" banner. Set by the auth-failure paths in the
 * request layer (apiClient / fetchInterceptor), consumed once by LoginPage.
 */
export function markSessionExpired(): void {
  localStorage.setItem(SESSION_EXPIRED_KEY, 'true');
}

/** Whether the session-expired banner flag is set. */
export function wasSessionExpired(): boolean {
  return localStorage.getItem(SESSION_EXPIRED_KEY) === 'true';
}

/** Clear the session-expired banner flag (consume-once). */
export function clearSessionExpired(): void {
  localStorage.removeItem(SESSION_EXPIRED_KEY);
}
