import { attemptTokenRefresh, endServerSession } from './tokenRefresh';
import * as authStorage from './authStorage';
import { authLog, authError } from './authDebug';

// Store navigation and auth clearing functions
let navigateToLogin: (() => void) | null = null;
let clearAuthState: (() => void) | null = null;

// Function to set handlers from AuthContext
export const setFetchInterceptorHandlers = (
  navigate: () => void,
  clearAuth: () => void
) => {
  navigateToLogin = navigate;
  clearAuthState = clearAuth;
};

/**
 * Endpoints that must NOT trigger an auto-refresh on 401:
 *   - login / register / logout: a 401 here is a real credential failure, not an
 *     expired session.
 *   - refresh: refreshing in response to a failed refresh would recurse.
 * Note /api/auth/me is intentionally NOT excluded — a 401 there (expired access
 * token on app load) SHOULD attempt a refresh so a reload keeps the user logged in.
 */
const NO_REFRESH_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/refresh',
];

/**
 * Only 401 means "your session is not valid" — it is the sole status
 * authenticateToken (server/authMiddleware.ts) returns for a missing/expired/
 * invalid token. 403 means the OPPOSITE: the server authenticated you fine and
 * is refusing this particular resource (e.g. GET /api/texts/:id for another
 * user's document, TextController.ts). Treating 403 as expiry logged a
 * perfectly valid session out — the user experienced it as the app "crashing"
 * to the login screen.
 */
const isUnauthorized = (status: number) => status === 401;

/**
 * Re-run the original request once with a freshly refreshed access token,
 * bypassing this interceptor (we call the captured native fetch, not the patched
 * window.fetch, so there is no recursion). We rewrite the Authorization header
 * because authMiddleware prefers the header over the cookie — a stale header
 * would otherwise override the fresh access-token cookie and 401 again.
 */
async function retryWithToken(
  originalFetch: typeof fetch,
  args: Parameters<typeof fetch>,
  newToken: string
): Promise<Response> {
  const [input, init] = args;

  // Build a Headers from whatever the original request carried.
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  );
  headers.set('Authorization', `Bearer ${newToken}`);

  return originalFetch(input, { ...init, headers, credentials: 'include' });
}

/**
 * Marker branded onto the patched fetch so we can recognise our own handiwork.
 *
 * The guard MUST live on the function object, not in a module-level `let`.
 * setupFetchInterceptor() is called from a useEffect with no cleanup, and it gets
 * re-invoked in two ways: React StrictMode (src/main.tsx) double-mounts in dev,
 * and — far worse — Vite HMR re-evaluates this module on every edit, which resets
 * any module-level flag while window.fetch stays patched from the previous
 * generation. Each re-invocation then captured an ALREADY-PATCHED window.fetch as
 * its "original", stacking interceptors. Observed in the wild: 21 nested layers
 * after a debugging session, so one 401 ran the refresh/retry/end-session logic
 * 21 times over. A symbol on the function survives both StrictMode and HMR.
 */
const INTERCEPTOR_MARK = Symbol.for('cow.fetchInterceptor.installed');

type MarkedFetch = typeof fetch & { [INTERCEPTOR_MARK]?: true };

// Setup global fetch interceptor
export const setupFetchInterceptor = () => {
  if ((window.fetch as MarkedFetch)[INTERCEPTOR_MARK]) {
    authLog('interceptor: already installed on window.fetch, skipping re-patch');
    return;
  }

  // Store the original (genuinely unpatched) fetch
  const originalFetch = window.fetch;

  // Override the global fetch
  const patched: MarkedFetch = async (...args): Promise<Response> => {
    // Call the original fetch — network errors propagate naturally
    const response = await originalFetch(...args);

    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
    const skipRefresh = NO_REFRESH_PATHS.some((p) => url.includes(p));

    // On an auth failure for a refreshable endpoint, try to transparently refresh
    // the access token and retry the original request once before giving up.
    if (!skipRefresh && isUnauthorized(response.status)) {
      authLog('interceptor: 401 — attempting refresh + retry', { url });
      const newToken = await attemptTokenRefresh();

      if (newToken) {
        const retried = await retryWithToken(originalFetch, args, newToken);
        // If the retry now succeeds, the caller never sees the 401.
        if (!isUnauthorized(retried.status)) {
          authLog('interceptor: retry succeeded after refresh', { url, status: retried.status });
          return retried;
        }
        // Still unauthorized after a fresh token => fall through to logout.
        authError('interceptor: retry STILL 401 after a fresh token', { url });
      }

      // Refresh failed (or retry still unauthorized): the session is truly over.
      // This is the single most important line to look for when the app "crashes"
      // to the login screen — `url` names the request that ended the session.
      authError('interceptor: ENDING SESSION and redirecting to /login', {
        url,
        refreshSucceeded: !!newToken,
      });

      // Kill it server-side FIRST. A refresh cookie that outlives this redirect
      // leaves the login screen sitting on a live session, which AuthContext's
      // silent refresh immediately restores (see endServerSession).
      await endServerSession();

      if (clearAuthState) {
        clearAuthState();
      }
      authStorage.clearToken();
      // Flag for LoginPage to show the "session expired" notice.
      authStorage.markSessionExpired();
      if (navigateToLogin) {
        navigateToLogin();
      }
    }

    return response;
  };

  patched[INTERCEPTOR_MARK] = true;
  window.fetch = patched;
  authLog('interceptor: installed');
};
