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
 *   - JSON request/response handling,
 *   - `credentials: 'include'` (cookie auth) on every request,
 *   - throw-on-non-2xx with an ApiError that mirrors axios's `err.response.data`
 *     shape, so the error bodies callers already read keep working.
 */
import { API_BASE_URL } from '../constants';

/** Query params; null/undefined values are omitted from the querystring. */
export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  params?: QueryParams;
  /** Extra headers merged over the defaults. */
  headers?: Record<string, string>;
  /** Forwarded to fetch — e.g. an AbortController signal. */
  signal?: AbortSignal;
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
  const res = await fetch(buildUrl(path, options.params), {
    method,
    credentials: 'include', // cookie-based auth (matches the retired axios client)
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    body: hasBody ? JSON.stringify(body) : undefined,
    signal: options.signal,
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

export const apiDelete = <T>(path: string, options?: RequestOptions): Promise<T> =>
  request<T>('DELETE', path, undefined, options);
