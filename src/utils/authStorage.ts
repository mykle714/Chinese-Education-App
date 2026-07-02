/**
 * authStorage — the single owner of client-side auth state.
 *
 * ACCESS TOKEN IS IN-MEMORY ONLY. It was previously persisted to
 * localStorage['token'], which let any XSS payload exfiltrate a live
 * credential from disk. The server also sets the token as an httpOnly cookie
 * (invisible to JS) on every login/refresh, and every request already sends
 * `credentials: 'include'`, so the JS-visible copy exists only to populate the
 * Authorization header some call sites still attach — it never needs to
 * survive a reload:
 *
 *   - Page reload → getToken() is null → AuthContext's checkAuth falls through
 *     to attemptTokenRefresh(), which uses the httpOnly REFRESH cookie to mint
 *     a fresh access token into memory. (This "no stored token" path predates
 *     this change — it used to handle manual localStorage clears.)
 *   - New tab → same silent-refresh path. Concurrent refreshes across tabs are
 *     covered by the server's 20s rotation-race grace window (UserService).
 *
 * The consumer-facing API (getToken/setToken/clearToken) is unchanged, so
 * AuthContext, tokenRefresh, fetchInterceptor, and CloudTTSProvider work
 * without modification.
 *
 * The post-logout banner flag (`sessionExpired`) stays in localStorage — it is
 * not sensitive and must survive the redirect-to-login navigation.
 */

const SESSION_EXPIRED_KEY = 'sessionExpired';
const LEGACY_TOKEN_KEY = 'token';

// One-time cleanup: purge any access token persisted by previous app versions
// so stale credentials don't linger on disk after this deploy.
try {
  localStorage.removeItem(LEGACY_TOKEN_KEY);
} catch {
  // Storage unavailable (private mode / SSR) — nothing persisted to clean.
}

/** The current access token, held in module memory only. */
let inMemoryToken: string | null = null;

/** The in-memory access token, or null if absent/blank/sentinel ("null"/"undefined"). */
export function getToken(): string | null {
  const token = inMemoryToken;
  if (!token || token === 'null' || token === 'undefined') return null;
  return token;
}

/** Hold the access token for this tab's lifetime (never persisted). */
export function setToken(token: string): void {
  inMemoryToken = token;
}

/** Drop the access token (logout / expiry). */
export function clearToken(): void {
  inMemoryToken = null;
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
