import { API_BASE_URL } from "../constants";

/**
 * Client-side interaction-latency telemetry.
 *
 * Purpose: the "buttons take 1–2s before working" lag on the mobile-demo footer
 * and /decks page only reproduces in production, so we cannot profile it
 * locally. This module records *real-user* tap→response latency in prod and
 * ships it to the server (`POST /api/diagnostics/perf`, see server.ts) for
 * offline analysis.
 *
 * What it measures (all via the platform Performance APIs — no polyfills):
 *
 *  - **Event Timing API** (`PerformanceObserver({ type: "event" })`) — the same
 *    data behind the INP / "Interaction to Next Paint" web-vital. For every slow
 *    interaction it reports four timestamps that let us decompose the lag:
 *      • inputDelay   = processingStart − startTime  (main thread was busy BEFORE
 *                       the handler could run — i.e. the tap "did nothing" window)
 *      • processing   = processingEnd  − processingStart (our click handler cost)
 *      • presentation = (startTime+duration) − processingEnd (render/paint cost)
 *      • duration     = whole tap→next-paint span (rounded to 8ms by the browser)
 *    This is exactly the breakdown we need to know whether the stall is the iOS
 *    click delay, our handler, or the post-navigation render burst.
 *
 *  - **Long Tasks** (`PerformanceObserver({ type: "longtask" })`) — any main-
 *    thread block ≥50ms. A wave of these right after a tap is the render-stall
 *    hypothesis made visible.
 *
 *  - **First Input Delay** (`type: "first-input"`) — latency of the very first
 *    interaction on a freshly navigated page.
 *
 *  - **Explicit tap records** (`kind: "tap"`, via `reportTap()`) — the Performance
 *    APIs above can only say an interaction was *slow*; they cannot say a tap was
 *    *ignored*. Game surfaces (Match Speed) call `reportTap` from inside their own
 *    pointerdown handler so we learn both, per tap: how long the tap waited for the
 *    main thread, and what the game actually decided to do with it (including "it
 *    hit a guard and did nothing"). See `reportTap`'s doc comment.
 *
 * Sampling: only interactions/tasks above a noticeable threshold are buffered,
 * so volume stays low. The buffer is flushed with `navigator.sendBeacon` (which
 * survives page navigation/unload) on a size cap, a periodic timer, and on
 * pagehide/visibility-hidden.
 *
 * Safe-by-construction: everything is wrapped in feature-detection + try/catch;
 * if any API is missing the module silently no-ops and never throws into app
 * code. Call `initPerfDiagnostics()` exactly once at startup.
 */

// Only report interactions at/above this whole-duration (ms). 200ms is the
// rough threshold where a tap starts to feel non-instant; the reported lag is
// 1–2s, so this is well below the signal and keeps noise out.
const INTERACTION_REPORT_MS = 200;
// Long tasks shorter than this aren't worth shipping (50ms is the spec floor).
const LONGTASK_REPORT_MS = 80;
// Flush when this many records accumulate, or every FLUSH_INTERVAL_MS.
const BUFFER_FLUSH_SIZE = 20;
const FLUSH_INTERVAL_MS = 10000;

// --- Explicit tap records (reportTap) -------------------------------------
// A tap is only shipped when it is INTERESTING: either the game ignored it, or
// some phase of it crossed this threshold. A speed game produces several taps a
// second and the overwhelming majority are healthy; logging those would drown
// the signal and burn the endpoint's per-IP rate limit for nothing.
const TAP_REPORT_MS = 100;
// Hard ceiling on shipped tap records per rolling minute, so a pathological
// session (or a future caller that forgets the threshold) cannot flood the sink.
const TAP_REPORTS_PER_MIN = 30;

const ENDPOINT = `${API_BASE_URL}/api/diagnostics/perf`;

// One record per interesting performance entry. Kept deliberately flat/small so
// the JSONL the server writes is easy to grep and the beacon payload stays tiny.
interface PerfRecord {
    kind: "interaction" | "longtask" | "first-input" | "tap";
    // Route the entry happened on (helps separate footer vs /decks vs learn).
    path: string;
    // Best-effort description of what was tapped (see describeTarget), or for
    // `tap` records the caller-supplied identifier of the thing tapped.
    target?: string;
    // Event type for interactions ("pointerup" | "click" | "keydown" | …).
    // For `tap` records this is the OUTCOME the handler chose (e.g. "match",
    // "ignored-exiting") — that is what makes a swallowed tap visible.
    name?: string;
    // Whole tap→next-paint span (ms). For longtask this is the block duration.
    duration: number;
    // Event-Timing decomposition (ms); omitted for longtask.
    inputDelay?: number;
    processing?: number;
    presentation?: number;
    // ms since navigation start, so we can see "right after a route change".
    at: number;
}

