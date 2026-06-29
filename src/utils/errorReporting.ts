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

export type ClientErrorKind = "react" | "window-error" | "unhandledrejection";

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

/**
 * Attach global listeners for errors the React boundary can't catch (event
 * handlers, async rejections, resource/runtime errors). Call once at startup.
 */
export function initErrorReporting(): void {
    if (started) return;
    started = true;

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
