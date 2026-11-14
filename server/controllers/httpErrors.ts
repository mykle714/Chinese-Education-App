import { Response } from 'express';
import { DALError } from '../types/dal.js';

/**
 * Turn a thrown error into the app's JSON error response. Shared by UserController and
 * SignInController (it was UserController's private `handleError`).
 *
 *   DALError (and its ValidationError / NotFoundError / DuplicateError / RateLimitError /
 *   ForbiddenError subclasses) → its own status + sanitized message (`toClientError`)
 *   a legacy `{ code, statusCode }` error → its status, message sanitized
 *   a JWT error → 401
 *   anything else → 500 with no detail (logged in full server-side)
 *
 * The server has no Express error middleware, so a controller that lets an error escape gets
 * Express's default HTML 500. Controllers catch and call this.
 *
 * Layer: controller helper (HTTP only).
 */
export function respondWithError(res: Response, error: any, label: string): void {
  console.error(`${label} error:`, {
    message: error?.message,
    stack: error?.stack,
    code: error?.code,
    statusCode: error?.statusCode,
    timestamp: new Date().toISOString(),
  });

  if (error instanceof DALError) {
    const clientError = error.toClientError();
    res.status(clientError.statusCode).json({ error: clientError.message, code: clientError.code });
    return;
  }

  if (error?.code && error?.statusCode) {
    let sanitizedMessage = String(error.message ?? '');
    sanitizedMessage = sanitizedMessage.replace(/mykle\.database\.windows\.net/gi, '[server]');
    sanitizedMessage = sanitizedMessage.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[server]');
    sanitizedMessage = sanitizedMessage.replace(/:\d{4,5}/g, '');
    sanitizedMessage = sanitizedMessage.replace(/in \d+ms/g, '');
    res.status(error.statusCode).json({ error: sanitizedMessage, code: error.code });
    return;
  }

  if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
    res.status(401).json({ error: 'Invalid or expired token', code: 'ERR_INVALID_TOKEN' });
    return;
  }

  res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL_SERVER_ERROR' });
}