let buffer: PerfRecord[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

/**
 * Build a short, human-readable description of an interaction's target element,
 * e.g. "div.mobile-footer-item[Home]" or "button.flashcards-decks__mix-button".
 * Uses the descriptive class names the app already applies, plus aria-label /
 * trimmed text as a fallback, so log lines map straight back to the component.
 */
function describeTarget(node: EventTarget | null): string | undefined {
    const el = node as Element | null;
    if (!el || typeof el.tagName !== "string") return undefined;
    try {
        const tag = el.tagName.toLowerCase();
        // First class token is enough to identify our BEM-ish names.
        const cls =
            typeof el.className === "string" && el.className.trim()
                ? "." + el.className.trim().split(/\s+/)[0]
                : "";
        const label =
            el.getAttribute?.("aria-label") ||
            (el.textContent || "").trim().slice(0, 24);
        return `${tag}${cls}${label ? `[${label}]` : ""}`;
    } catch {
        return undefined;
    }
}

function pushRecord(rec: PerfRecord) {
    buffer.push(rec);
    if (buffer.length >= BUFFER_FLUSH_SIZE) flush();
}

// Rolling-window counter backing TAP_REPORTS_PER_MIN.
let tapWindowStart = 0;
let tapsThisWindow = 0;

/**
 * Record one game-surface tap, from inside the surface's own pointerdown handler.
 *
 * WHY THIS EXISTS ALONGSIDE THE Event Timing OBSERVER: Event Timing can only tell
 * us an interaction was slow. It cannot tell us a tap was *ignored* — a tap that a
 * guard clause dropped in 0.1ms looks perfectly healthy to the platform and is
 * indistinguishable from one that never happened. "My tap did nothing" is exactly
 * the report we are chasing in Match Speed, so the game has to say what it decided.
 *
 * The three phases below are the whole diagnosis in one record:
 *   • inputDelay   — `eventTimeStamp` → handler entry. The main thread was busy
 *                    BEFORE this tap could be processed. If this is large, the tap
 *                    was queued behind a render (the "the animation locked me out"
 *                    feeling) rather than blocked by any animation.
 *   • processing   — the handler itself.
 *   • presentation — handler end → the next animation frame, i.e. the React
 *                    re-render + paint the tap triggered. This is what tells us
 *                    whether the tap is what STALLS THE NEXT tap.
 *
 * Ships only when interesting (see TAP_REPORT_MS) and is rate-capped
 * (TAP_REPORTS_PER_MIN). No-ops entirely unless `initPerfDiagnostics()` ran, so
 * this is silent in dev unless `localStorage.perfDiag = "1"` — same gate as the
 * rest of this module (src/main.tsx).
 *
 * Never throws into the caller: a tap handler must not be able to fail because
 * telemetry did.
 *
 * @param outcome         What the handler decided ("match", "ignored-frozen", …).
 * @param target          Identifier of the thing tapped, for grouping.
 * @param eventTimeStamp  The pointer event's `timeStamp` (same time origin as
 *                        `performance.now()` in every browser we support).
 * @param handlerStart    `performance.now()` captured at handler entry.
 */
export function reportTap(
    outcome: string,
    target: string,
    eventTimeStamp: number,
    handlerStart: number
): void {
    if (!started) return;
    try {
        const handlerEnd = performance.now();
        const inputDelay = Math.max(0, Math.round(handlerStart - eventTimeStamp));
        const processing = Math.round(handlerEnd - handlerStart);
        // An "ignored-*" outcome is always worth shipping regardless of timing —
        // that IS the bug report. Everything else must clear the threshold.
        const ignored = outcome.startsWith("ignored");

        // `presentation` is only knowable a frame later, so the record is pushed
        // from the rAF callback rather than here; that also means one dropped
        // frame shows up as a large presentation instead of a missing record.
        const finish = (presentation: number) => {
            if (!ignored && inputDelay < TAP_REPORT_MS && presentation < TAP_REPORT_MS) return;

            // Rate cap, evaluated at push time so cheap uninteresting taps never
            // consume budget.
            const now = Date.now();
            if (now - tapWindowStart > 60000) {
                tapWindowStart = now;
                tapsThisWindow = 0;
            }
            if (tapsThisWindow >= TAP_REPORTS_PER_MIN) return;
            tapsThisWindow++;

            pushRecord({
                kind: "tap",
                path: window.location.pathname,
                target,
                name: outcome,
                duration: inputDelay + processing + presentation,
                inputDelay,
                processing,
                presentation,
                at: Math.round(handlerStart),
            });
        };

        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => finish(Math.round(performance.now() - handlerEnd)));
        } else {
            finish(0);
        }
    } catch {
        /* never throw from telemetry */
    }
}

