import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';

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

/**
 * Per-user cap on WRITE traffic — the coarse backstop behind every other guard in
 * the app.
 *
 * WHY IT EXISTS. Until this was added, only four route groups were limited
 * (credentials, refresh, diagnostics, third-party proxies); every authenticated
 * write — minute points, marks, sorts, votes, decks, texts, challenges — accepted
 * unlimited request volume. Most of those endpoints are individually correct, but
 * "individually correct" is a per-request property: it is request VOLUME that turns
 * a check-then-write race into a currency generator, and unbounded row growth into
 * a disk problem. This bounds the volume so a single scripted client cannot lean on
 * any of them hard enough to matter.
 *
 * NOT A SUBSTITUTE FOR CORRECTNESS. It buys time and bounds damage; it does not
 * make a TOCTOU safe. Endpoints whose invariant actually matters still enforce it
 * atomically (see IUserDAL.claimMinutePointIncrement).
 *
 * SIZING. 600 writes per 5 minutes = 2/second sustained. A real study session
 * writes at most a few per second in bursts (marking a card, saving a layout, a
 * quick-mark batch), and one minute point per minute; nothing legitimate
 * approaches this rate for five minutes straight.
 *
 * KEYED PER USER, NOT PER IP. Keying on IP would let one abusive client throttle
 * an entire office or CGNAT range, and would be trivially sidestepped anyway. The
 * key is the caller's `userId`, recovered by verifying the same JWT the auth
 * middleware will verify a moment later; unauthenticated or unverifiable requests
 * fall back to the IP so the limiter still covers them (they are about to be
 * rejected with a 401 regardless).
 */
export const writeLimiter = rateLimit({
  ...standardOptions,
  windowMs: 5 * 60 * 1000,
  limit: 600,
  // GET/HEAD/OPTIONS are not the abuse surface this limiter is for; exempting them
  // keeps read-heavy screens (feeds, boards, dictionary search) off the counter.
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
  keyGenerator: (req) => rateLimitIdentity(req),
  message: { error: 'Too many requests, please slow down', code: 'ERR_RATE_LIMITED' },
});

/**
 * The caller's identity for rate-limiting purposes: their userId when the request
 * carries a verifiable access token, otherwise their IP.
 *
 * Deliberately a SEPARATE, non-throwing verification rather than a dependency on
 * `req.user`. This limiter is mounted globally, ahead of the routers, so
 * `authenticateToken` (which each route applies itself) has not run yet and
 * `req.user` is still undefined. Verifying here costs one HMAC check and — because
 * it never throws and never sends a response — cannot change which status code a
 * bad token produces: that stays the auth middleware's job.
 */
function rateLimitIdentity(req: Request): string {
  const headerToken = req.headers['authorization']?.split(' ')[1];
  const token = headerToken || (req as any).cookies?.token;
  if (token && token !== 'undefined' && token !== 'null') {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { userId?: string };
      if (decoded?.userId) return `user:${decoded.userId}`;
    } catch {
      // Unverifiable token — fall through to the IP key. The request is about to
      // be 401'd anyway; it just must not escape the counter on the way.
    }
  }
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}
