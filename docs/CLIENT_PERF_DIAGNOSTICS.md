# Client Performance Diagnostics

Real-user interaction-latency telemetry, built to diagnose the **prod-only**
"buttons take 1–2s before working" lag on the mobile-demo footer and `/decks`
page (the lag does not reproduce locally, so synthetic profiling is not enough).

## Layers / components

| Layer | File | Responsibility |
|---|---|---|
| **Client capture** | `src/utils/perfDiagnostics.ts` | Observes the platform Performance APIs, buffers interesting entries, beacons batches to the server. |
| **Client bootstrap** | `src/main.tsx` | Calls `initPerfDiagnostics()` once, gated to production (or `localStorage.perfDiag === "1"`). |
| **Server sink** | `server/server.ts` → `POST /api/diagnostics/perf` | Unauthenticated endpoint; appends each batch to a JSONL log + prints a one-line summary. |
| **Analysis** | `server/scripts/analyze-client-perf.ts` | Read-only aggregator; prints per-route p50/p95 latency breakdowns. |
| **Storage** | `server/logs/client-perf.jsonl` | Append-only JSONL, git-ignored (like `backfill-runs.jsonl`). |

## What is captured

Via three `PerformanceObserver`s (all feature-detected; the module no-ops where
unsupported and never throws into app code):

- **Event Timing** (`type: "event"`, the data behind the INP web-vital) — every
  interaction ≥ `INTERACTION_REPORT_MS` (200ms). Each record decomposes the lag:
  - `inputDelay` = `processingStart − startTime` — main thread busy **before** the
    handler ran (the "tap did nothing" window; iOS click delay + render stalls).
  - `processing` = `processingEnd − processingStart` — the click handler itself.
  - `presentation` = remainder of `duration` — render/paint after the handler
    (e.g. the post-navigation render burst).
  - `duration` = whole tap→next-paint span (browser rounds to 8ms).
- **First Input Delay** (`type: "first-input"`) — latency of the first tap on a
  freshly navigated page.
- **Long Tasks** (`type: "longtask"`) — main-thread blocks ≥ `LONGTASK_REPORT_MS`
  (80ms).

Each record carries the route `path` and a best-effort `target` description
derived from the app's descriptive class names (e.g.
`div.mobile-footer-item[Home]`), so a log line maps back to a component.

Each **batch** additionally carries `userAgent`, `deviceMemory`,
`hardwareConcurrency`, and `connection.effectiveType` to correlate lag with weak
hardware / slow networks.

## Delivery

Records are buffered and flushed via `navigator.sendBeacon` (survives the
navigation/unload that a slow tap often triggers; falls back to `keepalive`
fetch). Flush triggers: buffer reaches `BUFFER_FLUSH_SIZE` (20), a 10s interval,
and `pagehide` / `visibilitychange→hidden`.

## Endpoint contract

`POST /api/diagnostics/perf` — **unauthenticated by design**: `sendBeacon`
cannot attach an `Authorization` header, and the lag also affects public/demo
sessions. Body is `application/json` (parsed by `express.json()`, 100kb cap).
Batches with 0 or >100 records are dropped. Always responds `204` with no body.
It only appends to the JSONL log; it never reads/writes the database.

## Reading the data

From `server/`:

```bash
npx tsx scripts/analyze-client-perf.ts                  # all data
npx tsx scripts/analyze-client-perf.ts --path /flashcards/decks
npx tsx scripts/analyze-client-perf.ts --since 2026-06-13
npx tsx scripts/analyze-client-perf.ts --min 500        # only taps ≥500ms
```

Output groups by `(kind, route)`, sorted by p95 duration, and prints a
"dominant cost" line per interaction route. **Interpretation:**

- `inputDelay` dominates → main thread blocked before the handler: iOS click
  delay and/or a render stall (e.g. the `/decks` cpcd-card render burst). Fixes:
  `touch-action: manipulation`, lighten/defer the destination-page mount.
- `presentation` dominates → the paint after navigation is the cost: virtualize
  / stagger the heavy render.
- `processing` dominates → the click handler itself is slow (not expected here,
  since the footer/decks handlers only call `navigate()`).

## Lifecycle / removal