/**
 * Ship the buffered records and clear the buffer. Uses sendBeacon so the data
 * survives the very navigation/unload that often accompanies a slow tap; falls
 * back to a keepalive fetch where sendBeacon is unavailable. Failures are
 * swallowed — diagnostics must never disrupt the app.
 */
function flush() {
    if (buffer.length === 0) return;
    const payload = {
        sentAt: Date.now(),
        userAgent: navigator.userAgent,
        // Cheap device-capability hints to correlate lag with weak hardware.
        deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
        hardwareConcurrency: navigator.hardwareConcurrency,
        connection: (navigator as unknown as { connection?: { effectiveType?: string } })
            .connection?.effectiveType,
        records: buffer,
    };
    buffer = [];
    try {
        const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
        if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return;
        // Fallback for browsers/contexts where sendBeacon refused the payload.
        void fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            credentials: "include",
            keepalive: true,
        }).catch(() => {});
    } catch {
        /* never throw from telemetry */
    }
}

export function initPerfDiagnostics(): void {
    if (started) return;
    started = true;

    if (typeof PerformanceObserver === "undefined") return;

    const supported: string[] =
        (PerformanceObserver as unknown as { supportedEntryTypes?: string[] })
            .supportedEntryTypes || [];

    try {
        // --- Slow interactions (Event Timing) ---
        if (supported.includes("event")) {
            const obs = new PerformanceObserver((list) => {
                for (const e of list.getEntries()) {
                    const ev = e as PerformanceEventTiming;
                    if (ev.duration < INTERACTION_REPORT_MS) continue;
                    pushRecord({
                        kind: "interaction",
                        path: window.location.pathname,
                        target: describeTarget(ev.target),
                        name: ev.name,
                        duration: Math.round(ev.duration),
                        inputDelay: Math.round(ev.processingStart - ev.startTime),
                        processing: Math.round(ev.processingEnd - ev.processingStart),
                        presentation: Math.round(
                            ev.startTime + ev.duration - ev.processingEnd
                        ),
                        at: Math.round(ev.startTime),
                    });
                }
            });
            // durationThreshold lets the browser pre-filter; clamp to its 16ms min.
            obs.observe({
                type: "event",
                buffered: true,
                durationThreshold: INTERACTION_REPORT_MS,
            } as PerformanceObserverInit);
        }

        // --- First Input Delay ---
        if (supported.includes("first-input")) {
            const obs = new PerformanceObserver((list) => {
                for (const e of list.getEntries()) {
                    const ev = e as PerformanceEventTiming;
                    pushRecord({
                        kind: "first-input",
                        path: window.location.pathname,
                        target: describeTarget(ev.target),
                        name: ev.name,
                        duration: Math.round(ev.duration),
                        inputDelay: Math.round(ev.processingStart - ev.startTime),
                        at: Math.round(ev.startTime),
                    });
                }
            });
            obs.observe({ type: "first-input", buffered: true } as PerformanceObserverInit);
        }

        // --- Long main-thread tasks ---
        if (supported.includes("longtask")) {
            const obs = new PerformanceObserver((list) => {
                for (const e of list.getEntries()) {
                    if (e.duration < LONGTASK_REPORT_MS) continue;
                    pushRecord({
                        kind: "longtask",
                        path: window.location.pathname,
                        duration: Math.round(e.duration),
                        at: Math.round(e.startTime),
                    });
                }
            });
            obs.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
        }
    } catch {
        /* observer setup failed — leave whatever attached and carry on */
    }

    // Periodic flush so records still ship during a long-lived session.
    flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);

    // Guarantee delivery when the tab is backgrounded or torn down. pagehide +
    // visibilitychange(hidden) are the reliable cross-browser unload signals on
    // mobile (the classic "unload"/"beforeunload" often don't fire on iOS).
    const flushOnHide = () => {
        if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushOnHide);
}

// Exposed for tests / manual teardown; the app itself never stops it.
export function stopPerfDiagnostics(): void {
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = null;
    flush();
    started = false;
}
