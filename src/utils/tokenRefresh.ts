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
import { authLog, authError, tokenPreview } from './authDebug';
import { getBrowserTimezone } from './browserTimezone';

// The unpatched fetch, captured at MODULE-EVAL time.
//
// Why capture it: setupFetchInterceptor() replaces window.fetch (from a useEffect)
// so every request gets transparent refresh-and-retry on a 401. The refresh request
// itself must NOT go through that — a failing refresh would re-enter the
// interceptor, which would await the very in-flight promise it is trying to
// resolve, and hang. Module eval runs before any useEffect, so this binding is
// always the original.
//
// The `typeof window` guard is what makes this module importable without a DOM.
// It used to be a bare `window.fetch.bind(window)`, which threw
// `ReferenceError: window is not defined` the moment ANY module in this import
// subtree was loaded by a Node test runner — that is why the route registry could
// not be unit-tested. The guard keeps the eager capture (so the no-recursion
// guarantee is unchanged) and simply falls back to the global fetch off-DOM.
const nativeFetch: typeof fetch =
  typeof window !== 'undefined'
    ? window.fetch.bind(window)
    : globalThis.fetch.bind(globalThis);

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
  // Log the caller: a session ending unexpectedly is almost always someone
  // calling this at the wrong moment, and the stack names them.
  authLog('endServerSession: revoking refresh token', {
    calledFrom: new Error().stack?.split('\n').slice(2, 5).join(' | '),
  });
  try {
    await nativeFetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include', // send the httpOnly refresh cookie so it can be revoked
    });
  } catch (e) {
    // Network error — nothing more we can do client-side.
    authError('endServerSession: logout request failed', e);
  } finally {
    authStorage.clearToken();
  }
}

async function doRefresh(): Promise<string | null> {
  try {
    const res = await nativeFetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // send the httpOnly refresh cookie
      headers: { 'Content-Type': 'application/json' },
      // Piggyback the browser's timezone on the ~15-minute rotation. This is the
      // app's only heartbeat for a logged-in client, so it is the cheapest way to
      // keep `users.timezone` fresh — and the only trigger that catches a zone
      // changing MID-session (travel, an OS clock fix). The server treats it as
      // best-effort: a failed tz write never fails the rotation.
      // See utils/authSync.ts for the full freshness contract.
      body: JSON.stringify({ tz: getBrowserTimezone() }),
    });

    if (!res.ok) {
      // 401 here = no/expired/revoked refresh cookie (or reuse detected, which
      // revokes the whole family). 429 = refreshLimiter. Both surface as "you got
      // logged out", so distinguishing them matters.
      authError('refresh: FAILED', {
        status: res.status,
        retryAfter: res.headers.get('retry-after'),
      });
      return null;
    }

    const data = await res.json();
    const newToken: unknown = data?.token;
    if (typeof newToken === 'string' && newToken.length > 0) {
      authLog('refresh: OK', { token: tokenPreview(newToken) });
      authStorage.setToken(newToken);
      onAccessTokenRefreshed?.(newToken);
      return newToken;
    }
    authError('refresh: 200 but no token in payload');
    return null;
  } catch (e) {
    // Network error etc. — treat as a failed refresh.
    authError('refresh: network error', e);
    return null;
  }
}