This is a **diagnostic instrument**, not a permanent feature. Once the lag is
root-caused and fixed, it can be removed (delete the client module + bootstrap
guard, the endpoint, and the script) or left in place behind the
production gate. There is no rate-limiting on the endpoint; if it is kept
long-term, add throttling or a feature flag.

---

# Client Error Reporting (crash sink)

A sibling of the perf pipeline above, on the same `/api/diagnostics/*` family. The
app previously had **no** front-end error capture: an uncaught render or
event-handler throw (e.g. an out-of-range icon-layout index in the flashcard icon
editor, fie) unmounted the React tree into a **blank white screen with nothing
logged anywhere** — so user-reported "crashes" were invisible. This captures them.

## Layers / components

| Layer | File | Responsibility |
|---|---|---|
| **Error boundary** | `src/components/AppErrorBoundary.tsx` | Top-level React boundary; catches render/commit throws in the tree, reports them, and renders a recoverable "Something went wrong / Reload" fallback instead of a blank page. Wraps `<App/>` in `src/main.tsx`. |
| **Global listeners + reporter** | `src/utils/errorReporting.ts` | `initErrorReporting()` attaches `window` `error` + `unhandledrejection` listeners (handler/async throws the boundary can't see). `reportClientError()` scrubs + ships one record. |
| **Client bootstrap** | `src/main.tsx` | Calls `initErrorReporting()` once, **always on** (crashes were invisible in every environment, not just prod — unlike the prod-gated perf init). |
| **Server sink** | `server/server.ts` → `POST /api/diagnostics/error` | Unauthenticated endpoint; appends one scrubbed record per POST to a JSONL log + prints a `💥 client-error …` one-line summary. |
| **Storage** | `dist/logs/client-error.jsonl` (**inside the backend container**) | Append-only JSONL via `path.join(__dirname, 'logs', …)`. **Container-local and ephemeral** — a rebuild/`down` wipes it; read it between deploys. |

## What is captured

One record per error, from three sources (all funnelled through
`reportClientError`, every path wrapped in try/catch — reporting never throws or
recurses):

- **`react`** — render-phase throws caught by `AppErrorBoundary.componentDidCatch`
  (carries a `componentStack`).
- **`window-error`** — uncaught runtime errors incl. event-handler throws.
- **`unhandledrejection`** — async / promise rejections.

Each record: `kind`, `message`, `stack`, `componentStack?` (react only), `path`
(route), `userAgent`, `at` (client ts); the server adds `receivedAt` + `ip`.

**Guardrails (client):** capped at `MAX_REPORTS_PER_SESSION = 25`; identical
`kind|message` signatures deduped within `DEDUPE_WINDOW_MS = 5000` (React can fire
the same throw several times during a failed render). Shipped via `keepalive`
fetch (falls back to `sendBeacon`) so a report survives the crash-induced unload.

## Privacy / scrubbing

Error text can contain secrets and PII (a token baked into a URL, a `Bearer`
header echoed in a message). `scrub()` redacts before anything leaves the browser:
`Bearer <token>` → `Bearer [redacted]`, bare JWTs (`eyJ…`) → `[jwt]`, and
`?token=` / `access_token` / `refresh_token` query params → `[redacted]`. The
server additionally caps field lengths. **Keep any new fields scrubbed.**

## Endpoint contract

`POST /api/diagnostics/error` — **unauthenticated by design** (a crash can happen
before/around auth, and the client posts via keepalive fetch / `sendBeacon` with no
`Authorization` header). Body is `application/json`; a record with no `message` is
dropped. `message`/`stack`/`componentStack`/`path`/`userAgent` are length-capped.
Always responds `204`; only appends to the JSONL log, never touches the database.

## Reading the data

```bash
# the live log (container-local; grab it BEFORE any rebuild — a rebuild wipes it)
docker exec cow-backend-prod cat dist/logs/client-error.jsonl
# real crashes only (filter out manual SMOKE/TEST lines)
docker exec cow-backend-prod cat dist/logs/client-error.jsonl | grep -iv 'test'
# one-line summaries in the container console log
docker logs cow-backend-prod 2>&1 | grep '💥 client-error'
```
