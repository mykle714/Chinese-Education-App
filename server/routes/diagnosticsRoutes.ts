import { Router } from 'express';
import { appendDiagnostic } from '../utils/diagnosticsLog.js';
import { diagnosticsLimiter } from '../middleware/rateLimits.js';

/**
 * Client diagnostics sinks — /api/diagnostics/*
 *
 * LAYER: HTTP route layer (handlers are self-contained log appenders; no DB).
 * Split out of server.ts; paths unchanged.
 *
 * Both routes are deliberately UNAUTHENTICATED: payloads arrive via
 * navigator.sendBeacon / keepalive fetch, which cannot attach an Authorization
 * header, and crashes/lag also affect public/demo sessions. Defenses instead:
 * per-request caps (record count, field lengths, express.json body limit) plus
 * diagnosticsLimiter (per-IP request rate) so a loop can't fill the disk.
 * Logs are git-ignored JSONL via the shared diagnostics writer (daily-rotated,
 * persisted across rebuilds — see utils/diagnosticsLog.ts and
 * docs/CLIENT_PERF_DIAGNOSTICS.md).
 */
const router = Router();

// Client performance diagnostics sink. Receives batched interaction-latency
// telemetry from the browser (see src/utils/perfDiagnostics.ts). Used to diagnose
// the prod-only "buttons take 1–2s before working" lag on the mobile-demo
// footer/decks.
// @ts-ignore
router.post('/api/diagnostics/perf', diagnosticsLimiter, (req, res) => {
  try {
    const body = req.body || {};
    const records = Array.isArray(body.records) ? body.records : [];
    // Cap to avoid a malicious/buggy client flooding the log in one request.
    if (records.length === 0 || records.length > 100) {
      return res.status(204).end();
    }

    const entry = {
      receivedAt: new Date().toISOString(),
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      userAgent: typeof body.userAgent === 'string' ? body.userAgent.slice(0, 400) : undefined,
      deviceMemory: body.deviceMemory,
      hardwareConcurrency: body.hardwareConcurrency,
      connection: body.connection,
      records,
    };

    appendDiagnostic('client-perf', entry);

    // Compact console summary: the worst interaction in this batch, so prod logs
    // surface the lag without needing to open the JSONL.
    const worst = records
      .filter((r: any) => r && r.kind === 'interaction')
      .sort((a: any, b: any) => (b.duration || 0) - (a.duration || 0))[0];
    if (worst) {
      console.log(
        `⏱️  client-perf: ${worst.duration}ms on ${worst.path} ` +
        `[${worst.target || worst.name}] ` +
        `(inputDelay=${worst.inputDelay}ms, processing=${worst.processing}ms, present=${worst.presentation}ms)`
      );
    }

    // 204 keeps the beacon response empty; the client ignores the body anyway.
    return res.status(204).end();
  } catch (err) {
    console.error('Error handling client perf diagnostics:', err);
    return res.status(204).end();
  }
});

// Client-error sink (mirrors the perf sink above). The app has no other way to
// surface front-end crashes — this receives one scrubbed error record per POST
// from the client error boundary + global error/unhandledrejection listeners.
// The CLIENT scrubs tokens/PII before sending (see src/utils/errorReporting.ts);
// we additionally cap field lengths here.
// @ts-ignore
router.post('/api/diagnostics/error', diagnosticsLimiter, (req, res) => {
  try {
    const body = req.body || {};
    const message = typeof body.message === 'string' ? body.message.slice(0, 2000) : undefined;
    // Require at least a message; ignore empty/garbage beacons.
    if (!message) {
      return res.status(204).end();
    }

    const entry = {
      receivedAt: new Date().toISOString(),
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      kind: typeof body.kind === 'string' ? body.kind.slice(0, 40) : undefined,
      message,
      stack: typeof body.stack === 'string' ? body.stack.slice(0, 8000) : undefined,
      componentStack:
        typeof body.componentStack === 'string' ? body.componentStack.slice(0, 8000) : undefined,
      path: typeof body.path === 'string' ? body.path.slice(0, 300) : undefined,
      userAgent: typeof body.userAgent === 'string' ? body.userAgent.slice(0, 400) : undefined,
      at: typeof body.at === 'number' ? body.at : undefined,
    };

    appendDiagnostic('client-error', entry);

    // Compact console summary so prod logs surface crashes without opening the JSONL.
    console.error(
      `💥 client-error [${entry.kind || 'error'}] on ${entry.path || '?'}: ${message.slice(0, 200)}`
    );

    return res.status(204).end();
  } catch (err) {
    console.error('Error handling client error diagnostics:', err);
    return res.status(204).end();
  }
});

export default router;
