/**
 * Auth-path tracing.
 *
 * LAYER: client utility (no React, no network) — importable from AuthContext,
 * the fetch interceptor, the refresh core, and LoginPage alike.
 *
 * Why this exists: the auth path is spread across four modules that mutate each
 * other's state asynchronously (LoginPage -> AuthContext.login -> checkAuth
 * effect -> fetchInterceptor -> tokenRefresh), so a failed login is almost never
 * explained by a single stack trace. Every step logs one line with a stable
 * `[auth]` prefix and a monotonic ms clock, so the console reads as an ordered
 * story: which request fired, what the server said, and who cleared the session.
 *
 * Filter the console with `[auth]` to isolate it.
 *
 * NEVER pass a password (or a full token) into these calls — use tokenPreview().
 *
 * Referenced by: src/AuthContext.tsx, src/pages/LoginPage.tsx,
 * src/utils/fetchInterceptor.ts, src/utils/tokenRefresh.ts,
 * docs/TOKEN_EXPIRATION_IMPLEMENTATION.md.
 */

// Page-load-relative clock: absolute wall times make it hard to see that (say)
// a session-clear landed 40ms AFTER the login response.
const t0 = performance.now();
const stamp = () => `+${Math.round(performance.now() - t0)}ms`;

/**
 * Runtime kill switch. On by default so a user hitting the bug just has to open
 * the console; set `localStorage.authDebug = 'off'` to silence it.
 */
const enabled = () => localStorage.getItem('authDebug') !== 'off';

/** One traced auth event. `detail` is any serializable context object. */
export function authLog(event: string, detail?: unknown): void {
  if (!enabled()) return;
  if (detail === undefined) {
    console.log(`[auth ${stamp()}] ${event}`);
  } else {
    console.log(`[auth ${stamp()}] ${event}`, detail);
  }
}

/** Same, but rendered as a console error so it survives a "Errors only" filter. */
export function authError(event: string, detail?: unknown): void {
  if (!enabled()) return;
  console.error(`[auth ${stamp()}] ${event}`, detail);
}

/**
 * Safe token summary for logging — length plus first/last 4 chars. Enough to see
 * "the token changed" or "the token is byte-identical to the last one" (which
 * matters: two logins in the same second can mint an identical JWT, and React
 * then bails out of the setToken re-render) without printing a usable credential.
 */
export function tokenPreview(token: string | null | undefined): string {
  if (!token) return String(token);
  if (token.length <= 12) return `len=${token.length} <short>`;
  return `len=${token.length} ${token.slice(0, 4)}…${token.slice(-4)}`;
}

/**
 * Read a response body without ever throwing, and report what shape it was.
 * The auth paths used to do a bare `await response.json()` on the error branch;
 * a non-JSON error body (an nginx HTML 502, an empty 429) made that throw, so the
 * user saw a JSON parse error instead of the server's actual complaint.
 */
export async function readBodySafely(
  response: Response
): Promise<{ json: Record<string, unknown> | null; text: string }> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return { json: null, text: '<unreadable body>' };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return {
      json: typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null,
      text,
    };
  } catch {
    return { json: null, text };
  }
}

/** Rate-limit headers (draft-8), so "logins don't work" can be identified as a 429 budget. */
export function rateLimitInfo(response: Response): Record<string, string | null> {
  return {
    status: String(response.status),
    ratelimit: response.headers.get('ratelimit'),
    retryAfter: response.headers.get('retry-after'),
  };
}
