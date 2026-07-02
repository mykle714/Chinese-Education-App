import { API_BASE_URL } from "../constants";

/**
 * Client-side crash/error reporting.
 *
 * Purpose: the app has NO other front-end error capture. An uncaught render or
 * event-handler throw (e.g. in the flashcard icon editor) unmounts the React
 * tree into a blank white screen with nothing logged anywhere, so crashes the
 * user reports are otherwise invisible. This module ships a *scrubbed* error
 * record to the server (`POST /api/diagnostics/error`, see server.ts) for
 * offline analysis, mirroring the perf-diagnostics pipeline.
 *
 * Sources of errors, all funnelled through `reportClientError`:
 *   - the React error boundary (render-phase throws) — see AppErrorBoundary.tsx
 *   - `window` "error" events (uncaught runtime errors, incl. event handlers)
 *   - `window` "unhandledrejection" events (async/promise rejections)
 *
 * Safe-by-construction: every path is wrapped in try/catch and failures are
 * swallowed — reporting must never disrupt the app or throw recursively.
 *
 * PRIVACY: error text can contain secrets (a token baked into a URL, a Bearer
 * header echoed in an error message) and user content. `scrub()` strips bearer
 * tokens, JWTs, and token query params before anything leaves the browser. Keep
 * new fields scrubbed.
 */

const ENDPOINT = `${API_BASE_URL}/api/diagnostics/error`;

// Hard caps so a tight error loop can't flood the network / server log.
const MAX_REPORTS_PER_SESSION = 25;
// Drop an identical error signature seen again within this window (React in
// particular can fire the same throw several times during a failed render).
const DEDUPE_WINDOW_MS = 5000;

let reportCount = 0;
let started = false;
// signature -> last-sent timestamp, for short-window dedupe.
const recentSignatures = new Map<string, number>();

export type ClientErrorKind =
    | "react"
    | "window-error"
    | "unhandledrejection"
    // A browser/OS-initiated reload caught mid-flow via the breadcrumb below — NOT
    // a JS exception. See "Reload-surviving breadcrumb" further down.
    | "unexpected-reload";

export interface ClientErrorReport {
    kind: ClientErrorKind;
    message: string;
    stack?: string;
    /** React component stack (boundary only). */
    componentStack?: string;
}

/**
 * Redact secrets from a string before it leaves the browser:
 *   - `Bearer <token>`            -> `Bearer [redacted]`
 *   - bare JWTs (eyJ… . … . …)    -> `[jwt]`
 *   - `?token=…` / `access_token` / `refresh_token` query params -> `[redacted]`
 * Best-effort and conservative; never throws (returns the input on failure).
 */
function scrub(input: string | undefined): string | undefined {
    if (!input) return input;
    try {
        return input
            .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
            .replace(/eyJ[A-Za-z0-9._-]{8,}/g, "[jwt]")
            .replace(
                /([?&](?:token|access_token|refresh_token)=)[^&\s"'#]+/gi,
                "$1[redacted]"
            );
    } catch {
        return input;
    }
}

/**
 * Ship one scrubbed error record. Deduped within a short window and capped per
 * session. Uses keepalive fetch (then sendBeacon) so a report still flushes even
 * if the crash is followed by a navigation/unload. Never throws.
 */
export function reportClientError(report: ClientErrorReport): void {
    try {
        if (reportCount >= MAX_REPORTS_PER_SESSION) return;

        // Dedupe identical signatures fired in quick succession.
        const signature = `${report.kind}|${report.message}`;
        const now = Date.now();
        const last = recentSignatures.get(signature);
        if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return;
        recentSignatures.set(signature, now);
        reportCount += 1;

        const payload = {
            kind: report.kind,
            message: scrub(report.message) ?? "(no message)",
            stack: scrub(report.stack),
            componentStack: scrub(report.componentStack),
            path: window.location.pathname,
            userAgent: navigator.userAgent,
            at: now,
        };

        const body = JSON.stringify(payload);
        // keepalive fetch survives the unload that often follows a crash. Fall
        // back to sendBeacon if fetch is unavailable/refuses.
        void fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            credentials: "include",
            keepalive: true,
        }).catch(() => {
            try {
                const blob = new Blob([body], { type: "application/json" });
                navigator.sendBeacon?.(ENDPOINT, blob);
            } catch {
                /* give up — never throw from reporting */
            }
        });
    } catch {
        /* never throw from error reporting */
    }
}

// ---------------------------------------------------------------------------
// TEMPORARY auth-bootstrap tracer — diagnosing the prod "sort page loads
// forever" report (a SILENT hang: no throw is captured, so the normal error
// pipeline never sees it). Emits ordered breadcrumbs to the same client-error
// sink so we can read exactly which AuthContext bootstrap branch runs and where
// it stops. Isolated from reportClientError (own budget, NO dedupe so loop
// iterations show). NEVER logs token VALUES — only presence/length/HTTP status.
// Remove once the root cause is confirmed and fixed.
// ---------------------------------------------------------------------------
let authTraceCount = 0;
export function reportAuthTrace(message: string): void {
    try {
        if (authTraceCount >= 60) return; // hard cap so a loop can't flood
        authTraceCount += 1;
        const body = JSON.stringify({
            kind: "auth-trace",
            message: `[auth] ${message}`,
            path: window.location.pathname,
            userAgent: navigator.userAgent,
            at: Date.now(),
        });
        void fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            credentials: "include",
            keepalive: true,
        }).catch(() => {
            /* never throw from tracing */
        });
    } catch {
        /* never throw from tracing */
    }
}

