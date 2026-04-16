import { Request, Response } from 'express';
import { ValidationError, DuplicateError, NotFoundError, DALError } from '../types/dal.js';

/**
 * Shared controller utilities — auth extraction and error handling.
 * Centralizes boilerplate that was previously copy-pasted into every controller.
 */

/**
 * Extract and validate the authenticated user's ID from an Express request.
 * The `authenticateToken` middleware attaches `req.user.userId` after JWT verification.
 *
 * Returns the userId string, or sends a 401 response and returns null if the user
 * is not authenticated. Callers should return early when this returns null.
 *
 * @example
 * const userId = requireUserId(req, res);
 * if (!userId) return;
 */
export function requireUserId(req: Request, res: Response): string | null {
  const userId = (req as any).user?.userId;
  if (!userId) {
    res.status(401).json({
      error: 'User not authenticated',
      code: 'ERR_NOT_AUTHENTICATED'
    });
    return null;
  }
  return userId;
}

/**
 * Convert a caught error into an appropriate HTTP response.
 * Handles all DAL error types (ValidationError, DuplicateError, NotFoundError, DALError),
 * sanitizes legacy error messages to strip internal server details, and falls back to a
 * generic 500 for anything unexpected.
 *
 * @param error - The caught error (typed as `any` because catch blocks are untyped)
 * @param res   - The Express response object
 * @param controllerName - Short label used in the server-side log line for traceability
 */
export function handleControllerError(error: any, res: Response, controllerName: string = 'Controller'): void {
  // Log full error details server-side for debugging — never expose these to the client
  console.error(`${controllerName} error:`, {
    message: error.message,
    stack: error.stack,
    code: error.code,
    statusCode: error.statusCode,
    timestamp: new Date().toISOString()
  });

  // DAL error types each carry a toClientError() method that produces a safe, sanitized payload
  if (
    error instanceof ValidationError ||
    error instanceof DuplicateError ||
    error instanceof NotFoundError ||
    error instanceof DALError
  ) {
    const clientError = error.toClientError();
    res.status(clientError.statusCode).json({
      error: clientError.message,
      code: clientError.code
    });
    return;
  }

  // FK constraint violation: user's account was deleted but they still hold a valid JWT.
  // Return 401 so the client's fetch interceptor clears the stale session.
  if (error.code === '23503' && error.message?.includes('vocabentries_userId_fkey')) {
    res.status(401).json({ error: 'Session invalid. Please log in again.' });
    return;
  }

  // Legacy custom errors that predate the DAL layer — sanitize to strip internal details
  if (error.code && error.statusCode) {
    let sanitizedMessage: string = error.message;
    sanitizedMessage = sanitizedMessage.replace(/mykle\.database\.windows\.net/gi, '[server]');
    sanitizedMessage = sanitizedMessage.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[server]');
    sanitizedMessage = sanitizedMessage.replace(/:\d{4,5}/g, '');
    sanitizedMessage = sanitizedMessage.replace(/in \d+ms/g, '');

    res.status(error.statusCode).json({
      error: sanitizedMessage,
      code: error.code
    });
    return;
  }

  // Catch-all: never expose internal details to the client
  res.status(500).json({
    error: 'Internal server error',
    code: 'ERR_INTERNAL_SERVER_ERROR'
  });
}
