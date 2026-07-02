import rateLimit from 'express-rate-limit';

/**
 * Rate limiters for the abuse-sensitive route groups.
 *
 * LAYER: HTTP middleware (sits in front of controllers; no business logic).
 *
 * All limiters key on req.ip, which is correct only because server.ts sets
 * `trust proxy: 1` — in prod the backend is reachable solely through the nginx
 * frontend container (bound to 127.0.0.1:5002 + the docker network), so the
 * one trusted hop is exactly the TLS-terminating proxy.
 *
 * Referenced by: server.ts (route registrations), docs/TOKEN_EXPIRATION_IMPLEMENTATION.md.
 */

const standardOptions = {
  standardHeaders: 'draft-8' as const, // RateLimit-* response headers
  legacyHeaders: false,
};

/**
 * Credential endpoints (login/register): the only endpoints where an attacker
 * gains from raw request volume (bcrypt brute force, account enumeration).
 * 20 attempts per 15 minutes per IP is far above any legitimate human rate.
 */
export const authLimiter = rateLimit({
  ...standardOptions,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: { error: 'Too many authentication attempts, please try again later', code: 'ERR_RATE_LIMITED' },
});

/**
 * Token refresh: legitimate clients refresh at most every ~15 minutes per tab,
 * but multiple tabs/devices behind one IP (offices, CGNAT) need headroom, so
 * this is deliberately looser than authLimiter.
 */
export const refreshLimiter = rateLimit({
  ...standardOptions,
  windowMs: 15 * 60 * 1000,
  limit: 120,
  message: { error: 'Too many token refresh attempts, please try again later', code: 'ERR_RATE_LIMITED' },
});

/**
 * Unauthenticated diagnostics sinks (/api/diagnostics/perf, /error): each POST
 * appends to a JSONL log on disk. Per-request caps already bound one request's
 * size; this bounds the request *rate* so a loop can't fill the disk.
 * Responds 204 (not 429 JSON) because the client fires these via sendBeacon and
 * never reads the response.
 */
export const diagnosticsLimiter = rateLimit({
  ...standardOptions,
  windowMs: 60 * 1000,
  limit: 60,
  handler: (_req, res) => res.status(204).end(),
});

/**
 * Authenticated third-party proxies (TTS, handwriting recognition, icons8
 * search/ensure): each call spends Google/icons8 quota. Generous — normal use
 * is bursty but low-volume; this only stops runaway loops and scripted abuse.
 */
export const proxyLimiter = rateLimit({
  ...standardOptions,
  windowMs: 5 * 60 * 1000,
  limit: 300,
  message: { error: 'Too many requests to this endpoint, please slow down', code: 'ERR_RATE_LIMITED' },
});
