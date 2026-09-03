/**
 * http.ts — the app's single typed HTTP transport, a thin wrapper over the
 * global `fetch`.
 *
 * Why fetch (not axios): the app is overwhelmingly fetch-based (~80 call sites),
 * and the global fetch interceptor installed by AuthContext
 * (utils/fetchInterceptor.ts) already gives EVERY fetch transparent
 * access-token refresh + retry on 401. Because this wrapper calls the patched
 * global `fetch`, it inherits that auth-refresh for free — so we get one auth
 * layer for the whole app instead of the old axios `apiClient` duplicating it.
 *
 * What it adds over raw fetch:
 *   - base-URL prefixing (API_BASE_URL) so callers pass just the path,
 *   - querystring building from a `params` object,
 *   - JSON request/response handling (a FormData body is passed through untouched so
 *     the browser can set its own multipart boundary),
 *   - `credentials: 'include'` (cookie auth) on every request,
 *   - the `Authorization: Bearer` header, read at CALL TIME via authHeader() so a
 *     silent token refresh never changes a caller's function identity (see
 *     utils/authHeader.ts and CLAUDE.md "Never reload on token refresh"),
 *   - throw-on-non-2xx with an ApiError that mirrors axios's `err.response.data`
 *     shape, so the error bodies callers already read keep working.
 *
 * Callers should therefore NOT pass an Authorization header themselves, and should
 * NOT list `token` in the deps of a callback that calls these functions.
 */
import { API_BASE_URL } from '../constants';
import { authHeader } from '../utils/authHeader';

/** Query params; null/undefined values are omitted from the querystring. */
export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  params?: QueryParams;
  /** Extra headers merged over the defaults. */
  headers?: Record<string, string>;
  /** Forwarded to fetch — e.g. an AbortController signal. */
  signal?: AbortSignal;
  /**
   * Forwarded to fetch. Lets a small POST outlive the page that started it, which
   * is the only way a write fired from `pagehide`/`visibilitychange` survives a tab
   * close or a reload. Bodies are capped by the browser (~64KB across all keepalive
   * requests), so use it only for short payloads.
   */
  keepalive?: boolean;
}

/**
 * Thrown on any non-2xx response. `response.data` carries the parsed error body
 * (when JSON) so existing call sites that read `err.response.data.error` /
 * `.code` — the axios shape — keep working unchanged.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly response: { status: number; data: unknown };

  constructor(status: number, data: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.response = { status, data };
  }
}

function buildUrl(path: string, params?: QueryParams): string {
  const url = `${API_BASE_URL}${path}`;
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) qs.append(key, String(value));
  }
  const query = qs.toString();
  return query ? `${url}?${query}` : url;
}

/** Parse a response body as JSON, tolerating empty bodies and non-JSON text. */
async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text; // non-JSON payload (rare) — hand back the raw text
  }
}

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const hasBody = body !== undefined;
  // FormData (file upload) must go over the wire untouched: the browser sets its own
  // multipart Content-Type WITH the boundary parameter, so we must neither stringify
  // the body nor declare a Content-Type ourselves.
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(buildUrl(path, options.params), {
    method,
    credentials: 'include', // cookie-based auth (matches the retired axios client)
    headers: {
      ...(hasBody && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      // Read fresh on every call — never captured in a closure. Returns {} when
      // there is no usable token, in which case the request falls back to the
      // httpOnly access-token cookie that `credentials: 'include'` already sends.
      ...authHeader(),
      ...options.headers,
    },
    body: !hasBody ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
    signal: options.signal,
    keepalive: options.keepalive,
  });

  const data = await parseBody(res);

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed with status ${res.status}`;
    throw new ApiError(res.status, data, message);
  }

  return data as T;
}

export const apiGet = <T>(path: string, options?: RequestOptions): Promise<T> =>
  request<T>('GET', path, undefined, options);

export const apiPost = <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
  request<T>('POST', path, body, options);

export const apiPut = <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
  request<T>('PUT', path, body, options);

export const apiPatch = <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
  request<T>('PATCH', path, body, options);

/**
 * DELETE. Accepts an optional body — a few endpoints require one (e.g.
 * `/api/auth/deleteAccount` takes the confirming password), which is legal HTTP and
 * which `fetch` supports.
 */
export const apiDelete = <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
  request<T>('DELETE', path, body, options);

/**
 * Run an api* call, substituting `fallback` for the generic "Request failed with status N"
 * message that ApiError produces when the error body carries no `error` field.
 *
 * Exists because ~every hand-rolled call site used to spell this out as
 * `throw new Error(data?.error || 'Failed to ...')`. The server's own `error` text always
 * wins; the fallback is only the last resort. See docs/ARCHITECTURE_REVIEW.md finding 5.
 */
export async function withFallback<T>(call: Promise<T>, fallback: string): Promise<T> {
  try {
    return await call;
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    throw new Error(!message || /^Request failed with status/.test(message) ? fallback : message);
  }
}