// ---------------------------------------------------------------------------
// Reload-surviving breadcrumb (catches OS/browser-initiated reloads)
//
// Some "crashes" are NOT JS exceptions: iOS WebKit can tear down and RELOAD a
// memory-pressured tab outright (e.g. the flashcard icon editor holding up to a
// dozen icon images + the live gesture canvas). That destroys the JS context
// with no throw, so the error boundary and the window listeners above never see
// it — the page just silently reloads. To observe it, a reload-risky flow drops
// a breadcrumb in localStorage on entry and clears it on a CLEAN exit. If we
// boot and still find a recent breadcrumb, the page must have reloaded mid-flow
// without exiting cleanly — we report that as `unexpected-reload`.
// ---------------------------------------------------------------------------

const BREADCRUMB_KEY = "diag:edit-breadcrumb";
// Only treat a leftover breadcrumb as a reload signal if it's recent. A
// reload-then-reboot is near-instant; this generous window still covers a tab
// evicted while backgrounded and reopened minutes later, while ignoring any
// ancient crumb that somehow outlived a clean session.
const BREADCRUMB_TTL_MS = 10 * 60 * 1000;

export interface EditBreadcrumb {
    /** Which reload-risky flow is in progress, e.g. "fie". */
    flow: string;
    /** Sub-phase, so we can tell plain editing apart from the save re-render. */
    phase: string;
    /** Best-effort identifier of what's being edited (e.g. the card key). */
    ref?: string;
}

/** Record that a reload-risky flow is in progress (overwrites any prior crumb). */
export function setEditBreadcrumb(info: EditBreadcrumb): void {
    try {
        localStorage.setItem(
            BREADCRUMB_KEY,
            JSON.stringify({
                ...info,
                ts: Date.now(),
                path: window.location.pathname,
                // Device memory (GB) where exposed — correlates reloads with weak hardware.
                deviceMemory: (navigator as Navigator & { deviceMemory?: number })
                    .deviceMemory,
            })
        );
    } catch {
        /* localStorage can throw (private mode / quota) — never disrupt the flow */
    }
}

/** Clear the breadcrumb on a clean exit (save success, cancel, unmount). */
export function clearEditBreadcrumb(): void {
    try {
        localStorage.removeItem(BREADCRUMB_KEY);
    } catch {
        /* ignore */
    }
}

/**
 * On boot: if a recent breadcrumb is still present, the page reloaded mid-flow
 * without a clean exit (an OS/browser-initiated reload). Report it once, then
 * clear it. Called from initErrorReporting before listeners are attached.
 */
function reportUnexpectedReload(): void {
    try {
        const raw = localStorage.getItem(BREADCRUMB_KEY);
        if (!raw) return;
        localStorage.removeItem(BREADCRUMB_KEY); // consume regardless of outcome
        let crumb: {
            ts?: number;
            flow?: string;
            phase?: string;
            ref?: string;
            path?: string;
            deviceMemory?: number;
        };
        try {
            crumb = JSON.parse(raw);
        } catch {
            return;
        }
        const ts = typeof crumb?.ts === "number" ? crumb.ts : 0;
        const ageMs = Date.now() - ts;
        if (!ts || ageMs > BREADCRUMB_TTL_MS) return; // stale — not a reload signal

        reportClientError({
            kind: "unexpected-reload",
            message: `Unexpected reload during ${crumb.flow ?? "?"} (phase=${crumb.phase ?? "?"})`,
            // An OS reload leaves no JS stack; pack the breadcrumb context into the
            // stack field instead (the only persisted free-form field besides message).
            stack: JSON.stringify({
                flow: crumb.flow,
                phase: crumb.phase,
                ref: crumb.ref,
                path: crumb.path,
                deviceMemory: crumb.deviceMemory,
                ageMs,
            }),
        });
    } catch {
        /* never throw from reporting */
    }
}

/**
 * Attach global listeners for errors the React boundary can't catch (event
 * handlers, async rejections, resource/runtime errors). Call once at startup.
 */
export function initErrorReporting(): void {
    if (started) return;
    started = true;

    // Before anything else, surface a reload that happened mid-flow last session.
    reportUnexpectedReload();

    window.addEventListener("error", (e: ErrorEvent) => {
        // `e.error` carries the stack when available; fall back to the message.
        reportClientError({
            kind: "window-error",
            message: e.message || String(e.error ?? "Unknown error"),
            stack: e.error instanceof Error ? e.error.stack : undefined,
        });
    });

    window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
        const reason = e.reason;
        reportClientError({
            kind: "unhandledrejection",
            message:
                reason instanceof Error
                    ? reason.message
                    : typeof reason === "string"
                      ? reason
                      : "Unhandled promise rejection",
            stack: reason instanceof Error ? reason.stack : undefined,
        });
    });
}
