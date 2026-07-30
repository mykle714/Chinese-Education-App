import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * asyncHandler — the one adapter between an async controller method and an Express
 * route.
 *
 * LAYER: HTTP route layer (plumbing).
 *
 * Every route in this directory used to be registered like this:
 *
 *   // @ts-ignore
 *   router.get('/api/dictionary/search', authenticateToken, async (req, res) => {
 *     await dictionaryController.search(req, res);
 *   });
 *
 * and now reads:
 *
 *   router.get('/api/dictionary/search', authenticateToken, handle(dictionaryController.search, dictionaryController));
 *
 * Two things are fixed by this:
 *
 * 1. **The `@ts-ignore`s are gone.** They were never about the handler at all — they
 *    silenced a mismatch in `authenticateToken`'s inferred return type, which is now
 *    correct (see authMiddleware.ts). They are removed rather than kept "just in
 *    case", because a blanket suppression on a route registration also hides a
 *    genuinely wrong path or missing argument.
 *
 * 2. **Rejected promises are no longer unhandled.** Express 4 does NOT catch a
 *    promise rejection thrown out of an async handler: the request hangs until the
 *    client times out and Node logs an unhandled rejection. Controllers here almost
 *    always try/catch internally, but "almost always" is exactly the gap that bites.
 *    `handle` attaches a `.catch(next)` so any escaped rejection reaches the Express
 *    error middleware and returns a 500.
 *
 * The `thisArg` parameter exists because controller methods are ordinary (non-bound)
 * class methods: passing `controller.search` alone would lose `this`. Pass the
 * controller as the second argument, or pre-bind at the call site.
 *
 * See docs/ARCHITECTURE_REVIEW.md finding 10.
 */
export function handle(
  fn: (req: Request, res: Response) => unknown | Promise<unknown>,
  thisArg?: unknown
): RequestHandler {
  // Fail at BOOT, not on the first request. `handle(controller.typo, controller)`
  // would otherwise register happily and only 500 the first time someone hits the
  // route — which, for a rarely-used endpoint, could be a long time.
  if (typeof fn !== 'function') {
    throw new TypeError(
      'asyncHandler: expected a function. A route was registered with an undefined ' +
        'controller method — check the method name at the registration site.'
    );
  }

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = thisArg ? fn.call(thisArg, req, res) : fn(req, res);
      // Only a thenable needs a catch; a synchronous handler that threw is already
      // covered by the try/catch around this call.
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Alias kept for readability at registration sites that read better as
 * `asyncHandler(...)`. Same function.
 */
export const asyncHandler = handle;
