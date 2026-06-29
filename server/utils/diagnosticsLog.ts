import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES-module __dirname (this file compiles to dist/utils/diagnosticsLog.js).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Shared writer for the client diagnostics JSONL logs (perf + error sinks in
 * server.ts). Extracted so both sinks share ONE implementation of the directory
 * resolution, daily rotation, and retention sweep.
 *
 * PERSISTENCE: the log directory is configurable via `DIAGNOSTICS_LOG_DIR`. In
 * prod that env var points at a bind-mounted host directory (see
 * docker-compose.prod.yml: `DIAGNOSTICS_LOG_DIR=/app/logs` + `./server/logs:/app/logs`)
 * so the logs SURVIVE container rebuilds — previously they lived at
 * `<dist>/logs` inside the container and were wiped on every `up --build`. The
 * default keeps that historical in-container location for local/dev (`<dist>/logs`,
 * i.e. one level up from this util's dist/utils dir).
 *
 * ROTATION is TIME-BASED (daily): records are appended to a per-UTC-day file
 * named `<prefix>-YYYY-MM-DD.jsonl`. A new day starts a new file automatically —
 * no rename/lock dance, no single file growing unbounded, and each day's data is
 * trivially greppable/archivable on its own. Files older than the retention
 * window are swept (see below).
 */

// Base directory for diagnostic JSONL logs (see PERSISTENCE above).
export const DIAGNOSTICS_LOG_DIR =
  process.env.DIAGNOSTICS_LOG_DIR || path.join(__dirname, '..', 'logs');

// How many days of dated files to keep. Each daily file is tiny, so this is
// generous; set to 0 to disable the sweep entirely (keep forever).
const RETENTION_DAYS = Number(process.env.DIAGNOSTICS_LOG_RETENTION_DAYS ?? 30);

// The retention sweep does a readdir; throttle it to at most hourly per prefix so
// a high-traffic append path doesn't scan the directory on every write.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const lastSweep: Record<string, number> = {};

/** UTC `YYYY-MM-DD` — the daily rotation key. UTC (not local) so the boundary is
 *  stable regardless of server timezone and matches the ISO `receivedAt`. */
function dayStamp(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Append one record as a JSON line to today's `<prefix>-YYYY-MM-DD.jsonl` under
 * DIAGNOSTICS_LOG_DIR, then (throttled) sweep expired dated files. Fire-and-forget
 * and fully guarded — diagnostics must never throw into a request handler.
 */
export function appendDiagnostic(prefix: string, record: unknown): void {
  try {
    fs.mkdirSync(DIAGNOSTICS_LOG_DIR, { recursive: true });
    const file = path.join(DIAGNOSTICS_LOG_DIR, `${prefix}-${dayStamp()}.jsonl`);
    fs.appendFile(file, JSON.stringify(record) + '\n', () => {});
    sweepOldLogs(prefix);
  } catch {
    /* never throw from diagnostics */
  }
}

/**
 * Delete `<prefix>-YYYY-MM-DD.jsonl` files whose day is older than RETENTION_DAYS.
 * Async + best-effort; throttled per prefix. No-op when retention is disabled (0).
 */
function sweepOldLogs(prefix: string): void {
  if (RETENTION_DAYS <= 0) return;
  const now = Date.now();
  if (lastSweep[prefix] && now - lastSweep[prefix] < SWEEP_INTERVAL_MS) return;
  lastSweep[prefix] = now;

  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const dated = new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})\\.jsonl$`);
  fs.readdir(DIAGNOSTICS_LOG_DIR, (err, files) => {
    if (err) return;
    for (const f of files) {
      const m = f.match(dated);
      if (!m) continue;
      const dayMs = Date.parse(`${m[1]}T00:00:00Z`);
      if (!Number.isNaN(dayMs) && dayMs < cutoff) {
        fs.unlink(path.join(DIAGNOSTICS_LOG_DIR, f), () => {});
      }
    }
  });
}
