/**
 * httpStream.test.ts — `apiPostStream`'s SSE decoding.
 *
 * WHY THIS IS TESTED AND THE OTHER HELPERS ARE NOT. `apiGet`/`apiPost` are a thin wrapper
 * over `fetch` with nothing to get wrong; this one contains a real parser, and its failure
 * mode is the one that never shows up in a happy-path manual test: a frame split across two
 * network chunks. The transport chunks wherever it likes, so the cases below deliberately
 * split frames mid-field, mid-JSON and mid-UTF-8.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiPostStream, ApiError, type SseEvent } from '../http';

const encoder = new TextEncoder();

/** A fake `fetch` whose body streams exactly the byte chunks given. */
function respondWith(chunks: Array<string | Uint8Array>, ok = true, status = 200): void {
  const body = {
    getReader() {
      let i = 0;
      return {
        async read() {
          if (i >= chunks.length) return { done: true, value: undefined };
          const chunk = chunks[i++];
          return { done: false, value: typeof chunk === 'string' ? encoder.encode(chunk) : chunk };
        },
        releaseLock() {},
      };
    },
  };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status, body, text: async () => '' })));
}

/** Collect every event a stream produces. */
async function collect(chunks: Array<string | Uint8Array>): Promise<SseEvent[]> {
  respondWith(chunks);
  const seen: SseEvent[] = [];
  await apiPostStream('/api/test', {}, e => seen.push(e));
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe('apiPostStream — framing', () => {
  it('decodes one whole frame', async () => {
    const seen = await collect(['event: delta\ndata: {"say":"好"}\n\n']);
    expect(seen).toEqual([{ event: 'delta', data: { say: '好' } }]);
  });

  it('decodes several frames in one chunk', async () => {
    const seen = await collect([
      'event: delta\ndata: {"n":1}\n\nevent: delta\ndata: {"n":2}\n\nevent: end\ndata: {}\n\n',
    ]);
    expect(seen.map(e => e.event)).toEqual(['delta', 'delta', 'end']);
  });

  it('reassembles a frame split ACROSS chunks', async () => {
    // The case that never reproduces by hand and always happens on a real network.
    const seen = await collect(['event: del', 'ta\ndata: {"say":"好', '的"}\n', '\n']);
    expect(seen).toEqual([{ event: 'delta', data: { say: '好的' } }]);
  });

  it('reassembles a multi-byte character split mid-UTF-8', async () => {
    // Every NPC line is CJK, so a 3-byte character straddling a chunk boundary is the
    // normal case rather than an edge one. Without a streaming decoder this yields U+FFFD.
    const bytes = encoder.encode('event: delta\ndata: {"say":"好"}\n\n');
    const cut = bytes.indexOf(0xe5) + 1; // inside 好's three bytes
    const seen = await collect([bytes.slice(0, cut), bytes.slice(cut)]);
    expect(seen).toEqual([{ event: 'delta', data: { say: '好' } }]);
  });

  it('leaves an unterminated trailing frame undelivered', async () => {
    // A half-arrived frame is not an event. Delivering it would hand the caller a truncated
    // JSON payload, which is worse than nothing.
    expect(await collect(['event: delta\ndata: {"say":"好"}'])).toEqual([]);
  });
});

describe('apiPostStream — fields', () => {
  it('defaults a frame with no event name to "message"', async () => {
    const seen = await collect(['data: {"n":1}\n\n']);
    expect(seen[0].event).toBe('message');
  });

  it('ignores comment / keep-alive lines', async () => {
    // Proxies inject these to hold a connection open; treating one as an event would deliver
    // a spurious turn result.
    expect(await collect([': keep-alive\n\n'])).toEqual([]);
  });

  it('joins multi-line data with newlines', async () => {
    const seen = await collect(['data: line one\ndata: line two\n\n']);
    expect(seen[0].data).toBe('line one\nline two');
  });

  it('hands back raw text when the payload is not JSON', async () => {
    expect((await collect(['event: note\ndata: hello\n\n']))[0].data).toBe('hello');
  });

  it('strips exactly one space after the colon, not the payload\'s own', async () => {
    // Per the SSE spec a single leading space is framing. A second one is data.
    expect((await collect(['data:  padded\n\n']))[0].data).toBe(' padded');
  });
});

describe('apiPostStream — failures', () => {
  it('throws ApiError with the parsed body on a non-2xx', async () => {
    // A streaming endpoint must decide every refusal BEFORE flushing headers, so the error
    // path is the ordinary JSON one and callers read err.response.data as they do elsewhere.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      body: null,
      text: async () => JSON.stringify({ error: 'Slow down a moment.', refusal: { code: 'too-fast' } }),
    })));
    await expect(apiPostStream('/api/test', {}, () => {})).rejects.toMatchObject({
      status: 429,
      message: 'Slow down a moment.',
      response: { data: { refusal: { code: 'too-fast' } } },
    });
    await expect(apiPostStream('/api/test', {}, () => {})).rejects.toBeInstanceOf(ApiError);
  });

  it('asks for an event stream and sends JSON', async () => {
    respondWith(['data: {}\n\n']);
    await apiPostStream('/api/test', { a: 1 }, () => {});
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } };
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Accept).toBe('text/event-stream');
    expect(init.body).toBe('{"a":1}');
    // Cookie auth, same as every other call in this module — a raw fetch in a feature would
    // silently drop this.
    expect(init.credentials).toBe('include');
  });
});
