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
 * One decoded Server-Sent Event: the `event:` name and its parsed `data:` payload.
 *
 * `data` is `unknown` because SSE is a framing format, not a schema — each caller knows
 * what its own event names carry and narrows accordingly.
 */
export interface SseEvent {
  event: string;
  data: unknown;
}

/**
 * POST a JSON body and consume a `text/event-stream` response.
 *
 * ⚠️ **WHY THIS LIVES HERE RATHER THAN IN THE ONE FEATURE THAT USES IT.**
 * FRONTEND_LAYERING's rule is that every server call goes through this module — not because
 * the helpers are convenient, but because they are where `authHeader()` is read at call
 * time, where `credentials: 'include'` is set, and where `API_BASE_URL` is applied. A
 * feature that reached for a raw `fetch` to get a stream would silently opt out of all
 * three, and the auth one fails in the worst possible way: it works until a token rotates.
 *
 * ⚠️ **A NON-2xx STILL THROWS `ApiError` WITH THE PARSED BODY.** A streaming endpoint has
 * to decide every refusal BEFORE it flushes headers (once they are out the status is 200
 * forever), so the error path here is the ordinary JSON one and callers can read
 * `err.response.data` exactly as they do elsewhere.
 *
 * ⚠️ **EVENTS ARE DELIVERED BY CALLBACK, NOT AS A PROMISE OF THE WHOLE STREAM.** Buffering
 * to an array would work and would throw away the only reason to stream. The returned
 * promise resolves when the stream ENDS.
 *
 * Not built on `EventSource`: that is GET-only and cannot send a JSON body or an
 * Authorization header.
 */
export async function apiPostStream(
  path: string,
  body: unknown,
  onEvent: (event: SseEvent) => void,
  options: RequestOptions = {}
): Promise<void> {
  const res = await fetch(buildUrl(path, options.params), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...authHeader(),
      ...options.headers,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok || !res.body) {
    const data = await parseBody(res);
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed with status ${res.status}`;
    throw new ApiError(res.status, data, message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // SSE frames are separated by a blank line, and a chunk can split one anywhere — including
  // mid-UTF-8, which `{ stream: true }` handles. Everything up to the last blank line is
  // complete; whatever follows stays buffered for the next chunk.
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split: number;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const decoded = decodeSseFrame(frame);
        if (decoded) onEvent(decoded);
      }
    }
  } finally {
    // Releasing matters on the abort path: an un-released reader keeps the connection in a
    // state the browser will not reuse.
    reader.releaseLock();
  }
}

/** Decode one SSE frame, or null when it carries no data (a comment or a keep-alive). */
function decodeSseFrame(frame: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue; // comment / keep-alive
    if (line.startsWith('event:')) event = line.slice(6).trim();
    // Per the spec a single leading space after the colon is part of the framing, not data.
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: raw };
  }
}

/**
 * Run an api* call, substituting `fallback` for the generic "Request failed with status N"
 * message that ApiError produces when the error body carries no `error` field.
 *
 * Exists because ~every hand-rolled call site used to spell this out as
 * `throw new Error(data?.error || 'Failed to ...')`. The server's own `error` text always
 * wins; the fallback is only the last resort. See docs/ARCHITECTURE_REVIEW.md finding 5.
 *
 * ⚠️ IT MUST RETHROW AN `ApiError`, NOT A PLAIN `Error`. Until 2026-09-05 this rewrote
 * every failure into `new Error(message)`, which silently discarded `status` and
 * `response.data` — everything in the error body except the one `error` string. Any caller
 * that reads a STRUCTURED error body therefore got nothing, and the symptom was remote from
 * the cause: the iw scene editor's `problemsFromError` reads `response.data.problems`, so a
 * refused save reported the server's one-line summary ("This scene has problems…") and
 * never the per-field list, defeating the whole point of validating every field at once.
 * A `status` check (`err.status === 409`) would have failed the same way.
 *
 * Only the MESSAGE is substituted; the class, status and body are carried through, so
 * `err instanceof Error` and `err.message` behave exactly as before for the callers that
 * only want a string.
 */
export async function withFallback<T>(call: Promise<T>, fallback: string): Promise<T> {
  try {
    return await call;
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    const resolved = !message || /^Request failed with status/.test(message) ? fallback : message;
    if (err instanceof ApiError) {
      throw new ApiError(err.status, err.response.data, resolved);
    }
    throw new Error(resolved);
  }
}
