# Client Performance Diagnostics

Real-user interaction-latency telemetry, built to diagnose the **prod-only**
"buttons take 1–2s before working" lag on the mobile-demo footer and `/decks`
page (the lag does not reproduce locally, so synthetic profiling is not enough).

## Layers / components

| Layer | File | Responsibility |
|---|---|---|
| **Client capture** | `src/utils/perfDiagnostics.ts` | Observes the platform Performance APIs, buffers interesting entries, beacons batches to the server. |
| **Client bootstrap** | `src/main.tsx` | Calls `initPerfDiagnostics()` once, gated to production (or `localStorage.perfDiag === "1"`). |
| **Frame reporter** | `src/features/nightmarket/nmpPerf.ts` → `reportFrameStats()` | Ships each 2s window's mean/worst frame time under the current load label. The only *non*-interaction source — see "Frame records" below. |
| **Server sink** | `server/routes/diagnosticsRoutes.ts` → `POST /api/diagnostics/perf` | Unauthenticated endpoint; appends each batch via the shared writer + prints a one-line summary. |
| **Shared writer** | `server/utils/diagnosticsLog.ts` | `appendDiagnostic(prefix, record)` — resolves the (configurable) log dir, daily-rotates, and sweeps expired files. Used by **both** the perf and error sinks. |
| **Analysis** | `server/scripts/analyze-client-perf.ts` | Read-only aggregator; reads every `client-perf-*.jsonl` (+ legacy single file) and prints per-route p50/p95 latency breakdowns. |
| **Export (prod → dev)** | `server/scripts/export-diagnostics-bundle.ts` | Packages the JSONL for transport to a dev box, **stripping the `ip` field**. There is no cross-machine SSH on this project, so the only transport is a git commit — which makes scrubbing mandatory, not advisory. Driven by `/diagnostics-pull`. |
| **Storage** | `server/logs/client-perf-YYYY-MM-DD.jsonl` (host) | Append-only JSONL, git-ignored. **Persisted + daily-rotated** — see "Persistence & rotation" below. |

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

Plus one source that is **not** a Performance API:

- **Explicit tap records** (`kind: "tap"`, via the exported `reportTap()`) — called
  by a game's own pointer handler. The three observers above can only report that
  an interaction was *slow*; they cannot report that a tap was **ignored**. A tap
  dropped by a guard clause in 0.1ms looks perfectly healthy to Event Timing and
  is indistinguishable from a tap that never happened — so the surface has to say
  what it decided. Each record carries:
  - `name` — the **outcome** the handler chose. Match Speed emits `match`, `miss`,
    `select`, `deselect`, `cleanup-select/clear/deselect`, the three no-ops
    `ignored-frozen`, `ignored-exiting`, `ignored-removed`, and `no-card` (see
    below).
  - `target` — `side:cardId`, or for `no-card` the first class name of whatever
    element absorbed the tap.
  - `inputDelay` — the pointer event's `timeStamp` → handler entry. **Large here
    means the tap was queued behind a render**, not blocked by an animation.
  - `processing` — the handler itself.
  - `presentation` — handler end → next animation frame, i.e. the React re-render
    the tap caused. Large here means *this* tap is what stalls the *next* one.

  **These records are a CENSUS**, unlike every other source on this page: every
  tap on an instrumented surface ships, healthy or not, fast or slow. That is
  deliberate — a rate ("3% of taps were swallowed") needs the denominator, and a
  threshold-filtered log only ever has the numerator. `TAP_REPORTS_PER_MIN` (600)
  is a pure flood backstop, not a sampling knob: a human tapping flat-out with
  two fingers tops out near 360/min, so it never trims real play.

  Because it is a census, **every** tap path in a caller must report — including
  the paths that do nothing, and including taps that reach no card at all. Match
  Speed covers the latter with a board-level fallback that emits `no-card`
  (`handleBoardPointerDown`); without it the taps most likely to be behind "I
  tapped and nothing happened" are invisible, since a missing record is
  indistinguishable from the player simply not tapping.

  Callers: `src/games/match-speed/MatchSpeedBoard.tsx` (`handleTap` for card
  taps, `handleBoardPointerDown` for the rest).
  Rationale + how to read it: docs/MATCH_SPEED_GAME.md § Tap telemetry.

