// Tests for src/api/http.ts's quiet retry and connection signal
// (docs/NOTIFICATIONS.md § 3a "Failures", docs/FRONTEND_LAYERING.md § 3).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// authHeader reads a stored token; the transport only needs it to return headers.
vi.mock("../utils/authHeader", () => ({ authHeader: () => ({}) }));

import { apiGet, apiPost, ApiError, CONNECTION_EVENT } from "../api/http";

const ok = (body: unknown = { ok: true }) => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number) => new Response(JSON.stringify({ error: `status ${code}` }), { status: code });

let fetchMock: ReturnType<typeof vi.fn>;
let connectionEvents: boolean[];

beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    connectionEvents = [];
    // The node test environment has no window; give http.ts a minimal event target.
    const target = new EventTarget();
    target.addEventListener(CONNECTION_EVENT, (e) => connectionEvents.push((e as CustomEvent).detail.lost));
    vi.stubGlobal("window", target);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

/** Run a request to completion, advancing the retry waits. */
async function settle<T>(p: Promise<T>): Promise<T> {
    const result = p.then((v) => ({ v }), (e) => ({ e }));
    await vi.runAllTimersAsync();
    const r = await result;
    if ("e" in r) throw r.e;
    return r.v;
}

describe("quiet retry", () => {
    it("retries a GET through a network error and a 503", async () => {
        fetchMock
            .mockRejectedValueOnce(new TypeError("Failed to fetch"))
            .mockResolvedValueOnce(status(503))
            .mockResolvedValueOnce(ok({ n: 1 }));
        await expect(settle(apiGet("/x"))).resolves.toEqual({ n: 1 });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("never retries a 4xx or a 500", async () => {
        fetchMock.mockResolvedValueOnce(status(400));
        await expect(settle(apiGet("/x"))).rejects.toBeInstanceOf(ApiError);
        fetchMock.mockResolvedValueOnce(status(500));
        await expect(settle(apiGet("/x"))).rejects.toBeInstanceOf(ApiError);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not retry a write unless it opts in", async () => {
        fetchMock.mockResolvedValue(status(502));
        await expect(settle(apiPost("/mark", {}))).rejects.toBeInstanceOf(ApiError);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        fetchMock.mockReset();
        fetchMock.mockResolvedValueOnce(status(502)).mockResolvedValueOnce(ok());
        await expect(settle(apiPost("/focus", {}, { retry: true }))).resolves.toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("gives up after three attempts and returns the last failure", async () => {
        fetchMock.mockResolvedValue(status(504));
        const err = await settle(apiGet("/x")).catch((e) => e);
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(504);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("never retries an aborted request", async () => {
        const controller = new AbortController();
        controller.abort();
        fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
        await expect(settle(apiGet("/x", { signal: controller.signal }))).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe("connection signal", () => {
    it("reports lost after the retries fail at the network level, and restored at the next response", async () => {
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
        await expect(settle(apiGet("/x"))).rejects.toBeInstanceOf(TypeError);
        expect(connectionEvents).toEqual([true]);

        fetchMock.mockReset();
        fetchMock.mockResolvedValueOnce(status(404)); // any response proves reachability
        await expect(settle(apiGet("/x"))).rejects.toBeInstanceOf(ApiError);
        expect(connectionEvents).toEqual([true, false]);
    });
});
