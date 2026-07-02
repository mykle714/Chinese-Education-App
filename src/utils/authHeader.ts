import * as authStorage from './authStorage';

/**
 * Build the `Authorization` header from the LIVE in-memory access token.
 *
 * Why this exists: the access token silently refreshes every ~15 min, so the
 * `token` value from `useAuth()` changes identity on each refresh. A `useCallback`
 * fetcher that lists `token` in its deps is therefore recreated on every refresh —
 * and any effect that depends on that callback re-runs, reloading data and wiping
 * in-progress UI (see CLAUDE.md "Never reload on token refresh").
 *
 * The fix for such fetchers: read the token at call time via `authHeader()`
 * (authStorage's in-memory slot is kept current by the refresh core), and DROP
 * `token` from the callback's dependency array. The callback identity then stays
 * stable across refreshes while the header it sends is always fresh.
 *
 * Returns `{}` (no header) when there is no usable token, so the request falls
 * back to the httpOnly access-token cookie that every request already sends with
 * `credentials: 'include'`.
 */
export function authHeader(): Record<string, string> {
  const token = authStorage.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