### Frame records (`kind: "frame"` / `"frame-worst"`)

**Added 2026-08-13.** Reported by an animated surface itself via the exported
`reportFrameStats()` (`src/utils/perfDiagnostics.ts`), currently only from the
Night Market's `nmpPerf` probe (`src/features/nightmarket/nmpPerf.ts`).

**Why the other sources cannot cover this.** Everything above is
interaction-triggered. A scene rendering at 8fps with nobody touching it produces
**no records at all** and is indistinguishable from a healthy idle page. Frame
cost has to be volunteered by the renderer.

**Why here, and not a console log.** The Night Market scale question
(`docs/REACT_NATIVE_MIGRATION.md` action item 4a: does it hold at 1,000
pedestrians?) is answered by a *synthetic dev load test*, while the tap-lag
question is answered by *real prod telemetry*. Routing both through this pipeline
means they share one transport, one JSONL shape, and one analyzer — so the two
numbers are comparable rather than merely similarly named.

| Field | Meaning |
|---|---|
| `kind: "frame"` | **Mean** frame time (ms) over one 2s window — throughput |
| `kind: "frame-worst"` | **Longest single frame** (ms) in that window — jank, what a user feels |
| `target` | Surface name (`night-market`) |
| `name` | Load descriptor set by `nmpPerf.load()`, e.g. `peds=1000` — the experiment's x-axis |
| `duration` | The frame time itself, so the existing analyzer's p50/p95/max table works unchanged |

Two kinds rather than one field: the analyzer buckets by `(kind, path)` and takes
percentiles over `duration`, so mean and worst would pool into one meaningless
distribution if they shared a kind.

**Volume:** one pair per 2s window (~1 record/s) — two orders of magnitude under
the tap census.

**Double-gated, and both gates matter:**

| Gate | Where | Effect |
|---|---|---|
| `initPerfDiagnostics()` ran | `src/main.tsx` — prod, or `localStorage.perfDiag = "1"` | Without it `reportFrameStats` is a no-op |
| `nmpPerf` enabled | dev by default; `localStorage.nmpPerf = "1"` in prod | Without it no window is ever reported |

Consequence worth knowing before reading a report: **in ordinary production these
records do not exist**, because `nmpPerf` is off there. They are a *load-test
instrument* that happens to share the prod pipeline, not passive prod telemetry.
To run one, open nmp in dev with `localStorage.perfDiag = "1"`, cycle the
pedestrian-load button in the debug column, and read the result with the same
`analyze-client-perf.ts` invocation used for prod.

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
Batches with 0 or >100 records are dropped. Rate-limited to 60 req/min per IP
(`diagnosticsLimiter` in `server/middleware/rateLimits.ts`; over-limit requests
also get an empty `204` since the beacon never reads the response). Always
responds `204` with no body. It only appends to the JSONL log; it never
reads/writes the database.

## Reading the data

From `server/`:

```bash
npx tsx scripts/analyze-client-perf.ts                  # all data
npx tsx scripts/analyze-client-perf.ts --path /flashcards/decks
npx tsx scripts/analyze-client-perf.ts --since 2026-06-13
npx tsx scripts/analyze-client-perf.ts --min 500        # only taps ≥500ms
```

**Reading prod's data on a dev box:** these are files on the prod host, not a
database table, so `/data-pull`'s `pg_dump` path does not reach them. Use
the dedicated **`/diagnostics-pull`** skill, which runs `export-diagnostics-bundle.ts` on prod
(IP-stripped + gzipped), commits the bundle, and unpacks it into local
`server/logs/` where `analyze-client-perf.ts` picks it up with no flag.

⚠️ That also means **local dev records mix into the same report** — clear or rename
them first, or the prod picture is contaminated with laptop timings.

