import { attemptTokenRefresh } from './tokenRefresh';

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

const isUnauthorized = (status: number) => status === 401 || status === 403;

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

// Setup global fetch interceptor
export const setupFetchInterceptor = () => {
  // Store the original fetch
  const originalFetch = window.fetch;

  // Override the global fetch
  window.fetch = async (...args): Promise<Response> => {
    // Call the original fetch — network errors propagate naturally
    const response = await originalFetch(...args);

    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
    const skipRefresh = NO_REFRESH_PATHS.some((p) => url.includes(p));

    // On an auth failure for a refreshable endpoint, try to transparently refresh
    // the access token and retry the original request once before giving up.
    if (!skipRefresh && isUnauthorized(response.status)) {
      const newToken = await attemptTokenRefresh();

      if (newToken) {
        const retried = await retryWithToken(originalFetch, args, newToken);
        // If the retry now succeeds, the caller never sees the 401.
        if (!isUnauthorized(retried.status)) {
          return retried;
        }
        // Still unauthorized after a fresh token => fall through to logout.
      }

      // Refresh failed (or retry still unauthorized): the session is truly over.
      console.log('Session expired and refresh failed — redirecting to login...');

      if (clearAuthState) {
        clearAuthState();
      }
      localStorage.removeItem('token');
      // Flag for LoginPage to show the "session expired" notice.
      localStorage.setItem('sessionExpired', 'true');
      if (navigateToLogin) {
        navigateToLogin();
      }
    }

    return response;
  };
};
