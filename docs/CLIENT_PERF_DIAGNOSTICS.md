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