Output groups by `(kind, route)`, sorted by p95 duration, and prints a
"dominant cost" line per interaction route. **Interpretation:**

- `inputDelay` dominates → main thread blocked before the handler: iOS click
  delay and/or a render stall (e.g. the `/decks` cpcd-card render burst). Fixes:
  `touch-action: manipulation`, lighten/defer the destination-page mount.
- `presentation` dominates → the paint after navigation is the cost: virtualize
  / stagger the heavy render.
- `processing` dominates → the click handler itself is slow (not expected here,
  since the footer/decks handlers only call `navigate()`).

The report ends with a **"Game tap outcomes"** table, grouped by `(route,
outcome)`, for `kind: "tap"` records. This one **is** a census, so its `%`
column (share of that route's taps) is meaningful. Read it as:

- `no-card` rows in volume → taps are **missing the cards entirely**: the gutter
  between cells, an empty slot left by a popped pair, a card that went
  `pointer-events: none` mid-pop, or an overlay sitting above the board. Use the
  `target` class name to tell which. This is a hit-area/layout bug, not a guard bug.
- `ignored-*` rows in volume → a **guard is eating real input**; find which one
  from the outcome name. See the caveat below on what "in volume" means.
- Healthy outcomes (`match`, `select`, …) with a large `inDly p95` → input was
  never blocked; taps are **queued behind a render**. Fix by shrinking the render
  the previous tap triggers (memoize the cells, keep the tap handler
  referentially stable) — see docs/MATCH_SPEED_GAME.md § The other kind of lockout.

⚠️ **A no-op outcome is not automatically a bug.** Every `ignored-*` case is a
deliberate rule (`ignored-frozen` = the pre-run countdown; `ignored-exiting` /
`ignored-removed` = the second finger of a two-finger grab landing on a pair the
first finger already matched, which is correct multi-touch behaviour). Judge
these by **rate and context**, not by presence: a few percent of `ignored-exiting`
in a fast run is the design working, while `ignored-frozen` outside a countdown
or `ignored-removed` climbing with tap speed is a real defect.

⚠️ Records written **before** the census change are threshold-filtered and will
skew the percentages upward. Check the date range of the files being analyzed
before trusting a `%` column that spans that boundary.

## Persistence & rotation (shared by both sinks)

Both the perf and error sinks write through `server/utils/diagnosticsLog.ts`
(`appendDiagnostic(prefix, record)`), which owns three behaviors:

- **Persistence across rebuilds.** The log directory is `DIAGNOSTICS_LOG_DIR` when
  set, else `<dist>/logs` (the historical in-container path). In prod,
  `docker-compose.prod.yml` sets `DIAGNOSTICS_LOG_DIR=/app/logs` and bind-mounts
  `./server/logs:/app/logs`, so the logs live on the **host** at
  `~/vocabulary-app/server/logs/` and **survive `docker-compose up --build`** (they
  used to be wiped on every rebuild). The bind-mount dir must be writable by the
  container's `nodejs` user (uid 1001) — the host `server/logs` dir is `chmod 777`
  for that reason; the writer swallows errors, so a perms mismatch would silently
  drop logs.
- **Time-based (daily) rotation.** Records append to `<prefix>-YYYY-MM-DD.jsonl`
  (UTC day). A new file starts each day automatically — no single file grows
  unbounded, no rename/lock dance.
- **Retention sweep.** Dated files older than `DIAGNOSTICS_LOG_RETENTION_DAYS`
  (default **30**; `0` disables) are deleted, throttled to an hourly readdir per
  prefix. Keeps the directory bounded without an external cron.

**Container stdout/stderr logs** are a *separate* concern (not the JSONL above):
all three prod services set a `json-file` `max-size: 10m` / `max-file: 5` cap (a
shared `x-logging` anchor in `docker-compose.prod.yml`) so docker's default
*unbounded* driver can't grow to GBs over long uptimes.

## Lifecycle / removal

This is a **diagnostic instrument**, not a permanent feature. Once the lag is
root-caused and fixed, it can be removed (delete the client module + bootstrap
guard, the endpoint, and the script) or left in place behind the
production gate. Both diagnostics endpoints are rate-limited (60 req/min per
IP via `diagnosticsLimiter`) so a runaway client loop can't fill the disk.

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
| **Server sink** | `server/routes/diagnosticsRoutes.ts` → `POST /api/diagnostics/error` | Unauthenticated endpoint; appends one scrubbed record per POST via the shared writer + prints a `💥 client-error …` one-line summary. |
| **Storage** | `server/logs/client-error-YYYY-MM-DD.jsonl` (host) | Append-only JSONL via `appendDiagnostic` — **persisted + daily-rotated** (see "Persistence & rotation"). |

## What is captured

One record per error, from four sources (all funnelled through
`reportClientError`, every path wrapped in try/catch — reporting never throws or
recurses):

- **`react`** — render-phase throws caught by `AppErrorBoundary.componentDidCatch`
  (carries a `componentStack`).
- **`window-error`** — uncaught runtime errors incl. event-handler throws.
- **`unhandledrejection`** — async / promise rejections.
- **`unexpected-reload`** — a browser/OS-initiated full reload caught mid-flow via
  the **reload-surviving breadcrumb** (see below). This is **not** a JS exception —
  it's the one crash class the boundary + listeners are blind to.

Each record: `kind`, `message`, `stack`, `componentStack?` (react only), `path`
(route), `userAgent`, `at` (client ts); the server adds `receivedAt` + `ip`. For
`unexpected-reload`, `stack` holds the breadcrumb context as JSON
(`flow`, `phase`, `ref`, `path`, `deviceMemory`, `ageMs`) since there is no JS stack.

### Reload-surviving breadcrumb (catching OS reloads)

iOS WebKit can tear down and **reload** a memory-pressured tab outright — e.g. the
flashcard icon editor (fie) holding up to a dozen icon images plus the live gesture
canvas. That destroys the JS context with **no throw**, so the boundary and `window`
listeners never see it; the page just silently reloads (symptom: Save → page
refreshes back to flp on a *different* card, edit button greyed, card un-flippable —
flp's cold-mount state after a real reload). To observe it:

- `setEditBreadcrumb({ flow, phase, ref })` writes `diag:edit-breadcrumb` to
  `localStorage` (+ `ts`, `path`, `deviceMemory`) when a reload-risky flow starts.
  fie calls it in `enterEdit` (`phase: "editing"`) and re-stamps it at the start of
  `handleSaveLayout` (`phase: "saving"` — the suspected reload moment).
- `clearEditBreadcrumb()` removes it on every **clean** exit: `exitEdit` (cancel /
  post-save) and an flp unmount effect (in-app navigation away).
- On boot, `initErrorReporting()` → `reportUnexpectedReload()` finds a leftover
  breadcrumb younger than `BREADCRUMB_TTL_MS` (10 min) and reports it, then clears
  it. A clean exit leaves nothing, so a normal load reports nothing.

Code: `src/utils/errorReporting.ts` (breadcrumb helpers + boot check),
`src/features/flashcards/FlashcardsLearnPage/FlashcardsLearnPage.tsx` (`enterEdit`, `exitEdit`,
`handleSaveLayout`, unmount effect).

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
Rate-limited to 60 req/min per IP (`diagnosticsLimiter`). Always responds `204`;
only appends to the JSONL log, never touches the database.

## Reading the data

Logs are persisted on the **host** (survive rebuilds), one file per UTC day:

```bash
# today's crashes (read straight from the host — no docker exec needed)
cat server/logs/client-error-$(date -u +%F).jsonl
# all days, real crashes only (filter out manual SMOKE/TEST lines)
cat server/logs/client-error-*.jsonl | grep -iv 'test'
# one-line summaries in the container console log (capped at 10m × 5 files)
docker logs cow-backend-prod 2>&1 | grep '💥 client-error'
```
