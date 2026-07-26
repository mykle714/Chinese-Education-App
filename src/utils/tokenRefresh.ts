/**
 * Shared access-token refresh core for the proper refresh-token scheme
 * (server migration 85). Single source of truth so the fetch interceptor, the
 * axios client, and AuthContext all share ONE in-flight refresh — a burst of
 * concurrent 401s triggers exactly one /api/auth/refresh, and everyone awaits it.
 *
 * Flow: POST /api/auth/refresh sends the httpOnly refresh-token cookie; on
 * success the server rotates the refresh cookie and returns a new short-lived
 * access token, which we hold in authStorage's in-memory slot (for the
 * Authorization header) and broadcast to AuthContext via the registered
 * handler. The token is never persisted to disk.
 */
import { API_BASE_URL } from '../constants';
import * as authStorage from './authStorage';

// Capture the native fetch at module-eval time — this runs before
// setupFetchInterceptor() patches window.fetch (that happens in a useEffect),
// so refresh requests are never themselves intercepted (no recursion).
const nativeFetch: typeof fetch = window.fetch.bind(window);

// Set by AuthContext so a refreshed token can flow back into React state.
let onAccessTokenRefreshed: ((token: string) => void) | null = null;

export const setRefreshHandlers = (onRefreshed: (token: string) => void): void => {
  onAccessTokenRefreshed = onRefreshed;
};

// The single shared in-flight refresh promise (null when idle).
let inflight: Promise<string | null> | null = null;

/**
 * Attempt to refresh the access token. Returns the new token on success, or null
 * if the refresh failed (no/expired/revoked refresh cookie) — callers treat null
 * as "session is truly over, redirect to login". Concurrent callers share one
 * request.
 */
export function attemptTokenRefresh(): Promise<string | null> {
  if (!inflight) {
    inflight = doRefresh().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/**
 * End the session on the SERVER: revoke the presented refresh token and clear
 * both auth cookies (POST /api/auth/logout).
 *
 * Every client-side "you are logged out now" path must call this. Clearing only
 * the in-memory access token leaves the httpOnly refresh cookie alive, so the
 * login screen ends up sitting on top of a still-valid session — AuthContext's
 * silent refresh signs the user straight back in, and deleting "/login" from the
 * URL walks into the app. Revoking makes the redirect mean what it says.
 *
 * Uses the captured native fetch so it can never re-enter the interceptor (which
 * is what calls it) and swallows failures — the client-side clear happens
 * regardless.
 */
export async function endServerSession(): Promise<void> {
  try {
    await nativeFetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include', // send the httpOnly refresh cookie so it can be revoked
    });
  } catch {
    // Network error — nothing more we can do client-side.
  } finally {
    authStorage.clearToken();
  }
}

async function doRefresh(): Promise<string | null> {
  try {
    const res = await nativeFetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // send the httpOnly refresh cookie
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const newToken: unknown = data?.token;
    if (typeof newToken === 'string' && newToken.length > 0) {
      authStorage.setToken(newToken);
      onAccessTokenRefreshed?.(newToken);
      return newToken;
    }
    return null;
  } catch {
    // Network error etc. — treat as a failed refresh.
    return null;
  }
}
